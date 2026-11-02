import { describe, expect, it } from 'vitest';

import { normalizePath, type ChangedEndpoint } from '../diff/endpoints.js';
import type { ConsumerCandidate, EndpointCandidates } from './grep.js';
import { limitCandidates } from './limit.js';

const candidate = (repo: string, path: string, match_count: number): ConsumerCandidate => ({
  repo,
  path,
  blob_sha: `blob:${repo}:${path}`,
  match_count,
});

const entry = (p: string, candidates: ConsumerCandidate[]): EndpointCandidates => ({
  endpoint: {
    method: 'GET',
    path: p,
    normalized_path: normalizePath(p),
    operationId: null,
    changes: [],
    max_level: 'break',
  } satisfies ChangedEndpoint,
  candidates,
});

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => candidate('mfe', `f/${String(i).padStart(3, '0')}.ts`, 1));
const ids = (files: readonly ConsumerCandidate[]) => files.map((f) => `${f.repo}:${f.path}`);

describe('limitCandidates', () => {
  it('lebih dari batas → tepat 40 diproses, incomplete, skipped_files = sisanya', () => {
    const result = limitCandidates([entry('/a', many(45))], 40);

    expect(result.files).toHaveLength(40);
    expect(result.skipped_files).toBe(5);
    expect(result.incomplete).toBe(true);
  });

  it.each([40, 12, 0])('%i kandidat dengan batas 40 → semua diproses, tidak incomplete', (n) => {
    const result = limitCandidates([entry('/a', many(n))], 40);

    expect(result.files).toHaveLength(n);
    expect(result.skipped_files).toBe(0);
    expect(result.incomplete).toBe(false);
  });

  it('yang dipilih adalah match_count terbanyak; sisanya dilewati', () => {
    const result = limitCandidates(
      [entry('/a', [candidate('r', 'a', 1), candidate('r', 'b', 9), candidate('r', 'c', 5)])],
      2,
    );

    expect(ids(result.files)).toEqual(['r:b', 'r:c']);
    expect(result.skipped_files).toBe(1);
  });

  it('seri match_count: urut nama repo lalu path, apa pun urutan masukan', () => {
    const tied = [
      candidate('svc-payment', 'a.go', 2),
      candidate('mfe', 'z.ts', 2),
      candidate('mfe', 'b.ts', 2),
      candidate('mfe', 'a.ts', 2),
    ];
    const expected = ['mfe:a.ts', 'mfe:b.ts', 'mfe:z.ts', 'svc-payment:a.go'];

    expect(ids(limitCandidates([entry('/a', tied)], 40).files)).toEqual(expected);
    expect(ids(limitCandidates([entry('/a', [...tied].reverse())], 40).files)).toEqual(expected);
    // Pemotongan di tengah seri juga deterministik.
    expect(ids(limitCandidates([entry('/a', [...tied].reverse())], 2).files)).toEqual(
      expected.slice(0, 2),
    );
  });

  it('berkas yang sama dari beberapa endpoint dihitung sekali, match_count dijumlah', () => {
    const result = limitCandidates(
      [
        entry('/orders', [candidate('mfe', 'api.ts', 3), candidate('mfe', 'x.ts', 4)]),
        entry('/orders/{id}', [candidate('mfe', 'api.ts', 2)]),
      ],
      40,
    );

    expect(result.files.map((f) => [f.path, f.match_count])).toEqual([
      ['api.ts', 5],
      ['x.ts', 4],
    ]);
    expect(result.skipped_files).toBe(0);
  });

  it('endpoints tidak diubah: kandidat yang terlewati tetap ada, bukan "tanpa consumer"', () => {
    const endpoints = [entry('/a', many(3)), entry('/b', [candidate('mfe', 'f/000.ts', 1)])];
    const before = structuredClone(endpoints);

    limitCandidates(endpoints, 1);

    expect(endpoints).toEqual(before);
  });
});
