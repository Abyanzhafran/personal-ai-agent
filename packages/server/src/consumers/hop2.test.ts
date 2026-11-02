import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { normalizePath, type ChangedEndpoint } from '../diff/endpoints.js';
import type { Extraction } from '../extract/runner.js';
import { createGitAdapter, type GrepMatch } from '../git/adapter.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createConsumerGrep, type ConsumerRepo } from './grep.js';
import { createSymbolSearch, markViaSymbol, type WrapperSymbol } from './hop2.js';
import { limitCandidates } from './limit.js';

const SHA = 'a'.repeat(40);

const repo = (name: string): ConsumerRepo => ({
  name,
  role: 'microfrontend',
  path: `/r/${name}`,
  defaultBranch: 'main',
});

const wrapper = (over: Partial<WrapperSymbol> = {}): WrapperSymbol => ({
  repo: 'mfe',
  symbol: 'useOrders',
  method: 'GET',
  path: '/orders',
  ...over,
});

const hit = (p: string): GrepMatch => ({ path: p, line: 1, text: '' });

/** `grep(repoPath, word)` menentukan kecocokan; semua panggilan git dicatat berurutan. */
function fakeGit(grep: (repoPath: string, word: string) => GrepMatch[] = () => []) {
  const calls: string[] = [];
  const git = {
    revParse: (repoPath: string, ref: string) => {
      calls.push(`revParse ${repoPath} ${ref}`);
      return Promise.resolve(SHA);
    },
    lsTree: (repoPath: string, ref: string) => {
      calls.push(`lsTree ${repoPath} ${ref}`);
      return Promise.resolve(
        ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((p) => ({
          mode: '100644',
          type: 'blob' as const,
          sha: `blob-${p}`,
          path: p,
        })),
      );
    },
    grepWord: (repoPath: string, ref: string, word: string) => {
      calls.push(`grepWord ${repoPath} ${ref} ${word}`);
      return Promise.resolve(grep(repoPath, word));
    },
  };
  return { git, calls };
}

const search = (
  git: ReturnType<typeof fakeGit>['git'],
  input: Partial<Parameters<ReturnType<typeof createSymbolSearch>['search']>[0]> = {},
) =>
  createSymbolSearch({ git, concurrency: 4 }).search({
    wrappers: [wrapper()],
    repos: [repo('mfe'), repo('pay')],
    exclude: [],
    max: 40,
    ...input,
  });

