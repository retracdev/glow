import {
  BufferAttribute,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  Vector2,
  type IUniform,
  type Scene,
} from 'three';
import { TUBE_FRAG, TUBE_VERT } from './shaders';

export const MIRROR_SIGNS: readonly [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Draws every tube from one instanced mesh. Simulations write control points
 * into a float texture and the vertex shader builds the smooth curve, so a tube
 * costs one texture row and no CPU geometry work.
 *
 * Texture layout: row 2n holds xyz + radius, row 2n+1 holds frame normal + heat.
 */
export class TubeMesh {
  readonly data: Float32Array;
  readonly K: number;
  readonly width: number;
  private readonly texture: DataTexture;
  private readonly geometry: InstancedBufferGeometry;
  private readonly instances: InstancedBufferAttribute;
  private readonly materials: ShaderMaterial[] = [];
  private readonly meshes: Mesh[] = [];
  private instanceTotal = 0;

  constructor(
    K: number,
    subdivisions: number,
    radial: number,
    maxRows: number,
    shared: Record<string, IUniform>,
    scene: Scene,
  ) {
    this.K = K;
    this.width = K;
    this.data = new Float32Array(K * maxRows * 2 * 4);
    this.texture = new DataTexture(this.data, K, maxRows * 2, RGBAFormat, FloatType);
    this.texture.internalFormat = 'RGBA32F';
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    const rings = (K - 1) * subdivisions + 1;
    const vertices = new Float32Array(rings * radial * 3);
    let v = 0;
    for (let r = 0; r < rings; r++) {
      const u = r / (rings - 1);
      for (let a = 0; a < radial; a++) {
        const angle = (a / radial) * Math.PI * 2;
        vertices[v++] = u;
        vertices[v++] = Math.cos(angle);
        vertices[v++] = Math.sin(angle);
      }
    }
    const indices = new Uint32Array((rings - 1) * radial * 6);
    let n = 0;
    for (let r = 0; r < rings - 1; r++) {
      for (let a = 0; a < radial; a++) {
        const a1 = (a + 1) % radial;
        const p0 = r * radial + a;
        const p1 = r * radial + a1;
        const p2 = (r + 1) * radial + a;
        const p3 = (r + 1) * radial + a1;
        indices[n++] = p0;
        indices[n++] = p2;
        indices[n++] = p1;
        indices[n++] = p1;
        indices[n++] = p2;
        indices[n++] = p3;
      }
    }

    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(vertices, 3));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.instances = new InstancedBufferAttribute(new Float32Array(maxRows * 3), 3);
    this.instances.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aTube', this.instances);
    this.geometry.instanceCount = 0;

    const uniforms = {
      ...shared,
      uData: new Uniform(this.texture),
      uK: new Uniform(K),
    };
    for (const [sx, sy] of MIRROR_SIGNS) {
      const material = new ShaderMaterial({
        vertexShader: TUBE_VERT,
        fragmentShader: TUBE_FRAG,
        side: DoubleSide,
        uniforms: {
          ...uniforms,
          uMirror: new Uniform(new Vector2(sx, sy)),
          uMirrorScale: new Uniform(1),
        },
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      this.materials.push(material);
      this.meshes.push(mesh);
      scene.add(mesh);
    }
    this.setMirror(0, 0);
  }

  setMirror(x: number, y: number): void {
    const scales = [1, x, y, x * y];
    for (let i = 1; i < 4; i++) {
      this.materials[i].uniforms.uMirrorScale.value = scales[i];
      this.meshes[i].visible = scales[i] > 0.002;
    }
  }

  /** Rebuild the list of drawn rows. Called only when a tube appears or disappears. */
  beginInstances(): void {
    this.instanceTotal = 0;
  }

  addInstance(row: number, phase: number, radius: number): void {
    this.instances.setXYZ(this.instanceTotal++, row, phase, radius);
  }

  endInstances(): void {
    this.instances.needsUpdate = true;
    this.geometry.instanceCount = this.instanceTotal;
  }

  upload(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.texture.dispose();
    for (const material of this.materials) material.dispose();
    for (const mesh of this.meshes) mesh.removeFromParent();
  }
}

/**
 * Writes an ordered polyline to a texture row, transporting the tube frame along
 * it so the cross-section never twists. Unused texels collapse onto the final point.
 * `start` is where this polyline begins in `px` and `heat`; `radii` always starts at 0.
 */
export function writeRow(
  data: Float32Array,
  K: number,
  row: number,
  count: number,
  px: Float32Array,
  radii: Float32Array,
  heat: Float32Array,
  frame: { x: number; y: number; z: number },
  start = 0,
): void {
  let o = row * 2 * K * 4;
  let f = (row * 2 + 1) * K * 4;
  let nx = frame.x;
  let ny = frame.y;
  let nz = frame.z;
  const last = Math.max(count - 1, 0);
  for (let i = 0; i < K; i++) {
    const j = i < count ? i : last;
    const a = (start + Math.max(j - 1, 0)) * 3;
    const b = (start + Math.min(j + 1, last)) * 3;
    let tx = px[b] - px[a];
    let ty = px[b + 1] - px[a + 1];
    let tz = px[b + 2] - px[a + 2];
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-6 && i < count) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const d = nx * tx + ny * ty + nz * tz;
      let mx = nx - tx * d;
      let my = ny - ty * d;
      let mz = nz - tz * d;
      const ml = Math.hypot(mx, my, mz);
      if (ml > 1e-4) {
        mx /= ml;
        my /= ml;
        mz /= ml;
      } else {
        // Tangent lined up with the old normal: restart from any perpendicular.
        mx = -ty;
        my = tx;
        mz = 0.001;
      }
      nx = mx;
      ny = my;
      nz = mz;
      if (i === 0) {
        frame.x = nx;
        frame.y = ny;
        frame.z = nz;
      }
    }
    const q = (start + j) * 3;
    data[o] = px[q];
    data[o + 1] = px[q + 1];
    data[o + 2] = px[q + 2];
    data[o + 3] = i < count ? radii[j] : 0;
    data[f] = nx;
    data[f + 1] = ny;
    data[f + 2] = nz;
    data[f + 3] = heat[start + j];
    o += 4;
    f += 4;
  }
}
