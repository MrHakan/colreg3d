/* ==========================================================================
   COLREG 3D — Application shell controller  (STEP 1)
   --------------------------------------------------------------------------
   Owns everything that is *not* 3D: mode switching, keyboard access, the
   PWA lifecycle, persisted UI preferences and the status bar.

   Later steps plug in through `bus` (a plain EventTarget) and through the
   small `ui` façade exported at the bottom, so none of them need to edit
   this file's wiring.
   ========================================================================== */

import { initScene }         from './scene.js';     // STEP 2
import { initLights, ARCS }  from './lights.js';    // STEP 3
import { loadColregData } from './colreg-data.js';  // STEP 4
import { initQuiz }       from './quiz.js';         // STEP 5
import { initSimulator }  from './simulator.js';    // STEP 6

const APP_VERSION = '0.1.0';
const STORE_KEY = 'colreg3d:prefs';

/** App-wide event bus. Modules listen instead of importing each other. */
export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const root = document.documentElement;

/* ── Preferences ───────────────────────────────────────────────────────── */

const defaults = {
  mode: 'learn',
  daylight: 'night',
  perf: 'full',
  quizMode: 'A',
  shapes: false,
  arcs: false,
  debug: false
};

function loadPrefs() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing / quota — preferences simply don't persist */
  }
}

const prefs = loadPrefs();

/* A ?mode= query (used by the manifest shortcuts) wins over the stored value. */
const requestedMode = new URLSearchParams(location.search).get('mode');
if (['learn', 'quiz', 'simulator'].includes(requestedMode)) prefs.mode = requestedMode;

/* ── Boot overlay ──────────────────────────────────────────────────────── */

const boot = {
  el: $('#boot'),
  bar: $('#boot-bar-fill'),
  status: $('#boot-status'),

  progress(pct, message) {
    if (this.bar) this.bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (message && this.status) this.status.textContent = message;
  },

  dismiss() {
    if (!this.el) return;
    this.progress(100, 'Ready');
    this.el.classList.add('is-gone');
    // Remove from the a11y tree once it has faded out.
    setTimeout(() => this.el?.setAttribute('aria-hidden', 'true'), 450);
  }
};

/* ── Toasts ────────────────────────────────────────────────────────────── */

const toastHost = $('#toasts');

/**
 * @param {string} message
 * @param {{kind?:'info'|'ok'|'warn'|'err', timeout?:number,
 *          action?:{label:string, onClick:() => void}}} [opts]
 */
export function toast(message, opts = {}) {
  if (!toastHost) return () => {};

  const { kind = 'info', timeout = 5000, action } = opts;

  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;

  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);

  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  };

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.append(btn);
  }

  toastHost.append(el);
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ── Mode switching (ARIA tablist) ─────────────────────────────────────── */

const modeTabs = $$('.mode');
const panelRegion = $('#panel-region');

function setMode(mode, { focusTab = false } = {}) {
  if (!['learn', 'quiz', 'simulator'].includes(mode)) return;

  prefs.mode = mode;
  root.dataset.mode = mode;
  savePrefs();

  modeTabs.forEach((tab) => {
    const active = tab.dataset.modeTarget === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) {
      panelRegion?.setAttribute('aria-labelledby', tab.id);
      if (focusTab) tab.focus();
    }
  });

  emit('mode:change', { mode });
}

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.modeTarget));
});

/* Arrow-key navigation between tabs, per the WAI-ARIA tabs pattern. */
$('.modes__list')?.addEventListener('keydown', (ev) => {
  const idx = modeTabs.indexOf(document.activeElement);
  if (idx < 0) return;

  let next = null;
  switch (ev.key) {
    case 'ArrowRight': case 'ArrowDown': next = (idx + 1) % modeTabs.length; break;
    case 'ArrowLeft':  case 'ArrowUp':   next = (idx - 1 + modeTabs.length) % modeTabs.length; break;
    case 'Home': next = 0; break;
    case 'End':  next = modeTabs.length - 1; break;
    default: return;
  }

  ev.preventDefault();
  setMode(modeTabs[next].dataset.modeTarget, { focusTab: true });
});

