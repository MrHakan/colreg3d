/* ==========================================================================
   COLREG 3D — Multi-vessel encounter simulator  (STEP 6)
   --------------------------------------------------------------------------
   Two vessels on the water, classified live from the actual geometry. There
   are no preset situations: "head-on", "crossing" and "overtaking" are
   conclusions the code reaches from the bearings and headings you set, and
   the presets in the UI merely move the sliders.

   HOW THE CLASSIFICATION IS DECIDED

   Rule 13 is tested first, because Rule 13(a) makes it override everything in
   Part B Sections I and II. Rule 13(b) defines overtaking geometrically:
   coming up from more than 22.5° abaft the other's beam, "in such a position
   ... that at night she would be able to see only the sternlight of that
   vessel and neither of her sidelights". That is exactly the 135° sternlight
   arc of Rule 21(c), so the same arc constants that light the vessel also
   decide the encounter — one source of truth, not two.

   Rule 14 then tests for reciprocal or nearly reciprocal courses with the
   other vessel ahead or nearly ahead. Rule 15 catches the rest.

   Both Rule 13(c) and Rule 14(c) say that a vessel in doubt shall assume the
   situation exists. The doubt bands below implement that: near a boundary the
   simulator reports the more demanding interpretation, never the more
   convenient one.

   CONVENTION: headings and bearings are true, 000° = +Z = north, increasing
   clockwise to starboard. Own vessel sits at the origin on heading 000.
   ========================================================================== */

import { loadThree } from './scene.js';
import {
  ARCS, ARC_CENTRES, LIGHT_COLOURS, norm360, angleDelta, visibilityAt,
  buildVessel, makeGlowTexture
} from './lights.js';

/* ── Tunables ──────────────────────────────────────────────────────────── */

const OWN_SPEED_KN = 12;
const KN_TO_MS = 0.514444;

/** Rule 14: "reciprocal or nearly reciprocal courses" and "ahead or nearly
 *  ahead". Inside the tight band it is head-on; between tight and doubt it is
 *  reported as head-on by virtue of Rule 14(c). */
const HEADON = { tight: 6, doubt: 13 };

/** Rule 13(c) doubt band, in degrees inside the sternlight arc boundary. */
const OVERTAKING_DOUBT = 5;

/** Risk of collision (Rule 7) — a CPA inside this, closing, with time to run. */
const CPA_RISK_M = 120;

/* ── Pure classification (exported so it can be tested without a scene) ─── */

/**
 * @param {object} s
 * @param {number} s.relBearing   relative bearing of the target from own bow
 * @param {number} s.targetHeading true heading of the target
 * @param {number} s.range         metres
 * @param {number} s.targetSpeed   knots
 * @param {number} [s.ownHeading]  true heading of own vessel (default 000)
 * @param {number} [s.ownSpeed]    knots (default 12)
 */
