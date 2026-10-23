// Fretboard note trainer: "Play G on the A string" (find the note) or "Play
// this fret" and learn its name (name the fret). The pitch detector checks the
// answer; the string decides the octave, so the exact pitch is required.

import { NOTE_NAMES } from './music.js';

export const NATURALS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Pure: one random question. rnd() in [0, 1).
export function makeQuestion({ tuning, maxFret = 12, naturalsOnly = true, strings = null, avoid = null }, rnd = Math.random) {
  const pool = [];
  const use = strings || tuning.map((_, i) => i);
  for (const s of use) {
    for (let f = 0; f <= maxFret; f++) {
      const midi = tuning[s] + f;
      const name = NOTE_NAMES[midi % 12];
      if (naturalsOnly && name.includes('#')) continue;
      if (avoid && avoid.string === s && avoid.fret === f) continue;
      pool.push({ string: s, fret: f, midi, name });
    }
  }
  return pool[Math.floor(rnd() * pool.length)];
}

// Pure: judge a played pitch (fractional MIDI) against the question.
export function judgeAnswer(q, midi) {
  if (midi === null || midi === undefined) return { result: 'unclear' };
  const d = midi - q.midi;
  if (Math.abs(d) <= 0.5) return { result: 'right' };
  const r = Math.round(d);
  if (Math.abs(r) === 12 || Math.abs(r) === 24) return { result: 'octave', played: NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12] };
  return { result: 'wrong', played: NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12] };
}

export class NoteTrainer {
  constructor(session, { now = () => performance.now() } = {}) {
    this.session = session;
    this.now = now;
    this.listeners = new Set();
    this.round = null;
    session.on('played', (ev) => this.onPlayed(ev));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(event = null) { for (const fn of this.listeners) fn(this, event); }

  // opts: { tuning, mode: 'find' | 'name', count, maxFret, naturalsOnly }
  start(opts) {
    this.round = { ...opts, n: 0, firstTry: 0, attempts: 0, times: [], started: Date.now(), done: false, streak: 0, bestStreak: 0 };
    this.next();
  }

  stop() { this.round = null; this.changed(); }

  next() {
    const r = this.round;
    if (r.n >= r.count) { r.done = true; r.seconds = Math.round((Date.now() - r.started) / 1000); this.changed({ type: 'done' }); return; }
    r.q = makeQuestion({ tuning: r.tuning, maxFret: r.maxFret, naturalsOnly: r.naturalsOnly, avoid: r.q });
    r.n++;
    r.tries = 0;
    r.asked = this.now();
    r.feedback = null;
    r.waitingNext = false;
    this.changed({ type: 'question' });
  }

  onPlayed(ev) {
    const r = this.round;
    if (!r || r.done || r.waitingNext || ev.legato) return;
    if (ev.perf !== undefined && ev.perf < r.asked - 50) return;
    const j = judgeAnswer(r.q, ev.midi);
    if (j.result === 'unclear') return;
    r.tries++;
    if (j.result === 'right') {
      r.times.push((this.now() - r.asked) / 1000);
      if (r.tries === 1) { r.firstTry++; r.streak++; r.bestStreak = Math.max(r.bestStreak, r.streak); } else r.streak = 0;
      r.feedback = { ok: true, text: r.tries === 1 ? 'Right!' : 'Right (after a retry)' };
      r.waitingNext = true;
      this.changed({ type: 'right' });
      setTimeout(() => { if (this.round === r) this.next(); }, 900);
    } else {
      r.attempts++;
      r.streak = 0;
      const stringName = NOTE_NAMES[r.tuning[r.q.string] % 12];
      r.feedback = { ok: false, text: j.result === 'octave' ? `${j.played} is the right note, but in another octave: play it on the ${stringName} string.` : `That was ${j.played}. Try again.` };
      this.changed({ type: 'wrong' });
    }
  }

  // History record for the finished round (saved like a drill).
  record() {
    const r = this.round;
    if (!r || !r.done) return null;
    return {
      songKey: 'drill:fretboard', title: 'Fretboard trainer', artist: '', barCount: 0, at: Date.now(), kind: 'song', speed: 1,
      accuracy: r.firstTry / r.count, judged: r.count, hits: r.firstTry, bestStreak: r.bestStreak, avgOffsetMs: 0,
      seconds: r.seconds, perBar: [], avgAnswerSeconds: r.times.length ? r.times.reduce((a, x) => a + x, 0) / r.times.length : null,
    };
  }
}
