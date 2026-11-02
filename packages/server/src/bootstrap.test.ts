import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';
import { startApp, type RunningApp } from './bootstrap.js';
import { OasdiffUnavailableError } from './diff/oasdiff.js';
import { createLogger } from './logger.js';

// Start sungguhan (SQLite native, listen, probe oasdiff) dan hapus folder sementara di Windows
// bisa melewati 5/10 dtk bawaan saat mesin sibuk, terutama pada test pertama yang masih "dingin".
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let tmp: string;
let app: RunningApp | undefined;

function config(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0, // port acak yang bebas
    workspaceDir: path.join(tmp, 'workspace'),
    anthropicApiKey: 'k',
    anthropicModel: 'm',
    maxFilesPerCheck: 40,
    maxLlmCallsPerCheck: 40,
    gitConcurrency: 4,
    llmConcurrency: 4,
    specCmdTimeoutMs: 180_000,
    oasdiffBin: 'oasdiff',
    ...overrides,
  };
}

const silent = () => createLogger({ level: 'silent' });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-boot-'));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('startApp', () => {
  it('menyiapkan workspace dan app.db, lalu menjawab /api/health di loopback', async () => {
    app = await startApp(config(), { logger: silent(), webDist: path.join(tmp, 'tidak-ada') });

    for (const dir of ['contexts/projects', 'cache/specs', 'cache/extract', 'runs/checks']) {
      expect((await fs.stat(path.join(tmp, 'workspace', dir))).isDirectory()).toBe(true);
    }
    expect((await fs.stat(path.join(tmp, 'workspace', 'app.db'))).isFile()).toBe(true);
    expect(app.context.db.pragma('user_version', { simple: true })).toBe(1);

    const res = await fetch(`http://127.0.0.1:${app.port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: 'Contract Check' });

    const address = app.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });

  it('start ulang pada workspace yang sama idempoten dan datanya bertahan', async () => {
    app = await startApp(config(), { logger: silent() });
    app.context.db.prepare("INSERT INTO projects (name, slug) VALUES ('Order', 'order')").run();
    await app.close();

    app = await startApp(config(), { logger: silent() });
    expect(app.context.db.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 });
  });

  it('memasang rute /api/projects pada server sungguhan, datanya bertahan setelah restart', async () => {
    app = await startApp(config(), { logger: silent() });
    const created = await fetch(`http://127.0.0.1:${app.port}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Order Service' }),
    });
    expect(created.status).toBe(201);
    await app.close();

    app = await startApp(config(), { logger: silent() });
    const list = await fetch(`http://127.0.0.1:${app.port}/api/projects`);
    expect(await list.json()).toEqual([
      { id: 1, name: 'Order Service', slug: 'order-service', description: null },
    ]);
  });

  it('memasang rute repo dengan adapter git sungguhan di samping rute project', async () => {
    app = await startApp(config(), { logger: silent() });
    const base = `http://127.0.0.1:${app.port}/api`;
    const post = (url: string, body: unknown) =>
      fetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const project = (await (await post('/projects', { name: 'Order' })).json()) as { id: number };

    // Folder biasa: git sungguhan dijalankan lewat runner dan menjawab "bukan repo".
    const plain = await fs.mkdtemp(path.join(tmp, 'plain-'));
    const res = await post(`/projects/${project.id}/repos`, { role: 'service', local_path: plain });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('repo_not_git');
    expect((await fetch(`${base}/repos/1`, { method: 'DELETE' })).status).toBe(404);
  });

  it('memasang rute discovery: profil dan pindai ulang repo yang tidak ada → 404 repo_not_found', async () => {
    app = await startApp(config(), { logger: silent() });
    const base = `http://127.0.0.1:${app.port}/api/repos/999`;

    for (const res of [
      await fetch(`${base}/profile`),
      await fetch(`${base}/discovery`, { method: 'POST' }),
    ]) {
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('repo_not_found');
    }
  });

  describe('cek oasdiff saat start (CC-034)', () => {
    const capture = () => {
      const lines: { level: number; msg: string }[] = [];
      const logger = createLogger({
        level: 'debug',
        destination: {
          write: (line: string) => lines.push(JSON.parse(line) as (typeof lines)[number]),
        },
      });
      return { lines, logger };
    };

    it('tidak terpasang: server tetap hidup, log peringatan menyebut cara pasang, check ditolak lewat assertAvailable', async () => {
      const { lines, logger } = capture();
      app = await startApp(config({ oasdiffBin: 'oasdiff-tidak-terpasang-xyz' }), { logger });

      expect((await fetch(`http://127.0.0.1:${app.port}/api/health`)).status).toBe(200);
      expect(await app.context.oasdiff.capability()).toMatchObject({
        ok: false,
        reason: 'missing',
      });
      await expect(app.context.oasdiff.assertAvailable()).rejects.toBeInstanceOf(
        OasdiffUnavailableError,
      );
      const warning = lines.find((line) => line.msg.includes('oasdiff tidak ditemukan'));
      expect(warning?.level).toBe(40); // warn
      expect(warning?.msg).toContain('OASDIFF_BIN');
    });

    it('terpasang dengan versi memadai: dicatat sekali saat start', async () => {
      const { lines, logger } = capture();
      // `node` berpura-pura menjadi oasdiff: `--version` mencetak versinya.
      app = await startApp(config({ oasdiffBin: process.execPath }), { logger });

      expect(await app.context.oasdiff.capability()).toEqual({
        ok: true,
        version: process.versions.node,
      });
      expect(lines.filter((line) => line.msg === 'oasdiff siap')).toHaveLength(1);
    });
  });

  it('port yang sudah dipakai -> EADDRINUSE', async () => {
    app = await startApp(config(), { logger: silent() });
    const second = startApp(config({ port: app.port, workspaceDir: path.join(tmp, 'ws2') }), {
      logger: silent(),
    });
    await expect(second).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('close() menutup server dan melepaskan database', async () => {
    const running = await startApp(config(), { logger: silent() });
    const { port } = running;
    await running.close();
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    expect(running.context.db.open).toBe(false);
  });
});
