export type Tool = 'flow' | 'draw' | 'hole' | 'explode';

export type PaletteColors = [string, string, string, string];

export interface PalettePreset {
  id: string;
  name: string;
  colors: PaletteColors;
}

export const PRESETS: PalettePreset[] = [
  { id: 'neon', name: 'Neon', colors: ['#19e3ff', '#8b5cff', '#ff3fb4', '#2f6bff'] },
  { id: 'aurora', name: 'Aurora', colors: ['#3dffb0', '#19c8ff', '#7a5cff', '#d14dff'] },
  { id: 'sunset', name: 'Sunset', colors: ['#ffb03a', '#ff5e3a', '#ff2f7e', '#b13dff'] },
  { id: 'ocean', name: 'Ocean', colors: ['#7df9ff', '#00c2ff', '#0a6cff', '#3a3dff'] },
  { id: 'candy', name: 'Candy', colors: ['#ff7ad9', '#ffd36e', '#7afcff', '#b28dff'] },
  { id: 'ember', name: 'Ember', colors: ['#ffd000', '#ff8a00', '#ff3b1f', '#ff2a6d'] },
  { id: 'lumen', name: 'Lumen', colors: ['#f0edff', '#b9b2ff', '#7a6cff', '#8d89a6'] },
];

export const BACKGROUNDS: { name: string; color: string }[] = [
  { name: 'Void', color: '#05040a' },
  { name: 'Black', color: '#000000' },
  { name: 'Midnight', color: '#050b1a' },
  { name: 'Plum', color: '#12061a' },
  { name: 'Abyss', color: '#02100f' },
];

export interface GlowSettings {
  paletteId: string | null;
  palette: PaletteColors;
  glow: number;
  tubeCount: number;
  speed: number;
  trail: number;
  background: string;
  reducedEffects: boolean;
}

export const LIMITS = {
  glow: { min: 0.2, max: 2, step: 0.05 },
  tubeCount: { min: 1, max: 32, step: 1 },
  speed: { min: 0.25, max: 2.5, step: 0.05 },
  trail: { min: 0.6, max: 6, step: 0.1 },
} as const;

export function isSmallDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function defaultSettings(): GlowSettings {
  const small = isSmallDevice();
  return {
    paletteId: 'neon',
    palette: [...PRESETS[0].colors],
    glow: 1,
    tubeCount: small ? 9 : 14,
    speed: 1,
    trail: 2.4,
    background: BACKGROUNDS[0].color,
    reducedEffects: prefersReducedMotion(),
  };
}
