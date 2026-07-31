# COLREG 3D — Navigational Lights & Shapes Trainer

An offline-first, 100% client-side 3D trainer for the International Regulations
for Preventing Collisions at Sea (COLREG 72, as amended). Built to be dropped on
GitHub Pages and then used with no connection at all — on a shipboard laptop or
tablet, on the bridge, at night.

> **Build status: STEP 1 of 7 — application shell.**
> The layout, theme, PWA/offline plumbing and module contracts are complete and
> runnable. The 3D scene, light-sector engine, rule database, quiz and encounter
> simulator arrive in STEPs 2–7 and currently render as labelled placeholders.

---

## Running it

There is no build step. Any static file server works — ES modules and service
workers both require `http://`, so opening `index.html` from the filesystem will
not work.

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

Deploying to GitHub Pages: push the repository and enable Pages on the branch
root. Every path in the app is relative (`./…`), so it works unchanged from a
project page such as `https://<user>.github.io/colreg3d/`. The `.nojekyll` file
stops Pages from filtering directories.

---

## Layout

```
index.html                 shell + layout only
styles.css                 full dark theme (tokens → components → responsive)
manifest.json              PWA metadata, maskable icons, mode shortcuts
sw.js                      service worker: precache + runtime strategies
.nojekyll                  serve directories verbatim on GitHub Pages
js/
  main.js                  app shell: modes, keyboard, prefs, PWA lifecycle   [STEP 1]
  scene.js                 renderer, water, OrbitControls, aspect bearing     [STEP 2]
  lights.js                Rule 21 arc constants + light sector engine        [STEP 3]
  colreg-data.js           rule database loader + validation                  [STEP 4]
  quiz.js                  quiz modes A/B/C, scoring, localStorage            [STEP 5]
  simulator.js             Rules 13–15 encounter classification               [STEP 6]
data/
  colreg-rules.json        Rules 21–31 dataset (shape documented, filled in STEP 4)
assets/icons/              SVG + 192/512 PNG + maskable PNG
```

Modules communicate through a plain `EventTarget` bus exported by `main.js`
rather than importing each other, so later steps can be filled in without
rewiring the shell.

---

## Three.js

Pinned to **r185 (`three@0.185.1`)**, loaded as ESM from jsDelivr through the
import map in `index.html`.

Since r150 the module build is split, so `three.module.js` re-exports from
`three.core.js`. **Both** files must be cached for offline use — caching only the
entry point produces a module that 404s the moment you go offline. `sw.js`
precaches both plus `OrbitControls.js`, in a cache keyed by the Three.js version
so an app update does not re-download ~1.2 MB over a metered satellite link.

---

## Caching strategy (`sw.js`)

| Request | Strategy | Why |
| --- | --- | --- |
| Navigation | Network-first, 3.5 s timeout → cached `index.html` | A captive portal or dead sat link must never stop the app opening |
| Same-origin shell | Stale-while-revalidate | Instant paint, silent background refresh |
| Three.js (CDN) | Cache-first, version-keyed cache | URLs are immutable; never re-fetch |
| Anything else | Straight to network | Nothing else is cached |

Install **fails loudly** if any app-shell file is missing — a half-cached shell
is worse than none. Vendor assets are best-effort at install (the CDN may be
firewalled) and are picked up by the runtime handler on a later load.

When a new worker is waiting, the page raises a toast with a *Reload* action
rather than swapping code underneath a learner mid-quiz. The status bar shows
live cache state (`offline ready`, or a `shell/vendor` count while filling).

---

## Accessibility

- Mode tabs implement the WAI-ARIA tabs pattern: arrow keys, `Home`/`End`,
  roving `tabindex`.
- Visible focus ring on every interactive control; never suppressed.
- Skip link to the control region.
- Quiz feedback is a polite live region. The aspect meter deliberately is **not**
  a live region — it updates every frame and would flood a screen reader.
- `prefers-reduced-motion` and `prefers-contrast: more` are both honoured.
- Coarse-pointer media query raises hit targets to ≥ 44 px for tablet use.

## Performance

Target is a stable 30+ FPS on integrated graphics, with a scene budget of
**≈ 60 k triangles**.

The **Full FX / Lite FX** toggle (`P`) sets `data-perf` on `<html>`. In *Lite*,
CSS drops every `backdrop-filter` — the single biggest UI cost on integrated
GPUs, where each blurred layer costs real frame time — and from STEP 2 it also
caps the renderer pixel ratio at 1 and disables antialiasing.

## Keyboard

`1`/`2`/`3` modes · `D` day/night · `P` performance · `R` reset camera ·
`S` day shapes · `A` light arcs · `G` debug overlay · `?` help

---

## Licence & disclaimer

Training aid only. It is not a substitute for the official IMO publication of
the COLREGs, and must not be used for navigation.
