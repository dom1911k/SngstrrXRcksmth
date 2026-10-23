import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseCalibration } from '../extension/src/audio/calibration.js';
import { TunerModel } from '../extension/src/core/tuner.js';
import { midiToFreq } from '../extension/src/core/music.js';

test('calibration: recovers offset, ignores outliers and missed clicks', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => 10 + i * 0.6667);
  const jitter = [3, -4, 2, 0, -2, 5, -1, 1, -3, 4, 0, -5, 2, 1, -2, 0];
  const onsets = clicks.map((c, i) => c + 0.112 + jitter[i] / 1000);
  onsets.splice(3, 1);                 // a missed note
  onsets[6] += 0.09;                   // a sloppy one
  onsets.push(clicks[10] + 0.3);       // stray extra pluck (after the matched one)
  onsets.sort((a, b) => a - b);
  const r = analyseCalibration(clicks, onsets);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.offsetMs - 112) <= 2, `offset ${r.offsetMs}`);
  assert.ok(r.spreadMs <= 4, `spread ${r.spreadMs}`);
  assert.equal(r.matched, 15);
});

test('calibration: fails clearly with too few notes', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => i * 0.6667);
  const r = analyseCalibration(clicks, [0.1, 0.77, 1.43]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Only 3 of 16/);
});

const frames = (freq, from, n) => Array.from({ length: n }, (_, i) => ({ t: from + i * 0.0053, f0: freq, clarity: 0.97, rms: 0.05 }));

test('tuner: reading and string match', () => {
  const t = new TunerModel({ tuning: [28, 33, 38, 43] });
  let r;
  for (const f of frames(midiToFreq(33) * Math.pow(2, 4 / 1200), 0, 30)) r = t.push(f);
  assert.equal(r.note, 'A1');
  assert.equal(r.string, 1);
  assert.ok(Math.abs(r.stringCents - 4) < 0.01);
  assert.equal(t.mismatch().length, 0);
});

test('tuner: warns about a string tuned a half step down', () => {
  const t = new TunerModel({ tuning: [28, 33, 38, 43] });
  for (const f of frames(midiToFreq(27), 0, 200)) t.push(f);
  const w = t.mismatch();
  assert.equal(w.length, 1);
  assert.match(w[0].text, /E1 string is 100 cents flat \(about a half step down\)/);
});

test('tuner: drops reading after the note dies', () => {
  const t = new TunerModel({ tuning: [28, 33, 38, 43] });
  for (const f of frames(midiToFreq(28), 0, 20)) t.push(f);
  assert.ok(t.reading);
  t.push({ t: 3, f0: 0, clarity: 0, rms: 0 });
  assert.equal(t.reading, null);
});
