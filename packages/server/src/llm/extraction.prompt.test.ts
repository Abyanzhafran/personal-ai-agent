import { describe, expect, it } from 'vitest';

import {
  buildExtractionPrompt,
  EXTRACTION_PROMPT_VERSION,
  ExtractionOutput,
  MAX_EXTRACT_FILE_CHARS,
  type ExtractionInput,
} from './extraction.prompt.js';

const call = {
  method: 'GET',
  path: '/api/orders/${id}',
  file: 'src/api/orders.ts',
  line: 12,
  query_params: ['status'],
  body_fields: [{ name: 'currency', literal: '"IDR"', type: 'string' }],
  response_fields_read: [{ name: 'total', line: 20 }],
  confidence: 'high',
  wrapper_symbols: ['listOrders'],
};

const input = (over: Partial<ExtractionInput> = {}): ExtractionInput => ({
  path: 'src/api/orders.ts',
  content: 'import axios from "axios";\nexport const a = 1;\n',
  profile: 'Aplikasi React; axios.',
  endpoints: [
    { method: 'GET', path: '/orders', operationId: 'listOrders' },
    { method: 'POST', path: '/orders/{order_id}/cancel', operationId: null },
  ],
  ...over,
});

describe('ExtractionOutput', () => {
  it('keluaran lengkap lolos; tanpa pemanggilan juga lolos', () => {
    expect(ExtractionOutput.safeParse({ calls: [call] }).success).toBe(true);
    expect(ExtractionOutput.safeParse({ calls: [] }).success).toBe(true);
  });

  it('literal dan type boleh null (nilai dinamis)', () => {
    const dynamic = { ...call, body_fields: [{ name: 'x', literal: null, type: null }] };
    expect(ExtractionOutput.safeParse({ calls: [dynamic] }).success).toBe(true);
  });

  it.each([
    ['tanpa line', { ...call, line: undefined }],
    ['line berupa string', { ...call, line: '12' }],
    ['line null', { ...call, line: null }],
    ['line 0', { ...call, line: 0 }],
    ['line pecahan', { ...call, line: 1.5 }],
    [
      'line bacaan field bukan angka',
      { ...call, response_fields_read: [{ name: 'total', line: 'x' }] },
    ],
    ['line bacaan field hilang', { ...call, response_fields_read: [{ name: 'total' }] }],
    ['literal string kosong', { ...call, body_fields: [{ name: 'x', literal: '', type: null }] }],
    ['literal hilang', { ...call, body_fields: [{ name: 'x', type: null }] }],
    ['type di luar enum', { ...call, body_fields: [{ name: 'x', literal: null, type: 'float' }] }],
    ['confidence di luar enum', { ...call, confidence: 'sangat' }],
    ['wrapper_symbols hilang', { ...call, wrapper_symbols: undefined }],
  ])('menolak %s', (_nama, bad) => {
    expect(ExtractionOutput.safeParse({ calls: [bad] }).success).toBe(false);
  });

  it('menolak keluaran tanpa kunci calls atau berupa array telanjang', () => {
    expect(ExtractionOutput.safeParse({}).success).toBe(false);
    expect(ExtractionOutput.safeParse([call]).success).toBe(false);
  });
});

