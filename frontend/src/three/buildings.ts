/**
 * Development buildings.
 *
 * Levels 1-4 place that many small structures along the space's colour band —
 * they grow taller with each level so progress is readable at a glance. The
 * top level replaces them with a single landmark tower.
 *
 * Geometries and the base materials are shared across every space; only the
 * colour-tinted material is per group, so a fully developed board still costs
 * very few unique GPU resources.
 */
import * as THREE from 'three';
import { bandCentre, buildingSlot, type TileTransform } from './layout';

const HOUSE_BODY = new THREE.BoxGeometry(1, 1, 1);
const HOUSE_ROOF = new THREE.ConeGeometry(0.78, 0.5, 4);
const TOWER_BODY = new THREE.BoxGeometry(0.3, 1, 0.3);
const TOWER_CROWN = new THREE.ConeGeometry(0.2, 0.26, 6);
const TOWER_MAST = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5);
const WINDOW_STRIP = new THREE.BoxGeometry(0.32, 0.03, 0.32);
const BEACON = new THREE.SphereGeometry(0.035, 10, 8);

const roofMat = new THREE.MeshStandardMaterial({ color: '#2b3a55', metalness: 0.3, roughness: 0.7 });
const towerBodyMat = new THREE.MeshStandardMaterial({ color: '#e8f1ff', metalness: 0.45, roughness: 0.3 });

const tintCache = new Map<string, THREE.MeshStandardMaterial>();
function tint(color: string): THREE.MeshStandardMaterial {
  let m = tintCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.55 });
    tintCache.set(color, m);
  }
  return m;
}

const glowCache = new Map<string, THREE.MeshStandardMaterial>();
function glowMat(color: string, intensity: number): THREE.MeshStandardMaterial {
  const key = `${color}|${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      metalness: 0.2,
      roughness: 0.4,
    });
    glowCache.set(key, m);
  }
  return m;
}

export interface BuildingSet {
  group: THREE.Group;
  /** Objects that should pulse (tower beacon). */
  animated: THREE.Object3D[];
  level: number;
}

function house(height: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(HOUSE_BODY, tint(color));
  bodyMesh.scale.set(0.26, height, 0.26);
  bodyMesh.position.y = height / 2;
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  const roof = new THREE.Mesh(HOUSE_ROOF, roofMat);
  roof.scale.set(0.26, 0.26, 0.26);
  roof.position.y = height + 0.065;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  const win = new THREE.Mesh(WINDOW_STRIP, glowMat('#ffcb3d', 1.1));
  win.scale.set(0.85, 1, 0.85);
  win.position.y = height * 0.58;
  g.add(win);
  return g;
}

function tower(color: string): { group: THREE.Group; beacon: THREE.Mesh } {
  const g = new THREE.Group();
  const height = 0.86;

  const shaft = new THREE.Mesh(TOWER_BODY, towerBodyMat);
  shaft.scale.set(1, height, 1);
  shaft.position.y = height / 2;
  shaft.castShadow = true;
  g.add(shaft);

  const skirt = new THREE.Mesh(TOWER_BODY, tint(color));
  skirt.scale.set(1.35, 0.16, 1.35);
  skirt.position.y = 0.08;
  skirt.castShadow = true;
  g.add(skirt);

  // Three lit floors read clearly even at a shallow camera angle.
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(WINDOW_STRIP, glowMat('#9ff4ff', 1.5));
    band.scale.set(0.98, 1, 0.98);
    band.position.y = 0.26 + i * 0.2;
    g.add(band);
  }

  const crown = new THREE.Mesh(TOWER_CROWN, tint(color));
  crown.position.y = height + 0.11;
  crown.castShadow = true;
  g.add(crown);

  const mast = new THREE.Mesh(TOWER_MAST, towerBodyMat);
  mast.position.y = height + 0.32;
  g.add(mast);

  const beacon = new THREE.Mesh(BEACON, glowMat('#ff5f8f', 2.6));
  beacon.position.y = height + 0.43;
  g.add(beacon);

  return { group: g, beacon };
}

/**
 * Builds the structures for a space at a given level. `maxLevel` decides which
 * level counts as the landmark tier, so a host who caps levels at 3 still gets
 * a landmark at the top.
 */
export function createBuildings(
  level: number,
  transform: TileTransform,
  color: string,
  maxLevel: number,
  towerEnabled: boolean,
): BuildingSet {
  const group = new THREE.Group();
  const animated: THREE.Object3D[] = [];
  if (level <= 0) return { group, animated, level };

  const isTower = towerEnabled && level >= maxLevel;
  if (isTower) {
    const built = tower(color);
    const c = bandCentre(transform);
    built.group.position.set(c.x, 0, c.z);
    built.group.rotation.y = transform.rotY;
    group.add(built.group);
    animated.push(built.beacon);
    return { group, animated, level };
  }

  const count = Math.min(level, 4);
  // Later houses are taller, so the same space visibly grows between levels.
  for (let i = 0; i < count; i++) {
    const h = 0.17 + level * 0.035 + i * 0.008;
    const b = house(h, color);
    const slot = buildingSlot(i, transform);
    b.position.set(slot.x, 0, slot.z);
    b.rotation.y = transform.rotY + (i % 2 === 0 ? 0.06 : -0.06);
    group.add(b);
  }
  return { group, animated, level };
}

export function disposeBuildings(set: BuildingSet): void {
  set.group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    // Geometries and materials are shared and cached — only detach.
    if (m.isMesh) m.visible = false;
  });
  set.group.clear();
  set.group.removeFromParent();
}
