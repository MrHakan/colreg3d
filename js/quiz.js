/* ==========================================================================
   COLREG 3D — Quiz engine  (STEP 5)
   --------------------------------------------------------------------------
   Three question modes, all generated from data/colreg-rules.json rather than
   from a fixed question bank, so adding a configuration to the data adds
   questions everywhere automatically.

     Mode A  Identify the aspect & vessel type
             Random bearing and range; name what she is from her lights.
     Mode B  Night to day matching
             Given the night display, pick the matching daytime shapes.
     Mode C  Rule reference search
             Given a scenario, name the applicable Rule.

   Distractors are drawn from each entry's quizHints.commonConfusions first —
   the configurations learners genuinely mix up — and only then padded at
   random. A quiz whose wrong answers are obviously wrong teaches nothing.

   Progress persists in localStorage, including per-rule miss counts so the
   Progress panel can flag weak areas.
   ========================================================================== */

const STORE_KEY = 'colreg3d:quiz';

const MODE_LABELS = {
  A: 'Mode A · Identify the aspect',
  B: 'Mode B · Night → day matching',
  C: 'Mode C · Rule reference'
};

/* Scoring: a correct answer is worth 100 × multiplier, where the multiplier
   climbs with the streak and is capped so a long run cannot dwarf everything
   that follows. */
const BASE_POINTS = 100;
const MAX_MULTIPLIER = 3;
const multiplierFor = (streak) => Math.min(MAX_MULTIPLIER, 1 + streak * 0.2);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Persistence ───────────────────────────────────────────────────────── */

const emptyProgress = () => ({
  best: 0, answered: 0, correct: 0, bestStreak: 0,
  perRule: {}          // { "27": { seen, missed } }
});

