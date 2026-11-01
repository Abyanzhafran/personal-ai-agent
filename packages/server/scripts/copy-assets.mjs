// tsc tidak menyalin aset non-TS. Dipanggil setelah `tsc -p tsconfig.build.json`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['db/schema.sql'];

for (const asset of ASSETS) {
  const from = path.join(root, 'src', asset);
  const to = path.join(root, 'dist', asset);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
