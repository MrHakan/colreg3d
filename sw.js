/* ==========================================================================
   COLREG 3D — Service Worker
   --------------------------------------------------------------------------
   Goal: after one successful load the app must work with the aircraft-mode
   switch on, indefinitely, on a shipboard laptop that may not see the
   internet again for weeks.

   Caching strategy
     • App shell (same-origin, versioned by APP_VERSION)
         install  → precache, install FAILS if any shell file is missing
                    (a half-cached shell is worse than no shell)
         fetch    → stale-while-revalidate: instant paint, silent refresh
     • Navigations
         network-first with a short timeout → fall back to cached index.html
         (so a flaky sat link never blocks the bridge from opening the app)
     • Vendor / CDN (Three.js, version-pinned & immutable)
         cache-first, stored in a cache keyed by the Three.js version so an
         app update does not force a 1.2 MB re-download over a metered link
     • Everything else → straight to network, no caching

   Scope note: this file lives at the repository root, so its scope is the
   GitHub Pages project path (e.g. /colreg3d/). Every precache entry is
   RELATIVE, which is what makes the app portable between
   username.github.io/colreg3d/ and a local static server.
   ========================================================================== */

const APP_VERSION   = '1.0.0';
const THREE_VERSION = '0.185.1';

const SHELL_CACHE  = `colreg3d-shell-v${APP_VERSION}`;
const VENDOR_CACHE = `colreg3d-vendor-three-${THREE_VERSION}`;
const CACHE_PREFIX = 'colreg3d-';

/* Same-origin app shell. Relative paths only. */
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/main.js',
  './js/scene.js',
  './js/lights.js',
  './js/colreg-data.js',
  './js/quiz.js',
  './js/simulator.js',
  './data/colreg-rules.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

/* Third-party ESM. three.module.js re-exports from three.core.js, so BOTH
   are required — caching only the former yields a module that 404s offline. */
const VENDOR_ASSETS = [
  `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
  `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.core.js`,
  `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`
];

const VENDOR_HOSTS = ['cdn.jsdelivr.net'];
const NAV_TIMEOUT_MS = 3500;

/* ── Install ───────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);

    // Must succeed: a missing shell file is a build error we want to surface.
    await shell.addAll(APP_SHELL);

    // Best-effort: the CDN may be unreachable behind a ship firewall. The app
    // still installs; vendor files are picked up by the runtime handler later.
    const vendor = await caches.open(VENDOR_CACHE);
    const results = await Promise.allSettled(
      VENDOR_ASSETS.map(async (url) => {
        if (await vendor.match(url)) return; // already cached from a prior version
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        await vendor.put(url, res);
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      console.warn(`[sw] ${failed}/${VENDOR_ASSETS.length} vendor asset(s) not precached; will retry at runtime`);
    }
  })());

  // New shell should take over as soon as the page allows it.
  self.skipWaiting();
});

/* ── Activate ──────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }

    const keep = new Set([SHELL_CACHE, VENDOR_CACHE]);
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(CACHE_PREFIX) && !keep.has(n))
        .map((n) => caches.delete(n))
    );

    await self.clients.claim();
  })());
});

/* ── Fetch ─────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with writes, range media, or extension traffic.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (VENDOR_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
  // Anything else: default network handling.
});

/* ── Strategies ────────────────────────────────────────────────────────── */

/**
 * Navigation: try the network briefly, otherwise serve the cached shell.
 * Keeps the app openable on a dead or captive-portal link.
 */
async function handleNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const preload = await event.preloadResponse;
    if (preload) {
      cache.put('./index.html', preload.clone()).catch(() => {});
      return preload;
    }

    const network = await withTimeout(fetch(event.request), NAV_TIMEOUT_MS);
    if (network && network.ok) {
      cache.put('./index.html', network.clone()).catch(() => {});
      return network;
    }
  } catch {
    /* fall through to cache */
  }

  return (await cache.match('./index.html')) ||
         (await cache.match('./')) ||
         new Response(
           '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
           '<body style="font:16px system-ui;background:#05080f;color:#dce6f2;padding:2rem">' +
           '<h1>COLREG 3D is offline</h1><p>The app shell is not cached yet. ' +
           'Reconnect once to complete installation.</p>',
           { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
         );
}

/** Immutable, version-pinned assets: cache wins, network only fills gaps. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    return new Response(`/* offline: ${request.url} unavailable */`, {
      status: 504,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** App shell: paint from cache immediately, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      // Only cache complete, same-origin 200s — never a 206 or an opaque body.
      if (res.ok && res.status === 200 && res.type === 'basic') {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  if (hit) return hit;

  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

/* ── Page ↔ worker messaging ───────────────────────────────────────────── */
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'GET_STATUS' && event.ports && event.ports[0]) {
    event.waitUntil((async () => {
      const [shell, vendor] = await Promise.all([
        caches.open(SHELL_CACHE),
        caches.open(VENDOR_CACHE)
      ]);
      const [shellKeys, vendorKeys] = await Promise.all([shell.keys(), vendor.keys()]);

      event.ports[0].postMessage({
        appVersion: APP_VERSION,
        threeVersion: THREE_VERSION,
        shellCached: shellKeys.length,
        shellExpected: APP_SHELL.length,
        vendorCached: vendorKeys.length,
        vendorExpected: VENDOR_ASSETS.length,
        complete: shellKeys.length >= APP_SHELL.length &&
                  vendorKeys.length >= VENDOR_ASSETS.length
      });
    })());
  }
});
