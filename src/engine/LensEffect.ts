import { Effect, EffectAttribute } from 'postprocessing';
import { Color, Uniform, Vector4 } from 'three';
import { LENS_FRAG } from './shaders';

export const MAX_LENS_HOLES = 24;
const MAX_SHOCKS = 4;

/** Screen-space gravitational lensing, shockwave ripples and chromatic aberration. */
export class LensEffect extends Effect {
  private readonly holes: Vector4[];
  private readonly shocks: Vector4[];
  private readonly holeCount: Uniform<number>;
  readonly aberration: Uniform<number>;
  readonly viewAspect: Uniform<number>;
  readonly ringColor: Uniform<Color>;
  private count = 0;

  constructor() {
    const holes = Array.from({ length: MAX_LENS_HOLES }, () => new Vector4());
    const shocks = Array.from({ length: MAX_SHOCKS }, () => new Vector4());
    const holeCount = new Uniform(0);
    const aberration = new Uniform(0);
    const viewAspect = new Uniform(1);
    const ringColor = new Uniform(new Color(1, 1, 1));
    super('GlowLens', LENS_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uHoles', new Uniform(holes)],
        ['uHoleCount', holeCount],
        ['uShocks', new Uniform(shocks)],
        ['uAberration', aberration],
        ['uViewAspect', viewAspect],
        ['uRingColor', ringColor],
      ]),
    });
    this.holes = holes;
    this.shocks = shocks;
    this.holeCount = holeCount;
    this.aberration = aberration;
    this.viewAspect = viewAspect;
    this.ringColor = ringColor;
  }

  beginHoles(): void {
    this.count = 0;
  }

  addHole(u: number, v: number, radius: number, strength: number): void {
    if (this.count < MAX_LENS_HOLES) this.holes[this.count++].set(u, v, radius, strength);
  }

  endHoles(): void {
    this.holeCount.value = this.count;
  }

  setShock(index: number, u: number, v: number, radius: number, amplitude: number): void {
    this.shocks[index].set(u, v, radius, amplitude);
  }

  /** True when a full-screen resample would change the image at all. */
  get needed(): boolean {
    if (this.count > 0 || this.aberration.value > 0.0005) return true;
    for (const shock of this.shocks) if (shock.w > 0) return true;
    return false;
  }
}
