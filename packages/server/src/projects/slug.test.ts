import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceLayout } from '../workspace/layout.js';
import { slugify } from './slug.js';

describe('slugify', () => {
  it.each([
    ['Order Service', 'order-service'],
    ['ORDER', 'order'],
    ['  Toko   Online  ', 'toko-online'],
    ['Order\tService\nBaru', 'order-service-baru'],
    ['Order/Payment', 'order-payment'],
    ['a:b*c?d', 'a-b-c-d'],
    ['v1.2 Beta', 'v1.2-beta'],
    ['(Toko) [v2]', '(toko)-[v2]'],
    ['.hidden.', 'hidden'],
    ['Pesanan Çok Ünï', 'pesanan-çok-ünï'],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('nama yang berbeda hanya soal huruf besar dan spasi menghasilkan slug yang sama (bentrok)', () => {
    expect(slugify('Order Service')).toBe(slugify('order  service'));
  });

  it.each(['', '   ', '///', '..', '. . .', '***', '\u0001\u0002'])(
    '%j tidak punya karakter yang bisa dipakai → string kosong',
    (name) => {
      expect(slugify(name)).toBe('');
    },
  );

  it('setiap hasil tidak kosong lolos pemeriksaan path workspace', () => {
    const layout = new WorkspaceLayout(path.join(os.tmpdir(), 'cc-slug-layout'));
    for (const name of [
      'Order Service',
      'a/b\\c',
      '..x..',
      'con.',
      'x'.repeat(60),
      'Tab\tNama',
      '"kutip" <dan> |pipa|',
      '  .spasi.  ',
    ]) {
      const slug = slugify(name);
      expect(slug).not.toBe('');
      expect(() => layout.projectContextDir(slug)).not.toThrow();
    }
  });
});
