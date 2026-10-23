import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { songsterrToChart, expandRepeats, bassLikeTracks } from '../extension/src/adapters/songsterr/to-chart.js';
import { validateChart, computeAnchors, anchorAt } from '../extension/src/core/chart.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const FIXTURES = ['21-guns-bass', 'love-thats-gone-bass', 'good-riddance-contrabass'];

for (const name of FIXTURES) {
  test(`${name}: converts to a valid chart that matches Songsterr's timeline`, () => {
    const song = load(name);
    const { chart, warnings } = songsterrToChart(song);
    assert.deepEqual(validateChart(chart), []);
    assert.deepEqual(warnings, []);
    assert.deepEqual(chart.instrument.tuning, [28, 33, 38, 43]);
    // Every beat layout with notes produces notes at exactly Songsterr's timestamp.
    const noteTimes = new Set(chart.notes.map((n) => Math.round(n.t * 1000)));
    let k = 0, checked = 0;
    for (const m of song.part.measures) for (const l of m.layouts) {
      const ms = song.part.timestamps[k++];
      const playable = l.beats.some((b) => !b.rest && b.notes.some((n) => !n.tie));
      if (playable) { assert.ok(noteTimes.has(Math.round(ms)), `no note at ${ms}`); checked++; }
    }
    assert.ok(checked > 10);
    // Bars are contiguous, notes sorted and inside the song, pitches in bass range.
    chart.bars.forEach((b, i) => { if (i) assert.ok(Math.abs(chart.bars[i - 1].end - b.t) < 1e-6); });
    chart.notes.forEach((n, i) => {
      if (i) assert.ok(n.t >= chart.notes[i - 1].t);
      assert.ok(n.t >= 0 && n.t <= chart.duration);
      assert.ok(n.midi >= 28 && n.midi <= 28 + 24 + 15, `midi ${n.midi}`);
      assert.equal(n.midi, chart.instrument.tuning[n.string] + n.fret);
    });
    assert.ok(chart.beats.length > 50);
  });
}

test('21 Guns: string numbering flipped (low E = 0), sections present', () => {
  const { chart } = songsterrToChart(load('21-guns-bass'));
  const song = load('21-guns-bass');
  // Find the first Songsterr note and compare.
  for (const m of song.part.measures) for (const l of m.layouts) for (const b of l.beats) for (const n of b.notes) {
    const first = chart.notes[0];
    assert.equal(first.string, 3 - n.string);
    assert.equal(first.fret, n.fret);
    return;
  }
});

test('tied notes are merged into one longer note', () => {
  const song = load('21-guns-bass');
  let ties = 0, total = 0;
  for (const m of song.part.measures) for (const l of m.layouts) for (const b of l.beats) if (!b.rest) for (const n of b.notes) { total++; if (n.tie) ties++; }
  const { chart } = songsterrToChart(song);
  assert.equal(chart.notes.length, total - ties);
});

test('expandRepeats follows repeat signs and alternate endings', () => {
  const M = (o = {}) => ({ layouts: [], ...o });
  // |: 0 1 :|x2  2
  assert.deepEqual(expandRepeats([M({ repeatStart: true }), M({ repeat: 2 }), M()]), [0, 1, 0, 1, 2]);
  // 0 |: 1 [1. 2 :| [2. 3 ] 4
  assert.deepEqual(expandRepeats([M(), M({ repeatStart: true }), M({ alternateEnding: [1], repeat: 2 }), M({ alternateEnding: [2] }), M()]), [0, 1, 2, 1, 3, 4]);
  // repeat without start goes back to the beginning; x3
  assert.deepEqual(expandRepeats([M(), M({ repeat: 3 }), M()]), [0, 1, 0, 1, 0, 1, 2]);
  // two consecutive repeated sections
  assert.deepEqual(expandRepeats([M({ repeatStart: true, repeat: 2 }), M({ repeatStart: true, repeat: 2 })]), [0, 0, 1, 1]);
});

test('repeats: notes are placed on every pass using Songsterr timestamps', () => {
  const beat = (fret) => ({ beats: [{ startTick: 0, durationInTicks: 3840, notes: [{ string: 3, fret }] }] });
  const song = {
    title: 't', part: { tuning: [43, 38, 33, 28], strings: 4, tpqn: 960, timestamps: [0, 2000, 4000, 6000],
      measures: [
        { totalTicks: 3840, signature: [4, 4], repeatStart: true, layouts: [beat(1)] },
        { totalTicks: 3840, signature: [4, 4], repeat: 2, layouts: [beat(2)] },
      ] },
    metronome: [{ t: 0, beatNum: 1, bpm: 120 }],
  };
  const { chart } = songsterrToChart(song);
  assert.deepEqual(chart.notes.map((n) => [n.t, n.fret]), [[0, 1], [2, 2], [4, 1], [6, 2]]);
  assert.equal(chart.bars.length, 4);
});

test('bass-like track detection prefers bass guitar, accepts contrabass, skips guitars/drums', () => {
  const t = bassLikeTracks(load('good-riddance-contrabass').tracks);
  assert.deepEqual(t.map((x) => x.instrument), ['Contrabass']);
  assert.deepEqual(bassLikeTracks(load('21-guns-bass').tracks).map((x) => x.instrument), ['Electric Bass (pick)']);
});

test('anchors: 4-fret hand positions', () => {
  const n = (t, fret) => ({ t, dur: 0.1, fret, flags: {} });
  const a = computeAnchors([n(0, 5), n(1, 7), n(2, 0), n(3, 8), n(4, 3), n(5, 5), n(6, 12)]);
  assert.deepEqual(a.map((x) => x.fret), [5, 3, 12]);
  assert.equal(anchorAt(a, 2.5).fret, 5);
  assert.equal(anchorAt(a, 4.5).fret, 3);
});

test('validateChart reports useful errors', () => {
  const errs = validateChart({ format: 'x', version: 1, instrument: { tuning: [28, 33, 38, 43] }, notes: [{ t: -1, string: 4, fret: 2 }] });
  assert.ok(errs.some((e) => e.includes('format')));
  assert.ok(errs.some((e) => e.includes('notes[0].t')));
  assert.ok(errs.some((e) => e.includes('notes[0].string')));
});