/* ── Toggle buttons ────────────────────────────────────────────────────── */

/**
 * Wires an aria-pressed button to a preference key and an event.
 * @returns {(next:boolean) => void} setter, for keyboard shortcuts
 */
function wireToggle(selector, prefKey, eventName, onChange) {
  const el = $(selector);
  if (!el) return () => {};

  const apply = (on, { silent = false } = {}) => {
    prefs[prefKey] = on;
    el.setAttribute('aria-pressed', String(on));
    savePrefs();
    onChange?.(on, el);
    if (!silent) emit(eventName, { [prefKey]: on, enabled: on });
  };

  el.addEventListener('click', () => apply(el.getAttribute('aria-pressed') !== 'true'));
  apply(Boolean(prefs[prefKey]), { silent: true });

  return apply;
}

/* Day / night — drives both the UI accent and (from STEP 2) the scene. */
const daylightBtn = $('#btn-daylight');
const daylightLabel = $('#daylight-label');

function setDaylight(mode, { silent = false } = {}) {
  const isDay = mode === 'day';
  prefs.daylight = isDay ? 'day' : 'night';
  root.dataset.daylight = prefs.daylight;
  daylightBtn?.setAttribute('aria-pressed', String(isDay));
  if (daylightLabel) daylightLabel.textContent = isDay ? 'Day' : 'Night';
  savePrefs();
  if (!silent) emit('scene:daylight', { daylight: prefs.daylight });
}

daylightBtn?.addEventListener('click', () => {
  setDaylight(prefs.daylight === 'day' ? 'night' : 'day');
});

/* Performance mode — drops backdrop blur in CSS and, from STEP 2, lowers the
   renderer's pixel ratio and disables antialiasing. */
const perfBtn = $('#btn-perf');

function setPerf(mode, { silent = false } = {}) {
  const lite = mode === 'lite';
  prefs.perf = lite ? 'lite' : 'full';
  root.dataset.perf = prefs.perf;
  perfBtn?.setAttribute('aria-pressed', String(lite));
  const label = perfBtn?.querySelector('.tool__label');
  if (label) label.textContent = lite ? 'Lite FX' : 'Full FX';
  savePrefs();
  if (!silent) emit('scene:perf', { perf: prefs.perf });
}

perfBtn?.addEventListener('click', () => {
  setPerf(prefs.perf === 'lite' ? 'full' : 'lite');
});

/* Viewport toolbar */
const setShapes = wireToggle('#btn-shapes', 'shapes', 'scene:shapes');
const setArcs   = wireToggle('#btn-arcs',   'arcs',   'scene:arcs');
const setDebug  = wireToggle('#btn-debug',  'debug',  'scene:debug', (on) => {
  const overlay = $('#debug-overlay');
  if (!overlay) return;
  overlay.hidden = !on;
  overlay.setAttribute('aria-hidden', String(!on));
});

$('#btn-reset-camera')?.addEventListener('click', () => emit('camera:reset'));

/* ── Help dialog ───────────────────────────────────────────────────────── */

const helpDialog = $('#help-dialog');
$('#btn-help')?.addEventListener('click', () => {
  if (typeof helpDialog?.showModal === 'function') helpDialog.showModal();
});

/* ── Keyboard shortcuts ────────────────────────────────────────────────── */

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (TYPING.has(ev.target?.tagName) || ev.target?.isContentEditable) return;
  if (helpDialog?.open && ev.key !== 'Escape') return;

  switch (ev.key) {
    case '1': setMode('learn'); break;
    case '2': setMode('quiz'); break;
    case '3': setMode('simulator'); break;
    case 'd': case 'D': setDaylight(prefs.daylight === 'day' ? 'night' : 'day'); break;
    case 'p': case 'P': setPerf(prefs.perf === 'lite' ? 'full' : 'lite'); break;
    case 'r': case 'R': emit('camera:reset'); break;
    case 's': case 'S': setShapes(!prefs.shapes); break;
    case 'a': case 'A': setArcs(!prefs.arcs); break;
    case 'g': case 'G': setDebug(!prefs.debug); break;
    case '?': if (typeof helpDialog?.showModal === 'function') helpDialog.showModal(); break;
    default: return;
  }
  ev.preventDefault();
});

