// 0.13: phrases, phrase ladder, note detection advice, lessons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';
import { phrasesOf, phraseAt, nextPracticeRange, barsPerPhrase } from '../extension/src/core/phrases.js';
import { detectionAdvice, describeMiss, sensitivityOf } from '../extension/src/core/detection.js';

const load = (name) => songsterrToChart(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))).chart;

test('phrases: 1, 2 or 4 bars of roughly 4–10 s, covering every bar once', () => {
  assert.equal(barsPerPhrase(8, 2), 4);
  assert.equal(barsPerPhrase(8, 3), 2);
  assert.equal(barsPerPhrase(4, 6), 1);
  for (const name of ['21-guns-bass', 'enter-sandman-bass', 'love-thats-gone-bass']) {
    const chart = load(name);
    const ps = phrasesOf(chart);
    assert.ok(ps.length > 5, name);
    let bar = ps[0].firstBar;
    for (const p of ps) {
      assert.equal(p.firstBar, bar, `${name}: no gaps or overlaps`);
      bar = p.lastBar + 1;
      assert.ok(p.lastBar - p.firstBar + 1 <= 6, `${name}: ${p.name} is short`);
    }
    assert.equal(bar, chart.bars.length);
    assert.equal(phraseAt(chart, ps[3].t + 0.1), ps[3]);
  }
});

test('phrases: repeats point at the first phrase with the same notes', () => {
  const ps = phrasesOf(load('enter-sandman-bass'));
  const reps = ps.filter((p) => p.same !== null);
  assert.ok(reps.length > 3);
  for (const p of reps) assert.ok(p.same < p.index && ps[p.same].same === null);
});

test('phrase ladder: next phrase, then the whole section, then the next section', () => {
  const chart = load('enter-sandman-bass');
  const ps = phrasesOf(chart);
  const intro2 = ps.filter((p) => p.section === 'Intro 2');
  assert.ok(intro2.length >= 2);
  const last = intro2[intro2.length - 1];
  const fromLast = nextPracticeRange(chart, { start: last.t, end: last.end });
  assert.equal(fromLast.kind, 'section');
  assert.ok(Math.abs(fromLast.t - intro2[0].t) < 1e-6 && Math.abs(fromLast.end - last.end) < 1e-6);
  const after = nextPracticeRange(chart, { start: fromLast.t, end: fromLast.end });
  assert.ok(after.t >= last.end - 1e-6);
  const fromFirst = nextPracticeRange(chart, { start: intro2[0].t, end: intro2[0].end });
  assert.ok(fromFirst.t > intro2[0].t && fromFirst.t <= last.t);
  assert.equal(nextPracticeRange(chart, { start: 1.234, end: 3.21 }), null);
});

const res = (status, reason = null, extra = {}) => ({ status, reason, note: { midi: 40 }, expectedName: 'E2', playedName: 'F2', played: 41, offsetMs: 0, ...extra });

test('detection advice names the main kind of miss', () => {
  const hits = Array.from({ length: 10 }, () => res('hit'));
  assert.equal(detectionAdvice(hits), '');
  const notHeard = [...hits, ...Array.from({ length: 6 }, () => res('miss', 'not-heard'))];
  assert.match(detectionAdvice(notHeard), /higher sensitivity/);
  assert.match(detectionAdvice(notHeard, { sensitivity: 'max' }), /volume up/);
  const semitone = [...hits, ...Array.from({ length: 6 }, () => res('miss', 'wrong-note'))];
  assert.match(detectionAdvice(semitone), /tune up/);
  const late = [...hits, ...Array.from({ length: 6 }, () => res('miss', 'timing', { offsetMs: 180 }))];
  assert.match(detectionAdvice(late), /late/);
  assert.equal(describeMiss(res('miss', 'wrong-note')), 'E2: heard F2 instead (a semitone off)');
  assert.equal(describeMiss(res('miss', 'timing', { offsetMs: -170 })), 'E2: right note, but 170 ms early');
  assert.equal(describeMiss(res('miss', 'not-heard')), 'E2: nothing heard');
  assert.equal(sensitivityOf({ detectSensitivity: 'high' }).onsetDb, 4.5);
  assert.equal(sensitivityOf({}).onsetDb, 6);
});

import { LESSONS, lessonState, passesStep, recordStep, nextLesson, stepCount } from '../extension/src/core/lessons.js';
import { DRILLS, makeDrill, drillById } from '../extension/src/core/drills.js';
import { validateChart } from '../extension/src/core/chart.js';

test('lessons: every step uses a real drill; progress and pass rules', () => {
  for (const l of LESSONS) {
    assert.ok(l.steps.length >= 2 && l.intro && l.apply, l.id);
    for (const s of l.steps) {
      const d = drillById(s.drill);
      assert.ok(d && !d.trainer, `${l.id}: ${s.drill}`);
      const chart = makeDrill(s.drill, { ...d.defaults, bpm: s.bpm, bars: s.bars || d.defaults.bars });
      assert.equal(validateChart(chart).length, 0);
    }
  }
  const step = LESSONS[0].steps[0];
  assert.equal(passesStep(step, { accuracy: 0.9, speed: 1, judged: 40 }, 48), true);
  assert.equal(passesStep(step, { accuracy: 0.9, speed: 0.8, judged: 40 }, 48), false, 'needs full speed');
  assert.equal(passesStep(step, { accuracy: 0.8, speed: 1, judged: 40 }, 48), false, 'needs the target');
  assert.equal(passesStep(step, { accuracy: 1, speed: 1, judged: 10 }, 48), false, 'a stopped run does not count');
  let p = {};
  assert.equal(nextLesson(p), LESSONS[0]);
  p = recordStep(p, 'beat', 0, 0.9);
  p = recordStep(p, 'beat', 1, 0.7, false);
  let st = lessonState(LESSONS[0], p);
  assert.deepEqual([...st.passed], [0]);
  assert.equal(st.next, 1);
  assert.equal(st.best[1], 0.7);
  p = recordStep(p, 'beat', 1, 0.88);
  p = recordStep(p, 'beat', stepCount(LESSONS[0]) - 1);
  st = lessonState(LESSONS[0], p);
  assert.equal(st.done, true);
  assert.equal(nextLesson(p), LESSONS[1]);
});

test('new drills: hammer-ons are legato, muted groove has dead notes', () => {
  const hp = makeDrill('hammer-pull', { bpm: 70, bars: 4, position: 5 });
  assert.equal(hp.notes.filter((n) => n.flags.hopo).length, hp.notes.length / 2);
  const mg = makeDrill('muted-groove', { bpm: 80, bars: 4, position: 5 });
  assert.equal(mg.notes.filter((n) => n.flags.dead).length, mg.notes.length / 2);
  assert.ok(DRILLS.length >= 10);
});
