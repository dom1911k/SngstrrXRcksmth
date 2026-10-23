// Local player adapter: plays a chart (bass-chart JSON) together with a local
// audio file, without Songsterr. Same interface as the Songsterr adapter, so
// the highway, panel and (later) scoring work unchanged.
//
// Time source: an <audio> element (pitch-preserving speed changes). Without an
// audio file, a silent virtual clock runs instead so charts can be practised
// or checked on their own.

import { SongClock } from '../../core/clock.js';
import { validateChart, normalizeChart } from '../../core/chart.js';
import { getSettings, updateSettings } from '../../core/settings.js';

export class LocalAdapter {
  constructor() {
    this.name = 'local player';
    this.listeners = new Map();
    this.clock = new SongClock();
    this.status = { state: 'ok', detail: '' };
    this.chart = null;
    this.audio = new Audio();
    this.audio.preservesPitch = true;
    this.audioName = '';
    this.offset = 0;           // seconds: chart time 0 happens at audio time `offset`
    this.speed = 1;
    this.loop = null;
    this.virtual = { playing: false, base: 0, perf: 0 };
    this.counting = null;      // count-in in progress: { timer, until }
    this.audio.addEventListener('ended', () => this.emit('pause', this.getState()));
    this.audio.addEventListener('error', () => this.emit('error', 'This audio file cannot be played by Chrome (try MP3, OGG, WAV, M4A or FLAC).'));
  }

