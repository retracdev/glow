import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  HalfFloatType,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { isSmallDevice, type GlowSettings, type Tool } from '../settings';
import { BlackHoles, HOLE_RADIUS, type Hole } from './BlackHoles';
import { ForceField } from './ForceField';
import { FreeTubes, type Anchors, type TubeDrive } from './FreeTubes';
import { LensEffect } from './LensEffect';
import { Particles } from './Particles';
import { Strokes } from './Strokes';
import { BACKDROP_FRAG, BACKDROP_VERT, DUST_FRAG, DUST_VERT } from './shaders';
import { TubeMesh } from './TubeMesh';

const MAX_FREE_TUBES = 32;
const FOV = 38;
const WORLD_HEIGHT = 10;
const MIN_WORLD_WIDTH = 7.2;
const CHAOS_DURATION = 7.5;
const MAX_POINTERS = 5;
const SHOCK_SLOTS = 4;
const IDLE_BEFORE_AUTO = 9;
const BASE_FLOW = 1.9;

export interface GlowCallbacks {
  onChaosChange?: (active: boolean) => void;
}

interface PointerState {
  id: number;
  ndcX: number;
  ndcY: number;
  downX: number;
  downY: number;
  strokeId: number;
  brushX: number;
  brushY: number;
  brushReady: boolean;
  hole: Hole | null;
  holeMoved: boolean;
}

interface Shock {
  x: number;
  y: number;
  age: number;
  life: number;
  amp: number;
}

/**
 * The renderer and everything it draws. React only calls the small public API
 * below; nothing here depends on UI state, and the frame loop never reaches back
 * into React.
 */
