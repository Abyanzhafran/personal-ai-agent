import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../llm/client.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import {
  createExtractionRunner,
  extractionCacheVersion,
  type ExtractionFile,
  type ExtractionRunInput,
  type FileExtraction,
} from './runner.js';

// Tiap run menulis berkas dengan fsync di Windows; beri ruang saat mesin sibuk.
vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

let tmp: string;
let layout: WorkspaceLayout;
let workspace: WorkspaceStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-extract-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const blob = (n: number) => String(n).padStart(40, '0');

function file(n: number, over: Partial<ExtractionFile> = {}): ExtractionFile {
  return { repoId: 1, path: `src/api/f${n}.ts`, blob_sha: blob(n), profile: 'profil', ...over };
}

/** `file` sengaja salah: runner harus menimpanya dengan path berkas yang diminta. */
const call = (): ApiCall => ({
  method: 'GET',
  path: '/orders',
  file: 'dari-model.ts',
  line: 3,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
});

interface CallInput {
  prompt: { user: string };
  signal?: AbortSignal;
}

function setup(
  options: {
    model?: string;
    maxCalls?: number;
    concurrency?: number;
    reply?: (input: CallInput) => Promise<unknown>;
  } = {},
) {
  const { model = 'm1', maxCalls = 40, concurrency = 4 } = options;
  const callJson = vi.fn(options.reply ?? (() => Promise.resolve({ calls: [call()] })));
  const runner = createExtractionRunner({
    llm: { callJson: callJson as unknown as LlmClient['callJson'] },
    workspace,
    model,
    concurrency,
    maxCalls,
  });
  const run = (
    files: ExtractionFile[],
    extra: Partial<ExtractionRunInput> = {},
    checkId = 1,
  ): Promise<FileExtraction[]> =>
    runner.run({
      checkId,
      files,
      endpoints: [],
      readContent: (f) => Promise.resolve(`// ${f.path}\nfetch('/orders');\n`),
      ...extra,
    });
  return { callJson, run };
}

const statuses = (results: FileExtraction[]) =>
  results.map((r) => (r.status === 'ok' ? `ok:${r.source}` : r.status));

