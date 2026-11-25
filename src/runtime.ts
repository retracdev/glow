/*
 * The two plain scripts in public/ that run before the app: the live updater
 * (public/live-update.js) and the loading screen (public/splash.js). Either can be missing,
 * for example in a test page, so everything here copes without them.
 */

interface GlowLiveUpdate {
  readonly version: string;
  readonly restarted: boolean;
  check(): Promise<unknown> | undefined;
  refresh(options?: { onlyIfNewer?: boolean }): Promise<'updated' | 'refreshed' | 'current' | 'failed'>;
  onDispose(fn: () => void | Promise<void>): void;
  hold(fn: () => boolean): void;
}

interface GlowSplash {
  appReady(): void;
  isDone(): boolean;
  whenDone(fn: () => void): void;
}

declare global {
  interface Window {
    GlowLiveUpdate?: GlowLiveUpdate;
    GlowSplash?: GlowSplash;
  }
}

// Runs fn when an update shuts this run of Glow down.
export function onDispose(fn: () => void | Promise<void>) {
  window.GlowLiveUpdate?.onDispose(fn);
}

// While fn() returns true, automatic updates wait.
export function holdUpdates(fn: () => boolean) {
  window.GlowLiveUpdate?.hold(fn);
}

// True when a live update restarted Glow in this page, rather than a real page load.
export function restartedByUpdate(): boolean {
  return Boolean(window.GlowLiveUpdate?.restarted);
}

// The running version, from <meta name="glow-version">.
export function currentVersion(): string {
  return (
    window.GlowLiveUpdate?.version ??
    document.querySelector('meta[name="glow-version"]')?.getAttribute('content') ??
    ''
  );
}

// Check for Updates. Undefined when the live updater isn't loaded, so there's nothing to ask.
export function checkForUpdates(options?: { onlyIfNewer?: boolean }) {
  return window.GlowLiveUpdate?.refresh(options);
}

export function canCheckForUpdates(): boolean {
  return typeof window.GlowLiveUpdate?.refresh === 'function';
}

export function splashAppReady() {
  window.GlowSplash?.appReady();
}

export function splashDone(): boolean {
  return !window.GlowSplash || window.GlowSplash.isDone();
}

export function whenSplashDone(fn: () => void) {
  if (window.GlowSplash) window.GlowSplash.whenDone(fn);
  else fn();
}
