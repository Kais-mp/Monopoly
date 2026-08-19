/**
 * The world around the board: the plinth it sits on, the harbour water, a
 * distant skyline and a few moving lights. Purely decorative, and scaled back
 * automatically on lower quality tiers.
 */
import * as THREE from 'three';
import { BOARD_SIZE, HALF } from './layout';
import { hashRandom } from '../util';
import type { Quality } from '../prefs';

export interface Environment {
  group: THREE.Group;
  update: (elapsedMs: number) => void;
  dispose: () => void;
}

export function createEnvironment(quality: Quality): Environment {
  const group = new THREE.Group();
  group.name = 'environment';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  /* Plinth ---------------------------------------------------------- */
  const plinthGeo = track(new THREE.BoxGeometry(BOARD_SIZE + 1.5, 0.55, BOARD_SIZE + 1.5));
  const plinthMat = track(
    new THREE.MeshStandardMaterial({ color: '#131c2c', metalness: 0.55, roughness: 0.55 }),
  );
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.y = -0.28;
  plinth.receiveShadow = true;
  group.add(plinth);

  // Glowing edge trim around the plinth.
  const trimGeo = track(new THREE.BoxGeometry(BOARD_SIZE + 1.62, 0.05, BOARD_SIZE + 1.62));
  const trimMat = track(
    new THREE.MeshStandardMaterial({
      color: '#3ec7ff',
      emissive: new THREE.Color('#3ec7ff'),
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.3,
    }),
  );
  const trim = new THREE.Mesh(trimGeo, trimMat);
  trim.position.y = -0.02;
  group.add(trim);

  /* Water ----------------------------------------------------------- */
  const waterGeo = track(new THREE.CircleGeometry(78, quality === 'low' ? 24 : 64));
  const waterMat = track(
    new THREE.MeshStandardMaterial({
      color: '#071626',
      metalness: 0.92,
      roughness: 0.16,
      transparent: true,
      opacity: 0.97,
    }),
  );
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.4;
  water.receiveShadow = false;
  group.add(water);

  // Slow concentric swells so the water is never dead flat.
  const swells: THREE.Mesh[] = [];
  if (quality !== 'low') {
    const swellGeo = track(new THREE.RingGeometry(0.985, 1, 96));
    for (let i = 0; i < 4; i++) {
      const mat = track(
        new THREE.MeshBasicMaterial({ color: '#2f6f9e', transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
      );
      const ring = new THREE.Mesh(swellGeo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.38;
      ring.scale.setScalar(16 + i * 9);
      group.add(ring);
      swells.push(ring);
    }
  }

  /* Skyline --------------------------------------------------------- */
  const towers = quality === 'low' ? 0 : quality === 'medium' ? 42 : 84;
  let skyline: THREE.InstancedMesh | null = null;
  let windows: THREE.InstancedMesh | null = null;
  if (towers > 0) {
    const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
    const towerMat = track(
      new THREE.MeshStandardMaterial({ color: '#16233a', metalness: 0.6, roughness: 0.5 }),
    );
    const winMat = track(
      new THREE.MeshStandardMaterial({
        color: '#4fd0ff',
        emissive: new THREE.Color('#4fd0ff'),
        emissiveIntensity: 1.1,
        transparent: true,
        opacity: 0.55,
      }),
    );
    skyline = new THREE.InstancedMesh(boxGeo, towerMat, towers);
    windows = new THREE.InstancedMesh(boxGeo, winMat, towers);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2 + hashRandom(i * 7) * 0.06;
      const radius = HALF + 7 + hashRandom(i * 13) * 26;
      const h = 2 + hashRandom(i * 31) * 13;
      const w = 1.1 + hashRandom(i * 17) * 2.2;
      pos.set(Math.cos(a) * radius, h / 2 - 1.3, Math.sin(a) * radius);
      scale.set(w, h, w);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m.compose(pos, q, scale);
      skyline.setMatrixAt(i, m);

      // A lit band two-thirds up each tower.
      pos.y = h * 0.66 - 1.3;
      scale.set(w * 1.03, h * 0.08, w * 1.03);
      m.compose(pos, q, scale);
      windows.setMatrixAt(i, m);
    }
    skyline.instanceMatrix.needsUpdate = true;
    windows.instanceMatrix.needsUpdate = true;
    skyline.castShadow = false;
    skyline.receiveShadow = false;
    group.add(skyline, windows);
  }

  /* Drifting lights -------------------------------------------------- */
  const drones: THREE.Mesh[] = [];
  if (quality === 'high') {
    const droneGeo = track(new THREE.SphereGeometry(0.11, 10, 8));
    const colors = ['#3ec7ff', '#ff5f8f', '#ffcb3d'];
    for (let i = 0; i < 3; i++) {
      const mat = track(
        new THREE.MeshBasicMaterial({ color: colors[i]!, transparent: true, opacity: 0.9 }),
      );
      const drone = new THREE.Mesh(droneGeo, mat);
      group.add(drone);
      drones.push(drone);
    }
  }

  /* Corner beacons ---------------------------------------------------- */
  const beacons: THREE.Mesh[] = [];
  const beaconGeo = track(new THREE.CylinderGeometry(0.06, 0.09, 1.5, 8));
  const beaconTop = track(new THREE.SphereGeometry(0.13, 12, 10));
  const beaconMat = track(new THREE.MeshStandardMaterial({ color: '#22304a', metalness: 0.7, roughness: 0.4 }));
  const beaconLight = track(
    new THREE.MeshBasicMaterial({ color: '#9ff4ff', transparent: true, opacity: 0.95 }),
  );
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as [number, number][]) {
    const post = new THREE.Mesh(beaconGeo, beaconMat);
    post.position.set(sx * (HALF + 1.1), 0.45, sz * (HALF + 1.1));
    post.castShadow = true;
    group.add(post);
    const bulb = new THREE.Mesh(beaconTop, beaconLight);
    bulb.position.set(sx * (HALF + 1.1), 1.28, sz * (HALF + 1.1));
    group.add(bulb);
    beacons.push(bulb);
  }

  const update = (elapsedMs: number) => {
    const t = elapsedMs / 1000;
    for (let i = 0; i < swells.length; i++) {
      const ring = swells[i]!;
      const phase = (t * 0.06 + i * 0.25) % 1;
      const s = 14 + phase * 52;
      ring.scale.setScalar(s);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.18 * (1 - phase);
    }
    for (let i = 0; i < drones.length; i++) {
      const drone = drones[i]!;
      const a = t * (0.16 + i * 0.05) + i * 2.1;
      const r = HALF + 4.5 + Math.sin(t * 0.4 + i) * 1.6;
      drone.position.set(Math.cos(a) * r, 3.4 + Math.sin(t * 0.7 + i * 1.7) * 0.8, Math.sin(a) * r);
    }
    for (let i = 0; i < beacons.length; i++) {
      const bulb = beacons[i]!;
      const pulse = 0.55 + 0.45 * Math.sin(t * 1.6 + i * 1.4);
      (bulb.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.6;
      bulb.scale.setScalar(0.85 + pulse * 0.3);
    }
    trimMat.emissiveIntensity = 1.1 + Math.sin(t * 0.9) * 0.3;
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    group.clear();
  };

  return { group, update, dispose };
}
