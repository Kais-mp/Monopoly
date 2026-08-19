/**
 * Paints the entire board face onto one canvas.
 *
 * Using a single 2K texture instead of 40 individually textured meshes keeps
 * the board to one draw call and one material, which matters a great deal on
 * integrated GPUs and phones. Everything interactive (hover, ownership tint,
 * buildings) is a separate lightweight mesh layered on top.
 */
import type { BoardSpace, PropertyGroup } from '@shared/types';
import { canvasRotation, tileTransform, unitsToPixels, worldToCanvas, HALF, BOARD_SIZE } from './layout';

export const BOARD_TEXTURE_SIZE = 2048;

type SpacedCtx = CanvasRenderingContext2D & { letterSpacing?: string };

/** letterSpacing is not in every TS DOM lib yet, and is a no-op where unsupported. */
function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  (ctx as SpacedCtx).letterSpacing = value;
}

const FONT = "'Segoe UI', system-ui, -apple-system, Arial, sans-serif";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
}

/* ------------------------------------------------------------------ */
/* Glyphs for the non-property spaces                                  */
/* ------------------------------------------------------------------ */

function glyph(ctx: CanvasRenderingContext2D, kind: string, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size / 2;
  switch (kind) {
    case 'start': {
      // Chevrons pointing the way round the track.
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(-s * 0.5 + i * s * 0.5, -s * 0.55);
        ctx.lineTo(s * 0.05 + i * s * 0.5, 0);
        ctx.lineTo(-s * 0.5 + i * s * 0.5, s * 0.55);
      }
      ctx.stroke();
      break;
    }
    case 'event': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 ${size * 0.9}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, size * 0.03);
      break;
    }
    case 'tax': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.95);
      ctx.lineTo(0, s * 0.95);
      ctx.stroke();
      ctx.font = `800 ${size * 0.72}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, size * 0.02);
      break;
    }
    case 'transport': {
      // Stylised rail carriage.
      ctx.beginPath();
      roundRect(ctx, -s * 0.7, -s * 0.85, s * 1.4, s * 1.35, s * 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.35);
      ctx.lineTo(s * 0.45, -s * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.4, s * 0.72, s * 0.2, 0, Math.PI * 2);
      ctx.arc(s * 0.4, s * 0.72, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'utility': {
      ctx.beginPath();
      ctx.moveTo(s * 0.28, -s * 0.95);
      ctx.lineTo(-s * 0.55, s * 0.1);
      ctx.lineTo(s * 0.02, s * 0.1);
      ctx.lineTo(-s * 0.24, s * 0.95);
      ctx.lineTo(s * 0.6, -s * 0.16);
      ctx.lineTo(s * 0.02, -s * 0.16);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'detention': {
      ctx.beginPath();
      roundRect(ctx, -s * 0.85, -s * 0.85, s * 1.7, s * 1.7, s * 0.2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * s * 0.42, -s * 0.85);
        ctx.lineTo(i * s * 0.42, s * 0.85);
      }
      ctx.stroke();
      break;
    }
    case 'goto_detention': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.25);
      ctx.lineTo(s * 0.35, s * 0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.0, -s * 0.2);
      ctx.lineTo(s * 0.5, s * 0.25);
      ctx.lineTo(s * 0.0, s * 0.7);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(s * 0.35 + i * s * 0.28, -s * 0.85);
        ctx.lineTo(s * 0.35 + i * s * 0.28, -s * 0.05);
      }
      ctx.stroke();
      break;
    }
    case 'rest': {
      // Fountain / garden ring.
      ctx.beginPath();
      ctx.arc(0, s * 0.35, s * 0.85, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35);
      ctx.lineTo(0, -s * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.7, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Board painter                                                       */
/* ------------------------------------------------------------------ */

export function paintBoard(
  board: BoardSpace[],
  groups: PropertyGroup[],
  size = BOARD_TEXTURE_SIZE,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const groupColor = new Map(groups.map((g) => [g.id, g.color]));
  const px = (u: number) => unitsToPixels(u, size);

  /* Interior ------------------------------------------------------- */
  const bg = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.62);
  bg.addColorStop(0, '#16263f');
  bg.addColorStop(0.55, '#101c2f');
  bg.addColorStop(1, '#0a1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Faint survey grid across the plaza.
  ctx.strokeStyle = 'rgba(90, 150, 210, 0.075)';
  ctx.lineWidth = 2;
  const step = px(0.72);
  ctx.beginPath();
  for (let p = step; p < size; p += step) {
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  // Concentric harbour rings.
  ctx.strokeStyle = 'rgba(62, 199, 255, 0.1)';
  for (let r = 0; r < 3; r++) {
    ctx.lineWidth = 3 - r;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, px(2.1 + r * 0.9), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Brand mark, set on the diagonal like a printed board.
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232, 241, 255, 0.9)';
  ctx.font = `200 ${px(0.95)}px ${FONT}`;
  setLetterSpacing(ctx, `${px(0.16)}px`);
  ctx.fillText('AURORA', 0, -px(0.62));
  ctx.fillStyle = 'rgba(62, 199, 255, 0.95)';
  ctx.font = `700 ${px(0.95)}px ${FONT}`;
  ctx.shadowColor = 'rgba(62, 199, 255, 0.55)';
  ctx.shadowBlur = px(0.5);
  ctx.fillText('BAY', 0, px(0.5));
  ctx.shadowBlur = 0;
  setLetterSpacing(ctx, `${px(0.06)}px`);
  ctx.font = `400 ${px(0.2)}px ${FONT}`;
  ctx.fillStyle = 'rgba(147, 167, 196, 0.75)';
  ctx.fillText('HARBOUR TRADING COMPANY', 0, px(1.25));
  setLetterSpacing(ctx, '0px');
  ctx.restore();

  /* Track background ------------------------------------------------ */
  const outer = worldToCanvas(-HALF, -HALF, size);
  const inner0 = worldToCanvas(-HALF + 2.0, -HALF + 2.0, size);
  const trackW = inner0.cx - outer.cx;
  ctx.fillStyle = '#0d1524';
  ctx.fillRect(0, 0, size, trackW);
  ctx.fillRect(0, size - trackW, size, trackW);
  ctx.fillRect(0, 0, trackW, size);
  ctx.fillRect(size - trackW, 0, trackW, size);

  /* Spaces ---------------------------------------------------------- */
  for (const space of board) {
    const t = tileTransform(space.id);
    const { cx, cy } = worldToCanvas(t.x, t.z, size);
    const w = px(t.width);
    const h = px(t.depth);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(canvasRotation(t));

    const pad = px(0.035);
    const x0 = -w / 2 + pad;
    const y0 = -h / 2 + pad;
    const tw = w - pad * 2;
    const th = h - pad * 2;

    // Base plate.
    const plate = ctx.createLinearGradient(0, y0, 0, y0 + th);
    plate.addColorStop(0, '#1a2740');
    plate.addColorStop(1, '#111b2e');
    ctx.fillStyle = plate;
    roundRect(ctx, x0, y0, tw, th, px(0.09));
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 190, 240, 0.16)';
    ctx.lineWidth = Math.max(1.5, px(0.012));
    ctx.stroke();

    const accent = space.group ? groupColor.get(space.group) ?? '#5a7290' : '#5a7290';
    let textTop = y0 + px(0.16);

    if (space.type === 'property') {
      const bandH = px(0.42);
      ctx.save();
      roundRect(ctx, x0, y0, tw, th, px(0.09));
      ctx.clip();
      const band = ctx.createLinearGradient(0, y0, 0, y0 + bandH);
      band.addColorStop(0, accent);
      band.addColorStop(1, shade(accent, -0.22));
      ctx.fillStyle = band;
      ctx.fillRect(x0, y0, tw, bandH);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(x0, y0 + bandH - px(0.035), tw, px(0.035));
      ctx.restore();
      textTop = y0 + bandH + px(0.13);
    }

    // Name.
    ctx.fillStyle = '#e8f1ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const nameSize = t.corner ? px(0.2) : px(0.17);
    ctx.font = `600 ${nameSize}px ${FONT}`;
    const lines = wrap(ctx, space.name.toUpperCase(), tw - px(0.1), t.corner ? 2 : 3);
    const lineH = nameSize * 1.16;
    lines.forEach((line, i) => ctx.fillText(line, 0, textTop + i * lineH));

    const afterName = textTop + lines.length * lineH;

    // Glyph for the non-property spaces.
    if (space.type !== 'property') {
      const gKind =
        space.type === 'bonus' || space.type === 'penalty' ? 'tax' : space.type;
      const gSize = t.corner ? px(0.62) : px(0.5);
      const gy = afterName + px(0.1) + gSize / 2;
      ctx.save();
      ctx.translate(0, Math.min(gy, y0 + th - gSize * 0.7 - px(0.16)));
      glyph(ctx, gKind, gSize, glyphColor(space.type));
      ctx.restore();
    }

    // Price strip along the outer edge.
    if (space.price !== undefined) {
      ctx.fillStyle = 'rgba(6, 12, 22, 0.55)';
      ctx.fillRect(x0, y0 + th - px(0.28), tw, px(0.28));
      ctx.fillStyle = '#9fd8ff';
      ctx.font = `700 ${px(0.16)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${space.price}`, 0, y0 + th - px(0.14));
    } else if (space.amount !== undefined && (space.type === 'tax' || space.type === 'penalty')) {
      ctx.fillStyle = 'rgba(6, 12, 22, 0.55)';
      ctx.fillRect(x0, y0 + th - px(0.28), tw, px(0.28));
      ctx.fillStyle = '#ff9db8';
      ctx.font = `700 ${px(0.16)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`PAY $${space.amount}`, 0, y0 + th - px(0.14));
    }

    ctx.restore();
  }

  /* Outer trim ------------------------------------------------------- */
  ctx.strokeStyle = 'rgba(62, 199, 255, 0.28)';
  ctx.lineWidth = px(0.045);
  ctx.strokeRect(px(0.02), px(0.02), size - px(0.04), size - px(0.04));

  return canvas;
}

function glyphColor(type: string): string {
  switch (type) {
    case 'start':
      return '#6bffb0';
    case 'event':
      return '#b06bff';
    case 'tax':
    case 'penalty':
      return '#ff5f8f';
    case 'transport':
      return '#3ec7ff';
    case 'utility':
      return '#ffcb3d';
    case 'detention':
    case 'goto_detention':
      return '#ff8a3d';
    case 'rest':
      return '#6bffb0';
    default:
      return '#93a7c4';
  }
}

/** Lighten (t>0) or darken (t<0) a hex colour. */
function shade(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Exported for the mini-map / lobby preview, which reuses the same painter. */
export const BOARD_WORLD_SIZE = BOARD_SIZE;
