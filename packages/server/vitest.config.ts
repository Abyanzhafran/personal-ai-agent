import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
  ssr: {
    resolve: { conditions: ['source'] },
  },
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Banyak test menjalankan git sungguhan atas repo fixture; saat seluruh suite paralel, batas bawaan
    // 5 dtk terlewati secara acak (test yang gagal berganti tiap run), padahal tiap test lolos sendirian.
    testTimeout: 30_000,
  },
});