/* ── Aspect angle meter ────────────────────────────────────────────────── */

/* Relative-bearing sector names, matching standard bridge phraseology.
   Sidelight arcs (Rule 21(b)) are 112.5° each side, i.e. the green sector
   runs 000-112.5 and the red 247.5-360; the ticks below make that visible.
   The figure comes from lights.js so there is one cited source for it. */
const SIDELIGHT_ARC = ARCS.SIDELIGHT;

function describeBearing(deg) {
  const b = ((deg % 360) + 360) % 360;
  if (b === 0) return 'Right ahead';
  if (b === 180) return 'Right astern';
  if (b === 90) return 'Starboard beam';
  if (b === 270) return 'Port beam';
  if (b < 90)  return 'Starboard bow';
  if (b < 180) return 'Starboard quarter';
  if (b < 270) return 'Port quarter';
  return 'Port bow';
}

const aspect = {
  value: $('#aspect-value'),
  sector: $('#aspect-sector'),
  range: $('#aspect-range'),
  needle: $('#aspect-needle')
};

function buildAspectTicks() {
  const host = $('#aspect-ticks');
  if (!host) return;

  const NS = 'http://www.w3.org/2000/svg';
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg - 90) * Math.PI / 180;
    const major = deg % 90 === 0;
    const r1 = major ? 40 : 44;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', (60 + Math.cos(rad) * r1).toFixed(2));
    line.setAttribute('y1', (60 + Math.sin(rad) * r1).toFixed(2));
    line.setAttribute('x2', (60 + Math.cos(rad) * 49).toFixed(2));
    line.setAttribute('y2', (60 + Math.sin(rad) * 49).toFixed(2));

    // 000° is the boundary both sidelights share, so it stays neutral rather
    // than being claimed by starboard.
    if (deg > 0 && deg <= SIDELIGHT_ARC) line.setAttribute('class', 'is-stbd');
    else if (deg >= 360 - SIDELIGHT_ARC) line.setAttribute('class', 'is-port');
    else line.setAttribute('class', 'is-neutral');

    host.append(line);
  }
}

/**
 * Called every frame by the scene once STEP 2 lands.
 * @param {number} bearingDeg relative bearing of the camera from the vessel's bow
 * @param {number} [rangeM]   camera distance in metres
 */
export function setAspect(bearingDeg, rangeM) {
  const b = ((bearingDeg % 360) + 360) % 360;
  if (aspect.value) aspect.value.textContent = String(Math.round(b)).padStart(3, '0');
  if (aspect.sector) aspect.sector.textContent = describeBearing(Math.round(b));
  if (aspect.needle) aspect.needle.style.transform = `rotate(${b}deg)`;
  if (aspect.range && Number.isFinite(rangeM)) {
    aspect.range.textContent = Math.round(rangeM).toLocaleString('en');
  }
}

/* ── Learn mode: vessel catalogue ──────────────────────────────────────── */

const catalogue = {
  list: $('#catalogue'),
  empty: $('#catalogue-empty'),
  search: $('#catalogue-search'),
  title: $('#detail-title'),
  rule: $('#detail-rule'),
  body: $('#detail-body'),
  lights: $('#detail-lights')
};

/**
 * Renders the Rules 21–31 catalogue and drives the 3D scene from it.
 * @param {object} data   result of loadColregData()
 * @param {object} lights result of initLights()
 */
