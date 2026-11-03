import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ApiErrorEnvelope,
  ProjectRepo,
  RepoProfile,
  RepoProfileResponse,
  ValidationDetails,
  type Project,
  type Repo,
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
import { parseConfig } from '../config.js';
import { createGitAdapter } from '../git/adapter.js';
import { createApp } from '../http/app.js';
import { createLlmClient, type LlmClient, type LlmPrompt } from '../llm/client.js';
import { DISCOVERY_PROMPT_VERSION, DiscoveryOutput } from '../llm/discovery.prompt.js';
import { createLogger } from '../logger.js';
import { createCommandRunner } from '../proc/run-command.js';
import { projectRoutes } from '../projects/routes.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { createDiscoveryRunner, type DiscoveryRunner } from './discovery.js';
import { createRepoRepository } from './repository.js';
import { repoRoutes } from './routes.js';

// Tiap POST menjalankan beberapa perintah git, dan discovery membaca repo fixture sungguhan.
vi.setConfig({ testTimeout: 30_000 });

const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

/** Keadaan working tree dan HEAD; harus identik sebelum dan sesudah seluruh test. */
const snapshot = (repo: FixtureRepo) => ({
  status: rawGit(repo.path, 'status', '--porcelain=v1', '--ignored'),
  head: rawGit(repo.path, 'rev-parse', 'HEAD'),
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface CallInput {
  prompt: LlmPrompt;
  schema: unknown;
  signal?: AbortSignal;
}

const PROFILE = {
  profile_md: 'Service pesanan berbasis FastAPI.',
  spec_path: 'openapi.json',
  spec_cmd: 'node scripts/export-openapi.mjs',
  handler_dirs: ['app/routers'],
  http_client: null,
  base_url_pattern: null,
};

/** Menahan panggilan Claude sampai `open()`; abort (stop) menolaknya supaya teardown tidak menggantung. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const call = ({ signal }: CallInput) =>
    new Promise<unknown>((resolve, reject) => {
      // Signal yang sudah ter-abort tidak memicu listener; tolak langsung supaya stop() tidak menggantung.
      if (signal?.aborted) return reject(new Error('dibatalkan'));
      signal?.addEventListener('abort', () => reject(new Error('dibatalkan')));
      void opened.then(() => resolve(PROFILE));
    });
  return { open, call };
}

let fixturesTmp: string;
let fixtures: FixtureSet;
let before: ReturnType<typeof snapshot>[];

let tmp: string;
let db: Db;
let workspace: WorkspaceStore;
let layout: WorkspaceLayout;
let app: ReturnType<typeof createApp>;
let discovery: DiscoveryRunner;
let callJson: ReturnType<typeof makeCallJson>;
let teardown: (() => Promise<void>) | undefined;

const makeCallJson = () =>
  vi.fn<(input: CallInput) => Promise<unknown>>().mockResolvedValue(PROFILE);

beforeAll(async () => {
  fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-discovery-fx-'));
  fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
  before = Object.values(fixtures.repos).map(snapshot);
}, 120_000);

afterAll(async () => {
  try {
    // Discovery hanya membaca repo user (ls-tree dan show).
    expect(Object.values(fixtures.repos).map(snapshot)).toEqual(before);
  } finally {
    await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** Membangun ulang app dengan Claude palsu; bisa dipanggil lagi di dalam test untuk mengganti `LLM_CONCURRENCY`. */
async function boot(llmConcurrency = 4) {
  await teardown?.();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-discovery-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  db = openDatabase(':memory:');
  migrate(db);
  callJson = makeCallJson();
  const llm = { callJson } as unknown as LlmClient;
  const config = { gitConcurrency: 4, llmConcurrency };
  const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));
  const logger = createLogger({ level: 'silent' });
  discovery = createDiscoveryRunner({ db, workspace, git, llm, logger, config });
  const routes = [
    projectRoutes({ db, workspace }),
    repoRoutes({ db, workspace, git, config, discovery }),
  ];
  app = createApp({ logger, registerRoutes: (api) => routes.forEach((register) => register(api)) });
  const closing = { db, tmp, discovery };
  teardown = async () => {
    await closing.discovery.stop();
    closing.db.close();
    await fs.rm(closing.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
}

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await teardown?.();
  teardown = undefined;
});

const errorOf = (body: unknown) => ApiErrorEnvelope.parse(body).error;

const newProject = async () =>
  (await request(app).post('/api/projects').send({ name: 'Order Service' })).body as Project;

