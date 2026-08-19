/**
 * Socket.IO message contract. Every mutating action is a request from the
 * client that the server validates; clients never mutate state locally.
 */
import type {
  GameFx,
  GameSettings,
  GameState,
  PieceId,
  TradeSide,
  ChatMessage,
} from './types';

export interface CreateRoomPayload {
  name: string;
  piece: PieceId;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  piece: PieceId;
  /** Present when reconnecting to a seat we already own. */
  token?: string;
}

export interface ResumePayload {
  roomCode: string;
  token: string;
}

export type ClientAction =
  | { type: 'set_profile'; name?: string; piece?: PieceId }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'update_settings'; settings: GameSettings }
  | { type: 'start_game' }
  | { type: 'roll_dice' }
  | { type: 'buy' }
  | { type: 'decline_purchase' }
  | { type: 'bid'; amount: number }
  | { type: 'auction_pass' }
  | { type: 'build'; spaceId: number }
  | { type: 'sell_building'; spaceId: number }
  | { type: 'mortgage'; spaceId: number }
  | { type: 'unmortgage'; spaceId: number }
  | { type: 'pay_detention_fee' }
  | { type: 'use_escape_card' }
  | { type: 'roll_for_escape' }
  | { type: 'end_turn' }
  | { type: 'propose_trade'; toId: string; offer: TradeSide; request: TradeSide; counterOf?: string }
  | { type: 'respond_trade'; tradeId: string; accept: boolean }
  | { type: 'cancel_trade'; tradeId: string }
  | { type: 'declare_bankruptcy' }
  | { type: 'chat'; text: string }
  | { type: 'kick'; playerId: string }
  | { type: 'restart' };

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** server -> client */
export interface ServerToClientEvents {
  'room:state': (payload: { state: GameState; fx: GameFx[] }) => void;
  'room:chat': (payload: ChatMessage) => void;
  /** Full history, sent once when a client joins or resumes. */
  'room:chatlog': (payload: { messages: ChatMessage[] }) => void;
  'room:closed': (payload: { reason: string }) => void;
  'room:error': (payload: { message: string }) => void;
  'room:you': (payload: { playerId: string; token: string; roomCode: string }) => void;
  pong2: (payload: { t: number }) => void;
}

/** client -> server */
export interface ClientToServerEvents {
  'room:create': (
    payload: CreateRoomPayload,
    ack: (res: { ok: boolean; error?: string; roomCode?: string; playerId?: string; token?: string }) => void,
  ) => void;
  'room:join': (
    payload: JoinRoomPayload,
    ack: (res: { ok: boolean; error?: string; roomCode?: string; playerId?: string; token?: string }) => void,
  ) => void;
  'room:resume': (
    payload: ResumePayload,
    ack: (res: { ok: boolean; error?: string; roomCode?: string; playerId?: string; token?: string }) => void,
  ) => void;
  'room:leave': (payload: Record<string, never>, ack: (res: ActionResult) => void) => void;
  action: (payload: ClientAction, ack: (res: ActionResult) => void) => void;
  ping2: (payload: { t: number }) => void;
}

export const MAX_CHAT_LENGTH = 240;
export const MAX_NAME_LENGTH = 16;