function initCatalogue(data, lights) {
  if (!catalogue.list || !data?.entries?.length) return;

  let filterRule = 'all';
  let query = '';
  let selectedId = null;

  const arcLabel = (l) =>
    typeof l.arc === 'number' ? `${l.arc}°` : `${ARCS[l.arc] ?? '?'}°`;

  function matches(entry) {
    if (filterRule !== 'all' && String(entry.rule.number) !== filterRule) return false;
    if (!query) return true;
    const hay = `${entry.name} ${entry.summary ?? ''} ${entry.category} ${entry.rule.citation}`;
    return hay.toLowerCase().includes(query);
  }

  function render() {
    const visible = data.entries.filter(matches);
    catalogue.list.replaceChildren();

    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'catalogue__empty';
      li.textContent = 'No configuration matches that filter.';
      catalogue.list.append(li);
      return;
    }

    for (const entry of visible) {
      const li = document.createElement('li');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalogue__item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(entry.id === selectedId));
      btn.dataset.entryId = entry.id;

      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'catalogue__name';
      name.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'catalogue__meta';
      meta.textContent = `${entry.lights.length} light${entry.lights.length === 1 ? '' : 's'}` +
        (entry.dayShapes?.length ? ` · ${entry.dayShapes.length} shape${entry.dayShapes.length === 1 ? '' : 's'}` : '');
      text.append(name, document.createElement('br'), meta);

      const rule = document.createElement('span');
      rule.className = 'catalogue__rule';
      rule.textContent = `R${entry.rule.number}`;

      btn.append(text, rule);
      btn.addEventListener('click', () => select(entry.id));
      li.append(btn);
      catalogue.list.append(li);
    }
  }

  function select(id) {
    const entry = data.entries.find((e) => e.id === id);
    if (!entry) return;
    selectedId = id;

    $$('.catalogue__item').forEach((el) => {
      el.setAttribute('aria-selected', String(el.dataset.entryId === id));
    });

    // Drive the 3D scene.
    lights?.setConfiguration?.(entry);

    // Detail panel.
    if (catalogue.title) catalogue.title.textContent = entry.name;
    if (catalogue.rule) catalogue.rule.textContent = entry.rule.citation;

    const placeholder = catalogue.body?.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    let summary = catalogue.body?.querySelector('.detail-summary');
    if (!summary && catalogue.body) {
      summary = document.createElement('p');
      summary.className = 'detail-summary';
      catalogue.body.prepend(summary);
    }
    if (summary) summary.textContent = entry.summary ?? '';

    if (catalogue.lights) {
      catalogue.lights.hidden = false;
      catalogue.lights.replaceChildren();

      for (const l of entry.lights) {
        const row = document.createElement('div');
        row.className = 'lightlist__row';

        const swatch = document.createElement('span');
        swatch.className = 'lightlist__swatch';
        swatch.dataset.colour = l.colour;

        const dt = document.createElement('dt');
        dt.className = 'lightlist__name';
        dt.textContent = l.label ?? l.id;

        const dd = document.createElement('dd');
        dd.className = 'lightlist__arc';
        dd.textContent = arcLabel(l);
        dd.title = `${l.position ?? ''} — ${l.rule ?? ''}`;

        row.append(swatch, dt, dd);
        catalogue.lights.append(row);
      }

      for (const s of entry.dayShapes ?? []) {
        const row = document.createElement('div');
        row.className = 'lightlist__row';

        const swatch = document.createElement('span');
        swatch.className = 'lightlist__swatch';
        swatch.dataset.colour = 'shape';

        const dt = document.createElement('dt');
        dt.className = 'lightlist__name';
        dt.textContent = `${s.count > 1 ? `${s.count} × ` : ''}${s.shape}` +
          (s.arrangement ? ` (${s.arrangement})` : '');

        const dd = document.createElement('dd');
        dd.className = 'lightlist__arc';
        dd.textContent = s.rule ?? '';

        row.append(swatch, dt, dd);
        catalogue.lights.append(row);
      }
    }

    emit('catalogue:select', { entry });
  }

  catalogue.search?.addEventListener('input', () => {
    query = catalogue.search.value.trim().toLowerCase();
    render();
  });

  $$('[data-rule-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filterRule = chip.dataset.ruleFilter;
      $$('[data-rule-filter]').forEach((c) => {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      render();
    });
  });

  catalogue.empty?.remove();
  render();
  select(data.entries.find((e) => e.id === 'power-50m-and-over')?.id ?? data.entries[0].id);

  return { select, get selectedId() { return selectedId; } };
}

