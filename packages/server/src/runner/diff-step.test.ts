import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Repo } from '@cc/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CHANGELOG } from '../../../../fixtures/changelog.js';
import {
  makeFixtures,
  type FixtureRepo,
  type FixtureSet,
} from '../../../../fixtures/make-fixtures.js';
import type { OasdiffChange } from '../diff/oasdiff.js';
import { createGitAdapter } from '../git/adapter.js';
import { createCommandRunner } from '../proc/run-command.js';
import { SpecGenError, SpecMissing } from '../spec/errors.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { diffSpecs, type DiffStepDeps } from './diff-step.js';
import { CheckFailure } from './errors.js';

let tmp: string;
let fixtures: FixtureSet;
let layout: WorkspaceLayout;
let workspace: WorkspaceStore;
let deps: DiffStepDeps;
const changelog = vi.fn<(input: { base: string; head: string }) => Promise<OasdiffChange[]>>();

const order = (): FixtureRepo => fixtures.repos['svc-order'];

const provider = (over: Partial<Repo> = {}): Repo => ({
  id: 1,
  project_id: 1,
  role: 'service',
  name: 'svc-order',
  local_path: order().path,
  default_branch: 'main',
  spec_path: order().specPath ?? null,
  spec_cmd: order().specCmd ?? null,
  profile_status: 'not_scanned',
  profile_error: null,
  last_fetch_at: null,
  ...over,
});

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-runner-diff-'));
  fixtures = await makeFixtures(path.join(tmp, 'fixtures'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  const runner = createCommandRunner({ oasdiffBin: 'oasdiff', shellRoot: layout.checksDir });
  deps = {
    git: createGitAdapter(runner),
    runner,
    layout,
    workspace,
    timeoutMs: 60_000,
    logger: { info: () => undefined },
    oasdiff: { assertAvailable: () => Promise.resolve('1.35.0'), changelog },
    discovery: {
      profile: () => Promise.resolve({ status: 'not_scanned', error: null, profile: null }),
    },
  };
}, 120_000);

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const run = (repo: Repo, checkId: number) =>
  diffSpecs(deps, {
    checkId,
    provider: repo,
    baseSha: order().commits['initial'] as string,
    headSha: order().commits['feature-xyz'] as string,
  });

describe('diffSpecs', () => {
  it('spec_cmd: menulis tiga artefak, memberi path spec ke oasdiff, dan mengumpulkan endpoint + versi tool', async () => {
    const seen: { base: unknown; head: unknown }[] = [];
    changelog.mockImplementationOnce(async ({ base, head }) => {
      seen.push({
        base: JSON.parse(await fs.readFile(base, 'utf8')),
        head: JSON.parse(await fs.readFile(head, 'utf8')),
      });
      return [...FIXTURE_CHANGELOG];
    });

    const result = await run(provider(), 11);

    expect(changelog).toHaveBeenCalledWith({
      base: layout.checkArtifact(11, 'spec-base.json'),
      head: layout.checkArtifact(11, 'spec-head.json'),
    });
    expect(seen[0]?.base).toEqual(result.baseSpec);
    expect(seen[0]?.head).toEqual(result.headSpec);
    expect(result.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /orders',
      'POST /orders',
      'GET /orders/{order_id}',
      'POST /orders/{order_id}/cancel',
    ]);
    expect(
      JSON.parse(await fs.readFile(layout.checkArtifact(11, 'changelog.json'), 'utf8')),
    ).toHaveLength(FIXTURE_CHANGELOG.length);
    expect(result.toolVersions).toMatchObject({ oasdiff: '1.35.0' });
    expect(result.toolVersions['node']).toMatch(/^v\d+/);
    expect(result.specStale).toBeNull();
  }, 120_000);

  it('tanpa spec_cmd: spec dibaca dari git, tanpa versi tool generator', async () => {
    changelog.mockResolvedValueOnce([]);

    const result = await run(provider({ spec_cmd: null }), 12);

    expect(result.endpoints).toEqual([]);
    expect(result.toolVersions).toEqual({ oasdiff: '1.35.0' });
    expect(result.specUnpinned).toBe(false);
    expect((result.baseSpec as { openapi: string }).openapi).toBe('3.0.3');
  }, 60_000);

  it('spec_path kosong: CheckFailure yang menyebut repo, oasdiff tidak dipanggil', async () => {
    changelog.mockClear();

    const failure = await run(provider({ spec_path: null }), 13).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CheckFailure);
    expect((failure as Error).message).toContain('svc-order belum punya spec_path');
    expect(changelog).not.toHaveBeenCalled();
  });

  it('spec_cmd gagal merambat sebagai SpecGenError dan worktree dibersihkan', async () => {
    const failing = provider({ id: 2, spec_cmd: 'node -e "process.exit(3)"' });

    await expect(run(failing, 14)).rejects.toBeInstanceOf(SpecGenError);

    const leftovers = await fs.readdir(layout.checkRunDir(14)).catch(() => [] as string[]);
    expect(leftovers.filter((name) => name.startsWith('wt-'))).toEqual([]);
  }, 60_000);

  it('spec_path yang tidak ada di commit merambat sebagai SpecMissing', async () => {
    await expect(
      run(provider({ spec_cmd: null, spec_path: 'tidak-ada.json' }), 15),
    ).rejects.toBeInstanceOf(SpecMissing);
  });
});
