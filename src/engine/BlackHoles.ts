import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type IUniform,
  type Scene,
} from 'three';
import type { ForceField } from './ForceField';
import { DISK_FRAG, DISK_VERT } from './shaders';

export const HOLE_RADIUS = 0.46;
const DISK_SCALE = 3.5;

export interface Hole {
  active: boolean;
  dying: boolean;
  x: number;
  y: number;
  /** Animated 0..1 presence, slightly overshooting on spawn. */
  scale: number;
  velocity: number;
  tiltX: number;
  roll: number;
  seed: number;
  spin: number;
}

/** Owns black hole state and accretion disks. Gravity is fed to the ForceField, light bending to LensEffect. */
export class BlackHoles {
  readonly holes: Hole[] = [];
  private readonly geometry = new InstancedBufferGeometry();
  private readonly center: InstancedBufferAttribute;
  private readonly tilt: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private nextReplaced = 0;

  constructor(max: number, shared: Record<string, IUniform>, scene: Scene) {
    for (let i = 0; i < max; i++) {
      this.holes.push({
        active: false,
        dying: false,
        x: 0,
        y: 0,
        scale: 0,
        velocity: 0,
        tiltX: 0,
        roll: 0,
        seed: 0,
        spin: 1,
      });
    }
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.geometry.setAttribute('position', new BufferAttribute(quad, 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const capacity = max * 4; // One hole plus up to three reflections.
    this.center = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tilt = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.center.setUsage(DynamicDrawUsage);
    this.tilt.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aCenter', this.center);
    this.geometry.setAttribute('aTilt', this.tilt);
    this.geometry.instanceCount = 0;
    this.material = new ShaderMaterial({
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      uniforms: shared,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  place(x: number, y: number): Hole {
    let hole = this.holes.find((h) => !h.active);
    if (!hole) {
      // All in use: replace them in rotation, which always takes the oldest.
      hole = this.holes[this.nextReplaced];
      this.nextReplaced = (this.nextReplaced + 1) % this.holes.length;
    }
    hole.active = true;
    hole.dying = false;
    hole.x = x;
    hole.y = y;
    hole.scale = 0;
    hole.velocity = 0;
    // Mostly edge-on, so the lens lifts the far side of the disk into a halo.
    hole.tiltX = -1.18 - Math.random() * 0.22;
    hole.roll = (Math.random() - 0.5) * 0.9;
    hole.seed = Math.random();
    hole.spin = Math.random() < 0.5 ? 1 : -1;
    return hole;
  }

  /** Finds a hole under a point, including its reflected copies when mirroring. */
  hit(x: number, y: number, mirrorX: boolean, mirrorY: boolean, slop: number): Hole | null {
    let best: Hole | null = null;
    let bestDistance = HOLE_RADIUS * 1.5 + slop;
    for (const h of this.holes) {
      if (!h.active || h.dying) continue;
      for (let c = 0; c < 4; c++) {
        if ((c & 1 && !mirrorX) || (c & 2 && !mirrorY)) continue;
        const hx = c & 1 ? -h.x : h.x;
        const hy = c & 2 ? -h.y : h.y;
        const d = Math.hypot(hx - x, hy - y);
        if (d < bestDistance) {
          bestDistance = d;
          best = h;
        }
      }
    }
    return best;
  }

  remove(hole: Hole): void {
    hole.dying = true;
  }

  clear(): void {
    for (const h of this.holes) if (h.active) h.dying = true;
  }

  /** Runs on real time so placing and removing stays responsive while frozen. */
  update(realDt: number, field: ForceField, mirrorX: number, mirrorY: number): void {
    const dt = Math.min(realDt, 1 / 30);
    field.resetSources();
    let instance = 0;
    for (const h of this.holes) {
      if (!h.active) continue;
      if (h.dying) {
        h.scale -= dt * 3.2;
        if (h.scale <= 0) {
          h.scale = 0;
          h.active = false;
          continue;
        }
      } else {
        // Spring in with a little overshoot.
        h.velocity += ((1 - h.scale) * 90 - h.velocity * 11) * dt;
        h.scale += h.velocity * dt;
      }
      const presence = Math.max(h.scale, 0);
      for (let c = 0; c < 4; c++) {
        const flipX = c & 1 ? -1 : 1;
        const flipY = c & 2 ? -1 : 1;
        const weight = (c & 1 ? mirrorX : 1) * (c & 2 ? mirrorY : 1);
        if (weight <= 0.002) continue;
        const x = h.x * flipX;
        const y = h.y * flipY;
        field.addSource(x, y, HOLE_RADIUS, presence * weight);
        this.center.setXYZW(instance, x, y, 0, HOLE_RADIUS * DISK_SCALE * presence * weight);
        this.tilt.setXYZW(instance, h.tiltX * flipY, h.roll * flipX * flipY, h.seed, h.spin * flipX * flipY);
        instance++;
      }
    }
    this.center.needsUpdate = instance > 0;
    this.tilt.needsUpdate = instance > 0;
    this.geometry.instanceCount = instance;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
