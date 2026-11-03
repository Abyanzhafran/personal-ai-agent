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
  repo_not_found: 'repo_not_found',
  /** Folder bukan repo git (`rev-parse --is-inside-work-tree` tidak `true`). */
  repo_not_git: 'repo_not_git',
  /** `origin/<default_branch>` tidak ada. Nama branch ada di pesan. */
  branch_not_found: 'branch_not_found',
  /** `local_path` sudah terdaftar di project yang sama. */
  repo_path_taken: 'repo_path_taken',
  /** Nama repo sudah dipakai repo lain di project yang sama. `details`: `{ fields }`. */
  repo_name_taken: 'repo_name_taken',
  /** Penolakan `normalizeLocalPath`; pesannya siap tampil di field `local_path`. */
  local_path_empty: 'local_path_empty',
  local_path_not_absolute: 'local_path_not_absolute',
  local_path_missing: 'local_path_missing',
  local_path_not_directory: 'local_path_not_directory',
  /** Discovery repo ini sedang berjalan (409). Pantau lewat `GET /api/repos/:id/profile`. */
  discovery_in_progress: 'discovery_in_progress',
  /** Repo `e2e` tidak pernah dipindai (409). */
  discovery_not_applicable: 'discovery_not_applicable',
  /** `PUT /api/repos/:id/profile` sebelum ada draf discovery (409). */
  profile_not_ready: 'profile_not_ready',
  /** Project sudah punya check berjalan (409). `details`: `{ project_id, check_id }`. */
  check_already_running: 'check_already_running',
  /** DELETE project atau repo selagi check berjalan memakainya (409). */
  check_in_progress: 'check_in_progress',
  /** oasdiff tidak terpasang atau terlalu lama (503); pesannya menjelaskan cara memperbaikinya. */
  oasdiff_unavailable: 'oasdiff_unavailable',
  check_not_found: 'check_not_found',
  /** Batalkan check yang sudah selesai atau tidak sedang berjalan (409). */
  check_not_running: 'check_not_running',
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
