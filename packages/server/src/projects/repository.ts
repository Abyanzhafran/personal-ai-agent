import type { Project, Role } from '@cc/shared';
import type { Db } from '../db/database.js';

const COLUMNS = 'id, name, slug, description';

export function createProjectRepository(db: Db) {
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM projects ORDER BY name COLLATE NOCASE, id`);
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`);
  const insert = db.prepare(
    'INSERT INTO projects (name, slug, description) VALUES (@name, @slug, @description)',
  );
  const update = db.prepare(
    'UPDATE projects SET name = @name, description = @description WHERE id = @id',
  );
  const remove = db.prepare('DELETE FROM projects WHERE id = ?');
  const selectCheckIds = db.prepare('SELECT id FROM checks WHERE project_id = ?');
  const selectRepoRoles = db.prepare('SELECT role FROM repos WHERE project_id = ?');

  function get(id: number): Project | undefined {
    return selectOne.get(id) as Project | undefined;
  }

  return {
    list: (): Project[] => selectAll.all() as Project[],

    get,

    /** Undefined bila slug sudah dipakai project lain (satu-satunya kolom UNIQUE di tabel ini). */
    create(input: { name: string; slug: string; description: string | null }): Project | undefined {
      try {
        const { lastInsertRowid } = insert.run(input);
        return get(Number(lastInsertRowid));
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return undefined;
        throw error;
      }
    },

    /** Slug sengaja tidak ikut diubah: ia nama folder di disk. */
    update(id: number, input: { name: string; description: string | null }): Project | undefined {
      update.run({ id, ...input });
      return get(id);
    },

    /** Peran tiap repo project, untuk aturan siap check. */
    repoRoles: (projectId: number): Role[] =>
      (selectRepoRoles.all(projectId) as { role: Role }[]).map((row) => row.role),

    /** Id semua check milik project, untuk menghapus `runs/checks/<id>/`. */
    checkIds: (projectId: number): number[] =>
      (selectCheckIds.all(projectId) as { id: number }[]).map((row) => row.id),

    /** Repos, checks, dan findings ikut terhapus lewat ON DELETE CASCADE. */
    delete: (id: number): void => {
      remove.run(id);
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
