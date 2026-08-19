/**
 * Original 3D playing pieces, built procedurally from primitives.
 *
 * Everything is authored here rather than loaded as a model: it keeps the
 * download tiny, guarantees the assets are ours, and lets every piece be tinted
 * to the owning player's colour at build time.
 */
import * as THREE from 'three';
import type { PieceId } from '@shared/types';

/** Target silhouette for every piece so they read as one set. */
const TARGET_HEIGHT = 0.62;

interface Built {
  group: THREE.Group;
  /** Sub-object that spins or pulses on its own (rotor, flame, gem…). */
  animated: THREE.Object3D[];
}

function body(color: string, opts?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.35,
    roughness: 0.42,
    ...opts,
  });
}

function metal(color = '#c9d8ea'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25 });
}

function glow(color: string, intensity = 1.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
}

function dark(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#1b2537', metalness: 0.5, roughness: 0.55 });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/* ------------------------------------------------------------------ */
/* Individual pieces                                                   */
/* ------------------------------------------------------------------ */

function buildRobot(color: string): Built {
  const g = new THREE.Group();
  const shell = body(color);
  const trim = metal();
  const eye = glow('#9ff4ff', 2.4);

  g.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.3), trim, 0, 0.05, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 10), dark(), -0.13, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 10), dark(), 0.13, 0.15, 0));

  const torso = mesh(new THREE.BoxGeometry(0.4, 0.36, 0.28), shell, 0, 0.41, 0);
  g.add(torso);
  g.add(mesh(new THREE.BoxGeometry(0.26, 0.09, 0.02), glow('#ffcb3d', 1.2), 0, 0.42, 0.15));

  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), trim, -0.25, 0.42, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), trim, 0.25, 0.42, 0));

  const head = mesh(new THREE.BoxGeometry(0.26, 0.22, 0.24), shell, 0, 0.72, 0);
  g.add(head);
  g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), eye, -0.07, 0.74, 0.13));
  g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), eye, 0.07, 0.74, 0.13));

  const antenna = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), trim, 0, 0.9, 0);
  g.add(antenna);
  const beacon = mesh(new THREE.SphereGeometry(0.045, 12, 10), glow('#ff5f8f', 2.2), 0, 1.0, 0);
  g.add(beacon);

  return { group: g, animated: [beacon] };
}

function buildRocket(color: string): Built {
  const g = new THREE.Group();
  const shell = body(color, { metalness: 0.55, roughness: 0.3 });
  const trim = metal('#e8f1ff');

  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.62, 16), shell, 0, 0.44, 0));
  g.add(mesh(new THREE.ConeGeometry(0.15, 0.3, 16), trim, 0, 0.9, 0));
  g.add(mesh(new THREE.TorusGeometry(0.155, 0.02, 8, 20), trim, 0, 0.6, 0).rotateX(Math.PI / 2));
  const window = mesh(new THREE.SphereGeometry(0.07, 14, 12), glow('#9ff4ff', 1.1), 0, 0.6, 0.12);
  window.scale.set(1, 1, 0.4);
  g.add(window);

  for (let i = 0; i < 3; i++) {
    const fin = mesh(new THREE.BoxGeometry(0.02, 0.26, 0.2), trim);
    fin.position.set(Math.sin((i / 3) * Math.PI * 2) * 0.16, 0.22, Math.cos((i / 3) * Math.PI * 2) * 0.16);
    fin.rotation.y = -(i / 3) * Math.PI * 2;
    g.add(fin);
  }

  const flame = mesh(new THREE.ConeGeometry(0.11, 0.26, 12), glow('#ff8a3d', 2.6), 0, 0.0, 0);
  flame.rotation.x = Math.PI;
  flame.material = new THREE.MeshBasicMaterial({ color: '#ff9d4d', transparent: true, opacity: 0.85 });
  flame.castShadow = false;
  g.add(flame);

  return { group: g, animated: [flame] };
}

