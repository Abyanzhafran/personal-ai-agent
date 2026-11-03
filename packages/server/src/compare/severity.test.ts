import { KINDS } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import type { OasdiffChange } from '../diff/oasdiff.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { callFindings, changelogFindings, type SeverityFinding } from './severity.js';

type Schema = Record<string, unknown>;

interface Shape {
  readonly query?: readonly string[];
  readonly body?: Record<string, Schema>;
  readonly required?: readonly string[];
  readonly response?: Record<string, Schema>;
}

const endpoint = { method: 'POST', path: '/orders' };

// Satu operasi POST /orders: query, body JSON (dengan daftar required), dan respons 200.
const spec = ({ query = [], body, required = [], response = {} }: Shape = {}) => ({
  paths: {
    '/orders': {
      post: {
        parameters: query.map((name) => ({ name, in: 'query' })),
        ...(body && {
          requestBody: {
            content: { 'application/json': { schema: { required, properties: body } } },
          },
        }),
        responses: {
          '200': { content: { 'application/json': { schema: { properties: response } } } },
        },
      },
    },
  },
});

const call = (over: Partial<ApiCall> = {}): ApiCall => ({
  method: 'POST',
  path: '/orders',
  file: 'src/api/orders.ts',
  line: 7,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
  ...over,
});

type BodyField = ApiCall['body_fields'][number];

const field = (name: string, over: Partial<BodyField> = {}): BodyField => ({
  name,
  literal: null,
  type: null,
  ...over,
});

const run = (base: Shape, head: Shape, over: Partial<ApiCall>) =>
  callFindings(call(over), endpoint, { base: spec(base), head: spec(head) });

interface Row {
  readonly title: string;
  readonly base: Shape;
  readonly head: Shape;
  readonly call: Partial<ApiCall>;
  readonly expected: SeverityFinding;
}

// Satu baris per aturan matriks di dokumen Arsitektur; `kind` dan `severity` persis seperti di sana.
const MATRIX: readonly Row[] = [
  {
    title: 'parameter query yang dikirim tidak ada lagi di head',
    base: { query: ['page_size'] },
    head: { query: ['limit'] },
    call: { query_params: ['page_size'] },
    expected: {
      kind: 'removed',
      severity: 'break',
      source: 'query_params',
      name: 'page_size',
      line: 7,
    },
  },
  {
    title: 'field body yang dikirim tidak ada lagi di head',
    base: { body: { note: { type: 'string' } } },
    head: { body: {} },
    call: { body_fields: [field('note')] },
    expected: { kind: 'removed', severity: 'break', source: 'body_fields', name: 'note', line: 7 },
  },
  {
    title: 'field request required baru tidak dikirim',
    base: { body: { qty: { type: 'integer' }, sku: { type: 'string' } }, required: ['qty'] },
    head: { body: { qty: { type: 'integer' }, sku: { type: 'string' } }, required: ['qty', 'sku'] },
    call: { body_fields: [field('qty')] },
    expected: {
      kind: 'required_added',
      severity: 'break',
      source: 'body_fields',
      name: 'sku',
      line: 7,
    },
  },
  {
    title: 'nilai literal tidak ada di enum head',
    base: { body: { currency: { type: 'string', enum: ['IDR', 'USD'] } } },
    head: { body: { currency: { type: 'string', enum: ['IDR'] } } },
    call: { body_fields: [field('currency', { literal: '"USD"' })] },
    expected: {
      kind: 'param_mismatch',
      severity: 'break',
      source: 'literal',
      name: 'currency',
      line: 7,
    },
  },
  {
    title: 'tipe yang dikirim tidak cocok dengan head',
    base: { body: { qty: { type: 'integer' } } },
    head: { body: { qty: { type: 'integer' } } },
    call: { body_fields: [field('qty', { type: 'string' })] },
    expected: { kind: 'type_changed', severity: 'break', source: 'type', name: 'qty', line: 7 },
  },
  {
    title: 'field response yang dibaca dihapus',
    base: { response: { total: { type: 'integer' } } },
    head: { response: {} },
    call: { response_fields_read: [{ name: 'total', line: 12 }] },
    expected: {
      kind: 'removed',
      severity: 'break',
      source: 'response_fields_read',
      name: 'total',
      line: 12,
    },
  },
  {
    title: 'tipe field response yang dibaca berubah',
    base: { response: { total: { type: 'integer' } } },
    head: { response: { total: { type: 'string' } } },
    call: { response_fields_read: [{ name: 'total', line: 12 }] },
    expected: {
      kind: 'type_changed',
      severity: 'warn',
      source: 'response_fields_read',
      name: 'total',
      line: 12,
    },
  },
  {
    title: 'consumer mengirim field yang tidak ada di head',
    base: { body: { qty: { type: 'integer' } } },
    head: { body: { qty: { type: 'integer' } } },
    call: { body_fields: [field('coupon')] },
    expected: {
      kind: 'param_mismatch',
      severity: 'warn',
      source: 'body_fields',
      name: 'coupon',
      line: 7,
    },
  },
];

describe('callFindings: matriks severity', () => {
  it.each(MATRIX)('$title → $expected.kind / $expected.severity', (row) => {
    expect(run(row.base, row.head, row.call)).toEqual([row.expected]);
  });
});

