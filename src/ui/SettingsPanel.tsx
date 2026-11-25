import { LoaderCircle, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { canCheckForUpdates, checkForUpdates, currentVersion } from '../runtime';
import { BACKGROUNDS, LIMITS, PRESETS, defaultSettings, type GlowSettings, type PaletteColors } from '../settings';

interface SliderProps {
  label: string;
  value: number;
  display: string;
  limits: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}

function Slider({ label, value, display, limits, onChange }: SliderProps) {
  const fill = ((value - limits.min) / (limits.max - limits.min)) * 100;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/*
 * Check for Updates, ported from Simple Soundboard's footer button. It asks the live updater
 * (public/live-update.js) to fetch the newest Glow and restart it in this same page, which
 * shows the toast that follows. With art on the canvas it only restarts for a newer version,
 * so checking never wipes a drawing for nothing.
 */
function UpdateCheck({ hasArt }: { hasArt: () => boolean }) {
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!canCheckForUpdates()) return null;

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setFailed(false);
    try {
      // When Glow restarts, this panel goes away with the rest of the old app.
      await checkForUpdates({ onlyIfNewer: hasArt() });
    } catch (error) {
      console.warn('Glow: Check for Updates failed.', error);
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const version = currentVersion();
  return (
    <div className="update-check">
      <span>
        Glow {version && `version ${version}`}
        <small>{failed ? "Couldn't check for updates. Try again in a moment." : 'Updates install without reloading'}</small>
      </span>
      <button type="button" className="update-button" onClick={() => void check()} disabled={checking} aria-busy={checking}>
        {checking ? (
          <LoaderCircle className="update-spinner" size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
        )}
        {checking ? 'Checking…' : 'Check for Updates'}
      </button>
    </div>
  );
}

interface SettingsPanelProps {
  settings: GlowSettings;
  onChange: (settings: GlowSettings) => void;
  onClose: () => void;
  // Whether there's art on the canvas that a restart would wipe.
  hasArt: () => boolean;
}

export function SettingsPanel({ settings, onChange, onClose, hasArt }: SettingsPanelProps) {
  const set = <K extends keyof GlowSettings>(key: K, value: GlowSettings[K]) => onChange({ ...settings, [key]: value });
  const setColor = (index: number, hex: string) => {
    const palette = [...settings.palette] as PaletteColors;
    palette[index] = hex;
    onChange({ ...settings, palette, paletteId: null });
  };
  const bgIsCustom = !BACKGROUNDS.some((b) => b.color === settings.background);

  return (
    <section className="panel" aria-label="Settings">
      <div className="panel-head">
        <h2>Settings</h2>
        <div className="panel-actions">
          <button type="button" className="panel-icon" aria-label="Reset settings" title="Reset settings" onClick={() => onChange(defaultSettings())}>
            <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="panel-icon" aria-label="Close settings" title="Close settings" onClick={onClose}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div className="field">
          <span className="field-label">Colors</span>
          <div className="presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`preset${settings.paletteId === preset.id ? ' is-active' : ''}`}
                aria-pressed={settings.paletteId === preset.id}
                onClick={() => onChange({ ...settings, paletteId: preset.id, palette: [...preset.colors] })}
              >
                <span className="preset-swatch" style={{ background: `linear-gradient(120deg, ${preset.colors.join(', ')})` }} />
                {preset.name}
              </button>
            ))}
          </div>
          <div className="swatches">
            {settings.palette.map((hex, i) => (
              <label key={i} className="swatch" style={{ background: hex }} title={`Tube color ${i + 1}`}>
                <input type="color" value={hex} aria-label={`Tube color ${i + 1}`} onChange={(e) => setColor(i, e.target.value)} />
              </label>
            ))}
          </div>
        </div>

        <Slider label="Glow" value={settings.glow} display={`${Math.round(settings.glow * 100)}%`} limits={LIMITS.glow} onChange={(v) => set('glow', v)} />
        <Slider label="Tubes" value={settings.tubeCount} display={String(settings.tubeCount)} limits={LIMITS.tubeCount} onChange={(v) => set('tubeCount', v)} />
        <Slider label="Speed" value={settings.speed} display={`${settings.speed.toFixed(2)}x`} limits={LIMITS.speed} onChange={(v) => set('speed', v)} />
        <Slider label="Trail length" value={settings.trail} display={`${settings.trail.toFixed(1)}s`} limits={LIMITS.trail} onChange={(v) => set('trail', v)} />

        <div className="field">
          <span className="field-label">Background</span>
          <div className="swatches">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.color}
                type="button"
                className={`swatch swatch-bg${settings.background === bg.color ? ' is-active' : ''}`}
                style={{ background: bg.color }}
                aria-label={bg.name}
                aria-pressed={settings.background === bg.color}
                title={bg.name}
                onClick={() => set('background', bg.color)}
              />
            ))}
            <label
              className={`swatch swatch-bg swatch-custom${bgIsCustom ? ' is-active' : ''}`}
              style={bgIsCustom ? { background: settings.background } : undefined}
              title="Custom background"
            >
              <input type="color" value={settings.background} aria-label="Custom background color" onChange={(e) => set('background', e.target.value)} />
            </label>
          </div>
        </div>

        <label className="toggle">
          <span>
            Reduced effects
            <small>Calmer motion, no shake or flashes</small>
          </span>
          <input type="checkbox" role="switch" checked={settings.reducedEffects} onChange={(e) => set('reducedEffects', e.target.checked)} />
          <span className="toggle-track" aria-hidden="true" />
        </label>

        <UpdateCheck hasArt={hasArt} />
      </div>
    </section>
  );
}
