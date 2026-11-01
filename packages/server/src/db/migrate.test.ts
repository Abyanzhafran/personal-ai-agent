import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHECK_STATUSES,
  CONFIDENCES,
  KINDS,
  PROFILE_STATUSES,
  ROLES,
  SEVERITIES,
} from '@cc/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './database.js';
import { loadMigrations, migrate } from './migrate.js';

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => {
  db.close();
});

function columns(table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function indexColumns(table: string): string[][] {
  const indexes = db.pragma(`index_list(${table})`) as { name: string }[];
  return indexes.map((i) =>
    (db.pragma(`index_info(${i.name})`) as { name: string }[]).map((c) => c.name),
  );
}

/** Menyisipkan satu rantai lengkap project -> repo -> check -> finding. */
function seedChain() {
  const projectId = Number(
    db.prepare("INSERT INTO projects (name, slug) VALUES ('Order', 'order')").run().lastInsertRowid,
  );
  const insertRepo = db.prepare(
    `INSERT INTO repos (project_id, role, name, local_path, default_branch)
     VALUES (?, ?, ?, ?, 'main')`,
  );
  const providerId = Number(
    insertRepo.run(projectId, 'service', 'svc-order', '/r/svc').lastInsertRowid,
  );
  const consumerId = Number(
    insertRepo.run(projectId, 'microfrontend', 'mfe', '/r/mfe').lastInsertRowid,
  );
  const checkId = Number(
    db
      .prepare(
        `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at)
         VALUES (?, ?, 'main', 'feature/xyz', '2026-10-31T00:00:00.000Z')`,
      )
      .run(projectId, providerId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO findings (check_id, endpoint, consumer_repo_id, file, line, kind, severity, detail, confidence)
     VALUES (?, 'GET /orders', ?, 'src/a.ts', 3, 'removed', 'break', 'page_size dihapus', 'high')`,
  ).run(checkId, consumerId);
  return { projectId, providerId, consumerId, checkId };
}

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('migrate', () => {
  it('idempoten: dijalankan dua kali tidak error dan tidak mengubah apa pun', () => {
    expect(migrate(db)).toEqual({ from: 0, to: 1 });
    seedChain();
    expect(() => migrate(db)).not.toThrow();
    expect(migrate(db)).toEqual({ from: 1, to: 1 });
    expect(count('projects')).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('membuat tepat empat tabel (aturan #7: tidak menambah tabel)', () => {
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['checks', 'findings', 'projects', 'repos']);
  });

  it('menolak database yang lebih baru dari aplikasi', () => {
    migrate(db);
    db.pragma('user_version = 99');
    expect(() => migrate(db)).toThrow(/lebih baru/);
  });

  it('migrasi yang gagal di tengah di-rollback seluruhnya', () => {
    const broken = [
      { version: 1, name: 'rusak', sql: 'CREATE TABLE a (x); CREATE TABLE a (x);' },
    ] as const;
    expect(() => migrate(db, broken)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").all()).toHaveLength(0);
  });
});

describe('skema', () => {
  beforeEach(() => {
    migrate(db);
  });

  it('memuat kolom tambahan v2 dari mockup', () => {
    expect(columns('repos')).toEqual(expect.arrayContaining(['profile_status', 'last_fetch_at']));
    expect(columns('checks')).toContain('error');
    expect(columns('findings')).toEqual(
      expect.arrayContaining(['confidence', 'via_symbol', 'snippet_json']),
    );
  });

  it('memuat seluruh kolom dari brief', () => {
    expect(columns('projects')).toEqual(expect.arrayContaining(['id', 'name', 'description']));
    expect(columns('repos')).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'role',
        'name',
        'local_path',
        'default_branch',
        'spec_path',
        'spec_cmd',
      ]),
    );
    expect(columns('checks')).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'provider_repo_id',
        'base_ref',
        'head_ref',
        'base_sha',
        'head_sha',
        'status',
        'started_at',
        'finished_at',
        'summary_json',
      ]),
    );
    expect(columns('findings')).toEqual(
      expect.arrayContaining([
        'id',
        'check_id',
        'endpoint',
        'consumer_repo_id',
        'file',
        'line',
        'kind',
        'severity',
        'detail',
      ]),
    );
  });

  it('punya index checks(project_id, started_at) dan findings(check_id)', () => {
    expect(indexColumns('checks')).toContainEqual(['project_id', 'started_at']);
    expect(indexColumns('findings')).toContainEqual(['check_id']);
  });

  it('checks.status hanya menerima lima nilai', () => {
    const { projectId, providerId } = seedChain();
    const insert = db.prepare(
      `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at, status)
       VALUES (?, ?, 'main', 'x', '2026-10-31T00:00:00.000Z', ?)`,
    );
    for (const status of ['running', 'clean', 'findings', 'failed', 'cancelled']) {
      expect(() => insert.run(projectId, providerId, status)).not.toThrow();
    }
    expect(() => insert.run(projectId, providerId, 'done')).toThrow(/CHECK constraint/);
    expect(() => insert.run(projectId, providerId, 'spec_stale')).toThrow(/CHECK constraint/);
  });

  it('checks.status default-nya running', () => {
    const { checkId } = seedChain();
    const row = db.prepare('SELECT status FROM checks WHERE id = ?').get(checkId) as {
      status: string;
    };
    expect(row.status).toBe('running');
  });

  it('menghapus project ikut menghapus repos, checks, findings (cascade)', () => {
    const { projectId } = seedChain();
    expect([count('repos'), count('checks'), count('findings')]).toEqual([2, 1, 1]);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    expect([count('projects'), count('repos'), count('checks'), count('findings')]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('menghapus project hanya menghapus miliknya sendiri', () => {
    const { projectId } = seedChain();
    db.prepare("INSERT INTO projects (name, slug) VALUES ('Lain', 'lain')").run();
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    expect(count('projects')).toBe(1);
  });

  it('foreign key ditegakkan: repo tanpa project ditolak', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO repos (project_id, role, name, local_path, default_branch) VALUES (999, 'service', 'x', '/x', 'main')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('slug project unik', () => {
    db.prepare("INSERT INTO projects (name, slug) VALUES ('Order', 'order')").run();
    expect(() =>
      db.prepare("INSERT INTO projects (name, slug) VALUES ('ORDER', 'order')").run(),
    ).toThrow(/UNIQUE/);
  });

  it('local_path unik per project, tetapi boleh sama di project lain', () => {
    const { projectId } = seedChain();
    const other = Number(
      db.prepare("INSERT INTO projects (name, slug) VALUES ('Lain', 'lain')").run().lastInsertRowid,
    );
    const insert = db.prepare(
      "INSERT INTO repos (project_id, role, name, local_path, default_branch) VALUES (?, 'service', 'x', '/r/svc', 'main')",
    );
    expect(() => insert.run(projectId)).toThrow(/UNIQUE/);
    expect(() => insert.run(other)).not.toThrow();
  });

  it('summary_json dan snippet_json harus JSON valid', () => {
    const { checkId, consumerId } = seedChain();
    expect(() =>
      db.prepare("UPDATE checks SET summary_json = 'bukan json' WHERE id = ?").run(checkId),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db.prepare('UPDATE checks SET summary_json = \'{"break":1}\' WHERE id = ?').run(checkId),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO findings (check_id, endpoint, consumer_repo_id, kind, severity, detail, snippet_json)
           VALUES (?, 'GET /x', ?, 'removed', 'break', 'd', '{rusak')`,
        )
        .run(checkId, consumerId),
    ).toThrow(/CHECK constraint/);
  });

  it('finding tingkat provider (spec_stale) boleh tanpa consumer, file, line, confidence', () => {
    const { checkId } = seedChain();
    expect(() =>
      db
        .prepare(
          `INSERT INTO findings (check_id, endpoint, kind, severity, detail)
           VALUES (?, 'spec', 'spec_stale', 'warn', 'spec tidak diperbarui')`,
        )
        .run(checkId),
    ).not.toThrow();
  });
});

