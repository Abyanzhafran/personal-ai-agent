import type { RequestHandler } from 'express';
import type { Logger } from '../logger.js';

const CHECK_PATH = /^\/api\/checks\/(\d+)(?:\/|$)/;

/**
 * Satu baris log per request, ditulis saat respons selesai: method, path (tanpa query string),
 * status, durasi, dan `check_id` bila ada. `check_id` datang dari path `/api/checks/:id/...`
 * atau dari handler yang mengisi `res.locals.checkId` (mis. `POST /api/checks` yang baru membuat check).
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.once('close', () => {
      const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
      const status = res.statusCode;
      const local = res.locals['checkId'] as unknown;
      const fromPath = CHECK_PATH.exec(path)?.[1];
      const checkId =
        typeof local === 'number' ? local : fromPath === undefined ? undefined : Number(fromPath);

      const entry = {
        method: req.method,
        path,
        status,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        // Koneksi putus sebelum respons selesai ditulis.
        ...(res.writableFinished ? {} : { aborted: true }),
        ...(checkId === undefined ? {} : { check_id: checkId }),
      };

      if (status >= 500) logger.error(entry, 'request');
      else if (status >= 400) logger.warn(entry, 'request');
      else logger.info(entry, 'request');
    });

    next();
  };
}