function buildRoadster(color: string): Built {
  const g = new THREE.Group();
  const shell = body(color, { metalness: 0.6, roughness: 0.22 });

  const chassis = mesh(new THREE.BoxGeometry(0.62, 0.12, 0.32), shell, 0, 0.14, 0);
  g.add(chassis);
  const nose = mesh(new THREE.BoxGeometry(0.2, 0.09, 0.28), shell, 0.34, 0.13, 0);
  g.add(nose);
  const cabin = mesh(new THREE.BoxGeometry(0.26, 0.13, 0.26), dark(), -0.02, 0.26, 0);
  g.add(cabin);
  const spoiler = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.3), metal(), -0.3, 0.28, 0);
  g.add(spoiler);
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.02), metal(), -0.3, 0.22, 0.13));
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.02), metal(), -0.3, 0.22, -0.13));

  const underglow = mesh(new THREE.BoxGeometry(0.56, 0.012, 0.28), glow('#3ec7ff', 2.2), 0, 0.075, 0);
  underglow.castShadow = false;
  g.add(underglow);
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.04, 0.2), glow('#ffcb3d', 1.8), 0.44, 0.15, 0));

  const wheel = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14);
  const rubber = new THREE.MeshStandardMaterial({ color: '#141c2b', metalness: 0.1, roughness: 0.9 });
  for (const [x, z] of [
    [0.22, 0.17],
    [0.22, -0.17],
    [-0.22, 0.17],
    [-0.22, -0.17],
  ] as [number, number][]) {
    const w = mesh(wheel, rubber, x, 0.09, z);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }

  return { group: g, animated: [underglow] };
}

function buildCrown(color: string): Built {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#ffcb3d', metalness: 0.95, roughness: 0.2 });
  const gem = glow(color, 1.8);

  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.06, 24), gold, 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.24, 24, 1, true), gold, 0, 0.18, 0));
  g.add(mesh(new THREE.TorusGeometry(0.245, 0.025, 8, 26), gold, 0, 0.3, 0).rotateX(Math.PI / 2));

  const gems: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = mesh(new THREE.ConeGeometry(0.06, 0.24, 8), gold, Math.sin(a) * 0.22, 0.42, Math.cos(a) * 0.22);
    g.add(spike);
    const jewel = mesh(new THREE.OctahedronGeometry(0.045), gem, Math.sin(a) * 0.22, 0.57, Math.cos(a) * 0.22);
    g.add(jewel);
    gems.push(jewel);
  }
  const centre = mesh(new THREE.OctahedronGeometry(0.07), gem, 0, 0.42, 0);
  g.add(centre);
  gems.push(centre);

  return { group: g, animated: gems };
}

function buildStarship(color: string): Built {
  const g = new THREE.Group();
  const shell = body(color, { metalness: 0.75, roughness: 0.25 });
  const trim = metal('#dbe8f7');

  const hull = mesh(new THREE.ConeGeometry(0.14, 0.66, 12), shell, 0, 0.34, 0);
  hull.rotation.x = -Math.PI / 2;
  hull.scale.set(1, 1, 0.55);
  g.add(hull);

  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(0.3, 0.025, 0.24), trim, side * 0.2, 0.33, -0.06);
    wing.rotation.y = side * -0.42;
    wing.rotation.z = side * 0.16;
    g.add(wing);
    const engine = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.18, 10), dark(), side * 0.24, 0.33, -0.16);
    engine.rotation.x = Math.PI / 2;
    g.add(engine);
  }

  const thrust = mesh(new THREE.SphereGeometry(0.05, 12, 10), glow('#3ec7ff', 2.8), 0, 0.33, -0.3);
  thrust.scale.set(1, 1, 1.7);
  thrust.castShadow = false;
  g.add(thrust);

  const canopy = mesh(new THREE.SphereGeometry(0.075, 14, 12), glow('#9ff4ff', 0.9), 0, 0.4, 0.1);
  canopy.scale.set(1, 0.6, 1.3);
  g.add(canopy);

  // Pylon so it visually hovers rather than floats unsupported.
  const pylon = mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.28, 8), trim, 0, 0.14, -0.02);
  g.add(pylon);
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.03, 18), trim, 0, 0.015, -0.02));

  return { group: g, animated: [thrust] };
}

