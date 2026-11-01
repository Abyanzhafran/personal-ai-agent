import { describe, expect, it } from 'vitest';
import {
  ApiErrorEnvelope,
  CHECK_STATUSES,
  CONFIDENCES,
  ERROR_CODES,
  HealthResponse,
  Kind,
  KINDS,
  PROFILE_STATUSES,
  ROLES,
  SEVERITIES,
  ValidationDetails,
} from './index.js';

describe('enum domain (keputusan arsitek)', () => {
  it('kind tidak memuat `renamed`: rename tampil sebagai removed + saran heuristik (keputusan #5)', () => {
    expect(KINDS).not.toContain('renamed');
    expect(Kind.safeParse('renamed').success).toBe(false);
  });

  it('nilai persis sesuai dokumen arsitektur', () => {
    expect([...ROLES]).toEqual(['service', 'microfrontend', 'e2e']);
    expect([...CHECK_STATUSES]).toEqual(['running', 'clean', 'findings', 'failed', 'cancelled']);
    expect([...SEVERITIES]).toEqual(['break', 'warn', 'info']);
    expect([...KINDS]).toEqual([
      'removed',
      'required_added',
      'param_mismatch',
      'type_changed',
      'spec_stale',
    ]);
    expect([...CONFIDENCES]).toEqual(['high', 'medium', 'low']);
  });

  it('`spec_stale` bukan status check: ia finding (badge diturunkan dari findings)', () => {
    expect(CHECK_STATUSES).not.toContain('spec_stale');
    expect(KINDS).toContain('spec_stale');
  });

  it('status profil mencakup lima keadaan di UI Projects', () => {
    expect(PROFILE_STATUSES).toHaveLength(5);
  });
});

describe('kontrak galat', () => {
  it('kode galat unik dan nilainya sama dengan kuncinya', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) expect(value).toBe(key);
  });

  it('amplop galat: code, message, dan details (null bila kosong) wajib ada', () => {
    const ok = { error: { code: 'x', message: 'y', details: null } };
    expect(ApiErrorEnvelope.safeParse(ok).success).toBe(true);
    // `details` selalu dikirim server (null bila tidak ada), jadi klien boleh mengandalkannya.
    expect(ApiErrorEnvelope.safeParse({ error: { code: 'x', message: 'y' } }).success).toBe(false);
    expect(ApiErrorEnvelope.safeParse({ error: { message: 'y', details: null } }).success).toBe(
      false,
    );
    expect(ApiErrorEnvelope.safeParse({ message: 'y' }).success).toBe(false);
  });

  it('detail validasi wajib memuat minimal satu field', () => {
    expect(ValidationDetails.safeParse({ fields: [] }).success).toBe(false);
    expect(
      ValidationDetails.safeParse({ fields: [{ in: 'body', path: 'name', message: 'wajib' }] })
        .success,
    ).toBe(true);
    expect(
      ValidationDetails.safeParse({ fields: [{ in: 'cookie', path: 'a', message: 'b' }] }).success,
    ).toBe(false);
  });

  it('health', () => {
    expect(HealthResponse.safeParse({ ok: true, app: 'Contract Check' }).success).toBe(true);
    expect(HealthResponse.safeParse({ ok: false, app: 'x' }).success).toBe(false);
  });
});
