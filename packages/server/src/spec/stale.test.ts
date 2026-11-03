import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter } from '../git/adapter.js';
import { createLogger } from '../logger.js';
import { createCommandRunner } from '../proc/run-command.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { detectSpecStale, type SpecStaleDeps, type SpecStaleInput } from './stale.js';

const SHA = 'a'.repeat(40);

let tmp: string;
let layout: WorkspaceLayout;
let workspace: WorkspaceStore;
let runner: ReturnType<typeof createCommandRunner>;
let logLines: { msg: string; reason?: string }[];
let logger: ReturnType<typeof createLogger>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-stale-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  runner = createCommandRunner({ oasdiffBin: 'oasdiff', shellRoot: layout.checksDir });
  logLines = [];
  logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => logLines.push(JSON.parse(line)) },
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const approved = (handler_dirs: string[]): SpecStaleInput['profile'] => ({
  status: 'approved',
  profile: {
    profile_md: 'x',
    spec_path: null,
    spec_cmd: null,
    handler_dirs,
    http_client: null,
    base_url_pattern: null,
  },
});
const NO_PROFILE: SpecStaleInput['profile'] = { status: 'not_scanned', profile: null };

const baseInput = (extra: Partial<SpecStaleInput> = {}): SpecStaleInput => ({
  checkId: 1,
  repo: { id: 1, name: 'svc', local_path: tmp, spec_path: 'spec.json', spec_cmd: null },
  baseSha: 'b'.repeat(40),
  headSha: SHA,
  profile: NO_PROFILE,
  ...extra,
});
const withRepo = (repo: Partial<SpecStaleInput['repo']>): Partial<SpecStaleInput> => ({
  repo: { ...baseInput().repo, ...repo },
});

