// V2 practice tools: riff repeater, wait mode, practice history, takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SongClock } from '../extension/src/core/clock.js';
import { normalizeChart } from '../extension/src/core/chart.js';
import { loadSettings, updateSettings } from '../extension/src/core/settings.js';

let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
globalThis.requestAnimationFrame = () => 0;
const { ScoringSession } = await import('../extension/src/scoring/session.js');
const { nextRiffSpeed, RiffRepeater, sectionAt } = await import('../extension/src/core/riff-repeater.js');
const { WaitMode } = await import('../extension/src/core/wait-mode.js');
const { aggregate, sectionsOf, HistoryRecorder, memoryHistory, recordFromSummary, songKeyOf } = await import('../extension/src/core/history.js');
const { takeOffsetFor, takeSongTime, sliceChunks, encodeWav } = await import('../extension/src/core/takes.js');

class Emitter {
  constructor() { this.l = new Map(); }
  on(t, f) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t).add(f); return () => this.l.get(t).delete(f); }
  emit(t, d) { for (const f of this.l.get(t) || []) f(d); }
}

function makeChart() {
  // 8 bars of 2 s, two sections; one note per beat-ish.
  const bars = Array.from({ length: 8 }, (_, i) => ({ i, t: i * 2, end: i * 2 + 2, measure: i, section: i < 4 ? 'Verse' : 'Chorus' }));
  const notes = [];
  for (let i = 0; i < 8; i++) for (const k of [0, 1]) notes.push({ t: i * 2 + k, dur: 0.3, string: 1, fret: 2 + k, bar: i, flags: {} });
  return normalizeChart({
    format: 'bass-chart', version: 1,
    meta: { title: 'Test Song', artist: 'Band', source: { type: 'songsterr', songId: 7, partId: 2 } },
    instrument: { strings: 4, tuning: [28, 33, 38, 43] },
    bars, notes, sections: [{ name: 'Verse', t: 0 }, { name: 'Chorus', t: 8 }],
  });
}

function fakeAdapter(chart) {
  const a = new Emitter();
  a.clock = new SongClock();
  a.state = { ready: true, playing: true, shouldPlay: true, speed: 1, loop: null };
  a.calls = [];
  a.getState = () => a.state;
  a.getTime = () => a.clock.now();
  a.getChart = () => chart;
  a.setSpeed = (pct) => { a.calls.push(['speed', pct]); a.state.speed = pct / 100; };
  a.setLoop = (s, e) => { a.calls.push(['loop', s, e]); a.state.loop = { start: s, end: e }; };
  a.seek = (t) => { a.calls.push(['seek', t]); a.pos = t; };
  a.pause = () => { a.calls.push(['pause']); a.state.shouldPlay = false; a.state.playing = false; };
  a.play = () => { a.calls.push(['play']); a.state.shouldPlay = true; a.state.playing = true; };
  a.suppressCountIn = (on) => a.calls.push(['countIn', !on]);
  return a;
}

test('riff repeater: speed decision', () => {
  assert.deepEqual(nextRiffSpeed({ accuracy: 0.92, speedPct: 70 }), { speed: 75, action: 'up' });
  assert.deepEqual(nextRiffSpeed({ accuracy: 0.89, speedPct: 70 }), { speed: 70, action: 'stay' });
  assert.deepEqual(nextRiffSpeed({ accuracy: 0.9, speedPct: 98, step: 5 }), { speed: 100, action: 'up' });
  assert.deepEqual(nextRiffSpeed({ accuracy: 1, speedPct: 100 }), { speed: 100, action: 'mastered' });
  assert.deepEqual(nextRiffSpeed({ accuracy: null, speedPct: 70 }), { speed: 70, action: 'stay' });
});

