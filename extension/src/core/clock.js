// Song clock: turns position samples from the player (one per animation
// frame, each stamped with performance.now()) into a smooth "song time now".
//
// Small differences between our extrapolation and the player are slewed
// out gently (no visible jitter); big ones (seek, loop restart, buffering)
// snap immediately. So the highway re-syncs from the player instead of
// drifting.

const SNAP_SECONDS = 0.05;
const SLEW = 0.15;

export class SongClock {
  constructor() {
    this.base = null;     // { perf, time }
    this.playing = false;
    this.speed = 1;
    this.lastError = 0;   // seconds; for diagnostics
    this.snaps = 0;
  }

  // sample: { perf (ms), time (s), playing, speed (1 = 100%) }
  update(sample) {
    const predicted = this.base ? this.estimate(sample.perf) : sample.time;
    const err = sample.time - predicted;
    this.lastError = err;
    const snap = !this.base || !sample.playing || !this.playing || sample.speed !== this.speed || Math.abs(err) > SNAP_SECONDS;
    if (snap) {
      if (this.base && Math.abs(err) > SNAP_SECONDS) this.snaps++;
      this.base = { perf: sample.perf, time: sample.time };
    } else {
      this.base = { perf: sample.perf, time: predicted + err * SLEW };
    }
    this.playing = sample.playing;
    this.speed = sample.speed;
  }

  estimate(perf) {
    if (!this.base) return 0;
    return this.playing ? this.base.time + ((perf - this.base.perf) / 1000) * this.speed : this.base.time;
  }

  now() {
    return this.estimate(performance.now());
  }
}
