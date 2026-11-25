# Repository instructions

Open tabs update themselves in place, without reloading, through `public/live-update.js` (ported from Simple Soundboard):

- When you ship a change to the site, raise the version in `version.yml`. The build (`glowVersion()` in `vite.config.ts`) writes it into `<meta name="glow-version">` in `index.html` and publishes `version.yml` next to the page. Live updates only install a page whose meta matches `version.yml`.
- Anything that must be put away when the app is replaced registers `onDispose(fn)` from `src/runtime.ts` (`src/main.tsx` unmounts React there). Listeners on `window`/`document`, timers, animation frames, observers, fetches, Web Locks and WebGL contexts are cleaned up automatically.
- Automatic updates install as soon as they're found, whatever the person is doing (art on the canvas is not kept), just like Simple Soundboard. They only wait while the tab is hidden, and a hidden tab checks as soon as it's shown again. `holdUpdates(fn)` in `src/runtime.ts` can make them wait, but nothing uses it; don't add holds unless asked.
- Keep the app in a single JS chunk (no dynamic `import()`), so an update never reuses a stale module from the previous version.
- `public/live-update.js` itself is never replaced by a live update. Changes to it reach visitors on their next real page load.

The loading screen is `public/splash.js` plus the inline styles and `#splash` markup in `index.html`. It fills to 25% as the site's files load, then finishes over a random 0.5 to 1.5 seconds. Things that shouldn't start behind it wait on `whenSplashDone(fn)` from `src/runtime.ts`.
