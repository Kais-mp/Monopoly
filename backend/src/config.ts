/**
 * Runtime configuration. Everything comes from the environment so the same
 * build runs locally and in Azure App Service without code changes.
 */
import path from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  /** App Service injects PORT; 8080 is its Linux default. */
  port: int('PORT', 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',

  /**
   * Extra origins allowed to talk to the socket server. In the default
   * single-App-Service deployment the client is served from the same origin
   * and this can stay empty.
   */
  corsOrigins: list('CORS_ORIGINS'),

  /** Directory of the built client. Served statically when present. */
  publicDir: process.env.PUBLIC_DIR
    ? path.resolve(process.env.PUBLIC_DIR)
    : path.resolve(__dirname, '..', 'public'),

  room: {
    /** Rooms with nobody connected are reaped after this long. */
    emptyTtlMs: int('ROOM_EMPTY_TTL_MINUTES', 30) * 60_000,
    /** Absolute cap so a single instance cannot be exhausted. */
    maxRooms: int('MAX_ROOMS', 500),
    tickMs: int('ROOM_TICK_MS', 1000),
    chatHistory: int('CHAT_HISTORY', 80),
  },

  /** Simple per-socket flood control. */
  rateLimit: {
    actionsPerSecond: int('RATE_ACTIONS_PER_SECOND', 12),
    burst: int('RATE_BURST', 30),
  },

  logLevel: process.env.LOG_LEVEL ?? 'info',
} as const;
