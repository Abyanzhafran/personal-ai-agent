import { describe, expect, it } from 'vitest';
import { orderServiceSpec } from '../../../../fixtures/specs.js';
import { suggestReplacement } from './suggest.js';
import type { SeverityFinding } from './severity.js';

type Types = Record<string, string | undefined>;

const endpoint = { method: 'GET', path: '/orders' };

// GET /orders dengan parameter query dan body JSON; nilai = tipe (undefined → tipe tidak jelas).
const spec = (query: Types, body: Types = {}) => {
  const schema = (type?: string) => (type === undefined ? {} : { type });
  return {
    paths: {
      '/orders': {
        get: {
          parameters: Object.entries(query).map(([name, type]) => ({
            name,
            in: 'query',
            schema: schema(type),
          })),
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  properties: Object.fromEntries(
                    Object.entries(body).map(([name, type]) => [name, schema(type)]),
                  ),
                },
              },
            },
          },
          responses: {},
        },
      },
    },
  };
};

const removed = (
  name: string,
  source: SeverityFinding['source'] = 'query_params',
  kind: SeverityFinding['kind'] = 'removed',
) => ({ kind, source, name });

const suggest = (finding: ReturnType<typeof removed>, base: object, head: object) =>
  suggestReplacement(finding, endpoint, {
    base: base as Record<string, unknown>,
    head: head as Record<string, unknown>,
  });

describe('suggestReplacement', () => {
  it('fixture: page_size dihapus dan limit ditambahkan → kemungkinan diganti limit', () => {
    const specs = {
      base: orderServiceSpec('base') as Record<string, unknown>,
      head: orderServiceSpec('head') as Record<string, unknown>,
    };

    const text = suggestReplacement(removed('page_size'), endpoint, specs);

    expect(text).toMatch(/^Kemungkinan diganti limit /);
  });

  it('kalimat selalu menyebut heuristik, bukan hasil diff', () => {
    const texts = [
      suggest(removed('page_size'), spec({ page_size: 'integer' }), spec({ limit: 'integer' })),
      suggest(
        removed('qty', 'body_fields'),
        spec({}, { qty: 'integer' }),
        spec({}, { quantity: 'integer' }),
      ),
    ];

    for (const text of texts) {
      expect(text).toContain('saran heuristik');
      expect(text).toContain('bukan hasil diff');
    }
  });

  it('tanpa kandidat → null, bukan teks kosong', () => {
    const base = spec({ page_size: 'integer', status: 'string' });

    expect(suggest(removed('page_size'), base, spec({ status: 'string' }))).toBeNull();
    // Parameter baru ada, tetapi tipenya beda.
    expect(
      suggest(removed('page_size'), base, spec({ status: 'string', limit: 'string' })),
    ).toBeNull();
    // Kandidat harus baru: `status` sudah ada di base.
    expect(
      suggest(
        removed('page_size'),
        spec({ page_size: 'integer', n: 'integer' }),
        spec({ n: 'integer' }),
      ),
    ).toBeNull();
  });

  it('beberapa kandidat: yang namanya paling banyak berbagi kata menang', () => {
    const base = spec({ page_size: 'integer' });
    const head = spec({ limit: 'integer', pageSize: 'integer' });

    expect(suggest(removed('page_size'), base, head)).toContain('pageSize');
  });

  it('beberapa kandidat tanpa kesamaan nama, atau seri → null', () => {
    const base = spec({ page_size: 'integer' });

    expect(
      suggest(removed('page_size'), base, spec({ limit: 'integer', offset: 'integer' })),
    ).toBeNull();
    expect(
      suggest(removed('page_size'), base, spec({ page_a: 'integer', size_b: 'integer' })),
    ).toBeNull();
  });

  it('field body disaran dari field body, bukan dari query', () => {
    const base = spec({}, { qty: 'integer' });

    expect(
      suggest(
        removed('qty', 'body_fields'),
        base,
        spec({ jumlah: 'integer' }, { count: 'integer' }),
      ),
    ).toContain('count');
    expect(suggest(removed('qty', 'body_fields'), base, spec({ jumlah: 'integer' }))).toBeNull();
  });

  it('di luar cakupan → null: bukan removed, field response, atau tipe asal tidak jelas', () => {
    const base = spec({ page_size: 'integer', x: undefined });
    const head = spec({ limit: 'integer', y: undefined });

    expect(suggest(removed('page_size', 'query_params', 'type_changed'), base, head)).toBeNull();
    expect(suggest(removed('page_size', 'response_fields_read'), base, head)).toBeNull();
    expect(suggest(removed('x'), base, head)).toBeNull();
  });

  it('operasi tidak ada di salah satu spec → null', () => {
    const base = spec({ page_size: 'integer' });

    expect(suggest(removed('page_size'), base, { paths: {} })).toBeNull();
    expect(suggest(removed('page_size'), { paths: {} }, spec({ limit: 'integer' }))).toBeNull();
  });
});
