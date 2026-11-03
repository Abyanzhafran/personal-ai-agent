import type { NewFinding } from '../checks/repository.js';
import { matchedFields } from '../compare/fields.js';
import { matchCalls } from '../compare/match.js';
import {
  callFindings,
  changelogFindings,
  type SeverityFinding,
  type Specs,
} from '../compare/severity.js';
import { suggestReplacement } from '../compare/suggest.js';
import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { GitAdapter } from '../git/adapter.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import type { Logger } from '../logger.js';
import { buildSnippet } from '../report/snippet.js';
import type { ExtractedFile } from './consumers-step.js';

export interface CompareStepDeps {
  readonly git: Pick<GitAdapter, 'show'>;
  readonly logger: Pick<Logger, 'info'>;
}

export interface CompareStepResult {
  readonly findings: readonly NewFinding[];
  /** `'METHOD path'` → nama yang dipakai consumer dan tetap cocok di head (baris "Cocok:"). */
  readonly matchedFields: Readonly<Record<string, readonly string[]>>;
}

const endpointKey = (endpoint: Pick<ChangedEndpoint, 'method' | 'path'>) =>
  `${endpoint.method} ${endpoint.path}`;

/** Kalimat temuan untuk laporan; `changelog` sudah berupa teks oasdiff. */
function describe({ source, kind, name }: SeverityFinding): string {
  switch (source) {
    case 'query_params':
      return `Parameter query "${name}" tidak ada lagi di spec`;
    case 'body_fields':
      if (kind === 'removed') return `Field body "${name}" tidak ada lagi di spec`;
      if (kind === 'required_added') {
        return `Field body "${name}" kini wajib di spec, tetapi tidak dikirim`;
      }
      return `Field body "${name}" dikirim, tetapi tidak ada di spec`;
    case 'literal':
      return `Nilai literal untuk "${name}" tidak ada di enum spec`;
    case 'type':
      return `Tipe "${name}" yang dikirim tidak cocok dengan spec`;
    case 'response_fields_read':
      return kind === 'removed'
        ? `Field response "${name}" yang dibaca tidak ada lagi di spec`
        : `Tipe field response "${name}" yang dibaca berubah di spec`;
    case 'operation':
      return `Endpoint ${name} dihapus dari spec`;
    case 'changelog':
      return name;
  }
}

/**
 * Langkah 5: pemakaian hasil ekstraksi dicocokkan ke endpoint yang berubah, dibandingkan dengan spec
 * base dan head (matriks severity), lalu dirakit menjadi baris `findings` lengkap dengan saran dan
 * cuplikan kode. Temuan `changelog` (level info) melekat pada endpoint, bukan pada satu pemakaian,
 * jadi tanpa consumer, berkas, dan baris. Pemakaian yang path-nya tidak bisa dinormalisasi dicatat
 * di log (D-43).
 */
export async function compareCalls(
  { git, logger }: CompareStepDeps,
  {
    files,
    endpoints,
    specs,
  }: {
    readonly files: readonly ExtractedFile[];
    readonly endpoints: readonly ChangedEndpoint[];
    readonly specs: Specs;
  },
): Promise<CompareStepResult> {
  const findings: NewFinding[] = [];
  const matchedEndpoints = new Set<ChangedEndpoint>();
  // Satu consumer pada satu endpoint, dari semua berkasnya (kontrak `matchedFields`).
  const perConsumer = new Map<string, { endpoint: ChangedEndpoint; calls: ApiCall[] }>();

  for (const file of files) {
    const matches = matchCalls(file.calls, endpoints, {
      baseUrlPattern: file.baseUrlPattern,
      onSkip: (call) =>
        logger.info(
          { repo: file.repo.name, file: file.path, path: call.path },
          'pemakaian dilewati: path tidak bisa dinormalisasi',
        ),
    });
    for (const { call, endpoint } of matches) {
      matchedEndpoints.add(endpoint);
      const key = `${file.repo.id}\0${endpointKey(endpoint)}`;
      const group = perConsumer.get(key) ?? { endpoint, calls: [] };
      group.calls.push(call);
      perConsumer.set(key, group);

      for (const found of callFindings(call, endpoint, specs)) {
        const suggestion = suggestReplacement(found, endpoint, specs);
        const line = found.line ?? call.line;
        findings.push({
          endpoint: endpointKey(endpoint),
          consumerRepoId: file.repo.id,
          file: file.path,
          line,
          kind: found.kind,
          severity: found.severity,
          detail: suggestion === null ? describe(found) : `${describe(found)}. ${suggestion}`,
          confidence: call.confidence,
          viaSymbol: call.via_symbol ?? null,
          snippet: await buildSnippet(git, {
            repo: file.repo.local_path,
            sha: file.sha,
            file: file.path,
            line,
            tokens: [found.name],
          }),
        });
      }
    }
  }

  for (const endpoint of matchedEndpoints) {
    for (const found of changelogFindings(endpoint)) {
      findings.push({
        endpoint: endpointKey(endpoint),
        consumerRepoId: null,
        file: null,
        line: null,
        kind: found.kind,
        severity: found.severity,
        detail: describe(found),
        confidence: null,
        viaSymbol: null,
        snippet: null,
      });
    }
  }

  const matched = new Map<string, Set<string>>();
  for (const { endpoint, calls } of perConsumer.values()) {
    const names = matched.get(endpointKey(endpoint)) ?? new Set<string>();
    for (const name of matchedFields(calls, endpoint, specs)) names.add(name);
    matched.set(endpointKey(endpoint), names);
  }
  return {
    findings,
    matchedFields: Object.fromEntries(
      [...matched].filter(([, names]) => names.size > 0).map(([key, names]) => [key, [...names]]),
    ),
  };
}
