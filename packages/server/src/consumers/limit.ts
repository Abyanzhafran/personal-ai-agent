import type { ConsumerCandidate, EndpointCandidates } from './grep.js';

export interface LimitedCandidates {
  /** Berkas unik yang diekstrak, terbanyak cocok dulu. `match_count` = jumlah di semua endpoint. */
  readonly files: readonly ConsumerCandidate[];
  readonly skipped_files: number;
  /** True bila ada berkas yang dilewati (laporan tidak lengkap). */
  readonly incomplete: boolean;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Batas `MAX_FILES_PER_CHECK` untuk hop 1 (CC-038). Berkas yang sama dari beberapa endpoint dihitung
 * sekali. Urutan: `match_count` terbanyak, seri → nama repo lalu path. `endpoints` tidak diubah:
 * endpoint yang kandidatnya terlewati tetap punya kandidat, jadi tidak terbaca "tanpa consumer".
 */
export function limitCandidates(
  endpoints: readonly EndpointCandidates[],
  max: number,
): LimitedCandidates {
  const unique = new Map<string, ConsumerCandidate>();
  for (const { candidates } of endpoints) {
    for (const candidate of candidates) {
      const key = `${candidate.repo}\0${candidate.path}`;
      const seen = unique.get(key);
      unique.set(key, {
        ...candidate,
        match_count: (seen?.match_count ?? 0) + candidate.match_count,
      });
    }
  }

  const sorted = [...unique.values()].sort(
    (a, b) => b.match_count - a.match_count || compare(a.repo, b.repo) || compare(a.path, b.path),
  );
  const files = sorted.slice(0, max);
  const skipped_files = sorted.length - files.length;
  return { files, skipped_files, incomplete: skipped_files > 0 };
}
