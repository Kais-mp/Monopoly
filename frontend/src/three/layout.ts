/**
 * Board geometry.
 *
 * One source of truth for where every space sits in world units. The board
 * texture painter, the tile meshes, the buildings and the pieces all derive
 * their transforms from here, so nothing can drift out of alignment.
 */

/** Depth of a space, measured from the board edge inwards. */
export const TILE_DEPTH = 2.0;
/** Width of a regular (non-corner) space. */
export const TILE_WIDTH = 1.45;
/** Corner spaces are square. */
export const CORNER = TILE_DEPTH;
/** Spaces per side, excluding the two corners. */
export const PER_SIDE = 9;
/** Full outer edge length of the board. */
export const BOARD_SIZE = CORNER * 2 + TILE_WIDTH * PER_SIDE;
export const HALF = BOARD_SIZE / 2;
/** Height of the board slab's top surface above y=0. */
export const BOARD_TOP = 0.22;

export interface TileTransform {
  /** World position of the space's centre, on the board surface. */
  x: number;
  z: number;
  /** Rotation about Y so that local +Z points away from the board centre. */
  rotY: number;
  /** Footprint of this space. */
  width: number;
  depth: number;
  corner: boolean;
  /** 0 = bottom, 1 = left, 2 = top, 3 = right. */
  side: number;
}

const SIDE_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

/**
 * Space 0 is the bottom-right corner; the track runs anticlockwise when viewed
 * from above (left along the bottom, up the left side, and so on).
 */
export function tileTransform(index: number): TileTransform {
  const i = ((index % 40) + 40) % 40;
  const edgeCentre = HALF - TILE_DEPTH / 2;
  const firstOffset = HALF - CORNER;

  if (i === 0) return { x: edgeCentre, z: edgeCentre, rotY: SIDE_ROT[0]!, width: CORNER, depth: CORNER, corner: true, side: 0 };
  if (i === 10) return { x: -edgeCentre, z: edgeCentre, rotY: SIDE_ROT[1]!, width: CORNER, depth: CORNER, corner: true, side: 1 };
  if (i === 20) return { x: -edgeCentre, z: -edgeCentre, rotY: SIDE_ROT[2]!, width: CORNER, depth: CORNER, corner: true, side: 2 };
  if (i === 30) return { x: edgeCentre, z: -edgeCentre, rotY: SIDE_ROT[3]!, width: CORNER, depth: CORNER, corner: true, side: 3 };

  const side = Math.floor(i / 10);
  const n = i - side * 10; // 1..9
  const along = firstOffset - TILE_WIDTH * (n - 0.5);

  switch (side) {
    case 0:
      return { x: along, z: edgeCentre, rotY: SIDE_ROT[0]!, width: TILE_WIDTH, depth: TILE_DEPTH, corner: false, side: 0 };
    case 1:
      return { x: -edgeCentre, z: along, rotY: SIDE_ROT[1]!, width: TILE_WIDTH, depth: TILE_DEPTH, corner: false, side: 1 };
    case 2:
      return { x: -along, z: -edgeCentre, rotY: SIDE_ROT[2]!, width: TILE_WIDTH, depth: TILE_DEPTH, corner: false, side: 2 };
    default:
      return { x: edgeCentre, z: -along, rotY: SIDE_ROT[3]!, width: TILE_WIDTH, depth: TILE_DEPTH, corner: false, side: 3 };
  }
}

/** Converts a point in a space's local frame (+Z = outward) into world XZ. */
export function localToWorld(t: TileTransform, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(t.rotY);
  const c = Math.cos(t.rotY);
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c };
}

/** Unit vector pointing from the space towards the board centre. */
export function inward(t: TileTransform): { x: number; z: number } {
  return { x: -Math.sin(t.rotY), z: -Math.cos(t.rotY) };
}

/* ------------------------------------------------------------------ */
/* Slots                                                               */
/* ------------------------------------------------------------------ */

/** Local-space seats for up to six pieces standing on the same space. */
const PIECE_SLOTS: [number, number][] = [
  [-0.3, 0.14],
  [0.3, 0.14],
  [-0.3, -0.3],
  [0.3, -0.3],
  [0, 0.14],
  [0, -0.3],
];

export function pieceSlot(index: number, t: TileTransform): { x: number; z: number } {
  const slot = PIECE_SLOTS[index % PIECE_SLOTS.length]!;
  const scale = t.corner ? 1.25 : 1;
  return localToWorld(t, slot[0] * t.width * 0.62 * scale, slot[1] * scale);
}

/** Local-space positions for the four small buildings along the colour band. */
export function buildingSlot(index: number, t: TileTransform): { x: number; z: number } {
  const span = t.width * 0.66;
  const lx = -span / 2 + (span / 3) * index;
  return localToWorld(t, lx, -t.depth / 2 + 0.28);
}

/** Centre of the colour band, used for the level-5 landmark. */
export function bandCentre(t: TileTransform): { x: number; z: number } {
  return localToWorld(t, 0, -t.depth / 2 + 0.3);
}

/* ------------------------------------------------------------------ */
/* Texture-space mapping                                               */
/* ------------------------------------------------------------------ */

/**
 * The board top is a single canvas texture spanning the whole slab, so world
 * XZ maps linearly onto canvas pixels. Canvas +Y lines up with world +Z.
 */
export function worldToCanvas(x: number, z: number, canvasSize: number): { cx: number; cy: number } {
  const k = canvasSize / BOARD_SIZE;
  return { cx: (x + HALF) * k, cy: (z + HALF) * k };
}

export function unitsToPixels(units: number, canvasSize: number): number {
  return units * (canvasSize / BOARD_SIZE);
}

/** Canvas rotation (radians) that makes a space's text read from outside. */
export function canvasRotation(t: TileTransform): number {
  return -t.rotY;
}