describe('createSymbolSearch (fake git)', () => {
  it('meng-grep -w satu kali per simbol, hanya di repo asalnya, pada SHA origin/<default>', async () => {
    const { git, calls } = fakeGit();
    await search(git, {
      wrappers: [
        wrapper(),
        wrapper({ repo: 'pay', symbol: 'chargeOrder', method: 'POST', path: '/pay' }),
      ],
      repos: [repo('mfe'), repo('pay'), repo('lain')],
    });

    expect(calls.sort()).toEqual([
      `grepWord /r/mfe ${SHA} useOrders`,
      `grepWord /r/pay ${SHA} chargeOrder`,
      'revParse /r/mfe origin/main',
      'revParse /r/pay origin/main',
    ]);
  });

  it('simbol yang sama untuk dua panggilan di-grep sekali dan konteksnya memuat keduanya', async () => {
    const { git, calls } = fakeGit(() => [hit('a.ts')]);
    const result = await search(git, {
      wrappers: [wrapper(), wrapper({ path: '/orders/{id}' }), wrapper()],
    });

    expect(calls.filter((c) => c.startsWith('grepWord'))).toHaveLength(1);
    expect(result.files[0]?.context).toEqual([
      'useOrders calls GET /orders',
      'useOrders calls GET /orders/{id}',
    ]);
  });

  it('berkas hop 1 dibuang; blob_sha dari pohon git; tanpa kecocokan pohon tidak dibaca', async () => {
    const { git, calls } = fakeGit(() => [hit('a.ts'), hit('b.ts')]);
    const result = await search(git, { exclude: [{ repo: 'mfe', path: 'a.ts' }] });

    expect(result.files.map((f) => [f.repo, f.path, f.blob_sha])).toEqual([
      ['mfe', 'b.ts', 'blob-b.ts'],
    ]);
    // Berkas bernama sama di repo lain tidak ikut terbuang.
    const other = await search(fakeGit(() => [hit('a.ts')]).git, {
      exclude: [{ repo: 'pay', path: 'a.ts' }],
    });
    expect(other.files).toHaveLength(1);

    const none = fakeGit();
    await search(none.git);
    expect(none.calls.some((c) => c.startsWith('lsTree'))).toBe(false);
    expect(calls.some((c) => c.startsWith('lsTree'))).toBe(true);
  });

  it('berkas yang memakai dua simbol jadi satu kandidat: simbol terurut, kecocokan dijumlah', async () => {
    const { git } = fakeGit((_repo, word) =>
      word === 'useOrders' ? [hit('a.ts'), hit('a.ts')] : [hit('a.ts'), hit('b.ts')],
    );
    const result = await search(git, {
      wrappers: [wrapper(), wrapper({ symbol: 'listOrders' })],
    });

    expect(result.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(result.files[0]).toMatchObject({
      match_count: 3,
      symbols: ['listOrders', 'useOrders'],
      context: ['listOrders calls GET /orders', 'useOrders calls GET /orders'],
    });
    expect(result.files[1]).toMatchObject({ match_count: 1, symbols: ['listOrders'] });
  });

  it('dibatasi max sendiri: sisanya dilewati dan ditandai incomplete', async () => {
    const { git } = fakeGit(() => [
      hit('a.ts'),
      hit('b.ts'),
      hit('c.ts'),
      hit('d.ts'),
      hit('e.ts'),
    ]);

    const limited = await search(git, { max: 3 });
    expect(limited.files).toHaveLength(3);
    expect(limited).toMatchObject({ skipped_files: 2, incomplete: true });

    const roomy = await search(git, { max: 5 });
    expect(roomy).toMatchObject({ skipped_files: 0, incomplete: false });
  });

  it('tanpa simbol tidak menyentuh git', async () => {
    const { git, calls } = fakeGit();
    const result = await search(git, { wrappers: [] });

    expect(result).toEqual({ files: [], skipped_files: 0, incomplete: false });
    expect(calls).toEqual([]);
  });

  it('galat git merambat', async () => {
    const { git } = fakeGit();
    git.revParse = () => Promise.reject(new Error('ref hilang'));
    await expect(search(git)).rejects.toThrow('ref hilang');
  });
});

describe('markViaSymbol', () => {
  const call = (over: Partial<ApiCall>): ApiCall => ({
    method: 'GET',
    path: '/orders',
    file: 'src/pages/OrdersPage.tsx',
    line: 7,
    query_params: [],
    body_fields: [],
    response_fields_read: [{ name: 'total', line: 9 }],
    confidence: 'high',
    wrapper_symbols: ['useOrders'],
    ...over,
  });
  const extraction = (calls: ApiCall[]): Extraction => ({
    calls,
    truncated: false,
    total_lines: 20,
    sent_lines: 20,
  });

  it('menambah via_symbol dan membatasi keyakinan ke medium (keputusan #6)', () => {
    const marked = markViaSymbol(
      extraction([
        call({ confidence: 'high' }),
        call({ confidence: 'medium' }),
        call({ confidence: 'low' }),
      ]),
      ['useOrders'],
    );

    expect(marked.calls.map((c) => c.confidence)).toEqual(['medium', 'medium', 'low']);
    expect(marked.calls.map((c) => c.via_symbol)).toEqual(['useOrders', 'useOrders', 'useOrders']);
  });

  it('lebih dari satu simbol digabung; sisa data dan masukan tidak berubah', () => {
    const original = extraction([call({ confidence: 'high' })]);
    const marked = markViaSymbol(original, ['listOrders', 'useOrders']);

    expect(marked.calls[0]?.via_symbol).toBe('listOrders, useOrders');
    expect(marked.calls[0]).toMatchObject({ ...original.calls[0], confidence: 'medium' });
    expect(marked).toMatchObject({ truncated: false, total_lines: 20, sent_lines: 20 });
    expect(original.calls[0]).toEqual(call({ confidence: 'high' }));
  });
});

describe('repo fixture asli', () => {
  let tmp: string;
  let set: FixtureSet;
  const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-hop2-'));
    set = await makeFixtures(path.join(tmp, 'fixtures'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('OrdersPage.tsx ditemukan lewat useOrders, bukan lewat hop 1', async () => {
    const repos: ConsumerRepo[] = Object.values(set.repos).map(
      ({ name, role, path: p, defaultBranch }) => ({ name, role, path: p, defaultBranch }),
    );
    const endpoint: ChangedEndpoint = {
      method: 'GET',
      path: '/orders',
      normalized_path: normalizePath('/orders'),
      operationId: 'listOrders',
      changes: [],
      max_level: 'break',
    };
    const hop1 = await createConsumerGrep({ git, concurrency: 4 }).search({
      endpoints: [endpoint],
      repos,
      provider: 'svc-order',
    });
    const hop1Files = limitCandidates(hop1.endpoints, 40).files;
    expect(hop1Files.map((f) => f.path)).not.toContain('src/pages/OrdersPage.tsx');

    const result = await createSymbolSearch({ git, concurrency: 4 }).search({
      wrappers: [wrapper({ repo: 'mfe-dashboard' })],
      repos,
      exclude: hop1Files,
      max: 40,
    });

    expect(result.files.map((f) => f.path)).toEqual(['src/pages/OrdersPage.tsx']);
    expect(result.files[0]).toMatchObject({
      repo: 'mfe-dashboard',
      symbols: ['useOrders'],
      context: ['useOrders calls GET /orders'],
      blob_sha: expect.stringMatching(/^[0-9a-f]{40}$/) as string,
    });
    expect(result.incomplete).toBe(false);
  });
});
