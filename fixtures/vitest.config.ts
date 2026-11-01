import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'fixtures',
    environment: 'node',
    include: ['*.test.ts'],
    // Membuat empat repo git nyata lewat proses anak; di Windows tiap perintah git ~50 ms.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
