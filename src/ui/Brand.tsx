const STROKES = [
  // G
  'M27 11C23 6 12 6 9 15C6 25 13 33 21 31C25 30 27 27 27 23V22H19',
  // l (looped, flowing into o)
  'M32 31C36 24 40 14 39 8C38 4 34 6 34 12C34 22 35 31 41 30',
  // o
  'M48 19C52 19 54 22 54 25C54 29 51 31 48 31C44 31 42 28 42 25C42 22 44 19 48 19Z',
  // w with a trailing swash
  'M58 19C58 26 60 31 63 31C66 31 67 26 67 22C67 26 68 31 71 31C74 31 76 26 76 19C77 16 80 16 83 18',
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

export function Brand() {
  return (
    <header className="brand">
      <h1 className="brand-name">
        <svg className="brand-mark" viewBox="2 2 86 36" role="img" aria-label="Glow">
          <defs>
            <linearGradient id="glow-mark-grad" x1="0" y1="0" x2="1" y2="0.4">
              <stop offset="0" stopColor="#ff4fd8" />
              <stop offset="0.35" stopColor="#7b6bff" />
              <stop offset="0.7" stopColor="#2ee6ff" />
              <stop offset="1" stopColor="#5dff9b" />
            </linearGradient>
          </defs>
          <Strokes className="brand-mark-halo" />
          <Strokes className="brand-mark-tube" />
          <Strokes className="brand-mark-core" />
        </svg>
      </h1>
      <span className="brand-sep" aria-hidden="true" />
      <a className="brand-link" href="https://retrac.space" target="_blank" rel="noreferrer">
        <img src="/retrac-space-logo.png" alt="retrac.space" width="480" height="74" />
      </a>
    </header>
  );
}
