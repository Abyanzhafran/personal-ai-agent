// Changelog oasdiff untuk spec fixture (`orderServiceSpec('base')` -> `('head')`).

export interface FixtureChange {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
  operation: string;
  path: string;
  operationId?: string;
}

const change = (
  id: string,
  level: FixtureChange['level'],
  operation: string,
  path: string,
  operationId?: string,
): FixtureChange => ({
  id,
  text: id,
  level,
  operation,
  path,
  ...(operationId === undefined ? {} : { operationId }),
});

/**
 * Changelog BUATAN TANGAN untuk tujuh kasus fixture CC-090 (oasdiff belum terpasang, D-35/D-36):
 * bentuk field dari sumber oasdiff, tetapi `id` dan `level` bukan keluaran sungguhan. Cukup untuk
 * membuktikan pengelompokan dan perakitan pipeline, bukan angka "5 breaking di 3 endpoint" (G-6).
 */
export const FIXTURE_CHANGELOG: readonly FixtureChange[] = [
  change('request-parameter-removed', 'warn', 'GET', '/orders', 'listOrders'),
  change('response-required-property-removed', 'error', 'GET', '/orders', 'listOrders'),
  change('new-optional-request-parameter', 'info', 'GET', '/orders', 'listOrders'),
  change('new-required-request-property', 'error', 'POST', '/orders'),
  change('response-property-type-changed', 'error', 'GET', '/orders/{order_id}'),
  change('response-property-type-changed', 'info', 'GET', '/orders/{order_id}'),
  // Endpoint dihapus: entri tanpa operationId, jadi nilainya harus datang dari spec base.
  change('api-removed-without-deprecation', 'error', 'POST', '/orders/{order_id}/cancel'),
];
