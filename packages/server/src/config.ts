import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { expandHome } from './util/home.js';

/** Host dikunci ke loopback. Tidak ada variabel env yang bisa mengubahnya. */
export const HOST = '127.0.0.1' as const;

/** `.env` dicari di root repo (`packages/server/{src,dist}` -> tiga tingkat ke atas). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_ENV_FILE = path.join(REPO_ROOT, '.env');

export interface Config {
  readonly host: typeof HOST;
  readonly port: number;
  /** Path absolut. `~` sudah di-expand. */
  readonly workspaceDir: string;
  /** Tidak wajib saat start; panggilan Claude memintanya lewat {@link requireAnthropicApiKey}. */
  readonly anthropicApiKey: string | undefined;
  readonly anthropicModel: string;
  readonly maxFilesPerCheck: number;
  /** Batas panggilan ekstraksi ke Claude per check; cache hit tidak dihitung. */
  readonly maxLlmCallsPerCheck: number;
  readonly gitConcurrency: number;
  readonly llmConcurrency: number;
  readonly specCmdTimeoutMs: number;
  readonly oasdiffBin: string;
}

export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** Konfigurasi tidak valid. `message` selalu menyebut nama tiap variabel yang bermasalah. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      [
        'Konfigurasi tidak valid:',
        ...issues.map((i) => `  - ${i.variable}: ${i.message}`),
        'Periksa file .env di root repo (contoh: .env.example) atau variabel lingkungan proses.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const REQUIRED = 'wajib diisi';

function requiredString() {
  return z.string({ error: REQUIRED }).min(1, { error: REQUIRED });
}

function integer(fallback: number, min: number, max: number = Number.MAX_SAFE_INTEGER) {
  const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}-${max}`;
  const message = `harus bilangan bulat ${range}`;
  return z
    .string()
    .regex(/^\d+$/, { error: message })
    .transform(Number)
    .pipe(z.number().min(min, { error: message }).max(max, { error: message }))
    .default(fallback);
}

const VARIABLES = {
  PORT: integer(4711, 1, 65535),
  WORKSPACE_DIR: z.string().min(1).default('~/.contract-check'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: requiredString(),
  MAX_FILES_PER_CHECK: integer(40, 1),
  MAX_LLM_CALLS_PER_CHECK: integer(40, 1),
  GIT_CONCURRENCY: integer(4, 1),
  LLM_CONCURRENCY: integer(4, 1),
  SPEC_CMD_TIMEOUT_MS: integer(180_000, 1),
  OASDIFF_BIN: z.string().min(1).default('oasdiff'),
} as const;

const schema = z.object(VARIABLES);

/** Nilai rahasia tidak pernah dicetak di pesan error. */
const SECRET_VARIABLES = new Set<string>(['ANTHROPIC_API_KEY']);

export interface ParseOptions {
  /** Hanya untuk test; default `os.homedir()`. */
  readonly homedir?: string;
}

/**
 * Memvalidasi `env` dan membentuk {@link Config}. Murni: tidak membaca file maupun `process.env`.
 * String kosong diperlakukan sama dengan tidak diisi (baris `PORT=` di `.env`).
 */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
  options: ParseOptions = {},
): Config {
  const input: Record<string, string | undefined> = {};
  for (const name of Object.keys(VARIABLES)) {
    const value = env[name]?.trim();
    input[name] = value === '' ? undefined : value;
  }

  const result = schema.safeParse(input);
  const issues: ConfigIssue[] = result.success ? [] : toIssues(result.error, input);

  if (result.success) {
    const workspaceDir = expandHome(result.data.WORKSPACE_DIR, options.homedir ?? os.homedir());
    if (!path.isAbsolute(workspaceDir)) {
      issues.push({
        variable: 'WORKSPACE_DIR',
        message: `harus path absolut atau diawali ~ (nilai: '${result.data.WORKSPACE_DIR}')`,
      });
    }
    if (issues.length === 0) {
      const d = result.data;
      return {
        host: HOST,
        port: d.PORT,
        workspaceDir: path.normalize(workspaceDir),
        anthropicApiKey: d.ANTHROPIC_API_KEY,
        anthropicModel: d.ANTHROPIC_MODEL,
        maxFilesPerCheck: d.MAX_FILES_PER_CHECK,
        maxLlmCallsPerCheck: d.MAX_LLM_CALLS_PER_CHECK,
        gitConcurrency: d.GIT_CONCURRENCY,
        llmConcurrency: d.LLM_CONCURRENCY,
        specCmdTimeoutMs: d.SPEC_CMD_TIMEOUT_MS,
        oasdiffBin: d.OASDIFF_BIN,
      };
    }
  }

  throw new ConfigError(issues);
}

/**
 * Dipanggil tepat sebelum panggilan Claude pertama, bukan saat start: `verify` dan e2e
 * berjalan tanpa key. Galatnya `ConfigError` yang sama, jadi menyebut nama variabelnya.
 */
export function requireAnthropicApiKey(config: Config): string {
  if (config.anthropicApiKey === undefined) {
    throw new ConfigError([{ variable: 'ANTHROPIC_API_KEY', message: REQUIRED }]);
  }
  return config.anthropicApiKey;
}

function toIssues(error: z.ZodError, input: Record<string, string | undefined>): ConfigIssue[] {
  return error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? '(env)');
    const raw = input[variable];
    const shown = raw === undefined || SECRET_VARIABLES.has(variable) ? '' : ` (nilai: '${raw}')`;
    return { variable, message: `${issue.message}${shown}` };
  });
}

export interface LoadOptions {
  /** `false` = jangan baca file `.env`. Default: `.env` di root repo. */
  readonly envFile?: string | false;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homedir?: string;
}

/**
 * Membaca `.env` (bila ada) lalu memvalidasinya. Urutan prioritas: variabel proses > `.env`.
 * `process.env` tidak dimutasi.
 */
export function loadConfig(options: LoadOptions = {}): Config {
  const envFile = options.envFile === undefined ? DEFAULT_ENV_FILE : options.envFile;
  const fromFile =
    envFile !== false && fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
  const env = { ...fromFile, ...(options.env ?? process.env) };
  return parseConfig(env, options.homedir === undefined ? {} : { homedir: options.homedir });
}

/** Untuk bootstrap proses: config tidak valid -> cetak pesan, hentikan proses. */
export function loadConfigOrExit(
  options: LoadOptions = {},
  io: { error: (message: string) => void; exit: (code: number) => never } = {
    error: (message) => console.error(message),
    exit: (code) => process.exit(code),
  },
): Config {
  try {
    return loadConfig(options);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.error(err.message);
      return io.exit(1);
    }
    throw err;
  }
}
