import { describe, expect, it } from 'vitest';
import { normalizePath } from '../diff/endpoints.js';
import { normalizeUsagePath } from './normalize.js';

describe('normalizeUsagePath', () => {
  it.each([
    ['/api/v1/orders/${id}', '/api/v1/orders/{}'],
    ['/orders/:id', '/orders/{}'],
    ['/orders/{orderId}', '/orders/{}'],
    ['/orders/${order.id}/items/${itemId}', '/orders/{}/items/{}'],
    ['/orders/', '/orders'],
    ['orders/${id}', '/orders/{}'],
    ['/orders-${kind}/stats', '/{}/stats'],
    ['/orders?status=open&page=${page}', '/orders'],
    ['/orders/${id}#detail', '/orders/{}'],
    ['  /orders  ', '/orders'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUsagePath(input)).toBe(expected);
  });

  it('hasilnya sama dengan normalized_path spec untuk path yang sama', () => {
    for (const spec of ['/orders/{order_id}', '/orders/{order_id}/cancel', '/orders']) {
      expect(normalizeUsagePath(spec)).toBe(normalizePath(spec));
    }
  });

  describe('base URL dibuang', () => {
    it.each([
      ['${import.meta.env.VITE_API_BASE_URL}/orders/${id}', '/orders/{}'],
      ['${API_URL}/orders', '/orders'],
      ['${process.env.API ?? `${x}`}/orders', '/orders'],
      ['${base}${prefix}/orders', '/orders'],
      ['https://api.example.com/v1/orders/:id?x=1', '/v1/orders/{}'],
      ['http://localhost:8000/orders/', '/orders'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeUsagePath(input)).toBe(expected);
    });

    it.each([
      ['/api/v1', '/api/v1/orders/${id}', '/orders/{}'],
      ['http://localhost:8000', 'http://localhost:8000/orders', '/orders'],
      ['${config.baseUrl}', '${config.baseUrl}/orders/:id', '/orders/{}'],
      ['BASE_URL', 'BASE_URL/orders', '/orders'],
      [' /api ', '/api/orders', '/orders'],
    ])('base_url_pattern %j membuang awalan %j', (pattern, input, expected) => {
      expect(normalizeUsagePath(input, pattern)).toBe(expected);
    });

    it('pattern kosong atau null tidak mengubah apa pun; pattern yang tidak diawali diabaikan', () => {
      expect(normalizeUsagePath('/api/orders', '')).toBe('/api/orders');
      expect(normalizeUsagePath('/api/orders', null)).toBe('/api/orders');
      expect(normalizeUsagePath('/api/orders', '/v2')).toBe('/api/orders');
    });
  });

  it.each([
    ['${url}'],
    ['/${a}/${b}'],
    ['${base}/${resource}'],
    ['/:a/:b'],
    ['/'],
    [''],
    ['   '],
    ['?x=1'],
    ['${base'], // ekspresi tidak seimbang: tidak ada segmen statis yang bisa dipercaya
  ])('%j tidak bisa dinormalisasi → undefined', (input) => {
    expect(normalizeUsagePath(input)).toBeUndefined();
  });
});
