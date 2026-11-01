// `npm run fixtures [-- <folder>]`: membuat fixture dan mencetak path tiap repo.
import os from 'node:os';
import path from 'node:path';

import { makeFixtures } from './make-fixtures.js';

const target = process.argv[2] ?? path.join(os.tmpdir(), 'contract-check-fixtures');
const set = await makeFixtures(target);

console.log(`Fixture dibuat di ${set.root}`);
for (const repo of Object.values(set.repos)) {
  const spec = repo.specCmd ? `${repo.specPath} via '${repo.specCmd}'` : (repo.specPath ?? '-');
  console.log(`  ${repo.name.padEnd(14)} ${repo.role.padEnd(14)} ${repo.path}  spec: ${spec}`);
}
