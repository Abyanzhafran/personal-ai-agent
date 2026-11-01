import os from 'node:os';
import path from 'node:path';

/**
 * Mengganti awalan `~` (atau `~/…`, `~\…`) dengan direktori home.
 * Bentuk `~user` sengaja tidak didukung dan dikembalikan apa adanya.
 */
export function expandHome(input: string, homedir: string = os.homedir()): string {
  if (input === '~') return homedir;
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(homedir, input.slice(2));
  }
  return input;
}
