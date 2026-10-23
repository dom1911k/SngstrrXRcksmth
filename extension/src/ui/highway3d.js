// Rocksmith 2014-style 3D note highway (WebGL via three.js).
//
// World units: x = frets (1 unit per fret, nut at x = 0), y = up (floor at 0,
// strings stacked above it, low E on top by default), z = time (z = 0 is the
// strike line at the strings; upcoming notes are at negative z, far away).
// A camera behind the strings frames the frets of the current passage and
// stays still while you play it (see core/camera-follow.js).
//
// Same interface as Highway2D: setChart(chart), setOptions(o), render(state), fps.

import * as THREE from '../../vendor/three/three.module.min.js';
import { stringColors } from '../core/music.js';
import { computeAnchors, anchorAt, firstNoteAtOrAfter } from '../core/chart.js';
import { CameraFollow, planCameraSegments } from '../core/camera-follow.js';

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
const CAM = { fov: 26, strikeNdc: 0.6, farNdc: 0.86, widthFactor: 0.5, extraWidth: 0.5 };
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

// One mesh for many flat quads lying on (or parallel to) the floor, in the
// time group's coordinates (z in seconds). quads: [x0, x1, t0, t1, y, x0b?, x1b?]
// where x0b/x1b are the x edges at t1 (for slides); defaults to x0/x1.
function mergedQuads(quads, material) {
  const pos = new Float32Array(quads.length * 18);
  let o = 0;
  for (const [x0, x1, t0, t1, y, x0b = x0, x1b = x1] of quads) {
    pos.set([x0, y, -t0, x1, y, -t0, x1b, y, -t1, x0, y, -t0, x1b, y, -t1, x0b, y, -t1], o);
    o += 18;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // spans the whole song; culling would not help
  return mesh;
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
    this.follow = new CameraFollow();
    this.lit = new Float32Array(6);
    this.litPrev = new Float32Array(6);
    this.labelKey = '';
    this.lastRenderKey = '';
    this.quality = { maxDpr: 2, slowFor: 0 };

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
    // Shades darken the frets outside the current camera frame (frets that
    // aren't played in this passage). Unit-width planes, resized per frame.
    const shadeMat = new THREE.MeshBasicMaterial({ color: BG, transparent: true, opacity: 0.72, depthWrite: false });
    this.shades = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, DEPTH + 30), shadeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.02, -(DEPTH + 30) / 2 + 6);
      m.renderOrder = 1;
      S.add(m);
      return m;
    });
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
    this.lastRenderKey = '';
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
    this.follow = new CameraFollow(planCameraSegments(chart.notes));
    this.labelKey = '';
    this.lastRenderKey = '';

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

    // Beat lines and anchor lanes live in seconds (timeGroup is scaled by k).
    // Merged into a few meshes: one draw call per kind instead of hundreds.
    const beatMat = new THREE.MeshBasicMaterial({ color: 0x8a93aa, transparent: true, opacity: 0.35, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const barMat = new THREE.MeshBasicMaterial({ color: 0xdfe4f0, transparent: true, opacity: 0.6, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const beatQuads = [], barQuads = [];
    for (const b of chart.beats) {
      const w = b.downbeat ? 0.028 : 0.014;
      (b.downbeat ? barQuads : beatQuads).push([0, MAX_FRET, b.t - w / 2, b.t + w / 2, 0.012]);
    }
    if (beatQuads.length) this.timeGroup.add(mergedQuads(beatQuads, beatMat));
    if (barQuads.length) this.timeGroup.add(mergedQuads(barQuads, barMat));

    const anchorMat = new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.16, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const anchorEdgeMat = new THREE.MeshBasicMaterial({ color: 0xbcd2ff, transparent: true, opacity: 0.5, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const end = chart.duration + 2;
    const laneQuads = [], edgeQuads = [];
    for (const a of this.anchors) {
      const t1 = a.t + Math.max(0.05, Math.min(a.until, end) - a.t);
      laneQuads.push([a.fret - 1, a.fret + 3, a.t, t1, 0.008]);
      for (const x of [a.fret - 1, a.fret + 3]) edgeQuads.push([x - 0.025, x + 0.025, a.t, t1, 0.01]);
      // Fret number where the hand moves (yellow, on the floor).
      const sp = new THREE.Sprite(this.label(String(a.fret), '#f2c418'));
      sp.scale.set(0.9, 0.9, 1);
      sp.position.set(a.fret - 1.45, 0.45, -a.t);
      this.timeGroup.add(sp);
    }
    if (laneQuads.length) {
      this.timeGroup.add(mergedQuads(laneQuads, anchorMat));
      this.timeGroup.add(mergedQuads(edgeQuads, anchorEdgeMat));
    }
    const tailQuads = colors.map(() => []);
    const stemGeo = new THREE.BoxGeometry(0.04, 1, 0.04); stemGeo.userData.shared = true;

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
        const stem = new THREE.Mesh(stemGeo, this.stemMats[s]);
        stem.scale.y = stemH;
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
        tailQuads[s].push([x - hw, x + hw, note.t, note.t + note.dur, y, x1 - hw, x1 + hw]);
      }
      this.noteObjs.push({ note, obj, gem });
      prevOnString[s] = note;
    }
    tailQuads.forEach((q, s) => { if (q.length) this.timeGroup.add(mergedQuads(q, this.tailMats[s])); });
    this.visibleFrom = 0;
    this.visibleTo = 0;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
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
    this.adaptQuality(dt);
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
      const lit = this.lit;
      lit.fill(0);
      for (let i = Math.max(0, from - 40); i < to; i++) {
        const n = notes[i];
        if (n.t <= t && t <= n.t + Math.max(0.12, n.dur)) lit[n.string] = Math.max(lit[n.string], 1 - (t - n.t) / Math.max(0.3, n.dur + 0.2));
      }
      this.stringMats.forEach((m, s) => { m.emissiveIntensity = 0.45 + lit[s] * 1.4; });

      // Camera frames the current passage (see core/camera-follow.js).
      this.follow.update(t, speed, dt);
      const { lo: frameLo, hi: frameHi } = this.follow;
      const [left, right] = this.shades;
      left.scale.x = Math.max(0.001, frameLo + 3);
      left.position.x = (frameLo - 3) / 2;
      right.scale.x = Math.max(0.001, MAX_FRET + 3 - frameHi);
      right.position.x = (frameHi + MAX_FRET + 3) / 2;

      // Fret numbers: yellow under the hand, dim outside the frame.
      const cur = anchorAt(this.anchors, t);
      const hand = cur ? cur.fret : null;
      const key = `${hand}|${Math.round(frameLo * 2)}|${Math.round(frameHi * 2)}`;
      if (key !== this.labelKey) {
        this.labelKey = key;
        this.fretLabels.forEach((sp, i) => {
          const f = i + 1;
          const inHand = hand !== null && f >= hand && f <= hand + 3;
          const inFrame = f - 0.5 >= frameLo && f - 0.5 <= frameHi;
          sp.material = this.label(String(f), inHand ? '#f2c418' : inFrame ? '#7d8597' : '#2e3442');
        });
      }
    }

    // Nothing moves while paused: skip drawing the same picture again.
    const camX = this.follow.x, camSpan = this.follow.span;
    const key = `${t.toFixed(4)}|${camX.toFixed(3)}|${camSpan.toFixed(3)}|${this.w}x${this.h}|${this.dpr}|${k.toFixed(4)}|${this.chart ? this.chart.notes.length : 0}`;
    if (!state.playing && key === this.lastRenderKey) return;
    this.lastRenderKey = key;

    // Camera: behind and above the strings, looking down the highway.
    const cam = this.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(CAM.fov) / 2);
    const halfW = camSpan * CAM.widthFactor + CAM.extraWidth;         // half width at the strings
    // Wide, short windows show more frets instead of zooming in.
    const d0 = halfW / (tanV * Math.min(1.9, Math.max(0.6, cam.aspect))); // distance to the strike line
    const place = (pitch) => {
      const down = pitch + Math.atan(CAM.strikeNdc * tanV);            // angle down to the strike line
      const camH = d0 * Math.sin(down), camZ = d0 * Math.cos(down);
      cam.position.set(camX, camH, camZ);
      cam.lookAt(camX, 0, camZ - camH / Math.tan(pitch));
      cam.updateMatrixWorld();
    };
    let lo = THREE.MathUtils.degToRad(2), hi = THREE.MathUtils.degToRad(45);
    const far = this._far || (this._far = new THREE.Vector3());
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      place(mid);
      far.set(camX, 0, -DEPTH).project(cam);
      if (far.y > CAM.farNdc) hi = mid; else lo = mid;
    }
    place((lo + hi) / 2);
    this.renderer.render(this.scene, cam);
  }

  // If the PC can't keep up (< ~50 fps for 2 s while playing), render at a
  // lower resolution instead of stuttering. Never raises it again in a session.
  adaptQuality(dt) {
    const q = this.quality;
    if (dt > 1 / 50 && dt < 0.1) q.slowFor += dt; else q.slowFor = Math.max(0, q.slowFor - dt * 0.5);
    if (q.slowFor > 2 && (this.dpr || 1) > 1) {
      q.maxDpr = this.dpr > 1.5 ? 1.5 : 1;
      q.slowFor = 0;
      console.info(`[Bass Trainer] 3D highway: lowering resolution (pixel ratio ${q.maxDpr}) to keep it smooth`);
    }
  }
}
