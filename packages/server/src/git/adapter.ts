// Adapter git read-only (CC-010). Semua perintah lewat `runCommand()`, jadi kebijakan allowlist di
// proc/git-policy.ts berlaku. Keluaran selalu di-parse menjadi nilai bertipe, bukan string mentah.
import { assertSuccess, type CommandResult, type CommandRunner } from '../proc/run-command.js';
import { PathNotFoundError, RefNotFoundError } from './errors.js';

const READ_TIMEOUT_MS = 30_000;
/** `fetch` menyentuh jaringan, `worktree add/remove` menulis banyak berkas. */
const HEAVY_TIMEOUT_MS = 120_000;
/** Spec atau berkas sumber besar; batas bawaan runner (16 MiB) terlalu kecil untuk `show`. */
const SHOW_MAX_BUFFER = 64 * 1024 * 1024;

const ORIGIN = 'origin/';
const ORIGIN_REFS = `refs/remotes/${ORIGIN}`;

export interface TreeEntry {
  /** Mode git, mis. `100644`; `120000` symlink, `160000` submodule. */
  readonly mode: string;
  /** `blob`; submodule bertipe lain (`-r` sudah menelusuri semua folder). */
  readonly type: string;
  readonly sha: string;
  readonly path: string;
}

export interface GrepMatch {
  readonly path: string;
  /** Mulai dari 1. */
  readonly line: number;
  readonly text: string;
}

export interface RemoteBranch {
  /** Tanpa awalan `origin/`, mis. `feature/xyz`. */
  readonly name: string;
  readonly sha: string;
}

/** Semua fungsi menerima `repo` (path absolut repo) sebagai argumen pertama dan memakai `git -C <repo>`. */
export interface GitAdapter {
  /** False bila bukan repo git, path tidak ada, atau repo bare. */
  isInsideWorkTree(repo: string): Promise<boolean>;
  /** Selesai bila `ref` ada; melempar {@link RefNotFoundError} bila tidak. */
  verifyRef(repo: string, ref: string): Promise<void>;
  /** Cabang default dari `refs/remotes/origin/HEAD` (mis. `main`), atau null bila tidak terpasang. */
  originHead(repo: string): Promise<string | null>;
  /** SHA lengkap commit yang ditunjuk `ref` (tag dikupas ke commit-nya). */
  revParse(repo: string, ref: string): Promise<string>;
  /** SHA leluhur bersama, atau null bila riwayat kedua ref tidak berhubungan. */
  mergeBase(repo: string, a: string, b: string): Promise<string | null>;
  /** Isi berkas persis seperti di commit (byte demi byte, termasuk newline akhir). */
  show(repo: string, sha: string, path: string): Promise<string>;
  /** Seluruh berkas di `rev`, rekursif. */
  lsTree(repo: string, rev: string): Promise<TreeEntry[]>;
  /** Baris yang memuat salah satu `patterns` sebagai teks tetap (bukan regex); berkas biner dilewati. */
  grepFixed(repo: string, rev: string, patterns: readonly string[]): Promise<GrepMatch[]>;
  /** Seperti {@link grepFixed}, tetapi hanya kecocokan utuh satu kata (`useOrders` bukan `useOrdersList`). */
  grepWord(repo: string, rev: string, word: string): Promise<GrepMatch[]>;
  /** Branch di `origin` tanpa `origin/HEAD`, urut menurut nama. */
  forEachRefRemotes(repo: string): Promise<RemoteBranch[]>;
  fetchPrune(repo: string): Promise<void>;
  /** Membuat worktree detached di `dir` pada `sha`. */
  worktreeAdd(repo: string, dir: string, sha: string): Promise<void>;
  /** Menghapus worktree beserta berkas tak terlacak di dalamnya (hasil `spec_cmd`). */
  worktreeRemove(repo: string, dir: string): Promise<void>;
  worktreePrune(repo: string): Promise<void>;
  /**
   * Berkas yang berubah di sisi `head` sejak `merge-base(base, head)` (`base...head`). Rename dilaporkan
   * sebagai dua path, lama dan baru, supaya penyentuhan path lama tidak terlewat.
   */
  diffNameOnly(repo: string, base: string, head: string): Promise<string[]>;
}

/** Ref berawalan '-' akan terbaca sebagai opsi git; git sendiri tidak mengizinkan ref seperti itu. */
function assertRefName(ref: string): void {
  if (ref === '' || ref.startsWith('-')) throw new RefNotFoundError(ref);
}

const TREE_RECORD = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s;

function parseTree(output: string): TreeEntry[] {
  return output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const match = TREE_RECORD.exec(record);
      if (!match) throw new Error(`Keluaran git ls-tree tidak dikenali: ${record}`);
      return { mode: match[1]!, type: match[2]!, sha: match[3]!, path: match[4]! };
    });
}

/** Format `-z -n` dengan rev: `<rev>:<path>\0<baris>\0<teks>\n`. */
function parseGrep(output: string, rev: string): GrepMatch[] {
  const prefix = `${rev}:`;
  const matches: GrepMatch[] = [];
  for (const row of output.split('\n')) {
    if (row === '') continue;
    const pathEnd = row.indexOf('\0');
    const lineEnd = row.indexOf('\0', pathEnd + 1);
    if (pathEnd < 0 || lineEnd < 0) throw new Error(`Keluaran git grep tidak dikenali: ${row}`);
    const file = row.slice(0, pathEnd);
    matches.push({
      path: file.startsWith(prefix) ? file.slice(prefix.length) : file,
      line: Number(row.slice(pathEnd + 1, lineEnd)),
      text: row.slice(lineEnd + 1).replace(/\r$/, ''),
    });
  }
  return matches;
}

