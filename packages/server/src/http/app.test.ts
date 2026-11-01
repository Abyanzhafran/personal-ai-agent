import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiErrorEnvelope, ValidationDetails } from '@cc/shared';
import type { Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../logger.js';
import { createApp } from './app.js';
import { HttpError } from './errors.js';
import { validated } from './validate.js';

interface LogLine {
  level: number;
  msg: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  check_id?: number;
  aborted?: boolean;
  err?: unknown;
}

let logs: LogLine[];
let tmp: string;

function build(options: { webDist?: string; routes?: (api: Router) => void } = {}) {
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => void logs.push(JSON.parse(line) as LogLine) },
  });
  return createApp({
    logger,
    webDist: options.webDist ?? path.join(tmp, 'tidak-ada'),
    ...(options.routes ? { registerRoutes: options.routes } : {}),
  });
}

const requestLogs = () => logs.filter((l) => l.msg === 'request');

beforeEach(async () => {
  logs = [];
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-http-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('amplop galat', () => {
  it('rute /api tidak dikenal -> 404 dengan amplop error, bukan HTML Express', async () => {
    const res = await request(build()).get('/api/tidak-ada');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).not.toMatch(/<html|Cannot GET/i);
    const body = ApiErrorEnvelope.parse(res.body);
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('GET /tidak-ada');
    expect(body.error.details).toBeNull();
  });

  it('method lain pada rute tidak dikenal juga 404 amplop', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(build())[method]('/api/tidak-ada').send({});
      expect(res.status, method).toBe(404);
      expect(ApiErrorEnvelope.safeParse(res.body).success, method).toBe(true);
    }
  });

  it('HttpError dari handler dipetakan apa adanya', async () => {
    const app = build({
      routes: (api) =>
        api.get('/boom', () => {
          throw new HttpError(409, 'project_slug_taken', 'Nama sudah dipakai', { slug: 'order' });
        }),
    });
    const res = await request(app).get('/api/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'project_slug_taken',
        message: 'Nama sudah dipakai',
        details: { slug: 'order' },
      },
    });
  });

  it('galat tak terduga -> 500 generik, detail hanya di log', async () => {
    const app = build({
      routes: (api) =>
        api.get('/crash', () => {
          throw new Error('rahasia: password=hunter2');
        }),
    });
    const res = await request(app).get('/api/crash');
    expect(res.status).toBe(500);
    const body = ApiErrorEnvelope.parse(res.body);
    expect(body.error.code).toBe('internal_error');
    expect(res.text).not.toContain('hunter2');
    expect(JSON.stringify(logs.filter((l) => l.msg === 'unhandled error'))).toContain('hunter2');
  });

  it('promise yang ditolak di handler async juga berakhir sebagai amplop 500', async () => {
    const app = build({
      routes: (api) =>
        api.get('/async-crash', async () => {
          await Promise.resolve();
          throw new Error('async gagal');
        }),
    });
    const res = await request(app).get('/api/async-crash');
    expect(res.status).toBe(500);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('internal_error');
  });
});

