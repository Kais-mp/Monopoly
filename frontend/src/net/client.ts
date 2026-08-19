/**
 * Socket.IO wrapper.
 *
 * The client is a thin transport: it sends intents and receives authoritative
 * state. It deliberately owns no game logic — every rule lives on the server.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ActionResult,
  ClientAction,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@shared/protocol';
import type { ChatMessage, GameFx, GameState, PieceId } from '@shared/types';
import { SERVER_URL, apiUrl } from './endpoint';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface JoinAck {
  ok: boolean;
  error?: string;
  roomCode?: string;
  playerId?: string;
  token?: string;
}

type Handlers = {
  state: (payload: { state: GameState; fx: GameFx[] }) => void;
  chat: (message: ChatMessage) => void;
  chatlog: (messages: ChatMessage[]) => void;
  you: (payload: { playerId: string; token: string; roomCode: string }) => void;
  closed: (reason: string) => void;
  error: (message: string) => void;
  status: (status: ConnectionStatus, latency: number) => void;
};

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

class GameClient {
  private socket: Sock | null = null;
  private handlers: Partial<Handlers> = {};
  private pingTimer: number | null = null;
  private _latency = 0;
  private _status: ConnectionStatus = 'idle';
  /** Set once we hold a seat, so a dropped socket can silently re-seat itself. */
  private seat: { roomCode: string; token: string } | null = null;

  get latency(): number {
    return this._latency;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  on<K extends keyof Handlers>(event: K, fn: Handlers[K]): void {
    this.handlers[event] = fn;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.handlers.status?.(status, this._latency);
  }

  connect(): Sock {
    if (this.socket) return this.socket;
    this.setStatus('connecting');
    // Same-origin by default (the Vite dev server proxies /socket.io to :8080).
    // A VITE_SERVER_URL build talks to a separately hosted game server.
    const options = {
      transports: ['websocket', 'polling'] as const,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5000,
      timeout: 12000,
      autoConnect: true,
      withCredentials: false,
    };
    const socket: Sock = SERVER_URL
      ? io(SERVER_URL, { ...options, transports: [...options.transports] })
      : io({ ...options, transports: [...options.transports] });
    this.socket = socket;

    socket.on('connect', () => {
      this.setStatus('connected');
      this.startPing();
      // A reconnect after a drop must re-bind this socket to our existing seat.
      if (this.seat) {
        socket.emit('room:resume', { roomCode: this.seat.roomCode, token: this.seat.token }, (res) => {
          if (!res.ok) {
            this.seat = null;
            this.handlers.closed?.(res.error ?? 'This game is no longer available.');
          }
        });
      }
    });

    socket.on('disconnect', (reason) => {
      this.stopPing();
      if (reason === 'io client disconnect') this.setStatus('closed');
      else this.setStatus('reconnecting');
    });

    socket.io.on('reconnect_attempt', () => this.setStatus('reconnecting'));

    socket.on('room:state', (payload) => this.handlers.state?.(payload));
    socket.on('room:chat', (message) => this.handlers.chat?.(message));
    socket.on('room:chatlog', (payload) => this.handlers.chatlog?.(payload.messages));
    socket.on('room:you', (payload) => {
      this.seat = { roomCode: payload.roomCode, token: payload.token };
      this.handlers.you?.(payload);
    });
    socket.on('room:closed', (payload) => {
      this.seat = null;
      this.handlers.closed?.(payload.reason);
    });
    socket.on('room:error', (payload) => this.handlers.error?.(payload.message));
    socket.on('pong2', (payload) => {
      this._latency = Math.max(0, Date.now() - payload.t);
    });

    return socket;
  }

  private startPing(): void {
    this.stopPing();
    const beat = () => {
      this.socket?.emit('ping2', { t: Date.now() });
    };
    beat();
    this.pingTimer = window.setInterval(beat, 5000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Room lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  private waitForConnection(timeoutMs = 12000): Promise<boolean> {
    const socket = this.connect();
    if (socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        socket.off('connect', ok);
        resolve(false);
      }, timeoutMs);
      const ok = () => {
        clearTimeout(timer);
        resolve(true);
      };
      socket.once('connect', ok);
    });
  }

  private emitWithAck<T>(
    event: 'room:create' | 'room:join' | 'room:resume',
    payload: unknown,
  ): Promise<T | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket) {
        resolve({ ok: false, error: 'Not connected.' });
        return;
      }
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'The server did not respond. Try again.' });
      }, 12000);
      // The three room events share an identical ack shape.
      (socket.emit as unknown as (e: string, p: unknown, ack: (res: T) => void) => void)(event, payload, (res: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  async createRoom(name: string, piece: PieceId): Promise<JoinAck> {
    if (!(await this.waitForConnection())) return { ok: false, error: 'Could not reach the server.' };
    const res = await this.emitWithAck<JoinAck>('room:create', { name, piece });
    if (res.ok && res.roomCode && res.token) this.seat = { roomCode: res.roomCode, token: res.token };
    return res as JoinAck;
  }

  async joinRoom(roomCode: string, name: string, piece: PieceId, token?: string): Promise<JoinAck> {
    if (!(await this.waitForConnection())) return { ok: false, error: 'Could not reach the server.' };
    const res = await this.emitWithAck<JoinAck>('room:join', { roomCode, name, piece, token });
    if (res.ok && res.roomCode && res.token) this.seat = { roomCode: res.roomCode, token: res.token };
    return res as JoinAck;
  }

  async resume(roomCode: string, token: string): Promise<JoinAck> {
    if (!(await this.waitForConnection())) return { ok: false, error: 'Could not reach the server.' };
    const res = await this.emitWithAck<JoinAck>('room:resume', { roomCode, token });
    if (res.ok && res.roomCode) this.seat = { roomCode: res.roomCode, token };
    return res as JoinAck;
  }

  leave(): void {
    this.seat = null;
    this.socket?.emit('room:leave', {}, () => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  send(action: ClientAction): Promise<ActionResult> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket?.connected) {
        resolve({ ok: false, error: 'Reconnecting…' });
        return;
      }
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'No response from the server.' });
      }, 10000);
      socket.emit('action', action, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      });
    });
  }
}

export const client = new GameClient();

/** Room existence probe used by the join screen before we commit to joining. */
export async function probeRoom(code: string): Promise<{
  exists: boolean;
  phase?: string;
  players?: number;
  maxPlayers?: number;
  preset?: string;
}> {
  try {
    const res = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(code)}`), {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { exists: false };
    return (await res.json()) as { exists: boolean };
  } catch {
    return { exists: false };
  }
}
