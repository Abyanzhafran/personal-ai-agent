import { APP_NAME, type HealthResponse } from '@cc/shared';
import express, { type Express, type Router } from 'express';
import type { Logger } from '../logger.js';
import { apiNotFound, createErrorHandler } from './errors.js';
import { localOnly } from './local-only.js';
import { requestLogger } from './request-log.js';
import { webRouter } from './web.js';

export interface AppDeps {
  readonly logger: Logger;
  /** Folder hasil build web. Default `packages/web/dist`. */
  readonly webDist?: string;
  /** Batas body JSON. Profil discovery (markdown) jauh di bawah ini. */
  readonly bodyLimit?: string;
  /** Titik sambung rute `/api` milik task berikutnya (projects, repos, checks, ...). */
  readonly registerRoutes?: (api: Router) => void;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(deps.logger));
  app.use(localOnly());

  const api = express.Router();
  api.use(express.json({ limit: deps.bodyLimit ?? '1mb' }));
  api.get('/health', (_req, res) => {
    const body: HealthResponse = { ok: true, app: APP_NAME };
    res.json(body);
  });
  deps.registerRoutes?.(api);
  api.use(apiNotFound);
  app.use('/api', api);

  app.use(webRouter(deps.webDist));
  app.use(createErrorHandler(deps.logger));
  return app;
}