function loadProgress() {
  try {
    return { ...emptyProgress(), ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return emptyProgress();
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* quota or private mode — the session still works, it just won't persist */
  }
}

/* ── Day-shape phrasing, shared by modes B and the explanations ────────── */

function describeShapes(entry) {
  const shapes = entry.dayShapes || [];
  if (!shapes.length) return 'No day shapes required';

  return shapes.map((s) => {
    const n = s.count > 1 ? `${s.count} ` : 'a ';
    const plural = s.count > 1 ? 's' : '';
    const name = `${n}${s.shape}${plural}`;
    return s.arrangement ? `${name} (${s.arrangement})` : name;
  }).join(', ');
}

/* Most labels already name their colour ("All-round red (upper)"), so only
   prefix it when they don't — otherwise the prompt reads "red all-round red". */
function phraseLight(l) {
  const label = (l.label ?? l.id).toLowerCase();
  return label.includes(l.colour) ? label : `${l.colour} ${label}`;
}

function describeLights(entry) {
  return (entry.lights || []).map(phraseLight).join(', ');
}

/* ── Entry point ───────────────────────────────────────────────────────── */

/**
 * @param {{bus: EventTarget, data: object, scene: object, lights: object}} ctx
 */
export async function initQuiz(ctx) {
  const { bus, data, scene, lights } = ctx;

  const el = {
    question: $('#quiz-question'),
    answers: $('#quiz-answers'),
    feedback: $('#quiz-feedback'),
    index: $('#quiz-index'),
    modeLabel: $('#quiz-mode-label'),
    submit: $('#btn-quiz-submit'),
    next: $('#btn-quiz-next'),
    reset: $('#btn-reset-progress'),
    score: $('#quiz-score'),
    streak: $('#quiz-streak'),
    mult: $('#quiz-mult'),
    best: $('#quiz-best'),
    weak: $('#quiz-weak')
  };

  if (!el.answers || !data?.entries?.length) return { pending: true };

  const entries = data.entries;

  let progress = loadProgress();
  let mode = 'A';
  let score = 0;
  let streak = 0;
  let questionNo = 0;
  let current = null;      // the live question
  let selected = null;     // index of the chosen answer
  let answered = false;

  /* ── Question builders ─────────────────────────────────────────────── */

  /**
   * Chooses distractors: confusable configurations first, then random padding.
   * @returns {object[]} `count` entries, excluding `correct`
   */
  function distractorsFor(correct, count, pool = entries) {
    const out = [];
    const seen = new Set([correct.id]);

    for (const id of correct.quizHints?.commonConfusions ?? []) {
      if (out.length >= count) break;
      const e = pool.find((x) => x.id === id);
      if (e && !seen.has(e.id)) { out.push(e); seen.add(e.id); }
    }

    const rest = shuffle(pool.filter((e) => !seen.has(e.id)));
    while (out.length < count && rest.length) {
      const e = rest.pop();
      out.push(e); seen.add(e.id);
    }
    return out;
  }

  /** Mode A — identify her from a random aspect. */
  function buildModeA() {
    const correct = pick(entries);
    const bearing = rnd(360);
    const range = 70 + rnd(140);

    const options = shuffle([correct, ...distractorsFor(correct, 3)]);

    return {
      mode: 'A',
      entry: correct,
      bearing,
      range,
      prompt: 'You are viewing this vessel from the bearing shown on the aspect meter. ' +
              'What is she, and what is her status?',
      options: options.map((e) => ({ id: e.id, text: e.name, entry: e })),
      correctId: correct.id,
      explain: (chosen) => explainIdentity(correct, chosen, bearing),
      highlight: () => (correct.lights || []).map((l) => l.id)
    };
  }

  /** Mode B — night display in, daytime shapes out. */
  function buildModeB() {
    // Only ask about configurations whose day signal is distinctive.
    const withShapes = entries.filter((e) => (e.dayShapes || []).length);
    const correct = pick(withShapes.length ? withShapes : entries);

    const pool = distractorsFor(correct, 3);
    const texts = new Set([describeShapes(correct)]);
    const options = [{ id: correct.id, text: describeShapes(correct), entry: correct }];

    for (const e of pool) {
      const t = describeShapes(e);
      if (texts.has(t)) continue;        // never offer two identical answers
      texts.add(t);
      options.push({ id: e.id, text: t, entry: e });
    }

    // If confusables shared a day signal, pad from anywhere that differs.
    for (const e of shuffle(entries)) {
      if (options.length >= 4) break;
      const t = describeShapes(e);
      if (texts.has(t)) continue;
      texts.add(t);
      options.push({ id: e.id, text: t, entry: e });
    }

    return {
      mode: 'B',
      entry: correct,
      bearing: 20 + rnd(320),
      range: 80 + rnd(90),
      prompt: `She is showing: ${describeLights(correct)}. ` +
              'By day, what shapes would she exhibit?',
      options: shuffle(options),
      correctId: correct.id,
      explain: (chosen) => explainShapes(correct, chosen),
      highlight: () => []
    };
  }

  /** Mode C — scenario in, Rule number out. */
  function buildModeC() {
    const correct = pick(entries);

    const correctRule = correct.rule.citation;
    const texts = new Set([correctRule]);
    const options = [{ id: correct.id, text: correctRule, entry: correct }];

    for (const e of [...distractorsFor(correct, 6), ...shuffle(entries)]) {
      if (options.length >= 4) break;
      if (texts.has(e.rule.citation)) continue;
      texts.add(e.rule.citation);
      options.push({ id: e.id, text: e.rule.citation, entry: e });
    }

    return {
      mode: 'C',
      entry: correct,
      bearing: rnd(360),
      range: 80 + rnd(120),
      prompt: `At night you observe: ${describeLights(correct)}. ` +
              'Which Rule prescribes this display?',
      options: shuffle(options),
      correctId: correct.id,
      explain: (chosen) => explainRule(correct, chosen),
      highlight: () => (correct.lights || []).map((l) => l.id)
    };
  }

  const builders = { A: buildModeA, B: buildModeB, C: buildModeC };

  /* ── Explanations ──────────────────────────────────────────────────── */

  function sectorName(deg) {
    const b = ((deg % 360) + 360) % 360;
    if (b === 0) return 'right ahead';
    if (b === 180) return 'right astern';
    if (b < 90) return 'on her starboard bow';
    if (b < 180) return 'on her starboard quarter';
    if (b < 270) return 'on her port quarter';
    return 'on her port bow';
  }

  function explainIdentity(correct, chosen, bearing) {
    const lines = [
      `She is a <strong>${correct.name}</strong> — ${correct.rule.citation}.`,
      correct.summary ?? '',
      `You are ${sectorName(bearing)}, at a relative bearing of ` +
      `${String(Math.round(bearing)).padStart(3, '0')}°, which is why ` +
      `${visibleFromHere(correct, bearing)}.`
    ];
    if (chosen && chosen.id !== correct.id) {
      lines.push(`You chose <em>${chosen.text}</em>, which is ${chosen.entry.rule.citation}. ` +
                 `${correct.quizHints?.keySignature ?? ''}`);
    }
    return lines.filter(Boolean).join(' ');
  }

  function explainShapes(correct, chosen) {
    const lines = [
      `<strong>${describeShapes(correct)}</strong> — ${correct.rule.citation}.`,
      `Her night display (${describeLights(correct)}) identifies her as a ` +
      `${correct.name.toLowerCase()}.`
    ];
    if (chosen && chosen.id !== correct.id) {
      lines.push(`Those shapes belong to a ${chosen.entry.name.toLowerCase()} ` +
                 `(${chosen.entry.rule.citation}).`);
    }
    return lines.join(' ');
  }

  function explainRule(correct, chosen) {
    const lines = [
      `<strong>${correct.rule.citation}</strong> — ${correct.name}.`,
      correct.summary ?? ''
    ];
    if (chosen && chosen.id !== correct.id) {
      lines.push(`${chosen.text} covers a ${chosen.entry.name.toLowerCase()} instead.`);
    }
    if (correct.quizHints?.keySignature) {
      lines.push(`Remember: ${correct.quizHints.keySignature}`);
    }
    return lines.join(' ');
  }

  /** Names the lights actually inside their arcs from this bearing. */
  function visibleFromHere(entry, bearing) {
    const visible = (entry.lights || []).filter((l) => {
      const arc = typeof l.arc === 'number' ? l.arc : ARC_LOOKUP[l.arc] ?? 360;
      if (arc >= 360) return true;
      const centre = CENTRE_LOOKUP[l.arcCentre] ?? 0;
      let d = ((bearing - centre) % 360 + 360) % 360;
      if (d > 180) d -= 360;
      return Math.abs(d) <= arc / 2;
    });

    if (!visible.length) return 'none of her lights bear on you';
    return `you can see her ${visible.map(phraseLight).join(' and ')}`;
  }

  const ARC_LOOKUP = { MASTHEAD: 225, SIDELIGHT: 112.5, STERNLIGHT: 135, TOWING: 135, ALL_ROUND: 360 };
  const CENTRE_LOOKUP = {
    MASTHEAD: 0, SIDELIGHT_STBD: 56.25, SIDELIGHT_PORT: 303.75,
    STERNLIGHT: 180, TOWING: 180, ALL_ROUND: 0
  };

  /* ── Rendering ─────────────────────────────────────────────────────── */

  function renderScoreboard() {
    if (el.score) el.score.textContent = score.toLocaleString('en');
    if (el.streak) el.streak.textContent = streak;
    if (el.mult) el.mult.textContent = `×${multiplierFor(streak).toFixed(1)}`;
    if (el.best) el.best.textContent = progress.best.toLocaleString('en');
    renderWeakAreas();
  }

  function renderWeakAreas() {
    if (!el.weak) return;

    /* A rule counts as weak once it has been seen enough times for the ratio
       to mean anything and is still being missed more than a third of the
       time. Below that threshold one unlucky guess would flag it. */
    const weak = Object.entries(progress.perRule)
      .filter(([, v]) => v.seen >= 3 && v.missed / v.seen > 0.34)
      .sort((a, b) => (b[1].missed / b[1].seen) - (a[1].missed / a[1].seen));

    el.weak.replaceChildren();

    if (!weak.length) {
      const li = document.createElement('li');
      li.className = 'weak__empty';
      li.textContent = progress.answered
        ? 'No weak areas flagged — keep going.'
        : 'No data yet — answer some questions.';
      el.weak.append(li);
      return;
    }

    for (const [rule, v] of weak) {
      const li = document.createElement('li');
      li.className = 'weak__row';
      li.innerHTML =
        `<strong>Rule ${rule}</strong>` +
        `<span>missed ${v.missed} of ${v.seen}</span>` +
        `<span>${Math.round((v.missed / v.seen) * 100)}%</span>`;
      el.weak.append(li);
    }
  }

  function renderQuestion() {
    if (!current) return;

    if (el.index) el.index.textContent = String(questionNo);
    if (el.modeLabel) el.modeLabel.textContent = MODE_LABELS[current.mode];
    if (el.question) el.question.textContent = current.prompt;

    el.answers.replaceChildren();

    current.options.forEach((opt, i) => {
      const li = document.createElement('li');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.index = String(i);
      // Roving tabindex: the group is one tab stop, arrows move within it.
      btn.tabIndex = i === 0 ? 0 : -1;

      const key = document.createElement('span');
      key.className = 'answer__key';
      key.textContent = String.fromCharCode(65 + i);

      const text = document.createElement('span');
      text.textContent = opt.text;

      btn.append(key, text);
      btn.addEventListener('click', () => selectAnswer(i));
      li.append(btn);
      el.answers.append(li);
    });

    if (el.feedback) { el.feedback.hidden = true; el.feedback.replaceChildren(); }
    if (el.submit) el.submit.disabled = true;
    if (el.next) el.next.disabled = true;

    selected = null;
    answered = false;
  }

  function selectAnswer(i) {
    if (answered) return;
    selected = i;

    $$('#quiz-answers .answer').forEach((btn, j) => {
      btn.setAttribute('aria-checked', String(j === i));
      btn.tabIndex = j === i ? 0 : -1;
    });

    if (el.submit) el.submit.disabled = false;
  }

  function submit() {
    if (answered || selected === null || !current) return;
    answered = true;

    const chosen = current.options[selected];
    const isCorrect = chosen.id === current.correctId;
    const ruleNo = String(current.entry.rule.number);

    // Score and streak
    if (isCorrect) {
      score += Math.round(BASE_POINTS * multiplierFor(streak));
      streak += 1;
    } else {
      streak = 0;
    }

    // Persist
    progress.answered += 1;
    if (isCorrect) progress.correct += 1;
    progress.best = Math.max(progress.best, score);
    progress.bestStreak = Math.max(progress.bestStreak, streak);

    const rec = progress.perRule[ruleNo] ??= { seen: 0, missed: 0 };
    rec.seen += 1;
    if (!isCorrect) rec.missed += 1;
    saveProgress(progress);

    // Mark the options
    $$('#quiz-answers .answer').forEach((btn, j) => {
      const opt = current.options[j];
      btn.disabled = true;
      if (opt.id === current.correctId) btn.dataset.result = 'correct';
      else if (j === selected) btn.dataset.result = 'wrong';
    });

    // Feedback
    if (el.feedback) {
      el.feedback.hidden = false;
      el.feedback.dataset.result = isCorrect ? 'correct' : 'wrong';
      el.feedback.replaceChildren();

      const verdict = document.createElement('p');
      verdict.className = 'feedback__verdict';
      verdict.textContent = isCorrect
        ? `Correct  ·  +${Math.round(BASE_POINTS * multiplierFor(streak - 1))} points`
        : 'Not quite';
      el.feedback.append(verdict);

      const body = document.createElement('p');
      body.innerHTML = current.explain(chosen);
      el.feedback.append(body);

      const cite = document.createElement('span');
      cite.className = 'feedback__cite';
      cite.textContent = current.entry.rule.citation;
      el.feedback.append(cite);
    }

    // Point at the lights the explanation is about.
    lights?.setHighlight?.(current.highlight());

    if (el.submit) el.submit.disabled = true;
    if (el.next) { el.next.disabled = false; el.next.focus(); }

    renderScoreboard();
    bus?.dispatchEvent(new CustomEvent('quiz:answered', {
      detail: { correct: isCorrect, rule: ruleNo, entry: current.entry }
    }));
  }

  function nextQuestion() {
    questionNo += 1;
    current = builders[mode]();

    lights?.setHighlight?.([]);
    lights?.setConfiguration?.(current.entry);
    scene?.lookFromBearing?.(current.bearing, current.range, 66 + rnd(14));

    renderQuestion();

    // Move focus to the first answer so keyboard users land in the right place.
    el.answers.querySelector('.answer')?.focus();
  }

  function setMode(next) {
    if (!builders[next]) return;
    mode = next;
    $$('[data-quiz-mode]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.quizMode === next));
    });
    nextQuestion();
  }

  function resetProgress() {
    progress = emptyProgress();
    saveProgress(progress);
    score = 0;
    streak = 0;
    renderScoreboard();
  }

  /* ── Wiring ────────────────────────────────────────────────────────── */

  el.submit?.addEventListener('click', submit);
  el.next?.addEventListener('click', nextQuestion);
  el.reset?.addEventListener('click', resetProgress);

  $$('[data-quiz-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.quizMode));
  });

  /* Arrow keys move between answers; Enter selects, then submits. */
  el.answers.addEventListener('keydown', (ev) => {
    const buttons = $$('#quiz-answers .answer');
    const idx = buttons.indexOf(document.activeElement);
    if (idx < 0) return;

    let next = null;
    switch (ev.key) {
      case 'ArrowDown': case 'ArrowRight': next = (idx + 1) % buttons.length; break;
      case 'ArrowUp': case 'ArrowLeft': next = (idx - 1 + buttons.length) % buttons.length; break;
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      case ' ': case 'Enter':
        ev.preventDefault();
        if (selected === idx && !answered) submit(); else selectAnswer(idx);
        return;
      default: return;
    }

    ev.preventDefault();
    buttons[next].focus();
    if (!answered) selectAnswer(next);
  });

  /* N advances, but only while the quiz is the visible mode. */
  document.addEventListener('keydown', (ev) => {
    if (document.documentElement.dataset.mode !== 'quiz') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return;

    if ((ev.key === 'n' || ev.key === 'N') && !el.next?.disabled) {
      ev.preventDefault();
      nextQuestion();
    }
  });

  /* Entering quiz mode poses a question; leaving it clears the highlight so
     the Learn view is not left with a pulsing light. */
  bus?.addEventListener('mode:change', (e) => {
    if (e.detail.mode === 'quiz') {
      if (!current) nextQuestion(); else lights?.setConfiguration?.(current.entry);
    } else {
      lights?.setHighlight?.([]);
    }
  });

  renderScoreboard();
  if (document.documentElement.dataset.mode === 'quiz') nextQuestion();

  return {
    pending: false,
    get mode() { return mode; },
    get score() { return score; },
    get streak() { return streak; },
    get current() { return current; },
    setMode, next: nextQuestion, submit, selectAnswer, resetProgress,
    get progress() { return progress; }
  };
}
