import type { ChangedEndpoint } from '../diff/endpoints.js';
import { readOperation, type OperationFacts } from './operation.js';
import type { SeverityFinding, Specs } from './severity.js';

const tokens = (name: string): Set<string> =>
  new Set(
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

const shared = (a: string, b: string): number => {
  const other = tokens(b);
  return [...tokens(a)].filter((token) => other.has(token)).length;
};

const group = (facts: OperationFacts, source: SeverityFinding['source']) =>
  source === 'query_params' ? facts.query : source === 'body_fields' ? facts.body : undefined;

/**
 * Kalimat saran untuk finding `removed` pada parameter query atau field body (CC-047), atau `null`
 * bila tidak ada saran. Kandidat = nama yang ada di head tetapi tidak di base, pada kelompok yang
 * sama, dengan tipe yang sama dengan yang dihapus (tipe tidak jelas → tanpa saran). Satu kandidat
 * disarankan apa adanya; beberapa kandidat → yang paling banyak berbagi kata dengan nama lama
 * (pisah `_`, `-`, dan huruf besar), dan seri atau tanpa kesamaan → tanpa saran. Ini tebakan, bukan
 * hasil diff, dan kalimatnya selalu mengatakannya.
 */
export function suggestReplacement(
  removed: Pick<SeverityFinding, 'kind' | 'source' | 'name'>,
  endpoint: Pick<ChangedEndpoint, 'method' | 'path'>,
  { base, head }: Specs,
): string | null {
  if (removed.kind !== 'removed') return null;
  const before = readOperation(base, endpoint);
  const after = readOperation(head, endpoint);
  if (!before || !after) return null;
  const was = group(before, removed.source);
  const now = group(after, removed.source);
  const type = was?.get(removed.name)?.type;
  if (!was || !now || type === undefined) return null;

  const candidates = [...now].filter(([name, facts]) => !was.has(name) && facts.type === type);
  const ranked = candidates
    .map(([name]) => ({ name, score: shared(removed.name, name) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  if (ranked.length > 1 && (best.score === 0 || best.score === ranked[1]?.score)) return null;

  return `Kemungkinan diganti ${best.name} (saran heuristik dari nama dan tipe, bukan hasil diff).`;
}
