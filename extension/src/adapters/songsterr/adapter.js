// Songsterr adapter, extension side. Talks to page-bridge.js (page world)
// via window.postMessage and exposes the generic Player Adapter interface
// that the rest of the trainer uses (times in chart seconds):
//
//   getChart(), getTime(), getState(), on(event, fn)
//   play(), pause(), seek(t), setLoop(a, b), clearLoop(), setSpeed(pct), switchTrack(partId)
//   events: 'status', 'chart', 'play', 'pause', 'seek', 'loop', 'speed'

import { SongClock } from '../../core/clock.js';
import { songsterrToChart, bassLikeTracks } from './to-chart.js';

const FROM_BRIDGE = 'bass-trainer-bridge';
const TO_BRIDGE = 'bass-trainer-ext';

export class SongsterrAdapter {
  constructor() {
    this.name = 'Songsterr player';
    this.listeners = new Map();
    this.clock = new SongClock();
    this.status = { state: 'starting', detail: 'Connecting to Songsterr…' };
    this.sample = null;
    this.chart = null;
    this.chartInfo = null;
    this.songKey = '';
    this.requestId = 0;
    this.lastTickAt = 0;
    this.onMessage = this.onMessage.bind(this);
  }

  start() {
    window.addEventListener('message', this.onMessage);
    // If the bridge has gone quiet (e.g. Songsterr changed), say so.
    this.watchdog = setInterval(() => {
      if (this.status.state === 'ok' && performance.now() - this.lastTickAt > 3000 && document.visibilityState === 'visible') {
        this.setStatus({ state: 'searching', detail: 'No updates from the Songsterr player.' });
      }
    }, 1000);
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

  setStatus(st) {
    if (st.state === this.status.state && st.detail === this.status.detail) return;
    this.status = st;
    this.emit('status', st);
  }

  send(msg) {
    window.postMessage({ source: TO_BRIDGE, ...msg }, location.origin);
  }

  onMessage(e) {
    if (e.source !== window || !e.data || e.data.source !== FROM_BRIDGE) return;
    const msg = e.data;
    if (msg.type === 'status') {
      this.setStatus({ state: msg.state, detail: msg.detail });
    } else if (msg.type === 'tick') {
      this.onTick(msg);
    } else if (msg.type === 'song' && msg.requestId === this.requestId) {
      this.onSong(msg);
    } else if (msg.type === 'muteResult') {
      const resolve = this.muteWaiters && this.muteWaiters.get(msg.requestId);
      if (resolve) { this.muteWaiters.delete(msg.requestId); resolve(msg.result); }
    }
  }

  onTick(s) {
    this.lastTickAt = performance.now();
    if (this.status.state !== 'ok') this.setStatus({ state: 'ok', detail: '' });
    const prev = this.sample;
    this.sample = s;
    const speed = s.speed / 100;
    const time = s.cursor / 1000;
    const expected = prev && prev.playing ? prev.cursor / 1000 + ((s.perf - prev.perf) / 1000) * (prev.speed / 100) : prev ? prev.cursor / 1000 : time;
    this.clock.update({ perf: s.perf, time, playing: s.playing, speed });

    const key = `${s.songId}:${s.revisionId}:${s.partId}:${s.partGeneration}`;
    if (key !== this.songKey) {
      this.songKey = key;
      this.requestSong();
    }
    if (prev) {
      if (s.shouldPlay !== prev.shouldPlay) this.emit(s.shouldPlay ? 'play' : 'pause', this.getState());
      if (s.speed !== prev.speed) this.emit('speed', this.getState());
      if (s.loopStart !== prev.loopStart || s.loopEnd !== prev.loopEnd) this.emit('loop', this.getState());
      if (Math.abs(time - expected) > 0.25) this.emit('seek', { from: expected, to: time });
    }
  }

  requestSong() {
    this.requestId++;
    this.send({ type: 'getSong', requestId: this.requestId });
  }

  onSong(msg) {
    if (msg.error) {
      this.chart = null;
      this.chartInfo = { error: msg.error };
      // Tab still loading: try again shortly.
      setTimeout(() => this.requestSong(), 1000);
      this.emit('chart', this.chartInfo);
      return;
    }
    const song = msg.song;
    const bassTracks = bassLikeTracks(song.tracks);
    const current = song.tracks.find((t) => t.partId === song.partId);
    const isBassLike = bassTracks.some((t) => t.partId === song.partId);
    let chart = null, warnings = [], error = null;
    try {
      ({ chart, warnings } = songsterrToChart(song));
    } catch (err) {
      error = String(err.message || err);
    }
    this.chart = isBassLike ? chart : null;
    this.chartInfo = {
      chart, warnings, error, isBassLike, bassTracks,
      track: current, partId: song.partId, title: song.title, artist: song.artist,
    };
    this.emit('chart', this.chartInfo);
  }

  getChart() { return this.chart; }

  // Current song time in chart seconds (smoothed player clock).
  getTime() { return this.clock.now(); }

  getState() {
    const s = this.sample;
    if (!s) return { ready: false };
    return {
      ready: true,
      playing: s.playing,
      shouldPlay: s.shouldPlay,
      countIn: s.countIn,
      speed: s.speed / 100,
      loop: s.loopEnd > s.loopStart ? { start: s.loopStart / 1000, end: s.loopEnd / 1000 } : null,
      playerType: s.playerType,
      songsterrLatencyMs: s.latencyOffsetMs,
      partsMute: s.partsMute,
      partId: s.partId,
      bassMuted: (s.partsMute || []).includes(s.partId),
      countInEnabled: s.countInEnabled,
      countInLoopsEnabled: s.countInLoopsEnabled,
      videoOpened: s.videoOpened,
      hasPlus: s.hasPlus,
      canMute: !s.videoOpened && s.hasPlus,
    };
  }

  // Mute/unmute the shown (bass) track with Songsterr's own mute button.
  // Resolves 'ok' | 'unchanged' | 'video' (ORIG recording can't be muted) | 'no-plus' | 'timeout'.
  setBassMuted(mute) {
    this.muteWaiters = this.muteWaiters || new Map();
    const requestId = (this.muteSeq = (this.muteSeq || 0) + 1);
    return new Promise((resolve) => {
      this.muteWaiters.set(requestId, resolve);
      this.send({ type: 'command', cmd: 'muteShownTrack', args: { mute, requestId } });
      setTimeout(() => { if (this.muteWaiters.delete(requestId)) resolve('timeout'); }, 1500);
    });
  }

  setCountIn({ before, loops }) {
    this.send({ type: 'command', cmd: 'setCountIn', args: { before, loops } });
  }

  play() { this.send({ type: 'command', cmd: 'play' }); }
  pause() { this.send({ type: 'command', cmd: 'pause' }); }
  seek(t) { this.send({ type: 'command', cmd: 'seek', args: { ms: t * 1000 } }); }
  setLoop(a, b) { this.send({ type: 'command', cmd: 'setLoop', args: { startMs: a * 1000, endMs: b * 1000 } }); }
  clearLoop() { this.send({ type: 'command', cmd: 'clearLoop' }); }
  setSpeed(pct) { this.send({ type: 'command', cmd: 'setSpeed', args: { speed: pct } }); }
  switchTrack(partId) { this.send({ type: 'command', cmd: 'switchPart', args: { partId } }); }
}
