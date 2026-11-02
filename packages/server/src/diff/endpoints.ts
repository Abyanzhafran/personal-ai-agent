import type { Severity } from '@cc/shared';
import type { OasdiffChange } from './oasdiff.js';

/** Satu endpoint yang berubah beserta semua perubahan di dalamnya. */
export interface ChangedEndpoint {
  readonly method: string;
  readonly path: string;
  /** Nama parameter path dibuang (`/orders/{order_id}` → `/orders/{}`), slash akhir dibuang. */
  readonly normalized_path: string;
  /** Dari spec base; bila tidak ada di sana (mis. endpoint baru) dari changelog, selain itu `null`. */
  readonly operationId: string | null;
  readonly changes: readonly OasdiffChange[];
  readonly max_level: Severity;
}

type Level = OasdiffChange['level'];

// Urutan naik; level oasdiff dipetakan ke kosakata domain (D-35): error → break.
const LEVELS: readonly Level[] = ['info', 'warn', 'error'];
const SEVERITY: Record<Level, Severity> = { info: 'info', warn: 'warn', error: 'break' };

export const normalizePath = (path: string): string =>
  path.replace(/\{[^}]*\}/g, '{}').replace(/(.)\/+$/, '$1');

function baseOperationId(baseSpec: Record<string, unknown>, path: string, method: string) {
  const paths = baseSpec['paths'] as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const operation = paths?.[path]?.[method.toLowerCase()] as { operationId?: unknown } | undefined;
  return typeof operation?.operationId === 'string' ? operation.operationId : undefined;
}

/**
 * Mengelompokkan changelog oasdiff per endpoint `(method, path)`, urutan kemunculan pertama.
 * Perubahan tanpa `path` atau `operation` (komponen bersama) tidak punya endpoint dan dilewati.
 * Level `info` ikut masuk (keputusan #4).
 */
export function buildEndpoints(
  changes: readonly OasdiffChange[],
  { baseSpec }: { readonly baseSpec: Record<string, unknown> },
): ChangedEndpoint[] {
  const groups = new Map<string, { method: string; path: string; changes: OasdiffChange[] }>();
  for (const change of changes) {
    if (change.path === undefined || change.operation === undefined) continue;
    const key = `${change.operation} ${change.path}`;
    const group = groups.get(key) ?? { method: change.operation, path: change.path, changes: [] };
    group.changes.push(change);
    groups.set(key, group);
  }

  return [...groups.values()].map(({ method, path, changes }) => {
    const highest = Math.max(...changes.map((change) => LEVELS.indexOf(change.level)));
    return {
      method,
      path,
      normalized_path: normalizePath(path),
      operationId:
        baseOperationId(baseSpec, path, method) ??
        changes.find((change) => change.operationId !== undefined)?.operationId ??
        null,
      changes,
      max_level: SEVERITY[LEVELS[highest] as Level],
    };
  });
}