describe('validasi zod', () => {
  const Body = z.object({
    name: z.string().min(1).max(60),
    role: z.enum(['service', 'microfrontend', 'e2e']),
    tags: z.array(z.object({ key: z.string() })).optional(),
  });
  const Query = z.object({ limit: z.coerce.number().int().min(1).default(10) });
  const Params = z.object({ id: z.coerce.number().int().positive() });

  const app = () =>
    build({
      routes: (api) => {
        api.post(
          '/things/:id',
          validated(
            { body: Body, query: Query, params: Params },
            ({ body, query, params }, _req, res) => {
              res.status(201).json({ body, query, params });
            },
          ),
        );
      },
    });

  it('body tidak valid -> 400 dengan daftar semua field yang salah', async () => {
    const res = await request(app())
      .post('/api/things/3')
      .send({ name: '', role: 'admin', tags: [{ key: 1 }] });
    expect(res.status).toBe(400);
    const { error } = ApiErrorEnvelope.parse(res.body);
    expect(error.code).toBe('validation_failed');
    const details = ValidationDetails.parse(error.details);
    expect(details.fields.map((f) => `${f.in}:${f.path}`).sort()).toEqual([
      'body:name',
      'body:role',
      'body:tags.0.key',
    ]);
  });

  it('melaporkan masalah di body, query, dan params sekaligus', async () => {
    const res = await request(app()).post('/api/things/abc?limit=0').send({});
    const details = ValidationDetails.parse(ApiErrorEnvelope.parse(res.body).error.details);
    const where = new Set(details.fields.map((f) => f.in));
    expect(where).toEqual(new Set(['body', 'query', 'params']));
  });

  it('request tanpa body -> 400 validation_failed, bukan 500', async () => {
    const res = await request(app()).post('/api/things/3');
    expect(res.status).toBe(400);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('validation_failed');
  });

  it('input valid sampai ke handler dalam bentuk hasil parse (coerce, default)', async () => {
    const res = await request(app())
      .post('/api/things/42')
      .send({ name: 'order', role: 'service' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      body: { name: 'order', role: 'service' },
      query: { limit: 10 },
      params: { id: 42 },
    });
  });

  it('JSON rusak -> 400 invalid_json', async () => {
    const res = await request(app())
      .post('/api/things/3')
      .set('content-type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('invalid_json');
  });

  it('body lebih dari batas -> 413 payload_too_large', async () => {
    const res = await request(app())
      .post('/api/things/3')
      .send({ name: 'x'.repeat(2 * 1024 * 1024), role: 'service' });
    expect(res.status).toBe(413);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('payload_too_large');
  });
});

describe('log request', () => {
  it('memuat method, path, status, durasi; query string tidak ikut tercatat', async () => {
    await request(build()).get('/api/health?token=rahasia');
    const [line] = requestLogs();
    expect(line).toMatchObject({ method: 'GET', path: '/api/health', status: 200 });
    expect(typeof line?.durationMs).toBe('number');
    expect(line?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(logs)).not.toContain('rahasia');
    expect(line).not.toHaveProperty('check_id');
  });

  it('check_id diambil dari path /api/checks/:id/...', async () => {
    const app = build({
      routes: (api) => api.get('/checks/:id/events', (_req, res) => void res.json({})),
    });
    await request(app).get('/api/checks/17/events');
    await request(app).get('/api/checks/17');
    expect(requestLogs().map((l) => l.check_id)).toEqual([17, 17]);
  });

  it('check_id juga bisa diisi handler lewat res.locals (POST /api/checks yang baru membuat check)', async () => {
    const app = build({
      routes: (api) =>
        api.post('/checks', (_req, res) => {
          res.locals['checkId'] = 99;
          res.status(201).json({ id: 99 });
        }),
    });
    await request(app).post('/api/checks').send({});
    expect(requestLogs()[0]).toMatchObject({
      method: 'POST',
      path: '/api/checks',
      status: 201,
      check_id: 99,
    });
  });

  it('level mengikuti status: 4xx warn, 5xx error', async () => {
    const app = build({
      routes: (api) =>
        api.get(
          '/crash',
          () =>
            void (() => {
              throw new Error('x');
            })(),
        ),
    });
    await request(app).get('/api/health');
    await request(app).get('/api/nope');
    await request(app).get('/api/crash');
    expect(requestLogs().map((l) => [l.status, l.level])).toEqual([
      [200, 30],
      [404, 40],
      [500, 50],
    ]);
  });
});

describe('penjaga loopback (DNS rebinding / CSRF)', () => {
  it.each(['127.0.0.1:4711', 'localhost:5173', 'LOCALHOST', '[::1]:4711', '127.0.0.1'])(
    'Host %s diterima',
    async (host) => {
      const res = await request(build()).get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
    },
  );

  it.each([
    'evil.example:4711',
    'evil.example',
    '127.0.0.1.evil.example',
    'localhost.evil.example:80',
    '192.168.1.5:4711',
  ])('Host %s ditolak 403 forbidden_host', async (host) => {
    const res = await request(build()).get('/api/health').set('Host', host);
    expect(res.status).toBe(403);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('forbidden_host');
  });

  it('permintaan pengubah state dari Origin non-loopback ditolak sebelum handler jalan', async () => {
    let ran = false;
    const app = build({
      routes: (api) =>
        api.post('/mutate', (_req, res) => {
          ran = true;
          res.json({});
        }),
    });
    const res = await request(app)
      .post('/api/mutate')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('forbidden_origin');
    expect(ran).toBe(false);
  });

  it('Origin loopback (dev server Vite) dan tanpa Origin diterima', async () => {
    const app = build({
      routes: (api) => api.post('/mutate', (_req, res) => void res.json({ ok: true })),
    });
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
      expect((await request(app).post('/api/mutate').set('Origin', origin).send({})).status).toBe(
        200,
      );
    }
    expect((await request(app).post('/api/mutate').send({})).status).toBe(200);
  });

  it('Origin tidak valid ditolak', async () => {
    const app = build({ routes: (api) => api.post('/mutate', (_req, res) => void res.json({})) });
    const res = await request(app).post('/api/mutate').set('Origin', 'bukan-url').send({});
    expect(res.status).toBe(403);
  });
});

