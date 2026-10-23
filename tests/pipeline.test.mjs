// Full scoring pipeline on synthesized playing: worklet (pitch + onsets) ->
// NoteEventDetector -> Scorer, using the real 21 Guns chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProcessor } from './worklet-harness.mjs';
import { renderPerformance } from './synth.mjs';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';
import { NoteEventDetector } from '../extension/src/scoring/detector.js';
import { Scorer } from '../extension/src/scoring/scorer.js';
import { detectorMinFreq } from '../extension/src/core/music.js';

const SR = 48000;
const chart = songsterrToChart(JSON.parse(readFileSync(new URL('./fixtures/21-guns-bass.json', import.meta.url)))).chart;

const render = (from, to, perform) => renderPerformance(chart, from, to, { sampleRate: SR, perform });

function score(audio, startOffset, from, to) {
  const proc = createProcessor({ sampleRate: SR, minFreq: detectorMinFreq(chart.instrument.tuning) });
  const events = [];
  const det = new NoteEventDetector((e) => events.push(e));
  proc.feed(audio);
  for (const m of proc.messages) {
    if (m.type === 'onset') det.onOnset(m);
    else if (m.type === 'frame') det.onFrame(m);
  }
  const sc = new Scorer(chart);
  sc.beginPass(from, to);
  for (const e of events) {
    const t = e.t + startOffset; // audio time -> song time (no latency here)
    sc.advance(t - 0.3);
    sc.addEvent({ ...e, t });
  }
  sc.advance(1e9);
  return { stats: sc.passStats(), summary: sc.summary(chart), results: sc.pass.results, events };
}

const FROM = 40, TO = 110; // intro riff, verse and chorus of 21 Guns

test('21 Guns, played correctly: nearly everything is a hit, on time', () => {
  const { audio, startOffset } = render(FROM, TO, () => ({}));
  const { stats } = score(audio, startOffset, FROM, TO);
  console.log('correct', stats);
  assert.ok(stats.judged > 100);
  assert.ok(stats.accuracy >= 0.97, `accuracy ${stats.accuracy}`);
  assert.ok(Math.abs(stats.avgOffsetMs) <= 15, `avg offset ${stats.avgOffsetMs} ms`);
  assert.ok(stats.ontime / stats.hits > 0.9, 'most hits on time');
});

test('21 Guns, played 70 ms late: still hits, rated late', () => {
  const { audio, startOffset } = render(FROM, TO, (n) => ({ t: n.t + 0.07 }));
  const { stats } = score(audio, startOffset, FROM, TO);
  console.log('late', stats);
  assert.ok(stats.accuracy >= 0.95);
  assert.ok(stats.late / stats.hits > 0.85);
  assert.ok(Math.abs(stats.avgOffsetMs - 70) <= 15);
});

test('21 Guns with mistakes: wrong notes and skipped notes are misses, wrong notes say what was played', () => {
  const { audio, startOffset, notes } = render(FROM, TO, (n, i) => {
    if (i % 17 === 5 && !n.flags.dead) return { midi: n.midi + 1 };   // a semitone off
    if (i % 23 === 11) return { skip: true };                          // forgot a note
    return {};
  });
  const wrong = notes.filter((n, i) => i % 17 === 5 && !n.flags.dead && !(i % 23 === 11)).length;
  const skipped = notes.filter((n, i) => i % 23 === 11).length;
  const { stats, results } = score(audio, startOffset, FROM, TO);
  console.log('mistakes', stats, { wrong, skipped });
  const wrongReported = results.filter((r) => r.status === 'miss' && r.wrongPitch && Math.abs(r.played - r.note.midi - 1) < 0.5).length;
  assert.ok(wrongReported >= wrong * 0.8, `${wrongReported} of ${wrong} wrong notes reported with the played pitch`);
  assert.ok(stats.misses >= (wrong + skipped) * 0.8 && stats.misses <= (wrong + skipped) * 1.3 + 3, `misses ${stats.misses} vs ${wrong + skipped}`);
});

test('21 Guns, notes ringing into each other (not muted): no false hits, still accurate', () => {
  const { audio, startOffset } = renderPerformance(chart, FROM, TO, { sampleRate: SR, perform: () => ({}) });
  // Add a long ringing copy of every note (as if never muted).
  const ring = renderPerformance({ notes: chart.notes.map((n) => ({ ...n, dur: n.dur + 0.6 })) }, FROM, TO, { sampleRate: SR });
  for (let i = 0; i < audio.length; i++) audio[i] = audio[i] * 0.6 + ring.audio[i] * 0.4;
  const { stats } = score(audio, startOffset, FROM, TO);
  console.log('ringing', stats);
  assert.ok(stats.accuracy >= 0.93, `accuracy ${stats.accuracy}`);
});

test('detector: weak low note whose pitch settles late is reported with the attack time', async () => {
  const { NoteEventDetector } = await import('../extension/src/scoring/detector.js');
  const events = [];
  const d = new NoteEventDetector((e) => events.push(e));
  d.onOnset({ t: 1.0 });
  // Unclear for 150 ms, then a stable E1.
  for (let t = 1.005; t < 1.15; t += 0.005) d.onFrame({ t, f0: 0, clarity: 0, rms: 0.01 });
  for (let t = 1.15; t < 1.3; t += 0.005) d.onFrame({ t, f0: 41.2, clarity: 0.95, rms: 0.05 });
  assert.equal(events.length, 2);
  assert.equal(events[0].midi, null);
  assert.equal(events[1].t, 1.0);
  assert.ok(Math.abs(events[1].midi - 28) < 0.1);
});
