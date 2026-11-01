import { z } from 'zod';
import { CheckStatus } from './domain.js';

/**
 * Event SSE `GET /api/checks/:id/events`. Satu objek = satu event: `event:` SSE berisi `type`,
 * `id:` berisi `seq`, `data:` berisi JSON objek ini seutuhnya. `seq` naik dari 1 per check dan
 * tidak pernah dipakai ulang; server mengirim ulang buffer dari awal saat klien menyambung, jadi
 * klien membuang event dengan `seq` yang sudah dilihat.
 */

/** Nama event SSE (= `type`). Daftar ini dan `CheckEvent` di bawah dijaga sama oleh test. */
export const EVENT_TYPES = ['step', 'log', 'done'] as const;

export const STEP_STATUSES = ['running', 'done', 'failed', 'skipped'] as const;
export const StepStatus = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatus>;

const seq = z.number().int().positive();

export const StepEvent = z.object({
  type: z.literal('step'),
  seq,
  /** Nomor langkah, 1 sampai 6. */
  number: z.number().int().positive(),
  name: z.string(),
  status: StepStatus,
  /** Teks detail yang tampil di bawah nama langkah. */
  detail: z.string(),
});
export type StepEvent = z.infer<typeof StepEvent>;

export const LogEvent = z.object({
  type: z.literal('log'),
  seq,
  /** Waktu ISO 8601. */
  at: z.string(),
  category: z.string(),
  message: z.string(),
});
export type LogEvent = z.infer<typeof LogEvent>;

/** Event terakhir; server menutup koneksi sesudahnya. Status akhir tidak pernah `running`. */
export const DoneEvent = z.object({
  type: z.literal('done'),
  seq,
  status: CheckStatus.exclude(['running']),
});
export type DoneEvent = z.infer<typeof DoneEvent>;

export const CheckEvent = z.discriminatedUnion('type', [StepEvent, LogEvent, DoneEvent]);
export type CheckEvent = z.infer<typeof CheckEvent>;
