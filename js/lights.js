/* ==========================================================================
   COLREG 3D — Navigational light & sector engine
   STATUS: arc constants are final; the engine itself lands in STEP 3.

   The constants below are the single source of truth for every arc drawn or
   tested anywhere in the app (scene, quiz, simulator, aspect meter), each
   cited against its source in the Regulations.
   ========================================================================== */

/**
 * Prescribed arcs of visibility, in degrees.
 * All arcs are measured on the horizontal and are centred as noted.
 *
 * COLREG 1972 as amended, Rule 21 — Definitions.
 */
export const ARCS = Object.freeze({
  /** Rule 21(a): masthead light — 225°, centred on the bow (dead ahead),
   *  i.e. from right ahead to 22.5° abaft the beam on either side. */
  MASTHEAD: 225,

  /** Rule 21(b): sidelights — 112.5° each, from right ahead to 22.5° abaft
   *  the beam on their respective sides. Green to starboard, red to port. */
  SIDELIGHT: 112.5,

  /** Rule 21(c): sternlight — 135°, centred on the stern, i.e. 67.5° from
   *  right aft on each side. (135 + 2 × 112.5 = 360: the sidelights and the
   *  sternlight exactly tile the horizon.) */
  STERNLIGHT: 135,

  /** Rule 21(d): towing light — a yellow light with the same characteristics
   *  as the sternlight of Rule 21(c). Rule 24(a)(iv) places it above it. */
  TOWING: 135,

  /** Rule 21(e): all-round light — unbroken over 360°. */
  ALL_ROUND: 360
});

/**
 * Half-angles, pre-computed — the form the visibility test actually needs.
 * A light is visible when |relative bearing to the observer − arc centre|
 * ≤ the half-angle, with the difference wrapped to ±180°.
 */
export const HALF_ARCS = Object.freeze({
  MASTHEAD: ARCS.MASTHEAD / 2,     // 112.5° either side of dead ahead
  SIDELIGHT: ARCS.SIDELIGHT,       // measured from dead ahead, one side only
  STERNLIGHT: ARCS.STERNLIGHT / 2, // 67.5° either side of right astern
  TOWING: ARCS.TOWING / 2
});

/**
 * Arc centres as relative bearings from the vessel's bow (0° = right ahead,
 * increasing clockwise/to starboard).
 */
export const ARC_CENTRES = Object.freeze({
  MASTHEAD: 0,
  SIDELIGHT_STBD: ARCS.SIDELIGHT / 2,          // 056.25°
  SIDELIGHT_PORT: 360 - ARCS.SIDELIGHT / 2,    // 303.75°
  STERNLIGHT: 180,
  TOWING: 180
});

/**
 * Rendering colours. Chromaticity is specified in Annex I §7; these are
 * display approximations chosen for contrast on an unlit bridge.
 */
export const LIGHT_COLOURS = Object.freeze({
  white: 0xf4f8ff,
  red: 0xff2f45,
  green: 0x00e07a,
  yellow: 0xffd400,
  blue: 0x4f9bff
});

/**
 * STEP 3 will implement here:
 *   • procedural low-poly hull, superstructure and masts
 *   • one cone/sector mesh per light, built from ARCS above
 *   • per-frame visibility: fade each light in or out as the camera's
 *     relative bearing crosses its arc boundary (computed live, never
 *     baked per preset view)
 *   • the debug overlay rows that make each boundary manually verifiable,
 *     e.g. "bearing 112° → port sidelight visible; 113° → extinguished"
 *
 * @param {{scene: object, bus: EventTarget}} ctx
 * @returns {Promise<{pending: boolean}>}
 */
export async function initLights(_ctx) {
  return { pending: true };
}
