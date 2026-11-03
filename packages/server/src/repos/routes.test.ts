import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ApiErrorEnvelope,
  Repo,
  RepoFetchResult,
  RepoRef,
  ValidationDetails,
  type Project,
} from '@cc/shared';
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
import { createCheckRegistry, type CheckRegistry } from '../runner/registry.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import type { DiscoveryRunner } from './discovery.js';
import { repoRoutes } from './routes.js';

// Tiap POST menjalankan tiga perintah git; di Windows itu beberapa ratus milidetik.
vi.setConfig({ testTimeout: 30_000 });

/** Discovery diuji di discovery.test.ts; di sini dimatikan agar POST repo tidak memulai kerja latar belakang. */
const discovery: DiscoveryRunner = {
  isRunning: () => false,
  start: () => undefined,
  status: (repo) => repo.profile_status,
  profile: () => Promise.reject(new Error('tidak dipakai di test ini')),
  approve: () => Promise.reject(new Error('tidak dipakai di test ini')),
  stop: () => Promise.resolve(),
};

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
let registry: CheckRegistry;

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
  const config = { gitConcurrency: 4 };
  registry = createCheckRegistry();
  const checks = { registry };
  const routes = [
    projectRoutes({ db, workspace, checks }),
    repoRoutes({ db, workspace, git, config, discovery, checks }),
  ];
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

/**
 * Repo yang tidak terhubung ke fixture mana pun: remote bare sendiri + satu klon kerja. Dipakai test yang
 * mengubah remote atau tag, supaya fixture bersama tetap utuh untuk test lain.
 */
function makeIndependentRepo(name: string) {
  const remote = path.join(fixturesTmp, `${name}.git`);
  const work = path.join(fixturesTmp, name);
  rawGit(fixturesTmp, 'clone', '--quiet', '--bare', order().remote, remote);
  rawGit(fixturesTmp, 'clone', '--quiet', remote, work);
  return { remote, work, head: rawGit(work, 'rev-parse', 'HEAD') };
}

describe('GET /api/repos/:id/refs', () => {
  const register = async (localPath: string, extra: Record<string, unknown> = {}) => {
    const project = await newProject();
    const res = await addRepo(project.id, { role: 'service', local_path: localPath, ...extra });
    return res.body as Repo;
  };
  const refs = (id: number) => request(app).get(`/api/repos/${id}/refs`);

  it('branch fixture cocok persis, cabang default paling atas (bukan urutan abjad)', async () => {
    const repo = await register(order().path);

    const res = await refs(repo.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'main', kind: 'branch', sha: order().commits['readme'] },
      { name: 'feature/xyz', kind: 'branch', sha: order().commits['feature-xyz'] },
    ]);
    expect((res.body as unknown[]).map((r) => RepoRef.parse(r))).toHaveLength(2);
  });

  it('mengikuti default_branch yang diubah lewat PATCH', async () => {
    const repo = await register(order().path);
    await request(app).patch(`/api/repos/${repo.id}`).send({ default_branch: 'feature/xyz' });

    const names = ((await refs(repo.id)).body as { name: string }[]).map((r) => r.name);

    expect(names).toEqual(['feature/xyz', 'main']);
  });

  it('tag ikut, sesudah semua branch: ringan dan beranotasi menunjuk commit', async () => {
    const { work, head } = makeIndependentRepo('dengan-tag');
    rawGit(work, 'tag', 'v1.0');
    rawGit(
      work,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@example.com',
      'tag',
      '-a',
      '-m',
      'rilis',
      'v2.0',
    );
    const repo = await register(work);

    const res = await refs(repo.id);

    expect(res.body).toEqual([
      { name: 'main', kind: 'branch', sha: head },
      { name: 'feature/xyz', kind: 'branch', sha: order().commits['feature-xyz'] },
      { name: 'v1.0', kind: 'tag', sha: head },
      { name: 'v2.0', kind: 'tag', sha: head },
    ]);
  });

  it('folder repo sudah dipindah → 409 repo_not_git; id tidak ada → 404; bukan angka → 400', async () => {
    const { work } = makeIndependentRepo('akan-hilang');
    const repo = await register(work);
    await fs.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    const gone = await refs(repo.id);
    expect(gone.status).toBe(409);
    expect(errorOf(gone.body).code).toBe('repo_not_git');

    const missing = await refs(9999);
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('repo_not_found');
    expect((await request(app).get('/api/repos/abc/refs')).status).toBe(400);
  });
});

