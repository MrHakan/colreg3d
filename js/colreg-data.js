/* ==========================================================================
   COLREG 3D — Rule database loader
   STATUS: loader + validation skeleton. The full dataset lands in STEP 4.

   Keeping fetch + validation here (rather than inline in main.js) means the
   quiz and the simulator consume one already-checked structure, and a
   malformed edit to the JSON fails loudly at boot instead of silently
   producing wrong questions.
   ========================================================================== */

const DATA_URL = './data/colreg-rules.json';

/*
  Names the data file is allowed to use. Kept in sync with js/lights.js by the
  validator below, which fails loudly rather than silently drawing a light on
  a made-up arc.
*/
const ARC_NAMES = new Set(['MASTHEAD', 'SIDELIGHT', 'STERNLIGHT', 'TOWING', 'ALL_ROUND']);
const CENTRE_NAMES = new Set([
  'MASTHEAD', 'SIDELIGHT_STBD', 'SIDELIGHT_PORT', 'STERNLIGHT', 'TOWING', 'ALL_ROUND'
]);
const COLOURS = new Set(['white', 'red', 'green', 'yellow', 'blue']);
const SHAPES = new Set(['ball', 'cone', 'diamond', 'cylinder']);

/**
 * Structural and referential check over the whole document.
 * A malformed edit here would otherwise surface as a wrong quiz answer, which
 * is the worst possible failure mode for a training aid — so it is caught at
 * boot instead.
 *
 * @param {any} doc
 * @returns {string[]} human-readable problems, empty when valid
 */
export function validate(doc) {
  const problems = [];

  if (!doc || typeof doc !== 'object') {
    problems.push('document is not an object');
    return problems;
  }
  if (typeof doc.schemaVersion !== 'number') problems.push('missing numeric "schemaVersion"');
  if (!Array.isArray(doc.entries)) {
    problems.push('missing "entries" array');
    return problems;
  }

  const seen = new Set();

  doc.entries.forEach((entry, i) => {
    const where = `entries[${i}] (${entry?.id ?? 'no id'})`;

    if (!entry.id) problems.push(`${where}: missing "id"`);
    else if (seen.has(entry.id)) problems.push(`${where}: duplicate id`);
    else seen.add(entry.id);

    if (!entry.name) problems.push(`${where}: missing "name"`);
    if (!entry.rule?.citation) problems.push(`${where}: missing "rule.citation"`);
    if (!entry.rule?.number) problems.push(`${where}: missing "rule.number"`);

    if (!Array.isArray(entry.lights)) {
      problems.push(`${where}: missing "lights" array`);
    } else if (entry.lights.length === 0) {
      problems.push(`${where}: has no lights`);
    } else {
      entry.lights.forEach((l, j) => {
        const lw = `${where}.lights[${j}] (${l?.id ?? 'no id'})`;
        if (!l.id) problems.push(`${lw}: missing "id"`);
        if (!COLOURS.has(l.colour)) problems.push(`${lw}: unknown colour "${l.colour}"`);
        if (typeof l.arc !== 'number' && !ARC_NAMES.has(l.arc)) {
          problems.push(`${lw}: unknown arc "${l.arc}"`);
        }
        if (l.arcCentre !== undefined &&
            typeof l.arcCentre !== 'number' && !CENTRE_NAMES.has(l.arcCentre)) {
          problems.push(`${lw}: unknown arcCentre "${l.arcCentre}"`);
        }
        if (!l.rule) problems.push(`${lw}: missing "rule" citation`);
      });
    }

    (entry.dayShapes || []).forEach((s, j) => {
      if (!SHAPES.has(s.shape)) {
        problems.push(`${where}.dayShapes[${j}]: unknown shape "${s.shape}"`);
      }
      if (!s.rule) problems.push(`${where}.dayShapes[${j}]: missing "rule" citation`);
    });

    // Cross-references used by the quiz to build plausible distractors.
    (entry.quizHints?.commonConfusions || []).forEach((ref) => {
      if (!doc.entries.some((e) => e.id === ref)) {
        problems.push(`${where}: quizHints.commonConfusions → unknown id "${ref}"`);
      }
    });
  });

  return problems;
}

/**
 * @returns {Promise<{pending: boolean, schemaVersion: number, entries: object[],
 *                    byRule: Map<string, object[]>, problems: string[]}>}
 */
export async function loadColregData() {
  let doc;

  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = await res.json();
  } catch (err) {
    console.error('[colreg-data] load failed', err);
    return { pending: true, schemaVersion: 0, entries: [], byRule: new Map(), problems: [String(err)] };
  }

  const problems = validate(doc);
  if (problems.length) console.warn('[colreg-data] validation:', problems);

  const byRule = new Map();
  for (const entry of doc.entries || []) {
    const key = String(entry.rule?.number ?? entry.rule ?? 'unknown');
    if (!byRule.has(key)) byRule.set(key, []);
    byRule.get(key).push(entry);
  }

  return {
    pending: (doc.entries || []).length === 0,
    schemaVersion: doc.schemaVersion ?? 0,
    entries: doc.entries || [],
    byRule,
    problems
  };
}
