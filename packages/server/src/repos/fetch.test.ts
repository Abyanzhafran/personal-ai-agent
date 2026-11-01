import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { CommandFailedError, CommandTimeoutError } from '../proc/errors.js';
import { createProjectFetcher } from './fetch.js';

// Tanpa git sungguhan: adapter palsu mencatat panggilan, jadi batas paralel dan kegagalan bisa diatur.
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  db.prepare("INSERT INTO projects (name, slug) VALUES ('A', 'a'), ('B', 'b')").run();
});
afterEach(() => db.close());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function seedRepos(
  projectId: number,
  names: string[],
  lastFetchAt: string | null = null,
): number[] {
  return names.map((name) =>
    Number(
      db
        .prepare(
          `INSERT INTO repos (project_id, role, name, local_path, default_branch, last_fetch_at)
           VALUES (?, 'service', ?, ?, 'main', ?)`,
        )
        .run(projectId, name, `/repo/${projectId}/${name}`, lastFetchAt).lastInsertRowid,
    ),
  );
}

const lastFetchAt = () =>
  Object.fromEntries(
    (
      db.prepare('SELECT name, last_fetch_at FROM repos').all() as Record<string, string | null>[]
    ).map((row) => [row.name, row.last_fetch_at]),
  );

const NOW = new Date('2026-11-01T10:00:00.000Z');

describe('createProjectFetcher', () => {
  it('fetch semua repo project, mengisi last_fetch_at, hasil urut menurut id', async () => {
    const [one, two, three] = seedRepos(1, ['satu', 'dua', 'tiga']) as [number, number, number];
    seedRepos(2, ['lain']);
    const fetched: string[] = [];
    const fetcher = createProjectFetcher({
      db,
      concurrency: 4,
      now: () => NOW,
      git: {
        fetchPrune: async (repo) => {
          fetched.push(repo);
        },
      },
    });

    const results = await fetcher.fetchProject(1);

    const at = '2026-11-01T10:00:00.000Z';
    expect(results).toEqual([
      { repo_id: one, name: 'satu', ok: true, error: null, last_fetch_at: at },
      { repo_id: two, name: 'dua', ok: true, error: null, last_fetch_at: at },
      { repo_id: three, name: 'tiga', ok: true, error: null, last_fetch_at: at },
    ]);
    expect(fetched.sort()).toEqual(['/repo/1/dua', '/repo/1/satu', '/repo/1/tiga']);
    // Repo project lain tidak disentuh.
    expect(lastFetchAt()).toEqual({ satu: at, dua: at, tiga: at, lain: null });
  });

  it('satu repo gagal tidak menggagalkan repo lain; yang gagal tetap memegang nilai lamanya', async () => {
    seedRepos(1, ['baik-a', 'rusak', 'baik-b'], '2026-10-01T00:00:00.000Z');
    const fetcher = createProjectFetcher({
      db,
      concurrency: 1, // berurutan: yang rusak ada di tengah, repo sesudahnya tetap harus diambil
      now: () => NOW,
      git: {
        fetchPrune: async (repo) => {
          if (repo.endsWith('rusak')) {
            throw new CommandFailedError(
              'git fetch',
              128,
              "fatal: '/x' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
            );
          }
        },
      },
    });

    const results = await fetcher.fetchProject(1);

    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['baik-a', true],
      ['rusak', false],
      ['baik-b', true],
    ]);
    expect(results[1]).toMatchObject({
      error: "Fetch gagal: fatal: '/x' does not appear to be a git repository",
      last_fetch_at: '2026-10-01T00:00:00.000Z',
    });
    expect(lastFetchAt()).toEqual({
      'baik-a': '2026-11-01T10:00:00.000Z',
      rusak: '2026-10-01T00:00:00.000Z',
      'baik-b': '2026-11-01T10:00:00.000Z',
    });
  });

  it('kegagalan tanpa baris fatal memakai baris terakhir; tanpa stderr memakai exit code; timeout memakai pesannya', async () => {
    seedRepos(1, ['a', 'b', 'c']);
    const errors: Record<string, Error> = {
      '/repo/1/a': new CommandFailedError('git fetch', 1, 'catatan satu\ncatatan dua\n'),
      '/repo/1/b': new CommandFailedError('git fetch', 7, ''),
      '/repo/1/c': new CommandTimeoutError('git fetch', 120_000, '', ''),
    };
    const fetcher = createProjectFetcher({
      db,
      concurrency: 4,
      git: {
        fetchPrune: async (repo) => {
          throw errors[repo];
        },
      },
    });

    const messages = (await fetcher.fetchProject(1)).map((r) => r.error);

    expect(messages).toEqual([
      'Fetch gagal: catatan dua',
      'Fetch gagal: git keluar dengan kode 7',
      expect.stringContaining('batas waktu 120000 ms'),
    ]);
  });

  it('paling banyak `concurrency` fetch berjalan bersamaan', async () => {
    seedRepos(1, ['1', '2', '3', '4', '5', '6']);
    let running = 0;
    let peak = 0;
    const fetcher = createProjectFetcher({
      db,
      concurrency: 2,
      git: {
        fetchPrune: async () => {
          peak = Math.max(peak, ++running);
          await sleep(15);
          running--;
        },
      },
    });

    const results = await fetcher.fetchProject(1);

    expect(results).toHaveLength(6);
    expect(peak).toBe(2);
  });

  it('project tanpa repo → daftar kosong dan git tidak dipanggil', async () => {
    let calls = 0;
    const fetcher = createProjectFetcher({
      db,
      concurrency: 4,
      git: {
        fetchPrune: async () => {
          calls++;
        },
      },
    });
    expect(await fetcher.fetchProject(1)).toEqual([]);
    expect(calls).toBe(0);
  });
});
