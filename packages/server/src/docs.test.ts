import { ERROR_CODES } from '@cc/shared';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dokumen (CC-095) dijaga test supaya tidak melenceng dari kode: perintah yang ditulis harus ada di
 * package.json, tiap kode galat API dan tiap kelas galat bertipe punya tepat satu entri di runbook,
 * dan tiap variabel `.env.example` dijelaskan di README.
 */
const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const readme = read('docs/README.md');
const runbook = read('docs/RUNBOOK.md');

interface PackageJson {
  name: string;
  scripts?: Record<string, string>;
}
const rootScripts = (JSON.parse(read('package.json')) as PackageJson).scripts ?? {};
/** Nama paket (`@cc/server`) → skrip miliknya. */
const workspaceScripts = new Map(
  fs.readdirSync(path.join(root, 'packages')).map((dir) => {
    const pkg = JSON.parse(read(`packages/${dir}/package.json`)) as PackageJson;
    return [pkg.name, pkg.scripts ?? {}] as const;
  }),
);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

/**
 * Kelas galat bertipe di server: turunan `Error` (langsung atau lewat kelas lain) yang tidak
 * diturunkan lagi. Kelas dasar seperti `GitError` dan `CommandError` tidak punya pesan sendiri.
 */
function typedErrors(): string[] {
  const parentOf = new Map<string, string>();
  for (const file of sourceFiles(path.join(root, 'packages/server/src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^(?:export )?class (\w+) extends (\w+)/gm)) {
      parentOf.set(match[1] as string, match[2] as string);
    }
  }
  const isError = (name: string): boolean =>
    name === 'Error' || (parentOf.has(name) && isError(parentOf.get(name) as string));
  const parents = new Set(parentOf.values());
  return [...parentOf.keys()].filter((name) => isError(name) && !parents.has(name)).sort();
}

/** Baris judul (`#`) dan baris tabel yang diawali sel berkode `nama`. */
const headings = runbook.split('\n').filter((line) => line.startsWith('#'));
const tableRows = runbook.split('\n').filter((line) => line.startsWith('| `'));

/** Dibungkus `HttpError`; kodenya (`ERROR_CODES`) yang punya entri, bukan kelasnya. */
const EXEMPT = new Set(['HttpError']);

describe('RUNBOOK', () => {
  it('tiap kode galat API punya tepat satu baris di tabel', () => {
    const wrong = Object.values(ERROR_CODES).filter(
      (code) => tableRows.filter((row) => row.startsWith(`| \`${code}\``)).length !== 1,
    );
    expect(wrong).toEqual([]);
  });

  it('tiap kelas galat bertipe punya tepat satu judul', () => {
    const names = typedErrors().filter((name) => !EXEMPT.has(name));
    expect(names.length).toBeGreaterThan(0);
    const wrong = names.filter(
      (name) =>
        headings.filter((heading) => new RegExp(`\\b${name}\\b`).test(heading)).length !== 1,
    );
    expect(wrong).toEqual([]);
  });
});

describe('perintah di dokumen sama dengan package.json', () => {
  const docs = [
    ['README', readme],
    ['RUNBOOK', runbook],
  ] as const;
  // `npm run <skrip> [-w <paket>]`, serta `npm test` dan `npm start` yang berupa pintasan skrip.
  const COMMAND =
    /\bnpm (?:run ([a-z][\w:-]*)|(test|start))(?: (?:-w|--workspace) (@cc\/[\w-]+))?/g;

  it.each(docs)('%s: setiap `npm run ...` merujuk skrip yang ada', (_name, text) => {
    const found = [...text.matchAll(COMMAND)];
    expect(found.length).toBeGreaterThan(0);
    for (const match of found) {
      const script = (match[1] ?? match[2]) as string;
      const scripts = match[3] === undefined ? rootScripts : workspaceScripts.get(match[3]);
      expect(scripts, match[0]).toBeDefined();
      expect(Object.keys(scripts ?? {}), match[0]).toContain(script);
    }
  });

  it('README menyebut setiap skrip root', () => {
    for (const script of Object.keys(rootScripts)) {
      const shown = script === 'test' ? /\bnpm test\b/ : new RegExp(`\\bnpm run ${script}\\b`);
      expect(readme, script).toMatch(shown);
    }
  });
});

describe('README', () => {
  it('menjelaskan setiap variabel di .env.example', () => {
    const keys = [...read('.env.example').matchAll(/^([A-Z][A-Z_]+)=/gm)].map(
      (m) => m[1] as string,
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(readme, key).toContain(`\`${key}\``);
  });
});