/* ── Status bar ────────────────────────────────────────────────────────── */

const stats = {
  fps: $('#stat-fps'),
  tris: $('#stat-tris'),
  calls: $('#stat-calls'),
  sw: $('#stat-sw')
};

/** Fed by the render loop in STEP 2. */
export function setStats({ fps, triangles, calls } = {}) {
  if (stats.fps && Number.isFinite(fps)) stats.fps.textContent = Math.round(fps);
  if (stats.tris && Number.isFinite(triangles)) stats.tris.textContent = triangles.toLocaleString('en');
  if (stats.calls && Number.isFinite(calls)) stats.calls.textContent = calls;
}

/* ── Network state ─────────────────────────────────────────────────────── */

const netBadge = $('#net-badge');
const netText = $('#net-badge-text');

function updateNetwork() {
  const online = navigator.onLine;
  netBadge?.setAttribute('data-state', online ? 'online' : 'offline');
  if (netText) netText.textContent = online ? 'Online' : 'Offline';
}

addEventListener('online', updateNetwork);
addEventListener('offline', updateNetwork);

/* ── Simulator control read-outs (UI only until STEP 6) ────────────────── */

function wireSimSliders() {
  const pairs = [
    ['#sim-bearing', '#sim-bearing-out', (v) => `${String(v).padStart(3, '0')}°`, (v) => `${v} degrees`],
    ['#sim-heading', '#sim-heading-out', (v) => `${String(v).padStart(3, '0')}°`, (v) => `${v} degrees`],
    ['#sim-range',   '#sim-range-out',   (v) => `${(v / 10).toFixed(1)} NM`,      (v) => `${(v / 10).toFixed(1)} nautical miles`]
  ];

  for (const [inputSel, outSel, fmt, a11y] of pairs) {
    const input = $(inputSel);
    const out = $(outSel);
    if (!input || !out) continue;

    const sync = () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      input.setAttribute('aria-valuetext', a11y(v));
      emit('sim:input', { id: input.id, value: v });
    };

    input.addEventListener('input', sync);
    sync();
  }
}

/* ── Service worker / PWA lifecycle ────────────────────────────────────── */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    if (stats.sw) stats.sw.textContent = 'unsupported';
    return;
  }

  // file:// has no service worker support and module imports fail there too.
  if (location.protocol === 'file:') {
    if (stats.sw) stats.sw.textContent = 'needs http';
    toast('Open the app through a web server — file:// cannot load ES modules.', {
      kind: 'warn', timeout: 9000
    });
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (stats.sw) stats.sw.textContent = 'installing…';

    // A worker waiting on first load means an update is ready to apply.
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);

    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;

      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate(reg);
        } else if (incoming.state === 'activated') {
          reportCacheStatus();
        }
      });
    });

    // The page is only truly offline-capable once a worker controls it.
    if (navigator.serviceWorker.controller) reportCacheStatus();
    navigator.serviceWorker.addEventListener('controllerchange', reportCacheStatus);
  } catch (err) {
    console.error('[pwa] registration failed', err);
    if (stats.sw) stats.sw.textContent = 'failed';
  }
}

function offerUpdate(reg) {
  toast('A new version of COLREG 3D is ready.', {
    kind: 'ok',
    timeout: 0,
    action: {
      label: 'Reload',
      onClick: () => {
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        // controllerchange fires once the new worker takes over.
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      }
    }
  });
}

