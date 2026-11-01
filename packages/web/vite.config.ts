import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  // PORT dibaca dari .env di root repo, sama dengan yang dibaca server (config.ts).
  const env = loadEnv(mode, repoRoot, '');
  const serverPort = env['PORT'] ?? '4711';

  return {
    // Plugin router harus sebelum plugin React. Opsi lain dibaca dari tsr.config.json.
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    resolve: { conditions: ['source'] },
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
