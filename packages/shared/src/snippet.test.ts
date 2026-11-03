import { describe, expect, it } from 'vitest';
import { Snippet } from './snippet.js';

const valid = { lines: [{ n: 7, text: '\tconst x = 1;' }], highlight: 7, tokens: ['x'] };

describe('Snippet', () => {
  it('bentuk valid lolos dan tab tidak diubah', () => {
    expect(Snippet.parse(valid)).toEqual(valid);
    expect(Snippet.parse({ ...valid, tokens: [] }).tokens).toEqual([]);
  });

  it.each([
    ['tanpa baris', { ...valid, lines: [] }],
    ['nomor baris 0', { ...valid, lines: [{ n: 0, text: '' }] }],
    ['highlight 0', { ...valid, highlight: 0 }],
    ['token kosong', { ...valid, tokens: [''] }],
  ])('menolak %s', (_name, value) => {
    expect(Snippet.safeParse(value).success).toBe(false);
  });
});
