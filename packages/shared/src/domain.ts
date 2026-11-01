import { z } from 'zod';

/**
 * Enum domain. Satu-satunya sumber nilai: CHECK constraint di `server/src/db/schema.sql`
 * dicocokkan dengan konstanta ini oleh test, jadi menambah nilai berarti mengubah keduanya.
 */

export const ROLES = ['service', 'microfrontend', 'e2e'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/**
 * Status profil discovery yang tersimpan (kolom `repos.profile_status`). "Sedang dipindai"
 * adalah status in-memory dan "tidak dipindai" diturunkan dari role e2e, jadi keduanya bukan nilai.
 */
export const PROFILE_STATUSES = [
  'not_scanned', // Belum dipindai
  'pending_review', // Menunggu review
  'approved', // Disetujui
] as const;
export const ProfileStatus = z.enum(PROFILE_STATUSES);
export type ProfileStatus = z.infer<typeof ProfileStatus>;

export const CHECK_STATUSES = ['running', 'clean', 'findings', 'failed', 'cancelled'] as const;
export const CheckStatus = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const SEVERITIES = ['break', 'warn', 'info'] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

/** `renamed` sengaja tidak ada: rename tampil sebagai `removed` + saran heuristik (keputusan #5). */
export const KINDS = [
  'removed',
  'required_added',
  'param_mismatch',
  'type_changed',
  'spec_stale',
] as const;
export const Kind = z.enum(KINDS);
export type Kind = z.infer<typeof Kind>;

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const Confidence = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof Confidence>;
