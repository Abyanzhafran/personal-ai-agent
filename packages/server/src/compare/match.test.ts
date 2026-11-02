import { describe, expect, it, vi } from 'vitest';
import { normalizePath, type ChangedEndpoint } from '../diff/endpoints.js';
import { matchCalls } from './match.js';

const endpoint = (method: string, path: string): ChangedEndpoint => ({
  method,
  path,
  normalized_path: normalizePath(path),
  operationId: null,
  changes: [],
  max_level: 'break',
});

const call = (method: string, path: string) => ({ method, path });

const paths = (matches: { endpoint: ChangedEndpoint }[]) => matches.map((m) => m.endpoint.path);

describe('matchCalls', () => {
  const getOrder = endpoint('GET', '/orders/{orderId}');

  it.each([
    ['/api/v1/orders/${id}'],
    ['/orders/:id'],
    ['/orders/{orderId}'],
    ['/orders/${id}/'],
    ['${import.meta.env.VITE_API_BASE_URL}/orders/${id}'],
    ['https://api.example.com/orders/:id?expand=1'],
  ])('%s cocok ke GET /orders/{orderId}', (path) => {
    const [match, ...rest] = matchCalls([call('GET', path)], [getOrder]);
    expect(rest).toHaveLength(0);
    expect(match?.endpoint).toBe(getOrder);
  });

  it('base_url_pattern profil membuang awalan sebelum pencocokan', () => {
    const endpoints = [endpoint('GET', '/orders/{id}'), endpoint('GET', '/v1/orders/{id}')];
    const calls = [call('GET', '/v1/orders/${id}')];

    expect(paths(matchCalls(calls, endpoints))).toEqual(['/v1/orders/{id}']);
    expect(paths(matchCalls(calls, endpoints, { baseUrlPattern: '/v1' }))).toEqual([
      '/orders/{id}',
    ]);
  });

  it('method harus sama, tanpa membedakan huruf besar-kecil', () => {
    expect(matchCalls([call('POST', '/orders/${id}')], [getOrder])).toEqual([]);
    expect(matchCalls([call('get', '/orders/${id}')], [getOrder])).toHaveLength(1);
  });

  it('path dengan jumlah atau bentuk segmen beda tidak cocok; sufiks dijaga di batas segmen', () => {
    expect(matchCalls([call('GET', '/orders')], [getOrder])).toEqual([]);
    expect(matchCalls([call('GET', '/orders/${id}/items')], [getOrder])).toEqual([]);
    expect(matchCalls([call('GET', '/xorders/${id}')], [getOrder])).toEqual([]);
    expect(
      matchCalls([call('GET', '/orders/cancel')], [endpoint('GET', '/orders/{id}/cancel')]),
    ).toEqual([]);
  });

  it('kecocokan persis mengalahkan sufiks; sufiks terpanjang mengalahkan yang lebih pendek', () => {
    const endpoints = [
      endpoint('GET', '/orders/{id}'),
      endpoint('GET', '/v1/orders/{id}'),
      endpoint('GET', '/api/v1/orders/{id}'),
    ];
    const pathsFor = (usage: string) => paths(matchCalls([call('GET', usage)], endpoints));
    expect(pathsFor('/api/v1/orders/${id}')).toEqual(['/api/v1/orders/{id}']);
    expect(pathsFor('/x/v1/orders/${id}')).toEqual(['/v1/orders/{id}']);
    expect(pathsFor('/orders/${id}')).toEqual(['/orders/{id}']);
  });

  it('pemakaian tanpa endpoint yang berubah dibuang diam-diam, bukan dilewati', () => {
    const onSkip = vi.fn();
    const result = matchCalls(
      [call('GET', '/payments/${id}'), call('GET', '/orders/${id}')],
      [getOrder],
      {
        onSkip,
      },
    );
    expect(result.map((m) => m.call.path)).toEqual(['/orders/${id}']);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('path dinamis dilewati dan dilaporkan lewat onSkip; yang lain tetap diproses berurutan', () => {
    const skipped: string[] = [];
    const calls = [
      call('GET', '/orders/${id}'),
      call('GET', '${url}'),
      call('GET', '/${a}/${b}'),
      call('GET', '/api/orders/:id'),
    ];

    const result = matchCalls(calls, [getOrder], { onSkip: (c) => skipped.push(c.path) });

    expect(skipped).toEqual(['${url}', '/${a}/${b}']);
    expect(result.map((m) => m.call)).toEqual([calls[0], calls[3]]);
  });

  it('mempertahankan bentuk pemakaian asal (field lain ikut terbawa)', () => {
    const usage = { ...call('GET', '/orders/${id}'), line: 12, confidence: 'high' as const };
    expect(matchCalls([usage], [getOrder])[0]?.call).toBe(usage);
  });
});
