import fs from 'node:fs/promises';
import path from 'node:path';

const isWindows = process.platform === 'win32';

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Nilai variabel env tanpa peduli huruf besar/kecil di Windows (`Path` vs `PATH`). */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (!isWindows) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Mencari executable seperti shell: nama polos dicari di PATH, nama berpemisah path dicek langsung.
 * Di Windows ikut mencoba ekstensi PATHEXT. Dipakai karena execa di Windows tidak melaporkan
 * binary yang hilang sebagai ENOENT, melainkan exit 1 dengan pesan cmd.exe yang bergantung bahasa OS.
 */
export async function resolveExecutable(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const extensions = isWindows
    ? ['', ...(envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];

  const hasDirectory = file.includes('/') || (isWindows && file.includes('\\'));
  const directories = hasDirectory
    ? ['']
    : (envValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate =
        directory === '' ? file + extension : path.join(directory, file + extension);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}