describe('cache (CC-041 AC1, AC4)', () => {
  it('check kedua atas blob yang sama: nol panggilan API dan isi berkas tidak dibaca', async () => {
    const { callJson, run } = setup();
    const files = [file(1), file(2), file(3)];

    expect(statuses(await run(files))).toEqual(['ok:llm', 'ok:llm', 'ok:llm']);
    expect(callJson).toHaveBeenCalledTimes(3);

    const readContent = vi.fn(() => Promise.resolve(''));
    expect(statuses(await run(files, { readContent }, 2))).toEqual([
      'ok:cache',
      'ok:cache',
      'ok:cache',
    ]);
    expect(callJson).toHaveBeenCalledTimes(3);
    expect(readContent).not.toHaveBeenCalled();
  });

  it('blob berubah = ekstraksi ulang', async () => {
    const { callJson, run } = setup();
    await run([file(1)]);
    expect(statuses(await run([file(1, { blob_sha: blob(9) })], {}, 2))).toEqual(['ok:llm']);
    expect(callJson).toHaveBeenCalledTimes(2);
  });

  it('ganti model membatalkan cache lama', async () => {
    await setup({ model: 'm1' }).run([file(1)]);
    const other = setup({ model: 'm2' });
    expect(statuses(await other.run([file(1)], {}, 2))).toEqual(['ok:llm']);
    expect(other.callJson).toHaveBeenCalledTimes(1);
  });

  it('versi cache bergantung pada prompt dan model, dan aman sebagai nama berkas', () => {
    expect(extractionCacheVersion('m', 'a')).not.toBe(extractionCacheVersion('m', 'b'));
    expect(extractionCacheVersion('m1', 'a')).not.toBe(extractionCacheVersion('m2', 'a'));
    expect(extractionCacheVersion('m', 'a')).toBe(extractionCacheVersion('m', 'a'));
    expect(extractionCacheVersion('us.anthropic/claude:0')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('path tidak ikut kunci: blob yang sama di path lain memakai cache dan file ditimpa path barunya', async () => {
    const { callJson, run } = setup();
    const first = await run([file(1, { path: 'a.ts' })]);
    const second = await run([file(1, { path: 'b.ts' })], {}, 2);

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(statuses(second)).toEqual(['ok:cache']);
    const files = (r: FileExtraction | undefined) =>
      r?.status === 'ok' ? r.extraction.calls.map((c) => c.file) : [];
    expect(files(first[0])).toEqual(['a.ts']);
    expect(files(second[0])).toEqual(['b.ts']);
  });

  it('truncated, total_lines, dan sent_lines ikut tersimpan di cache (D-39)', async () => {
    const { run } = setup();
    const big = Array.from({ length: 30 }, () => 'a'.repeat(1000)).join('\n');
    const readContent = () => Promise.resolve(big);

    const [fresh] = await run([file(1)], { readContent });
    const [cached] = await run([file(1)], { readContent }, 2);

    expect(fresh).toMatchObject({
      source: 'llm',
      extraction: { truncated: true, total_lines: 30 },
    });
    expect(fresh?.status === 'ok' && fresh.extraction.sent_lines).toBeLessThan(30);
    expect(cached?.status === 'ok' && cached.source).toBe('cache');
    expect(cached?.status === 'ok' && cached.extraction).toEqual(
      fresh?.status === 'ok' && fresh.extraction,
    );
  });

  it('cache rusak dianggap miss lalu ditimpa', async () => {
    const { callJson, run } = setup();
    await workspace.writeCache(layout.extractCacheFile(1, blob(1), extractionCacheVersion('m1')), {
      calls: 'bukan array',
    });

    expect(statuses(await run([file(1)]))).toEqual(['ok:llm']);
    expect(statuses(await run([file(1)], {}, 2))).toEqual(['ok:cache']);
    expect(callJson).toHaveBeenCalledTimes(1);
  });
});

describe('hasil per berkas', () => {
  it('onFile menerima tiap berkas dengan sumbernya (bahan log "extract <path> (cache)")', async () => {
    const { run } = setup();
    const seen: string[] = [];
    const onFile = (r: FileExtraction) => seen.push(`${r.path} ${statuses([r])[0]}`);

    await run([file(1), file(2)], { onFile });
    await run([file(1)], { onFile }, 2);

    expect(seen.sort()).toEqual([
      'src/api/f1.ts ok:cache',
      'src/api/f1.ts ok:llm',
      'src/api/f2.ts ok:llm',
    ]);
  });

  it('satu berkas gagal ditandai failed; yang lain tetap selesai dan hasil gagal tidak di-cache', async () => {
    const { callJson, run } = setup({
      reply: ({ prompt }) =>
        prompt.user.includes('f2.ts')
          ? Promise.reject(new Error('Respons Claude tidak sesuai skema'))
          : Promise.resolve({ calls: [call()] }),
    });

    const results = await run([file(1), file(2), file(3)]);

    expect(statuses(results)).toEqual(['ok:llm', 'failed', 'ok:llm']);
    expect(results[1]).toMatchObject({
      path: 'src/api/f2.ts',
      error: expect.stringContaining('skema'),
    });
    await expect(
      fs.stat(layout.extractCacheFile(1, blob(2), extractionCacheVersion('m1'))),
    ).rejects.toThrow();

    await run([file(2)], {}, 2);
    expect(callJson).toHaveBeenCalledTimes(4);
  });

  it('galat membaca isi berkas juga hanya menandai berkas itu failed', async () => {
    const { run } = setup();
    const results = await run([file(1), file(2)], {
      readContent: (f) =>
        f.path.endsWith('f1.ts')
          ? Promise.reject(new Error('git show gagal'))
          : Promise.resolve('x'),
    });
    expect(statuses(results)).toEqual(['failed', 'ok:llm']);
  });

  it('hasil yang dipakai (cache maupun baru) disalin ke runs/checks/<id>/extract/; yang gagal tidak', async () => {
    const { run } = setup({
      reply: ({ prompt }) =>
        prompt.user.includes('f3.ts')
          ? Promise.reject(new Error('x'))
          : Promise.resolve({ calls: [call()] }),
    });
    const dir = (checkId: number) => path.dirname(layout.checkExtractFile(checkId, 'x.json'));

    await run([file(1), file(2), file(3)], {}, 1);
    await run([file(1)], {}, 2);

    expect(await fs.readdir(dir(1))).toHaveLength(2);
    const [name] = await fs.readdir(dir(2));
    const copy = JSON.parse(await fs.readFile(path.join(dir(2), name ?? ''), 'utf8')) as unknown;
    expect(copy).toMatchObject({
      repo_id: 1,
      path: 'src/api/f1.ts',
      blob_sha: blob(1),
      source: 'cache',
      truncated: false,
      calls: [{ method: 'GET', path: '/orders', file: 'src/api/f1.ts' }],
    });
  });
});

describe('batas panggilan per check', () => {
  it('berkas di atas batas dilewati; cache hit tidak menghabiskan jatah', async () => {
    const { callJson, run } = setup({ maxCalls: 2, concurrency: 1 });
    const files = [file(1), file(2), file(3), file(4)];

    const first = await run(files);
    expect(statuses(first)).toEqual(['ok:llm', 'ok:llm', 'skipped', 'skipped']);
    expect(first[2]).toMatchObject({ reason: 'budget', path: 'src/api/f3.ts' });
    expect(callJson).toHaveBeenCalledTimes(2);

    const second = await run(files, {}, 2);
    expect(statuses(second)).toEqual(['ok:cache', 'ok:cache', 'ok:llm', 'ok:llm']);
    expect(callJson).toHaveBeenCalledTimes(4);
  });

  it('berkas yang dilewati tidak dibaca isinya dan tidak disalin', async () => {
    const { run } = setup({ maxCalls: 1, concurrency: 1 });
    const readContent = vi.fn(() => Promise.resolve('x'));

    await run([file(1), file(2)], { readContent });

    expect(readContent).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(path.dirname(layout.checkExtractFile(1, 'x.json')))).toHaveLength(1);
  });
});

describe('paralelisme dan pembatalan', () => {
  it('tidak lebih dari concurrency panggilan berjalan bersamaan', async () => {
    let running = 0;
    let peak = 0;
    const { run } = setup({
      concurrency: 2,
      reply: async () => {
        peak = Math.max(peak, ++running);
        await sleep(15);
        running--;
        return { calls: [] };
      },
    });

    await run([1, 2, 3, 4, 5, 6].map((n) => file(n)));

    expect(peak).toBe(2);
  });

  it('signal sudah batal: melempar dan tidak memanggil Claude', async () => {
    const { callJson, run } = setup();
    await expect(run([file(1)], { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(callJson).not.toHaveBeenCalled();
  });

  it('signal batal saat berjalan: panggilan dihentikan, sisa berkas tidak dipanggil, onFile diam', async () => {
    const controller = new AbortController();
    const { callJson, run } = setup({
      concurrency: 1,
      reply: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    });
    const onFile = vi.fn();

    const running = run([file(1), file(2), file(3)], { signal: controller.signal, onFile });
    await vi.waitFor(() => expect(callJson).toHaveBeenCalledTimes(1), { timeout: 5000 });
    controller.abort();

    await expect(running).rejects.toThrow();
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(onFile).not.toHaveBeenCalled();
  });
});