  start() {
    const tick = () => {
      requestAnimationFrame(tick);
      const time = this.rawTime();
      if (this.loop && this.isPlaying() && time >= this.loop.end) {
        this.seek(this.loop.start);
        if (this.settingOr('countInLoops', true) && !this.countInSuppressed) { this.stopPlayback(); this.startWithCountIn(); }
      }
      // Without an audio file (drills, charts on their own) stop after the end.
      if (!this.hasAudio() && this.isPlaying() && this.chart && !this.loop && time > this.chart.duration + 1.5) this.pause();
      this.clock.update({ perf: performance.now(), time: this.rawTime(), playing: this.isPlaying(), speed: this.speed });
      this.tickMetronome();
    };
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

  hasAudio() { return !!this.audio.src; }

  isPlaying() {
    return this.hasAudio() ? !this.audio.paused && !this.audio.ended : this.virtual.playing;
  }

  rawTime() {
    if (this.hasAudio()) return this.audio.currentTime - this.offset;
    const v = this.virtual;
    return v.playing ? v.base + ((performance.now() - v.perf) / 1000) * this.speed : v.base;
  }

  // ---- loading ----
  loadChartText(text, fileName = '') {
    let chart;
    try {
      chart = JSON.parse(text);
    } catch (err) {
      throw new Error(`${fileName || 'The file'} is not valid JSON: ${err.message}`);
    }
    const errors = validateChart(chart);
    if (errors.length) throw new Error(`${fileName || 'The chart'} is not a valid bass chart:\n• ${errors.join('\n• ')}`);
    this.setChart(normalizeChart(chart));
  }

  setChart(chart) {
    this.chart = chart;
    this.pause();
    this.seek(0);
    this.emit('chart', {
      chart,
      warnings: [],
      isBassLike: true,
      bassTracks: [],
      track: { instrument: chart.meta && chart.meta.instrument || 'Bass', name: chart.meta && chart.meta.track || '' },
      title: (chart.meta && chart.meta.title) || 'Untitled',
      artist: (chart.meta && chart.meta.artist) || '',
    });
  }

  loadAudioFile(file) {
    if (this.audio.src) URL.revokeObjectURL(this.audio.src);
    this.pause();
    this.audio.src = URL.createObjectURL(file);
    this.audio.playbackRate = this.speed;
    this.audioName = file.name;
    this.lastFile = file;
    this.emit('audio', { name: file.name });
  }

  setOffset(seconds) {
    this.offset = seconds;
    this.emit('seek', {});
  }

  duration() {
    const chartEnd = this.chart ? this.chart.duration : 0;
    const audioEnd = this.hasAudio() && Number.isFinite(this.audio.duration) ? this.audio.duration - this.offset : 0;
    return Math.max(chartEnd, audioEnd);
  }

  // ---- adapter interface ----
  getChart() { return this.chart; }
  getTime() { return this.clock.now(); }

  getState() {
    return {
      ready: true,
      playing: this.isPlaying(),
      shouldPlay: this.isPlaying() || !!this.counting,
      countIn: !!this.counting,
      countInEnabled: this.settingOr('countIn', true),
      countInLoopsEnabled: this.settingOr('countInLoops', true),
      bassMuted: false,
      canMute: false,
      speed: this.speed,
      loop: this.loop,
      playerType: this.hasAudio() ? 'audio file' : 'no audio',
      songsterrLatencyMs: 0,
      partsMute: [],
    };
  }

  settingOr(key, fallback) {
    try { return getSettings()[key]; } catch { return fallback; }
  }

  play() {
    if (this.counting || this.isPlaying()) return;
    if (this.settingOr('countIn', true) && !this.countInSuppressed) this.startWithCountIn();
    else this.startPlayback();
  }

  // ---- metronome (drills, or switched on in the player) ----
  metronomeOn() { return this.metronome || !!(this.chart && this.chart.meta && this.chart.meta.metronome); }
  setMetronome(on) { this.metronome = on; this.metroNext = null; }

  audioCtx() {
    if (!this.clickCtx) this.clickCtx = new AudioContext({ latencyHint: 'interactive' });
    if (this.clickCtx.state !== 'running') this.clickCtx.resume();
    return this.clickCtx;
  }

  click(when, accent) {
    const ctx = this.audioCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.7 : 0.45, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  // Schedules the clicks of the next ~0.2 s of beats (song time -> context time).
  tickMetronome() {
    const beats = this.chart ? this.chart.beats : null;
    if (!this.metronomeOn() || !beats || !beats.length || !this.isPlaying()) { this.metroNext = null; return; }
    const now = this.rawTime();
    if (this.metroNext === null || this.metroNext === undefined || this.metroJump !== this.clock.lastJumpPerf) {
      this.metroJump = this.clock.lastJumpPerf;
      let i = 0;
      while (i < beats.length && beats[i].t < now - 0.005) i++;
      this.metroNext = i;
    }
    const ctx = this.audioCtx();
    while (this.metroNext < beats.length && beats[this.metroNext].t <= now + 0.2 * this.speed) {
      const b = beats[this.metroNext++];
      const when = ctx.currentTime + Math.max(0, (b.t - now) / this.speed);
      this.click(when, b.downbeat);
    }
  }

  // One bar of clicks at the song's tempo (and current speed), then play.
  startWithCountIn() {
    const t = this.rawTime();
    const bars = this.chart ? this.chart.bars : [];
    let bar = bars[0];
    for (const b of bars) { if (b.t <= t + 1e-3) bar = b; else break; }
    const beats = bar && bar.sig ? bar.sig[0] : 4;
    const bpm = (bar && bar.bpm) || 120;
    const beat = 60 / bpm / this.speed;
    const ctx = this.audioCtx();
    const start = ctx.currentTime + 0.08;
    for (let i = 0; i < beats; i++) this.click(start + i * beat, i === 0);
    const ms = (0.08 + beats * beat) * 1000;
    this.counting = { until: performance.now() + ms, timer: setTimeout(() => { this.counting = null; this.startPlayback(); }, ms) };
    this.emit('play', this.getState());
  }

  stopPlayback() {
    if (this.hasAudio()) this.audio.pause();
    else this.virtual = { playing: false, base: this.rawTime(), perf: performance.now() };
  }

  startPlayback() {
    if (this.hasAudio()) {
      // Before the audio starts (negative chart time) just seek to its start.
      this.audio.play().catch((err) => this.emit('error', `Could not play audio: ${err.message}`));
    } else {
      this.virtual = { playing: true, base: this.rawTime(), perf: performance.now() };
    }
    this.emit('play', this.getState());
  }

  pause() {
    if (this.counting) { clearTimeout(this.counting.timer); this.counting = null; }
    this.stopPlayback();
    this.emit('pause', this.getState());
  }

  toggle() { if (this.isPlaying() || this.counting) this.pause(); else this.play(); }

  seek(t) {
    const target = Math.max(-this.offset, Math.min(t, this.duration() || t));
    if (this.hasAudio()) this.audio.currentTime = Math.max(0, target + this.offset);
    else this.virtual = { ...this.virtual, base: target, perf: performance.now() };
    this.emit('seek', { to: target });
  }

  setLoop(a, b) {
    this.loop = b > a ? { start: a, end: b } : null;
    this.emit('loop', this.getState());
  }

  clearLoop() { this.setLoop(0, 0); }

  setSpeed(pct) {
    const t = this.rawTime();
    this.speed = Math.max(0.25, Math.min(1.5, pct / 100));
    if (this.hasAudio()) this.audio.playbackRate = this.speed;
    else this.virtual = { ...this.virtual, base: t, perf: performance.now() };
    this.emit('speed', this.getState());
  }

  switchTrack() { /* not applicable */ }

  // A local audio file can't be split into instruments.
  setBassMuted() { return Promise.resolve('local'); }

  // Several tools can ask at once (reason = 'wait' | 'take').
  suppressCountIn(on, reason = 'default') {
    this.countInBy = this.countInBy || new Set();
    if (on) this.countInBy.add(reason); else this.countInBy.delete(reason);
    this.countInSuppressed = this.countInBy.size > 0;
  }

  setCountIn({ before, loops }) { updateSettings({ countIn: before, countInLoops: loops }); }
}
