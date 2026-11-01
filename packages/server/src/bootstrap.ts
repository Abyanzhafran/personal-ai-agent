import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from './config.js';
import { openDatabase, type Db } from './db/database.js';
import { migrate } from './db/migrate.js';
import { createApp, type AppDeps } from './http/app.js';
import type { Logger } from './logger.js';
import { createCommandRunner, type CommandRunner } from './proc/run-command.js';
import { projectRoutes } from './projects/routes.js';
import { WorkspaceLayout } from './workspace/layout.js';
import { WorkspaceStore } from './workspace/store.js';

/** Semua yang dibutuhkan modul lain; bertambah seiring task (DAO, registry check, dst.). */
export interface AppContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly db: Db;
  readonly workspace: WorkspaceStore;
  readonly runner: CommandRunner;
}

export interface RunningApp {
  readonly context: AppContext;
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  readonly logger: Logger;
  readonly webDist?: AppDeps['webDist'];
}

/**
 * Menyiapkan workspace dan database, lalu mulai mendengarkan di `config.host:config.port`.
 * Urutan penting: pemulihan setelah server mati (CC-063) harus berjalan di antara migrasi dan `listen`,
 * karena aturannya "sebelum HTTP server menerima request".
 */
export async function startApp(config: Config, options: StartOptions): Promise<RunningApp> {
  const { logger } = options;

  const layout = new WorkspaceLayout(config.workspaceDir);
  const workspace = new WorkspaceStore(layout);
  await workspace.ensure();

  const db = openDatabase(layout.dbFile);
  const { from, to } = migrate(db);
  logger.info({ workspace: layout.root, schemaFrom: from, schemaTo: to }, 'workspace siap');

  const runner = createCommandRunner({
    oasdiffBin: config.oasdiffBin,
    shellRoot: layout.checksDir,
  });
  const context: AppContext = { config, logger, db, workspace, runner };

  const app = createApp({
    logger,
    ...(options.webDist === undefined ? {} : { webDist: options.webDist }),
    registerRoutes: projectRoutes(context),
  });

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      // Express 5 meneruskan galat listen (mis. EADDRINUSE) ke callback ini.
      const listening = app.listen(config.port, config.host, (err?: Error) =>
        err ? reject(err) : resolve(listening),
      );
    });
  } catch (err) {
    // Jangan menggantung handle database (dan file WAL-nya) ketika start gagal.
    db.close();
    throw err;
  }
  const port = (server.address() as AddressInfo).port;
  logger.info({ host: config.host, port }, 'server mendengarkan');

  return {
    context,
    server,
    port,
    async close() {
      runner.killAll();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
