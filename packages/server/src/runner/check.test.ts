import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CheckSummary, type Check, type CheckEvent, type Repo } from '@cc/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CHANGELOG } from '../../../../fixtures/changelog.js';
import {
  makeFixtures,
  type FixtureRepo,
  type FixtureSet,
} from '../../../../fixtures/make-fixtures.js';
import { createCheckRepository } from '../checks/repository.js';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { OasdiffUnavailableError, type OasdiffChange } from '../diff/oasdiff.js';
import { createGitAdapter } from '../git/adapter.js';
import type { LlmClient } from '../llm/client.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { createLogger } from '../logger.js';
import { createCommandRunner } from '../proc/run-command.js';
import { createProjectRepository } from '../projects/repository.js';
import { createRepoRepository } from '../repos/repository.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import {
  CheckAlreadyRunningError,
  CheckNotRunningError,
  createCheckRunner,
  type CheckRunner,
  type CheckRunnerDeps,
} from './check.js';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** git mentah untuk menyiapkan data uji; bukan bagian yang diuji. */
const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
  }).trim();

let tmp: string;
let fixtures: FixtureSet;
let layout: WorkspaceLayout;
let db: Db;
let deps: CheckRunnerDeps;
let runner: CheckRunner;
let unrelated: string;
let projectCount = 0;

const changelog = vi.fn<() => Promise<OasdiffChange[]>>();
const callJson =
  vi.fn<(input: { prompt: { user: string }; signal?: AbortSignal }) => Promise<unknown>>();
/** True = panggilan Claude menggantung sampai di-abort, supaya check tetap `running`. */
let hold = false;
/** Banyak panggilan pertama yang tetap dijawab sebelum `hold` berlaku. */
let holdAfter = 0;
/** Keluaran model palsu per path berkas consumer. */
let outputs: Record<string, ApiCall[]>;

const order = (): FixtureRepo => fixtures.repos['svc-order'];

const call = (over: Partial<ApiCall>): ApiCall => ({
  method: 'GET',
  path: '/orders',
  file: '',
  line: 1,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
  ...over,
});

