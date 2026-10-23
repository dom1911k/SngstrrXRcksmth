import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SongClock } from '../extension/src/core/clock.js';
import { normalizeChart } from '../extension/src/core/chart.js';
import { loadSettings, updateSettings } from '../extension/src/core/settings.js';

// Controllable time for the session (it uses performance.now()).
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
globalThis.requestAnimationFrame = () => 0;
const { ScoringSession } = await import('../extension/src/scoring/session.js');

class Emitter {
  constructor() { this.l = new Map(); }
  on(t, f) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t).add(f); return () => this.l.get(t).delete(f); }
  emit(t, d) { for (const f of this.l.get(t) || []) f(d); }
}

function setup({ latencyMs = 150, loop = null }) {
  const chart = normalizeChart({
    format: 'bass-chart', version: 1, instrument: { strings: 4, tuning: [28, 33, 38, 43] },
    notes: [2.0, 2.5, 3.0, 3.5, 3.95].map((t, i) => ({ t, dur: 0.2, string: 0, fret: 3 + i, bar: 1, flags: {} })),
    bars: [{ i: 0, t: 0, end: 2, measure: 0 }, { i: 1, t: 2, end: 4, measure: 1 }],
  });
  const engine = new Emitter();
  engine.running = true;
  engine.ctxToPerf = (t) => t * 1000;
  const adapter = new Emitter();
  adapter.clock = new SongClock();
  adapter.state = { ready: true, playing: true, shouldPlay: true, speed: 1, loop };
  adapter.getState = () => adapter.state;
  adapter.getTime = () => adapter.clock.now();
  return { chart, engine, adapter, latencyMs };
}

test('loop passes: notes played just before the loop restarts count for the right pass', async () => {
  await loadSettings();
  await updateSettings({ calibrationMs: 150, fineTuneMs: 0, scoring: true });
  const { chart, engine, adapter } = setup({ loop: { start: 2, end: 4 } });
  const session = new ScoringSession(engine, adapter);
  const summaries = [];
  session.on('summary', (s) => summaries.push(s));
  adapter.emit('chart', { chart, isBassLike: true });

  // Song position: starts at 1.5 s, loops 2..4, perfect playing (in pass 2 the
  // 3rd note is wrong). Events reach the session 150 ms (latency) + 80 ms later.
  const start = 1.5;
  const songAt = (perf) => {
    const t = start + perf / 1000;
    return t < 4 ? t : 2 + ((t - 4) % 2);
  };
  const pending = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const n of chart.notes) {
      const playPerf = (n.t - start + pass * 2) * 1000;
      const midi = pass === 1 && n.t === 3.0 ? n.midi + 2 : n.midi;
      pending.push({ at: playPerf + 150 + 80, ev: { t: (playPerf + 150) / 1000, midi, legato: false } });
    }
  }
  pending.sort((a, b) => a.at - b.at);
  for (fakeNow = 0; fakeNow < 7000; fakeNow += 16) {
    adapter.clock.update({ perf: fakeNow, time: songAt(fakeNow), playing: true, speed: 1 });
    while (pending.length && pending[0].at <= fakeNow) session.onEvent(pending.shift().ev);
    session.tick();
  }
  assert.ok(summaries.length >= 2, `${summaries.length} summaries`);
  assert.equal(summaries[0].kind, 'loop');
  assert.equal(summaries[0].hits, 5, JSON.stringify(summaries[0]));
  assert.equal(summaries[0].misses, 0);
  assert.equal(summaries[1].hits, 4);
  assert.equal(summaries[1].misses, 1);
  assert.equal(summaries[1].wrongNotes[0].played, 'B1');
  // Timing is exact: latency was compensated.
  assert.ok(Math.abs(summaries[0].avgOffsetMs) <= 2, `avg offset ${summaries[0].avgOffsetMs}`);
});

test('notes played while paused are ignored; no misses while paused', async () => {
  await loadSettings();
  await updateSettings({ calibrationMs: 150, fineTuneMs: 0, scoring: true });
  const { chart, engine, adapter } = setup({});
  const session = new ScoringSession(engine, adapter);
  const results = [];
  session.on('result', (r) => results.push(r));
  adapter.emit('chart', { chart, isBassLike: true });
  adapter.state.playing = false;
  for (fakeNow = 10000; fakeNow < 13000; fakeNow += 16) {
    adapter.clock.update({ perf: fakeNow, time: 2.2, playing: false, speed: 1 });
    if (fakeNow === 11008) session.onEvent({ t: 11.0, midi: 31, legato: false });
    session.tick();
  }
  assert.equal(results.length, 0);
});
