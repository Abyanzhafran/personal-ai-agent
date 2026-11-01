import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ApiErrorEnvelope, Repo, ValidationDetails, type Project } from '@cc/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  makeFixtures,
  type FixtureRepo,
  type FixtureSet,
} from '../../../../fixtures/make-fixtures.js';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { createGitAdapter } from '../git/adapter.js';
import { createApp } from '../http/app.js';
import { createLogger } from '../logger.js';
import { createCommandRunner } from '../proc/run-command.js';
import { projectRoutes } from '../projects/routes.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { repoRoutes } from './routes.js';

// Tiap POST menjalankan tiga perintah git; di Windows itu beberapa ratus milidetik.
vi.setConfig({ testTimeout: 30_000 });

const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

/** Keadaan working tree dan HEAD; harus identik sebelum dan sesudah seluruh test. */
const snapshot = (repo: FixtureRepo) => ({
  status: rawGit(repo.path, 'status', '--porcelain=v1', '--ignored'),
  head: rawGit(repo.path, 'rev-parse', 'HEAD'),
});

let fixturesTmp: string;
let fixtures: FixtureSet;
let before: ReturnType<typeof snapshot>[];
/** Repo git tanpa remote `origin`: tidak punya origin/HEAD maupun origin/main. */
let noOrigin: string;

let tmp: string;
let db: Db;
let layout: WorkspaceLayout;
let app: ReturnType<typeof createApp>;

const order = () => fixtures.repos['svc-order'];
const mfe = () => fixtures.repos['mfe-dashboard'];

beforeAll(async () => {
  fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-repos-fx-'));
  fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
  before = Object.values(fixtures.repos).map(snapshot);

  noOrigin = path.join(fixturesTmp, 'tanpa-origin');
  await fs.mkdir(noOrigin);
  rawGit(noOrigin, 'init', '--quiet', '--initial-branch=main');
}, 120_000);

afterAll(async () => {
  try {
    // Menutup AC "repo user tidak berubah": validasi hanya membaca.
    expect(Object.values(fixtures.repos).map(snapshot)).toEqual(before);
  } finally {
    await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-repos-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  const workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  db = openDatabase(':memory:');
  migrate(db);
  const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));
  const routes = [projectRoutes({ db, workspace }), repoRoutes({ db, workspace, git })];
  app = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: (api) => routes.forEach((register) => register(api)),
  });
});

