import type { Repo } from '@cc/shared';
import type { Config } from '../config.js';
import {
  createConsumerGrep,
  type ConsumerCandidate,
  type ConsumerRepo,
} from '../consumers/grep.js';
import {
  createSymbolSearch,
  markViaSymbol,
  type Hop2Candidate,
  type WrapperSymbol,
} from '../consumers/hop2.js';
import { limitCandidates } from '../consumers/limit.js';
import { matchCalls } from '../compare/match.js';
import type { ChangedEndpoint } from '../diff/endpoints.js';
import {
  createExtractionRunner,
  type ExtractionFile,
  type FileExtraction,
} from '../extract/runner.js';
import { verifyExtraction } from '../extract/verify.js';
import type { GitAdapter } from '../git/adapter.js';
import type { LlmClient } from '../llm/client.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import type { Logger } from '../logger.js';
import type { DiscoveryRunner } from '../repos/discovery.js';
import type { WorkspaceStore } from '../workspace/store.js';
import type { StepReporter } from './events.js';

export interface ConsumerStepDeps {
  readonly git: Pick<GitAdapter, 'revParse' | 'lsTree' | 'grepFixed' | 'grepWord' | 'show'>;
  readonly discovery: Pick<DiscoveryRunner, 'profile'>;
  readonly llm: Pick<LlmClient, 'callJson'>;
  readonly workspace: WorkspaceStore;
  readonly config: Pick<
    Config,
    | 'anthropicModel'
    | 'gitConcurrency'
    | 'llmConcurrency'
    | 'maxFilesPerCheck'
    | 'maxLlmCallsPerCheck'
  >;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
}

export interface ConsumerStepInput {
  readonly checkId: number;
  readonly provider: Repo;
  /** Semua repo project; consumer = bukan provider dan bukan e2e. */
  readonly repos: readonly Repo[];
  readonly endpoints: readonly ChangedEndpoint[];
  /** Event langkah 2–4 dan log untuk SSE. */
  readonly report: StepReporter;
  readonly signal?: AbortSignal;
}

/** Panggilan hasil ekstraksi; `via_symbol` hanya ada pada berkas hop 2. */
export type ExtractedCall = ApiCall & { readonly via_symbol?: string };

/** Satu berkas consumer yang berhasil diekstrak dan diverifikasi. */
export interface ExtractedFile {
  readonly repo: Repo;
  /** SHA `origin/<default>` consumer yang dibaca. */
  readonly sha: string;
  readonly path: string;
  readonly baseUrlPattern: string | null;
  readonly calls: readonly ExtractedCall[];
}

export interface ConsumerStepResult {
  readonly files: readonly ExtractedFile[];
  readonly consumerShas: Readonly<Record<string, string>>;
  /** `'METHOD path'` tanpa satu pun berkas kandidat. */
  readonly endpointsWithoutConsumer: readonly string[];
  readonly filesChecked: number;
  readonly filesViaHop2: number;
  /** Berkas yang terlewat karena batas berkas atau jatah panggilan Claude. */
  readonly skippedFiles: number;
  readonly incomplete: boolean;
}

/**
 * Langkah 2–4: berkas consumer yang memuat kata kunci endpoint (hop 1), ekstraksi pemakaian oleh
 * Claude, verifikasi, lalu berkas yang memakai simbol pembungkus (hop 2). Berkas yang gagal
 * diekstrak dicatat di log dan dilewati; check tetap lanjut.
 */
