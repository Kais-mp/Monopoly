/**
 * Shared domain types for Aurora Bay.
 *
 * This file is the single source of truth for the wire protocol. The backend
 * compiles it directly; the frontend aliases it as `@shared/types`, so the two
 * sides can never drift apart.
 */

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

export type PieceId =
  | 'robot'
  | 'rocket'
  | 'roadster'
  | 'crown'
  | 'starship'
  | 'crystal'
  | 'fox'
  | 'hovercraft';

export const PIECE_IDS: PieceId[] = [
  'robot',
  'rocket',
  'roadster',
  'crown',
  'starship',
  'crystal',
  'fox',
  'hovercraft',
];

export interface PieceDef {
  id: PieceId;
  name: string;
  blurb: string;
}

export const PIECES: PieceDef[] = [
  { id: 'robot', name: 'Cogsworth', blurb: 'A dutiful dock-loader bot with a dented chest plate.' },
  { id: 'rocket', name: 'Ember Rocket', blurb: 'Retro finned rocket, permanently ready for launch.' },
  { id: 'roadster', name: 'Neon Roadster', blurb: 'Low-slung street racer with underglow.' },
  { id: 'crown', name: 'Harbour Crown', blurb: 'The old city crown, still gilded.' },
  { id: 'starship', name: 'Voidwing', blurb: 'Sleek survey ship from the orbital yards.' },
  { id: 'crystal', name: 'Prism Shard', blurb: 'A humming shard from the Crystal Ridge mines.' },
  { id: 'fox', name: 'Bay Fox', blurb: 'The city mascot. Fast, and slightly larcenous.' },
  { id: 'hovercraft', name: 'Skiff', blurb: 'Anti-grav skiff used by the harbour patrol.' },
];

/** Player colours, assigned by seat order. */
export const PLAYER_COLORS = [
  '#3ec7ff',
  '#ff5f8f',
  '#8bff6b',
  '#ffcb3d',
  '#b06bff',
  '#ff8a3d',
] as const;

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export type SpaceType =
  | 'start'
  | 'property'
  | 'transport'
  | 'utility'
  | 'tax'
  | 'event'
  | 'detention'
  | 'goto_detention'
  | 'rest'
  | 'bonus'
  | 'penalty';

export interface PropertyGroup {
  id: string;
  name: string;
  color: string;
}

/**
 * A board space after the host's multipliers have been applied. This is what
 * clients receive, so the UI never has to re-derive prices.
 */
export interface BoardSpace {
  id: number;
  name: string;
  type: SpaceType;
  flavor?: string;
  /** Property / transport / utility purchase price. */
  price?: number;
  /** Rent ladder: index 0 = unimproved, 1..5 = building levels. */
  rent?: number[];
  /** Cost of one building level. */
  buildCost?: number;
  group?: string;
  /** Tax / bonus / penalty amount. */
  amount?: number;
  /** Utilities multiply the dice roll instead of using a flat rent. */
  utilityMultipliers?: [number, number];
}