/** Nomor baris pertama di berkas klon fixture yang memuat `needle` (D-17: anchor baris fixture). */
async function lineOf(repo: FixtureRepo, file: string, needle: string): Promise<number> {
  const text = await fs.readFile(path.join(repo.path, file), 'utf8');
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`${file} tidak memuat '${needle}'`);
  return index + 1;
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-runner-check-'));
  fixtures = await makeFixtures(path.join(tmp, 'fixtures'));
  rawGit(order().path, 'tag', 'v-feature', order().commits['feature-xyz'] as string);

  const mfe = fixtures.repos['mfe-dashboard'];
  const payment = fixtures.repos['svc-payment'];
  outputs = {
    'src/api/orders.ts': [
      call({
        line: await lineOf(mfe, 'src/api/orders.ts', "http.get('/orders'"),
        query_params: ['page_size', 'status'],
        wrapper_symbols: ['listOrders'],
      }),
      call({
        path: '/orders/${id}',
        line: await lineOf(mfe, 'src/api/orders.ts', 'getOrder ='),
        response_fields_read: [
          { name: 'grand_total', line: await lineOf(mfe, 'src/api/orders.ts', 'getOrder =') },
        ],
        wrapper_symbols: ['getOrder'],
      }),
    ],
    'src/hooks/useOrders.ts': [
      call({
        line: await lineOf(mfe, 'src/hooks/useOrders.ts', "queryKey: ['orders'"),
        confidence: 'medium',
        wrapper_symbols: ['useOrders'],
      }),
    ],
    // Hop 2: baris yang disitasi memuat simbol `useOrders`, bukan path atau field.
    'src/pages/OrdersPage.tsx': [
      call({
        line: await lineOf(mfe, 'src/pages/OrdersPage.tsx', 'useOrders(filters)'),
        response_fields_read: [
          { name: 'total', line: await lineOf(mfe, 'src/pages/OrdersPage.tsx', 'data.total') },
          { name: 'items', line: await lineOf(mfe, 'src/pages/OrdersPage.tsx', 'data.items') },
        ],
      }),
    ],
    'internal/clients/order_client.go': [
      call({
        method: 'POST',
        line: await lineOf(payment, 'internal/clients/order_client.go', 'c.baseURL + "/orders"'),
        body_fields: [
          { name: 'customer_id', literal: null, type: 'string' },
          { name: 'items', literal: null, type: 'array' },
          { name: 'note', literal: null, type: 'string' },
        ],
      }),
    ],
  };

  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  const workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  db = openDatabase(':memory:');
  migrate(db);

  const commandRunner = createCommandRunner({ oasdiffBin: 'oasdiff', shellRoot: layout.checksDir });
  callJson.mockImplementation(async ({ prompt, signal }) => {
    if (hold && callJson.mock.calls.length > holdAfter) {
      // Seperti SDK asli: signal yang sudah ter-abort menolak langsung (event abort tidak muncul lagi).
      await new Promise((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const file = /^File: (.+)$/m.exec(prompt.user)?.[1] ?? '';
    return { calls: outputs[file] ?? [] };
  });
  changelog.mockImplementation(() => Promise.resolve([...FIXTURE_CHANGELOG]));
  deps = {
    db,
    config: {
      anthropicModel: 'model-uji',
      gitConcurrency: 4,
      llmConcurrency: 2,
      maxFilesPerCheck: 40,
      maxLlmCallsPerCheck: 40,
      specCmdTimeoutMs: 60_000,
    },
    logger: createLogger({ level: 'silent' }),
    workspace,
    git: createGitAdapter(commandRunner),
    runner: commandRunner,
    oasdiff: { assertAvailable: () => Promise.resolve('1.35.0'), changelog },
    llm: { callJson } as unknown as Pick<LlmClient, 'callJson'>,
    discovery: {
      profile: () =>
        Promise.resolve({
          status: 'approved',
          error: null,
          profile: {
            profile_md: 'Aplikasi uji.',
            spec_path: null,
            spec_cmd: null,
            handler_dirs: [],
            http_client: null,
            base_url_pattern: null,
          },
        }),
    },
  };
  runner = createCheckRunner(deps);

  // Dua cabang origin yang riwayatnya tidak berhubungan.
  const bare = path.join(tmp, 'unrelated.git');
  unrelated = path.join(tmp, 'unrelated');
  await fs.mkdir(unrelated, { recursive: true });
  rawGit(tmp, 'init', '--quiet', '--bare', bare);
  rawGit(unrelated, 'init', '--quiet', '--initial-branch=main');
  rawGit(unrelated, 'commit', '--quiet', '--allow-empty', '-m', 'main');
  rawGit(unrelated, 'checkout', '--quiet', '--orphan', 'lain');
  rawGit(unrelated, 'commit', '--quiet', '--allow-empty', '-m', 'lain');
  rawGit(unrelated, 'remote', 'add', 'origin', bare);
  rawGit(unrelated, 'push', '--quiet', 'origin', 'main', 'lain');
}, 120_000);

afterEach(() => {
  hold = false;
  holdAfter = 0;
  callJson.mockClear();
  changelog.mockClear();
});

afterAll(async () => {
  await runner.stop();
  db.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

interface Entry {
  readonly name: string;
  readonly role: Repo['role'];
  readonly path: string;
  readonly defaultBranch?: string;
  readonly specPath?: string | null;
  readonly specCmd?: string | null;
}

const entryOf = (repo: FixtureRepo): Entry => ({
  name: repo.name,
  role: repo.role,
  path: repo.path,
  defaultBranch: repo.defaultBranch,
  specPath: repo.specPath ?? null,
  specCmd: repo.specCmd ?? null,
});

/** Project baru berisi `entries`; repo pertama adalah provider. */
function register(entries: readonly Entry[]): Repo[] {
  const projects = createProjectRepository(db);
  const repos = createRepoRepository(db);
  projectCount++;
  const project = projects.create({
    name: `Project ${projectCount}`,
    slug: `project-${projectCount}`,
    description: null,
  });
  return entries.map((entry) => {
    const created = repos.create({
      projectId: project?.id as number,
      role: entry.role,
      name: entry.name,
      localPath: entry.path,
      defaultBranch: entry.defaultBranch ?? 'main',
    });
    if ('conflict' in created) throw new Error(`bentrok: ${entry.name}`);
    return repos.update(created.repo.id, {
      role: entry.role,
      defaultBranch: entry.defaultBranch ?? 'main',
      specPath: entry.specPath ?? null,
      specCmd: entry.specCmd ?? null,
    }) as Repo;
  });
}

const allFixtures = (): Repo[] => register(Object.values(fixtures.repos).map(entryOf));

const checksRepo = () => createCheckRepository(db);

async function finish(provider: Repo, headRef = 'feature/xyz', baseRef = 'main'): Promise<Check> {
  const started = await runner.start({ provider, baseRef, headRef });
  await runner.registry.forProject(provider.project_id)?.done;
  return checksRepo().get(started.id) as Check;
}

const providerOf = (repos: Repo[]) => repos.find((repo) => repo.name === 'svc-order') as Repo;

interface FindingRow {
  endpoint: string;
  repo: string | null;
  file: string | null;
  line: number | null;
  kind: string;
  severity: string;
  detail: string;
  confidence: string | null;
  via_symbol: string | null;
  snippet_json: string | null;
}

const findingRows = (checkId: number): FindingRow[] =>
  db
    .prepare(
      `SELECT f.endpoint, r.name AS repo, f.file, f.line, f.kind, f.severity, f.detail,
              f.confidence, f.via_symbol, f.snippet_json
       FROM findings f LEFT JOIN repos r ON r.id = f.consumer_repo_id
       WHERE f.check_id = ? ORDER BY f.id`,
    )
    .all(checkId) as FindingRow[];

const summaryOf = (checkId: number): CheckSummary =>
  CheckSummary.parse(
    JSON.parse(
      (
        db.prepare('SELECT summary_json FROM checks WHERE id = ?').get(checkId) as {
          summary_json: string;
        }
      ).summary_json,
    ),
  );

/** Semua event check dari buffer (check yang sudah selesai tetap disimpan di memori). */
const replayOf = (checkId: number): CheckEvent[] => [
  ...(runner.events.subscribe(checkId, () => undefined)?.replay ?? []),
];

/** Detail event step terakhir untuk nomor langkah tertentu. */
const lastStepDetail = (events: CheckEvent[], number: number): string =>
  events.flatMap((e) => (e.type === 'step' && e.number === number ? [e.detail] : [])).at(-1) ?? '';

const brief = (rows: FindingRow[]) =>
  rows.map((r) => [r.endpoint, r.repo, r.file, r.line, r.kind, r.severity, r.confidence]);

describe('pipeline enam langkah (fixture asli, oasdiff dan Claude palsu)', () => {
  it('merangkai langkah 1–6: finding, ringkasan, artefak, dan cache ekstraksi', async () => {
    const repos = allFixtures();
    const check = await finish(providerOf(repos));

    expect(check).toMatchObject({
      status: 'findings',
      error: null,
      base_sha: order().commits['initial'],
      head_sha: order().commits['feature-xyz'],
    });
    expect(check.finished_at).not.toBeNull();

    const mfe = fixtures.repos['mfe-dashboard'];
    const listLine = await lineOf(mfe, 'src/api/orders.ts', "http.get('/orders'");
    const paymentLine = await lineOf(
      fixtures.repos['svc-payment'],
      'internal/clients/order_client.go',
      'c.baseURL + "/orders"',
    );
    const totalLine = await lineOf(mfe, 'src/pages/OrdersPage.tsx', 'data.total');
    const detailLine = await lineOf(mfe, 'src/api/orders.ts', 'getOrder =');
    const rows = findingRows(check.id);
    expect(brief(rows)).toEqual(
      expect.arrayContaining([
        ['GET /orders', 'mfe-dashboard', 'src/api/orders.ts', listLine, 'removed', 'break', 'high'],
        // Hop 2: keyakinan dibatasi medium oleh markViaSymbol; dilolos verifikasi lewat simbol.
        [
          'GET /orders',
          'mfe-dashboard',
          'src/pages/OrdersPage.tsx',
          totalLine,
          'removed',
          'break',
          'medium',
        ],
        [
          'POST /orders',
          'svc-payment',
          'internal/clients/order_client.go',
          paymentLine,
          'required_added',
          'break',
          'high',
        ],
        [
          'POST /orders',
          'svc-payment',
          'internal/clients/order_client.go',
          paymentLine,
          'param_mismatch',
          'warn',
          'high',
        ],
        [
          'GET /orders/{order_id}',
          'mfe-dashboard',
          'src/api/orders.ts',
          detailLine,
          'type_changed',
          'warn',
          'high',
        ],
        ['GET /orders', null, null, null, 'type_changed', 'info', null],
        ['GET /orders/{order_id}', null, null, null, 'type_changed', 'info', null],
      ]),
    );
    expect(rows).toHaveLength(7);

    const viaHop2 = rows.find((r) => r.file === 'src/pages/OrdersPage.tsx');
    expect(viaHop2?.via_symbol).toBe('useOrders');
    const removedQuery = rows.find((r) => r.line === listLine);
    expect(removedQuery?.detail).toContain('page_size');
    expect(removedQuery?.detail).toContain('limit'); // saran heuristik (CC-047)
    // Sorotan di baris panggilan; page_size ada di baris sesudahnya, jadi tidak jadi token (D-47).
    const querySnippet = JSON.parse(removedQuery?.snippet_json as string) as {
      highlight: number;
      tokens: string[];
      lines: { n: number; text: string }[];
    };
    expect(querySnippet).toMatchObject({ highlight: listLine, tokens: [] });
    expect(querySnippet.lines.some((l) => l.text.includes('page_size'))).toBe(true);
    // Field response disitir di barisnya sendiri, jadi tokennya tersimpan.
    expect(JSON.parse(viaHop2?.snippet_json as string)).toMatchObject({
      highlight: totalLine,
      tokens: ['total'],
    });

    const summary = summaryOf(check.id);
    expect(summary).toMatchObject({
      counts: { break: 3, warn: 2, info: 2 },
      files_checked: 6, // lima berkas hop 1 + OrdersPage.tsx
      files_via_hop2: 1,
      endpoints_without_consumer: [],
      incomplete: false,
      skipped_files: 0,
      spec_unpinned: false,
      fetch_errors: [],
    });
    expect(summary.tool_versions['oasdiff']).toBe('1.35.0');
    expect(summary.tool_versions['node']).toMatch(/^v\d+/); // dari spec_cmd (D-51)
    expect(Object.keys(summary.consumer_shas).sort()).toEqual(['mfe-dashboard', 'svc-payment']);
    expect(summary.consumer_shas['mfe-dashboard']).toBe(
      rawGit(mfe.path, 'rev-parse', 'origin/main'),
    );
    expect(summary.matched_fields['POST /orders']).toEqual(['customer_id', 'items']);
    expect(summary.matched_fields['GET /orders']).toEqual(['status', 'items']);

    // Cuplikan awet (CC-048): persis baris di SHA consumer, dan tidak berubah walau berkasnya diubah kemudian.
    const consumerSha = summary.consumer_shas['mfe-dashboard'] as string;
    const atSha = rawGit(mfe.path, 'show', `${consumerSha}:src/api/orders.ts`).split('\n');
    for (const line of querySnippet.lines) expect(line.text).toBe(atSha[line.n - 1]);
    const ordersFile = path.join(mfe.path, 'src/api/orders.ts');
    const original = await fs.readFile(ordersFile, 'utf8');
    await fs.writeFile(ordersFile, 'export const diubah = 1;\n');
    try {
      expect(findingRows(check.id).find((r) => r.line === listLine)?.snippet_json).toBe(
        removedQuery?.snippet_json,
      );
    } finally {
      await fs.writeFile(ordersFile, original);
    }

    // Artefak langkah 1 dan hasil ekstraksi (6 panggilan Claude, satu berkas per hasil).
    for (const name of ['spec-base.json', 'spec-head.json', 'changelog.json']) {
      await expect(fs.stat(layout.checkArtifact(check.id, name))).resolves.toBeDefined();
    }
    const extracted = await fs.readdir(path.join(layout.checkRunDir(check.id), 'extract'));
    expect(extracted).toHaveLength(6);
    expect(callJson).toHaveBeenCalledTimes(6);
    expect(await fs.readdir(layout.checkRunDir(check.id))).not.toContainEqual(
      expect.stringMatching(/^wt-/),
    );

    // Check kedua atas ref yang sama: ekstraksi dari cache, hasil sama.
    const again = await finish(providerOf(repos));
    expect(again.id).not.toBe(check.id);
    expect(callJson).toHaveBeenCalledTimes(6);
    expect(brief(findingRows(again.id))).toEqual(brief(rows));
  }, 180_000);

  it('head_ref berupa tag dan berupa SHA menghasilkan check yang sama dengan branch-nya', async () => {
    changelog.mockResolvedValue([]);
    const provider = providerOf(allFixtures());
    const head = order().commits['feature-xyz'] as string;

    for (const headRef of ['v-feature', head, 'feature/xyz']) {
      const check = await finish(provider, headRef);
      expect(check).toMatchObject({
        status: 'clean',
        head_ref: headRef,
        base_sha: order().commits['initial'],
        head_sha: head,
      });
    }
    // Tanpa endpoint berubah tidak ada yang dicari di consumer.
    expect(callJson).not.toHaveBeenCalled();
    changelog.mockImplementation(() => Promise.resolve([...FIXTURE_CHANGELOG]));
  }, 120_000);

  it('ref tidak ada → failed dengan alasan, bukan clean; SHA belum terisi', async () => {
    const check = await finish(providerOf(allFixtures()), 'feature/old');

    expect(check).toMatchObject({
      status: 'failed',
      error: 'origin/feature/old tidak ada',
      head_sha: null,
      base_sha: null,
    });
    expect(check.finished_at).not.toBeNull();
    expect(findingRows(check.id)).toEqual([]);
    expect(changelog).not.toHaveBeenCalled();
  }, 60_000);

  it('riwayat tidak berhubungan → failed dengan pesan yang menyebut kedua ref', async () => {
    const [provider] = register([
      { name: 'unrelated', role: 'service', path: unrelated, specPath: 'openapi.json' },
    ]);

    const check = await finish(provider as Repo, 'lain');

    expect(check.status).toBe('failed');
    expect(check.error).toContain('main');
    expect(check.error).toContain('lain');
    expect(check.error).toContain('tidak berhubungan');
  }, 60_000);

  it('generate spec gagal → failed, bukan clean', async () => {
    const entries = Object.values(fixtures.repos).map(entryOf);
    const failing = entries.map((entry) =>
      entry.name === 'svc-order' ? { ...entry, specCmd: 'node -e "process.exit(3)"' } : entry,
    );
    const check = await finish(providerOf(register(failing)));

    expect(check.status).toBe('failed');
    expect(check.error).toContain('spec_cmd gagal');
    expect(findingRows(check.id)).toEqual([]);
    expect(callJson).not.toHaveBeenCalled();
  }, 120_000);

  it('spec_path belum diisi → failed dengan petunjuk', async () => {
    const entries = Object.values(fixtures.repos).map(entryOf);
    const bare = entries.map((entry) =>
      entry.name === 'svc-order' ? { ...entry, specPath: null, specCmd: null } : entry,
    );
    const check = await finish(providerOf(register(bare)));

    expect(check.status).toBe('failed');
    expect(check.error).toContain('belum punya spec_path');
  }, 60_000);

  it('fetch consumer gagal → check lanjut dan kegagalannya masuk ringkasan; fetch provider gagal → failed', async () => {
    const clone = async (name: string, from: FixtureRepo) => {
      const dir = path.join(tmp, name);
      rawGit(tmp, 'clone', '--quiet', from.remote, dir);
      // Ref origin/main sudah ada di klon; fetch berikutnya yang gagal.
      rawGit(dir, 'remote', 'set-url', 'origin', path.join(tmp, 'tidak-ada.git'));
      return dir;
    };
    const brokenConsumer = await clone('consumer-rusak', fixtures.repos['svc-payment']);
    const [provider] = register([
      entryOf(order()),
      { name: 'consumer-rusak', role: 'microfrontend', path: brokenConsumer },
    ]);

    const check = await finish(provider as Repo);

    expect(check.status).toBe('findings');
    const summary = summaryOf(check.id);
    expect(summary.fetch_errors).toHaveLength(1);
    expect(summary.fetch_errors[0]).toMatchObject({ repo: 'consumer-rusak' });
    expect(summary.fetch_errors[0]?.message).toContain('Fetch gagal');
    expect(summary.consumer_shas).toHaveProperty('consumer-rusak');

    const brokenProvider = await clone('provider-rusak', order());
    const [bad] = register([{ ...entryOf(order()), name: 'provider-rusak', path: brokenProvider }]);
    const failed = await finish(bad as Repo);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('provider-rusak');
    expect(failed.error).toContain('Fetch gagal');
  }, 120_000);
});

describe('event SSE dari pipeline (CC-061)', () => {
  const stepsOf = (events: CheckEvent[]) => events.flatMap((e) => (e.type === 'step' ? [e] : []));
  const logsOf = (events: CheckEvent[]) =>
    events.flatMap((e) => (e.type === 'log' ? [`${e.category}: ${e.message}`] : []));
  /** Status dan detail terakhir tiap nomor langkah. */
  const lastPerStep = (events: CheckEvent[]) =>
    Object.fromEntries(stepsOf(events).map((e) => [e.number, [e.status, e.detail]]));

  it('enam langkah berakhir done dengan teks detail seperti mockup; log menandai berkas dari cache', async () => {
    const repos = allFixtures();
    const initial = (order().commits['initial'] as string).slice(0, 7);

    const first = await finish(providerOf(repos));
    const events = replayOf(first.id);

    expect(events.map((e) => e.seq)).toEqual(events.map((_, index) => index + 1));
    expect(new Set(stepsOf(events).map((e) => e.number))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(lastPerStep(events)).toEqual({
      1: ['done', `merge-base ${initial} · 4 perubahan breaking di 4 endpoint · spec_stale: tidak`],
      2: ['done', '5 file kandidat di 2 repo (git grep) · repo e2e dilewati'],
      3: ['done', '5 dari 5 file selesai · 0 dari cache · batas 40 file per check'],
      4: ['done', '1 file lewat simbol: useOrders'],
      5: ['done', '5 pemakaian cocok · 3 break · 2 warn · 2 info'],
      6: ['done', '7 finding disimpan'],
    });
    // Progres langkah 3: satu event running per berkas, lalu done.
    expect(
      stepsOf(events)
        .filter((e) => e.number === 3)
        .map((e) => e.status),
    ).toEqual(['running', 'running', 'running', 'running', 'running', 'running', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'findings' });

    const logs = logsOf(events);
    expect(logs[0]).toBe(`start: check #${first.id} · svc-order · main → feature/xyz`);
    expect(logs).toContainEqual(
      expect.stringMatching(/^resolve: main=\w{7} · feature\/xyz=\w{7} · merge-base=\w{7}$/),
    );
    expect(logs).toContain('diff: oasdiff: 4 breaking changes, 4 endpoints');
    expect(logs).toContain('diff: spec_stale: no');
    expect(logs).toContain('grep: 5 candidate files in 2 repos');
    expect(logs).toContain('extract: src/api/orders.ts');
    expect(logs).not.toContain('extract: src/api/orders.ts (cache)');

    // Check kedua: semua berkas dari cache dan log menandainya.
    const again = await finish(providerOf(repos));
    const secondEvents = replayOf(again.id);
    expect(lastPerStep(secondEvents)[3]).toEqual([
      'done',
      '5 dari 5 file selesai · 5 dari cache · batas 40 file per check',
    ]);
    expect(logsOf(secondEvents)).toContain('extract: src/api/orders.ts (cache)');
  }, 180_000);

  it('tanpa endpoint berubah: langkah 2–5 dilewati dengan alasannya, check clean', async () => {
    changelog.mockResolvedValue([]);

    const check = await finish(providerOf(allFixtures()));
    const events = replayOf(check.id);

    expect(lastPerStep(events)).toMatchObject({
      1: ['done', expect.stringContaining('0 perubahan breaking di 0 endpoint')],
      2: ['skipped', 'Tidak ada endpoint yang berubah'],
      3: ['skipped', 'Tidak ada endpoint yang berubah'],
      4: ['skipped', 'Tidak ada endpoint yang berubah'],
      5: ['skipped', 'Tidak ada endpoint yang berubah'],
      6: ['done', '0 finding disimpan'],
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'clean' });
    changelog.mockImplementation(() => Promise.resolve([...FIXTURE_CHANGELOG]));
  }, 120_000);

  it('langkah yang gagal mengirim step failed dengan alasannya lalu done failed', async () => {
    const check = await finish(providerOf(allFixtures()), 'feature/old');
    const events = replayOf(check.id);

    expect(stepsOf(events).map((e) => [e.number, e.status, e.detail])).toEqual([
      [1, 'running', ''],
      [1, 'failed', 'origin/feature/old tidak ada'],
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'failed' });
  }, 60_000);

  it('klien yang menyambung di tengah langkah 3 tetap menerima langkah 1 dan 2; abort berakhir done cancelled', async () => {
    hold = true;
    const provider = providerOf(allFixtures());
    const started = await runner.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await vi.waitFor(() => expect(callJson).toHaveBeenCalled(), { timeout: 60_000 });

    const live: CheckEvent[] = [];
    const subscription = runner.events.subscribe(started.id, (event) => live.push(event));
    expect(subscription?.finished).toBe(false);
    expect(lastPerStep([...(subscription?.replay ?? [])])).toMatchObject({
      1: ['done', expect.stringContaining('merge-base')],
      2: ['done', expect.stringContaining('file kandidat')],
      3: ['running', expect.stringContaining('dari 5 file selesai')],
    });

    await runner.stop();

    expect(live.at(-1)).toMatchObject({ type: 'done', status: 'cancelled' });
    expect(runner.events.listenerCount(started.id)).toBe(0);
  }, 120_000);
});

describe('batas dan kegagalan spec', () => {
  it('batas berkas per check memotong kandidat: ringkasan incomplete dengan jumlah yang terlewat', async () => {
    const limited = createCheckRunner({ ...deps, config: { ...deps.config, maxFilesPerCheck: 2 } });
    const provider = providerOf(allFixtures());

    const started = await limited.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await limited.registry.forProject(provider.project_id)?.done;

    expect(checksRepo().get(started.id)?.status).toBe('findings');
    const summary = summaryOf(started.id);
    // Lima kandidat hop 1: dua teratas (match_count) diekstrak, tiga dilewati. Hop 2 menemukan
    // OrdersPage.tsx lewat useOrders, jadi tiga berkas diperiksa.
    expect(summary).toMatchObject({
      incomplete: true,
      skipped_files: 3,
      files_checked: 3,
      files_via_hop2: 1,
    });
    // Jumlah yang dilewati muncul di event langkah 2 (CC-038).
    const stepTwo = limited.events
      .subscribe(started.id, () => undefined)
      ?.replay.find((e) => e.type === 'step' && e.number === 2 && e.status === 'done');
    expect(stepTwo).toMatchObject({
      detail:
        '5 file kandidat di 2 repo (git grep) · repo e2e dilewati · 3 file dilewati (batas 2)',
    });
  }, 120_000);

  it('Swagger 2 yang tidak bisa dikonversi → failed, bukan clean (D-56)', async () => {
    const bare = path.join(tmp, 'swagger.git');
    const work = path.join(tmp, 'swagger');
    await fs.mkdir(work, { recursive: true });
    rawGit(tmp, 'init', '--quiet', '--bare', bare);
    rawGit(work, 'init', '--quiet', '--initial-branch=main');
    await fs.writeFile(
      path.join(work, 'swagger.json'),
      JSON.stringify({ swagger: '2.0', paths: 'bukan objek' }),
    );
    rawGit(work, 'add', '.');
    rawGit(work, 'commit', '--quiet', '-m', 'awal');
    rawGit(work, 'checkout', '--quiet', '-b', 'fitur');
    await fs.appendFile(path.join(work, 'swagger.json'), '\n');
    rawGit(work, 'commit', '--quiet', '-am', 'fitur');
    rawGit(work, 'remote', 'add', 'origin', bare);
    rawGit(work, 'push', '--quiet', 'origin', 'main', 'fitur');
    const [provider] = register([
      { name: 'swagger', role: 'service', path: work, specPath: 'swagger.json' },
    ]);

    const check = await finish(provider as Repo, 'fitur');

    expect(check.status).toBe('failed');
    expect(check.error).toContain('gagal dikonversi dari Swagger 2');
    expect(changelog).not.toHaveBeenCalled();
  }, 60_000);
});

describe('Batalkan (CC-062)', () => {
  /** Worktree terdaftar di repo provider; hanya klon utama yang boleh tersisa. */
  const worktrees = () =>
    rawGit(order().path, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '));
  const leftovers = async (checkId: number) =>
    (await fs.readdir(layout.checkRunDir(checkId)).catch(() => [] as string[])).filter((name) =>
      name.startsWith('wt-'),
    );

  it('batal di tengah langkah 3: cancelled, nol worktree dan finding; ekstraksi yang selesai dipakai check berikutnya', async () => {
    hold = true;
    holdAfter = 2; // dua berkas pertama selesai dan masuk cache, sisanya menggantung
    const provider = providerOf(allFixtures());
    const started = await runner.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await vi.waitFor(() => expect(callJson.mock.calls.length).toBeGreaterThanOrEqual(3), {
      timeout: 60_000,
    });

    const cancelled = await runner.cancel(started.id);

    expect(cancelled).toMatchObject({ id: started.id, status: 'cancelled', error: null });
    expect(findingRows(started.id)).toEqual([]);
    expect(await leftovers(started.id)).toEqual([]);
    expect(worktrees()).toHaveLength(1);
    expect(runner.registry.forProject(provider.project_id)).toBeUndefined();
    expect(replayOf(started.id).at(-1)).toMatchObject({ type: 'done', status: 'cancelled' });

    hold = false;
    const callsBefore = callJson.mock.calls.length;
    const next = await finish(provider);

    expect(next.status).toBe('findings');
    // Enam berkas (lima hop 1 + OrdersPage.tsx); dua sudah di cache dari check yang dibatalkan.
    expect(callJson.mock.calls.length - callsBefore).toBe(4);
    expect(lastStepDetail(replayOf(next.id), 3)).toContain('2 dari cache');
  }, 180_000);

  it('batal saat spec_cmd berjalan: proses dihentikan dan worktree dihapus dari disk dan metadata git', async () => {
    const entries = Object.values(fixtures.repos).map(entryOf);
    const slow = entries.map((entry) =>
      entry.name === 'svc-order'
        ? { ...entry, specCmd: 'node -e "setTimeout(() => {}, 120000)"' }
        : entry,
    );
    const provider = providerOf(register(slow));
    const started = await runner.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await vi.waitFor(async () => expect(await leftovers(started.id)).toHaveLength(1), {
      timeout: 60_000,
    });
    expect(worktrees()).toHaveLength(2);

    const begin = Date.now();
    const cancelled = await runner.cancel(started.id);

    expect(Date.now() - begin).toBeLessThan(30_000); // spec_cmd sendiri akan berjalan 120 dtk
    expect(cancelled.status).toBe('cancelled');
    expect(await leftovers(started.id)).toEqual([]);
    expect(worktrees()).toHaveLength(1);
    expect(findingRows(started.id)).toEqual([]);
  }, 120_000);

  it('check yang sudah selesai atau tidak ada → CheckNotRunningError dan statusnya tidak berubah', async () => {
    const finished = await finish(providerOf(allFixtures()), 'feature/old');
    expect(finished.status).toBe('failed');

    await expect(runner.cancel(finished.id)).rejects.toBeInstanceOf(CheckNotRunningError);
    await expect(runner.cancel(99_999)).rejects.toBeInstanceOf(CheckNotRunningError);
    expect(checksRepo().get(finished.id)?.status).toBe('failed');
  }, 60_000);
});

describe('registry dan abort', () => {
  it('project yang sudah punya check berjalan → CheckAlreadyRunningError; repo yang dibaca terhitung sibuk', async () => {
    hold = true;
    const repos = allFixtures();
    const provider = providerOf(repos);

    const first = await runner.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await vi.waitFor(() => expect(callJson).toHaveBeenCalled(), { timeout: 60_000 });

    const second = await runner
      .start({ provider, baseRef: 'main', headRef: 'feature/xyz' })
      .catch((e: unknown) => e);
    expect(second).toBeInstanceOf(CheckAlreadyRunningError);
    expect(second).toMatchObject({ projectId: provider.project_id, checkId: first.id });
    expect(checksRepo().get(first.id + 1)).toBeUndefined();

    for (const repo of repos) {
      expect(runner.registry.usesRepo(repo.id)).toBe(repo.role !== 'e2e');
    }

    await runner.stop();
    expect(checksRepo().get(first.id)?.status).toBe('cancelled');
    expect(runner.registry.forProject(provider.project_id)).toBeUndefined();
    expect(runner.registry.usesRepo(provider.id)).toBe(false);
  }, 120_000);

  it('abort → cancelled tanpa finding parsial, worktree bersih; project bisa menjalankan check lagi', async () => {
    hold = true;
    const provider = providerOf(allFixtures());
    const check = await runner.start({ provider, baseRef: 'main', headRef: 'feature/xyz' });
    await vi.waitFor(() => expect(callJson).toHaveBeenCalled(), { timeout: 60_000 });

    runner.registry.forProject(provider.project_id)?.abort.abort();
    await runner.registry.forProject(provider.project_id)?.done;

    expect(checksRepo().get(check.id)).toMatchObject({ status: 'cancelled', error: null });
    expect(findingRows(check.id)).toEqual([]);
    expect(await fs.readdir(layout.checkRunDir(check.id))).not.toContainEqual(
      expect.stringMatching(/^wt-/),
    );

    hold = false;
    expect((await finish(provider)).status).toBe('findings');
  }, 120_000);

  it('oasdiff tidak bisa dipakai → ditolak sebelum baris check dibuat', async () => {
    const provider = providerOf(allFixtures());
    const unavailable = createCheckRunner({
      ...deps,
      oasdiff: {
        assertAvailable: () =>
          Promise.reject(new OasdiffUnavailableError('missing', 'oasdiff tidak ditemukan')),
        changelog,
      },
    });
    const before = db.prepare('SELECT COUNT(*) AS n FROM checks').get();

    await expect(
      unavailable.start({ provider, baseRef: 'main', headRef: 'feature/xyz' }),
    ).rejects.toBeInstanceOf(OasdiffUnavailableError);

    expect(db.prepare('SELECT COUNT(*) AS n FROM checks').get()).toEqual(before);
  });
});
