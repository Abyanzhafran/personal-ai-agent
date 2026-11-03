import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCommandRunner, type CommandRunner } from '../proc/run-command.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { WorkspaceStore } from '../workspace/store.js';
import { SpecGenError } from './errors.js';
import { generateSpecCached, type CachedGenerateInput, type SpecCacheDeps } from './cache.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

let tmp: string;
let layout: WorkspaceLayout;
let workspace: WorkspaceStore;
let runner: CommandRunner;
let runCommand: Mock<CommandRunner['runCommand']>;
let worktreeAdd: Mock<SpecCacheDeps['git']['worktreeAdd']>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-cache-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  workspace = new WorkspaceStore(layout);
  await workspace.ensure();
  runner = createCommandRunner({ oasdiffBin: 'oasdiff', shellRoot: layout.checksDir });
  runCommand = vi.fn(runner.runCommand);
  worktreeAdd = vi.fn(async (_repo: string, dir: string) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'spec.yaml'), 'openapi: 3.0.3\n');
    await fs.writeFile(path.join(dir, 'lain.yaml'), 'lain: true\n');
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const deps = (): SpecCacheDeps => ({
  git: {
    worktreeAdd,
    worktreeRemove: async (_repo, dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  },
  runner: { runCommand },
  layout,
  workspace,
  timeoutMs: 30_000,
});
const input = (extra: Partial<CachedGenerateInput> = {}): CachedGenerateInput => ({
  repoId: 1,
  checkId: 1,
  repo: tmp,
  sha: SHA,
  specPath: 'spec.yaml',
  specCmd: 'echo ok',
  ...extra,
});
const generate = (extra: Partial<CachedGenerateInput> = {}) =>
  generateSpecCached(deps(), input(extra));
const cacheDir = (repoId = 1) => path.join(layout.specCacheDir, String(repoId));
const cached = async (repoId = 1) => (await fs.readdir(cacheDir(repoId))).sort();

describe('generateSpecCached', () => {
  it('SHA yang sama tidak menjalankan spec_cmd lagi dan hasilnya identik', async () => {
    const first = await generate();
    const second = await generate({ checkId: 2 });
    expect(second).toEqual(first);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(worktreeAdd).toHaveBeenCalledTimes(1);
  });

  it('kunci memuat repo, sha, dan spec_cmd', async () => {
    await generate();
    await generate({ specCmd: 'echo lain' });
    await generate({ sha: OTHER_SHA });
    await generate({ repoId: 2 });
    expect(runCommand).toHaveBeenCalledTimes(4);
    expect(await cached(1)).toHaveLength(3); // spec_cmd lain, sha lain, dan aslinya
    expect(await cached(2)).toHaveLength(1);
  });

  it('spec_path berbeda untuk kunci yang sama → miss, bukan dokumen path lama', async () => {
    await generate();
    const other = await generate({ specPath: 'lain.yaml' });
    expect(other).toMatchObject({ path: 'lain.yaml', document: { lain: true } });
    expect(worktreeAdd).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['bukan JSON', 'bukan { json'],
    ['salah bentuk', JSON.stringify({ document: 'bukan objek' })],
  ])('berkas cache rusak (%s) → miss, ditimpa, bukan error', async (_name, content) => {
    await generate();
    const [name] = await cached();
    await fs.writeFile(path.join(cacheDir(), name as string), content);

    const regenerated = await generate();
    expect(regenerated.document).toEqual({ openapi: '3.0.3' });
    expect(worktreeAdd).toHaveBeenCalledTimes(2);

    await generate();
    expect(worktreeAdd).toHaveBeenCalledTimes(2); // sudah pulih
  });

  it('hasil gagal tidak disimpan', async () => {
    const failing = { specCmd: 'exit 1' };
    await expect(generate(failing)).rejects.toBeInstanceOf(SpecGenError);
    await expect(generate(failing)).rejects.toBeInstanceOf(SpecGenError);
    expect(worktreeAdd).toHaveBeenCalledTimes(2);
    await expect(fs.readdir(cacheDir())).rejects.toThrow();
  });
});
