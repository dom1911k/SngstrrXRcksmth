// Runs extension/src/audio/pitch-worklet.js in Node by stubbing the
// AudioWorkletGlobalScope, and feeds it synthetic audio.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = new URL('../extension/src/audio/pitch-worklet.js', import.meta.url);

export function createProcessor({ sampleRate = 48000, minFreq = 36 } = {}) {
  const messages = [];
  let Processor;
  const ctx = {
    sampleRate,
    currentTime: 0,
    Math, Float32Array, Infinity,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m), onmessage: null };
      }
    },
    registerProcessor: (_name, cls) => { Processor = cls; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(SRC, 'utf8'), ctx);
  const proc = new Processor({ processorOptions: { minFreq } });

  function feed(samples) {
    const Q = 128;
    let frame = Math.round(ctx.currentTime * sampleRate);
    for (let off = 0; off + Q <= samples.length; off += Q) {
      ctx.currentTime = frame / sampleRate;
      proc.process([[samples.subarray(off, off + Q)]], [[new Float32Array(Q)]]);
      frame += Q;
    }
    ctx.currentTime = frame / sampleRate;
  }
  return { proc, messages, feed, ctx, mpm: ctx.__bassTrainerMpm };
}

// Bass-like plucked note: harmonics with faster decay for higher partials,
// plus a short noise burst for the attack.
export function pluck({ freq, dur, sampleRate = 48000, amp = 0.3, harmonics = [1, 0.8, 0.5, 0.35, 0.2, 0.12], noise = 0.15, seed = 1 }) {
  const n = Math.round(dur * sampleRate);
  const out = new Float32Array(n);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const phases = harmonics.map((_, i) => (i * 1.3) % (2 * Math.PI));
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const decay = Math.exp(-t * (1.2 + h * 1.5));
      v += harmonics[h] * decay * Math.sin(2 * Math.PI * freq * (h + 1) * t + phases[h]);
    }
    const attack = Math.min(1, t / 0.002);
    v *= attack;
    if (t < 0.012) v += noise * rnd() * (1 - t / 0.012) * 2;
    out[i] = amp * v / 2;
  }
  return out;
}

export function silence(dur, sampleRate = 48000, level = 0.0003) {
  const out = new Float32Array(Math.round(dur * sampleRate));
  let s = 7;
  for (let i = 0; i < out.length; i++) { s = (s * 16807) % 2147483647; out[i] = level * (s / 2147483647 - 0.5); }
  return out;
}

export function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Mix b into a starting at time t (seconds).
export function mixAt(a, b, t, sampleRate = 48000) {
  const off = Math.round(t * sampleRate);
  for (let i = 0; i < b.length && off + i < a.length; i++) a[off + i] += b[i];
  return a;
}
