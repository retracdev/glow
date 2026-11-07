/**
 * Shared physics environment: the divergence-free flow every point drifts in,
 * chaos gravity, and the gravity wells created by black holes.
 * Everything is flat typed-array data so per-point evaluation never allocates.
 */
export const MAX_SOURCES = 24;
const SOURCE_STRIDE = 4;
const RANGE = 8;
const RANGE_SQ = RANGE * RANGE;

export class ForceField {
  /** Results of `flow` and `wells`, kept on the instance to avoid allocating per call. */
  ax = 0;
  ay = 0;
  az = 0;
  thin = 1;

  flowTime = 0;
  flowFreq = 0.82;
  gravityX = 0;
  gravityY = 0;
  gravityZ = 0;

  /** x, y, horizon radius, mass */
  private readonly sources = new Float32Array(MAX_SOURCES * SOURCE_STRIDE);
  private sourceCount = 0;

  resetSources(): void {
    this.sourceCount = 0;
  }

  addSource(x: number, y: number, rs: number, mass: number): void {
    if (this.sourceCount >= MAX_SOURCES || mass <= 0.001) return;
    const o = this.sourceCount++ * SOURCE_STRIDE;
    this.sources[o] = x;
    this.sources[o + 1] = y;
    this.sources[o + 2] = rs;
    this.sources[o + 3] = mass;
  }

  /** ABC flow: smooth, incompressible and cheap, so tubes curl without clumping. */
  flow(x: number, y: number, z: number, amp: number): void {
    const f = this.flowFreq;
    const t = this.flowTime;
    const t2 = t * 0.73 + 1.7;
    const t3 = t * 0.51 + 4.1;
    this.ax = (Math.sin(z * f + t) + Math.cos(y * f * 1.13 + t2)) * amp + this.gravityX;
    this.ay = (Math.sin(x * f * 0.91 + t2) + Math.cos(z * f + t3)) * amp + this.gravityY;
    this.az = (Math.sin(y * f + t3) + Math.cos(x * f * 1.07 + t)) * amp * 0.7 + this.gravityZ;
  }

  /** Adds black hole gravity and swirl to ax/ay/az and reports how much a point is squeezed. */
  wells(x: number, y: number, z: number, scale: number): void {
    this.thin = 1;
    const s = this.sources;
    for (let i = 0, o = 0; i < this.sourceCount; i++, o += SOURCE_STRIDE) {
      const dx = s[o] - x;
      const dy = s[o + 1] - y;
      const r2 = dx * dx + dy * dy + z * z;
      if (r2 > RANGE_SQ) continue;
      const r = Math.sqrt(r2) + 1e-4;
      const mass = s[o + 3] * scale;
      const pull = (mass * 7.5) / (r2 + 0.14) / r;
      const swirl = (mass * 3.6) / (r + 0.35) / r;
      this.ax += dx * pull - dy * swirl;
      this.ay += dy * pull + dx * swirl;
      this.az -= z * pull * 1.6;
      const near = r / (s[o + 2] * 1.5);
      if (near < 1) this.thin = Math.min(this.thin, 0.18 + 0.82 * near * near);
    }
  }
}
