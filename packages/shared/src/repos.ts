import { z } from 'zod';
import { PROFILE_STATUSES, ProfileStatus, ROLES, Role } from './domain.js';

/**
 * Kontrak endpoint repo (CC-013): `POST /api/projects/:id/repos`, `PATCH` dan `DELETE /api/repos/:id`.
 * Pesan galat per isian berbahasa Indonesia, sama seperti `projects.ts`.
 */

const INVALID_ROLE = `Peran repo harus salah satu dari: ${ROLES.join(', ')}`;

const RepoRole = z.enum(ROLES, { error: INVALID_ROLE });

/** Isian opsional yang dikosongkan user dianggap tidak dikirim. */
const optionalText = (label: string) =>
  z
    .string({ error: `${label} harus berupa teks` })
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .optional();

/** Teks kosong atau hanya spasi berarti nilainya dikosongkan; hasil parse teks tak kosong atau null. */
const nullableText = (label: string) =>
  z
    .string({ error: `${label} harus berupa teks` })
    .trim()
    .nullable()
    .transform((value) => (value === '' ? null : value));

export const Repo = z.object({
  id: z.number().int(),
  project_id: z.number().int(),
  role: Role,
  /** Nama file profil `contexts/projects/<slug>/<name>.md`. Unik per project dan tidak berubah. */
  name: z.string(),
  /** Path folder repo yang sudah dinormalkan (absolut, symlink diselesaikan). Tidak berubah. */
  local_path: z.string(),
  /** Tanpa awalan `origin/`. */
  default_branch: z.string(),
  spec_path: z.string().nullable(),
  spec_cmd: z.string().nullable(),
  profile_status: ProfileStatus,
  profile_error: z.string().nullable(),
  last_fetch_at: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

/**
 * `name` kosong → nama folder. `default_branch` kosong → dideteksi dari `origin/HEAD`.
 * `local_path` sengaja tidak divalidasi di sini: server menormalkannya dan menjawab dengan kode
 * `local_path_*` yang spesifik.
 */
export const CreateRepoRequest = z.object(
  {
    role: RepoRole,
    local_path: z.string({ error: 'Path folder repo wajib diisi' }),
    name: optionalText('Nama repo'),
    default_branch: optionalText('Branch default'),
  },
  { error: 'Body harus berupa objek JSON' },
);
export type CreateRepoRequest = z.infer<typeof CreateRepoRequest>;

/** Isian yang tidak dikirim tidak berubah; `name` dan `local_path` memang tidak bisa diubah. */
export const UpdateRepoRequest = z.object(
  {
    role: RepoRole.optional(),
    default_branch: z
      .string({ error: 'Branch default harus berupa teks' })
      .trim()
      .min(1, 'Branch default tidak boleh kosong')
      .optional(),
    spec_path: nullableText('Path spec').optional(),
    spec_cmd: nullableText('Perintah spec').optional(),
  },
  { error: 'Body harus berupa objek JSON' },
);
export type UpdateRepoRequest = z.infer<typeof UpdateRepoRequest>;

/**
 * Satu ref yang bisa dipilih sebagai base atau head (CC-015). `GET /api/repos/:id/refs` mengembalikan
 * array biasa: branch `origin` dulu (cabang default paling atas, sisanya urut nama), lalu tag urut nama.
 */
export const RepoRef = z.object({
  /** Branch tanpa awalan `origin/` (`feature/xyz`), atau nama tag (`v1.2.0`). */
  name: z.string(),
  kind: z.enum(['branch', 'tag']),
  /** Commit yang ditunjuk. */
  sha: z.string(),
});
export type RepoRef = z.infer<typeof RepoRef>;

/** Query `GET /api/repos/:id/compare` (CC-080): ref seperti yang diketik user, sama dengan `POST /api/checks`. */
export const RepoCompareQuery = z.object({
  base: z.string({ error: 'Ref base wajib diisi' }).trim().min(1, 'Ref base wajib diisi'),
  head: z.string({ error: 'Ref head wajib diisi' }).trim().min(1, 'Ref head wajib diisi'),
});
export type RepoCompareQuery = z.infer<typeof RepoCompareQuery>;

/**
 * Hasil membaca dua ref tanpa menjalankan check. `base_sha` adalah ujung `base`, **bukan** merge-base:
 * itu `merge_base`, yang disimpan check sebagai `checks.base_sha`.
 */
export const RepoCompare = z.object({
  base_sha: z.string(),
  head_sha: z.string(),
  merge_base: z.string(),
});
export type RepoCompare = z.infer<typeof RepoCompare>;

/** Hasil fetch satu repo. `POST /api/projects/:id/fetch` mengembalikan array ini, satu entri per repo. */
export const RepoFetchResult = z.object({
  repo_id: z.number().int(),
  name: z.string(),
  ok: z.boolean(),
  /** Satu baris alasan bila `ok` false; null bila berhasil. */
  error: z.string().nullable(),
  /** Waktu fetch berhasil terakhir (ISO-8601 UTC); tetap nilai lama bila fetch ini gagal. */
  last_fetch_at: z.string().nullable(),
});
export type RepoFetchResult = z.infer<typeof RepoFetchResult>;

/**
 * Draf discovery (CC-019), disimpan di `contexts/projects/<slug>/<repo>.json`. Enam field yang sama
 * dengan `DiscoveryOutput` di server; test server menjaga keduanya sejalan.
 */
export const RepoProfile = z.object({
  profile_md: z.string(),
  spec_path: z.string().nullable(),
  spec_cmd: z.string().nullable(),
  handler_dirs: z.array(z.string()),
  http_client: z.string().nullable(),
  base_url_pattern: z.string().nullable(),
});
export type RepoProfile = z.infer<typeof RepoProfile>;

/** Nilai DB ditambah dua status turunan: `scanning` dari job in-memory, `skipped` dari role e2e. */
export const REPO_PROFILE_STATUSES = [...PROFILE_STATUSES, 'scanning', 'skipped'] as const;

/**
 * Elemen `GET /api/projects/:id/repos` (CC-076): `Repo` dengan `profile_status` turunan (`scanning`,
 * `skipped`) seperti di {@link RepoProfileResponse}, tanpa membaca draf.
 */
export const ProjectRepo = Repo.extend({ profile_status: z.enum(REPO_PROFILE_STATUSES) });
export type ProjectRepo = z.infer<typeof ProjectRepo>;

/**
 * `GET /api/repos/:id/profile`; `POST /api/repos/:id/discovery` membalas 202 dengan bentuk yang sama
 * (status `scanning`).
 */
export const RepoProfileResponse = z.object({
  status: z.enum(REPO_PROFILE_STATUSES),
  /** Satu baris alasan discovery terakhir gagal; null bila tidak ada. */
  error: z.string().nullable(),
  /** Draf discovery; null selama belum ada (`not_scanned`, `skipped`). */
  profile: RepoProfile.nullable(),
});
export type RepoProfileResponse = z.infer<typeof RepoProfileResponse>;

/**
 * `PUT /api/repos/:id/profile` (CC-020): menyetujui profil. `profile_md` dipakai persis seperti dikirim
 * (hasil edit user, tanpa trim). `apply_spec_path` true menyalin `spec_path` draf ke repo (draf null =
 * tidak diubah). `spec_cmd` tidak dikirim = tidak berubah; kosong = null. Membalas `RepoProfileResponse`.
 */
export const ApproveProfileRequest = z.object(
  {
    profile_md: z
      .string({ error: 'Profil wajib diisi' })
      .refine((value) => value.trim() !== '', 'Profil tidak boleh kosong'),
    apply_spec_path: z.boolean({ error: 'apply_spec_path harus true atau false' }),
    spec_cmd: nullableText('Perintah spec').optional(),
  },
  { error: 'Body harus berupa objek JSON' },
);
export type ApproveProfileRequest = z.infer<typeof ApproveProfileRequest>;

const INVALID_REPO_ID = 'Id repo tidak valid';

export const RepoIdParams = z.object({
  id: z.coerce.number({ error: INVALID_REPO_ID }).int(INVALID_REPO_ID).positive(INVALID_REPO_ID),
});
export type RepoIdParams = z.infer<typeof RepoIdParams>;
