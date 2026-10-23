// Rocksmith 2014-style 3D note highway (WebGL via three.js).
//
// World units: x = frets (1 unit per fret, nut at x = 0), y = up (floor at 0,
// strings stacked above it, low E on top by default), z = time (z = 0 is the
// strike line at the strings; upcoming notes are at negative z, far away).
// A camera behind the strings follows the hand position (anchor) smoothly.
//
// Same interface as Highway2D: setChart(chart), setOptions(o), render(state), fps.

import * as THREE from '../../vendor/three/three.module.min.js';
import { stringColors } from '../core/music.js';
import { computeAnchors, anchorAt, firstNoteAtOrAfter } from '../core/chart.js';

const DEPTH = 40;            // world units from the strike line to the far end
const MAX_FRET = 24;
const BG = 0x06070c;
const STRING_GAP = 0.38;
const STRING_BASE = 0.42;    // height of the lowest drawn string above the floor
// Camera: behind and above the strings, looking down the highway (scaled by zoom).
// Camera placement: the strike line sits `strikeNdc` below the screen centre
// (0.62 = about 80% down), the view is tilted down by `pitchDeg`, and the
// camera backs off until about camSpan frets fit across the strings.
// The tilt is solved per frame so that the far end of the highway sits at
// `farNdc` (just below the top edge) for any window shape.
const CAM = { fov: 26, strikeNdc: 0.6, farNdc: 0.86, widthFactor: 0.72, extraWidth: 1.2 };
const GEM_W = 0.78, GEM_H = 0.34, GEM_D = 0.24;
const PAST_KEEP = 0.045;     // seconds a gem stays after its hit time

