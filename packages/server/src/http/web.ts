import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES } from '@cc/shared';
import express, { type Router } from 'express';
import { HttpError, toEnvelope } from './errors.js';

/** Hasil `npm run build -w @cc/web`: `packages/web/dist` (dari `packages/server/{src,dist}/http`). */
export const DEFAULT_WEB_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../web/dist',
);

const NOT_BUILT_MESSAGE =
  'Antarmuka web belum di-build. Jalankan `npm run build` lalu muat ulang halaman ini, ' +
  'atau pakai `npm run dev` dan buka http://127.0.0.1:5173.';

function notBuiltPage(): string {
  return `<!doctype html>
<html lang="id">
  <head><meta charset="utf-8" /><title>Contract Check</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; line-height: 1.5">
    <h1>Contract Check</h1>
    <p>${NOT_BUILT_MESSAGE.replace(/`([^`]+)`/g, '<code>$1</code>')}</p>
    <p>API tetap berjalan di <a href="/api/health">/api/health</a>.</p>
  </body>
</html>
`;
}

/**
 * Menyajikan hasil build SPA dengan fallback ke `index.html` untuk rute sisi klien
 * (`/projects/3`, `/checks/12`). Permintaan aset yang tidak ada (ada ekstensi) dijawab 404,
 * bukan HTML, supaya `/assets/hilang.js` tidak diterima browser sebagai skrip.
 * Build dicek tiap request: `npm run build` boleh dijalankan sambil server hidup.
 */
export function webRouter(webDist: string = DEFAULT_WEB_DIST): Router {
  const router = express.Router();
  const indexFile = path.join(webDist, 'index.html');
  const assets = express.static(webDist, { index: false, fallthrough: true });

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next(
        new HttpError(
          404,
          ERROR_CODES.not_found,
          `Rute tidak ditemukan: ${req.method} ${req.path}`,
        ),
      );
      return;
    }
    if (!fs.existsSync(indexFile)) {
      if (req.path === '/' || path.extname(req.path) === '') {
        res.status(503);
        if (req.accepts(['html', 'json']) === 'json') {
          res.json(toEnvelope(ERROR_CODES.web_not_built, NOT_BUILT_MESSAGE));
        } else {
          res.type('html').send(notBuiltPage());
        }
        return;
      }
      next(new HttpError(404, ERROR_CODES.not_found, `Berkas tidak ditemukan: ${req.path}`));
      return;
    }
    assets(req, res, next);
  });

  router.use((req, res, next) => {
    if (path.extname(req.path) !== '') {
      next(new HttpError(404, ERROR_CODES.not_found, `Berkas tidak ditemukan: ${req.path}`));
      return;
    }
    res.sendFile(indexFile);
  });

  return router;
}