describe('POST /api/projects/:id/fetch', () => {
  const fetchProject = (id: number) => request(app).post(`/api/projects/${id}/fetch`);
  const lastFetch = (id: number) =>
    (
      db.prepare('SELECT last_fetch_at FROM repos WHERE id = ?').get(id) as {
        last_fetch_at: string | null;
      }
    ).last_fetch_at;

  it('mengisi last_fetch_at tiap repo yang berhasil; working tree fixture tidak berubah', async () => {
    const project = await newProject();
    const a = (await addRepo(project.id, { role: 'service', local_path: order().path }))
      .body as Repo;
    const b = (await addRepo(project.id, { role: 'microfrontend', local_path: mfe().path }))
      .body as Repo;
    expect([a.last_fetch_at, b.last_fetch_at]).toEqual([null, null]);
    const snapshots = [snapshot(order()), snapshot(mfe())];
    const started = Date.now();

    const res = await fetchProject(project.id);

    expect(res.status).toBe(200);
    const results = (res.body as unknown[]).map((r) => RepoFetchResult.parse(r));
    expect(results.map((r) => [r.repo_id, r.name, r.ok, r.error])).toEqual([
      [a.id, 'svc-order', true, null],
      [b.id, 'mfe-dashboard', true, null],
    ]);
    for (const result of results) {
      expect(Date.parse(result.last_fetch_at as string)).toBeGreaterThanOrEqual(started);
      expect(lastFetch(result.repo_id)).toBe(result.last_fetch_at);
    }
    expect([snapshot(order()), snapshot(mfe())]).toEqual(snapshots);
  });

  it('branch baru di remote muncul, yang dihapus di remote dipangkas', async () => {
    const { remote, work, head } = makeIndependentRepo('berubah');
    const project = await newProject();
    const repo = (await addRepo(project.id, { role: 'service', local_path: work })).body as Repo;
    const names = async () =>
      ((await request(app).get(`/api/repos/${repo.id}/refs`)).body as { name: string }[]).map(
        (r) => r.name,
      );
    expect(await names()).toEqual(['main', 'feature/xyz']);

    rawGit(remote, 'update-ref', 'refs/heads/baru', head);
    rawGit(remote, 'update-ref', '-d', 'refs/heads/feature/xyz');
    rawGit(remote, 'update-ref', 'refs/tags/v9', head);
    expect((await fetchProject(project.id)).status).toBe(200);

    expect(await names()).toEqual(['main', 'baru', 'v9']);
  });

  it('satu repo gagal tidak menggagalkan yang lain; last_fetch_at hanya terisi untuk yang berhasil', async () => {
    const { work: broken } = makeIndependentRepo('putus');
    const project = await newProject();
    const bad = (await addRepo(project.id, { role: 'service', local_path: broken })).body as Repo;
    const good = (await addRepo(project.id, { role: 'service', local_path: order().path }))
      .body as Repo;
    // Didaftarkan dulu (validasi lolos), baru remote-nya diputus.
    rawGit(broken, 'remote', 'set-url', 'origin', path.join(fixturesTmp, 'remote-tidak-ada.git'));

    const res = await fetchProject(project.id);

    expect(res.status).toBe(200);
    const [failed, succeeded] = (res.body as unknown[]).map((r) => RepoFetchResult.parse(r));
    expect(failed).toMatchObject({ repo_id: bad.id, ok: false, last_fetch_at: null });
    expect(failed?.error).toMatch(/^Fetch gagal: fatal:/);
    expect(succeeded).toMatchObject({ repo_id: good.id, ok: true, error: null });
    expect(lastFetch(bad.id)).toBeNull();
    expect(lastFetch(good.id)).toBe(succeeded?.last_fetch_at);
  });

  it('repo yang gagal lagi sesudah pernah berhasil menyimpan waktu lamanya', async () => {
    const { work } = makeIndependentRepo('sempat-baik');
    const project = await newProject();
    const repo = (await addRepo(project.id, { role: 'service', local_path: work })).body as Repo;
    const first = (await fetchProject(project.id)).body[0] as RepoFetchResult;
    expect(first.ok).toBe(true);

    rawGit(work, 'remote', 'set-url', 'origin', path.join(fixturesTmp, 'remote-tidak-ada.git'));
    const second = (await fetchProject(project.id)).body[0] as RepoFetchResult;

    expect(second).toMatchObject({ ok: false, last_fetch_at: first.last_fetch_at });
    expect(lastFetch(repo.id)).toBe(first.last_fetch_at);
  });

  it('project tanpa repo → []; project tidak ada → 404; id bukan angka → 400', async () => {
    const project = await newProject();
    const empty = await fetchProject(project.id);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const missing = await fetchProject(9999);
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('project_not_found');
    expect((await request(app).post('/api/projects/abc/fetch')).status).toBe(400);
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
      drafts: [provider, consumer].map((r) => layout.repoProfileDraftFile(project.slug, r.name)),
      caches: [provider, consumer].flatMap((r) => [
        layout.specCacheFile(r.id, 'abcdef1', 'ab12'),
        layout.extractCacheFile(r.id, 'abcdef1', 'pv1'),
      ]),
    };
    for (const file of [files.checkArtifact, ...files.profiles, ...files.drafts, ...files.caches]) {
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
    expect(await exists(files.drafts[0] as string)).toBe(false);
    expect(await exists(files.caches[0] as string)).toBe(false);
    expect(await exists(files.caches[1] as string)).toBe(false);
    // Milik consumer tetap ada.
    expect(await exists(files.profiles[1] as string)).toBe(true);
    expect(await exists(files.drafts[1] as string)).toBe(true);
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

describe('DELETE /api/repos/:id saat check berjalan (G-7)', () => {
  it('409 hanya untuk repo yang dibaca check; repo lain di project yang sama tetap bisa dihapus', async () => {
    const project = await newProject();
    const provider = (await addRepo(project.id, { role: 'service', local_path: order().path }))
      .body as Repo;
    const other = (await addRepo(project.id, { role: 'microfrontend', local_path: mfe().path }))
      .body as Repo;
    registry.add({
      checkId: 1,
      projectId: project.id,
      repoIds: new Set([provider.id]),
      abort: new AbortController(),
      done: Promise.resolve(),
    });

    const blocked = await request(app).delete(`/api/repos/${provider.id}`);
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked.body).code).toBe('check_in_progress');
    expect(count('repos', `id = ${provider.id}`)).toBe(1);

    expect((await request(app).delete(`/api/repos/${other.id}`)).status).toBe(204);

    registry.remove(1);
    expect((await request(app).delete(`/api/repos/${provider.id}`)).status).toBe(204);
  });
});
