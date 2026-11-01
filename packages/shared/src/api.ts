import { z } from 'zod';

/**
 * Kontrak API. Satu-satunya tempat bentuk request/response didefinisikan (aturan kerja #5):
 * server memvalidasi dengan skema ini, web mem-parse response dengan skema yang sama.
 * Skema per endpoint ditambahkan bersama task endpoint-nya.
 */

/** Kode galat yang dikenali web. Kode lain boleh muncul; web memperlakukannya sebagai galat umum. */
export const ERROR_CODES = {
  validation_failed: 'validation_failed',
  invalid_json: 'invalid_json',
  payload_too_large: 'payload_too_large',
  not_found: 'not_found',
  forbidden_host: 'forbidden_host',
  forbidden_origin: 'forbidden_origin',
  web_not_built: 'web_not_built',
  internal_error: 'internal_error',
  project_not_found: 'project_not_found',
  /** Nama menghasilkan slug yang sudah dipakai project lain. `details`: `{ slug }`. */
  project_slug_taken: 'project_slug_taken',
} as const;

/** Satu isian yang salah. `in` menyebut bagian request, `path` nama field bertitik (`items.0.name`). */
export const FieldIssue = z.object({
  in: z.enum(['body', 'query', 'params']),
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof FieldIssue>;

export const ValidationDetails = z.object({ fields: z.array(FieldIssue).min(1) });
export type ValidationDetails = z.infer<typeof ValidationDetails>;

/** Amplop galat seragam untuk semua respons non-2xx dari `/api`. `details` null bila tidak ada. */
export const ApiErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

export const HealthResponse = z.object({
  ok: z.literal(true),
  app: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
