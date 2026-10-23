import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scorer } from '../extension/src/scoring/scorer.js';
import { normalizeChart } from '../extension/src/core/chart.js';

// Tiny chart helper: notes [t, string, fret, flags?] on E standard.
function chart(notes) {
  return normalizeChart({
    format: 'bass-chart', version: 1,
    instrument: { strings: 4, tuning: [28, 33, 38, 43] },
    notes: notes.map(([t, string, fret, flags = {}], i) => ({ t, dur: 0.2, string, fret, bar: Math.floor(t / 2), flags })),
    bars: [0, 2, 4, 6, 8, 10].map((t, i) => ({ i, t, end: t + 2, measure: i, sig: [4, 4] })),
  });
}
const run = (c, events, opts, speed = 1) => {
  const sc = new Scorer(c, opts);
  const results = [];
  sc.on('result', (r) => results.push(r));
  for (const e of events) { sc.advance(e.t - 0.5, speed); sc.addEvent({ legato: false, ...e }, speed); }
  sc.advance(1e9, speed);
  return { sc, results };
};

test('hit on time, early and late; offsets in real ms', () => {
  const c = chart([[1, 0, 3], [2, 0, 5], [3, 1, 2]]);
  const { results, sc } = run(c, [{ t: 1.01, midi: 31 }, { t: 1.93, midi: 33 }, { t: 3.08, midi: 35.2 }]);
  assert.deepEqual(results.map((r) => [r.status, r.rating, r.offsetMs]), [['hit', 'ontime', 10], ['hit', 'early', -70], ['hit', 'late', 80]]);
  assert.equal(sc.passStats().accuracy, 1);
});

test('at half speed the window and ratings are in real time', () => {
  const c = chart([[1, 0, 3]]);
  // 40 ms song time late at 50% speed = 80 ms real time late.
  const { results } = run(c, [{ t: 1.04, midi: 31 }], {}, 0.5);
  assert.equal(results[0].offsetMs, 80);
  assert.equal(results[0].rating, 'late');
});

test('wrong note is a miss that reports what was played; nothing played is a plain miss', () => {
  const c = chart([[1, 0, 3], [2, 0, 5]]);
  const { results, sc } = run(c, [{ t: 1.0, midi: 32 }]);
  assert.equal(results[0].status, 'miss');
  assert.equal(results[0].playedName, 'G#1');
  assert.equal(results[0].expectedName, 'G1');
  assert.equal(results[0].wrongPitch, true);
  assert.equal(results[1].status, 'miss');
  assert.equal(results[1].played, null);
  assert.equal(sc.summary(c).wrongNotes[0].expected, 'G1');
});

test('octave error from the detector still counts, flagged', () => {
  const c = chart([[1, 0, 0]]);
  const { results } = run(c, [{ t: 1.0, midi: 40.1 }]);
  assert.equal(results[0].status, 'hit');
  assert.equal(results[0].octave, true);
});

test('dead notes: any attack counts (also without pitch); "ignore" skips them', () => {
  const c = chart([[1, 1, 5, { dead: true }], [2, 0, 3]]);
  let r = run(c, [{ t: 1.02, midi: null }, { t: 2.0, midi: 31 }]).results;
  assert.deepEqual(r.map((x) => x.status), ['hit', 'hit']);
  r = run(c, [{ t: 2.0, midi: 31 }], { deadNotes: 'ignore' }).results;
  assert.equal(r.length, 1);
});

