// Auto-sync for the RS2014 kit: where in your audio file does the chart start?
//
// The chart (from Songsterr) is timed to Songsterr's recording; your file may start
// earlier or later. analyzeAudio() makes two cheap features of the whole mix:
//   onset   a bass-band "something was plucked here" curve (5 ms steps)
//   chroma  how strong each of the 12 note names is in the low end (20 ms steps)
// estimateOffset() slides the chart over the audio and scores each position by how
// strongly the chart's notes sound in the low end while they are played (pitch), with
// the attacks as a tie-break. Rhythm alone is ambiguous (steady eighths fit one beat
// off just as well); the notes are not. The result is good to about 20 ms; the
// converter refines it on the separated bass.
//
//   offset = audio time of chart time 0 (the player's "Audio offset", the converter's chart_offset)

const TARGET_SR = 11025;
const ONSET_HOP = 0.005;   // s
const CHROMA_HOP = 0.02;   // s
const FFT_N = 4096;      // 0.37 s at 11 kHz: fine enough to tell E1 (41 Hz) from F1

// Plucked notes (not the second note of a hammer-on / pull-off / legato slide, not ghosts).
export function pluckedNotes(chart) {
  return chart.notes.filter((n) => !n.flags.ghost && !n.flags.hopo && !n.flags.slideTarget);
}

function downsample(samples, sr) {
  const f = Math.max(1, Math.round(sr / TARGET_SR));
  const out = new Float32Array(Math.floor(samples.length / f));
  for (let i = 0, j = 0; j < out.length; j++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += samples[i++];
    out[j] = s / f;
  }
  return { y: out, sr: sr / f };
}

