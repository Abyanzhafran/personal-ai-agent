import { describe, expect, it } from 'vitest';
import { orderServiceSpec } from '../../../../fixtures/specs.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { matchedFields } from './fields.js';

const specs = {
  base: orderServiceSpec('base') as Record<string, unknown>,
  head: orderServiceSpec('head') as Record<string, unknown>,
};

const call = (over: Partial<ApiCall>): ApiCall => ({
  method: 'GET',
  path: '/orders',
  file: 'src/api/orders.ts',
  line: 40,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
  ...over,
});

const read = (name: string) => ({ name, line: 41 });
const get = { method: 'GET', path: '/orders' };

describe('matchedFields', () => {
  it('GET /orders fixture → status dan items; page_size dan total jadi finding', () => {
    const usage = call({
      query_params: ['page_size', 'status'],
      response_fields_read: [read('items'), read('total')],
    });

    expect(matchedFields([usage], get, specs)).toEqual(['status', 'items']);
  });

  it('field yang jadi finding tidak ikut: tipe body salah, literal di luar enum, field tak dikenal', () => {
    const post = { method: 'POST', path: '/orders' };
    const usage = call({
      method: 'POST',
      body_fields: [
        { name: 'customer_id', literal: null, type: 'string' },
        { name: 'items', literal: null, type: 'string' },
        { name: 'note', literal: '"x"', type: 'string' },
      ],
    });

    expect(matchedFields([usage], post, specs)).toEqual(['customer_id']);
  });

  it('finding di body tidak menyembunyikan nama yang sama di query', () => {
    const post = { method: 'POST', path: '/orders' };
    const spec = {
      paths: {
        '/orders': { post: { parameters: [{ name: 'status', in: 'query' }], responses: {} } },
      },
    };
    const usage = call({
      method: 'POST',
      query_params: ['status'],
      body_fields: [{ name: 'status', literal: null, type: null }],
    });

    expect(matchedFields([usage], post, { base: spec, head: spec })).toEqual(['status']);
  });

  it('beberapa pemakaian digabung tanpa duplikat', () => {
    const first = call({ query_params: ['status'], response_fields_read: [read('items')] });
    const second = call({
      line: 90,
      query_params: ['status', 'limit'],
      response_fields_read: [read('items'), read('total')],
    });

    expect(matchedFields([first, second], get, specs)).toEqual(['status', 'items', 'limit']);
  });

  it('operasi tidak ada di head → kosong', () => {
    const cancel = { method: 'POST', path: '/orders/{order_id}/cancel' };

    expect(matchedFields([call({ method: 'POST' })], cancel, specs)).toEqual([]);
  });

  it('tanpa pemakaian → kosong', () => {
    expect(matchedFields([], get, specs)).toEqual([]);
  });
});
