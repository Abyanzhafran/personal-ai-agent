import {
  RepoProfile,
  type ApproveProfileRequest,
  type Repo,
  type RepoProfileResponse,
} from '@cc/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import type { GitAdapter } from '../git/adapter.js';
import type { LlmClient } from '../llm/client.js';
import { buildDiscoveryPrompt, DiscoveryOutput } from '../llm/discovery.prompt.js';
import type { Logger } from '../logger.js';
import { createProjectRepository } from '../projects/repository.js';
import { createLimiter } from '../util/concurrency.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { createDiscoveryInputCollector } from './discovery-input.js';
import { createRepoRepository } from './repository.js';

interface DiscoveryRunnerDeps {
  readonly db: Db;
  readonly workspace: WorkspaceStore;
  readonly git: Pick<GitAdapter, 'lsTree' | 'show'>;
  readonly llm: Pick<LlmClient, 'callJson'>;
  readonly logger: Logger;
  /** `GIT_CONCURRENCY` untuk membaca file repo, `LLM_CONCURRENCY` untuk panggilan Claude paralel. */
  readonly config: Pick<Config, 'gitConcurrency' | 'llmConcurrency'>;
}

/**
 * Discovery repo di latar belakang (CC-019): input deterministik (CC-017) → prompt (CC-018) →
 * Claude → draf `contexts/projects/<slug>/<repo>.json`. "Sedang dipindai" hanya ada di memori
 * (`running`), jadi hilang bila server mati dan repo kembali ke status tersimpannya.
 */
export function createDiscoveryRunner({
  db,
  workspace,
  git,
  llm,
  logger,
  config,
}: DiscoveryRunnerDeps) {
  const repos = createRepoRepository(db);
  const projects = createProjectRepository(db);
  const collector = createDiscoveryInputCollector({ git, concurrency: config.gitConcurrency });
  // Hanya panggilan Claude yang diantre; membaca file lewat git sudah dibatasi `GIT_CONCURRENCY`.
  const withLlmSlot = createLimiter(config.llmConcurrency);
  const running = new Map<number, Promise<void>>();
  const stopping = new AbortController();

  async function scan(repo: Repo): Promise<void> {
    try {
      const input = await collector.collect({
        path: repo.local_path,
        defaultBranch: repo.default_branch,
      });
      const profile = await withLlmSlot(() =>
        llm.callJson({
          prompt: buildDiscoveryPrompt(input),
          schema: DiscoveryOutput,
          signal: stopping.signal,
        }),
      );
      // Repo atau project bisa dihapus selagi dipindai; jangan meninggalkan draf yatim.
      const slug = repos.get(repo.id) ? projects.get(repo.project_id)?.slug : undefined;
      if (slug === undefined) return;
      await workspace.writeJson(workspace.layout.repoProfileDraftFile(slug, repo.name), profile);
      repos.setProfileScanned(repo.id);
    } catch (error) {
      // Gagal karena server dimatikan bukan galat discovery; jangan dicatat ke repo.
      if (stopping.signal.aborted) return;
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/g, ' ')
        .trim();
      logger.warn({ repoId: repo.id, error: message }, 'Discovery gagal');
      repos.setProfileScanFailed(repo.id, message);
    }
  }

  /** Draf discovery; null bila berkasnya tidak ada atau rusak. */
  async function readDraft(repo: Repo): Promise<RepoProfile | null> {
    const project = projects.get(repo.project_id);
    if (!project) return null;
    const file = workspace.layout.repoProfileDraftFile(project.slug, repo.name);
    return (await workspace.readCache(file, (data) => RepoProfile.parse(data))) ?? null;
  }

  return {
    isRunning: (repoId: number): boolean => running.has(repoId),

    /** Memulai discovery tanpa menunggu. Pemanggil memastikan repo bukan `e2e` dan belum berjalan. */
    start(repo: Repo): void {
      const job = scan(repo)
        // `scan` menangani galat discovery sendiri; sisanya (mis. DB gagal menulis) tidak boleh menjatuhkan proses.
        .catch((error: unknown) =>
          logger.error(
            { repoId: repo.id, error: String(error) },
            'Discovery: hasil tidak tersimpan',
          ),
        )
        .finally(() => running.delete(repo.id));
      running.set(repo.id, job);
    },

    /** Isi `GET /api/repos/:id/profile`. */
    async profile(repo: Repo): Promise<RepoProfileResponse> {
      const status =
        repo.role === 'e2e' ? 'skipped' : running.has(repo.id) ? 'scanning' : repo.profile_status;
      return {
        status,
        error: repo.profile_error,
        profile: repo.profile_status === 'not_scanned' ? null : await readDraft(repo),
      };
    },

    /**
     * Menyetujui profil (CC-020): `.md` persis seperti dikirim, `.json` = draf + nilai yang disetujui,
     * lalu DB. Berkas dulu, DB terakhir, jadi PUT yang sama aman diulang bila gagal di tengah.
     * `undefined` bila belum ada draf yang terbaca. Pemanggil sudah menolak e2e dan scan yang berjalan.
     */
    async approve(
      repo: Repo,
      input: ApproveProfileRequest,
    ): Promise<RepoProfileResponse | undefined> {
      const slug = projects.get(repo.project_id)?.slug;
      const draft = repo.profile_status === 'not_scanned' ? null : await readDraft(repo);
      if (slug === undefined || draft === null) return undefined;

      const specPath =
        input.apply_spec_path && draft.spec_path !== null ? draft.spec_path : repo.spec_path;
      const specCmd = input.spec_cmd === undefined ? repo.spec_cmd : input.spec_cmd;
      const profile = {
        ...draft,
        profile_md: input.profile_md,
        spec_path: specPath,
        spec_cmd: specCmd,
      };
      const { layout } = workspace;
      await workspace.writeFileAtomic(layout.repoProfileFile(slug, repo.name), input.profile_md);
      await workspace.writeJson(layout.repoProfileDraftFile(slug, repo.name), profile);
      repos.setProfileApproved(repo.id, { specPath, specCmd });
      return { status: 'approved', error: null, profile };
    },

    /** Membatalkan panggilan Claude yang berjalan dan menunggu semuanya berhenti, sebelum DB ditutup. */
    async stop(): Promise<void> {
      stopping.abort();
      await Promise.all(running.values());
    },
  };
}

export type DiscoveryRunner = ReturnType<typeof createDiscoveryRunner>;
