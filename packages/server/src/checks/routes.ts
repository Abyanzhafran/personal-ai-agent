import { CreateCheckRequest, ERROR_CODES } from '@cc/shared';
import type { Router } from 'express';
import type { Db } from '../db/database.js';
import { OasdiffUnavailableError } from '../diff/oasdiff.js';
import { HttpError } from '../http/errors.js';
import { validated } from '../http/validate.js';
import { CheckAlreadyRunningError, type CheckRunner } from '../runner/check.js';
import { createRepoRepository } from '../repos/repository.js';

export interface CheckRouteDeps {
  readonly db: Db;
  readonly checks: Pick<CheckRunner, 'start'>;
}

/** Rute check (CC-060). Dipasang lewat `registerRoutes` di bootstrap. */
export function checkRoutes({ db, checks }: CheckRouteDeps): (api: Router) => void {
  const repos = createRepoRepository(db);

  return (api) => {
    // 202: pipeline jalan di latar belakang; hasilnya dipantau lewat baris check (CC-061/064).
    api.post(
      '/checks',
      validated({ body: CreateCheckRequest }, async ({ body }, _req, res) => {
        const provider = repos.get(body.provider_repo_id);
        if (!provider) {
          throw new HttpError(404, ERROR_CODES.repo_not_found, 'Repo provider tidak ditemukan');
        }
        try {
          const check = await checks.start({
            provider,
            baseRef: body.base_ref ?? provider.default_branch,
            headRef: body.head_ref,
          });
          res.status(202).json(check);
        } catch (error) {
          if (error instanceof CheckAlreadyRunningError) {
            throw new HttpError(
              409,
              ERROR_CODES.check_already_running,
              'Project ini sudah punya check yang sedang berjalan. Tunggu sampai selesai.',
              { project_id: error.projectId, check_id: error.checkId },
            );
          }
          if (error instanceof OasdiffUnavailableError) {
            throw new HttpError(503, ERROR_CODES.oasdiff_unavailable, error.message);
          }
          throw error;
        }
      }),
    );
  };
}
