/**
 * The 3D world.
 *
 * Holds the renderer, the board, the pieces and the effect queue. State
 * arriving from the server is applied immediately; the ordered `fx` stream is
 * replayed as animation so the table feels alive without the client ever being
 * the source of truth for anything.
 */
import * as THREE from 'three';
import type { GameFx, GameState } from '@shared/types';
import { clamp, damp, easeInOut, hashRandom } from '../util';
import { prefs } from '../prefs';
import { sfx } from '../audio/audio';
import { OrbitCam } from './camera';
import { BOARD_SIZE, BOARD_TOP, HALF, pieceSlot, tileTransform } from './layout';
import { paintBoard } from './boardTexture';
import { createPiece, disposePiece, type PieceObject } from './pieces';
import { createBuildings, disposeBuildings, type BuildingSet } from './buildings';
import { DiceTray } from './dice';
import { EffectsLayer } from './effects';
import { createEnvironment, type Environment } from './decor';

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

const SPEED_FACTOR = { slow: 1.35, normal: 1, fast: 0.62 } as const;

interface QueuedFx {
  fx: GameFx;
  /** Presentation time in ms; the queue waits this long before the next item. */
  hold: number;
}

interface PieceEntry {
  playerId: string;
  obj: PieceObject;
  /** Visual space index — lags behind state while a move animates. */
  space: number;
  anim: { path: number[]; index: number; t: number; stepMs: number } | null;
  pos: THREE.Vector3;
  bob: number;
  landing: number;
}

export interface WorldHooks {
  /** Fires when an effect starts playing, so the UI can sync modals/toasts. */
  onPresent?: (fx: GameFx) => void;
  onSpaceClick?: (spaceId: number) => void;
  onSpaceHover?: (spaceId: number | null, screenX: number, screenY: number) => void;
  /** Fires when the queue drains, used to release the "animating" UI lock. */
  onIdle?: () => void;
}

export class World {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: OrbitCam;
  private canvas: HTMLCanvasElement;
  private hooks: WorldHooks = {};

  private boardMesh: THREE.Mesh | null = null;
  private boardTexture: THREE.CanvasTexture | null = null;
  private tiles: THREE.Mesh[] = [];
  private tileMaterials: THREE.MeshBasicMaterial[] = [];
  private ownerBars: THREE.Mesh[] = [];
  private buildings = new Map<number, BuildingSet>();
  private pieces = new Map<string, PieceEntry>();
  private activeRing: THREE.Mesh | null = null;
  private highlight: THREE.Mesh | null = null;
  private dice = new DiceTray();
  private effects = new EffectsLayer();
  private environment: Environment | null = null;
  private keyLight: THREE.DirectionalLight;

  private state: GameState | null = null;
  private youId: string | null = null;
  private boardSignature = '';

  private queue: QueuedFx[] = [];
  private holdUntil = 0;
  private wasBusy = false;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerScreen = { x: 0, y: 0 };
  private hoverSpace: number | null = null;
  private pointerDownAt = { x: 0, y: 0, t: 0, moved: false };
  private pointerInside = false;

  private clock = new THREE.Clock();
  private elapsed = 0;
  private running = false;
  private frameHandle = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentDpr = 1;
  private detach: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: prefs.quality === 'high',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.currentDpr = this.targetDpr();
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = prefs.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#050912');
    this.scene.fog = new THREE.Fog('#050912', 42, 120);

    this.cam = new OrbitCam(canvas, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.cam.setLimits({ minDistance: 7, maxDistance: 54, panRadius: HALF - 1 });
    this.cam.reset(true);

    /* Lighting ------------------------------------------------------- */
    const hemi = new THREE.HemisphereLight('#8fc4ff', '#0b1424', 1.0);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
    this.keyLight.position.set(9, 17, 8);
    this.keyLight.castShadow = prefs.quality !== 'low';
    this.keyLight.shadow.mapSize.set(prefs.quality === 'high' ? 2048 : 1024, prefs.quality === 'high' ? 2048 : 1024);
    this.keyLight.shadow.camera.near = 4;
    this.keyLight.shadow.camera.far = 48;
    const s = BOARD_SIZE * 0.62;
    this.keyLight.shadow.camera.left = -s;
    this.keyLight.shadow.camera.right = s;
    this.keyLight.shadow.camera.top = s;
    this.keyLight.shadow.camera.bottom = -s;
    this.keyLight.shadow.bias = -0.0012;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Cool rim light from the opposite side keeps pieces from going flat.
    const rim = new THREE.DirectionalLight('#4f9dff', 0.9);
    rim.position.set(-11, 7, -9);
    this.scene.add(rim);

    const fill = new THREE.PointLight('#b06bff', 22, 40, 2);
    fill.position.set(0, 7, 0);
    this.scene.add(fill);

    this.environment = createEnvironment(prefs.quality);
    this.scene.add(this.environment.group);

    this.dice.group.position.set(0, BOARD_TOP, 0);
    this.scene.add(this.dice.group);
    this.scene.add(this.effects.group);

    this.buildIndicators();
    this.attachPointer();
    this.attachResize();
  }

