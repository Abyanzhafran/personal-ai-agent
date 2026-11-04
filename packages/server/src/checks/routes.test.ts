import {
  ApiErrorEnvelope,
  CheckDetail,
  CheckEvent,
  CheckList,
  ValidationDetails,
  type Check,
  type Repo,
} from '@cc/shared';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { OasdiffUnavailableError } from '../diff/oasdiff.js';
import { createApp } from '../http/app.js';
import { createLogger } from '../logger.js';
import { createProjectRepository } from '../projects/repository.js';
import { createRepoRepository } from '../repos/repository.js';
import {
  CheckAlreadyRunningError,
  CheckNotRunningError,
  type StartCheckInput,
} from '../runner/check.js';
import { createCheckEvents } from '../runner/events.js';
import { createCheckRepository, type CheckResult, type NewFinding } from './repository.js';
import { checkRoutes } from './routes.js';

let db: Db;
let provider: Repo;
let app: ReturnType<typeof createApp>;
const start = vi.fn<(input: StartCheckInput) => Promise<Check>>();
const cancel = vi.fn<(checkId: number) => Promise<Check>>();
let events: ReturnType<typeof createCheckEvents>;
let servers: http.Server[] = [];

const row = (over: Partial<Check> = {}): Check => ({
  id: 5,
  project_id: provider.project_id,
  provider_repo_id: provider.id,
  base_ref: 'main',
  head_ref: 'feature/xyz',
  base_sha: null,
  head_sha: null,
  status: 'running',
  started_at: '2026-11-03T00:00:00.000Z',
  finished_at: null,
  error: null,
  ...over,
});

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  const project = createProjectRepository(db).create({
    name: 'Order',
    slug: 'order',
    description: null,
  });
  const created = createRepoRepository(db).create({
    projectId: project?.id as number,
    role: 'service',
    name: 'svc-order',
    localPath: '/r/svc-order',
    defaultBranch: 'develop',
  });
  provider = (created as { repo: Repo }).repo;
  start.mockReset();
  cancel.mockReset();
  events = createCheckEvents();
  app = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: checkRoutes({ db, checks: { start, events, cancel } }),
  });
});

afterEach(async () => {
  await Promise.all(
    servers.map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
  servers = [];
  db.close();
});

const post = (body: unknown) =>
  request(app)
    .post('/api/checks')
    .send(body as object);

const errorOf = (body: unknown) => ApiErrorEnvelope.parse(body).error;

describe('POST /api/checks', () => {
  it('202 dengan baris check; base_ref kosong memakai branch default provider', async () => {
    start.mockResolvedValue(row({ base_ref: 'develop' }));

    const res = await post({ provider_repo_id: provider.id, head_ref: ' feature/xyz ' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(row({ base_ref: 'develop' }));
    expect(start).toHaveBeenCalledWith({
      provider,
      baseRef: 'develop',
      headRef: 'feature/xyz',
    });
  });

  it('base_ref yang dikirim dipakai apa adanya', async () => {
    start.mockResolvedValue(row());

    await post({ provider_repo_id: provider.id, head_ref: 'v1.2.0', base_ref: 'release' });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'release', headRef: 'v1.2.0' }),
    );
  });

  it('body tidak valid → 400 validation_failed dengan pesan per isian, check tidak dimulai', async () => {
    const res = await post({ provider_repo_id: provider.id, head_ref: '  ' });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('validation_failed');
    expect(ValidationDetails.parse(errorOf(res.body).details).fields).toEqual([
      { in: 'body', path: 'head_ref', message: 'Ref head wajib diisi' },
    ]);
    expect(start).not.toHaveBeenCalled();
  });

  it('repo provider tidak ada → 404 repo_not_found', async () => {
    const res = await post({ provider_repo_id: 999, head_ref: 'x' });

    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('repo_not_found');
    expect(start).not.toHaveBeenCalled();
  });

  it('project sudah punya check berjalan → 409 check_already_running membawa id project dan check', async () => {
    start.mockRejectedValue(new CheckAlreadyRunningError(provider.project_id, 4));

    const res = await post({ provider_repo_id: provider.id, head_ref: 'x' });

    expect(res.status).toBe(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'check_already_running',
      details: { project_id: provider.project_id, check_id: 4 },
    });
  });

  it('oasdiff tidak bisa dipakai → 503 oasdiff_unavailable dengan pesannya', async () => {
    start.mockRejectedValue(new OasdiffUnavailableError('missing', 'oasdiff tidak ditemukan'));

    const res = await post({ provider_repo_id: provider.id, head_ref: 'x' });

    expect(res.status).toBe(503);
    expect(errorOf(res.body)).toMatchObject({
      code: 'oasdiff_unavailable',
      message: 'oasdiff tidak ditemukan',
    });
  });
});

