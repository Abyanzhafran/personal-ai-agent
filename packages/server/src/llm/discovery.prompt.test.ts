import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { parseConfig } from '../config.js';
import { createGitAdapter } from '../git/adapter.js';
import { createLogger } from '../logger.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createDiscoveryInputCollector, type DiscoveryInput } from '../repos/discovery-input.js';
import { createLlmClient, LlmSchemaError } from './client.js';
import {
  buildDiscoveryPrompt,
  DISCOVERY_PROMPT_VERSION,
  DiscoveryOutput,
} from './discovery.prompt.js';

const valid = {
  profile_md: 'Layanan FastAPI.',
  spec_path: 'openapi.json',
  spec_cmd: 'python -m app.export',
  handler_dirs: ['app/routers'],
  http_client: null,
  base_url_pattern: null,
};

const file = (p: string, content: string, truncated = false) => ({ path: p, content, truncated });
const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  ref: 'origin/main',
  tree: { paths: ['go.mod', 'main.go', 'util/x.go'], truncated: false },
  manifests: [file('go.mod', 'module example')],
  routerCandidates: [file('main.go', 'package main')],
  specCandidates: [],
  ...over,
});

describe('DiscoveryOutput', () => {
  it('spec_cmd boleh null dan handler_dirs boleh kosong; semua yang nullable boleh null', () => {
    const result = DiscoveryOutput.safeParse({
      ...valid,
      spec_path: null,
      spec_cmd: null,
      handler_dirs: [],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['field hilang', { ...valid, handler_dirs: undefined }],
    ['profile_md kosong', { ...valid, profile_md: '   ' }],
    ['handler_dirs bukan array', { ...valid, handler_dirs: 'app/routers' }],
    ['handler_dirs null', { ...valid, handler_dirs: null }],
    ['string kosong ganti null', { ...valid, spec_cmd: '' }],
    ['tipe salah', { ...valid, http_client: 42 }],
    ['bukan objek', 'profil'],
  ])('menolak %s', (_nama, output) => {
    expect(DiscoveryOutput.safeParse(output).success).toBe(false);
  });
});

describe('keluaran mock yang tidak sesuai skema melalui callJson', () => {
  const reply = (text: string) =>
    new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const client = (text: string) =>
    createLlmClient({
      config: parseConfig(
        { ANTHROPIC_MODEL: 'm', ANTHROPIC_API_KEY: 'k' },
        { homedir: os.homedir() },
      ),
      logger: createLogger({ destination: { write: () => undefined } }),
      fetch: () => Promise.resolve(reply(text)),
    });
  const prompt = buildDiscoveryPrompt(input());

  it('ditolak utuh dengan LlmSchemaError, tidak ada hasil separuh', async () => {
    const half = JSON.stringify({ profile_md: 'ada', spec_path: null });
    await expect(client(half).callJson({ prompt, schema: DiscoveryOutput })).rejects.toBeInstanceOf(
      LlmSchemaError,
    );
  });

  it('keluaran yang sesuai lolos', async () => {
    await expect(
      client(JSON.stringify(valid)).callJson({ prompt, schema: DiscoveryOutput }),
    ).resolves.toEqual(valid);
  });
});

describe('buildDiscoveryPrompt', () => {
  it('versi = hash teks prompt: 12 hex, stabil, ikut terbawa ke prompt', () => {
    expect(DISCOVERY_PROMPT_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(buildDiscoveryPrompt(input()).version).toBe(DISCOVERY_PROMPT_VERSION);
    expect(buildDiscoveryPrompt(input({ ref: 'origin/lain' })).version).toBe(
      DISCOVERY_PROMPT_VERSION,
    );
  });

  it('memuat bahasa terdeteksi, pohon file, dan isi file kunci', () => {
    const { user } = buildDiscoveryPrompt(input());
    expect(user).toContain('Detected language and stack: Go');
    expect(user).toContain('File tree (3 paths):');
    expect(user).toContain('util/x.go');
    expect(user).toContain('=== FILE: main.go ===\npackage main\n=== END FILE ===');
  });

  it('satu bahasa dari beberapa manifest disebut sekali; tanpa manifest = unknown', () => {
    const python = input({
      manifests: [file('pyproject.toml', 'a'), file('requirements.txt', 'b')],
    });
    expect(buildDiscoveryPrompt(python).user).toContain('stack: Python\n');
    expect(buildDiscoveryPrompt(input({ manifests: [] })).user).toContain('stack: unknown\n');
  });

  it('file yang router sekaligus spec dikirim sekali; truncated ditandai', () => {
    const both = file('openapi_routes.py', 'x'.repeat(5), true);
    const { user } = buildDiscoveryPrompt(
      input({ routerCandidates: [both], specCandidates: [both] }),
    );
    expect(user.match(/=== FILE: openapi_routes\.py \(truncated\) ===/g)).toHaveLength(1);
  });

  it('pohon yang dipotong diberi catatan; tanpa file kunci tertulis (none)', () => {
    const { user } = buildDiscoveryPrompt(
      input({
        tree: { paths: ['a'], truncated: true },
        manifests: [],
        routerCandidates: [],
      }),
    );
    expect(user).toContain('File tree (1 paths, truncated: more files exist):');
    expect(user).toContain('Key files:\n(none)');
  });

  it('isi file yang kebetulan memuat {tree} atau $& tidak ikut diganti', () => {
    const tricky = file('main.go', 'a {tree} b $& c {files}');
    const { user } = buildDiscoveryPrompt(input({ manifests: [], routerCandidates: [tricky] }));
    expect(user).toContain('a {tree} b $& c {files}');
  });
});

describe('prompt dari repo fixture asli', () => {
  let tmp: string;
  let set: FixtureSet;
  const git = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));
  const collector = createDiscoveryInputCollector({ git, concurrency: 4 });

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-discovery-prompt-'));
    set = await makeFixtures(path.join(tmp, 'fixtures'));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('memuat bahasa dan file kunci, tidak memuat isi file lain di repo', async () => {
    const repo = set.repos['svc-order'];
    const collected = await collector.collect({
      path: repo.path,
      defaultBranch: repo.defaultBranch,
    });
    const { user } = buildDiscoveryPrompt(collected);

    expect(user).toContain('Detected language and stack: Python');
    expect(user).toContain('app/routers/orders.py'); // di pohon dan sebagai file kunci

    const keyPaths = new Set(
      [...collected.manifests, ...collected.routerCandidates, ...collected.specCandidates].map(
        (f) => f.path,
      ),
    );
    const others = collected.tree.paths.filter((p) => !keyPaths.has(p));
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      const body = await git.show(repo.path, collected.ref, other);
      // Path boleh tampil (pohon), isi tidak. Berkas kosong tidak bisa dibuktikan, lewati.
      if (body.trim() !== '') expect(user).not.toContain(body.trim());
    }
  });
});
