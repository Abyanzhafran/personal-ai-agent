import { z } from 'zod';

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
