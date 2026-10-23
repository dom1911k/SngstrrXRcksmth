// Camera framing for the highway (no three.js here, so it can be unit tested).
//
// Instead of following every hand position, the song is split into passages
// ("camera segments") whose notes fit inside a comfortable fret range (default
// 9 frets). The camera holds completely still during a passage and glides to
// the next frame only when the music moves to another part of the neck.
// Frets outside the frame are shaded by the renderer.
//
// Output: `x` (centre, in fret-wire units: wire w is at x = w), `span`
// (number of frets framed), `lo`/`hi` (= x ∓ span/2).

const MAX_SPAN = 9;          // frets a frame may cover before the camera moves
const MIN_SPAN = 6;          // never zoom in closer than this
const MIN_SEGMENT = 4;       // s: shorter passages are merged into a neighbour if possible
const MERGE_SPAN = 12;       // ...as long as the merged frame stays within this
const MARGIN = 0.5;          // frets of air on each side of the notes
const LEAD = 1.2;            // s (at 100%): start moving up to this long before a new passage
const MOVE_TIME = 0.6;       // smoothing time (s) of a camera move (shorter if the gap is short)
const MIN_MOVE_TIME = 0.12;
const SNAP_JUMP = 2.5;       // song seconds; bigger jumps (seek) snap the camera

// Unity-style SmoothDamp: critically damped spring towards `target`.
export function smoothDamp(current, target, state, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

function frameOf(lo, hi, opts) {
  // Notes on frets lo..hi occupy wires (lo-1)..hi.
  const a = lo - 1 - MARGIN, b = hi + MARGIN;
  const span = Math.max(opts.minSpan, b - a);
  const x = Math.max(span / 2 - MARGIN, (a + b) / 2); // don't frame far left of the nut
  return { x, span };
}

const width = (lo, hi) => hi - lo + 1 + 2 * MARGIN;

// Split the song into camera segments. notes: chart notes (sorted by t).
export function planCameraSegments(notes, options = {}) {
  const opts = { maxSpan: MAX_SPAN, minSpan: MIN_SPAN, minSegment: MIN_SEGMENT, mergeSpan: MERGE_SPAN, ...options };
  const fretted = notes.filter((n) => n.fret > 0 && !(n.flags && n.flags.ghost));
  const segs = [];
  let cur = null;
  for (const n of fretted) {
    if (cur && width(Math.min(cur.lo, n.fret), Math.max(cur.hi, n.fret)) <= opts.maxSpan) {
      cur.lo = Math.min(cur.lo, n.fret);
      cur.hi = Math.max(cur.hi, n.fret);
      cur.end = n.t;
      continue;
    }
    cur = { t: n.t, end: n.t, lo: n.fret, hi: n.fret };
    segs.push(cur);
  }
  // Merge short passages into a neighbour when the combined frame stays reasonable.
  let merged = true;
  while (merged && segs.length > 1) {
    merged = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const next = segs[i + 1];
      const dur = (next ? next.t : s.end + opts.minSegment) - s.t;
      if (dur >= opts.minSegment) continue;
      const candidates = [segs[i - 1], next].filter(Boolean)
        .map((o) => ({ o, w: width(Math.min(o.lo, s.lo), Math.max(o.hi, s.hi)) }))
        .filter((c) => c.w <= opts.mergeSpan)
        .sort((a, b) => a.w - b.w);
      if (!candidates.length) continue;
      const o = candidates[0].o;
      o.lo = Math.min(o.lo, s.lo);
      o.hi = Math.max(o.hi, s.hi);
      o.t = Math.min(o.t, s.t);
      o.end = Math.max(o.end, s.end);
      segs.splice(i, 1);
      merged = true;
      break;
    }
  }
  // Neighbouring segments that fit one frame together are one passage, and so
  // are neighbours where one frame already contains the other's frets.
  const contains = (a, b) => a.lo <= b.lo && a.hi >= b.hi;
  for (let i = segs.length - 1; i > 0; i--) {
    const a = segs[i - 1], b = segs[i];
    if (width(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi)) <= opts.maxSpan || contains(a, b) || contains(b, a)) {
      a.lo = Math.min(a.lo, b.lo); a.hi = Math.max(a.hi, b.hi); a.end = b.end;
      segs.splice(i, 1);
    }
  }
  // When to start moving to each passage: up to LEAD before its first note,
  // but never before the previous passage's last note has been played. A
  // short gap means a quicker move so it still finishes in time.
  return segs.map((s, i) => {
    const prevEnd = i > 0 ? segs[i - 1].end + 0.03 : -Infinity;
    const moveStart = Math.min(s.t - 0.02, Math.max(s.t - LEAD, prevEnd));
    const moveTime = Math.max(MIN_MOVE_TIME, Math.min(MOVE_TIME, (s.t - moveStart) * 0.3));
    return { ...s, ...frameOf(s.lo, s.hi, opts), moveStart, moveTime };
  });
}

export class CameraFollow {
  constructor(segments = []) {
    this.setSegments(segments);
  }

  setSegments(segments) {
    this.segments = segments;
    const first = segments[0] || { x: 3.5, span: MIN_SPAN };
    this.x = first.x;
    this.span = first.span;
    this.vx = { v: 0 };
    this.vs = { v: 0 };
    this.lastT = null;
  }

  // The frame that should be on screen at time t (song seconds).
  target(t) {
    const segs = this.segments;
    if (!segs.length) return { x: this.x, span: this.span, moveTime: MOVE_TIME };
    let best = segs[0];
    for (const s of segs) { if (s.moveStart <= t) best = s; else break; }
    return best;
  }

  reset(t) {
    const g = this.target(t);
    this.x = g.x;
    this.span = g.span;
    this.vx.v = this.vs.v = 0;
    this.lastT = t;
  }

  update(t, speed, dt) {
    if (this.lastT === null || Math.abs(t - this.lastT) > SNAP_JUMP * speed) {
      this.reset(t, speed);
      return this;
    }
    this.lastT = t;
    const g = this.target(t);
    const moveTime = (g.moveTime || MOVE_TIME) / speed; // song-time gap -> real time
    this.x = smoothDamp(this.x, g.x, this.vx, moveTime, dt);
    this.span = smoothDamp(this.span, g.span, this.vs, moveTime, dt);
    return this;
  }

  get lo() { return this.x - this.span / 2; }
  get hi() { return this.x + this.span / 2; }
}
