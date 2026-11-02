import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigError,
  HOST,
  loadConfig,
  loadConfigOrExit,
  parseConfig,
  requireAnthropicApiKey,
} from './config.js';

const HOME = path.resolve(path.sep, 'fake-home');
const REQUIRED_ENV = { ANTHROPIC_API_KEY: 'sk-test-secret', ANTHROPIC_MODEL: 'test-model' };

function issuesOf(fn: () => unknown): ConfigError['issues'] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error('parseConfig seharusnya melempar ConfigError');
}

describe('parseConfig: nilai default', () => {
  it('cocok dengan snapshot default', () => {
    const config = parseConfig(REQUIRED_ENV, { homedir: HOME });
    expect({ ...config, workspaceDir: path.relative(HOME, config.workspaceDir) })
      .toMatchInlineSnapshot(`
        {
          "anthropicApiKey": "sk-test-secret",
          "anthropicModel": "test-model",
          "gitConcurrency": 4,
          "host": "127.0.0.1",
          "llmConcurrency": 4,
          "maxFilesPerCheck": 40,
          "maxLlmCallsPerCheck": 40,
          "oasdiffBin": "oasdiff",
          "port": 4711,
          "specCmdTimeoutMs": 180000,
          "workspaceDir": ".contract-check",
        }
      `);
  });

  it('menganggap string kosong sebagai tidak diisi (baris `PORT=` di .env)', () => {
    const config = parseConfig({ ...REQUIRED_ENV, PORT: '', OASDIFF_BIN: '  ' }, { homedir: HOME });
    expect(config.port).toBe(4711);
    expect(config.oasdiffBin).toBe('oasdiff');
  });

  it('membaca nilai yang diisi', () => {
    const config = parseConfig(
      {
        ...REQUIRED_ENV,
        PORT: '5000',
        MAX_FILES_PER_CHECK: '10',
        MAX_LLM_CALLS_PER_CHECK: '7',
        GIT_CONCURRENCY: '2',
        LLM_CONCURRENCY: '3',
        SPEC_CMD_TIMEOUT_MS: '5000',
        OASDIFF_BIN: '/opt/oasdiff',
      },
      { homedir: HOME },
    );
    expect(config).toMatchObject({
      port: 5000,
      maxFilesPerCheck: 10,
      maxLlmCallsPerCheck: 7,
      gitConcurrency: 2,
      llmConcurrency: 3,
      specCmdTimeoutMs: 5000,
      oasdiffBin: '/opt/oasdiff',
    });
  });

  it('PROMPT_VERSION di env diabaikan: versi prompt diturunkan dari hash file prompt (CC-018)', () => {
    const config = parseConfig({ ...REQUIRED_ENV, PROMPT_VERSION: 'v7' }, { homedir: HOME });
    expect(config).not.toHaveProperty('promptVersion');
  });
});

describe('parseConfig: variabel wajib', () => {
  it('ANTHROPIC_MODEL kosong -> error yang menyebut nama variabelnya', () => {
    const env: Record<string, string | undefined> = { ...REQUIRED_ENV, ANTHROPIC_MODEL: '' };
    expect(() => parseConfig(env)).toThrow(ConfigError);
    expect(() => parseConfig(env)).toThrow(/ANTHROPIC_MODEL: wajib diisi/);
  });

  it('melaporkan semua variabel bermasalah sekaligus, bukan satu per satu', () => {
    const issues = issuesOf(() => parseConfig({ PORT: 'abc' }));
    expect(issues.map((i) => i.variable).sort()).toEqual(['ANTHROPIC_MODEL', 'PORT']);
  });

  it('tidak pernah mencetak nilai rahasia di pesan error', () => {
    // API key valid, tetapi PORT salah: pesan tidak boleh memuat key.
    const issues = issuesOf(() => parseConfig({ ...REQUIRED_ENV, PORT: 'abc' }));
    expect(JSON.stringify(issues)).not.toContain('sk-test-secret');
  });
});

describe('ANTHROPIC_API_KEY: divalidasi saat Claude dipanggil, bukan saat start', () => {
  const MODEL_ONLY = { ANTHROPIC_MODEL: 'test-model' };

  it.each([
    ['tidak ada', MODEL_ONLY],
    ['kosong', { ...MODEL_ONLY, ANTHROPIC_API_KEY: '' }],
  ])('start tanpa key (%s) lolos', (_label, env) => {
    expect(parseConfig(env, { homedir: HOME }).anthropicApiKey).toBeUndefined();
  });

  it('requireAnthropicApiKey mengembalikan key bila ada', () => {
    const config = parseConfig(REQUIRED_ENV, { homedir: HOME });
    expect(requireAnthropicApiKey(config)).toBe('sk-test-secret');
  });

  it('requireAnthropicApiKey tanpa key -> ConfigError yang menyebut ANTHROPIC_API_KEY', () => {
    const config = parseConfig(MODEL_ONLY, { homedir: HOME });
    expect(() => requireAnthropicApiKey(config)).toThrow(ConfigError);
    expect(() => requireAnthropicApiKey(config)).toThrow(/ANTHROPIC_API_KEY: wajib diisi/);
  });
});

