/*
 * The loading screen, ported from Simple Soundboard. The Glow logo pops up on black with a bar
 * under it. The bar fills to 25% as the site's required files load (the page and its images,
 * the app's code and styles, and the fonts), then runs on to 100% over a random 0.5 to 1.5
 * seconds. At 100% the screen fades away, Glow rises in, and anything waiting on whenDone()
 * (the onboarding, the welcome pill and so on) gets its turn.
 *
 * It lives in public/ as a plain script, so it runs before the app's bundle and paints the bar
 * right away. Live updates run it again with the new version's page (see live-update.js).
 */
(function () {
  'use strict';

  const ASSETS_SHARE = 25; // Percent of the bar that stands for loading the site's files.
  const MIN_FINISH_MS = 500;
  const MAX_FINISH_MS = 1500;
  const HOLD_AT_FULL_MS = 180; // A beat at 100% before it leaves, so the full bar registers.
  const LEAVE_MS = 650; // Matches the longest .splash.is-leaving transition in index.html.
  const REVEAL_MS = 900; // Matches the site-in animation in index.html.
  const GIVE_UP_MS = 20000; // A slow connection still gets in eventually.

  const root = document.documentElement;
  const splash = document.getElementById('splash');
  const fill = splash && splash.querySelector('.splash__fill');
  const waiting = [];
  let done = false;
  let finishing = false;
  let shown = 0;

  function flush() {
    done = true;
    waiting.splice(0).forEach((fn) => {
      try { fn(); } catch (error) { console.error(error); }
    });
  }

  if (!splash || !fill) {
    root.classList.remove('is-splashing');
    flush();
  }

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Nothing behind the screen can be focused or read out until it's gone.
  const hidden = splash ? [...document.body.children].filter((el) => el !== splash && !el.inert) : [];
  hidden.forEach((el) => { el.inert = true; });
  function blockKeys(event) { event.stopPropagation(); }
  if (splash) window.addEventListener('keydown', blockKeys, true);

  function show(percent) {
    if (!fill) return;
    shown = Math.max(shown, Math.min(100, percent));
    fill.style.transform = `scaleX(${shown / 100})`;
    splash.setAttribute('aria-valuenow', String(Math.round(shown)));
  }

  function leave() {
    splash.classList.add('is-leaving');
    root.classList.add('is-revealing');
    root.classList.remove('is-splashing');
    hidden.forEach((el) => { el.inert = false; });
    window.removeEventListener('keydown', blockKeys, true);
    setTimeout(() => {
      splash.remove();
      flush();
    }, reducedMotion ? 200 : LEAVE_MS);
    setTimeout(() => root.classList.remove('is-revealing'), REVEAL_MS + 100);
  }

  // Slow at the very start and end, quick through the middle.
  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function finish() {
    if (finishing || done) return;
    finishing = true;
    clearTimeout(giveUp);
    const from = Math.max(shown, ASSETS_SHARE);
    const duration = MIN_FINISH_MS + Math.random() * (MAX_FINISH_MS - MIN_FINISH_MS);
    fill.classList.add('is-running'); // Frames drive it from here, not the CSS transition.
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      show(from + (100 - from) * ease(t));
      if (t < 1) requestAnimationFrame(frame);
      else setTimeout(leave, HOLD_AT_FULL_MS);
    }
    requestAnimationFrame(frame);
  }

  const giveUp = splash ? setTimeout(finish, GIVE_UP_MS) : null;

  // ---------- The required files ----------
  // Each step that settles moves the bar a share of the way to 25%. Failures count as settled,
  // so a missing image never holds Glow back.

  let appReady;
  const steps = [
    // The page and everything it references: the app's code, styles and images.
    document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener('load', resolve, { once: true })),
    // The app has mounted (src/main.tsx calls GlowSplash.appReady()).
    new Promise((resolve) => { appReady = resolve; }),
  ];
  let settled = 0;
  function track(promise) {
    return Promise.resolve(promise).catch(() => {}).then(() => {
      settled++;
      if (!finishing && !done) show(ASSETS_SHARE * (settled / total));
    });
  }
  // Fonts and the images on screen are checked once the app is up, since only then is it
  // known which ones it uses. They count as one more step.
  const total = steps.length + 1;
  const tracked = steps.map(track);
  tracked[1]
    .then(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
    .then(() => track(Promise.all([
      document.fonts ? document.fonts.ready : null,
      ...[...document.images].map((image) => (image.complete ? null : image.decode())),
    ].map((promise) => Promise.resolve(promise).catch(() => {})))))
    .then(() => Promise.all(tracked))
    .then(() => {
      if (done) return;
      show(ASSETS_SHARE);
      finish();
    });

  window.GlowSplash = {
    // The app has rendered for the first time.
    appReady() {
      appReady();
    },

    isDone: () => done,

    // Runs fn once the screen is gone, or right away if it already is.
    whenDone(fn) {
      if (done) fn();
      else waiting.push(fn);
    },
  };
})();
