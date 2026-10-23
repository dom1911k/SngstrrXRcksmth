// Takes: record what you play and listen back to it together with the song.
//
// While "Record takes" is on and the input runs, the raw cable signal is
// recorded (audio/pitch-worklet.js, RecorderProcessor). Each stretch of
// uninterrupted playback (until a pause, seek, loop restart or speed change)
// becomes one take. A take remembers which song time each of its samples
// belongs to, using the same latency correction as scoring, so playback
// lines up with the song the way you played it (to the song you heard).
//
// Playback: the song plays from just before the take; the take is scheduled
// in the AudioContext so that its sample for song time s is rendered when the
// player is at s, and resynced if it drifts or the player jumps.

import { getSettings, totalLatencyMs } from './settings.js';

const MAX_TAKES = 6;
const MIN_TAKE_S = 1.5;
const KEEP_CHUNKS_S = 3;      // raw chunks kept until they are assigned to a take
const PREROLL_S = 1.0;
const RESYNC_S = 0.03;

// Song time (as you meant to play it) of take-relative time x (seconds).
export function takeSongTime(take, x) {
  return take.sRef + (take.ctxStart + x - take.cRef) * take.speed;
}

// Take-relative time for song time s.
export function takeOffsetFor(take, s) {
  return (s - take.sRef) / take.speed + take.cRef - take.ctxStart;
}

// 16-bit mono WAV.
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Cut [c0, c1) (AudioContext seconds) out of stamped chunks.
export function sliceChunks(chunks, c0, c1, sampleRate) {
  const n = Math.max(0, Math.round((c1 - c0) * sampleRate));
  const out = new Float32Array(n);
  for (const ch of chunks) {
    const start = Math.round((ch.t - c0) * sampleRate);
    for (let i = Math.max(0, -start); i < ch.data.length && start + i < n; i++) out[start + i] = ch.data[i];
  }
  return out;
}

export class Takes {
  constructor(engine, adapter, session, { notify = () => {}, autoTick = true } = {}) {
    this.engine = engine;
    this.adapter = adapter;
    this.session = session;
    this.notify = notify;
    this.armed = false;
    this.takes = [];
    this.chunks = [];
    this.current = null;        // take being recorded
    this.pending = [];          // finished takes waiting for their last chunks
    this.playback = null;       // { take, source, gain, ... }
    this.volume = 1;
    this.seq = 0;
    this.listeners = new Set();
    engine.on('state', (st) => { if (!st.running) { this.stopRecording(); this.setArmed(false, true); } });
    adapter.on('chart', () => { this.stopPlayback(); this.takes = []; this.changed(); });
    if (autoTick) {
      const loop = () => { requestAnimationFrame(loop); this.tick(); };
      requestAnimationFrame(loop);
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this); }

  get ctx() { return this.engine.ctx; }
  perfToCtx(perf) { return (perf - this.engine.ctxToPerf(0)) / 1000; }

  setArmed(on, quiet = false) {
    if (on && !this.engine.running) { this.notify('Start the input first to record takes'); on = false; }
    if (on === this.armed) { this.changed(); return; }
    this.armed = on;
    if (on) {
      this.engine.setRecording(true, (c) => this.onChunk(c));
    } else {
      this.stopRecording();
      if (this.engine.running) this.engine.setRecording(false);
    }
    if (!quiet) this.notify(on ? 'Recording takes: play, and every run is kept' : 'Take recording off');
    this.changed();
  }

  onChunk(c) {
    this.chunks.push(c);
    // Between takes, keep only a short history.
    if (!this.current && !this.pending.length && this.ctx) {
      const cutoff = this.ctx.currentTime - KEEP_CHUNKS_S;
      while (this.chunks.length && this.chunks[0].t < cutoff) this.chunks.shift();
    }
  }

  tick() {
    const clock = this.adapter.clock;
    const now = performance.now();
    if (this.armed && this.engine.running && !this.playback) {
      const st = this.adapter.getState();
      const lat = totalLatencyMs(getSettings());
      if (this.current) {
        const c = this.current;
        if (!clock.playing || clock.lastJumpPerf !== c.jump || clock.speed !== c.speed) this.stopRecording(now);
        else {
          // Reference point for the song-time mapping (refreshed every frame).
          c.cRef = this.perfToCtx(now);
          c.sRef = clock.estimate(now) - (lat / 1000) * clock.speed;
          c.songEnd = clock.estimate(now);
        }
      }
      if (!this.current && clock.playing && st.ready) {
        this.current = {
          id: ++this.seq,
          ctxStart: this.perfToCtx(now),
          jump: clock.lastJumpPerf,
          speed: clock.speed,
          cRef: this.perfToCtx(now),
          sRef: clock.estimate(now) - (lat / 1000) * clock.speed,
          songStart: clock.estimate(now),
          loop: st.loop,
        };
      }
    }
    // Finish takes once their last chunks have arrived.
    const ctx = this.ctx;
    if (ctx && this.pending.length) {
      const ready = this.pending.filter((p) => ctx.currentTime > p.ctxEnd + 0.25);
      for (const p of ready) this.finish(p);
      this.pending = this.pending.filter((p) => !ready.includes(p));
    }
    if (this.playback) this.tickPlayback(now);
  }

