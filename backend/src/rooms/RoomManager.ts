/**
 * Room lifecycle: creation, membership, reconnection tokens, chat history and
 * the per-room tick that drives auctions and idle-turn timeouts.
 *
 * State is held in process. That is the right call for a single App Service
 * instance with ARR affinity on (see infra/README). Scaling out horizontally
 * would mean moving this map behind Redis and adding the Socket.IO Redis
 * adapter — the interface below is deliberately narrow so that swap is local.
 */
import { GameEngine } from '../game/engine';
import { generateRoomCode, uuid } from '../game/rng';
import type { ChatMessage, PieceId } from '../shared/types';
import { config } from '../config';
import { log } from '../logger';

export interface RoomMember {
  playerId: string;
  token: string;
}

export class Room {
  readonly code: string;
  readonly engine: GameEngine;
  readonly createdAt = Date.now();

  /** reconnection token -> playerId */
  private tokens = new Map<string, string>();
  chat: ChatMessage[] = [];
  lastActivity = Date.now();

  constructor(code: string) {
    this.code = code;
    this.engine = new GameEngine(code);
  }

  issueToken(playerId: string): string {
    const token = uuid();
    this.tokens.set(token, playerId);
    return token;
  }

  playerIdForToken(token: string): string | undefined {
    return this.tokens.get(token);
  }

  revokeTokensFor(playerId: string): void {
    for (const [token, id] of this.tokens) if (id === playerId) this.tokens.delete(token);
  }

  pushChat(message: ChatMessage): void {
    this.chat.push(message);
    if (this.chat.length > config.room.chatHistory) {
      this.chat.splice(0, this.chat.length - config.room.chatHistory);
    }
    this.lastActivity = Date.now();
  }

  systemMessage(text: string): ChatMessage {
    const message: ChatMessage = {
      id: uuid(),
      kind: 'system',
      playerId: null,
      playerName: null,
      color: null,
      text,
      at: Date.now(),
    };
    this.pushChat(message);
    return message;
  }

  get isReapable(): boolean {
    if (this.engine.isEmpty) return true;
    if (!this.engine.allDisconnected) return false;
    return Date.now() - this.lastActivity > config.room.emptyTtlMs;
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  create(): Room | { error: string } {
    if (this.rooms.size >= config.room.maxRooms) {
      return { error: 'The server is at capacity. Please try again shortly.' };
    }
    let code = generateRoomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = generateRoomCode();
    if (this.rooms.has(code)) return { error: 'Could not allocate a room code.' };

    const room = new Room(code);
    this.rooms.set(code, room);
    log.info('room created', { code, rooms: this.rooms.size });
    return room;
  }

  createWithHost(name: string, piece: PieceId): { room: Room; playerId: string; token: string } | { error: string } {
    const created = this.create();
    if ('error' in created) return created;
    const player = created.engine.addPlayer(name, piece);
    if ('error' in player) {
      this.rooms.delete(created.code);
      return { error: player.error };
    }
    created.engine.handleAction(player.id, { type: 'set_ready', ready: true });
    const token = created.issueToken(player.id);
    return { room: created, playerId: player.id, token };
  }

  join(
    code: string,
    name: string,
    piece: PieceId,
    token?: string,
  ): { room: Room; playerId: string; token: string } | { error: string } {
    const room = this.get(code);
    if (!room) return { error: 'No room with that code.' };

    if (token) {
      const existing = room.playerIdForToken(token);
      if (existing && room.engine.player(existing)) {
        room.engine.setConnected(existing, true);
        room.lastActivity = Date.now();
        return { room, playerId: existing, token };
      }
    }

    const player = room.engine.addPlayer(name, piece);
    if ('error' in player) return { error: player.error };
    const issued = room.issueToken(player.id);
    room.lastActivity = Date.now();
    return { room, playerId: player.id, token: issued };
  }

  resume(code: string, token: string): { room: Room; playerId: string } | { error: string } {
    const room = this.get(code);
    if (!room) return { error: 'That game is no longer available.' };
    const playerId = room.playerIdForToken(token);
    if (!playerId || !room.engine.player(playerId)) return { error: 'Your seat is no longer reserved.' };
    room.engine.setConnected(playerId, true);
    room.lastActivity = Date.now();
    return { room, playerId };
  }

  destroy(code: string): void {
    if (this.rooms.delete(code.toUpperCase())) {
      log.info('room destroyed', { code, rooms: this.rooms.size });
    }
  }

  /** Runs every tick: advances timers and reaps abandoned rooms. */
  sweep(onChange: (room: Room) => void): void {
    for (const room of [...this.rooms.values()]) {
      if (room.isReapable) {
        this.destroy(room.code);
        continue;
      }
      if (room.engine.tick()) onChange(room);
    }
  }

  stats(): { rooms: number; players: number; playing: number } {
    let players = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      players += room.engine.players.length;
      if (room.engine.state.phase === 'playing') playing += 1;
    }
    return { rooms: this.rooms.size, players, playing };
  }
}
