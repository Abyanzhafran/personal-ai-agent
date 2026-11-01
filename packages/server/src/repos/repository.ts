import type { Repo, Role } from '@cc/shared';
import type { Db } from '../db/database.js';

const COLUMNS =
  'id, project_id, role, name, local_path, default_branch, spec_path, spec_cmd, profile_status, profile_error, last_fetch_at';

export interface NewRepo {
  projectId: number;
  role: Role;
  name: string;
  localPath: string;
  defaultBranch: string;
}

export interface RepoChanges {
  role: Role;
  defaultBranch: string;
  specPath: string | null;
  specCmd: string | null;
}

export type CreateRepoResult =
  { readonly repo: Repo } | { readonly conflict: 'local_path' | 'name' };

export function createRepoRepository(db: Db) {
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM repos WHERE id = ?`);
  const pathTaken = db.prepare('SELECT 1 FROM repos WHERE project_id = ? AND local_path = ?');
  // Nama menjadi nama file profil, dan Windows/macOS tidak membedakan huruf besar-kecil nama file.
  const nameTaken = db.prepare(
    'SELECT 1 FROM repos WHERE project_id = ? AND name = ? COLLATE NOCASE',
  );
  const insert = db.prepare(
    `INSERT INTO repos (project_id, role, name, local_path, default_branch)
     VALUES (@projectId, @role, @name, @localPath, @defaultBranch)`,
  );
  const update = db.prepare(
    `UPDATE repos SET role = @role, default_branch = @defaultBranch, spec_path = @specPath,
       spec_cmd = @specCmd WHERE id = @id`,
  );
  const remove = db.prepare('DELETE FROM repos WHERE id = ?');
  const selectProviderCheckIds = db.prepare('SELECT id FROM checks WHERE provider_repo_id = ?');

  function get(id: number): Repo | undefined {
    return selectOne.get(id) as Repo | undefined;
  }

  return {
    get,

    /**
     * Pemeriksaan bentrok dan INSERT berjalan sinkron tanpa `await` di antaranya, jadi tidak ada
     * request lain yang bisa menyela. Path diperiksa dulu: itu yang paling berguna bagi user.
     */
    create(input: NewRepo): CreateRepoResult {
      if (pathTaken.get(input.projectId, input.localPath)) return { conflict: 'local_path' };
      if (nameTaken.get(input.projectId, input.name)) return { conflict: 'name' };
      const { lastInsertRowid } = insert.run(input);
      return { repo: get(Number(lastInsertRowid)) as Repo };
    },

    /** `name` dan `local_path` sengaja tidak ikut: nama file profil dan kunci unik tidak berubah. */
    update(id: number, input: RepoChanges): Repo | undefined {
      update.run({ id, ...input });
      return get(id);
    },

    /** Id check yang repo ini jadi provider-nya, untuk menghapus `runs/checks/<id>/`. */
    providerCheckIds: (repoId: number): number[] =>
      (selectProviderCheckIds.all(repoId) as { id: number }[]).map((row) => row.id),

    /** Check provider dan finding konsumen repo ini ikut terhapus lewat ON DELETE CASCADE. */
    delete: (id: number): void => {
      remove.run(id);
    },
  };
}

export type RepoRepository = ReturnType<typeof createRepoRepository>;
