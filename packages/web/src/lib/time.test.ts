import { describe, expect, it } from 'vitest';
import { formatAgo, formatClock, formatDuration, formatWhen } from './time';

// Tanggal dibuat dari komponen lokal: format menampilkan jam lokal, jadi test tidak bergantung zona waktu.
const local = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month - 1, day, hour, minute);
const NOW = local(11, 4, 15, 0);

describe('formatWhen', () => {
  it('hari ini, kemarin, dan tanggal lain dengan nama bulan Indonesia', () => {
    expect(formatWhen(local(11, 4, 14, 32).toISOString(), NOW)).toBe('Hari ini, 14:32');
    expect(formatWhen(local(11, 3, 17, 20).toISOString(), NOW)).toBe('Kemarin, 17:20');
    expect(formatWhen(local(10, 25, 9, 14).toISOString(), NOW)).toBe('25 Okt, 09:14');
  });

  it('jam dan menit satu angka diberi nol di depan', () => {
    expect(formatWhen(local(11, 4, 9, 5).toISOString(), NOW)).toBe('Hari ini, 09:05');
  });
});

describe('formatClock', () => {
  it('jam lokal dengan nol di depan; detik hanya bila diminta', () => {
    const iso = new Date(2026, 10, 4, 9, 5, 7).toISOString();
    expect(formatClock(iso)).toBe('09:05');
    expect(formatClock(iso, true)).toBe('09:05:07');
  });
});

describe('formatAgo', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it('belum pernah, baru saja, menit, jam, hari', () => {
    expect(formatAgo(null, NOW)).toBe('Belum pernah');
    expect(formatAgo(ago(30_000), NOW)).toBe('baru saja');
    expect(formatAgo(ago(3 * 60_000), NOW)).toBe('3 menit lalu');
    expect(formatAgo(ago(2 * 3_600_000), NOW)).toBe('2 jam lalu');
    expect(formatAgo(ago(3 * 86_400_000), NOW)).toBe('3 hari lalu');
  });

  it('waktu di masa depan (jam bergeser) dibaca baru saja', () => {
    expect(formatAgo(ago(-5 * 60_000), NOW)).toBe('baru saja');
  });
});

describe('formatDuration', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 4, 0, 0, seconds)).toISOString();

  it('detik, menit plus detik, dan null selama belum selesai', () => {
    expect(formatDuration(at(0), at(48))).toBe('48 dtk');
    expect(formatDuration(at(0), at(65))).toBe('1 mnt 5 dtk');
    expect(formatDuration(at(0), null)).toBeNull();
  });
});
