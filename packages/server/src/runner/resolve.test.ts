import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeFixtures,
  type FixtureRepo,
  type FixtureSet,
} from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter } from '../git/adapter.js';
import { createCommandRunner } from '../proc/run-command.js';
import { CheckFailure } from './errors.js';
import { resolveRefs } from './resolve.js';

const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** git mentah untuk menyiapkan data uji; bukan bagian yang diuji. */
const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
  }).trim();

let tmp: string;
let set: FixtureSet;
let order: FixtureRepo;
/** Repo dengan dua branch di origin yang riwayatnya tidak berhubungan. */
let unrelated: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-runner-resolve-'));
  set = await makeFixtures(path.join(tmp, 'fixtures'));
  order = set.repos['svc-order'];
  // Tag dan commit dibuat di klon fixture milik berkas ini saja.
  rawGit(order.path, 'tag', 'v-feature', order.commits['feature-xyz'] as string);

  const bare = path.join(tmp, 'unrelated.git');
  unrelated = path.join(tmp, 'unrelated');
  await fs.mkdir(unrelated, { recursive: true });
  rawGit(tmp, 'init', '--quiet', '--bare', bare);
  rawGit(unrelated, 'init', '--quiet', '--initial-branch=main');
  rawGit(unrelated, 'commit', '--quiet', '--allow-empty', '-m', 'main');
  rawGit(unrelated, 'checkout', '--quiet', '--orphan', 'lain');
  rawGit(unrelated, 'commit', '--quiet', '--allow-empty', '-m', 'lain');
  rawGit(unrelated, 'remote', 'add', 'origin', bare);
  rawGit(unrelated, 'push', '--quiet', 'origin', 'main', 'lain');
  rawGit(unrelated, 'fetch', '--quiet', 'origin');
}, 120_000);

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const resolve = (repo: string, baseRef: string, headRef: string) =>
  resolveRefs(git, repo, { baseRef, headRef });

describe('resolveRefs', () => {
  it('head berupa branch: base_sha = merge-base dengan base_ref', async () => {
    expect(await resolve(order.path, 'main', 'feature/xyz')).toEqual({
      baseTipSha: order.commits['readme'], // ujung origin/main
      baseSha: order.commits['initial'],
      headSha: order.commits['feature-xyz'],
    });
  });

  it('head berupa tag dan berupa SHA menghasilkan pasangan SHA yang sama dengan branch-nya', async () => {
    const expected = {
      baseTipSha: order.commits['readme'],
      baseSha: order.commits['initial'],
      headSha: order.commits['feature-xyz'],
    };

    expect(await resolve(order.path, 'main', 'v-feature')).toEqual(expected);
    expect(await resolve(order.path, 'main', order.commits['feature-xyz'] as string)).toEqual(
      expected,
    );
    expect(
      await resolve(order.path, 'main', (order.commits['feature-xyz'] as string).slice(0, 8)),
    ).toEqual(expected);
  });

  it('base_ref juga boleh tag atau commit', async () => {
    expect(await resolve(order.path, order.commits['initial'] as string, 'feature/xyz')).toEqual({
      baseTipSha: order.commits['initial'],
      baseSha: order.commits['initial'],
      headSha: order.commits['feature-xyz'],
    });
  });

  it('branch yang tidak ada di origin gagal dengan teks origin/<ref> tidak ada', async () => {
    const failure = await resolve(order.path, 'main', 'feature/old').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CheckFailure);
    expect((failure as Error).message).toBe('origin/feature/old tidak ada');
  });

  it('SHA yang tidak ada gagal dengan teks Commit <sha> tidak ada; base yang hilang disebut juga', async () => {
    const ghost = 'deadbeef';
    await expect(resolve(order.path, 'main', ghost)).rejects.toThrow('Commit deadbeef tidak ada');
    await expect(resolve(order.path, 'hilang', 'feature/xyz')).rejects.toThrow(
      'origin/hilang tidak ada',
    );
  });

  it('branch lokal tanpa padanan di origin tidak dipakai', async () => {
    rawGit(order.path, 'branch', 'hanya-lokal', order.commits['feature-xyz'] as string);

    await expect(resolve(order.path, 'main', 'hanya-lokal')).rejects.toThrow(
      'origin/hanya-lokal tidak ada',
    );
  });

  it('riwayat tidak berhubungan: gagal dengan pesan yang menyebut kedua ref', async () => {
    const failure = await resolve(unrelated, 'main', 'lain').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CheckFailure);
    expect((failure as Error).message).toContain('main');
    expect((failure as Error).message).toContain('lain');
    expect((failure as Error).message).toContain('tidak berhubungan');
  });
});
