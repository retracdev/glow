import { ArrowLeft, ArrowRight, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GlowMark } from './Brand';

/*
 * First-visit onboarding: the logo draws itself, settles above a short welcome, and Start
 * leads to a photosensitivity warning. Only "Continue and Start" records the visit, so
 * leaving for retrac.space changes nothing and the onboarding shows again next time.
 */

const COOKIE = 'glow_onboarded';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;
const INTRO_MS = 1400;
const LOADING_MS = 700;
const LEAVE_MS = 550;

export function hasOnboarded(): boolean {
  return document.cookie.split('; ').includes(`${COOKIE}=1`);
}

function rememberOnboarded() {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=1; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

// intro: logo draws in. welcome: text and Start. loading: small spinner popup.
// warning: the popup grown to full size. leaving: fading out into Glow.
type Stage = 'intro' | 'welcome' | 'loading' | 'warning' | 'leaving';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<Stage>('intro');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next: Partial<Record<Stage, [Stage | null, number]>> = {
      intro: ['welcome', INTRO_MS],
      loading: ['warning', LOADING_MS],
      leaving: [null, LEAVE_MS],
    };
    const step = next[stage];
    if (!step) return;
    const timer = window.setTimeout(() => (step[0] ? setStage(step[0]) : onDone()), step[1]);
    return () => window.clearTimeout(timer);
  }, [stage, onDone]);

  // The popup grows from the spinner to exactly fit the warning, so measure the warning.
  useLayoutEffect(() => {
    if (stage !== 'warning') return;
    const measure = () => {
      const el = contentRef.current;
      if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
    };
    measure();
    popupRef.current?.focus();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'warning') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStage('welcome');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  // The popup stays up while leaving, so it fades out with everything else.
  const popupOpen = stage === 'loading' || stage === 'warning' || stage === 'leaving';
  const expanded = stage !== 'loading' && size !== null;

  const start = () => {
    rememberOnboarded();
    setStage('leaving');
  };

  return (
    <div className={`onboarding is-${stage}`}>
      <div className="onb-hero" aria-hidden={popupOpen}>
        <GlowMark className="onb-mark" />
        <div className="onb-copy">
          <h1>Welcome to Glow!</h1>
          <p>A playground of light. Steer glowing tubes, draw neon braids, and set off bursts of color.</p>
          <button
            type="button"
            className="onb-start"
            onClick={() => setStage('loading')}
            disabled={stage !== 'welcome'}
          >
            <span className="onb-start-face" aria-hidden="true" />
            <span className="onb-start-label">Start</span>
            <ArrowRight size={19} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>

      {popupOpen && (
        <div className="onb-scrim">
          <div
            ref={popupRef}
            className={`onb-popup${expanded ? ' is-expanded' : ''}`}
            style={expanded ? size : undefined}
            role="alertdialog"
            aria-modal="true"
            aria-busy={stage === 'loading'}
            aria-labelledby="onb-warning-title"
            aria-describedby="onb-warning-text"
            tabIndex={-1}
          >
            <span className="onb-spinner" aria-hidden="true" />
            <div ref={contentRef} className="onb-warning" inert={stage !== 'warning'}>
              <TriangleAlert className="onb-warning-icon" size={44} strokeWidth={1.8} aria-hidden="true" />
              <h2 id="onb-warning-title">Flashing lights warning</h2>
              <p id="onb-warning-text">
                Glow contains flashing lights, bright colors, and fast-moving patterns. If you have epilepsy, are
                sensitive to flashing lights, or have ever had a seizure, you shouldn't use Glow.
              </p>
              <div className="onb-actions">
                <button type="button" className="onb-continue" onClick={start}>
                  Continue and Start
                </button>
                <a className="onb-back" href="https://retrac.space">
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back to retrac.space
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
