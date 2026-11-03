import type { Repo } from '@cc/shared';
import { buildEndpoints, type ChangedEndpoint } from '../diff/endpoints.js';
import type { Oasdiff, OasdiffChange } from '../diff/oasdiff.js';
import type { DiscoveryRunner } from '../repos/discovery.js';
import { generateSpecCached } from '../spec/cache.js';
import { toOpenApi3 } from '../spec/convert.js';
import { resolveCommittedSpec } from '../spec/resolve.js';
import { detectSpecStale, type SpecStaleDeps, type SpecStaleFinding } from '../spec/stale.js';
import type { WorkspaceLayout } from '../workspace/layout.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { CheckFailure } from './errors.js';

export interface DiffStepDeps extends SpecStaleDeps {
  readonly layout: Pick<WorkspaceLayout, 'worktreeDir' | 'specCacheFile' | 'checkArtifact'>;
  readonly workspace: Pick<WorkspaceStore, 'readCache' | 'writeCache' | 'writeJson'>;
  readonly oasdiff: Pick<Oasdiff, 'assertAvailable' | 'changelog'>;
  readonly discovery: Pick<DiscoveryRunner, 'profile'>;
}

export interface DiffStepInput {
  readonly checkId: number;
  readonly provider: Repo;
  readonly baseSha: string;
  readonly headSha: string;
  readonly signal?: AbortSignal;
}

export interface DiffStepResult {
  /** Sudah OpenAPI 3: dipakai ulang pembanding (langkah 5). */
  readonly baseSpec: Record<string, unknown>;
  readonly headSpec: Record<string, unknown>;
  readonly endpoints: readonly ChangedEndpoint[];
  readonly specStale: SpecStaleFinding | null;
  /** oasdiff ditambah tool generator (`spec_cmd`) base dan head. */
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly specUnpinned: boolean;
}

/**
 * Langkah 1 sesudah ref terselesaikan: spec base dan head (generate atau `git show`), konversi
 * Swagger 2, `oasdiff changelog`, daftar endpoint berubah, dan deteksi `spec_stale`. Artefak
 * `spec-base.json`, `spec-head.json`, dan `changelog.json` ditulis ke `runs/checks/<id>/`.
 * Galat spec/generate/oasdiff merambat; pemanggil menjadikannya check Gagal.
 */
export async function diffSpecs(
  deps: DiffStepDeps,
  { checkId, provider, baseSha, headSha, signal }: DiffStepInput,
): Promise<DiffStepResult> {
  const { layout, workspace, oasdiff } = deps;
  const { spec_path: specPath, spec_cmd: specCmd } = provider;
  if (specPath === null) {
    throw new CheckFailure(
      `Repo ${provider.name} belum punya spec_path. Isi spec_path di pengaturan repo, lalu ulangi check.`,
    );
  }
  const withSignal = signal === undefined ? {} : { signal };

  // Berurutan: base dan head sama bila head = base, dan keduanya memakai nama worktree yang sama.
  const load = (sha: string) =>
    specCmd === null
      ? resolveCommittedSpec(deps.git, { repo: provider.local_path, sha, specPath })
      : generateSpecCached(deps, {
          repoId: provider.id,
          checkId,
          repo: provider.local_path,
          sha,
          specPath,
          specCmd,
          ...withSignal,
        });
  const base = await load(baseSha);
  const head = await load(headSha);
  const baseSpec = (await toOpenApi3(base)).document;
  const headSpec = (await toOpenApi3(head)).document;

  const baseFile = layout.checkArtifact(checkId, 'spec-base.json');
  const headFile = layout.checkArtifact(checkId, 'spec-head.json');
  await workspace.writeJson(baseFile, baseSpec);
  await workspace.writeJson(headFile, headSpec);

  const oasdiffVersion = await oasdiff.assertAvailable();
  const changes: OasdiffChange[] = await oasdiff.changelog({
    base: baseFile,
    head: headFile,
    ...withSignal,
  });
  await workspace.writeJson(layout.checkArtifact(checkId, 'changelog.json'), changes);

  const specStale = await detectSpecStale(deps, {
    checkId,
    repo: provider,
    baseSha,
    headSha,
    profile: await deps.discovery.profile(provider),
    ...withSignal,
  });

  return {
    baseSpec,
    headSpec,
    endpoints: buildEndpoints(changes, { baseSpec }),
    specStale,
    toolVersions: {
      oasdiff: oasdiffVersion,
      ...(base.source === 'generated' ? base.tool_versions : {}),
      ...(head.source === 'generated' ? head.tool_versions : {}),
    },
    specUnpinned:
      (base.source === 'generated' && base.spec_unpinned) ||
      (head.source === 'generated' && head.spec_unpinned),
  };
}
