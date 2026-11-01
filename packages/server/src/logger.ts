import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  readonly level?: string;
  /** Cetak berwarna untuk terminal. Default mati: keluaran JSON, satu format dengan event SSE. */
  readonly pretty?: boolean;
  /** Untuk test: tangkap keluaran. Tidak kompatibel dengan `pretty`. */
  readonly destination?: DestinationStream;
}

/** Nilai rahasia tidak boleh sampai ke log walau ada yang tidak sengaja mencatat config. */
const REDACT = ['*.anthropicApiKey', 'anthropicApiKey', '*.ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'];

export function createLogger(options: LoggerOptions = {}): Logger {
  const base = { level: options.level ?? 'info', redact: REDACT };
  if (options.destination) return pino(base, options.destination);
  if (options.pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(base);
}
