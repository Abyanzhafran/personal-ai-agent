import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ApiErrorEnvelope, ValidationDetails, type Project } from '@cc/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { createApp } from '../http/app.js';
import { createLogger } from '../logger.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { projectRoutes } from './routes.js';

let fixturesTmp: string;
let fixtures: FixtureSet;

let tmp: string;
let db: Db;
let layout: WorkspaceLayout;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-projects-fx-'));
  fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
}, 120_000);

afterAll(async () => {
  await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-projects-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  const workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  db = openDatabase(':memory:');
  migrate(db);
  app = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: projectRoutes({ db, workspace }),
  });
});

afterEach(async () => {
  db.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const create = (body: unknown) =>
  request(app)
    .post('/api/projects')
    .send(body as object);

const errorOf = (body: unknown) => ApiErrorEnvelope.parse(body).error;

const count = (table: string, where = '1 = 1') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

describe('POST /api/projects', () => {
  it('membuat project: 201, nama ter-trim, slug huruf kecil dengan spasi jadi "-"', async () => {
    const res = await create({ name: '  Order Service  ', description: '  Layanan pesanan ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      name: 'Order Service',
      slug: 'order-service',
      description: 'Layanan pesanan',
    });
    expect(db.prepare('SELECT name, slug FROM projects').all()).toEqual([
      { name: 'Order Service', slug: 'order-service' },
    ]);
  });

  it('deskripsi tidak dikirim atau kosong disimpan sebagai null', async () => {
    expect((await create({ name: 'A' })).body.description).toBeNull();
    expect((await create({ name: 'B', description: '   ' })).body.description).toBeNull();
  });

  it('nama yang slug-nya sudah dipakai → 409 project_slug_taken, tidak ada baris baru', async () => {
    expect((await create({ name: 'Order Service' })).status).toBe(201);

    const res = await create({ name: 'order   SERVICE' });
    expect(res.status).toBe(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'project_slug_taken',
      details: { slug: 'order-service' },
    });
    expect(errorOf(res.body).message).toContain('order-service');
    expect(count('projects')).toBe(1);
  });

  it('nama 61 karakter → 400 dengan pesan di field name; 60 karakter lolos', async () => {
    const res = await create({ name: 'a'.repeat(61) });
    expect(res.status).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('validation_failed');
    expect(ValidationDetails.parse(error.details).fields).toEqual([
      { in: 'body', path: 'name', message: 'Nama project maksimal 60 karakter' },
    ]);
    expect(count('projects')).toBe(0);

    expect((await create({ name: 'a'.repeat(60) })).status).toBe(201);
    expect((await create({ name: ` ${'b'.repeat(60)} ` })).status).toBe(201);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 5 }])(
    'nama wajib: %j → 400 "wajib diisi"',
    async (body) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(ValidationDetails.parse(errorOf(res.body).details).fields).toEqual([
        { in: 'body', path: 'name', message: 'Nama project wajib diisi' },
      ]);
    },
  );

  it('nama tanpa huruf atau angka yang bisa jadi folder → 400 di field name', async () => {
    const res = await create({ name: '///' });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('validation_failed');
    expect(ValidationDetails.parse(errorOf(res.body).details).fields).toEqual([
      { in: 'body', path: 'name', message: 'Nama project harus memuat huruf atau angka' },
    ]);
    expect(count('projects')).toBe(0);
  });

  it('nama dengan karakter terlarang di nama folder tetap diterima dan slug-nya aman', async () => {
    const res = await create({ name: 'Order/Payment: v2' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('order-payment-v2');
    expect(() => layout.projectContextDir(res.body.slug as string)).not.toThrow();
  });

  it('tanpa body → 400 berpesan Indonesia', async () => {
    const res = await request(app).post('/api/projects');
    expect(res.status).toBe(400);
    expect(ValidationDetails.parse(errorOf(res.body).details).fields[0]?.message).toBe(
      'Body harus berupa objek JSON',
    );
  });
});

describe('GET /api/projects', () => {
  it('daftar kosong, lalu terurut menurut nama tanpa memedulikan huruf besar-kecil', async () => {
    expect((await request(app).get('/api/projects')).body).toEqual([]);
    await create({ name: 'beta' });
    await create({ name: 'Alpha' });
    await create({ name: 'Charlie' });
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect((res.body as Project[]).map((p) => p.name)).toEqual(['Alpha', 'beta', 'Charlie']);
  });

  it('GET /:id mengembalikan satu project; id tidak ada → 404; id bukan angka → 400', async () => {
    const { body } = await create({ name: 'Order' });
    expect((await request(app).get(`/api/projects/${body.id}`)).body).toEqual(body);

    const missing = await request(app).get('/api/projects/999');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('project_not_found');

    const bad = await request(app).get('/api/projects/abc');
    expect(bad.status).toBe(400);
    expect(ValidationDetails.parse(errorOf(bad.body).details).fields).toEqual([
      { in: 'params', path: 'id', message: 'Id project tidak valid' },
    ]);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('mengganti nama tidak mengubah slug maupun folder', async () => {
    const { body } = await create({ name: 'Order Service' });
    const profile = layout.repoProfileFile('order-service', 'svc-order');
    await fs.mkdir(path.dirname(profile), { recursive: true });
    await fs.writeFile(profile, '# profil\n');

    const res = await request(app)
      .patch(`/api/projects/${body.id}`)
      .send({ name: ' Pesanan Baru ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...body, name: 'Pesanan Baru' });
    expect(res.body.slug).toBe('order-service');

    expect(await fs.readFile(profile, 'utf8')).toBe('# profil\n');
    expect(await fs.readdir(path.dirname(layout.projectContextDir('order-service')))).toEqual([
      'order-service',
    ]);
    expect((await request(app).get(`/api/projects/${body.id}`)).body.slug).toBe('order-service');
  });

  it('isian yang tidak dikirim tidak berubah; description null menghapus deskripsi', async () => {
    const { body } = await create({ name: 'Order', description: 'Awal' });

    const onlyName = await request(app).patch(`/api/projects/${body.id}`).send({ name: 'Order 2' });
    expect(onlyName.body).toMatchObject({ name: 'Order 2', description: 'Awal' });

    const onlyDescription = await request(app)
      .patch(`/api/projects/${body.id}`)
      .send({ description: 'Baru' });
    expect(onlyDescription.body).toMatchObject({ name: 'Order 2', description: 'Baru' });

    const cleared = await request(app)
      .patch(`/api/projects/${body.id}`)
      .send({ description: null });
    expect(cleared.body).toMatchObject({ name: 'Order 2', description: null });

    expect((await request(app).patch(`/api/projects/${body.id}`).send({})).body).toEqual(
      cleared.body,
    );
  });

  it('nama baru melewati 60 karakter → 400 dan data lama utuh; id tidak ada → 404', async () => {
    const { body } = await create({ name: 'Order' });
    const tooLong = await request(app)
      .patch(`/api/projects/${body.id}`)
      .send({ name: 'x'.repeat(61) });
    expect(tooLong.status).toBe(400);
    expect((await request(app).get(`/api/projects/${body.id}`)).body.name).toBe('Order');

    const missing = await request(app).patch('/api/projects/999').send({ name: 'x' });
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('project_not_found');
  });
});

/** Ringkasan isi folder (nama, isi, mtime) untuk membuktikan tidak ada yang tersentuh. */
async function treeDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (dir: string): Promise<void> => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      hash.update(`${path.relative(root, full)}\0`);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        hash.update(`${(await fs.stat(full)).mtimeMs}\0`);
        hash.update(await fs.readFile(full));
      }
    }
  };
  await walk(root);
  return hash.digest('hex');
}

describe('DELETE /api/projects/:id', () => {
  /** Dua repo, `checks` kali check, dan satu finding per check; plus berkas di contexts/ dan runs/. */
  async function seed(project: Project, checks: number) {
    const repoIds = [
      { role: 'service', repo: fixtures.repos['svc-order'] },
      { role: 'microfrontend', repo: fixtures.repos['mfe-dashboard'] },
    ].map(({ role, repo }) =>
      Number(
        db
          .prepare(
            `INSERT INTO repos (project_id, role, name, local_path, default_branch)
             VALUES (?, ?, ?, ?, 'main')`,
          )
          .run(project.id, role, repo.name, repo.path).lastInsertRowid,
      ),
    );

    const profile = layout.repoProfileFile(project.slug, 'svc-order');
    await fs.mkdir(path.dirname(profile), { recursive: true });
    await fs.writeFile(profile, `# profil ${project.slug}\n`);

    const checkIds: number[] = [];
    for (let i = 0; i < checks; i++) {
      const checkId = Number(
        db
          .prepare(
            `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at)
             VALUES (?, ?, 'main', 'feature/xyz', '2026-11-01T00:00:00Z')`,
          )
          .run(project.id, repoIds[0]).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO findings (check_id, endpoint, consumer_repo_id, kind, severity, detail)
         VALUES (?, 'GET /orders', ?, 'removed', 'break', 'field dihapus')`,
      ).run(checkId, repoIds[1]);
      const artifact = layout.checkArtifact(checkId, 'spec-base.json');
      await fs.mkdir(path.dirname(artifact), { recursive: true });
      await fs.writeFile(artifact, '{}');
      checkIds.push(checkId);
    }
    return { profile, checkIds };
  }

  it('menghapus baris projects, repos, checks, findings, serta folder contexts/ dan runs/ miliknya', async () => {
    const a = (await create({ name: 'Order Service' })).body as Project;
    const b = (await create({ name: 'Billing' })).body as Project;
    const seededA = await seed(a, 2);
    const seededB = await seed(b, 1);
    expect([count('projects'), count('repos'), count('checks'), count('findings')]).toEqual([
      2, 4, 3, 3,
    ]);

    const res = await request(app).delete(`/api/projects/${a.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    expect(db.prepare('SELECT slug FROM projects').all()).toEqual([{ slug: 'billing' }]);
    expect([
      count('repos', `project_id = ${b.id}`),
      count('checks', `project_id = ${b.id}`),
      count('findings', `check_id = ${seededB.checkIds[0]}`),
    ]).toEqual([2, 1, 1]);
    expect([count('repos'), count('checks'), count('findings')]).toEqual([2, 1, 1]);

    expect(await exists(layout.projectContextDir(a.slug))).toBe(false);
    for (const id of seededA.checkIds) expect(await exists(layout.checkRunDir(id))).toBe(false);
    // Milik project lain tidak disentuh.
    expect(await fs.readFile(seededB.profile, 'utf8')).toBe('# profil billing\n');
    expect(await exists(layout.checkRunDir(seededB.checkIds[0] as number))).toBe(true);
  });

  it('berkas di repo user tidak berubah sama sekali setelah DELETE', async () => {
    const project = (await create({ name: 'Order Service' })).body as Project;
    await seed(project, 2);
    const userRepos = [fixtures.repos['svc-order'].path, fixtures.repos['mfe-dashboard'].path];
    const before = await Promise.all(userRepos.map(treeDigest));
    // Pastikan pembanding ini sungguh sensitif: folder yang dihitung tidak kosong.
    expect(await fs.readdir(userRepos[0] as string)).toContain('.git');

    expect((await request(app).delete(`/api/projects/${project.id}`)).status).toBe(204);

    expect(await Promise.all(userRepos.map(treeDigest))).toEqual(before);
  });

  it('project tanpa folder atau check apa pun tetap bisa dihapus', async () => {
    const { body } = await create({ name: 'Kosong' });
    expect((await request(app).delete(`/api/projects/${body.id}`)).status).toBe(204);
    expect(count('projects')).toBe(0);
  });

  it('id tidak ada, atau sudah dihapus → 404; id bukan angka → 400', async () => {
    const { body } = await create({ name: 'Sekali' });
    expect((await request(app).delete(`/api/projects/${body.id}`)).status).toBe(204);

    const again = await request(app).delete(`/api/projects/${body.id}`);
    expect(again.status).toBe(404);
    expect(errorOf(again.body).code).toBe('project_not_found');
    expect((await request(app).get(`/api/projects/${body.id}`)).status).toBe(404);
    expect((await request(app).delete('/api/projects/abc')).status).toBe(400);
  });

  it('nama yang sama bisa dipakai lagi sesudah project dihapus', async () => {
    const first = (await create({ name: 'Order' })).body as Project;
    await request(app).delete(`/api/projects/${first.id}`);
    expect((await create({ name: 'Order' })).status).toBe(201);
  });
});