function buildCrystal(color: string): Built {
  const g = new THREE.Group();
  const shard = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.9,
    metalness: 0.1,
    roughness: 0.08,
    transparent: true,
    opacity: 0.86,
  });
  const base = new THREE.MeshStandardMaterial({ color: '#26344b', metalness: 0.4, roughness: 0.7 });

  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.07, 18), base, 0, 0.035, 0));

  const main = mesh(new THREE.OctahedronGeometry(0.22, 0), shard, 0, 0.4, 0);
  main.scale.set(0.7, 1.5, 0.7);
  g.add(main);

  const shards: THREE.Object3D[] = [main];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const s = mesh(new THREE.OctahedronGeometry(0.1, 0), shard, Math.sin(a) * 0.15, 0.22, Math.cos(a) * 0.15);
    s.scale.set(0.6, 1.4, 0.6);
    s.rotation.z = Math.sin(a) * 0.35;
    s.rotation.x = Math.cos(a) * 0.35;
    g.add(s);
    shards.push(s);
  }

  const halo = mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 24), glow(color, 2.4), 0, 0.44, 0);
  halo.rotation.x = Math.PI / 2;
  halo.castShadow = false;
  g.add(halo);
  shards.push(halo);

  return { group: g, animated: shards };
}

function buildFox(color: string): Built {
  const g = new THREE.Group();
  const fur = body(color, { metalness: 0.05, roughness: 0.85 });
  const light = new THREE.MeshStandardMaterial({ color: '#f5f0e6', metalness: 0.05, roughness: 0.9 });
  const nose = new THREE.MeshStandardMaterial({ color: '#1b2537', metalness: 0.2, roughness: 0.6 });

  const torso = mesh(new THREE.CapsuleGeometry(0.13, 0.24, 6, 12), fur, -0.02, 0.28, 0);
  torso.rotation.z = Math.PI / 2;
  g.add(torso);
  g.add(mesh(new THREE.CapsuleGeometry(0.1, 0.16, 6, 10), light, -0.02, 0.21, 0.04).rotateZ(Math.PI / 2));

  const head = mesh(new THREE.SphereGeometry(0.13, 16, 14), fur, 0.22, 0.4, 0);
  g.add(head);
  const snout = mesh(new THREE.ConeGeometry(0.06, 0.16, 10), light, 0.34, 0.36, 0);
  snout.rotation.z = -Math.PI / 2;
  g.add(snout);
  g.add(mesh(new THREE.SphereGeometry(0.025, 8, 8), nose, 0.42, 0.36, 0));

  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.05, 0.14, 8), fur, 0.19, 0.53, side * 0.07);
    ear.rotation.z = -0.12;
    g.add(ear);
    g.add(mesh(new THREE.SphereGeometry(0.02, 8, 8), nose, 0.31, 0.44, side * 0.06));
  }

  const legGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.2, 8);
  for (const [x, z] of [
    [0.12, 0.09],
    [0.12, -0.09],
    [-0.14, 0.09],
    [-0.14, -0.09],
  ] as [number, number][]) {
    g.add(mesh(legGeo, fur, x, 0.1, z));
  }

  const tail = mesh(new THREE.ConeGeometry(0.09, 0.32, 10), fur, -0.28, 0.36, 0);
  tail.rotation.z = 0.9;
  g.add(tail);
  const tip = mesh(new THREE.SphereGeometry(0.055, 10, 8), light, -0.38, 0.48, 0);
  g.add(tip);

  return { group: g, animated: [tail, tip] };
}

