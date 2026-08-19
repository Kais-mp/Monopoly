/**
 * Client-only preferences: audio, accessibility, camera behaviour.
 *
 * These never touch the game rules — the server owns those. Everything here is
 * persisted locally so a player's comfort settings survive a refresh.
 */

export type Quality = 'high' | 'medium' | 'low';

export interface Prefs {
  playerName: string;
  musicOn: boolean;
  sfxOn: boolean;
  musicVolume: number;
  sfxVolume: number;
  /** Accessibility: drastically shortens or removes movement animation. */
  reducedMotion: boolean;
  /** Accessibility: turns off particles, bloom and other decorative effects. */
  reducedEffects: boolean;
  highContrast: boolean;
  uiScale: 'normal' | 'large' | 'xl';
  quality: Quality;
  /** Camera automatically frames whoever is taking their turn. */
  followActive: boolean;
  showTooltips: boolean;
}

const KEY = 'aurorabay.prefs.v1';

const DEFAULTS: Prefs = {
  playerName: '',
  musicOn: true,
  sfxOn: true,
  musicVolume: 0.32,
  sfxVolume: 0.7,
  reducedMotion: false,
  reducedEffects: false,
  highContrast: false,
  uiScale: 'normal',
  quality: 'high',
  followActive: true,
  showTooltips: true,
};

function detectQuality(): Quality {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || (mem !== undefined && mem <= 3) || cores <= 3) return 'medium';
  return 'high';
}

function load(): Prefs {
  const base: Prefs = { ...DEFAULTS, quality: detectQuality() };
  // Respect the OS-level motion preference on first run.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    base.reducedMotion = true;
    base.reducedEffects = true;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

export const prefs: Prefs = load();

type Listener = (p: Prefs) => void;
const listeners = new Set<Listener>();

export function onPrefsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (prefs[key] === value) return;
  prefs[key] = value;
  save();
  applyDocumentPrefs();
  for (const fn of listeners) fn(prefs);
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing — preferences simply won't persist */
  }
}

/** Mirrors accessibility prefs onto <html> so CSS can react to them. */
export function applyDocumentPrefs(): void {
  const el = document.documentElement;
  el.dataset.motion = prefs.reducedMotion ? 'reduced' : 'full';
  el.dataset.effects = prefs.reducedEffects ? 'low' : 'full';
  el.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
  el.dataset.uiscale = prefs.uiScale;
}

/* ------------------------------------------------------------------ */
/* Seat token storage (reconnect)                                      */
/* ------------------------------------------------------------------ */

interface Seat {
  roomCode: string;
  token: string;
  playerId: string;
  at: number;
}

const SEAT_KEY = 'aurorabay.seat.v1';
/** A seat older than this is almost certainly a dead room. */
const SEAT_TTL_MS = 6 * 60 * 60 * 1000;

export function saveSeat(seat: Omit<Seat, 'at'>): void {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify({ ...seat, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function loadSeat(): Seat | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const seat = JSON.parse(raw) as Seat;
    if (!seat?.token || !seat?.roomCode) return null;
    if (Date.now() - (seat.at ?? 0) > SEAT_TTL_MS) return null;
    return seat;
  } catch {
    return null;
  }
}

export function clearSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* ignore */
  }
}
