/* ==========================================================================
   COLREG 3D — Rule database loader
   STATUS: loader + validation skeleton. The full dataset lands in STEP 4.

   Keeping fetch + validation here (rather than inline in main.js) means the
   quiz and the simulator consume one already-checked structure, and a
   malformed edit to the JSON fails loudly at boot instead of silently
   producing wrong questions.
   ========================================================================== */

const DATA_URL = './data/colreg-rules.json';

/**
 * Minimal structural check. STEP 4 extends this to validate every entry's
 * lights, arcs and rule citation.
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
  if (!Array.isArray(doc.entries)) problems.push('missing "entries" array');

  (doc.entries || []).forEach((entry, i) => {
    if (!entry.id) problems.push(`entries[${i}]: missing "id"`);
    if (!entry.rule) problems.push(`entries[${i}]: missing "rule" citation`);
    if (!Array.isArray(entry.lights)) problems.push(`entries[${i}]: missing "lights" array`);
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
