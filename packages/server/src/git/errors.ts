/** Akar error adapter git. Setiap subclass membawa `code` yang stabil untuk dipetakan ke API. */
export class GitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export type LocalPathErrorCode =
  | 'local_path_empty'
  | 'local_path_not_absolute'
  | 'local_path_missing'
  | 'local_path_not_directory';

/** Path ketikan user tidak bisa dipakai sebagai folder repo. Pesannya siap tampil di field dialog. */
export class LocalPathError extends GitError {
  constructor(code: LocalPathErrorCode, message: string) {
    super(code, message);
  }
}

/** Branch, tag, atau SHA tidak ada di repo (atau berawalan '-', yang tidak pernah dianggap ref). */
export class RefNotFoundError extends GitError {
  constructor(readonly ref: string) {
    super('ref_not_found', `Ref tidak ditemukan: ${ref}`);
  }
}

/** Ref ada, tetapi berkasnya tidak ada di commit itu. */
export class PathNotFoundError extends GitError {
  constructor(
    readonly ref: string,
    readonly path: string,
  ) {
    super('path_not_found', `Berkas '${path}' tidak ada di ${ref}`);
  }
}
