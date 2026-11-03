import type { Check, CheckSummary, Repo } from '@cc/shared';
import { createCheckRepository, type NewFinding } from '../checks/repository.js';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import type { Oasdiff } from '../diff/oasdiff.js';
import type { GitAdapter } from '../git/adapter.js';
import type { LlmClient } from '../llm/client.js';
import type { Logger } from '../logger.js';
import type { CommandRunner } from '../proc/run-command.js';
import type { DiscoveryRunner } from '../repos/discovery.js';
import { createProjectFetcher } from '../repos/fetch.js';
import { createRepoRepository } from '../repos/repository.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { compareCalls } from './compare-step.js';
import { findConsumerCalls, type ConsumerStepResult } from './consumers-step.js';
import { diffSpecs } from './diff-step.js';
import { CheckFailure } from './errors.js';
import { createCheckRegistry } from './registry.js';
import { resolveRefs } from './resolve.js';

export interface CheckRunnerDeps {
  readonly db: Db;
  readonly config: Pick<
    Config,
    | 'anthropicModel'
    | 'gitConcurrency'
    | 'llmConcurrency'
    | 'maxFilesPerCheck'
    | 'maxLlmCallsPerCheck'
    | 'specCmdTimeoutMs'
  >;
  readonly logger: Logger;
  readonly workspace: WorkspaceStore;
  readonly git: GitAdapter;
  readonly runner: CommandRunner;
  readonly oasdiff: Pick<Oasdiff, 'assertAvailable' | 'changelog'>;
  readonly llm: Pick<LlmClient, 'callJson'>;
  readonly discovery: Pick<DiscoveryRunner, 'profile'>;
  readonly now?: () => Date;
}

/** Project sudah punya check berjalan; satu job aktif per project. */
export class CheckAlreadyRunningError extends Error {
  constructor(
    readonly projectId: number,
    readonly checkId: number,
  ) {
    super(`Project ${projectId} sudah punya check berjalan (#${checkId})`);
    this.name = 'CheckAlreadyRunningError';
  }
}

export interface StartCheckInput {
  readonly provider: Repo;
  readonly baseRef: string;
  readonly headRef: string;
}

const NO_CONSUMERS: ConsumerStepResult = {
  files: [],
  consumerShas: {},
  endpointsWithoutConsumer: [],
  filesChecked: 0,
  filesViaHop2: 0,
  skippedFiles: 0,
  incomplete: false,
};

/**
 * Check runner (CC-060): membuat baris `checks`, lalu menjalankan pipeline enam langkah di latar
 * belakang. Satu job aktif per project (registry di memori). Segala galat pipeline menjadi status
 * `failed` dengan alasannya; abort menjadi `cancelled` tanpa finding parsial. Hasil hanya ditulis
 * sekali, di akhir langkah 6.
 */