test('ghost notes and legato slide targets are not scored', () => {
  const c = chart([[1, 0, 3, { ghost: true }], [2, 0, 5, { slide: { type: 'legato', toFret: 7 } }], [2.3, 0, 7, { slideTarget: true }]]);
  const { results } = run(c, [{ t: 2.0, midi: 33 }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'hit');
});

test('a note that keeps ringing does not hit the next note of the same pitch', () => {
  const c = chart([[1, 0, 3], [1.5, 0, 3]]);
  const { results } = run(c, [{ t: 1.0, midi: 31 }]); // only one attack
  assert.deepEqual(results.map((r) => r.status), ['hit', 'miss']);
});

test('hammer-on/pull-off notes accept a pitch change without attack', () => {
  const c = chart([[1, 0, 3], [1.25, 0, 5, { hopo: true }]]);
  const { results } = run(c, [{ t: 1.0, midi: 31 }, { t: 1.27, midi: 33, legato: true }]);
  assert.deepEqual(results.map((r) => [r.status, r.soft]), [['hit', false], ['hit', false]]);
});

test('soft pluck (right pitch, no attack detected) still counts; an attack wins if there is one', () => {
  const c = chart([[1, 0, 3], [2, 0, 7], [3, 0, 5]]);
  const { results } = run(c, [
    { t: 1.0, midi: 31 },
    { t: 2.02, midi: 35, legato: true },                 // soft pluck
    { t: 2.98, midi: 33, legato: true }, { t: 3.01, midi: 33 }, // pitch change + attack
  ]);
  assert.deepEqual(results.map((r) => [r.status, r.soft]), [['hit', false], ['hit', true], ['hit', false]]);
  assert.equal(results[2].offsetMs, 10);
});

test('wrong pitch without attack is not a hit', () => {
  const c = chart([[1, 0, 3]]);
  const { results } = run(c, [{ t: 1.0, midi: 36, legato: true }]);
  assert.equal(results[0].status, 'miss');
});

test('miss reasons: different note, right note too early/late, nothing heard', () => {
  const c = chart([[1, 0, 3], [2, 0, 5], [3, 0, 7]]);
  const { results, sc } = run(c, [{ t: 1.0, midi: 33 }, { t: 2.2, midi: 33 }]);
  assert.deepEqual(results.map((r) => r.reason), ['wrong-note', 'timing', 'not-heard']);
  assert.equal(results[1].offsetMs, 200);
  const st = sc.passStats();
  assert.deepEqual([st.wrongPitch, st.missTiming, st.missNotHeard], [1, 1, 1]);
});

test('an attack whose pitch is unclear does not count as a wrong note', () => {
  const c = chart([[1, 0, 3]]);
  const { results } = run(c, [{ t: 1.0, midi: null }]);
  assert.equal(results[0].reason, 'not-heard');
  assert.equal(results[0].wrongPitch, false);
});

test('fast passage: each attack is used once and windows shrink', () => {
  // 16ths at 150 bpm = 100 ms apart, same pitch.
  const notes = [0, 1, 2, 3].map((i) => [1 + i * 0.1, 0, 3]);
  const c = chart(notes);
  const { results } = run(c, [{ t: 1.0, midi: 31 }, { t: 1.11, midi: 31 }, { t: 1.29, midi: 31 }]);
  assert.deepEqual(results.map((r) => r.status), ['hit', 'hit', 'hit', 'miss']);
  // The 3rd attack (1.29) is outside note 3's shrunken 50 ms window, so it hits note 4.
  assert.equal(results[2].note.t, 1.3);
});

test('chords: only the lowest note is scored', () => {
  const c = chart([[1, 0, 5], [1, 1, 7]]);
  const { results } = run(c, [{ t: 1.0, midi: 33 }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'hit');
});

test('passes: a loop pass only scores its range and restarts cleanly', () => {
  const c = chart([[1, 0, 3], [3, 0, 5], [5, 0, 7]]);
  const sc = new Scorer(c);
  sc.beginPass(2.5, 4);
  sc.addEvent({ t: 3.0, midi: 33 });
  sc.advance(10);
  assert.deepEqual(sc.passStats().hits, 1);
  assert.equal(sc.passStats().judged, 1);
  sc.beginPass(2.5, 4);
  sc.advance(10);
  assert.equal(sc.passStats().misses, 1);
});

test('summary lists weak bars', () => {
  const c = chart([[1, 0, 3], [3, 0, 5], [3.5, 0, 5], [5, 0, 7]]);
  const { sc } = run(c, [{ t: 1, midi: 31 }, { t: 5, midi: 35 }]);
  const s = sc.summary(c);
  assert.equal(s.weakBars[0].number, 2);
  assert.equal(s.weakBars[0].misses, 2);
  assert.equal(Math.round(s.accuracy * 100), 50);
});
