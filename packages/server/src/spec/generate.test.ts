import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter, type GitAdapter } from '../git/adapter.js';
import { CommandAbortedError, CommandTimeoutError } from '../proc/errors.js';
import { createCommandRunner, type CommandRunner } from '../proc/run-command.js';
import { WorkspaceLayout } from '../workspace/layout.js';
import { SpecGenError, SpecMissing, SpecParseError } from './errors.js';
import { generateSpec, type GenerateInput, type SpecGeneratorDeps } from './generate.js';
import { resolveCommittedSpec } from './resolve.js';

const NODE = process.execPath;
const SHA = 'a'.repeat(40);

let tmp: string;
let layout: WorkspaceLayout;
let runner: CommandRunner;
let adapter: GitAdapter;

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitFor(condition: () => Promise<boolean> | boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`kondisi tidak terpenuhi dalam ${ms} ms`);
}

/** `node -e` yang aman untuk cmd.exe maupun sh: tanpa tanda kutip ganda di dalam skrip. */
const nodeEval = (script: string) => `"${NODE}" -e "${script}"`;
const writeFile = (name: string, content: string) =>
  nodeEval(`require('fs').writeFileSync('${name}', '${content}')`);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-gen-'));
  layout = new WorkspaceLayout(path.join(tmp, 'workspace'));
  await fs.mkdir(layout.checksDir, { recursive: true });
  runner = createCommandRunner({ oasdiffBin: 'oasdiff', shellRoot: layout.checksDir });
  adapter = createGitAdapter(runner);
});
afterEach(async () => {
  runner.killAll();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('dengan git asli (fixture)', () => {
  let fixtures: FixtureSet;
  let fixturesTmp: string;

  beforeAll(async () => {
    fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-gen-fx-'));
    fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
  }, 120_000);
  afterAll(async () => {
    await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const order = () => fixtures.repos['svc-order'];
  const deps = (timeoutMs = 30_000): SpecGeneratorDeps => ({
    git: adapter,
    runner,
    layout,
    timeoutMs,
  });
  const input = (specCmd: string, extra: Partial<GenerateInput> = {}): GenerateInput => ({
    checkId: 1,
    repo: order().path,
    sha: order().commits['initial'] as string,
    specPath: 'openapi.json',
    specCmd,
    ...extra,
  });
  const worktrees = () =>
    execFileSync('git', ['-C', order().path, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree ')).length;
  const worktreeGone = async (sha = order().commits['initial'] as string) => {
    expect(await exists(layout.worktreeDir(1, sha))).toBe(false);
    expect(worktrees()).toBe(1);
  };

  it('menjalankan spec_cmd fixture: dokumen sama dengan yang ter-commit, versi node tercatat', async () => {
    const generated = await generateSpec(deps(), input(order().specCmd as string));
    const committed = await resolveCommittedSpec(adapter, {
      repo: order().path,
      sha: generated.sha,
      specPath: 'openapi.json',
    });
    expect(generated).toMatchObject({ source: 'generated', path: 'openapi.json' });
    expect(generated.document).toEqual(committed.document);
    expect(generated.tool_versions['node']).toMatch(/^v\d+\./);
    await worktreeGone();
  });

  it('spec dibaca dari hasil spec_cmd, bukan dari berkas ter-commit', async () => {
    const generated = await generateSpec(
      deps(),
      input(writeFile('gen.yaml', 'dibuat: ya'), { specPath: 'gen.yaml' }),
    );
    expect(generated.document).toEqual({ dibuat: 'ya' });
    await worktreeGone();
  });

  it('repo tanpa lockfile → spec_unpinned; repo dengan requirements.txt terkunci → tidak', async () => {
    const payment = fixtures.repos['svc-payment'];
    const cmd = writeFile('gen.yaml', 'a: 1');
    const unpinned = await generateSpec(
      deps(),
      input(cmd, {
        repo: payment.path,
        sha: payment.commits['initial'] as string,
        specPath: 'gen.yaml',
      }),
    );
    const pinned = await generateSpec(deps(), input(cmd, { specPath: 'gen.yaml' }));
    expect(unpinned.spec_unpinned).toBe(true);
    expect(pinned.spec_unpinned).toBe(false);
  });

  it('exit bukan nol → SpecGenError dengan 20 baris terakhir stderr; worktree terhapus', async () => {
    const cmd = nodeEval(
      "for (let i = 1; i <= 25; i++) console.error('baris ' + i); process.exit(3)",
    );
    const error = await generateSpec(deps(), input(cmd)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpecGenError);
    const { exitCode, stderrTail } = error as SpecGenError;
    expect(exitCode).toBe(3);
    const lines = stderrTail.split('\n').map((line) => line.trim());
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('baris 6');
    expect(lines[19]).toBe('baris 25');
    await worktreeGone();
  });

  describe('timeout dan abort', () => {
    /** Skrip yang memunculkan cucu proses lalu menunggu selamanya (sama dengan run-command.test). */
    async function startTree(): Promise<{ pidFile: string; command: string }> {
      const script = path.join(tmp, 'tree.cjs');
      const pidFile = path.join(tmp, 'pids.json');
      await fs.writeFile(
        script,
        `const { spawn } = require('node:child_process');
         const fs = require('node:fs');
         const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
         fs.writeFileSync(process.argv[2], JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
         setInterval(() => {}, 1000);`,
      );
      return { pidFile, command: `"${NODE}" "${script}" "${pidFile}"` };
    }

    async function pidsOf(pidFile: string): Promise<{ child: number; grandchild: number }> {
      await waitFor(() => exists(pidFile));
      for (let i = 0; i < 20; i++) {
        const text = await fs.readFile(pidFile, 'utf8');
        if (text) return JSON.parse(text) as { child: number; grandchild: number };
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('pid file kosong');
    }

    it('timeout → CommandTimeoutError, seluruh process group mati, worktree terhapus', async () => {
      const { pidFile, command } = await startTree();
      const settled = generateSpec(deps(1500), input(command)).catch((e: unknown) => e);
      const { child, grandchild } = await pidsOf(pidFile);
      expect(await settled).toBeInstanceOf(CommandTimeoutError);
      await waitFor(() => !alive(child) && !alive(grandchild));
      await worktreeGone();
    }, 60_000);

    it('abort → CommandAbortedError, seluruh process group mati, worktree terhapus', async () => {
      const { pidFile, command } = await startTree();
      const controller = new AbortController();
      const settled = generateSpec(
        deps(60_000),
        input(command, { signal: controller.signal }),
      ).catch((e: unknown) => e);
      const { child, grandchild } = await pidsOf(pidFile);
      controller.abort();
      expect(await settled).toBeInstanceOf(CommandAbortedError);
      await waitFor(() => !alive(child) && !alive(grandchild));
      await worktreeGone();
    }, 60_000);
  });
});

describe('dengan git palsu (isi worktree diatur test)', () => {
  /** `worktreeAdd` menulis `files` ke folder worktree; `worktreeRemove` menghapusnya. */
  const fakeGit = (files: Record<string, string>): SpecGeneratorDeps['git'] => ({
    async worktreeAdd(_repo, dir) {
      await fs.mkdir(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await fs.writeFile(path.join(dir, name), content);
      }
    },
    async worktreeRemove(_repo, dir) {
      await fs.rm(dir, { recursive: true, force: true });
    },
  });

  const generate = (files: Record<string, string>, specCmd = 'echo ok', specPath = 'spec.yaml') =>
    generateSpec(
      { git: fakeGit(files), runner, layout, timeoutMs: 30_000 },
      { checkId: 1, repo: tmp, sha: SHA, specPath, specCmd },
    );
  const SPEC = { 'spec.yaml': 'openapi: 3.0.3\n' };

  it.each(['uv.lock', 'poetry.lock', 'go.sum', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])(
    '%s menandai terkunci',
    async (lockfile) => {
      expect((await generate({ ...SPEC, [lockfile]: '' })).spec_unpinned).toBe(false);
    },
  );

  it.each<[string, string | undefined, boolean]>([
    [
      'semua baris `==`, dengan komentar dan baris kosong',
      '# runtime\nfastapi==0.115.0\n\n\r\nuvicorn==0.30.6\n',
      false,
    ],
    ['ada baris tanpa `==`', 'fastapi==0.115.0\npydantic>=2\n', true],
    ['hanya komentar', '# kosong\n', true],
    ['tanpa requirements.txt', undefined, true],
  ])('requirements.txt: %s', async (_name, requirements, unpinned) => {
    const files = requirements === undefined ? SPEC : { ...SPEC, 'requirements.txt': requirements };
    expect((await generate(files)).spec_unpinned).toBe(unpinned);
  });

  it('lockfile yang dibuat spec_cmd tidak dihitung', async () => {
    const cmd = writeFile('uv.lock', 'x');
    expect((await generate(SPEC, cmd)).spec_unpinned).toBe(true);
  });

  it('tool_versions hanya memuat tool yang disebut spec_cmd', async () => {
    expect(Object.keys((await generate(SPEC, 'echo ok')).tool_versions)).toEqual([]);
    const withNode = await generate(SPEC, nodeEval('0'));
    expect(withNode.tool_versions['node']).toMatch(/^v\d+\./);
  });

  it('spec_path tidak ada, atau keluar dari worktree → SpecMissing', async () => {
    await expect(generate({}, 'echo ok')).rejects.toBeInstanceOf(SpecMissing);
    // `runs/checks/1/luar.yaml` ada, tetapi berada di luar worktree.
    await fs.mkdir(path.join(layout.checksDir, '1'), { recursive: true });
    await fs.writeFile(path.join(layout.checksDir, '1', 'luar.yaml'), 'a: 1');
    await expect(generate(SPEC, 'echo ok', '../luar.yaml')).rejects.toBeInstanceOf(SpecMissing);
  });

  it('isi spec rusak → SpecParseError', async () => {
    await expect(generate({ 'spec.yaml': 'a: [\n' })).rejects.toBeInstanceOf(SpecParseError);
  });
});
