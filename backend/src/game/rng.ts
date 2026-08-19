/**
 * All randomness lives on the server and uses the crypto RNG. Clients receive
 * results only — a browser can never influence a dice roll or a card draw.
 */
import { randomInt, randomUUID } from 'node:crypto';

export function rollDie(sides: number): number {
  return randomInt(1, sides + 1);
}

export function rollDice(count: number, sides: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rollDie(sides));
  return out;
}

export function pickIndex(length: number): number {
  if (length <= 0) return 0;
  return randomInt(0, length);
}

export function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const a = arr[i];
    const b = arr[j];
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

export function uuid(): string {
  return randomUUID();
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Ambiguous characters (0/O, 1/I) are excluded so codes read cleanly aloud. */
export function generateRoomCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ROOM_ALPHABET[randomInt(0, ROOM_ALPHABET.length)];
  return out;
}
