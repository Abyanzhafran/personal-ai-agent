import { splitLines } from '../llm/extraction.prompt.js';
import type { Extraction } from './runner.js';

/**
 * Segmen statis terpanjang dari path seperti tertulis di kode (seri: yang pertama, seperti hop 1).
 * Segmen dengan `$`, `{}`, atau `:` dilewati: variabel template, parameter (`:id`), dan awalan URL
 * absolut (`http:`, `host:8080`). Query string dibuang dulu.
 */
function staticSegment(path: string): string | undefined {
  let best: string | undefined;
  for (const segment of (path.split(/[?#]/)[0] ?? '').split('/')) {
    if (segment === '' || /[${}:]/.test(segment)) continue;
    if (best === undefined || segment.length > best.length) best = segment;
  }
  return best;
}

/**
 * Memeriksa tiap panggilan hasil ekstraksi terhadap isi berkasnya: `line` harus ada, dan teks baris
 * itu harus memuat segmen statis path atau nama salah satu field (query, body, response) panggilan
 * itu. Yang lolos tidak berubah; yang tidak lolos tetap ada tetapi keyakinannya jadi `low`.
 * Tanpa bahan pembanding (path tanpa segmen statis dan tanpa field) panggilan juga tidak lolos.
 *
 * `content` harus isi berkas yang sama dengan yang diekstraksi. Baris di atas `sent_lines` tidak
 * pernah dilihat model (berkas dipotong), jadi dihitung di luar jangkauan walau barisnya ada.
 */
export function verifyExtraction(extraction: Extraction, content: string): Extraction {
  const lines = splitLines(content);
  return {
    ...extraction,
    calls: extraction.calls.map((call) => {
      const text = call.line <= extraction.sent_lines ? lines[call.line - 1] : undefined;
      const evidence = [
        staticSegment(call.path),
        ...call.query_params,
        ...call.body_fields.map((field) => field.name),
        ...call.response_fields_read.map((field) => field.name),
      ];
      const verified =
        text !== undefined && evidence.some((e) => e !== undefined && text.includes(e));
      return verified ? call : { ...call, confidence: 'low' as const };
    }),
  };
}
