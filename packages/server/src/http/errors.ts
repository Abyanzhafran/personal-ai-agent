import { ERROR_CODES, type ApiErrorEnvelope } from '@cc/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger.js';

/** Galat yang sengaja dilempar handler; dipetakan apa adanya ke amplop galat. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function toEnvelope(
  code: string,
  message: string,
  details: unknown = null,
): ApiErrorEnvelope {
  return { error: { code, message, details } };
}

/** Untuk `/api/*` yang tidak cocok dengan rute mana pun. */
export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(
    new HttpError(404, ERROR_CODES.not_found, `Rute tidak ditemukan: ${req.method} ${req.path}`),
  );
};

interface BodyParserError {
  readonly type?: unknown;
  readonly status?: unknown;
}

function asBodyParserError(err: unknown): BodyParserError | undefined {
  return typeof err === 'object' && err !== null && 'type' in err
    ? (err as BodyParserError)
    : undefined;
}

/** Memetakan error body-parser (JSON rusak, body kebesaran) ke galat 4xx yang jelas. */
function fromBodyParser(err: unknown): HttpError | undefined {
  const parsed = asBodyParserError(err);
  if (!parsed) return undefined;
  if (parsed.type === 'entity.parse.failed') {
    return new HttpError(400, ERROR_CODES.invalid_json, 'Body bukan JSON yang valid');
  }
  if (parsed.type === 'entity.too.large') {
    return new HttpError(413, ERROR_CODES.payload_too_large, 'Body terlalu besar');
  }
  return undefined;
}

/** Semua galat berakhir di sini dan keluar sebagai `{ error: { code, message, details } }`. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const http = err instanceof HttpError ? err : fromBodyParser(err);
    if (http) {
      res.status(http.status).json(toEnvelope(http.code, http.message, http.details));
      return;
    }

    // Detail sengaja tidak dikirim ke klien; ia hanya masuk log.
    logger.error({ err }, 'unhandled error');
    res
      .status(500)
      .json(toEnvelope(ERROR_CODES.internal_error, 'Terjadi kesalahan internal pada server'));
  };
}
