import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside, WorkspacePathError, type WorkspaceLayout } from './layout.js';

const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Windows kadang menolak rename sesaat ketika antivirus/indexer memegang file tujuan. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = errorCode(err);
      if (attempt >= RENAME_ATTEMPTS || code === undefined || !RETRYABLE_RENAME.has(code))
        throw err;
      await sleep(30 * attempt);
    }
  }
}

/**
 * Semua I/O ke workspace lewat sini. Setiap operasi menolak path di luar `WORKSPACE_DIR`,
 * baik secara leksikal (`..`, path absolut) maupun lewat symlink di dalam workspace.
 */
export class WorkspaceStore {
  constructor(readonly layout: WorkspaceLayout) {}

  /** Membuat root dan folder tingkat atas. Aman dipanggil berulang. */
  async ensure(): Promise<void> {
    const { layout } = this;
    await fs.mkdir(layout.root, { recursive: true });
    await Promise.all(
      [layout.contextsDir, layout.specCacheDir, layout.extractCacheDir, layout.checksDir].map(
        (dir) => fs.mkdir(dir, { recursive: true }),
      ),
    );
  }

  /** Menulis file secara atomic: tulis ke file sementara di folder yang sama, fsync, lalu rename. */
  async writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const target = this.layout.resolveInside(file);
    const dir = path.dirname(target);
    // Diperiksa sebelum mkdir supaya symlink tidak sempat membuat folder di luar workspace.
    await this.assertRealPathInside(dir);
    await fs.mkdir(dir, { recursive: true });

    const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const handle = await fs.open(tmp, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } catch (err) {
      await handle.close().catch(() => undefined);
      await fs.rm(tmp, { force: true });
      throw err;
    }
    await handle.close();

    try {
      await renameWithRetry(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async writeJson(file: string, value: unknown): Promise<void> {
    await this.writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Membaca teks; `undefined` bila file tidak ada. */
  async readText(file: string): Promise<string | undefined> {
    const target = this.layout.resolveInside(file);
    try {
      return await fs.readFile(target, 'utf8');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
      throw err;
    }
  }

  /**
   * Membaca cache JSON. File tidak ada, bukan JSON, atau ditolak `parse` = cache miss
   * (`undefined`), bukan error: cache boleh dibuang kapan saja.
   */
  async readCache<T>(file: string, parse: (data: unknown) => T): Promise<T | undefined> {
    const text = await this.readText(file);
    if (text === undefined) return undefined;
    try {
      return parse(JSON.parse(text));
    } catch {
      return undefined;
    }
  }

  async writeCache(file: string, value: unknown): Promise<void> {
    await this.writeJson(file, value);
  }

  /** Menghapus file atau folder (rekursif) di dalam workspace. Tidak ada = bukan error. */
  async remove(target: string): Promise<void> {
    const resolved = this.layout.resolveInside(target);
    if (resolved === this.layout.root) {
      throw new WorkspacePathError('Menghapus root workspace ditolak');
    }
    // Symlink dilepas saja, isi tujuannya tidak disentuh.
    const stat = await fs.lstat(resolved).catch((err: unknown) => {
      if (errorCode(err) === 'ENOENT') return undefined;
      throw err;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      await fs.unlink(resolved);
      return;
    }
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }

  /**
   * Membersihkan milik satu project: `contexts/projects/<slug>/` dan `runs/checks/<id>/` untuk
   * tiap check project itu. `cache/` bersama antar project sehingga tidak disentuh.
   * Tidak menjalankan `git worktree prune`; sisa metadata worktree dibersihkan recovery (CC-063).
   */
  async removeProjectData(project: { slug: string; checkIds: readonly number[] }): Promise<void> {
    await this.remove(this.layout.projectContextDir(project.slug));
    for (const checkId of project.checkIds) {
      await this.remove(this.layout.checkRunDir(checkId));
    }
  }

  /**
   * Menolak bila leluhur terdalam `dir` yang sudah ada (setelah symlink di-resolve) berada di
   * luar workspace asli. `dir` sendiri boleh belum ada.
   */
  private async assertRealPathInside(dir: string): Promise<void> {
    await fs.mkdir(this.layout.root, { recursive: true });
    const realRoot = await fs.realpath(this.layout.root);

    let probe = dir;
    for (;;) {
      try {
        const realProbe = await fs.realpath(probe);
        if (!isInside(realRoot, realProbe)) {
          throw new WorkspacePathError(`Path keluar dari workspace lewat symlink: '${dir}'`);
        }
        return;
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') throw err;
        const parent = path.dirname(probe);
        if (parent === probe) throw err;
        probe = parent;
      }
    }
  }
}
