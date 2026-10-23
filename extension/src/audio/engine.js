// Audio engine: owns the AudioContext, the Real Tone Cable input stream, the
// pitch worklet and the monitoring path.
//
//   cable ─ MediaStreamSource ─┬─ pitch worklet ─ (silent) ─ destination
//                              └─ monitor gain (default 0) ─ destination
//
// Emits: 'frame', 'onset', 'level' (from the worklet), 'state', 'devices'.

const WORKLET_URL = new URL('./pitch-worklet.js', import.meta.url).href;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.monitor = null;
    this.listeners = new Map();
    this.running = false;
    this.deviceId = '';
    this.deviceLabel = '';
    this.minFreq = 36;
    this.monitorLevel = 0;
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

  async listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  }

  // Find the saved device again: deviceIds can change after a Windows/Chrome
  // update, so fall back to the label, then to anything that looks like the
  // Real Tone Cable.
  async resolveDevice(savedId, savedLabel) {
    const inputs = await this.listInputs();
    return (
      inputs.find((d) => savedId && d.deviceId === savedId) ||
      inputs.find((d) => savedLabel && d.label === savedLabel) ||
      inputs.find((d) => /rocksmith|real ?tone/i.test(d.label)) ||
      null
    );
  }

  async start({ deviceId = '', deviceLabel = '', minFreq } = {}) {
    if (minFreq) this.minFreq = minFreq;
    await this.stop();

    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      await this.loadWorklet();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();

    let id = deviceId;
    try {
      this.stream = await this.openStream(id);
    } catch (err) {
      // A saved device that no longer exists: open the default input first
      // (this also grants permission so device labels become visible).
      if (!id || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
      id = '';
      this.stream = await this.openStream('');
    }
    if (!id) {
      // Prefer the device with the saved name, or anything that looks like the cable.
      const cable = await this.resolveDevice('', deviceLabel);
      if (cable && cable.deviceId !== this.trackDeviceId()) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = await this.openStream(cable.deviceId);
      }
    }
    this.emit('devices', await this.listInputs());

    const track = this.stream.getAudioTracks()[0];
    this.deviceId = this.trackDeviceId();
    this.deviceLabel = track.label;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'bass-trainer-pitch', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { minFreq: this.minFreq },
    });
    this.node.port.onmessage = (e) => this.emit(e.data.type, e.data);
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination); // outputs silence; keeps it processing

    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = this.monitorLevel;
    this.source.connect(this.monitor);
    this.monitor.connect(this.ctx.destination);

    track.addEventListener('ended', () => {
      this.running = false;
      this.emit('state', this.describe('Input disconnected. Plug the cable back in and press Start.'));
    });

    this.running = true;
    this.emit('state', this.describe());
    return this.describe();
  }

  async openStream(deviceId) {
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      // Ask Chrome not to add its own input latency buffer.
      latency: { ideal: 0 },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }

  trackDeviceId() {
    const track = this.stream && this.stream.getAudioTracks()[0];
    return (track && track.getSettings().deviceId) || '';
  }

  async loadWorklet() {
    try {
      await this.ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      // Fallback if a page policy blocks loading from the extension URL.
      const code = await (await fetch(WORKLET_URL)).text();
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(blobUrl);
    }
  }

  async stop() {
    if (this.source) this.source.disconnect();
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); }
    if (this.monitor) this.monitor.disconnect();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.source = this.node = this.monitor = this.stream = null;
    if (this.running) {
      this.running = false;
      this.emit('state', this.describe());
    }
  }

  setMinFreq(minFreq) {
    this.minFreq = minFreq;
    if (this.node) this.node.port.postMessage({ type: 'config', minFreq });
  }

  // 0..1. Uses a short ramp to avoid clicks.
  setMonitorLevel(level) {
    this.monitorLevel = level;
    if (this.monitor) {
      const g = this.monitor.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }
  }

  // Schedule a metronome click at AudioContext time `when`.
  click(when, accent = false) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  describe(message = '') {
    const ctx = this.ctx;
    const track = this.stream && this.stream.getAudioTracks()[0];
    const settings = track ? track.getSettings() : {};
    return {
      running: this.running,
      message,
      deviceId: this.deviceId,
      deviceLabel: this.deviceLabel,
      sampleRate: ctx ? ctx.sampleRate : 0,
      // What Chrome reports about its own buffering (does not include the
      // wireless headset or the input path; calibration measures the total).
      baseLatencyMs: ctx ? Math.round((ctx.baseLatency || 0) * 1000) : 0,
      outputLatencyMs: ctx ? Math.round((ctx.outputLatency || 0) * 1000) : 0,
      processing: {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      },
    };
  }
}
