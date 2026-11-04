import { z } from 'zod';
import { CheckStatus, Confidence, Kind, Severity } from './domain.js';
import { Snippet } from './snippet.js';

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

/** Ukuran halaman yang boleh dipilih untuk riwayat check (CC-064). */
export const CHECK_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_CHECK_PAGE_SIZE = 25;

const INVALID_PROJECT_ID = 'Id project tidak valid';
const INVALID_PAGE = 'Nomor halaman tidak valid';
const INVALID_PAGE_SIZE = `Ukuran halaman harus ${CHECK_PAGE_SIZES.join(', ')}`;

/** Query `GET /api/checks`. Tanpa `project` = semua project; `page` mulai dari 1. */
export const ListChecksQuery = z.object({
  project: z.coerce
    .number({ error: INVALID_PROJECT_ID })
    .int(INVALID_PROJECT_ID)
    .positive(INVALID_PROJECT_ID)
    .optional(),
  page: z.coerce
    .number({ error: INVALID_PAGE })
    .int(INVALID_PAGE)
    .positive(INVALID_PAGE)
    .default(1),
  page_size: z.coerce
    .number({ error: INVALID_PAGE_SIZE })
    .refine((size) => (CHECK_PAGE_SIZES as readonly number[]).includes(size), INVALID_PAGE_SIZE)
    .default(DEFAULT_CHECK_PAGE_SIZE),
});
export type ListChecksQuery = z.infer<typeof ListChecksQuery>;

/**
 * Satu baris riwayat. `counts` = `summary_json.counts`, null selama check berjalan atau bila tidak
 * pernah menulis hasil (`failed`, `cancelled`). `spec_stale` diturunkan dari tabel `findings`
 * (ada finding `spec_stale`), bukan dari `status`, yang tidak punya nilai itu.
 */
export const CheckListItem = Check.extend({
  project_name: z.string(),
  provider_repo_name: z.string(),
  counts: CheckSummary.shape.counts.nullable(),
  spec_stale: z.boolean(),
});
export type CheckListItem = z.infer<typeof CheckListItem>;

/**
 * `GET /api/checks`: halaman terbaru-dulu. `total_items` = baris hasil filter di semua halaman;
 * `counts` selalu untuk semua project (angka chip filter tidak berubah saat filter dipilih).
 */
export const CheckList = z.object({
  items: z.array(CheckListItem),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total_items: Count,
  counts: z.object({
    total: Count,
    by_project: z.array(z.object({ project_id: z.number().int(), name: z.string(), count: Count })),
  }),
});
export type CheckList = z.infer<typeof CheckList>;

/** Satu baris `findings` untuk laporan. Finding tingkat provider (`spec_stale`) tanpa consumer/file/line. */
export const Finding = z.object({
  id: z.number().int(),
  /** `'METHOD path'`, atau `'spec'` untuk finding tingkat provider. */
  endpoint: z.string(),
  /** Nama repo consumer; null untuk finding tingkat provider. */
  consumer_repo: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  kind: Kind,
  severity: Severity,
  detail: z.string(),
  confidence: Confidence.nullable(),
  via_symbol: z.string().nullable(),
  snippet: Snippet.nullable(),
});
export type Finding = z.infer<typeof Finding>;

/** `GET /api/checks/:id`. `summary` null selama check berjalan atau bila tidak pernah menulis hasil. */
export const CheckDetail = z.object({
  check: Check,
  project_name: z.string(),
  provider_repo_name: z.string(),
  findings: z.array(Finding),
  summary: CheckSummary.nullable(),
});
export type CheckDetail = z.infer<typeof CheckDetail>;
