// Latency calibration: play along to clicks; measure how late your notes
// arrive at the detector. The result is the TOTAL offset:
//   headphone/output latency + your timing habit + cable/input latency + detection delay.

export const CALIBRATION_DEFAULTS = {
  bpm: 90,
  countIn: 4,       // clicks you only listen to
  clicks: 16,       // clicks you play along with
  earlyWindow: 0.15, // seconds before a click an onset may arrive
  lateWindow: 0.45,  // seconds after a click an onset may arrive
  minMatches: 8,
};

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Pure function so it can be unit tested. Times in seconds on one clock.
export function analyseCalibration(clickTimes, onsetTimes, opts = {}) {
  const { earlyWindow, lateWindow, minMatches } = { ...CALIBRATION_DEFAULTS, ...opts };
  const offsets = [];
  for (const c of clickTimes) {
    const o = onsetTimes.find((t) => t >= c - earlyWindow && t <= c + lateWindow);
    if (o !== undefined) offsets.push(o - c);
  }
  const total = clickTimes.length;
  if (offsets.length < minMatches) {
    return {
      ok: false,
      matched: offsets.length,
      total,
      reason: `Only ${offsets.length} of ${total} notes were detected. Play one clear note (an open string works) on every click, and check the input level.`,
    };
  }
  const med = median(offsets);
  const mad = median(offsets.map((x) => Math.abs(x - med)));
  const limit = Math.max(3 * 1.4826 * mad, 0.015);
  const kept = offsets.filter((x) => Math.abs(x - med) <= limit);
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const spread = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length);
  const quality = spread < 0.012 ? 'good' : spread < 0.025 ? 'ok' : 'poor';
  return {
    ok: true,
    offsetMs: Math.round(mean * 1000),
    spreadMs: Math.round(spread * 1000),
    matched: offsets.length,
    used: kept.length,
    total,
    quality,
  };
}

// Runs one calibration pass on a started AudioEngine.
// onProgress({ phase: 'countin'|'play'|'done', index, of, hits })
export function runCalibration(engine, onProgress = () => {}, opts = {}) {
  const o = { ...CALIBRATION_DEFAULTS, ...opts };
  const ctx = engine.ctx;
  const interval = 60 / o.bpm;
  const start = ctx.currentTime + 0.4;
  const all = o.countIn + o.clicks;
  const clickTimes = [];
  for (let i = 0; i < all; i++) {
    const t = start + i * interval;
    engine.click(t, i % 4 === 0);
    if (i >= o.countIn) clickTimes.push(t);
  }
  const onsets = [];
  const off = engine.on('onset', (e) => onsets.push(e.t));
  let cancelled = false;
  let timer;

  const promise = new Promise((resolve) => {
    const end = start + all * interval + o.lateWindow;
    timer = setInterval(() => {
      const now = ctx.currentTime;
      const i = Math.floor((now - start) / interval);
      const hits = analyseCalibration(clickTimes, onsets, { ...o, minMatches: 0 }).matched;
      if (cancelled) {
        clearInterval(timer); off();
        resolve({ ok: false, cancelled: true, reason: 'Cancelled.' });
      } else if (now >= end) {
        clearInterval(timer); off();
        const result = analyseCalibration(clickTimes, onsets, o);
        onProgress({ phase: 'done', index: o.clicks, of: o.clicks, hits });
        resolve(result);
      } else if (i < o.countIn) {
        onProgress({ phase: 'countin', index: Math.max(0, i), of: o.countIn, hits });
      } else {
        onProgress({ phase: 'play', index: i - o.countIn, of: o.clicks, hits });
      }
    }, 50);
  });

  return { promise, cancel: () => { cancelled = true; } };
}
