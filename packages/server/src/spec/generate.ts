import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitAdapter } from '../git/adapter.js';
import { tail } from '../proc/errors.js';
import type { CommandRunner } from '../proc/run-command.js';
import { isInside, type WorkspaceLayout } from '../workspace/layout.js';
import { SpecGenError, SpecMissing } from './errors.js';
import { parseSpecDocument } from './resolve.js';

/** Lockfile yang cukup menandai dependensi terkunci (D-51). `requirements.txt` dinilai terpisah. */
const LOCKFILES = [
  'uv.lock',
  'poetry.lock',
  'go.sum',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

const PROBE_TIMEOUT_MS = 10_000;

/** Tool generator yang versinya dicatat bila `spec_cmd` memakainya. */
const TOOLS = [
  { name: 'node', uses: /\b(node|npm|npx|pnpm|yarn)\b/, probe: 'node -v' },
  { name: 'go', uses: /\bgo\b/, probe: 'go version' },
  { name: 'python', uses: /\b(python3?|pip|uv|poetry)\b/, probe: 'python -V' },
  { name: 'swag', uses: /\bswag\b/, probe: 'swag --version' },
] as const;

/** Spec hasil `spec_cmd`, dibaca dari worktree pada `sha`. */
export interface GeneratedSpec {
  readonly document: Record<string, unknown>;
  readonly source: 'generated';
  readonly sha: string;
  readonly path: string;
  /** Tidak ada lockfile ter-commit di akar repo: hasil bisa berbeda antar waktu. */
  readonly spec_unpinned: boolean;
  /** Keluaran mentah perintah versi, per tool yang dipakai `spec_cmd` dan terpasang. */
  readonly tool_versions: Readonly<Record<string, string>>;
}

export interface SpecGeneratorDeps {
  readonly git: Pick<GitAdapter, 'worktreeAdd' | 'worktreeRemove'>;
  readonly runner: Pick<CommandRunner, 'runCommand'>;
  readonly layout: Pick<WorkspaceLayout, 'worktreeDir'>;
  /** `config.specCmdTimeoutMs`. */
  readonly timeoutMs: number;
}

export interface GenerateInput {
  readonly checkId: number;
  /** Folder repo di disk user. */
  readonly repo: string;
  readonly sha: string;
  /** `repos.spec_path`, relatif terhadap akar worktree. */
  readonly specPath: string;
  readonly specCmd: string;
  readonly signal?: AbortSignal;
}

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** Lockfile dari daftar, atau `requirements.txt` yang setiap barisnya (selain komentar) memakai `==`. */
async function hasLockfile(dir: string): Promise<boolean> {
  for (const name of LOCKFILES) {
    if (await exists(path.join(dir, name))) return true;
  }
  const requirements = await fs
    .readFile(path.join(dir, 'requirements.txt'), 'utf8')
    .catch(() => undefined);
  if (requirements === undefined) return false;
  const lines = requirements
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  return lines.length > 0 && lines.every((line) => line.includes('=='));
}

/**
 * Menjalankan `spec_cmd` di worktree sementara pada `sha` (`runs/checks/<id>/wt-<sha>`) lalu
 * membaca `spec_path` dari sana. Worktree selalu dihapus: sukses, gagal, timeout, maupun abort.
 * Galat bertipe: `SpecGenError` (exit bukan nol), `SpecMissing` (spec_path tidak ada setelah
 * `spec_cmd`), `SpecParseError`; timeout dan abort merambat sebagai `CommandTimeoutError` /
 * `CommandAbortedError`.
 */
export async function generateSpec(
  { git, runner, layout, timeoutMs }: SpecGeneratorDeps,
  { checkId, repo, sha, specPath, specCmd, signal }: GenerateInput,
): Promise<GeneratedSpec> {
  const dir = layout.worktreeDir(checkId, sha);
  const withSignal = signal === undefined ? {} : { signal };
  await git.worktreeAdd(repo, dir, sha);
  try {
    // Dinilai sebelum `spec_cmd`: lockfile yang dibuat perintah itu bukan lockfile ter-commit.
    const spec_unpinned = !(await hasLockfile(dir));

    const result = await runner.runCommand({ shell: specCmd, cwd: dir, timeoutMs, ...withSignal });
    if (result.exitCode !== 0) {
      throw new SpecGenError(sha, specCmd, result.exitCode, tail(result.stderr, 20));
    }

    const tool_versions: Record<string, string> = {};
    for (const tool of TOOLS) {
      if (!tool.uses.test(specCmd)) continue;
      const probe = await runner.runCommand({
        shell: tool.probe,
        cwd: dir,
        timeoutMs: PROBE_TIMEOUT_MS,
        ...withSignal,
      });
      const output = (probe.stdout.trim() || probe.stderr.trim()).split(/\r?\n/)[0];
      if (probe.exitCode === 0 && output) tool_versions[tool.name] = output;
    }

    const file = path.resolve(dir, specPath);
    if (!isInside(dir, file)) throw new SpecMissing(sha, specPath);
    const raw = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new SpecMissing(sha, specPath);
      throw error;
    });

    return {
      document: parseSpecDocument(raw, sha, specPath),
      source: 'generated',
      sha,
      path: specPath,
      spec_unpinned,
      tool_versions,
    };
  } finally {
    await git.worktreeRemove(repo, dir);
  }
}
