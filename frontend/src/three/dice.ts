/**
 * 3D dice.
 *
 * The roll is pure theatre: the server has already decided the numbers, and the
 * animation is constructed backwards from them so the dice always come to rest
 * showing exactly what the server sent. Nothing here can change the outcome.
 */
import * as THREE from 'three';
import { easeOut } from '../util';

const SIZE = 0.46;

/** Face value carried by each BoxGeometry material slot: +X -X +Y -Y +Z -Z. */
const FACE_VALUES = [1, 6, 2, 5, 3, 4];

/** Euler angles that bring each face value to the top. */
const FACE_UP: Record<number, [number, number, number]> = {
  1: [0, 0, Math.PI / 2],
  2: [0, 0, 0],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
  5: [Math.PI, 0, 0],
  6: [0, 0, -Math.PI / 2],
};

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

const texCache = new Map<string, THREE.CanvasTexture>();

function faceTexture(value: number, accent: string): THREE.CanvasTexture {
  const key = `${value}|${accent}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const s = 192;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#f6fbff');
  grad.addColorStop(1, '#d5e4f5');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(30, 60, 100, 0.18)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, s - 6, s - 6);

  const pips = PIP_LAYOUT[value];
  if (pips) {
    const r = s * 0.082;
    const off = s * 0.26;
    for (const [px, py] of pips) {
      const cx = s / 2 + px * off;
      const cy = s / 2 + py * off;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = value === 1 ? accent : '#16233a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
    }
  } else {
    // Non-standard dice sizes fall back to a printed numeral.
    ctx.fillStyle = '#16233a';
    ctx.font = `700 ${s * 0.5}px 'Segoe UI', system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), s / 2, s / 2 + s * 0.02);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

interface Die {
  mesh: THREE.Mesh;
  /** Rest transform, computed when the roll starts. */
  restX: number;
  restZ: number;
  startX: number;
  startZ: number;
  startY: number;
  spin: THREE.Vector3;
  target: THREE.Quaternion;
  settleFrom: THREE.Quaternion;
  captured: boolean;
  delay: number;
}

export class DiceTray {
  readonly group = new THREE.Group();
  private dice: Die[] = [];
  private geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  private elapsed = 0;
  private duration = 0;
  private active = false;
  private accent = '#3ec7ff';
  private onLandCb: (() => void) | null = null;
  private landed = false;

  constructor() {
    this.group.visible = false;
  }

  get rolling(): boolean {
    return this.active;
  }

  setAccent(color: string): void {
    this.accent = color;
  }

  private materialsFor(value: number, sides: number): THREE.MeshStandardMaterial[] {
    // A d6 uses the canonical pip layout; other dice print the numbers, with
    // the rolled value guaranteed to sit on the face we rotate upwards.
    return FACE_VALUES.map((faceValue) => {
      let shown = faceValue;
      if (sides !== 6) {
        shown = faceValue === 2 ? value : 1 + ((faceValue * 7 + value) % sides);
      }
      return new THREE.MeshStandardMaterial({
        map: faceTexture(shown, this.accent),
        metalness: 0.08,
        roughness: 0.42,
      });
    });
  }

  /** Starts a roll that ends showing exactly `values`. */
  roll(values: number[], sides: number, durationMs: number, onLand?: () => void): void {
    this.clear();
    this.duration = Math.max(320, durationMs);
    this.elapsed = 0;
    this.active = true;
    this.landed = false;
    this.onLandCb = onLand ?? null;
    this.group.visible = true;

    const spread = Math.max(1, values.length - 1);
    values.forEach((value, i) => {
      const mesh = new THREE.Mesh(this.geometry, this.materialsFor(value, sides));
      mesh.castShadow = true;
      this.group.add(mesh);

      const lane = (i - spread / 2) * 0.72;
      const die: Die = {
        mesh,
        restX: lane + (Math.random() - 0.5) * 0.18,
        restZ: 1.1 + (Math.random() - 0.5) * 0.4,
        startX: lane * 0.4 - 2.4,
        startZ: 3.4,
        startY: 3.1 + Math.random() * 0.6,
        spin: new THREE.Vector3(
          6 + Math.random() * 9,
          5 + Math.random() * 8,
          6 + Math.random() * 9,
        ),
        // Face-up rotation plus a random yaw so identical rolls still look different.
        target: new THREE.Quaternion(),
        settleFrom: new THREE.Quaternion(),
        captured: false,
        delay: i * 0.05,
      };
      const e = FACE_UP[sides === 6 ? value : 2] ?? [0, 0, 0];
      die.target.setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
      const yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (Math.random() - 0.5) * 0.9,
      );
      die.target.premultiply(yaw);

      mesh.position.set(die.startX, die.startY, die.startZ);
      mesh.quaternion.identity();
      this.dice.push(die);
    });
  }

  update(dtMs: number): void {
    if (!this.active) return;
    this.elapsed += dtMs;
    const t = Math.min(1, this.elapsed / this.duration);
    const settleStart = 0.66;

    for (const die of this.dice) {
      const local = Math.min(1, Math.max(0, (t - die.delay) / (1 - die.delay)));
      const { mesh } = die;

      // Travel: a flat arc from off-board towards the resting spot.
      const travel = easeOut(Math.min(1, local / settleStart));
      mesh.position.x = die.startX + (die.restX - die.startX) * travel;
      mesh.position.z = die.startZ + (die.restZ - die.startZ) * travel;

      // Height: a launch arc plus two decaying bounces.
      const rest = SIZE / 2 + 0.01;
      if (local < settleStart) {
        const p = local / settleStart;
        const arc = Math.sin(p * Math.PI) * 1.3;
        const bounce = Math.abs(Math.sin(p * Math.PI * 3.1)) * 0.55 * (1 - p);
        mesh.position.y = rest + (die.startY - rest) * (1 - p) * (1 - p) + arc * (1 - p) + bounce;
        mesh.rotateX(die.spin.x * (dtMs / 1000));
        mesh.rotateY(die.spin.y * (dtMs / 1000));
        mesh.rotateZ(die.spin.z * (dtMs / 1000));
      } else {
        if (!die.captured) {
          die.settleFrom.copy(mesh.quaternion);
          die.captured = true;
        }
        const p = easeOut((local - settleStart) / (1 - settleStart));
        mesh.quaternion.slerpQuaternions(die.settleFrom, die.target, p);
        // One small hop as it comes to rest.
        mesh.position.y = rest + Math.max(0, Math.sin(p * Math.PI) * 0.16 * (1 - p));
      }
    }

    if (!this.landed && t >= 0.94) {
      this.landed = true;
      this.onLandCb?.();
    }
    if (t >= 1) {
      this.active = false;
      for (const die of this.dice) {
        die.mesh.position.y = SIZE / 2 + 0.01;
        die.mesh.quaternion.copy(die.target);
      }
    }
  }

  /** Fades the dice out once the turn moves on. */
  hide(): void {
    this.group.visible = false;
    this.active = false;
  }

  clear(): void {
    for (const die of this.dice) {
      const mats = die.mesh.material as THREE.Material[];
      mats.forEach((m) => m.dispose());
      this.group.remove(die.mesh);
    }
    this.dice = [];
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
  }
}