describe('parseConfig: penolakan nilai salah tipe', () => {
  it.each([
    ['PORT', 'abc'],
    ['PORT', '47.11'],
    ['PORT', '-1'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '1e3'],
    ['PORT', '0x10'],
    ['MAX_FILES_PER_CHECK', '0'],
    ['MAX_FILES_PER_CHECK', 'banyak'],
    ['MAX_LLM_CALLS_PER_CHECK', '0'],
    ['MAX_LLM_CALLS_PER_CHECK', 'banyak'],
    ['GIT_CONCURRENCY', '0'],
    ['LLM_CONCURRENCY', '-4'],
    ['SPEC_CMD_TIMEOUT_MS', '3 menit'],
  ])('%s=%s ditolak dan variabelnya disebut', (name, value) => {
    const issues = issuesOf(() => parseConfig({ ...REQUIRED_ENV, [name]: value }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.variable).toBe(name);
    expect(issues[0]?.message).toContain('harus bilangan bulat');
  });
});

describe('parseConfig: WORKSPACE_DIR', () => {
  it('meng-expand ~ ke direktori home', () => {
    const config = parseConfig({ ...REQUIRED_ENV, WORKSPACE_DIR: '~/data/cc' }, { homedir: HOME });
    expect(config.workspaceDir).toBe(path.join(HOME, 'data', 'cc'));
  });

  it('menerima path absolut apa adanya', () => {
    const abs = path.resolve(path.sep, 'srv', 'cc');
    expect(parseConfig({ ...REQUIRED_ENV, WORKSPACE_DIR: abs }).workspaceDir).toBe(abs);
  });

  it('menolak path relatif karena ambigu terhadap cwd', () => {
    const issues = issuesOf(() => parseConfig({ ...REQUIRED_ENV, WORKSPACE_DIR: 'data/cc' }));
    expect(issues[0]?.variable).toBe('WORKSPACE_DIR');
    expect(issues[0]?.message).toContain('path absolut');
  });
});

describe('host terkunci ke loopback', () => {
  it('konstanta HOST adalah 127.0.0.1', () => {
    expect(HOST).toBe('127.0.0.1');
  });

  it.each(['HOST', 'BIND_HOST', 'LISTEN_HOST', 'CC_HOST', 'HOSTNAME', 'SERVER_HOST'])(
    'variabel %s=0.0.0.0 tidak mengubah host',
    (name) => {
      const config = parseConfig({ ...REQUIRED_ENV, [name]: '0.0.0.0' });
      expect(config.host).toBe('127.0.0.1');
    },
  );
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-config-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('membaca .env, dan variabel proses mengalahkan isi file', () => {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'ANTHROPIC_API_KEY=dari-file\nANTHROPIC_MODEL=m-file\nPORT=6000\n');
    const config = loadConfig({ envFile, env: { PORT: '7000' }, homedir: HOME });
    expect(config.anthropicApiKey).toBe('dari-file');
    expect(config.port).toBe(7000);
  });

  it('file .env yang tidak ada bukan error, selama variabel wajib ada di proses', () => {
    const config = loadConfig({
      envFile: path.join(dir, 'tidak-ada.env'),
      env: REQUIRED_ENV,
      homedir: HOME,
    });
    expect(config.anthropicModel).toBe('test-model');
  });

  it('tidak memutasi process.env', () => {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'ANTHROPIC_API_KEY=k\nANTHROPIC_MODEL=m\nCC_TEST_MARKER=x\n');
    loadConfig({ envFile, env: {}, homedir: HOME });
    expect(process.env['CC_TEST_MARKER']).toBeUndefined();
  });
});

describe('loadConfigOrExit', () => {
  it('config tidak valid -> mencetak pesan berisi nama variabel lalu exit(1)', () => {
    const error = vi.fn();
    const exit = vi.fn((): never => {
      throw new Error('exit dipanggil');
    });
    expect(() => loadConfigOrExit({ envFile: false, env: {} }, { error, exit })).toThrow(
      'exit dipanggil',
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledOnce();
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain('ANTHROPIC_MODEL');
    expect(message).not.toContain('ANTHROPIC_API_KEY');
  });

  it('config valid -> mengembalikan Config tanpa exit', () => {
    const exit = vi.fn((): never => {
      throw new Error('tidak boleh dipanggil');
    });
    const config = loadConfigOrExit(
      { envFile: false, env: REQUIRED_ENV, homedir: HOME },
      { error: vi.fn(), exit },
    );
    expect(config.port).toBe(4711);
    expect(exit).not.toHaveBeenCalled();
  });
});
