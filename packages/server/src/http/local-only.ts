import { ERROR_CODES } from '@cc/shared';
import type { RequestHandler } from 'express';
import { HttpError } from './errors.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Hostname dari nilai header `Host` (`127.0.0.1:4711`, `[::1]:4711`, `localhost`). */
function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith('['))
    return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase();
  return (hostHeader.split(':')[0] ?? '').toLowerCase();
}

/**
 * Pertahanan terhadap DNS rebinding dan CSRF ke server lokal. Binding ke 127.0.0.1 saja tidak cukup:
 * halaman web mana pun yang dibuka di browser bisa menyuruh browser memanggil localhost, dan lewat
 * DNS rebinding permintaannya tampak same-origin. API ini bisa mendaftarkan `spec_cmd` yang dijalankan
 * lewat shell, jadi akses dibatasi ke:
 *  - header `Host` loopback (menolak `evil.example:4711`), dan
 *  - untuk method yang mengubah state, header `Origin` (bila ada) juga loopback.
 * Port tidak dibatasi supaya dev server Vite (5173) tetap bisa lewat proxy.
 */
export function localOnly(): RequestHandler {
  return (req, _res, next) => {
    const host = req.headers.host;
    if (host === undefined || !LOOPBACK.has(hostnameOf(host))) {
      next(new HttpError(403, ERROR_CODES.forbidden_host, 'Host tidak diizinkan: hanya loopback'));
      return;
    }

    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const origin = req.headers.origin;
    if (!safeMethod && origin !== undefined) {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = undefined;
      }
      if (originHost === undefined || !LOOPBACK.has(hostnameOf(originHost))) {
        next(new HttpError(403, ERROR_CODES.forbidden_origin, 'Origin tidak diizinkan'));
        return;
      }
    }
    next();
  };
}