describe('buildExtractionPrompt', () => {
  it('versi = hash teks prompt: 12 hex, stabil untuk file dan repo mana pun', () => {
    expect(EXTRACTION_PROMPT_VERSION).toMatch(/^[0-9a-f]{12}$/);
    const { prompt } = buildExtractionPrompt(input());
    expect(prompt.version).toBe(EXTRACTION_PROMPT_VERSION);
    expect(
      buildExtractionPrompt(input({ path: 'x.go', content: 'package x' })).prompt.version,
    ).toBe(EXTRACTION_PROMPT_VERSION);
  });

  it('meminta semua pemanggilan API di file, bukan hanya endpoint yang berubah', () => {
    const { system } = buildExtractionPrompt(input()).prompt;
    expect(system).toContain('Report every HTTP API call found in the file');
    expect(system).toContain('not only calls to the endpoints in the list');
  });

  it('memberi nomor di depan tiap baris; CRLF dan newline akhir tidak menambah baris', () => {
    const result = buildExtractionPrompt(input({ content: 'a\r\nb\r\nc\r\n' }));
    expect(result.prompt.user).toContain('=== FILE ===\n1: a\n2: b\n3: c\n=== END FILE ===');
    expect(result.total_lines).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('memuat profil, daftar endpoint sebagai konteks, dan path file', () => {
    const { user } = buildExtractionPrompt(input()).prompt;
    expect(user).toContain('Repository profile:\nAplikasi React; axios.');
    expect(user).toContain('- GET /orders (listOrders)\n- POST /orders/{order_id}/cancel\n');
    expect(user).toContain('File: src/api/orders.ts');
    expect(buildExtractionPrompt(input({ endpoints: [] })).prompt.user).toContain(
      'context only):\n(none)',
    );
  });

  it('teks seperti {path} di dalam profil atau isi file tidak diganti', () => {
    const { user } = buildExtractionPrompt(
      input({ profile: 'pakai {content}', content: 'const t = "{path} {profile}";' }),
    ).prompt;
    expect(user).toContain('pakai {content}');
    expect(user).toContain('1: const t = "{path} {profile}";');
  });

  describe('pemotongan', () => {
    const line = (n: number) => `${String(n).padStart(4, '0')}:${'x'.repeat(95)}`; // 100 karakter
    const file = (lines: number) => Array.from({ length: lines }, (_, i) => line(i)).join('\n');

    it('tepat di batas tidak dipotong; lebih satu karakter membuang baris terakhir', () => {
      const first = 'a'.repeat(10_000);
      const exact = buildExtractionPrompt(
        input({ content: `${first}\n${'b'.repeat(MAX_EXTRACT_FILE_CHARS - first.length - 1)}` }),
      );
      expect(exact).toMatchObject({ truncated: false, sent_lines: 2, total_lines: 2 });
      expect(exact.prompt.user).not.toContain('[file truncated');

      const over = buildExtractionPrompt(
        input({ content: `${first}\n${'b'.repeat(MAX_EXTRACT_FILE_CHARS - first.length)}` }),
      );
      expect(over).toMatchObject({ truncated: true, sent_lines: 1, total_lines: 2 });
    });

    it('melewati batas: dipotong di akhir baris penuh, ditandai di hasil dan di prompt', () => {
      const total = 300;
      const result = buildExtractionPrompt(input({ content: file(total) }));

      expect(result.truncated).toBe(true);
      expect(result.total_lines).toBe(total);
      expect(result.sent_lines).toBeLessThan(total);
      expect(result.sent_lines).toBeGreaterThan(0);

      const { user } = result.prompt;
      // Baris terakhir yang terkirim utuh; baris berikutnya tidak ada sama sekali.
      const lastSent = result.sent_lines;
      expect(user).toContain(`${lastSent}: ${line(lastSent - 1)}\n`);
      expect(user).not.toContain(`${lastSent + 1}: `);
      expect(user).toContain(
        `[file truncated: only lines 1-${lastSent} of ${total} are shown]\n=== END FILE ===`,
      );
    });

    it('isi yang terkirim tidak melebihi batas karakter', () => {
      const { user } = buildExtractionPrompt(input({ content: file(500) })).prompt;
      const body = user.slice(
        user.indexOf('=== FILE ===\n') + 13,
        user.indexOf('\n[file truncated'),
      );
      const raw = body.split('\n').map((row) => row.slice(row.indexOf(': ') + 2));
      expect(raw.join('\n').length).toBeLessThanOrEqual(MAX_EXTRACT_FILE_CHARS);
    });

    it('satu baris yang melewati batas: tidak ada isi terkirim, tetap ditandai dipotong', () => {
      const result = buildExtractionPrompt(
        input({ content: 'x'.repeat(MAX_EXTRACT_FILE_CHARS + 1) }),
      );
      expect(result.sent_lines).toBe(0);
      expect(result.truncated).toBe(true);
      expect(result.prompt.user).toContain('[file truncated: only lines 1-0 of 1 are shown]');
    });
  });
});
