import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CommandAbortedError,
  CommandFailedError,
  CommandNotAllowedError,
  CommandNotFoundError,
  CommandOutputTooLargeError,
  CommandTimeoutError,
} from './errors.js';
import { assertSuccess, createCommandRunner, type CommandRunner } from './run-command.js';

const NODE = process.execPath;

let tmp: string;
let shellRoot: string;
let runner: CommandRunner;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-proc-'));
  shellRoot = path.join(tmp, 'runs', 'checks');
  await fs.mkdir(shellRoot, { recursive: true });
  // `node` dipakai sebagai "OASDIFF_BIN" supaya perilaku umum runCommand bisa diuji lintas OS.
  runner = createCommandRunner({ oasdiffBin: NODE, shellRoot });
});
afterEach(async () => {
  runner.killAll();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const run = (script: string, extra: Partial<Parameters<CommandRunner['runCommand']>[0]> = {}) =>
  runner.runCommand({ file: NODE, args: ['-e', script], timeoutMs: 10_000, ...extra });

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

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

describe('allowlist', () => {
  it('binary di luar allowlist ditolak dengan error bertipe dan TIDAK dijalankan', async () => {
    const marker = path.join(tmp, 'marker.txt');
    const other = createCommandRunner({ oasdiffBin: 'oasdiff' }); // node tidak di allowlist
    await expect(
      other.runCommand({
        file: NODE,
        args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'jalan')`],
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
    expect(await exists(marker)).toBe(false);
  });

  it.each(['rm', 'curl', 'powershell', 'sh', 'bash', 'cmd', 'npm'])('%s ditolak', async (file) => {
    await expect(runner.runCommand({ file, args: [], timeoutMs: 1000 })).rejects.toMatchObject({
      name: 'CommandNotAllowedError',
      code: 'command_not_allowed',
    });
  });

  it('binary dengan path absolut yang berbeda dari OASDIFF_BIN ditolak', async () => {
    await expect(
      runner.runCommand({ file: `${NODE}.evil`, args: [], timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
  });

  it('timeoutMs wajib dan harus > 0', async () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined as never]) {
      await expect(runner.runCommand({ file: NODE, args: ['-e', ''], timeoutMs })).rejects.toThrow(
        /timeoutMs/,
      );
    }
  });
});

describe('git lewat runCommand', () => {
  let repo: string;

  beforeEach(async () => {
    repo = path.join(tmp, 'repo');
    await fs.mkdir(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    await fs.writeFile(path.join(repo, 'a.txt'), 'satu\n');
    git('add', '.');
    git('commit', '-q', '-m', 'awal');
  });

  it('menjalankan subcommand baca dan mengembalikan keluaran persis', async () => {
    const result = await runner.runCommand({
      file: 'git',
      args: ['-C', repo, 'show', 'HEAD:a.txt'],
      timeoutMs: 20_000,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'satu\n', stderr: '' });
  });

  it('exit code bukan nol dikembalikan, bukan dilempar; assertSuccess yang melempar', async () => {
    const result = await runner.runCommand({
      file: 'git',
      args: ['-C', repo, 'rev-parse', '--verify', 'origin/tidak-ada'],
      timeoutMs: 20_000,
    });
    expect(result.exitCode).not.toBe(0);
    expect(() => assertSuccess(result)).toThrow(CommandFailedError);
  });

  it.each(['checkout', 'switch', 'reset', 'clean', 'commit', 'push', 'stash', 'apply'])(
    'git %s ditolak sebelum dijalankan dan repo tidak berubah',
    async (subcommand) => {
      await fs.writeFile(path.join(repo, 'a.txt'), 'diubah user\n'); // perubahan lokal belum di-commit
      const args =
        subcommand === 'commit'
          ? ['-C', repo, 'commit', '-a', '-m', 'x']
          : ['-C', repo, subcommand];
      await expect(
        runner.runCommand({ file: 'git', args, timeoutMs: 20_000 }),
      ).rejects.toBeInstanceOf(CommandNotAllowedError);
      expect(await fs.readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('diubah user\n');
      const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
        encoding: 'utf8',
      });
      expect(status.trim()).toBe('M a.txt');
    },
  );

  it('tidak pernah menunggu prompt kredensial dan tidak menulis lock (env git)', async () => {
    const probe = createCommandRunner({ oasdiffBin: NODE });
    const result = await probe.runCommand({
      file: NODE,
      args: ['-e', 'console.log(process.env.GIT_TERMINAL_PROMPT ?? "unset")'],
      timeoutMs: 5000,
    });
    // Untuk binary non-git, default git tidak disuntikkan.
    expect(result.stdout.trim()).toBe('unset');
  });
});

describe('env anak', () => {
  it('tidak mewarisi variabel ANTHROPIC_* ke proses anak', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'rahasia-jangan-bocor';
    process.env['anthropic_model'] = 'x';
    try {
      const result = await run('console.log(JSON.stringify(Object.keys(process.env)))');
      const keys = (JSON.parse(result.stdout) as string[]).map((k) => k.toUpperCase());
      expect(keys.filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([]);
      expect(result.stdout).not.toContain('rahasia-jangan-bocor');
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['anthropic_model'];
    }
  });

  it('env tambahan diteruskan, dan nilai undefined menghapus variabel', async () => {
    process.env['CC_PROC_TEST_REMOVE'] = 'ada';
    try {
      const result = await run(
        'console.log(JSON.stringify([process.env.CC_PROC_TEST_ADD, process.env.CC_PROC_TEST_REMOVE ?? null]))',
        { env: { CC_PROC_TEST_ADD: 'baru', CC_PROC_TEST_REMOVE: undefined } },
      );
      expect(JSON.parse(result.stdout)).toEqual(['baru', null]);
    } finally {
      delete process.env['CC_PROC_TEST_REMOVE'];
    }
  });
});

describe('hasil dan keluaran', () => {
  it('stdout/stderr dipertahankan persis, tanpa pemangkasan baris akhir', async () => {
    const result = await run('process.stdout.write("a\\n\\n"); process.stderr.write("b\\n")');
    expect(result.stdout.replace(/\r\n/g, '\n')).toBe('a\n\n');
    expect(result.stderr.replace(/\r\n/g, '\n')).toBe('b\n');
  });

  it('exit code dikembalikan apa adanya', async () => {
    expect((await run('process.exit(7)')).exitCode).toBe(7);
  });

  it('stdin tidak terhubung ke terminal: proses yang membaca stdin langsung mendapat EOF', async () => {
    const result = await run(
      'let n=0; process.stdin.on("data",c=>n+=c.length); process.stdin.on("end",()=>console.log("eof",n))',
    );
    expect(result.stdout.trim()).toBe('eof 0');
  });

  it('input diteruskan lewat stdin', async () => {
    const result = await run(
      'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>console.log(s.toUpperCase()))',
      { input: 'halo' },
    );
    expect(result.stdout.trim()).toBe('HALO');
  });

  it('keluaran melebihi maxBuffer -> CommandOutputTooLargeError', async () => {
    await expect(
      run('process.stdout.write("x".repeat(5000))', { maxBuffer: 100 }),
    ).rejects.toBeInstanceOf(CommandOutputTooLargeError);
  });
});

describe('binary tidak ada', () => {
  it('CommandNotFoundError yang menyebut nama binary, bukan exit code samar', async () => {
    const missing = createCommandRunner({ oasdiffBin: 'oasdiff-tidak-terpasang-xyz' });
    await expect(
      missing.runCommand({
        file: 'oasdiff-tidak-terpasang-xyz',
        args: ['--version'],
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ name: 'CommandNotFoundError', file: 'oasdiff-tidak-terpasang-xyz' });
    await expect(
      missing.runCommand({ file: 'oasdiff-tidak-terpasang-xyz', args: [], timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(CommandNotFoundError);
  });

  it('isAvailable membedakan ada dan tidak ada', async () => {
    expect(await runner.isAvailable('git')).toBe(true);
    expect(await runner.isAvailable(NODE)).toBe(true);
    expect(await runner.isAvailable('oasdiff-tidak-terpasang-xyz')).toBe(false);
  });
});

describe('timeout dan abort', () => {
  it('melewati timeout -> CommandTimeoutError dan prosesnya mati', async () => {
    const started = Date.now();
    await expect(run('setInterval(() => {}, 1000)', { timeoutMs: 400 })).rejects.toBeInstanceOf(
      CommandTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(8000);
    expect(runner.activeCount).toBe(0);
  });

  it('signal yang sudah abort -> CommandAbortedError tanpa menjalankan apa pun', async () => {
    const marker = path.join(tmp, 'marker.txt');
    const controller = new AbortController();
    controller.abort();
    await expect(
      run(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'jalan')`, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(CommandAbortedError);
    expect(await exists(marker)).toBe(false);
  });

  it('abort di tengah jalan -> CommandAbortedError', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await expect(
      run('setInterval(() => {}, 1000)', { signal: controller.signal, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(CommandAbortedError);
    expect(runner.activeCount).toBe(0);
  });
});

describe('shell (spec_cmd) hanya di dalam worktree', () => {
  it('menolak cwd di luar shellRoot, shellRoot itu sendiri, dan ketika shellRoot tidak dikonfigurasi', async () => {
    const outside = path.join(tmp, 'luar');
    await fs.mkdir(outside);
    await expect(
      runner.runCommand({ shell: 'echo hai', cwd: outside, timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
    await expect(
      runner.runCommand({ shell: 'echo hai', cwd: shellRoot, timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
    await expect(
      runner.runCommand({
        shell: 'echo hai',
        cwd: path.join(shellRoot, '..', '..', 'luar'),
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);

    const noRoot = createCommandRunner({ oasdiffBin: NODE });
    await expect(
      noRoot.runCommand({ shell: 'echo hai', cwd: shellRoot, timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(CommandNotAllowedError);
  });

  it('menjalankan perintah lewat shell dengan cwd worktree', async () => {
    const worktree = path.join(shellRoot, '1', 'wt-abc1234');
    await fs.mkdir(worktree, { recursive: true });
    const result = await runner.runCommand({
      shell: `"${NODE}" -e "console.log(process.cwd())"`,
      cwd: worktree,
      timeoutMs: 20_000,
    });
    expect(await fs.realpath(result.stdout.trim())).toBe(await fs.realpath(worktree));
  });
});

describe('process group', () => {
  /**
   * Skrip yang memunculkan cucu proses (stdio diabaikan, tidak detached) lalu menunggu selamanya.
   * Dipakai alih-alih `sleep` supaya test jalan sama di Windows, macOS, dan Linux.
   */
  async function startTree(): Promise<{ worktree: string; pidFile: string; command: string }> {
    const worktree = path.join(shellRoot, '1', 'wt-abc1234');
    await fs.mkdir(worktree, { recursive: true });
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
    return { worktree, pidFile, command: `"${NODE}" "${script}" "${pidFile}"` };
  }

  async function pidsOf(pidFile: string): Promise<{ child: number; grandchild: number }> {
    await waitFor(() => exists(pidFile));
    // file ditulis sekali; beri jeda singkat bila masih kosong
    for (let i = 0; i < 20; i++) {
      const text = await fs.readFile(pidFile, 'utf8');
      if (text) return JSON.parse(text) as { child: number; grandchild: number };
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('pid file kosong');
  }

  it('abort mematikan seluruh process group, termasuk cucu proses', async () => {
    const { worktree, pidFile, command } = await startTree();
    const controller = new AbortController();
    const pending = runner.runCommand({
      shell: command,
      cwd: worktree,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const settled = pending.catch((e: unknown) => e);

    const { child, grandchild } = await pidsOf(pidFile);
    expect(alive(child)).toBe(true);
    expect(alive(grandchild)).toBe(true);

    controller.abort();
    expect(await settled).toBeInstanceOf(CommandAbortedError);
    await waitFor(() => !alive(child) && !alive(grandchild));
  }, 30_000);

  it('timeout juga mematikan cucu proses, bukan hanya proses induk', async () => {
    const { worktree, pidFile, command } = await startTree();
    const settled = runner
      .runCommand({ shell: command, cwd: worktree, timeoutMs: 1500 })
      .catch((e: unknown) => e);

    const { child, grandchild } = await pidsOf(pidFile);
    expect(await settled).toBeInstanceOf(CommandTimeoutError);
    await waitFor(() => !alive(child) && !alive(grandchild));
  }, 30_000);

  it('killAll mematikan semua proses yang sedang berjalan', async () => {
    const { worktree, pidFile, command } = await startTree();
    const settled = runner
      .runCommand({ shell: command, cwd: worktree, timeoutMs: 60_000 })
      .catch((e: unknown) => e);

    const { child, grandchild } = await pidsOf(pidFile);
    expect(runner.activeCount).toBe(1);
    runner.killAll();
    await settled;
    await waitFor(() => !alive(child) && !alive(grandchild));
    expect(runner.activeCount).toBe(0);
  }, 30_000);
});
