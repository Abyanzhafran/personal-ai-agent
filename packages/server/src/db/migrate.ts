import fs from 'node:fs';
import type { Db } from './database.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

function readSqlFile(name: string): string {
  return fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

/**
 * Urut menurut `version`, naik satu-satu. Versi 1 adalah `schema.sql`.
 * Perubahan skema berikutnya = menambah entri baru di sini, bukan mengedit entri lama.
 */
export function loadMigrations(): readonly Migration[] {
  return [{ version: 1, name: 'baseline', sql: readSqlFile('schema.sql') }];
}

export interface MigrateResult {
  readonly from: number;
  readonly to: number;
}

/**
 * Menjalankan migrasi yang belum diterapkan, tiap migrasi dalam satu transaksi.
 * Idempoten: dijalankan ulang pada database yang sudah mutakhir tidak mengubah apa pun.
 * Versi tersimpan di `PRAGMA user_version`.
 */
export function migrate(
  db: Db,
  migrations: readonly Migration[] = loadMigrations(),
): MigrateResult {
  const current = db.pragma('user_version', { simple: true }) as number;
  const latest = migrations.at(-1)?.version ?? 0;

  if (current > latest) {
    throw new Error(
      `Database berversi ${current}, lebih baru dari yang dikenali aplikasi ini (${latest}). ` +
        'Jalankan versi aplikasi yang lebih baru.',
    );
  }

  let applied = current;
  for (const migration of migrations) {
    if (migration.version <= applied) continue;
    if (migration.version !== applied + 1) {
      throw new Error(`Migrasi tidak berurutan: ${applied} -> ${migration.version}`);
    }
    db.transaction(() => {
      db.exec(migration.sql);
      // user_version tidak mendukung parameter terikat; nilainya angka dari kode sendiri.
      db.pragma(`user_version = ${migration.version}`);
    })();
    applied = migration.version;
  }

  return { from: current, to: applied };
}
