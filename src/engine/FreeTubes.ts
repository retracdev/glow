import type { ForceField } from './ForceField';
import { writeRow, type TubeMesh } from './TubeMesh';

const HEAD_STEP = 1 / 120;
const MAX_HEAD_STEPS = 10;
const POINT_DRAG = 1.15;
const BASE_RADIUS = 0.078;

export interface Anchors {
  /** World-space anchor per tube index is `x[i % count]`. */
  x: Float32Array;
  y: Float32Array;
  count: number;
  /** 0 = follow the pointer, 1 = follow the idle choreography. */
  auto: number;
  autoRadiusX: number;
  autoRadiusY: number;
  /** How far tubes orbit their anchor, in world units. */
  spread: number;
}

export interface TubeDrive {
  speed: number;
  trail: number;
  orbitBoost: number;
  rateBoost: number;
  stiffnessBoost: number;
  flowAmp: number;
}

/**
 * The always-alive tubes. Each head chases an anchor on an underdamped spring
 * and drops samples behind it. Samples keep their momentum and drift through
 * the force field, so a trail bends, curls and heals on its own.
 */
export class FreeTubes {
  private readonly K: number;
  private readonly max: number;
  private readonly field: ForceField;
  private readonly mesh: TubeMesh;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly heat: Float32Array;
  private readonly thin: Float32Array;
  private readonly head: Int32Array;
  private readonly count: Int32Array;

  private readonly hp: Float32Array;
  private readonly hPrev: Float32Array;
  private readonly hv: Float32Array;
  private readonly target: Float32Array;
  private readonly seed: Float32Array;
  private readonly phase: Float32Array;
  private readonly stiffness: Float32Array;
  private readonly radius: Float32Array;
  private readonly orbit: Float32Array;
  private readonly scale: Float32Array;
  private readonly frames: { x: number; y: number; z: number }[] = [];

  private readonly orderedPos: Float32Array;
  private readonly orderedRadius: Float32Array;
  private readonly orderedHeat: Float32Array;

  private desired = 0;
  private accumulator = 0;
  private sampleClock = 0;
  private orbitTime = 0;
  private autoTime = Math.random() * 40;
  instancesDirty = true;

  constructor(K: number, maxTubes: number, mesh: TubeMesh, field: ForceField) {
    this.K = K;
    this.max = maxTubes;
    this.mesh = mesh;
    this.field = field;
    const points = K * maxTubes;
    this.pos = new Float32Array(points * 3);
    this.vel = new Float32Array(points * 3);
    this.age = new Float32Array(points);
    this.heat = new Float32Array(points);
    this.thin = new Float32Array(points).fill(1);
    this.head = new Int32Array(maxTubes);
    this.count = new Int32Array(maxTubes);
    this.hp = new Float32Array(maxTubes * 3);
    this.hPrev = new Float32Array(maxTubes * 3);
    this.hv = new Float32Array(maxTubes * 3);
    this.target = new Float32Array(maxTubes * 3);
    this.seed = new Float32Array(maxTubes * 4);
    this.phase = new Float32Array(maxTubes);
    this.stiffness = new Float32Array(maxTubes);
    this.radius = new Float32Array(maxTubes);
    this.orbit = new Float32Array(maxTubes);
    this.scale = new Float32Array(maxTubes);
    this.orderedPos = new Float32Array(K * 3);
    this.orderedRadius = new Float32Array(K);
    this.orderedHeat = new Float32Array(K);
    for (let i = 0; i < maxTubes; i++) {
      this.seed[i * 4] = Math.random() * 100;
      this.seed[i * 4 + 1] = 0.55 + Math.random() * 0.75;
      this.seed[i * 4 + 2] = 0.45 + Math.random() * 0.7;
      this.seed[i * 4 + 3] = Math.random() * 100;
      // Golden-ratio spacing keeps neighbouring tubes in clearly different colours.
      this.phase[i] = (i * 0.618034) % 1;
      this.stiffness[i] = 26 + Math.random() * 62;
      this.radius[i] = BASE_RADIUS * (0.72 + Math.random() * 0.56);
      this.orbit[i] = 0.45 + Math.random() * 0.85;
      this.frames.push({ x: 0, y: 1, z: 0 });
    }
  }

