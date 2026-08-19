/** Small shared helpers. No DOM, no three — safe to import anywhere. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0..1 easing used by most of the presentation code. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Frame-rate independent damping factor for exponential smoothing. */
export function damp(dt: number, halfLife: number): number {
  return 1 - Math.pow(2, -dt / halfLife);
}

const moneyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function money(amount: number): string {
  const n = Math.round(amount);
  return (n < 0 ? '-$' : '$') + moneyFmt.format(Math.abs(n));
}

export function signedMoney(amount: number): string {
  const n = Math.round(amount);
  return (n < 0 ? '-$' : '+$') + moneyFmt.format(Math.abs(n));
}

export function shortMoney(amount: number): string {
  const n = Math.round(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${sign}$${Math.round(n / 1000)}k`;
  return sign + '$' + moneyFmt.format(n);
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Hex string -> {r,g,b} in 0..1, tolerant of `#abc` and missing hash. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 1, g: 1, b: 1 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Mix two hex colours; t=0 gives a, t=1 gives b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const to = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + to(lerp(ca.r, cb.r, t)) + to(lerp(ca.g, cb.g, t)) + to(lerp(ca.b, cb.b, t));
}

export function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Stable pseudo-random in 0..1 from an integer seed — used for decor placement. */
export function hashRandom(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
