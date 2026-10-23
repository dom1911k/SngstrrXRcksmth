// Camera follow logic for the 3D highway (no three.js here, so it can be
// unit tested). Produces a smoothed centre fret position `x` and a visible
// width `span` (in frets) from the hand positions (anchors) ahead.
//
// Rocksmith-like behaviour, calm rather than twitchy:
//  - pan: follows the hand positions of the next ~1.2 s with a critically
//    damped spring (no overshoot, no sudden starts);
//  - zoom: planned over the next ~3 s; zooming OUT starts early and is smooth,
//    zooming IN only happens after the narrower view has been enough for a
//    while, and then slowly. Zoom-ins under 2 frets are ignored.

const PAN_WINDOW = 1.2;      // song seconds (at 100%) ahead used for panning
const ZOOM_WINDOW = 3.0;     // song seconds ahead used for zoom
const ZOOM_BEHIND = 0.4;     // keep frets just played in view this long
const MIN_SPAN = 7;          // frets
const PAN_TIME = 0.55;       // smoothing time (s) for panning
const ZOOM_OUT_TIME = 0.9;
const ZOOM_IN_TIME = 2.2;
const ZOOM_IN_DELAY = 2.5;   // s the narrower view must suffice before zooming in
const ZOOM_IN_MIN = 2;       // frets: smaller zoom-ins are not worth moving for
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

function range(anchors, from, to) {
  let lo = Infinity, hi = -Infinity;
  for (const a of anchors) {
    if (a.until < from || a.t > to) continue;
    lo = Math.min(lo, a.fret - 1);
    hi = Math.max(hi, a.fret + 3);
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

function anchorBefore(anchors, t) {
  let best = null;
  for (const a of anchors) { if (a.t <= t) best = a; else break; }
  return best || anchors[0] || null;
}

export class CameraFollow {
  constructor() {
    this.x = 4;
    this.span = 8;
    this.vx = { v: 0 };
    this.vs = { v: 0 };
    this.spanTarget = 8;
    this.narrowFor = 0;
    this.lastT = null;
  }

  targets(anchors, t, speed) {
    const pan = range(anchors, t, t + PAN_WINDOW * speed);
    const zoom = range(anchors, t - ZOOM_BEHIND * speed, t + ZOOM_WINDOW * speed);
    const cur = anchorBefore(anchors, t);
    const fallback = cur ? { lo: cur.fret - 1, hi: cur.fret + 3 } : { lo: 0, hi: 4 };
    const p = pan || fallback;
    const z = zoom || p;
    return { x: (p.lo + p.hi) / 2, span: Math.max(MIN_SPAN, Math.ceil(z.hi - z.lo + 1)) };
  }

  reset(anchors, t, speed = 1) {
    const g = this.targets(anchors, t, speed);
    this.x = g.x;
    this.span = this.spanTarget = g.span;
    this.vx.v = this.vs.v = 0;
    this.narrowFor = 0;
    this.lastT = t;
  }

  update(anchors, t, speed, dt) {
    if (this.lastT === null || Math.abs(t - this.lastT) > SNAP_JUMP * speed) {
      this.reset(anchors, t, speed);
      return this;
    }
    this.lastT = t;
    const g = this.targets(anchors, t, speed);
    if (g.span > this.spanTarget) {
      this.spanTarget = g.span;
      this.narrowFor = 0;
    } else if (g.span <= this.spanTarget - ZOOM_IN_MIN) {
      this.narrowFor += dt;
      if (this.narrowFor >= ZOOM_IN_DELAY) { this.spanTarget = g.span; this.narrowFor = 0; }
    } else {
      this.narrowFor = 0;
    }
    this.x = smoothDamp(this.x, g.x, this.vx, PAN_TIME, dt);
    const zoomTime = this.spanTarget >= this.span ? ZOOM_OUT_TIME : ZOOM_IN_TIME;
    this.span = smoothDamp(this.span, this.spanTarget, this.vs, zoomTime, dt);
    return this;
  }
}
