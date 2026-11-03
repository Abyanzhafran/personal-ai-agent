import type { GitAdapter } from '../git/adapter.js';
import { RefNotFoundError } from '../git/errors.js';
import { CheckFailure } from './errors.js';

const SHA_LIKE = /^[0-9a-f]{7,40}$/i;

/**
 * Ref yang diketik user menjadi SHA commit. Urutan: branch di `origin` (hasil fetch), tag, lalu SHA.
 * Branch lokal sengaja tidak dicoba: fetch tidak memperbaruinya, jadi hasilnya bisa basi.
 */
async function resolveRef(
  git: Pick<GitAdapter, 'revParse'>,
  repo: string,
  ref: string,
): Promise<string> {
  const candidates = [`origin/${ref}`, `refs/tags/${ref}`, ...(SHA_LIKE.test(ref) ? [ref] : [])];
  for (const candidate of candidates) {
    try {
      return await git.revParse(repo, candidate);
    } catch (error) {
      if (!(error instanceof RefNotFoundError)) throw error;
    }
  }
  throw new CheckFailure(
    SHA_LIKE.test(ref) ? `Commit ${ref} tidak ada` : `origin/${ref} tidak ada`,
  );
}

export interface ResolvedRefs {
  readonly baseSha: string;
  readonly headSha: string;
}

/**
 * Langkah 1: `head_sha` dari `head_ref` (branch, tag, atau commit), `base_sha` = merge-base antara
 * `base_ref` dan `head_sha`. Melempar {@link CheckFailure} bila ref tidak ada atau riwayatnya tak berhubungan.
 */
export async function resolveRefs(
  git: Pick<GitAdapter, 'revParse' | 'mergeBase'>,
  repo: string,
  { baseRef, headRef }: { readonly baseRef: string; readonly headRef: string },
): Promise<ResolvedRefs> {
  const headSha = await resolveRef(git, repo, headRef);
  const baseTip = await resolveRef(git, repo, baseRef);
  const baseSha = await git.mergeBase(repo, baseTip, headSha);
  if (baseSha === null) {
    throw new CheckFailure(
      `Riwayat ${baseRef} dan ${headRef} tidak berhubungan: tidak ada leluhur bersama untuk dibandingkan`,
    );
  }
  return { baseSha, headSha };
}