/** Asks the active worker how much of the app is cached, for the status bar. */
function reportCacheStatus() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return;

  const channel = new MessageChannel();
  const timer = setTimeout(() => { if (stats.sw) stats.sw.textContent = 'active'; }, 2500);

  channel.port1.onmessage = ({ data }) => {
    clearTimeout(timer);
    if (!stats.sw) return;
    stats.sw.textContent = data.complete
      ? 'offline ready'
      : `${data.shellCached}/${data.shellExpected} shell · ${data.vendorCached}/${data.vendorExpected} vendor`;
  };

  worker.postMessage({ type: 'GET_STATUS' }, [channel.port2]);
}

/* ── Boot sequence ─────────────────────────────────────────────────────── */

async function start() {
  boot.progress(10, 'Restoring preferences…');

  setMode(prefs.mode);
  setDaylight(prefs.daylight, { silent: true });
  setPerf(prefs.perf, { silent: true });
  buildAspectTicks();
  wireSimSliders();
  updateNetwork();

  boot.progress(30, 'Registering offline cache…');
  await registerServiceWorker();

  /* Modules 2-6 are stubs in STEP 1. Each returns a descriptor so the shell
     can report honestly what is and isn't wired up yet, instead of pretending
     the scene exists. */
  boot.progress(50, 'Preparing render engine…');
  const scene = await initScene({ host: $('#canvas-host'), bus, prefs });

  if (scene && !scene.pending) {
    /* The render loop runs at 60 Hz; the DOM does not need to. Bearing text
       is rewritten only when the rounded value actually changes, and the
       counters four times a second. */
    let lastBearing = -1;
    let statsAccum = 0;

    scene.onFrame((f) => {
      const b = Math.round(f.bearing);
      if (b !== lastBearing) {
        lastBearing = b;
        setAspect(b, f.range);
      }

      statsAccum += f.dt;
      if (statsAccum >= 0.25) {
        statsAccum = 0;
        const info = scene.renderer.info.render;
        setStats({ fps: f.fps, triangles: info.triangles, calls: info.calls });
      }
    });
  }

  boot.progress(65, 'Preparing light sector engine…');
  const lights = await initLights({ scene, bus });

  boot.progress(78, 'Loading COLREG database…');
  const data = await loadColregData();

  initCatalogue(data, lights);

  if (data?.problems?.length) {
    toast(`Rule data: ${data.problems.length} validation problem(s) — see console.`,
      { kind: 'warn', timeout: 9000 });
  }

  boot.progress(88, 'Preparing quiz engine…');
  const quiz = await initQuiz({ bus, data, scene, lights });

  boot.progress(94, 'Preparing encounter simulator…');
  const simulator = await initSimulator({ bus, data, scene });

  boot.progress(100, 'Ready');
  setTimeout(() => boot.dismiss(), 260);

  /* Report what is genuinely not wired up yet, rather than a hardcoded
     message that drifts out of date as the steps land. */
  const pending = [
    ['3D scene', scene], ['light engine', lights], ['rule database', data],
    ['quiz', quiz], ['simulator', simulator]
  ].filter(([, m]) => m?.pending).map(([label]) => label);

  if (scene?.failed) {
    toast('3D view unavailable — Three.js could not be loaded.', { kind: 'warn', timeout: 9000 });
  } else if (pending.length) {
    toast(`Not yet wired up: ${pending.join(', ')}.`, { kind: 'info', timeout: 6000 });
  }

  /* Live handles for the arc-verification workflow described in lights.js:
     __COLREG__.scene.lookFromBearing(113) then read the debug overlay. */
  Object.assign(window.__COLREG__, { scene, lights, data, quiz, simulator });

  emit('app:ready', { version: APP_VERSION });
}

/* Small debug handle; useful when manually verifying arcs in STEP 3. */
window.__COLREG__ = { bus, setAspect, setStats, toast, prefs, version: APP_VERSION };

start().catch((err) => {
  console.error('[app] boot failed', err);
  boot.progress(100, 'Startup failed — see console');
  toast(`Startup failed: ${err.message}`, { kind: 'err', timeout: 0 });
});

export const ui = { setMode, setDaylight, setPerf, setAspect, setStats, toast };