  setHooks(hooks: WorldHooks): void {
    this.hooks = hooks;
  }

  private targetDpr(): number {
    const cap = prefs.quality === 'high' ? 2 : prefs.quality === 'medium' ? 1.5 : 1;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  /* ---------------------------------------------------------------- */
  /* Board construction                                                */
  /* ---------------------------------------------------------------- */

  /** Rebuilt only when the board itself changes (new game, new multipliers). */
  private ensureBoard(state: GameState): void {
    const signature = `${state.board.length}|${state.board.map((b) => `${b.id}:${b.price ?? 0}`).join(',')}`;
    if (signature === this.boardSignature) return;
    this.boardSignature = signature;
    this.teardownBoard();

    const canvas = paintBoard(state.board, state.groups);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.boardTexture = texture;

    const slabGeo = new THREE.BoxGeometry(BOARD_SIZE, BOARD_TOP, BOARD_SIZE);
    const sideMat = new THREE.MeshStandardMaterial({ color: '#0b1220', metalness: 0.5, roughness: 0.6 });
    const topMat = new THREE.MeshStandardMaterial({ map: texture, metalness: 0.12, roughness: 0.78 });
    // BoxGeometry material order: +X -X +Y -Y +Z -Z — only the top is painted.
    const slab = new THREE.Mesh(slabGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    slab.position.y = BOARD_TOP / 2;
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.boardMesh = slab;

    /* Per-space interaction + ownership overlays --------------------- */
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    for (const space of state.board) {
      const t = tileTransform(space.id);
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const tile = new THREE.Mesh(planeGeo, mat);
      tile.rotation.x = -Math.PI / 2;
      tile.rotation.z = -t.rotY;
      tile.position.set(t.x, BOARD_TOP + 0.006, t.z);
      tile.scale.set(t.width * 0.96, t.depth * 0.96, 1);
      tile.userData.spaceId = space.id;
      tile.renderOrder = 2;
      this.scene.add(tile);
      this.tiles.push(tile);
      this.tileMaterials.push(mat);

      // Thin ownership bar along the outer edge of ownable spaces.
      if (space.price !== undefined) {
        const barMat = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0,
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(t.width * 0.88, 0.06, 0.08), barMat);
        const outward = new THREE.Vector3(Math.sin(t.rotY), 0, Math.cos(t.rotY)).multiplyScalar(t.depth / 2 - 0.09);
        bar.position.set(t.x + outward.x, BOARD_TOP + 0.03, t.z + outward.z);
        bar.rotation.y = t.rotY;
        bar.userData.spaceId = space.id;
        this.scene.add(bar);
        this.ownerBars.push(bar);
      }
    }
  }

  private buildIndicators(): void {
    const ringGeo = new THREE.RingGeometry(0.34, 0.44, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#3ec7ff',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.activeRing = new THREE.Mesh(ringGeo, ringMat);
    this.activeRing.rotation.x = -Math.PI / 2;
    this.activeRing.position.y = BOARD_TOP + 0.012;
    this.activeRing.visible = false;
    this.activeRing.renderOrder = 4;
    this.scene.add(this.activeRing);

    const hlGeo = new THREE.PlaneGeometry(1, 1);
    const hlMat = new THREE.MeshBasicMaterial({
      color: '#9ff4ff',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.highlight = new THREE.Mesh(hlGeo, hlMat);
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.visible = false;
    this.highlight.renderOrder = 3;
    this.scene.add(this.highlight);
  }

  private teardownBoard(): void {
    if (this.boardMesh) {
      this.boardMesh.geometry.dispose();
      (this.boardMesh.material as THREE.Material[]).forEach((m) => m.dispose());
      this.scene.remove(this.boardMesh);
      this.boardMesh = null;
    }
    this.boardTexture?.dispose();
    this.boardTexture = null;
    for (const tile of this.tiles) {
      (tile.material as THREE.Material).dispose();
      this.scene.remove(tile);
    }
    this.tiles = [];
    this.tileMaterials = [];
    for (const bar of this.ownerBars) {
      bar.geometry.dispose();
      (bar.material as THREE.Material).dispose();
      this.scene.remove(bar);
    }
    this.ownerBars = [];
    for (const set of this.buildings.values()) disposeBuildings(set);
    this.buildings.clear();
  }

  /* ---------------------------------------------------------------- */
  /* State application                                                 */
  /* ---------------------------------------------------------------- */

  setState(state: GameState, youId: string | null): void {
    const first = this.state === null;
    this.state = state;
    this.youId = youId;
    this.ensureBoard(state);
    this.syncPieces(state, first);
    this.syncBuildings(state);
    this.syncOwnership(state);
  }

  private syncPieces(state: GameState, snap: boolean): void {
    const seen = new Set<string>();
    for (const player of state.players) {
      seen.add(player.id);
      let entry = this.pieces.get(player.id);
      if (!entry) {
        const obj = createPiece(player.piece, player.color);
        this.scene.add(obj.root);
        entry = {
          playerId: player.id,
          obj,
          space: player.position,
          anim: null,
          pos: new THREE.Vector3(),
          bob: hashRandom(player.id.charCodeAt(0) + player.position) * Math.PI * 2,
          landing: 0,
        };
        this.pieces.set(player.id, entry);
        const t = tileTransform(player.position);
        entry.pos.set(t.x, BOARD_TOP, t.z);
        entry.obj.root.position.copy(entry.pos);
      } else if (entry.obj.pieceId !== player.piece) {
        // The player changed their piece in the lobby.
        disposePiece(entry.obj);
        const obj = createPiece(player.piece, player.color);
        this.scene.add(obj.root);
        entry.obj = obj;
      }
      // Bankrupt players leave the table.
      entry.obj.root.visible = !player.bankrupt;
      if (snap && !entry.anim) entry.space = player.position;
    }
    for (const [id, entry] of [...this.pieces]) {
      if (seen.has(id)) continue;
      disposePiece(entry.obj);
      this.pieces.delete(id);
    }
  }

  private syncBuildings(state: GameState): void {
    const maxLevel = state.settings.property.maxLevel;
    const towerEnabled = state.settings.property.towerEnabled;
    for (const space of state.board) {
      const prop = state.properties[space.id];
      const level = prop && !prop.mortgaged ? prop.level : 0;
      const existing = this.buildings.get(space.id);
      if ((existing?.level ?? 0) === level) continue;
      if (existing) {
        disposeBuildings(existing);
        this.buildings.delete(space.id);
      }
      if (level <= 0) continue;
      const owner = state.players.find((p) => p.id === prop?.ownerId);
      const groupColor = state.groups.find((g) => g.id === space.group)?.color ?? owner?.color ?? '#3ec7ff';
      const set = createBuildings(level, tileTransform(space.id), groupColor, maxLevel, towerEnabled);
      set.group.position.y = BOARD_TOP;
      this.scene.add(set.group);
      this.buildings.set(space.id, set);
    }
  }

  private syncOwnership(state: GameState): void {
    for (const bar of this.ownerBars) {
      const spaceId = bar.userData.spaceId as number;
      const prop = state.properties[spaceId];
      const mat = bar.material as THREE.MeshStandardMaterial;
      const owner = prop?.ownerId ? state.players.find((p) => p.id === prop.ownerId) : null;
      if (!owner) {
        mat.opacity = 0;
        bar.visible = false;
        continue;
      }
      bar.visible = true;
      mat.color.set(owner.color);
      mat.emissive.set(owner.color);
      mat.opacity = prop?.mortgaged ? 0.28 : 0.95;
      mat.emissiveIntensity = prop?.mortgaged ? 0.2 : 1.3;
      mat.transparent = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Effect queue                                                      */
  /* ---------------------------------------------------------------- */

  private speed(): number {
    if (prefs.reducedMotion) return 0.3;
    return SPEED_FACTOR[this.state?.settings.speed ?? 'normal'];
  }

  enqueue(effects: GameFx[]): void {
    for (const fx of effects) this.queue.push({ fx, hold: 0 });
    // A reconnect can deliver a long backlog; collapse it so the player is not
    // stuck watching several minutes of catch-up animation.
    if (this.queue.length > 14) {
      const drop = this.queue.splice(0, this.queue.length - 10);
      for (const item of drop) this.applyInstant(item.fx);
    }
  }

  get busy(): boolean {
    return this.queue.length > 0 || performance.now() < this.holdUntil || this.dice.rolling;
  }

  private applyInstant(item: GameFx): void {
    // Fast-forward: apply the visual consequence without the animation.
    if (item.t === 'move') {
      const entry = this.pieces.get(item.playerId);
      if (entry) {
        entry.space = item.to;
        entry.anim = null;
      }
    }
  }

  private pump(now: number): void {
    if (now < this.holdUntil) return;
    const next = this.queue.shift();
    if (!next) {
      if (this.wasBusy && !this.busy) {
        this.wasBusy = false;
        this.hooks.onIdle?.();
      }
      return;
    }
    this.wasBusy = true;
    const hold = this.play(next.fx);
    this.holdUntil = now + hold;
    this.hooks.onPresent?.(next.fx);
  }

  /** Starts one effect and returns how long the queue should wait for it. */
  private play(fx: GameFx): number {
    const k = this.speed();
    const state = this.state;
    switch (fx.t) {
      case 'dice': {
        const player = state?.players.find((p) => p.id === fx.playerId);
        this.dice.setAccent(player?.color ?? '#3ec7ff');
        const dur = 1500 * k;
        this.dice.roll(fx.values, state?.settings.dice.sides ?? 6, dur, () => sfx('land'));
        sfx('dice');
        return dur * 0.72;
      }
      case 'move': {
        const entry = this.pieces.get(fx.playerId);
        if (!entry) return 0;
        const path = fx.path.length > 0 ? fx.path : [fx.to];
        const stepMs = clamp(280 * k, 55, 420);
        // Long hops (a card teleport) should not take forever.
        const total = Math.min(stepMs * path.length, 3400 * k);
        const perStep = total / Math.max(1, path.length);
        entry.anim = { path, index: 0, t: 0, stepMs: perStep };
        if (prefs.followActive) this.focusSpace(fx.to);
        return total + 120;
      }
      case 'money': {
        const entry = this.pieces.get(fx.playerId);
        const player = state?.players.find((p) => p.id === fx.playerId);
        if (entry) {
          const positive = fx.delta >= 0;
          this.effects.floatText(
            entry.pos.x,
            entry.pos.y + 1.1,
            entry.pos.z,
            `${positive ? '+' : '-'}$${Math.abs(Math.round(fx.delta))}`,
            positive ? '#6bffb0' : '#ff5f8f',
          );
          if (positive) this.effects.burst(entry.pos.x, entry.pos.y + 0.7, entry.pos.z, '#6bffb0', 14, 1.6, 800);
        }
        sfx(fx.delta >= 0 ? 'money_in' : 'money_out', 90);
        void player;
        return 220 * k;
      }
      case 'purchase': {
        const t = tileTransform(fx.spaceId);
        const player = state?.players.find((p) => p.id === fx.playerId);
        this.effects.ring(t.x, t.z, player?.color ?? '#3ec7ff', 0.4, 1.9, 900);
        this.effects.burst(t.x, BOARD_TOP + 0.4, t.z, player?.color ?? '#3ec7ff', 22, 2.2, 900);
        this.pulseTile(fx.spaceId, player?.color ?? '#3ec7ff');
        sfx('buy');
        return 520 * k;
      }
      case 'rent': {
        const from = this.pieces.get(fx.fromId);
        const to = this.pieces.get(fx.toId);
        if (from) {
          this.effects.floatText(from.pos.x, from.pos.y + 1.1, from.pos.z, `-$${fx.amount}`, '#ff5f8f');
        }
        if (to) {
          this.effects.floatText(to.pos.x, to.pos.y + 1.35, to.pos.z, `+$${fx.amount}`, '#6bffb0');
          this.effects.ring(to.pos.x, to.pos.z, '#6bffb0', 0.3, 1.2, 700);
        }
        this.pulseTile(fx.spaceId, '#ffcb3d');
        sfx('money_out');
        return 640 * k;
      }
      case 'build': {
        const t = tileTransform(fx.spaceId);
        this.effects.burst(t.x, BOARD_TOP + 0.5, t.z, '#ffcb3d', 20, 2.0, 800);
        this.effects.ring(t.x, t.z, '#ffcb3d', 0.3, 1.3, 700);
        sfx('build');
        return 460 * k;
      }
      case 'demolish': {
        const t = tileTransform(fx.spaceId);
        this.effects.burst(t.x, BOARD_TOP + 0.35, t.z, '#93a7c4', 16, 1.5, 700);
        sfx('demolish');
        return 360 * k;
      }
      case 'mortgage': {
        this.pulseTile(fx.spaceId, fx.mortgaged ? '#ff5f8f' : '#6bffb0');
        sfx('click');
        return 240 * k;
      }
      case 'card': {
        const entry = this.pieces.get(fx.playerId);
        if (entry) this.effects.burst(entry.pos.x, entry.pos.y + 0.9, entry.pos.z, '#b06bff', 26, 2.4, 1000);
        sfx('card');
        // Long enough for the card modal to be read.
        return 1900 * k;
      }
      case 'detention': {
        const entry = this.pieces.get(fx.playerId);
        if (entry && fx.entering) {
          this.effects.burst(entry.pos.x, entry.pos.y + 0.6, entry.pos.z, '#ff8a3d', 22, 2.0, 900);
          sfx('detention');
        }
        return 420 * k;
      }
      case 'bankrupt': {
        const entry = this.pieces.get(fx.playerId);
        if (entry) {
          this.effects.burst(entry.pos.x, entry.pos.y + 0.6, entry.pos.z, '#ff5f8f', 40, 3.2, 1400);
          this.effects.ring(entry.pos.x, entry.pos.z, '#ff5f8f', 0.4, 3.0, 1200);
        }
        sfx('bankrupt');
        return 1100 * k;
      }
      case 'victory': {
        const entry = this.pieces.get(fx.playerId);
        const colors = (this.state?.players ?? []).map((p) => p.color);
        this.effects.confetti(colors, 320);
        if (entry) {
          this.cam.lookAtPoint(entry.pos.x, entry.pos.z, 12, true);
          this.effects.ring(entry.pos.x, entry.pos.z, '#ffcb3d', 0.4, 4, 1800);
        }
        sfx('victory');
        return 1400 * k;
      }
      case 'trade': {
        const a = this.pieces.get(fx.fromId);
        const b = this.pieces.get(fx.toId);
        for (const entry of [a, b]) {
          if (entry) this.effects.burst(entry.pos.x, entry.pos.y + 0.8, entry.pos.z, '#b06bff', 18, 2.0, 900);
        }
        sfx('trade');
        return 520 * k;
      }
      case 'auction_won': {
        const t = tileTransform(fx.spaceId);
        const player = state?.players.find((p) => p.id === fx.playerId);
        this.effects.ring(t.x, t.z, player?.color ?? '#ffcb3d', 0.4, 2.0, 900);
        this.pulseTile(fx.spaceId, player?.color ?? '#ffcb3d');
        sfx('buy');
        return 560 * k;
      }
      case 'turn': {
        this.dice.hide();
        sfx('turn');
        if (prefs.followActive) {
          const player = state?.players.find((p) => p.id === fx.playerId);
          if (player) this.focusSpace(player.position);
        }
        return 180 * k;
      }
      default:
        return 0;
    }
  }

  private pulseTile(spaceId: number, color: string): void {
    const index = this.tiles.findIndex((t) => t.userData.spaceId === spaceId);
    if (index < 0) return;
    const mat = this.tileMaterials[index]!;
    mat.color.set(color);
    mat.opacity = 0.55;
    mat.userData.decay = true;
  }

  private focusSpace(spaceId: number): void {
    if (!prefs.followActive || this.cam.isUserControlling) return;
    const t = tileTransform(spaceId);
    // Pull the look-at point towards the middle so the board stays in frame.
    this.cam.lookAtPoint(t.x * 0.45, t.z * 0.45, undefined);
    // Face the side the piece is on so it is never behind the camera.
    this.cam.faceAngle(t.side * (Math.PI / 2));
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.frameHandle = requestAnimationFrame(loop);
      this.frame();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const dtMs = dt * 1000;
    this.elapsed += dtMs;
    const now = performance.now();

    this.pump(now);
    this.updatePieces(dt, dtMs);
    this.dice.update(dtMs);
    this.effects.update(dtMs);
    this.environment?.update(this.elapsed);
    this.updateIndicators(dt);
    this.decayTiles(dt);
    this.cam.update(dt);
    this.keyLight.target.position.set(0, 0, 0);

    this.renderer.render(this.scene, this.cam.camera);
    this.adaptQuality(dtMs);
  }

  /** Drops the pixel ratio if we cannot hold a smooth frame rate. */
  private adaptQuality(dtMs: number): void {
    this.fpsAccum += dtMs;
    this.fpsFrames++;
    if (this.fpsAccum < 2000) return;
    const avg = this.fpsAccum / this.fpsFrames;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    if (avg > 26 && this.currentDpr > 1) {
      this.currentDpr = Math.max(1, this.currentDpr - 0.25);
      this.renderer.setPixelRatio(this.currentDpr);
    } else if (avg < 15 && this.currentDpr < this.targetDpr()) {
      this.currentDpr = Math.min(this.targetDpr(), this.currentDpr + 0.25);
      this.renderer.setPixelRatio(this.currentDpr);
    }
  }

  private updatePieces(dt: number, dtMs: number): void {
    const state = this.state;
    if (!state) return;

    // Stable slot assignment: order pieces on a space by seat order.
    const occupancy = new Map<number, string[]>();
    const order = state.order.length > 0 ? state.order : state.players.map((p) => p.id);
    for (const id of order) {
      const entry = this.pieces.get(id);
      const player = state.players.find((p) => p.id === id);
      if (!entry || !player || player.bankrupt) continue;
      const space = entry.anim ? entry.anim.path[Math.min(entry.anim.index, entry.anim.path.length - 1)]! : entry.space;
      const list = occupancy.get(space) ?? [];
      list.push(id);
      occupancy.set(space, list);
    }

    for (const [id, entry] of this.pieces) {
      const player = state.players.find((p) => p.id === id);
      if (!player) continue;

      if (entry.anim) {
        this.advanceMove(entry, dtMs);
      } else if (entry.space !== player.position) {
        // No animation arrived (fast-forward, reconnect) — snap.
        entry.space = player.position;
      }

      const t = tileTransform(entry.space);
      const list = occupancy.get(entry.space) ?? [id];
      const slotIndex = Math.max(0, list.indexOf(id));
      const slot = pieceSlot(slotIndex, t);

      if (entry.anim) {
        // While moving, the animator owns the position.
        entry.obj.root.position.copy(entry.pos);
      } else {
        const target = new THREE.Vector3(slot.x, BOARD_TOP, slot.z);
        entry.pos.lerp(target, damp(dt, 0.09));
        entry.obj.root.position.copy(entry.pos);
        const facing = t.rotY + Math.PI;
        entry.obj.root.rotation.y += (facing - entry.obj.root.rotation.y) * damp(dt, 0.12);
      }

      /* Idle life ---------------------------------------------------- */
      entry.bob += dt * 1.7;
      const isActive = state.turn.playerId === id;
      const bobAmount = prefs.reducedMotion ? 0 : isActive ? 0.055 : 0.022;
      entry.obj.inner.position.y = Math.sin(entry.bob) * bobAmount;
      entry.obj.inner.rotation.z = Math.sin(entry.bob * 0.6) * (prefs.reducedMotion ? 0 : 0.035);

      if (entry.landing > 0) {
        entry.landing = Math.max(0, entry.landing - dtMs);
        const p = 1 - entry.landing / 320;
        entry.obj.inner.position.y += Math.sin(p * Math.PI) * 0.22;
        entry.obj.inner.scale.set(1 + (1 - p) * 0.08, 1 - (1 - p) * 0.1, 1 + (1 - p) * 0.08);
      } else {
        entry.obj.inner.scale.setScalar(1);
      }

      // Detained pieces sit lower and slightly tilted.
      if (player.status === 'detained') {
        entry.obj.inner.position.y -= 0.06;
        entry.obj.inner.rotation.z += 0.12;
      }

      for (const part of entry.obj.animated) {
        part.rotation.y += dt * 1.6;
        const pulse = 0.85 + Math.sin(this.elapsed / 260 + entry.bob) * 0.15;
        part.scale.setScalar(pulse);
      }
    }
  }

  private advanceMove(entry: PieceEntry, dtMs: number): void {
    const anim = entry.anim!;
    anim.t += dtMs;
    const step = Math.min(1, anim.t / anim.stepMs);
    const fromSpace = anim.index === 0 ? entry.space : anim.path[anim.index - 1]!;
    const toSpace = anim.path[anim.index]!;
    const a = tileTransform(fromSpace);
    const b = tileTransform(toSpace);

    const e = easeInOut(step);
    const x = a.x + (b.x - a.x) * e;
    const z = a.z + (b.z - a.z) * e;
    // A hop arc per space; short steps get a lower arc so fast play stays calm.
    const arcHeight = clamp(anim.stepMs / 280, 0.35, 1) * 0.34;
    const y = BOARD_TOP + Math.sin(step * Math.PI) * arcHeight;
    entry.pos.set(x, y, z);

    // Face the direction of travel.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
      const yaw = Math.atan2(dx, dz);
      const cur = entry.obj.root.rotation.y;
      let target = yaw;
      while (target - cur > Math.PI) target -= Math.PI * 2;
      while (cur - target > Math.PI) target += Math.PI * 2;
      entry.obj.root.rotation.y = cur + (target - cur) * 0.24;
    }

    if (step >= 1) {
      entry.space = toSpace;
      anim.index++;
      anim.t = 0;
      sfx('step', 40);
      if (anim.index >= anim.path.length) {
        entry.anim = null;
        entry.landing = 320;
        sfx('land', 60);
        const t = tileTransform(entry.space);
        this.effects.ring(t.x, t.z, '#9ff4ff', 0.25, 0.9, 520);
      }
    }
  }

  private updateIndicators(dt: number): void {
    const state = this.state;
    if (!this.activeRing) return;
    const activeId = state?.turn.playerId ?? null;
    const entry = activeId ? this.pieces.get(activeId) : null;
    const player = state?.players.find((p) => p.id === activeId);
    if (!entry || !player || state?.phase !== 'playing') {
      this.activeRing.visible = false;
    } else {
      this.activeRing.visible = true;
      this.activeRing.position.set(entry.pos.x, BOARD_TOP + 0.014, entry.pos.z);
      this.activeRing.rotation.z += dt * 0.9;
      const mat = this.activeRing.material as THREE.MeshBasicMaterial;
      mat.color.set(player.color);
      mat.opacity = 0.55 + Math.sin(this.elapsed / 300) * 0.25;
      const pulse = 1 + Math.sin(this.elapsed / 340) * 0.06;
      this.activeRing.scale.setScalar(pulse);
    }

    if (this.highlight) {
      if (this.hoverSpace === null) {
        this.highlight.visible = false;
      } else {
        const t = tileTransform(this.hoverSpace);
        this.highlight.visible = true;
        this.highlight.position.set(t.x, BOARD_TOP + 0.009, t.z);
        this.highlight.rotation.z = -t.rotY;
        this.highlight.scale.set(t.width * 0.94, t.depth * 0.94, 1);
      }
    }

    for (const [, set] of this.buildings) {
      for (const part of set.animated) {
        const mat = (part as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat?.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = 1.6 + Math.sin(this.elapsed / 380) * 1.0;
        }
      }
    }
  }

  private decayTiles(dt: number): void {
    for (const mat of this.tileMaterials) {
      if (!mat.userData.decay) continue;
      mat.opacity = Math.max(0, mat.opacity - dt * 0.9);
      if (mat.opacity <= 0.001) {
        mat.opacity = 0;
        mat.userData.decay = false;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Interaction                                                       */
  /* ---------------------------------------------------------------- */

  private attachPointer(): void {
    const el = this.canvas;

    const setPointer = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      this.pointerScreen.x = ev.clientX;
      this.pointerScreen.y = ev.clientY;
    };

    const onMove = (ev: PointerEvent) => {
      setPointer(ev);
      this.pointerInside = true;
      if (this.pointerDownAt.t > 0) {
        const dist = Math.hypot(ev.clientX - this.pointerDownAt.x, ev.clientY - this.pointerDownAt.y);
        if (dist > 6) this.pointerDownAt.moved = true;
      }
      const hit = this.pickSpace();
      if (hit !== this.hoverSpace) {
        this.hoverSpace = hit;
        this.hooks.onSpaceHover?.(hit, this.pointerScreen.x, this.pointerScreen.y);
        if (hit !== null) sfx('hover', 220);
      } else if (hit !== null) {
        this.hooks.onSpaceHover?.(hit, this.pointerScreen.x, this.pointerScreen.y);
      }
    };

    const onDown = (ev: PointerEvent) => {
      setPointer(ev);
      this.pointerDownAt = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false };
    };

    const onUp = (ev: PointerEvent) => {
      const wasTap =
        this.pointerDownAt.t > 0 && !this.pointerDownAt.moved && performance.now() - this.pointerDownAt.t < 600;
      this.pointerDownAt.t = 0;
      if (!wasTap || ev.button !== 0) return;
      setPointer(ev);
      const hit = this.pickSpace();
      if (hit !== null) {
        sfx('click');
        this.hooks.onSpaceClick?.(hit);
      }
    };

    const onLeave = () => {
      this.pointerInside = false;
      if (this.hoverSpace !== null) {
        this.hoverSpace = null;
        this.hooks.onSpaceHover?.(null, 0, 0);
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    this.detach.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    });
  }

  private pickSpace(): number | null {
    if (this.tiles.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.cam.camera);
    const hits = this.raycaster.intersectObjects(this.tiles, false);
    const first = hits[0];
    if (!first) return null;
    return (first.object.userData.spaceId as number) ?? null;
  }

  private attachResize(): void {
    const resize = () => {
      const width = this.canvas.clientWidth || window.innerWidth;
      const height = this.canvas.clientHeight || window.innerHeight;
      this.renderer.setSize(width, height, false);
      this.cam.resize(width / Math.max(1, height));
      // On a narrow screen the board needs a little more distance to fit.
      const minDistance = width < 700 ? 10 : 7;
      this.cam.setLimits({ minDistance });
    };
    resize();
    window.addEventListener('resize', resize);
    const onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.detach.push(() => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    });
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(resize);
      ro.observe(this.canvas);
      this.detach.push(() => ro.disconnect());
    }
  }

  /* ---------------------------------------------------------------- */
  /* Public camera helpers                                             */
  /* ---------------------------------------------------------------- */

  resetCamera(): void {
    this.cam.reset();
  }

  orbit(delta: number): void {
    this.cam.nudgeOrbit(delta);
  }

  zoom(delta: number): void {
    this.cam.zoomBy(delta);
  }

  focusPlayer(playerId: string): void {
    const entry = this.pieces.get(playerId);
    if (!entry) return;
    this.cam.lookAtPoint(entry.pos.x * 0.6, entry.pos.z * 0.6, 20, true);
  }

  focusOnSpace(spaceId: number): void {
    const t = tileTransform(spaceId);
    this.cam.lookAtPoint(t.x * 0.5, t.z * 0.5, 18, true);
    this.cam.faceAngle(t.side * (Math.PI / 2), true);
  }

  /** Slow idle orbit used behind the menu and lobby screens. */
  setCinematic(on: boolean): void {
    this.cinematic = on;
    if (on) {
      this.cam.setEnabled(true);
      this.cam.lookAtPoint(0, 0, 34, true);
    }
  }

  private cinematic = false;

  applyQualityChange(): void {
    this.renderer.shadowMap.enabled = prefs.quality !== 'low';
    this.keyLight.castShadow = prefs.quality !== 'low';
    this.currentDpr = this.targetDpr();
    this.renderer.setPixelRatio(this.currentDpr);
    if (this.environment) {
      this.scene.remove(this.environment.group);
      this.environment.dispose();
    }
    this.environment = createEnvironment(prefs.quality);
    this.scene.add(this.environment.group);
  }

  clearTable(): void {
    this.queue = [];
    this.holdUntil = 0;
    this.effects.clear();
    this.dice.hide();
    for (const entry of this.pieces.values()) disposePiece(entry.obj);
    this.pieces.clear();
    this.teardownBoard();
    this.boardSignature = '';
    this.state = null;
  }

  dispose(): void {
    this.stop();
    for (const fn of this.detach) fn();
    this.detach = [];
    this.clearTable();
    this.dice.dispose();
    this.effects.dispose();
    this.environment?.dispose();
    this.cam.dispose();
    this.renderer.dispose();
  }
}

