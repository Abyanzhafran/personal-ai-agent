import { z } from 'zod';
import { CheckStatus } from './domain.js';

const Count = z.number().int().nonnegative();

/** Isi `checks.summary_json` (CC-049), ditulis sekali saat check selesai. */
export const CheckSummary = z.object({
  /** Jumlah baris `findings` per severity; dihitung penulis, bukan pemanggil. */
  counts: z.object({ break: Count, warn: Count, info: Count }),
  /** Berkas consumer yang diperiksa ekstraksi. */
  files_checked: Count,
  /** Dari `files_checked`, yang ditemukan lewat simbol (hop 2). */
  files_via_hop2: Count,
  /** `'METHOD path'` untuk endpoint berubah yang tidak dipakai consumer mana pun. */
  endpoints_without_consumer: z.array(z.string()),
  /** Nama repo consumer → SHA `origin/<default>` yang dibaca. */
  consumer_shas: z.record(z.string(), z.string()),
  /** `'METHOD path'` → nama field yang dipakai consumer dan tetap cocok di head. */
  matched_fields: z.record(z.string(), z.array(z.string())),
  /** True bila batas berkas memotong kandidat; `skipped_files` = jumlah yang terlewat. */
  incomplete: z.boolean(),
  skipped_files: Count,
  /** Tool → keluaran perintah versi (oasdiff, node, go, ...). */
  tool_versions: z.record(z.string(), z.string()),
  /** Spec provider dihasilkan tanpa lockfile ter-commit (CC-031). */
  spec_unpinned: z.boolean(),
  /** Repo yang gagal di-fetch; check tetap lanjut. */
  fetch_errors: z.array(z.object({ repo: z.string(), message: z.string() })),
});
export type CheckSummary = z.infer<typeof CheckSummary>;

/**
 * `POST /api/checks` (CC-060). Project diturunkan dari repo provider; `base_ref` kosong atau tidak
 * dikirim = `default_branch` provider. `head_ref` boleh branch, tag, atau commit.
 */
export const CreateCheckRequest = z.object(
  {
    provider_repo_id: z
      .number({ error: 'Repo provider wajib dipilih' })
      .int('Repo provider tidak valid')
      .positive('Repo provider tidak valid'),
    head_ref: z.string({ error: 'Ref head wajib diisi' }).trim().min(1, 'Ref head wajib diisi'),
    base_ref: z
      .string({ error: 'Ref base harus berupa teks' })
      .trim()
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  },
  { error: 'Body harus berupa objek JSON' },
);
export type CreateCheckRequest = z.infer<typeof CreateCheckRequest>;

/**
 * Satu baris `checks`. `base_sha` dan `head_sha` null sampai langkah 1 selesai (atau selamanya bila
 * gagal sebelum itu); `error` hanya terisi saat `status` = `failed`.
 */
export const Check = z.object({
  id: z.number().int(),
  project_id: z.number().int(),
  provider_repo_id: z.number().int(),
  base_ref: z.string(),
  head_ref: z.string(),
  base_sha: z.string().nullable(),
  head_sha: z.string().nullable(),
  status: CheckStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type Check = z.infer<typeof Check>;

const INVALID_CHECK_ID = 'Id check tidak valid';

export const CheckIdParams = z.object({
  id: z.coerce.number({ error: INVALID_CHECK_ID }).int(INVALID_CHECK_ID).positive(INVALID_CHECK_ID),
});
export type CheckIdParams = z.infer<typeof CheckIdParams>;
