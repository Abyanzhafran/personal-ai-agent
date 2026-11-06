import { defineConfig } from 'vitest/config';

// Setiap paket punya vitest.config.ts sendiri (environment dan alias berbeda).
export default defineConfig({
  test: {
    projects: ['packages/*', 'fixtures'],
    passWithNoTests: true,
    // Hanya aktif lewat `npm run test:coverage` (CC-094): modul murni, ambang per berkas.
    coverage: {
      provider: 'v8',
      include: [
        'packages/server/src/compare/normalize.ts',
        'packages/server/src/compare/severity.ts',
        'packages/server/src/diff/endpoints.ts',
        'packages/server/src/extract/verify.ts',
        'packages/shared/src/copytext.ts',
      ],
      thresholds: { perFile: true, lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
