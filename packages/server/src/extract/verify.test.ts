import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixtures } from '../../../../fixtures/make-fixtures.js';
import { splitLines, type ApiCall } from '../llm/extraction.prompt.js';
import type { Extraction } from './runner.js';
import { verifyExtraction } from './verify.js';

// Berkas nyata dari repo fixture mfe-dashboard (src/api/orders.ts):
//   41: http.get('/orders', {
//   42:   params: { page_size: p.size, status: p.status },
//   45: export const getOrder = (id: string) => http.get(`/orders/${id}`);
let tmp: string;
let content: string;
let total: number;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-extract-verify-'));
  const set = await makeFixtures(path.join(tmp, 'fixtures'));
  content = await fs.readFile(
    path.join(set.repos['mfe-dashboard'].path, 'src/api/orders.ts'),
    'utf8',
  );
  total = splitLines(content).length;
}, 120_000);

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Nomor baris (mulai 1) pertama yang memuat `needle`; gagal bila fixture berubah. */
function lineOf(needle: string): number {
  const index = splitLines(content).findIndex((l) => l.includes(needle));
  if (index < 0) throw new Error(`fixture tidak memuat '${needle}'`);
  return index + 1;
}

const call = (over: Partial<ApiCall>): ApiCall => ({
  method: 'GET',
  path: '/orders',
  file: 'src/api/orders.ts',
  line: 1,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
  ...over,
});

const extraction = (calls: ApiCall[], over: Partial<Extraction> = {}): Extraction => ({
  calls,
  truncated: false,
  total_lines: total,
  sent_lines: total,
  ...over,
});

const confidences = (e: Extraction) => e.calls.map((c) => c.confidence);

describe('verifyExtraction', () => {
  it('lolos: segmen statis path ada di baris panggilan, keyakinan tidak berubah', () => {
    const result = verifyExtraction(
      extraction([
        call({ path: '/orders/${id}', line: lineOf('getOrder') }),
        call({ path: '/orders', line: lineOf("http.get('/orders'"), confidence: 'medium' }),
      ]),
      content,
    );
    expect(confidences(result)).toEqual(['high', 'medium']);
  });

  it('URL absolut dengan parameter: yang dicocokkan segmen statis, bukan awalan host', () => {
    const result = verifyExtraction(
      extraction([
        call({ path: 'http://localhost:8080/orders/:id?x=1', line: lineOf('getOrder') }),
      ]),
      content,
    );
    expect(confidences(result)).toEqual(['high']);
  });

  it('lolos lewat nama field walau path tidak ada di baris itu', () => {
    const result = verifyExtraction(
      extraction([
        call({ path: '/payments', query_params: ['page_size'], line: lineOf('page_size') }),
      ]),
      content,
    );
    expect(confidences(result)).toEqual(['high']);
  });

  it('baris di luar jangkauan file: keyakinan low, panggilan tidak dibuang', () => {
    const result = verifyExtraction(extraction([call({ line: total + 10 })]), content);
    expect(result.calls).toHaveLength(1);
    expect(confidences(result)).toEqual(['low']);
  });

  it('nama field yang hanya muncul di baris lain tidak lolos', () => {
    // page_size ada di berkas (baris 42), tetapi bukan di baris getOrder yang diklaim.
    const result = verifyExtraction(
      extraction([
        call({ path: '/payments', query_params: ['page_size'], line: lineOf('getOrder') }),
      ]),
      content,
    );
    expect(confidences(result)).toEqual(['low']);
  });

  it('turun ke low dari high maupun medium; yang sudah low tetap low', () => {
    const line = lineOf('getOrder');
    const result = verifyExtraction(
      extraction(
        (['high', 'medium', 'low'] as const).map((confidence) =>
          call({ path: '/payments', line, confidence }),
        ),
      ),
      content,
    );
    expect(confidences(result)).toEqual(['low', 'low', 'low']);
  });

  it('tanpa bahan pembanding (path tanpa segmen statis, tanpa field) tidak lolos', () => {
    const result = verifyExtraction(
      extraction([call({ path: '${BASE_URL}', line: lineOf("http.get('/orders'") })]),
      content,
    );
    expect(confidences(result)).toEqual(['low']);
  });

  it('berkas dipotong: baris di atas sent_lines di luar jangkauan walau barisnya ada', () => {
    const line = lineOf('getOrder');
    const calls = [call({ path: '/orders/${id}', line })];
    expect(confidences(verifyExtraction(extraction(calls, { sent_lines: line }), content))).toEqual(
      ['high'],
    );
    expect(
      confidences(
        verifyExtraction(extraction(calls, { sent_lines: line - 1, truncated: true }), content),
      ),
    ).toEqual(['low']);
  });

  it('akhir baris CRLF tidak menggeser nomor baris', () => {
    const result = verifyExtraction(
      extraction([call({ path: '/orders/${id}', line: lineOf('getOrder') })]),
      content.replace(/\n/g, '\r\n'),
    );
    expect(confidences(result)).toEqual(['high']);
  });

  it('hop 2: baris yang memuat simbol pembungkus lolos, selain itu tetap low (D-42)', () => {
    const hop2 = 'const rows = await useOrders();\n';
    const calls = [call({ path: '/orders', line: 1 })];

    expect(confidences(verifyExtraction(extraction(calls, { sent_lines: 1 }), hop2))).toEqual([
      'low',
    ]);
    expect(
      confidences(verifyExtraction(extraction(calls, { sent_lines: 1 }), hop2, ['useOrders'])),
    ).toEqual(['high']);
    expect(
      confidences(verifyExtraction(extraction(calls, { sent_lines: 1 }), hop2, ['listAll'])),
    ).toEqual(['low']);
  });

  it('hop 2: simbol tidak menolong baris di luar sent_lines', () => {
    const hop2 = 'x\nconst rows = await useOrders();\n';
    const calls = [call({ path: '/orders', line: 2 })];

    expect(
      confidences(verifyExtraction(extraction(calls, { sent_lines: 1 }), hop2, ['useOrders'])),
    ).toEqual(['low']);
  });

  it('tidak mengubah masukan dan hanya keyakinan yang berubah', () => {
    const original = extraction([call({ path: '/payments', line: lineOf('getOrder') })]);
    const result = verifyExtraction(original, content);

    expect(original.calls[0]?.confidence).toBe('high');
    expect(result.calls[0]).toEqual({ ...original.calls[0], confidence: 'low' });
    expect({ ...result, calls: [] }).toEqual({ ...original, calls: [] });
  });
});