// In-place radix-2 FFT (re, im of length n = power of two).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// samples: mono Float32Array at sampleRate.
export function analyzeAudio(samples, sampleRate) {
  const { y, sr } = downsample(samples, sampleRate);
  // Onset: low band (< ~300 Hz, two one-pole low-passes) energy, log rise per 5 ms step.
  const hop = Math.max(1, Math.round(ONSET_HOP * sr));
  const a = Math.exp((-2 * Math.PI * 300) / sr);
  let l1 = 0, l2 = 0;
  const frames = Math.floor(y.length / hop);
  const energy = new Float32Array(frames);
  for (let f = 0, i = 0; f < frames; f++) {
    let e = 0;
    for (let k = 0; k < hop; k++, i++) {
      l1 = a * l1 + (1 - a) * y[i];
      l2 = a * l2 + (1 - a) * l1;
      e += l2 * l2;
    }
    energy[f] = Math.log(1e-9 + e / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 2; f < frames; f++) onset[f] = Math.max(0, energy[f] - Math.max(energy[f - 1], energy[f - 2]));
  // Normalise (99th percentile -> 1) so loud and quiet files score alike.
  const sorted = Float32Array.from(onset).sort();
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 1;
  for (let f = 0; f < frames; f++) onset[f] = Math.min(1.5, onset[f] / p99);

  // Chroma of the bass range (40–300 Hz: fundamentals and the first harmonics), every 20 ms.
  const chop = Math.max(1, Math.round(CHROMA_HOP * sr));
  const cframes = Math.max(0, Math.floor((y.length - FFT_N) / chop) + 1);
  const chroma = Array.from({ length: 12 }, () => new Float32Array(cframes));
  // Each bin counts for its two nearest note names (weighted by distance), not just the
  // rounded one: the lowest notes are less than a bin apart.
  const binPc = new Int8Array(FFT_N / 2).fill(-1), binW = new Float32Array(FFT_N / 2);
  for (let b = 1; b < FFT_N / 2; b++) {
    const hz = (b * sr) / FFT_N;
    if (hz < 38 || hz > 300) continue;
    const m = 69 + 12 * Math.log2(hz / 440), lo = Math.floor(m);
    binPc[b] = ((lo % 12) + 12) % 12;
    binW[b] = 1 - (m - lo);   // share of the lower note; the rest goes to the next one
  }
  const win = new Float32Array(FFT_N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_N));
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  for (let c = 0; c < cframes; c++) {
    const off = c * chop;
    for (let i = 0; i < FFT_N; i++) { re[i] = y[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let max = 1e-12;
    const acc = new Float32Array(12);
    for (let b = 1; b < FFT_N / 2; b++) {
      if (binPc[b] < 0) continue;
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      acc[binPc[b]] += mag * binW[b];
      acc[(binPc[b] + 1) % 12] += mag * (1 - binW[b]);
    }
    for (let p = 0; p < 12; p++) max = Math.max(max, acc[p]);
    for (let p = 0; p < 12; p++) chroma[p][c] = acc[p] / max;
  }
  return { onset, onsetHop: hop / sr, chroma, chromaHop: chop / sr, chromaWin: FFT_N / sr, duration: y.length / sr };
}

// Best offset (s) for the chart in the analysed audio.
// opts.center: search only ±0.3 s around it (e.g. the current offset).
export function estimateOffset(chart, an, { center = null, range = 60 } = {}) {
  const notes = chart.notes.filter((n) => !n.flags.ghost && !n.flags.dead);
  if (notes.length < 4) return null;
  const tuning = chart.instrument.tuning;
  const capo = chart.instrument.capo || 0;
  // Each note is checked in the middle of its first 0.25 s (the attack itself is noisy).
  const mids = notes.map((n) => n.t + Math.min(0.12, Math.max(0.04, n.dur / 2)));
  const pcs = notes.map((n) => (((tuning[n.string] + n.fret + capo) % 12) + 12) % 12);
  const plucked = pluckedNotes(chart).map((n) => n.t);
  const nC = an.chroma[0].length, half = an.chromaWin / 2;
  const pitchScore = (off) => {
    let s = 0, n = 0;
    for (let i = 0; i < mids.length; i++) {
      const x = (mids[i] + off - half) / an.chromaHop;   // frame whose window is centred there
      const c = Math.floor(x), w = x - c;
      if (c < 0 || c + 1 >= nC) continue;
      const row = an.chroma[pcs[i]];
      s += row[c] * (1 - w) + row[c + 1] * w; n++;
    }
    return n >= mids.length * 0.5 ? s / n : 0;   // most of the chart must fall inside the audio
  };
  const onsetAt = (t) => {
    const f = Math.round(t / an.onsetHop);
    if (f < 1 || f >= an.onset.length - 1) return 0;
    return Math.max(an.onset[f - 1], an.onset[f], an.onset[f + 1]);
  };
  const onsetScore = (off) => { let s = 0; for (const t of plucked) s += onsetAt(t + off); return plucked.length ? s / plucked.length : 0; };
  // 1. Coarse: 20 ms steps by pitch.
  const lo = center === null ? -range : center - 0.3, hi = center === null ? range : center + 0.3;
  const scores = [];
  for (let off = lo; off <= hi + 1e-9; off += 0.02) scores.push([off, pitchScore(off)]);
  const best = Math.max(...scores.map((x) => x[1]));
  if (!(best > 0)) return null;
  // 2. The strongest peaks; the attacks break near-ties.
  const peaks = scores.filter(([, v], i) => v >= best - 0.08 && v >= (scores[i - 1] || [0, -1])[1] && v >= (scores[i + 1] || [0, -1])[1]);
  let win = null;
  for (const [off, v] of peaks) {
    const total = v + 0.15 * Math.min(1, onsetScore(off));
    if (!win || total > win.total) win = { off, v, total };
  }
  // 3. Refine: the pitch window is long, so the pitch score is flat for ±0.1–0.2 s around
  // the answer. Within that plateau, the attacks decide (4 ms steps).
  let off = win.off, top = -1;
  const pv = pitchScore(win.off);
  for (let d = -0.25; d <= 0.25 + 1e-9; d += 0.004) {
    const p = pitchScore(win.off + d);
    if (p < pv - 0.03) continue;
    const t = p + 0.6 * Math.min(1, onsetScore(win.off + d));
    if (t > top) { top = t; off = win.off + d; }
  }
  top = pitchScore(off) + 0.15 * Math.min(1, onsetScore(off));   // same scale as the candidates below
  const other = peaks.filter(([o]) => Math.abs(o - off) > 0.2)
    .map(([o, v]) => [o, v + 0.15 * Math.min(1, onsetScore(o))]).sort((a, b) => b[1] - a[1])[0];
  return {
    offset: Math.round(off * 1000) / 1000,
    pitch: pitchScore(off),            // 0..1: how clearly the chart's notes are heard
    margin: other ? top - other[1] : 1, // lead over the best other position (small = unsure)
    runnerUp: other ? Math.round(other[0] * 1000) / 1000 : null,
  };
}
