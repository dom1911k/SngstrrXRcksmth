// Synthesizes a bass performance of chart notes (for scoring tests).
import { writeFileSync } from 'node:fs';
import { pluck } from './worklet-harness.mjs';
import { midiToFreq } from '../extension/src/core/music.js';

// Notes in [from, to) are rendered starting `lead` seconds into the audio.
// perform(note, i) -> { t, midi, skip, dead, legato } overrides.
export function renderPerformance(chart, from, to, { sampleRate = 48000, lead = 0.5, perform = () => ({}) } = {}) {
  const dur = to - from + lead + 1;
  const out = new Float32Array(Math.round(dur * sampleRate));
  let s = 1;
  for (let i = 0; i < out.length; i++) { s = (s * 16807) % 2147483647; out[i] = 0.0004 * (s / 2147483647 - 0.5); }
  const notes = chart.notes.filter((n) => n.t >= from && n.t < to && !n.flags.ghost);
  notes.forEach((n, i) => {
    const p = perform(n, i);
    if (p.skip) return;
    const next = notes[i + 1];
    const len = Math.max(0.06, Math.min(n.dur, next ? next.t - n.t : n.dur) - 0.01);
    let sig;
    if (n.flags.dead || p.dead) {
      sig = pluck({ freq: midiToFreq(n.midi), dur: 0.05, sampleRate, harmonics: [0.15, 0.1], noise: 0.5, seed: i + 5 });
    } else {
      sig = pluck({ freq: midiToFreq(p.midi ?? n.midi), dur: len + 0.02, sampleRate, noise: (n.flags.hopo || p.legato) ? 0 : 0.15, seed: i + 5 });
      const fade = Math.round(0.02 * sampleRate);
      for (let k = 0; k < fade; k++) sig[sig.length - 1 - k] *= k / fade;
    }
    const off = Math.round(((p.t ?? n.t) - from + lead) * sampleRate);
    for (let k = 0; k < sig.length && off + k < out.length; k++) out[off + k] += sig[k];
  });
  return { audio: out, startOffset: from - lead, notes };
}

export function writeWav(path, samples, sampleRate = 48000) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}
