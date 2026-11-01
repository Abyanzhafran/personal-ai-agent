import { describe, expect, it, vi } from 'vitest';

import { CommandFailedError, CommandNotFoundError, CommandTimeoutError } from '../proc/errors.js';
import {
  createCommandRunner,
  type CommandResult,
  type CommandRunner,
} from '../proc/run-command.js';
import {
  createOasdiff,
  OASDIFF_MIN_VERSION,
  OasdiffOutputError,
  OasdiffUnavailableError,
} from './oasdiff.js';

type Run = CommandRunner['runCommand'];

const done = (stdout: string, over: Partial<CommandResult> = {}): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  durationMs: 1,
  command: 'oasdiff',
  ...over,
});

/** Runner palsu: `--version` dijawab `version`, perintah lain dijawab `changelog`. */
function fake(version: CommandResult | Error, changelog?: CommandResult | Error) {
  const runCommand = vi.fn<Run>(async (request) => {
    const answer = 'args' in request && request.args[0] === '--version' ? version : changelog;
    if (answer === undefined) throw new Error('panggilan tak terduga');
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { runCommand, oasdiff: createOasdiff({ runner: { runCommand }, bin: 'oasdiff' }) };
}

const ok = (v: string) => done(`oasdiff version ${v}\n`);

/** Bentuk nyata `oasdiff changelog -f json` (formatters.Change): level angka, banyak field lain. */
const SAMPLE = JSON.stringify([
  {
    id: 'response-property-removed',
    text: "removed the optional property 'total' from the response with the '200' status",
    level: 3,
    operation: 'GET',
    operationId: 'listOrders',
    path: '/orders',
    section: 'paths',
    attributes: { propertyName: 'total' },
    baseSource: { file: 'base.json', line: 12, column: 5 },
    fingerprint: 'abc123',
  },
  {
    id: 'request-parameter-removed',
    text: "deleted the 'query' request parameter 'page_size'",
    level: 2,
    operation: 'GET',
    path: '/orders',
  },
  {
    id: 'new-optional-request-parameter',
    text: "added the new optional 'limit' parameter",
    level: 1,
  },
]);

describe('cek kapabilitas', () => {
  it('versi memenuhi minimum → ok dengan nomor versi (bahan summary_json.tool_versions)', async () => {
    const { oasdiff, runCommand } = fake(ok('1.35.0'));
    expect(await oasdiff.capability()).toEqual({ ok: true, version: '1.35.0' });
    expect(await oasdiff.assertAvailable()).toBe('1.35.0');
    expect(runCommand.mock.calls[0]?.[0]).toMatchObject({ file: 'oasdiff', args: ['--version'] });
  });

  it('hasil cek disimpan untuk proses itu: binary hanya ditanya sekali', async () => {
    const { oasdiff, runCommand } = fake(ok('1.35.0'));
    await Promise.all([oasdiff.capability(), oasdiff.capability(), oasdiff.assertAvailable()]);
    await oasdiff.capability();
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['1.11.0', true],
    ['1.11.1', true],
    ['1.100.0', true],
    ['2.0.0', true],
    ['1.10.9', false],
    ['1.9.20', false],
    ['0.99.99', false],
  ])('versi %s: memenuhi minimum = %s', async (version, expected) => {
    const result = await fake(ok(version)).oasdiff.capability();
    expect(result.ok).toBe(expected);
  });

  it('versi di bawah minimum → pesan menyebut versi terpasang dan versi minimum', async () => {
    const result = await fake(ok('1.10.9')).oasdiff.capability();
    expect(result).toMatchObject({ ok: false, reason: 'too_old' });
    const message = result.ok ? '' : result.message;
    expect(message).toContain('1.10.9');
    expect(message).toContain(OASDIFF_MIN_VERSION);
  });

  it('format keluaran lain tetap terbaca: awalan v dan akhiran pra-rilis', async () => {
    expect(await fake(done('v1.35.0-rc.1\n')).oasdiff.capability()).toEqual({
      ok: true,
      version: '1.35.0',
    });
  });

  it('binary tidak ada → pesan menyebut cara pasang dan OASDIFF_BIN; assertAvailable melempar alasan yang sama', async () => {
    const { oasdiff, runCommand } = fake(new CommandNotFoundError('oasdiff'));
    const result = await oasdiff.capability();
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    const message = result.ok ? '' : result.message;
    expect(message).toContain('github.com/oasdiff/oasdiff');
    expect(message).toContain('OASDIFF_BIN');

    const error = await oasdiff.assertAvailable().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OasdiffUnavailableError);
    expect(error).toMatchObject({ reason: 'missing', message });
    // Check ditolak sebelum menjalankan changelog.
    await expect(oasdiff.changelog({ base: 'a.json', head: 'b.json' })).rejects.toMatchObject({
      reason: 'missing',
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('binary sungguhan yang tidak terpasang (runner asli) → missing, tanpa melempar', async () => {
    const bin = 'oasdiff-tidak-terpasang-xyz';
    const oasdiff = createOasdiff({ runner: createCommandRunner({ oasdiffBin: bin }), bin });
    const result = await oasdiff.capability();
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    expect(result.ok ? '' : result.message).toContain(bin);
    // Menelusuri PATH di Windows bisa lambat saat mesin sibuk; batas bawaan 5 dtk terlalu ketat.
  }, 20_000);

  it('proses sungguhan lewat runner asli: versi dibaca dari keluaran --version', async () => {
    // `node --version` mencetak "v24.x.y"; cukup untuk membuktikan jalur runner → parse versi.
    const bin = process.execPath;
    const oasdiff = createOasdiff({ runner: createCommandRunner({ oasdiffBin: bin }), bin });
    expect(await oasdiff.capability()).toEqual({ ok: true, version: process.versions.node });
  }, 20_000);

  it('keluaran tak berversi, exit code bukan nol, atau galat runner lain → unreadable, tidak melempar', async () => {
    const cases: (CommandResult | Error)[] = [
      done('halo dunia'),
      done('', { exitCode: 2, stderr: 'rusak' }),
      new CommandTimeoutError('oasdiff --version', 10_000, '', ''),
    ];
    for (const version of cases) {
      const result = await fake(version).oasdiff.capability();
      expect(result).toMatchObject({ ok: false, reason: 'unreadable' });
    }
  });
});

describe('changelog', () => {
  it('menjalankan oasdiff changelog <base> <head> -f json dan meneruskan signal', async () => {
    const { oasdiff, runCommand } = fake(ok('1.35.0'), done('[]'));
    const controller = new AbortController();

    await oasdiff.changelog({ base: 'base.json', head: 'head.json', signal: controller.signal });

    const request = runCommand.mock.calls[1]?.[0];
    expect(request).toMatchObject({
      file: 'oasdiff',
      args: ['changelog', 'base.json', 'head.json', '-f', 'json'],
      signal: controller.signal,
    });
    expect(request?.timeoutMs).toBeGreaterThan(0);
  });

  it('keluaran JSON ter-parse ke tipe bertingkat: level, id, path, operation, text', async () => {
    const { oasdiff } = fake(ok('1.35.0'), done(SAMPLE));

    const changes = await oasdiff.changelog({ base: 'a.json', head: 'b.json' });

    expect(changes).toEqual([
      {
        id: 'response-property-removed',
        text: "removed the optional property 'total' from the response with the '200' status",
        level: 'error',
        operation: 'GET',
        operationId: 'listOrders',
        path: '/orders',
        section: 'paths',
      },
      {
        id: 'request-parameter-removed',
        text: "deleted the 'query' request parameter 'page_size'",
        level: 'warn',
        operation: 'GET',
        path: '/orders',
      },
      {
        id: 'new-optional-request-parameter',
        text: "added the new optional 'limit' parameter",
        level: 'info',
      },
    ]);
  });

  it('tanpa perubahan: [] maupun keluaran kosong (versi lama) → daftar kosong', async () => {
    for (const stdout of ['[]', '', '\n']) {
      const { oasdiff } = fake(ok('1.35.0'), done(stdout));
      expect(await oasdiff.changelog({ base: 'a', head: 'b' })).toEqual([]);
    }
  });

  it('keluaran yang bukan JSON, bukan array, atau berlevel asing → OasdiffOutputError tanpa isi keluaran', async () => {
    const secret = 'RAHASIA-ISI-SPEC';
    const bad = [
      `bukan json ${secret}`,
      JSON.stringify({ changes: [] }),
      JSON.stringify([{ id: 'x', text: secret, level: 0 }]),
      JSON.stringify([{ id: 'x', text: secret, level: 'error' }]),
      JSON.stringify([{ text: secret, level: 1 }]),
    ];
    for (const stdout of bad) {
      const { oasdiff } = fake(ok('1.35.0'), done(stdout));
      const error = await oasdiff.changelog({ base: 'a', head: 'b' }).catch((e: unknown) => e);
      expect(error, stdout).toBeInstanceOf(OasdiffOutputError);
      expect((error as Error).message, stdout).not.toContain(secret);
    }
  });

  it('exit code bukan nol merambat sebagai CommandFailedError dengan stderr', async () => {
    const { oasdiff } = fake(ok('1.35.0'), done('', { exitCode: 105, stderr: 'spec tidak valid' }));
    const error = await oasdiff.changelog({ base: 'a', head: 'b' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandFailedError);
    expect(error).toMatchObject({ exitCode: 105, stderr: 'spec tidak valid' });
  });

  it('versi terlalu lama: changelog ditolak sebelum dijalankan, dengan versi terpasang dan minimum', async () => {
    const { oasdiff, runCommand } = fake(ok('1.10.9'), done('[]'));
    const error = await oasdiff.changelog({ base: 'a', head: 'b' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OasdiffUnavailableError);
    expect((error as Error).message).toContain('1.10.9');
    expect((error as Error).message).toContain(OASDIFF_MIN_VERSION);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
