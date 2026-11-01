/** Akar error adapter git. Setiap subclass membawa `code` yang stabil untuk dipetakan ke API. */
export class GitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
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