/** Server sungguhan di port acak: supertest tidak cocok untuk aliran yang sengaja dibiarkan terbuka. */
async function serve(heartbeatMs?: number): Promise<string> {
  const stream = createApp({
    logger: createLogger({ level: 'silent' }),
    registerRoutes: checkRoutes({
      db,
      checks: { start, events, cancel },
      ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    }),
  });
  const server = http.createServer(stream);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const newCheck = () =>
  createCheckRepository(db).create({
    projectId: provider.project_id,
    providerRepoId: provider.id,
    baseRef: 'main',
    headRef: 'feature/xyz',
    startedAt: '2026-11-03T13:42:00.000Z',
  });

/** Frame SSE bernama (komentar `: keepalive` dilewati) menjadi objek. */
const parseFrames = (text: string): { event: string; id: string; data: CheckEvent }[] =>
  text
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const field = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(frame)?.[1] ?? '';
      return {
        event: field('event'),
        id: field('id'),
        data: JSON.parse(field('data')) as CheckEvent,
      };
    });

/** Membaca aliran sampai `predicate` benar untuk teks yang terkumpul. */
async function readUntil(res: Response, predicate: (text: string) => boolean): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!predicate(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return text;
}

describe('GET /api/checks/:id/events', () => {
  it('check selesai: semua event diputar ulang dengan event:/id:/data: lalu koneksi ditutup', async () => {
    const check = newCheck();
    events.open(check.id);
    const report = events.reporter(check.id);
    report.log('start', 'check #1');
    report.step(1, 'running');
    report.step(1, 'done', 'merge-base a1b2c3d');
    events.emit(check.id, { type: 'done', status: 'findings' });
    const base = await serve();

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const frames = parseFrames(await res.text()); // selesai hanya bila server menutup koneksi

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(frames.map((f) => [f.event, f.id, f.data.seq])).toEqual([
      ['log', '1', 1],
      ['step', '2', 2],
      ['step', '3', 3],
      ['done', '4', 4],
    ]);
    expect(frames.every((f) => CheckEvent.safeParse(f.data).success)).toBe(true);
    expect(events.listenerCount(check.id)).toBe(0);
  });

  it('menyambung di tengah langkah 3: langkah 1 dan 2 tetap diterima, lalu event baru sampai done', async () => {
    const check = newCheck();
    events.open(check.id);
    const report = events.reporter(check.id);
    report.step(1, 'done', 'a');
    report.step(2, 'done', 'b');
    report.step(3, 'running', '1 dari 5 file selesai');
    const base = await serve();

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (parseFrames(text).length < 3) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(
      parseFrames(text).map((f) => (f.data.type === 'step' ? [f.data.number, f.data.status] : [])),
    ).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'running'],
    ]);

    report.step(3, 'done', '5 dari 5 file selesai');
    events.emit(check.id, { type: 'done', status: 'clean' });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    const all = parseFrames(text);
    expect(all.map((f) => f.data.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.at(-1)?.data).toMatchObject({ type: 'done', status: 'clean' });
    expect(events.listenerCount(check.id)).toBe(0);
  });

  it('klien putus → pendengar dilepas tanpa menunggu done', async () => {
    const check = newCheck();
    events.open(check.id);
    const base = await serve();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/checks/${check.id}/events`, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(events.listenerCount(check.id)).toBe(1));

    controller.abort();
    await res.body?.cancel().catch(() => undefined);

    await vi.waitFor(() => expect(events.listenerCount(check.id)).toBe(0));
  });

  it('aliran sepi mengirim komentar keepalive berkala', async () => {
    const check = newCheck();
    events.open(check.id);
    const base = await serve(20);

    const res = await fetch(`${base}/api/checks/${check.id}/events`);
    const text = await readUntil(res, (seen) => seen.includes(': keepalive'));

    expect(text).toContain(': keepalive\n\n');
    await res.body?.cancel();
  });

  it('tanpa buffer di memori: check selesai → satu event done dari DB; check running → 404', async () => {
    const finished = newCheck();
    createCheckRepository(db).fail(finished.id, 'origin/x tidak ada', '2026-11-03T13:43:00.000Z');
    const running = newCheck();
    const base = await serve();

    const done = await fetch(`${base}/api/checks/${finished.id}/events`);
    expect(parseFrames(await done.text()).map((f) => f.data)).toEqual([
      { type: 'done', seq: 1, status: 'failed' },
    ]);

    const lost = await fetch(`${base}/api/checks/${running.id}/events`);
    expect(lost.status).toBe(404);
    expect(errorOf(await lost.json()).code).toBe('check_not_found');
  });

  it('check tidak ada → 404 check_not_found; id bukan angka → 400', async () => {
    const missing = await request(app).get('/api/checks/999/events');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('check_not_found');

    const invalid = await request(app).get('/api/checks/abc/events');
    expect(invalid.status).toBe(400);
    expect(errorOf(invalid.body).code).toBe('validation_failed');
  });
});

describe('POST /api/checks/:id/cancel', () => {
  it('check berjalan → 200 dengan baris check yang sudah cancelled', async () => {
    const check = newCheck();
    cancel.mockResolvedValue({
      ...check,
      status: 'cancelled',
      finished_at: '2026-11-03T13:50:00.000Z',
    });

    const res = await request(app).post(`/api/checks/${check.id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: check.id, status: 'cancelled' });
    expect(cancel).toHaveBeenCalledWith(check.id);
  });

  it('check yang sudah selesai atau tidak berjalan → 409 check_not_running, bukan 500', async () => {
    const check = newCheck();
    cancel.mockRejectedValue(new CheckNotRunningError(check.id));

    const res = await request(app).post(`/api/checks/${check.id}/cancel`);

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('check_not_running');
  });

  it('check tidak ada → 404 check_not_found tanpa memanggil runner; id bukan angka → 400', async () => {
    const missing = await request(app).post('/api/checks/999/cancel');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('check_not_found');
    expect(cancel).not.toHaveBeenCalled();

    expect((await request(app).post('/api/checks/abc/cancel')).status).toBe(400);
  });
});

