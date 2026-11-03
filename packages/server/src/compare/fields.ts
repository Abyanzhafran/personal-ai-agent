import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { readOperation } from './operation.js';
import { callFindings, type FindingSource, type Specs } from './severity.js';

// Finding `type`/`literal` menunjuk field body; grup mencegah finding pada `status` di body
// menyembunyikan `status` yang cocok di query.
const GROUP: Record<FindingSource, 'query' | 'body' | 'response' | 'changelog' | 'operation'> = {
  query_params: 'query',
  body_fields: 'body',
  literal: 'body',
  type: 'body',
  response_fields_read: 'response',
  changelog: 'changelog',
  operation: 'operation',
};

/**
 * Daftar "Cocok:" di laporan (CC-046): nama parameter query, field body, dan field response yang
 * dipakai `calls` (semua pemakaian satu consumer pada satu endpoint), masih ada di spec head, dan
 * tidak menjadi finding. Nama unik, urutan kemunculan pertama. Operasi tidak ada di head → kosong.
 */
export function matchedFields(
  calls: readonly ApiCall[],
  endpoint: Pick<ChangedEndpoint, 'method' | 'path'>,
  specs: Specs,
): string[] {
  const head = readOperation(specs.head, endpoint);
  if (!head) return [];

  const flagged = new Set(
    calls
      .flatMap((call) => callFindings(call, endpoint, specs))
      .map((finding) => `${GROUP[finding.source]}:${finding.name}`),
  );
  const found = new Set<string>();
  const keep = (group: 'query' | 'body' | 'response', name: string, inHead: boolean) => {
    if (inHead && !flagged.has(`${group}:${name}`)) found.add(name);
  };

  for (const call of calls) {
    for (const name of call.query_params) keep('query', name, head.query.has(name));
    for (const { name } of call.body_fields) keep('body', name, head.body.has(name));
    for (const { name } of call.response_fields_read) {
      keep('response', name, head.response.has(name));
    }
  }
  return [...found];
}