describe('changelogFindings: baris changelog', () => {
  const change = (level: OasdiffChange['level'], text: string): OasdiffChange => ({
    id: 'x',
    text,
    level,
  });

  it('tiap entri info → type_changed / info, tanpa baris; level lain diabaikan', () => {
    const changes = [
      change('info', 'parameter opsional ditambahkan'),
      change('warn', 'abaikan'),
      change('error', 'abaikan juga'),
      change('info', 'tipe melebar'),
    ];

    expect(changelogFindings({ changes })).toEqual([
      {
        kind: 'type_changed',
        severity: 'info',
        source: 'changelog',
        name: 'parameter opsional ditambahkan',
        line: null,
      },
      {
        kind: 'type_changed',
        severity: 'info',
        source: 'changelog',
        name: 'tipe melebar',
        line: null,
      },
    ]);
    expect(changelogFindings({ changes: [] })).toEqual([]);
  });
});

describe('keyakinan', () => {
  const removed = {
    base: { body: { note: {} } },
    head: { body: {} },
    call: { body_fields: [field('note')] },
  };

  it('removed + keyakinan sedang (hop 2) tetap break', () => {
    const [finding] = run(removed.base, removed.head, { ...removed.call, confidence: 'medium' });
    expect(finding).toMatchObject({ kind: 'removed', severity: 'break' });
  });

  it('removed + keyakinan rendah turun menjadi warn', () => {
    const [finding] = run(removed.base, removed.head, { ...removed.call, confidence: 'low' });
    expect(finding).toMatchObject({ kind: 'removed', severity: 'warn' });
  });

  it('keyakinan rendah tidak pernah break pada aturan mana pun', () => {
    for (const row of MATRIX) {
      const findings = run(row.base, row.head, { ...row.call, confidence: 'low' });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).not.toBe('break');
      expect(findings[0]?.kind).toBe(row.expected.kind);
    }
  });
});

describe('renamed bukan kind (keputusan #5)', () => {
  it('rename page_size → limit tampil sebagai removed, bukan renamed', () => {
    const findings = run(
      { query: ['page_size'] },
      { query: ['limit'] },
      { query_params: ['page_size'] },
    );

    expect(findings.map((finding) => finding.kind)).toEqual(['removed']);
    for (const row of MATRIX) expect(KINDS).toContain(row.expected.kind);
    expect(KINDS).not.toContain('renamed');
  });
});

describe('yang dilewati', () => {
  it('pemakaian yang masih cocok dengan head → tanpa finding', () => {
    const shape = {
      query: ['limit'],
      body: { qty: { type: 'integer' }, currency: { type: 'string', enum: ['IDR'] } },
      required: ['qty'],
      response: { total: { type: 'integer' } },
    };

    expect(
      run(shape, shape, {
        query_params: ['limit'],
        body_fields: [field('qty', { type: 'integer' }), field('currency', { literal: "'IDR'" })],
        response_fields_read: [{ name: 'total', line: 9 }],
      }),
    ).toEqual([]);
  });

  it('operasi tidak ada di base atau di head → tanpa finding', () => {
    const usage = call({ query_params: ['x'], body_fields: [field('y')] });
    const withOp = spec({ query: ['x'], body: { y: {} } });
    const without = { paths: {} };

    expect(callFindings(usage, endpoint, { base: without, head: withOp })).toEqual([]);
    expect(callFindings(usage, endpoint, { base: withOp, head: without })).toEqual([]);
  });

  it('literal dan type null (dinamis) tidak dibandingkan', () => {
    const shape = {
      body: { qty: { type: 'integer' }, currency: { type: 'string', enum: ['IDR'] } },
    };

    expect(run(shape, shape, { body_fields: [field('qty'), field('currency')] })).toEqual([]);
  });

  it('literal angka dibandingkan sebagai teks dengan nilai enum', () => {
    const shape = { body: { level: { enum: [1, 2] } } };

    expect(run(shape, shape, { body_fields: [field('level', { literal: '2' })] })).toEqual([]);
    expect(run(shape, shape, { body_fields: [field('level', { literal: '3' })] })).toHaveLength(1);
  });

  it('integer boleh dikirim ke field number, number ke field integer tidak', () => {
    const number = { body: { qty: { type: 'number' } } };
    const integer = { body: { qty: { type: 'integer' } } };

    expect(run(number, number, { body_fields: [field('qty', { type: 'integer' })] })).toEqual([]);
    expect(run(integer, integer, { body_fields: [field('qty', { type: 'number' })] })).toHaveLength(
      1,
    );
  });

  it('required_added: tidak dinilai bila body_fields kosong atau sudah required di base', () => {
    const body = { sku: { type: 'string' } };

    expect(run({ body }, { body, required: ['sku'] }, {})).toEqual([]);
    expect(
      run(
        { body, required: ['sku'] },
        { body, required: ['sku'] },
        { body_fields: [field('qty')] },
      ),
    ).toEqual([expect.objectContaining({ kind: 'param_mismatch', name: 'qty' })]);
  });

  it('parameter query yang tak pernah ada di spec manapun tidak menjadi finding', () => {
    expect(run({ query: ['a'] }, { query: ['a'] }, { query_params: ['b'] })).toEqual([]);
  });
});
