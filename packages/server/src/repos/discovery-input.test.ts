import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter } from '../git/adapter.js';
import { RefNotFoundError } from '../git/errors.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createDiscoveryInputCollector } from './discovery-input.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Adapter palsu: pohon dari daftar path, isi berkas dari `files` atau `isi <path>`. */
function fakeGit(paths: string[], files: Record<string, string> = {}, delayMs = 0) {
  const calls: { op: string; ref: string }[] = [];
  let running = 0;
  const state = { peak: 0 };
  const git = {
    lsTree: async (_repo: string, ref: string) => {
      calls.push({ op: 'lsTree', ref });
      return paths.map((p) => ({ mode: '100644', type: 'blob', sha: 'x', path: p }));
    },
    show: async (_repo: string, ref: string, p: string) => {
      calls.push({ op: 'show', ref });
      state.peak = Math.max(state.peak, ++running);
      await sleep(delayMs);
      running--;
      return files[p] ?? `isi ${p}`;
    },
  };
  return { git, calls, state };
}

const collect = (git: ReturnType<typeof fakeGit>['git'], defaultBranch = 'main', concurrency = 4) =>
  createDiscoveryInputCollector({ git, concurrency }).collect({ path: '/repo', defaultBranch });
const pathsOf = (files: readonly { path: string }[]) => files.map((f) => f.path);

describe('pohon file', () => {
  it('lebih dari 400 path dipotong dan ditandai truncated; tepat 400 tidak', async () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => `f/${String(i).padStart(4, '0')}.txt`);

    const exact = await collect(fakeGit(make(400)).git);
    expect(exact.tree.paths).toHaveLength(400);
    expect(exact.tree.truncated).toBe(false);

    const over = await collect(fakeGit(make(401)).git);
    expect(over.tree.paths).toEqual(make(400));
    expect(over.tree.truncated).toBe(true);
  });

  it('node_modules, vendor, dist, build dibuang di kedalaman mana pun; nama mirip tetap', async () => {
    const { git } = fakeGit([
      'node_modules/a/routes.js',
      'web/node_modules/b.js',
      'vendor/c.go',
      'src/dist/main.go',
      'build/app.py',
      'docs/build-notes.md',
      'src/builder/x.ts',
      'src/vendored.ts',
    ]);
    const { tree, routerCandidates } = await collect(git);
    expect(tree.paths).toEqual(['docs/build-notes.md', 'src/builder/x.ts', 'src/vendored.ts']);
    expect(routerCandidates).toEqual([]);
  });

  it('hanya blob: submodule (type commit) tidak ikut', async () => {
    const git = {
      lsTree: async () => [
        { mode: '100644', type: 'blob', sha: 'x', path: 'a.txt' },
        { mode: '160000', type: 'commit', sha: 'y', path: 'sub' },
      ],
      show: async () => '',
    };
    expect((await collect(git)).tree.paths).toEqual(['a.txt']);
  });
});

