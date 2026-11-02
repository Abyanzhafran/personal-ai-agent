import type { Role } from '@cc/shared';
import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { GitAdapter } from '../git/adapter.js';
import { mapLimit } from '../util/concurrency.js';

interface Deps {
  readonly git: Pick<GitAdapter, 'revParse' | 'lsTree' | 'grepFixed'>;
  /** `GIT_CONCURRENCY`: paling banyak sekian repo consumer di-grep bersamaan. */
  readonly concurrency: number;
}

export interface ConsumerRepo {
  readonly name: string;
  readonly role: Role;
  /** Folder repo di disk user (`repos.local_path`). */
  readonly path: string;
  readonly defaultBranch: string;
}

/** Satu berkas consumer yang memuat kata kunci endpoint. */
export interface ConsumerCandidate {
  readonly repo: string;
  readonly path: string;
  /** Dari pohon git commit yang di-grep, bukan dari berkas lokal. */
  readonly blob_sha: string;
  /** Jumlah baris yang cocok di berkas itu. */
  readonly match_count: number;
}

export interface EndpointCandidates {
  readonly endpoint: ChangedEndpoint;
  /** Kosong = "tanpa consumer". */
  readonly candidates: readonly ConsumerCandidate[];
}

export interface ConsumerSearch {
  readonly endpoints: readonly EndpointCandidates[];
  /** Commit `origin/<default>` tiap consumer yang di-grep (kunci: nama repo), bahan laporan. */
  readonly consumer_shas: Readonly<Record<string, string>>;
}

/** Segmen path tanpa parameter yang paling panjang; seri → yang pertama. */
export function longestStaticSegment(path: string): string | undefined {
  let best: string | undefined;
  for (const segment of path.split('/')) {
    if (segment === '' || segment.includes('{')) continue;
    if (best === undefined || segment.length > best.length) best = segment;
  }
  return best;
}

/** Kata kunci hop 1: `/<segmen statis terpanjang>` dan `operationId`; kosong bila keduanya tak ada. */
function patternsFor(endpoint: ChangedEndpoint): string[] {
  const segment = longestStaticSegment(endpoint.path);
  return [segment === undefined ? null : `/${segment}`, endpoint.operationId].filter(
    (pattern): pattern is string => pattern !== null,
  );
}

/**
 * Hop 1 (CC-037): berkas consumer yang memuat kata kunci tiap endpoint, hanya dari `origin/<default>`.
 * Repo `e2e` dan provider tidak pernah di-grep. Galat git (mis. ref hilang) merambat: consumer yang
 * dilewati diam-diam akan terbaca sebagai "tanpa consumer".
 */
export function createConsumerGrep({ git, concurrency }: Deps) {
  async function searchRepo(repo: ConsumerRepo, patterns: readonly (readonly string[])[]) {
    const sha = await git.revParse(repo.path, `origin/${repo.defaultBranch}`);
    // Pohon hanya dibaca bila ada kecocokan.
    let blobs: Promise<Map<string, string>> | undefined;
    const blobShas = () =>
      (blobs ??= git
        .lsTree(repo.path, sha)
        .then((entries) => new Map(entries.map((entry) => [entry.path, entry.sha]))));

    const perEndpoint: ConsumerCandidate[][] = [];
    for (const endpointPatterns of patterns) {
      const counts = new Map<string, number>();
      if (endpointPatterns.length > 0) {
        for (const match of await git.grepFixed(repo.path, sha, endpointPatterns)) {
          counts.set(match.path, (counts.get(match.path) ?? 0) + 1);
        }
      }
      const tree = counts.size > 0 ? await blobShas() : new Map<string, string>();
      perEndpoint.push(
        [...counts].map(([path, match_count]) => ({
          repo: repo.name,
          path,
          blob_sha: tree.get(path)!,
          match_count,
        })),
      );
    }
    return { sha, perEndpoint };
  }

  return {
    async search(input: {
      readonly endpoints: readonly ChangedEndpoint[];
      readonly repos: readonly ConsumerRepo[];
      /** Nama repo provider, dikecualikan dari pencarian. */
      readonly provider: string;
    }): Promise<ConsumerSearch> {
      const consumers = input.repos.filter(
        (repo) => repo.role !== 'e2e' && repo.name !== input.provider,
      );
      const patterns = input.endpoints.map(patternsFor);
      const results = await mapLimit(consumers, concurrency, (repo) => searchRepo(repo, patterns));

      return {
        endpoints: input.endpoints.map((endpoint, index) => ({
          endpoint,
          candidates: results.flatMap((result) => result.perEndpoint[index]!),
        })),
        consumer_shas: Object.fromEntries(
          consumers.map((repo, index) => [repo.name, results[index]!.sha]),
        ),
      };
    },
  };
}
