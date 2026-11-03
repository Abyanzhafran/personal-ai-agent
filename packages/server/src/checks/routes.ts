import { CheckIdParams, CreateCheckRequest, ERROR_CODES, type CheckEvent } from '@cc/shared';
import type { Router } from 'express';
import type { Db } from '../db/database.js';
import { OasdiffUnavailableError } from '../diff/oasdiff.js';
import { HttpError } from '../http/errors.js';
import { validated } from '../http/validate.js';
import { CheckAlreadyRunningError, type CheckRunner } from '../runner/check.js';
import { createRepoRepository } from '../repos/repository.js';
import { createCheckRepository } from './repository.js';

/** Selang komentar `: keepalive` agar proxy tidak memutus koneksi SSE yang sepi. */
const HEARTBEAT_MS = 15_000;

export interface CheckRouteDeps {
  readonly db: Db;
  readonly checks: Pick<CheckRunner, 'start' | 'events'>;
  readonly heartbeatMs?: number;
}

/** Rute check (CC-060). Dipasang lewat `registerRoutes` di bootstrap. */
export function checkRoutes({
  db,
  checks,
  heartbeatMs = HEARTBEAT_MS,
}: CheckRouteDeps): (api: Router) => void {
  const repos = createRepoRepository(db);
  const checkRows = createCheckRepository(db);

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

    // SSE (CC-061). Kontrak event dan aturan sambung ulang: packages/shared/src/events.ts.
    api.get(
      '/checks/:id/events',
      validated({ params: CheckIdParams }, ({ params }, req, res) => {
        const check = checkRows.get(params.id);
        if (!check) throw new HttpError(404, ERROR_CODES.check_not_found, 'Check tidak ditemukan');

        const frame = (event: CheckEvent) =>
          `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
        const open = () => {
          res.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.flushHeaders();
        };

        let heartbeat: NodeJS.Timeout | undefined;
        const subscription = checks.events.subscribe(check.id, (event) => {
          res.write(frame(event));
          if (event.type === 'done') {
            clearInterval(heartbeat);
            res.end();
          }
        });

        if (!subscription) {
          // Buffer hilang (check lama atau server pernah mati): yang tersisa hanya status akhir di DB.
          if (check.status === 'running') {
            throw new HttpError(
              404,
              ERROR_CODES.check_not_found,
              'Event check ini tidak tersedia lagi (server pernah berhenti saat check berjalan)',
            );
          }
          open();
          res.end(frame({ type: 'done', seq: 1, status: check.status }));
          return;
        }

        open();
        for (const event of subscription.replay) res.write(frame(event));
        if (subscription.finished) {
          res.end();
          return;
        }
        heartbeat = setInterval(() => res.write(': keepalive\n\n'), heartbeatMs);
        req.on('close', () => {
          clearInterval(heartbeat);
          subscription.unsubscribe();
        });
      }),
    );
  };
}
