/**
 * Client-side view model.
 *
 * The store never invents state. It holds the last authoritative snapshot, the
 * chat log, and a few purely local flags (which drawer is open, what is
 * selected). Presentation effects are forwarded to subscribers — the 3D world
 * consumes them as an animation queue.
 */
import type {
  BoardSpace,
  ChatMessage,
  GameFx,
  GameState,
  Player,
  PropertyGroup,
  PropertyState,
} from '@shared/types';
import type { ConnectionStatus } from './net/client';

export type Screen = 'boot' | 'menu' | 'create' | 'join' | 'lobby' | 'game' | 'finished';
export type Drawer = null | 'chat' | 'trade' | 'holdings' | 'settings' | 'rules';

type Listener = () => void;

class Store {
  state: GameState | null = null;
  youId: string | null = null;
  roomCode: string | null = null;
  chat: ChatMessage[] = [];
  screen: Screen = 'boot';
  drawer: Drawer = null;
  /** Board space the player has clicked/tapped for a closer look. */
  inspectSpace: number | null = null;
  inspectPlayer: string | null = null;
  connection: ConnectionStatus = 'idle';
  latency = 0;
  unreadChat = 0;
  /** Local error surfaced by the last rejected action. */
  lastError: string | null = null;

  private listeners = new Set<Listener>();
  private fxListeners = new Set<(fx: GameFx[]) => void>();
  private chatListeners = new Set<(m: ChatMessage) => void>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onFx(fn: (fx: GameFx[]) => void): () => void {
    this.fxListeners.add(fn);
    return () => this.fxListeners.delete(fn);
  }

  onChat(fn: (m: ChatMessage) => void): () => void {
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  /** Coalesced notify — many small updates in one frame render once. */
  private dirty = false;
  emit(): void {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      for (const fn of this.listeners) fn();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Ingest                                                            */
  /* ---------------------------------------------------------------- */

  applyState(payload: { state: GameState; fx: GameFx[] }): void {
    const incoming = payload.state;
    // Stale snapshots can arrive out of order after a reconnect burst.
    if (this.state && incoming.version < this.state.version && incoming.roomCode === this.state.roomCode) return;
    const previousPhase = this.state?.phase;
    this.state = incoming;
    this.roomCode = incoming.roomCode;

    if (incoming.phase === 'lobby') this.screen = 'lobby';
    else if (incoming.phase === 'playing') this.screen = 'game';
    else if (incoming.phase === 'finished') this.screen = 'finished';

    if (previousPhase !== incoming.phase) {
      this.drawer = null;
      this.inspectSpace = null;
    }

    if (payload.fx.length > 0) {
      for (const fn of this.fxListeners) fn(payload.fx);
    }
    this.emit();
  }

  pushChat(message: ChatMessage): void {
    this.chat.push(message);
    if (this.chat.length > 200) this.chat.splice(0, this.chat.length - 200);
    if (this.drawer !== 'chat') this.unreadChat++;
    for (const fn of this.chatListeners) fn(message);
    this.emit();
  }

  setChatLog(messages: ChatMessage[]): void {
    this.chat = messages.slice(-200);
    this.emit();
  }

  setScreen(screen: Screen): void {
    if (this.screen === screen) return;
    this.screen = screen;
    this.emit();
  }

  setDrawer(drawer: Drawer): void {
    this.drawer = this.drawer === drawer ? null : drawer;
    if (this.drawer === 'chat') this.unreadChat = 0;
    this.emit();
  }

  setInspect(spaceId: number | null): void {
    this.inspectSpace = spaceId;
    this.inspectPlayer = null;
    this.emit();
  }

  setInspectPlayer(playerId: string | null): void {
    this.inspectPlayer = playerId;
    this.inspectSpace = null;
    this.emit();
  }

  reset(): void {
    this.state = null;
    this.youId = null;
    this.roomCode = null;
    this.chat = [];
    this.drawer = null;
    this.inspectSpace = null;
    this.inspectPlayer = null;
    this.unreadChat = 0;
    this.screen = 'menu';
    this.emit();
  }

  /* ---------------------------------------------------------------- */
  /* Selectors                                                         */
  /* ---------------------------------------------------------------- */

  me(): Player | null {
    if (!this.state || !this.youId) return null;
    return this.state.players.find((p) => p.id === this.youId) ?? null;
  }

  player(id: string | null | undefined): Player | null {
    if (!this.state || !id) return null;
    return this.state.players.find((p) => p.id === id) ?? null;
  }

  playerName(id: string | null | undefined): string {
    return this.player(id)?.name ?? 'The bank';
  }

  playerColor(id: string | null | undefined): string {
    return this.player(id)?.color ?? '#93a7c4';
  }

  isHost(): boolean {
    return !!this.state && this.state.hostId === this.youId;
  }

  isMyTurn(): boolean {
    return !!this.state && this.state.turn.playerId === this.youId;
  }

  activePlayer(): Player | null {
    return this.player(this.state?.turn.playerId);
  }

  space(id: number): BoardSpace | null {
    return this.state?.board[id] ?? null;
  }

  property(id: number): PropertyState | null {
    return this.state?.properties[id] ?? null;
  }

  group(id: string | undefined): PropertyGroup | null {
    if (!id || !this.state) return null;
    return this.state.groups.find((g) => g.id === id) ?? null;
  }

  groupColor(id: string | undefined): string {
    return this.group(id)?.color ?? '#5a7290';
  }

  /** Every ownable space held by a player, in board order. */
  holdings(playerId: string | null | undefined): { space: BoardSpace; prop: PropertyState }[] {
    if (!this.state || !playerId) return [];
    const out: { space: BoardSpace; prop: PropertyState }[] = [];
    for (const space of this.state.board) {
      const prop = this.state.properties[space.id];
      if (prop && prop.ownerId === playerId) out.push({ space, prop });
    }
    return out;
  }

  /** Trades that are still awaiting a decision from someone. */
  openTrades(): GameState['trades'] {
    return this.state?.trades.filter((t) => t.status === 'pending') ?? [];
  }

  incomingTrades(): GameState['trades'] {
    return this.openTrades().filter((t) => t.toId === this.youId);
  }
}

export const store = new Store();
