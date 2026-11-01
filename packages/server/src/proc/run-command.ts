// SATU-SATUNYA pintu ke child process. Modul ini satu-satunya yang boleh meng-import `execa`
// atau `child_process`; test statis di guardrails.test.ts menjaganya.
import path from 'node:path';
import { execa } from 'execa';
import { isInside } from '../workspace/layout.js';
import {
  CommandAbortedError,
  CommandFailedError,
  CommandNotAllowedError,
  CommandNotFoundError,
  CommandOutputTooLargeError,
  CommandTimeoutError,
} from './errors.js';
import { resolveExecutable } from './executable.js';
import { checkGitArgs } from './git-policy.js';

const isWindows = process.platform === 'win32';
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

interface CommonRequest {
  /** Wajib dan harus > 0: tidak ada perintah yang boleh berjalan tanpa batas waktu. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Batas stdout/stderr (karakter) masing-masing. Default 16 MiB. */
  readonly maxBuffer?: number;
  /** Tambahan env; nilai `undefined` menghapus variabel. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input?: string;
}

/** Menjalankan binary di allowlist (`git` atau `OASDIFF_BIN`) tanpa shell. */
export interface BinaryRequest extends CommonRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/** Menjalankan `spec_cmd` lewat shell. `cwd` wajib berada di dalam `shellRoot` (worktree check). */
export interface ShellRequest extends CommonRequest {
  readonly shell: string;
  readonly cwd: string;
}

export type CommandRequest = BinaryRequest | ShellRequest;

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Untuk log; argumen dan perintah shell apa adanya, tanpa env. */
  readonly command: string;
}

export interface CommandRunnerOptions {
  /** Nilai `OASDIFF_BIN` dari config. */
  readonly oasdiffBin: string;
  /** Satu-satunya tempat shell boleh berjalan: `layout.checksDir` (`runs/checks`). */
  readonly shellRoot?: string;
}

export interface CommandRunner {
  /**
   * Menjalankan perintah. Resolve untuk exit code berapa pun (periksa `exitCode`, atau pakai
   * {@link assertSuccess}); reject dengan error bertipe untuk: perintah tidak diizinkan, binary
   * tidak ada, timeout, abort, dan keluaran terlalu besar.
   */
  runCommand(request: CommandRequest): Promise<CommandResult>;
  /** True bila `file` ada di PATH. Dipakai cek kapabilitas `oasdiff` saat start. */
  isAvailable(file: string): Promise<boolean>;
  /** Mematikan semua proses yang masih berjalan (shutdown server). */
  killAll(): void;
  readonly activeCount: number;
}

/** Menganggap exit code bukan nol sebagai kegagalan. */
export function assertSuccess(result: CommandResult): CommandResult {
  if (result.exitCode !== 0) {
    throw new CommandFailedError(result.command, result.exitCode, result.stderr);
  }
  return result;
}

/** Env anak: rahasia aplikasi tidak diwariskan ke git maupun `spec_cmd` buatan repo user. */
function childEnv(extra: CommonRequest['env'], gitDefaults: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.toUpperCase().startsWith('ANTHROPIC_')) env[key] = value;
  }
  if (gitDefaults) {
    // Jangan pernah menunggu prompt kredensial; jangan menulis index/lock saat membaca.
    env['GIT_TERMINAL_PROMPT'] = '0';
    env['GIT_OPTIONAL_LOCKS'] = '0';
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const live = new Set<number>();

  const shellRoot = options.shellRoot === undefined ? undefined : path.resolve(options.shellRoot);

  async function runCommand(request: CommandRequest): Promise<CommandResult> {
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new CommandNotAllowedError('timeoutMs wajib diisi dan harus > 0');
    }

    const isShell = 'shell' in request;
    let file: string;
    let args: readonly string[];
    let cwd: string | undefined;

    if (isShell) {
      if (shellRoot === undefined) {
        throw new CommandNotAllowedError('Shell tidak diizinkan: shellRoot tidak dikonfigurasi');
      }
      const resolvedCwd = path.resolve(request.cwd);
      if (resolvedCwd === shellRoot || !isInside(shellRoot, resolvedCwd)) {
        throw new CommandNotAllowedError(
          `Shell hanya boleh berjalan di dalam worktree (${shellRoot}), bukan di '${resolvedCwd}'`,
        );
      }
      if (request.shell.trim() === '') throw new CommandNotAllowedError('Perintah shell kosong');
      file = request.shell;
      args = [];
      cwd = resolvedCwd;
    } else {
      file = request.file;
      args = request.args;
      cwd = request.cwd;
      if (file === 'git') {
        checkGitArgs(args);
      } else if (file !== options.oasdiffBin) {
        throw new CommandNotAllowedError(`Binary '${file}' tidak ada di allowlist`);
      }
    }

    const command = isShell ? file : [file, ...args].join(' ');
    if (request.signal?.aborted) throw new CommandAbortedError(command);

    const env = childEnv(request.env, !isShell && file === 'git');

    if (!isShell && (await resolveExecutable(file, env)) === undefined) {
      throw new CommandNotFoundError(file);
    }

    const maxBuffer = request.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const startedAt = Date.now();
    const child = execa(file, [...args], {
      ...(cwd === undefined ? {} : { cwd }),
      env,
      extendEnv: false,
      shell: isShell,
      reject: false,
      stripFinalNewline: false,
      maxBuffer,
      // Pemimpin group di POSIX supaya seluruh keturunannya bisa dibunuh sekaligus.
      detached: !isWindows,
      windowsHide: true,
      ...(request.input === undefined ? { stdin: 'ignore' as const } : { input: request.input }),
    });

    const pid = child.pid;
    if (pid !== undefined) live.add(pid);

    let cause: 'timeout' | 'abort' | undefined;
    const terminate = (why: 'timeout' | 'abort') => {
      if (cause !== undefined) return;
      cause = why;
      if (child.exitCode === null && child.signalCode === null) killTree(pid);
    };
    const timer = setTimeout(() => terminate('timeout'), request.timeoutMs);
    const onAbort = () => terminate('abort');
    request.signal?.addEventListener('abort', onAbort, { once: true });

    let result: Awaited<typeof child>;
    try {
      result = await child;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      if (pid !== undefined) live.delete(pid);
    }

    if (cause === 'timeout') {
      throw new CommandTimeoutError(command, request.timeoutMs, result.stdout, result.stderr);
    }
    if (cause === 'abort') throw new CommandAbortedError(command);
    if (result.isMaxBuffer) throw new CommandOutputTooLargeError(command, maxBuffer);

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      command,
    };
  }

  return {
    runCommand,
    async isAvailable(file) {
      return (await resolveExecutable(file)) !== undefined;
    },
    killAll() {
      for (const pid of live) killTree(pid);
    },
    get activeCount() {
      return live.size;
    },
  };
}

/**
 * Membunuh proses beserta seluruh keturunannya.
 * POSIX: SIGKILL ke process group (anak dijalankan `detached`, jadi pid = pgid).
 * Windows: `taskkill /T /F`. Pilihan SIGKILL langsung (tanpa SIGTERM bertahap) disengaja:
 * hasil `spec_cmd` yang dibatalkan dibuang, dan worktree-nya dihapus paksa sesudahnya.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (isWindows) {
    // Fire-and-forget; exit code 128 (proses sudah tidak ada) bukan masalah.
    void execa('taskkill', ['/pid', String(pid), '/T', '/F'], {
      reject: false,
      windowsHide: true,
      stdin: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // sudah selesai
    }
  }
}
