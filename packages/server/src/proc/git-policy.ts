import { CommandNotAllowedError } from './errors.js';

/**
 * Kebijakan "repo user read-only" (aturan kerja #1). Dievaluasi di dalam `runCommand()` sehingga
 * tidak ada jalur kode yang bisa menjalankan git di luar kebijakan ini.
 *
 * Hanya subcommand yang membaca, atau yang menulis hanya ke `.git` lewat `fetch --prune` dan
 * `worktree add/remove/prune`. `diff` ditambahkan (hanya baca) karena CC-036 memakai
 * `git diff --name-only`; aturan #1 di backlog belum menyebutkannya.
 */
const SIMPLE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'rev-parse',
  'merge-base',
  'show',
  'grep',
  'ls-tree',
  'for-each-ref',
  'symbolic-ref',
  'diff',
]);

const WORKTREE_ACTIONS: ReadonlySet<string> = new Set(['add', 'remove', 'prune']);

/** Subcommand yang menulis ke working tree atau history. Ditolak dengan pesan khusus. */
const FORBIDDEN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'checkout',
  'switch',
  'reset',
  'clean',
  'commit',
  'push',
  'stash',
  'apply',
  'restore',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'pull',
  'am',
  'add',
  'rm',
  'mv',
  'tag',
  'branch',
  'config',
  'gc',
  'filter-branch',
]);

/** Opsi yang menjalankan perintah lain atau menulis file arbitrer. */
const DANGEROUS_OPTION =
  /^(--upload-pack|--receive-pack|--exec|--open-files-in-pager|--output)(=|$)|^-O/;

/** Konfigurasi `-c` yang diizinkan. Selain ini ditolak (mis. `core.sshCommand`, `core.pager`, `alias.*`). */
const ALLOWED_CONFIG = /^core\.quotepath=(true|false)$/;

/** Opsi global git tanpa argumen yang boleh mendahului subcommand. */
const ALLOWED_GLOBAL_FLAGS: ReadonlySet<string> = new Set(['--no-pager', '--no-optional-locks']);

export interface GitInvocation {
  readonly subcommand: string;
  /** Hanya terisi untuk `worktree`. */
  readonly action?: string;
}

/** Memeriksa argumen git; melempar {@link CommandNotAllowedError} bila melanggar kebijakan. */
export function checkGitArgs(args: readonly string[]): GitInvocation {
  let i = 0;
  for (; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '-C') {
      if (args[i + 1] === undefined) throw notAllowed('opsi -C tanpa path');
      i++;
    } else if (arg === '-c') {
      const setting = args[i + 1];
      if (setting === undefined || !ALLOWED_CONFIG.test(setting)) {
        throw notAllowed(`konfigurasi -c '${setting ?? ''}' tidak diizinkan`);
      }
      i++;
    } else if (ALLOWED_GLOBAL_FLAGS.has(arg)) {
      continue;
    } else if (arg.startsWith('-')) {
      throw notAllowed(`opsi global '${arg}' tidak diizinkan`);
    } else {
      break;
    }
  }

  const subcommand = args[i];
  if (subcommand === undefined) throw notAllowed('subcommand git kosong');

  const rest = args.slice(i + 1);
  // Setelah `--` semua argumen adalah path/ref, dan argumen setelah `-e` adalah pola grep:
  // keduanya bukan opsi walau diawali '-'.
  for (let j = 0; j < rest.length; j++) {
    const arg = rest[j] as string;
    if (arg === '--') break;
    if (arg === '-e') {
      j++;
      continue;
    }
    if (DANGEROUS_OPTION.test(arg)) throw notAllowed(`opsi '${arg}' tidak diizinkan`);
  }

  if (FORBIDDEN_SUBCOMMANDS.has(subcommand)) {
    throw notAllowed(`'git ${subcommand}' dilarang: repo user bersifat read-only`);
  }

  if (subcommand === 'fetch') {
    if (!rest.includes('--prune')) throw notAllowed("'git fetch' harus memakai --prune");
    return { subcommand };
  }

  if (subcommand === 'worktree') {
    const action = rest[0];
    if (action === undefined || !WORKTREE_ACTIONS.has(action)) {
      throw notAllowed(`'git worktree ${action ?? ''}' tidak diizinkan (hanya add, remove, prune)`);
    }
    return { subcommand, action };
  }

  if (SIMPLE_SUBCOMMANDS.has(subcommand)) return { subcommand };

  throw notAllowed(`subcommand git '${subcommand}' tidak ada di allowlist`);
}

function notAllowed(reason: string): CommandNotAllowedError {
  return new CommandNotAllowedError(`Perintah git ditolak: ${reason}`);
}
