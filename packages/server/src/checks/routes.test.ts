import { ApiErrorEnvelope, ValidationDetails, type Check, type Repo } from '@cc/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { OasdiffUnavailableError } from '../diff/oasdiff.js';
import { createApp } from '../http/app.js';
import { createLogger } from '../logger.js';
import { createProjectRepository } from '../projects/repository.js';
import { createRepoRepository } from '../repos/repository.js';
import { CheckAlreadyRunningError, type StartCheckInput } from '../runner/check.js';
import { checkRoutes } from './routes.js';

let db: Db;
let provider: Repo;
let app: ReturnType<typeof createApp>;
const start = vi.fn<(input: StartCheckInput) => Promise<Check>>();

const row = (over: Partial<Check> = {}): Check => ({
  id: 5,
  project_id: provider.project_id,
  provider_repo_id: provider.id,
  base_ref: 'main',
  head_ref: 'feature/xyz',
  base_sha: null,
  head_sha: null,
  status: 'running',
  started_at: '2026-11-03T00:00:00.000Z',
  finished_at: null,
  error: null,
  ...over,
});

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  const project = createProjectRepository(db).create({
    name: 'Order',
    slug: 'order',
    description: null,
  });
  const created = createRepoRepository(db).create({
    projectId: project?.id as number,
    role: 'service',
    name: 'svc-order',
    localPath: '/r/svc-order',
    defaultBranch: 'develop',
  });
  provider = (created as { repo: Repo }).repo;
  start.mockReset();
  app = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: checkRoutes({ db, checks: { start } }),
  });
});

afterEach(() => {
  db.close();
});

const post = (body: unknown) =>
  request(app)
    .post('/api/checks')
    .send(body as object);

const errorOf = (body: unknown) => ApiErrorEnvelope.parse(body).error;

describe('POST /api/checks', () => {
  it('202 dengan baris check; base_ref kosong memakai branch default provider', async () => {
    start.mockResolvedValue(row({ base_ref: 'develop' }));

    const res = await post({ provider_repo_id: provider.id, head_ref: ' feature/xyz ' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(row({ base_ref: 'develop' }));
    expect(start).toHaveBeenCalledWith({
      provider,
      baseRef: 'develop',
      headRef: 'feature/xyz',
    });
  });

  it('base_ref yang dikirim dipakai apa adanya', async () => {
    start.mockResolvedValue(row());

    await post({ provider_repo_id: provider.id, head_ref: 'v1.2.0', base_ref: 'release' });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'release', headRef: 'v1.2.0' }),
    );
  });

  it('body tidak valid → 400 validation_failed dengan pesan per isian, check tidak dimulai', async () => {
    const res = await post({ provider_repo_id: provider.id, head_ref: '  ' });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('validation_failed');
    expect(ValidationDetails.parse(errorOf(res.body).details).fields).toEqual([
      { in: 'body', path: 'head_ref', message: 'Ref head wajib diisi' },
    ]);
    expect(start).not.toHaveBeenCalled();
  });

  it('repo provider tidak ada → 404 repo_not_found', async () => {
    const res = await post({ provider_repo_id: 999, head_ref: 'x' });

    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('repo_not_found');
    expect(start).not.toHaveBeenCalled();
  });

  it('project sudah punya check berjalan → 409 check_already_running membawa id project dan check', async () => {
    start.mockRejectedValue(new CheckAlreadyRunningError(provider.project_id, 4));

    const res = await post({ provider_repo_id: provider.id, head_ref: 'x' });

    expect(res.status).toBe(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'check_already_running',
      details: { project_id: provider.project_id, check_id: 4 },
    });
  });

  it('oasdiff tidak bisa dipakai → 503 oasdiff_unavailable dengan pesannya', async () => {
    start.mockRejectedValue(new OasdiffUnavailableError('missing', 'oasdiff tidak ditemukan'));

    const res = await post({ provider_repo_id: provider.id, head_ref: 'x' });

    expect(res.status).toBe(503);
    expect(errorOf(res.body)).toMatchObject({
      code: 'oasdiff_unavailable',
      message: 'oasdiff tidak ditemukan',
    });
  });
});
