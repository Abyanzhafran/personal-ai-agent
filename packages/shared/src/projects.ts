import { z } from 'zod';

/**
 * Kontrak endpoint `/api/projects` (CC-012). Pesan galat ditulis per isian dalam bahasa Indonesia,
 * bukan memakai pesan bawaan zod: pesan ini tampil langsung di bawah field dialog (CC-077).
 */

export const PROJECT_NAME_MAX = 60;

const ProjectName = z
  .string({ error: 'Nama project wajib diisi' })
  .trim()
  .min(1, 'Nama project wajib diisi')
  .max(PROJECT_NAME_MAX, `Nama project maksimal ${PROJECT_NAME_MAX} karakter`);

/** Teks kosong atau hanya spasi berarti tanpa deskripsi; hasil parse selalu teks tak kosong atau null. */
const ProjectDescription = z
  .string({ error: 'Deskripsi harus berupa teks' })
  .trim()
  .nullable()
  .transform((value) => (value === '' ? null : value));

export const Project = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Nama folder `contexts/projects/<slug>/`. Dibuat sekali dari nama saat project dibuat dan tidak berubah. */
  slug: z.string(),
  description: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectRequest = z.object(
  { name: ProjectName, description: ProjectDescription.optional() },
  { error: 'Body harus berupa objek JSON' },
);
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

/** Isian yang tidak dikirim tidak berubah. `description: null` atau `''` menghapus deskripsi. */
export const UpdateProjectRequest = z.object(
  { name: ProjectName.optional(), description: ProjectDescription.optional() },
  { error: 'Body harus berupa objek JSON' },
);
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

const INVALID_PROJECT_ID = 'Id project tidak valid';

export const ProjectIdParams = z.object({
  id: z.coerce
    .number({ error: INVALID_PROJECT_ID })
    .int(INVALID_PROJECT_ID)
    .positive(INVALID_PROJECT_ID),
});
export type ProjectIdParams = z.infer<typeof ProjectIdParams>;
