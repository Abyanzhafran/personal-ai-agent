import path from 'node:path';
import {
  ApproveProfileRequest,
  CreateRepoRequest,
  ERROR_CODES,
  ProjectIdParams,
  RepoIdParams,
  UpdateRepoRequest,
  type ProjectRepo,
  type Repo,
  type RepoRef,
  type ValidationDetails,
} from '@cc/shared';
import type { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import { LocalPathError, RefNotFoundError } from '../git/errors.js';
import type { GitAdapter } from '../git/adapter.js';
import { normalizeLocalPath } from '../git/paths.js';
import { HttpError } from '../http/errors.js';
import { validated } from '../http/validate.js';
import { createProjectRepository } from '../projects/repository.js';
import type { CheckRunner } from '../runner/check.js';
import { assertSafeSegment, WorkspacePathError } from '../workspace/layout.js';
import type { WorkspaceStore } from '../workspace/store.js';
import type { DiscoveryRunner } from './discovery.js';
import { createProjectFetcher } from './fetch.js';
import { createRepoRepository } from './repository.js';

export interface RepoRouteDeps {
  readonly db: Db;
  readonly workspace: WorkspaceStore;
  readonly git: GitAdapter;
  readonly config: Pick<Config, 'gitConcurrency'>;
  readonly discovery: DiscoveryRunner;
  /** Menolak DELETE selagi repo dibaca check yang berjalan (G-7). */
  readonly checks: { readonly registry: Pick<CheckRunner['registry'], 'usesRepo'> };
}

const projectNotFound = () =>
  new HttpError(404, ERROR_CODES.project_not_found, 'Project tidak ditemukan');

const repoNotFound = () => new HttpError(404, ERROR_CODES.repo_not_found, 'Repo tidak ditemukan');

/** Galat yang menunjuk satu isian body, supaya dialog menampilkannya di bawah field itu. */
function fieldError(status: number, code: string, field: string, message: string): HttpError {
  const details: ValidationDetails = { fields: [{ in: 'body', path: field, message }] };
  return new HttpError(status, code, message, details);
}

/** "Copy as path" di Windows menempelkan path dengan tanda kutip ganda di kedua ujung. */
function stripSurroundingQuotes(input: string): string {
  const typed = input.trim();
  return typed.length >= 2 && typed.startsWith('"') && typed.endsWith('"')
    ? typed.slice(1, -1)
    : typed;
}

async function normalizePath(input: string): Promise<string> {
  try {
    return await normalizeLocalPath(stripSurroundingQuotes(input));
  } catch (error) {
    if (error instanceof LocalPathError) {
      throw fieldError(400, error.code, 'local_path', error.message);
    }
    throw error;
  }
}

/** Nama repo menjadi nama file profil (D-7), jadi harus lolos aturan nama file workspace. */
function assertUsableName(name: string): void {
  try {
    assertSafeSegment(name, 'nama repo');
  } catch (error) {
    if (!(error instanceof WorkspacePathError)) throw error;
    throw fieldError(
      400,
      ERROR_CODES.validation_failed,
      'name',
      `Nama repo "${name}" tidak bisa dipakai sebagai nama file profil. ` +
        'Hindari \\ / : * ? " < > |, dan akhiran titik atau spasi.',
    );
  }
}

/** Rute repo (CC-013). Dipasang lewat `registerRoutes` di bootstrap. */
export function repoRoutes({
  db,
  workspace,
  git,
  config,
  discovery,
  checks,
}: RepoRouteDeps): (api: Router) => void {
  const projects = createProjectRepository(db);
  const repos = createRepoRepository(db);
  const fetcher = createProjectFetcher({ db, git, concurrency: config.gitConcurrency });

  /**
   * Validasi saat simpan: folder repo git yang punya `origin/<branch>`. Mengembalikan branch yang
   * dipakai; tanpa `branch`, dideteksi dari `origin/HEAD`.
   */
  async function checkGit(
    localPath: string,
    branch: string | undefined,
    notGitField: 'local_path' | 'default_branch',
  ): Promise<string> {
    if (!(await git.isInsideWorkTree(localPath))) {
      throw fieldError(
        400,
        ERROR_CODES.repo_not_git,
        notGitField,
        `Folder ini bukan repo git: ${localPath}`,
      );
    }
    const resolved = branch ?? (await git.originHead(localPath));
    if (resolved === null) {
      throw fieldError(
        400,
        ERROR_CODES.validation_failed,
        'default_branch',
        'Branch default tidak bisa dideteksi dari origin/HEAD. Isi nama branch default.',
      );
    }
    try {
      await git.verifyRef(localPath, `origin/${resolved}`);
    } catch (error) {
      if (!(error instanceof RefNotFoundError)) throw error;
      throw fieldError(
        400,
        ERROR_CODES.branch_not_found,
        'default_branch',
        `Branch "${resolved}" tidak ada di origin. Periksa namanya, atau jalankan git fetch di repo ini.`,
      );
    }
    return resolved;
  }

  /** Discovery dan persetujuan profil tidak berlaku untuk repo e2e dan tidak boleh menyela scan yang berjalan. */
  function assertDiscoverable(repo: Repo): void {
    if (repo.role === 'e2e') {
      throw new HttpError(
        409,
        ERROR_CODES.discovery_not_applicable,
        'Repo e2e tidak dipindai oleh discovery',
      );
    }
    if (discovery.isRunning(repo.id)) {
      throw new HttpError(
        409,
        ERROR_CODES.discovery_in_progress,
        'Discovery repo ini sedang berjalan. Tunggu sampai selesai.',
      );
    }
  }

  return (api) => {
    api.get(
      '/projects/:id/repos',
      validated({ params: ProjectIdParams }, ({ params }, _req, res) => {
        if (!projects.get(params.id)) throw projectNotFound();
        const list: ProjectRepo[] = repos
          .listByProject(params.id)
          .map((repo) => ({ ...repo, profile_status: discovery.status(repo) }));
        res.json(list);
      }),
    );

    api.post(
      '/projects/:id/repos',
      validated(
        { params: ProjectIdParams, body: CreateRepoRequest },
        async ({ params, body }, _req, res) => {
          if (!projects.get(params.id)) throw projectNotFound();

          const localPath = await normalizePath(body.local_path);
          const name = body.name ?? path.basename(localPath);
          assertUsableName(name);
          const defaultBranch = await checkGit(localPath, body.default_branch, 'local_path');

          const result = repos.create({
            projectId: params.id,
            role: body.role,
            name,
            localPath,
            defaultBranch,
          });
          if ('conflict' in result) {
            throw result.conflict === 'local_path'
              ? fieldError(
                  409,
                  ERROR_CODES.repo_path_taken,
                  'local_path',
                  'Path sudah terdaftar di project ini',
                )
              : fieldError(
                  409,
                  ERROR_CODES.repo_name_taken,
                  'name',
                  `Nama repo "${name}" sudah dipakai repo lain di project ini. Isi nama lain.`,
                );
          }
          // Discovery jalan di latar belakang; repo berikutnya tidak menunggu. e2e tidak dipindai.
          if (result.repo.role !== 'e2e') discovery.start(result.repo);
          res.status(201).json(result.repo);
        },
      ),
    );

    api.get(
      '/repos/:id',
      validated({ params: RepoIdParams }, ({ params }, _req, res) => {
        const repo = repos.get(params.id);
        if (!repo) throw repoNotFound();
        res.json(repo);
      }),
    );

    api.patch(
      '/repos/:id',
      validated(
        { params: RepoIdParams, body: UpdateRepoRequest },
        async ({ params, body }, _req, res) => {
          const current = repos.get(params.id);
          if (!current) throw repoNotFound();

          // Branch divalidasi ulang hanya bila dikirim: PATCH peran atau spec tidak menyentuh git.
          const defaultBranch =
            body.default_branch === undefined
              ? current.default_branch
              : await checkGit(current.local_path, body.default_branch, 'default_branch');

          const updated = repos.update(current.id, {
            role: body.role ?? current.role,
            defaultBranch,
            specPath: body.spec_path === undefined ? current.spec_path : body.spec_path,
            specCmd: body.spec_cmd === undefined ? current.spec_cmd : body.spec_cmd,
          });
          res.json(updated);
        },
      ),
    );

    api.get(
      '/repos/:id/refs',
      validated({ params: RepoIdParams }, async ({ params }, _req, res) => {
        const repo = repos.get(params.id);
        if (!repo) throw repoNotFound();
        // Folder yang dipindah atau dihapus user sesudah didaftarkan: jawab jelas, bukan 500.
        if (!(await git.isInsideWorkTree(repo.local_path))) {
          throw new HttpError(
            409,
            ERROR_CODES.repo_not_git,
            `Folder repo tidak lagi berupa repo git: ${repo.local_path}`,
          );
        }
        const [branches, tags] = await Promise.all([
          git.forEachRefRemotes(repo.local_path),
          git.forEachRefTags(repo.local_path),
        ]);
        // Cabang default paling atas; sisanya tetap urut nama seperti dari git.
        const isDefault = (branch: { name: string }) => branch.name === repo.default_branch;
        const refs: RepoRef[] = [
          ...[...branches.filter(isDefault), ...branches.filter((b) => !isDefault(b))].map((b) => ({
            ...b,
            kind: 'branch' as const,
          })),
          ...tags.map((t) => ({ ...t, kind: 'tag' as const })),
        ];
        res.json(refs);
      }),
    );

    api.get(
      '/repos/:id/profile',
      validated({ params: RepoIdParams }, async ({ params }, _req, res) => {
        const repo = repos.get(params.id);
        if (!repo) throw repoNotFound();
        res.json(await discovery.profile(repo));
      }),
    );

    // Pindai (ulang) manual. 202: hasilnya dipantau lewat GET /repos/:id/profile.
    api.post(
      '/repos/:id/discovery',
      validated({ params: RepoIdParams }, async ({ params }, _req, res) => {
        const repo = repos.get(params.id);
        if (!repo) throw repoNotFound();
        assertDiscoverable(repo);
        discovery.start(repo);
        res.status(202).json(await discovery.profile(repo));
      }),
    );

    api.put(
      '/repos/:id/profile',
      validated(
        { params: RepoIdParams, body: ApproveProfileRequest },
        async ({ params, body }, _req, res) => {
          const repo = repos.get(params.id);
          if (!repo) throw repoNotFound();
          assertDiscoverable(repo);
          const approved = await discovery.approve(repo, body);
          if (!approved) {
            throw new HttpError(
              409,
              ERROR_CODES.profile_not_ready,
              'Repo ini belum punya draf profil. Jalankan discovery dulu.',
            );
          }
          res.json(approved);
        },
      ),
    );

    api.post(
      '/projects/:id/fetch',
      validated({ params: ProjectIdParams }, async ({ params }, _req, res) => {
        if (!projects.get(params.id)) throw projectNotFound();
        // 200 walau ada repo yang gagal: kegagalan per repo ada di isi respons.
        res.json(await fetcher.fetchProject(params.id));
      }),
    );

    api.delete(
      '/repos/:id',
      validated({ params: RepoIdParams }, async ({ params }, _req, res) => {
        const repo = repos.get(params.id);
        if (!repo) throw repoNotFound();
        if (checks.registry.usesRepo(repo.id)) {
          throw new HttpError(
            409,
            ERROR_CODES.check_in_progress,
            'Repo ini sedang dibaca check yang berjalan. Tunggu sampai selesai sebelum menghapusnya.',
          );
        }
        const project = projects.get(repo.project_id);
        if (!project) throw projectNotFound();
        // Berkas dulu, baris DB sesudahnya (pola yang sama dengan DELETE project): kegagalan di
        // tengah bisa diulang dengan DELETE yang sama.
        await workspace.removeRepoData({
          id: repo.id,
          name: repo.name,
          projectSlug: project.slug,
          checkIds: repos.providerCheckIds(repo.id),
        });
        repos.delete(repo.id);
        res.status(204).end();
      }),
    );
  };
}