describe('kesesuaian CHECK constraint dengan @cc/shared', () => {
  /** Mengambil daftar nilai dari `CHECK (<column> IN ('a', 'b', ...))` di DDL asli. */
  function checkValues(table: string, column: string): string[] {
    const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as {
      sql: string;
    };
    const match = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`).exec(row.sql);
    if (!match?.[1]) throw new Error(`CHECK ${table}.${column} tidak ditemukan`);
    return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
  }

  beforeEach(() => {
    migrate(db);
  });

  it.each([
    ['repos', 'role', ROLES],
    ['repos', 'profile_status', PROFILE_STATUSES],
    ['checks', 'status', CHECK_STATUSES],
    ['findings', 'kind', KINDS],
    ['findings', 'severity', SEVERITIES],
    ['findings', 'confidence', CONFIDENCES],
  ] as const)('%s.%s sama persis dengan konstanta shared', (table, column, shared) => {
    expect([...checkValues(table, column)].sort()).toEqual([...shared].sort());
  });
});

describe('openDatabase', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-db-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('memakai WAL dan foreign_keys=ON pada file database', () => {
    const file = path.join(dir, 'nested', 'app.db');
    const fileDb = openDatabase(file);
    try {
      expect(fileDb.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(fileDb.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      fileDb.close();
    }
  });

  it('migrasi pada file yang dibuka ulang tetap idempoten dan datanya bertahan', () => {
    const file = path.join(dir, 'app.db');
    const first = openDatabase(file);
    migrate(first);
    first.prepare("INSERT INTO projects (name, slug) VALUES ('Order', 'order')").run();
    first.close();

    const second = openDatabase(file);
    try {
      expect(migrate(second)).toEqual({ from: 1, to: 1 });
      expect(second.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 });
    } finally {
      second.close();
    }
  });
});

describe('loadMigrations', () => {
  it('berurutan mulai dari 1 tanpa lompatan', () => {
    const versions = loadMigrations().map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });
});
