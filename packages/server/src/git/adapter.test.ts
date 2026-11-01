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
import { CommandFailedError } from '../proc/errors.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createGitAdapter } from './adapter.js';
import { PathNotFoundError, RefNotFoundError } from './errors.js';

const adapter = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_OPTIONAL_LOCKS: '0',
};

/** git mentah untuk menyiapkan data dan sebagai pembanding independen; bukan bagian yang diuji. */
const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

/** Keadaan working tree dan HEAD; harus identik sebelum dan sesudah seluruh test. */
const snapshot = (repo: FixtureRepo) => ({
  status: rawGit(repo.path, 'status', '--porcelain=v1', '--ignored'),
  head: rawGit(repo.path, 'rev-parse', 'HEAD'),
  branch: rawGit(repo.path, 'symbolic-ref', 'HEAD'),
});

let tmp: string;
let set: FixtureSet;
let before: ReturnType<typeof snapshot>[];
/** Repo buatan test untuk kasus tepi yang tidak ada di fixture. */
let extra: string;
let rootA: string;
let rootB: string;

const order = () => set.repos['svc-order'];
const mfe = () => set.repos['mfe-dashboard'];

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-git-adapter-'));
  set = await makeFixtures(path.join(tmp, 'fixtures'));
  before = Object.values(set.repos).map(snapshot);

  extra = path.join(tmp, 'extra');
  await fs.mkdir(path.join(extra, 'ünï cödé'), { recursive: true });
  rawGit(extra, 'init', '--quiet', '--initial-branch=main');
  const files: Record<string, string> = {
    'ünï cödé/spasi nama.txt': 'satu\nJARUM: dua:titik\tdan tab\nempat JARUM lagi\n',
    'crlf.txt': 'JARUM di sini\r\nlain\r\n',
    'opsi.txt': 'kata --pakai-strip dan -O lain\n',
    'kata.txt': 'useThingElse\ncall useThing()\n',
    'big.txt': `${'x'.repeat(1023)}\n`.repeat(17 * 1024), // 17 MiB, di atas batas bawaan runner
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(extra, name), content);
  }
  rawGit(extra, 'add', '--all');
  rawGit(extra, 'commit', '--quiet', '--message', 'awal');
  // Dua commit tanpa induk: riwayatnya tidak berhubungan.
  const tree = rawGit(extra, 'rev-parse', 'HEAD^{tree}');
  rootA = rawGit(extra, 'commit-tree', tree, '-m', 'a');
  rootB = rawGit(extra, 'commit-tree', tree, '-m', 'b');
}, 120_000);

