const STROKES = [
  // G
  'M27 11C23 6 12 6 9 15C6 25 13 33 21 31C25 30 27 27 27 23V22H19',
  // l (looped, flowing into o)
  'M36 31C41 24 46 14 45 8C44 3 37 4 37 12C37 22 38 31 44 30',
  // o
  'M58 18.5C62 18.5 64.5 21.5 64.5 25C64.5 28.5 62 31.5 58 31.5C54 31.5 51.5 28.5 51.5 25C51.5 21.5 54 18.5 58 18.5Z',
  // w with a trailing swash
  'M72 19C72 26 75 31 79 31C83 31 84 26 84 22C84 26 85 31 89 31C93 31 95 26 95 19C96 16 99 16 102 18',
];

function Strokes({ className }: { className: string }) {
  return (
    <g className={className}>
      {STROKES.map((d, i) => (
        <path key={i} d={d} pathLength={1} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </g>
  );
}

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The neon wordmark, in the cyan-to-blue glass of the app icon. It draws itself in when it
// mounts, then light slowly slides along it. Only one should be on screen at a time, since
// they share a gradient id.
export function GlowMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`brand-mark ${className}`.trim()} viewBox="1 0 105 40" role="img" aria-label="Glow">
      <defs>
        <linearGradient
          id="glow-mark-grad"
          gradientUnits="userSpaceOnUse"
          x1="4"
          y1="4"
          x2="104"
          y2="36"
          spreadMethod="reflect"
        >
          <stop offset="0" stopColor="#8ef0ff" />
          <stop offset="0.35" stopColor="#33c3f5" />
          <stop offset="0.7" stopColor="#2f8cff" />
          <stop offset="1" stopColor="#5b7cff" />
          {!reducedMotion && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values="0 0; 100 32; 0 0"
              dur="6s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      <Strokes className="brand-mark-halo" />
      <Strokes className="brand-mark-tube" />
      <Strokes className="brand-mark-core" />
    </svg>
  );
}

export function Brand() {
  return (
    <header className="brand">
      <h1 className="brand-name">
        <GlowMark />
      </h1>
      <span className="brand-sep" aria-hidden="true" />
      <a className="brand-link" href="https://retrac.space" target="_blank" rel="noreferrer">
        <img src="/retrac-space-logo.png" alt="retrac.space" width="480" height="74" />
      </a>
    </header>
  );
}
