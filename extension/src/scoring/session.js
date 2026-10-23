// Scoring session: connects the audio engine (detected notes), the player
// adapter (song clock, seeks, loops) and the Scorer.
//
// Timing: a detected attack has an AudioContext time. It is mapped to
// performance.now(), the calibrated total latency is subtracted (the moment
// you actually played, as heard against the music), and the adapter's clock
// turns that into song time.
//
// Passes: playing from a seek point to the end, or one loop pass. When the
// player jumps (seek or loop restart), the old pass stays open for
// latency + 0.3 s so the last notes you played before the jump still count;
// notes detected after the jump wait in a queue for the new pass.
//
// Events: 'result' (per note), 'summary' (end of song / loop pass; kind 'partial'
// when you jump away after playing a good part of a pass), 'pass', 'stats',
// 'played' (every detected note while the input is on, song time; used by wait mode).
//
// Scoring can be suspended (wait mode, take playback): suspend(reason, true).

import { NoteEventDetector } from './detector.js';
import { Scorer } from './scorer.js';
import { getSettings, updateSettings, totalLatencyMs, onSettingsChange } from '../core/settings.js';

const CLOSE_GRACE_MS = 300;
const DECISION_MS = 200;      // detector needs up to ~150 ms to decide a pitch
// Automatic timing correction: after every AUTO_SAMPLES timing measurements
// (hits + right notes just outside the window), move the correction a part of
// the way towards their median. Small enough to never chase single notes.
const AUTO_SAMPLES = 12;
const AUTO_MIN_MS = 8;
const AUTO_GAIN = 0.6;
const AUTO_LIMIT_MS = 100;

export class ScoringSession {
  constructor(engine, adapter) {
    this.engine = engine;
    this.adapter = adapter;
    this.listeners = new Map();
    this.chart = null;
    this.scorer = null;
    this.closing = null;
    this.queue = [];
    this.seenJump = adapter.clock.lastJumpPerf;
    this.ended = false;
    this.suspended = new Set();
    this.wasActive = false;
    this.detector = new NoteEventDetector((ev) => this.onEvent(ev));
    engine.on('onset', (o) => this.detector.onOnset(o));
    engine.on('frame', (f) => this.detector.onFrame(f));
    engine.on('state', () => { this.detector.reset(); this.emit('stats', this.stats()); });
    adapter.on('chart', (info) => this.setChart(info.isBassLike ? info.chart : null));
    adapter.on('loop', () => this.restartPass('loop-changed'));
    onSettingsChange((s) => {
      const o = this.scorerOptions(s);
      if (this.scorer && (o.hitWindowMs !== this.scorer.opts.hitWindowMs || o.onTimeMs !== this.scorer.opts.onTimeMs || o.deadNotes !== this.scorer.opts.deadNotes)) this.setChart(this.chart);
    });
    const tick = () => { requestAnimationFrame(tick); this.tick(); };
    requestAnimationFrame(tick);
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, data) {
    const set = this.listeners.get(type);
    if (set) for (const fn of set) fn(data);
  }

  scorerOptions(s = getSettings()) {
    return { hitWindowMs: s.hitWindowMs, onTimeMs: s.onTimeMs, deadNotes: s.deadNotes };
  }

  get active() {
    return !!(this.scorer && this.engine.running && getSettings().scoring && !this.suspended.size);
  }

  suspend(reason, on) {
    if (on) this.suspended.add(reason); else this.suspended.delete(reason);
    this.emit('stats', this.stats());
  }

  setChart(chart) {
    this.chart = chart;
    this.scorer = chart ? new Scorer(chart, this.scorerOptions()) : null;
    if (this.scorer) {
      this.scorer.on('result', (r) => { this.learnTiming(r); this.emit('result', r); this.emit('stats', this.stats()); });
      const last = this.scorer.scorable[this.scorer.scorable.length - 1];
      this.lastNoteTime = last ? last.note.t : 0;
    }
    this.closing = null;
    this.queue = [];
    this.restartPass('chart');
  }

  passRange(from) {
    const st = this.adapter.getState();
    const loop = st.ready && st.loop;
    if (loop && from >= loop.start - 0.5 && from < loop.end) return [Math.max(from, loop.start), loop.end, 'loop'];
    return [from, Infinity, 'song'];
  }

  restartPass(reason, at = this.adapter.getTime()) {
    if (!this.scorer) return;
    const [from, to, kind] = this.passRange(at);
    this.scorer.beginPass(from - 0.02, to);
    this.passKind = kind;
    this.ended = false;
    this.emit('pass', { reason, from, to, kind });
    this.emit('stats', this.stats());
  }

  latencyMs() {
    return totalLatencyMs(getSettings());
  }

  onEvent(ev) {
    const perf = this.engine.ctxToPerf(ev.t) - this.latencyMs();
    if (this.engine.running && this.listeners.has('played')) {
      this.emit('played', { ...ev, perf, songTime: this.adapter.clock.timeAt(perf) });
    }
    if (!this.active) return;
    // The jump is noticed on the next frame, a few ms after it happened:
    // anything that maps beyond the old pass belongs to the new one.
    if (this.closing && (perf >= this.closing.jumpPerf || this.adapter.clock.timeAt(perf) >= this.closing.before - 0.0005)) {
      this.queue.push(ev);
      return;
    }
    this.addAtPerf(ev, perf);
  }