test('riff repeater: starts at the start speed and speeds up after good full passes', async () => {
  await loadSettings();
  await updateSettings({ riffRepeater: false, rrStartSpeed: 70, rrStep: 5, rrTarget: 90, rrMaxSpeed: 100 });
  const chart = makeChart();
  const adapter = fakeAdapter(chart);
  const session = new Emitter();
  const notes = [];
  const rr = new RiffRepeater(adapter, session, { notify: (t) => notes.push(t) });
  adapter.setLoop(8, 16);
  await updateSettings({ riffRepeater: true });
  assert.deepEqual(adapter.calls.at(-1), ['speed', 70]);
  session.emit('summary', { kind: 'loop', accuracy: 0.95, from: 8 });
  assert.deepEqual(adapter.calls.at(-1), ['speed', 75]);
  session.emit('summary', { kind: 'loop', accuracy: 0.7, from: 8 });
  assert.deepEqual(adapter.calls.at(-1), ['speed', 75]);
  // A pass that started in the middle of the loop doesn't count.
  session.emit('summary', { kind: 'loop', accuracy: 1, from: 11 });
  assert.deepEqual(adapter.calls.at(-1), ['speed', 75]);
  assert.match(notes.at(-1), /90% needed/);
  // A new loop restarts at the start speed.
  adapter.setLoop(0, 8);
  adapter.emit('loop', adapter.state);
  assert.deepEqual(adapter.calls.at(-1), ['speed', 70]);
  assert.equal(sectionAt(chart, 9).name, 'Chorus');
  await updateSettings({ riffRepeater: false });
  void rr;
});

test('history: sections, weak bars and per-song keys', async () => {
  const chart = makeChart();
  assert.equal(songKeyOf(chart), 'songsterr:7:2');
  const secs = sectionsOf(chart);
  assert.deepEqual(secs.map((s) => [s.name, s.firstBar, s.lastBar]), [['Verse', 0, 3], ['Chorus', 4, 7]]);
  const store = memoryHistory();
  const session = new Emitter();
  session.chart = chart;
  const rec = new HistoryRecorder(session, { store: Promise.resolve(store) });
  // Bar 5 is always missed, everything else hit.
  for (let k = 0; k < 3; k++) {
    const perBar = Array.from({ length: 8 }, (_, bar) => (bar === 5 ? { bar, hits: 0, misses: 2 } : { bar, hits: 2, misses: 0 }));
    await rec.save({ kind: 'song', speed: 1, at: 1000 + k, accuracy: 14 / 16, judged: 16, hits: 14, perBar, from: 0, to: Infinity });
  }
  // Too short to save.
  assert.equal(recordFromSummary({ kind: 'loop', judged: 2, hits: 2 }, chart), null);
  const { records, stats } = await rec.load();
  assert.equal(records.length, 3);
  assert.equal(stats.fullPlays, 3);
  assert.equal(stats.weakBars[0].bar, 5);
  assert.equal(stats.weakBars[0].number, 6);
  assert.equal(stats.weakBars[0].missRate, 1);
  assert.equal(stats.sections[0].accuracy, 1);
  assert.equal(stats.sections[1].accuracy, 0.75);
  // An edited tab (different bar count) doesn't mix bar statistics.
  const other = aggregate(records, { ...chart, bars: chart.bars.slice(0, 6) });
  assert.equal(other.weakBars.length, 0);
  assert.equal(await rec.clear(), 3);
});

test('session: scores only while the input is on, and reports played notes', async () => {
  await loadSettings();
  await updateSettings({ calibrationMs: 0, fineTuneMs: 0, autoTiming: false, scoring: true });
  const chart = makeChart();
  const adapter = fakeAdapter(chart);
  const engine = new Emitter();
  engine.running = false;
  engine.ctxToPerf = (t) => t * 1000;
  const session = new ScoringSession(engine, adapter);
  const results = [], played = [];
  session.on('result', (r) => results.push(r));
  session.on('played', (p) => played.push(p));
  adapter.emit('chart', { chart, isBassLike: true });
  for (fakeNow = 0; fakeNow < 5000; fakeNow += 16) {
    adapter.clock.update({ perf: fakeNow, time: fakeNow / 1000, playing: true, speed: 1 });
    session.tick();
  }
  assert.equal(results.length, 0, 'nothing judged with the input off');
  engine.running = true;
  for (; fakeNow < 9000; fakeNow += 16) {
    adapter.clock.update({ perf: fakeNow, time: fakeNow / 1000, playing: true, speed: 1 });
    if (fakeNow === 6000) session.onEvent({ t: 6.0, midi: chart.notes[6].midi, legato: false });
    session.tick();
  }
  assert.equal(played.length, 1);
  assert.ok(Math.abs(played[0].songTime - 6) < 0.01);
  // Notes from 5 s on are judged; the one at 6 s is a hit; nothing before 5 s.
  assert.ok(results.length >= 3);
  assert.ok(results.every((r) => r.note.t >= 5));
  assert.equal(results.find((r) => r.note.t === 6).status, 'hit');
  // Suspended (wait mode / take playback): no judging.
  session.suspend('wait', true);
  const n = results.length;
  for (; fakeNow < 12000; fakeNow += 16) {
    adapter.clock.update({ perf: fakeNow, time: fakeNow / 1000, playing: true, speed: 1 });
    session.tick();
  }
  assert.equal(results.length, n);
});

