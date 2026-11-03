import { describe, expect, it } from 'vitest';
import { CheckSummary, CreateCheckRequest } from './checks.js';
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

describe('CreateCheckRequest', () => {
  it('base_ref kosong atau tidak dikirim berarti tidak diisi; head_ref di-trim', () => {
    expect(CreateCheckRequest.parse({ provider_repo_id: 3, head_ref: ' feature/xyz ' })).toEqual({
      provider_repo_id: 3,
      head_ref: 'feature/xyz',
    });
    expect(
      CreateCheckRequest.parse({ provider_repo_id: 3, head_ref: 'v1.2.0', base_ref: '  ' }),
    ).toEqual({ provider_repo_id: 3, head_ref: 'v1.2.0', base_ref: undefined });
    expect(
      CreateCheckRequest.parse({ provider_repo_id: 3, head_ref: 'abc1234', base_ref: 'release' })
        .base_ref,
    ).toBe('release');
  });

  it.each<[string, unknown, string]>([
    ['repo provider hilang', { head_ref: 'x' }, 'Repo provider wajib dipilih'],
    [
      'repo provider bukan bilangan bulat',
      { provider_repo_id: 1.5, head_ref: 'x' },
      'Repo provider tidak valid',
    ],
    ['head_ref kosong', { provider_repo_id: 1, head_ref: '  ' }, 'Ref head wajib diisi'],
    ['head_ref hilang', { provider_repo_id: 1 }, 'Ref head wajib diisi'],
    ['bukan objek', 'x', 'Body harus berupa objek JSON'],
  ])('menolak %s dengan pesan Indonesia', (_name, body, message) => {
    const result = CreateCheckRequest.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