const addRepo = (projectId: number, name: keyof FixtureSet['repos'], role: Repo['role']) =>
  request(app)
    .post(`/api/projects/${projectId}/repos`)
    .send({ role, local_path: fixtures.repos[name].path });

const getProfile = (id: number | string) => request(app).get(`/api/repos/${id}/profile`);
const rescan = (id: number | string) => request(app).post(`/api/repos/${id}/discovery`);

/** Menunggu job repo itu selesai seluruhnya (termasuk tulis DB); `runner` default job aplikasi. */
const settled = (id: number, runner: Pick<DiscoveryRunner, 'isRunning'> = discovery) =>
  vi.waitFor(() => expect(runner.isRunning(id)).toBe(false), { timeout: 20_000, interval: 20 });

/** Menunggu Claude palsu dipanggil sekali (pengumpulan input lewat git sungguhan bisa lambat saat mesin sibuk). */
const called = () =>
  vi.waitFor(() => expect(callJson).toHaveBeenCalledTimes(1), { timeout: 20_000, interval: 20 });

const row = (id: number) =>
  db.prepare('SELECT profile_status, profile_error FROM repos WHERE id = ?').get(id);

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

describe('discovery otomatis setelah POST /api/projects/:id/repos', () => {
  it('POST membalas 201 sebelum discovery selesai; sedang dipindai → menunggu review, draf tertulis', async () => {
    const hold = gate();
    callJson.mockImplementationOnce(hold.call);
    const project = await newProject();

    const created = await addRepo(project.id, 'svc-order', 'service');
    const repo = created.body as Repo;

    // Claude belum menjawab, tetapi POST sudah selesai.
    expect(created.status).toBe(201);
    expect(RepoProfileResponse.parse((await getProfile(repo.id)).body)).toEqual({
      status: 'scanning',
      error: null,
      profile: null,
    });
    // "Sedang dipindai" tidak disimpan di DB.
    expect(row(repo.id)).toEqual({ profile_status: 'not_scanned', profile_error: null });

    await called();
    const call = callJson.mock.calls[0]?.[0] as CallInput;
    expect(call.schema).toBe(DiscoveryOutput);
    expect(call.prompt.version).toBe(DISCOVERY_PROMPT_VERSION);
    // Prompt dibangun dari repo sungguhan (origin/main), bukan data kosong.
    expect(call.prompt.user).toContain('app/routers/orders.py');

    hold.open();
    await settled(repo.id);

    expect(row(repo.id)).toEqual({ profile_status: 'pending_review', profile_error: null });
    expect(RepoProfileResponse.parse((await getProfile(repo.id)).body)).toEqual({
      status: 'pending_review',
      error: null,
      profile: PROFILE,
    });
    const draft = layout.repoProfileDraftFile(project.slug, 'svc-order');
    expect(JSON.parse(await fs.readFile(draft, 'utf8'))).toEqual(PROFILE);
  });

  it('repo e2e tidak pernah dipindai dan tidak memanggil Claude', async () => {
    const project = await newProject();
    const service = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    const e2e = (await addRepo(project.id, 'e2e-suite', 'e2e')).body as Repo;
    await settled(service.id);

    expect(RepoProfileResponse.parse((await getProfile(e2e.id)).body)).toEqual({
      status: 'skipped',
      error: null,
      profile: null,
    });
    const manual = await rescan(e2e.id);
    expect(manual.status).toBe(409);
    expect(errorOf(manual.body).code).toBe('discovery_not_applicable');
    expect(row(e2e.id)).toEqual({ profile_status: 'not_scanned', profile_error: null });
    // Satu-satunya panggilan datang dari repo service.
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it('microfrontend ikut dipindai', async () => {
    const project = await newProject();
    const mfe = (await addRepo(project.id, 'mfe-dashboard', 'microfrontend')).body as Repo;
    await settled(mfe.id);
    expect(row(mfe.id)).toEqual({ profile_status: 'pending_review', profile_error: null });
  });
});

describe('GET /api/repos/:id', () => {
  it('mengembalikan repo itu (termasuk project_id); id tidak ada → 404, bukan angka → 400', async () => {
    const project = await newProject();
    const created = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;

    const found = await request(app).get(`/api/repos/${created.id}`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ id: created.id, project_id: project.id, name: 'svc-order' });

    const missing = await request(app).get('/api/repos/999');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('repo_not_found');
    expect((await request(app).get('/api/repos/abc')).status).toBe(400);
  });
});

describe('GET /api/projects/:id/repos', () => {
  const list = (projectId: number | string) => request(app).get(`/api/projects/${projectId}/repos`);
  const statuses = async (projectId: number) =>
    ProjectRepo.array()
      .parse((await list(projectId)).body)
      .map((r) => [r.name, r.profile_status]);

  it('mengembalikan repo project urut id dengan status turunan: scanning, pending_review, skipped', async () => {
    const hold = gate();
    callJson.mockImplementationOnce(hold.call);
    const project = await newProject();
    const service = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await addRepo(project.id, 'e2e-suite', 'e2e');
    const other = await newProject();
    await addRepo(other.id, 'mfe-dashboard', 'microfrontend');

    // Claude belum menjawab: DB masih `not_scanned`, daftar sudah menyebut `scanning`.
    expect(await statuses(project.id)).toEqual([
      ['svc-order', 'scanning'],
      ['e2e-suite', 'skipped'],
    ]);

    hold.open();
    await settled(service.id);
    expect(await statuses(project.id)).toEqual([
      ['svc-order', 'pending_review'],
      ['e2e-suite', 'skipped'],
    ]);
  });

  it('project tanpa repo → []; project yang tidak ada → 404 project_not_found', async () => {
    const project = await newProject();
    expect((await list(project.id)).body).toEqual([]);

    const missing = await list(999);
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('project_not_found');
  });
});

describe('gagal dan pindai ulang', () => {
  it('gagal → belum dipindai + pesan satu baris tersimpan; Pindai ulang tetap bisa dan menghapus galat', async () => {
    callJson.mockRejectedValueOnce(
      new Error('Respons Claude tidak sesuai skema\nprofile_md: kosong'),
    );
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await settled(repo.id);

    const message = 'Respons Claude tidak sesuai skema profile_md: kosong';
    expect(row(repo.id)).toEqual({ profile_status: 'not_scanned', profile_error: message });
    expect(RepoProfileResponse.parse((await getProfile(repo.id)).body)).toEqual({
      status: 'not_scanned',
      error: message,
      profile: null,
    });
    expect(await exists(layout.repoProfileDraftFile(project.slug, 'svc-order'))).toBe(false);

    const again = await rescan(repo.id);
    expect(again.status).toBe(202);
    expect(RepoProfileResponse.parse(again.body).status).toBe('scanning');
    await settled(repo.id);
    expect(row(repo.id)).toEqual({ profile_status: 'pending_review', profile_error: null });
  });

  it('klien Claude sungguhan tanpa ANTHROPIC_API_KEY: gagal dengan pesan yang menyebut variabelnya, tanpa jaringan', async () => {
    const config = parseConfig({ ANTHROPIC_MODEL: 'm' }, { homedir: os.homedir() });
    const logger = createLogger({ level: 'silent' });
    const real = createDiscoveryRunner({
      db,
      workspace,
      git: createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' })),
      llm: createLlmClient({ config, logger }),
      logger,
      config,
    });
    const project = await newProject();
    const result = createRepoRepository(db).create({
      projectId: project.id,
      role: 'service',
      name: 'svc-order',
      localPath: fixtures.repos['svc-order'].path,
      defaultBranch: 'main',
    });
    if (!('repo' in result)) throw new Error('repo gagal dibuat');

    real.start(result.repo);
    await settled(result.repo.id, real);

    const { profile_status, profile_error } = row(result.repo.id) as {
      profile_status: string;
      profile_error: string;
    };
    expect(profile_status).toBe('not_scanned');
    expect(profile_error).toContain('ANTHROPIC_API_KEY');
  });

  it('pindai ulang yang gagal membuat repo menunggu review kembali ke belum dipindai', async () => {
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await settled(repo.id);
    expect(row(repo.id)).toMatchObject({ profile_status: 'pending_review' });

    callJson.mockRejectedValueOnce(new Error('API sibuk'));
    await rescan(repo.id);
    await settled(repo.id);

    expect(row(repo.id)).toEqual({ profile_status: 'not_scanned', profile_error: 'API sibuk' });
    // Draf lama tidak ditampilkan untuk repo yang kembali belum dipindai.
    expect((await getProfile(repo.id)).body).toMatchObject({
      status: 'not_scanned',
      profile: null,
    });
  });

  it('repo approved: pindai ulang boleh; gagal mempertahankan approved, berhasil → menunggu review', async () => {
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await settled(repo.id);
    db.prepare("UPDATE repos SET profile_status = 'approved' WHERE id = ?").run(repo.id);

    callJson.mockRejectedValueOnce(new Error('API sibuk'));
    expect((await rescan(repo.id)).status).toBe(202);
    await settled(repo.id);
    expect(row(repo.id)).toEqual({ profile_status: 'approved', profile_error: 'API sibuk' });
    // Draf yang disetujui tetap terbaca.
    expect(RepoProfileResponse.parse((await getProfile(repo.id)).body)).toEqual({
      status: 'approved',
      error: 'API sibuk',
      profile: PROFILE,
    });

    await rescan(repo.id);
    await settled(repo.id);
    expect(row(repo.id)).toEqual({ profile_status: 'pending_review', profile_error: null });
  });

  it('discovery yang sedang berjalan → 409; id tidak ada → 404; bukan angka → 400', async () => {
    const hold = gate();
    callJson.mockImplementationOnce(hold.call);
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;

    const busy = await rescan(repo.id);
    expect(busy.status).toBe(409);
    expect(errorOf(busy.body).code).toBe('discovery_in_progress');

    for (const call of [getProfile(9999), rescan(9999)]) {
      const res = await call;
      expect(res.status).toBe(404);
      expect(errorOf(res.body).code).toBe('repo_not_found');
    }
    expect((await getProfile('abc')).status).toBe(400);
    expect((await rescan('abc')).status).toBe(400);

    hold.open();
    await settled(repo.id);
  });

  it('draf yang rusak dibaca sebagai profile null, bukan 500', async () => {
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await settled(repo.id);
    await fs.writeFile(layout.repoProfileDraftFile(project.slug, 'svc-order'), 'bukan json');

    const res = await getProfile(repo.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending_review', error: null, profile: null });
  });
});

describe('antrean dan siklus hidup job', () => {
  it('LLM_CONCURRENCY membatasi panggilan Claude yang berjalan bersamaan', async () => {
    await boot(1);
    // Git palsu: pengumpulan input selesai seketika, jadi ketiga job sudah menunggu giliran Claude.
    const git = {
      lsTree: () => Promise.resolve([{ mode: '100644', type: 'blob', sha: 'x', path: 'a.txt' }]),
      show: () => Promise.resolve(''),
    };
    const llm = { callJson } as unknown as LlmClient;
    const logger = createLogger({ level: 'silent' });
    const fast = createDiscoveryRunner({
      db,
      workspace,
      git,
      llm,
      logger,
      config: { gitConcurrency: 4, llmConcurrency: 1 },
    });
    const hold = gate();
    let running = 0;
    let peak = 0;
    callJson.mockImplementation(async (input) => {
      peak = Math.max(peak, ++running);
      try {
        return await hold.call(input);
      } finally {
        running--;
      }
    });

    try {
      const project = await newProject();
      const repos = createRepoRepository(db);
      const created = ['a', 'b', 'c'].map((name) => {
        const result = repos.create({
          projectId: project.id,
          role: 'service',
          name,
          localPath: `/tidak/dipakai/${name}`,
          defaultBranch: 'main',
        });
        if (!('repo' in result)) throw new Error('repo gagal dibuat');
        return result.repo;
      });
      created.forEach((repo) => fast.start(repo));

      await sleep(50);
      expect(callJson).toHaveBeenCalledTimes(1);

      hold.open();
      await Promise.all(created.map((repo) => settled(repo.id, fast)));
      expect(callJson).toHaveBeenCalledTimes(3);
      expect(peak).toBe(1);
      expect(created.map((repo) => row(repo.id))).toEqual(
        created.map(() => ({ profile_status: 'pending_review', profile_error: null })),
      );
    } finally {
      await fast.stop();
    }
  });

  it('repo yang dihapus selagi dipindai tidak meninggalkan draf yatim', async () => {
    const hold = gate();
    callJson.mockImplementationOnce(hold.call);
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await called();

    expect((await request(app).delete(`/api/repos/${repo.id}`)).status).toBe(204);
    hold.open();
    await settled(repo.id);

    expect(await exists(layout.repoProfileDraftFile(project.slug, 'svc-order'))).toBe(false);
  });

  it('menghapus repo membuang drafnya; repo lain tetap', async () => {
    const project = await newProject();
    const order = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    const mfe = (await addRepo(project.id, 'mfe-dashboard', 'microfrontend')).body as Repo;
    await Promise.all([settled(order.id), settled(mfe.id)]);

    expect((await request(app).delete(`/api/repos/${order.id}`)).status).toBe(204);

    expect(await exists(layout.repoProfileDraftFile(project.slug, 'svc-order'))).toBe(false);
    expect(await exists(layout.repoProfileDraftFile(project.slug, 'mfe-dashboard'))).toBe(true);
  });

  it('stop() membatalkan panggilan Claude dan kegagalan karena shutdown tidak dicatat', async () => {
    callJson.mockImplementationOnce(gate().call);
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await called();

    await discovery.stop();

    expect(discovery.isRunning(repo.id)).toBe(false);
    expect((callJson.mock.calls[0]?.[0] as CallInput).signal?.aborted).toBe(true);
    expect(row(repo.id)).toEqual({ profile_status: 'not_scanned', profile_error: null });
  });
});

describe('PUT /api/repos/:id/profile (menyetujui profil)', () => {
  const DRAFT = { ...PROFILE, http_client: 'axios', base_url_pattern: 'VITE_API_BASE_URL' };

  const approve = (id: number | string, body: unknown) =>
    request(app)
      .put(`/api/repos/${id}/profile`)
      .send(body as object);

  /** Repo service yang discovery-nya sudah selesai (menunggu review) dengan DRAFT. */
  async function scanned() {
    callJson.mockResolvedValueOnce(DRAFT);
    const project = await newProject();
    const repo = (await addRepo(project.id, 'svc-order', 'service')).body as Repo;
    await settled(repo.id);
    return {
      project,
      repo,
      mdFile: layout.repoProfileFile(project.slug, 'svc-order'),
      jsonFile: layout.repoProfileDraftFile(project.slug, 'svc-order'),
    };
  }

  /** Pindai ulang dengan `draft` sebagai jawaban Claude, lalu tunggu selesai. */
  async function rescanWith(id: number, draft: unknown) {
    callJson.mockResolvedValueOnce(draft);
    expect((await rescan(id)).status).toBe(202);
    await settled(id);
  }

  const repoRow = (id: number) =>
    db
      .prepare('SELECT profile_status, profile_error, spec_path, spec_cmd FROM repos WHERE id = ?')
      .get(id);

  it('.md persis seperti dikirim (hasil edit user); .json memuat nilai yang disetujui dan sisanya dari draf; DB approved', async () => {
    const { repo, mdFile, jsonFile } = await scanned();
    const md = '# Svc order (hasil edit)\n\n- baris dengan spasi di ujung  \n\n';

    const res = await approve(repo.id, {
      profile_md: md,
      apply_spec_path: true,
      spec_cmd: ' make spec ',
    });

    expect(res.status).toBe(200);
    const approved = { ...DRAFT, profile_md: md, spec_path: 'openapi.json', spec_cmd: 'make spec' };
    expect(RepoProfileResponse.parse(res.body)).toEqual({
      status: 'approved',
      error: null,
      profile: approved,
    });
    expect(await fs.readFile(mdFile, 'utf8')).toBe(md);
    // handler_dirs, http_client, dan base_url_pattern tidak ada di request: semuanya dari draf.
    expect(JSON.parse(await fs.readFile(jsonFile, 'utf8'))).toEqual(approved);
    expect(repoRow(repo.id)).toEqual({
      profile_status: 'approved',
      profile_error: null,
      spec_path: 'openapi.json',
      spec_cmd: 'make spec',
    });
    expect((await getProfile(repo.id)).body).toEqual(res.body);
  });

  it('menyetujui dua kali menimpa berkas tanpa menduplikasi isi atau meninggalkan sisa', async () => {
    const { repo, mdFile } = await scanned();

    await approve(repo.id, { profile_md: 'versi satu\nbaris dua', apply_spec_path: false });
    const second = await approve(repo.id, { profile_md: '# Versi dua', apply_spec_path: false });

    expect(second.status).toBe(200);
    expect(await fs.readFile(mdFile, 'utf8')).toBe('# Versi dua');
    expect((await fs.readdir(path.dirname(mdFile))).sort()).toEqual([
      'svc-order.json',
      'svc-order.md',
    ]);
    expect((await getProfile(repo.id)).body).toMatchObject({
      status: 'approved',
      profile: { profile_md: '# Versi dua', handler_dirs: DRAFT.handler_dirs },
    });
  });

  it('apply_spec_path: false tidak mengubah spec_path; true menyalin dari draf, tetapi draf null tidak menimpa', async () => {
    const { repo } = await scanned();
    db.prepare("UPDATE repos SET spec_path = 'docs/spec.yaml' WHERE id = ?").run(repo.id);

    await approve(repo.id, { profile_md: 'x', apply_spec_path: false });
    expect(repoRow(repo.id)).toMatchObject({ spec_path: 'docs/spec.yaml' });

    await rescanWith(repo.id, { ...DRAFT, spec_path: null });
    await approve(repo.id, { profile_md: 'x', apply_spec_path: true });
    expect(repoRow(repo.id)).toMatchObject({ spec_path: 'docs/spec.yaml' });

    await rescanWith(repo.id, { ...DRAFT, spec_path: 'openapi.json' });
    await approve(repo.id, { profile_md: 'x', apply_spec_path: true });
    expect(repoRow(repo.id)).toMatchObject({ spec_path: 'openapi.json' });
  });

  it('spec_cmd kosong disimpan null (bukan string kosong); tidak dikirim tidak mengubah', async () => {
    const { repo } = await scanned();
    const body = { profile_md: 'x', apply_spec_path: false };

    await approve(repo.id, { ...body, spec_cmd: 'make spec' });
    await approve(repo.id, body);
    expect(repoRow(repo.id)).toMatchObject({ spec_cmd: 'make spec' });

    for (const empty of ['', '   ', null]) {
      await approve(repo.id, { ...body, spec_cmd: 'ada isinya' });
      const res = await approve(repo.id, { ...body, spec_cmd: empty });
      expect(repoRow(repo.id)).toMatchObject({ spec_cmd: null });
      expect((res.body as RepoProfileResponse).profile?.spec_cmd).toBeNull();
    }
  });

  it('ditolak 409 bila belum ada draf (termasuk draf lama setelah pindai ulang gagal), tanpa menulis apa pun', async () => {
    const { repo, project } = await scanned();
    callJson.mockRejectedValueOnce(new Error('API sibuk'));
    await rescan(repo.id);
    await settled(repo.id);
    expect(row(repo.id)).toMatchObject({ profile_status: 'not_scanned' });

    const res = await approve(repo.id, { profile_md: 'x', apply_spec_path: true, spec_cmd: 'a' });

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('profile_not_ready');
    expect(await exists(layout.repoProfileFile(project.slug, 'svc-order'))).toBe(false);
    expect(repoRow(repo.id)).toEqual({
      profile_status: 'not_scanned',
      profile_error: 'API sibuk',
      spec_path: null,
      spec_cmd: null,
    });
  });

  it('ditolak 409 saat discovery berjalan atau repo e2e; 404 bila repo tidak ada; 400 untuk body salah', async () => {
    const { project, repo } = await scanned();
    const hold = gate();
    callJson.mockImplementationOnce(hold.call);
    await rescan(repo.id);
    const busy = await approve(repo.id, { profile_md: 'x', apply_spec_path: false });
    expect(busy.status).toBe(409);
    expect(errorOf(busy.body).code).toBe('discovery_in_progress');
    hold.open();
    await settled(repo.id);

    const e2e = (await addRepo(project.id, 'e2e-suite', 'e2e')).body as Repo;
    const skipped = await approve(e2e.id, { profile_md: 'x', apply_spec_path: false });
    expect(skipped.status).toBe(409);
    expect(errorOf(skipped.body).code).toBe('discovery_not_applicable');

    const missing = await approve(9999, { profile_md: 'x', apply_spec_path: false });
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('repo_not_found');

    const invalid = await approve(repo.id, { profile_md: '  ', apply_spec_path: 'ya' });
    expect(invalid.status).toBe(400);
    expect(
      ValidationDetails.parse(errorOf(invalid.body).details).fields.map((f) => [f.in, f.path]),
    ).toEqual([
      ['body', 'profile_md'],
      ['body', 'apply_spec_path'],
    ]);
  });
});

describe('RepoProfile (shared) sejalan dengan DiscoveryOutput (server)', () => {
  it('menerima apa pun yang diloloskan DiscoveryOutput', () => {
    const allNull = {
      profile_md: 'x',
      spec_path: null,
      spec_cmd: null,
      handler_dirs: [],
      http_client: null,
      base_url_pattern: null,
    };
    for (const sample of [PROFILE, allNull]) {
      expect(RepoProfile.parse(DiscoveryOutput.parse(sample))).toEqual(sample);
    }
  });
});
