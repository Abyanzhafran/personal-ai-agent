import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorkspaceLayout } from '../workspace/layout.js';
import type { WorkspaceStore } from '../workspace/store.js';
import {
  generateSpec,
  type GenerateInput,
  type GeneratedSpec,
  type SpecGeneratorDeps,
} from './generate.js';

const CachedSpec = z.object({
  document: z.record(z.string(), z.unknown()),
  source: z.literal('generated'),
  sha: z.string(),
  path: z.string(),
  spec_unpinned: z.boolean(),
  tool_versions: z.record(z.string(), z.string()),
});

export interface SpecCacheDeps extends SpecGeneratorDeps {
  readonly layout: Pick<WorkspaceLayout, 'worktreeDir' | 'specCacheFile'>;
  readonly workspace: Pick<WorkspaceStore, 'readCache' | 'writeCache'>;
}

export interface CachedGenerateInput extends GenerateInput {
  /** `repos.id`: kunci cache memakai id, bukan nama (D-6). */
  readonly repoId: number;
}

/**
 * `generateSpec` dengan cache `cache/specs/<repoId>/<sha>-<sha256(spec_cmd)>.json`, dipakai base
 * dan head. Hanya hasil sukses yang disimpan. Berkas cache rusak, salah bentuk, atau untuk
 * `spec_path` lain dianggap cache miss.
 */
export async function generateSpecCached(
  deps: SpecCacheDeps,
  input: CachedGenerateInput,
): Promise<GeneratedSpec> {
  const { layout, workspace } = deps;
  const cmdHash = createHash('sha256').update(input.specCmd).digest('hex');
  const file = layout.specCacheFile(input.repoId, input.sha, cmdHash);

  const cached = await workspace.readCache(file, (data) => CachedSpec.parse(data));
  // `spec_path` tidak ada di kunci (kartu); hasil untuk path lain tidak boleh dipakai.
  if (cached && cached.path === input.specPath) return cached;

  const generated = await generateSpec(deps, input);
  await workspace.writeCache(file, generated);
  return generated;
}
