import {
  CreateProjectRequest,
  ERROR_CODES,
  ProjectIdParams,
  UpdateProjectRequest,
  type ProjectDetail,
  type ValidationDetails,
} from '@cc/shared';
import type { Router } from 'express';
import type { Db } from '../db/database.js';
import { HttpError } from '../http/errors.js';
import { validated } from '../http/validate.js';
import type { CheckRunner } from '../runner/check.js';
import type { WorkspaceStore } from '../workspace/store.js';
import { projectReadiness } from './readiness.js';
import { createProjectRepository } from './repository.js';
import { slugify } from './slug.js';

export interface ProjectRouteDeps {
  readonly db: Db;
  readonly workspace: WorkspaceStore;
  /** Menolak DELETE selagi project punya check berjalan (G-7). */
  readonly checks: { readonly registry: Pick<CheckRunner['registry'], 'forProject'> };
}

const projectNotFound = () =>
  new HttpError(404, ERROR_CODES.project_not_found, 'Project tidak ditemukan');

/** Rute `/api/projects` (CC-012). Dipasang lewat `registerRoutes` di bootstrap. */
export function projectRoutes({ db, workspace, checks }: ProjectRouteDeps): (api: Router) => void {
  const projects = createProjectRepository(db);

  return (api) => {
    api.get('/projects', (_req, res) => {
      res.json(projects.list());
    });

    api.post(
      '/projects',
      validated({ body: CreateProjectRequest }, ({ body }, _req, res) => {
        const slug = slugify(body.name);
        if (slug === '') {
          const details: ValidationDetails = {
            fields: [
              { in: 'body', path: 'name', message: 'Nama project harus memuat huruf atau angka' },
            ],
          };
          throw new HttpError(
            400,
            ERROR_CODES.validation_failed,
            'Permintaan tidak valid',
            details,
          );
        }
        const project = projects.create({
          name: body.name,
          slug,
          description: body.description ?? null,
        });
        if (!project) {
          const message = `Sudah ada project dengan nama serupa (folder "${slug}"). Pakai nama lain.`;
          const fields: ValidationDetails['fields'] = [{ in: 'body', path: 'name', message }];
          throw new HttpError(409, ERROR_CODES.project_slug_taken, message, { slug, fields });
        }
        res.status(201).json(project);
      }),
    );

    api.get(
      '/projects/:id',
      validated({ params: ProjectIdParams }, ({ params }, _req, res) => {
        const project = projects.get(params.id);
        if (!project) throw projectNotFound();
        const detail: ProjectDetail = {
          ...project,
          ...projectReadiness(projects.repoRoles(project.id)),
        };
        res.json(detail);
      }),
    );

    api.patch(
      '/projects/:id',
      validated(
        { params: ProjectIdParams, body: UpdateProjectRequest },
        ({ params, body }, _req, res) => {
          const current = projects.get(params.id);
          if (!current) throw projectNotFound();
          const updated = projects.update(current.id, {
            name: body.name ?? current.name,
            description: body.description === undefined ? current.description : body.description,
          });
          res.json(updated);
        },
      ),
    );

    api.delete(
      '/projects/:id',
      validated({ params: ProjectIdParams }, async ({ params }, _req, res) => {
        const project = projects.get(params.id);
        if (!project) throw projectNotFound();
        if (checks.registry.forProject(project.id)) {
          throw new HttpError(
            409,
            ERROR_CODES.check_in_progress,
            'Project ini sedang menjalankan check. Tunggu sampai selesai sebelum menghapusnya.',
          );
        }
        // Berkas dulu, baris DB sesudahnya: bila berkas gagal dihapus, project masih ada dan DELETE yang
        // sama bisa diulang sampai tuntas. Kebalikannya meninggalkan folder yatim yang tak terjangkau API.
        await workspace.removeProjectData({
          slug: project.slug,
          checkIds: projects.checkIds(project.id),
        });
        projects.delete(project.id);
        res.status(204).end();
      }),
    );
  };
}
