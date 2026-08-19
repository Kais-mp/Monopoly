/**
 * The authoritative game engine.
 *
 * Every rule lives here and nowhere else. Clients send intents; this class
 * validates them against the current state and the host's settings, mutates
 * state, and records presentation effects (`fx`) for the clients to animate.
 * Nothing a client sends is trusted.
 */
import type { ClientAction } from '../shared/protocol';
import type {
  AuctionState,
  BoardSpace,
  EventCard,
  GameFx,
  GameSettings,
  GameState,
  PieceId,
  Player,
  PropertyState,
  TradeOffer,
  TradeSide,
} from '../shared/types';
import { PLAYER_COLORS } from '../shared/types';
import { BASE_BOARD, BOARD_SIZE, GROUPS, isOwnable } from './board';
import { deckForSettings } from './events';
import { defaultSettings, sanitizeSettings } from './settings';
import { pickIndex, rollDice, shuffle, uuid } from './rng';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
}

const DISCONNECT_GRACE_MS = 12_000;

export class GameEngine {
  readonly state: GameState;

  private fx: GameFx[] = [];
  private messages: string[] = [];
  private deck: EventCard[] = [];
  private deckPos = 0;
  private auctionQueue: number[] = [];
  /** Set while a bankruptcy is being processed so we don't recurse. */
  private resolving = false;

  constructor(roomCode: string) {
    this.state = {
      roomCode,
      phase: 'lobby',
      settings: defaultSettings(),
      board: [],
      groups: GROUPS,
      players: [],
      order: [],
      properties: {},
      turn: {
        playerId: null,
        phase: 'awaiting_roll',
        number: 0,
        round: 0,
        dice: [],
        doublesCount: 0,
        rolledThisTurn: false,
        pendingPurchase: null,
        deadline: null,
      },
      auction: null,
      trades: [],
      pot: 0,
      winnerId: null,
      finalStandings: null,
      hostId: null,
      version: 0,
    };
    this.rebuildBoard();
  }

  /* ================================================================ */
  /* Board construction                                               */
  /* ================================================================ */

  private rebuildBoard(): void {
    const m = this.state.settings.money;
    const scale = (v: number, pct: number) => Math.max(0, Math.round((v * pct) / 100));

    this.state.board = BASE_BOARD.map((base): BoardSpace => {
      const space: BoardSpace = { ...base };
      if (base.price !== undefined) space.price = Math.max(1, scale(base.price, m.propertyPriceMultiplier));
      if (base.rent) space.rent = base.rent.map((r) => scale(r, m.rentMultiplier));
      if (base.buildCost !== undefined) space.buildCost = Math.max(1, scale(base.buildCost, m.buildCostMultiplier));
      if (base.amount !== undefined) {
        const pct = base.type === 'tax' ? m.taxMultiplier : m.penaltyMultiplier;
        space.amount = scale(base.amount, pct);
      }
      if (base.utilityMultipliers) space.utilityMultipliers = [...base.utilityMultipliers];
      return space;
    });

    const props: Record<number, PropertyState> = {};
    for (const space of this.state.board) {
      if (isOwnable(space)) props[space.id] = { spaceId: space.id, ownerId: null, level: 0, mortgaged: false };
    }
    this.state.properties = props;
  }

  /* ================================================================ */
  /* Snapshot / effects                                               */
  /* ================================================================ */

  snapshot(): GameState {
    for (const p of this.state.players) p.netWorth = this.netWorth(p);
    return this.state;
  }

  drainFx(): GameFx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  drainMessages(): string[] {
    const out = this.messages;
    this.messages = [];
    return out;
  }

  private emit(fx: GameFx): void {
    this.fx.push(fx);
  }

  private say(text: string): void {
    this.messages.push(text);
  }

  private touch(): void {
    this.state.version++;
  }

  /* ================================================================ */
  /* Players                                                          */
  /* ================================================================ */

  get players(): Player[] {
    return this.state.players;
  }

  player(id: string | null | undefined): Player | undefined {
    if (!id) return undefined;
    return this.state.players.find((p) => p.id === id);
  }

  private activePlayers(): Player[] {
    return this.state.players.filter((p) => !p.bankrupt);
  }

  takenPieces(): PieceId[] {
    return this.state.players.map((p) => p.piece);
  }