describe('file kunci', () => {
  it('manifest hanya yang ada di root, urut seperti kartu; yang bersarang tidak dibaca', async () => {
    const { git } = fakeGit([
      'svc/package.json',
      'requirements.txt',
      'package.json',
      'go.mod',
      'README.md',
    ]);
    expect(pathsOf((await collect(git)).manifests)).toEqual([
      'package.json',
      'go.mod',
      'requirements.txt',
    ]);
  });

  it('kandidat router: router/routes di path penuh, main.go/app.py nama persis; tanpa membedakan huruf; dangkal dulu', async () => {
    const { git } = fakeGit([
      'tests/test_app.py',
      'internal/domain.go',
      'app/routers/orders.py',
      'src/Routes.ts',
      'api/v1/user_router.py',
      'cmd/main.go',
      'app.py',
      'README.md',
      'src/server.ts',
    ]);
    expect(pathsOf((await collect(git)).routerCandidates)).toEqual([
      'app.py',
      'cmd/main.go',
      'src/Routes.ts',
      'api/v1/user_router.py',
      'app/routers/orders.py',
    ]);
  });

  it('kandidat spec: nama memuat swagger atau openapi', async () => {
    const { git } = fakeGit(['docs/Swagger.yaml', 'openapi.json', 'api/openapi-v2.yml', 'a.txt']);
    expect(pathsOf((await collect(git)).specCandidates)).toEqual([
      'openapi.json',
      'api/openapi-v2.yml',
      'docs/Swagger.yaml',
    ]);
  });

  it('jumlah kandidat dibatasi: 15 router dan 5 spec, yang dangkal menang', async () => {
    const routes = Array.from({ length: 20 }, (_, i) => `d${String(i).padStart(2, '0')}/routes.ts`);
    const specs = Array.from({ length: 8 }, (_, i) => `s${i}/openapi.json`);
    const { git } = fakeGit([...routes, ...specs, 'routes.ts', 'openapi.yaml']);
    const result = await collect(git);

    expect(result.routerCandidates).toHaveLength(15);
    expect(result.routerCandidates[0]?.path).toBe('routes.ts');
    expect(result.routerCandidates[14]?.path).toBe('d13/routes.ts');
    expect(result.specCandidates).toHaveLength(5);
    expect(result.specCandidates[0]?.path).toBe('openapi.yaml');
  });

  it('kandidat dipilih dari pohon penuh, bukan dari yang sudah dipotong 400', async () => {
    const filler = Array.from({ length: 450 }, (_, i) => `a/${String(i).padStart(4, '0')}.txt`);
    const { git } = fakeGit([...filler, 'z/routes.ts']);
    const result = await collect(git);
    expect(result.tree.paths).not.toContain('z/routes.ts');
    expect(pathsOf(result.routerCandidates)).toEqual(['z/routes.ts']);
  });

  it('isi file dipotong 20.000 karakter dan ditandai; tepat 20.000 tidak', async () => {
    const { git } = fakeGit(['package.json', 'go.mod'], {
      'package.json': 'x'.repeat(20_001),
      'go.mod': 'y'.repeat(20_000),
    });
    const [big, exact] = (await collect(git)).manifests;
    expect(big?.content).toHaveLength(20_000);
    expect(big?.truncated).toBe(true);
    expect(exact?.content).toHaveLength(20_000);
    expect(exact?.truncated).toBe(false);
  });
});

describe('git', () => {
  it('membaca origin/<default_branch>; semua panggilan git memakai ref itu', async () => {
    const { git, calls } = fakeGit(['package.json', 'src/routes.ts', 'openapi.json']);
    const result = await collect(git, 'release/1');
    expect(result.ref).toBe('origin/release/1');
    expect(calls.length).toBe(4); // 1 lsTree + 3 show
    expect(new Set(calls.map((c) => c.ref))).toEqual(new Set(['origin/release/1']));
  });

  it('pembacaan file paralel dibatasi concurrency', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `d${i}/routes.ts`);
    const { git, state } = fakeGit(paths, {}, 10);
    await collect(git, 'main', 3);
    expect(state.peak).toBe(3);
  });
});

describe('repo fixture asli', () => {
  let tmp: string;
  let set: FixtureSet;
  const collector = createDiscoveryInputCollector({
    git: createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' })),
    concurrency: 4,
  });
  const run = (name: 'svc-order' | 'mfe-dashboard' | 'svc-payment') =>
    collector.collect({ path: set.repos[name].path, defaultBranch: set.repos[name].defaultBranch });

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-discovery-input-'));
    set = await makeFixtures(path.join(tmp, 'fixtures'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it.each(['svc-order', 'mfe-dashboard', 'svc-payment'] as const)('snapshot %s', async (name) => {
    expect(await run(name)).toMatchSnapshot();
  });

  it('tidak membaca working tree: perubahan lokal tanpa commit tidak mengubah hasil', async () => {
    const repo = set.repos['mfe-dashboard'].path;
    const manifest = path.join(repo, 'package.json');
    const original = await fs.readFile(manifest, 'utf8');
    const before = await run('mfe-dashboard');

    await fs.writeFile(manifest, '{"name":"diubah-lokal"}');
    await fs.writeFile(path.join(repo, 'routes-baru.ts'), 'export {};');
    try {
      expect(await run('mfe-dashboard')).toEqual(before);
    } finally {
      await fs.writeFile(manifest, original);
      await fs.rm(path.join(repo, 'routes-baru.ts'), { force: true });
    }
  });

  it('branch yang tidak ada di origin: RefNotFoundError', async () => {
    await expect(
      collector.collect({ path: set.repos['svc-order'].path, defaultBranch: 'tidak-ada' }),
    ).rejects.toBeInstanceOf(RefNotFoundError);
  });
});
