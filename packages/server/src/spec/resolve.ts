import { parse as parseYaml } from 'yaml';
import type { GitAdapter } from '../git/adapter.js';
import { PathNotFoundError } from '../git/errors.js';
import { SpecMissing, SpecParseError } from './errors.js';

/** Spec yang sudah terbaca beserta asalnya. */
export interface ResolvedSpec {
  readonly document: Record<string, unknown>;
  /** Dibaca langsung dari git, tanpa menjalankan `spec_cmd`. */
  readonly source: 'committed';
  readonly sha: string;
  readonly path: string;
}

interface ResolveInput {
  /** Folder repo di disk user. */
  readonly repo: string;
  readonly sha: string;
  /** `repos.spec_path`, relatif terhadap akar repo. */
  readonly specPath: string;
}

const firstLine = (text: string) => text.split('\n')[0] ?? text;

/**
 * Mem-parse isi spec. `.json` dibaca sebagai JSON; selain itu sebagai YAML, yang juga menerima
 * JSON. Melempar `SpecParseError` bila rusak atau akar bukan objek.
 */
export function parseSpecDocument(
  raw: string,
  sha: string,
  specPath: string,
): Record<string, unknown> {
  // Editor Windows kerap menyimpan BOM; JSON.parse menolaknya.
  const text = raw.replace(/^\uFEFF/, '');
  let document: unknown;
  try {
    document = specPath.toLowerCase().endsWith('.json')
      ? JSON.parse(text)
      : parseYaml(text, { logLevel: 'error' });
  } catch (error) {
    throw new SpecParseError(
      sha,
      specPath,
      firstLine(error instanceof Error ? error.message : String(error)),
    );
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new SpecParseError(sha, specPath, 'akar dokumen harus berupa objek');
  }
  return document as Record<string, unknown>;
}

/**
 * Membaca spec yang ter-commit (`git show <sha>:<spec_path>`) dan mem-parse-nya.
 * Galat bertipe: `SpecMissing` (tidak ada di ref), `SpecParseError` (rusak atau akar bukan objek).
 * Galat git lain (mis. sha tidak dikenal) merambat apa adanya.
 */
export async function resolveCommittedSpec(
  git: Pick<GitAdapter, 'show'>,
  { repo, sha, specPath }: ResolveInput,
): Promise<ResolvedSpec> {
  let raw: string;
  try {
    raw = await git.show(repo, sha, specPath);
  } catch (error) {
    if (error instanceof PathNotFoundError) throw new SpecMissing(sha, specPath);
    throw error;
  }
  return {
    document: parseSpecDocument(raw, sha, specPath),
    source: 'committed',
    sha,
    path: specPath,
  };
}
