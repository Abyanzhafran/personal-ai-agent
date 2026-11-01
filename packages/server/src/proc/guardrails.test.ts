import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Test statis (CC-006): memindai kode sumber server. Dua aturan:
 *  1. perintah git penulis tidak boleh muncul di kode;
 *  2. child process hanya boleh dibuat di `proc/run-command.ts`.
 * Pemindai diuji dulu dengan contoh buatan agar test ini tidak lolos karena pemindainya buta.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const GATE = 'proc/run-command.ts';
const POLICY = 'proc/git-policy.ts';

const FORBIDDEN = ['checkout', 'switch', 'reset', 'clean', 'commit', 'push', 'stash', 'apply'];
const FORBIDDEN_ALT = FORBIDDEN.join('|');

/** `git checkout`, `git -C x reset`, dst. di teks mana pun (string, komentar, template). */
const GIT_COMMAND_TEXT = new RegExp(`\\bgit\\s+(?:-C\\s+\\S+\\s+)?(?:${FORBIDDEN_ALT})\\b`);
/** Literal string tepat berisi subcommand terlarang, mis. `['checkout', ref]`. */
const FORBIDDEN_LITERAL = new RegExp(`(['"\`])(?:${FORBIDDEN_ALT})\\1`);
const CALLS_GIT = /(['"`])git\1/;

const CHILD_PROCESS_USE = [
  /from\s+['"](?:node:)?child_process['"]/,
  /require\(\s*['"](?:node:)?child_process['"]\s*\)/,
  /import\(\s*['"](?:node:)?child_process['"]\s*\)/,
  /from\s+['"](?:execa|cross-spawn|shelljs|node-pty)['"]/,
  /require\(\s*['"](?:execa|cross-spawn|shelljs|node-pty)['"]\s*\)/,
  /import\(\s*['"](?:execa|cross-spawn|shelljs|node-pty)['"]\s*\)/,
];

function findForbiddenGit(source: string): string[] {
  const hits: string[] = [];
  const text = GIT_COMMAND_TEXT.exec(source);
  if (text) hits.push(text[0]);
  // Literal polos hanya dicurigai di file yang memang memanggil git ('clean' juga nilai status check).
  if (CALLS_GIT.test(source)) {
    const literal = FORBIDDEN_LITERAL.exec(source);
    if (literal) hits.push(literal[0]);
  }
  return hits;
}

function findChildProcessUse(source: string): string[] {
  return CHILD_PROCESS_USE.flatMap((pattern) => {
    const match = pattern.exec(source);
    return match ? [match[0]] : [];
  });
}

function sourceFiles(dir: string, base = dir): { rel: string; text: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, base);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [
      {
        rel: path.relative(base, full).split(path.sep).join('/'),
        text: fs.readFileSync(full, 'utf8'),
      },
    ];
  });
}

describe('pemindai (diuji dengan contoh buatan)', () => {
  it.each(FORBIDDEN)('mendeteksi `git %s` di teks', (sub) => {
    expect(findForbiddenGit(`exec("git ${sub} .")`)).not.toEqual([]);
    expect(findForbiddenGit(`// jalankan git -C /repo ${sub}`)).not.toEqual([]);
  });

  it.each(FORBIDDEN)('mendeteksi literal args ["%s"] di file yang memanggil git', (sub) => {
    expect(findForbiddenGit(`run({ file: 'git', args: ['-C', repo, '${sub}'] })`)).not.toEqual([]);
  });

  it("tidak salah menandai 'clean' sebagai status di file yang tidak memanggil git", () => {
    expect(findForbiddenGit(`const status = 'clean';`)).toEqual([]);
  });

  it('mendeteksi import child process dalam semua bentuk', () => {
    for (const code of [
      `import { spawn } from 'node:child_process';`,
      `import cp from "child_process";`,
      `const cp = require('node:child_process');`,
      `const cp = await import('child_process');`,
      `import { execa } from 'execa';`,
      `import spawn from 'cross-spawn';`,
    ]) {
      expect(findChildProcessUse(code), code).not.toEqual([]);
    }
    expect(findChildProcessUse(`import path from 'node:path';`)).toEqual([]);
  });
});

describe('kode sumber server (packages/server/src)', () => {
  const files = sourceFiles(SRC);

  it('memindai berkas sungguhan, bukan folder kosong', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((f) => f.rel)).toContain(GATE);
  });

  it('tidak memuat perintah git penulis: checkout, switch, reset, clean, commit, push, stash, apply', () => {
    const offenders = files
      .filter((f) => f.rel !== POLICY)
      .flatMap((f) => findForbiddenGit(f.text).map((hit) => `${f.rel}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('execa/child_process hanya dipakai di proc/run-command.ts', () => {
    const offenders = files
      .filter((f) => f.rel !== GATE)
      .flatMap((f) => findChildProcessUse(f.text).map((hit) => `${f.rel}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('pintu itu sendiri memang memakai execa (jaga agar aturan di atas tidak kosong)', () => {
    const gate = files.find((f) => f.rel === GATE);
    expect(findChildProcessUse(gate?.text ?? '')).not.toEqual([]);
  });
});