  stopRecording(now = performance.now()) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    c.ctxEnd = this.perfToCtx(now);
    if (c.ctxEnd - c.ctxStart >= MIN_TAKE_S) this.pending.push(c);
  }

  finish(c) {
    const sr = this.ctx.sampleRate;
    const samples = sliceChunks(this.chunks.filter((ch) => ch.t + ch.data.length / sr > c.ctxStart && ch.t < c.ctxEnd), c.ctxStart, c.ctxEnd, sr);
    const chart = this.adapter.getChart();
    const barOf = (t) => {
      const bars = chart ? chart.bars : [];
      let b = null;
      for (const x of bars) { if (x.t <= t + 1e-3) b = x; else break; }
      return b ? b.measure + 1 : 1;
    };
    const take = {
      id: c.id, speed: c.speed, ctxStart: c.ctxStart, cRef: c.cRef, sRef: c.sRef,
      sampleRate: sr, samples, duration: samples.length / sr,
      recordedAt: Date.now(),
    };
    take.songStart = takeSongTime(take, 0);
    take.songEnd = takeSongTime(take, take.duration);
    take.label = `Bars ${barOf(Math.max(0, take.songStart))}–${barOf(take.songEnd)} · ${Math.round(take.duration)} s${Math.abs(take.speed - 1) > 0.001 ? ` · ${Math.round(take.speed * 100)}%` : ''}`;
    this.takes.unshift(take);
    if (this.takes.length > MAX_TAKES) this.takes.length = MAX_TAKES;
    // Drop chunks nobody needs any more.
    const keepFrom = Math.min(...this.pending.filter((p) => p !== c).map((p) => p.ctxStart), this.current ? this.current.ctxStart : Infinity, this.ctx.currentTime - KEEP_CHUNKS_S);
    this.chunks = this.chunks.filter((ch) => ch.t + ch.data.length / sr >= keepFrom);
    this.changed();
  }

  remove(take) {
    if (this.playback && this.playback.take === take) this.stopPlayback();
    this.takes = this.takes.filter((t) => t !== take);
    this.changed();
  }

  download(take) {
    const chart = this.adapter.getChart();
    const title = chart && chart.meta && chart.meta.title ? chart.meta.title.replace(/[^\w\- ]+/g, '').trim() : 'take';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(encodeWav(take.samples, take.sampleRate));
    a.download = `${title} - take ${take.id}.wav`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---- playback with the song ----
  async play(take) {
    if (!this.ctx) { this.notify('Start the input once so audio can play'); return; }
    this.stopPlayback();
    if (this.armed) this.setArmed(false, true);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const buffer = this.ctx.createBuffer(1, take.samples.length, take.sampleRate);
    buffer.copyToChannel(take.samples, 0);
    const gain = this.ctx.createGain();
    gain.gain.value = this.volume;
    gain.connect(this.ctx.destination);
    this.playback = { take, buffer, gain, source: null, checkAt: 0 };
    this.session.suspend('take', true);
    const st = this.adapter.getState();
    if (Math.abs((st.speed || 1) - take.speed) > 0.001) this.adapter.setSpeed(Math.round(take.speed * 100));
    if (st.loop && (take.songStart < st.loop.start - 0.5 || take.songEnd > st.loop.end + 0.5)) this.adapter.clearLoop();
    this.adapter.seek(Math.max(0, take.songStart - PREROLL_S * take.speed));
    if (this.adapter.suppressCountIn) this.adapter.suppressCountIn(true, 'take');
    setTimeout(() => this.adapter.play(), 120);
    this.notify(`Playing take ${take.id} with the song`);
    this.changed();
  }

  setVolume(v) {
    this.volume = v;
    if (this.playback) this.playback.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  stopSource() {
    const p = this.playback;
    if (p && p.source) { try { p.source.stop(); } catch { /* already stopped */ } p.source.disconnect(); p.source = null; }
  }

  stopPlayback() {
    if (!this.playback) return;
    this.stopSource();
    this.playback.gain.disconnect();
    this.playback = null;
    this.session.suspend('take', false);
    if (this.adapter.suppressCountIn) this.adapter.suppressCountIn(false, 'take');
    this.changed();
  }

  tickPlayback(now) {
    const p = this.playback;
    const clock = this.adapter.clock;
    const take = p.take;
    this.engine.updateClockMap();
    const ok = clock.playing && Math.abs(clock.speed - take.speed) < 0.001;
    if (!ok || clock.lastJumpPerf !== p.jump) {
      this.stopSource();
      p.jump = clock.lastJumpPerf;
      if (!ok) return;
    }
    const s = clock.estimate(now);
    if (s > take.songEnd + 0.4) { this.adapter.pause(); this.stopPlayback(); this.notify('End of the take'); return; }
    const ctx = this.ctx;
    if (p.source) {
      if (now < p.checkAt) return;
      p.checkAt = now + 500;
      // Drift check: where the take is vs. where it should be.
      const actual = ctx.currentTime - p.startCtx + p.startOffset;
      const expected = takeOffsetFor(take, clock.estimate(this.engine.ctxToPerf(ctx.currentTime)));
      if (Math.abs(actual - expected) <= RESYNC_S) return;
      this.stopSource();
    }
    // (Re)start: line the take up with the song from a moment shortly ahead.
    const startCtx = ctx.currentTime + 0.08;
    const sAt = clock.estimate(this.engine.ctxToPerf(startCtx));
    let offset = takeOffsetFor(take, sAt);
    let when = startCtx;
    if (offset < 0) { when -= offset; offset = 0; }
    if (offset >= take.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = p.buffer;
    src.connect(p.gain);
    src.start(when, offset);
    p.source = src;
    p.startCtx = when;
    p.startOffset = offset;
    p.checkAt = now + 500;
  }
}
