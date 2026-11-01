import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Membuka `app.db` (atau `:memory:` untuk test) dengan PRAGMA yang wajib di tiap koneksi.
 * Folder induk dibuat bila belum ada.
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Aman bersama WAL dan jauh lebih cepat daripada FULL.
  db.pragma('synchronous = NORMAL');
  // Proses tunggal, tetapi test dan CLI inspeksi bisa membuka file yang sama.
  db.pragma('busy_timeout = 5000');
  return db;
}