export function createGitAdapter(runner: CommandRunner): GitAdapter {
  function git(
    repo: string,
    args: readonly string[],
    limits: { timeoutMs?: number; maxBuffer?: number } = {},
  ): Promise<CommandResult> {
    return runner.runCommand({
      file: 'git',
      args: ['-C', repo, ...args],
      timeoutMs: limits.timeoutMs ?? READ_TIMEOUT_MS,
      maxBuffer: limits.maxBuffer,
    });
  }

  async function revParse(repo: string, ref: string): Promise<string> {
    assertRefName(ref);
    const result = await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (result.exitCode === 1) throw new RefNotFoundError(ref);
    return assertSuccess(result).stdout.trim();
  }

  /**
   * Git memakai exit 128 untuk ref yang hilang maupun kegagalan lain. Bila gagal, periksa dulu
   * refnya supaya penyebab sebenarnya yang dilaporkan (RefNotFoundError atau CommandFailedError).
   */
  async function ensureOk(
    repo: string,
    refs: readonly string[],
    result: CommandResult,
  ): Promise<CommandResult> {
    if (result.exitCode !== 0) {
      for (const ref of refs) await revParse(repo, ref);
    }
    return assertSuccess(result);
  }

  async function grep(
    repo: string,
    rev: string,
    patterns: readonly string[],
    wholeWord: boolean,
  ): Promise<GrepMatch[]> {
    assertRefName(rev);
    // Pola kosong cocok dengan setiap baris; lebih baik gagal keras daripada mengembalikan seluruh repo.
    if (patterns.length === 0 || patterns.includes('')) {
      throw new Error('Pola grep tidak boleh kosong');
    }
    const result = await git(repo, [
      'grep',
      '-n',
      '-I',
      '-z',
      '-F',
      ...(wholeWord ? ['-w'] : []),
      ...patterns.flatMap((pattern) => ['-e', pattern]),
      rev,
      '--',
    ]);
    if (result.exitCode === 1) return []; // git grep: 1 = tidak ada kecocokan
    return parseGrep((await ensureOk(repo, [rev], result)).stdout, rev);
  }

  return {
    async isInsideWorkTree(repo) {
      const result = await git(repo, ['rev-parse', '--is-inside-work-tree']);
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    },

    async verifyRef(repo, ref) {
      await revParse(repo, ref);
    },

    async originHead(repo) {
      const result = await git(repo, ['symbolic-ref', '--short', `${ORIGIN_REFS}HEAD`]);
      if (result.exitCode !== 0) return null;
      const name = result.stdout.trim();
      return name.startsWith(ORIGIN) ? name.slice(ORIGIN.length) : name;
    },

    revParse,

    async mergeBase(repo, a, b) {
      assertRefName(a);
      assertRefName(b);
      const result = await git(repo, ['merge-base', a, b]);
      if (result.exitCode === 1) return null; // tidak ada leluhur bersama
      return (await ensureOk(repo, [a, b], result)).stdout.trim();
    },

    async show(repo, sha, path) {
      assertRefName(sha);
      const result = await git(repo, ['show', `${sha}:${path}`], { maxBuffer: SHOW_MAX_BUFFER });
      if (result.exitCode !== 0) {
        await revParse(repo, sha); // RefNotFoundError bila sha-nya yang salah
        throw new PathNotFoundError(sha, path);
      }
      return result.stdout;
    },

    async lsTree(repo, rev) {
      assertRefName(rev);
      const result = await git(repo, ['ls-tree', '-r', '-z', rev]);
      return parseTree((await ensureOk(repo, [rev], result)).stdout);
    },

    grepFixed: (repo, rev, patterns) => grep(repo, rev, patterns, false),

    grepWord: (repo, rev, word) => grep(repo, rev, [word], true),

    async forEachRefRemotes(repo) {
      const result = assertSuccess(
        await git(repo, ['for-each-ref', '--format=%(objectname)%09%(refname)', ORIGIN_REFS]),
      );
      return result.stdout
        .split('\n')
        .filter((row) => row !== '')
        .map((row) => {
          const [sha = '', refname = ''] = row.split('\t');
          return { name: refname.slice(ORIGIN_REFS.length), sha };
        })
        .filter((branch) => branch.name !== 'HEAD');
    },

    async fetchPrune(repo) {
      assertSuccess(
        await git(repo, ['fetch', '--prune', 'origin'], { timeoutMs: HEAVY_TIMEOUT_MS }),
      );
    },

    async worktreeAdd(repo, dir, sha) {
      assertRefName(sha);
      const result = await git(repo, ['worktree', 'add', '--detach', dir, sha], {
        timeoutMs: HEAVY_TIMEOUT_MS,
      });
      await ensureOk(repo, [sha], result);
    },

    async worktreeRemove(repo, dir) {
      assertSuccess(
        await git(repo, ['worktree', 'remove', '--force', dir], { timeoutMs: HEAVY_TIMEOUT_MS }),
      );
    },

    async worktreePrune(repo) {
      assertSuccess(await git(repo, ['worktree', 'prune']));
    },

    async diffNameOnly(repo, base, head) {
      assertRefName(base);
      assertRefName(head);
      const result = await git(repo, [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        `${base}...${head}`,
        '--',
      ]);
      return (await ensureOk(repo, [base, head], result)).stdout
        .split('\0')
        .filter((file) => file !== '');
    },
  };
}
