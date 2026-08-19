/**
 * Orbit camera rig.
 *
 * Hand-rolled rather than pulled from three's examples so that follow-mode,
 * cinematic focus moves and the reset button all share one damped target and
 * never fight each other.
 */
import * as THREE from 'three';
import { clamp, damp } from '../util';

const MIN_PHI = 0.16;
const MAX_PHI = 1.35;

export interface CameraLimits {
  minDistance: number;
  maxDistance: number;
  panRadius: number;
}

export class OrbitCam {
  readonly camera: THREE.PerspectiveCamera;

  /** Where the camera is heading. */
  private target = new THREE.Vector3(0, 0, 0);
  private theta = Math.PI * 0.0;
  private phi = 0.78;
  private distance = 30;

  /** Where it currently is (damped towards the values above). */
  private curTarget = new THREE.Vector3(0, 0, 0);
  private curTheta = 0;
  private curPhi = 0.9;
  private curDistance = 46;

  private limits: CameraLimits = { minDistance: 7, maxDistance: 52, panRadius: 13 };
  private dragging: 'orbit' | 'pan' | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private element: HTMLElement;
  private enabled = true;
  /** Set while the user is driving the camera, so follow-mode backs off. */
  private userHoldUntil = 0;
  private detachFns: (() => void)[] = [];

  constructor(element: HTMLElement, aspect: number) {
    this.element = element;
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.5, 260);
    this.attach();
    this.apply(1);
  }

  get isUserControlling(): boolean {
    return performance.now() < this.userHoldUntil;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private attach(): void {
    const el = this.element;
    const onDown = (ev: PointerEvent) => {
      if (!this.enabled) return;
      el.setPointerCapture?.(ev.pointerId);
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 1) {
        this.dragging = ev.button === 2 || ev.button === 1 || ev.shiftKey ? 'pan' : 'orbit';
      } else if (this.pointers.size === 2) {
        this.dragging = 'pan';
        this.lastPinch = this.pinchDistance();
      }
      this.userHoldUntil = performance.now() + 2600;
    };

    const onMove = (ev: PointerEvent) => {
      const prev = this.pointers.get(ev.pointerId);
      if (!prev) return;
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (!this.enabled) return;
      this.userHoldUntil = performance.now() + 2600;

      if (this.pointers.size >= 2) {
        const pinch = this.pinchDistance();
        if (this.lastPinch > 0) this.zoom((this.lastPinch - pinch) * 0.06);
        this.lastPinch = pinch;
        this.pan(dx * 0.5, dy * 0.5);
        return;
      }
      if (this.dragging === 'orbit') {
        this.theta -= dx * 0.005;
        this.phi = clamp(this.phi - dy * 0.004, MIN_PHI, MAX_PHI);
      } else if (this.dragging === 'pan') {
        this.pan(dx, dy);
      }
    };

    const onUp = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size === 0) this.dragging = null;
      if (this.pointers.size < 2) this.lastPinch = 0;
      el.releasePointerCapture?.(ev.pointerId);
    };

    const onWheel = (ev: WheelEvent) => {
      if (!this.enabled) return;
      ev.preventDefault();
      this.userHoldUntil = performance.now() + 2600;
      this.zoom(ev.deltaY * 0.012);
    };

    const onContext = (ev: Event) => ev.preventDefault();

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);

    this.detachFns.push(() => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    });
  }

  dispose(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }

  private pinchDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  private pan(dx: number, dy: number): void {
    // Pan in the camera's ground plane so dragging feels like moving the table.
    const scale = this.distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const forward = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(forward, -dy * scale);
    const r = this.limits.panRadius;
    this.target.x = clamp(this.target.x, -r, r);
    this.target.z = clamp(this.target.z, -r, r);
    this.target.y = 0;
  }

  private zoom(delta: number): void {
    this.distance = clamp(this.distance * (1 + delta), this.limits.minDistance, this.limits.maxDistance);
  }

  /* ---------------------------------------------------------------- */
  /* Programmatic moves                                                */
  /* ---------------------------------------------------------------- */

  setLimits(limits: Partial<CameraLimits>): void {
    Object.assign(this.limits, limits);
    this.distance = clamp(this.distance, this.limits.minDistance, this.limits.maxDistance);
  }

  /** Frames the whole board from the default three-quarter angle. */
  reset(instant = false): void {
    this.target.set(0, 0, 0);
    this.theta = 0;
    this.phi = 0.82;
    this.distance = 31;
    this.userHoldUntil = 0;
    if (instant) this.apply(1);
  }

  /** Gently moves the look-at point; used by follow mode and victory. */
  lookAtPoint(x: number, z: number, distance?: number, force = false): void {
    if (!force && this.isUserControlling) return;
    this.target.set(x, 0, z);
    if (distance !== undefined) {
      this.distance = clamp(distance, this.limits.minDistance, this.limits.maxDistance);
    }
  }

  /** Rotates the camera so a given board angle sits nicely on screen. */
  faceAngle(theta: number, force = false): void {
    if (!force && this.isUserControlling) return;
    // Choose the equivalent angle nearest the current one to avoid long spins.
    const twoPi = Math.PI * 2;
    let t = theta;
    while (t - this.theta > Math.PI) t -= twoPi;
    while (this.theta - t > Math.PI) t += twoPi;
    this.theta = t;
  }

  nudgeOrbit(delta: number): void {
    this.theta += delta;
    this.userHoldUntil = performance.now() + 2600;
  }

  zoomBy(delta: number): void {
    this.zoom(delta);
    this.userHoldUntil = performance.now() + 2600;
  }

  get orbitAngle(): number {
    return this.curTheta;
  }

  /* ---------------------------------------------------------------- */
  /* Frame update                                                      */
  /* ---------------------------------------------------------------- */

  update(dt: number, instant = false): void {
    this.apply(instant ? 1 : damp(dt, 0.11));
  }

  private apply(k: number): void {
    this.curTheta += (this.theta - this.curTheta) * k;
    this.curPhi += (this.phi - this.curPhi) * k;
    this.curDistance += (this.distance - this.curDistance) * k;
    this.curTarget.lerp(this.target, k);

    const sinPhi = Math.sin(this.curPhi);
    this.camera.position.set(
      this.curTarget.x + this.curDistance * sinPhi * Math.sin(this.curTheta),
      this.curTarget.y + this.curDistance * Math.cos(this.curPhi),
      this.curTarget.z + this.curDistance * sinPhi * Math.cos(this.curTheta),
    );
    this.camera.lookAt(this.curTarget);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
