import { defineConfig } from 'vitest/config';

// Setiap paket punya vitest.config.ts sendiri (environment dan alias berbeda).
export default defineConfig({
  test: {
    projects: ['packages/*', 'fixtures'],
    passWithNoTests: true,
  },
});
