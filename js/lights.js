/* ==========================================================================
   COLREG 3D — Navigational light & sector engine  (STEP 3)
   --------------------------------------------------------------------------
   Builds the procedural vessel, hangs her prescribed lights and day shapes on
   it, and fades each light in or out live from the camera's relative bearing.

   Every arc constant below is cited against its source. They are the single
   source of truth for the scene, the quiz and the simulator alike.

   SCALE NOTE — deliberate, documented exaggeration
   Lights and day shapes are drawn far larger than scale (a Rule 31 ball is
   0.6 m across per Annex I §6; at a 95 m eye distance that is roughly one
   pixel). Sizes here are chosen for legibility, since the point of the app is
   to teach which lights are showing, not to model lamp optics. Positions,
   arcs and relative vertical order are all faithful.
   ========================================================================== */

import { loadThree } from './scene.js';

/* ── Arcs of visibility — Rule 21 ──────────────────────────────────────── */

/**
 * Prescribed arcs, in degrees, measured on the horizontal.
 * COLREG 1972 as amended, Rule 21 — Definitions.
 */
export const ARCS = Object.freeze({
  /** Rule 21(a): masthead light — 225°, centred dead ahead, i.e. from right
   *  ahead to 22.5° abaft the beam on either side. */
  MASTHEAD: 225,

  /** Rule 21(b): sidelights — 112.5° each, from right ahead to 22.5° abaft
   *  the beam on their own side. Green to starboard, red to port. */
  SIDELIGHT: 112.5,

  /** Rule 21(c): sternlight — 135°, centred right aft, i.e. 67.5° from right
   *  aft on each side. Note 135 + 2 × 112.5 = 360: the sidelights and the
   *  sternlight exactly tile the horizon, with no gap and no overlap. */
  STERNLIGHT: 135,

  /** Rule 21(d): towing light — yellow, same characteristics as the
   *  sternlight of Rule 21(c). Rule 24(a)(iv) places it above that light. */
  TOWING: 135,

  /** Rule 21(e): all-round light — unbroken over 360°. */
  ALL_ROUND: 360
});

/**
 * Arc centres as relative bearings from the bow (000° = right ahead,
 * increasing to starboard).
 */
export const ARC_CENTRES = Object.freeze({
  MASTHEAD: 0,
  SIDELIGHT_STBD: ARCS.SIDELIGHT / 2,        // 056.25°
  SIDELIGHT_PORT: 360 - ARCS.SIDELIGHT / 2,  // 303.75°
  STERNLIGHT: 180,
  TOWING: 180,
  ALL_ROUND: 0
});

/**
 * Annex I §9(a)(i): intensity "shall decrease to reach practical cut-off
 * between 1 degree and 3 degrees outside the prescribed sectors". A real
 * light therefore does not vanish at a knife edge, and neither does this one.
 * 2° sits in the middle of the permitted band.
 */
export const CUT_OFF_DEG = 2;

/** Display approximations of the Annex I §7 chromaticities. */
export const LIGHT_COLOURS = Object.freeze({
  white: 0xfff4e2,
  red: 0xff2233,
  green: 0x12e06a,
  yellow: 0xffd400,
  blue: 0x4f9bff
});

/* ── Pure geometry helpers (exported so the quiz can reuse them) ────────── */

export const norm360 = (deg) => ((deg % 360) + 360) % 360;

