#!/usr/bin/env node
/* ==========================================================================
   COLREG 3D — pre-deploy verification
   --------------------------------------------------------------------------
   Runs in CI before anything is published. Everything checked here is a
   failure mode that would otherwise reach a learner as a wrong answer or a
   broken offline install, so the deploy is blocked rather than warned about.

     1. Rule data passes the same referential validation the app runs at boot
     2. The Rule 21 arc self-test — the real one, imported from lights.js
     3. Encounter classification at the Rule 13/14/15 boundaries
     4. Every file sw.js precaches actually exists (a missing one makes
        addAll() reject, which breaks offline for every user)
     5. manifest.json parses and its icons are on disk

   Lives under .github/ so actions/upload-pages-artifact leaves it out of the
   published site.
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { validate } from '../../js/colreg-data.js';
import { runArcSelfTest, DEFAULT_CONFIG, visibilityAt, ARCS, ARC_CENTRES } from '../../js/lights.js';
import { classifyEncounter } from '../../js/simulator.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let failures = 0;

function check(label, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    ok = r === true;
    if (!ok && typeof r === 'string') detail = r;
  } catch (err) {
    detail = err.message;
  }
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

/* ── 1. Rule data ──────────────────────────────────────────────────────── */
console.log('\nRule database');

const doc = JSON.parse(read('data/colreg-rules.json'));

check('data/colreg-rules.json passes validation', () => {
  const problems = validate(doc);
  return problems.length === 0 || problems.slice(0, 5).join('; ');
});

check('covers Rules 23-31', () => {
  const rules = new Set(doc.entries.map((e) => String(e.rule.number)));
  const missing = ['23', '24', '25', '26', '27', '28', '29', '30', '31']
    .filter((r) => !rules.has(r));
  return missing.length === 0 || `missing Rule ${missing.join(', ')}`;
});

check('every entry has at least one light', () =>
  doc.entries.every((e) => e.lights?.length) ||
  doc.entries.filter((e) => !e.lights?.length).map((e) => e.id).join(', '));

/* ── 2. Arc geometry — the app's own self-test ─────────────────────────── */
console.log('\nRule 21 arcs');

const rows = runArcSelfTest(DEFAULT_CONFIG);
for (const row of rows) check(row.label, () => row.pass);

check('sidelights + sternlight tile 360° for every data entry', () => {
  // 112.5 + 112.5 + 135 = 360 exactly; no configuration may leave a gap.
  const side = { arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_STBD };
  const port = { arc: ARCS.SIDELIGHT, centre: ARC_CENTRES.SIDELIGHT_PORT };
  const stern = { arc: ARCS.STERNLIGHT, centre: ARC_CENTRES.STERNLIGHT };
  for (let b = 0; b < 360; b += 0.25) {
    const lit = visibilityAt(side, b) + visibilityAt(port, b) + visibilityAt(stern, b);
    if (lit < 0.999) return `gap at ${b}°`;
  }
  return true;
});

/* ── 3. Encounter classification ───────────────────────────────────────── */
console.log('\nRules 13-15 classification');

const enc = (o) => classifyEncounter({ range: 600, targetSpeed: 12, ...o });

check('head-on → Rule 14(a), both give way', () => {
  const r = enc({ relBearing: 0, targetHeading: 180 });
  return (r.rule === 'Rule 14(a)' && r.ownRole === 'giveway') || `${r.rule} / ${r.ownRole}`;
});

check('near-reciprocal → Rule 14(c) doubt clause', () => {
  const r = enc({ relBearing: 10, targetHeading: 171 });
  return (r.rule === 'Rule 14(c)' && r.doubt === true) || `${r.rule} / doubt=${r.doubt}`;
});

check('target on starboard bow → Rule 15, we give way', () => {
  const r = enc({ relBearing: 55, targetHeading: 300 });
  return (r.rule === 'Rule 15' && r.ownRole === 'giveway') || `${r.rule} / ${r.ownRole}`;
});

