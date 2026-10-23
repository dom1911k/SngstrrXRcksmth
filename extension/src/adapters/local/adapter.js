// Local player adapter: plays a chart (bass-chart JSON) together with a local
// audio file, without Songsterr. Same interface as the Songsterr adapter, so
// the highway, panel and (later) scoring work unchanged.
//
// Time source: an <audio> element (pitch-preserving speed changes). Without an
// audio file, a silent virtual clock runs instead so charts can be practised
// or checked on their own.

import { SongClock } from '../../core/clock.js';
import { validateChart, normalizeChart } from '../../core/chart.js';

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
    this.audio.addEventListener('ended', () => this.emit('pause', this.getState()));
    this.audio.addEventListener('error', () => this.emit('error', 'This audio file cannot be played by Chrome (try MP3, OGG, WAV, M4A or FLAC).'));
  }

  start() {
    const tick = () => {
      requestAnimationFrame(tick);
      const time = this.rawTime();
      if (this.loop && this.isPlaying() && time >= this.loop.end) this.seek(this.loop.start);
      this.clock.update({ perf: performance.now(), time: this.rawTime(), playing: this.isPlaying(), speed: this.speed });
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
      shouldPlay: this.isPlaying(),
      countIn: false,
      speed: this.speed,
      loop: this.loop,
      playerType: this.hasAudio() ? 'audio file' : 'no audio',
      songsterrLatencyMs: 0,
      partsMute: [],
    };
  }

  play() {
    if (this.hasAudio()) {
      // Before the audio starts (negative chart time) just seek to its start.
      this.audio.play().catch((err) => this.emit('error', `Could not play audio: ${err.message}`));
    } else {
      this.virtual = { playing: true, base: this.rawTime(), perf: performance.now() };
    }
    this.emit('play', this.getState());
  }

  pause() {
    if (this.hasAudio()) this.audio.pause();
    else this.virtual = { playing: false, base: this.rawTime(), perf: performance.now() };
    this.emit('pause', this.getState());
  }

  toggle() { if (this.isPlaying()) this.pause(); else this.play(); }

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
}