export async function findConsumerCalls(
  deps: ConsumerStepDeps,
  { checkId, provider, repos, endpoints, report, signal }: ConsumerStepInput,
): Promise<ConsumerStepResult> {
  const { git, discovery, config, logger } = deps;
  const consumers = repos.filter((repo) => repo.role !== 'e2e' && repo.id !== provider.id);
  const consumerRepos: ConsumerRepo[] = consumers.map((repo) => ({
    name: repo.name,
    role: repo.role,
    path: repo.local_path,
    defaultBranch: repo.default_branch,
  }));
  const repoByName = new Map(consumers.map((repo) => [repo.name, repo]));
  const withSignal = signal === undefined ? {} : { signal };

  // Langkah 2: hop 1.
  report.step(2, 'running');
  const search = await createConsumerGrep({ git, concurrency: config.gitConcurrency }).search({
    endpoints,
    repos: consumerRepos,
    provider: provider.name,
  });
  const hop1 = limitCandidates(search.endpoints, config.maxFilesPerCheck);
  const endpointsWithoutConsumer = search.endpoints
    .filter(({ candidates }) => candidates.length === 0)
    .map(({ endpoint }) => `${endpoint.method} ${endpoint.path}`);

  const candidateFiles = hop1.files.length + hop1.skipped_files;
  const candidateRepos = new Set(
    search.endpoints.flatMap(({ candidates }) => candidates.map((candidate) => candidate.repo)),
  ).size;
  const skippedNote =
    hop1.skipped_files > 0
      ? ` · ${hop1.skipped_files} file dilewati (batas ${config.maxFilesPerCheck})`
      : '';
  report.log(
    'grep',
    `${candidateFiles} candidate files in ${candidateRepos} repos` +
      (hop1.skipped_files > 0
        ? ` (${hop1.skipped_files} skipped, limit ${config.maxFilesPerCheck})`
        : ''),
  );
  report.step(
    2,
    'done',
    `${candidateFiles} file kandidat di ${candidateRepos} repo (git grep)` +
      (repos.some((repo) => repo.role === 'e2e') ? ' · repo e2e dilewati' : '') +
      skippedNote,
  );

  const profiles = new Map(
    await Promise.all(
      consumers.map(async (repo) => [repo.id, await discovery.profile(repo)] as const),
    ),
  );
  const profileOf = (repo: Repo) => profiles.get(repo.id)?.profile ?? null;
  const promptEndpoints = endpoints.map(({ method, path, operationId }) => ({
    method,
    path,
    operationId,
  }));

  /** Mengekstrak lalu memverifikasi `candidates`; hasil mengikuti urutan masukan. */
  async function extract(
    candidates: readonly (ConsumerCandidate &
      Partial<Pick<Hop2Candidate, 'symbols' | 'context'>>)[],
    maxCalls: number,
    onResult: (result: FileExtraction) => void,
  ): Promise<{ files: ExtractedFile[]; results: FileExtraction[] }> {
    const repoOf = (name: string) => repoByName.get(name) as Repo;
    const byRepoId = new Map(consumers.map((repo) => [repo.id, repo]));
    const files: ExtractionFile[] = candidates.map((candidate) => {
      const repo = repoOf(candidate.repo);
      return {
        repoId: repo.id,
        path: candidate.path,
        blob_sha: candidate.blob_sha,
        profile: profileOf(repo)?.profile_md ?? '',
        ...(candidate.context === undefined ? {} : { context: candidate.context }),
      };
    });
    const read = (repo: Repo, path: string) =>
      git.show(repo.local_path, search.consumer_shas[repo.name] as string, path);

    const results = await createExtractionRunner({
      llm: deps.llm,
      workspace: deps.workspace,
      model: config.anthropicModel,
      concurrency: config.llmConcurrency,
      maxCalls,
    }).run({
      checkId,
      files,
      endpoints: promptEndpoints,
      readContent: (file) => read(byRepoId.get(file.repoId) as Repo, file.path),
      ...withSignal,
      onFile: (result) => {
        logger.info(
          {
            checkId,
            path: result.path,
            status: result.status,
            ...(result.status === 'ok' ? { source: result.source } : {}),
          },
          'ekstraksi berkas',
        );
        report.log(
          'extract',
          result.status === 'ok'
            ? `${result.path}${result.source === 'cache' ? ' (cache)' : ''}`
            : result.status === 'failed'
              ? `${result.path} failed: ${result.error}`
              : `${result.path} skipped (Claude call limit)`,
        );
        onResult(result);
      },
    });

    const extracted: ExtractedFile[] = [];
    for (const [index, result] of results.entries()) {
      const candidate = candidates[index] as (typeof candidates)[number];
      const repo = repoOf(candidate.repo);
      if (result.status === 'failed') {
        logger.warn(
          { checkId, repo: repo.name, path: result.path, error: result.error },
          'ekstraksi berkas gagal',
        );
      }
      if (result.status !== 'ok') continue;
      const verified = verifyExtraction(
        result.extraction,
        await read(repo, candidate.path),
        candidate.symbols,
      );
      const marked =
        candidate.symbols === undefined ? verified : markViaSymbol(verified, candidate.symbols);
      extracted.push({
        repo,
        sha: search.consumer_shas[repo.name] as string,
        path: candidate.path,
        baseUrlPattern: profileOf(repo)?.base_url_pattern ?? null,
        calls: marked.calls,
      });
    }
    return { files: extracted, results };
  }

  // Langkah 3: ekstraksi hop 1.
  let finished = 0;
  let cached = 0;
  let failed = 0;
  const progress = () =>
    `${finished} dari ${hop1.files.length} file selesai · ${cached} dari cache` +
    (failed > 0 ? ` · ${failed} gagal` : '') +
    ` · batas ${config.maxFilesPerCheck} file per check`;
  report.step(3, 'running', progress());
  const first = await extract(hop1.files, config.maxLlmCallsPerCheck, (result) => {
    finished++;
    if (result.status === 'ok' && result.source === 'cache') cached++;
    if (result.status === 'failed') failed++;
    report.step(3, 'running', progress());
  });
  report.step(3, 'done', progress());

  // Langkah 4: hop 2, hanya simbol dari pemakaian yang cocok dengan endpoint berubah.
  const wrappers: WrapperSymbol[] = first.files.flatMap((file) =>
    matchCalls(file.calls, endpoints, { baseUrlPattern: file.baseUrlPattern }).flatMap(({ call }) =>
      call.wrapper_symbols.map((symbol) => ({
        repo: file.repo.name,
        symbol,
        method: call.method,
        path: call.path,
      })),
    ),
  );
  const wrapperNames = [...new Set(wrappers.map((wrapper) => wrapper.symbol))];
  if (wrappers.length > 0) report.step(4, 'running', `simbol: ${wrapperNames.join(', ')}`);
  const hop2 =
    wrappers.length === 0
      ? { files: [], skipped_files: 0, incomplete: false }
      : await createSymbolSearch({ git, concurrency: config.gitConcurrency }).search({
          wrappers,
          repos: consumerRepos,
          exclude: hop1.files,
          max: config.maxFilesPerCheck,
        });
  // Jatah panggilan Claude berlaku per check: hop 2 memakai sisa hop 1. Berkas gagal dihitung terpakai.
  const used = first.results.filter(
    (result) => result.status === 'failed' || (result.status === 'ok' && result.source === 'llm'),
  ).length;
  const second = await extract(
    hop2.files,
    Math.max(0, config.maxLlmCallsPerCheck - used),
    () => undefined,
  );
  const viaSymbols = [...new Set(hop2.files.flatMap((file) => file.symbols))].sort();
  report.log('hop2', `${second.files.length} files via symbols ${viaSymbols.join(', ') || '-'}`);
  report.step(
    4,
    'done',
    wrappers.length === 0
      ? 'Tidak ada simbol pembungkus'
      : `${second.files.length} file lewat simbol` +
          (viaSymbols.length > 0 ? `: ${viaSymbols.join(', ')}` : ''),
  );

  const budgetSkipped = [...first.results, ...second.results].filter(
    (result) => result.status === 'skipped',
  ).length;
  const skippedFiles = hop1.skipped_files + hop2.skipped_files + budgetSkipped;
  return {
    files: [...first.files, ...second.files],
    consumerShas: search.consumer_shas,
    endpointsWithoutConsumer,
    filesChecked: first.files.length + second.files.length,
    filesViaHop2: second.files.length,
    skippedFiles,
    incomplete: skippedFiles > 0,
  };
}
