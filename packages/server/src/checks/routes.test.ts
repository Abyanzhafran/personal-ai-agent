import { ApiErrorEnvelope, CheckEvent, ValidationDetails, type Check, type Repo } from '@cc/shared';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { createCheckEvents } from '../runner/events.js';
import { createCheckRepository } from './repository.js';
import { checkRoutes } from './routes.js';

let db: Db;
let provider: Repo;
let app: ReturnType<typeof createApp>;
const start = vi.fn<(input: StartCheckInput) => Promise<Check>>();
let events: ReturnType<typeof createCheckEvents>;
let servers: http.Server[] = [];

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
  events = createCheckEvents();
  app = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: checkRoutes({ db, checks: { start, events } }),
  });
});

afterEach(async () => {
  await Promise.all(
    servers.map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
  servers = [];
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

/** Server sungguhan di port acak: supertest tidak cocok untuk aliran yang sengaja dibiarkan terbuka. */
async function serve(heartbeatMs?: number): Promise<string> {
  const stream = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: checkRoutes({
      db,
      checks: { start, events },
      ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    }),
  });
  const server = http.createServer(stream);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const newCheck = () =>
  createCheckRepository(db).create({
    projectId: provider.project_id,
    providerRepoId: provider.id,
    baseRef: 'main',
    headRef: 'feature/xyz',
    startedAt: '2026-11-03T13:42:00.000Z',
  });

/** Frame SSE bernama (komentar `: keepalive` dilewati) menjadi objek. */
const parseFrames = (text: string): { event: string; id: string; data: CheckEvent }[] =>
  text
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const field = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(frame)?.[1] ?? '';
      return {
        event: field('event'),
        id: field('id'),
        data: JSON.parse(field('data')) as CheckEvent,
      };
    });

/** Membaca aliran sampai `predicate` benar untuk teks yang terkumpul. */
async function readUntil(res: Response, predicate: (text: string) => boolean): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!predicate(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return text;
}

describe('GET /api/checks/:id/events', () => {
  it('check selesai: semua event diputar ulang dengan event:/id:/data: lalu koneksi ditutup', async () => {
    const check = newCheck();
    events.open(check.id);
    const report = events.reporter(check.id);
    report.log('start', 'check #1');
    report.step(1, 'running');
    report.step(1, 'done', 'merge-base a1b2c3d');
    events.emit(check.id, { type: 'done', status: 'findings' });
    const base = await serve();

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const frames = parseFrames(await res.text()); // selesai hanya bila server menutup koneksi

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(frames.map((f) => [f.event, f.id, f.data.seq])).toEqual([
      ['log', '1', 1],
      ['step', '2', 2],
      ['step', '3', 3],
      ['done', '4', 4],
    ]);
    expect(frames.every((f) => CheckEvent.safeParse(f.data).success)).toBe(true);
    expect(events.listenerCount(check.id)).toBe(0);
  });

  it('menyambung di tengah langkah 3: langkah 1 dan 2 tetap diterima, lalu event baru sampai done', async () => {
    const check = newCheck();
    events.open(check.id);
    const report = events.reporter(check.id);
    report.step(1, 'done', 'a');
    report.step(2, 'done', 'b');
    report.step(3, 'running', '1 dari 5 file selesai');
    const base = await serve();

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (parseFrames(text).length < 3) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(
      parseFrames(text).map((f) => (f.data.type === 'step' ? [f.data.number, f.data.status] : [])),
    ).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'running'],
    ]);

    report.step(3, 'done', '5 dari 5 file selesai');
    events.emit(check.id, { type: 'done', status: 'clean' });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    const all = parseFrames(text);
    expect(all.map((f) => f.data.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.at(-1)?.data).toMatchObject({ type: 'done', status: 'clean' });
    expect(events.listenerCount(check.id)).toBe(0);
  });

  it('klien putus → pendengar dilepas tanpa menunggu done', async () => {
    const check = newCheck();
    events.open(check.id);
    const base = await serve();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/checks/${check.id}/events`, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(events.listenerCount(check.id)).toBe(1));

    controller.abort();
    await res.body?.cancel().catch(() => undefined);

    await vi.waitFor(() => expect(events.listenerCount(check.id)).toBe(0));
  });

  it('aliran sepi mengirim komentar keepalive berkala', async () => {
    const check = newCheck();
    events.open(check.id);
    const base = await serve(20);

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const text = await readUntil(res, (seen) => seen.includes(': keepalive'));

    expect(text).toContain(': keepalive\n\n');
    await res.body?.cancel();
  });

  it('tanpa buffer di memori: check selesai → satu event done dari DB; check running → 404', async () => {
    const finished = newCheck();
    createCheckRepository(db).fail(finished.id, 'origin/x tidak ada', '2026-11-03T13:43:00.000Z');
    const running = newCheck();
    const base = await serve();

    const done = await fetch(`${base}/api/checks/${finished.id}/events`);
    expect(parseFrames(await done.text()).map((f) => f.data)).toEqual([
      { type: 'done', seq: 1, status: 'failed' },
    ]);

    const lost = await fetch(`${base}/api/checks/${running.id}/events`);
    expect(lost.status).toBe(404);
    expect(errorOf(await lost.json()).code).toBe('check_not_found');
  });

  it('check tidak ada → 404 check_not_found; id bukan angka → 400', async () => {
    const missing = await request(app).get('/api/checks/999/events');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('check_not_found');

    const invalid = await request(app).get('/api/checks/abc/events');
    expect(invalid.status).toBe(400);
    expect(errorOf(invalid.body).code).toBe('validation_failed');
  });
});
