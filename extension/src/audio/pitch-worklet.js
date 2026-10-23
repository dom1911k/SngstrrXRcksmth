// AudioWorklet: onset detection + McLeod Pitch Method (MPM) for bass.
//
// Kept self-contained (no imports) so it can also be loaded from a Blob URL.
//
// Signal path inside the processor:
//   input ─┬─ DC/rumble high-pass (20 Hz) ─ low-pass 2 kHz (4th order) ─ decimate to ~12 kHz ─ MPM pitch
//          └─ high-pass 250 Hz ─ block energy ─ onset detector
//
// Messages posted to the main thread (all times are AudioContext seconds of
// the *input* sample they describe):
//   { type: 'frame', t, f0, clarity, rms }   every hop (~5 ms); f0 = 0 when no pitch
//   { type: 'onset', t, strength, rms }      when a new attack is detected
//   { type: 'level', rms, peak }             ~every 25 ms, for meters

const TARGET_RATE = 12000;

class Biquad {
  constructor(type, freq, q, fs) {
    const w = (2 * Math.PI * freq) / fs;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  step(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Energy in one high-passed band, smoothed over ~10 ms, compared with the
// LOUDEST smoothed energy of the previous ~48 ms (>= 1.5 periods of low E/B).
// A note that keeps ringing never exceeds its own recent maximum, so only a
// new attack produces a positive rise.
class OnsetBand {
  constructor(cutoff, fs) {
    this.f1 = new Biquad('highpass', cutoff, 0.5412, fs);
    this.f2 = new Biquad('highpass', cutoff, 1.3066, fs);
    this.blocks = new Float32Array(4);
    this.blockIdx = 0;
    this.hist = new Float32Array(18);
    this.histIdx = 0;
    this.noiseFloor = 1e-7;
    this.acc = 0;
  }
  step(x) {
    const h = this.f2.step(this.f1.step(x));
    this.acc += h * h;
  }
  // Call once per render quantum; returns { rise (dB), energy, gate }.
  endBlock(n) {
    this.blocks[this.blockIdx] = this.acc / n;
    this.blockIdx = (this.blockIdx + 1) % this.blocks.length;
    this.acc = 0;
    let e = 0;
    for (let j = 0; j < this.blocks.length; j++) e += this.blocks[j];
    e /= this.blocks.length;
    let baseline = 0;
    for (let j = 0; j < this.hist.length; j++) if (this.hist[j] > baseline) baseline = this.hist[j];
    this.hist[this.histIdx] = e;
    this.histIdx = (this.histIdx + 1) % this.hist.length;
    // Noise floor tracker: falls immediately, rises slowly.
    this.noiseFloor = e < this.noiseFloor ? e : this.noiseFloor * 1.002 + 1e-13;
    const gate = Math.max(this.noiseFloor * 30, 1e-8);
    return { rise: 10 * Math.log10((e + 1e-12) / (baseline + 1e-12)), energy: e, gate };
  }
}

// Autocorrelation of x[0..W) for lags 0..maxLag via FFT (zero-padded so the
// circular correlation equals the linear one). ~3x faster than the direct sum
// at bass window sizes, identical results.
class FastAcf {
  constructor(W, maxLag) {
    let N = 1;
    while (N < W + maxLag + 1) N <<= 1;
    this.N = N;
    const levels = Math.log2(N);
    this.rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(N / 2);
    this.sin = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / N); this.sin[i] = -Math.sin((2 * Math.PI * i) / N); }
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
  }
  fft() {
    const { N, rev, cos, sin, re, im } = this;
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] - im[l] * sin[k];
          const tim = re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }
  compute(x, W, maxLag, out) {
    const { N, re, im } = this;
    re.fill(0); im.fill(0);
    for (let i = 0; i < W; i++) re[i] = x[i];
    this.fft();
    for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    this.fft(); // power spectrum is real and even: forward FFT = N * inverse
    for (let t = 0; t <= maxLag; t++) out[t] = re[t] / N;
  }
}

// MPM on a window x[0..W). Returns { f0, clarity } (f0 = 0 when nothing found).
// `acf` (optional) is the precomputed autocorrelation; otherwise it is summed
// directly. Exported via globalThis for unit tests running outside a worklet.
function mpm(x, W, fs, minLag, maxLag, nsdf, k, periodLimit = maxLag, acf = null) {
  // m(tau) = sum_{j<W-tau} x[j]^2 + x[j+tau]^2, computed incrementally.
  let m = 0;
  for (let j = 0; j < W; j++) m += 2 * x[j] * x[j];
  if (m < 1e-12) return { f0: 0, clarity: 0 };
  nsdf[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    m -= x[W - tau] * x[W - tau] + x[tau - 1] * x[tau - 1];
    let r;
    if (acf) r = acf[tau];
    else {
      r = 0;
      const n = W - tau;
      for (let j = 0; j < n; j++) r += x[j] * x[j + tau];
    }
    nsdf[tau] = m > 1e-12 ? (2 * r) / m : 0;
  }
  // Skip the initial positive lobe around tau = 0.
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  if (tau > maxLag) return { f0: 0, clarity: 0 };
  // Key maxima: the highest point of each positive lobe.
  const peaks = [];
  let globalMax = 0;
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1, bestTau = -1;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
      tau++;
    }
    // A lobe that runs into maxLag has not peaked yet; ignore it.
    if (bestTau > 0 && tau <= maxLag && bestTau >= minLag && bestTau <= periodLimit) {
      peaks.push(bestTau);
      if (best > globalMax) globalMax = best;
    }
  }
  if (!peaks.length) return { f0: 0, clarity: 0 };
  const threshold = k * globalMax;
  let chosen = peaks[0];
  for (const p of peaks) {
    if (nsdf[p] >= threshold) { chosen = p; break; }
  }
  // Parabolic interpolation around the chosen peak.
  const a = nsdf[chosen - 1], b = nsdf[chosen], c = nsdf[chosen + 1];
  const denom = a - 2 * b + c;
  let shift = 0, peakVal = b;
  if (denom !== 0) {
    shift = (0.5 * (a - c)) / denom;
    peakVal = b - 0.25 * (a - c) * shift;
  }
  return { f0: fs / (chosen + shift), clarity: Math.min(1, peakVal) };
}

