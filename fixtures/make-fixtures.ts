// Generator fixture repo git (CC-090). Membuat repo nyata di folder yang diberikan, tidak pernah di
// dalam repo Contract Check. Tiap repo punya remote bare lokal sebagai `origin`; author, tanggal, dan
// konfigurasi git dikunci sehingga SHA sama di setiap mesin dan setiap kali dijalankan.
//
// Isi repo ada di fixtures/repos/<repo>/<langkah>/ (disalin berurutan menimpa pohon kerja, satu
// langkah satu commit). Berkas spec dibangkitkan dari fixtures/specs.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  committedSpecText,
  exportScriptText,
  orderServiceSpec,
  paymentSwagger,
  type OrderSpecVariant,
} from './specs.js';

const run = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const TEMPLATES = path.join(HERE, 'repos');

/** Penanda bahwa folder ini dibuat oleh generator, jadi aman dihapus dan dibuat ulang. */
export const MARKER_FILE = '.contract-check-fixtures';

export type FixtureRepoName = 'svc-order' | 'mfe-dashboard' | 'svc-payment' | 'e2e-suite';
export type FixtureRole = 'service' | 'microfrontend' | 'e2e';

export interface FixtureRepo {
  name: FixtureRepoName;
  role: FixtureRole;
  /** Klon kerja; nilai `local_path` saat repo didaftarkan. */
  path: string;
  /** Remote bare yang menjadi `origin`. */
  remote: string;
  defaultBranch: string;
  specPath?: string;
  specCmd?: string;
  /** SHA tiap commit menurut `label` pada rencana. */
  commits: Record<string, string>;
}

export interface FixtureSet {
  root: string;
  repos: Record<FixtureRepoName, FixtureRepo>;
}

interface CommitPlan {
  label: string;
  branch: string;
  /** Label commit tempat cabang baru dibuat; wajib bila cabangnya belum ada. */
  from?: string;
  message: string;
  date: string;
  /** Folder di fixtures/repos/<repo>/ yang disalin menimpa pohon kerja. */
  overlay: string;
  /** Berkas bangkitan: path relatif -> isi. */
  generated?: Record<string, string>;
}

interface RepoPlan {
  name: FixtureRepoName;
  role: FixtureRole;
  specPath?: string;
  specCmd?: string;
  commits: CommitPlan[];
}

const orderSpecFiles = (variant: OrderSpecVariant): Record<string, string> => {
  const spec = orderServiceSpec(variant);
  return {
    'openapi.json': committedSpecText(spec),
    'scripts/export-openapi.mjs': exportScriptText(spec),
  };
};

const REPOS: RepoPlan[] = [
  {
    name: 'svc-order',
    role: 'service',
    specPath: 'openapi.json',
    specCmd: 'node scripts/export-openapi.mjs',
    commits: [
      {
        label: 'initial',
        branch: 'main',
        message: 'Layanan pesanan awal',
        date: '2026-09-01T09:00:00+00:00',
        overlay: '01-initial',
        generated: orderSpecFiles('base'),
      },
      {
        label: 'feature-xyz',
        branch: 'feature/xyz',
        from: 'initial',
        message: 'Rapikan kontrak pesanan',
        date: '2026-09-10T09:00:00+00:00',
        overlay: '02-feature-xyz',
        generated: orderSpecFiles('head'),
      },
      // Main maju setelah cabang dibuat, supaya merge-base berbeda dari ujung main.
      {
        label: 'readme',
        branch: 'main',
        message: 'Tambah catatan rilis di README',
        date: '2026-09-12T09:00:00+00:00',
        overlay: '03-main-readme',
      },
    ],
  },
  {
    name: 'mfe-dashboard',
    role: 'microfrontend',
    commits: [
      {
        label: 'initial',
        branch: 'main',
        message: 'Dashboard awal',
        date: '2026-09-02T09:00:00+00:00',
        overlay: '01-initial',
      },
    ],
  },
  {
    name: 'svc-payment',
    role: 'service',
    specPath: 'docs/swagger.json',
    commits: [
      {
        label: 'initial',
        branch: 'main',
        message: 'Layanan pembayaran awal',
        date: '2026-09-03T09:00:00+00:00',
        overlay: '01-initial',
        generated: { 'docs/swagger.json': committedSpecText(paymentSwagger(), 4) },
      },
    ],
  },
  {
    name: 'e2e-suite',
    role: 'e2e',
    commits: [
      {
        label: 'initial',
        branch: 'main',
        message: 'Suite e2e awal',
        date: '2026-09-04T09:00:00+00:00',
        overlay: '01-initial',
      },
    ],
  },
];

