import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { normalizeUsagePath } from './normalize.js';

export interface MatchedCall<C> {
  readonly call: C;
  readonly endpoint: ChangedEndpoint;
}

/**
 * Mencocokkan pemakaian hasil ekstraksi ke endpoint yang berubah (CC-044) lewat
 * `(method, normalized_path)`. Cocok bila method sama dan path pemakaian berakhir dengan
 * `normalized_path` endpoint (batas segmen terjaga karena endpoint diawali `/`), sehingga awalan
 * seperti `/api/v1` tidak menghalangi. Bila beberapa endpoint cocok, yang terpanjang menang, jadi
 * kecocokan persis selalu mengalahkan kecocokan sufiks.
 *
 * Pemakaian tanpa endpoint yang cocok dibuang diam-diam (ekstraksi mengambil semua panggilan,
 * penyaringan di sini). Path yang tidak bisa dinormalisasi dilewati dan dilaporkan lewat `onSkip`,
 * bukan dicocokkan. Urutan hasil mengikuti `calls`.
 */
export function matchCalls<C extends Pick<ApiCall, 'method' | 'path'>>(
  calls: readonly C[],
  endpoints: readonly ChangedEndpoint[],
  options: {
    /** `base_url_pattern` dari profil repo pemanggil. */
    readonly baseUrlPattern?: string | null;
    readonly onSkip?: (call: C) => void;
  } = {},
): MatchedCall<C>[] {
  const matched: MatchedCall<C>[] = [];
  for (const call of calls) {
    const path = normalizeUsagePath(call.path, options.baseUrlPattern);
    if (path === undefined) {
      options.onSkip?.(call);
      continue;
    }
    const method = call.method.toUpperCase();
    let best: ChangedEndpoint | undefined;
    for (const endpoint of endpoints) {
      if (endpoint.method.toUpperCase() !== method || !path.endsWith(endpoint.normalized_path)) {
        continue;
      }
      if (best === undefined || endpoint.normalized_path.length > best.normalized_path.length) {
        best = endpoint;
      }
    }
    if (best) matched.push({ call, endpoint: best });
  }
  return matched;
}