globalThis.__bassTrainerMpm = mpm;
globalThis.__bassTrainerFastAcf = FastAcf;

class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.decim = Math.max(1, Math.round(sampleRate / TARGET_RATE));
    this.fs = sampleRate / this.decim;

    this.hp = new Biquad('highpass', 20, 0.7071, sampleRate);
    this.lp1 = new Biquad('lowpass', 2000, 0.5412, sampleRate);
    this.lp2 = new Biquad('lowpass', 2000, 1.3066, sampleRate);

    this.ringSize = 4096;
    this.ring = new Float32Array(this.ringSize);
    this.ringPos = 0;      // next write index
    this.ringCount = 0;    // total decimated samples written
    this.decimPhase = 0;
    this.hop = 64;         // decimated samples between analyses (~5.3 ms)
    this.sinceHop = 0;

    this.k = 0.9;
    this.maxFreq = 520;
    this.configure(opts.minFreq || 36);

    // Onset detector: a mid band (string attack + upper harmonics) and a high
    // band (pick/finger click), so re-plucking a ringing string is still seen.
    this.onsetBands = [new OnsetBand(250, sampleRate), new OnsetBand(1500, sampleRate)];
    this.lastOnsetTime = -1;
    this.onsetRiseDb = opts.onsetRiseDb || 6;
    this.refractory = 0.05;

    this.levelPeak = 0;
    this.levelSumSq = 0;
    this.levelCount = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'config') {
        if (msg.minFreq) this.configure(msg.minFreq);
        if (msg.onsetRiseDb) this.onsetRiseDb = msg.onsetRiseDb;
      }
    };
  }

  configure(minFreq) {
    this.minFreq = minFreq;
    // Longest period we accept, plus search headroom so the lobe around that
    // period can be seen to peak.
    this.periodLimit = Math.ceil(this.fs / minFreq);
    this.maxLag = Math.ceil(this.periodLimit * 1.35) + 2;
    this.minLag = Math.floor(this.fs / this.maxFreq);
    // Window holds at least two periods of the lowest note.
    this.W = Math.min(this.ringSize - 1, Math.max(2 * this.periodLimit + 4, this.maxLag + 8));
    this.window = new Float32Array(this.W);
    this.nsdf = new Float32Array(this.maxLag + 2);
    this.acf = new Float64Array(this.maxLag + 2);
    this.fastAcf = new FastAcf(this.W, this.maxLag);
  }

  analyse(tEnd) {
    const W = this.W;
    if (this.ringCount < W) return;
    let start = this.ringPos - W;
    if (start < 0) start += this.ringSize;
    let sumSq = 0;
    for (let i = 0; i < W; i++) {
      const v = this.ring[(start + i) % this.ringSize];
      this.window[i] = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / W);
    let f0 = 0, clarity = 0;
    if (rms > 1e-4) {
      this.fastAcf.compute(this.window, W, this.maxLag, this.acf);
      const r = mpm(this.window, W, this.fs, this.minLag, this.maxLag, this.nsdf, this.k, this.periodLimit, this.acf);
      f0 = r.f0; clarity = r.clarity;
      if (f0 < this.minFreq * 0.97 || f0 > this.maxFreq) { f0 = 0; clarity = 0; }
    }
    this.port.postMessage({ type: 'frame', t: tEnd, f0, clarity, rms });
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    const n = ch.length;
    const t0 = currentTime;

    const [bandMid, bandHigh] = this.onsetBands;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const ax = x < 0 ? -x : x;
      if (ax > this.levelPeak) this.levelPeak = ax;
      this.levelSumSq += x * x;

      bandMid.step(x);
      bandHigh.step(x);

      const y = this.lp2.step(this.lp1.step(this.hp.step(x)));
      if (++this.decimPhase >= this.decim) {
        this.decimPhase = 0;
        this.ring[this.ringPos] = y;
        this.ringPos = (this.ringPos + 1) % this.ringSize;
        this.ringCount++;
        if (++this.sinceHop >= this.hop) {
          this.sinceHop = 0;
          this.analyse(t0 + (i + 1) / sampleRate);
        }
      }
    }
    this.levelCount += n;

    // --- Onset detection ---
    let rise = -Infinity, energy = 0;
    for (const band of this.onsetBands) {
      const r = band.endBlock(n);
      if (r.energy > r.gate && r.rise > rise) { rise = r.rise; energy = r.energy; }
    }
    if (rise > this.onsetRiseDb && t0 - this.lastOnsetTime > this.refractory) {
      this.lastOnsetTime = t0;
      this.port.postMessage({ type: 'onset', t: t0, strength: rise, rms: Math.sqrt(energy) });
    }

    if (this.levelCount >= sampleRate * 0.025) {
      this.port.postMessage({
        type: 'level',
        rms: Math.sqrt(this.levelSumSq / this.levelCount),
        peak: this.levelPeak,
      });
      this.levelPeak = 0; this.levelSumSq = 0; this.levelCount = 0;
    }

    // Output silence (the node is connected to the destination only so that
    // Chrome keeps pulling it).
    return true;
  }
}

registerProcessor('bass-trainer-pitch', PitchProcessor);
