import { isDeepStrictEqual } from 'node:util';
import type { Repo, RepoProfileResponse } from '@cc/shared';
import type { GitAdapter } from '../git/adapter.js';
import type { Logger } from '../logger.js';
import { generateSpecCached, type SpecCacheDeps } from './cache.js';
import { resolveCommittedSpec } from './resolve.js';

/** Finding tingkat provider: baris `findings` dengan `endpoint` = 'spec', tanpa consumer. */
export interface SpecStaleFinding {
  readonly kind: 'spec_stale';
  readonly severity: 'warn';
  readonly endpoint: 'spec';
  readonly detail: string;
}

export interface SpecStaleDeps extends SpecCacheDeps {
  readonly git: Pick<GitAdapter, 'worktreeAdd' | 'worktreeRemove' | 'show' | 'diffNameOnly'>;
  readonly logger: Pick<Logger, 'info'>;
}

export interface SpecStaleInput {
  readonly checkId: number;
  readonly repo: Pick<Repo, 'id' | 'name' | 'local_path' | 'spec_path' | 'spec_cmd'>;
  readonly baseSha: string;
  readonly headSha: string;
  /** `discovery.profile(repo)`; `handler_dirs` hanya dipakai bila statusnya `approved`. */
  readonly profile: Pick<RepoProfileResponse, 'status' | 'profile'>;
  readonly signal?: AbortSignal;
}

const finding = (detail: string): SpecStaleFinding => ({
  kind: 'spec_stale',
  severity: 'warn',
  endpoint: 'spec',
  detail,
});

/** `./app/routers/` → `app/routers`; pemisah Windows disamakan. */
const normalizeDir = (dir: string) =>
  dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * Mendeteksi spec provider yang tidak ikut diperbarui. Dua jalur:
 * - ada `spec_cmd`: spec hasil generate di head dibandingkan dengan yang ter-commit di head
 *   (deep-equal setelah parse, jadi urutan kunci dan indentasi tidak berpengaruh; nilai default
 *   tidak diisi);
 * - tanpa `spec_cmd`: `base...head` menyentuh `handler_dirs` tetapi tidak menyentuh `spec_path`.
 * Mengembalikan `null` bila spec segar atau deteksi dilewati (dicatat di log). Galat generate,
 * spec hilang, atau rusak merambat (`SpecGenError`, `SpecMissing`, `SpecParseError`).
 */
export async function detectSpecStale(
  deps: SpecStaleDeps,
  { checkId, repo, baseSha, headSha, profile, signal }: SpecStaleInput,
): Promise<SpecStaleFinding | null> {
  const { git, logger } = deps;
  const { spec_path: specPath, spec_cmd: specCmd } = repo;
  const handlerDirs =
    profile.status === 'approved' ? (profile.profile?.handler_dirs ?? []).map(normalizeDir) : [];

  const skip = (reason: string) => {
    logger.info({ repo: repo.name, reason }, 'deteksi spec_stale dilewati');
    return null;
  };
  if (specPath === null) return skip('spec_path belum diisi');

  if (specCmd !== null) {
    const generated = await generateSpecCached(deps, {
      repoId: repo.id,
      checkId,
      repo: repo.local_path,
      sha: headSha,
      specPath,
      specCmd,
      ...(signal === undefined ? {} : { signal }),
    });
    const committed = await resolveCommittedSpec(git, {
      repo: repo.local_path,
      sha: headSha,
      specPath,
    });
    return isDeepStrictEqual(generated.document, committed.document)
      ? null
      : finding(
          `${specPath} yang ter-commit berbeda dari hasil spec_cmd di ${headSha.slice(0, 7)}`,
        );
  }

  if (handlerDirs.length === 0) return skip('tanpa spec_cmd dan tanpa handler_dirs yang disetujui');

  const changed = await git.diffNameOnly(repo.local_path, baseSha, headSha);
  const touchesHandlers = changed.some((file) =>
    handlerDirs.some((dir) => file === dir || file.startsWith(`${dir}/`)),
  );
  return touchesHandlers && !changed.includes(specPath)
    ? finding(`Kode di handler_dirs berubah, tetapi ${specPath} tidak ikut diubah`)
    : null;
}