test('wait mode: stops at each note and continues on the right pitch', async () => {
  await loadSettings();
  await updateSettings({ visualDelayMs: 60, calibrationMs: 0, fineTuneMs: 0, scoring: true });
  const chart = makeChart();
  const adapter = fakeAdapter(chart);
  const session = new Emitter();
  session.suspend = (r, on) => { session.suspended = on; };
  const wm = new WaitMode(adapter, session, { autoTick: false, now: () => fakeNow });
  let pos = 0.5;
  fakeNow = 100000;
  adapter.clock.update({ perf: fakeNow, time: pos, playing: true, speed: 1 });
  wm.setEnabled(true);
  assert.equal(session.suspended, true);
  assert.deepEqual(adapter.calls.at(-1), ['countIn', false]);
  // Play until the stop at the note at 1.0 s (shown on the strings at 1.06).
  while (adapter.state.playing && pos < 3) {
    fakeNow += 16; pos += 0.016;
    adapter.clock.update({ perf: fakeNow, time: pos, playing: adapter.state.playing, speed: 1 });
    wm.tick();
  }
  assert.equal(wm.state, 'waiting');
  assert.equal(wm.target.t, 1);
  assert.ok(pos >= 1.02 && pos < 1.07, `paused at ${pos}`);
  assert.deepEqual(adapter.calls.slice(-2), [['pause'], ['seek', 1.06]]);
  assert.match(wm.message, /Play C2 · fret 3 on the A string/);
  // Wrong note: keeps waiting.
  session.emit('played', { perf: fakeNow + 100, midi: 40, legato: false });
  assert.equal(wm.state, 'waiting');
  assert.match(wm.message, /you played E2/);
  // Right note: plays on.
  session.emit('played', { perf: fakeNow + 200, midi: 36.1, legato: false });
  assert.equal(wm.state, 'run');
  assert.deepEqual(adapter.calls.at(-1), ['play']);
  // The next stop is the note at 2.0 s.
  pos = 1.06;
  for (let i = 0; i < 100 && adapter.state.playing; i++) {
    fakeNow += 16; pos += 0.016;
    adapter.clock.update({ perf: fakeNow, time: pos, playing: adapter.state.playing, speed: 1 });
    wm.tick();
  }
  assert.equal(wm.target.t, 2);
  wm.setEnabled(false);
  assert.equal(session.suspended, false);
  assert.equal(wm.stats.notes, 1);
  assert.equal(wm.stats.firstTry, 0);
});

test('takes: song-time mapping, slicing and WAV', () => {
  const take = { sRef: 10.2, cRef: 5.0, ctxStart: 3.0, speed: 0.8 };
  // ctx 5.0 (x = 2) is song time 10.2; 1 real second = 0.8 song seconds.
  assert.ok(Math.abs(takeSongTime(take, 2) - 10.2) < 1e-9);
  assert.ok(Math.abs(takeSongTime(take, 3) - 11.0) < 1e-9);
  assert.ok(Math.abs(takeOffsetFor(take, 11.0) - 3) < 1e-9);
  const sr = 1000;
  const chunks = [{ t: 0.0, data: Float32Array.from({ length: 100 }, (_, i) => i) }, { t: 0.1, data: Float32Array.from({ length: 100 }, (_, i) => 100 + i) }];
  const s = sliceChunks(chunks, 0.05, 0.15, sr);
  assert.equal(s.length, 100);
  assert.equal(s[0], 50);
  assert.equal(s[99], 149);
  const wav = encodeWav(new Float32Array([0, 0.5, -1]), 48000);
  assert.equal(wav.size, 44 + 6);
});

