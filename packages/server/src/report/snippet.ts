import type { Snippet } from '@cc/shared';
import type { GitAdapter } from '../git/adapter.js';

/** Jumlah baris sebelum dan sesudah baris yang disorot. */
const CONTEXT_LINES = 2;

export interface SnippetInput {
  readonly repo: string;
  /** SHA consumer yang diperiksa check; isi dibaca dari sini, bukan dari working tree. */
  readonly sha: string;
  readonly file: string;
  /** Baris yang disorot, mulai 1. */
  readonly line: number;
  /** Kandidat teks yang ditebalkan (mis. nama field); hanya yang ada di baris itu yang disimpan. */
  readonly tokens: readonly string[];
}

/**
 * Cuplikan awet untuk `findings.snippet_json` (CC-048): dua baris sebelum dan sesudah `line`,
 * dibaca lewat `git show <sha>:<file>` sehingga tidak berubah walau repo consumer berubah
 * kemudian. Baris dipotong di awal/akhir file. `line` di luar file (nomor baris dari LLM bisa
 * salah) → `null`, bukan galat: finding tetap ada tanpa cuplikan. Tab dan isi baris dipertahankan,
 * hanya `\r` akhir baris yang dibuang.
 */
export async function buildSnippet(
  git: Pick<GitAdapter, 'show'>,
  { repo, sha, file, line, tokens }: SnippetInput,
): Promise<Snippet | null> {
  const all = (await git.show(repo, sha, file)).split(/\r?\n/);
  if (all.at(-1) === '') all.pop(); // newline penutup bukan baris tambahan
  if (line < 1 || line > all.length) return null;

  const first = Math.max(1, line - CONTEXT_LINES);
  const last = Math.min(all.length, line + CONTEXT_LINES);
  const lines = all.slice(first - 1, last).map((text, index) => ({ n: first + index, text }));

  const highlighted = all[line - 1] as string;
  const found = [...new Set(tokens)].filter((token) => token !== '' && highlighted.includes(token));
  return { lines, highlight: line, tokens: found };
}
