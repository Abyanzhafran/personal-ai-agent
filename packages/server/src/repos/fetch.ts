import type { RepoFetchResult } from '@cc/shared';
import type { Db } from '../db/database.js';
import type { GitAdapter } from '../git/adapter.js';
import { CommandFailedError } from '../proc/errors.js';
import { mapLimit } from '../util/concurrency.js';
import { createRepoRepository } from './repository.js';

export interface ProjectFetcherDeps {
  readonly db: Db;
  readonly git: Pick<GitAdapter, 'fetchPrune'>;
  /** `GIT_CONCURRENCY`: paling banyak sekian `git fetch` berjalan bersamaan. */
  readonly concurrency: number;
  readonly now?: () => Date;
}

/** Satu baris yang menjelaskan kegagalan; baris `fatal:`/`error:` git lebih informatif daripada baris terakhir. */
function describeFetchError(error: unknown): string {
  if (error instanceof CommandFailedError) {
    const lines = error.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const reason =
      lines.find((line) => /^(fatal|error):/i.test(line)) ??
      lines.at(-1) ??
      `git keluar dengan kode ${error.exitCode}`;
    return `Fetch gagal: ${reason}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch semua repo satu project (CC-015). Dipakai tombol "Fetch sekarang" dan, di CC-065, langkah 1
 * sebuah check. Kegagalan satu repo dikembalikan sebagai hasil, bukan dilempar, supaya repo lain
 * tetap diambil dan pemanggil memutuskan artinya (consumer gagal → lanjut, provider gagal → check gagal).
 */
export function createProjectFetcher({
  db,
  git,
  concurrency,
  now = () => new Date(),
}: ProjectFetcherDeps) {
  const repos = createRepoRepository(db);

  return {
    /** Hasil per repo, urut menurut id repo. `last_fetch_at` hanya diperbarui untuk yang berhasil. */
    fetchProject(projectId: number): Promise<RepoFetchResult[]> {
      return mapLimit(repos.listByProject(projectId), concurrency, async (repo) => {
        try {
          await git.fetchPrune(repo.local_path);
        } catch (error) {
          return {
            repo_id: repo.id,
            name: repo.name,
            ok: false,
            error: describeFetchError(error),
            last_fetch_at: repo.last_fetch_at,
          };
        }
        const at = now().toISOString();
        repos.setLastFetchAt(repo.id, at);
        return { repo_id: repo.id, name: repo.name, ok: true, error: null, last_fetch_at: at };
      });
    },
  };
}

export type ProjectFetcher = ReturnType<typeof createProjectFetcher>;
