import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from '../util/home.js';
import { LocalPathError } from './errors.js';

/**
 * Mengubah path folder repo ketikan atau tempelan user menjadi bentuk kanonik: `~` diperluas, symlink
 * diselesaikan, tanpa trailing slash, `.` dan `..` dilipat. Dua teks yang menunjuk folder yang sama
 * menghasilkan string yang sama, jadi hasilnya aman dipakai sebagai kunci `UNIQUE(project_id, local_path)`.
 *
 * Path relatif tidak pernah dihitung dari cwd server: user tidak punya cwd yang bisa ia lihat.
 * Melempar {@link LocalPathError} dengan kode dan pesan berbeda untuk tiap penolakan.
 */
export async function normalizeLocalPath(
  input: string,
  homedir: string = os.homedir(),
): Promise<string> {
  const typed = input.trim();
  if (typed === '') {
    throw new LocalPathError('local_path_empty', 'Path folder repo tidak boleh kosong');
  }

  const expanded = expandHome(typed, homedir);
  if (!path.isAbsolute(expanded)) {
    throw new LocalPathError(
      'local_path_not_absolute',
      `Path harus absolut atau diawali ~, bukan path relatif: ${typed}`,
    );
  }

  let real: string;
  try {
    real = await fs.realpath(expanded);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new LocalPathError('local_path_missing', `Folder tidak ditemukan: ${typed}`);
    }
    throw error;
  }

  if (!(await fs.stat(real)).isDirectory()) {
    throw new LocalPathError('local_path_not_directory', `Path ini berkas, bukan folder: ${typed}`);
  }
  return real;
}
