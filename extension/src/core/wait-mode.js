// Wait mode: playback stops at each note until you play its pitch, then
// continues. For learning a part note by note; nothing is scored meanwhile.
//
// Stops are the notes the scorer would judge (ghost notes and slide arrivals
// are skipped; for a chord, its lowest note). The song is paused just as the
// note reaches the strings and put back exactly there, so the gem waits on
// the strings. Any played pitch is compared like the scorer does (octave
// errors of the detector are accepted, a dead note needs any muted attack).
// Pressing play yourself skips the note. Count-in is off while wait mode runs.

import { Scorer } from '../scoring/scorer.js';
import { getSettings } from './settings.js';
import { noteName, noteNameNoOctave } from './music.js';

const PAUSE_EARLY = 0.03;     // s (real time): pause this much before the note (player reaction)
const SELF_SEEK_MS = 800;     // ignore the jump caused by our own repositioning

export class WaitMode {
  constructor(adapter, session, { notify = () => {}, autoTick = true, now = () => performance.now() } = {}) {
    this.adapter = adapter;
    this.session = session;
    this.notify = notify;
    this.now = now;
    this.enabled = false;
    this.state = 'off';          // 'off' | 'run' | 'waiting'
    this.target = null;          // the note being waited for
    this.cleared = -Infinity;    // song time up to which notes are done
    this.message = '';
    this.stats = { notes: 0, firstTry: 0, wrong: 0 };
    this.listeners = new Set();
    this.selfSeekUntil = 0;
    this.seenJump = adapter.clock.lastJumpPerf;
    this.stops = [];
    adapter.on('chart', () => this.build());
    session.on('played', (ev) => this.onPlayed(ev));
    this.build();
    if (autoTick) {
      const loop = () => { requestAnimationFrame(loop); this.tick(); };
      requestAnimationFrame(loop);
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this); }

  build() {
    const chart = this.adapter.getChart();
    this.scorer = chart ? new Scorer(chart, { deadNotes: getSettings().deadNotes }) : null;
    this.stops = this.scorer ? this.scorer.scorable.map((it) => it.note) : [];
    this.state = this.enabled ? 'run' : 'off';
    this.target = null;
    this.cleared = this.adapter.getTime() - 0.02;
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.session.suspend('wait', on);
    if (this.adapter.suppressCountIn) this.adapter.suppressCountIn(on, 'wait');
    if (on) {
      this.stats = { notes: 0, firstTry: 0, wrong: 0 };
      this.state = 'run';
      this.target = null;
      this.cleared = this.adapter.getTime() - 0.02;
      this.message = '';
      this.notify('Wait mode on: the song waits for each note');
    } else {
      const s = this.stats;
      this.state = 'off';
      this.target = null;
      this.message = '';
      this.notify(s.notes ? `Wait mode off · ${s.firstTry} of ${s.notes} notes right the first time` : 'Wait mode off');
    }
    this.changed();
  }

  toggle() { this.setEnabled(!this.enabled); }

  // Next stop after `cleared`.
  nextStop() {
    const stops = this.stops;
    let lo = 0, hi = stops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (stops[mid].t <= this.cleared + 1e-4) lo = mid + 1; else hi = mid; }
    return stops[lo] || null;
  }

  displayLead(speed) {
    // The highway shows the song shifted by the visual delay; stop when the
    // gem is on the strings.
    return (getSettings().visualDelayMs / 1000) * speed;
  }

  tick() {
    if (!this.enabled || !this.stops.length) return;
    const clock = this.adapter.clock;
    const st = this.adapter.getState();
    if (!st.ready) return;
    const now = this.now();

    // A seek / loop restart by the user: continue from there.
    if (clock.lastJumpPerf !== this.seenJump) {
      this.seenJump = clock.lastJumpPerf;
      if (now > this.selfSeekUntil) {
        this.cleared = this.adapter.getTime() - this.displayLead(st.speed || 1) - 0.02;
        if (this.state === 'waiting') { this.state = 'run'; this.target = null; this.message = ''; this.changed(); }
      }
    }

    if (this.state === 'waiting') {
      // You pressed play yourself: skip this note.
      if (st.shouldPlay && now > this.resumeGuardUntil) {
        this.cleared = this.target.t;
        this.state = 'run';
        this.target = null;
        this.message = '';
        this.changed();
      }
      return;
    }

    if (!st.shouldPlay || !st.playing) return;
    const target = this.nextStop();
    if (!target) return;
    const speed = st.speed || 1;
    const lead = this.displayLead(speed);
    const t = this.adapter.getTime();
    if (t >= target.t + lead - PAUSE_EARLY * speed) {
      this.state = 'waiting';
      this.target = target;
      this.attempts = 0;
      this.waitStart = now;
      this.resumeGuardUntil = now + 400; // the player may still report "playing" briefly
      this.adapter.pause();
      this.selfSeekUntil = now + SELF_SEEK_MS;
      this.adapter.seek(target.t + lead);
      this.message = this.describe(target);
      this.changed();
    }
  }

  describe(note) {
    const chart = this.adapter.getChart();
    const stringName = chart ? noteNameNoOctave(chart.instrument.tuning[note.string]) : '';
    if (note.flags.dead) return `Play a muted note (x) on the ${stringName} string`;
    return `Play ${noteName(note.midi)} · ${note.fret === 0 ? 'open' : `fret ${note.fret}`} on the ${stringName} string`;
  }

  onPlayed(ev) {
    if (!this.enabled || this.state !== 'waiting' || !this.target || !this.scorer) return;
    if (ev.perf < this.waitStart - 50) return; // played before the stop
    const m = this.scorer.pitchMatch(ev, this.target);
    if (ev.legato && !this.target.flags.hopo && !m) return; // pitch drifting while ringing
    if (m) {
      this.stats.notes++;
      if (!this.attempts) this.stats.firstTry++;
      this.cleared = this.target.t;
      this.state = 'run';
      this.target = null;
      this.message = '';
      this.adapter.play();
      this.changed();
    } else if (!ev.legato && ev.midi !== null && ev.midi !== undefined) {
      this.attempts++;
      this.stats.wrong++;
      this.message = `${this.describe(this.target)}  (you played ${noteName(ev.midi)})`;
      this.changed();
    }
  }
}