function buildHovercraft(color: string): Built {
  const g = new THREE.Group();
  const shell = body(color, { metalness: 0.5, roughness: 0.35 });
  const trim = metal('#b8c8dc');

  const skirt = mesh(new THREE.TorusGeometry(0.24, 0.07, 10, 22), dark(), 0, 0.11, 0);
  skirt.rotation.x = Math.PI / 2;
  skirt.scale.set(1.15, 1, 1);
  g.add(skirt);

  const hull = mesh(new THREE.CapsuleGeometry(0.15, 0.22, 6, 14), shell, 0, 0.26, 0);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1.15, 0.8);
  g.add(hull);

  const canopy = mesh(new THREE.SphereGeometry(0.1, 14, 12), glow('#9ff4ff', 0.8), 0.07, 0.36, 0);
  canopy.scale.set(1.1, 0.7, 0.9);
  g.add(canopy);

  g.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.02), trim, -0.2, 0.38, 0));

  const jets: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const jet = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), glow('#3ec7ff', 2.4), -0.16, 0.11, side * 0.14);
    jet.castShadow = false;
    g.add(jet);
    jets.push(jet);
  }

  const cushion = mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.02, 22), glow('#3ec7ff', 1.4), 0, 0.03, 0);
  cushion.castShadow = false;
  (cushion.material as THREE.MeshStandardMaterial).transparent = true;
  (cushion.material as THREE.MeshStandardMaterial).opacity = 0.4;
  g.add(cushion);
  jets.push(cushion);

  return { group: g, animated: jets };
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

const BUILDERS: Record<PieceId, (color: string) => Built> = {
  robot: buildRobot,
  rocket: buildRocket,
  roadster: buildRoadster,
  crown: buildCrown,
  starship: buildStarship,
  crystal: buildCrystal,
  fox: buildFox,
  hovercraft: buildHovercraft,
};

export interface PieceObject {
  root: THREE.Group;
  /** Inner group that carries hop/bob/tilt so `root` stays authoritative. */
  inner: THREE.Group;
  animated: THREE.Object3D[];
  pieceId: PieceId;
}

/**
 * Builds a piece, normalises it to a common height, and wraps it in an outer
 * group whose position is the authoritative board position.
 */
export function createPiece(pieceId: PieceId, color: string): PieceObject {
  const builder = BUILDERS[pieceId] ?? buildRobot;
  const built = builder(color);

  const box = new THREE.Box3().setFromObject(built.group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = TARGET_HEIGHT / Math.max(size.y, 0.0001);
  built.group.scale.setScalar(scale);
  built.group.position.y -= box.min.y * scale;

  const inner = new THREE.Group();
  inner.add(built.group);

  const root = new THREE.Group();
  root.add(inner);
  root.name = `piece:${pieceId}`;

  return { root, inner, animated: built.animated, pieceId };
}

export function disposePiece(piece: PieceObject): void {
  piece.root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  piece.root.removeFromParent();
}

/* ------------------------------------------------------------------ */
/* Lobby preview thumbnails                                            */
/* ------------------------------------------------------------------ */

let previewRenderer: THREE.WebGLRenderer | null = null;
let previewScene: THREE.Scene | null = null;
let previewCamera: THREE.PerspectiveCamera | null = null;

/**
 * Renders a piece into a small standalone canvas for the piece picker. One
 * hidden renderer is reused for all eight thumbnails.
 */
export function piecePreview(pieceId: PieceId, color: string, size = 128): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');

  try {
    if (!previewRenderer) {
      previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      previewRenderer.setSize(size, size, false);
      previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      previewScene = new THREE.Scene();
      previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
      previewCamera.position.set(1.25, 1.05, 1.5);
      previewCamera.lookAt(0, 0.32, 0);
      const key = new THREE.DirectionalLight('#ffffff', 2.4);
      key.position.set(2, 3, 2);
      previewScene.add(key);
      const rim = new THREE.DirectionalLight('#5aa7ff', 1.4);
      rim.position.set(-2, 1.2, -1.6);
      previewScene.add(rim);
      previewScene.add(new THREE.AmbientLight('#8fb4e0', 1.1));
    }
    const scene = previewScene!;
    const piece = createPiece(pieceId, color);
    piece.root.rotation.y = -0.5;
    scene.add(piece.root);
    previewRenderer.setSize(size, size, false);
    previewRenderer.render(scene, previewCamera!);
    ctx?.drawImage(previewRenderer.domElement, 0, 0, size, size);
    scene.remove(piece.root);
    disposePiece(piece);
  } catch {
    // WebGL may be unavailable (software rendering, blocked context) — fall
    // back to a simple coloured medallion so the picker still works.
    if (ctx) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return out;
}
