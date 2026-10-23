import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CameraFollow, planCameraSegments, smoothDamp } from '../extension/src/core/camera-follow.js';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';

const chartOf = (name) => songsterrToChart(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))).chart;
const note = (t, fret) => ({ t, dur: 0.2, fret, string: 0, flags: {} });

// Run the camera over notes at 60 fps; returns movement stats and the worst
// case of a note being outside the framed frets when it is played.
function simulate(notes, duration) {
  const cam = new CameraFollow(planCameraSegments(notes));
  const dt = 1 / 60;
  let travel = 0, moves = 0, moving = false, worstOutside = 0, prevX = null, prevSpan = null;
  let ni = 0;
  for (let t = 0; t < duration; t += dt) {
    cam.update(t, 1, dt);
    if (prevX !== null) {
      const d = Math.abs(cam.x - prevX) + Math.abs(cam.span - prevSpan);
      travel += d;
      const now = d > 1e-3;
      if (now && !moving) moves++;
      moving = now;
    }
    prevX = cam.x; prevSpan = cam.span;
    while (ni < notes.length && notes[ni].t <= t) {
      const n = notes[ni++];
      if (n.fret > 0) worstOutside = Math.max(worstOutside, cam.lo - (n.fret - 1), n.fret - cam.hi);
    }
  }
  return { travel, moves, worstOutside, segments: cam.segments };
}

for (const name of ['21-guns-bass', 'love-thats-gone-bass', 'good-riddance-contrabass']) {
  test(`${name}: camera holds still for the whole song and every note is in frame`, () => {
    const chart = chartOf(name);
    const r = simulate(chart.notes, chart.duration);
    assert.equal(r.segments.length, 1);
    assert.equal(r.moves, 0, `camera moved ${r.moves} times`);
    assert.ok(r.worstOutside <= 0, `a note was ${r.worstOutside.toFixed(2)} frets outside the frame`);
    assert.ok(r.segments[0].span <= 9.5);
  });
}

test('21 Guns frame covers frets 1–8 and hides the rest of the neck', () => {
  const [seg] = planCameraSegments(chartOf('21-guns-bass').notes);
  assert.equal(seg.lo, 1);
  assert.equal(seg.hi, 8);
  assert.ok(seg.x + seg.span / 2 < 9.6);
});

test('moving up the neck: one smooth move, finished before the new passage starts', () => {
  const notes = [];
  for (let t = 0; t < 20; t += 0.5) notes.push(note(t, [1, 3, 5, 2][Math.floor(t * 2) % 4]));
  for (let t = 20; t < 40; t += 0.5) notes.push(note(t, [12, 14, 15, 12][Math.floor(t * 2) % 4]));
  const r = simulate(notes, 40);
  assert.equal(r.segments.length, 2);
  assert.equal(r.moves, 1);
  assert.ok(r.worstOutside <= 0, `note ${r.worstOutside} frets outside`);
});

test('a short excursion does not make the camera go back and forth', () => {
  const notes = [];
  for (let t = 0; t < 10; t += 0.5) notes.push(note(t, 1 + (Math.floor(t * 2) % 4)));
  notes.push(note(10, 9), note(10.5, 10));
  for (let t = 11; t < 20; t += 0.5) notes.push(note(t, 1 + (Math.floor(t * 2) % 4)));
  const r = simulate(notes, 20);
  assert.equal(r.segments.length, 1, JSON.stringify(r.segments.map((s) => [s.lo, s.hi])));
  assert.equal(r.moves, 0);
  assert.ok(r.worstOutside <= 0);
});

test('open strings and ghost notes never move the camera', () => {
  const notes = [note(0, 5), note(1, 0), note(2, 7), { ...note(3, 17), flags: { ghost: true } }, note(4, 6)];
  assert.equal(planCameraSegments(notes).length, 1);
});

test('seek snaps the camera instead of gliding across the neck', () => {
  const notes = [note(0, 2), note(5, 3), note(20, 14), note(25, 15)];
  const cam = new CameraFollow(planCameraSegments(notes));
  cam.update(1, 1, 1 / 60);
  cam.update(22, 1, 1 / 60);
  assert.ok(cam.lo <= 13 && cam.hi >= 15, `${cam.lo}..${cam.hi}`);
});

test('smoothDamp settles without overshoot', () => {
  const st = { v: 0 };
  let x = 0, max = 0;
  for (let i = 0; i < 300; i++) { x = smoothDamp(x, 10, st, 0.5, 1 / 60); max = Math.max(max, x); }
  assert.ok(Math.abs(x - 10) < 0.01);
  assert.ok(max <= 10.0001);
});
