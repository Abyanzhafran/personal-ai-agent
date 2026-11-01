import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout, WorkspacePathError } from './layout.js';
import { WorkspaceStore } from './store.js';

let tmp: string;
let root: string;
let layout: WorkspaceLayout;
let store: WorkspaceStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-ws-'));
  root = path.join(tmp, 'workspace');
  layout = new WorkspaceLayout(root);
  store = new WorkspaceStore(layout);
  await store.ensure();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

describe('ensure', () => {
  it('membuat folder tingkat atas dan aman dipanggil berulang', async () => {
    await store.ensure();
    for (const dir of [
      layout.contextsDir,
      layout.specCacheDir,
      layout.extractCacheDir,
      layout.checksDir,
    ]) {
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    }
  });
});

describe('writeJson / readCache', () => {
  it('menulis JSON, membuat folder induk, dan bisa dibaca kembali', async () => {
    const file = layout.checkArtifact(5, 'summary.json');
    await store.writeJson(file, { a: 1, b: ['x'] });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ a: 1, b: ['x'] });
    expect(await store.readCache(file, (d) => d as { a: number })).toEqual({ a: 1, b: ['x'] });
  });

  it('menimpa file lama dan tidak meninggalkan file sementara', async () => {
    const file = layout.checkArtifact(1, 'x.json');
    await store.writeJson(file, { v: 1 });
    await store.writeJson(file, { v: 2 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 2 });
    expect(await fs.readdir(path.dirname(file))).toEqual(['x.json']);
  });

  it('cache miss: file tidak ada, JSON rusak, atau ditolak parser -> undefined', async () => {
    const file = layout.specCacheFile(1, 'a'.repeat(40), 'ab');
    expect(await store.readCache(file, (d) => d)).toBeUndefined();

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"separuh":');
    expect(await store.readCache(file, (d) => d)).toBeUndefined();

    await fs.writeFile(file, '{"ok":true}');
    const strict = (d: unknown) => {
      if (typeof d !== 'object' || d === null || !('versi' in d)) throw new Error('bentuk salah');
      return d;
    };
    expect(await store.readCache(file, strict)).toBeUndefined();
    expect(await store.readCache(file, (d) => d)).toEqual({ ok: true });
  });

  it('menulis berkas teks (profil .md) apa adanya, termasuk akhir baris', async () => {
    const file = layout.repoProfileFile('order', 'svc-order');
    const md = '# svc-order\r\n\r\n- tab\tdi sini\n';
    await store.writeFileAtomic(file, md);
    expect(await fs.readFile(file, 'utf8')).toBe(md);
    expect(await store.readText(file)).toBe(md);
    expect(await store.readText(layout.repoProfileFile('order', 'tidak-ada'))).toBeUndefined();
  });
});

describe('atomicity', () => {
  it('gagal sebelum rename: file lama utuh dan file sementara dibersihkan', async () => {
    const file = layout.checkArtifact(1, 'x.json');
    await store.writeJson(file, { versi: 'lama' });

    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('disk penuh'), { code: 'ENOSPC' }),
    );
    await expect(store.writeJson(file, { versi: 'baru' })).rejects.toThrow('disk penuh');

    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ versi: 'lama' });
    expect(await fs.readdir(path.dirname(file))).toEqual(['x.json']);
  });

  it('mengulang rename yang ditolak sesaat (EPERM/EBUSY) lalu berhasil', async () => {
    const file = layout.checkArtifact(1, 'x.json');
    const real = fs.rename.bind(fs);
    const spy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockRejectedValueOnce(Object.assign(new Error('perm'), { code: 'EPERM' }))
      .mockImplementation(real);
    await store.writeJson(file, { ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: true });
  });

  it('error rename selain EPERM/EBUSY/EACCES tidak diulang', async () => {
    const file = layout.checkArtifact(1, 'x.json');
    const spy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(Object.assign(new Error('io'), { code: 'EIO' }));
    await expect(store.writeJson(file, {})).rejects.toThrow('io');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('proses dibunuh (SIGKILL) di tengah penulisan: pembaca tidak pernah melihat JSON separuh', async () => {
    const file = layout.checkArtifact(1, 'big.json');
    await store.writeJson(file, { n: -1, payload: 'awal' });

    const script = fileURLToPath(new URL('../../test/fixtures/atomic-writer.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', script, root, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    let exitedEarly = false;
    child.once('exit', (code, signal) => {
      if (signal === null && code !== 0) exitedEarly = true;
    });

    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
    });

    const seen = new Set<number>();
    const check = () => {
      const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8')) as {
        n: number;
        payload: string;
      };
      // Selalu salah satu versi utuh: 'awal' dari sebelum child, atau payload penuh dari child.
      if (parsed.n === -1) expect(parsed.payload).toBe('awal');
      else expect(parsed.payload).toHaveLength(2_000_000);
      seen.add(parsed.n);
    };

    // Baca terus-menerus selagi child menimpa file; bunuh child di tengah putaran.
    const deadline = Date.now() + 8000;
    while (seen.size < 6 && Date.now() < deadline) {
      check();
      await new Promise((r) => setTimeout(r, 20));
    }
    const alreadyGone = child.exitCode !== null || child.signalCode !== null;
    if (!alreadyGone) {
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
    }
    expect(exitedEarly, `child berhenti sendiri: ${stderr}`).toBe(false);
    expect(seen.size).toBeGreaterThanOrEqual(3); // child benar-benar menimpa berulang kali

    check(); // setelah dibunuh pun file tujuan tetap JSON utuh
  }, 30_000);
});

