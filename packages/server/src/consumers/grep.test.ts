import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { normalizePath, type ChangedEndpoint } from '../diff/endpoints.js';
import { createGitAdapter, type GrepMatch } from '../git/adapter.js';
import { RefNotFoundError } from '../git/errors.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createConsumerGrep, longestStaticSegment, type ConsumerRepo } from './grep.js';

const endpoint = (method: string, p: string, operationId: string | null): ChangedEndpoint => ({
  method,
  path: p,
  normalized_path: normalizePath(p),
  operationId,
  changes: [],
  max_level: 'break',
});

const repo = (name: string, role: ConsumerRepo['role']): ConsumerRepo => ({
  name,
  role,
  path: `/r/${name}`,
  defaultBranch: 'main',
});

/** Git palsu: commit `sha:<path repo>`, blob `blob:<path berkas>`, hasil grep dari `grep(repoPath, patterns)`. */
function fakeGit(grep: (repoPath: string, patterns: readonly string[]) => GrepMatch[] = () => []) {
  const calls: { op: string; repo: string; ref: string; patterns?: readonly string[] }[] = [];
  const git = {
    revParse: async (repoPath: string, ref: string) => {
      calls.push({ op: 'revParse', repo: repoPath, ref });
      return `sha:${repoPath}`;
    },
    lsTree: async (repoPath: string, ref: string) => {
      calls.push({ op: 'lsTree', repo: repoPath, ref });
      const files = new Set(grep(repoPath, ['*']).map((match) => match.path));
      return [...files].map((p) => ({ mode: '100644', type: 'blob', sha: `blob:${p}`, path: p }));
    },
    grepFixed: async (repoPath: string, ref: string, patterns: readonly string[]) => {
      calls.push({ op: 'grep', repo: repoPath, ref, patterns });
      return grep(repoPath, patterns);
    },
  };
  return { git, calls };
}

const match = (p: string, line = 1): GrepMatch => ({ path: p, line, text: '' });
const search = (
  git: ReturnType<typeof fakeGit>['git'],
  endpoints: ChangedEndpoint[],
  repos: ConsumerRepo[],
) =>
  createConsumerGrep({ git, concurrency: 4 }).search({ endpoints, repos, provider: 'svc-order' });

describe('longestStaticSegment', () => {
  it.each([
    ['/orders', 'orders'],
    ['/orders/{id}/cancel', 'orders'], // seri 6 huruf: yang pertama
    ['/api/{id}/cancel-reason', 'cancel-reason'],
    ['/payments/{id}', 'payments'],
    ['/{id}', undefined],
    ['/', undefined],
  ])('%s → %s', (input, expected) => {
    expect(longestStaticSegment(input)).toBe(expected);
  });
});

