// Input check: what the trainer hears right now, and a plain-language warning
// when scoring keeps failing for a reason you can fix (no sound from the
// cable, everything late/early, everything a semitone off).
//
//   monitor.heard()   -> { midi, name, clarity } of the current clear pitch, or null
//   monitor.warning   -> text or '' (shown on the highway)

import { noteName } from './music.js';

const HEARD_MS = 140;         // a pitch counts as "heard now" this long after its frame
const STREAK = 6;             // consecutive misses of one kind before warning

export class InputMonitor {
  constructor(engine, session, { now = () => performance.now() } = {}) {
    this.engine = engine;
    this.session = session;
    this.now = now;
    this.last = null;            // last clear pitch frame { midi, clarity, perf }
    this.lastOnsetPerf = -Infinity;
    this.misses = [];            // recent consecutive misses (results)
    this.warning = '';
    this.listeners = new Set();
    engine.on('frame', (f) => this.onFrame(f));
    engine.on('onset', (o) => { this.lastOnsetPerf = this.engine.ctxToPerf(o.t); });
    engine.on('state', (st) => { if (!st.running) { this.last = null; this.reset(); } });
    session.on('result', (r) => this.onResult(r));
    session.on('pass', () => this.reset());
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  onFrame(f) {
    if (f.f0 > 0 && f.clarity >= 0.85) {
      this.last = { midi: 69 + 12 * Math.log2(f.f0 / 440), clarity: f.clarity, perf: this.engine.ctxToPerf(f.t) };
    }
  }

  // Current clear pitch (MIDI, fractional) or null.
  heardMidi(perf = this.now()) {
    const l = this.last;
    return l && perf - l.perf < HEARD_MS ? l.midi : null;
  }

  heard(perf = this.now()) {
    const m = this.heardMidi(perf);
    if (m === null) return null;
    const cents = Math.round((m - Math.round(m)) * 100);
    return { midi: m, name: noteName(m), cents, clarity: this.last.clarity };
  }

  reset() {
    this.misses = [];
    this.setWarning('');
  }

  setWarning(text) {
    if (text === this.warning) return;
    this.warning = text;
    for (const fn of this.listeners) fn(text);
  }

  onResult(r) {
    if (r.status === 'hit') { this.misses = []; this.setWarning(''); return; }
    this.misses.push(r);
    if (this.misses.length > 16) this.misses.shift();
    this.setWarning(diagnose(this.misses, { sinceOnsetMs: this.now() - this.lastOnsetPerf }));
  }
}

// Pure diagnosis from consecutive misses (exported for tests).
export function diagnose(misses, { sinceOnsetMs = 0 } = {}) {
  if (misses.length < STREAK) return '';
  const recent = misses.slice(-STREAK);
  if (recent.every((r) => r.reason === 'not-heard')) {
    return sinceOnsetMs > 4000
      ? 'No sound from your bass: check that the Real Tone Cable is selected under Input and the level meter moves when you play.'
      : 'Your notes are not recognised: play a little harder, or check the input level (aim for the yellow part of the meter).';
  }
  const timed = recent.filter((r) => r.reason === 'timing' && r.offsetMs !== null);
  if (timed.length >= STREAK - 1) {
    const avg = Math.round(timed.reduce((a, r) => a + r.offsetMs, 0) / timed.length);
    return `Right notes, but all about ${Math.abs(avg)} ms ${avg > 0 ? 'late' : 'early'}: run the latency calibration again (panel → Latency calibration).`;
  }
  const wrong = recent.filter((r) => r.reason === 'wrong-note' && r.played !== null && r.note && !r.note.flags.dead);
  if (wrong.length >= STREAK - 1) {
    const offs = wrong.map((r) => Math.round(r.played - r.note.midi));
    const same = offs.every((d) => d === offs[0]) && offs[0] !== 0 && Math.abs(offs[0]) <= 2;
    if (same) return `Everything sounds ${Math.abs(offs[0])} semitone${Math.abs(offs[0]) > 1 ? 's' : ''} ${offs[0] < 0 ? 'lower' : 'higher'} than the tab: check your tuning with the tuner (the tab may use a different tuning).`;
  }
  return '';
}
