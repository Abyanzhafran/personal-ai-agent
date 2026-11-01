import { z } from 'zod';
import { CommandNotFoundError } from '../proc/errors.js';
import { assertSuccess, type CommandRunner } from '../proc/run-command.js';

/** Versi `oasdiff` terendah yang didukung (README: >= 1.11). */
export const OASDIFF_MIN_VERSION = '1.11.0';

// Konstanta, bukan config.ts (pola adapter.ts).
const VERSION_TIMEOUT_MS = 10_000;
const CHANGELOG_TIMEOUT_MS = 60_000;

const INSTALL_HINT =
  'Pasang dari https://github.com/oasdiff/oasdiff#installation ' +
  '(mis. `brew install oasdiff` atau `go install github.com/oasdiff/oasdiff@latest`), ' +
  'atau isi OASDIFF_BIN dengan path binary-nya.';

export type OasdiffCapability =
  | { readonly ok: true; readonly version: string }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'too_old' | 'unreadable';
      /** Siap tampil di log start dan sebagai alasan check ditolak. */
      readonly message: string;
    };

/** `oasdiff` tidak bisa dipakai (tidak ada, terlalu lama, atau versinya tidak terbaca). */
export class OasdiffUnavailableError extends Error {
  constructor(
    readonly reason: 'missing' | 'too_old' | 'unreadable',
    message: string,
  ) {
    super(message);
    this.name = 'OasdiffUnavailableError';
  }
}

/** Keluaran `oasdiff changelog` bukan JSON bentuk yang dikenal. `problem` tidak memuat isi keluaran. */
export class OasdiffOutputError extends Error {
  constructor(readonly problem: string) {
    super(`Keluaran oasdiff tidak bisa dibaca: ${problem}`);
    this.name = 'OasdiffOutputError';
  }
}

type Version = readonly [number, number, number];

const parseVersion = (
  text: string,
): { readonly text: string; readonly parts: Version } | undefined => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match
    ? { text: match[0], parts: [Number(match[1]), Number(match[2]), Number(match[3])] }
    : undefined;
};

const isOlder = (a: Version, b: Version): boolean => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
  }
  return false;
};

const MIN_VERSION = parseVersion(OASDIFF_MIN_VERSION)?.parts as Version;

// `level` di JSON oasdiff berupa angka (INFO=1, WARN=2, ERR=3).
const LEVEL_NAMES = { 1: 'info', 2: 'warn', 3: 'error' } as const;

/** Satu perubahan dari `oasdiff changelog -f json`. Field lain di keluaran dibuang. */
const OasdiffChange = z.object({
  id: z.string(),
  text: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).transform((n) => LEVEL_NAMES[n]),
  /** Kosong untuk perubahan yang bukan milik satu operasi (mis. komponen bersama). */
  operation: z.string().optional(),
  operationId: z.string().optional(),
  path: z.string().optional(),
  section: z.string().optional(),
});
export type OasdiffChange = z.output<typeof OasdiffChange>;

function parseChanges(stdout: string): OasdiffChange[] {
  // Versi lama mencetak keluaran kosong, bukan `[]`, bila tidak ada perubahan.
  if (stdout.trim() === '') return [];
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new OasdiffOutputError('bukan JSON yang valid');
  }
  const result = z.array(OasdiffChange).safeParse(json);
  if (result.success) return result.data;
  throw new OasdiffOutputError(
    result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.map(String).join('.') || '(akar)'}: ${issue.message}`)
      .join('; '),
  );
}

interface OasdiffDeps {
  readonly runner: Pick<CommandRunner, 'runCommand'>;
  /** `OASDIFF_BIN`: satu-satunya binary selain `git` yang boleh dijalankan runner. */
  readonly bin: string;
}

/** Satu-satunya pintu ke `oasdiff` (CC-034). */
export function createOasdiff({ runner, bin }: OasdiffDeps) {
  let capability: Promise<OasdiffCapability> | undefined;

  async function probe(): Promise<OasdiffCapability> {
    const unreadable = (detail: string): OasdiffCapability => ({
      ok: false,
      reason: 'unreadable',
      message: `Versi oasdiff ('${bin}') tidak bisa dibaca: ${detail}`,
    });
    try {
      const result = await runner.runCommand({
        file: bin,
        args: ['--version'],
        timeoutMs: VERSION_TIMEOUT_MS,
      });
      if (result.exitCode !== 0)
        return unreadable(`'--version' keluar dengan kode ${result.exitCode}`);
      const version = parseVersion(`${result.stdout}\n${result.stderr}`);
      if (!version) return unreadable('keluaran tidak memuat nomor versi');
      if (isOlder(version.parts, MIN_VERSION)) {
        return {
          ok: false,
          reason: 'too_old',
          message:
            `oasdiff ${version.text} terpasang, tetapi minimum yang dibutuhkan ${OASDIFF_MIN_VERSION}. ` +
            'Perbarui oasdiff.',
        };
      }
      return { ok: true, version: version.text };
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return {
          ok: false,
          reason: 'missing',
          message: `oasdiff tidak ditemukan ('${bin}'). ${INSTALL_HINT}`,
        };
      }
      return unreadable(error instanceof Error ? error.message : String(error));
    }
  }

  /** Hasil cek binary dan versi; dijalankan sekali per proses. Tidak pernah melempar. */
  const check = (): Promise<OasdiffCapability> => (capability ??= probe());

  /** Mengembalikan versi terpasang, atau melempar {@link OasdiffUnavailableError} dengan alasannya. */
  async function assertAvailable(): Promise<string> {
    const result = await check();
    if (!result.ok) throw new OasdiffUnavailableError(result.reason, result.message);
    return result.version;
  }

  return {
    capability: check,
    assertAvailable,

    /**
     * `oasdiff changelog <base> <head> -f json`. `base` dan `head` adalah path berkas spec.
     * Exit code bukan nol dan timeout merambat sebagai galat runner.
     */
    async changelog(input: {
      readonly base: string;
      readonly head: string;
      readonly signal?: AbortSignal;
    }): Promise<OasdiffChange[]> {
      await assertAvailable();
      const result = assertSuccess(
        await runner.runCommand({
          file: bin,
          args: ['changelog', input.base, input.head, '-f', 'json'],
          timeoutMs: CHANGELOG_TIMEOUT_MS,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      );
      return parseChanges(result.stdout);
    },
  };
}

export type Oasdiff = ReturnType<typeof createOasdiff>;
