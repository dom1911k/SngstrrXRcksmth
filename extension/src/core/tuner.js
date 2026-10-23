// Tuner model: turns pitch frames into a steady reading and compares it with
// the target tuning. No DOM here.
import { freqToMidi, midiToFreq, noteName } from './music.js';

const MIN_CLARITY = 0.93;
const HISTORY = 15;        // frames (~80 ms) in the median
const HOLD_SECONDS = 1.2;  // keep showing the last reading after the note dies
const OFF_CENTS = 25;      // a string further off than this triggers a warning
const OFF_SECONDS = 0.7;   // ...if it stays off this long

export class TunerModel {
  constructor({ tuning, refA = 440 }) {
    this.history = [];
    this.lastGoodTime = -Infinity;
    this.reading = null;
    this.offSince = new Map();   // string index -> time it first read off
    this.warnings = new Map();   // string index -> { cents, t }
    this.setTuning(tuning, refA);
  }

  setTuning(tuning, refA = this.refA || 440) {
    this.tuning = tuning;
    this.refA = refA;
    this.offSince.clear();
    this.warnings.clear();
  }

  // frame: { t, f0, clarity, rms }
  push(frame) {
    if (frame.f0 > 0 && frame.clarity >= MIN_CLARITY && frame.rms > 0.002) {
      this.history.push(frame.f0);
      if (this.history.length > HISTORY) this.history.shift();
      this.lastGoodTime = frame.t;
      if (this.history.length >= 5) this.update(frame.t);
    } else if (frame.t - this.lastGoodTime > 0.08) {
      this.history.length = 0;
    }
    if (this.reading && frame.t - this.lastGoodTime > HOLD_SECONDS) this.reading = null;
    return this.reading;
  }

  update(t) {
    const sorted = [...this.history].sort((a, b) => a - b);
    const freq = sorted[sorted.length >> 1];
    const midiFloat = freqToMidi(freq, this.refA);
    const nearest = Math.round(midiFloat);

    // Closest string of the target tuning (strings are >= 2 semitones apart,
    // so +-250 cents is never ambiguous).
    let string = -1, stringCents = 0, best = Infinity;
    this.tuning.forEach((m, i) => {
      const c = (midiFloat - m) * 100;
      if (Math.abs(c) < Math.abs(best)) { best = c; string = i; }
    });
    if (Math.abs(best) > 250) string = -1;
    else stringCents = best;

    if (string >= 0) {
      if (Math.abs(stringCents) > OFF_CENTS) {
        if (!this.offSince.has(string)) this.offSince.set(string, t);
        if (t - this.offSince.get(string) >= OFF_SECONDS) this.warnings.set(string, { cents: stringCents, t });
      } else {
        this.offSince.delete(string);
        this.warnings.delete(string);
      }
    }

    this.reading = {
      freq,
      note: noteName(nearest),
      cents: (midiFloat - nearest) * 100,
      string,
      stringCents,
      targetFreq: string >= 0 ? midiToFreq(this.tuning[string], this.refA) : 0,
    };
  }

  // Human-readable mismatch warnings for strings played off-pitch for a while.
  mismatch() {
    const out = [];
    for (const [i, w] of this.warnings) {
      const c = Math.round(w.cents);
      let hint = '';
      if (Math.abs(Math.abs(c) - 100) <= 30) hint = c < 0 ? ' (about a half step down)' : ' (about a half step up)';
      else if (Math.abs(Math.abs(c) - 200) <= 30) hint = c < 0 ? ' (about a whole step down, Drop tuning?)' : ' (about a whole step up)';
      out.push({ string: i, cents: c, text: `${noteName(this.tuning[i])} string is ${Math.abs(c)} cents ${c < 0 ? 'flat' : 'sharp'}${hint}` });
    }
    return out.sort((a, b) => a.string - b.string);
  }
}
