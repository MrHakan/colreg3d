# COLREG 3D — Navigational Lights & Shapes Trainer

An offline-first, 100% client-side 3D trainer for the International Regulations
for Preventing Collisions at Sea (COLREG 72, as amended). Built to be dropped on
GitHub Pages and then used with no connection at all — on a shipboard laptop or
tablet, on the bridge, at night.

**v1.0.0 — all seven build steps complete.**

| Mode | What it does |
| --- | --- |
| **Learn** | 33 vessel configurations from Rules 23–31. Pick one and she is built on the water with her prescribed lights, arcs and day shapes. |
| **Quiz** | Three question modes with scoring, streaks, per-rule weak-area tracking and feedback that cites the exact paragraph. |
| **Encounters** | Two vessels, classified live under Rules 13–15 from the actual geometry, with CPA/TCPA and stand-on / give-way roles. |

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
styles.css                 dark theme (tokens → components → responsive)
manifest.json              PWA metadata, maskable icons, mode shortcuts
sw.js                      service worker: precache + runtime strategies
js/
  main.js                  shell: modes, keyboard, catalogue, PWA, status bar
  scene.js                 renderer, shader ocean, OrbitControls, aspect bearing
  lights.js                Rule 21 arcs, procedural vessel, sector engine
  colreg-data.js           rule database loader + referential validation
  quiz.js                  three quiz modes, scoring, localStorage
  simulator.js             Rules 13–15 encounter classification