describe('penolakan path di luar workspace', () => {
  it('menulis ke path di luar root ditolak dan tidak membuat apa pun', async () => {
    const outside = path.join(tmp, 'luar.json');
    await expect(store.writeJson(outside, {})).rejects.toThrow(WorkspacePathError);
    await expect(store.writeJson(path.join(root, '..', 'luar.json'), {})).rejects.toThrow(
      WorkspacePathError,
    );
    expect(await exists(outside)).toBe(false);
  });

  it('membaca dan menghapus di luar root juga ditolak', async () => {
    const outside = path.join(tmp, 'luar.txt');
    await fs.writeFile(outside, 'rahasia');
    await expect(store.readText(outside)).rejects.toThrow(WorkspacePathError);
    await expect(store.remove(outside)).rejects.toThrow(WorkspacePathError);
    expect(await fs.readFile(outside, 'utf8')).toBe('rahasia');
  });

  it('menolak menghapus root workspace', async () => {
    await expect(store.remove(root)).rejects.toThrow(WorkspacePathError);
    expect(await exists(root)).toBe(true);
  });

  it('symlink di dalam workspace yang menunjuk ke luar tidak bisa dipakai menulis', async () => {
    const outsideDir = path.join(tmp, 'luar');
    await fs.mkdir(outsideDir);
    const link = path.join(layout.contextsDir, 'jebakan');
    await fs.symlink(outsideDir, link, 'junction');

    await expect(store.writeFileAtomic(path.join(link, 'sub', 'x.md'), 'isi')).rejects.toThrow(
      WorkspacePathError,
    );
    expect(await fs.readdir(outsideDir)).toEqual([]); // tidak ada folder 'sub' yang sempat dibuat
  });

  it('menghapus symlink hanya melepas tautannya, bukan isi tujuan', async () => {
    const outsideDir = path.join(tmp, 'luar');
    await fs.mkdir(outsideDir);
    await fs.writeFile(path.join(outsideDir, 'penting.txt'), 'jangan hapus');
    const link = path.join(layout.contextsDir, 'tautan');
    await fs.symlink(outsideDir, link, 'junction');

    await store.remove(link);
    expect(await exists(link)).toBe(false);
    expect(await fs.readFile(path.join(outsideDir, 'penting.txt'), 'utf8')).toBe('jangan hapus');
  });
});

describe('removeProjectData', () => {
  it('membersihkan contexts/ dan runs/checks/ milik satu project saja', async () => {
    // project A: slug 'a', check 1 dan 2. project B: slug 'b', check 3.
    const files = {
      aProfile: layout.repoProfileFile('a', 'svc'),
      bProfile: layout.repoProfileFile('b', 'svc'),
      a1: layout.checkArtifact(1, 'spec-base.json'),
      a2: layout.checkExtractFile(2, 'f.json'),
      b3: layout.checkArtifact(3, 'spec-base.json'),
      cache: layout.specCacheFile(9, 'b'.repeat(40), 'ab'),
    };
    await store.writeFileAtomic(files.aProfile, '# a');
    await store.writeFileAtomic(files.bProfile, '# b');
    await store.writeJson(files.a1, {});
    await store.writeJson(files.a2, {});
    await store.writeJson(files.b3, {});
    await store.writeCache(files.cache, {});

    await store.removeProjectData({ slug: 'a', checkIds: [1, 2] });

    expect(await exists(layout.projectContextDir('a'))).toBe(false);
    expect(await exists(layout.checkRunDir(1))).toBe(false);
    expect(await exists(layout.checkRunDir(2))).toBe(false);
    // milik project lain dan cache bersama tidak tersentuh
    expect(await exists(files.bProfile)).toBe(true);
    expect(await exists(files.b3)).toBe(true);
    expect(await exists(files.cache)).toBe(true);
  });

  it('project yang belum punya folder bukan error', async () => {
    await expect(
      store.removeProjectData({ slug: 'belum-ada', checkIds: [99] }),
    ).resolves.toBeUndefined();
  });

  it('slug berbahaya ditolak sebelum menghapus apa pun', async () => {
    await expect(store.removeProjectData({ slug: '..', checkIds: [] })).rejects.toThrow(
      WorkspacePathError,
    );
    expect(await exists(layout.contextsDir)).toBe(true);
  });
});
