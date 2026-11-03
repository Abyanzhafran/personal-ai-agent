import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixtures, type FixtureRepo } from '../../../../fixtures/make-fixtures.js';
import { createCheckRepository } from '../checks/repository.js';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { createGitAdapter } from '../git/adapter.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createProjectRepository } from '../projects/repository.js';
import { createRepoRepository } from '../repos/repository.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { INTERRUPTED_ERROR, recoverInterruptedChecks } from './recovery.js';

const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));
const logger = { info: vi.fn(), warn: vi.fn() };

let tmp: string;
let order: FixtureRepo;
let layout: WorkspaceLayout;
let workspace: WorkspaceStore;
let db: Db;
let projectId: number;
let providerId: number;
let sequence = 0;

const rawGit = (...args: string[]) =>
  execFileSync('git', ['-C', order.path, ...args], { encoding: 'utf8' }).trim();
/** Hanya klon utama yang boleh terdaftar setelah pemulihan. */
const registeredWorktrees = () =>
  rawGit('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-recovery-'));
  order = (await makeFixtures(path.join(tmp, 'fixtures'))).repos['svc-order'];
}, 120_000);

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  layout = new WorkspaceLayout(path.join(tmp, `workspace-${++sequence}`));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  db = openDatabase(':memory:');
  migrate(db);
  projectId = createProjectRepository(db).create({
    name: 'Order',
    slug: 'order',
    description: null,
  })?.id as number;
  providerId = addRepo('svc-order', order.path);
  logger.info.mockClear();
  logger.warn.mockClear();
});

function addRepo(name: string, localPath: string): number {
  const created = createRepoRepository(db).create({
    projectId,
    role: 'service',
    name,
    localPath,
    defaultBranch: 'main',
  });
  return (created as { repo: { id: number } }).repo.id;
}

function newCheck(providerRepoId = providerId): number {
  return createCheckRepository(db).create({
    projectId,
    providerRepoId,
    baseRef: 'main',
    headRef: 'feature/xyz',
    startedAt: '2026-11-03T13:00:00.000Z',
  }).id;
}

/** Meniru proses yang mati di tengah `spec_cmd`: worktree terdaftar di git dan folder-nya ada. */
async function leaveWorktree(checkId: number): Promise<string> {
  const dir = layout.worktreeDir(checkId, order.commits['initial'] as string);
  await git.worktreeAdd(order.path, dir, order.commits['initial'] as string);
  return dir;
}

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

const recover = () => recoverInterruptedChecks({ db, workspace, git, logger });

describe('recoverInterruptedChecks', () => {
  it('check running → failed; worktree yatim hilang dari disk dan metadata git; hasil lain utuh', async () => {
    const interrupted = newCheck();
    const dir = await leaveWorktree(interrupted);
    await workspace.writeJson(layout.checkArtifact(interrupted, 'spec-base.json'), {
      openapi: '3',
    });
    expect(registeredWorktrees()).toHaveLength(2);

    const finished = newCheck();
    createCheckRepository(db).cancel(finished, '2026-11-03T13:01:00.000Z');
    await workspace.writeJson(layout.checkArtifact(finished, 'spec-base.json'), { openapi: '3' });

    expect(await recover()).toEqual({ recovered: 1 });

    expect(createCheckRepository(db).get(interrupted)).toMatchObject({
      status: 'failed',
      error: INTERRUPTED_ERROR,
    });
    expect(createCheckRepository(db).get(interrupted)?.finished_at).not.toBeNull();
    expect(createCheckRepository(db).get(finished)).toMatchObject({
      status: 'cancelled',
      error: null,
      finished_at: '2026-11-03T13:01:00.000Z',
    });
    expect(await exists(dir)).toBe(false);
    expect(registeredWorktrees()).toHaveLength(1);
    // Artefak check yang terputus tetap ada untuk diperiksa; hanya worktree-nya yang dibuang.
    expect(await exists(layout.checkArtifact(interrupted, 'spec-base.json'))).toBe(true);
    expect(await exists(layout.checkArtifact(finished, 'spec-base.json'))).toBe(true);
  }, 60_000);

  it('sisa worktree dari check yang sudah bukan running juga dibersihkan', async () => {
    const earlier = newCheck();
    createCheckRepository(db).fail(earlier, 'galat lama', '2026-11-03T13:02:00.000Z');
    const dir = await leaveWorktree(earlier);

    expect(await recover()).toEqual({ recovered: 0 });

    expect(await exists(dir)).toBe(false);
    expect(registeredWorktrees()).toHaveLength(1);
    expect(createCheckRepository(db).get(earlier)?.error).toBe('galat lama');
  }, 60_000);

  it('folder repo provider sudah hilang: prune hanya dicatat, check tetap failed dan start tidak berhenti', async () => {
    const ghost = addRepo('hilang', path.join(tmp, 'tidak-ada'));
    const interrupted = newCheck(ghost);

    await expect(recover()).resolves.toEqual({ recovered: 1 });

    expect(createCheckRepository(db).get(interrupted)?.status).toBe('failed');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: ghost }),
      'git worktree prune gagal saat pemulihan',
    );
  });

  it('tidak ada yang tertinggal: tidak ada perubahan', async () => {
    const done = newCheck();
    createCheckRepository(db).cancel(done, '2026-11-03T13:03:00.000Z');

    expect(await recover()).toEqual({ recovered: 0 });

    expect(createCheckRepository(db).get(done)?.status).toBe('cancelled');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