  addAtPerf(ev, perf, afterJump = false) {
    const clock = this.adapter.clock;
    if (afterJump) {
      // Map with the new segment, extended backwards over the detection gap.
      if (!clock.playing) return;
      this.scorer.addEvent({ ...ev, t: clock.estimate(perf) }, clock.speed);
      return;
    }
    // Ignore what was played while paused (e.g. tuning up).
    const playing = perf < clock.lastJumpPerf && clock.prev ? clock.prev.playing : clock.playing;
    if (!playing) return;
    const speed = perf < clock.lastJumpPerf && clock.prev ? clock.prev.speed : clock.speed;
    this.scorer.addEvent({ ...ev, t: clock.timeAt(perf) }, speed);
  }

  tick() {
    if (!this.scorer) return;
    const clock = this.adapter.clock;
    const now = performance.now();
    // Only score while the input is on: notes passed while it was off (or
    // suspended) are not misses. Turning it on starts a fresh pass from here.
    const active = this.active;
    if (active !== this.wasActive) {
      this.wasActive = active;
      if (active) this.restartPass('input');
    }
    if (!active) {
      this.seenJump = clock.lastJumpPerf;
      this.closing = null;
      this.queue = [];
      return;
    }

    // A seek or loop restart happened.
    if (clock.lastJumpPerf !== this.seenJump) {
      this.seenJump = clock.lastJumpPerf;
      if (this.closing) this.closePass(); // two jumps in a row
      const before = clock.timeAt(clock.lastJumpPerf - 1);
      const after = this.adapter.getTime();
      const st = this.adapter.getState();
      const loopWrap = !!(st.ready && st.loop && Math.abs(after - st.loop.start) < 0.4 && before >= st.loop.end - 0.6);
      // Song time where the old pass ends: the loop end for a loop restart.
      const limit = loopWrap ? Math.min(before, st.loop.end) : before;
      this.closing = { speed: clock.prev ? clock.prev.speed : clock.speed, jumpPerf: clock.lastJumpPerf, at: now + this.latencyMs() + CLOSE_GRACE_MS + DECISION_MS, before: limit, after, loopWrap };
    }
    if (this.closing && now >= this.closing.at) this.closePass();

    const ref = now - this.latencyMs() - DECISION_MS;
    if (this.closing) {
      if (ref < this.closing.jumpPerf) this.scorer.advance(clock.timeAt(ref), clock.prev ? clock.prev.speed : clock.speed);
      return;
    }
    if (!clock.playing) return;
    if (ref >= clock.lastJumpPerf) this.scorer.advance(clock.timeAt(ref), clock.speed);

    // End of the song.
    if (!this.ended && this.passKind === 'song' && clock.timeAt(ref) > this.lastNoteTime + 1) {
      this.ended = true;
      const s = this.scorer.passStats();
      if (s.judged >= 4) this.emit('summary', this.summaryOf('song', clock.speed));
    }
  }

  closePass() {
    const c = this.closing;
    this.closing = null;
    // Judge everything that was reached before the jump.
    this.scorer.advance(c.before, this.adapter.clock.prev ? this.adapter.clock.prev.speed : this.adapter.clock.speed);
    const s = this.scorer.passStats();
    if (c.loopWrap && s.judged >= 2) this.emit('summary', this.summaryOf('loop', c.speed));
    else if (!c.loopWrap && s.judged >= 12 && !this.ended) this.emit('summary', this.summaryOf('partial', c.speed));
    this.restartPass(c.loopWrap ? 'loop' : 'seek', c.after);
    const q = this.queue;
    this.queue = [];
    for (const ev of q) this.addAtPerf(ev, this.engine.ctxToPerf(ev.t) - this.latencyMs(), true);
  }

  learnTiming(r) {
    const s = getSettings();
    if (!s.autoTiming || r.offsetMs === null || r.soft) return;
    if (!(r.status === 'hit' || r.reason === 'timing')) return;
    this.timingSamples = this.timingSamples || [];
    this.timingSamples.push(r.offsetMs);
    if (this.timingSamples.length < AUTO_SAMPLES) return;
    const sorted = [...this.timingSamples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.timingSamples = [];
    if (Math.abs(median) < AUTO_MIN_MS) return;
    const next = Math.max(-AUTO_LIMIT_MS, Math.min(AUTO_LIMIT_MS, Math.round((s.autoTimingMs || 0) + median * AUTO_GAIN)));
    if (next !== s.autoTimingMs) {
      updateSettings({ autoTimingMs: next });
      this.emit('autotiming', { ms: next, median });
    }
  }

  stats() {
    if (!this.scorer) return null;
    return { ...this.scorer.passStats(), active: this.active, kind: this.passKind };
  }

  summaryOf(kind, speed) {
    return { kind, speed, at: Date.now(), ...this.scorer.summary(this.chart) };
  }

  currentSummary() {
    return this.scorer ? { kind: this.passKind, ...this.scorer.summary(this.chart) } : null;
  }
}
