import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPathError } from './errors.js';
import { normalizeLocalPath } from './paths.js';

let tmp: string;
/** Folder `$HOME` palsu; `tmp` sendiri sudah dikanonkan supaya perbandingan tidak terganggu symlink OS. */
let home: string;
let repo: string;
let file: string;

const rejection = (input: string) =>
  normalizeLocalPath(input, home).then(
    () => {
      throw new Error(`Seharusnya ditolak: ${JSON.stringify(input)}`);
    },
    (error: unknown) => error as LocalPathError,
  );

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cc-paths-')));
  home = path.join(tmp, 'home');
  repo = path.join(home, 'work', 'svc-order');
  file = path.join(repo, 'README.md');
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(file, '# svc-order\n');
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('normalizeLocalPath: bentuk kanonik', () => {
  it('~/work/svc-order dan ~/work/svc-order/ menghasilkan path identik', async () => {
    const a = await normalizeLocalPath('~/work/svc-order', home);
    const b = await normalizeLocalPath('~/work/svc-order/', home);
    expect(a).toBe(b);
    expect(a).toBe(repo);
  });

  it('~ saja menunjuk home; spasi ujung dan . / .. dilipat', async () => {
    expect(await normalizeLocalPath('~', home)).toBe(home);
    expect(await normalizeLocalPath(`  ${repo}  \n`, home)).toBe(repo);
    expect(await normalizeLocalPath(path.join(repo, '.', '..', 'svc-order') + path.sep, home)).toBe(
      repo,
    );
  });

  it('path absolut dan bentuk ~ untuk folder yang sama identik', async () => {
    expect(await normalizeLocalPath(repo, home)).toBe(
      await normalizeLocalPath('~/work/svc-order', home),
    );
  });
});

describe('normalizeLocalPath: symlink', () => {
  it('dua path berbeda yang menunjuk folder sama lewat symlink dianggap sama', async () => {
    const link = path.join(tmp, 'tautan-svc-order');
    // 'junction' diabaikan di POSIX (jadi symlink biasa) dan tidak butuh hak khusus di Windows.
    await fs.symlink(repo, link, 'junction');

    const viaLink = await normalizeLocalPath(link, home);
    const direct = await normalizeLocalPath(repo, home);
    expect(link).not.toBe(repo);
    expect(viaLink).toBe(direct);
    expect(viaLink).toBe(repo);
    expect(await normalizeLocalPath(`${link}${path.sep}`, home)).toBe(repo);
  });
});

describe.runIf(process.platform === 'win32')('normalizeLocalPath: Windows', () => {
  it('~\\ dan ~/ sama; huruf besar-kecil berbeda menunjuk folder yang sama', async () => {
    expect(await normalizeLocalPath('~\\work\\svc-order', home)).toBe(repo);
    expect(await normalizeLocalPath(repo.toLowerCase(), home)).toBe(
      await normalizeLocalPath(repo.toUpperCase(), home),
    );
  });
});

describe('normalizeLocalPath: penolakan', () => {
  it('kosong, relatif, berkas, dan tidak ada ditolak dengan kode dan pesan berbeda', async () => {
    const cases = [
      ['', 'local_path_empty'],
      ['   ', 'local_path_empty'],
      ['work/svc-order', 'local_path_not_absolute'],
      ['./svc-order', 'local_path_not_absolute'],
      ['../svc-order', 'local_path_not_absolute'],
      ['~orang/work', 'local_path_not_absolute'],
      [file, 'local_path_not_directory'],
      [path.join(repo, 'tidak-ada'), 'local_path_missing'],
      [path.join(file, 'di-dalam-berkas'), 'local_path_missing'],
    ] as const;

    const errors = new Map<string, string>();
    for (const [input, code] of cases) {
      const error = await rejection(input);
      expect(error).toBeInstanceOf(LocalPathError);
      expect(error.code).toBe(code);
      errors.set(code, error.message);
    }
    // Empat alasan, empat pesan berbeda.
    expect(new Set(errors.values()).size).toBe(4);
  });

  it('pesan menyebut path yang diketik user', async () => {
    expect((await rejection('work/svc-order')).message).toContain('work/svc-order');
    expect((await rejection(file)).message).toContain(file);
  });
});