check('target on port bow → stand-on', () => {
  const r = enc({ relBearing: 305, targetHeading: 60 });
  return r.ownRole === 'standon' || `${r.rule} / ${r.ownRole}`;
});

check('coming up from astern of her → Rule 13(a), we give way', () => {
  const r = enc({ relBearing: 8, targetHeading: 5, targetSpeed: 6 });
  return (r.rule === 'Rule 13(a)' && r.ownRole === 'giveway') || `${r.rule} / ${r.ownRole}`;
});

check('faster vessel astern of us → Rule 13(a), we stand on', () => {
  const r = enc({ relBearing: 185, targetHeading: 2, targetSpeed: 18 });
  return (r.rule === 'Rule 13(a)' && r.ownRole === 'standon') || `${r.rule} / ${r.ownRole}`;
});

check('Rule 13 overrides at 22.5° abaft her beam, not before', () => {
  // Aspect on her = 180 − her heading, with us right ahead of ourselves.
  const inside = enc({ relBearing: 0, targetHeading: 67, targetSpeed: 6 });   // aspect 113
  const outside = enc({ relBearing: 0, targetHeading: 75, targetSpeed: 6 });  // aspect 105
  return (inside.rule === 'Rule 13(a)' && outside.rule.startsWith('Rule 15')) ||
         `${inside.rule} / ${outside.rule}`;
});

check('opening vessels → no risk, Rule 7', () => {
  const r = enc({ relBearing: 180, targetHeading: 180 });
  return r.rule === 'Rule 7' || r.rule;
});

/* ── 4. Offline shell integrity ────────────────────────────────────────── */
console.log('\nOffline install');

const sw = read('sw.js');
const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);

check('sw.js declares an APP_SHELL list', () => Boolean(shellMatch));

if (shellMatch) {
  const files = [...shellMatch[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((f) => f !== './');   // the directory index, served by index.html

  check(`all ${files.length + 1} precached files exist on disk`, () => {
    const missing = files.filter((f) => !existsSync(resolve(ROOT, f)));
    return missing.length === 0 || missing.join(', ');
  });

  check('every js/*.js module is precached', () => {
    const declared = new Set(files);
    const onDisk = ['main', 'scene', 'lights', 'colreg-data', 'quiz', 'simulator']
      .map((n) => `./js/${n}.js`);
    const missing = onDisk.filter((f) => !declared.has(f));
    return missing.length === 0 || `not in APP_SHELL: ${missing.join(', ')}`;
  });
}

check('index.html import map pins the same Three.js version as sw.js', () => {
  const html = read('index.html');
  const swVersion = sw.match(/const THREE_VERSION = '([^']+)'/)?.[1];
  const htmlVersions = [...html.matchAll(/three@([\d.]+)/g)].map((m) => m[1]);
  if (!swVersion) return 'no THREE_VERSION in sw.js';
  const mismatched = htmlVersions.filter((v) => v !== swVersion);
  return mismatched.length === 0 || `sw.js=${swVersion} html=${mismatched.join(',')}`;
});

/* ── 5. PWA manifest ───────────────────────────────────────────────────── */
console.log('\nPWA manifest');

const manifest = JSON.parse(read('manifest.json'));

check('manifest paths are relative (GitHub Pages project sites)', () =>
  (manifest.start_url.startsWith('./') && manifest.scope.startsWith('./')) ||
  `start_url=${manifest.start_url} scope=${manifest.scope}`);

check('all manifest icons exist', () => {
  const missing = manifest.icons
    .map((i) => i.src)
    .filter((src) => !existsSync(resolve(ROOT, src)));
  return missing.length === 0 || missing.join(', ');
});

check('a maskable icon is declared', () =>
  manifest.icons.some((i) => (i.purpose || '').includes('maskable')));

/* ── Result ────────────────────────────────────────────────────────────── */
console.log(
  failures
    ? `\n${failures} check(s) failed — not deploying.\n`
    : '\nAll checks passed.\n'
);
process.exit(failures ? 1 : 0);
