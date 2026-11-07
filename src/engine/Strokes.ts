import type { ForceField } from './ForceField';
import { writeRow, type TubeMesh } from './TubeMesh';

const STRANDS = 3;
const STROKE_RADIUS = 0.058;
const HELIX_RADIUS = 0.085;
const HELIX_RATE = 3.6;
const REST_SPRING = 9;
const DRAG = 3.2;

interface Stroke {
  active: boolean;
  drawing: boolean;
  fade: number;
  dying: boolean;
  count: number;
  minDist: number;
  arc: number;
  lastX: number;
  lastY: number;
  lastDirX: number;
  lastDirY: number;
  phase: number;
  order: number;
}

/**
 * Drag-drawn tubes. Each stroke is a woven braid of three strands that stays on
 * canvas, breathes gently, and reacts to black holes and explosions before
 * springing back to where it was drawn.
 */
export class Strokes {
  private readonly K: number;
  private readonly mesh: TubeMesh;
  private readonly field: ForceField;
  private readonly firstRow: number;
  private readonly strokes: Stroke[] = [];
  private readonly rest: Float32Array;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly heat: Float32Array;
  private readonly radii: Float32Array;
  private readonly frames: { x: number; y: number; z: number }[] = [];
  private orderCounter = 0;
  private dirty = false;
  instancesDirty = false;

  constructor(K: number, maxStrokes: number, firstRow: number, mesh: TubeMesh, field: ForceField) {
    this.K = K;
    this.mesh = mesh;
    this.field = field;
    this.firstRow = firstRow;
    const rows = maxStrokes * STRANDS;
    this.rest = new Float32Array(rows * K * 3);
    this.pos = new Float32Array(rows * K * 3);
    this.vel = new Float32Array(rows * K * 3);
    this.heat = new Float32Array(rows * K);
    this.radii = new Float32Array(K);
    for (let i = 0; i < maxStrokes; i++) {
      this.strokes.push({
        active: false,
        drawing: false,
        fade: 0,
        dying: false,
        count: 0,
        minDist: 0.05,
        arc: 0,
        lastX: 0,
        lastY: 0,
        lastDirX: 1,
        lastDirY: 0,
        phase: 0,
        order: 0,
      });
    }
    for (let i = 0; i < rows; i++) this.frames.push({ x: 0, y: 1, z: 0 });
  }

  /** Returns a stroke id for `extend` and `end`. */
  begin(x: number, y: number): number {
    let index = this.strokes.findIndex((s) => !s.active);
    if (index < 0) {
      // Pool exhausted: recycle the oldest finished stroke.
      let oldest = Infinity;
      this.strokes.forEach((s, i) => {
        if (!s.drawing && s.order < oldest) {
          oldest = s.order;
          index = i;
        }
      });
      if (index < 0) return -1;
    }
    const s = this.strokes[index];
    s.active = true;
    s.drawing = true;
    s.dying = false;
    s.fade = 1;
    s.count = 0;
    s.minDist = 0.05;
    s.arc = 0;
    s.lastX = x;
    s.lastY = y;
    s.lastDirX = 1;
    s.lastDirY = 0;
    s.phase = Math.random();
    s.order = ++this.orderCounter;
    this.append(index, s, x, y);
    this.instancesDirty = true;

    // Quietly retire the oldest stroke once the pool is nearly full.
    const activeCount = this.strokes.reduce((n, v) => n + (v.active && !v.dying ? 1 : 0), 0);
    if (activeCount >= this.strokes.length) {
      let oldest: Stroke | null = null;
      for (const v of this.strokes) {
        if (v.active && !v.drawing && !v.dying && (!oldest || v.order < oldest.order)) oldest = v;
      }
      if (oldest) oldest.dying = true;
    }
    return index;
  }

  extend(id: number, x: number, y: number): void {
    const s = this.strokes[id];
    if (!s?.drawing) return;
    const dx = x - s.lastX;
    const dy = y - s.lastY;
    const d = Math.hypot(dx, dy);
    if (d < s.minDist) return;
    s.lastDirX = dx / d;
    s.lastDirY = dy / d;
    s.arc += d;
    s.lastX = x;
    s.lastY = y;
    if (s.count >= this.K) this.decimate(id, s);
    this.append(id, s, x, y);
  }

  end(id: number): void {
    const s = this.strokes[id];
    if (!s) return;
    s.drawing = false;
    // A click with no movement leaves a tiny sparkle of a stroke; drop it.
    if (s.count < 3) s.dying = true;
  }

  clear(): void {
    for (const s of this.strokes) {
      if (s.active) {
        s.dying = true;
        s.drawing = false;
      }
    }
  }

  impulse(x: number, y: number, strength: number, radius: number): void {
    const { pos, vel, heat, K } = this;
    this.strokes.forEach((s, id) => {
      if (!s.active) return;
      for (let strand = 0; strand < STRANDS; strand++) {
        const base = (id * STRANDS + strand) * K;
        for (let j = 0; j < s.count; j++) {
          const i = base + j;
          const q = i * 3;
          const dx = pos[q] - x;
          const dy = pos[q + 1] - y;
          const d = Math.hypot(dx, dy, pos[q + 2]) + 1e-3;
          if (d >= radius) continue;
          const fall = 1 - d / radius;
          const push = (strength * fall * fall) / d;
          vel[q] += dx * push;
          vel[q + 1] += dy * push;
          vel[q + 2] += (j % 2 === 0 ? 1 : -1) * strength * 0.3 * fall * fall;
          heat[i] = Math.max(heat[i], fall);
        }
      }
    });
  }

