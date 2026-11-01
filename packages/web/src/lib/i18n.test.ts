import { describe, expect, it } from 'vitest';
import { id } from '../locales/id';
import { createT, useT, type MessageKey, type Messages } from './i18n';

describe('i18n', () => {
  it('useT mengembalikan teks dari kamus ID', () => {
    const t = useT();
    for (const [key, text] of Object.entries(id)) {
      expect(t(key as MessageKey)).toBe(text);
    }
  });

  it('mengganti {placeholder} dengan nilainya dan membiarkan yang tidak diberi nilai', () => {
    const t = useT();
    expect(t('breadcrumb.check', { id: 128 })).toBe('Check #128');
    expect(t('breadcrumb.check')).toBe('Check #{id}');
    expect(t('breadcrumb.check', { id: undefined })).toBe('Check #{id}');
  });

  it('bahasa lain cukup memenuhi Messages; komponen tetap memakai useT()', () => {
    const en: Messages = { ...id, 'nav.checks': 'Checks (EN)' };
    expect(createT(en)('nav.checks')).toBe('Checks (EN)');
  });

  it('tipe Messages diturunkan dari id.ts: kunci kurang atau lebih ditolak kompilator', () => {
    // @ts-expect-error hampir semua kunci kurang
    const kurang: Messages = { 'nav.projects': 'x' };
    // @ts-expect-error kunci 'nav.lain' tidak ada di id.ts
    const lebih: Messages = { ...id, 'nav.lain': 'x' };
    expect([kurang, lebih]).toHaveLength(2);
  });
});
