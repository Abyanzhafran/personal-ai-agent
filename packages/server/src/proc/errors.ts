/** Akar semua error dari pintu proses. Setiap subclass membawa `code` yang stabil untuk dipetakan ke API. */
export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Binary di luar allowlist, subcommand git terlarang, atau shell di luar worktree. Tidak pernah dijalankan. */
export class CommandNotAllowedError extends CommandError {
  constructor(message: string) {
    super('command_not_allowed', message);
  }
}

/** Binary tidak ada di PATH (mis. `oasdiff` belum terpasang). */
export class CommandNotFoundError extends CommandError {
  constructor(readonly file: string) {
    super('command_not_found', `Perintah '${file}' tidak ditemukan di PATH`);
  }
}

export class CommandTimeoutError extends CommandError {
  constructor(
    readonly command: string,
    readonly timeoutMs: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super('command_timeout', `Perintah melewati batas waktu ${timeoutMs} ms: ${command}`);
  }
}

export class CommandAbortedError extends CommandError {
  constructor(readonly command: string) {
    super('command_aborted', `Perintah dibatalkan: ${command}`);
  }
}

export class CommandOutputTooLargeError extends CommandError {
  constructor(
    readonly command: string,
    readonly maxBuffer: number,
  ) {
    super('command_output_too_large', `Keluaran melebihi ${maxBuffer} byte: ${command}`);
  }
}

/** Dilempar oleh `assertSuccess()` untuk pemanggil yang menganggap exit code bukan nol sebagai kegagalan. */
export class CommandFailedError extends CommandError {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super('command_failed', `Perintah gagal (exit ${exitCode}): ${command}\n${tail(stderr, 20)}`);
  }
}

/** `n` baris terakhir dari `text`. */
export function tail(text: string, lines: number): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}
