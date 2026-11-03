import { describe, expect, it } from 'vitest';

import { FIXTURE_CHANGELOG } from '../../../../fixtures/changelog.js';
import { orderServiceSpec } from '../../../../fixtures/specs.js';
import { buildEndpoints, normalizePath } from './endpoints.js';
import type { OasdiffChange } from './oasdiff.js';

const baseSpec = orderServiceSpec('base') as Record<string, unknown>;

const change = (over: Partial<OasdiffChange> & Pick<OasdiffChange, 'id' | 'level'>) =>
  ({ text: over.id, ...over }) satisfies OasdiffChange;

describe('buildEndpoints', () => {
  it('mengelompokkan per (method, path) dengan urutan kemunculan pertama dan level tertinggi', () => {
    const endpoints = buildEndpoints(FIXTURE_CHANGELOG, { baseSpec });

    expect(
      endpoints.map((e) => [e.method, e.path, e.normalized_path, e.changes.length, e.max_level]),
    ).toEqual([
      ['GET', '/orders', '/orders', 3, 'break'],
      ['POST', '/orders', '/orders', 1, 'break'],
      ['GET', '/orders/{order_id}', '/orders/{}', 2, 'break'],
      ['POST', '/orders/{order_id}/cancel', '/orders/{}/cancel', 1, 'break'],
    ]);
  });

  it('endpoint dihapus tetap muncul, operationId dari spec base', () => {
    const endpoints = buildEndpoints(FIXTURE_CHANGELOG, { baseSpec });

    const removed = endpoints.find((e) => e.path === '/orders/{order_id}/cancel');
    expect(removed).toMatchObject({ method: 'POST', operationId: 'cancelOrder' });
    expect(endpoints.map((e) => e.operationId)).toEqual([
      'listOrders',
      'createOrder',
      'getOrder',
      'cancelOrder',
    ]);
  });

  it('spec base didahulukan atas field changelog; tanpa keduanya operationId = null', () => {
    const [fromBase, fromChangelog, none] = buildEndpoints(
      [
        change({ id: 'x', level: 'warn', operation: 'GET', path: '/orders', operationId: 'salah' }),
        change({ id: 'x', level: 'info', operation: 'GET', path: '/baru', operationId: 'getBaru' }),
        change({ id: 'x', level: 'info', operation: 'GET', path: '/tanpa-id' }),
      ],
      { baseSpec },
    );

    expect(fromBase?.operationId).toBe('listOrders');
    expect(fromChangelog?.operationId).toBe('getBaru');
    expect(none?.operationId).toBeNull();
  });

  it('perubahan level info ikut terdaftar, endpoint hanya-info punya max_level info', () => {
    const [endpoint] = buildEndpoints(
      [
        change({
          id: 'new-optional-request-parameter',
          level: 'info',
          operation: 'GET',
          path: '/orders',
        }),
      ],
      { baseSpec },
    );

    expect(endpoint).toMatchObject({ max_level: 'info' });
    expect(endpoint?.changes).toHaveLength(1);
  });

  it.each([
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'break'],
  ] as const)('level oasdiff %s → max_level %s', (level, severity) => {
    const [endpoint] = buildEndpoints([change({ id: 'x', level, operation: 'GET', path: '/a' })], {
      baseSpec,
    });
    expect(endpoint?.max_level).toBe(severity);
  });

  it('perubahan tanpa path atau operation (komponen bersama) dilewati', () => {
    expect(
      buildEndpoints(
        [
          change({ id: 'x', level: 'error' }),
          change({ id: 'x', level: 'error', path: '/orders' }),
          change({ id: 'x', level: 'error', operation: 'GET' }),
        ],
        { baseSpec },
      ),
    ).toEqual([]);
  });

  it('changelog kosong → daftar kosong', () => {
    expect(buildEndpoints([], { baseSpec })).toEqual([]);
  });
});

describe('normalizePath', () => {
  it.each([
    ['/orders', '/orders'],
    ['/orders/{order_id}', '/orders/{}'],
    ['/orders/{id}/items/{item_id}', '/orders/{}/items/{}'],
    ['/orders/', '/orders'],
    ['/', '/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('nama parameter berbeda antar versi spec menghasilkan path yang sama', () => {
    expect(normalizePath('/orders/{id}')).toBe(normalizePath('/orders/{order_id}'));
  });
});
