/* ==========================================================================
   COLREG 3D — Quiz engine
   STATUS: placeholder. Implemented in STEP 5.

   STEP 5 will own, in this file:
     • Mode A "Identify the Aspect & Vessel Type" — random camera bearing and
       range; the learner names vessel type, length category and status
     • Mode B "Night to Day Matching" — 3D lights in, day-shape set out
     • Mode C "Rule Reference Search" — scenario in, rule number + required
       action out
     • Scoring: streak counter and score multiplier
     • localStorage persistence of high scores and per-rule miss counts, so
       the Progress panel can flag weak areas (e.g. repeated Rule 27 misses)
     • Feedback rendering with the exact rule citation, plus a
       'quiz:highlight' event so the scene can pick out the relevant light
     • Full keyboard operation: ↑/↓ between answers, Enter to select/submit,
       N for the next question
   ========================================================================== */

/**
 * @param {{bus: EventTarget, data: object}} ctx
 * @returns {Promise<{pending: boolean}>}
 */
export async function initQuiz(_ctx) {
  return { pending: true };
}
