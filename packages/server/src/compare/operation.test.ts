import { describe, expect, it } from 'vitest';
import { readOperation } from './operation.js';

const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const target = { method: 'GET', path: '/orders' };

describe('readOperation', () => {
  it('membaca query, body, dan response dari spec tanpa $ref', () => {
    const spec = {
      paths: {
        '/orders': {
          get: {
            parameters: [{ name: 'limit', in: 'query' }],
            requestBody: json({
              type: 'object',
              required: ['sku'],
              properties: { sku: { type: 'string' }, status: { type: 'string', enum: ['a', 'b'] } },
            }),
            responses: {
              '200': json({ type: 'object', properties: { total: { type: 'integer' } } }),
            },
          },
        },
      },
    };

    const facts = readOperation(spec, target);

    expect([...(facts?.query ?? [])]).toEqual(['limit']);
    expect([...(facts?.body ?? [])]).toEqual([
      ['sku', { type: 'string', required: true }],
      ['status', { type: 'string', enum: ['a', 'b'], required: false }],
    ]);
    expect([...(facts?.response ?? [])]).toEqual([['total', { type: 'integer', required: false }]]);
  });

  it('mengikuti $ref ke parameter, requestBody, skema, dan response', () => {
    const spec = {
      paths: {
        '/orders': {
          get: {
            parameters: [{ $ref: '#/components/parameters/Page' }],
            requestBody: { $ref: '#/components/requestBodies/Create' },
            responses: { '200': { $ref: '#/components/responses/List' } },
          },
        },
      },
      components: {
        parameters: { Page: { name: 'page', in: 'query' } },
        requestBodies: { Create: json({ $ref: '#/components/schemas/Create' }) },
        responses: { List: json({ $ref: '#/components/schemas/List' }) },
        schemas: {
          Create: { properties: { note: { $ref: '#/components/schemas/Note' } } },
          Note: { type: 'string' },
          List: { properties: { total: { type: 'integer' } } },
        },
      },
    };

    const facts = readOperation(spec, target);

    expect([...(facts?.query ?? [])]).toEqual(['page']);
    expect(facts?.body.get('note')?.type).toBe('string');
    expect(facts?.response.get('total')?.type).toBe('integer');
  });

  it('menggabung parameter tingkat path dan memakai nama $ref yang di-escape', () => {
    const spec = {
      paths: {
        '/orders': {
          parameters: [
            { name: 'tenant', in: 'query' },
            { name: 'id', in: 'path' },
          ],
          get: { parameters: [{ name: 'page', in: 'query' }], responses: {} },
        },
      },
    };

    expect([...(readOperation(spec, target)?.query ?? [])]).toEqual(['tenant', 'page']);
    expect(
      readOperation(
        {
          paths: { '/orders': { get: { requestBody: { $ref: '#/a~1b' } } } },
          'a/b': json({ properties: { x: {} } }),
        },
        target,
      )?.body.has('x'),
    ).toBe(true);
  });

  it('membuka array satu tingkat dan hanya membaca respons 2xx berformat JSON', () => {
    const spec = {
      paths: {
        '/orders': {
          get: {
            responses: {
              '200': json({ type: 'array', items: { properties: { id: { type: 'integer' } } } }),
              '201': { content: { 'text/plain': { schema: { properties: { teks: {} } } } } },
              '404': json({ properties: { detail: { type: 'string' } } }),
            },
          },
        },
      },
    };

    expect([...(readOperation(spec, target)?.response.keys() ?? [])]).toEqual(['id']);
  });

  it('operasi atau path tidak ada → undefined', () => {
    const spec = { paths: { '/orders': { post: { responses: {} } } } };

    expect(readOperation(spec, target)).toBeUndefined();
    expect(readOperation(spec, { method: 'POST', path: '/lain' })).toBeUndefined();
    expect(readOperation({}, target)).toBeUndefined();
  });

  it('$ref berputar atau eksternal tidak menggantung dan dianggap kosong', () => {
    const spec = {
      paths: {
        '/orders': {
          get: {
            requestBody: json({ $ref: '#/components/schemas/A' }),
            responses: { '200': json({ $ref: 'https://contoh.test/skema.json' }) },
          },
        },
      },
      components: {
        schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } },
      },
    };

    const facts = readOperation(spec, target);

    expect(facts?.body.size).toBe(0);
    expect(facts?.response.size).toBe(0);
  });

  it('type non-string (OpenAPI 3.1) dibaca sebagai tidak jelas', () => {
    const spec = {
      paths: {
        '/orders': {
          get: { responses: { '200': json({ properties: { n: { type: ['string', 'null'] } } }) } },
        },
      },
    };

    expect(readOperation(spec, target)?.response.get('n')).toEqual({ required: false });
  });
});