data/colreg-rules.json     33 configurations, Rules 23–31, each cited
assets/icons/              SVG + 192/512 PNG + maskable PNG
```

Modules never import each other's state. They communicate over `bus`, a plain
`EventTarget` exported by `main.js`; the event list is documented at the top of
that file.

**Coordinate convention**, used by every module: `+Z` is the bow (relative
bearing 000°), `+X` is starboard (090°), the sea surface is `y = 0`. Relative
bearing is therefore `atan2(x, z)`.

---

## Correctness

Every arc constant lives in `js/lights.js` with its citation, and **nothing
duplicates them** — the scene, the quiz explanations, the aspect meter's compass
ticks and the encounter classifier all read the same values.

| Light | Arc | Source |
| --- | --- | --- |
| Masthead | 225°, centred ahead | Rule 21(a) |
| Sidelights | 112.5° each side | Rule 21(b) |
| Sternlight | 135°, centred astern | Rule 21(c) |
| Towing (yellow) | 135°, above the sternlight | Rule 21(d), Rule 24(a)(iv) |
| All-round | 360° | Rule 21(e) |

Note that `135 + 2 × 112.5 = 360`: the sidelights and sternlight tile the horizon
exactly. A self-test asserts this by sweeping the full circle.

Lights do not snap off at a knife edge. **Annex I §9(a)(i)** allows practical
cut-off 1–3° outside the prescribed sector, so they ramp off across a 2° band.

**Press `G`** for the arc-verification overlay. It runs 16 boundary assertions
live and shows PASS/FAIL — starboard sidelight full at 112.0°, in cut-off at
113.0°, dark at 115.0°; masthead dark astern; sternlight dark at 110.0° and full
at 113.0°; and the 360° tiling sweep. Orbit the vessel and watch each row change
state as you cross a boundary.

The encounter classifier reuses those same arcs. Rule 13(b) defines overtaking as
coming up from more than 22.5° abaft the beam — "she would be able to see only
the sternlight … and neither of her sidelights" — which *is* the 135° sternlight
arc, so one constant decides both what you see and who gives way. Rule 13(c) and
Rule 14(c) doubt bands are implemented literally: near a boundary the simulator
reports the more demanding interpretation, never the more convenient one.

### Two honest caveats

- The rule text in `data/colreg-rules.json` is **summarised, not quoted**. It is a
  training aid; the official IMO publication governs.
- The master brief asked for day shapes "per Rule 31". Rule 31 is actually the
  *seaplane* exception — day shapes are prescribed by each rule individually
  (Rule 24(a)(v) diamond, Rule 26 cones, Rule 27(b)(ii) ball–diamond–ball, Rule
  30(d)(ii) three balls, and so on). Shapes are implemented per their real rules,
  and Rule 31 is included as its own entry.

---

## Three.js

Pinned to **r185 (`three@0.185.1`)**, loaded as ESM from jsDelivr through the
import map in `index.html`.

Since r150 the module build is split, so `three.module.js` re-exports from
`three.core.js`. **Both** must be cached for offline use — caching only the entry
point produces a module that 404s the moment you go offline. `sw.js` precaches
both plus `OrbitControls.js`, in a cache keyed by the Three.js version so an app
update does not re-download ~1.2 MB over a metered satellite link.

Three.js is imported **dynamically**, so a blocked or cold CDN degrades to "3D
unavailable" instead of taking the whole app down — the catalogue, rule text and
quiz do not need WebGL.

---

## Caching strategy (`sw.js`)

| Request | Strategy | Why |
| --- | --- | --- |
| Navigation | Network-first, 3.5 s timeout → cached `index.html` | A captive portal or dead sat link must never stop the app opening |
| Same-origin shell | Stale-while-revalidate | Instant paint, silent background refresh |
| Three.js (CDN) | Cache-first, version-keyed cache | URLs are immutable; never re-fetch |
| Anything else | Straight to network | Nothing else is cached |

Install **fails loudly** if any app-shell file is missing — a half-cached shell is
worse than none. Vendor assets are best-effort at install (the CDN may be
firewalled) and are picked up by the runtime handler on a later load.

When a new worker is waiting, the page raises a toast with a *Reload* action
rather than swapping code underneath a learner mid-quiz.

### Offline verification checklist

1. Load the app once with a connection. The status bar `CACHE` field should read
   **`offline ready`** (it shows `n/15 shell · n/3 vendor` while filling).
2. Go offline — aircraft mode, or DevTools → Network → Offline.
3. Hard-reload. Expect: the page loads, the ocean renders, the status bar shows a
   non-zero `TRIS` count, and the network badge reads **Offline**.
4. Switch through all three modes. The catalogue must still list 33
   configurations and the quiz must still generate questions.
5. Install to the home screen (Chrome: *Install app*) and launch it with no
   connection.

Verified in Chromium: offline reload returns HTTP 200 from cache, renders 34,398
triangles, and logs zero console errors.

---

## Performance

Target is a stable 30+ FPS on integrated graphics, with a scene budget of
**≈ 60 k triangles**. Actual: **~35 k** with a vessel and lights (water 32,768 +
sky 768 + hull ~3.4 k), in under 40 draw calls.

The **Full FX / Lite FX** toggle (`P`) halves the water grid to 64×64 — a
measured **35,346 → 10,230 triangles** — caps the renderer pixel ratio at 1,
disables antialiasing, and drops every CSS `backdrop-filter`, the single biggest
UI cost on integrated GPUs.

Other deliberate choices: fine ocean ripples perturb the normal per pixel rather
than adding geometry; the frame loop allocates nothing; light visibility is
recomputed only when the eye actually moves; the aspect read-out is rewritten
only when the rounded bearing changes, and the counters four times a second.

> FPS in a headless SwiftShader test rig is not representative — it is software
> rasterisation. Judge frame rate on real hardware.

---

## Accessibility

- Mode tabs implement the WAI-ARIA tabs pattern: arrow keys, `Home`/`End`,
  roving `tabindex`. Quiz answers use the same pattern.
- Visible focus ring on every interactive control; never suppressed.
- Zero unlabelled focusable controls in any of the three modes.
- Quiz feedback is a polite live region. The aspect meter deliberately is **not**
  one — it updates every frame and would flood a screen reader.
- `prefers-reduced-motion` and `prefers-contrast: more` are both honoured.
- Coarse-pointer media query raises hit targets to ≥ 44 px.
- No horizontal overflow and no unscrollable clipped panel at 1440 / 1280 / 768 px
  in any mode.

## Keyboard

`1`/`2`/`3` modes · `D` day/night · `P` performance · `R` reset camera ·
`S` day shapes · `A` light arcs · `G` arc verification · `?` help

In the quiz: `↑`/`↓` move between answers, `Enter` selects then submits, `N` next.

Touch: one finger orbits, two fingers pinch-zoom.

---

## Licence & disclaimer

Training aid only. It is not a substitute for the official IMO publication of the
COLREGs, and must not be used for navigation.