describe('riwayat dan detail check (CC-064)', () => {
  const SUMMARY: CheckResult['summary'] = {
    files_checked: 2,
    files_via_hop2: 0,
    endpoints_without_consumer: [],
    consumer_shas: {},
    matched_fields: {},
    incomplete: false,
    skipped_files: 0,
    tool_versions: {},
    spec_unpinned: false,
    fetch_errors: [],
  };
  let consumer: Repo;
  let billing: { id: number; provider: Repo };
  let emptyProjectId: number;

  const addProject = (name: string) =>
    createProjectRepository(db).create({ name, slug: name.toLowerCase(), description: null })
      ?.id as number;
  const addRepo = (projectId: number, role: 'service' | 'microfrontend', name: string) =>
    (
      createRepoRepository(db).create({
        projectId,
        role,
        name,
        localPath: `/r/${name}`,
        defaultBranch: 'main',
      }) as { repo: Repo }
    ).repo;

  const finding = (extra: Partial<NewFinding> = {}): NewFinding => ({
    endpoint: 'GET /orders',
    consumerRepoId: consumer.id,
    file: 'src/orders.ts',
    line: 12,
    kind: 'removed',
    severity: 'break',
    detail: 'Parameter page_size dihapus',
    confidence: 'high',
    viaSymbol: null,
    snippet: null,
    ...extra,
  });
  // Literal penuh: `finding()` membaca `consumer`, yang baru ada setelah `beforeEach`.
  const STALE: NewFinding = {
    endpoint: 'spec',
    consumerRepoId: null,
    file: null,
    line: null,
    kind: 'spec_stale',
    severity: 'warn',
    detail: 'Spec di head tidak sama dengan hasil generate',
    confidence: null,
    viaSymbol: null,
    snippet: null,
  };

  const order = () => ({ id: provider.project_id, provider });
  const add = (startedAt: string, target: { id: number; provider: Repo } = order()) =>
    createCheckRepository(db).create({
      projectId: target.id,
      providerRepoId: target.provider.id,
      baseRef: 'main',
      headRef: 'feature/xyz',
      startedAt,
    });
  const finish = (id: number, findings: NewFinding[]) =>
    createCheckRepository(db).saveResult(id, {
      findings,
      summary: SUMMARY,
      finishedAt: '2026-11-03T20:00:00.000Z',
    });

  /** Lima check: Order (selesai dengan finding, hanya spec_stale, gagal, berjalan) dan Billing (bersih). */
  const seedHistory = () => {
    const a = add('2026-11-03T10:00:00.000Z');
    finish(a.id, [finding(), finding({ severity: 'warn', kind: 'type_changed' })]);
    const b = add('2026-11-03T11:00:00.000Z');
    finish(b.id, [STALE]);
    const c = add('2026-11-03T12:00:00.000Z');
    createCheckRepository(db).fail(
      c.id,
      'origin/feature/old tidak ada',
      '2026-11-03T12:00:02.000Z',
    );
    const d = add('2026-11-03T13:00:00.000Z');
    const e = add('2026-11-03T14:00:00.000Z', billing);
    finish(e.id, []);
    return { a, b, c, d, e };
  };

  const list = async (query: Record<string, string | number> = {}) =>
    CheckList.parse((await request(app).get('/api/checks').query(query)).body);

  beforeEach(() => {
    consumer = addRepo(provider.project_id, 'microfrontend', 'mfe');
    const billingId = addProject('Billing');
    billing = { id: billingId, provider: addRepo(billingId, 'service', 'svc-invoice') };
    emptyProjectId = addProject('Empty');
  });

  describe('GET /api/checks', () => {
    it('terbaru dulu; spec_stale dari findings, failed membawa error, running tanpa counts', async () => {
      const { a, b, c, d, e } = seedHistory();

      const { items } = await list();

      expect(items.map((item) => item.id)).toEqual([e.id, d.id, c.id, b.id, a.id]);
      const byId = (id: number) => items.find((item) => item.id === id);
      expect(byId(a.id)).toMatchObject({
        status: 'findings',
        spec_stale: false,
        counts: { break: 1, warn: 1, info: 0 },
        project_name: 'Order',
        provider_repo_name: 'svc-order',
      });
      // AC1: status tetap `findings`; badge datang dari baris finding. counts apa adanya (warn = 1).
      expect(byId(b.id)).toMatchObject({
        status: 'findings',
        spec_stale: true,
        counts: { break: 0, warn: 1, info: 0 },
      });
      // AC2
      expect(byId(c.id)).toMatchObject({
        status: 'failed',
        error: 'origin/feature/old tidak ada',
        counts: null,
        spec_stale: false,
      });
      expect(byId(d.id)).toMatchObject({ status: 'running', counts: null, finished_at: null });
      expect(byId(e.id)).toMatchObject({
        status: 'clean',
        counts: { break: 0, warn: 0, info: 0 },
        project_name: 'Billing',
        provider_repo_name: 'svc-invoice',
      });
    });

    it('AC3: jumlah per project sama dengan baris hasil filter dan tidak berubah saat filter dipilih', async () => {
      seedHistory();
      const all = await list();

      expect(all.counts).toEqual({
        total: 5,
        by_project: [
          { project_id: billing.id, name: 'Billing', count: 1 },
          { project_id: emptyProjectId, name: 'Empty', count: 0 },
          { project_id: provider.project_id, name: 'Order', count: 4 },
        ],
      });
      for (const { project_id, count } of all.counts.by_project) {
        const filtered = await list({ project: project_id });
        expect(filtered.total_items).toBe(count);
        expect(filtered.items).toHaveLength(count);
        expect(filtered.items.every((item) => item.project_id === project_id)).toBe(true);
        expect(filtered.counts).toEqual(all.counts);
      }
    });

    it('project yang tidak ada → daftar kosong, bukan error', async () => {
      seedHistory();

      const none = await list({ project: 999 });

      expect(none).toMatchObject({ items: [], total_items: 0, counts: { total: 5 } });
    });

    it('halaman: page_size 10 membagi 12 check tanpa tumpang tindih; default 25; lewat akhir kosong', async () => {
      const ids = Array.from(
        { length: 12 },
        (_, i) => add(`2026-11-03T10:${String(i).padStart(2, '0')}:00.000Z`).id,
      );

      const first = await list({ page_size: 10 });
      const second = await list({ page_size: 10, page: 2 });

      expect(first).toMatchObject({ page: 1, page_size: 10, total_items: 12 });
      expect(second).toMatchObject({ page: 2, page_size: 10, total_items: 12 });
      expect([...first.items, ...second.items].map((item) => item.id)).toEqual([...ids].reverse());
      expect([first.items.length, second.items.length]).toEqual([10, 2]);

      const fallback = await list();
      expect(fallback).toMatchObject({ page: 1, page_size: 25, total_items: 12 });
      expect(fallback.items).toHaveLength(12);
      expect((await list({ page_size: 10, page: 3 })).items).toEqual([]);
    });

    it.each([
      [{ page_size: 7 }, 'page_size', 'Ukuran halaman harus 10, 25, 50, 100'],
      [{ page: 0 }, 'page', 'Nomor halaman tidak valid'],
      [{ project: 'abc' }, 'project', 'Id project tidak valid'],
    ])('query %j tidak valid → 400 dengan pesan per isian', async (query, path, message) => {
      const res = await request(app).get('/api/checks').query(query);

      expect(res.status).toBe(400);
      expect(ValidationDetails.parse(errorOf(res.body).details).fields).toEqual([
        { in: 'query', path, message },
      ]);
    });
  });

  describe('GET /api/checks/:id', () => {
    it('check selesai: check, nama, finding dengan nama repo consumer dan snippet, serta summary', async () => {
      const snippet = { lines: [{ n: 12, text: 'fetch(url)' }], highlight: 12, tokens: ['url'] };
      const check = add('2026-11-03T10:00:00.000Z');
      finish(check.id, [finding({ snippet, viaSymbol: 'useOrders', confidence: 'medium' }), STALE]);

      const res = await request(app).get(`/api/checks/${check.id}`);

      expect(res.status).toBe(200);
      const detail = CheckDetail.parse(res.body);
      expect(detail).toMatchObject({
        check: { id: check.id, status: 'findings', finished_at: '2026-11-03T20:00:00.000Z' },
        project_name: 'Order',
        provider_repo_name: 'svc-order',
      });
      expect(detail.findings).toEqual([
        {
          id: expect.any(Number),
          endpoint: 'GET /orders',
          consumer_repo: 'mfe',
          file: 'src/orders.ts',
          line: 12,
          kind: 'removed',
          severity: 'break',
          detail: 'Parameter page_size dihapus',
          confidence: 'medium',
          via_symbol: 'useOrders',
          snippet,
        },
        {
          id: expect.any(Number),
          endpoint: 'spec',
          consumer_repo: null,
          file: null,
          line: null,
          kind: 'spec_stale',
          severity: 'warn',
          detail: STALE.detail,
          confidence: null,
          via_symbol: null,
          snippet: null,
        },
      ]);
      expect(detail.summary).toMatchObject({
        counts: { break: 1, warn: 1, info: 0 },
        files_checked: 2,
      });
    });

    it('check berjalan atau gagal: tanpa finding dan summary; error ikut terbawa', async () => {
      const running = add('2026-11-03T10:00:00.000Z');
      const failed = add('2026-11-03T11:00:00.000Z');
      createCheckRepository(db).fail(failed.id, 'origin/x tidak ada', '2026-11-03T11:00:02.000Z');

      const a = CheckDetail.parse((await request(app).get(`/api/checks/${running.id}`)).body);
      const b = CheckDetail.parse((await request(app).get(`/api/checks/${failed.id}`)).body);

      expect(a).toMatchObject({ check: { status: 'running' }, findings: [], summary: null });
      expect(b).toMatchObject({
        check: { status: 'failed', error: 'origin/x tidak ada' },
        findings: [],
        summary: null,
      });
    });

    it('check tidak ada → 404 check_not_found; id bukan angka → 400', async () => {
      const missing = await request(app).get('/api/checks/999');
      expect(missing.status).toBe(404);
      expect(errorOf(missing.body).code).toBe('check_not_found');

      const invalid = await request(app).get('/api/checks/abc');
      expect(invalid.status).toBe(400);
      expect(errorOf(invalid.body).code).toBe('validation_failed');
    });
  });
});