test('input check: plain-language warnings from repeated misses', async () => {
  const { diagnose } = await import('../extension/src/core/input-monitor.js');
  const note = { midi: 40, flags: {} };
  const many = (r, n = 6) => Array.from({ length: n }, () => ({ status: 'miss', note, offsetMs: null, played: null, ...r }));
  assert.equal(diagnose(many({ reason: 'not-heard' }, 5)), '');
  assert.match(diagnose(many({ reason: 'not-heard' }), { sinceOnsetMs: 10000 }), /No sound from your bass/);
  assert.match(diagnose(many({ reason: 'not-heard' }), { sinceOnsetMs: 500 }), /not recognised/);
  assert.match(diagnose(many({ reason: 'timing', offsetMs: 180 })), /180 ms late/);
  assert.match(diagnose(many({ reason: 'wrong-note', played: 39 })), /1 semitone lower/);
  assert.equal(diagnose(many({ reason: 'wrong-note', played: 47 })), '');
});

test('timing correction is remembered per sound source', async () => {
  const { sourceKeyOf } = await import('../extension/src/scoring/session.js');
  assert.equal(sourceKeyOf({ videoOpened: true }), 'songsterr-orig');
  assert.equal(sourceKeyOf({ videoOpened: false, playerType: 'synth' }), 'songsterr-synth');
  assert.equal(sourceKeyOf({ playerType: 'audio file' }), 'player-audio file');
  await loadSettings();
  await updateSettings({ autoTimingMs: 30, autoTimingBySource: { 'songsterr-orig': -20 } });
  const chart = makeChart();
  const adapter = fakeAdapter(chart);
  adapter.state.videoOpened = false;
  const engine = new Emitter();
  engine.running = true;
  engine.ctxToPerf = (t) => t * 1000;
  const session = new ScoringSession(engine, adapter);
  adapter.emit('chart', { chart, isBassLike: true });
  fakeNow = 50000;
  session.tick();
  const { getSettings } = await import('../extension/src/core/settings.js');
  assert.equal(getSettings().autoTimingMs, 30);                 // unknown source keeps the value
  adapter.state.videoOpened = true;                             // switch to ORIG
  fakeNow += 1500; session.tick();
  assert.equal(getSettings().autoTimingMs, -20);
  assert.equal(getSettings().autoTimingBySource['songsterr-synth'], 30);
  adapter.state.videoOpened = false;                            // and back
  fakeNow += 1500; session.tick();
  assert.equal(getSettings().autoTimingMs, 30);
});

test('riff repeater: phrase by phrase moves on when a loop is mastered', async () => {
  await loadSettings();
  await updateSettings({ riffRepeater: false, rrStartSpeed: 90, rrStep: 10, rrTarget: 90, rrMaxSpeed: 100, rrAdvance: true });
  // 16 bars of 2 s: Verse = the same 4 bars twice, Chorus = 8 different bars.
  const bars = Array.from({ length: 16 }, (_, i) => ({ i, t: i * 2, end: i * 2 + 2, measure: i }));
  const notes = bars.map((b) => ({ t: b.t, dur: 0.5, string: 1, fret: b.i < 8 ? 2 + (b.i % 4) : b.i, bar: b.i, flags: {} }));
  const chart = normalizeChart({ format: 'bass-chart', version: 1, meta: { title: 'Ladder' }, instrument: { strings: 4, tuning: [28, 33, 38, 43] },
    bars, notes, sections: [{ name: 'Verse', t: 0 }, { name: 'Chorus', t: 16 }] });
  const adapter = fakeAdapter(chart);
  const session = new Emitter();
  const rr = new RiffRepeater(adapter, session, { notify: () => {} });
  const master = () => {
    const loop = adapter.state.loop;
    adapter.state.speed = 1;
    session.emit('summary', { kind: 'loop', accuracy: 1, from: loop.start });
    return adapter.state.loop;
  };
  adapter.setLoop(0, 8);                         // Verse · 1/2
  await updateSettings({ riffRepeater: true });
  // Verse · 2/2 repeats 1/2 -> straight to the whole Verse, then Chorus · 1/2, Chorus · 2/2, the whole Chorus.
  assert.deepEqual(master(), { start: 0, end: 16 });
  assert.deepEqual(master(), { start: 16, end: 24 });
  assert.deepEqual(master(), { start: 24, end: 32 });
  assert.deepEqual(master(), { start: 16, end: 32 });
  // Nothing after the last section: it stays.
  assert.deepEqual(master(), { start: 16, end: 32 });
  await updateSettings({ riffRepeater: false, rrStartSpeed: 70, rrStep: 5 });
});