export interface PropertyState {
  spaceId: number;
  ownerId: string | null;
  level: number;
  mortgaged: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type RestStopMode = 'nothing' | 'fixed' | 'pot' | 'percent';
export type DoublesPenalty = 'detention' | 'lose_turn' | 'nothing';
export type VictoryMode = 'last_standing' | 'wealth_target' | 'turn_limit';
export type GameSpeed = 'slow' | 'normal' | 'fast';
export type EventFrequency = 'off' | 'low' | 'normal' | 'high';
export type BankruptcyAssetMode = 'to_creditor' | 'to_auction' | 'to_bank';

export interface MoneySettings {
  startingMoney: number;
  passStartAmount: number;
  landOnStartBonus: number;
  /** Percentages, 100 = unchanged. */
  propertyPriceMultiplier: number;
  rentMultiplier: number;
  buildCostMultiplier: number;
  taxMultiplier: number;
  /** Flat fee to leave detention. */
  detentionFee: number;
  /** Flat penalty applied by penalty spaces, percentage multiplier. */
  penaltyMultiplier: number;
}

export interface DiceSettings {
  count: number;
  sides: number;
  doublesGrantExtraTurn: boolean;
  maxConsecutiveDoubles: number;
  onMaxDoubles: DoublesPenalty;
  /** Every roll is boosted by this many spaces (0 = off). */
  bonusSpaces: number;
}

export interface PropertySettings {
  maxLevel: number;
  towerEnabled: boolean;
  evenBuildingRequired: boolean;
  buildingsRequireFullGroup: boolean;
  fullGroupRentMultiplier: number;
  mortgageEnabled: boolean;
  mortgageValuePercent: number;
  unmortgageInterestPercent: number;
  sellBuildingRefundPercent: number;
  auctionsEnabled: boolean;
  auctionSeconds: number;
  auctionMinIncrement: number;
  /** Rent still due on properties whose owner is in detention. */
  collectRentInDetention: boolean;
}

export interface DetentionSettings {
  enabled: boolean;
  turns: number;
  escapeWithDoubles: boolean;
  payToLeaveAllowed: boolean;
  cardsAllowed: boolean;
  /** Forced to pay the fee once the max turns are up. */
  mustPayAfterMaxTurns: boolean;
}

export interface RestStopSettings {
  mode: RestStopMode;
  fixedAmount: number;
  percentOfPot: number;
  potFromTaxes: boolean;
  potFromFees: boolean;
  potFromPenalties: boolean;
}

export interface EventSettings {
  enabled: boolean;
  frequency: EventFrequency;
  /** Percentage applied to every money amount on a card. */
  strength: number;
  /** Categories the host has switched off. */
  disabledCategories: EventCategory[];
}

export interface TradingSettings {
  enabled: boolean;
  allowMoney: boolean;
  allowProperties: boolean;
  allowMortgaged: boolean;
  allowEscapeCards: boolean;
  /** Trading permitted only during your own turn. */
  onlyOnYourTurn: boolean;
}

export interface BankruptcySettings {
  assetMode: BankruptcyAssetMode;
  /** Buildings are sold to the bank at this % when a player goes under. */
  buildingRefundPercent: number;
  /** Transferred properties arrive mortgaged. */
  transferMortgaged: boolean;
  eliminatePlayer: boolean;
}

export interface VictorySettings {
  mode: VictoryMode;
  wealthTarget: number;
  turnLimit: number;
}

export interface GameSettings {
  presetName: string;
  money: MoneySettings;
  dice: DiceSettings;
  property: PropertySettings;
  detention: DetentionSettings;
  restStop: RestStopSettings;
  events: EventSettings;
  trading: TradingSettings;
  bankruptcy: BankruptcySettings;
  victory: VictorySettings;
  speed: GameSpeed;
  maxPlayers: number;
  /** Seconds before a disconnected/idle player's turn is auto-played. 0 = off. */
  turnTimeLimit: number;
}

/* ------------------------------------------------------------------ */
/* Events (cards)                                                      */
/* ------------------------------------------------------------------ */

export type EventCategory = 'fortune' | 'setback' | 'movement' | 'civic' | 'chaos';

export type EventEffect =
  | { kind: 'money'; amount: number }
  | { kind: 'collect_from_each'; amount: number }
  | { kind: 'pay_each'; amount: number }
  | { kind: 'move_to'; space: number; collectStart: boolean }
  | { kind: 'move_relative'; steps: number }
  | { kind: 'move_nearest'; spaceType: 'transport' | 'utility'; rentMultiplier: number }
  | { kind: 'go_detention' }
  | { kind: 'escape_card' }
  | { kind: 'repairs'; perLevel: number; perTower: number }
  | { kind: 'rent_modifier'; multiplier: number; turns: number }
  | { kind: 'purchase_discount'; percent: number; turns: number }
  | { kind: 'all_move_relative'; steps: number }
  | { kind: 'pot_take' }
  | { kind: 'pot_add'; amount: number };

export interface EventCard {
  id: string;
  title: string;
  text: string;
  category: EventCategory;
  effects: EventEffect[];
}

export interface PlayerModifier {
  id: string;
  kind: 'rent_multiplier' | 'purchase_discount';
  value: number;
  turnsRemaining: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Players                                                             */
/* ------------------------------------------------------------------ */

export type PlayerStatus = 'lobby' | 'active' | 'detained' | 'bankrupt' | 'winner';

export interface Player {
  id: string;
  name: string;
  piece: PieceId;
  color: string;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  money: number;
  position: number;
  status: PlayerStatus;
  detentionTurns: number;
  escapeCards: number;
  bankrupt: boolean;
  turnsPlayed: number;
  netWorth: number;
  modifiers: PlayerModifier[];
  /** Outstanding debt that must be settled before the turn can end. */
  debt: { amount: number; creditorId: string | null } | null;
}

/* ------------------------------------------------------------------ */
/* Turn / phase                                                        */
/* ------------------------------------------------------------------ */

export type TurnPhase =
  | 'awaiting_roll'
  | 'resolving'
  | 'awaiting_purchase'
  | 'auction'
  | 'awaiting_end'
  | 'settling_debt'
  | 'detained'
  | 'game_over';

export interface TurnState {
  playerId: string | null;
  phase: TurnPhase;
  number: number;
  round: number;
  dice: number[];
  doublesCount: number;
  rolledThisTurn: boolean;
  /** Space awaiting a buy/pass decision. */
  pendingPurchase: number | null;
  /** Server timestamp (ms) when the turn is auto-played, or null. */
  deadline: number | null;
}

export interface AuctionState {
  spaceId: number;
  currentBid: number;
  highBidderId: string | null;
  activeBidders: string[];
  passed: string[];
  endsAt: number;
}

export interface TradeSide {
  money: number;
  properties: number[];
  escapeCards: number;
}

export interface TradeOffer {
  id: string;
  fromId: string;
  toId: string;
  offer: TradeSide;
  request: TradeSide;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'countered';
  counterOf: string | null;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  kind: 'chat' | 'system';
  playerId: string | null;
  playerName: string | null;
  color: string | null;
  text: string;
  at: number;
}

/* ------------------------------------------------------------------ */
/* Full game state                                                     */
/* ------------------------------------------------------------------ */

export type GamePhase = 'lobby' | 'playing' | 'finished';

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  settings: GameSettings;
  board: BoardSpace[];
  groups: PropertyGroup[];
  players: Player[];
  order: string[];
  properties: Record<number, PropertyState>;
  turn: TurnState;
  auction: AuctionState | null;
  trades: TradeOffer[];
  pot: number;
  winnerId: string | null;
  finalStandings: { playerId: string; name: string; netWorth: number; rank: number }[] | null;
  hostId: string | null;
  /** Bumped on every mutation, used by the client to drop stale snapshots. */
  version: number;
}

/* ------------------------------------------------------------------ */
/* Presentation effects (client animation cues)                        */
/* ------------------------------------------------------------------ */

export type GameFx =
  | { t: 'dice'; playerId: string; values: number[]; doubles: boolean }
  | { t: 'move'; playerId: string; from: number; to: number; path: number[]; reason: 'roll' | 'card' | 'detention' }
  | { t: 'money'; playerId: string; delta: number; reason: string }
  | { t: 'purchase'; playerId: string; spaceId: number }
  | { t: 'rent'; fromId: string; toId: string; amount: number; spaceId: number }
  | { t: 'build'; playerId: string; spaceId: number; level: number }
  | { t: 'demolish'; playerId: string; spaceId: number; level: number }
  | { t: 'mortgage'; spaceId: number; mortgaged: boolean }
  | { t: 'card'; playerId: string; card: EventCard }
  | { t: 'detention'; playerId: string; entering: boolean }
  | { t: 'bankrupt'; playerId: string; creditorId: string | null }
  | { t: 'victory'; playerId: string }
  | { t: 'trade'; fromId: string; toId: string }
  | { t: 'auction_won'; playerId: string; spaceId: number; amount: number }
  | { t: 'turn'; playerId: string };

/* ------------------------------------------------------------------ */
/* Lobby / room summaries                                              */
/* ------------------------------------------------------------------ */

export interface JoinResult {
  ok: boolean;
  error?: string;
  playerId?: string;
  token?: string;
  roomCode?: string;
}

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  settings: GameSettings;
  custom?: boolean;
}
