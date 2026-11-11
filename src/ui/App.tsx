import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAccountState, subscribeAccount } from '../account/account';
import { GlowEngine } from '../engine/GlowEngine';
import { defaultSettings, type GlowSettings, type Tool } from '../settings';
import { Brand } from './Brand';
import { Hint } from './Hint';
import { isGateOpen, LaunchGate } from './LaunchGate';
import { hasOnboarded, Onboarding } from './Onboarding';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';

const IDLE_MS = 5000;

const TOOL_HINTS: Record<Tool, { touch: string; mouse: string }> = {
  flow: { touch: 'Drag to steer the tubes', mouse: 'Move to steer. Drag to draw.' },
  draw: { touch: 'Drag to draw a glowing braid', mouse: 'Drag to draw a glowing braid' },
  hole: {
    touch: 'Tap to place a black hole. Tap one to remove it, or drag to move it.',
    mouse: 'Click to place a black hole. Click one to remove it, or drag to move it.',
  },
  explode: { touch: 'Tap anywhere for a Particle Burst', mouse: 'Click anywhere for a Particle Burst' },
};

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlowEngine | null>(null);
  const [settings, setSettings] = useState<GlowSettings>(defaultSettings);
  const [tool, setTool] = useState<Tool>('flow');
  const [frozen, setFrozen] = useState(false);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);
  const account = useSyncExternalStore(subscribeAccount, getAccountState);
  const [onboarded, setOnboarded] = useState(hasOnboarded);
  const finishOnboarding = useCallback(() => setOnboarded(true), []);
  const gateOpen = isGateOpen(account);
  // Glow is hands-off behind the launch gate and during the onboarding.
  const locked = !gateOpen || !onboarded;
  // The onboarding has its own large logo, so the corner one waits until it's done.
  const showBrand = onboarded || (!gateOpen && account.status !== 'unknown');

  const coarse = useRef(window.matchMedia('(pointer: coarse)').matches);
  const latest = useRef({ settings, tool, frozen, mirrorX, mirrorY, locked });
  latest.current = { settings, tool, frozen, mirrorX, mirrorY, locked };
  const hintId = useRef(0);

  const showHint = useCallback((text: string) => {
    hintId.current += 1;
    setHint({ id: hintId.current, text });
  }, []);

  // The engine lives outside React state. Effects below push changes to it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let engine: GlowEngine;
    try {
      engine = new GlowEngine(stage, latest.current.settings, { onChaosChange: setChaos });
    } catch (error) {
      console.error('Glow could not start WebGL', error);
      setWebglError(true);
      return;
    }
    engineRef.current = engine;
    engine.setTool(latest.current.tool);
    engine.setFrozen(latest.current.frozen);
    engine.setMirror(latest.current.mirrorX, latest.current.mirrorY);
    engine.setInputEnabled(!latest.current.locked);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => engineRef.current?.setSettings(settings), [settings]);
  useEffect(() => engineRef.current?.setTool(tool), [tool]);
  useEffect(() => engineRef.current?.setFrozen(frozen), [frozen]);
  useEffect(() => engineRef.current?.setMirror(mirrorX, mirrorY), [mirrorX, mirrorY]);
  useEffect(() => engineRef.current?.setInputEnabled(!locked), [locked]);

  // A first hint that disappears on its own, once the onboarding is out of the way.
  useEffect(() => {
    if (locked) return;
    const text = coarse.current ? 'Drag to steer the tubes' : 'Move to steer. Drag to draw.';
    const timer = window.setTimeout(() => showHint(text), 900);
    return () => window.clearTimeout(timer);
  }, [showHint, locked]);

  // Controls recede when you're just watching or playing.
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const selectTool = useCallback(
    (next: Tool) => {
      setTool(next);
      showHint(TOOL_HINTS[next][coarse.current ? 'touch' : 'mouse']);
    },
    [showHint],
  );

  const triggerChaos = useCallback(() => engineRef.current?.triggerChaos(), []);
  const clear = useCallback(() => engineRef.current?.clear(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.locked) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, select, textarea')) return;
      switch (e.key.toLowerCase()) {
        case ' ':
          if (target?.matches('button')) return;
          e.preventDefault();
          setFrozen((v) => !v);
          break;
        case 'f':
          setFrozen((v) => !v);
          break;
        case '1':
          selectTool('flow');
          break;
        case 'b':
          selectTool('hole');
          break;
        case 'e':
          selectTool('explode');
          break;
        case 'x':
          triggerChaos();
          break;
        case 'm':
          // Cycles off, left-right, top-bottom, both.
          setMirrorX((x) => {
            const y = latest.current.mirrorY;
            if (!x && !y) return true;
            if (x && !y) {
              setMirrorY(true);
              return false;
            }
            if (!x && y) return true;
            setMirrorY(false);
            return false;
          });
          break;
        case 'c':
          clear();
          break;
        case 'escape':
          setPanelOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear, selectTool, triggerChaos]);

  return (
    <div className={`app${idle && !panelOpen ? ' is-idle' : ''}`}>
      <div className="stage" ref={stageRef} />
      {webglError && (
        <div className="fallback" role="alert">
          <h1>Glow needs WebGL 2</h1>
          <p>Your browser or device couldn't start it. Try turning on hardware acceleration or using another browser.</p>
        </div>
      )}
      {!gateOpen && !webglError && <LaunchGate account={account} />}
      {gateOpen && !onboarded && !webglError && <Onboarding onDone={finishOnboarding} />}
      {showBrand && <Brand />}
      {!locked && <div className="dock">
        {hint && <Hint key={hint.id} text={hint.text} />}
        {panelOpen && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanelOpen(false)} />}
        <Toolbar
          tool={tool}
          showDraw={coarse.current}
          frozen={frozen}
          mirrorX={mirrorX}
          mirrorY={mirrorY}
          chaos={chaos}
          panelOpen={panelOpen}
          onTool={selectTool}
          onFrozen={setFrozen}
          onMirrorX={setMirrorX}
          onMirrorY={setMirrorY}
          onChaos={triggerChaos}
          onClear={clear}
          onTogglePanel={() => setPanelOpen((v) => !v)}
        />
      </div>}
    </div>
  );
}
