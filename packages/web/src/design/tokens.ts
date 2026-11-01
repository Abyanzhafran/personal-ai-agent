/**
 * Daftar NAMA token (tanpa nilai). Nilainya hidup di `styles/globals.css` dan dibaca saat runtime
 * oleh /dev/tokens; test memastikan daftar ini dan CSS tidak pernah berbeda.
 */
export const COLOR_TOKEN_GROUPS = [
  { group: 'Aksi utama', tokens: ['primary', 'on-primary'] },
  { group: 'Tonal', tokens: ['secondary-container', 'on-secondary-container'] },
  {
    group: 'Permukaan',
    tokens: ['surface', 'surface-container-lowest', 'surface-container', 'surface-container-high'],
  },
  { group: 'Garis', tokens: ['outline', 'outline-variant', 'divider'] },
  { group: 'Teks', tokens: ['on-surface', 'on-surface-variant'] },
  {
    group: 'Status',
    tokens: [
      'error-container',
      'on-error-container',
      'warning-container',
      'on-warning-container',
      'success-container',
      'on-success-container',
      'info-container',
      'on-info-container',
      'neutral-container',
    ],
  },
  {
    group: 'Sorot kode',
    tokens: ['code-highlight-break', 'code-highlight-warn', 'code-highlight-info'],
  },
] as const;

export const COLOR_TOKENS = COLOR_TOKEN_GROUPS.flatMap((g) => g.tokens);
export const RADIUS_TOKENS = ['sm', 'md', 'lg', 'xl'] as const;
export const FONT_TOKENS = ['sans', 'mono'] as const;
export const TEXT_TOKENS = ['headline', 'title', 'body', 'label', 'code'] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