export function classifyEncounter(s) {
  const ownHeading = s.ownHeading ?? 0;
  const ownSpeed = s.ownSpeed ?? OWN_SPEED_KN;
  const relBearing = norm360(s.relBearing);
  const targetHeading = norm360(s.targetHeading);

  /* True bearing of the target from us, and of us from the target. */
  const bearingToTarget = norm360(ownHeading + relBearing);
  const bearingToOwn = norm360(bearingToTarget + 180);

  /* Where we lie in HER frame — this is the aspect that Rule 13(b) turns on. */
  const aspectFromTarget = norm360(bearingToOwn - targetHeading);

  const headingDiff = Math.abs(angleDelta(ownHeading, targetHeading));

  /* Positions and velocities in the XZ plane: x = east, z = north. */
  const rad = (d) => (d * Math.PI) / 180;
  const pos = { x: Math.sin(rad(bearingToTarget)) * s.range, z: Math.cos(rad(bearingToTarget)) * s.range };
  const ownVel = { x: Math.sin(rad(ownHeading)) * ownSpeed * KN_TO_MS, z: Math.cos(rad(ownHeading)) * ownSpeed * KN_TO_MS };
  const tgtVel = { x: Math.sin(rad(targetHeading)) * s.targetSpeed * KN_TO_MS, z: Math.cos(rad(targetHeading)) * s.targetSpeed * KN_TO_MS };
  const relVel = { x: tgtVel.x - ownVel.x, z: tgtVel.z - ownVel.z };

  const relSpeed2 = relVel.x ** 2 + relVel.z ** 2;
  const dot = pos.x * relVel.x + pos.z * relVel.z;

  // TCPA is where the relative track passes closest; negative means it already has.
  const tcpa = relSpeed2 > 1e-9 ? -dot / relSpeed2 : Infinity;
  const cpa = relSpeed2 > 1e-9
    ? Math.hypot(pos.x + relVel.x * Math.max(tcpa, 0), pos.z + relVel.z * Math.max(tcpa, 0))
    : s.range;

  const rangeRate = s.range > 1e-6 ? dot / s.range : 0;   // m/s, negative = closing
  const closing = rangeRate < -0.05;

  const riskOfCollision = closing && tcpa > 0 && cpa < CPA_RISK_M;

  /* Which of her lights bear on us, and which of ours bear on her. */
  const sternHalf = ARCS.STERNLIGHT / 2;              // 67.5°
  const sideArc = ARCS.SIDELIGHT;                     // 112.5°

  const weAreInHerSternArc =
    Math.abs(angleDelta(ARC_CENTRES.STERNLIGHT, aspectFromTarget)) <= sternHalf;
  const sheIsInOurSternArc =
    Math.abs(angleDelta(ARC_CENTRES.STERNLIGHT, relBearing)) <= sternHalf;

  /* Doubt bands: just outside the sternlight arc, Rule 13(c) says assume it. */
  const weAreNearlyInHerSternArc =
    Math.abs(angleDelta(ARC_CENTRES.STERNLIGHT, aspectFromTarget)) <= sternHalf + OVERTAKING_DOUBT;
  const sheIsNearlyInOurSternArc =
    Math.abs(angleDelta(ARC_CENTRES.STERNLIGHT, relBearing)) <= sternHalf + OVERTAKING_DOUBT;

  const base = {
    relBearing, targetHeading, aspectFromTarget, headingDiff,
    range: s.range, cpa, tcpa, rangeRate, closing, riskOfCollision,
    visibleLights: lightsBearingOnUs(aspectFromTarget)
  };

  /* Nothing to decide if the two are opening. Rule 7 still applies. */
  if (!closing) {
    return {
      ...base,
      rule: 'Rule 7',
      situation: 'No risk — vessels opening',
      ownRole: 'none', targetRole: 'none',
      action: 'The range is opening. Rule 7 still requires you to keep using every available means to determine whether risk of collision exists.',
      doubt: false
    };
  }

  /* ── Rule 13 — Overtaking (checked first; Rule 13(a) overrides Part B) ── */

  // We can only be overtaking her if we are actually catching her up.
  const comingUpWithHer = s.targetSpeed < ownSpeed - 0.25;
  const sheIsComingUpWithUs = s.targetSpeed > ownSpeed + 0.25;

  if (weAreInHerSternArc && comingUpWithHer) {
    return {
      ...base,
      rule: 'Rule 13(a)',
      situation: 'Overtaking — you are the overtaking vessel',
      ownRole: 'giveway', targetRole: 'standon',
      action: 'Keep out of the way of the vessel being overtaken (Rule 13(a)). ' +
              'You remain the give-way vessel until you are finally past and clear (Rule 13(d)).',
      doubt: false
    };
  }

  if (sheIsInOurSternArc && sheIsComingUpWithUs) {
    return {
      ...base,
      rule: 'Rule 13(a)',
      situation: 'Overtaking — you are being overtaken',
      ownRole: 'standon', targetRole: 'giveway',
      action: 'You are the stand-on vessel: keep your course and speed (Rule 17(a)(i)). ' +
              'She must keep out of your way until finally past and clear.',
      doubt: false
    };
  }

  // Rule 13(c): in any doubt, assume you are overtaking.
  if (weAreNearlyInHerSternArc && comingUpWithHer) {
    return {
      ...base,
      rule: 'Rule 13(c)',
      situation: 'Overtaking assumed (in doubt)',
      ownRole: 'giveway', targetRole: 'standon',
      action: 'You are close to the 22.5°-abaft-the-beam boundary. Rule 13(c) requires that ' +
              'when in any doubt as to whether you are overtaking, you assume that you are ' +
              'and act accordingly — keep out of her way.',
      doubt: true
    };
  }

  /* ── Rule 14 — Head-on ─────────────────────────────────────────────── */

  const nearlyReciprocal = headingDiff >= 180 - HEADON.doubt;
  const aheadOrNearlyAhead = Math.abs(angleDelta(0, relBearing)) <= HEADON.doubt;

  if (nearlyReciprocal && aheadOrNearlyAhead) {
    const tight = headingDiff >= 180 - HEADON.tight &&
                  Math.abs(angleDelta(0, relBearing)) <= HEADON.tight;
    return {
      ...base,
      rule: tight ? 'Rule 14(a)' : 'Rule 14(c)',
      situation: tight ? 'Head-on' : 'Head-on assumed (in doubt)',
      ownRole: 'giveway', targetRole: 'giveway',
      action: tight
        ? 'Each vessel shall alter course to starboard so that each shall pass on the port side of the other (Rule 14(a)). Neither is the stand-on vessel.'
        : 'The courses are close to reciprocal. Rule 14(c) requires that when in doubt you assume a head-on situation exists — alter course to starboard.',
      doubt: !tight
    };
  }

  /* ── Rule 15 — Crossing ────────────────────────────────────────────── */

  // Is she within our starboard sidelight arc, i.e. on our own starboard side?
  const onOurStarboard =
    Math.abs(angleDelta(ARC_CENTRES.SIDELIGHT_STBD, relBearing)) <= sideArc / 2;

  if (onOurStarboard) {
    return {
      ...base,
      rule: 'Rule 15',
      situation: 'Crossing — she is on your starboard side',
      ownRole: 'giveway', targetRole: 'standon',
      action: 'You have her on your own starboard side, so you shall keep out of the way ' +
              '(Rule 15) and, if the circumstances admit, avoid crossing ahead of her. ' +
              'Rule 16 requires early and substantial action.',
      doubt: false
    };
  }

  return {
    ...base,
    rule: 'Rule 15 / Rule 17',
    situation: 'Crossing — she is on your port side',
    ownRole: 'standon', targetRole: 'giveway',
    action: 'She has you on her starboard side, so she is the give-way vessel. ' +
            'Keep your course and speed (Rule 17(a)(i)), but Rule 17(a)(ii) permits you ' +
            'to act once it becomes apparent she is not taking appropriate action, and ' +
            'Rule 17(b) requires it when collision cannot be avoided by her action alone.',
    doubt: false
  };
}

