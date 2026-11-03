import fs from 'node:fs/promises';
import path from 'node:path';
import { createCheckRepository } from '../checks/repository.js';
import type { Db } from '../db/database.js';
import type { GitAdapter } from '../git/adapter.js';
import type { Logger } from '../logger.js';
import { createRepoRepository } from '../repos/repository.js';
import type { WorkspaceStore } from '../workspace/store.js';

export const INTERRUPTED_ERROR = 'server berhenti saat check berjalan';

export interface RecoveryDeps {
  readonly db: Db;
  readonly workspace: Pick<WorkspaceStore, 'layout' | 'remove'>;
  readonly git: Pick<GitAdapter, 'worktreePrune'>;
  readonly logger: Pick<Logger, 'info' | 'warn'>;
  readonly now?: () => Date;
}

/** Id check dari folder `runs/checks/<id>/` yang masih menyimpan `wt-*` (worktree sementara `spec_cmd`). */
async function checksWithLeftoverWorktrees(
  workspace: RecoveryDeps['workspace'],
): Promise<Map<number, string[]>> {
  const found = new Map<number, string[]>();
  const root = workspace.layout.checksDir;
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const id = Number(entry.name);
    const inner = await fs.readdir(path.join(root, entry.name)).catch(() => [] as string[]);
    const leftovers = inner.filter((name) => name.startsWith('wt-'));
    if (leftovers.length > 0) found.set(id, leftovers);
  }
  return found;
}

/**
 * Pemulihan saat start (CC-063), sebelum HTTP server menerima request: check yang masih `running`
 * berarti prosesnya mati di tengah jalan, jadi ditandai `failed`. Folder `wt-*` yang tersisa dihapus,
 * lalu `git worktree prune` di repo provider terkait membuang metadata worktree yatimnya. Kegagalan
 * membersihkan satu repo (mis. foldernya sudah tidak ada) hanya dicatat; start tidak boleh terhenti.
 */
export async function recoverInterruptedChecks({
  db,
  workspace,
  git,
  logger,
  now = () => new Date(),
}: RecoveryDeps): Promise<{ recovered: number }> {
  const checks = createCheckRepository(db);
  const repos = createRepoRepository(db);

  const interrupted = checks.listRunning();
  for (const check of interrupted) {
    checks.fail(check.id, INTERRUPTED_ERROR, now().toISOString());
  }

  const leftovers = await checksWithLeftoverWorktrees(workspace);
  const touched = new Set([...interrupted.map((check) => check.id), ...leftovers.keys()]);
  for (const [checkId, names] of leftovers) {
    for (const name of names) {
      await workspace.remove(path.join(workspace.layout.checkRunDir(checkId), name));
    }
  }

  // Worktree dibuat di repo provider; prune sesudah foldernya hilang.
  const providers = new Map<number, string>();
  for (const checkId of touched) {
    const check = checks.get(checkId);
    const provider = check && repos.get(check.provider_repo_id);
    if (provider) providers.set(provider.id, provider.local_path);
  }
  for (const [repoId, localPath] of providers) {
    try {
      await git.worktreePrune(localPath);
    } catch (error) {
      logger.warn({ repoId, localPath, err: error }, 'git worktree prune gagal saat pemulihan');
    }
  }

  logger.info(
    { recovered: interrupted.length, worktreeDirs: [...leftovers.values()].flat().length },
    'pemulihan check selesai',
  );
  return { recovered: interrupted.length };
}
