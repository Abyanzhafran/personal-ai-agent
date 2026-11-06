import { describe, expect, it } from 'vitest';
import { buildCopyText, type CopyTextFinding, type CopyTextInput } from './copytext.js';

const sha = (prefix: string) => prefix.padEnd(40, '0');

const mfe = 'microfrontend-dashboard';
const payment = 'svc-payment';

const finding = (extra: Partial<CopyTextFinding>): CopyTextFinding => ({
  endpoint: 'GET /orders',
  location: { repo: mfe, file: 'src/api/orders.ts', line: 42 },
  kind: 'removed',
  severity: 'break',
  detail: 'detail',
  confidence: 'high',
  via_symbol: null,
  ...extra,
});

const summary: CopyTextInput['summary'] = {
  counts: { break: 3, warn: 2, info: 1 },
  files_checked: 12,
  files_via_hop2: 1,
  endpoints_without_consumer: ['POST /orders/{param}/cancel'],
  consumer_shas: {
    [mfe]: sha('7c4d2e1'),
    [payment]: sha('3b9a0f8'),
    'svc-inventory': sha('e5f6a7b'),
  },
  matched_fields: {},
  incomplete: false,
  skipped_files: 0,
  tool_versions: {},
  spec_unpinned: false,
  fetch_errors: [],
};

const report = (extra: Partial<CopyTextInput> = {}): CopyTextInput => ({
  id: 128,
  provider: 'svc-order',
  base_ref: 'main',
  head_ref: 'feature/xyz',
  base_sha: sha('a1b2c3d'),
  head_sha: sha('9f8e7d6'),
  summary,
  findings: [],
  ...extra,
});

/** Laporan #128 di mockup, sengaja tidak berurutan supaya pengurutan ikut terbukti. */
const findings128: CopyTextFinding[] = [
  finding({
    endpoint: 'GET /orders/{param}',
    location: { repo: mfe, file: 'src/components/OrderLines.tsx', line: 18 },
    kind: 'type_changed',
    severity: 'info',
    detail:
      'Field response quantity melebar dari integer ke number; kompatibel dengan cara consumer membacanya.',
  }),
  finding({
    endpoint: 'POST /orders',
    location: { repo: payment, file: 'internal/clients/order_client.go', line: 66 },
    kind: 'param_mismatch',
    severity: 'warn',
    detail: 'Consumer mengirim note yang tidak ada di spec head; provider akan mengabaikannya.',
  }),
  finding({
    location: { repo: mfe, file: 'src/pages/OrdersPage.tsx', line: 88 },
    detail: 'Field response total dihapus di feature/xyz, tapi consumer masih membacanya.',
    via_symbol: 'useOrders',
  }),
  finding({
    endpoint: 'GET /orders/{param}',
    location: { repo: mfe, file: 'src/components/OrderSummary.tsx', line: 31 },
    kind: 'type_changed',
    severity: 'warn',
    detail:
      'Field response grand_total berubah tipe number → string; consumer memformatnya sebagai angka.',
    confidence: 'low',
  }),
  finding({
    detail:
      'Consumer mengirim query page_size, yang sudah dihapus dari provider (head). Kemungkinan diganti limit (saran heuristik, bukan hasil diff).',
  }),
  finding({
    endpoint: 'POST /orders',
    location: { repo: payment, file: 'internal/clients/order_client.go', line: 63 },
    kind: 'required_added',
    detail:
      'Field request currency kini required, tapi consumer tidak mengirimnya; request akan ditolak.',
    confidence: 'medium',
  }),
];

