/** `spec_path` tidak ada di ref yang diminta. */
export class SpecMissing extends Error {
  constructor(
    readonly sha: string,
    readonly path: string,
  ) {
    super(`Spec '${path}' tidak ada di ${sha}`);
    this.name = 'SpecMissing';
  }
}

/** Isi spec tidak bisa dibaca sebagai YAML/JSON, atau akarnya bukan objek. `problem` satu baris. */
export class SpecParseError extends Error {
  constructor(
    readonly sha: string,
    readonly path: string,
    readonly problem: string,
  ) {
    super(`Spec '${path}' di ${sha} tidak bisa dibaca: ${problem}`);
    this.name = 'SpecParseError';
  }
}

/** `spec_cmd` keluar dengan kode bukan nol. `stderrTail` = 20 baris terakhir stderr. */
export class SpecGenError extends Error {
  constructor(
    readonly sha: string,
    readonly command: string,
    readonly exitCode: number,
    readonly stderrTail: string,
  ) {
    super(`spec_cmd gagal (exit ${exitCode}) di ${sha}: ${command}\n${stderrTail}`);
    this.name = 'SpecGenError';
  }
}
