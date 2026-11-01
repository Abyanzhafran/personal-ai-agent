import { describe, expect, it } from 'vitest';
import { id } from '../locales/id';
import { createT, useT, type Messages } from './i18n';

describe('i18n', () => {
  it('useT mengembalikan teks dari kamus ID', () => {
    const t = useT();
    for (const [key, text] of Object.entries(id)) {
      expect(t(key as keyof typeof id)).toBe(text);
    }
  });

  it('bahasa lain cukup memenuhi Messages; komponen tetap memakai useT()', () => {
    const en: Messages = {
      'nav.projects': 'Projects',
      'nav.checks': 'Checks',
      'nav.guide': 'Guide',
    };
    expect(createT(en)('nav.guide')).toBe('Guide');
  });

  it('tipe Messages diturunkan dari id.ts: kunci kurang atau lebih ditolak kompilator', () => {
    // @ts-expect-error kunci 'nav.guide' dan 'nav.checks' kurang
    const kurang: Messages = { 'nav.projects': 'x' };
    // @ts-expect-error kunci 'nav.lain' tidak ada di id.ts
    const lebih: Messages = { ...id, 'nav.lain': 'x' };
    expect([kurang, lebih]).toHaveLength(2);
  });
});
