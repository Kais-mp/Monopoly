/**
 * Presentation effects: floating numbers, ground rings, sparkles, confetti.
 *
 * All of them are cheap, self-expiring, and skipped entirely when the player
 * has asked for reduced effects.
 */
import * as THREE from 'three';
import { easeOut } from '../util';
import { prefs } from '../prefs';

/* ------------------------------------------------------------------ */
/* Floating text                                                       */
/* ------------------------------------------------------------------ */

const textCache = new Map<string, THREE.Texture>();

function textTexture(text: string, color: string): THREE.Texture {
  const key = `${text}|${color}`;
  const hit = textCache.get(key);
  if (hit) return hit;

  const pad = 24;
  const font = `700 64px 'Segoe UI', system-ui, Arial, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = 110;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4, 8, 16, 0.92)';
  ctx.lineWidth = 12;
  ctx.strokeText(text, w / 2, h / 2);
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = 0;
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Cache is bounded: the same handful of amounts repeat all game.
  if (textCache.size > 120) {
    const first = textCache.keys().next().value;
    if (first) {
      textCache.get(first)?.dispose();
      textCache.delete(first);
    }
  }
  textCache.set(key, tex);
  return tex;
}

interface FloatItem {
  sprite: THREE.Sprite;
  life: number;
  ttl: number;
  rise: number;
  drift: THREE.Vector3;
  baseW: number;
  baseH: number;
}

/* ------------------------------------------------------------------ */
/* Rings                                                               */
/* ------------------------------------------------------------------ */

interface RingItem {
  mesh: THREE.Mesh;
  life: number;
  ttl: number;
  from: number;
  to: number;
}

/* ------------------------------------------------------------------ */
/* Particles                                                           */
/* ------------------------------------------------------------------ */

interface BurstItem {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  ttl: number;
  gravity: number;
}

export class EffectsLayer {
  readonly group = new THREE.Group();
  private floats: FloatItem[] = [];
  private rings: RingItem[] = [];
  private bursts: BurstItem[] = [];
  private ringGeo = new THREE.RingGeometry(0.72, 1, 48);
  private particleTex: THREE.Texture;

  constructor() {
    this.group.name = 'effects';
    this.particleTex = makeParticleTexture();
  }

  /** A rising `+$200` / `-$150` label above a board position. */
  floatText(x: number, y: number, z: number, text: string, color: string, scale = 1): void {
    const material = new THREE.SpriteMaterial({
      map: textTexture(text, color),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    const tex = material.map!;
    const image = tex.image as HTMLCanvasElement;
    const aspect = image.width / image.height;
    const height = 0.52 * scale;
    sprite.scale.set(height * aspect, height, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 900;
    this.group.add(sprite);
    this.floats.push({
      sprite,
      life: 0,
      ttl: 1500,
      rise: 1.15,
      drift: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3),
      baseW: height * aspect,
      baseH: height,
    });
  }

  /** Expanding ground ring — used for landings, purchases and turn changes. */
  ring(x: number, z: number, color: string, from = 0.3, to = 1.6, ttl = 900): void {
    if (prefs.reducedEffects) return;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.24, z);
    mesh.renderOrder = 5;
    this.group.add(mesh);
    this.rings.push({ mesh, life: 0, ttl, from, to });
  }

  /** Small omnidirectional spark burst. */
  burst(x: number, y: number, z: number, color: string, count = 26, power = 2.6, ttl = 1100): void {
    if (prefs.reducedEffects) return;
    const n = Math.max(4, Math.round(count));
    const positions = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = 0.35 + Math.random() * 0.9;
      const r = (0.4 + Math.random()) * power;
      velocities[i * 3] = Math.cos(a) * r;
      velocities[i * 3 + 1] = up * power;
      velocities[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.14,
      map: this.particleTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 800;
    this.group.add(points);
    this.bursts.push({ points, velocities, life: 0, ttl, gravity: 5.2 });
  }

  /** Victory confetti, rained down over the whole board. */
  confetti(colors: string[], amount = 260): void {
    if (prefs.reducedEffects) {
      amount = Math.round(amount * 0.25);
    }
    const palette = colors.length > 0 ? colors : ['#3ec7ff'];
    for (let c = 0; c < palette.length; c++) {
      const n = Math.max(6, Math.round(amount / palette.length));
      const positions = new Float32Array(n * 3);
      const velocities = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 18;
        positions[i * 3 + 1] = 9 + Math.random() * 7;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
        velocities[i * 3] = (Math.random() - 0.5) * 1.1;
        velocities[i * 3 + 1] = -1.4 - Math.random() * 1.6;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: palette[c],
        size: 0.22,
        map: this.particleTex,
        transparent: true,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      this.group.add(points);
      this.bursts.push({ points, velocities, life: 0, ttl: 7000, gravity: 0.9 });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const item = this.floats[i]!;
      item.life += dtMs;
      const t = item.life / item.ttl;
      if (t >= 1) {
        item.sprite.material.map = null;
        item.sprite.material.dispose();
        this.group.remove(item.sprite);
        this.floats.splice(i, 1);
        continue;
      }
      item.sprite.position.y += item.rise * dt * (1 - t * 0.55);
      item.sprite.position.x += item.drift.x * dt;
      item.sprite.position.z += item.drift.z * dt;
      item.sprite.material.opacity = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.55) / 0.45);
      // Small pop as it appears, then hold at full size.
      const pop = t < 0.16 ? 0.62 + easeOut(t / 0.16) * 0.38 : 1;
      item.sprite.scale.set(item.baseW * pop, item.baseH * pop, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const item = this.rings[i]!;
      item.life += dtMs;
      const t = item.life / item.ttl;
      if (t >= 1) {
        (item.mesh.material as THREE.Material).dispose();
        this.group.remove(item.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      const s = item.from + (item.to - item.from) * easeOut(t);
      item.mesh.scale.set(s, s, s);
      (item.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const item = this.bursts[i]!;
      item.life += dtMs;
      const t = item.life / item.ttl;
      if (t >= 1) {
        item.points.geometry.dispose();
        (item.points.material as THREE.Material).dispose();
        this.group.remove(item.points);
        this.bursts.splice(i, 1);
        continue;
      }
      const attr = item.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let p = 0; p < arr.length; p += 3) {
        item.velocities[p + 1]! -= item.gravity * dt;
        arr[p] += item.velocities[p]! * dt;
        arr[p + 1] += item.velocities[p + 1]! * dt;
        arr[p + 2] += item.velocities[p + 2]! * dt;
        // Skitter along the board instead of sinking through it.
        if (arr[p + 1]! < 0.25) {
          arr[p + 1] = 0.25;
          item.velocities[p + 1] = Math.abs(item.velocities[p + 1]!) * 0.32;
          item.velocities[p]! *= 0.7;
          item.velocities[p + 2]! *= 0.7;
        }
      }
      attr.needsUpdate = true;
      (item.points.material as THREE.PointsMaterial).opacity = 1 - Math.max(0, (t - 0.6) / 0.4);
      (item.points.material as THREE.PointsMaterial).transparent = true;
    }
  }

  clear(): void {
    for (const f of this.floats) {
      f.sprite.material.dispose();
      this.group.remove(f.sprite);
    }
    for (const r of this.rings) {
      (r.mesh.material as THREE.Material).dispose();
      this.group.remove(r.mesh);
    }
    for (const b of this.bursts) {
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
      this.group.remove(b.points);
    }
    this.floats = [];
    this.rings = [];
    this.bursts = [];
  }

  dispose(): void {
    this.clear();
    this.ringGeo.dispose();
    this.particleTex.dispose();
  }
}

function makeParticleTexture(): THREE.Texture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