const AUTHOR = { name: 'Fixture Author', email: 'fixture@contract-check.test' };

/** Lingkungan git yang tidak bergantung pada mesin: tanpa GIT_* warisan, tanpa config user/sistem. */
function gitEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, '.config'),
    ...extra,
  };
}

async function git(
  root: string,
  cwd: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: gitEnv(root, extraEnv), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim();
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function prepareRoot(root: string): Promise<void> {
  if (isInside(PROJECT_ROOT, root)) {
    throw new Error(`Fixture tidak boleh ditulis ke dalam repo Contract Check: ${root}`);
  }
  const existing = await fs.readdir(root).catch(() => null);
  if (existing && existing.length > 0) {
    if (!existing.includes(MARKER_FILE)) {
      throw new Error(
        `Folder fixture tidak kosong dan bukan buatan generator, tidak dihapus: ${root}`,
      );
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, MARKER_FILE), 'Dibuat oleh fixtures/make-fixtures.ts\n');
  await fs.writeFile(path.join(root, '.gitconfig'), '');
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else await fs.copyFile(source, target);
  }
}

async function writeGenerated(work: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(work, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

async function buildRepo(root: string, plan: RepoPlan): Promise<FixtureRepo> {
  const work = path.join(root, 'repos', plan.name);
  const remote = path.join(root, 'remotes', `${plan.name}.git`);
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(remote, { recursive: true });

  await git(root, remote, ['init', '--bare', '--initial-branch=main']);
  await git(root, work, ['init', '--initial-branch=main']);
  await git(root, work, ['config', 'core.autocrlf', 'false']);

  const commits: Record<string, string> = {};
  const branches = new Set<string>();
  for (const commit of plan.commits) {
    if (branches.has(commit.branch)) {
      await git(root, work, ['checkout', '--quiet', commit.branch]);
    } else if (commit.from) {
      const base = commits[commit.from];
      if (!base) throw new Error(`${plan.name}: commit '${commit.from}' belum dibuat`);
      await git(root, work, ['checkout', '--quiet', '-b', commit.branch, base]);
    }
    branches.add(commit.branch);

    await copyTree(path.join(TEMPLATES, plan.name, commit.overlay), work);
    if (commit.generated) await writeGenerated(work, commit.generated);
    await git(root, work, ['add', '--all']);
    await git(root, work, ['commit', '--quiet', '--message', commit.message], {
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_AUTHOR_DATE: commit.date,
      GIT_COMMITTER_NAME: AUTHOR.name,
      GIT_COMMITTER_EMAIL: AUTHOR.email,
      GIT_COMMITTER_DATE: commit.date,
    });
    commits[commit.label] = await git(root, work, ['rev-parse', 'HEAD']);
  }

  // Seperti klon sungguhan: cabang lain hanya ada sebagai origin/<cabang>, bukan cabang lokal.
  await git(root, work, ['remote', 'add', 'origin', remote]);
  await git(root, work, ['push', '--quiet', 'origin', '--all']);
  await git(root, work, ['remote', 'set-head', 'origin', 'main']);
  await git(root, work, ['checkout', '--quiet', 'main']);
  for (const branch of branches) {
    if (branch !== 'main')
      await git(root, work, ['branch', '--quiet', '--delete', '--force', branch]);
  }

  return {
    name: plan.name,
    role: plan.role,
    path: work,
    remote,
    defaultBranch: 'main',
    specPath: plan.specPath,
    specCmd: plan.specCmd,
    commits,
  };
}

/** Membuat (atau membuat ulang) seluruh fixture di `root`. Hanya menghapus folder buatan generator. */
export async function makeFixtures(root: string): Promise<FixtureSet> {
  const resolved = path.resolve(root);
  await prepareRoot(resolved);
  const repos = await Promise.all(REPOS.map((plan) => buildRepo(resolved, plan)));
  return {
    root: resolved,
    repos: Object.fromEntries(repos.map((repo) => [repo.name, repo])) as FixtureSet['repos'],
  };
}
