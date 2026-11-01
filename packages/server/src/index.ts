import { startApp, type RunningApp } from './bootstrap.js';
import { loadConfigOrExit } from './config.js';
import { createLogger } from './logger.js';

const config = loadConfigOrExit();
const logger = createLogger({
  pretty: process.env['NODE_ENV'] !== 'production' && process.stdout.isTTY === true,
});

let app: RunningApp;
try {
  app = await startApp(config, { logger });
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    logger.fatal(`Port ${config.port} sudah dipakai. Ubah PORT di .env atau hentikan proses lain.`);
  } else {
    logger.fatal({ err }, 'server gagal start');
  }
  process.exit(1);
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'menghentikan server');
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