function labelTexture(text, { color = '#ffffff', size = 128, font = 'bold 84px system-ui, "Segoe UI", sans-serif', outline = 'rgba(0,0,0,0.85)' } = {}) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = outline;
  g.strokeText(text, size / 2, size / 2 + 4);
  g.fillStyle = color;
  g.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Highway3D {
  static isSupported() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.options = { lookahead: 3.5, invertStrings: false, showDebug: false, showFretNumbers: true };
    this.chart = null;
    this.fps = 60;
    this.lastFrame = 0;
    this.camX = 4;
    this.camSpan = 8;

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setClearColor(BG);
    r.localClippingEnabled = true;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(BG, DEPTH * 0.75, DEPTH * 1.08);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 2, 0.1, DEPTH + 30);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 8, 6);
    this.scene.add(sun);

    // Clip time-objects that have passed the strike line (z > 0).
    this.clipStrike = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.05)];
    this.clipFloor = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.2)];

    this.labelCache = new Map();
    this.glowTex = glowTexture();
    this.buildStatic();
    this.timeGroup = new THREE.Group();   // children in seconds along -z; scaled per frame
    this.noteGroup = new THREE.Group();   // gems, positioned per frame
    this.scene.add(this.timeGroup, this.noteGroup);
    this.flashes = [];
  }

  label(text, color = '#ffffff') {
    const key = `${text}|${color}`;
    if (!this.labelCache.has(key)) {
      this.labelCache.set(key, new THREE.SpriteMaterial({ map: labelTexture(text, { color }), transparent: true, depthWrite: false, fog: true }));
    }
    return this.labelCache.get(key);
  }

  buildStatic() {
    const S = this.static = new THREE.Group();
    // Floor (the neck), slightly lighter than the background.
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a2030 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAX_FRET + 4, DEPTH + 30), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(MAX_FRET / 2, 0, -(DEPTH + 30) / 2 + 12);
    S.add(floor);
    // Fret wires running into the distance.
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x6d7790 });
    const nutMat = new THREE.MeshBasicMaterial({ color: 0xe6e6e6 });
    for (let w = 0; w <= MAX_FRET; w++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w === 0 ? 0.08 : 0.035, 0.01, DEPTH + 14), w === 0 ? nutMat : wireMat);
      m.position.set(w, 0.006, -(DEPTH + 14) / 2 + 6);
      S.add(m);
    }
    // Fret numbers on the floor in front of the strings.
    this.fretLabels = [];
    for (let f = 1; f <= MAX_FRET; f++) {
      const sp = new THREE.Sprite(this.label(String(f), '#7d8597'));
      sp.scale.set(0.48, 0.48, 1);
      sp.position.set(f - 0.5, 0.12, 0.75);
      S.add(sp);
      this.fretLabels.push(sp);
    }
    this.scene.add(S);
  }

  setOptions(o) {
    const invertChanged = o.invertStrings !== undefined && o.invertStrings !== this.options.invertStrings;
    Object.assign(this.options, o);
    if (invertChanged && this.chart) this.setChart(this.chart);
  }

  stringY(string) {
    const n = this.chart.instrument.strings;
    const row = this.options.invertStrings ? n - 1 - string : string; // row 0 = top
    return STRING_BASE + (n - 1 - row) * STRING_GAP;
  }

  clearChart() {
    for (const g of [this.timeGroup, this.noteGroup]) {
      for (const child of [...g.children]) {
        g.remove(child);
        child.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
      }
    }
    if (this.stringMeshes) for (const m of this.stringMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.stringMeshes = [];
    this.noteObjs = [];
  }

  setChart(chart) {
    this.clearChart();
    this.chart = chart;
    if (!chart) return;
    const n = chart.instrument.strings;
    const colors = stringColors(n);
    this.colors = colors;
    this.anchors = computeAnchors(chart.notes);
    const first = this.anchors[0];
    this.camX = first ? first.fret + 1 : 4;

    // Strings at the strike line.
    this.stringMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.4 }));
    for (let s = 0; s < n; s++) {
      const row = this.options.invertStrings ? n - 1 - s : s;
      const radius = 0.035 + (n - 1 - row) * 0.0 + (s === 0 ? 0.02 : s === 1 ? 0.012 : 0.006);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, MAX_FRET + 3, 10), this.stringMats[s]);
      m.rotation.z = Math.PI / 2;
      m.position.set(MAX_FRET / 2, this.stringY(s), 0);
      this.scene.add(m);
      this.stringMeshes.push(m);
    }

    // Materials.
    this.gemMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.1 }));
    this.ghostMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, transparent: true, opacity: 0.35 }));
    this.deadMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.35), emissive: c, emissiveIntensity: 0.12, roughness: 0.6 }));
    this.stemMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, fog: true }));
    this.tailMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, clippingPlanes: this.clipStrike, depthWrite: false }));
    this.glowMats = colors.map((c) => new THREE.SpriteMaterial({ map: this.glowTex, color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const gemGeo = new THREE.BoxGeometry(GEM_W, GEM_H, GEM_D); gemGeo.userData.shared = true;
    const edgeGeo = new THREE.EdgesGeometry(gemGeo); edgeGeo.userData.shared = true;
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });

    // Beat lines and anchor bands live in seconds (timeGroup is scaled by k).
    const beatMat = new THREE.MeshBasicMaterial({ color: 0x8a93aa, transparent: true, opacity: 0.35, clippingPlanes: this.clipFloor, depthWrite: false });
    const barMat = new THREE.MeshBasicMaterial({ color: 0xdfe4f0, transparent: true, opacity: 0.6, clippingPlanes: this.clipFloor, depthWrite: false });
    for (const b of chart.beats) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(MAX_FRET, b.downbeat ? 0.028 : 0.014), b.downbeat ? barMat : beatMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(MAX_FRET / 2, 0.012, -b.t);
      this.timeGroup.add(m);
    }
    const anchorMat = new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.16, clippingPlanes: this.clipFloor, depthWrite: false });
    const anchorEdgeMat = new THREE.MeshBasicMaterial({ color: 0xbcd2ff, transparent: true, opacity: 0.5, clippingPlanes: this.clipFloor, depthWrite: false });
    const end = chart.duration + 2;
    this.anchorLabels = [];
    for (const a of this.anchors) {
      const len = Math.max(0.05, Math.min(a.until, end) - a.t);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4, len), anchorMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(a.fret + 1, 0.008, -(a.t + len / 2));
      this.timeGroup.add(m);
      for (const x of [a.fret - 1, a.fret + 3]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(0.05, len), anchorEdgeMat);
        e.rotation.x = -Math.PI / 2;
        e.position.set(x, 0.01, -(a.t + len / 2));
        this.timeGroup.add(e);
      }
      // Fret number where the hand moves (yellow, on the floor).
      const sp = new THREE.Sprite(this.label(String(a.fret), '#f2c418'));
      sp.scale.set(0.9, 0.9, 1);
      sp.position.set(a.fret - 1.45, 0.45, -a.t);
      this.timeGroup.add(sp);
    }

    // Notes.
    const prevOnString = [];
    for (const note of chart.notes) {
      const s = note.string;
      const y = this.stringY(s);
      const open = note.fret === 0;
      const anchor = anchorAt(this.anchors, note.t);
      const a0 = anchor ? anchor.fret - 1 : 0;
      const x = open ? a0 + 2 : note.fret - 0.5;
      const obj = new THREE.Group();
      const mat = note.flags.dead ? this.deadMats[s] : note.flags.ghost ? this.ghostMats[s] : this.gemMats[s];
      const gem = new THREE.Mesh(gemGeo, mat);
      if (open) gem.scale.set(4 / GEM_W * 0.96, 0.55, 1);
      if (note.flags.ghost) gem.scale.multiplyScalar(0.8);
      obj.add(gem);
      if (!note.flags.ghost) {
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.scale.copy(gem.scale);
        obj.add(edges);
      }
      const glow = new THREE.Sprite(this.glowMats[s]);
      glow.scale.set(open ? 4.6 : 1.5, 0.9, 1);
      glow.position.z = -0.02;
      glow.renderOrder = -1;
      obj.add(glow);
      // Stem down to the floor.
      const stemH = y - GEM_H / 2;
      if (stemH > 0.02) {
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, stemH, 0.04), this.stemMats[s]);
        stem.position.y = -GEM_H / 2 - stemH / 2;
        obj.add(stem);
      }
      // Fret number (or X) on the gem.
      if (this.options.showFretNumbers || note.flags.dead) {
        const txt = note.flags.dead ? 'X' : String(note.fret);
        const sp = new THREE.Sprite(this.label(txt));
        sp.scale.set(0.5, 0.5, 1);
        sp.position.set(0, 0.02, GEM_D / 2 + 0.03);
        sp.renderOrder = 2;
        obj.add(sp);
      }
      // Technique tag above the gem.
      const tags = [];
      if (note.flags.hopo) tags.push(prevOnString[s] && note.fret < prevOnString[s].fret ? 'P' : 'H');
      if (note.flags.palmMute) tags.push('PM');
      if (note.flags.harmonic) tags.push('◆');
      if (note.flags.bend) tags.push('⤴');
      if (tags.length) {
        const sp = new THREE.Sprite(this.label(tags.join(' '), '#e8e8ea'));
        sp.scale.set(0.55, 0.55, 1);
        sp.position.set(0, GEM_H / 2 + 0.24, 0);
        obj.add(sp);
      }
      obj.position.set(x, y, -1000);
      obj.visible = false;
      this.noteGroup.add(obj);

      // Sustain / slide tail in seconds (timeGroup), a ribbon at string height.
      const sustain = (note.dur >= 0.5 || (note.flags.slide && note.dur > 0.15)) && !note.flags.dead && !note.flags.staccato;
      if (sustain) {
        const toFret = note.flags.slide && note.flags.slide.toFret !== null && note.flags.slide.toFret !== undefined ? note.flags.slide.toFret : null;
        const x1 = open ? x : toFret !== null ? Math.max(0.5, toFret - 0.5) : x;
        const hw = open ? 0.35 : 0.16;
        const geo = new THREE.BufferGeometry();
        const t0 = note.t, t1 = note.t + note.dur;
        geo.setAttribute('position', new THREE.Float32BufferAttribute([
          x - hw, y, -t0, x + hw, y, -t0, x1 + hw, y, -t1,
          x - hw, y, -t0, x1 + hw, y, -t1, x1 - hw, y, -t1,
        ], 3));
        const tail = new THREE.Mesh(geo, this.tailMats[s]);
        this.timeGroup.add(tail);
      }
      this.noteObjs.push({ note, obj, gem });
      prevOnString[s] = note;
    }
    this.visibleFrom = 0;
    this.visibleTo = 0;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = Math.max(0.1, w / Math.max(1, h));
      this.camera.updateProjectionMatrix();
    }
  }

  // state: { time (song s), speed, playing, loop, message }
  render(state) {
    const nowMs = performance.now();
    const dt = this.lastFrame ? Math.min(0.1, (nowMs - this.lastFrame) / 1000) : 0.016;
    if (this.lastFrame) this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
    this.lastFrame = nowMs;
    this.resize();
    if (!this.w || !this.h) return;

    const chart = this.chart;
    const t = state.time;
    const speed = state.speed || 1;
    const look = this.options.lookahead * speed;   // song seconds visible
    const k = DEPTH / look;                        // world units per song second

    if (chart) {
      // Time group: z(world) = (t - noteTime) * k  ->  position.z = t*k, scale.z = k.
      this.timeGroup.position.z = t * k;
      this.timeGroup.scale.z = k;

      // Gems: show and place only those in the window.
      const notes = chart.notes;
      const from = firstNoteAtOrAfter(notes, t - PAST_KEEP);
      let to = from;
      while (to < notes.length && notes[to].t <= t + look * 1.02) to++;
      for (let i = this.visibleFrom; i < this.visibleTo; i++) {
        if (i < from || i >= to) this.noteObjs[i].obj.visible = false;
      }
      for (let i = from; i < to; i++) {
        const o = this.noteObjs[i];
        const dz = (o.note.t - t) * k;
        o.obj.visible = true;
        o.obj.position.z = -dz;
        // Hit flash: grow a little as the note reaches the strings.
        const near = Math.abs(o.note.t - t);
        const pop = near < 0.07 ? 1 + (0.07 - near) * 4 : 1;
        o.obj.scale.setScalar(pop);
      }
      this.visibleFrom = from;
      this.visibleTo = to;

      // Strings light up while a note on them is sounding.
      const lit = new Array(chart.instrument.strings).fill(0);
      for (let i = Math.max(0, from - 40); i < to; i++) {
        const n = notes[i];
        if (n.t <= t && t <= n.t + Math.max(0.12, n.dur)) lit[n.string] = Math.max(lit[n.string], 1 - (t - n.t) / Math.max(0.3, n.dur + 0.2));
      }
      this.stringMats.forEach((m, s) => { m.emissiveIntensity = 0.45 + lit[s] * 1.4; });

      // Camera follows the hand position over the next ~1.5 s.
      let lo = Infinity, hi = -Infinity;
      for (const a of this.anchors) {
        if (a.until < t || a.t > t + 1.5 * speed) continue;
        lo = Math.min(lo, a.fret - 1);
        hi = Math.max(hi, a.fret + 3);
      }
      if (!Number.isFinite(lo)) { const a = anchorAt(this.anchors, t); lo = a ? a.fret - 1 : 0; hi = lo + 4; }
      const targetX = (lo + hi) / 2;
      const targetSpan = Math.max(6, hi - lo + 2);
      const follow = Math.min(1, dt * 2.5);
      this.camX += (targetX - this.camX) * follow;
      this.camSpan += (targetSpan - this.camSpan) * follow;

      // Highlight fret numbers under the hand.
      const cur = anchorAt(this.anchors, t);
      this.fretLabels.forEach((sp, i) => {
        const f = i + 1;
        const inHand = cur && f >= cur.fret && f <= cur.fret + 3;
        sp.material = this.label(String(f), inHand ? '#f2c418' : '#7d8597');
      });
    }

    // Camera: behind and above the strings, looking down the highway.
    const cam = this.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(CAM.fov) / 2);
    const halfW = this.camSpan * CAM.widthFactor + CAM.extraWidth;    // half width at the strings
    // Wide, short windows show more frets instead of zooming in.
    const d0 = halfW / (tanV * Math.min(1.9, Math.max(0.6, cam.aspect))); // distance to the strike line
    const place = (pitch) => {
      const down = pitch + Math.atan(CAM.strikeNdc * tanV);            // angle down to the strike line
      const camH = d0 * Math.sin(down), camZ = d0 * Math.cos(down);
      cam.position.set(this.camX, camH, camZ);
      cam.lookAt(this.camX, 0, camZ - camH / Math.tan(pitch));
      cam.updateMatrixWorld();
    };
    let lo = THREE.MathUtils.degToRad(2), hi = THREE.MathUtils.degToRad(45);
    const far = this._far || (this._far = new THREE.Vector3());
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      place(mid);
      far.set(this.camX, 0, -DEPTH).project(cam);
      if (far.y > CAM.farNdc) hi = mid; else lo = mid;
    }
    place((lo + hi) / 2);
    this.renderer.render(this.scene, cam);
  }
}
