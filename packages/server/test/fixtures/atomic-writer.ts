// Proses anak untuk test atomicity: menulis ulang satu file JSON besar tanpa henti sampai dibunuh.
import { WorkspaceLayout } from '../../src/workspace/layout.js';
import { WorkspaceStore } from '../../src/workspace/store.js';

export const PAYLOAD_LENGTH = 2_000_000;

const [root, file] = process.argv.slice(2);
if (!root || !file) throw new Error('usage: atomic-writer <root> <file>');

const store = new WorkspaceStore(new WorkspaceLayout(root));
console.log('ready');
for (let n = 0; ; n++) {
  await store.writeJson(file, { n, payload: 'x'.repeat(PAYLOAD_LENGTH) });
}
