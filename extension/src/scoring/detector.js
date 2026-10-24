// Turns the worklet's raw stream (onsets + ~5 ms pitch frames, AudioContext
// seconds) into "played note" events:
//
//   { t, midi, legato, clarity }
//     t       time of the attack (onset) in AudioContext seconds
//     midi    detected pitch as a fractional MIDI number, or null when the attack
//             had no clear pitch (muted/dead note, very short or noisy attack)
//     legato  true for a pitch change WITHOUT a new attack (hammer-on, pull-off,
//             slide arrival); t is estimated from when the new pitch appeared
//
// Timing always comes from the attack; pitch from the first stable stretch
// after it (low E needs ~50 ms). A note that keeps ringing produces no new
// events, so it can never be counted again.

import { freqToMidi } from '../core/music.js';

const MIN_CLARITY = 0.85;   // default; DetectionLog's sensitivity setting changes detector.minClarity
const SETTLE = 0.012;        // s after the onset before pitch frames count (pick noise)
const MAX_WAIT = 0.14;       // s: give up waiting for a stable pitch (-> midi null)
const STABLE_FRAMES = 4;     // frames that must agree for a pitch decision
const AGREE = 0.45;          // semitones: frames "agree" within this
const LEGATO_MIN_JUMP = 0.75;// semitones: smaller changes are vibrato/bends, not new notes
const LEGATO_BLOCK = 0.09;   // s after an onset when pitch changes are part of that attack
const LEGATO_DELAY = 0.025;  // s: a pitch change is detected about this long after it happened
const SILENCE = 0.15;        // s without a clear pitch = the note has ended
const LATE_PITCH = 0.35;     // s after an attack: a pitch that only settles now still belongs to it

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

function stableRun(values) {
  if (values.length < STABLE_FRAMES) return null;
  const run = values.slice(-STABLE_FRAMES);
  const m = median(run);
  return run.every((v) => Math.abs(v - m) <= AGREE) ? m : null;
}

export class NoteEventDetector {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.pending = null;      // onset waiting for its pitch
    this.lastOnset = -Infinity;
    this.ref = null;          // pitch of the note currently sounding (midi)
    this.lastGood = -Infinity;
    this.run = [];            // recent pitches (for legato detection)
    this.runStart = 0;
    this.awaiting = null;     // attack whose pitch was unclear: { t }
    this.minClarity = MIN_CLARITY;
  }

  reset() {
    this.pending = null;
    this.awaiting = null;
    this.ref = null;
    this.run = [];
  }

  onOnset(o) {
    if (this.pending) this.finish(this.pending.t + MAX_WAIT);
    this.awaiting = null;
    this.pending = { t: o.t, values: [], strength: o.strength };
    this.lastOnset = o.t;
  }

  onFrame(f) {
    const good = f.f0 > 0 && f.clarity >= this.minClarity;
    const m = good ? freqToMidi(f.f0) : null;
    if (good) this.lastGood = f.t;

    // 1. Pitch for a pending attack.
    if (this.pending) {
      if (good && f.t >= this.pending.t + SETTLE) this.pending.values.push(m);
      if (stableRun(this.pending.values) !== null || f.t >= this.pending.t + MAX_WAIT) this.finish(f.t);
      return;
    }

    // 2. Note ended?
    if (f.t - this.lastGood > SILENCE) { this.ref = null; this.run = []; return; }
    if (!good) return;

    // 3. Pitch change without an attack -> legato event.
    if (this.run.length && Math.abs(m - this.run[this.run.length - 1]) > AGREE) { this.run = []; }
    if (!this.run.length) this.runStart = f.t;
    this.run.push(m);
    if (this.run.length > 8) this.run.shift();
    const stable = stableRun(this.run);
    if (stable === null) return;
    if (this.ref === null) {
      this.ref = stable;
      // A weak low note: the attack was heard but its pitch only became clear
      // now. Report it with the attack's time.
      if (this.awaiting && f.t - this.awaiting.t <= LATE_PITCH) {
        this.onEvent({ t: this.awaiting.t, midi: stable, legato: false, late: true });
      }
      this.awaiting = null;
      return;
    }
    if (Math.abs(stable - this.ref) >= LEGATO_MIN_JUMP && f.t - this.lastOnset > LEGATO_BLOCK) {
      this.onEvent({ t: this.runStart - LEGATO_DELAY, midi: stable, legato: true, clarity: f.clarity });
      this.ref = stable;
      this.run = [];
    } else if (Math.abs(stable - this.ref) < AGREE) {
      this.ref += (stable - this.ref) * 0.2;
    }
  }

  finish(now) {
    const p = this.pending;
    this.pending = null;
    let midi = null;
    if (p.values.length) {
      // Prefer the later, settled frames over the attack transient.
      const settled = p.values.length > STABLE_FRAMES ? p.values.slice(-Math.max(STABLE_FRAMES, Math.ceil(p.values.length / 2))) : p.values;
      midi = median(settled);
    }
    this.ref = midi;
    this.run = [];
    this.awaiting = midi === null ? { t: p.t } : null;
    this.onEvent({ t: p.t, midi, legato: false, decidedAt: now });
  }
}
