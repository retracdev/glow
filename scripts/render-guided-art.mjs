/*
 * Renders public/guided-setup.jpg, the 960x1200 art the retrac.space guided sign-in page shows
 * next to its form: the Glow logo in the middle, over neon light strings and glass tiles with
 * Glow's tools on them. Run it with `npm run build:art` after changing the logo or this file.
 *
 * Uses a locally installed Chrome (or Edge) through playwright-core.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'public/guided-setup.jpg';
const WIDTH = 960;
const HEIGHT = 1200;

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

// The same lucide icons as Glow's toolbar, so the tiles read as its tools.
async function icon(name) {
  const url = pathToFileURL(ROOT + `node_modules/lucide-react/dist/esm/icons/${name}.mjs`).href;
  const { __iconData } = await import(url);
  // Some names are aliases that only re-export another icon.
  if (!__iconData) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const target = /from '\.\/([\w-]+)\.mjs'/.exec(source);
    if (!target) throw new Error(`No icon called ${name}`);
    return icon(target[1]);
  }
  return __iconData.node
    .map(([tag, attrs]) => {
      const list = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${list}/>`;
    })
    .join('');
}

// A small seeded random, so every render comes out the same.
function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const COLORS = {
  cyan: '#7fd6ff',
  blue: '#2f8cff',
  magenta: '#ff3fb4',
  amber: '#ffb347',
  lime: '#9dff6b',
  violet: '#a98bff',
  red: '#ff5b6e',
};

// Light strings, like the tubes Glow draws: a wide soft halo, a coloured tube, a white core.
const STRINGS = [
  ['cyan', 'M -60 330 C 180 140, 360 470, 610 270 S 900 60, 1040 190'],
  ['magenta', 'M -70 880 C 170 1010, 300 690, 520 800 S 860 1120, 1040 930'],
  ['amber', 'M 160 640 C 150 430, 470 330, 700 390 S 900 720, 640 840 S 200 880, 160 640 Z'],
  ['violet', 'M 1040 430 C 860 500, 930 700, 1040 790'],
  ['lime', 'M -50 1150 C 180 1060, 280 1230, 500 1170 S 820 1110, 1020 1210'],
  ['red', 'M 330 -40 C 290 110, 140 170, -50 140'],
  ['blue', 'M 640 -40 C 700 120, 860 110, 1020 40'],
];

// [icon, x, y, size, rotation, colour, depth]. Depth 0 is sharp and close, 1 and 2 are further
// back, smaller and blurred. Nothing sits within about 250px of the middle, where the logo is.
const TILES = [
  ['pencil', 160, 190, 156, -12, 'cyan', 0],
  ['orbit', 800, 235, 148, 10, 'violet', 0],
  ['bomb', 118, 590, 128, 8, 'red', 0],
  ['tornado', 846, 640, 150, -8, 'magenta', 0],
  ['waves', 190, 985, 152, 10, 'cyan', 0],
  ['snowflake', 780, 1020, 142, -12, 'blue', 0],
  ['flip-horizontal-2', 480, 112, 112, 4, 'amber', 1],
  ['camera', 480, 1110, 118, -6, 'lime', 1],
  ['sparkles', 318, 330, 86, 14, 'amber', 1],
  ['eraser', 660, 360, 80, -16, 'magenta', 2],
  ['images', 300, 850, 92, -10, 'violet', 1],
  ['sliders-horizontal', 668, 858, 84, 12, 'lime', 2],
  ['flip-vertical-2', 40, 820, 104, -14, 'amber', 2],
  ['palette', 930, 900, 110, 16, 'cyan', 2],
  ['wand-sparkles', 920, 40, 120, 18, 'amber', 2],
  ['brush', 30, 40, 120, -20, 'lime', 2],
];

async function page() {
  const rand = random(7);
  const logo = readFileSync(ROOT + 'public/favicon.svg', 'utf8');
  const logoUrl = 'data:image/svg+xml;base64,' + Buffer.from(logo).toString('base64');

  const strings = STRINGS.map(([color, d]) => {
    const c = COLORS[color];
    return `<g class="string" style="--c:${c}">
      <path class="halo" d="${d}"/><path class="tube" d="${d}"/><path class="core" d="${d}"/></g>`;
  }).join('');

  // Specks of light, brighter and denser near the strings' paths would be nice, but an even
  // dusting with a few bright ones reads well enough.
  let specks = '';
  const palette = Object.values(COLORS);
  for (let i = 0; i < 140; i++) {
    const x = rand() * WIDTH;
    const y = rand() * HEIGHT;
    const r = 0.6 + rand() * (rand() < 0.12 ? 3.2 : 1.4);
    const c = rand() < 0.5 ? '#ffffff' : palette[Math.floor(rand() * palette.length)];
    specks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${c}" opacity="${(0.35 + rand() * 0.65).toFixed(2)}"/>`;
  }

  const tiles = (
    await Promise.all(
      TILES.map(async ([name, x, y, size, rot, color, depth]) => {
        const c = COLORS[color];
        return `<div class="tile depth-${depth}" style="left:${x}px;top:${y}px;--s:${size}px;--r:${rot}deg;--c:${c}">
          <svg viewBox="0 0 24 24">${await icon(name)}</svg></div>`;
      }),
    )
  ).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #05040a; }
  .art { position: relative; width: 100%; height: 100%; overflow: hidden;
    background:
      radial-gradient(60% 40% at 18% 14%, rgba(47,140,255,.30), transparent 70%),
      radial-gradient(55% 40% at 88% 30%, rgba(169,139,255,.26), transparent 70%),
      radial-gradient(60% 42% at 12% 86%, rgba(255,63,180,.24), transparent 70%),
      radial-gradient(55% 40% at 90% 92%, rgba(127,214,255,.22), transparent 70%),
      linear-gradient(180deg, #0a0817, #05040a 50%, #0a0715);
  }
  svg.layer { position: absolute; inset: 0; width: 100%; height: 100%; }
  .string path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .string .halo { stroke: var(--c); stroke-width: 34; opacity: .38; filter: url(#soft); }
  .string .tube { stroke: var(--c); stroke-width: 8; filter: url(#glow); }
  .string .core { stroke: #fff; stroke-width: 2.6; opacity: .85; }
  .specks { filter: url(#speck); }

  .tile { position: absolute; width: var(--s); height: var(--s);
    transform: translate(-50%, -50%) rotate(var(--r));
    display: grid; place-items: center;
    border-radius: calc(var(--s) * .26);
    background:
      radial-gradient(120% 90% at 25% 0%, rgba(255,255,255,.22), transparent 55%),
      linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03));
    border: 1.5px solid rgba(255,255,255,.22);
    box-shadow: inset 0 1.5px 0 rgba(255,255,255,.35), 0 18px 40px rgba(0,0,0,.55),
      0 0 46px color-mix(in srgb, var(--c) 28%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
  }
  .tile svg { width: 50%; height: 50%; fill: none; stroke: var(--c); stroke-width: 1.9;
    stroke-linecap: round; stroke-linejoin: round;
    filter: drop-shadow(0 0 6px var(--c)) drop-shadow(0 0 16px var(--c)); }
  .depth-1 { filter: blur(1.4px); opacity: .78; }
  .depth-2 { filter: blur(3.6px); opacity: .5; }

  /* Darkens the middle so the logo stands out, and the very edges a little. */
  .shade { position: absolute; inset: 0;
    background:
      radial-gradient(circle 360px at 50% 50%, rgba(5,4,10,.88) 32%, rgba(5,4,10,.5) 68%, rgba(5,4,10,0)),
      linear-gradient(180deg, rgba(5,4,10,.45), transparent 18%, transparent 82%, rgba(5,4,10,.45)); }
  .halo-ring { position: absolute; left: 50%; top: 50%; width: 600px; height: 600px;
    transform: translate(-50%, -50%); border-radius: 50%;
    background: radial-gradient(circle, rgba(51,195,245,.50), rgba(47,140,255,.16) 42%, transparent 68%); }
  .logo { position: absolute; left: 50%; top: 50%; width: 300px; height: 300px;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 26px 40px rgba(0,0,0,.7)) drop-shadow(0 0 30px rgba(127,214,255,.35)); }
  </style></head><body><div class="art">
    <svg class="layer" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <filter id="soft" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${WIDTH + 200}" height="${HEIGHT + 200}"><feGaussianBlur stdDeviation="16"/></filter>
        <filter id="glow" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${WIDTH + 200}" height="${HEIGHT + 200}">
          <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="speck" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g class="specks">${specks}</g>
      ${strings}
    </svg>
    ${tiles}
    <div class="shade"></div>
    <div class="halo-ring"></div>
    <img class="logo" src="${logoUrl}" alt="">
  </div></body></html>`;
}

const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH to one.');

const browser = await chromium.launch({ executablePath });
try {
  const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await tab.setContent(await page(), { waitUntil: 'load' });
  await tab.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode())));
  await tab.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
  console.log('Wrote', OUT);
} finally {
  await browser.close();
}