afterAll(async () => {
  try {
    // Menutup AC "working tree fixture tidak tersentuh oleh adapter".
    expect(Object.values(set.repos).map(snapshot)).toEqual(before);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('isInsideWorkTree', () => {
  it('true untuk repo, false untuk folder biasa dan path yang tidak ada', async () => {
    expect(await adapter.isInsideWorkTree(order().path)).toBe(true);
    expect(await adapter.isInsideWorkTree(set.root)).toBe(false);
    expect(await adapter.isInsideWorkTree(path.join(tmp, 'tidak-ada'))).toBe(false);
  });

  it('false untuk repo bare (tidak punya working tree)', async () => {
    expect(await adapter.isInsideWorkTree(order().remote)).toBe(false);
  });
});

describe('revParse dan verifyRef', () => {
  it('menyelesaikan branch remote, SHA pendek, dan HEAD ke SHA lengkap', async () => {
    const { commits } = order();
    expect(await adapter.revParse(order().path, 'origin/main')).toBe(commits['readme']);
    expect(await adapter.revParse(order().path, 'origin/feature/xyz')).toBe(commits['feature-xyz']);
    expect(await adapter.revParse(order().path, commits['initial']!.slice(0, 8))).toBe(
      commits['initial'],
    );
    await expect(adapter.verifyRef(order().path, 'origin/main')).resolves.toBeUndefined();
  });

  it('ref tidak ada → RefNotFoundError dengan nama ref di pesannya', async () => {
    for (const call of [adapter.revParse, adapter.verifyRef]) {
      const error = await call(order().path, 'origin/tidak-ada').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RefNotFoundError);
      expect(error).toMatchObject({ code: 'ref_not_found', ref: 'origin/tidak-ada' });
      expect((error as Error).message).toContain('origin/tidak-ada');
    }
  });

  it('ref berawalan "-" ditolak sebagai ref, bukan diteruskan ke git sebagai opsi', async () => {
    const target = path.join(tmp, 'tidak-boleh-ada.txt');
    await expect(adapter.revParse(order().path, `--output=${target}`)).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
    await expect(adapter.show(order().path, '--version', 'x')).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
    await expect(fs.access(target)).rejects.toThrow();
  });

  it('kegagalan yang bukan soal ref (bukan repo) tetap CommandFailedError', async () => {
    await expect(adapter.revParse(set.root, 'main')).rejects.toBeInstanceOf(CommandFailedError);
  });
});

describe('originHead', () => {
  it('mengembalikan nama cabang default tanpa awalan origin/', async () => {
    expect(await adapter.originHead(order().path)).toBe('main');
  });

  it('null bila origin/HEAD tidak ada', async () => {
    expect(await adapter.originHead(extra)).toBeNull();
  });
});

describe('mergeBase', () => {
  it('leluhur bersama, bukan ujung main yang sudah maju', async () => {
    const base = await adapter.mergeBase(order().path, 'origin/main', 'origin/feature/xyz');
    expect(base).toBe(order().commits['initial']);
    expect(base).not.toBe(order().commits['readme']);
  });

  it('null bila riwayat tidak berhubungan', async () => {
    expect(await adapter.mergeBase(extra, rootA, rootB)).toBeNull();
  });

  it('menyebut ref yang tidak ada', async () => {
    await expect(
      adapter.mergeBase(order().path, 'origin/main', 'origin/hilang'),
    ).rejects.toMatchObject({
      name: 'RefNotFoundError',
      ref: 'origin/hilang',
    });
    await expect(
      adapter.mergeBase(order().path, 'origin/hilang', 'origin/main'),
    ).rejects.toMatchObject({
      ref: 'origin/hilang',
    });
  });
});

describe('show', () => {
  it('isi berkas sama persis dengan git, termasuk newline akhir', async () => {
    const { commits, path: repo } = order();
    const text = await adapter.show(repo, commits['initial']!, 'openapi.json');
    expect(text).toBe(
      execFileSync('git', ['-C', repo, 'show', `${commits['initial']}:openapi.json`], {
        encoding: 'utf8',
      }),
    );
    expect(text.endsWith('\n')).toBe(true);
    expect(await adapter.show(repo, 'origin/feature/xyz', 'openapi.json')).not.toBe(text);
  });

  it('berkas lebih dari 16 MiB tidak terpotong', async () => {
    const text = await adapter.show(extra, 'HEAD', 'big.txt');
    expect(text.length).toBe(17 * 1024 * 1024);
  });

  it('SHA salah → RefNotFoundError; path salah di commit yang ada → PathNotFoundError', async () => {
    await expect(
      adapter.show(order().path, 'origin/hilang', 'openapi.json'),
    ).rejects.toBeInstanceOf(RefNotFoundError);
    const error = await adapter
      .show(order().path, 'origin/main', 'tidak/ada.json')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PathNotFoundError);
    expect(error).toMatchObject({
      code: 'path_not_found',
      ref: 'origin/main',
      path: 'tidak/ada.json',
    });
  });
});

describe('lsTree', () => {
  it('mendaftar berkas (bukan folder) beserta SHA blob yang cocok dengan git', async () => {
    const entries = await adapter.lsTree(order().path, 'origin/main');
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(expect.arrayContaining(['openapi.json', 'app/routers/orders.py']));
    expect(paths).not.toContain('app');
    expect(
      entries.every((entry) => entry.type === 'blob' && /^[0-9a-f]{40}$/.test(entry.sha)),
    ).toBe(true);
    const spec = entries.find((entry) => entry.path === 'openapi.json');
    expect(spec).toMatchObject({
      mode: '100644',
      sha: rawGit(order().path, 'rev-parse', 'origin/main:openapi.json'),
    });
  });

  it('nama berkas dengan spasi dan karakter non-ASCII utuh', async () => {
    const paths = (await adapter.lsTree(extra, 'HEAD')).map((entry) => entry.path);
    expect(paths).toContain('ünï cödé/spasi nama.txt');
  });

  it('rev tidak ada → RefNotFoundError', async () => {
    await expect(adapter.lsTree(order().path, 'origin/hilang')).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
  });
});

describe('grepFixed dan grepWord', () => {
  it('mengembalikan path, line, text yang sudah di-parse', async () => {
    const matches = await adapter.grepFixed(mfe().path, 'origin/main', ['orders']);
    expect([...new Set(matches.map((match) => match.path))].sort()).toEqual([
      'src/api/orders.ts',
      'src/components/OrderLines.tsx',
      'src/components/OrderSummary.tsx',
      'src/hooks/useOrders.ts',
    ]);
    for (const match of matches) {
      expect(Number.isInteger(match.line) && match.line > 0).toBe(true);
      expect(match.text).toContain('orders');
      // Baris yang dilaporkan memang ada di berkas itu.
      const file = rawGit(mfe().path, 'show', `origin/main:${match.path}`).split('\n');
      expect(file[match.line - 1]!.trimEnd()).toBe(match.text.trimEnd());
    }
  });

  it('beberapa pola bekerja sebagai ATAU', async () => {
    const paths = (patterns: string[]) =>
      adapter
        .grepFixed(mfe().path, 'origin/main', patterns)
        .then((matches) => new Set(matches.map((match) => match.path)));
    const hook = await paths(['useOrders']);
    const format = await paths(['formatCurrency']);
    expect(format.has('src/lib/format.ts')).toBe(true);
    expect(hook.has('src/lib/format.ts')).toBe(false);
    expect(await paths(['useOrders', 'formatCurrency'])).toEqual(new Set([...hook, ...format]));
  });

  it('grepWord hanya kecocokan satu kata utuh; grepFixed juga kecocokan sebagian', async () => {
    const word = await adapter.grepWord(extra, 'HEAD', 'useThing');
    expect(word).toEqual([{ path: 'kata.txt', line: 2, text: 'call useThing()' }]);
    const fixed = await adapter.grepFixed(extra, 'HEAD', ['useThing']);
    expect(fixed.map((match) => match.line)).toEqual([1, 2]);
  });

  it('hop 2: simbol hook ditemukan di halaman yang memakainya', async () => {
    const matches = await adapter.grepWord(mfe().path, 'origin/main', 'useOrders');
    expect(matches.map((match) => match.path)).toContain('src/pages/OrdersPage.tsx');
  });

  it('path ber-spasi/non-ASCII, titik dua, tab, dan CRLF ter-parse benar', async () => {
    const matches = await adapter.grepFixed(extra, 'HEAD', ['JARUM']);
    expect(matches).toEqual([
      { path: 'crlf.txt', line: 1, text: 'JARUM di sini' },
      { path: 'ünï cödé/spasi nama.txt', line: 2, text: 'JARUM: dua:titik\tdan tab' },
      { path: 'ünï cödé/spasi nama.txt', line: 3, text: 'empat JARUM lagi' },
    ]);
  });

  it('pola berawalan "-" dicari sebagai teks, bukan opsi', async () => {
    expect(await adapter.grepFixed(extra, 'HEAD', ['--pakai-strip'])).toEqual([
      { path: 'opsi.txt', line: 1, text: 'kata --pakai-strip dan -O lain' },
    ]);
    expect((await adapter.grepFixed(extra, 'HEAD', ['-O lain'])).length).toBe(1);
  });

  it('tanpa kecocokan → daftar kosong; rev salah → RefNotFoundError; pola kosong ditolak', async () => {
    expect(await adapter.grepFixed(mfe().path, 'origin/main', ['tidak-ada-di-mana-pun'])).toEqual(
      [],
    );
    await expect(adapter.grepFixed(mfe().path, 'origin/hilang', ['orders'])).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
    await expect(adapter.grepFixed(mfe().path, 'origin/main', [''])).rejects.toThrow('kosong');
    await expect(adapter.grepFixed(mfe().path, 'origin/main', [])).rejects.toThrow('kosong');
  });
});

describe('forEachRefRemotes', () => {
  it('branch origin urut menurut nama, tanpa awalan origin/ dan tanpa HEAD', async () => {
    expect(await adapter.forEachRefRemotes(order().path)).toEqual([
      { name: 'feature/xyz', sha: order().commits['feature-xyz'] },
      { name: 'main', sha: order().commits['readme'] },
    ]);
  });
});

describe('forEachRefTags', () => {
  it('kosong bila repo tidak punya tag (fixture)', async () => {
    expect(await adapter.forEachRefTags(order().path)).toEqual([]);
  });

  it('tag ringan dan beranotasi sama-sama menunjuk commit, urut menurut nama', async () => {
    const head = rawGit(extra, 'rev-parse', 'HEAD');
    rawGit(extra, 'tag', 'v2-ringan');
    rawGit(extra, 'tag', '--annotate', '--message', 'rilis', 'v1-anotasi');

    // Objek tag beranotasi berbeda dari commit; adapter harus mengupasnya.
    expect(rawGit(extra, 'rev-parse', 'v1-anotasi')).not.toBe(head);
    expect(await adapter.forEachRefTags(extra)).toEqual([
      { name: 'v1-anotasi', sha: head },
      { name: 'v2-ringan', sha: head },
    ]);
  });
});

describe('fetchPrune', () => {
  it('mengambil branch baru dari remote dan memangkas yang sudah dihapus', async () => {
    const { remote, path: repo, commits } = mfe();
    const names = async () => (await adapter.forEachRefRemotes(repo)).map((b) => b.name);
    expect(await names()).toEqual(['main']);

    rawGit(remote, 'update-ref', 'refs/heads/sementara', commits['initial']!);
    await adapter.fetchPrune(repo);
    expect(await names()).toEqual(['main', 'sementara']);

    rawGit(remote, 'update-ref', '-d', 'refs/heads/sementara');
    await adapter.fetchPrune(repo);
    expect(await names()).toEqual(['main']);
  });

  it('remote yang tidak bisa dijangkau → CommandFailedError', async () => {
    await expect(adapter.fetchPrune(extra)).rejects.toBeInstanceOf(CommandFailedError);
  });
});

describe('worktree', () => {
  const worktreeCount = (repo: string) =>
    rawGit(repo, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree ')).length;

  it('add → berkas ada di SHA itu; remove menghapusnya meski ada berkas hasil generate', async () => {
    const { path: repo, commits } = order();
    const dir = path.join(tmp, 'wt-initial');
    await adapter.worktreeAdd(repo, dir, commits['initial']!);
    expect(worktreeCount(repo)).toBe(2);
    expect(await fs.readFile(path.join(dir, 'openapi.json'), 'utf8')).toBe(
      await adapter.show(repo, commits['initial']!, 'openapi.json'),
    );

    await fs.writeFile(path.join(dir, 'hasil-spec-cmd.json'), '{}'); // berkas tak terlacak
    await adapter.worktreeRemove(repo, dir);
    await expect(fs.access(dir)).rejects.toThrow();
    expect(worktreeCount(repo)).toBe(1);
  });

  it('prune membersihkan worktree yang foldernya sudah hilang', async () => {
    const { path: repo, commits } = order();
    const dir = path.join(tmp, 'wt-hilang');
    await adapter.worktreeAdd(repo, dir, commits['initial']!);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    expect(worktreeCount(repo)).toBe(2);
    await adapter.worktreePrune(repo);
    expect(worktreeCount(repo)).toBe(1);
  });

  it('SHA tidak ada → RefNotFoundError dan tidak ada worktree tersisa', async () => {
    const dir = path.join(tmp, 'wt-salah');
    await expect(adapter.worktreeAdd(order().path, dir, 'origin/hilang')).rejects.toBeInstanceOf(
      RefNotFoundError,
    );
    expect(worktreeCount(order().path)).toBe(1);
  });
});

describe('diffNameOnly', () => {
  it('hanya perubahan di sisi head sejak merge-base (README di main tidak ikut)', async () => {
    const changed = await adapter.diffNameOnly(order().path, 'origin/main', 'origin/feature/xyz');
    expect(changed).toContain('openapi.json');
    expect(changed).not.toContain('README.md');
    const expected = rawGit(
      order().path,
      'diff',
      '--name-only',
      '--no-renames',
      `${order().commits['initial']}..origin/feature/xyz`,
    ).split('\n');
    expect([...changed].sort()).toEqual(expected.sort());
  });

  it('ref tidak ada → RefNotFoundError', async () => {
    await expect(
      adapter.diffNameOnly(order().path, 'origin/main', 'origin/hilang'),
    ).rejects.toMatchObject({ name: 'RefNotFoundError', ref: 'origin/hilang' });
  });
});
