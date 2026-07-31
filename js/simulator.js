/* ==========================================================================
   COLREG 3D — Multi-vessel encounter simulator
   STATUS: placeholder. Implemented in STEP 6.

   STEP 6 will own, in this file:
     • Two vessels on the water, positioned from the bearing/heading/range
       controls in the Encounter Setup panel
     • Live classification from the actual geometry — never a fixed preset:
         – Rule 13 overtaking: approaching from more than 22.5° abaft the
           target's beam (i.e. inside her sternlight arc)
         – Rule 14 head-on: reciprocal or nearly reciprocal headings, seeing
           both sidelights and the masthead lights in line
         – Rule 15 crossing: everything else where risk of collision exists
       with the boundary cases resolved the way Rule 13(c) requires — if in
       doubt, assume overtaking
     • Stand-on / give-way highlighting and recommended manoeuvre vectors
     • Compass bearing lines and a constant-bearing indication
   ========================================================================== */

/**
 * @param {{bus: EventTarget, data: object}} ctx
 * @returns {Promise<{pending: boolean}>}
 */
export async function initSimulator(_ctx) {
  return { pending: true };
}
