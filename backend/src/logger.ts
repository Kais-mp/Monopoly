/**
 * Minimal structured logger. Emits single-line JSON in production so Azure
 * App Service / Log Analytics can parse it, and readable text locally.
 */
import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : 'info'];

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  if (config.isProduction) {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })}\n`,
    );
  } else {
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    process.stdout.write(`[${level}] ${message}${extra}\n`);
  }
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};
