/**
 * Socket.IO gateway.
 *
 * Responsibilities: authenticate a socket to a seat, forward validated intents
 * to the engine, and broadcast the resulting state + effects to the room.
 * It contains no game rules of its own.
 */
import type { Server as IOServer, Socket } from 'socket.io';
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH } from '../shared/protocol';
import type {
  ClientAction,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../shared/protocol';
import type { ChatMessage, PieceId } from '../shared/types';
import { PIECE_IDS } from '../shared/types';
import { GameEngine } from '../game/engine';
import { uuid } from '../game/rng';
import type { Room, RoomManager } from '../rooms/RoomManager';
import { config } from '../config';
import { log } from '../logger';

interface SocketData {
  roomCode?: string;
  playerId?: string;
  tokens: number;
  lastRefill: number;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function sanitizeName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Player';
}

function sanitizePiece(raw: unknown, taken: PieceId[]): PieceId {
  if (typeof raw === 'string' && (PIECE_IDS as string[]).includes(raw) && !taken.includes(raw as PieceId)) {
    return raw as PieceId;
  }
  return GameEngine.randomPiece(taken);
}

function sanitizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) : '';
}

export function registerGateway(io: IOServer, rooms: RoomManager): void {
  /** Push the current state (and any pending effects) to everyone in a room. */
  function broadcast(room: Room): void {
    const fx = room.engine.drainFx();
    const messages = room.engine.drainMessages();
    for (const text of messages) {
      const message = room.systemMessage(text);
      io.to(room.code).emit('room:chat', message);
    }
    io.to(room.code).emit('room:state', { state: room.engine.snapshot(), fx });
    room.lastActivity = Date.now();
  }

  function sendPersonalSync(socket: GameSocket, room: Room, playerId: string, token: string): void {
    socket.emit('room:you', { playerId, token, roomCode: room.code });
    socket.emit('room:chatlog', { messages: room.chat });
    socket.emit('room:state', { state: room.engine.snapshot(), fx: [] });
  }

  function allowed(socket: GameSocket): boolean {
    const now = Date.now();
    const data = socket.data;
    const elapsed = (now - data.lastRefill) / 1000;
    data.lastRefill = now;
    data.tokens = Math.min(config.rateLimit.burst, data.tokens + elapsed * config.rateLimit.actionsPerSecond);
    if (data.tokens < 1) return false;
    data.tokens -= 1;
    return true;
  }

  io.on('connection', (raw: Socket) => {
    const socket = raw as GameSocket;
    socket.data.tokens = config.rateLimit.burst;
    socket.data.lastRefill = Date.now();

    socket.on('ping2', (payload) => {
      socket.emit('pong2', { t: payload?.t ?? Date.now() });
    });

    socket.on('room:create', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!allowed(socket)) return ack({ ok: false, error: 'Slow down a moment.' });

      const name = sanitizeName(payload?.name);
      const created = rooms.createWithHost(name, sanitizePiece(payload?.piece, []));
      if ('error' in created) return ack({ ok: false, error: created.error });

      const { room, playerId, token } = created;
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      void socket.join(room.code);

      log.info('room hosted', { code: room.code, playerId });
      sendPersonalSync(socket, room, playerId, token);
      broadcast(room);
      ack({ ok: true, roomCode: room.code, playerId, token });
    });

    socket.on('room:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!allowed(socket)) return ack({ ok: false, error: 'Slow down a moment.' });

      const code = sanitizeCode(payload?.roomCode);
      if (!code) return ack({ ok: false, error: 'Enter a room code.' });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: 'No room with that code.' });

      const name = sanitizeName(payload?.name);
      const piece = sanitizePiece(payload?.piece, room.engine.takenPieces());
      const joined = rooms.join(code, name, piece, payload?.token);
      if ('error' in joined) return ack({ ok: false, error: joined.error });

      socket.data.roomCode = joined.room.code;
      socket.data.playerId = joined.playerId;
      void socket.join(joined.room.code);

      sendPersonalSync(socket, joined.room, joined.playerId, joined.token);
      broadcast(joined.room);
      ack({ ok: true, roomCode: joined.room.code, playerId: joined.playerId, token: joined.token });
    });

    socket.on('room:resume', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!allowed(socket)) return ack({ ok: false, error: 'Slow down a moment.' });

      const code = sanitizeCode(payload?.roomCode);
      const token = typeof payload?.token === 'string' ? payload.token : '';
      if (!code || !token) return ack({ ok: false, error: 'Nothing to resume.' });

      const resumed = rooms.resume(code, token);
      if ('error' in resumed) return ack({ ok: false, error: resumed.error });

      socket.data.roomCode = resumed.room.code;
      socket.data.playerId = resumed.playerId;
      void socket.join(resumed.room.code);

      log.info('player resumed', { code, playerId: resumed.playerId });
      sendPersonalSync(socket, resumed.room, resumed.playerId, token);
      broadcast(resumed.room);
      ack({ ok: true, roomCode: resumed.room.code, playerId: resumed.playerId, token });
    });

    socket.on('room:leave', (_payload, ack) => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      const playerId = socket.data.playerId;
      if (room && playerId) {
        if (room.engine.state.phase === 'lobby') {
          room.revokeTokensFor(playerId);
          room.engine.removePlayer(playerId);
        } else {
          room.engine.setConnected(playerId, false);
        }
        void socket.leave(room.code);
        broadcast(room);
      }
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('action', (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => undefined;
      if (!allowed(socket)) return respond({ ok: false, error: 'Slow down a moment.' });

      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      const playerId = socket.data.playerId;
      if (!room || !playerId) return respond({ ok: false, error: 'You are not in a game.' });
      if (!payload || typeof payload.type !== 'string') return respond({ ok: false, error: 'Bad action.' });

      if (payload.type === 'chat') {
        const player = room.engine.player(playerId);
        if (!player) return respond({ ok: false, error: 'You are not in this game.' });
        const text = String((payload as { text?: unknown }).text ?? '')
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, MAX_CHAT_LENGTH);
        if (!text) return respond({ ok: false, error: 'Say something first.' });
        const message: ChatMessage = {
          id: uuid(),
          kind: 'chat',
          playerId: player.id,
          playerName: player.name,
          color: player.color,
          text,
          at: Date.now(),
        };
        room.pushChat(message);
        io.to(room.code).emit('room:chat', message);
        return respond({ ok: true });
      }

      const result = room.engine.handleAction(playerId, payload as ClientAction);
      if (result.ok) broadcast(room);
      respond(result);
    });

    socket.on('disconnect', (reason) => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      const playerId = socket.data.playerId;
      if (!room || !playerId) return;

      // In the lobby a disconnect is a departure; mid-game it is a dropout the
      // player can come back from with their token.
      if (room.engine.state.phase === 'lobby') {
        room.revokeTokensFor(playerId);
        room.engine.removePlayer(playerId);
      } else {
        room.engine.setConnected(playerId, false);
      }
      broadcast(room);
      log.debug('socket disconnected', { code: room.code, playerId, reason });
    });
  });

  // Timers: auctions ending, idle turns being auto-played, rooms being reaped.
  const timer = setInterval(() => {
    rooms.sweep((room) => broadcast(room));
  }, config.room.tickMs);
  timer.unref?.();
}
