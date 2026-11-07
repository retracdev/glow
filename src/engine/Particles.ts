import {
  AdditiveBlending,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Uniform,
  Vector2,
  type Color,
  type IUniform,
  type Scene,
} from 'three';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders';
import { MIRROR_SIGNS } from './TubeMesh';

/**
 * Explosion sparks. Motion is analytic in the vertex shader, so the CPU only
 * touches a particle when spawning it. Stored in a ring buffer: bursts overwrite
 * the oldest sparks, which are nearly faded by then.
 */
export class Particles {
  private readonly geometry = new InstancedBufferGeometry();
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly c: InstancedBufferAttribute;
  private readonly materials: ShaderMaterial[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly capacity: number;
  private cursor = 0;

  constructor(capacity: number, shared: Record<string, IUniform>, scene: Scene) {
    this.capacity = capacity;
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.geometry.setAttribute('position', new BufferAttribute(quad, 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = this.attribute('aA');
    this.b = this.attribute('aB');
    this.c = this.attribute('aC');
    this.geometry.instanceCount = capacity;

    for (const [sx, sy] of MIRROR_SIGNS) {
      const material = new ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        uniforms: {
          ...shared,
          uMirror: new Uniform(new Vector2(sx, sy)),
          uMirrorScale: new Uniform(1),
        },
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.materials.push(material);
      this.meshes.push(mesh);
      scene.add(mesh);
    }
    this.setMirror(0, 0);
  }

  private attribute(name: string): InstancedBufferAttribute {
    const attribute = new InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
    attribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute(name, attribute);
    return attribute;
  }

  setMirror(x: number, y: number): void {
    const scales = [1, x, y, x * y];
    for (let i = 1; i < 4; i++) {
      this.materials[i].uniforms.uMirrorScale.value = scales[i];
      this.meshes[i].visible = scales[i] > 0.002;
    }
  }

  burst(x: number, y: number, z: number, time: number, palette: Color[], amount: number): void {
    const first = this.cursor;
    const spawned = Math.min(amount + 3, this.capacity);
    const baseHue = Math.floor(Math.random() * palette.length);

    for (let n = 0; n < amount; n++) {
      const kind = Math.random();
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = Math.random() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      let speed: number;
      let life: number;
      let size: number;
      let dirZ = cosPhi;
      let flat = sinPhi;
      if (kind < 0.18) {
        // Equatorial ring: gives each burst a crisp expanding shape.
        speed = 15 + Math.random() * 2.2;
        life = 0.7 + Math.random() * 0.5;
        size = 0.03 + Math.random() * 0.02;
        dirZ = (Math.random() - 0.5) * 0.08;
        flat = 1;
      } else if (kind < 0.68) {
        // Fast sparks.
        speed = 5 + Math.random() ** 0.6 * 15;
        life = 0.65 + Math.random() * 0.9;
        size = 0.018 + Math.random() * 0.028;
      } else {
        // Slow embers that linger after the burst.
        speed = 0.8 + Math.random() * 4.5;
        life = 1.4 + Math.random() * 1.9;
        size = 0.028 + Math.random() * 0.052;
      }
      const color = palette[(baseHue + Math.floor(Math.random() * 2.4)) % palette.length];
      const white = Math.random() < 0.14 ? 0.7 : 0.05;
      const gain = 1.3 + Math.random() * 1.6;
      this.put(
        x,
        y,
        z,
        time,
        Math.cos(theta) * flat * speed,
        Math.sin(theta) * flat * speed,
        dirZ * speed,
        life,
        (color.r + (1 - color.r) * white) * gain,
        (color.g + (1 - color.g) * white) * gain,
        (color.b + (1 - color.b) * white) * gain,
        size,
      );
    }

    // Three soft flash layers give the burst a hot, blooming centre.
    const flash = palette[baseHue];
    this.put(x, y, z, time, 0, 0, 0, 0.16, 9, 9, 9, 0.7);
    this.put(x, y, z, time, 0, 0, 0, 0.4, flash.r * 3, flash.g * 3, flash.b * 3, 1.7);
    this.put(x, y, z, time, 0, 0, 0, 0.8, flash.r * 0.6, flash.g * 0.6, flash.b * 0.6, 3.2);

    this.flush(first, spawned);
  }

  clear(): void {
    this.b.array.fill(0);
    this.b.clearUpdateRanges();
    this.b.needsUpdate = true;
  }

  private put(
    x: number,
    y: number,
    z: number,
    birth: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    r: number,
    g: number,
    b: number,
    size: number,
  ): void {
    const i = this.cursor;
    this.a.setXYZW(i, x, y, z, birth);
    this.b.setXYZW(i, vx, vy, vz, life);
    this.c.setXYZW(i, r, g, b, size);
    this.cursor = (i + 1) % this.capacity;
  }

  /** Uploads only the slots just written, which may wrap around the ring. */
  private flush(first: number, count: number): void {
    for (const attribute of [this.a, this.b, this.c]) {
      // Ranges accumulate until the next upload, so two bursts in a frame both land.
      const untilEnd = Math.min(count, this.capacity - first);
      attribute.addUpdateRange(first * 4, untilEnd * 4);
      if (count > untilEnd) attribute.addUpdateRange(0, (count - untilEnd) * 4);
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const mesh of this.meshes) mesh.removeFromParent();
  }
}