/** Which of the target's lights bear on own vessel, given our aspect on her. */
function lightsBearingOnUs(aspectFromTarget) {
  const defs = [
    { id: 'masthead', label: 'masthead light(s)', colour: 'white', arc: ARCS.MASTHEAD, centre: ARC_CENTRES.MASTHEAD },
    { id: 'stbd', label: 'green sidelight', colour: 'green', arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_STBD },
    { id: 'port', label: 'red sidelight', colour: 'red', arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_PORT },
    { id: 'stern', label: 'sternlight', colour: 'white', arc: ARCS.STERNLIGHT, centre: ARC_CENTRES.STERNLIGHT }
  ];
  return defs.filter((d) => visibilityAt(d, aspectFromTarget) > 0.5);
}

/* ── Presets: these only move the sliders; the verdict is still derived ─── */

export const PRESETS = {
  headon: { bearing: 0, heading: 180, range: 420, speed: 12 },
  crossing: { bearing: 55, heading: 300, range: 420, speed: 12 },
  overtaking: { bearing: 8, heading: 5, range: 420, speed: 6 }
};

/* ── Scene + UI ────────────────────────────────────────────────────────── */

/**
 * @param {{bus: EventTarget, data: object, scene: object}} ctx
 */
export async function initSimulator(ctx) {
  const { bus, scene } = ctx;

  const el = {
    bearing: document.querySelector('#sim-bearing'),
    heading: document.querySelector('#sim-heading'),
    range: document.querySelector('#sim-range'),
    speed: document.querySelector('#sim-speed'),
    bearingOut: document.querySelector('#sim-bearing-out'),
    headingOut: document.querySelector('#sim-heading-out'),
    rangeOut: document.querySelector('#sim-range-out'),
    speedOut: document.querySelector('#sim-speed-out'),
    verdict: document.querySelector('#sim-verdict'),
    rule: document.querySelector('#sim-rule'),
    situation: document.querySelector('#sim-situation'),
    ownRole: document.querySelector('#sim-own-role'),
    targetRole: document.querySelector('#sim-target-role'),
    aspect: document.querySelector('#sim-aspect'),
    visible: document.querySelector('#sim-visible-lights'),
    trend: document.querySelector('#sim-bearing-trend'),
    cpa: document.querySelector('#sim-cpa'),
    advice: document.querySelector('#sim-advice'),
    showBearings: document.querySelector('#sim-show-bearings'),
    showVectors: document.querySelector('#sim-show-vectors'),
    showSectors: document.querySelector('#sim-show-sectors')
  };

  if (!el.bearing || !scene || scene.pending || scene.failed) {
    // The panel still works as a read-out even without 3D.
    return { pending: !el.bearing, classify: classifyEncounter };
  }

  const { THREE } = await loadThree();
  const root = scene.targetAnchor;      // simulator-only content lives here
  const glow = makeGlowTexture(THREE);

  /* ── Target vessel ── */
  const targetShip = buildVessel(THREE);
  root.add(targetShip.group);

  /* Her navigation lights. Visibility is computed from OWN vessel's position,
     not the camera's — the panel answers "what would I see from my bridge?",
     which is a different question from what the orbiting user can see. */
  const targetLightDefs = [
    { id: 'masthead-fwd', colour: 'white', arc: ARCS.MASTHEAD, centre: ARC_CENTRES.MASTHEAD, pos: [0, 15, 16] },
    { id: 'masthead-aft', colour: 'white', arc: ARCS.MASTHEAD, centre: ARC_CENTRES.MASTHEAD, pos: [0, 21, -14] },
    { id: 'sidelight-stbd', colour: 'green', arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_STBD, pos: [6.5, 9, 8] },
    { id: 'sidelight-port', colour: 'red', arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_PORT, pos: [-6.5, 9, 8] },
    { id: 'sternlight', colour: 'white', arc: ARCS.STERNLIGHT, centre: ARC_CENTRES.STERNLIGHT, pos: [0, 7, -39] }
  ];

  const targetLights = targetLightDefs.map((def) => {
    const mat = new THREE.SpriteMaterial({
      map: glow, color: new THREE.Color(LIGHT_COLOURS[def.colour]),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.fromArray(def.pos);
    sprite.scale.setScalar(7);
    root.add(sprite);
    return { def, sprite };
  });

  /* ── Overlays ── */
  const overlays = new THREE.Group();
  scene.scene.add(overlays);

  // Bearing line, own vessel → target.
  const bearingGeo = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(), new THREE.Vector3()]);
  const bearingMat = new THREE.LineDashedMaterial({
    color: 0x3fe0ff, dashSize: 12, gapSize: 8, transparent: true, opacity: 0.85
  });
  const bearingLine = new THREE.Line(bearingGeo, bearingMat);
  overlays.add(bearingLine);

  // Heading vectors for both vessels, and the recommended manoeuvre.
  const ownVector = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 12, 0), 90, 0x22d17c, 22, 12);
  const targetVector = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 12, 0), 90, 0xffb347, 22, 12);
  const adviceVector = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 18, 0), 70, 0x3fe0ff, 20, 11);
  overlays.add(ownVector, targetVector, adviceVector);

  /* Role tint: the hull itself turns green for stand-on, amber for give-way,
     which is faster to read than any label. */
  const ownHullMats = (scene.vesselAnchor.userData.hullMaterials ??= []);
  const roleColours = {
    standon: new THREE.Color(0x0a2317),
    giveway: new THREE.Color(0x27200f),
    none: new THREE.Color(0x121b26)
  };

  /* Only the hull plating carries the role tint. Tinting every material —
     deck, superstructure, masts — turns the whole vessel into a coloured
     blob and buries her lights, which are the thing being taught. */
  function tintHull(materials, role) {
    const hullMat = materials[0];
    if (hullMat?.emissive) hullMat.emissive.copy(roleColours[role] ?? roleColours.none);
  }

  root.visible = false;
  overlays.visible = false;

  /* ── State ── */
  const state = { bearing: 45, heading: 270, range: 450, speed: 12 };
  let verdict = null;

  function readControls() {
    state.bearing = Number(el.bearing.value);
    state.heading = Number(el.heading.value);
    state.range = Number(el.range.value);
    state.speed = Number(el.speed?.value ?? 12);
  }

  function fmtDeg(v) { return `${String(Math.round(v)).padStart(3, '0')}°`; }

  function update() {
    readControls();

    verdict = classifyEncounter({
      relBearing: state.bearing,
      targetHeading: state.heading,
      range: state.range,
      targetSpeed: state.speed
    });

    /* ── Panel ── */
    if (el.bearingOut) el.bearingOut.textContent = fmtDeg(state.bearing);
    if (el.headingOut) el.headingOut.textContent = fmtDeg(state.heading);
    if (el.rangeOut) el.rangeOut.textContent = `${state.range} m`;
    if (el.speedOut) el.speedOut.textContent = `${state.speed} kn`;

    el.bearing.setAttribute('aria-valuetext', `${state.bearing} degrees relative`);
    el.heading.setAttribute('aria-valuetext', `${state.heading} degrees true`);
    el.range.setAttribute('aria-valuetext', `${state.range} metres`);
    el.speed?.setAttribute('aria-valuetext', `${state.speed} knots`);

    if (el.rule) el.rule.textContent = verdict.rule;
    if (el.situation) el.situation.textContent = verdict.situation;
    if (el.verdict) el.verdict.dataset.state = verdict.ownRole;

    const roleText = {
      standon: 'Stand-on — keep course and speed',
      giveway: 'Give-way — keep out of the way',
      none: '—'
    };
    if (el.ownRole) el.ownRole.textContent = roleText[verdict.ownRole];
    if (el.targetRole) el.targetRole.textContent = roleText[verdict.targetRole];

    if (el.aspect) {
      el.aspect.textContent =
        `${fmtDeg(verdict.aspectFromTarget)} on her — ${aspectWord(verdict.aspectFromTarget)}`;
    }
    if (el.visible) {
      el.visible.textContent = verdict.visibleLights.length
        ? verdict.visibleLights.map((l) => l.label).join(', ')
        : 'none';
    }
    if (el.trend) {
      el.trend.textContent = !verdict.closing
        ? 'opening'
        : verdict.riskOfCollision ? 'steady — risk of collision' : 'closing';
    }
    if (el.cpa) {
      el.cpa.textContent = verdict.tcpa > 0 && Number.isFinite(verdict.tcpa)
        ? `${Math.round(verdict.cpa)} m in ${formatTime(verdict.tcpa)}`
        : 'past CPA';
    }
    if (el.advice) {
      el.advice.innerHTML = `<p>${verdict.action}</p>` +
        (verdict.riskOfCollision
          ? '<p><strong>Rule 7(d)(i):</strong> the compass bearing is not appreciably changing — risk of collision is deemed to exist.</p>'
          : '');
    }

    /* ── Scene ── */
    const rad = (d) => (d * Math.PI) / 180;
    const x = Math.sin(rad(state.bearing)) * state.range;
    const z = Math.cos(rad(state.bearing)) * state.range;

    root.position.set(x, 0, z);
    root.rotation.y = rad(state.heading);

    // Her lights, as seen from OUR bridge.
    for (const l of targetLights) {
      const v = visibilityAt(l.def, verdict.aspectFromTarget);
      l.sprite.material.opacity = v;
      l.sprite.visible = v > 0.01;
      l.sprite.scale.setScalar(4 + 5 * v);
    }

    // Bearing line.
    bearingGeo.setFromPoints([new THREE.Vector3(0, 10, 0), new THREE.Vector3(x, 10, z)]);
    bearingGeo.computeBoundingSphere();
    bearingLine.computeLineDistances();      // required for the dashes to show

    // Heading vectors.
    ownVector.setDirection(new THREE.Vector3(0, 0, 1));
    targetVector.position.set(x, 12, z);
    targetVector.setDirection(new THREE.Vector3(Math.sin(rad(state.heading)), 0, Math.cos(rad(state.heading))));

    // Recommended manoeuvre: to starboard when we must give way, otherwise
    // straight on — Rule 8(a) wants any alteration to be large enough to be
    // obvious, so 45° reads better here than a token nudge.
    const adviceHeading = verdict.ownRole === 'giveway' ? 45 : 0;
    adviceVector.setDirection(new THREE.Vector3(Math.sin(rad(adviceHeading)), 0, Math.cos(rad(adviceHeading))));
    adviceVector.setColor(new THREE.Color(verdict.ownRole === 'giveway' ? 0xffb347 : 0x22d17c));

    tintHull(ownHullMats, verdict.ownRole);
    tintHull(targetShip.materials, verdict.targetRole);

    bus?.dispatchEvent(new CustomEvent('sim:classified', { detail: verdict }));
  }

  function aspectWord(deg) {
    const b = norm360(deg);
    if (b < 22.5 || b >= 337.5) return 'you are right ahead of her';
    if (b < 112.5) return 'you are on her starboard bow';
    if (b < 157.5) return 'you are on her starboard quarter';
    if (b < 202.5) return 'you are right astern of her';
    if (b < 247.5) return 'you are on her port quarter';
    return 'you are on her port bow';
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }

  /* ── Wiring ── */

  for (const input of [el.bearing, el.heading, el.speed]) {
    input?.addEventListener('input', update);
  }

  // Range changes the framing as well as the verdict.
  el.range?.addEventListener('input', () => {
    update();
    if (root.visible) frameBoth();
  });

  document.querySelectorAll('[data-sim-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS[btn.dataset.simPreset];
      if (!p) return;
      el.bearing.value = p.bearing;
      el.heading.value = p.heading;
      el.range.value = p.range;
      if (el.speed) el.speed.value = p.speed;
      document.querySelectorAll('[data-sim-preset]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      update();
    });
  });

  el.showBearings?.addEventListener('change', () => {
    bearingLine.visible = el.showBearings.checked;
  });
  el.showVectors?.addEventListener('change', () => {
    const on = el.showVectors.checked;
    ownVector.visible = targetVector.visible = adviceVector.visible = on;
  });
  el.showSectors?.addEventListener('change', () => {
    // Reuses the Learn-mode arc wedges on own vessel.
    bus?.dispatchEvent(new CustomEvent('scene:arcs', {
      detail: { enabled: el.showSectors.checked, arcs: el.showSectors.checked }
    }));
  });

  /* Entering the simulator shows the second vessel and pulls the camera back
     far enough to hold both; leaving hides everything it added. */
  function setActive(on) {
    root.visible = on;
    overlays.visible = on;
    if (!on) {
      tintHull(ownHullMats, 'none');
      return;
    }
    update();
    frameBoth();
  }

  /** Centres the eye on the midpoint of the two vessels, far enough back to
   *  hold both plus a margin for the manoeuvre arrows. */
  function frameBoth() {
    const rad = (d) => (d * Math.PI) / 180;
    const mid = new THREE.Vector3(
      Math.sin(rad(state.bearing)) * state.range * 0.5, 6,
      Math.cos(rad(state.bearing)) * state.range * 0.5);
    /* View across the encounter line, not along it: looking down the line
       foreshortens the separation to nothing and the far vessel falls off
       the top of the frame. 90° off puts both hulls side by side. */
    scene.frameArea(mid, state.range * 1.05 + 230, state.bearing + 270, 58);
  }

  bus?.addEventListener('mode:change', (e) => setActive(e.detail.mode === 'simulator'));

  update();
  if (document.documentElement.dataset.mode === 'simulator') setActive(true);

  return {
    pending: false,
    classify: classifyEncounter,
    get verdict() { return verdict; },
    get state() { return { ...state }; },
    set(next) {
      if (next.bearing !== undefined) el.bearing.value = next.bearing;
      if (next.heading !== undefined) el.heading.value = next.heading;
      if (next.range !== undefined) el.range.value = next.range;
      if (next.speed !== undefined && el.speed) el.speed.value = next.speed;
      update();
      return verdict;
    },
    dispose() {
      overlays.removeFromParent();
      bearingGeo.dispose();
      bearingMat.dispose();
      glow.dispose();
    }
  };
}
