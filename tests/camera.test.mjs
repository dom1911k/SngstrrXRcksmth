import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CameraFollow, smoothDamp } from '../extension/src/core/camera-follow.js';
import { computeAnchors, anchorAt } from '../extension/src/core/chart.js';
import { songsterrToChart } from '../extension/src/adapters/songsterr/to-chart.js';

const chartOf = (name) => songsterrToChart(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))).chart;

// The 0.3.0 behaviour, for comparison.
function oldCamera(anchors, t, speed, dt, st) {
  let lo = Infinity, hi = -Infinity;
  for (const a of anchors) { if (a.until < t || a.t > t + 1.5 * speed) continue; lo = Math.min(lo, a.fret - 1); hi = Math.max(hi, a.fret + 3); }
  if (!Number.isFinite(lo)) { const a = anchorAt(anchors, t); lo = a ? a.fret - 1 : 0; hi = lo + 4; }
  const f = Math.min(1, dt * 2.5);
  st.x += ((lo + hi) / 2 - st.x) * f;
  st.span += (Math.max(6, hi - lo + 2) - st.span) * f;
  return st;
}

function stats(series, dt) {
  let maxRate = 0, reversals = 0, lastDir = 0, travel = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    maxRate = Math.max(maxRate, Math.abs(d) / dt);
    travel += Math.abs(d);
    const dir = Math.abs(d) < 1e-4 ? 0 : Math.sign(d);
    if (dir && lastDir && dir !== lastDir) reversals++;
    if (dir) lastDir = dir;
  }
  return { maxRate, reversals, travel };
}

for (const name of ['21-guns-bass', 'love-thats-gone-bass']) {
  test(`${name}: camera zooms calmly (fewer, slower zoom changes than 0.3.0)`, () => {
    const chart = chartOf(name);
    const anchors = computeAnchors(chart.notes);
    const dt = 1 / 60;
    const cam = new CameraFollow();
    const old = { x: 4, span: 8 };
    const spans = [], oldSpans = [], xs = [];
    for (let t = 0; t < chart.duration; t += dt) {
      cam.update(anchors, t, 1, dt);
      oldCamera(anchors, t, 1, dt, old);
      spans.push(cam.span); oldSpans.push(old.span); xs.push(cam.x);
    }
    const n = stats(spans, dt), o = stats(oldSpans, dt), p = stats(xs, dt);
    const minutes = chart.duration / 60;
    console.log(name, { new: n, old: o, pan: p, minutes: +minutes.toFixed(1) });
    assert.ok(n.reversals <= o.reversals / 2, `zoom reversals ${n.reversals} vs old ${o.reversals}`);
    assert.ok(n.maxRate < o.maxRate, `max zoom rate ${n.maxRate} vs old ${o.maxRate}`);
    assert.ok(n.maxRate < 6, `zoom faster than 6 frets/s: ${n.maxRate}`);
    assert.ok(n.reversals / minutes < 6, `${(n.reversals / minutes).toFixed(1)} zoom direction changes per minute`);
  });
}

test('every upcoming hand position is in view when its notes arrive', () => {
  const chart = chartOf('21-guns-bass');
  const anchors = computeAnchors(chart.notes);
  const cam = new CameraFollow();
  const dt = 1 / 60;
  let worst = 0;
  let ai = 0;
  for (let t = 0; t < chart.duration; t += dt) {
    cam.update(anchors, t, 1, dt);
    while (ai < anchors.length && anchors[ai].t < t) ai++;
    const a = anchors[ai - 1];
    if (!a || t - a.t > 0.05) continue;
    // Visible fret range ~ x ± span/2; how far is the hand lane outside it?
    const lo = cam.x - cam.span / 2, hi = cam.x + cam.span / 2;
    worst = Math.max(worst, lo - (a.fret - 1), (a.fret + 3) - hi);
  }
  assert.ok(worst < 1.0, `hand lane up to ${worst.toFixed(2)} frets outside the view`);
});

test('seek snaps the camera instead of gliding across the neck', () => {
  const anchors = [{ t: 0, until: 10, fret: 1 }, { t: 10, until: Infinity, fret: 12 }];
  const cam = new CameraFollow();
  cam.update(anchors, 1, 1, 1 / 60);
  cam.update(anchors, 20, 1, 1 / 60);
  assert.ok(Math.abs(cam.x - 13) < 0.01);
});

test('smoothDamp settles without overshoot', () => {
  const st = { v: 0 };
  let x = 0, max = 0;
  for (let i = 0; i < 300; i++) { x = smoothDamp(x, 10, st, 0.5, 1 / 60); max = Math.max(max, x); }
  assert.ok(Math.abs(x - 10) < 0.01);
  assert.ok(max <= 10.0001);
});
