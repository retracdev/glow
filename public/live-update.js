/*
 * Live updates: Glow moves to a newly published version without the browser ever reloading
 * or navigating. Ported from Simple Soundboard's js/live-update.js.
 *
 * version.yml holds the published version. Every 30 seconds (while the tab is visible) this
 * reads it, and when it's newer than the running version it downloads index.html and every
 * script and stylesheet it loads, checks they're all there and really are that version, then
 * restarts the app inside this same document:
 *
 *   loading screen up -> old app shut down -> new <head>, <body>, CSS and JS -> the app starts
 *   just like on a first visit -> loading screen finishes -> "updated" toast.
 *
 * refresh() does the same restart even when the version hasn't changed, but never installs an
 * older version than the one running.
 *
 * Shutting the old app down: this file runs before any app script and wraps the browser APIs
 * the app holds things with (listeners on window and document, timers, animation frames,
 * observers, fetches, Web Locks, audio contexts, sockets, WebGL contexts and new globals). Each
 * run of the app is a "generation". Disposing one releases everything it started, and its
 * leftover callbacks, fetches and lock grants go quiet, so nothing stale reaches the next run.
 * App code registers onDispose(fn) to put things away itself (Glow unmounts React there).
 *
 * Automatic updates never wipe someone's art: the app registers hold(fn), and while any hold
 * returns true a downloaded update waits. This file lives in public/ so Vite leaves it alone.
 * It is never replaced by an update; changes to it reach visitors on their next real load.
 */