  setCount(count: number, spawnX: number, spawnY: number): void {
    const next = Math.min(count, this.max);
    for (let i = this.desired; i < next; i++) {
      if (this.scale[i] > 0.01) continue;
      const o = i * 3;
      this.hp[o] = spawnX;
      this.hp[o + 1] = spawnY;
      this.hp[o + 2] = 0;
      this.hPrev.set(this.hp.subarray(o, o + 3), o);
      this.hv.fill(0, o, o + 3);
      this.count[i] = 0;
    }
    this.desired = next;
  }

  /** Radial shove from an explosion, applied once to every nearby point. */
  impulse(x: number, y: number, z: number, strength: number, radius: number): void {
    const K = this.K;
    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] <= 0) continue;
      const base = t * K;
      const count = this.count[t];
      let ring = this.head[t];
      for (let j = 0; j < count; j++) {
        const i = base + ring;
        this.kick(this.pos, this.vel, i * 3, x, y, z, strength, radius, i);
        ring = ring === 0 ? K - 1 : ring - 1;
      }
      this.kick(this.hp, this.hv, t * 3, x, y, z, strength * 0.6, radius, -1);
    }
  }

  private kick(
    p: Float32Array,
    v: Float32Array,
    o: number,
    x: number,
    y: number,
    z: number,
    strength: number,
    radius: number,
    heatIndex: number,
  ): void {
    const dx = p[o] - x;
    const dy = p[o + 1] - y;
    const dz = p[o + 2] - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
    if (d >= radius) return;
    const fall = 1 - d / radius;
    const push = (strength * fall * fall) / d;
    v[o] += dx * push;
    v[o + 1] += dy * push;
    v[o + 2] += dz * push + (dz >= 0 ? 0.4 : -0.4) * strength * fall * fall;
    if (heatIndex >= 0) this.heat[heatIndex] = Math.max(this.heat[heatIndex], fall);
  }

  step(dt: number, anchors: Anchors, drive: TubeDrive): void {
    if (dt <= 0) return;
    this.updateScales(dt);
    this.updateTargets(dt, anchors, drive);

    const interval = Math.max(drive.trail / (this.K - 2), HEAD_STEP);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= HEAD_STEP && steps < MAX_HEAD_STEPS) {
      this.accumulator -= HEAD_STEP;
      steps++;
      this.stepHeads(drive);
      this.sampleClock += HEAD_STEP;
      if (this.sampleClock >= interval) {
        this.sampleClock -= interval;
        this.dropSamples();
      }
    }
    if (steps === MAX_HEAD_STEPS) this.accumulator = 0;
    this.stepPoints(dt, drive);
  }

  /** Publishes the current state to the shared texture, including the partial head step. */
  write(): void {
    const K = this.K;
    const alpha = this.accumulator / HEAD_STEP;
    const px = this.orderedPos;
    const rad = this.orderedRadius;
    const hot = this.orderedHeat;
    for (let t = 0; t < this.max; t++) {
      const scale = this.scale[t];
      if (scale <= 0) continue;
      const baseR = this.radius[t];
      const o = t * 3;
      px[0] = this.hPrev[o] + (this.hp[o] - this.hPrev[o]) * alpha;
      px[1] = this.hPrev[o + 1] + (this.hp[o + 1] - this.hPrev[o + 1]) * alpha;
      px[2] = this.hPrev[o + 2] + (this.hp[o + 2] - this.hPrev[o + 2]) * alpha;
      const speed = Math.hypot(this.hv[o], this.hv[o + 1], this.hv[o + 2]);
      rad[0] = baseR * scale;
      hot[0] = Math.min(speed * 0.08, 1);

      const base = t * K;
      const count = this.count[t];
      let ring = this.head[t];
      let n = 1;
      for (let j = 0; j < count && n < K; j++) {
        const i = base + ring;
        const q = i * 3;
        const w = n * 3;
        px[w] = this.pos[q];
        px[w + 1] = this.pos[q + 1];
        px[w + 2] = this.pos[q + 2];
        const life = Math.max(1 - this.age[i] * this.lifeInverse, 0);
        const shaped = life >= 0.7 ? 1 : (life / 0.7) ** 0.6;
        rad[n] = baseR * scale * shaped * this.thin[i];
        hot[n] = this.heat[i];
        n++;
        ring = ring === 0 ? K - 1 : ring - 1;
      }
      writeRow(this.mesh.data, K, t, n, px, rad, hot, this.frames[t]);
    }
  }

  writeInstances(): void {
    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] > 0) this.mesh.addInstance(t, this.phase[t], this.radius[t]);
    }
  }

  private lifeInverse = 1;

  private updateScales(dt: number): void {
    for (let t = 0; t < this.max; t++) {
      const goal = t < this.desired ? 1 : 0;
      const before = this.scale[t];
      if (before === goal) continue;
      const delta = dt * 1.8;
      const next = goal > before ? Math.min(before + delta, 1) : Math.max(before - delta, 0);
      this.scale[t] = next;
      if ((before === 0) !== (next === 0)) this.instancesDirty = true;
    }
  }

  private updateTargets(dt: number, a: Anchors, drive: TubeDrive): void {
    this.orbitTime += dt * drive.speed * drive.rateBoost;
    this.autoTime += dt * drive.speed;
    const time = this.orbitTime;
    const auto = a.auto;
    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] <= 0) continue;
      const s = t * 4;
      const seed = this.seed[s];
      const w1 = this.seed[s + 1];
      const w2 = this.seed[s + 2];
      const seed2 = this.seed[s + 3];

      let ax = a.x[t % a.count];
      let ay = a.y[t % a.count];
      if (auto > 0.001) {
        // Idle choreography: each tube runs the same path slightly behind the last,
        // so they stream past each other as a loose braid.
        const at = this.autoTime * 1.05 - t * 0.085;
        const px =
          Math.sin(at * 0.71 + 1.3) * 0.72 + Math.sin(at * 0.29 + 0.4) * 0.22 + Math.sin(at * 1.37) * 0.06;
        const py =
          Math.sin(at * 1.03) * 0.62 + Math.cos(at * 0.43 + 2.2) * 0.24 + Math.sin(at * 1.9 + 1.0) * 0.08;
        ax += (px * a.autoRadiusX - ax) * auto;
        ay += (py * a.autoRadiusY - ay) * auto;
      }

      const r = this.orbit[t] * a.spread * drive.orbitBoost;
      const o1 = time * w1 + seed;
      const o2 = time * w2 * 1.27 + seed2;
      const o = t * 3;
      this.target[o] = ax + r * (Math.sin(o1) + 0.45 * Math.sin(o2 * 2.1 + seed));
      this.target[o + 1] = ay + r * (Math.cos(o1 * 0.87 + seed2) + 0.45 * Math.cos(o2 * 1.7));
      this.target[o + 2] = (0.35 + a.spread * 0.9) * Math.sin(o2 + seed * 0.5) * drive.orbitBoost;
    }
  }

  private stepHeads(drive: TubeDrive): void {
    const h = HEAD_STEP;
    const field = this.field;
    const speedFactor = 0.55 + 0.45 * drive.speed;
    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] <= 0) continue;
      const o = t * 3;
      const k = this.stiffness[t] * speedFactor * drive.stiffnessBoost;
      // Underdamped: heads overshoot a little, which gives moves their whip.
      const c = 2 * Math.sqrt(k) * 0.56;
      const x = this.hp[o];
      const y = this.hp[o + 1];
      const z = this.hp[o + 2];
      field.ax = field.ay = field.az = 0;
      field.wells(x, y, z, 0.55);
      this.hPrev[o] = x;
      this.hPrev[o + 1] = y;
      this.hPrev[o + 2] = z;
      this.hv[o] += ((this.target[o] - x) * k - this.hv[o] * c + field.ax + field.gravityX) * h;
      this.hv[o + 1] += ((this.target[o + 1] - y) * k - this.hv[o + 1] * c + field.ay + field.gravityY) * h;
      this.hv[o + 2] += ((this.target[o + 2] - z) * k - this.hv[o + 2] * c + field.az) * h;
      this.hp[o] = x + this.hv[o] * h;
      this.hp[o + 1] = y + this.hv[o + 1] * h;
      this.hp[o + 2] = z + this.hv[o + 2] * h;
    }
  }

  private dropSamples(): void {
    const K = this.K;
    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] <= 0) continue;
      const nextRing = (this.head[t] + 1) % K;
      this.head[t] = nextRing;
      this.count[t] = Math.min(this.count[t] + 1, K - 1);
      const i = t * K + nextRing;
      const q = i * 3;
      const o = t * 3;
      this.pos[q] = this.hp[o];
      this.pos[q + 1] = this.hp[o + 1];
      this.pos[q + 2] = this.hp[o + 2];
      // Samples inherit some head momentum, so fast flicks throw the tail outward.
      this.vel[q] = this.hv[o] * 0.34;
      this.vel[q + 1] = this.hv[o + 1] * 0.34;
      this.vel[q + 2] = this.hv[o + 2] * 0.34;
      this.age[i] = 0;
      this.thin[i] = 1;
      this.heat[i] = Math.min(Math.hypot(this.hv[o], this.hv[o + 1], this.hv[o + 2]) * 0.075, 1);
    }
  }

  private stepPoints(dt: number, drive: TubeDrive): void {
    const K = this.K;
    const field = this.field;
    const { pos, vel, age, heat, thin } = this;
    const lifeInverse = 1 / drive.trail;
    this.lifeInverse = lifeInverse;
    const damp = Math.exp(-POINT_DRAG * dt);
    const heatDecay = Math.exp(-2.2 * dt);
    const flowAmp = drive.flowAmp;

    for (let t = 0; t < this.max; t++) {
      if (this.scale[t] <= 0) continue;
      const base = t * K;
      let count = this.count[t];
      let ring = this.head[t];
      for (let j = 0; j < count; j++) {
        const i = base + ring;
        const a = age[i] + dt;
        if (a >= drive.trail) {
          count = j;
          break;
        }
        age[i] = a;
        const q = i * 3;
        const x = pos[q];
        const y = pos[q + 1];
        const z = pos[q + 2];
        // Young trail follows the head; older trail is carried by the flow.
        const n = a * lifeInverse;
        const influence = n > 0.3 ? 1 : n * 3.3333;
        field.flow(x, y, z, flowAmp * influence * influence);
        field.wells(x, y, z, 1);
        // Weak pull to the depth plane so tubes stay in a readable volume.
        const vx = (vel[q] + field.ax * dt) * damp;
        const vy = (vel[q + 1] + field.ay * dt) * damp;
        const vz = (vel[q + 2] + (field.az - z * 0.28) * dt) * damp;
        vel[q] = vx;
        vel[q + 1] = vy;
        vel[q + 2] = vz;
        pos[q] = x + vx * dt;
        pos[q + 1] = y + vy * dt;
        pos[q + 2] = z + vz * dt;
        heat[i] *= heatDecay;
        thin[i] += (field.thin - thin[i]) * Math.min(dt * 8, 1);
        ring = ring === 0 ? K - 1 : ring - 1;
      }
      this.count[t] = count;

      // Light Laplacian smoothing removes kinks from sudden pointer jumps and kicks.
      if (count > 2) {
        let prev = (this.head[t] - 0 + K) % K;
        let cur = prev === 0 ? K - 1 : prev - 1;
        for (let j = 1; j < count - 1; j++) {
          const next = cur === 0 ? K - 1 : cur - 1;
          const a = (base + prev) * 3;
          const b = (base + cur) * 3;
          const c = (base + next) * 3;
          pos[b] += (pos[a] + pos[c] - 2 * pos[b]) * 0.06;
          pos[b + 1] += (pos[a + 1] + pos[c + 1] - 2 * pos[b + 1]) * 0.06;
          pos[b + 2] += (pos[a + 2] + pos[c + 2] - 2 * pos[b + 2]) * 0.06;
          prev = cur;
          cur = next;
        }
      }
    }
  }
}