  addPlayer(name: string, piece: PieceId): Player | { error: string } {
    if (this.state.phase !== 'lobby') return { error: 'This game has already started.' };
    if (this.state.players.length >= this.state.settings.maxPlayers) return { error: 'This room is full.' };

    const usedColors = new Set(this.state.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
    const finalPiece = this.takenPieces().includes(piece) ? this.firstFreePiece(piece) : piece;

    const player: Player = {
      id: uuid(),
      name: this.uniqueName(name),
      piece: finalPiece,
      color,
      isHost: this.state.players.length === 0,
      connected: true,
      ready: false,
      money: 0,
      position: 0,
      status: 'lobby',
      detentionTurns: 0,
      escapeCards: 0,
      bankrupt: false,
      turnsPlayed: 0,
      netWorth: 0,
      modifiers: [],
      debt: null,
    };
    this.state.players.push(player);
    if (player.isHost) this.state.hostId = player.id;
    this.say(`${player.name} joined the room.`);
    this.touch();
    return player;
  }

  private firstFreePiece(preferred: PieceId): PieceId {
    const all: PieceId[] = ['robot', 'rocket', 'roadster', 'crown', 'starship', 'crystal', 'fox', 'hovercraft'];
    const taken = this.takenPieces();
    return all.find((p) => !taken.includes(p)) ?? preferred;
  }

  private uniqueName(name: string): string {
    const base = (name || 'Player').trim().slice(0, 16) || 'Player';
    let candidate = base;
    let n = 2;
    while (this.state.players.some((p) => p.name.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${base.slice(0, 13)} ${n++}`;
    }
    return candidate;
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.player(playerId);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    this.say(connected ? `${p.name} reconnected.` : `${p.name} lost connection.`);
    if (!connected && p.isHost) this.transferHost(p.id);
    this.touch();
  }

  private transferHost(fromId: string): void {
    const candidate =
      this.state.players.find((p) => p.id !== fromId && p.connected && !p.bankrupt) ??
      this.state.players.find((p) => p.id !== fromId && p.connected);
    if (!candidate) return;
    for (const p of this.state.players) p.isHost = p.id === candidate.id;
    this.state.hostId = candidate.id;
    this.say(`${candidate.name} is now the host.`);
  }

  removePlayer(playerId: string): void {
    const idx = this.state.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [removed] = this.state.players.splice(idx, 1);
    if (!removed) return;
    this.say(`${removed.name} left the room.`);
    if (removed.isHost) {
      const next = this.state.players[0];
      if (next) {
        next.isHost = true;
        this.state.hostId = next.id;
        this.say(`${next.name} is now the host.`);
      } else {
        this.state.hostId = null;
      }
    }
    this.touch();
  }

  /* ================================================================ */
  /* Action dispatch                                                  */
  /* ================================================================ */

  handleAction(playerId: string, action: ClientAction): ActionOutcome {
    const p = this.player(playerId);
    if (!p) return { ok: false, error: 'You are not in this game.' };

    const result = this.dispatch(p, action);
    if (result.ok) {
      this.touch();
      this.refreshDeadline();
    }
    return result;
  }

  private dispatch(p: Player, action: ClientAction): ActionOutcome {
    switch (action.type) {
      case 'set_profile':
        return this.setProfile(p, action.name, action.piece);
      case 'set_ready':
        if (this.state.phase !== 'lobby') return { ok: false, error: 'The game has started.' };
        p.ready = action.ready;
        return { ok: true };
      case 'update_settings':
        if (!p.isHost) return { ok: false, error: 'Only the host can change the rules.' };
        if (this.state.phase !== 'lobby') return { ok: false, error: 'Rules are locked once the game starts.' };
        this.state.settings = sanitizeSettings(action.settings);
        this.rebuildBoard();
        return { ok: true };
      case 'start_game':
        if (!p.isHost) return { ok: false, error: 'Only the host can start the game.' };
        return this.startGame();
      case 'kick':
        if (!p.isHost) return { ok: false, error: 'Only the host can remove players.' };
        if (this.state.phase !== 'lobby') return { ok: false, error: 'Cannot remove players mid-game.' };
        if (action.playerId === p.id) return { ok: false, error: 'You cannot remove yourself.' };
        this.removePlayer(action.playerId);
        return { ok: true };
      case 'restart':
        if (!p.isHost) return { ok: false, error: 'Only the host can restart.' };
        return this.restart();
      case 'roll_dice':
        return this.rollForMove(p);
      case 'buy':
        return this.buyPending(p);
      case 'decline_purchase':
        return this.declinePending(p);
      case 'bid':
        return this.placeBid(p, action.amount);
      case 'auction_pass':
        return this.auctionPass(p);
      case 'build':
        return this.build(p, action.spaceId);
      case 'sell_building':
        return this.sellBuilding(p, action.spaceId);
      case 'mortgage':
        return this.mortgage(p, action.spaceId);
      case 'unmortgage':
        return this.unmortgage(p, action.spaceId);
      case 'pay_detention_fee':
        return this.payDetentionFee(p);
      case 'use_escape_card':
        return this.useEscapeCard(p);
      case 'roll_for_escape':
        return this.rollForEscape(p);
      case 'end_turn':
        return this.endTurn(p);
      case 'propose_trade':
        return this.proposeTrade(p, action.toId, action.offer, action.request, action.counterOf);
      case 'respond_trade':
        return this.respondTrade(p, action.tradeId, action.accept);
      case 'cancel_trade':
        return this.cancelTrade(p, action.tradeId);
      case 'declare_bankruptcy':
        return this.declareBankruptcy(p);
      default:
        return { ok: false, error: 'Unknown action.' };
    }
  }

  private setProfile(p: Player, name?: string, piece?: PieceId): ActionOutcome {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'Profiles are locked once the game starts.' };
    if (name !== undefined) {
      const trimmed = name.trim().slice(0, 16);
      if (trimmed && trimmed.toLowerCase() !== p.name.toLowerCase()) {
        const others = this.state.players.filter((o) => o.id !== p.id);
        let candidate = trimmed;
        let n = 2;
        while (others.some((o) => o.name.toLowerCase() === candidate.toLowerCase())) {
          candidate = `${trimmed.slice(0, 13)} ${n++}`;
        }
        p.name = candidate;
      }
    }
    if (piece !== undefined) {
      const taken = this.state.players.some((o) => o.id !== p.id && o.piece === piece);
      if (taken) return { ok: false, error: 'That piece is already taken.' };
      p.piece = piece;
    }
    return { ok: true };
  }

  /* ================================================================ */
  /* Game lifecycle                                                   */
  /* ================================================================ */

  private startGame(): ActionOutcome {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'The game is already running.' };
    if (this.state.players.length < 2) return { ok: false, error: 'You need at least 2 players.' };

    this.rebuildBoard();
    const s = this.state.settings;

    for (const p of this.state.players) {
      p.money = s.money.startingMoney;
      p.position = 0;
      p.status = 'active';
      p.detentionTurns = 0;
      p.escapeCards = 0;
      p.bankrupt = false;
      p.turnsPlayed = 0;
      p.modifiers = [];
      p.debt = null;
    }

    this.state.order = shuffle(this.state.players.map((p) => p.id));
    this.state.pot = 0;
    this.state.trades = [];
    this.state.auction = null;
    this.state.winnerId = null;
    this.state.finalStandings = null;
    this.auctionQueue = [];
    this.deck = shuffle(deckForSettings(s.events.disabledCategories));
    this.deckPos = 0;
    this.state.phase = 'playing';
    this.state.turn = {
      playerId: null,
      phase: 'awaiting_roll',
      number: 0,
      round: 1,
      dice: [],
      doublesCount: 0,
      rolledThisTurn: false,
      pendingPurchase: null,
      deadline: null,
    };

    const firstName = this.player(this.state.order[0])?.name ?? 'Someone';
    this.say(`The game begins. ${firstName} goes first.`);
    this.beginTurn(this.state.order[0]!);
    return { ok: true };
  }

  private restart(): ActionOutcome {
    if (this.state.phase !== 'finished') return { ok: false, error: 'The game is still running.' };
    this.state.phase = 'lobby';
    this.state.winnerId = null;
    this.state.finalStandings = null;
    this.state.auction = null;
    this.state.trades = [];
    this.state.pot = 0;
    for (const p of this.state.players) {
      p.ready = p.isHost;
      p.status = 'lobby';
      p.bankrupt = false;
      p.money = 0;
      p.position = 0;
      p.modifiers = [];
      p.debt = null;
      p.escapeCards = 0;
      p.detentionTurns = 0;
      p.turnsPlayed = 0;
    }
    this.rebuildBoard();
    this.say('The host reset the room. Adjust the rules and start again.');
    return { ok: true };
  }

  /* ================================================================ */
  /* Turns                                                            */
  /* ================================================================ */

  private beginTurn(playerId: string): void {
    const p = this.player(playerId);
    if (!p) return;

    const t = this.state.turn;
    t.playerId = playerId;
    t.number += 1;
    t.dice = [];
    t.doublesCount = 0;
    t.rolledThisTurn = false;
    t.pendingPurchase = null;

    p.turnsPlayed += 1;
    this.tickModifiers(p);

    const detained = p.status === 'detained' && this.state.settings.detention.enabled;
    t.phase = detained ? 'detained' : 'awaiting_roll';
    this.emit({ t: 'turn', playerId });
    this.refreshDeadline();
  }

  private tickModifiers(p: Player): void {
    p.modifiers = p.modifiers
      .map((m) => ({ ...m, turnsRemaining: m.turnsRemaining - 1 }))
      .filter((m) => m.turnsRemaining > 0);
  }

  private refreshDeadline(): void {
    const t = this.state.turn;
    if (this.state.phase !== 'playing') {
      t.deadline = null;
      return;
    }
    if (this.state.auction) {
      t.deadline = this.state.auction.endsAt;
      return;
    }
    const p = this.player(t.playerId);
    if (!p) {
      t.deadline = null;
      return;
    }
    const limit = this.state.settings.turnTimeLimit;
    if (!p.connected) {
      t.deadline = Date.now() + DISCONNECT_GRACE_MS;
      return;
    }
    t.deadline = limit > 0 ? Date.now() + limit * 1000 : null;
  }

  private endTurn(p: Player): ActionOutcome {
    if (this.state.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    if (this.state.auction) return { ok: false, error: 'Finish the auction first.' };
    if (p.debt) return { ok: false, error: 'Settle your debt first.' };
    if (this.state.turn.phase === 'awaiting_purchase') return { ok: false, error: 'Buy or pass first.' };
    if (this.state.turn.phase === 'awaiting_roll' && !this.state.turn.rolledThisTurn) {
      return { ok: false, error: 'You still have to roll.' };
    }
    this.advanceTurn();
    return { ok: true };
  }

  private advanceTurn(): void {
    if (this.state.phase !== 'playing') return;
    if (this.checkVictory()) return;

    const order = this.state.order.filter((id) => {
      const pl = this.player(id);
      return pl && !pl.bankrupt;
    });
    if (order.length === 0) return;

    const currentId = this.state.turn.playerId;
    const idx = currentId ? order.indexOf(currentId) : -1;
    const nextIdx = (idx + 1) % order.length;
    if (nextIdx <= idx || idx === -1) this.state.turn.round += 1;

    // Turn-limit victory is evaluated once a full round has completed.
    if (
      this.state.settings.victory.mode === 'turn_limit' &&
      this.state.turn.round > this.state.settings.victory.turnLimit
    ) {
      this.finishByStandings('The turn limit was reached.');
      return;
    }

    this.beginTurn(order[nextIdx]!);
  }

  /** Recompute the turn phase after an action resolves. */
  private settlePhase(): void {
    if (this.state.phase !== 'playing') return;
    const t = this.state.turn;
    const p = this.player(t.playerId);
    if (!p) return;

    if (this.state.auction) {
      t.phase = 'auction';
      return;
    }
    if (p.debt) {
      t.phase = 'settling_debt';
      return;
    }
    if (t.pendingPurchase !== null) {
      t.phase = 'awaiting_purchase';
      return;
    }
    if (p.status === 'detained' && !t.rolledThisTurn) {
      t.phase = 'detained';
      return;
    }
    const doubles = this.lastRollWasDoubles();
    if (
      doubles &&
      this.state.settings.dice.doublesGrantExtraTurn &&
      p.status !== 'detained' &&
      t.doublesCount < this.state.settings.dice.maxConsecutiveDoubles
    ) {
      t.phase = 'awaiting_roll';
      return;
    }
    t.phase = 'awaiting_end';
  }

  private lastRollWasDoubles(): boolean {
    const d = this.state.turn.dice;
    return d.length > 1 && d.every((v) => v === d[0]);
  }

  /* ================================================================ */
  /* Dice + movement                                                  */
  /* ================================================================ */

  private rollForMove(p: Player): ActionOutcome {
    if (this.state.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    if (this.state.auction) return { ok: false, error: 'Finish the auction first.' };
    if (p.debt) return { ok: false, error: 'Settle your debt first.' };
    if (this.state.turn.phase !== 'awaiting_roll') return { ok: false, error: 'You cannot roll right now.' };

    const s = this.state.settings.dice;
    const values = rollDice(s.count, s.sides);
    const doubles = values.length > 1 && values.every((v) => v === values[0]);
    this.state.turn.dice = values;
    this.state.turn.rolledThisTurn = true;
    this.emit({ t: 'dice', playerId: p.id, values, doubles });

    if (doubles && s.doublesGrantExtraTurn) {
      this.state.turn.doublesCount += 1;
      if (this.state.turn.doublesCount >= s.maxConsecutiveDoubles) {
        this.say(`${p.name} rolled ${this.state.turn.doublesCount} doubles in a row.`);
        if (s.onMaxDoubles === 'detention' && this.state.settings.detention.enabled) {
          this.sendToDetention(p, 'too many doubles');
          this.settlePhase();
          return { ok: true };
        }
        if (s.onMaxDoubles === 'lose_turn') {
          this.say(`${p.name} loses the turn.`);
          this.state.turn.phase = 'awaiting_end';
          return { ok: true };
        }
      }
    }

    const steps = values.reduce((a, b) => a + b, 0) + s.bonusSpaces;
    this.movePlayer(p, steps, 'roll');
    this.resolveLanding(p, p.position, steps);
    this.settlePhase();
    return { ok: true };
  }

  private movePlayer(p: Player, steps: number, reason: 'roll' | 'card' | 'detention'): void {
    if (steps === 0) return;
    const from = p.position;
    const dir = steps > 0 ? 1 : -1;
    const path: number[] = [];
    let pos = from;
    for (let i = 0; i < Math.abs(steps); i++) {
      pos = (pos + dir + BOARD_SIZE) % BOARD_SIZE;
      path.push(pos);
      if (dir > 0 && pos === 0) this.passStart(p);
    }
    p.position = pos;
    this.emit({ t: 'move', playerId: p.id, from, to: pos, path, reason });
  }

  private teleport(p: Player, to: number, collectStart: boolean, reason: 'card' | 'detention'): void {
    const from = p.position;
    if (collectStart && to < from) this.passStart(p);
    p.position = to;
    this.emit({ t: 'move', playerId: p.id, from, to, path: [to], reason });
  }

  private passStart(p: Player): void {
    const amount = this.state.settings.money.passStartAmount;
    if (amount <= 0) return;
    this.credit(p, amount, 'passing Launch Plaza');
  }

  /* ================================================================ */
  /* Landing resolution                                               */
  /* ================================================================ */

  private resolveLanding(p: Player, spaceId: number, diceSum: number): void {
    const space = this.state.board[spaceId];
    if (!space) return;
    const s = this.state.settings;

    switch (space.type) {
      case 'start': {
        const bonus = s.money.landOnStartBonus;
        if (bonus > 0) this.credit(p, bonus, 'landing on Launch Plaza');
        break;
      }
      case 'property':
      case 'transport':
      case 'utility':
        this.resolveOwnable(p, space, diceSum);
        break;
      case 'tax': {
        const amount = space.amount ?? 0;
        if (amount > 0) {
          this.say(`${p.name} paid ${this.fmt(amount)} — ${space.name}.`);
          this.charge(p, amount, null, space.name, s.restStop.potFromTaxes);
        }
        break;
      }
      case 'penalty': {
        const amount = space.amount ?? 0;
        if (amount > 0) this.charge(p, amount, null, space.name, s.restStop.potFromPenalties);
        break;
      }
      case 'bonus': {
        const amount = space.amount ?? 0;
        if (amount > 0) this.credit(p, amount, space.name);
        break;
      }
      case 'event':
        this.maybeDrawCard(p, true);
        return;
      case 'detention':
        break;
      case 'goto_detention':
        if (s.detention.enabled) this.sendToDetention(p, 'harbour patrol');
        break;
      case 'rest':
        this.resolveRestStop(p);
        break;
    }

    // "High" event frequency sprinkles extra cards onto ordinary landings.
    // (The `event` case returns early, so we never double-draw.)
    this.maybeDrawCard(p, false);
  }

  private resolveOwnable(p: Player, space: BoardSpace, diceSum: number): void {
    const prop = this.state.properties[space.id];
    if (!prop) return;

    if (prop.ownerId === null) {
      const price = this.purchasePrice(p, space);
      if (p.money >= price) {
        this.state.turn.pendingPurchase = space.id;
      } else if (this.state.settings.property.auctionsEnabled) {
        this.say(`${p.name} cannot afford ${space.name}. It goes to auction.`);
        this.startAuction(space.id);
      }
      return;
    }

    if (prop.ownerId === p.id) return;
    if (prop.mortgaged) {
      this.say(`${space.name} is mortgaged — no rent is due.`);
      return;
    }

    const owner = this.player(prop.ownerId);
    if (!owner || owner.bankrupt) return;
    if (owner.status === 'detained' && !this.state.settings.property.collectRentInDetention) {
      this.say(`${owner.name} is detained and cannot collect rent.`);
      return;
    }

    const rent = this.calculateRent(space, prop, owner, diceSum);
    if (rent <= 0) return;

    this.emit({ t: 'rent', fromId: p.id, toId: owner.id, amount: rent, spaceId: space.id });
    this.say(`${p.name} paid ${owner.name} ${this.fmt(rent)} rent for ${space.name}.`);
    this.charge(p, rent, owner.id, `rent for ${space.name}`);
  }

  /** Public so tests and the auction path can reuse the exact same maths. */
  calculateRent(space: BoardSpace, prop: PropertyState, owner: Player, diceSum: number): number {
    const s = this.state.settings;
    let rent = 0;

    if (space.type === 'utility') {
      const owned = this.countGroupOwned(owner.id, 'works');
      const mult = space.utilityMultipliers ?? [4, 10];
      const factor = owned >= 2 ? mult[1] : mult[0];
      rent = Math.round((factor * Math.max(diceSum, 1) * s.money.rentMultiplier) / 100);
    } else if (space.type === 'transport') {
      const owned = this.countGroupOwned(owner.id, 'transit');
      const ladder = space.rent ?? [25, 50, 100, 200];
      rent = ladder[Math.min(Math.max(owned, 1), ladder.length) - 1] ?? 0;
    } else {
      const ladder = space.rent ?? [0];
      const level = Math.min(prop.level, ladder.length - 1);
      rent = ladder[level] ?? 0;
      if (prop.level === 0 && this.ownsFullGroup(owner.id, space.group)) {
        rent = Math.round((rent * s.property.fullGroupRentMultiplier) / 100);
      }
    }

    for (const mod of owner.modifiers) {
      if (mod.kind === 'rent_multiplier') rent = Math.round((rent * mod.value) / 100);
    }
    return Math.max(0, rent);
  }

  private resolveRestStop(p: Player): void {
    const r = this.state.settings.restStop;
    switch (r.mode) {
      case 'nothing':
        break;
      case 'fixed':
        if (r.fixedAmount > 0) {
          this.say(`${p.name} took a rest at Aurora Gardens and collected ${this.fmt(r.fixedAmount)}.`);
          this.credit(p, r.fixedAmount, 'Aurora Gardens');
        }
        break;
      case 'pot':
      case 'percent': {
        const pct = r.mode === 'pot' ? 100 : r.percentOfPot;
        const take = Math.floor((this.state.pot * pct) / 100);
        if (take > 0) {
          this.state.pot -= take;
          this.say(`${p.name} collected ${this.fmt(take)} from the Aurora Gardens pool.`);
          this.credit(p, take, 'Aurora Gardens pool');
        } else {
          this.say(`The Aurora Gardens pool is empty.`);
        }
        break;
      }
    }
  }

  /* ================================================================ */
  /* Event cards                                                      */
  /* ================================================================ */

  private maybeDrawCard(p: Player, onEventSpace: boolean): void {
    const e = this.state.settings.events;
    if (!e.enabled || e.frequency === 'off' || this.deck.length === 0) return;

    if (onEventSpace) {
      if (e.frequency === 'low' && Math.random() > 0.6) {
        this.say(`${p.name} checks the city feed. Nothing today.`);
        return;
      }
    } else {
      if (e.frequency !== 'high') return;
      if (Math.random() > 0.12) return;
    }

    const card = this.drawCard();
    if (!card) return;
    this.emit({ t: 'card', playerId: p.id, card });
    this.say(`${p.name} — ${card.title}: ${card.text}`);
    this.applyCard(p, card);
  }

  private drawCard(): EventCard | null {
    if (this.deck.length === 0) return null;
    if (this.deckPos >= this.deck.length) {
      this.deck = shuffle(this.deck);
      this.deckPos = 0;
    }
    const card = this.deck[this.deckPos];
    this.deckPos += 1;
    return card ?? null;
  }

  private applyCard(p: Player, card: EventCard): void {
    const strength = this.state.settings.events.strength / 100;
    const scale = (n: number) => Math.round(n * strength);
    const diceSum = this.state.turn.dice.reduce((a, b) => a + b, 0) || 7;

    for (const effect of card.effects) {
      switch (effect.kind) {
        case 'money': {
          const amount = scale(effect.amount);
          if (amount >= 0) this.credit(p, amount, card.title);
          else this.charge(p, -amount, null, card.title, this.state.settings.restStop.potFromPenalties);
          break;
        }
        case 'collect_from_each': {
          const amount = scale(effect.amount);
          for (const other of this.activePlayers()) {
            if (other.id === p.id) continue;
            this.charge(other, amount, p.id, card.title);
          }
          break;
        }
        case 'pay_each': {
          const amount = scale(effect.amount);
          for (const other of this.activePlayers()) {
            if (other.id === p.id) continue;
            this.charge(p, amount, other.id, card.title);
          }
          break;
        }
        case 'move_to': {
          this.teleport(p, effect.space, effect.collectStart, 'card');
          this.resolveLanding(p, p.position, diceSum);
          break;
        }
        case 'move_relative': {
          this.movePlayer(p, effect.steps, 'card');
          this.resolveLanding(p, p.position, diceSum);
          break;
        }
        case 'move_nearest': {
          const target = this.findNearest(p.position, effect.spaceType);
          if (target === null) break;
          this.teleport(p, target, true, 'card');
          const space = this.state.board[target];
          const prop = this.state.properties[target];
          if (!space || !prop) break;
          if (prop.ownerId === null) {
            const price = this.purchasePrice(p, space);
            if (p.money >= price) this.state.turn.pendingPurchase = target;
            else if (this.state.settings.property.auctionsEnabled) this.startAuction(target);
          } else if (prop.ownerId !== p.id && !prop.mortgaged) {
            const owner = this.player(prop.ownerId);
            if (owner) {
              const base = this.calculateRent(space, prop, owner, diceSum);
              const due = Math.round(base * effect.rentMultiplier);
              this.emit({ t: 'rent', fromId: p.id, toId: owner.id, amount: due, spaceId: target });
              this.say(`${p.name} paid ${owner.name} ${this.fmt(due)} at ${space.name}.`);
              this.charge(p, due, owner.id, `charge at ${space.name}`);
            }
          }
          break;
        }
        case 'go_detention':
          if (this.state.settings.detention.enabled) this.sendToDetention(p, card.title);
          break;
        case 'escape_card':
          p.escapeCards += 1;
          break;
        case 'repairs': {
          let total = 0;
          for (const prop of Object.values(this.state.properties)) {
            if (prop.ownerId !== p.id || prop.level === 0) continue;
            total += prop.level >= 5 ? effect.perTower : prop.level * effect.perLevel;
          }
          total = scale(total);
          if (total > 0) {
            this.say(`${p.name} paid ${this.fmt(total)} in repairs.`);
            this.charge(p, total, null, card.title, this.state.settings.restStop.potFromPenalties);
          }
          break;
        }
        case 'rent_modifier':
          p.modifiers.push({
            id: uuid(),
            kind: 'rent_multiplier',
            value: effect.multiplier,
            turnsRemaining: effect.turns + 1,
            label: `${effect.multiplier}% rent`,
          });
          break;
        case 'purchase_discount':
          p.modifiers.push({
            id: uuid(),
            kind: 'purchase_discount',
            value: effect.percent,
            turnsRemaining: effect.turns + 1,
            label: `${effect.percent}% off`,
          });
          break;
        case 'all_move_relative': {
          for (const other of this.activePlayers()) {
            if (other.status === 'detained') continue;
            this.movePlayer(other, effect.steps, 'card');
          }
          break;
        }
        case 'pot_take': {
          const take = this.state.pot;
          this.state.pot = 0;
          if (take > 0) this.credit(p, take, card.title);
          break;
        }
        case 'pot_add': {
          const amount = scale(effect.amount);
          this.charge(p, amount, null, card.title, true);
          break;
        }
      }
    }
  }

  private findNearest(from: number, type: 'transport' | 'utility'): number | null {
    for (let i = 1; i <= BOARD_SIZE; i++) {
      const idx = (from + i) % BOARD_SIZE;
      if (this.state.board[idx]?.type === type) return idx;
    }
    return null;
  }

  /* ================================================================ */
  /* Detention                                                        */
  /* ================================================================ */

  private detentionSpace(): number {
    const idx = this.state.board.findIndex((s) => s.type === 'detention');
    return idx === -1 ? 10 : idx;
  }

  private sendToDetention(p: Player, reason: string): void {
    p.status = 'detained';
    p.detentionTurns = 0;
    this.teleport(p, this.detentionSpace(), false, 'detention');
    this.emit({ t: 'detention', playerId: p.id, entering: true });
    this.say(`${p.name} was sent to the Holding Yard (${reason}).`);
    this.state.turn.doublesCount = 0;
    if (this.state.turn.playerId === p.id) {
      this.state.turn.rolledThisTurn = true;
      this.state.turn.phase = 'awaiting_end';
    }
  }

  private releaseFromDetention(p: Player, how: string): void {
    p.status = 'active';
    p.detentionTurns = 0;
    this.emit({ t: 'detention', playerId: p.id, entering: false });
    this.say(`${p.name} left the Holding Yard (${how}).`);
  }

  private payDetentionFee(p: Player): ActionOutcome {
    const d = this.state.settings.detention;
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    if (p.status !== 'detained') return { ok: false, error: 'You are not detained.' };
    if (!d.payToLeaveAllowed) return { ok: false, error: 'Paying your way out is disabled.' };
    const fee = this.state.settings.money.detentionFee;
    if (p.money < fee) return { ok: false, error: 'You cannot afford the fee.' };

    this.charge(p, fee, null, 'detention fee', this.state.settings.restStop.potFromFees);
    this.releaseFromDetention(p, 'paid the fee');
    this.state.turn.phase = this.state.turn.rolledThisTurn ? 'awaiting_end' : 'awaiting_roll';
    return { ok: true };
  }

  private useEscapeCard(p: Player): ActionOutcome {
    const d = this.state.settings.detention;
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    if (p.status !== 'detained') return { ok: false, error: 'You are not detained.' };
    if (!d.cardsAllowed) return { ok: false, error: 'Release cards are disabled.' };
    if (p.escapeCards <= 0) return { ok: false, error: 'You have no release card.' };

    p.escapeCards -= 1;
    this.releaseFromDetention(p, 'used a release card');
    this.state.turn.phase = this.state.turn.rolledThisTurn ? 'awaiting_end' : 'awaiting_roll';
    return { ok: true };
  }

  private rollForEscape(p: Player): ActionOutcome {
    const d = this.state.settings.detention;
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    if (p.status !== 'detained') return { ok: false, error: 'You are not detained.' };
    if (this.state.turn.rolledThisTurn) return { ok: false, error: 'You already rolled.' };

    const s = this.state.settings.dice;
    const values = rollDice(s.count, s.sides);
    const doubles = values.length > 1 && values.every((v) => v === values[0]);
    this.state.turn.dice = values;
    this.state.turn.rolledThisTurn = true;
    this.emit({ t: 'dice', playerId: p.id, values, doubles });

    const steps = values.reduce((a, b) => a + b, 0);

    if (doubles && d.escapeWithDoubles) {
      this.releaseFromDetention(p, 'rolled doubles');
      this.movePlayer(p, steps, 'roll');
      this.resolveLanding(p, p.position, steps);
      this.state.turn.doublesCount = 0;
      this.settlePhase();
      if (this.state.turn.phase === 'awaiting_roll') this.state.turn.phase = 'awaiting_end';
      return { ok: true };
    }

    p.detentionTurns += 1;
    const remaining = d.turns - p.detentionTurns;
    if (remaining <= 0) {
      if (d.mustPayAfterMaxTurns) {
        const fee = this.state.settings.money.detentionFee;
        this.say(`${p.name} served the full stay and paid the ${this.fmt(fee)} fee.`);
        this.charge(p, fee, null, 'detention fee', this.state.settings.restStop.potFromFees);
      }
      this.releaseFromDetention(p, 'time served');
      this.movePlayer(p, steps, 'roll');
      this.resolveLanding(p, p.position, steps);
      this.settlePhase();
      if (this.state.turn.phase === 'awaiting_roll') this.state.turn.phase = 'awaiting_end';
      return { ok: true };
    }

    this.say(`${p.name} stays in the Holding Yard (${remaining} turn${remaining === 1 ? '' : 's'} left).`);
    this.state.turn.phase = 'awaiting_end';
    return { ok: true };
  }

  /* ================================================================ */
  /* Buying, auctions                                                 */
  /* ================================================================ */

  purchasePrice(p: Player, space: BoardSpace): number {
    let price = space.price ?? 0;
    for (const mod of p.modifiers) {
      if (mod.kind === 'purchase_discount') price = Math.round((price * (100 - mod.value)) / 100);
    }
    return Math.max(0, price);
  }

  private buyPending(p: Player): ActionOutcome {
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    const spaceId = this.state.turn.pendingPurchase;
    if (spaceId === null) return { ok: false, error: 'There is nothing to buy.' };
    const space = this.state.board[spaceId];
    const prop = this.state.properties[spaceId];
    if (!space || !prop) return { ok: false, error: 'Unknown space.' };
    if (prop.ownerId !== null) return { ok: false, error: 'Already owned.' };

    const price = this.purchasePrice(p, space);
    if (p.money < price) return { ok: false, error: 'You cannot afford it.' };

    p.money -= price;
    prop.ownerId = p.id;
    this.state.turn.pendingPurchase = null;
    this.emit({ t: 'money', playerId: p.id, delta: -price, reason: `bought ${space.name}` });
    this.emit({ t: 'purchase', playerId: p.id, spaceId });
    this.say(`${p.name} bought ${space.name} for ${this.fmt(price)}.`);
    this.settlePhase();
    return { ok: true };
  }

  private declinePending(p: Player): ActionOutcome {
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'It is not your turn.' };
    const spaceId = this.state.turn.pendingPurchase;
    if (spaceId === null) return { ok: false, error: 'There is nothing to decline.' };
    this.state.turn.pendingPurchase = null;

    if (this.state.settings.property.auctionsEnabled) {
      this.startAuction(spaceId);
    } else {
      this.say(`${p.name} passed on ${this.state.board[spaceId]?.name ?? 'the property'}.`);
    }
    this.settlePhase();
    return { ok: true };
  }

  private startAuction(spaceId: number): void {
    const bidders = this.activePlayers().filter((p) => !p.debt);
    if (bidders.length === 0) return;
    const space = this.state.board[spaceId];
    const auction: AuctionState = {
      spaceId,
      currentBid: 0,
      highBidderId: null,
      activeBidders: bidders.map((p) => p.id),
      passed: [],
      endsAt: Date.now() + this.state.settings.property.auctionSeconds * 1000,
    };
    this.state.auction = auction;
    this.state.turn.phase = 'auction';
    this.say(`${space?.name ?? 'A property'} goes to auction. Opening bid ${this.fmt(this.state.settings.property.auctionMinIncrement)}.`);
  }

  private placeBid(p: Player, amount: number): ActionOutcome {
    const a = this.state.auction;
    if (!a) return { ok: false, error: 'No auction is running.' };
    if (!a.activeBidders.includes(p.id)) return { ok: false, error: 'You are out of this auction.' };
    const min = a.currentBid + this.state.settings.property.auctionMinIncrement;
    const bid = Math.round(amount);
    if (!Number.isFinite(bid) || bid < min) return { ok: false, error: `Minimum bid is ${this.fmt(min)}.` };
    if (bid > p.money) return { ok: false, error: 'You cannot cover that bid.' };

    a.currentBid = bid;
    a.highBidderId = p.id;
    a.endsAt = Math.max(a.endsAt, Date.now() + 6000);
    this.say(`${p.name} bids ${this.fmt(bid)}.`);
    return { ok: true };
  }

  private auctionPass(p: Player): ActionOutcome {
    const a = this.state.auction;
    if (!a) return { ok: false, error: 'No auction is running.' };
    if (!a.activeBidders.includes(p.id)) return { ok: false, error: 'You already passed.' };
    a.activeBidders = a.activeBidders.filter((id) => id !== p.id);
    a.passed.push(p.id);
    this.say(`${p.name} passed.`);
    if (a.activeBidders.length === 0 || (a.activeBidders.length === 1 && a.highBidderId === a.activeBidders[0])) {
      this.finishAuction();
    }
    return { ok: true };
  }

  private finishAuction(): void {
    const a = this.state.auction;
    if (!a) return;
    this.state.auction = null;
    const space = this.state.board[a.spaceId];
    const prop = this.state.properties[a.spaceId];
    const winner = this.player(a.highBidderId);

    if (winner && prop && space && a.currentBid > 0 && winner.money >= a.currentBid) {
      winner.money -= a.currentBid;
      prop.ownerId = winner.id;
      this.emit({ t: 'money', playerId: winner.id, delta: -a.currentBid, reason: `won ${space.name}` });
      this.emit({ t: 'auction_won', playerId: winner.id, spaceId: a.spaceId, amount: a.currentBid });
      this.say(`${winner.name} won ${space.name} at auction for ${this.fmt(a.currentBid)}.`);
    } else {
      this.say(`${space?.name ?? 'The property'} found no buyer.`);
    }

    const next = this.auctionQueue.shift();
    if (next !== undefined) {
      this.startAuction(next);
      return;
    }
    this.settlePhase();
  }

  /* ================================================================ */
  /* Building, mortgaging                                             */
  /* ================================================================ */

  private ownsFullGroup(playerId: string, groupId: string | undefined): boolean {
    if (!groupId) return false;
    const spaces = this.state.board.filter((s) => s.group === groupId);
    if (spaces.length === 0) return false;
    return spaces.every((s) => this.state.properties[s.id]?.ownerId === playerId);
  }

  private countGroupOwned(playerId: string, groupId: string): number {
    return this.state.board.filter(
      (s) => s.group === groupId && this.state.properties[s.id]?.ownerId === playerId,
    ).length;
  }

  private groupLevels(groupId: string): number[] {
    return this.state.board
      .filter((s) => s.group === groupId && s.type === 'property')
      .map((s) => this.state.properties[s.id]?.level ?? 0);
  }

  private buildCostFor(space: BoardSpace): number {
    return space.buildCost ?? 0;
  }

  private build(p: Player, spaceId: number): ActionOutcome {
    if (this.state.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    const space = this.state.board[spaceId];
    const prop = this.state.properties[spaceId];
    const s = this.state.settings.property;
    if (!space || !prop) return { ok: false, error: 'Unknown property.' };
    if (space.type !== 'property') return { ok: false, error: 'You can only build on districts.' };
    if (prop.ownerId !== p.id) return { ok: false, error: 'You do not own that.' };
    if (prop.mortgaged) return { ok: false, error: 'Lift the mortgage first.' };
    if (this.state.turn.playerId !== p.id) return { ok: false, error: 'You can only build on your turn.' };
    if (p.debt) return { ok: false, error: 'Settle your debt first.' };

    const maxLevel = s.towerEnabled ? s.maxLevel : Math.min(s.maxLevel, 4);
    if (prop.level >= maxLevel) return { ok: false, error: 'This is already at the highest level.' };
    if (s.buildingsRequireFullGroup && !this.ownsFullGroup(p.id, space.group)) {
      return { ok: false, error: 'You need the whole district first.' };
    }
    if (space.group) {
      const groupSpaces = this.state.board.filter((sp) => sp.group === space.group);
      if (groupSpaces.some((sp) => this.state.properties[sp.id]?.mortgaged)) {
        return { ok: false, error: 'Something in this district is mortgaged.' };
      }
      if (s.evenBuildingRequired) {
        const levels = this.groupLevels(space.group);
        const min = Math.min(...levels);
        if (prop.level > min) return { ok: false, error: 'Build evenly across the district.' };
      }
    }

    const cost = this.buildCostFor(space);
    if (p.money < cost) return { ok: false, error: 'You cannot afford that upgrade.' };

    p.money -= cost;
    prop.level += 1;
    this.emit({ t: 'money', playerId: p.id, delta: -cost, reason: `built on ${space.name}` });
    this.emit({ t: 'build', playerId: p.id, spaceId, level: prop.level });
    this.say(`${p.name} upgraded ${space.name} to level ${prop.level}.`);
    return { ok: true };
  }

  private sellBuilding(p: Player, spaceId: number): ActionOutcome {
    const space = this.state.board[spaceId];
    const prop = this.state.properties[spaceId];
    const s = this.state.settings.property;
    if (!space || !prop) return { ok: false, error: 'Unknown property.' };
    if (prop.ownerId !== p.id) return { ok: false, error: 'You do not own that.' };
    if (prop.level <= 0) return { ok: false, error: 'There is nothing to sell.' };

    if (s.evenBuildingRequired && space.group) {
      const levels = this.groupLevels(space.group);
      const max = Math.max(...levels);
      if (prop.level < max) return { ok: false, error: 'Sell evenly across the district.' };
    }

    const refund = Math.round((this.buildCostFor(space) * s.sellBuildingRefundPercent) / 100);
    prop.level -= 1;
    this.credit(p, refund, `sold a level on ${space.name}`);
    this.emit({ t: 'demolish', playerId: p.id, spaceId, level: prop.level });
    this.say(`${p.name} sold a level on ${space.name} for ${this.fmt(refund)}.`);
    this.autoSettleDebt(p);
    return { ok: true };
  }

  private mortgageValue(space: BoardSpace): number {
    return Math.round(((space.price ?? 0) * this.state.settings.property.mortgageValuePercent) / 100);
  }

  private mortgage(p: Player, spaceId: number): ActionOutcome {
    const s = this.state.settings.property;
    if (!s.mortgageEnabled) return { ok: false, error: 'Mortgages are disabled in this game.' };
    const space = this.state.board[spaceId];
    const prop = this.state.properties[spaceId];
    if (!space || !prop) return { ok: false, error: 'Unknown property.' };
    if (prop.ownerId !== p.id) return { ok: false, error: 'You do not own that.' };
    if (prop.mortgaged) return { ok: false, error: 'Already mortgaged.' };
    if (prop.level > 0) return { ok: false, error: 'Sell the buildings first.' };

    prop.mortgaged = true;
    const value = this.mortgageValue(space);
    this.credit(p, value, `mortgaged ${space.name}`);
    this.emit({ t: 'mortgage', spaceId, mortgaged: true });
    this.say(`${p.name} mortgaged ${space.name} for ${this.fmt(value)}.`);
    this.autoSettleDebt(p);
    return { ok: true };
  }

  private unmortgage(p: Player, spaceId: number): ActionOutcome {
    const s = this.state.settings.property;
    if (!s.mortgageEnabled) return { ok: false, error: 'Mortgages are disabled in this game.' };
    const space = this.state.board[spaceId];
    const prop = this.state.properties[spaceId];
    if (!space || !prop) return { ok: false, error: 'Unknown property.' };
    if (prop.ownerId !== p.id) return { ok: false, error: 'You do not own that.' };
    if (!prop.mortgaged) return { ok: false, error: 'That is not mortgaged.' };

    const cost = Math.round((this.mortgageValue(space) * (100 + s.unmortgageInterestPercent)) / 100);
    if (p.money < cost) return { ok: false, error: `You need ${this.fmt(cost)} to lift this mortgage.` };
    p.money -= cost;
    prop.mortgaged = false;
    this.emit({ t: 'money', playerId: p.id, delta: -cost, reason: `lifted mortgage on ${space.name}` });
    this.emit({ t: 'mortgage', spaceId, mortgaged: false });
    this.say(`${p.name} lifted the mortgage on ${space.name} for ${this.fmt(cost)}.`);
    return { ok: true };
  }

  /* ================================================================ */
  /* Money                                                            */
  /* ================================================================ */

  private fmt(amount: number): string {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }

  private credit(p: Player, amount: number, reason: string): void {
    if (amount <= 0) return;
    p.money += amount;
    this.emit({ t: 'money', playerId: p.id, delta: amount, reason });
  }

  /**
   * Take money from a player. If they are short, the active player gets a
   * chance to raise funds (debt phase); anyone else is liquidated automatically
   * and, if that is not enough, goes bankrupt on the spot.
   */
  private charge(
    p: Player,
    amount: number,
    creditorId: string | null,
    reason: string,
    toPot = false,
  ): boolean {
    if (amount <= 0 || p.bankrupt) return true;

    if (p.money >= amount) {
      p.money -= amount;
      this.emit({ t: 'money', playerId: p.id, delta: -amount, reason });
      this.payOut(creditorId, amount, reason, toPot);
      return true;
    }

    const isActive = this.state.turn.playerId === p.id;
    if (isActive && this.canRaise(p, amount)) {
      p.debt = { amount, creditorId };
      this.state.turn.phase = 'settling_debt';
      this.say(`${p.name} owes ${this.fmt(amount)} and must raise the money.`);
      return false;
    }

    if (!isActive) {
      this.liquidate(p, amount);
      if (p.money >= amount) {
        p.money -= amount;
        this.emit({ t: 'money', playerId: p.id, delta: -amount, reason });
        this.payOut(creditorId, amount, reason, toPot);
        return true;
      }
    }

    this.bankrupt(p, creditorId, amount);
    return false;
  }

  private payOut(creditorId: string | null, amount: number, reason: string, toPot: boolean): void {
    if (creditorId) {
      const creditor = this.player(creditorId);
      if (creditor && !creditor.bankrupt) {
        creditor.money += amount;
        this.emit({ t: 'money', playerId: creditor.id, delta: amount, reason });
      }
      return;
    }
    if (toPot) this.state.pot += amount;
  }

  /** Total the player could raise by selling buildings and mortgaging. */
  private canRaise(p: Player, target: number): boolean {
    return this.liquidationValue(p) + p.money >= target;
  }

  private liquidationValue(p: Player): number {
    const s = this.state.settings.property;
    let total = 0;
    for (const prop of Object.values(this.state.properties)) {
      if (prop.ownerId !== p.id) continue;
      const space = this.state.board[prop.spaceId];
      if (!space) continue;
      total += Math.round((this.buildCostFor(space) * s.sellBuildingRefundPercent * prop.level) / 100);
      if (!prop.mortgaged && s.mortgageEnabled) total += this.mortgageValue(space);
    }
    return total;
  }

  /** Sell buildings then mortgage, cheapest-first, until the target is met. */
  private liquidate(p: Player, target: number): void {
    const s = this.state.settings.property;
    const owned = () => Object.values(this.state.properties).filter((pr) => pr.ownerId === p.id);

    let guard = 0;
    while (p.money < target && guard++ < 200) {
      const withBuildings = owned()
        .filter((pr) => pr.level > 0)
        .sort((a, b) => b.level - a.level);
      const top = withBuildings[0];
      if (top) {
        const space = this.state.board[top.spaceId];
        if (space) {
          top.level -= 1;
          const refund = Math.round((this.buildCostFor(space) * s.sellBuildingRefundPercent) / 100);
          this.credit(p, refund, `sold a level on ${space.name}`);
          this.emit({ t: 'demolish', playerId: p.id, spaceId: top.spaceId, level: top.level });
          continue;
        }
      }
      if (!s.mortgageEnabled) break;
      const mortgageable = owned().filter((pr) => !pr.mortgaged && pr.level === 0);
      const next = mortgageable[0];
      if (!next) break;
      const space = this.state.board[next.spaceId];
      if (!space) break;
      next.mortgaged = true;
      this.credit(p, this.mortgageValue(space), `mortgaged ${space.name}`);
      this.emit({ t: 'mortgage', spaceId: next.spaceId, mortgaged: true });
    }
  }

  private autoSettleDebt(p: Player): void {
    if (!p.debt) return;
    if (p.money < p.debt.amount) return;
    const { amount, creditorId } = p.debt;
    p.debt = null;
    p.money -= amount;
    this.emit({ t: 'money', playerId: p.id, delta: -amount, reason: 'settled debt' });
    this.payOut(creditorId, amount, 'debt settled', false);
    this.say(`${p.name} settled a debt of ${this.fmt(amount)}.`);
    this.settlePhase();
  }

  /* ================================================================ */
  /* Bankruptcy                                                       */
  /* ================================================================ */

  private declareBankruptcy(p: Player): ActionOutcome {
    if (this.state.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    if (!p.debt) return { ok: false, error: 'You have nothing to declare.' };
    this.bankrupt(p, p.debt.creditorId, p.debt.amount);
    return { ok: true };
  }

  private bankrupt(p: Player, creditorId: string | null, owed: number): void {
    if (p.bankrupt || this.resolving) return;
    this.resolving = true;

    const s = this.state.settings.bankruptcy;
    const creditor = this.player(creditorId);
    const owned = Object.values(this.state.properties).filter((pr) => pr.ownerId === p.id);

    // Buildings are always cashed out first.
    let buildingCash = 0;
    for (const prop of owned) {
      if (prop.level <= 0) continue;
      const space = this.state.board[prop.spaceId];
      if (!space) continue;
      buildingCash += Math.round((this.buildCostFor(space) * s.buildingRefundPercent * prop.level) / 100);
      prop.level = 0;
      this.emit({ t: 'demolish', playerId: p.id, spaceId: prop.spaceId, level: 0 });
    }

    const cash = p.money + buildingCash;
    p.money = 0;

    if (creditor && !creditor.bankrupt && s.assetMode === 'to_creditor') {
      if (cash > 0) {
        creditor.money += cash;
        this.emit({ t: 'money', playerId: creditor.id, delta: cash, reason: `${p.name}'s estate` });
      }
      for (const prop of owned) {
        prop.ownerId = creditor.id;
        if (s.transferMortgaged) prop.mortgaged = true;
      }
      this.say(`${p.name} went bankrupt. ${creditor.name} takes the estate.`);
    } else if (s.assetMode === 'to_auction') {
      for (const prop of owned) {
        prop.ownerId = null;
        prop.mortgaged = false;
      }
      if (creditor && cash > 0) {
        creditor.money += cash;
        this.emit({ t: 'money', playerId: creditor.id, delta: cash, reason: `${p.name}'s estate` });
      }
      this.auctionQueue.push(...owned.map((pr) => pr.spaceId));
      this.say(`${p.name} went bankrupt. Their deeds go under the hammer.`);
    } else {
      for (const prop of owned) {
        prop.ownerId = null;
        prop.mortgaged = false;
      }
      if (creditor && cash > 0) {
        creditor.money += cash;
        this.emit({ t: 'money', playerId: creditor.id, delta: cash, reason: `${p.name}'s estate` });
      }
      this.say(`${p.name} went bankrupt. Their deeds return to the market.`);
    }

    p.bankrupt = true;
    p.debt = null;
    p.status = 'bankrupt';
    p.modifiers = [];
    p.escapeCards = 0;
    this.emit({ t: 'bankrupt', playerId: p.id, creditorId: creditor?.id ?? null });
    void owed;

    this.resolving = false;

    if (this.state.auction) {
      const a = this.state.auction;
      a.activeBidders = a.activeBidders.filter((id) => id !== p.id);
      if (a.highBidderId === p.id) a.highBidderId = null;
    }

    if (this.checkVictory()) return;

    if (this.state.turn.playerId === p.id) {
      if (this.auctionQueue.length > 0 && !this.state.auction) {
        const next = this.auctionQueue.shift();
        if (next !== undefined) {
          this.startAuction(next);
          return;
        }
      }
      this.advanceTurn();
    } else if (this.auctionQueue.length > 0 && !this.state.auction) {
      const next = this.auctionQueue.shift();
      if (next !== undefined) this.startAuction(next);
    }
  }

  /* ================================================================ */
  /* Trading                                                          */
  /* ================================================================ */

  private sanitizeSide(side: TradeSide | undefined): TradeSide {
    const s = this.state.settings.trading;
    const money = s.allowMoney ? Math.max(0, Math.round(Number(side?.money) || 0)) : 0;
    const properties = s.allowProperties && Array.isArray(side?.properties)
      ? Array.from(new Set(side!.properties.map((n) => Math.round(Number(n))).filter((n) => Number.isInteger(n))))
      : [];
    const escapeCards = s.allowEscapeCards ? Math.max(0, Math.round(Number(side?.escapeCards) || 0)) : 0;
    return { money, properties, escapeCards };
  }

  private validateSide(owner: Player, side: TradeSide): string | null {
    const s = this.state.settings.trading;
    if (side.money > owner.money) return `${owner.name} does not have that much cash.`;
    if (side.escapeCards > owner.escapeCards) return `${owner.name} does not have that many release cards.`;
    for (const spaceId of side.properties) {
      const prop = this.state.properties[spaceId];
      const space = this.state.board[spaceId];
      if (!prop || !space) return 'That property does not exist.';
      if (prop.ownerId !== owner.id) return `${owner.name} does not own ${space.name}.`;
      if (prop.level > 0) return `${space.name} still has buildings on it.`;
      if (prop.mortgaged && !s.allowMortgaged) return `${space.name} is mortgaged and cannot be traded.`;
    }
    return null;
  }

  private proposeTrade(
    p: Player,
    toId: string,
    offer: TradeSide,
    request: TradeSide,
    counterOf?: string,
  ): ActionOutcome {
    const s = this.state.settings.trading;
    if (!s.enabled) return { ok: false, error: 'Trading is disabled in this game.' };
    if (this.state.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    if (s.onlyOnYourTurn && this.state.turn.playerId !== p.id) {
      return { ok: false, error: 'You can only trade on your own turn.' };
    }
    const other = this.player(toId);
    if (!other) return { ok: false, error: 'That player is not here.' };
    if (other.id === p.id) return { ok: false, error: 'You cannot trade with yourself.' };
    if (other.bankrupt || p.bankrupt) return { ok: false, error: 'That player is out of the game.' };

    const cleanOffer = this.sanitizeSide(offer);
    const cleanRequest = this.sanitizeSide(request);
    if (
      cleanOffer.money === 0 &&
      cleanOffer.properties.length === 0 &&
      cleanOffer.escapeCards === 0 &&
      cleanRequest.money === 0 &&
      cleanRequest.properties.length === 0 &&
      cleanRequest.escapeCards === 0
    ) {
      return { ok: false, error: 'An empty trade is not a trade.' };
    }

    const offerError = this.validateSide(p, cleanOffer);
    if (offerError) return { ok: false, error: offerError };
    const requestError = this.validateSide(other, cleanRequest);
    if (requestError) return { ok: false, error: requestError };

    const pendingFromMe = this.state.trades.filter((t) => t.fromId === p.id && t.status === 'pending');
    if (pendingFromMe.length >= 3) return { ok: false, error: 'You have too many offers open.' };

    if (counterOf) {
      const parent = this.state.trades.find((t) => t.id === counterOf);
      if (parent && parent.status === 'pending') parent.status = 'countered';
    }

    const trade: TradeOffer = {
      id: uuid(),
      fromId: p.id,
      toId: other.id,
      offer: cleanOffer,
      request: cleanRequest,
      status: 'pending',
      counterOf: counterOf ?? null,
      createdAt: Date.now(),
    };
    this.state.trades.push(trade);
    if (this.state.trades.length > 40) this.state.trades.splice(0, this.state.trades.length - 40);
    this.say(`${p.name} sent ${other.name} a trade offer.`);
    return { ok: true };
  }

  private respondTrade(p: Player, tradeId: string, accept: boolean): ActionOutcome {
    const trade = this.state.trades.find((t) => t.id === tradeId);
    if (!trade) return { ok: false, error: 'That offer no longer exists.' };
    if (trade.status !== 'pending') return { ok: false, error: 'That offer is no longer open.' };
    if (trade.toId !== p.id) return { ok: false, error: 'That offer is not addressed to you.' };

    const from = this.player(trade.fromId);
    if (!from) return { ok: false, error: 'The other player has left.' };

    if (!accept) {
      trade.status = 'rejected';
      this.say(`${p.name} rejected ${from.name}'s offer.`);
      return { ok: true };
    }

    const offerError = this.validateSide(from, trade.offer);
    if (offerError) {
      trade.status = 'cancelled';
      return { ok: false, error: offerError };
    }
    const requestError = this.validateSide(p, trade.request);
    if (requestError) {
      trade.status = 'cancelled';
      return { ok: false, error: requestError };
    }

    this.executeTradeSide(from, p, trade.offer);
    this.executeTradeSide(p, from, trade.request);
    trade.status = 'accepted';
    this.emit({ t: 'trade', fromId: from.id, toId: p.id });
    this.say(`${from.name} and ${p.name} completed a trade.`);
    this.autoSettleDebt(from);
    this.autoSettleDebt(p);
    return { ok: true };
  }

  private executeTradeSide(from: Player, to: Player, side: TradeSide): void {
    if (side.money > 0) {
      from.money -= side.money;
      to.money += side.money;
      this.emit({ t: 'money', playerId: from.id, delta: -side.money, reason: 'trade' });
      this.emit({ t: 'money', playerId: to.id, delta: side.money, reason: 'trade' });
    }
    if (side.escapeCards > 0) {
      from.escapeCards -= side.escapeCards;
      to.escapeCards += side.escapeCards;
    }
    for (const spaceId of side.properties) {
      const prop = this.state.properties[spaceId];
      if (prop) prop.ownerId = to.id;
    }
  }

  private cancelTrade(p: Player, tradeId: string): ActionOutcome {
    const trade = this.state.trades.find((t) => t.id === tradeId);
    if (!trade) return { ok: false, error: 'That offer no longer exists.' };
    if (trade.fromId !== p.id) return { ok: false, error: 'That is not your offer.' };
    if (trade.status !== 'pending') return { ok: false, error: 'That offer is already closed.' };
    trade.status = 'cancelled';
    return { ok: true };
  }

  /* ================================================================ */
  /* Victory                                                          */
  /* ================================================================ */

  netWorth(p: Player): number {
    if (p.bankrupt) return 0;
    const s = this.state.settings.property;
    let total = p.money;
    for (const prop of Object.values(this.state.properties)) {
      if (prop.ownerId !== p.id) continue;
      const space = this.state.board[prop.spaceId];
      if (!space) continue;
      total += prop.mortgaged ? this.mortgageValue(space) : space.price ?? 0;
      total += this.buildCostFor(space) * prop.level;
    }
    void s;
    return Math.round(total);
  }

  private checkVictory(): boolean {
    if (this.state.phase !== 'playing') return false;
    const v = this.state.settings.victory;
    const alive = this.activePlayers();

    if (alive.length <= 1) {
      this.finish(alive[0]?.id ?? null, 'Last one standing.');
      return true;
    }
    if (v.mode === 'wealth_target') {
      const rich = alive.find((p) => this.netWorth(p) >= v.wealthTarget);
      if (rich) {
        this.finish(rich.id, `${rich.name} reached the wealth target.`);
        return true;
      }
    }
    return false;
  }

  private finishByStandings(reason: string): void {
    const ranked = this.activePlayers()
      .map((p) => ({ p, worth: this.netWorth(p) }))
      .sort((a, b) => b.worth - a.worth);
    this.finish(ranked[0]?.p.id ?? null, reason);
  }

  private finish(winnerId: string | null, reason: string): void {
    this.state.phase = 'finished';
    this.state.winnerId = winnerId;
    this.state.auction = null;
    this.state.turn.phase = 'game_over';
    this.state.turn.deadline = null;

    const standings = this.state.players
      .map((p) => ({ playerId: p.id, name: p.name, netWorth: this.netWorth(p), bankrupt: p.bankrupt }))
      .sort((a, b) => {
        if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
        return b.netWorth - a.netWorth;
      })
      .map((row, i) => ({ playerId: row.playerId, name: row.name, netWorth: row.netWorth, rank: i + 1 }));
    this.state.finalStandings = standings;

    const winner = this.player(winnerId);
    if (winner) {
      winner.status = 'winner';
      this.emit({ t: 'victory', playerId: winner.id });
      this.say(`${reason} ${winner.name} wins Aurora Bay!`);
    } else {
      this.say(`${reason} Nobody is left standing.`);
    }
    this.touch();
  }

  /* ================================================================ */
  /* Timers                                                           */
  /* ================================================================ */

  /** Called on an interval by the room; drives auctions and idle turns. */
  tick(now = Date.now()): boolean {
    if (this.state.phase !== 'playing') return false;
    let changed = false;

    if (this.state.auction && now >= this.state.auction.endsAt) {
      this.finishAuction();
      changed = true;
    }

    const t = this.state.turn;
    if (!this.state.auction && t.deadline !== null && now >= t.deadline) {
      const p = this.player(t.playerId);
      if (p) {
        this.autoPlay(p);
        changed = true;
      }
    }

    if (changed) {
      this.touch();
      this.refreshDeadline();
    }
    return changed;
  }

  /** Keeps the game moving when someone is away or disconnected. */
  private autoPlay(p: Player): void {
    const t = this.state.turn;
    this.say(`${p.name} is away — the bank plays for them.`);
    switch (t.phase) {
      case 'awaiting_roll':
        this.rollForMove(p);
        if (this.state.turn.phase === 'awaiting_purchase') this.declinePending(p);
        if (this.state.turn.phase === 'awaiting_end') this.advanceTurn();
        break;
      case 'detained':
        this.rollForEscape(p);
        if (this.state.turn.phase === 'awaiting_purchase') this.declinePending(p);
        if (this.state.turn.phase === 'awaiting_end') this.advanceTurn();
        break;
      case 'awaiting_purchase':
        this.declinePending(p);
        if (this.state.turn.phase === 'awaiting_end') this.advanceTurn();
        break;
      case 'settling_debt': {
        const debt = p.debt;
        if (debt) {
          this.liquidate(p, debt.amount);
          if (p.money >= debt.amount) this.autoSettleDebt(p);
          else this.bankrupt(p, debt.creditorId, debt.amount);
        }
        break;
      }
      case 'awaiting_end':
        this.advanceTurn();
        break;
      default:
        break;
    }
  }

  /* ================================================================ */
  /* Read helpers used by the transport layer                         */
  /* ================================================================ */

  applySettings(settings: GameSettings): void {
    this.state.settings = sanitizeSettings(settings);
    this.rebuildBoard();
    this.touch();
  }

  get isEmpty(): boolean {
    return this.state.players.length === 0;
  }

  get allDisconnected(): boolean {
    return this.state.players.every((p) => !p.connected);
  }

  static randomPiece(taken: PieceId[]): PieceId {
    const all: PieceId[] = ['robot', 'rocket', 'roadster', 'crown', 'starship', 'crystal', 'fox', 'hovercraft'];
    const free = all.filter((p) => !taken.includes(p));
    return free[pickIndex(free.length)] ?? all[0]!;
  }
}
