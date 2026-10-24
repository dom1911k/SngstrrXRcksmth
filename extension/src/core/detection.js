// Note detection tuning and the "what I heard" log.
//
// Sensitivity: how easily a pluck counts as a new note (onset threshold in the
// worklet) and how clear a pitch must be (detector). Higher = catches softer
// plucks, but also more noise. Pitch tolerance: how far off (cents) a note may
// be and still count as the right one.
//
//   const log = new DetectionLog(session);
//   log.heard     -> last detected notes [{ at, name, midi, kind }] (newest first)
//   log.misses    -> last missed notes [{ at, bar, expected, played, reason, offsetMs, text }]
//   log.advice()  -> plain-language tip from the recent results, or ''

import { noteName } from './music.js';

export const SENSITIVITY = {
  low: { onsetDb: 8, clarity: 0.88, label: 'Low (noisy room, strong picking)' },
  normal: { onsetDb: 6, clarity: 0.85, label: 'Normal' },
  high: { onsetDb: 4.5, clarity: 0.8, label: 'High (soft fingerstyle)' },
  max: { onsetDb: 3.5, clarity: 0.75, label: 'Very high (if many notes are "not heard")' },
};

export function sensitivityOf(s) {
  return SENSITIVITY[s.detectSensitivity] || SENSITIVITY.normal;
}

// Plain-language text for one missed note.
export function describeMiss(r) {
  const exp = r.expectedName === 'x' ? 'a muted note' : r.expectedName;
  if (r.reason === 'wrong-note') {
    const d = Math.round(r.played - r.note.midi);
    const by = Math.abs(d) === 1 ? ' (a semitone off)' : Math.abs(d) === 12 ? ' (an octave off)' : '';
    return `${exp}: heard ${r.playedName} instead${by}`;
  }
  if (r.reason === 'timing') {
    const ms = Math.abs(r.offsetMs || 0);
    return `${exp}: right note, but ${ms} ms ${r.offsetMs < 0 ? 'early' : 'late'}`;
  }
  return `${exp}: nothing heard`;
}

// Tip from recent results (hits and misses). Pure; exported for tests.
export function detectionAdvice(results, { sensitivity = 'normal', tolerance = 50 } = {}) {
  const misses = results.filter((r) => r.status === 'miss');
  if (results.length < 10 || misses.length < 4 || misses.length / results.length < 0.2) return '';
  const count = (reason) => misses.filter((r) => r.reason === reason).length;
  const notHeard = count('not-heard'), wrong = count('wrong-note'), timing = count('timing');
  const top = Math.max(notHeard, wrong, timing);
  if (top === notHeard) {
    return sensitivity === 'max'
      ? 'Most misses: nothing heard. Turn the bass volume up (the level meter should reach the yellow when you pluck) and check that the Real Tone Cable is the input.'
      : 'Most misses: nothing heard. Try a higher sensitivity, or turn the bass volume up (the level meter should reach the yellow when you pluck).';
  }
  if (top === wrong) {
    const semis = misses.filter((r) => r.reason === 'wrong-note').map((r) => r.played - r.note.midi);
    const near = semis.filter((d) => Math.abs(d) < 1.5).length;
    if (near >= semis.length * 0.6) {
      return tolerance < 70
        ? 'Most misses are just off the right pitch: tune up with the tuner, or set the pitch tolerance to Relaxed.'
        : 'Most misses are just off the right pitch: tune up with the tuner (a string may be a semitone off).';
    }
    return 'Most misses: a different note was heard. Check the fret and string on the highway; if it happens on fast notes, slow the song down.';
  }
  const late = misses.filter((r) => r.reason === 'timing' && r.offsetMs > 0).length;
  const dir = late >= timing / 2 ? 'late' : 'early';
  return `Most misses: the right note, but ${dir}. If you feel you play in time, run the latency calibration again.`;
}

export class DetectionLog {
  constructor(session, { size = 12 } = {}) {
    this.size = size;
    this.heard = [];
    this.misses = [];
    this.recent = [];       // last 40 results (for advice)
    this.listeners = new Set();
    session.on('played', (ev) => this.onPlayed(ev));
    session.on('result', (r) => this.onResult(r, session.chart));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  onPlayed(ev) {
    const kind = ev.midi === null || ev.midi === undefined ? 'muted / unclear' : ev.legato ? 'legato' : 'pluck';
    this.heard.unshift({ at: Date.now(), midi: ev.midi, name: ev.midi === null || ev.midi === undefined ? '–' : noteName(ev.midi), kind });
    if (this.heard.length > this.size) this.heard.pop();
    this.emit();
  }

  onResult(r, chart) {
    this.recent.push(r);
    if (this.recent.length > 40) this.recent.shift();
    if (r.status === 'miss') {
      const bar = chart && chart.bars && chart.bars[r.note.bar] ? chart.bars[r.note.bar].measure + 1 : null;
      this.misses.unshift({ at: Date.now(), bar, expected: r.expectedName, played: r.playedName, reason: r.reason, offsetMs: r.offsetMs, text: describeMiss(r) });
      if (this.misses.length > this.size) this.misses.pop();
    }
    this.emit();
  }

  clear() {
    this.heard = []; this.misses = []; this.recent = [];
    this.emit();
  }

  advice(settings) {
    return detectionAdvice(this.recent, { sensitivity: settings.detectSensitivity, tolerance: settings.pitchToleranceCents });
  }
}