/** Smallest signed difference a → b, in (-180, 180]. */
export function angleDelta(a, b) {
  let d = norm360(b) - norm360(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * How brightly a light shows to an observer on a given relative bearing.
 *
 * @param {{arc:number, centre:number}} light
 * @param {number} observerBearing relative bearing of the observer from the bow
 * @returns {number} 1 inside the prescribed sector, ramping to 0 across the
 *                   Annex I §9(a)(i) cut-off band just outside it
 */
export function visibilityAt(light, observerBearing) {
  if (light.arc >= 360) return 1;

  const half = light.arc / 2;
  const off = Math.abs(angleDelta(light.centre, observerBearing));

  if (off <= half) return 1;
  if (off >= half + CUT_OFF_DEG) return 0;
  return 1 - (off - half) / CUT_OFF_DEG;
}

/* ── Default vessel: power-driven, 50 m or more, underway ──────────────── */

/*
  Dimensions in metres; the scene works in metres. Vertical positions follow
  Annex I §2:
    §2(a)(i)  forward masthead light not less than 6 m above the hull
    §2(a)(ii) two masthead lights, the after one at least 4.5 m vertically
              higher than the forward one
    §2(g)     sidelights not higher than three quarters of the height of the
              forward masthead light
    §2(a)(i)  masthead lights spaced so the after one is seen over and
              separate from the forward one at 1000 m from the stem
*/
export const VESSEL = Object.freeze({
  loa: 80, beam: 13, freeboard: 6, draft: 4,
  mast: { fore: { z: 16, y: 15 }, main: { z: -14, y: 21 } }
});

const DEFAULT_LIGHTS = [
  {
    id: 'masthead-fwd', label: 'Forward masthead', colour: 'white',
    arc: ARCS.MASTHEAD, centre: ARC_CENTRES.MASTHEAD,
    pos: [0, VESSEL.mast.fore.y, VESSEL.mast.fore.z],
    rule: 'Rule 23(a)(i)'
  },
  {
    id: 'masthead-aft', label: 'After masthead', colour: 'white',
    arc: ARCS.MASTHEAD, centre: ARC_CENTRES.MASTHEAD,
    pos: [0, VESSEL.mast.main.y, VESSEL.mast.main.z],
    rule: 'Rule 23(a)(ii)'
  },
  {
    id: 'sidelight-stbd', label: 'Starboard sidelight', colour: 'green',
    arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_STBD,
    pos: [VESSEL.beam / 2, 9, 8],
    rule: 'Rule 23(a)(iii)'
  },
  {
    id: 'sidelight-port', label: 'Port sidelight', colour: 'red',
    arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_PORT,
    pos: [-VESSEL.beam / 2, 9, 8],
    rule: 'Rule 23(a)(iii)'
  },
  {
    id: 'sternlight', label: 'Sternlight', colour: 'white',
    arc: ARCS.STERNLIGHT, centre: ARC_CENTRES.STERNLIGHT,
    pos: [0, 7, -VESSEL.loa / 2 + 1],
    rule: 'Rule 23(a)(iv)'
  }
];

export const DEFAULT_CONFIG = Object.freeze({
  id: 'power-driven-50m-plus',
  name: 'Power-driven vessel underway, 50 m or more',
  rule: { citation: 'Rule 23(a)' },
  lights: DEFAULT_LIGHTS,
  dayShapes: []
});

/* ── Mount points for extra lights and shapes ──────────────────────────── */

/*
  Vertical stacks used by configurations that carry all-round lights or day
  shapes. Annex I §2(k) requires 2 m vertical separation between the lights of
  Rule 27(b)(i); §6(b) requires 1.5 m between shapes. Spacing here is 3 m so
  the separation is unmistakable at teaching distances.
*/
export const MOUNTS = Object.freeze({
  /** All-round light stacks go on the mainmast, where best seen. */
  stack: (i, count) => [0, VESSEL.mast.main.y + 6 - i * 3, VESSEL.mast.main.z],
  /** Day shapes hang forward, on the foremast. */
  shapeStack: (i) => [0, VESSEL.mast.fore.y - 1 - i * 3.4, VESSEL.mast.fore.z]
});

/* ── Entry point ───────────────────────────────────────────────────────── */

/**
 * @param {{scene: object, bus: EventTarget}} ctx
 */
export async function initLights(ctx) {
  const { scene, bus } = ctx;
  if (!scene || scene.pending || scene.failed) return { pending: true };

  const { THREE } = await loadThree();
  const anchor = scene.vesselAnchor;

  const glowTexture = makeGlowTexture(THREE);

  /* ── Vessel hull ── */
  const hull = buildVessel(THREE);
  anchor.add(hull.group);

  /* ── Mutable light rig ── */
  let rig = [];                 // [{ def, sprite, lamp, sector, materials }]
  let shapes = [];              // [{ mesh, materials }]
  let config = DEFAULT_CONFIG;

  let arcsVisible = false;
  let shapesVisible = false;
  let debugVisible = false;

  const disposables = new Set();

  // Declared before build(), which renders into it on the first pass.
  const debugList = document.querySelector('#debug-list');

  /** Frees every geometry/material a rebuild is about to orphan. */
  function clearRig() {
    for (const item of [...rig, ...shapes]) {
      item.root.removeFromParent();
      item.root.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      });
    }
    rig = [];
    shapes = [];
  }

  function build(cfg) {
    clearRig();
    config = cfg;

    for (const def of cfg.lights || []) {
      const root = new THREE.Group();
      root.position.fromArray(def.pos);

      const colour = new THREE.Color(LIGHT_COLOURS[def.colour] ?? LIGHT_COLOURS.white);

      // The lamp itself: a small emissive bead, so the source has a position
      // even when the glow is faded out.
      const lampMat = new THREE.MeshBasicMaterial({ color: colour });
      const lamp = new THREE.Mesh(sharedLampGeo(THREE), lampMat);
      root.add(lamp);

      // Additive sprite glow — always faces the eye, which is exactly how a
      // navigation light behaves.
      const spriteMat = new THREE.SpriteMaterial({
        map: glowTexture, color: colour, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.setScalar(7);
      root.add(sprite);

      // Arc-of-visibility wedge, shown by the "Arcs" toggle.
      const sector = buildSector(THREE, def, colour);
      sector.visible = false;
      root.add(sector);

      anchor.add(root);
      rig.push({ def, root, sprite, lamp, sector, colour });
    }

    for (const [i, shapeDef] of (cfg.dayShapes || []).entries()) {
      const root = buildDayShape(THREE, shapeDef, i);
      root.visible = shapesVisible;
      anchor.add(root);
      shapes.push({ def: shapeDef, root });
    }

    renderDebugRows();
  }

  build(DEFAULT_CONFIG);

  /* ── Per-frame visibility ── */

  let lastBearing = -999;

  scene.onFrame(({ bearing }) => {
    // Nothing moves unless the eye actually moved; orbiting is the only thing
    // that changes an arc, so this skips the work on a still camera.
    if (Math.abs(bearing - lastBearing) < 0.05) return;
    lastBearing = bearing;

    for (const item of rig) {
      const v = visibilityAt(item.def, bearing);

      item.sprite.material.opacity = v;
      item.sprite.visible = v > 0.001;
      // A light near its cut-off dims *and* shrinks; both cues read faster
      // than opacity alone on a bright bridge display.
      item.sprite.scale.setScalar(3 + 4 * v);

      // Outside its sector the lamp must go genuinely dark, not merely dim:
      // a red glow visible from astern would teach the wrong thing. The bead
      // stays just bright enough to show where the fitting is.
      item.lamp.material.color.copy(item.colour).multiplyScalar(0.07 + 0.93 * v);

      if (item.sector.visible) {
        item.sector.material.opacity = (0.10 + 0.22 * v) * (arcsVisible ? 1 : 0);
      }
    }

    if (debugVisible) updateDebugRows(bearing);
  });

  /* ── Debug / arc-verification overlay ── */

  function renderDebugRows() {
    if (!debugList) return;
    debugList.innerHTML = '';

    for (const item of rig) {
      const li = document.createElement('li');
      li.className = 'debug__row';
      li.dataset.lightId = item.def.id;

      const name = document.createElement('span');
      name.textContent = `${item.def.label} · ${item.def.arc}°`;

      const state = document.createElement('span');
      state.dataset.role = 'state';
      state.textContent = '—';

      li.append(name, state);
      debugList.append(li);
    }

    const sep = document.createElement('li');
    sep.className = 'debug__row';
    sep.innerHTML = '<span>Boundary self-test</span><span data-role="selftest">—</span>';
    debugList.append(sep);

    for (const row of runArcSelfTest(config)) {
      const li = document.createElement('li');
      li.className = `debug__row ${row.pass ? 'is-pass' : 'is-fail'}`;
      li.innerHTML =
        `<span>${row.label}</span><span>${row.pass ? 'PASS' : 'FAIL'}</span>`;
      debugList.append(li);
    }
  }

  function updateDebugRows(bearing) {
    if (!debugList) return;

    for (const item of rig) {
      const li = debugList.querySelector(`[data-light-id="${item.def.id}"]`);
      const state = li?.querySelector('[data-role="state"]');
      if (!state) continue;

      const v = visibilityAt(item.def, bearing);
      state.textContent = v === 1 ? 'visible'
        : v === 0 ? 'hidden'
        : `cut-off ${(v * 100).toFixed(0)}%`;
      li.className = `debug__row ${v === 1 ? 'is-pass' : v === 0 ? '' : 'is-fail'}`;
    }

    const st = debugList.querySelector('[data-role="selftest"]');
    if (st) st.textContent = `${bearing.toFixed(1)}°`;
  }

  /* ── External API ── */

  function setArcsVisible(on) {
    arcsVisible = on;
    for (const item of rig) item.sector.visible = on;
    lastBearing = -999;   // force an opacity refresh on the next frame
  }

  function setShapesVisible(on) {
    shapesVisible = on;
    for (const s of shapes) s.root.visible = on;
  }

  function setDebugVisible(on) {
    debugVisible = on;
    if (on) updateDebugRows(scene.getBearing());
  }

  function setConfiguration(entry) {
    build(toSceneConfig(entry));
    setShapesVisible(shapesVisible);
    setArcsVisible(arcsVisible);
    lastBearing = -999;
  }

  bus?.addEventListener('scene:arcs', (e) => setArcsVisible(e.detail.enabled));
  bus?.addEventListener('scene:shapes', (e) => setShapesVisible(e.detail.enabled));
  bus?.addEventListener('scene:debug', (e) => setDebugVisible(e.detail.enabled));

  return {
    pending: false,
    hull,
    get config() { return config; },
    get lights() { return rig.map((r) => r.def); },
    visibleLights: (bearing) =>
      rig.filter((r) => visibilityAt(r.def, bearing) > 0.5).map((r) => r.def),
    setConfiguration, setArcsVisible, setShapesVisible, setDebugVisible,
    dispose() { clearRig(); glowTexture.dispose(); disposables.forEach((d) => d.dispose?.()); }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Arc verification self-test
   ══════════════════════════════════════════════════════════════════════════
   Answers, mechanically, the question "is each arc actually right?".
   Shown in the debug overlay (G) so correctness can be confirmed by eye as
   well as by assertion.
*/
export function runArcSelfTest(config = DEFAULT_CONFIG) {
  const byId = Object.fromEntries((config.lights || []).map((l) => [l.id, l]));
  const rows = [];

  const check = (label, fn) => {
    let pass = false;
    try { pass = fn() === true; } catch { pass = false; }
    rows.push({ label, pass });
  };

  const stbd = byId['sidelight-stbd'];
  const port = byId['sidelight-port'];
  const mast = byId['masthead-fwd'];
  const stern = byId['sternlight'];

  if (stbd) {
    // Rule 21(b): green shows from right ahead to 22.5° abaft the starboard beam.
    check('stbd sidelight full at 112.0°', () => visibilityAt(stbd, 112.0) === 1);
    check('stbd sidelight cut-off at 113.0°', () => {
      const v = visibilityAt(stbd, 113.0);
      return v > 0 && v < 1;
    });
    check('stbd sidelight dark at 115.0°', () => visibilityAt(stbd, 115.0) === 0);
    check('stbd sidelight full at 000.0°', () => visibilityAt(stbd, 0) === 1);
    check('stbd sidelight dark to port (300°)', () => visibilityAt(stbd, 300) === 0);
  }

  if (port) {
    check('port sidelight full at 248.0°', () => visibilityAt(port, 248.0) === 1);
    check('port sidelight dark at 245.0°', () => visibilityAt(port, 245.0) === 0);
    check('port sidelight full at 000.0°', () => visibilityAt(port, 0) === 1);
  }

  if (mast) {
    // Rule 21(a): 225°, i.e. dark from 112.5° to 247.5°.
    check('masthead full at 112.0°', () => visibilityAt(mast, 112.0) === 1);
    check('masthead dark at 180.0° (astern)', () => visibilityAt(mast, 180) === 0);
    check('masthead full at 248.0°', () => visibilityAt(mast, 248.0) === 1);
  }

  if (stern) {
    // Rule 21(c): 135° centred astern → 112.5° to 247.5°.
    check('sternlight dark at 110.0°', () => visibilityAt(stern, 110.0) === 0);
    check('sternlight full at 113.0°', () => visibilityAt(stern, 113.0) === 1);
    check('sternlight full at 180.0°', () => visibilityAt(stern, 180) === 1);
    check('sternlight dark at 250.0°', () => visibilityAt(stern, 250.0) === 0);
  }

  if (stbd && stern) {
    // The tiling property: at any bearing at least one of sidelight/stern shows.
    check('sidelights + stern tile 360° (no gap)', () => {
      for (let b = 0; b < 360; b += 0.5) {
        const lit = visibilityAt(stbd, b) + visibilityAt(port, b) + visibilityAt(stern, b);
        if (lit < 0.999) return false;
      }
      return true;
    });
  }

  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   Geometry builders
   ══════════════════════════════════════════════════════════════════════════ */

let _lampGeo = null;
function sharedLampGeo(THREE) {
  _lampGeo ??= new THREE.SphereGeometry(0.55, 8, 6);
  return _lampGeo;
}

/** Soft radial gradient used by every light sprite. Built once, tinted per light. */
function makeGlowTexture(THREE) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');

  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');

  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Horizontal wedge showing a light's arc of visibility.
 * Built as an explicit triangle fan in the vessel's frame — direction for a
 * relative bearing θ is (sin θ, 0, cos θ), so there is no rotation to get
 * backwards.
 */
function buildSector(THREE, def, colour) {
  const radius = 42;
  const segments = Math.max(8, Math.round(def.arc / 4));
  const start = def.centre - def.arc / 2;

  const positions = [0, 0, 0];
  const fades = [1];

  for (let i = 0; i <= segments; i++) {
    const deg = start + (def.arc * i) / segments;
    const rad = THREE.MathUtils.degToRad(deg);
    positions.push(Math.sin(rad) * radius, 0, Math.cos(rad) * radius);
    fades.push(0);
  }

  const indices = [];
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uColour: { value: colour.clone() }, uOpacity: { value: 0.3 } },
    vertexShader: `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      precision mediump float;
      uniform vec3 uColour;
      uniform float uOpacity;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(uColour, vFade * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  // ShaderMaterial has no `.opacity`; expose one so the frame loop can fade
  // the wedge with the same code path as the sprites.
  Object.defineProperty(mat, 'opacity', {
    get() { return this.uniforms.uOpacity.value; },
    set(v) { this.uniforms.uOpacity.value = v; }
  });

  return new THREE.Mesh(geo, mat);
}

/** Rule 31 / Annex I §6 shapes: ball, cone, diamond, cylinder. */
function buildDayShape(THREE, def, index) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x11151b, roughness: 0.95, metalness: 0
  });

  const R = 1.1;          // exaggerated for legibility; Annex I §6(a)(i) is 0.6 m
  const count = def.count ?? 1;

  for (let i = 0; i < count; i++) {
    let geo;
    switch (def.shape) {
      case 'cone':
        geo = new THREE.ConeGeometry(R, R * 2, 14);
        break;
      case 'cylinder':
        geo = new THREE.CylinderGeometry(R, R, R * 2, 16);
        break;
      case 'diamond': {
        // Two cones base to base — Annex I §6(a)(iv).
        geo = new THREE.ConeGeometry(R, R * 1.6, 14);
        const lower = new THREE.Mesh(new THREE.ConeGeometry(R, R * 1.6, 14), mat);
        lower.rotation.x = Math.PI;
        lower.position.y = -R * 1.6;
        group.add(lower);
        break;
      }
      case 'ball':
      default:
        geo = new THREE.SphereGeometry(R, 14, 10);
    }

    const mesh = new THREE.Mesh(geo, mat);

    // Rule 27(b)(i) and Rule 30 stacks read top-to-bottom.
    const [x, y, z] = MOUNTS.shapeStack(index + i);
    mesh.position.set(x, y, z);

    // "Apexes together" for the Rule 26 trawling / Rule 27(d) cone pairs.
    if (def.shape === 'cone' && def.arrangement === 'apexes-together' && i === 1) {
      mesh.rotation.x = Math.PI;
    }

    group.add(mesh);
  }

  return group;
}

/**
 * Procedural low-poly vessel: hull, forecastle, superstructure, funnel and
 * two masts. Roughly 3 400 triangles.
 */
function buildVessel(THREE) {
  const group = new THREE.Group();
  const { loa, beam, freeboard, draft } = VESSEL;

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1a2430, roughness: 0.82, metalness: 0.08,
    // A little self-illumination keeps the silhouette readable at night,
    // where a physically correct hull would be a black hole.
    emissive: 0x121b26, emissiveIntensity: 1
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x2a3646, roughness: 0.75, metalness: 0.1, emissive: 0x0c141d
  });
  const houseMat = new THREE.MeshStandardMaterial({
    color: 0x3d4a5c, roughness: 0.7, metalness: 0.05, emissive: 0x121a24
  });
  const mastMat = new THREE.MeshStandardMaterial({
    color: 0x4a5666, roughness: 0.6, metalness: 0.2, emissive: 0x10161e
  });

  /* Hull: a plan-view outline (pointed bow, transom stern) extruded
     vertically. Built in the shape's XY plane then rotated so the bow ends up
     on +Z and the extrusion becomes height. */
  const half = beam / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, loa / 2);                       // stem
  shape.quadraticCurveTo(half * 0.9, loa * 0.34, half, loa * 0.16);
  shape.lineTo(half, -loa * 0.36);
  shape.quadraticCurveTo(half * 0.95, -loa / 2, half * 0.72, -loa / 2);
  shape.lineTo(-half * 0.72, -loa / 2);           // transom
  shape.quadraticCurveTo(-half * 0.95, -loa / 2, -half, -loa * 0.36);
  shape.lineTo(-half, loa * 0.16);
  shape.quadraticCurveTo(-half * 0.9, loa * 0.34, 0, loa / 2);

  const hullGeo = new THREE.ExtrudeGeometry(shape, {
    depth: freeboard + draft,
    bevelEnabled: true,
    bevelThickness: 1.1,
    bevelSize: 0.9,
    bevelSegments: 2,
    curveSegments: 6
  });
  hullGeo.rotateX(Math.PI / 2);   // shape +Y (length) → +Z, extrusion → -Y
  hullGeo.translate(0, freeboard, 0);
  hullGeo.computeVertexNormals();
  group.add(new THREE.Mesh(hullGeo, hullMat));

  // Main deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.98, 0.5, loa * 0.97), deckMat);
  deck.position.y = freeboard + 0.25;
  group.add(deck);

  // Forecastle
  const fc = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.8, 1.6, loa * 0.13), deckMat);
  fc.position.set(0, freeboard + 1.1, loa * 0.4);
  group.add(fc);

  // Superstructure block, stepped, aft of midships
  const houseZ = VESSEL.mast.main.z + 2;
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.78, 7.5, 15), houseMat);
  house.position.set(0, freeboard + 4.2, houseZ);
  group.add(house);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.92, 3.2, 8.5), houseMat);
  bridge.position.set(0, freeboard + 9.5, houseZ + 2);
  group.add(bridge);

  // Funnel
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.3, 6.5, 12), houseMat);
  funnel.position.set(0, freeboard + 11.5, houseZ - 5.5);
  group.add(funnel);

  // Masts — the mounting points for the masthead and all-round lights
  const foremast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.42, VESSEL.mast.fore.y - freeboard, 8), mastMat);
  foremast.position.set(0, freeboard + (VESSEL.mast.fore.y - freeboard) / 2, VESSEL.mast.fore.z);
  group.add(foremast);

  const mainmast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.45, VESSEL.mast.main.y - freeboard - 9, 8), mastMat);
  mainmast.position.set(
    0, freeboard + 9 + (VESSEL.mast.main.y - freeboard - 9) / 2, VESSEL.mast.main.z);
  group.add(mainmast);

  // Sidelight screens — Annex I §5 requires inboard screens matt black, and
  // they are what physically produces the 112.5° cut-off.
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 });
  for (const sx of [-1, 1]) {
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 1.4), screenMat);
    screen.position.set(sx * (beam / 2 - 0.25), 9, 8);
    group.add(screen);
  }

  return { group, materials: [hullMat, deckMat, houseMat, mastMat, screenMat] };
}

/* ══════════════════════════════════════════════════════════════════════════
   Data adaptor
   ══════════════════════════════════════════════════════════════════════════
   Turns a data/colreg-rules.json entry (STEP 4) into the scene-side shape the
   builders above expect: resolves named arcs to degrees and named mount
   points to coordinates.
*/
export function toSceneConfig(entry) {
  if (!entry) return DEFAULT_CONFIG;

  const F = VESSEL.mast.fore;
  const M = VESSEL.mast.main;

  const named = {
    'masthead-fwd': [0, F.y, F.z],
    'masthead-aft': [0, M.y, M.z],
    'sidelight-stbd': [VESSEL.beam / 2, 9, 8],
    'sidelight-port': [-VESSEL.beam / 2, 9, 8],
    'sternlight': [0, 7, -VESSEL.loa / 2 + 1],
    /* Rule 24(a)(iv): the towing light sits in a vertical line ABOVE the
       sternlight, which is why it gets its own mount rather than sharing. */
    'towing': [0, 10, -VESSEL.loa / 2 + 1],
    /* Rule 24(a)(i) / 24(c)(i): two — or three, for a tow over 200 m —
       masthead lights in a vertical line, on the foremast. */
    'masthead-vert-1': [0, F.y + 6, F.z],
    'masthead-vert-2': [0, F.y + 3, F.z],
    'masthead-vert-3': [0, F.y, F.z],
    /* Rule 30(a): anchor lights — one in the fore part, one at or near the
       stern and lower than the forward one. */
    'anchor-fwd': [0, 13, VESSEL.loa / 2 - 6],
    'anchor-aft': [0, 8, -VESSEL.loa / 2 + 4],
    /* Rule 27(d)(i)/(ii): obstruction and safe-pass sides, shown abeam. */
    'obstruction-upper': [-VESSEL.beam / 2 - 2, 14, 2],
    'obstruction-lower': [-VESSEL.beam / 2 - 2, 11, 2],
    'safepass-upper': [VESSEL.beam / 2 + 2, 14, 2],
    'safepass-lower': [VESSEL.beam / 2 + 2, 11, 2]
  };

  let stackIndex = 0;
  const lights = (entry.lights || []).map((l) => {
    const arc = typeof l.arc === 'number' ? l.arc : (ARCS[l.arc] ?? ARCS.ALL_ROUND);
    const centre = typeof l.arcCentre === 'number'
      ? l.arcCentre
      : (ARC_CENTRES[l.arcCentre] ?? defaultCentreFor(l.id, arc));

    const pos = named[l.id] ?? MOUNTS.stack(stackIndex++, 3);

    return {
      id: l.id, label: l.label ?? l.id, colour: l.colour ?? 'white',
      arc, centre, pos, rule: l.rule ?? entry.rule?.citation
    };
  });

  return {
    id: entry.id,
    name: entry.name,
    rule: entry.rule,
    lights: lights.length ? lights : DEFAULT_LIGHTS,
    dayShapes: entry.dayShapes || []
  };
}

function defaultCentreFor(id = '', arc) {
  if (arc >= 360) return 0;
  if (id.includes('stbd')) return ARC_CENTRES.SIDELIGHT_STBD;
  if (id.includes('port')) return ARC_CENTRES.SIDELIGHT_PORT;
  if (id.includes('stern') || id.includes('towing')) return ARC_CENTRES.STERNLIGHT;
  return ARC_CENTRES.MASTHEAD;
}