export class GlowEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: GlowCallbacks;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 80);
  private readonly lens = new LensEffect();
  private readonly lensPass: EffectPass;
  private readonly bloom: BloomEffect;
  private readonly field = new ForceField();
  private readonly tubeMesh: TubeMesh;
  private readonly tubes: FreeTubes;
  private readonly strokes: Strokes;
  private readonly particles: Particles;
  private readonly blackHoles: BlackHoles;
  private readonly resizeObserver: ResizeObserver;
  private readonly small = isSmallDevice();

  // Uniforms shared across materials.
  private readonly uTime = new Uniform(0);
  private readonly uGain = new Uniform(1);
  private readonly uIntro = new Uniform(0);
  private readonly uHue = new Uniform(0);
  private readonly uRadiusScale = new Uniform(1);
  private readonly uPalette = new Uniform([new Color(), new Color(), new Color(), new Color()]);
  private readonly uLightPos = new Uniform([new Vector3(), new Vector3(), new Vector3(), new Vector3()]);
  private readonly uLightColor = new Uniform([new Color(), new Color(), new Color(), new Color()]);
  private readonly uBg = new Uniform(new Color());
  private readonly uGlowA = new Uniform(new Color());
  private readonly uGlowB = new Uniform(new Color());
  private readonly uPosA = new Uniform(new Vector2());
  private readonly uPosB = new Uniform(new Vector2());
  private readonly uAspect = new Uniform(1);
  private readonly uDustScale = new Uniform(1);

  private readonly targetPalette = [new Color(), new Color(), new Color(), new Color()];
  private readonly targetBg = new Color();
  private readonly scratch = new Vector3();
  private readonly flashColor = new Color();

  private readonly backdropGeometry: BufferGeometry;
  private readonly backdropMaterial: ShaderMaterial;
  private readonly dustGeometry: BufferGeometry;
  private readonly dustMaterial: ShaderMaterial;

  private settings: GlowSettings;
  private tool: Tool = 'flow';
  private frozen = false;
  private timeScale = 1;
  private simTime = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = true;
  private disposed = false;

  private width = 1;
  private height = 1;
  private viewW = WORLD_HEIGHT;
  private viewH = WORLD_HEIGHT;
  private cameraDistance = 14;
  private qualityLevel = 0;
  private readonly dprLevels: number[];
  private frameTimes = 0;
  private frameSamples = 0;
  private warmupFrames = 45;

  // Pointer input.
  private readonly pointers = new Map<number, PointerState>();
  private lastNdcX = 0.3;
  private lastNdcY = 0.1;
  private hoverNdcX = 0;
  private hoverNdcY = 0;
  private hasInteracted = false;
  private sinceInput = Infinity;
  private pointerSpeed = 0;
  private prevAnchorX = 0;
  private prevAnchorY = 0;
  private spread = 1;
  private autoWeight = 1;
  private readonly anchors: Anchors = {
    x: new Float32Array(MAX_POINTERS),
    y: new Float32Array(MAX_POINTERS),
    count: 1,
    auto: 1,
    autoRadiusX: 4,
    autoRadiusY: 4,
    spread: 1,
  };
  private readonly drive: TubeDrive = {
    speed: 1,
    trail: 2.4,
    orbitBoost: 1,
    rateBoost: 1,
    stiffnessBoost: 1,
    flowAmp: 1,
  };

  // Mirror.
  private mirrorX = false;
  private mirrorY = false;
  private mirrorAmountX = 0;
  private mirrorAmountY = 0;

  // Effects.
  private readonly shocks: Shock[] = [];
  private flash = 0;
  private readonly flashPos = new Vector3();
  private cameraShake = 0;
  private parallaxX = 0;
  private parallaxY = 0;

  // Chaos.
  private chaosActive = false;
  private chaosTime = 0;
  private chaosEnv = 0;
  private chaosPhaseClock = 0;
  private chaosBoomClock = 0;
  private chaosHue = 0;
  private chaosOrbit = 1;
  private chaosRate = 1;
  private chaosFlow = 1;
  private chaosFlowGoal = 1;
  private chaosOrbitGoal = 1;
  private chaosRateGoal = 1;
  private chaosGravX = 0;
  private chaosGravY = 0;
  private chaosGravZ = 0;
  private chaosGravGoalX = 0;
  private chaosGravGoalY = 0;
  private chaosGravGoalZ = 0;

  constructor(container: HTMLElement, settings: GlowSettings, callbacks: GlowCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.settings = settings;
    this.dprLevels = this.small ? [1.5, 1.25, 1] : [2, 1.5, 1.25, 1];

    this.renderer = new WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = NoToneMapping;
    const canvas = this.renderer.domElement;
    canvas.className = 'glow-canvas';
    canvas.setAttribute('aria-label', 'Glow canvas. Move to steer the glowing tubes.');
    container.appendChild(canvas);

    const shared = {
      uTime: this.uTime,
      uGain: this.uGain,
      uIntro: this.uIntro,
      uHue: this.uHue,
      uRadiusScale: this.uRadiusScale,
      uPalette: this.uPalette,
      uLightPos: this.uLightPos,
      uLightColor: this.uLightColor,
    };

    // Backdrop: near-black with a faint wash that follows the light.
    this.backdropGeometry = new BufferGeometry();
    this.backdropGeometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.backdropMaterial = new ShaderMaterial({
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uBg: this.uBg,
        uGlowA: this.uGlowA,
        uGlowB: this.uGlowB,
        uPosA: this.uPosA,
        uPosB: this.uPosB,
        uAspect: this.uAspect,
      },
    });
    const backdrop = new Mesh(this.backdropGeometry, this.backdropMaterial);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -10;
    this.scene.add(backdrop);

    // Dust: drifting motes that give the empty space real depth.
    const dustCount = this.small ? 260 : 620;
    const dustPos = new Float32Array(dustCount * 3);
    const dustSeed = new Float32Array(dustCount * 4);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 34;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      dustPos[i * 3 + 2] = -9 + Math.random() * 11;
      for (let c = 0; c < 4; c++) dustSeed[i * 4 + c] = Math.random();
    }
    this.dustGeometry = new BufferGeometry();
    this.dustGeometry.setAttribute('position', new BufferAttribute(dustPos, 3));
    this.dustGeometry.setAttribute('aSeed', new BufferAttribute(dustSeed, 4));
    this.dustMaterial = new ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.uTime,
        uHue: this.uHue,
        uPalette: this.uPalette,
        uScale: this.uDustScale,
        uIntro: this.uIntro,
      },
    });
    const dust = new Points(this.dustGeometry, this.dustMaterial);
    dust.frustumCulled = false;
    dust.renderOrder = -5;
    this.scene.add(dust);

    const K = this.small ? 90 : 150;
    const subdivisions = this.small ? 2 : 3;
    const radial = this.small ? 7 : 10;
    const maxStrokes = this.small ? 10 : 16;
    const rows = MAX_FREE_TUBES + maxStrokes * 3;
    this.tubeMesh = new TubeMesh(K, subdivisions, radial, rows, shared, this.scene);
    this.tubes = new FreeTubes(K, MAX_FREE_TUBES, this.tubeMesh, this.field);
    this.strokes = new Strokes(K, maxStrokes, MAX_FREE_TUBES, this.tubeMesh, this.field);
    this.particles = new Particles(this.small ? 2600 : 9000, { uTime: this.uTime, uGain: this.uGain }, this.scene);
    this.blackHoles = new BlackHoles(
      this.small ? 3 : 6,
      { uTime: this.uTime, uGain: this.uGain, uHue: this.uHue, uPalette: this.uPalette },
      this.scene,
    );

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
      multisampling: this.small ? 0 : 4,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.lensPass = new EffectPass(this.camera, this.lens);
    this.composer.addPass(this.lensPass);
    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0.32,
      luminanceSmoothing: 0.42,
      intensity: 1,
      radius: 0.74,
      levels: this.small ? 6 : 8,
    });
    const finish = new EffectPass(
      this.camera,
      this.bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
      new VignetteEffect({ offset: 0.28, darkness: 0.62 }),
    );
    finish.dithering = true;
    this.composer.addPass(finish);

    this.applySettings(settings, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.prewarm();
    this.tick(performance.now());
  }

  // Public API ------------------------------------------------------------------

  setSettings(settings: GlowSettings): void {
    this.applySettings(settings, false);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.updateCursor();
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  setMirror(x: boolean, y: boolean): void {
    this.mirrorX = x;
    this.mirrorY = y;
  }

  triggerChaos(): void {
    if (this.chaosActive) return;
    this.chaosActive = true;
    this.chaosTime = 0;
    this.chaosPhaseClock = 0;
    this.chaosBoomClock = 0.25;
    this.callbacks.onChaosChange?.(true);
  }

  clear(): void {
    this.strokes.clear();
    this.blackHoles.clear();
    this.particles.clear();
    for (const shock of this.shocks) shock.age = shock.life;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const canvas = this.renderer.domElement;
    this.resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.tubeMesh.dispose();
    this.particles.dispose();
    this.blackHoles.dispose();
    this.backdropGeometry.dispose();
    this.backdropMaterial.dispose();
    this.dustGeometry.dispose();
    this.dustMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // Settings --------------------------------------------------------------------

  private applySettings(settings: GlowSettings, immediate: boolean): void {
    const previous = this.settings;
    this.settings = settings;
    settings.palette.forEach((hex, i) => {
      this.targetPalette[i].set(hex);
      if (immediate) this.uPalette.value[i].copy(this.targetPalette[i]);
    });
    this.targetBg.set(settings.background);
    if (immediate) this.uBg.value.copy(this.targetBg);
    if (immediate || previous.tubeCount !== settings.tubeCount) {
      const spawn = this.anchors;
      this.tubes.setCount(settings.tubeCount, spawn.x[0], spawn.y[0]);
    }
    this.drive.trail = settings.trail;
    this.drive.speed = settings.speed;
  }

  // Layout ----------------------------------------------------------------------

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.width = width;
    this.height = height;
    this.applyPixelRatio();

    const aspect = width / height;
    // Keep a consistent minimum world size, so tubes stay in proportion on a phone.
    this.viewH = Math.max(WORLD_HEIGHT, MIN_WORLD_WIDTH / aspect);
    this.viewW = this.viewH * aspect;
    this.camera.aspect = aspect;
    this.cameraDistance = this.viewH / 2 / Math.tan((FOV * Math.PI) / 360);
    this.camera.position.set(0, 0, this.cameraDistance);
    this.camera.updateProjectionMatrix();
    this.uAspect.value = aspect;
    this.lens.viewAspect.value = aspect;
    this.anchors.autoRadiusX = this.viewW * 0.5 * 0.92;
    this.anchors.autoRadiusY = this.viewH * 0.5 * 0.92;
  }

  private applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprLevels[this.qualityLevel]);
    this.renderer.setPixelRatio(dpr);
    this.composer.setSize(this.width, this.height);
    this.uDustScale.value = 34 * dpr * (this.height / 900);
  }

  // Input -----------------------------------------------------------------------

  private ndcFromEvent(e: PointerEvent, out: { ndcX: number; ndcY: number }): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    out.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    out.ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  /** Unprojects to the z=0 plane. Writes to `scratch`, so nothing is allocated per frame. */
  private worldFromNdc(nx: number, ny: number): Vector3 {
    const v = this.scratch.set(nx, ny, 0.5).unproject(this.camera);
    v.sub(this.camera.position);
    const t = -this.camera.position.z / v.z;
    return v.multiplyScalar(t).add(this.camera.position);
  }

  private markInput(): void {
    this.sinceInput = 0;
    this.hasInteracted = true;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    const state: PointerState = {
      id: e.pointerId,
      ndcX: 0,
      ndcY: 0,
      downX: e.clientX,
      downY: e.clientY,
      strokeId: -1,
      brushX: 0,
      brushY: 0,
      brushReady: false,
      hole: null,
      holeMoved: false,
    };
    this.ndcFromEvent(e, state);
    if (this.pointers.size >= MAX_POINTERS) return;
    this.pointers.set(e.pointerId, state);
    this.lastNdcX = state.ndcX;
    this.lastNdcY = state.ndcY;
    this.markInput();

    const world = this.worldFromNdc(state.ndcX, state.ndcY);
    switch (this.tool) {
      case 'hole': {
        const slop = e.pointerType === 'touch' ? 0.35 : 0;
        const hit = this.blackHoles.hit(world.x, world.y, this.mirrorX, this.mirrorY, slop);
        if (hit) state.hole = hit;
        else this.blackHoles.place(world.x, world.y);
        break;
      }
      case 'explode':
        this.explode(world.x, world.y);
        break;
      case 'draw':
        state.strokeId = this.strokes.begin(world.x, world.y);
        break;
      case 'flow':
        // On touch, a dragging finger steers. A mouse has hover for that, so its drag draws.
        if (e.pointerType !== 'touch') state.strokeId = this.strokes.begin(world.x, world.y);
        break;
    }
    if (state.strokeId >= 0) {
      state.brushX = world.x;
      state.brushY = world.y;
      state.brushReady = true;
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId);
    if (state) {
      this.ndcFromEvent(e, state);
      this.lastNdcX = state.ndcX;
      this.lastNdcY = state.ndcY;
      if (state.hole) {
        const moved = Math.hypot(e.clientX - state.downX, e.clientY - state.downY);
        if (moved > 8 || state.holeMoved) {
          state.holeMoved = true;
          const world = this.worldFromNdc(state.ndcX, state.ndcY);
          state.hole.x = world.x;
          state.hole.y = world.y;
        }
      }
      this.markInput();
      return;
    }
    if (e.pointerType === 'touch') return;
    this.ndcFromEvent(e, this.moveProbe);
    this.lastNdcX = this.moveProbe.ndcX;
    this.lastNdcY = this.moveProbe.ndcY;
    this.hoverNdcX = this.lastNdcX;
    this.hoverNdcY = this.lastNdcY;
    this.markInput();
    this.updateCursor();
  };

  private readonly moveProbe = { ndcX: 0, ndcY: 0 };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;
    this.pointers.delete(e.pointerId);
    if (state.strokeId >= 0) this.strokes.end(state.strokeId);
    if (state.hole && !state.holeMoved && e.type === 'pointerup') {
      this.blackHoles.remove(state.hole);
      const world = this.worldFromNdc(state.ndcX, state.ndcY);
      this.tubes.impulse(world.x, world.y, 0, 3, 3);
    }
    this.sinceInput = 0;
  };

  private updateCursor(): void {
    const canvas = this.renderer.domElement;
    let cursor = 'default';
    if (this.tool === 'explode') cursor = 'crosshair';
    if (this.tool === 'hole') {
      const world = this.worldFromNdc(this.hoverNdcX, this.hoverNdcY);
      cursor = this.blackHoles.hit(world.x, world.y, this.mirrorX, this.mirrorY, 0) ? 'pointer' : 'crosshair';
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.raf);
  };

  private readonly onContextRestored = (): void => {
    this.running = true;
    this.lastFrame = 0;
    this.tick(performance.now());
  };

  private readonly onVisibility = (): void => {
    this.lastFrame = 0;
    this.frameSamples = 0;
    this.frameTimes = 0;
    this.warmupFrames = 30;
  };

  // Effects ---------------------------------------------------------------------

  private explode(x: number, y: number, power = 1): void {
    const reduced = this.settings.reducedEffects;
    const amount = Math.round((this.small ? 240 : 520) * (reduced ? 0.45 : 1) * power);
    this.particles.burst(x, y, 0.3, this.simTime, this.uPalette.value, amount);

    const kick = 13 * power;
    const radius = 5.2 * (0.7 + power * 0.3);
    for (let c = 0; c < 4; c++) {
      if ((c & 1 && !this.mirrorX) || (c & 2 && !this.mirrorY)) continue;
      const ex = c & 1 ? -x : x;
      const ey = c & 2 ? -y : y;
      this.tubes.impulse(ex, ey, 0, kick, radius);
      this.strokes.impulse(ex, ey, kick * 0.8, radius);
    }

    if (!reduced) {
      this.addShock(x, y, power);
      this.cameraShake = Math.min(this.cameraShake + 0.3 * power, 0.5);
    }
    this.flash = reduced ? 0.5 : 1;
    this.flashPos.set(x, y, 1.2);
    const colors = this.uPalette.value;
    this.flashColor.copy(colors[Math.floor(Math.random() * colors.length)]).lerp(WHITE, 0.45);
  }

  private addShock(x: number, y: number, power: number): void {
    const shock: Shock = { x, y, age: 0, life: 0.85, amp: 0.045 * power };
    if (this.shocks.length >= SHOCK_SLOTS) this.shocks.shift();
    this.shocks.push(shock);
  }

  // Simulation ------------------------------------------------------------------

  private prewarm(): void {
    // Run the simulation before the first paint, so the first frame is already beautiful.
    const seconds = this.settings.trail + 1;
    this.updateAnchors(1 / 60);
    const dt = this.small ? 1 / 45 : 1 / 60;
    this.tubes.setCount(this.settings.tubeCount, 0, 0);
    for (let t = 0; t < seconds; t += dt) {
      this.simTime += dt;
      this.field.flowTime = this.simTime * 0.42;
      this.drive.flowAmp = BASE_FLOW;
      this.tubes.step(dt, this.anchors, this.drive);
    }
  }

  private updateChaos(dt: number): void {
    const reduced = this.settings.reducedEffects;
    if (this.chaosActive) {
      this.chaosTime += dt;
      const t = this.chaosTime;
      const rampIn = Math.min(t / 0.5, 1);
      const rampOut = Math.min((CHAOS_DURATION - t) / 1.8, 1);
      this.chaosEnv = Math.max(Math.min(rampIn, rampOut), 0);
      this.chaosEnv = this.chaosEnv * this.chaosEnv * (3 - 2 * this.chaosEnv);

      this.chaosPhaseClock -= dt;
      if (this.chaosPhaseClock <= 0) {
        // Every "gust" re-rolls how the world misbehaves.
        this.chaosPhaseClock = 0.55 + Math.random() * 0.75;
        this.chaosFlowGoal = 2.5 + Math.random() * (reduced ? 2 : 6);
        this.chaosOrbitGoal = 1.5 + Math.random() * 2.6;
        this.chaosRateGoal = 1.2 + Math.random() * (reduced ? 0.6 : 2.6);
        const g = reduced ? 3 : 9;
        const angle = Math.random() * Math.PI * 2;
        this.chaosGravGoalX = Math.cos(angle) * g * Math.random();
        this.chaosGravGoalY = Math.sin(angle) * g * Math.random();
        this.chaosGravGoalZ = (Math.random() - 0.5) * g * 0.6;
      }
      this.chaosBoomClock -= dt;
      if (this.chaosBoomClock <= 0 && !reduced && t < CHAOS_DURATION - 1.5) {
        this.chaosBoomClock = 0.45 + Math.random() * 0.75;
        const x = (Math.random() - 0.5) * this.viewW * 0.85;
        const y = (Math.random() - 0.5) * this.viewH * 0.8;
        this.explode(x, y, 0.55 + Math.random() * 0.4);
      }
      if (t >= CHAOS_DURATION) {
        this.chaosActive = false;
        this.chaosEnv = 0;
        this.callbacks.onChaosChange?.(false);
      }
    }

    const env = this.chaosEnv;
    const ease = 1 - Math.exp(-dt * 4);
    this.chaosFlow += (this.chaosFlowGoal - this.chaosFlow) * ease;
    this.chaosOrbit += (this.chaosOrbitGoal - this.chaosOrbit) * ease;
    this.chaosRate += (this.chaosRateGoal - this.chaosRate) * ease;
    this.chaosGravX += (this.chaosGravGoalX - this.chaosGravX) * ease;
    this.chaosGravY += (this.chaosGravGoalY - this.chaosGravY) * ease;
    this.chaosGravZ += (this.chaosGravGoalZ - this.chaosGravZ) * ease;

    // All chaos is scaled by the envelope, so normal behaviour returns on its own.
    this.chaosHue += dt * (reduced ? 0.35 : 1.5);
    this.uHue.value = this.chaosHue * env;
    this.drive.orbitBoost = 1 + (this.chaosOrbit - 1) * env;
    this.drive.rateBoost = 1 + (this.chaosRate - 1) * env;
    this.drive.stiffnessBoost = 1 - 0.35 * env;
    this.field.gravityX = this.chaosGravX * env;
    this.field.gravityY = this.chaosGravY * env;
    this.field.gravityZ = this.chaosGravZ * env;
    this.uRadiusScale.value = 1 + env * 0.32 * Math.sin(this.simTime * 7.1) * (reduced ? 0.3 : 1);
  }

  private updateAnchors(realDt: number): void {
    const a = this.anchors;
    let count = 0;
    for (const state of this.pointers.values()) {
      if (count >= MAX_POINTERS) break;
      const world = this.worldFromNdc(state.ndcX, state.ndcY);
      a.x[count] = world.x;
      a.y[count] = world.y;
      count++;
    }
    if (count === 0) {
      const world = this.worldFromNdc(this.lastNdcX, this.lastNdcY);
      a.x[0] = world.x;
      a.y[0] = world.y;
      count = 1;
    }
    a.count = count;

    this.sinceInput += realDt;
    const wantAuto = !this.hasInteracted || this.sinceInput > IDLE_BEFORE_AUTO;
    const rate = wantAuto ? 0.45 : 9;
    this.autoWeight += ((wantAuto ? 1 : 0) - this.autoWeight) * (1 - Math.exp(-realDt * rate));
    a.auto = this.autoWeight;

    // Fast moves tighten the bundle; resting lets tubes bloom outward around the cursor.
    const moved = Math.hypot(a.x[0] - this.prevAnchorX, a.y[0] - this.prevAnchorY);
    this.prevAnchorX = a.x[0];
    this.prevAnchorY = a.y[0];
    const speed = realDt > 0 ? moved / realDt : 0;
    this.pointerSpeed += (speed - this.pointerSpeed) * (1 - Math.exp(-realDt * 6));
    let goal = 1.15 - Math.min(this.pointerSpeed * 0.055, 0.72);
    if (this.isDrawing()) goal = 0.16;
    goal = goal * (1 - this.autoWeight) + 1.05 * this.autoWeight;
    this.spread += (goal - this.spread) * (1 - Math.exp(-realDt * 3.2));
    a.spread = this.spread;
  }

  private isDrawing(): boolean {
    for (const state of this.pointers.values()) if (state.strokeId >= 0) return true;
    return false;
  }

  private updateBrushes(realDt: number): void {
    const follow = 1 - Math.exp(-realDt * 28);
    for (const state of this.pointers.values()) {
      if (state.strokeId < 0 || !state.brushReady) continue;
      const world = this.worldFromNdc(state.ndcX, state.ndcY);
      state.brushX += (world.x - state.brushX) * follow;
      state.brushY += (world.y - state.brushY) * follow;
      this.strokes.extend(state.strokeId, state.brushX, state.brushY);
    }
  }

  private updateShocks(dt: number): void {
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const shock = this.shocks[i];
      shock.age += dt;
      if (shock.age >= shock.life) this.shocks.splice(i, 1);
    }
    for (let i = 0; i < SHOCK_SLOTS; i++) {
      const shock = this.shocks[i];
      if (!shock) {
        this.lens.setShock(i, 0, 0, 0, 0);
        continue;
      }
      const p = this.scratch.set(shock.x, shock.y, 0).project(this.camera);
      const n = shock.age / shock.life;
      const radius = (1 - (1 - n) ** 2.4) * 0.62;
      this.lens.setShock(i, p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, radius, shock.amp * (1 - n) ** 1.4);
    }
  }

  private updateLens(): void {
    const lens = this.lens;
    lens.beginHoles();
    for (const h of this.blackHoles.holes) {
      if (!h.active || h.scale <= 0.001) continue;
      for (let c = 0; c < 4; c++) {
        const weight = c === 0 ? 1 : c === 1 ? this.mirrorAmountX : c === 2 ? this.mirrorAmountY : this.mirrorAmountX * this.mirrorAmountY;
        if (weight <= 0.002) continue;
        const p = this.scratch.set(c & 1 ? -h.x : h.x, c & 2 ? -h.y : h.y, 0).project(this.camera);
        const radius = (HOLE_RADIUS / this.viewH) * h.scale * weight;
        lens.addHole(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, radius, Math.min(h.scale * weight, 1));
      }
    }
    lens.endHoles();
    const reduced = this.settings.reducedEffects;
    lens.aberration.value = reduced ? 0 : 0.012 + this.chaosEnv * 0.09;
    this.lensPass.enabled = lens.needed;
    lens.ringColor.value.copy(this.uPalette.value[0]).lerp(WHITE, 0.55);
  }

  private updateLights(realDt: number, t: number): void {
    const positions = this.uLightPos.value;
    const colors = this.uLightColor.value;
    const palette = this.uPalette.value;
    const a = this.anchors;
    const glow = this.settings.glow;

    // The first light rides with the action; two others roam so the shading keeps changing.
    const ax = a.auto > 0.5 ? Math.sin(t * 0.44 + 1.3) * a.autoRadiusX * 0.7 : a.x[0];
    const ay = a.auto > 0.5 ? Math.sin(t * 0.64) * a.autoRadiusY * 0.6 : a.y[0];
    positions[0].lerp(this.scratch.set(ax, ay, 2.2), 1 - Math.exp(-realDt * 7));
    colors[0].copy(palette[0]).multiplyScalar(9 * glow);
    positions[1].set(Math.cos(t * 0.31) * this.viewW * 0.42, Math.sin(t * 0.47) * this.viewH * 0.42, 2.8);
    colors[1].copy(palette[1]).multiplyScalar(7 * glow);
    positions[2].set(Math.sin(t * 0.23 + 2) * this.viewW * 0.42, Math.cos(t * 0.37 + 1) * this.viewH * 0.42, 2.6);
    colors[2].copy(palette[2]).multiplyScalar(7 * glow);

    this.flash = Math.max(this.flash - realDt * 2.8, 0);
    positions[3].copy(this.flashPos);
    colors[3].copy(this.flashColor).multiplyScalar(26 * this.flash * this.flash);

    // The backdrop wash follows the two most visible lights, at a very low level.
    this.uGlowA.value.copy(palette[0]);
    this.uGlowB.value.copy(palette[1]);
    this.uPosA.value.set((positions[0].x / this.viewW) * 2, (positions[0].y / this.viewH) * 2);
    this.uPosB.value.set((positions[1].x / this.viewW) * 2, (positions[1].y / this.viewH) * 2);
  }

  private updateCamera(realDt: number): void {
    const mirroring = Math.max(this.mirrorAmountX, this.mirrorAmountY);
    // Parallax is off while mirroring, since a moving camera would break screen symmetry.
    const amount = (this.settings.reducedEffects ? 0 : 0.45) * (1 - mirroring);
    const px = this.lastNdcX * amount * (1 - this.autoWeight);
    const py = this.lastNdcY * amount * 0.7 * (1 - this.autoWeight);
    const ease = 1 - Math.exp(-realDt * 2.2);
    this.parallaxX += (px - this.parallaxX) * ease;
    this.parallaxY += (py - this.parallaxY) * ease;

    let shakeX = 0;
    let shakeY = 0;
    this.cameraShake = Math.max(this.cameraShake - realDt * 1.4, 0);
    if (this.cameraShake > 0 && !this.settings.reducedEffects) {
      const s = this.cameraShake * this.cameraShake;
      shakeX = Math.sin(this.simTime * 61) * s * 0.5;
      shakeY = Math.cos(this.simTime * 53) * s * 0.5;
    }
    const sway = this.settings.reducedEffects ? 0 : (1 - mirroring) * 0.12;
    this.camera.position.set(
      this.parallaxX + shakeX + Math.sin(this.simTime * 0.17) * sway,
      this.parallaxY + shakeY + Math.cos(this.simTime * 0.13) * sway,
      this.cameraDistance,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  // Frame loop ------------------------------------------------------------------

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const rawDt = this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / 60;
    this.lastFrame = now;
    const realDt = Math.min(rawDt, 1 / 20);

    // Ease in and out of frozen time so the stop feels physical.
    const goal = this.frozen ? 0 : 1;
    const ease = this.frozen ? 11 : 4.5;
    this.timeScale += (goal - this.timeScale) * (1 - Math.exp(-realDt * ease));
    if (this.frozen && this.timeScale < 0.002) this.timeScale = 0;
    if (!this.frozen && this.timeScale > 0.998) this.timeScale = 1;

    const reducedSpeed = this.settings.reducedEffects ? 0.65 : 1;
    const dt = realDt * this.timeScale * reducedSpeed;
    this.simTime += dt;
    this.uTime.value = this.simTime;

    // Colours crossfade rather than snapping.
    const blend = 1 - Math.exp(-realDt * 4.5);
    for (let i = 0; i < 4; i++) this.uPalette.value[i].lerp(this.targetPalette[i], blend);
    this.uBg.value.lerp(this.targetBg, blend);
    this.uIntro.value = Math.min(this.uIntro.value + realDt * 1.6, 1);

    const mirrorEase = 1 - Math.exp(-realDt * 5);
    this.mirrorAmountX += ((this.mirrorX ? 1 : 0) - this.mirrorAmountX) * mirrorEase;
    this.mirrorAmountY += ((this.mirrorY ? 1 : 0) - this.mirrorAmountY) * mirrorEase;
    this.tubeMesh.setMirror(this.mirrorAmountX, this.mirrorAmountY);
    this.particles.setMirror(this.mirrorAmountX, this.mirrorAmountY);

    this.updateCamera(realDt);
    this.updateChaos(dt);
    this.updateAnchors(realDt);
    this.updateBrushes(realDt);
    this.blackHoles.update(realDt, this.field, this.mirrorAmountX, this.mirrorAmountY);

    this.field.flowTime += dt * 0.42 * this.settings.speed * (1 + this.chaosEnv * 1.6);
    this.drive.flowAmp = BASE_FLOW + (this.chaosFlow - 1) * this.chaosEnv;
    this.tubes.step(dt, this.anchors, this.drive);
    this.strokes.step(dt, realDt);
    this.tubes.write();
    this.strokes.write();
    if (this.tubes.instancesDirty || this.strokes.instancesDirty) {
      this.tubes.instancesDirty = false;
      this.strokes.instancesDirty = false;
      this.tubeMesh.beginInstances();
      this.tubes.writeInstances();
      this.strokes.writeInstances();
      this.tubeMesh.endInstances();
    }
    this.tubeMesh.upload();

    this.updateShocks(dt);
    this.updateLens();
    this.updateLights(realDt, this.simTime);

    const glow = this.settings.glow;
    const pulse = 1 + this.chaosEnv * 0.45;
    this.uGain.value = (0.46 + glow * 0.54) * pulse;
    this.bloom.intensity = (this.settings.reducedEffects ? 0.65 : 0.95) * glow * pulse;

    this.composer.render(realDt);
    this.watchPerformance(rawDt);
  };

  /** Steps resolution down if the device can't keep up. Never steps back up, to avoid visible flip-flopping. */
  private watchPerformance(rawDt: number): void {
    if (this.warmupFrames > 0) {
      this.warmupFrames--;
      return;
    }
    this.frameTimes += rawDt;
    this.frameSamples++;
    if (this.frameSamples < 75) return;
    const average = this.frameTimes / this.frameSamples;
    this.frameTimes = 0;
    this.frameSamples = 0;
    if (average > 1 / 42 && this.qualityLevel < this.dprLevels.length - 1) {
      this.qualityLevel++;
      this.warmupFrames = 30;
      this.applyPixelRatio();
    }
  }
}

const WHITE = new Color(1, 1, 1);