(function () {
  'use strict';

  if (window.GlowLiveUpdate) return;

  const POLL_MS = 30000;
  const FETCH_TIMEOUT_MS = 15000;
  const DISPOSE_TIMEOUT_MS = 1500; // The longest the old app gets to put itself away.
  const READY_TIMEOUT_MS = 30000; // The loading screen gives up on slow files after 20s.
  const RETRY_MIN_MS = 30000; // After a failed download, wait 30s, 60s, 120s... up to 10 min.
  const RETRY_MAX_MS = 10 * 60000;
  const TOAST_MS = 5000;
  const VERSION = /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?$/;
  const JS_TYPE = /^\s*(|module|(text|application)\/(x-)?(java|ecma)script)\s*$/i;
  const MESSAGES = {
    updated: 'Glow has been updated. You’re now on the latest version.',
    refreshed: 'Glow has been refreshed. You’re running the latest version.',
    current: 'You’re already running the newest version of Glow.',
    failed: 'Glow couldn’t finish updating, so you’re still on the version you had.',
  };

  // The real browser APIs, saved before anything is wrapped. This file only ever uses these,
  // so nothing it does is mistaken for the app's.
  const native = {
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    fetch: window.fetch,
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
  };
  const wait = (ms) => new Promise((resolve) => native.setTimeout.call(window, resolve, ms));
  const nextFrame = () => Promise.race([
    new Promise((resolve) => native.requestAnimationFrame.call(window, resolve)), wait(100),
  ]);
  const never = () => new Promise(() => {});

  // ---------- Generations: one run of the app and everything it holds ----------

  // Between generations nothing is alive, so stale code that tries to start something is ignored.
  const LIMBO = { alive: false };
  let current = LIMBO;
  let runs = 0;

  function startGeneration() {
    runs++;
    let end;
    const ended = new Promise((resolve) => { end = resolve; });
    current = {
      alive: true,
      ended,
      end,
      listeners: [], // { target, type, listener, capture } on window, document and friends
      callbacks: new Set(), // cancel functions for timers, frames and idle callbacks
      controllers: new Set(), // AbortControllers for fetches and lock requests
      closers: new Set(), // close functions for observers, audio contexts, sockets, WebGL
      disposers: [], // the app's own onDispose hooks
      holds: [], // the app's hold() checks: while one is true, automatic updates wait
      globals: new Set(Object.getOwnPropertyNames(window)), // window before the app ran
    };
    return current;
  }

  // Settles like promise while gen is alive. Once gen is disposed it never settles, so stale
  // code that was waiting on it just stops there.
  function guard(gen, promise) {
    return new Promise((resolve, reject) => {
      promise.then((value) => { if (gen.alive) resolve(value); }, (error) => { if (gen.alive) reject(error); });
    });
  }

  function follow(controller, signal) {
    if (!signal) return;
    if (signal.aborted) controller.abort(signal.reason);
    else native.addEventListener.call(signal, 'abort', () => controller.abort(signal.reason), { once: true });
  }

  // Timers, animation frames and idle callbacks.
  function trackCallbacks(requestName, cancelName, repeats) {
    const request = window[requestName];
    const cancel = window[cancelName];
    if (typeof request !== 'function' || typeof cancel !== 'function') return;
    const pending = new Map(); // id -> { gen, stop }
    window[requestName] = function (callback, ...rest) {
      const gen = current;
      if (typeof callback !== 'function') return request.call(window, callback, ...rest);
      if (!gen.alive) return 0;
      const id = request.call(window, function (...args) {
        if (!repeats) forget(id);
        if (gen.alive) callback.apply(this, args);
      }, ...rest);
      const stop = () => {
        pending.delete(id);
        cancel.call(window, id);
      };
      pending.set(id, { gen, stop });
      gen.callbacks.add(stop);
      return id;
    };
    function forget(id) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.gen.callbacks.delete(entry.stop);
    }
    window[cancelName] = function (id) {
      forget(id);
      return cancel.call(window, id);
    };
  }
  trackCallbacks('setTimeout', 'clearTimeout', false);
  trackCallbacks('setInterval', 'clearInterval', true);
  trackCallbacks('requestAnimationFrame', 'cancelAnimationFrame', false);
  trackCallbacks('requestIdleCallback', 'cancelIdleCallback', false);

  // Listeners on things that outlive a run. Listeners on the app's own elements go away with
  // the elements, so they aren't tracked.
  function persistent(target) {
    return target === window || target === document || target === document.documentElement
      || target === document.head || target === document.body || target === window.visualViewport
      || target === window.screen || (typeof MediaQueryList === 'function' && target instanceof MediaQueryList);
  }
  const captures = (options) => (typeof options === 'boolean' ? options : Boolean(options && options.capture));
  function listenerIndex(gen, target, type, listener, capture) {
    return gen.listeners.findIndex((entry) => entry.target === target && entry.type === type
      && entry.listener === listener && entry.capture === capture);
  }
  EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
    if (listener && persistent(this)) {
      const gen = current;
      if (!gen.alive) return undefined;
      const capture = captures(options);
      if (listenerIndex(gen, this, type, listener, capture) === -1) gen.listeners.push({ target: this, type, listener, capture });
    }
    return native.addEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
    const gen = current;
    if (listener && gen.alive && persistent(this)) {
      const index = listenerIndex(gen, this, type, listener, captures(options));
      if (index !== -1) gen.listeners.splice(index, 1);
    }
    return native.removeEventListener.call(this, type, listener, options);
  };

  // Things the app constructs that keep running until closed.
  function trackInstances(name, close, guardsCallback) {
    const Native = window[name];
    if (typeof Native !== 'function') return;
    window[name] = new Proxy(Native, {
      construct(target, args, newTarget) {
        const gen = current;
        if (guardsCallback && typeof args[0] === 'function') {
          const callback = args[0];
          args = [function (...rest) { if (gen.alive) return callback.apply(this, rest); }, ...args.slice(1)];
        }
        const instance = Reflect.construct(target, args, newTarget);
        const stop = () => { try { close(instance); } catch (error) { /* Already closed. */ } };
        if (gen.alive) gen.closers.add(stop);
        else stop();
        return instance;
      },
    });
  }
  ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']
    .forEach((name) => trackInstances(name, (observer) => observer.disconnect(), true));
  ['AudioContext', 'webkitAudioContext'].forEach((name) => trackInstances(name, (context) => {
    if (context.state !== 'closed') context.close().catch(() => {});
  }));
  ['WebSocket', 'EventSource', 'BroadcastChannel'].forEach((name) => trackInstances(name, (channel) => channel.close()));
  trackInstances('Worker', (worker) => worker.terminate());

  // WebGL contexts are let go when their run ends rather than whenever garbage collection gets
  // to them, since browsers only allow a handful at once.
  const getContext = HTMLCanvasElement.prototype.getContext;
  const contexts = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    const gen = current;
    if (context && gen.alive && /^(webgl2?|experimental-webgl)$/.test(type) && !contexts.has(context)) {
      contexts.add(context);
      gen.closers.add(() => {
        const lose = context.getExtension('WEBGL_lose_context');
        if (lose && !context.isContextLost()) lose.loseContext();
      });
    }
    return context;
  };

  // Fetches are cancelled when their run ends, and their results never reach stale code.
  window.fetch = function fetch(input, init) {
    const gen = current;
    if (!gen.alive) return never();
    // A keepalive request is meant to outlive the page, so it's left to finish.
    if (init && init.keepalive) return guard(gen, native.fetch.call(window, input, init));
    const controller = new AbortController();
    follow(controller, (init && init.signal) || (input instanceof Request ? input.signal : null));
    gen.controllers.add(controller);
    const request = native.fetch.call(window, input, Object.assign({}, init, { signal: controller.signal }));
    const done = () => gen.controllers.delete(controller);
    request.then(done, done);
    return guard(gen, request);
  };

  // Web Locks: a waiting request is withdrawn and a held lock is let go when its run ends, even
  // if the code holding it never finishes, so the next run can't be locked out.
  const locks = navigator.locks;
  if (locks && typeof locks.request === 'function') {
    const request = locks.request;
    locks.request = function (name, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      const gen = current;
      if (!gen.alive) return never();
      const settings = Object.assign({}, options);
      let controller = null;
      if (!settings.steal && !settings.ifAvailable) { // Those two can't take a signal.
        controller = new AbortController();
        follow(controller, settings.signal);
        settings.signal = controller.signal;
        gen.controllers.add(controller);
      }
      const held = request.call(this, name, settings, (lock) => (gen.alive
        ? Promise.race([new Promise((resolve) => resolve(callback(lock))), gen.ended])
        : undefined));
      if (controller) {
        const done = () => gen.controllers.delete(controller);
        held.then(done, done);
      }
      return guard(gen, held);
    };
  }

  // Shuts the running app down: its own hooks first, then everything it left running.
  async function dispose() {
    const gen = current;
    if (!gen.alive) return;
    const hooks = gen.disposers.splice(0).reverse();
    const results = await Promise.race([
      Promise.allSettled(hooks.map((hook) => new Promise((resolve) => resolve(hook())))),
      wait(DISPOSE_TIMEOUT_MS).then(() => []),
    ]);
    results.forEach((result) => { if (result.status === 'rejected') console.error(result.reason); });

    gen.alive = false;
    current = LIMBO;
    gen.end();
    gen.listeners.forEach(({ target, type, listener, capture }) => {
      native.removeEventListener.call(target, type, listener, capture);
    });
    gen.callbacks.forEach((stop) => stop());
    gen.controllers.forEach((controller) => controller.abort());
    gen.closers.forEach((stop) => stop());
    document.querySelectorAll('audio, video').forEach((media) => media.pause());
    // Remove the globals the app defined, so the next run can't pick up the old ones.
    Object.getOwnPropertyNames(window).forEach((key) => {
      if (gen.globals.has(key) || key.startsWith('__')) return; // __ is left to dev tools.
      try { delete window[key]; } catch (error) { /* Not removable. */ }
    });
    gen.listeners.length = 0;
    gen.callbacks.clear();
    gen.controllers.clear();
    gen.closers.clear();
    gen.holds.length = 0;
  }

  // ---------- Versions ----------

  function compareVersions(a, b) {
    const [, coreA, preA] = VERSION.exec(a);
    const [, coreB, preB] = VERSION.exec(b);
    const partsA = coreA.split('.').map(Number);
    const partsB = coreB.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff) return Math.sign(diff);
    }
    // A pre-release (1.2.0-beta) comes before its release (1.2.0).
    if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
    const idsA = preA.split('.');
    const idsB = preB.split('.');
    for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
      if (idsA[i] === undefined) return -1;
      if (idsB[i] === undefined) return 1;
      const numberA = /^\d+$/.test(idsA[i]);
      const numberB = /^\d+$/.test(idsB[i]);
      if (numberA && numberB && Number(idsA[i]) !== Number(idsB[i])) return Math.sign(idsA[i] - idsB[i]);
      if (numberA !== numberB) return numberA ? -1 : 1;
      if (idsA[i] !== idsB[i]) return idsA[i] < idsB[i] ? -1 : 1;
    }
    return 0;
  }

  // The app's own address, without the search or hash, so it works under any subpath.
  function pageUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  async function get(url, cache) {
    const controller = new AbortController();
    const timer = native.setTimeout.call(window, () => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await native.fetch.call(window, url, { cache, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(url + ' answered HTTP ' + response.status);
      return await response.text();
    } finally {
      native.clearTimeout.call(window, timer);
    }
  }

  // Loads files straight from the server: past the browser cache (no-store) and past GitHub
  // Pages' CDN cache (a query string it hasn't seen).
  function freshLoader() {
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return (url) => {
      const busted = new URL(url);
      busted.searchParams.set('live', token);
      return get(busted.href, 'no-store');
    };
  }

  async function publishedVersion() {
    const text = await freshLoader()(new URL('version.yml', pageUrl()).href);
    const match = /^\s*version\s*:\s*(["']?)([^"'\s#]+)\1\s*(?:#.*)?$/m.exec(text);
    if (!match || !VERSION.test(match[2])) throw new Error('version.yml has no valid version');
    return match[2];
  }

  // Stylesheets are applied inline, so their relative url()s and @imports are made absolute.
  function rebase(css, from) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g, (match, q1, ref1, q2, ref2) => {
      const ref = (ref1 || ref2).trim();
      if (/^(#|[a-z][a-z0-9+.-]*:)/i.test(ref)) return match; // Fragments, data:, https: and so on.
      const href = new URL(ref, from).href;
      return ref1 ? 'url("' + href + '")' : '@import "' + href + '"';
    });
  }

  // Downloads one version of the app: the page, then every script and stylesheet it loads.
  // Nothing here touches the running app, and it rejects if anything required is missing or
  // broken. expect(version) can turn the page down before any of its files are fetched.
  async function download(url, load, expect) {
    const doc = new DOMParser().parseFromString(await load(url), 'text/html');
    const meta = doc.querySelector('meta[name="glow-version"]');
    const version = ((meta && meta.getAttribute('content')) || '').trim();
    if (!VERSION.test(version)) throw new Error('The page has no valid glow-version');
    if (expect) expect(version);

    const scripts = [];
    doc.querySelectorAll('script').forEach((node) => {
      const type = node.getAttribute('type') || '';
      if (node.hasAttribute('data-live-update') || node.hasAttribute('nomodule') || !JS_TYPE.test(type)) return;
      const src = node.getAttribute('src');
      const module = type.trim().toLowerCase() === 'module';
      scripts.push({
        module,
        url: src ? new URL(src, url).href : null,
        code: src ? null : node.textContent,
        late: module || node.hasAttribute('defer') || node.hasAttribute('async'),
      });
    });
    const styles = new Map();
    const sheets = [...doc.querySelectorAll('link[rel~="stylesheet" i][href]')]
      .map((link) => new URL(link.getAttribute('href'), url).href);
    await Promise.all([
      ...scripts.filter((script) => script.url).map(async (script) => {
        try {
          script.code = await load(script.url);
        } catch (error) {
          // A content blocker refusing a file (no response at all) skips it, just as a page load
          // would. A missing file (an HTTP error) means the deployment isn't finished.
          if (!(error instanceof TypeError)) throw error;
          script.skip = true;
          return;
        }
        if (!script.module) new Function(script.code); // Throws on a syntax error. Nothing runs.
      }),
      ...sheets.map(async (href) => styles.set(href, rebase(await load(href), href))),
    ]);
    // More than a few refused files is a network problem, not a blocker.
    if (scripts.filter((script) => script.skip).length > Math.max(2, scripts.length / 4)) {
      throw new Error('Too many files could not be fetched');
    }
    return { version, url, doc, scripts, styles };
  }

  // Brings the smaller files the new version uses (icons, fonts) up to date in the browser
  // cache. Best effort: one that's missing never holds an update back.
  function refreshAssets(pkg) {
    const urls = new Set();
    const add = (value, from) => {
      try {
        const url = new URL(value, from);
        url.hash = '';
        if (url.origin === location.origin) urls.add(url.href);
      } catch (error) { /* Not a URL. */ }
    };
    pkg.doc.querySelectorAll('link[href]').forEach((link) => {
      if (/\b(icon|preload|modulepreload|manifest)\b/i.test(link.getAttribute('rel') || '')) add(link.getAttribute('href'), pkg.url);
    });
    pkg.styles.forEach((css) => {
      for (const [, ref] of css.matchAll(/url\("([^"]+)"\)/g)) add(ref);
    });
    return Promise.allSettled([...urls].map((url) => native.fetch.call(window, url, { cache: 'reload' })
      .then((response) => response.arrayBuffer())));
  }

  // ---------- Swapping versions inside this document ----------

  const splashIn = (root) => root.querySelector('[data-update-splash]');
  const blockKeys = (event) => event.stopPropagation();

  // Puts the new version's loading screen over the running app and quiets everything behind it.
  function raiseSplash(pkg) {
    document.querySelectorAll('[data-update-splash]').forEach((node) => node.remove());
    native.addEventListener.call(window, 'keydown', blockKeys, true);
    [...document.body.children].forEach((element) => { element.inert = true; });
    const source = splashIn(pkg.doc.body);
    if (!source) return null;
    const splash = document.importNode(source, true);
    document.documentElement.className = pkg.doc.documentElement.className;
    document.body.prepend(splash);
    return splash;
  }

  function copyAttributes(from, to) {
    [...to.attributes].forEach((attribute) => to.removeAttribute(attribute.name));
    [...from.attributes].forEach((attribute) => to.setAttribute(attribute.name, attribute.value));
  }

  // Swaps in the new version's document: the <html> attributes, the <head> (title, metadata,
  // styles) and the <body>, all in one go. The loading screen and this script stay put.
  function install(pkg, splash) {
    const fresh = document.importNode(pkg.doc.documentElement, true);
    // Scripts are run separately. <noscript> must go too: parsed here it holds live elements.
    fresh.querySelectorAll('script, noscript').forEach((node) => {
      if (node.localName === 'noscript' || JS_TYPE.test(node.getAttribute('type') || '')) node.remove();
    });
    fresh.querySelectorAll('link[rel~="stylesheet" i][href]').forEach((link) => {
      const style = document.createElement('style');
      style.textContent = pkg.styles.get(new URL(link.getAttribute('href'), pkg.url).href) || '';
      if (link.media) style.media = link.media;
      style.dataset.href = link.getAttribute('href');
      link.replaceWith(style);
    });
    const head = fresh.querySelector('head');
    const body = fresh.querySelector('body');

    copyAttributes(fresh, document.documentElement);
    const self = document.querySelector('script[data-live-update]');
    [...document.head.childNodes].forEach((node) => { if (node !== self) node.remove(); });
    document.head.append(...head.childNodes);

    copyAttributes(body, document.body);
    [...document.body.childNodes].forEach((node) => { if (node !== splash) node.remove(); });
    const placeholder = splash && splashIn(body);
    if (placeholder && placeholder.parentNode === body) {
      // The live loading screen takes its place, so its animation carries on without a restart.
      const nodes = [...body.childNodes];
      const at = nodes.indexOf(placeholder);
      splash.before(...nodes.slice(0, at));
      document.body.append(...nodes.slice(at + 1));
    } else {
      if (splash) splash.remove();
      document.body.append(...body.childNodes);
    }
    native.removeEventListener.call(window, 'keydown', blockKeys, true);
    window.scrollTo(0, 0);
  }

  // Runs the new version's scripts in the order a page load would.
  // Loads a script with a real <script src>, the way a page load does.
  function loadTag(url, module) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      if (module) element.type = 'module';
      element.src = url;
      element.async = false;
      native.addEventListener.call(element, 'load', resolve);
      native.addEventListener.call(element, 'error', () => reject(new Error('Could not load ' + url)));
      document.head.append(element);
    });
  }

  async function run(pkg) {
    const order = [...pkg.scripts.filter((script) => !script.late), ...pkg.scripts.filter((script) => script.late)];
    for (const [index, script] of order.entries()) {
      if (script.skip) {
        // Some content blockers refuse a script when it's fetched, but allow it as a <script>
        // tag, which is how a page load gets it. Try the fresh copy first, then the plain one.
        const fresh = new URL(script.url);
        fresh.searchParams.set('live', Date.now().toString(36));
        try {
          await loadTag(fresh.href, script.module).catch(() => loadTag(script.url, script.module));
        } catch (error) {
          console.warn('Glow: skipped ' + script.url + ', which was blocked.', error);
        }
        continue;
      }
      if (script.module && script.url) {
        const url = new URL(script.url);
        url.searchParams.set('live', Date.now().toString(36)); // A fresh module instance.
        await import(url.href);
      } else if (script.module) {
        const element = document.createElement('script');
        element.type = 'module';
        element.textContent = script.code;
        document.head.append(element);
      } else {
        // Indirect eval runs it in global scope like a <script>, but throws straight back here.
        (0, eval)(script.code + '\n//# sourceURL=' + (script.url || pkg.url + '#inline-script-' + index));
      }
    }
  }

  // The app is ready once its loading screen has finished.
  function ready() {
    const splash = window.GlowSplash;
    if (!splash || typeof splash.whenDone !== 'function') return Promise.resolve();
    return Promise.race([
      new Promise((resolve) => splash.whenDone(resolve)),
      wait(READY_TIMEOUT_MS).then(() => { throw new Error('The app never finished starting'); }),
    ]);
  }

  async function activate(pkg) {
    const splash = raiseSplash(pkg);
    await nextFrame(); // Let the loading screen paint before the old app goes.
    await nextFrame();
    await dispose();
    install(pkg, splash);
    startGeneration();
    await run(pkg);
    await ready();
  }

  // Glow has no toast system of its own, so this draws a small glass one in its style.
  function toast(icon, text) {
    document.querySelectorAll('[data-live-update-toast]').forEach((node) => node.remove());
    const box = document.createElement('div');
    box.setAttribute('data-live-update-toast', '');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:50%;top:max(22px,env(safe-area-inset-top,0px));z-index:100001;'
      + 'display:flex;align-items:center;gap:10px;width:max-content;max-width:min(420px,calc(100vw - 32px));'
      + 'padding:11px 16px;border:1px solid rgb(240 237 255 / .14);border-radius:18px;'
      + 'background:rgb(14 12 24 / .82);color:#f0edff;'
      + 'font:500 .88rem/1.4 "Space Grotesk Variable",ui-sans-serif,system-ui,sans-serif;'
      + 'box-shadow:0 10px 30px rgb(0 0 0 / .4);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);'
      + 'opacity:0;transform:translate(-50%,-8px);pointer-events:none;'
      + 'transition:opacity .3s ease,transform .4s cubic-bezier(.22,1,.36,1)';
    const badge = document.createElement('span');
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = icon === 'warning' ? '!' : '\u2713';
    badge.style.cssText = 'flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;'
      + 'font-size:.75rem;font-weight:700;color:#05040a;background:' + (icon === 'warning' ? '#ffc46b' : '#7fd6ff');
    const label = document.createElement('span');
    label.textContent = text;
    box.append(badge, label);
    document.body.append(box);
    nextFrame().then(nextFrame).then(() => {
      box.style.opacity = '1';
      box.style.transform = 'translate(-50%,0)';
    });
    native.setTimeout.call(window, () => {
      box.style.opacity = '0';
      box.style.transform = 'translate(-50%,-8px)';
      native.setTimeout.call(window, () => box.remove(), 450);
    }, TOAST_MS);
  }

  // ---------- Checking and updating ----------

  const running = { version: null, pkg: null };
  let busy = null; // { result, done } for the check or update in progress. One runs at a time.
  let manualRun = null;
  let failedVersion = null; // A version that wouldn't start. Automatic checks leave it alone.
  let failures = 0;
  let retryAt = 0;
  let lastCheck = 0;
  let staged = null; // A downloaded update waiting for a moment that won't interrupt anyone.

  function exclusive(task) {
    const result = (busy ? busy.done : Promise.resolve()).then(task);
    const entry = { result };
    entry.done = result.then(() => {}, () => {}).then(() => { if (busy === entry) busy = null; });
    busy = entry;
    return result;
  }

  // The running version straight from the browser cache, to fall back on if an update won't
  // start. Only used when it's provably the same version.
  async function captureRunning() {
    try {
      return await download(location.href.split('#')[0], (url) => get(url, 'force-cache'), (version) => {
        if (compareVersions(version, running.version) !== 0) throw new Error('The cached page is another version');
      });
    } catch (error) {
      return null;
    }
  }

  async function apply(pkg, outcome) {
    console.info('Glow: switching from ' + running.version + ' to ' + pkg.version + ' (' + outcome + ').');
    const previous = running.pkg || await captureRunning();
    if (!previous) console.warn('Glow: no copy of the running version to fall back on.');
    try {
      await activate(pkg);
    } catch (error) {
      console.error('Glow: version ' + pkg.version + ' failed to start.', error);
      failedVersion = pkg.version;
      if (previous) {
        try {
          await activate(previous);
          toast('warning', MESSAGES.failed);
          return 'failed';
        } catch (restoreError) {
          console.error('Glow: the previous version failed to start again.', restoreError);
        }
      }
      showStuck(pkg);
      return 'failed';
    }
    running.version = pkg.version;
    running.pkg = pkg;
    if (failedVersion === pkg.version) failedVersion = null;
    console.info('Glow: now running ' + pkg.version + '.');
    toast('success', MESSAGES[outcome]);
    return outcome;
  }

  // The last resort, when neither version would start: say so and offer another try. The
  // page is never reloaded behind anyone's back.
  function showStuck(pkg) {
    document.querySelectorAll('[data-update-splash]').forEach((node) => node.remove());
    document.documentElement.removeAttribute('class');
    native.removeEventListener.call(window, 'keydown', blockKeys, true);
    const panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;left:16px;right:16px;bottom:max(16px,env(safe-area-inset-bottom));z-index:100001;'
      + 'max-width:420px;margin:0 auto;padding:16px 18px;border:1px solid rgba(255,255,255,.14);border-radius:18px;'
      + 'background:rgb(14 12 24 / .86);color:#f0edff;font:500 .9rem/1.45 "Space Grotesk Variable",system-ui,sans-serif;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)';
    const text = document.createElement('p');
    text.style.margin = '0 0 12px';
    text.textContent = 'Glow couldn’t finish updating. Check your connection, then try again.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Try again';
    button.style.cssText = 'padding:7px 16px;border:1px solid rgba(255,255,255,.2);border-radius:999px;'
      + 'background:rgba(255,255,255,.1);color:inherit;font:inherit;font-weight:700;cursor:pointer';
    button.addEventListener('click', () => {
      panel.remove();
      exclusive(() => apply(pkg, compareVersions(pkg.version, running.version) > 0 ? 'updated' : 'refreshed'));
    });
    panel.append(text, button);
    document.body.append(panel);
  }

  // A restart now would get in someone's way: the tab is hidden, the app is still loading, a
  // dialog is open, or the app holds updates (art on the canvas, the onboarding, a popup).
  // Automatic updates wait for a better moment.
  function held() {
    return current.holds.some((fn) => {
      try { return Boolean(fn()); } catch (error) { return true; }
    });
  }
  function interrupting() {
    return document.hidden || held() || Boolean(document.querySelector('dialog[open], [data-update-splash]'));
  }

  async function automatic() {
    const published = await publishedVersion();
    if (compareVersions(published, running.version) <= 0 || published === failedVersion) return null;
    let pkg = staged && compareVersions(staged.version, published) === 0 ? staged : null;
    staged = null;
    if (!pkg) {
      try {
        pkg = await download(pageUrl(), freshLoader(), (version) => {
          // GitHub Pages can serve the new version.yml before the new page: try again later.
          if (compareVersions(version, published) !== 0) {
            throw new Error('index.html is ' + version + ' but version.yml is ' + published + '; the deployment isn’t finished');
          }
        });
        await refreshAssets(pkg);
      } catch (error) {
        failures++;
        retryAt = Date.now() + Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures - 1));
        throw error;
      }
      failures = 0;
      retryAt = 0;
    }
    if (interrupting()) {
      staged = pkg;
      return null;
    }
    return apply(pkg, 'updated');
  }

  // An automatic check. Does nothing unless a newer version is published.
  function check() {
    if (busy) return busy.done;
    if (interrupting() || Date.now() < retryAt) return undefined;
    lastCheck = Date.now();
    return exclusive(() => automatic().catch((error) => {
      console.warn('Glow: update check failed.', error);
      return null;
    }));
  }

  async function manual() {
    const published = await publishedVersion();
    if (compareVersions(published, running.version) < 0) {
      toast('success', MESSAGES.current); // Never go back to an older version.
      return 'current';
    }
    let older = false;
    const pkg = await download(pageUrl(), freshLoader(), (version) => {
      if (compareVersions(version, running.version) < 0) {
        older = true;
        throw new Error('The page is older than the running version');
      }
    }).catch((error) => {
      if (older) return null;
      throw error;
    });
    if (!pkg) {
      toast('success', MESSAGES.current);
      return 'current';
    }
    await refreshAssets(pkg);
    return apply(pkg, compareVersions(pkg.version, running.version) > 0 ? 'updated' : 'refreshed');
  }

  // Check for Updates: fetch the newest app and restart it, even if the version is the same.
  // Resolves to 'updated', 'refreshed', 'current' or 'failed'; rejects if nothing could be fetched.
  function refresh() {
    if (!manualRun) {
      const prior = busy && busy.result;
      manualRun = exclusive(async () => {
        // An automatic update that was already under way has just done the job.
        if (prior && (await prior.catch(() => null)) === 'updated') return 'updated';
        return manual();
      });
      manualRun.then(() => { manualRun = null; }, () => { manualRun = null; });
    }
    return manualRun;
  }

  function poll() {
    native.setTimeout.call(window, () => {
      Promise.resolve(check()).finally(poll);
    }, POLL_MS);
  }

  // ---------- Start ----------

  const meta = document.querySelector('meta[name="glow-version"]');
  const version = ((meta && meta.getAttribute('content')) || '').trim();
  running.version = VERSION.test(version) ? version : '0';

  window.GlowLiveUpdate = Object.freeze({
    get version() { return running.version; },
    // True once an update has restarted the app in this page, so first-visit touches can skip.
    get restarted() { return runs > 1; },
    check,
    refresh,
    // Runs fn when this run of the app is shut down for an update. It may return a promise.
    onDispose(fn) {
      if (typeof fn === 'function' && current.alive) current.disposers.push(fn);
    },
    // While fn() returns true, automatic updates wait. A downloaded one is kept until then.
    hold(fn) {
      if (typeof fn === 'function' && current.alive) current.holds.push(fn);
    },
  });

  startGeneration(); // Everything from here on belongs to the first run of the app.
  native.addEventListener.call(document, 'visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheck > POLL_MS) check();
  });
  poll();
})();
