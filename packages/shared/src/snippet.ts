import { z } from 'zod';

/** Isi `findings.snippet_json` (CC-048): cuplikan kode consumer di sekitar baris yang bermasalah. */
export const Snippet = z.object({
  /** Baris berurutan beserta nomornya di file (mulai 1); teks apa adanya, termasuk tab. */
  lines: z.array(z.object({ n: z.number().int().positive(), text: z.string() })).min(1),
  /** Nomor baris yang disorot; selalu salah satu `lines[].n`. */
  highlight: z.number().int().positive(),
  /** Potongan teks pada baris yang disorot yang ditebalkan. Kosong bila tidak ada yang cocok. */
  tokens: z.array(z.string().min(1)),
});
export type Snippet = z.infer<typeof Snippet>;