afterEach(async () => {
  db.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const errorOf = (body: unknown) => ApiErrorEnvelope.parse(body).error;
const fieldsOf = (body: unknown) => ValidationDetails.parse(errorOf(body).details).fields;

const newProject = async (name = 'Order Service') =>
  (await request(app).post('/api/projects').send({ name })).body as Project;

const addRepo = (projectId: number, body: unknown) =>
  request(app)
    .post(`/api/projects/${projectId}/repos`)
    .send(body as object);

const count = (table: string, where = '1 = 1') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

describe('POST /api/projects/:id/repos', () => {
  it('menyimpan repo: 201, path kanonik, name dari nama folder, branch dari origin/HEAD', async () => {
    const project = await newProject();
    const res = await addRepo(project.id, { role: 'service', local_path: order().path });

    expect(res.status).toBe(201);
    expect(Repo.parse(res.body)).toEqual({
      id: expect.any(Number),
      project_id: project.id,
      role: 'service',
      name: 'svc-order',
      local_path: await fs.realpath(order().path),
      default_branch: 'main',
      spec_path: null,
      spec_cmd: null,
      profile_status: 'not_scanned',
      profile_error: null,
      last_fetch_at: null,
    });
    expect(db.prepare('SELECT name, default_branch FROM repos').all()).toEqual([
      { name: 'svc-order', default_branch: 'main' },
    ]);
  });

  it('name dan default_branch yang dikirim dipakai; kosong dianggap tidak dikirim', async () => {
    const project = await newProject();
    const named = await addRepo(project.id, {
      role: 'microfrontend',
      local_path: mfe().path,
      name: '  dashboard  ',
      default_branch: 'main',
    });
    expect(named.body).toMatchObject({ name: 'dashboard', default_branch: 'main' });

    const blank = await addRepo(project.id, {
      role: 'service',
      local_path: order().path,
      name: '',
      default_branch: '   ',
    });
    expect(blank.body).toMatchObject({ name: 'svc-order', default_branch: 'main' });
  });

  it('repo e2e disimpan seperti repo lain', async () => {
    const project = await newProject();
    const res = await addRepo(project.id, {
      role: 'e2e',
      local_path: fixtures.repos['e2e-suite'].path,
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('e2e');
  });

  it('path bukan repo git → 400 repo_not_git, tidak ada baris tersimpan', async () => {
    const project = await newProject();
    const plain = await fs.mkdtemp(path.join(tmp, 'folder-biasa-'));

    const res = await addRepo(project.id, { role: 'service', local_path: plain });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('repo_not_git');
    expect(fieldsOf(res.body)).toEqual([
      {
        in: 'body',
        path: 'local_path',
        message: expect.stringContaining(await fs.realpath(plain)),
      },
    ]);
    expect(count('repos')).toBe(0);
  });

  it('origin/<default_branch> tidak ada → 400 branch_not_found menyebut nama branch, tidak tersimpan', async () => {
    const project = await newProject();

    const res = await addRepo(project.id, {
      role: 'service',
      local_path: order().path,
      default_branch: 'tidak-ada',
    });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('branch_not_found');
    expect(errorOf(res.body).message).toContain('tidak-ada');
    expect(fieldsOf(res.body).map((f) => f.path)).toEqual(['default_branch']);
    expect(count('repos')).toBe(0);
  });

  it('branch lokal tanpa padanan di origin tidak dihitung ada', async () => {
    const project = await newProject();
    const res = await addRepo(project.id, {
      role: 'service',
      local_path: noOrigin,
      default_branch: 'main',
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('branch_not_found');
  });

  it('default_branch kosong dan origin/HEAD tidak ada → 400 yang meminta field diisi', async () => {
    const project = await newProject();

    const res = await addRepo(project.id, { role: 'service', local_path: noOrigin });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('validation_failed');
    expect(fieldsOf(res.body)).toEqual([
      { in: 'body', path: 'default_branch', message: expect.stringContaining('Isi nama branch') },
    ]);
    expect(count('repos')).toBe(0);
  });

  it.each([
    ['kosong', '', 'local_path_empty'],
    ['hanya spasi', '   ', 'local_path_empty'],
    ['relatif', 'repo/order', 'local_path_not_absolute'],
    ['tidak ada', path.join(os.tmpdir(), 'cc-tidak-ada-sama-sekali'), 'local_path_missing'],
  ])('local_path %s → 400 %s', async (_label, localPath, code) => {
    const project = await newProject();
    const res = await addRepo(project.id, { role: 'service', local_path: localPath });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe(code);
    expect(fieldsOf(res.body)).toEqual([
      { in: 'body', path: 'local_path', message: errorOf(res.body).message },
    ]);
  });

  it('local_path yang menunjuk berkas → 400 local_path_not_directory', async () => {
    const project = await newProject();
    const file = path.join(order().path, 'README.md');
    const res = await addRepo(project.id, { role: 'service', local_path: file });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('local_path_not_directory');
  });

  it('tanda kutip ganda hasil "Copy as path" dibuang', async () => {
    const project = await newProject();
    const res = await addRepo(project.id, { role: 'service', local_path: `"${order().path}"` });
    expect(res.status).toBe(201);
    expect(res.body.local_path).toBe(await fs.realpath(order().path));
  });

  it('local_path sudah terdaftar di project yang sama → 409 repo_path_taken, apa pun ejaannya', async () => {
    const project = await newProject();
    expect((await addRepo(project.id, { role: 'service', local_path: order().path })).status).toBe(
      201,
    );

    const spellings = [
      order().path,
      `${order().path}${path.sep}`,
      path.join(order().path, 'app', '..'),
    ];
    for (const local_path of spellings) {
      const res = await addRepo(project.id, { role: 'microfrontend', local_path, name: 'lain' });
      expect(res.status).toBe(409);
      expect(errorOf(res.body)).toMatchObject({
        code: 'repo_path_taken',
        message: 'Path sudah terdaftar di project ini',
      });
      expect(fieldsOf(res.body).map((f) => f.path)).toEqual(['local_path']);
    }
    expect(count('repos')).toBe(1);
  });

  it('path yang sama di project lain tetap boleh', async () => {
    const a = await newProject('A');
    const b = await newProject('B');
    expect((await addRepo(a.id, { role: 'service', local_path: order().path })).status).toBe(201);
    expect((await addRepo(b.id, { role: 'service', local_path: order().path })).status).toBe(201);
    expect(count('repos')).toBe(2);
  });

  it('name sudah dipakai repo lain di project yang sama → 409 repo_name_taken, huruf besar-kecil sama', async () => {
    const project = await newProject();
    await addRepo(project.id, { role: 'service', local_path: order().path });

    for (const name of ['svc-order', 'SVC-Order']) {
      const res = await addRepo(project.id, {
        role: 'microfrontend',
        local_path: mfe().path,
        name,
      });
      expect(res.status).toBe(409);
      expect(errorOf(res.body).code).toBe('repo_name_taken');
      expect(errorOf(res.body).message).toContain(name);
      expect(fieldsOf(res.body).map((f) => f.path)).toEqual(['name']);
    }
    expect(count('repos')).toBe(1);

    // Nama yang sama di project lain tidak bentrok, dan nama lain di project ini lolos.
    const other = await newProject('Lain');
    expect(
      (await addRepo(other.id, { role: 'service', local_path: order().path, name: 'svc-order' }))
        .status,
    ).toBe(201);
    expect(
      (await addRepo(project.id, { role: 'microfrontend', local_path: mfe().path })).status,
    ).toBe(201);
  });

  it('name default yang bentrok dengan repo lain minta name diisi, tanpa menyimpan apa pun', async () => {
    const project = await newProject();
    const copy = path.join(fixturesTmp, 'salinan', 'svc-order');
    await fs.mkdir(path.dirname(copy), { recursive: true });
    await fs.cp(order().path, copy, { recursive: true });
    await addRepo(project.id, { role: 'service', local_path: order().path });

    const clash = await addRepo(project.id, { role: 'service', local_path: copy });
    expect(clash.status).toBe(409);
    expect(errorOf(clash.body).code).toBe('repo_name_taken');

    const named = await addRepo(project.id, {
      role: 'service',
      local_path: copy,
      name: 'svc-copy',
    });
    expect(named.status).toBe(201);
  });

  it.each(['a/b', 'a\\b', 'x:y', 'ujung.', '..'])(
    'name %j tidak bisa jadi nama file profil → 400 di field name',
    async (name) => {
      const project = await newProject();
      const res = await addRepo(project.id, { role: 'service', local_path: order().path, name });
      expect(res.status).toBe(400);
      expect(errorOf(res.body).code).toBe('validation_failed');
      expect(fieldsOf(res.body).map((f) => f.path)).toEqual(['name']);
      expect(count('repos')).toBe(0);
    },
  );

  it('role salah atau local_path tidak dikirim → 400 per field; project tidak ada → 404', async () => {
    const project = await newProject();
    const bad = await addRepo(project.id, { role: 'admin' });
    expect(bad.status).toBe(400);
    expect(fieldsOf(bad.body)).toEqual([
      {
        in: 'body',
        path: 'role',
        message: 'Peran repo harus salah satu dari: service, microfrontend, e2e',
      },
      { in: 'body', path: 'local_path', message: 'Path folder repo wajib diisi' },
    ]);

    const missing = await addRepo(9999, { role: 'service', local_path: order().path });
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('project_not_found');

    expect((await addRepo('abc' as unknown as number, {})).status).toBe(400);
    expect(count('repos')).toBe(0);
  });
});

describe('PATCH /api/repos/:id', () => {
  const register = async (extra: Record<string, unknown> = {}) => {
    const project = await newProject();
    const res = await addRepo(project.id, {
      role: 'service',
      local_path: order().path,
      ...extra,
    });
    return res.body as Repo;
  };

  const patch = (id: number | string, body: unknown) =>
    request(app)
      .patch(`/api/repos/${id}`)
      .send(body as object);

  it('mengubah peran, branch, spec_path, dan spec_cmd; yang tidak dikirim tetap', async () => {
    const repo = await register();

    const res = await patch(repo.id, {
      role: 'microfrontend',
      default_branch: 'feature/xyz',
      spec_path: ' openapi.json ',
      spec_cmd: 'node scripts/export-openapi.mjs',
    });
    expect(res.status).toBe(200);
    expect(Repo.parse(res.body)).toEqual({
      ...repo,
      role: 'microfrontend',
      default_branch: 'feature/xyz',
      spec_path: 'openapi.json',
      spec_cmd: 'node scripts/export-openapi.mjs',
    });

    const onlyRole = await patch(repo.id, { role: 'service' });
    expect(onlyRole.body).toMatchObject({
      role: 'service',
      default_branch: 'feature/xyz',
      spec_path: 'openapi.json',
    });
  });

  it('spec_path dan spec_cmd dikosongkan lewat string kosong atau null', async () => {
    const repo = await register();
    await patch(repo.id, { spec_path: 'a.json', spec_cmd: 'x' });
    const res = await patch(repo.id, { spec_path: '', spec_cmd: null });
    expect(res.body).toMatchObject({ spec_path: null, spec_cmd: null });
  });

  it('body kosong tidak mengubah apa pun; name dan local_path tidak bisa diubah', async () => {
    const repo = await register();
    expect((await patch(repo.id, {})).body).toEqual(repo);
    const res = await patch(repo.id, { name: 'baru', local_path: mfe().path });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(repo);
  });

  it('branch yang tidak ada di origin → 400 branch_not_found, tidak ada isian yang berubah', async () => {
    const repo = await register();

    const res = await patch(repo.id, { role: 'e2e', default_branch: 'tidak-ada' });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('branch_not_found');
    expect(errorOf(res.body).message).toContain('tidak-ada');
    expect(db.prepare('SELECT role, default_branch FROM repos').get()).toEqual({
      role: 'service',
      default_branch: 'main',
    });
  });

  it('default_branch kosong → 400; peran atau spec tanpa branch tidak menyentuh git', async () => {
    const repo = await register();
    const empty = await patch(repo.id, { default_branch: '  ' });
    expect(empty.status).toBe(400);
    expect(fieldsOf(empty.body)).toEqual([
      { in: 'body', path: 'default_branch', message: 'Branch default tidak boleh kosong' },
    ]);

    // Folder repo hilang: hanya perubahan branch yang butuh git, jadi yang lain tetap berhasil.
    const gone = await fs.mkdtemp(path.join(tmp, 'pindah-'));
    db.prepare('UPDATE repos SET local_path = ? WHERE id = ?').run(gone, repo.id);
    expect((await patch(repo.id, { spec_cmd: 'make spec' })).status).toBe(200);

    const moved = await patch(repo.id, { default_branch: 'main' });
    expect(moved.status).toBe(400);
    expect(errorOf(moved.body).code).toBe('repo_not_git');
    expect(fieldsOf(moved.body).map((f) => f.path)).toEqual(['default_branch']);
  });

  it('id tidak ada → 404 repo_not_found; id bukan angka → 400', async () => {
    const res = await patch(9999, { role: 'service' });
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('repo_not_found');
    expect((await patch('abc', {})).status).toBe(400);
  });
});

describe('DELETE /api/repos/:id', () => {
  /** Dua repo; satu check dengan `provider` sebagai provider dan satu finding yang menunjuk `consumer`. */
  async function seed() {
    const project = await newProject();
    const provider = (await addRepo(project.id, { role: 'service', local_path: order().path }))
      .body as Repo;
    const consumer = (await addRepo(project.id, { role: 'microfrontend', local_path: mfe().path }))
      .body as Repo;

    const checkId = Number(
      db
        .prepare(
          `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at)
           VALUES (?, ?, 'main', 'feature/xyz', '2026-11-01T00:00:00Z')`,
        )
        .run(project.id, provider.id).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO findings (check_id, endpoint, consumer_repo_id, kind, severity, detail)
       VALUES (?, 'GET /orders', ?, 'removed', 'break', 'field dihapus')`,
    ).run(checkId, consumer.id);

    const files = {
      checkDir: layout.checkRunDir(checkId),
      checkArtifact: layout.checkArtifact(checkId, 'spec-base.json'),
      profiles: [provider, consumer].map((r) => layout.repoProfileFile(project.slug, r.name)),
      caches: [provider, consumer].flatMap((r) => [
        layout.specCacheFile(r.id, 'abcdef1', 'ab12'),
        layout.extractCacheFile(r.id, 'abcdef1', 'pv1'),
      ]),
    };
    for (const file of [files.checkArtifact, ...files.profiles, ...files.caches]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '{}');
    }
    return { project, provider, consumer, checkId, files };
  }

  it('menghapus baris repo, profil, cache, serta check provider-nya; repo lain tidak disentuh', async () => {
    const { provider, consumer, files } = await seed();

    const res = await request(app).delete(`/api/repos/${provider.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(db.prepare('SELECT id FROM repos').all()).toEqual([{ id: consumer.id }]);
    // Check provider dan finding-nya ikut terhapus lewat cascade, begitu pula folder run-nya.
    expect([count('checks'), count('findings')]).toEqual([0, 0]);
    expect(await exists(files.checkDir)).toBe(false);
    expect(await exists(files.profiles[0] as string)).toBe(false);
    expect(await exists(files.caches[0] as string)).toBe(false);
    expect(await exists(files.caches[1] as string)).toBe(false);
    // Milik consumer tetap ada.
    expect(await exists(files.profiles[1] as string)).toBe(true);
    expect(await exists(files.caches[2] as string)).toBe(true);
  });

  it('menghapus repo konsumen membuang finding-nya saja; check provider tetap', async () => {
    const { consumer, files } = await seed();

    expect((await request(app).delete(`/api/repos/${consumer.id}`)).status).toBe(204);

    expect([count('repos'), count('checks'), count('findings')]).toEqual([1, 1, 0]);
    expect(await exists(files.checkArtifact)).toBe(true);
    expect(await exists(files.profiles[1] as string)).toBe(false);
    expect(await exists(files.profiles[0] as string)).toBe(true);
  });

  it('folder repo di disk user tidak disentuh', async () => {
    const { provider } = await seed();
    expect((await request(app).delete(`/api/repos/${provider.id}`)).status).toBe(204);
    expect(await exists(path.join(order().path, '.git'))).toBe(true);
    expect(rawGit(order().path, 'status', '--porcelain=v1')).toBe('');
  });

  it('repo tanpa berkas apa pun bisa dihapus; id tidak ada atau sudah dihapus → 404; bukan angka → 400', async () => {
    const project = await newProject();
    const { body } = await addRepo(project.id, { role: 'service', local_path: order().path });

    expect((await request(app).delete(`/api/repos/${body.id}`)).status).toBe(204);
    const again = await request(app).delete(`/api/repos/${body.id}`);
    expect(again.status).toBe(404);
    expect(errorOf(again.body).code).toBe('repo_not_found');
    expect((await request(app).delete('/api/repos/abc')).status).toBe(400);
  });

  it('path dan nama yang sama bisa didaftarkan lagi sesudah dihapus', async () => {
    const project = await newProject();
    const first = (await addRepo(project.id, { role: 'service', local_path: order().path })).body;
    await request(app).delete(`/api/repos/${first.id}`);
    expect((await addRepo(project.id, { role: 'service', local_path: order().path })).status).toBe(
      201,
    );
  });
});