describe('dengan git asli (fixture)', () => {
  let fixtures: FixtureSet;
  let fixturesTmp: string;

  beforeAll(async () => {
    fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-stale-fx-'));
    fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
  }, 120_000);
  afterAll(async () => {
    await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const order = () => fixtures.repos['svc-order'];
  const detect = (input: SpecStaleInput) => {
    const git = createGitAdapter(runner);
    return detectSpecStale({ git, runner, layout, workspace, timeoutMs: 30_000, logger }, input);
  };
  const repoOf = (spec_path: string | null, spec_cmd: string | null) => ({
    id: 1,
    name: 'svc-order',
    local_path: order().path,
    spec_path,
    spec_cmd,
  });

  it('spec_cmd: hasil generate beda format dari yang ter-commit tetap dianggap segar', async () => {
    const git = createGitAdapter(runner);
    const headSha = await git.revParse(order().path, 'origin/feature/xyz');
    const finding = await detect(
      baseInput({
        repo: repoOf('openapi.json', order().specCmd as string),
        headSha,
        baseSha: order().commits['initial'] as string,
      }),
    );
    expect(finding).toBeNull();
  });

  it('tanpa spec_cmd: handler_dirs berubah dan spec_path ikut berubah → segar', async () => {
    const git = createGitAdapter(runner);
    const headSha = await git.revParse(order().path, 'origin/feature/xyz');
    const input = baseInput({
      baseSha: order().commits['initial'] as string,
      headSha,
      profile: approved(['app/routers']),
    });
    expect(await detect({ ...input, repo: repoOf('openapi.json', null) })).toBeNull();
    expect(await detect({ ...input, repo: repoOf('docs/tidak-berubah.json', null) })).toMatchObject(
      { kind: 'spec_stale', severity: 'warn', endpoint: 'spec' },
    );
  });
});

describe('dengan git palsu', () => {
  /** `committed` = isi `spec_path` di head; `generated` = yang ditulis worktree untuk `spec_cmd`. */
  function setup({
    committed = '{}',
    generated = '{}',
    changed = [] as string[],
  }: { committed?: string; generated?: string; changed?: string[] } = {}) {
    const git = {
      worktreeAdd: vi.fn(async (_repo: string, dir: string) => {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'spec.json'), generated);
      }),
      worktreeRemove: async (_repo: string, dir: string) => {
        await fs.rm(dir, { recursive: true, force: true });
      },
      show: vi.fn(async () => committed),
      diffNameOnly: vi.fn(async () => changed),
    } satisfies SpecStaleDeps['git'];
    const detect = (input: SpecStaleInput) =>
      detectSpecStale({ git, runner, layout, workspace, timeoutMs: 30_000, logger }, input);
    return { git, detect };
  }
  const withCmd = withRepo({ spec_cmd: 'echo ok' });
  const skipped = () => logLines.filter((line) => line.msg === 'deteksi spec_stale dilewati');

  describe('jalur spec_cmd', () => {
    it('tidak tertipu urutan kunci atau indentasi', async () => {
      const { detect } = setup({
        committed: '{\n        "b": 1,\n  "a": { "y": 2, "x": [1, 2] }\n}',
        generated: JSON.stringify({ a: { x: [1, 2], y: 2 }, b: 1 }),
      });
      expect(await detect(baseInput(withCmd))).toBeNull();
    });

    it('isi berbeda → satu finding spec_stale severity warn', async () => {
      const { detect } = setup({ committed: '{"a": 1}', generated: '{"a": 2}' });
      expect(await detect(baseInput(withCmd))).toEqual({
        kind: 'spec_stale',
        severity: 'warn',
        endpoint: 'spec',
        detail: `spec.json yang ter-commit berbeda dari hasil spec_cmd di ${SHA.slice(0, 7)}`,
      });
    });

    it('urutan elemen array tetap dihitung', async () => {
      const { detect } = setup({ committed: '{"a": [1, 2]}', generated: '{"a": [2, 1]}' });
      expect(await detect(baseInput(withCmd))).not.toBeNull();
    });
  });

  describe('jalur handler_dirs', () => {
    const run = (changed: string[], dirs: string[], extra: Partial<SpecStaleInput> = {}) =>
      setup({ changed }).detect(baseInput({ profile: approved(dirs), ...extra }));

    it('menyentuh handler_dirs tanpa menyentuh spec_path → finding', async () => {
      expect(await run(['app/routers/orders.py'], ['app/routers'])).toMatchObject({
        kind: 'spec_stale',
        severity: 'warn',
      });
    });

    it('spec_path ikut berubah, atau handler_dirs tidak tersentuh → segar', async () => {
      expect(await run(['app/routers/orders.py', 'spec.json'], ['app/routers'])).toBeNull();
      expect(await run(['README.md'], ['app/routers'])).toBeNull();
    });

    it('cocok per folder, bukan per awalan nama; "./", "/" di ujung, dan "\\" dinormalkan', async () => {
      expect(await run(['app/routers2/x.py'], ['app/routers'])).toBeNull();
      expect(await run(['app/routers/x.py'], ['./app/routers/'])).not.toBeNull();
      expect(await run(['app/routers/x.py'], ['app\\routers'])).not.toBeNull();
    });
  });

  describe('dilewati dan dicatat di log', () => {
    it.each<[string, Partial<SpecStaleInput>]>([
      ['tanpa spec_cmd dan tanpa handler_dirs', { profile: approved([]) }],
      [
        'profil belum disetujui, walau drafnya punya handler_dirs',
        { profile: { ...approved(['app']), status: 'pending_review' } },
      ],
      ['spec_path belum diisi', withRepo({ spec_path: null, spec_cmd: 'echo ok' })],
    ])('%s', async (_name, extra) => {
      const { git, detect } = setup({ changed: ['app/x.py'] });
      expect(await detect(baseInput(extra))).toBeNull();
      expect(skipped()).toHaveLength(1);
      expect(skipped()[0]).toMatchObject({ reason: expect.any(String) as string });
      expect(git.diffNameOnly).not.toHaveBeenCalled();
      expect(git.worktreeAdd).not.toHaveBeenCalled();
    });
  });
});
