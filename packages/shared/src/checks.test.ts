import { describe, expect, it } from 'vitest';
import { CheckSummary } from './checks.js';
import { SEVERITIES } from './domain.js';

const valid = {
  counts: { break: 5, warn: 1, info: 2 },
  files_checked: 12,
  files_via_hop2: 1,
  endpoints_without_consumer: ['GET /orders/{id}/cancel'],
  consumer_shas: { 'mfe-dashboard': 'a'.repeat(40) },
  matched_fields: { 'GET /orders': ['status', 'total'] },
  incomplete: false,
  skipped_files: 0,
  tool_versions: { oasdiff: '1.11.0', node: 'v24.1.0' },
  spec_unpinned: true,
  fetch_errors: [{ repo: 'svc-payment', message: 'origin tidak terjangkau' }],
};

describe('CheckSummary', () => {
  it('bentuk lengkap lolos tanpa berubah; map dan daftar boleh kosong', () => {
    expect(CheckSummary.parse(valid)).toEqual(valid);
    const empty = {
      ...valid,
      endpoints_without_consumer: [],
      consumer_shas: {},
      matched_fields: {},
      tool_versions: {},
      fetch_errors: [],
    };
    expect(CheckSummary.parse(empty)).toEqual(empty);
  });

  it('kunci counts sama dengan SEVERITIES', () => {
    expect(Object.keys(CheckSummary.shape.counts.shape)).toEqual([...SEVERITIES]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['count negatif', { counts: { break: -1, warn: 0, info: 0 } }],
    ['count bukan bilangan bulat', { files_checked: 1.5 }],
    ['count severity hilang', { counts: { break: 1, warn: 0 } }],
    ['incomplete bukan boolean', { incomplete: 'ya' }],
    ['matched_fields bukan daftar', { matched_fields: { 'GET /x': 'status' } }],
    ['fetch_errors tanpa pesan', { fetch_errors: [{ repo: 'x' }] }],
    ['tool_versions bukan string', { tool_versions: { node: 24 } }],
  ])('menolak %s', (_name, override) => {
    expect(CheckSummary.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it.each(Object.keys(valid))('menolak bila %s hilang', (key) => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest[key];
    expect(CheckSummary.safeParse(rest).success).toBe(false);
  });
});
