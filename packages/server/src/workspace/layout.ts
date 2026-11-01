import path from 'node:path';

/** Path yang diminta keluar dari WORKSPACE_DIR, atau satu segmen path tidak aman. */
export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

const SHA = /^[0-9a-f]{7,64}$/;
const HEX = /^[0-9a-f]+$/;

/**
 * Satu segmen nama file/folder yang aman: bukan kosong, bukan `.`/`..`, tanpa pemisah path,
 * karakter terlarang Windows, NUL, atau titik/spasi di ujung (Windows membuangnya diam-diam).
 */
export function assertSafeSegment(value: string, label: string): string {
  if (
    value === '' ||
    value === '.' ||
    value === '..' ||
    // eslint-disable-next-line no-control-regex
    /[\\/:*?"<>|\u0000-\u001f]/.test(value) ||
    /[. ]$/.test(value)
  ) {
    throw new WorkspacePathError(`${label} tidak valid sebagai nama file: '${value}'`);
  }
  return value;
}

function assertMatches(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) {
    throw new WorkspacePathError(`${label} tidak valid: '${value}'`);
  }
  return value;
}

/** True bila `target` sama dengan `root` atau berada di dalamnya (perbandingan leksikal). */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Peta lokasi semua file dan folder di workspace (`WORKSPACE_DIR`). Hanya menghitung path,
 * tidak menyentuh disk. Setiap path yang dikembalikan dijamin berada di dalam `root`.
 */
export class WorkspaceLayout {
  readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) {
      throw new WorkspacePathError(`WORKSPACE_DIR harus absolut: '${root}'`);
    }
    this.root = path.resolve(root);
  }

  /** Menggabungkan segmen yang sudah divalidasi dan memastikan hasilnya tetap di dalam root. */
  private join(...segments: string[]): string {
    const resolved = path.resolve(this.root, ...segments);
    if (!isInside(this.root, resolved)) {
      throw new WorkspacePathError(`Path keluar dari workspace: '${resolved}'`);
    }
    return resolved;
  }

  /**
   * Menerima path absolut dari luar (mis. dari argumen) dan menolaknya bila di luar root.
   * Untuk path yang dibangun dari segmen, pakai helper bernama di bawah.
   */
  resolveInside(candidate: string): string {
    const resolved = path.resolve(this.root, candidate);
    if (!isInside(this.root, resolved)) {
      throw new WorkspacePathError(`Path keluar dari workspace: '${resolved}'`);
    }
    return resolved;
  }

  get dbFile(): string {
    return this.join('app.db');
  }

  get contextsDir(): string {
    return this.join('contexts', 'projects');
  }
  get specCacheDir(): string {
    return this.join('cache', 'specs');
  }
  get extractCacheDir(): string {
    return this.join('cache', 'extract');
  }
  get checksDir(): string {
    return this.join('runs', 'checks');
  }

  /** `contexts/projects/<slug>/` */
  projectContextDir(slug: string): string {
    return this.join('contexts', 'projects', assertSafeSegment(slug, 'slug project'));
  }

  /** `contexts/projects/<slug>/<repoName>.md` */
  repoProfileFile(slug: string, repoName: string): string {
    return this.join(
      'contexts',
      'projects',
      assertSafeSegment(slug, 'slug project'),
      `${assertSafeSegment(repoName, 'nama repo')}.md`,
    );
  }

  /** `contexts/projects/<slug>/<repoName>.json` — draf discovery (CC-019); `.md` milik profil yang disetujui. */
  repoProfileDraftFile(slug: string, repoName: string): string {
    return this.join(
      'contexts',
      'projects',
      assertSafeSegment(slug, 'slug project'),
      `${assertSafeSegment(repoName, 'nama repo')}.json`,
    );
  }

  /** `cache/specs/<repoId>/<sha>-<cmdHash>.json`. Dikunci dengan id repo, bukan nama, agar tidak bentrok antar project. */
  specCacheFile(repoId: number, sha: string, cmdHash: string): string {
    assertMatches(sha, SHA, 'sha');
    assertMatches(cmdHash, HEX, 'hash spec_cmd');
    return this.join('cache', 'specs', repoSegment(repoId), `${sha}-${cmdHash}.json`);
  }

  /** `cache/extract/<repoId>/<blobSha>-<pv>.json`; `pv` = versi prompt+model yang sudah aman sebagai nama file. */
  extractCacheFile(repoId: number, blobSha: string, pv: string): string {
    assertMatches(blobSha, SHA, 'blob sha');
    return this.join(
      'cache',
      'extract',
      repoSegment(repoId),
      `${blobSha}-${assertSafeSegment(pv, 'versi prompt')}.json`,
    );
  }

  /** `cache/specs/<repoId>/` */
  repoSpecCacheDir(repoId: number): string {
    return this.join('cache', 'specs', repoSegment(repoId));
  }

  /** `cache/extract/<repoId>/` */
  repoExtractCacheDir(repoId: number): string {
    return this.join('cache', 'extract', repoSegment(repoId));
  }

  /** `runs/checks/<checkId>/` */
  checkRunDir(checkId: number): string {
    return this.join('runs', 'checks', checkSegment(checkId));
  }

  /** `runs/checks/<checkId>/<name>`, mis. `spec-base.json`. */
  checkArtifact(checkId: number, name: string): string {
    return this.join(
      'runs',
      'checks',
      checkSegment(checkId),
      assertSafeSegment(name, 'nama artefak'),
    );
  }

  /** `runs/checks/<checkId>/extract/<name>` */
  checkExtractFile(checkId: number, name: string): string {
    return this.join(
      'runs',
      'checks',
      checkSegment(checkId),
      'extract',
      assertSafeSegment(name, 'nama file ekstraksi'),
    );
  }

  /** `runs/checks/<checkId>/wt-<sha>/` — worktree sementara untuk `spec_cmd`. */
  worktreeDir(checkId: number, sha: string): string {
    assertMatches(sha, SHA, 'sha');
    return this.join('runs', 'checks', checkSegment(checkId), `wt-${sha}`);
  }
}

function repoSegment(repoId: number): string {
  if (!Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new WorkspacePathError(`id repo tidak valid: ${repoId}`);
  }
  return String(repoId);
}

function checkSegment(checkId: number): string {
  if (!Number.isSafeInteger(checkId) || checkId <= 0) {
    throw new WorkspacePathError(`id check tidak valid: ${checkId}`);
  }
  return String(checkId);
}
