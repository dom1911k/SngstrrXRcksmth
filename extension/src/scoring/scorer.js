// Scorer: matches played-note events against the chart. Pure logic in SONG
// time (seconds on the chart timeline). Edge-case policy: docs/SCORING.md.
//
//   const sc = new Scorer(chart, options);
//   sc.beginPass(fromTime, toTime);          // after load / seek / each loop pass
//   sc.addEvent({ t, midi, legato }, speed); // a played note (song time)
//   sc.advance(songTime, speed);             // finalise notes whose window has passed
//   sc.on('result', fn) / sc.passStats()
//
// Results: { index, note, status: 'hit' | 'miss', rating: 'early' | 'ontime' | 'late',
//            offsetMs (real time, + = late), played (midi|null), octave, wrongPitch }

import { noteName } from '../core/music.js';

const NEAR_MS = 300; // right pitch this close to a note counts as a near miss (timing)

export const SCORING_DEFAULTS = {
  hitWindowMs: 110,     // a note can be hit this early/late (real time)
  onTimeMs: 40,         // within this it counts as "on time"
  pitchTolerance: 0.5,  // semitones (50 cents)
  deadNotes: 'attack',  // 'attack' = any muted attack counts | 'ignore'
  minWindowMs: 35,      // fast passages: windows shrink, but not below this
};

// Why a note is not scored (null = scored).
export function ignoreReason(note, opts) {
  if (note.flags.ghost) return 'ghost';
  if (note.flags.slideTarget) return 'slide-target';
  if (note.flags.dead && opts.deadNotes === 'ignore') return 'dead';
  return null;
}

export class Scorer {
  constructor(chart, options = {}) {
    this.opts = { ...SCORING_DEFAULTS, ...options };
    this.listeners = new Map();
    this.items = chart.notes.map((note, index) => ({ index, note, state: 'idle', ignore: ignoreReason(note, this.opts) }));
    // Chords: the detector is monophonic, so only the lowest note of
    // simultaneous notes is scored; the others follow its result.
    const byTime = new Map();
    for (const it of this.items) {
      if (it.ignore) continue;
      const key = Math.round(it.note.t * 1000);
      const other = byTime.get(key);
      if (!other) { byTime.set(key, it); continue; }
      const [low, high] = it.note.midi < other.note.midi ? [it, other] : [other, it];
      high.ignore = 'chord';
      byTime.set(key, low);
    }
    this.scorable = this.items.filter((it) => !it.ignore);
    // Gaps to the neighbouring scorable notes (song seconds) for fast passages.
    this.scorable.forEach((it, i) => {
      const prev = this.scorable[i - 1], next = this.scorable[i + 1];
      it.gapPrev = prev ? it.note.t - prev.note.t : Infinity;
      it.gapNext = next ? next.note.t - it.note.t : Infinity;
    });
    this.beginPass(-Infinity, Infinity);
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

  // Hit window (song seconds) for a note: the normal window, shrunk to half the
  // distance to its neighbours when notes are close together.
  window(it, speed) {
    const base = (this.opts.hitWindowMs / 1000) * speed;
    const min = (this.opts.minWindowMs / 1000) * speed;
    return Math.max(min, Math.min(base, it.gapPrev / 2, it.gapNext / 2));
  }

  // Start counting from `from` (inclusive) to `to` (exclusive). Notes outside
  // are not scored in this pass.
  beginPass(from, to) {
    this.pass = { from, to, results: [], extras: 0, streak: 0, bestStreak: 0 };
    this.cursor = 0;
    for (const it of this.scorable) {
      it.state = it.note.t >= from - 1e-6 && it.note.t < to ? 'pending' : 'out';
      it.attempt = null;
      it.near = null;
      it.soft = null;
      it.result = null;
    }
    while (this.cursor < this.scorable.length && this.scorable[this.cursor].state !== 'pending') this.cursor++;
  }

  pitchMatch(ev, note) {
    if (note.flags.dead) return ev.legato ? null : { octave: false };
    if (ev.midi === null || ev.midi === undefined) return null;
    const diff = ev.midi - note.midi;
    const tol = this.opts.pitchTolerance;
    if (Math.abs(diff) <= tol) return { octave: false };
    // Octave errors of the detector (or a harmonic): count as a hit, flagged.
    for (const k of note.flags.harmonic ? [12, 19, 24, -12] : [12, -12]) {
      if (Math.abs(diff - k) <= tol) return { octave: true };
    }
    return null;
  }

  addEvent(ev, speed = 1) {
    let best = null, bestDt = Infinity, nearest = null, nearestDt = Infinity;
    const nearRange = (NEAR_MS / 1000) * speed;
    for (let i = this.cursor; i < this.scorable.length; i++) {
      const it = this.scorable[i];
      const dt = ev.t - it.note.t;
      if (dt > 3) continue;
      if (dt < -3) break;
      if (it.state !== 'pending') continue;
      const w = this.window(it, speed);
      const m = Math.abs(dt) <= nearRange ? this.pitchMatch(ev, it.note) : null;
      if (Math.abs(dt) > w) {
        // Right note, but outside the window: remember it (miss reason
        // "timing", and input for the automatic timing correction).
        if (m && !ev.legato && (!it.near || Math.abs(dt) < Math.abs(it.near.dt))) it.near = { dt };
        continue;
      }
      if (ev.legato && !it.note.flags.hopo) {
        // Right pitch without a detected attack (very soft pluck): keep as a
        // fallback; it counts if no attack-based match comes along.
        if (m && (!it.soft || Math.abs(dt) < Math.abs(it.soft.dt))) it.soft = { dt, midi: ev.midi, octave: m.octave };
        continue;
      }
      if (Math.abs(dt) < nearestDt) { nearest = it; nearestDt = Math.abs(dt); }
      if (m && Math.abs(dt) < bestDt) { best = { it, m, dt }; bestDt = Math.abs(dt); }
    }
    if (best) {
      this.judge(best.it, 'hit', { dt: best.dt, played: ev.midi, octave: best.m.octave }, speed);
      return best.it.result;
    }
    if (nearest && !ev.legato) {
      // Wrong note (or an attack whose pitch is still unclear): remember it.
      if (ev.midi !== null && ev.midi !== undefined) nearest.attempt = { midi: ev.midi, dt: ev.t - nearest.note.t };
      else if (!nearest.attempt) nearest.attempt = { midi: null, dt: ev.t - nearest.note.t };
    } else if (!ev.legato) {
      this.pass.extras++;
    }
    return null;
  }

  // Finalise notes whose window has passed by `songTime`.
  advance(songTime, speed = 1) {
    while (this.cursor < this.scorable.length) {
      const it = this.scorable[this.cursor];
      if (it.state === 'pending') {
        if (it.note.t + this.window(it, speed) >= songTime) break;
        if (it.soft) {
          this.judge(it, 'hit', { dt: it.soft.dt, played: it.soft.midi, octave: it.soft.octave, soft: true }, speed);
        } else {
          const a = it.attempt;
          const reason = a && a.midi !== null ? 'wrong-note' : it.near ? 'timing' : 'not-heard';
          this.judge(it, 'miss', { dt: a ? a.dt : it.near ? it.near.dt : null, played: a ? a.midi : null, octave: false, reason }, speed);
        }
      }
      this.cursor++;
    }
  }

  judge(it, status, { dt, played, octave, soft = false, reason = null }, speed) {
    it.state = status;
    const offsetMs = dt === null ? null : (dt / speed) * 1000;
    const rating = status !== 'hit' ? null
      : Math.abs(offsetMs) <= this.opts.onTimeMs ? 'ontime' : offsetMs < 0 ? 'early' : 'late';
    const wrongPitch = status === 'miss' && played !== null && played !== undefined;
    const r = {
      index: it.index,
      note: it.note,
      status,
      rating,
      offsetMs: offsetMs === null ? null : Math.round(offsetMs),
      played: played === undefined ? null : played,
      playedName: played === null || played === undefined ? null : noteName(played),
      expectedName: it.note.flags.dead ? 'x' : noteName(it.note.midi),
      octave: !!octave,
      wrongPitch,
      soft,                      // hit by pitch alone (no attack detected)
      reason: status === 'miss' ? reason : null, // 'wrong-note' | 'timing' | 'not-heard'
    };
    it.result = r;
    const p = this.pass;
    p.results.push(r);
    if (status === 'hit') { p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak); } else p.streak = 0;
    this.emit('result', r);
  }

