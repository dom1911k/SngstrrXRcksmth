// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProcessor, pluck, silence, concat, mixAt } from './worklet-harness.mjs';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const cents = (f, ref) => 1200 * Math.log2(f / ref);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function stablePitch(messages, from, to) {
  const f = messages.filter((m) => m.type === 'frame' && m.t >= from && m.t <= to && m.f0 > 0 && m.clarity > 0.9);
  return f.length ? median(f.map((m) => m.f0)) : 0;
}

for (const sr of [48000, 44100]) {
  test(`open strings and frets detected within 2 cents @${sr}`, () => {
    // Low E open, A, D, G, plus high frets and a detuned string.
    const cases = [28, 33, 38, 43, 40, 55, 67].map((m) => ({ m, f: midiToFreq(m) }));
    cases.push({ m: 28, f: midiToFreq(28) * Math.pow(2, 7 / 1200) }); // E +7 cents
    for (const { m, f } of cases) {
      const p = createProcessor({ sampleRate: sr });
      p.feed(concat(silence(0.2, sr), pluck({ freq: f, dur: 1.2, sampleRate: sr })));
      const got = stablePitch(p.messages, 0.4, 1.3);
      assert.ok(got > 0, `no pitch for midi ${m}`);
      const err = cents(got, f);
      assert.ok(Math.abs(err) < 2, `midi ${m}: ${got.toFixed(3)} Hz vs ${f.toFixed(3)} (${err.toFixed(2)} cents)`);
    }
  });
}

test('weak fundamental does not cause octave-up error on low E', () => {
  const f = midiToFreq(28);
  const p = createProcessor();
  p.feed(concat(silence(0.2), pluck({ freq: f, dur: 1.0, harmonics: [0.35, 1, 0.6, 0.4, 0.2] })));
  const got = stablePitch(p.messages, 0.4, 1.1);
  assert.ok(Math.abs(cents(got, f)) < 5, `got ${got} Hz expected ${f}`);
});

test('5-string low B detected when configured', () => {
  const f = midiToFreq(23);
  const p = createProcessor({ minFreq: midiToFreq(21) });
  p.feed(concat(silence(0.2), pluck({ freq: f, dur: 1.2 })));
  const got = stablePitch(p.messages, 0.45, 1.3);
  assert.ok(Math.abs(cents(got, f)) < 3, `got ${got} expected ${f}`);
});

test('pitch locks quickly after the attack (low E within 80 ms)', () => {
  const f = midiToFreq(28);
  const p = createProcessor();
  p.feed(concat(silence(0.3), pluck({ freq: f, dur: 0.5 })));
  const first = p.messages.find((m) => m.type === 'frame' && m.t > 0.3 && m.f0 > 0 && m.clarity > 0.9 && Math.abs(cents(m.f0, f)) < 30);
  assert.ok(first, 'never locked');
  const delay = first.t - 0.3;
  assert.ok(delay < 0.08, `lock delay ${(delay * 1000).toFixed(1)} ms`);
});

test('onsets: timing within 6 ms, one onset per pluck, repeated same note re-triggers', () => {
  const sr = 48000;
  const sig = silence(3.0, sr);
  const times = [0.3, 0.8, 1.05, 1.3, 1.55, 2.2];
  const freqs = [28, 28, 28, 33, 33, 43].map(midiToFreq);
  // Each pluck rings into the next (no muting), like a real bass.
  times.forEach((t, i) => mixAt(sig, pluck({ freq: freqs[i], dur: 3.0 - t, seed: i + 3 }), t, sr));
  const p = createProcessor({ sampleRate: sr });
  p.feed(sig);
  const onsets = p.messages.filter((m) => m.type === 'onset').map((m) => m.t);
  assert.equal(onsets.length, times.length, `onsets ${onsets.map((t) => t.toFixed(3))}`);
  onsets.forEach((t, i) => assert.ok(Math.abs(t - times[i]) < 0.006, `onset ${i}: ${t} vs ${times[i]}`));
});

test('no onsets from silence/noise floor or a long decay', () => {
  const p = createProcessor();
  p.feed(concat(silence(0.5), pluck({ freq: midiToFreq(33), dur: 4 }), silence(1)));
  const onsets = p.messages.filter((m) => m.type === 'onset');
  assert.equal(onsets.length, 1);
});
