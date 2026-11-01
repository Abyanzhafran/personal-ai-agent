import { describe, expect, it } from 'vitest';
import {
  CreateProjectRequest,
  PROJECT_NAME_MAX,
  ProjectIdParams,
  UpdateProjectRequest,
} from './projects.js';

/** Pesan semua isian yang salah; kosong bila input sah. */
const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('CreateProjectRequest', () => {
  it('nama di-trim; spasi di ujung tidak ikut tersimpan', () => {
    expect(CreateProjectRequest.parse({ name: '  Order Service  ' })).toEqual({
      name: 'Order Service',
    });
  });

  it('batas 60 karakter dihitung setelah trim: 60 lolos, 61 ditolak', () => {
    expect(CreateProjectRequest.safeParse({ name: 'a'.repeat(PROJECT_NAME_MAX) }).success).toBe(
      true,
    );
    expect(
      CreateProjectRequest.safeParse({ name: ` ${'a'.repeat(PROJECT_NAME_MAX)} ` }).success,
    ).toBe(true);
    const tooLong = CreateProjectRequest.safeParse({ name: 'a'.repeat(PROJECT_NAME_MAX + 1) });
    expect(tooLong.success).toBe(false);
    expect(messages(tooLong)).toEqual(['Nama project maksimal 60 karakter']);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: null }, { name: 7 }])(
    'nama %j ditolak dengan pesan "wajib diisi"',
    (body) => {
      expect(messages(CreateProjectRequest.safeParse(body))).toEqual(['Nama project wajib diisi']);
    },
  );

  it('body bukan objek ditolak dengan pesan Indonesia', () => {
    for (const body of [undefined, null, 'teks', 3]) {
      expect(messages(CreateProjectRequest.safeParse(body))).toEqual([
        'Body harus berupa objek JSON',
      ]);
    }
  });

  it('deskripsi opsional: kosong, spasi, dan null menjadi null; teks di-trim', () => {
    const parse = (description: unknown) =>
      CreateProjectRequest.parse({ name: 'x', description }).description;
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse('  Layanan pesanan  ')).toBe('Layanan pesanan');
    expect(CreateProjectRequest.parse({ name: 'x' }).description).toBeUndefined();
    expect(messages(CreateProjectRequest.safeParse({ name: 'x', description: 5 }))).toEqual([
      'Deskripsi harus berupa teks',
    ]);
  });

  it('tidak ada pesan bawaan zod (Inggris) yang bocor ke pengguna', () => {
    const bad = [
      CreateProjectRequest.safeParse({}),
      CreateProjectRequest.safeParse(undefined),
      CreateProjectRequest.safeParse({ name: 'x', description: false }),
      UpdateProjectRequest.safeParse({ name: 5 }),
      ProjectIdParams.safeParse({ id: 'abc' }),
      ProjectIdParams.safeParse({}),
    ];
    for (const result of bad) {
      expect(result.success).toBe(false);
      for (const message of messages(result))
        expect(message).not.toMatch(/invalid|expected|received/i);
    }
  });
});

describe('UpdateProjectRequest', () => {
  it('isian yang tidak dikirim tetap undefined (tidak berubah)', () => {
    expect(UpdateProjectRequest.parse({})).toEqual({});
    expect(UpdateProjectRequest.parse({ name: ' Baru ' })).toEqual({ name: 'Baru' });
  });

  it('description null atau kosong berarti hapus deskripsi', () => {
    expect(UpdateProjectRequest.parse({ description: null })).toEqual({ description: null });
    expect(UpdateProjectRequest.parse({ description: ' ' })).toEqual({ description: null });
  });

  it('nama tetap dibatasi 60 karakter dan tidak boleh kosong', () => {
    expect(UpdateProjectRequest.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ name: '  ' }).success).toBe(false);
  });
});

describe('ProjectIdParams', () => {
  it('string angka dari URL menjadi bilangan bulat positif', () => {
    expect(ProjectIdParams.parse({ id: '12' })).toEqual({ id: 12 });
  });

  it.each(['abc', '', '0', '-3', '1.5', ' '])('id %j ditolak dengan satu pesan', (id) => {
    expect(messages(ProjectIdParams.safeParse({ id }))).toEqual(['Id project tidak valid']);
  });
});