describe('buildCopyText', () => {
  it('laporan #128 (6 finding + 1 endpoint tanpa consumer) cocok dengan golden', async () => {
    await expect(buildCopyText(report({ findings: findings128 }))).toMatchFileSnapshot(
      './__snapshots__/copytext-128.txt',
    );
  });

  it('laporan bersih: teks pendek tanpa bagian finding', () => {
    const text = buildCopyText(
      report({
        id: 129,
        head_ref: 'feature/abc',
        head_sha: sha('1a2b3c4'),
        summary: {
          ...summary,
          counts: { break: 0, warn: 0, info: 0 },
          endpoints_without_consumer: [],
        },
      }),
    );

    expect(text).toBe(
      [
        'Contract Check #129 · svc-order',
        'Base: main (merge-base a1b2c3d)',
        'Head: feature/abc @ 1a2b3c4',
        '',
        'Bersih: tidak ada dampak ke consumer.',
        '12 file diperiksa di 3 repo (1 via hop 2)',
        '',
        'Consumer (default branch): microfrontend-dashboard @ 7c4d2e1, svc-payment @ 3b9a0f8, svc-inventory @ e5f6a7b',
      ].join('\n'),
    );
  });

  it('memuat base, head, merge-base, dan catatan bila laporan tidak lengkap', () => {
    const text = buildCopyText(
      report({
        summary: {
          ...summary,
          incomplete: true,
          skipped_files: 5,
          spec_unpinned: true,
          fetch_errors: [{ repo: 'svc-inventory', message: 'origin tidak terjangkau' }],
        },
        findings: findings128,
      }),
    );

    expect(text).toContain('Base: main (merge-base a1b2c3d)');
    expect(text).toContain('Head: feature/xyz @ 9f8e7d6');
    expect(text).toContain(
      'Catatan: laporan tidak lengkap, 5 file consumer dilewati karena batas jumlah file.',
    );
    expect(text).toContain('Catatan: fetch gagal untuk svc-inventory (origin tidak terjangkau).');
    expect(text).toContain('Catatan: spec provider dibuat tanpa lockfile ter-commit.');
  });

  it('finding tingkat provider (spec_stale) tampil tanpa lokasi dan keyakinan', () => {
    const text = buildCopyText(
      report({
        findings: [
          finding({
            endpoint: 'spec',
            location: null,
            kind: 'spec_stale',
            severity: 'warn',
            detail: 'Spec di head tidak sama dengan hasil generate.',
            confidence: null,
          }),
        ],
      }),
    );

    expect(text).toContain(
      'spec\n- WARN spec_stale\n  Spec di head tidak sama dengan hasil generate.',
    );
  });

  it('finding sama berat dalam satu endpoint diurutkan menurut repo, file, lalu baris', () => {
    const at = (repo: string, file: string, line: number) =>
      finding({ location: { repo, file, line }, confidence: null });
    const text = buildCopyText(
      report({
        findings: [
          at('b-repo', 'x.ts', 5),
          at('a-repo', 'z.ts', 1),
          at('a-repo', 'y.ts', 9),
          at('a-repo', 'y.ts', 2),
        ],
      }),
    );

    expect(text.split('\n').filter((line) => line.startsWith('- BREAK'))).toEqual([
      '- BREAK removed — a-repo y.ts:2',
      '- BREAK removed — a-repo y.ts:9',
      '- BREAK removed — a-repo z.ts:1',
      '- BREAK removed — b-repo x.ts:5',
    ]);
  });

  it('finding tanpa lokasi sama berat: urutan masukan dipertahankan', () => {
    const stale = (detail: string) =>
      finding({
        endpoint: 'spec',
        location: null,
        kind: 'spec_stale',
        severity: 'warn',
        detail,
        confidence: null,
      });
    const text = buildCopyText(report({ findings: [stale('pertama'), stale('kedua')] }));

    expect(text).toContain('spec\n- WARN spec_stale\n  pertama\n- WARN spec_stale\n  kedua');
  });

  it('tanpa endpoint tanpa consumer dan tanpa repo: baris dan blok itu tidak ada', () => {
    const text = buildCopyText(
      report({
        summary: { ...summary, endpoints_without_consumer: [], consumer_shas: {} },
        findings: findings128,
      }),
    );

    expect(text).toContain('3 break · 2 warn · 1 info\n12 file diperiksa di 0 repo (1 via hop 2)');
    expect(text).not.toContain('Tanpa consumer');
    expect(text).not.toContain('Consumer (default branch)');
  });
});
