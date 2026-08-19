/**
 * HTTP + WebSocket host.
 *
 * One process serves the built client and the Socket.IO game server, which is
 * what makes the default Azure deployment a single App Service with no CORS
 * surface and no second origin to configure.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server as IOServer } from 'socket.io';

import { config } from './config';
import { log } from './logger';
import { registerGateway } from './net/gateway';
import { RoomManager } from './rooms/RoomManager';
import { PRESETS } from './game/settings';
import { PIECES } from './shared/types';

const app = express();
const rooms = new RoomManager();

// Azure App Service terminates TLS at the front end; trust its forwarding
// headers so req.protocol / req.ip are accurate behind the proxy.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // The client fetches nothing cross-origin, but WebGL canvases and blob
    // audio are happier without an opener policy that isolates them.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }),
);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
if (config.corsOrigins.length > 0) {
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
}

/* ------------------------------------------------------------------ */
/* Operational endpoints                                               */
/* ------------------------------------------------------------------ */

/** Azure health check probe target. Must stay cheap and dependency-free. */
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), ...rooms.stats() });
});

app.get('/api/presets', (_req, res) => {
  res.json({ presets: PRESETS });
});

app.get('/api/pieces', (_req, res) => {
  res.json({ pieces: PIECES });
});

/** Cheap existence check so the join screen can validate a code before joining. */
app.get('/api/rooms/:code', (req, res) => {
  const code = String(req.params.code ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ exists: false });
    return;
  }
  const state = room.engine.state;
  res.json({
    exists: true,
    code: room.code,
    phase: state.phase,
    players: state.players.length,
    maxPlayers: state.settings.maxPlayers,
    preset: state.settings.presetName,
  });
});

/* ------------------------------------------------------------------ */
/* Static client                                                       */
/* ------------------------------------------------------------------ */

const hasClient = fs.existsSync(path.join(config.publicDir, 'index.html'));
if (hasClient) {
  // Hashed asset filenames can be cached hard; index.html must not be.
  app.use(
    express.static(config.publicDir, {
      index: false,
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('Aurora Bay server is running. Build the client (npm run build) to serve it from here.');
  });
}

/* ------------------------------------------------------------------ */
/* Server + sockets                                                    */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);

const io = new IOServer(server, {
  cors:
    config.corsOrigins.length > 0
      ? { origin: config.corsOrigins, credentials: false }
      : { origin: true, credentials: false },
  // App Service drops idle connections around 230s; these keep the socket warm
  // and detect real drops quickly enough for the reconnect flow to feel instant.
  pingInterval: 20_000,
  pingTimeout: 25_000,
  maxHttpBufferSize: 1e5,
  transports: ['websocket', 'polling'],
});

registerGateway(io, rooms);

server.listen(config.port, () => {
  log.info('aurora bay listening', {
    port: config.port,
    env: config.nodeEnv,
    client: hasClient ? config.publicDir : 'not built',
  });
});

/* ------------------------------------------------------------------ */
/* Graceful shutdown (App Service sends SIGTERM before recycling)      */
/* ------------------------------------------------------------------ */

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception', { error: err.message, stack: err.stack });
});

export { app, server, io, rooms };
