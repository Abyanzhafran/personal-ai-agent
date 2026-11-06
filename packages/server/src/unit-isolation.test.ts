import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CC-094: test modul murni tidak menyentuh jaringan, dan filesystem hanya lewat folder sementara.
 * Pemindai teks seperti guardrails.test.ts. Daftar modul = `coverage.include` di vitest.config.ts,
 * jadi menambah modul ke ambang cakupan otomatis ikut dijaga. Pengecualian yang disengaja:
 * `toMatchFileSnapshot` membaca golden yang di-commit di `__snapshots__/` (masukan, bukan keadaan mesin).
 */
const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const modules = [...read('vitest.config.ts').matchAll(/'(packages\/[^']+)\.ts'/g)].map(
  (m) => m[1] as string,
);

const NETWORK =
  /\bfetch\s*\(|from ['"](?:node:)?(?:https?|http2|net|tls|dgram|dns)['"]|from ['"](?:supertest|axios|undici|ws)['"]/;
// Path yang dihitung dari lokasi berkas, cwd, atau home menunjuk ke luar folder sementara.
const OUTSIDE_TMP = /process\.cwd\(|import\.meta\.(?:dirname|url)|__dirname|homedir\(/;
const IMPORTS_FS = /from ['"]node:fs(?:\/promises)?['"]/;
const USES_TMP = /\bos\.tmpdir\(\)/;

describe('test modul murni (ambang cakupan CC-094)', () => {
  it('ada modul yang dijaga', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  describe.each(modules)('%s', (mod) => {
    const testFile = `${mod}.test.ts`;
    const source = read(testFile);

    it('tidak memakai jaringan', () => {
      expect(NETWORK.exec(source)?.[0]).toBeUndefined();
    });

    it('tidak menghitung path dari lokasi berkas, cwd, atau home', () => {
      expect(OUTSIDE_TMP.exec(source)?.[0]).toBeUndefined();
    });

    it('memakai fs hanya bersama folder sementara', () => {
      if (IMPORTS_FS.test(source)) expect(source).toMatch(USES_TMP);
    });
  });
});
