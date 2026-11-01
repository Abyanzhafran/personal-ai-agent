import { z } from 'zod';
import { ProfileStatus, ROLES, Role } from './domain.js';

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

const INVALID_REPO_ID = 'Id repo tidak valid';

export const RepoIdParams = z.object({
  id: z.coerce.number({ error: INVALID_REPO_ID }).int(INVALID_REPO_ID).positive(INVALID_REPO_ID),
});
export type RepoIdParams = z.infer<typeof RepoIdParams>;
