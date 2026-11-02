import type { Extraction } from '../extract/runner.js';
import type { GitAdapter } from '../git/adapter.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { mapLimit } from '../util/concurrency.js';
import type { ConsumerCandidate, ConsumerRepo } from './grep.js';
import { limitCandidates, type LimitedCandidates } from './limit.js';

interface Deps {
  readonly git: Pick<GitAdapter, 'revParse' | 'lsTree' | 'grepWord'>;
  /** `GIT_CONCURRENCY`: paling banyak sekian repo di-grep bersamaan. */
  readonly concurrency: number;
}

/** Satu `wrapper_symbols` dari hasil hop 1 beserta panggilan API yang dibungkusnya. */
export interface WrapperSymbol {
  /** Repo tempat simbol ditemukan; hop 2 hanya meng-grep repo ini. */
  readonly repo: string;
  readonly symbol: string;
  readonly method: string;
  readonly path: string;
}

/** Berkas yang memakai simbol pembungkus, bukan memuat kata kunci endpoint seperti hop 1. */
export interface Hop2Candidate extends ConsumerCandidate {
  /** Simbol yang dipakai berkas ini, terurut. */
  readonly symbols: readonly string[];
  /** Bahan `context` prompt ekstraksi: `useOrders calls GET /orders`, terurut dan tanpa duplikat. */
  readonly context: readonly string[];
}

const fileKey = (repo: string, path: string) => `${repo}\0${path}`;

/**
 * Hop 2 (CC-043): berkas di repo yang sama yang memakai simbol pembungkus dari hop 1, dicari dengan
 * `git grep -w` pada SHA `origin/<default>` (seperti hop 1, D-37). Satu hop saja: fungsi ini hanya
 * meng-grep simbol yang diberikan, jadi `wrapper_symbols` dari hasil hop 2 tidak pernah dicari lagi.
 * Pemanggil yang memilih simbol mana yang relevan. Galat git merambat.
 */
export function createSymbolSearch({ git, concurrency }: Deps) {
  async function searchRepo(
    repo: ConsumerRepo,
    wrappers: readonly WrapperSymbol[],
    exclude: ReadonlySet<string>,
  ): Promise<Hop2Candidate[]> {
    const sha = await git.revParse(repo.path, `origin/${repo.defaultBranch}`);
    const found = new Map<string, { symbols: Set<string>; match_count: number }>();
    for (const symbol of new Set(wrappers.map((wrapper) => wrapper.symbol))) {
      for (const match of await git.grepWord(repo.path, sha, symbol)) {
        if (exclude.has(fileKey(repo.name, match.path))) continue;
        const entry = found.get(match.path) ?? { symbols: new Set<string>(), match_count: 0 };
        entry.symbols.add(symbol);
        entry.match_count++;
        found.set(match.path, entry);
      }
    }
    if (found.size === 0) return [];

    const blobs = new Map(
      (await git.lsTree(repo.path, sha)).map((entry) => [entry.path, entry.sha]),
    );
    return [...found].map(([path, { symbols, match_count }]) => ({
      repo: repo.name,
      path,
      blob_sha: blobs.get(path)!,
      match_count,
      symbols: [...symbols].sort(),
      context: [
        ...new Set(
          wrappers
            .filter((wrapper) => symbols.has(wrapper.symbol))
            .map((wrapper) => `${wrapper.symbol} calls ${wrapper.method} ${wrapper.path}`),
        ),
      ].sort(),
    }));
  }

  return {
    /**
     * @param exclude berkas yang sudah diproses hop 1 (tidak diekstrak dua kali)
     * @param max batas berkas hop 2 sendiri, terpisah dari hop 1 (AC kartu: `MAX_FILES_PER_CHECK`)
     */
    async search(input: {
      readonly wrappers: readonly WrapperSymbol[];
      readonly repos: readonly ConsumerRepo[];
      readonly exclude: readonly { readonly repo: string; readonly path: string }[];
      readonly max: number;
    }): Promise<LimitedCandidates<Hop2Candidate>> {
      const exclude = new Set(input.exclude.map((file) => fileKey(file.repo, file.path)));
      const repos = input.repos.filter((repo) =>
        input.wrappers.some((wrapper) => wrapper.repo === repo.name),
      );
      const perRepo = await mapLimit(repos, concurrency, (repo) =>
        searchRepo(
          repo,
          input.wrappers.filter((wrapper) => wrapper.repo === repo.name),
          exclude,
        ),
      );
      return limitCandidates([{ candidates: perRepo.flat() }], input.max);
    },
  };
}

export type ViaSymbolCall = ApiCall & { readonly via_symbol: string };

/**
 * Menandai hasil ekstraksi berkas hop 2: tiap panggilan membawa `via_symbol` (nama simbol yang
 * membawa berkas ini ke hop 2; bila lebih dari satu, digabung dengan `, `) dan keyakinannya paling
 * tinggi `medium` (keputusan #6). Masukan tidak diubah.
 */
export function markViaSymbol(extraction: Extraction, symbols: readonly string[]) {
  const via_symbol = symbols.join(', ');
  return {
    ...extraction,
    calls: extraction.calls.map((call): ViaSymbolCall => ({
      ...call,
      via_symbol,
      confidence: call.confidence === 'high' ? 'medium' : call.confidence,
    })),
  };
}
