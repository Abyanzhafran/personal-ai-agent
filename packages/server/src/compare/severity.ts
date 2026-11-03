import type { Kind, Severity } from '@cc/shared';
import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { readOperation } from './operation.js';

/** Kolom "Sumber pembanding" pada matriks severity di dokumen Arsitektur. */
export type FindingSource =
  'query_params' | 'body_fields' | 'literal' | 'type' | 'response_fields_read' | 'changelog';

export interface SeverityFinding {
  /** `spec_stale` bukan urusan modul ini (CC-036); `renamed` tidak ada (keputusan #5). */
  readonly kind: Exclude<Kind, 'spec_stale'>;
  readonly severity: Severity;
  readonly source: FindingSource;
  /** Nama parameter/field; untuk `changelog` teks perubahan dari oasdiff. */
  readonly name: string;
  /** Baris di file consumer; `null` untuk `changelog` (tidak terikat pada satu call). */
  readonly line: number | null;
}

export interface Specs {
  readonly base: Record<string, unknown>;
  readonly head: Record<string, unknown>;
}

const unquote = (literal: string): string => /^(["'`])(.*)\1$/s.exec(literal)?.[2] ?? literal;

// Integer boleh dikirim ke field number, kebalikannya tidak.
const accepts = (headType: string, sentType: string): boolean =>
  headType === sentType || (headType === 'number' && sentType === 'integer');

/**
 * Delapan aturan matriks severity (CC-045) untuk satu pemakaian consumer, dibandingkan dengan
 * operasi yang sama di spec base dan head. Hanya properti tingkat atas yang dibandingkan. Dilewati
 * (tanpa finding) bila operasinya tidak ada di salah satu spec, bila `literal`/`type` bernilai
 * `null` (dinamis), dan bila `body_fields` kosong untuk aturan `required_added` (isi body tidak
 * terbaca, bukan berarti kosong). Keyakinan rendah tidak pernah `break`: diturunkan jadi `warn`.
 */
export function callFindings(
  call: ApiCall,
  endpoint: Pick<ChangedEndpoint, 'method' | 'path'>,
  { base, head }: Specs,
): SeverityFinding[] {
  const before = readOperation(base, endpoint);
  const after = readOperation(head, endpoint);
  if (!before || !after) return [];

  const found: SeverityFinding[] = [];
  const add = (
    kind: SeverityFinding['kind'],
    severity: Severity,
    source: FindingSource,
    name: string,
    line = call.line,
  ) => found.push({ kind, severity, source, name, line });

  for (const name of call.query_params) {
    if (before.query.has(name) && !after.query.has(name))
      add('removed', 'break', 'query_params', name);
  }

  for (const field of call.body_fields) {
    const current = after.body.get(field.name);
    if (!current) {
      if (before.body.has(field.name)) add('removed', 'break', 'body_fields', field.name);
      else add('param_mismatch', 'warn', 'body_fields', field.name);
      continue;
    }
    if (
      field.literal !== null &&
      current.enum &&
      !current.enum.some((value) => String(value) === unquote(field.literal as string))
    ) {
      add('param_mismatch', 'break', 'literal', field.name);
    }
    if (field.type !== null && current.type !== undefined && !accepts(current.type, field.type)) {
      add('type_changed', 'break', 'type', field.name);
    }
  }

  if (call.body_fields.length > 0) {
    const sent = new Set(call.body_fields.map((field) => field.name));
    for (const [name, property] of after.body) {
      if (property.required && !before.body.get(name)?.required && !sent.has(name)) {
        add('required_added', 'break', 'body_fields', name);
      }
    }
  }

  for (const { name, line } of call.response_fields_read) {
    const was = before.response.get(name);
    const now = after.response.get(name);
    if (!was) continue;
    if (!now) add('removed', 'break', 'response_fields_read', name, line);
    else if (was.type !== undefined && now.type !== undefined && was.type !== now.type) {
      add('type_changed', 'warn', 'response_fields_read', name, line);
    }
  }

  if (call.confidence !== 'low') return found;
  return found.map((finding) =>
    finding.severity === 'break' ? { ...finding, severity: 'warn' } : finding,
  );
}

/**
 * Baris terakhir matriks: perubahan tingkat `info` di changelog (tipe melebar, parameter opsional
 * baru) menjadi satu finding per entri per endpoint, tidak digandakan per call. Pemanggil hanya
 * memanggilnya untuk endpoint yang punya minimal satu call cocok.
 */
export function changelogFindings(endpoint: Pick<ChangedEndpoint, 'changes'>): SeverityFinding[] {
  return endpoint.changes
    .filter((change) => change.level === 'info')
    .map((change): SeverityFinding => ({
      kind: 'type_changed',
      severity: 'info',
      source: 'changelog',
      name: change.text,
      line: null,
    }));
}
