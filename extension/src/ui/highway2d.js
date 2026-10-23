// Rocksmith 2014-style note highway drawn on a 2D canvas with a simple
// perspective projection. Notes travel from the distance toward the strike
// line; horizontal position = fret, colour and row = string, a lighter band on
// the floor shows the hand position (anchor).
//
// Only depends on the chart format; no Songsterr knowledge here.

import { stringColors } from '../core/music.js';
import { computeAnchors, anchorAt, firstNoteAtOrAfter } from '../core/chart.js';
import { CameraFollow, planCameraSegments } from '../core/camera-follow.js';

const FAR_SCALE = 5;          // far plane is drawn at 1 / (1 + FAR_SCALE) size
const MIN_FRETS_VISIBLE = 7;
const PAST_KEEP = 0.15;       // seconds a played note stays visible

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Highway2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chart = null;
    this.anchors = [];
    this.options = { lookahead: 2.4, invertStrings: false, showDebug: false };
    this.cam = { lo: 0, hi: 8 };
    this.lastFrame = 0;
    this.fps = 0;
  }

  setChart(chart) {
    this.chart = chart;
    this.anchors = chart ? computeAnchors(chart.notes) : [];
    // Hammer-on vs pull-off: compare with the previous note on that string.
    this.hopoLabel = new Map();
    if (chart) {
      const prev = [];
      for (const n of chart.notes) {
        if (n.flags.hopo && prev[n.string]) this.hopoLabel.set(n, n.fret > prev[n.string].fret ? 'H' : 'P');
        prev[n.string] = n;
      }
    }
    if (chart) {
      const a = this.anchors[0];
      const lo = a ? Math.max(0, a.fret - 2) : 0;
      this.cam = { lo, hi: lo + MIN_FRETS_VISIBLE + 1 };
      this.follow = new CameraFollow(planCameraSegments(chart.notes));
      this.colors = stringColors(chart.instrument.strings);
    }
  }

  setOptions(o) { Object.assign(this.options, o); }


  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    return { w, h };
  }

  // state: { time (song seconds), speed (1 = 100%), playing, loop: {start,end}|null, message, debug }
  render(state) {
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016;
    if (this.lastFrame) this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
    this.lastFrame = now;

    const { w: W, h: H } = this.resize();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05060a');
    bg.addColorStop(1, '#121620');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const chart = this.chart;
    if (!chart) {
      this.text(state.message || 'Waiting for the song…', W / 2, H / 2, 16, '#9aa0aa', 'center');
      return;
    }

    const speed = state.speed || 1;
    const t = state.time;
    const look = this.options.lookahead * speed; // song seconds visible ahead
    const nStr = chart.instrument.strings;
    const s = Math.min(W, H * 2.2) / 1000; // UI scale

    // ---- geometry ----
    const vp = { x: W / 2, y: H * 0.03 };
    const strTop = H * 0.50, strBot = H * 0.76;
    const floorY = H * 0.83;
    const left = W * 0.05, right = W * 0.95;
    const row = (string) => (this.options.invertStrings ? nStr - 1 - string : string);
    const stringY = (string) => (nStr === 1 ? strTop : strTop + ((strBot - strTop) * row(string)) / (nStr - 1));
    const scaleAt = (z) => 1 / (1 + Math.max(0, z) * FAR_SCALE);
    const depth = (time) => (time - t) / look;
    const proj = (x, y, z) => { const k = scaleAt(z); return { x: vp.x + (x - vp.x) * k, y: vp.y + (y - vp.y) * k, k }; };

    // ---- camera: frames the current passage, still while you play it ----
    this.follow.update(t, speed, dt);
    this.cam.lo = Math.max(0, this.follow.lo - 0.5);
    this.cam.hi = Math.min((chart.instrument.frets || 24) + 0.5, this.follow.hi + 0.5);
    const wireX = (wire) => left + ((wire - this.cam.lo) / (this.cam.hi - this.cam.lo)) * (right - left);
    const fretX = (fret) => (fret <= 0 ? wireX(this.cam.lo + 0.5) : (wireX(fret - 1) + wireX(fret)) / 2);
    const fretW = wireX(1) - wireX(0);

    // ---- floor ----
    const fl = proj(left - fretW * 0.3, floorY, 0), fr = proj(right + fretW * 0.3, floorY, 0);
    const farL = proj(left - fretW * 0.3, floorY, 1), farR = proj(right + fretW * 0.3, floorY, 1);
    const floorGrad = ctx.createLinearGradient(0, farL.y, 0, floorY);
    floorGrad.addColorStop(0, 'rgba(30,34,46,0.2)');
    floorGrad.addColorStop(1, 'rgba(40,46,62,0.95)');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(farR.x, farR.y); ctx.lineTo(farL.x, farL.y);
    ctx.closePath(); ctx.fill();

    // Anchor bands (hand position) on the floor.
    for (const a of this.anchors) {
      if (a.until < t - 0.05 || a.t > t + look) continue;
      const z0 = Math.max(0, depth(a.t)), z1 = Math.min(1, depth(a.until));
      if (z1 <= z0) continue;
      const xa = wireX(a.fret - 1), xb = wireX(a.fret + 3);
      const p0 = proj(xa, floorY, z0), p1 = proj(xb, floorY, z0), p2 = proj(xb, floorY, z1), p3 = proj(xa, floorY, z1);
      ctx.fillStyle = 'rgba(120,150,210,0.22)';
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.fill();
      // Upcoming position change: show the fret number where the band starts.
      if (a.t > t && depth(a.t) < 0.95) {
        const lab = proj(xa, floorY, depth(a.t));
        this.text(String(a.fret), lab.x + 3 * s, lab.y - 4 * s, Math.max(10, 18 * s * lab.k), '#f2c418', 'left');
      }
    }

    // Fret wires.
    ctx.lineWidth = Math.max(1, 1.2 * s);
    for (let wire = Math.ceil(this.cam.lo); wire <= Math.floor(this.cam.hi); wire++) {
      const a = proj(wireX(wire), floorY, 0), b = proj(wireX(wire), floorY, 1);
      ctx.strokeStyle = wire === 0 ? 'rgba(230,230,230,0.7)' : 'rgba(170,180,200,0.35)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Beat lines.
    const beats = chart.beats;
    for (let i = firstNoteAtOrAfter(beats, t - 0.01); i < beats.length && beats[i].t <= t + look; i++) {
      const z = depth(beats[i].t);
      const a = proj(left, floorY, z), b = proj(right, floorY, z);
      ctx.strokeStyle = beats[i].downbeat ? 'rgba(225,230,245,0.75)' : 'rgba(205,210,225,0.35)';
      ctx.lineWidth = Math.max(1, (beats[i].downbeat ? 4 : 2) * s * a.k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Strings at the strike plane.
    for (let i = 0; i < nStr; i++) {
      const y = stringY(i);
      ctx.strokeStyle = shade(this.colors[i], 0.85);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(1.5, (4.5 - row(i) * 0.6) * s);
      ctx.beginPath(); ctx.moveTo(left - fretW * 0.3, y); ctx.lineTo(right + fretW * 0.3, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Fret numbers under the strike line (anchor frets highlighted).
    const cur = anchorAt(this.anchors, t);
    for (let f = Math.max(1, Math.ceil(this.cam.lo + 0.5)); f <= Math.floor(this.cam.hi + 0.5); f++) {
      const inHand = cur && f >= cur.fret && f <= cur.fret + 3;
      this.text(String(f), fretX(f), floorY + 26 * s, 17 * s, inHand ? '#f2c418' : '#6f7685', 'center');
    }

    // ---- notes (draw far to near) ----
    const notes = chart.notes;
    let i0 = firstNoteAtOrAfter(notes, t - 8);
    const visible = [];
    for (let i = i0; i < notes.length && notes[i].t <= t + look; i++) {
      const n = notes[i];
      const end = n.t + Math.max(n.dur, 0);
      if (end < t - PAST_KEEP && n.t < t - PAST_KEEP) continue;
      visible.push(n);
    }
    for (let j = visible.length - 1; j >= 0; j--) this.drawNote(visible[j], { t, depth, proj, stringY, fretX, wireX, floorY, fretW, s, look });

    // ---- HUD ----
    const bar = this.barAt(t);
    if (bar) {
      const label = `${bar.section ? bar.section + ' · ' : ''}bar ${bar.measure + 1}`;
      this.text(label, 14 * s, 26 * s, 18 * s, '#c9ced8', 'left');
    }
    const hud = [];
    if (Math.abs(speed - 1) > 0.001) hud.push(`${Math.round(speed * 100)}%`);
    if (state.loop) hud.push('LOOP');
    if (!state.playing) hud.push('PAUSED');
    if (hud.length) this.text(hud.join('  '), W - 56 * s, 26 * s, 18 * s, '#f2c418', 'right');
    if (state.message) this.text(state.message, W / 2, H * 0.22, 16 * s, '#ffb347', 'center');
    if (this.options.showDebug && state.debug) this.text(`${state.debug} · ${Math.round(this.fps)} fps`, W - 10 * s, H - 10 * s, 12 * s, '#6f7685', 'right');
  }

  drawNote(n, g) {
    const ctx = this.ctx;
    const color = this.colors[n.string] || '#ccc';
    const z = g.depth(n.t);
    const zEnd = g.depth(n.t + n.dur);
    const y0 = g.stringY(n.string);
    const open = n.fret === 0;
    const x0 = open ? null : g.fretX(n.fret);
    const anchor = anchorAt(this.anchors, n.t);
    const openA = anchor ? g.wireX(anchor.fret - 1) : g.wireX(this.cam.lo);
    const openB = anchor ? g.wireX(anchor.fret + 3) : g.wireX(this.cam.lo + 4);
    const alpha = n.flags.ghost ? 0.4 : 1;

    // Sustain tail (and slide path) from max(now, start) to end.
    const sustain = (n.dur >= 0.5 || (n.flags.slide && n.dur > 0.15)) && !n.flags.dead && !n.flags.staccato;
    if (sustain && zEnd > 0) {
      const za = Math.max(0, z), zb = Math.min(1, zEnd);
      if (zb > za) {
        const slideTo = n.flags.slide && n.flags.slide.toFret !== null ? n.flags.slide.toFret : null;
        const xAt = (zz) => {
          if (open) return (openA + openB) / 2;
          if (slideTo === null || slideTo === undefined) return x0;
          const f = (zz - z) / Math.max(1e-6, zEnd - z);
          return x0 + (g.fretX(Math.max(1, slideTo)) - x0) * f;
        };
        const halfW = (open ? (openB - openA) * 0.1 : g.fretW * 0.14);
        const a = g.proj(xAt(za) - halfW, y0, za), b = g.proj(xAt(za) + halfW, y0, za);
        const c = g.proj(xAt(zb) + halfW, y0, zb), d = g.proj(xAt(zb) - halfW, y0, zb);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.45 * alpha;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (z < -PAST_KEEP / g.look) return;
    const zz = Math.max(0, z);
    const fade = z < 0 ? Math.max(0, 1 + z * g.look / PAST_KEEP) : 1;
    const p = g.proj(open ? (openA + openB) / 2 : x0, y0, zz);
    const k = p.k;
    let gw = (open ? openB - openA - g.fretW * 0.2 : g.fretW * 0.8) * k;
    let gh = Math.max(5, 46 * g.s * k);
    if (n.flags.ghost) { gw *= 0.75; gh *= 0.75; }

    // Stem to the floor (helps judge depth, like Rocksmith).
    const floorP = g.proj(open ? (openA + openB) / 2 : x0, g.floorY, zz);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35 * alpha * fade;
    ctx.lineWidth = Math.max(1, 2 * g.s * k);
    ctx.beginPath(); ctx.moveTo(p.x, p.y + gh / 2); ctx.lineTo(floorP.x, floorP.y); ctx.stroke();

    // Gem.
    ctx.globalAlpha = alpha * fade;
    const fill = n.flags.dead ? shade(color, 0.35) : color;
    const grad = ctx.createLinearGradient(0, p.y - gh / 2, 0, p.y + gh / 2);
    grad.addColorStop(0, shade(n.flags.dead ? '#555555' : color, 1.35));
    grad.addColorStop(1, fill);
    ctx.fillStyle = grad;
    roundRect(ctx, p.x - gw / 2, p.y - gh / 2, gw, gh, gh * 0.3);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * g.s * k);
    ctx.strokeStyle = shade(color, 0.55);
    ctx.stroke();

    // Strike flash.
    if (z <= 0.02 && z > -PAST_KEEP / g.look) {
      ctx.globalAlpha = 0.6 * fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, 3 * g.s);
      roundRect(ctx, p.x - gw / 2 - 4 * g.s, p.y - gh / 2 - 4 * g.s, gw + 8 * g.s, gh + 8 * g.s, gh * 0.35);
      ctx.stroke();
    }

    // Label: fret number (or X for dead notes); technique hints.
    const fs = Math.max(9, 30 * g.s * k);
    if (k > 0.22) {
      const label = n.flags.dead ? 'X' : n.flags.ghost ? `(${n.fret})` : String(n.fret);
      this.text(label, p.x, p.y + fs * 0.36, fs, '#ffffff', 'center', true);
      const tags = [];
      if (n.flags.hopo) tags.push(this.hopoLabel.get(n) || 'H');
      if (n.flags.slide) tags.push(n.flags.slide.toFret !== null && n.flags.slide.toFret < n.fret ? '↘' : '↗');
      if (n.flags.palmMute) tags.push('PM');
      if (n.flags.harmonic) tags.push('◆');
      if (n.flags.bend) tags.push('⤴');
      if (tags.length && k > 0.4) this.text(tags.join(' '), p.x, p.y - gh / 2 - 4 * g.s, fs * 0.7, '#e8e8ea', 'center');
    }
    ctx.globalAlpha = 1;
  }

  barAt(t) {
    const bars = this.chart.bars;
    let lo = 0, hi = bars.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].t <= t) { best = bars[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  }

  text(str, x, y, size, color, align = 'left', bold = false) {
    const ctx = this.ctx;
    ctx.font = `${bold ? '700' : '600'} ${Math.round(size)}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    if (bold) { ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(str, x, y); }
    ctx.fillText(str, x, y);
  }
}