  passStats() {
    const r = this.pass.results;
    const hits = r.filter((x) => x.status === 'hit');
    const misses = r.filter((x) => x.status === 'miss');
    const timed = hits.filter((x) => x.offsetMs !== null);
    const avgOffset = timed.length ? timed.reduce((a, x) => a + x.offsetMs, 0) / timed.length : 0;
    return {
      judged: r.length,
      hits: hits.length,
      misses: misses.length,
      accuracy: r.length ? hits.length / r.length : null,
      streak: this.pass.streak,
      bestStreak: this.pass.bestStreak,
      early: hits.filter((x) => x.rating === 'early').length,
      ontime: hits.filter((x) => x.rating === 'ontime').length,
      late: hits.filter((x) => x.rating === 'late').length,
      avgOffsetMs: Math.round(avgOffset),
      extras: this.pass.extras,
      wrongPitch: misses.filter((x) => x.reason === 'wrong-note').length,
      missTiming: misses.filter((x) => x.reason === 'timing').length,
      missNotHeard: misses.filter((x) => x.reason === 'not-heard').length,
      soft: hits.filter((x) => x.soft).length,
      octave: hits.filter((x) => x.octave).length,
    };
  }

  // Pass summary for the end-of-song / end-of-loop card.
  summary(chart) {
    const s = this.passStats();
    // Bars with the most misses.
    const perBar = new Map();
    for (const r of this.pass.results) {
      const b = r.note.bar !== undefined ? r.note.bar : -1;
      const e = perBar.get(b) || { bar: b, hits: 0, misses: 0 };
      if (r.status === 'hit') e.hits++; else e.misses++;
      perBar.set(b, e);
    }
    const bars = chart && chart.bars ? chart.bars : [];
    s.weakBars = [...perBar.values()].filter((e) => e.misses > 0)
      .sort((a, b) => b.misses - a.misses || a.bar - b.bar).slice(0, 5)
      .map((e) => ({ ...e, number: bars[e.bar] ? bars[e.bar].measure + 1 : e.bar + 1, section: bars[e.bar] ? bars[e.bar].section : undefined }));
    // Repeated "you played X instead of Y" -> maybe a tab error or a habit.
    const swaps = new Map();
    for (const r of this.pass.results) {
      if (!r.wrongPitch) continue;
      const key = `${r.expectedName}>${Math.round(r.played)}`;
      const e = swaps.get(key) || { expected: r.expectedName, played: noteName(r.played), count: 0, bars: new Set() };
      e.count++;
      e.bars.add(bars[r.note.bar] ? bars[r.note.bar].measure + 1 : r.note.bar + 1);
      swaps.set(key, e);
    }
    s.wrongNotes = [...swaps.values()].sort((a, b) => b.count - a.count).slice(0, 5).map((e) => ({ ...e, bars: [...e.bars].slice(0, 6) }));
    s.from = this.pass.from;
    s.to = this.pass.to;
    return s;
  }
}