describe('antarmuka web', () => {
  it('GET / sebelum web di-build -> 503 dengan pesan yang menyebut npm run build', async () => {
    const res = await request(build()).get('/').set('Accept', 'text/html');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('npm run build');
  });

  it('GET / untuk klien JSON sebelum di-build -> amplop web_not_built', async () => {
    const res = await request(build()).get('/').set('Accept', 'application/json');
    expect(res.status).toBe(503);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('web_not_built');
  });

  describe('setelah di-build', () => {
    let webDist: string;
    beforeEach(async () => {
      webDist = path.join(tmp, 'dist');
      await fs.mkdir(path.join(webDist, 'assets'), { recursive: true });
      await fs.writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>SPA</title>');
      await fs.writeFile(path.join(webDist, 'assets', 'app.js'), 'console.log(1)');
    });

    it('GET / menyajikan index.html', async () => {
      const res = await request(build({ webDist })).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>SPA</title>');
    });

    it('menyajikan aset statis', async () => {
      const res = await request(build({ webDist })).get('/assets/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
    });

    it('rute sisi klien (/projects/3, /checks/12) jatuh ke index.html', async () => {
      for (const route of ['/projects/3', '/checks/12', '/repos/4/discovery', '/panduan']) {
        const res = await request(build({ webDist })).get(route);
        expect(res.status, route).toBe(200);
        expect(res.text, route).toContain('<title>SPA</title>');
      }
    });

    it('aset yang tidak ada -> 404 amplop, bukan HTML', async () => {
      const res = await request(build({ webDist })).get('/assets/hilang.js');
      expect(res.status).toBe(404);
      expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('not_found');
    });

    it('/api tidak pernah jatuh ke index.html', async () => {
      const res = await request(build({ webDist })).get('/api/tidak-ada');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('build yang muncul setelah server hidup langsung terlayani tanpa restart', async () => {
      const app = build({ webDist: path.join(tmp, 'nanti') });
      expect((await request(app).get('/')).status).toBe(503);
      await fs.mkdir(path.join(tmp, 'nanti'));
      await fs.writeFile(path.join(tmp, 'nanti', 'index.html'), '<title>baru</title>');
      expect((await request(app).get('/')).status).toBe(200);
    });
  });

  it('POST ke rute non-API -> 404 amplop', async () => {
    const res = await request(build()).post('/sesuatu').send({});
    expect(res.status).toBe(404);
    expect(ApiErrorEnvelope.parse(res.body).error.code).toBe('not_found');
  });
});

describe('health', () => {
  it('GET /api/health', async () => {
    const res = await request(build()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, app: 'Contract Check' });
  });
});
