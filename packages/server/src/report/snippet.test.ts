import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Snippet } from '@cc/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter, type GitAdapter } from '../git/adapter.js';
import { createCommandRunner } from '../proc/run-command.js';
import { buildSnippet } from './snippet.js';

/** Git palsu: `show` mengembalikan `content` untuk file apa pun. */
const fakeGit = (content: string) => ({
  show: vi.fn<GitAdapter['show']>(async () => content),
});

const build = (content: string, line: number, tokens: string[] = []) =>
  buildSnippet(fakeGit(content), { repo: '/r', sha: 'abc1234', file: 'a.ts', line, tokens });

const numbered = Array.from({ length: 10 }, (_, i) => `baris ${i + 1}`).join('\n');
const nums = (snippet: Awaited<ReturnType<typeof build>>) => snippet?.lines.map((l) => l.n);

describe('buildSnippet: jendela baris', () => {
  it('dua baris sebelum dan sesudah, baris yang disorot dicatat', async () => {
    const snippet = await build(numbered, 5);

    expect(nums(snippet)).toEqual([3, 4, 5, 6, 7]);
    expect(snippet?.highlight).toBe(5);
    expect(snippet?.lines[2]).toEqual({ n: 5, text: 'baris 5' });
    expect(Snippet.safeParse(snippet).success).toBe(true);
  });

  it('baris di awal atau akhir file → terpotong, bukan galat', async () => {
    expect(nums(await build(numbered, 1))).toEqual([1, 2, 3]);
    expect(nums(await build(numbered, 2))).toEqual([1, 2, 3, 4]);
    expect(nums(await build(numbered, 10))).toEqual([8, 9, 10]);
    expect(nums(await build('satu', 1))).toEqual([1]);
  });

  it('newline penutup bukan baris tambahan; CRLF dibuang \\r-nya', async () => {
    expect(nums(await build('a\nb\nc\n', 3))).toEqual([1, 2, 3]);
    expect(await build('a\nb\nc\n', 4)).toBeNull();
    expect((await build('a\r\nb\r\n', 2))?.lines).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
  });

  it('line di luar file atau file kosong → null', async () => {
    expect(await build(numbered, 11)).toBeNull();
    expect(await build(numbered, 0)).toBeNull();
    expect(await build('', 1)).toBeNull();
  });

  it('tab dan spasi di awal baris dipertahankan apa adanya', async () => {
    const snippet = await build('\tif (a) {\n\t\treturn 1;\n  }\n', 2);

    expect(snippet?.lines.map((l) => l.text)).toEqual(['\tif (a) {', '\t\treturn 1;', '  }']);
  });
});

describe('buildSnippet: token', () => {
  const content = 'x\nhttp.get("/orders", { page_size: 5, page_size: 6 })\ny';

  it('hanya token yang ada di baris yang disorot; unik dan urutan diberikan', async () => {
    const snippet = await build(content, 2, ['status', 'page_size', '/orders', 'page_size']);

    expect(snippet?.tokens).toEqual(['page_size', '/orders']);
  });

  it('huruf besar-kecil dihitung; token di baris konteks tidak ikut; tidak ketemu → kosong', async () => {
    expect((await build(content, 2, ['PAGE_SIZE', 'x']))?.tokens).toEqual([]);
    expect((await build(content, 2))?.tokens).toEqual([]);
  });
});

describe('buildSnippet: git sungguhan pada fixture', () => {
  let tmp: string;
  let fixtures: FixtureSet;
  const adapter = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-snippet-'));
    fixtures = await makeFixtures(path.join(tmp, 'fixtures'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('dibaca dari sha yang diminta: revisi lain tidak mengubah cuplikan sha lama', async () => {
    const order = fixtures.repos['svc-order'];
    const input = { repo: order.path, file: 'app/routers/orders.py', line: 9 };
    const tokens = ['page_size', 'limit'];

    const old = await buildSnippet(adapter, {
      ...input,
      sha: order.commits['initial'] as string,
      tokens,
    });
    const later = await buildSnippet(adapter, { ...input, sha: 'origin/feature/xyz', tokens });
    const oldAgain = await buildSnippet(adapter, {
      ...input,
      sha: order.commits['initial'] as string,
      tokens,
    });

    expect(old?.lines.find((l) => l.n === 9)?.text).toContain('page_size');
    expect(old?.tokens).toEqual(['page_size']);
    expect(later?.lines.find((l) => l.n === 9)?.text).toContain('limit');
    expect(later?.tokens).toEqual(['limit']);
    expect(oldAgain).toEqual(old);
  }, 30_000);
});
