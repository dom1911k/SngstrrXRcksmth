// Generates a WAV of A-string plucks (+4 cents) every 2/3 s for browser tests.
import { writeFileSync } from 'node:fs';
import { pluck, silence, mixAt } from './worklet-harness.mjs';
const sr = 48000, dur = 12;
const sig = silence(dur, sr, 0.0005);
const f = 55 * Math.pow(2, 4 / 1200);
for (let t = 0.2; t < dur - 0.7; t += 60 / 90) mixAt(sig, pluck({ freq: f, dur: 0.6, sampleRate: sr }), t, sr);
const buf = Buffer.alloc(44 + sig.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + sig.length * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(sig.length * 2, 40);
for (let i = 0; i < sig.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sig[i] * 32767))), 44 + i * 2);
writeFileSync(process.argv[2], buf);