describe('createConsumerGrep.search', () => {
  const repos = [
    repo('svc-order', 'service'),
    repo('mfe-dashboard', 'microfrontend'),
    repo('svc-payment', 'service'),
    repo('e2e-suite', 'e2e'),
  ];

  it('repo e2e dan provider tidak pernah disentuh git', async () => {
    const { git, calls } = fakeGit(() => [match('a.ts')]);
    await search(git, [endpoint('GET', '/orders', 'listOrders')], repos);

    expect([...new Set(calls.map((call) => call.repo))].sort()).toEqual([
      '/r/mfe-dashboard',
      '/r/svc-payment',
    ]);
  });

  it('pola: /<segmen terpanjang> dan operationId; tanpa operationId hanya segmen', async () => {
    const { git, calls } = fakeGit();
    await search(
      git,
      [
        endpoint('POST', '/orders/{order_id}/cancel', 'cancelOrder'),
        endpoint('GET', '/payments/{id}', null),
      ],
      [repo('mfe-dashboard', 'microfrontend')],
    );

    expect(calls.filter((call) => call.op === 'grep').map((call) => call.patterns)).toEqual([
      ['/orders', 'cancelOrder'],
      ['/payments'],
    ]);
  });

  it('endpoint tanpa segmen statis dan tanpa operationId: grep tidak dipanggil, tanpa consumer', async () => {
    const { git, calls } = fakeGit(() => [match('a.ts')]);
    const result = await search(git, [endpoint('GET', '/{id}', null)], repos);

    expect(calls.some((call) => call.op === 'grep')).toBe(false);
    expect(result.endpoints[0]?.candidates).toEqual([]);
  });

  it('endpoint tanpa kecocokan tetap masuk daftar dengan candidates kosong', async () => {
    const { git, calls } = fakeGit((_repoPath, patterns) =>
      patterns.includes('/orders') ? [match('src/orders.ts')] : [],
    );
    const result = await search(
      git,
      [endpoint('GET', '/orders', null), endpoint('GET', '/refunds', null)],
      [repo('mfe-dashboard', 'microfrontend')],
    );

    expect(result.endpoints.map((e) => [e.endpoint.path, e.candidates.length])).toEqual([
      ['/orders', 1],
      ['/refunds', 0],
    ]);
    expect(calls.filter((call) => call.op === 'lsTree')).toHaveLength(1);
  });

  it('pohon tidak dibaca bila tidak ada kecocokan', async () => {
    const { git, calls } = fakeGit();
    await search(git, [endpoint('GET', '/orders', null)], repos);
    expect(calls.some((call) => call.op === 'lsTree')).toBe(false);
  });

  it('grep dan pohon memakai commit yang dilaporkan; blob_sha dari pohon; match_count = baris per berkas', async () => {
    const { git, calls } = fakeGit(() => [match('a.ts', 1), match('a.ts', 7), match('b.ts', 3)]);
    const result = await search(
      git,
      [endpoint('GET', '/orders', null)],
      [repo('mfe-dashboard', 'microfrontend')],
    );

    expect(result.endpoints[0]?.candidates).toEqual([
      { repo: 'mfe-dashboard', path: 'a.ts', blob_sha: 'blob:a.ts', match_count: 2 },
      { repo: 'mfe-dashboard', path: 'b.ts', blob_sha: 'blob:b.ts', match_count: 1 },
    ]);
    expect(result.consumer_shas).toEqual({ 'mfe-dashboard': 'sha:/r/mfe-dashboard' });
    expect(calls[0]).toMatchObject({ op: 'revParse', ref: 'origin/main' });
    for (const call of calls.slice(1)) expect(call.ref).toBe('sha:/r/mfe-dashboard');
  });

  it('kandidat disusun per repo menurut urutan repo; consumer_shas memuat tiap consumer', async () => {
    const { git } = fakeGit((repoPath) => [match(`${path.basename(repoPath)}.ts`)]);
    const result = await search(git, [endpoint('GET', '/orders', null)], repos);

    expect(result.endpoints[0]?.candidates.map((c) => c.repo)).toEqual([
      'mfe-dashboard',
      'svc-payment',
    ]);
    expect(Object.keys(result.consumer_shas)).toEqual(['mfe-dashboard', 'svc-payment']);
  });

  it('galat git merambat, bukan dibaca sebagai tanpa consumer', async () => {
    const { git } = fakeGit();
    git.revParse = async (_repoPath, ref) => {
      throw new RefNotFoundError(ref);
    };
    await expect(search(git, [endpoint('GET', '/orders', null)], repos)).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
  });
});

describe('repo fixture asli', () => {
  let tmp: string;
  let set: FixtureSet;
  const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-consumer-grep-'));
    set = await makeFixtures(path.join(tmp, 'fixtures'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const fixtureRepos = () =>
    Object.values(set.repos).map(({ name, role, path: p, defaultBranch }) => ({
      name,
      role,
      path: p,
      defaultBranch,
    }));

  const searchFixtures = () =>
    createConsumerGrep({ git, concurrency: 4 }).search({
      endpoints: [
        endpoint('GET', '/orders', 'listOrders'),
        endpoint('POST', '/orders/{order_id}/cancel', 'cancelOrder'),
      ],
      repos: fixtureRepos(),
      provider: 'svc-order',
    });

  it('hop 1 atas endpoint fixture: e2e tidak di-grep, blob_sha = isi origin/main', async () => {
    const result = await searchFixtures();

    // Lima berkas (D-17), bukan "tiga" seperti AC1 kartu (G-5). Segmen `/orders` juga dipakai
    // endpoint cancel (seri dengan `cancel`, yang pertama menang), jadi daftarnya sama.
    const files = [
      'mfe-dashboard:src/api/orders.ts',
      'mfe-dashboard:src/components/OrderLines.tsx',
      'mfe-dashboard:src/components/OrderSummary.tsx',
      'mfe-dashboard:src/hooks/useOrders.ts',
      'svc-payment:internal/clients/order_client.go',
    ];
    const fileList = (e: (typeof result.endpoints)[number]) =>
      e.candidates.map((c) => `${c.repo}:${c.path}`);
    expect(result.endpoints.map(fileList)).toEqual([files, files]);

    const candidates = result.endpoints.flatMap((e) => e.candidates);
    for (const c of candidates) {
      const dir = set.repos[c.repo as keyof FixtureSet['repos']].path;
      const expected = execFileSync('git', ['-C', dir, 'rev-parse', `origin/main:${c.path}`], {
        encoding: 'utf8',
      }).trim();
      expect(c.blob_sha).toBe(expected);
    }
  });

  it('tidak membaca working tree: perubahan lokal tanpa commit tidak mengubah hasil', async () => {
    const file = path.join(set.repos['mfe-dashboard'].path, 'src/api/orders.ts');
    const original = await fs.readFile(file, 'utf8');
    const before = await searchFixtures();

    await fs.writeFile(file, 'export const diubahLokal = 1;\n');
    try {
      expect(await searchFixtures()).toEqual(before);
    } finally {
      await fs.writeFile(file, original);
    }
  });
});