  /** `dt` is simulation time and stops when frozen; `realDt` keeps fades responsive. */
  step(dt: number, realDt: number): void {
    const { field, K, pos, vel, rest, heat } = this;
    const damp = Math.exp(-DRAG * dt);
    const heatDecay = Math.exp(-1.5 * dt);
    this.strokes.forEach((s, id) => {
      if (!s.active) return;
      if (s.dying) {
        s.fade -= realDt * 2.4;
        this.dirty = true;
        if (s.fade <= 0) {
          s.active = false;
          s.dying = false;
          s.count = 0;
          this.instancesDirty = true;
          return;
        }
      }
      if (dt <= 0) return;
      this.dirty = true;
      for (let strand = 0; strand < STRANDS; strand++) {
        const base = (id * STRANDS + strand) * K;
        for (let j = 0; j < s.count; j++) {
          const i = base + j;
          const q = i * 3;
          const x = pos[q];
          const y = pos[q + 1];
          const z = pos[q + 2];
          field.flow(x, y, z, 0.3);
          field.wells(x, y, z, 0.8);
          const vx = (vel[q] + (field.ax + (rest[q] - x) * REST_SPRING) * dt) * damp;
          const vy = (vel[q + 1] + (field.ay + (rest[q + 1] - y) * REST_SPRING) * dt) * damp;
          const vz = (vel[q + 2] + (field.az + (rest[q + 2] - z) * REST_SPRING) * dt) * damp;
          vel[q] = vx;
          vel[q + 1] = vy;
          vel[q + 2] = vz;
          pos[q] = x + vx * dt;
          pos[q + 1] = y + vy * dt;
          pos[q + 2] = z + vz * dt;
          heat[i] = 0.1 + (heat[i] - 0.1) * heatDecay;
        }
      }
    });
  }

  write(): void {
    if (!this.dirty && !this.strokes.some((s) => s.drawing)) return;
    this.dirty = false;
    const { K, radii } = this;
    this.strokes.forEach((s, id) => {
      if (!s.active) return;
      const count = s.count;
      const taperSpan = Math.max(Math.min(count * 0.18, 14), 2);
      for (let j = 0; j < count; j++) {
        const fromStart = Math.min(j / taperSpan, 1);
        const fromEnd = s.drawing ? 1 : Math.min((count - 1 - j) / taperSpan, 1);
        radii[j] = STROKE_RADIUS * Math.max(s.fade, 0) * Math.sqrt(fromStart) * Math.sqrt(fromEnd);
      }
      for (let strand = 0; strand < STRANDS; strand++) {
        const rowIndex = id * STRANDS + strand;
        const base = rowIndex * K;
        writeRow(
          this.mesh.data,
          K,
          this.firstRow + rowIndex,
          count,
          this.pos,
          radii,
          this.heat,
          this.frames[rowIndex],
          base,
        );
      }
    });
  }

  writeInstances(): void {
    this.strokes.forEach((s, id) => {
      if (!s.active) return;
      for (let strand = 0; strand < STRANDS; strand++) {
        this.mesh.addInstance(this.firstRow + id * STRANDS + strand, s.phase + strand / STRANDS, STROKE_RADIUS);
      }
    });
  }

  private append(id: number, s: Stroke, x: number, y: number): void {
    const { K, rest, pos, vel, heat } = this;
    const j = s.count++;
    const perpX = -s.lastDirY;
    const perpY = s.lastDirX;
    for (let strand = 0; strand < STRANDS; strand++) {
      const angle = s.arc * HELIX_RATE + (strand / STRANDS) * Math.PI * 2;
      const side = Math.cos(angle) * HELIX_RADIUS;
      const q = ((id * STRANDS + strand) * K + j) * 3;
      const px = x + perpX * side;
      const py = y + perpY * side;
      const pz = Math.sin(angle) * HELIX_RADIUS;
      rest[q] = pos[q] = px;
      rest[q + 1] = pos[q + 1] = py;
      rest[q + 2] = pos[q + 2] = pz;
      vel[q] = vel[q + 1] = vel[q + 2] = 0;
      heat[(id * STRANDS + strand) * K + j] = 1;
    }
    this.dirty = true;
  }

  /** Halves the resolution of a long stroke so it can keep growing at a fixed row size. */
  private decimate(id: number, s: Stroke): void {
    const { K, rest, pos, vel, heat } = this;
    const kept = Math.ceil(s.count / 2);
    for (let strand = 0; strand < STRANDS; strand++) {
      const base = (id * STRANDS + strand) * K;
      for (let j = 0; j < kept; j++) {
        const to = (base + j) * 3;
        const from = (base + j * 2) * 3;
        for (let c = 0; c < 3; c++) {
          rest[to + c] = rest[from + c];
          pos[to + c] = pos[from + c];
          vel[to + c] = vel[from + c];
        }
        heat[base + j] = heat[base + j * 2];
      }
    }
    s.count = kept;
    s.minDist *= 2;
  }
}