export function createCheckRunner(deps: CheckRunnerDeps) {
  const { db, config, logger, workspace, git, oasdiff, discovery } = deps;
  const now = deps.now ?? (() => new Date());
  const checks = createCheckRepository(db);
  const repos = createRepoRepository(db);
  const registry = createCheckRegistry();
  const fetcher = createProjectFetcher({ db, git, concurrency: config.gitConcurrency, now });

  async function pipeline(check: Check, provider: Repo, signal: AbortSignal): Promise<void> {
    const log = (step: string, name: string) =>
      logger.info({ checkId: check.id, step, name }, 'langkah check dimulai');
    const projectRepos = repos.listByProject(provider.project_id);

    log('1', 'Resolve ref dan diff spec');
    const fetchErrors: CheckSummary['fetch_errors'] = [];
    for (const result of await fetcher.fetchProject(provider.project_id)) {
      if (result.ok) continue;
      if (result.repo_id === provider.id) {
        throw new CheckFailure(`Repo ${provider.name}: ${result.error}`);
      }
      fetchErrors.push({ repo: result.name, message: result.error ?? '' });
    }
    signal.throwIfAborted();

    const { baseSha, headSha } = await resolveRefs(git, provider.local_path, {
      baseRef: check.base_ref,
      headRef: check.head_ref,
    });
    checks.setShas(check.id, baseSha, headSha);
    const diff = await diffSpecs(
      {
        git,
        runner: deps.runner,
        layout: workspace.layout,
        workspace,
        timeoutMs: config.specCmdTimeoutMs,
        logger,
        oasdiff,
        discovery,
      },
      { checkId: check.id, provider, baseSha, headSha, signal },
    );
    signal.throwIfAborted();

    // Tanpa perubahan endpoint tidak ada yang dicari di consumer.
    let consumers = NO_CONSUMERS;
    let findings: NewFinding[] = [];
    let matched: Readonly<Record<string, readonly string[]>> = {};
    if (diff.endpoints.length > 0) {
      log('2-4', 'Cari consumer, ekstraksi pemakaian, pemakai simbol');
      consumers = await findConsumerCalls(
        { git, discovery, llm: deps.llm, workspace, config, logger },
        { checkId: check.id, provider, repos: projectRepos, endpoints: diff.endpoints, signal },
      );
      signal.throwIfAborted();

      log('5', 'Bandingkan');
      const compared = await compareCalls(
        { git, logger },
        {
          files: consumers.files,
          endpoints: diff.endpoints,
          specs: { base: diff.baseSpec, head: diff.headSpec },
        },
      );
      findings = [...compared.findings];
      matched = compared.matchedFields;
    }
    if (diff.specStale !== null) {
      findings.push({
        endpoint: diff.specStale.endpoint,
        consumerRepoId: null,
        file: null,
        line: null,
        kind: diff.specStale.kind,
        severity: diff.specStale.severity,
        detail: diff.specStale.detail,
        confidence: null,
        viaSymbol: null,
        snippet: null,
      });
    }

    log('6', 'Laporan');
    // Setelah ini tidak ada `await`: status check tidak mungkin berubah menjadi cancelled/failed lebih dulu.
    signal.throwIfAborted();
    checks.saveResult(check.id, {
      findings,
      summary: {
        files_checked: consumers.filesChecked,
        files_via_hop2: consumers.filesViaHop2,
        endpoints_without_consumer: [...consumers.endpointsWithoutConsumer],
        consumer_shas: { ...consumers.consumerShas },
        matched_fields: Object.fromEntries(Object.entries(matched).map(([k, v]) => [k, [...v]])),
        incomplete: consumers.incomplete,
        skipped_files: consumers.skippedFiles,
        tool_versions: { ...diff.toolVersions },
        spec_unpinned: diff.specUnpinned,
        fetch_errors: fetchErrors,
      },
      finishedAt: now().toISOString(),
    });
  }

  /** Tidak pernah menolak: apa pun yang terjadi berakhir sebagai status check. */
  async function execute(check: Check, provider: Repo, signal: AbortSignal): Promise<void> {
    try {
      await pipeline(check, provider, signal);
    } catch (error) {
      try {
        if (signal.aborted) {
          checks.cancel(check.id, now().toISOString());
        } else {
          logger.warn({ checkId: check.id, err: error }, 'check gagal');
          checks.fail(
            check.id,
            error instanceof Error ? error.message : String(error),
            now().toISOString(),
          );
        }
      } catch (writeError) {
        logger.error({ checkId: check.id, err: writeError }, 'status check tidak bisa ditulis');
      }
    }
  }

  return {
    registry,

    /**
     * Membuat check dan memulainya di latar belakang; mengembalikan baris yang baru dibuat (status
     * `running`). Melempar `OasdiffUnavailableError` (tanpa membuat baris) bila oasdiff tidak bisa dipakai,
     * dan {@link CheckAlreadyRunningError} bila project sudah punya check berjalan.
     */
    async start({ provider, baseRef, headRef }: StartCheckInput): Promise<Check> {
      await oasdiff.assertAvailable();

      // Dari sini sampai `registry.add` tanpa `await`, jadi dua POST bersamaan tidak lolos keduanya.
      const running = registry.forProject(provider.project_id);
      if (running) throw new CheckAlreadyRunningError(provider.project_id, running.checkId);
      const check = checks.create({
        projectId: provider.project_id,
        providerRepoId: provider.id,
        baseRef,
        headRef,
        startedAt: now().toISOString(),
      });
      const abort = new AbortController();
      const done = execute(check, provider, abort.signal).finally(() => registry.remove(check.id));
      registry.add({
        checkId: check.id,
        projectId: provider.project_id,
        repoIds: new Set(
          repos
            .listByProject(provider.project_id)
            .filter((repo) => repo.role !== 'e2e')
            .map((repo) => repo.id),
        ),
        abort,
        done,
      });
      return check;
    },

    /** Mengabort semua check berjalan dan menunggunya menulis status (shutdown). */
    stop: () => registry.stopAll(),
  };
}

export type CheckRunner = ReturnType<typeof createCheckRunner>;
