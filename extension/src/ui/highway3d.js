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
import { roundedGemGeometry, shadowTexture, wideLabelTexture, slotTexture, beamTexture, Particles, Bloom } from './highway3d-fx.js';

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
// RS2014-like view: strings low on screen, lane running up to near the top.
// 0.6.1: wider lens from closer and lower = flatter view with a visible horizon.
const CAM = { fov: 36, strikeNdc: 0.75, farNdc: 0.76, widthFactor: 0.62, extraWidth: 1.2, fogStart: 0.82 };
// Looks (setting "theme"). Strings and notes keep the Rocksmith colours in all.
export const THEMES = {
  classic: { bg: 0x06070c, floor: 0x1a2030, wire: 0x6d7790, lane: 0x8fb4ff, laneBase: 0.16, beams: [0x3a4f9a, 0x5a3d8f, 0x3d6d9a, 0x4a3a8a], beamOpacity: 0.16, horizon: 0x233366, glow: 0.38, outline: 0.75 },
  stage: { bg: 0x0a0612, floor: 0x211a30, wire: 0x7a6f98, lane: 0xc9a0ff, laneBase: 0.17, beams: [0xb03a8a, 0xd08a2a, 0x3aa0d0, 0x8a3ad0], beamOpacity: 0.26, horizon: 0x5a2266, glow: 0.5, outline: 0.75 },
  minimal: { bg: 0x0b0c10, floor: 0x15171d, wire: 0x4a505e, lane: 0x9aa6c0, laneBase: 0.12, beams: null, beamOpacity: 0, horizon: null, glow: 0, outline: 0.5 },
  contrast: { bg: 0x000000, floor: 0x10141e, wire: 0xb8c2d8, lane: 0xffffff, laneBase: 0.2, beams: null, beamOpacity: 0, horizon: 0x1a2a55, glow: 0.3, outline: 1 },
};

const GEM_W = 0.78, GEM_H = 0.34, GEM_D = 0.24;
const GEM_GROW = 0.35;       // far gems are up to 35% bigger (readability)
const PAST_KEEP = 0.045;     // seconds a gem stays after its hit time

// Text on a 256 px canvas (crisp on high-DPI screens), mipmapped.
function labelTexture(text, { color = '#ffffff', size = 256, outline = 'rgba(0,0,0,0.85)' } = {}) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const k = size / 128;
  g.font = `800 ${Math.round(84 * k)}px system-ui, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 12 * k;
  g.strokeStyle = outline;
  g.strokeText(text, size / 2, size / 2 + 4 * k);
  g.fillStyle = color;
  g.fillText(text, size / 2, size / 2 + 4 * k);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Subtle fretboard texture: darker grooves and fine grain (grey, multiplied
// with the theme's floor colour).
function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    const v = 225 + Math.floor(rnd() * 30);
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1, 2 + Math.floor(rnd() * 10));
  }
  const grad = g.createLinearGradient(0, 0, 256, 0);   // darker towards the fret wires
  grad.addColorStop(0, 'rgba(0,0,0,0.22)'); grad.addColorStop(0.18, 'rgba(0,0,0,0)');
  grad.addColorStop(0.82, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// A soft "studio" environment for reflections on gems, strings and frets.
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  const panel = (color, intensity, w, hgt, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.rotation.set(...rot);
    scene.add(m);
  };
  panel(0xffffff, 3, 8, 2, [0, 6, 2], [Math.PI / 2, 0, 0]);       // soft key light above
  panel(0x6f8cff, 1.6, 10, 4, [0, 2, -9], [0, 0, 0]);            // blue stage glow ahead
  panel(0xffb070, 1.2, 4, 6, [-8, 2, 0], [0, Math.PI / 2, 0]);   // warm side light
  panel(0x9a6fff, 1.0, 4, 6, [8, 2, 0], [0, -Math.PI / 2, 0]);   // purple side light
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return env;
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
    this.options = { lookahead: 4.5, invertStrings: false, showDebug: false, showFretNumbers: true, glow: true, sparks: true, timingMarks: false };
    this.chart = null;
    this.fps = 60;
    this.lastFrame = 0;
    this.follow = new CameraFollow();
    this.lit = new Float32Array(6);
    this.sustainLit = new Float32Array(6);
    this.sectionLabels = [];
    this.litPrev = new Float32Array(6);
    this.labelKey = '';
    this.lastRenderKey = '';
    this.quality = { maxDpr: 2, slowFor: 0, level: 'auto' };

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setClearColor(BG);
    r.localClippingEnabled = true;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    try { this.envMap = studioEnvironment(r); this.scene.environment = this.envMap; } catch (err) { console.warn('[Bass Trainer] no environment lighting', err); }
    this.scene.fog = new THREE.Fog(BG, DEPTH * 0.75, DEPTH * 1.08);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 2, 0.5, DEPTH + 40); // near 0.5: better depth precision

    // Soft glow on the horizon behind the far end of the highway (not fogged).
    this.horizon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x233366, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.horizon.scale.set(70, 16, 1);
    this.horizon.renderOrder = -10;
    this.scene.add(this.horizon);

    // Stage backdrop: a few slow, faint light beams behind the horizon.
    this.beams = [-26, -9, 9, 26].map((x, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: beamTexture(), color: [0x3a4f9a, 0x5a3d8f, 0x3d6d9a, 0x4a3a8a][i], transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
      sp.scale.set(9, 46, 1);
      sp.renderOrder = -9;
      sp.userData = { x, phase: i * 1.7 };
      this.scene.add(sp);
      return sp;
    });

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242e, 0.6));
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 8, 6);
    this.scene.add(sun);

    // Clip time-objects that have passed the strike line (z > 0).
    this.clipStrike = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.05)];
    this.clipFloor = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.2)];
    this.clipBeats = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.3)]; // beat lines vanish just after the strings

    this.labelCache = new Map();
    this.glowTex = glowTexture();
    this.shadowTex = shadowTexture();
    this.slotTex = slotTexture();
    this.particles = new Particles(this.scene);
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
    // Pushed back in the depth buffer so lines lying on it never flicker
    // (z-fighting at the flat viewing angle).
    const floorTex = floorTexture();
    floorTex.repeat.set(MAX_FRET + 4, (DEPTH + 30) / 6);
    const floorMat = this.floorMat = new THREE.MeshLambertMaterial({ color: 0x1a2030, map: floorTex, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAX_FRET + 4, DEPTH + 30), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(MAX_FRET / 2, 0, -(DEPTH + 30) / 2 + 12);
    S.add(floor);
    // Fret wires running into the distance.
    // Fret wires: metal that catches the light (a bit raised above the floor).
    const wireMat = this.wireMat = new THREE.MeshStandardMaterial({ color: 0x6d7790, metalness: 0.8, roughness: 0.35, emissive: 0x6d7790, emissiveIntensity: 0.45 });
    const nutMat = new THREE.MeshBasicMaterial({ color: 0xc4c8d0 });
    for (let w = 0; w <= MAX_FRET; w++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w === 0 ? 0.08 : 0.035, 0.016, DEPTH + 14), w === 0 ? nutMat : wireMat);
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
    // Inlay dots on the fretboard (3, 5, 7, 9, 12 double, …) between the strings and the numbers.
    const inlayMat = new THREE.MeshBasicMaterial({ color: 0x8c96ad, transparent: true, opacity: 0.35, depthWrite: false });
    const inlayGeo = new THREE.CircleGeometry(0.11, 20);
    inlayGeo.rotateX(-Math.PI / 2);
    for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      for (const dz of f % 12 === 0 ? [-0.14, 0.14] : [0]) {
        const m = new THREE.Mesh(inlayGeo, inlayMat);
        m.position.set(f - 0.5 + dz, 0.014, -0.45);
        S.add(m);
      }
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

  // Hit indicator: a soft spot on the string at the note's fret. It brightens
  // as the note approaches (last ~0.6 s), flashes briefly at the exact moment
  // to play, then fades. Purely a timing cue, not a judgement.
  updateTargets(t, speed, heard) {
    if (!this.targetPool) {
      this.targetPool = Array.from({ length: 14 }, () => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
        sp.visible = false;
        sp.renderOrder = 5;
        this.scene.add(sp);
        return sp;
      });
    }
    if (!this.slotPool) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      this.slotPool = Array.from({ length: 8 }, () => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.slotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        m.visible = false;
        m.renderOrder = 2;
        this.scene.add(m);
        return m;
      });
    }
    const notes = this.chart.notes;
    const before = 0.6 * speed, after = 0.16 * speed;
    let used = 0, slots = 0;
    for (let i = firstNoteAtOrAfter(notes, t - after); i < notes.length && notes[i].t <= t + before && used < this.targetPool.length; i++) {
      const n = notes[i];
      if (n.flags.ghost) continue;
      const o = this.noteObjs[i];
      const real = (n.t - t) / speed;           // seconds until the note, real time
      let alpha;
      if (real > 0.04) alpha = 0.12 + 0.33 * (1 - real / 0.6);
      else if (real > -0.04) alpha = 0.95;
      else alpha = 0.95 * Math.max(0, 1 + (real + 0.04) / 0.12);
      if (alpha <= 0.01) continue;
      const sp = this.targetPool[used++];
      sp.material.color.set(this.colors[n.string] || '#ffffff');
      sp.material.opacity = alpha;
      const open = n.fret === 0;
      sp.scale.set(open ? 4.2 : 1.0, real > -0.04 && real < 0.04 ? 0.42 : 0.3, 1);
      sp.position.set(o.obj.position.x, o.obj.position.y, 0.03);
      sp.visible = true;
      // The fret on the fretboard lights up under the note as it arrives.
      if (slots < this.slotPool.length) {
        const m = this.slotPool[slots++];
        m.material.color.set(this.colors[n.string] || '#ffffff');
        m.material.opacity = Math.min(0.55, alpha * 0.6);
        m.scale.set(open ? 3.9 : 0.94, 1, 2.2);
        m.position.set(o.obj.position.x, 0.016, 0.25);
        m.visible = true;
      }
    }
    for (let k = slots; k < this.slotPool.length; k++) this.slotPool[k].visible = false;
    // Held notes: while you hold the right pitch, a bright flare stays on the
    // string at the note's fret (Rocksmith's sustain feedback).
    this.sustainLit.fill(0);
    if (heard) {
      for (let i = Math.max(0, firstNoteAtOrAfter(notes, t - 8)); i < notes.length && notes[i].t <= t && used < this.targetPool.length; i++) {
        const n = notes[i];
        if (n.dur < 0.3 || t > n.t + n.dur || n.flags.dead || n.flags.ghost) continue;
        const d = heard - n.midi;
        if (!(Math.abs(d) < 0.6 || Math.abs(Math.abs(d) - 12) < 0.6)) continue;
        const o = this.noteObjs[i];
        const sp = this.targetPool[used++];
        sp.material.color.set(this.colors[n.string] || '#ffffff');
        sp.material.opacity = 0.75 + 0.15 * Math.sin(performance.now() / 60);
        sp.scale.set(n.fret === 0 ? 4.4 : 1.25, 0.5, 1);
        sp.position.set(o.obj.position.x, o.obj.position.y, 0.03);
        sp.visible = true;
        this.sustainLit[n.string] = 1;
      }
    }
    for (let k = used; k < this.targetPool.length; k++) this.targetPool[k].visible = false;
  }

  setOptions(o) {
    const invertChanged = o.invertStrings !== undefined && o.invertStrings !== this.options.invertStrings;
    const themeChanged = o.theme !== undefined && o.theme !== this.options.theme;
    const qualityChanged = o.quality !== undefined && o.quality !== this.quality.level;
    Object.assign(this.options, o);
    this.lastRenderKey = '';
    if (themeChanged || !this.themeApplied) this.applyTheme();
    if (qualityChanged) this.applyQuality(o.quality);
    if (invertChanged && this.chart) this.setChart(this.chart);
  }

  theme() { return THEMES[this.options.theme] || THEMES.classic; }

  // Graphics quality: 'high' (full resolution, all effects, never lowered),
  // 'auto' (lowers itself if the PC can't keep up) or 'low' (for slow PCs).
  applyQuality(level) {
    const q = this.quality;
    q.level = level || 'auto';
    q.maxDpr = q.level === 'low' ? 1 : 2;
    q.noGlow = q.level === 'low';
    q.slowFor = 0;
    this.scene.environment = q.level === 'low' ? null : this.envMap || null;
    if (this.chart) this.setChart(this.chart);   // gem materials depend on the level
    this.lastRenderKey = '';
  }

  applyTheme() {
    const th = this.theme();
    this.themeApplied = true;
    this.renderer.setClearColor(th.bg);
    this.scene.fog.color.set(th.bg);
    if (this.floorMat) this.floorMat.color.set(th.floor);
    if (this.wireMat) this.wireMat.color.set(th.wire);
    if (this.anchorMat) this.anchorMat.color.set(th.lane);
    if (this.edgeMat) this.edgeMat.opacity = th.outline;
    this.beams.forEach((b, i) => { b.visible = !!th.beams; if (th.beams) b.material.color.set(th.beams[i]); });
    this.horizon.visible = th.horizon !== null;
    if (th.horizon !== null) this.horizon.material.color.set(th.horizon);
    this.lastRenderKey = '';
  }

  stringY(string) {
    const n = this.chart.instrument.strings;
    const row = this.options.invertStrings ? n - 1 - string : string; // row 0 = top
    return STRING_BASE + (n - 1 - row) * STRING_GAP;
  }

  clearChart() {
    if (this.targetPool) for (const sp of this.targetPool) sp.visible = false;
    this.particles.clear();
    for (const g of [this.timeGroup, this.noteGroup]) {
      for (const child of [...g.children]) {
        g.remove(child);
        child.traverse((o) => {
          if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
          if (o.userData.ownMaterial) { o.material.map.dispose(); o.material.dispose(); }
        });
      }
    }
    if (this.stringMeshes) for (const m of this.stringMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.stringMeshes = [];
    this.noteObjs = [];
    this.sectionLabels = [];
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
    // Metallic strings with a highlight from the environment.
    this.stringMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2 }));
    // Thinner strings, graded like real ones (lowest = thickest).
    const radii = n >= 5 ? [0.025, 0.021, 0.018, 0.015, 0.013] : [0.021, 0.018, 0.015, 0.013];
    for (let s = 0; s < n; s++) {
      const row = this.options.invertStrings ? n - 1 - s : s;
      const radius = radii[s] || 0.013;
      // Many segments along the string so it can bend locally when you hit a note.
      const geo = new THREE.CylinderGeometry(radius, radius, MAX_FRET + 3, 14, 160);
      const m = new THREE.Mesh(geo, this.stringMats[s]);
      m.rotation.z = Math.PI / 2;
      m.position.set(MAX_FRET / 2, this.stringY(s), 0);
      m.userData.base = Float32Array.from(geo.attributes.position.array);
      m.userData.waves = [];
      this.scene.add(m);
      this.stringMeshes.push(m);
    }

    // Materials.
    // Glossy gems (clear coat reflects the stage lights).
    const hiQ = this.quality.level !== 'low';
    this.gemMats = colors.map((c) => (hiQ
      ? new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.38, roughness: 0.32, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.18, envMapIntensity: 0.9 })
      : new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.1 })));
    this.ghostMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, transparent: true, opacity: 0.35 }));
    this.deadMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.35), emissive: c, emissiveIntensity: 0.12, roughness: 0.6 }));
    this.stemMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, fog: true }));
    this.tailMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, clippingPlanes: this.clipStrike, depthWrite: false }));
    this.tailCoreMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55), transparent: true, opacity: 0.9, side: THREE.DoubleSide, clippingPlanes: this.clipStrike, depthWrite: false }));
    this.glowMats = colors.map((c) => new THREE.SpriteMaterial({ map: this.glowTex, color: c, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    // Rounded gems with a bright outline and a soft shadow on the floor.
    const { geo: gemGeo, outline: edgeGeo } = roundedGemGeometry(GEM_W, GEM_H, GEM_D);
    this.gemGeo = gemGeo;
    gemGeo.userData.shared = true; edgeGeo.userData.shared = true;
    const edgeMat = this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: this.theme().outline });
    const shadowGeo = new THREE.PlaneGeometry(1, 1); shadowGeo.userData.shared = true;
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });

    // Beat lines and anchor lanes live in seconds (timeGroup is scaled by k).
    // Merged into a few meshes: one draw call per kind instead of hundreds.
    const beatMat = new THREE.MeshBasicMaterial({ color: 0x8a93aa, transparent: true, opacity: 0.35, clippingPlanes: this.clipBeats, depthWrite: false, side: THREE.DoubleSide });
    const barMat = new THREE.MeshBasicMaterial({ color: 0xdfe4f0, transparent: true, opacity: 0.6, clippingPlanes: this.clipBeats, depthWrite: false, side: THREE.DoubleSide });
    const beatQuads = [], barQuads = [];
    for (const b of chart.beats) {
      const w = b.downbeat ? 0.028 : 0.014;
      (b.downbeat ? barQuads : beatQuads).push([0, MAX_FRET, b.t - w / 2, b.t + w / 2, 0.012]);
    }
    if (beatQuads.length) this.timeGroup.add(mergedQuads(beatQuads, beatMat));
    if (barQuads.length) this.timeGroup.add(mergedQuads(barQuads, barMat));

    const anchorMat = this.anchorMat = new THREE.MeshBasicMaterial({ color: this.theme().lane, transparent: true, opacity: 0.16, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const anchorEdgeMat = new THREE.MeshBasicMaterial({ color: 0xbcd2ff, transparent: true, opacity: 0.5, clippingPlanes: this.clipFloor, depthWrite: false, side: THREE.DoubleSide });
    const end = chart.duration + 2;
    const laneQuads = [], edgeQuads = [];
    this.anchors.forEach((a, i) => {
      const t1 = a.t + Math.max(0.05, Math.min(a.until, end) - a.t);
      const next = this.anchors[i + 1];
      const lo = a.fret - 1, hi = a.fret + 3;
      if (next && Math.abs(next.t - t1) < 0.01 && next.fret !== a.fret) {
        // The lane slides over to the next hand position just before it.
        const d = Math.min(0.22, 0.35 * (t1 - a.t));
        const nlo = next.fret - 1, nhi = next.fret + 3;
        laneQuads.push([lo, hi, a.t, t1 - d, 0.008], [lo, hi, t1 - d, t1, 0.008, nlo, nhi]);
        for (const [x, nx] of [[lo, nlo], [hi, nhi]]) {
          edgeQuads.push([x - 0.025, x + 0.025, a.t, t1 - d, 0.01], [x - 0.025, x + 0.025, t1 - d, t1, 0.01, nx - 0.025, nx + 0.025]);
        }
      } else {
        laneQuads.push([lo, hi, a.t, t1, 0.008]);
        for (const x of [lo, hi]) edgeQuads.push([x - 0.025, x + 0.025, a.t, t1, 0.01]);
      }
      // Fret number where the hand moves (yellow, on the floor).
      const sp = new THREE.Sprite(this.label(String(a.fret), '#f2c418'));
      sp.scale.set(0.9, 0.9, 1);
      sp.position.set(a.fret - 1.45, 0.45, -a.t);
      this.timeGroup.add(sp);
    });
    // Section names floating above the lane where a section starts.
    for (const sec of chart.sections || []) {
      if (!Number.isFinite(sec.t) || !sec.name) continue;
      const a = anchorAt(this.anchors, sec.t + 0.01);
      const mat = new THREE.SpriteMaterial({ map: wideLabelTexture(sec.name.toUpperCase()), transparent: true, opacity: 0.85, depthWrite: false, clippingPlanes: this.clipStrike });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(3.6, 0.9, 1);
      sp.position.set(a ? a.fret + 1 : 3, STRING_BASE + (n - 1) * STRING_GAP + 1.1, -sec.t);
      sp.userData.ownMaterial = true;
      sp.userData.t = sec.t;
      this.timeGroup.add(sp);
      this.sectionLabels.push(sp);
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
      const body = new THREE.Group();   // the gem itself (grows with distance)
      obj.add(body);
      const mat = note.flags.dead ? this.deadMats[s] : note.flags.ghost ? this.ghostMats[s] : this.gemMats[s];
      const gem = new THREE.Mesh(gemGeo, mat);
      if (open) gem.scale.set(4 / GEM_W * 0.96, 0.55, 1);
      if (note.flags.ghost) gem.scale.multiplyScalar(0.8);
      body.add(gem);
      if (!note.flags.ghost) {
        const edges = new THREE.LineLoop(edgeGeo, edgeMat);
        edges.scale.copy(gem.scale);
        body.add(edges);
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.scale.set(open ? 4.2 : GEM_W * 1.5, 1, 0.7);
        shadow.position.y = -y + 0.02;
        obj.add(shadow);
      }
      const glow = new THREE.Sprite(this.glowMats[s]);
      glow.scale.set(open ? 4.4 : 1.3, 0.7, 1);
      glow.position.z = -0.02;
      glow.renderOrder = -1;
      body.add(glow);
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
        body.add(sp);
      }
      // Technique tag above the gem.
      const tags = [];
      if (note.flags.hopo) tags.push(prevOnString[s] && note.fret < prevOnString[s].fret ? 'P' : 'H');
      if (note.flags.palmMute) tags.push('PM');
      if (note.flags.harmonic) tags.push('◆');
      if (note.flags.bend) tags.push('⤴');
      if (tags.length) {
        const sp = new THREE.Sprite(this.label(tags.join(' '), '#8b93a3'));
        sp.scale.set(0.36, 0.36, 1);
        sp.position.set(0, GEM_H / 2 + 0.16, 0);
        body.add(sp);
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
        if (note.flags.vibrato && toFret === null) {
          // Vibrato: a wavy tail, as in Rocksmith.
          const step = 0.07, amp = 0.09;
          for (let t0 = note.t, k = 0; t0 < note.t + note.dur - 1e-3; t0 += step, k++) {
            const t1 = Math.min(note.t + note.dur, t0 + step);
            const a = k === 0 ? 0 : (k % 2 ? amp : -amp), b = k % 2 ? -amp : amp;
            tailQuads[s].push([x - hw + a, x + hw + a, t0, t1, y, x - hw + b, x + hw + b]);
          }
        } else {
          tailQuads[s].push([x - hw, x + hw, note.t, note.t + note.dur, y, x1 - hw, x1 + hw]);
        }
      }
      this.noteObjs.push({ note, obj, gem, body });
      prevOnString[s] = note;
    }
    tailQuads.forEach((q, s) => {
      if (!q.length) return;
      this.timeGroup.add(mergedQuads(q, this.tailMats[s]));
      // A bright core line inside each tail, as on Rocksmith's sustains.
      const core = q.map(([x0, x1, t0, t1, y, x0b = x0, x1b = x1]) => {
        const c = (x0 + x1) / 2, cb = (x0b + x1b) / 2, w = 0.03;
        return [c - w, c + w, t0, t1, y + 0.004, cb - w, cb + w];
      });
      this.timeGroup.add(mergedQuads(core, this.tailCoreMats[s]));
    });
    this.addChordFrames();
    this.visibleFrom = 0;
    this.visibleTo = 0;
  }

  // Chords (two or more notes at once): a frame around them, as Rocksmith
  // draws chord boxes. Attached to the chord's first gem so it moves with it.
  addChordFrames() {
    const objs = this.noteObjs;
    const mat = this.chordMat || (this.chordMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
    const bar = this.chordBarGeo || (this.chordBarGeo = new THREE.BoxGeometry(1, 1, 0.03));
    bar.userData.shared = true;
    for (let i = 0; i < objs.length;) {
      let j = i + 1;
      while (j < objs.length && Math.abs(objs[j].note.t - objs[i].note.t) < 0.002) j++;
      const group = objs.slice(i, j).filter((o) => !o.note.flags.ghost);
      if (group.length >= 2 && new Set(group.map((o) => o.note.string)).size >= 2) {
        const ys = group.map((o) => o.obj.position.y);
        const halfW = (o) => (o.note.fret === 0 ? 2 : GEM_W / 2);
        const x0 = Math.min(...group.map((o) => o.obj.position.x - halfW(o))) - 0.1;
        const x1 = Math.max(...group.map((o) => o.obj.position.x + halfW(o))) + 0.1;
        const y0 = 0.03, y1 = Math.max(...ys) + GEM_H / 2 + 0.1;
        const host = group[0].obj;
        const frame = new THREE.Group();
        const t = 0.035;
        for (const [cx, cy, w, hgt] of [[(x0 + x1) / 2, y1, x1 - x0, t], [(x0 + x1) / 2, y0, x1 - x0, t], [x0, (y0 + y1) / 2, t, y1 - y0], [x1, (y0 + y1) / 2, t, y1 - y0]]) {
          const m = new THREE.Mesh(bar, mat);
          m.scale.set(w, hgt, 1);
          m.position.set(cx - host.position.x, cy - host.position.y, -GEM_D / 2);
          frame.add(m);
        }
        host.add(frame);
      }
      i = j;
    }
  }

  // 1 right at the start of a section, fading over ~0.7 s (real time).
  sectionFlash(t, speed) {
    const secs = this.chart.sections || [];
    let last = null;
    for (const s of secs) { if (s.t <= t) last = s; else break; }
    if (!last || last.t <= 0.01) return 0;
    const age = (t - last.t) / speed;
    return age >= 0 && age < 0.7 ? 1 - age / 0.7 : 0;
  }

  // 1 right on a beat, decaying over ~0.15 s (real time); downbeats count fully.
  beatPulse(t, speed) {
    const beats = this.chart.beats;
    if (!beats || !beats.length) return 0;
    let lo = 0, hi = beats.length - 1, b = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (beats[mid].t <= t) { b = mid; lo = mid + 1; } else hi = mid - 1; }
    if (b < 0) return 0;
    const age = (t - beats[b].t) / speed;
    return Math.exp(-age / 0.15) * (beats[b].downbeat ? 1 : 0.55);
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
      if (this.bloom) this.bloom.setSize(Math.round(w * dpr), Math.round(h * dpr));
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
        // Far gems a bit bigger so they stay readable with the flatter view.
        o.body.scale.setScalar((this.options.largeNotes ? 1.3 : 1) * (1 + GEM_GROW * Math.max(0, Math.min(1, dz / DEPTH))));
      }
      this.visibleFrom = from;
      this.visibleTo = to;
      this.updateTargets(t, speed, state.heard);

      // Strings light up while a note on them is sounding.
      const lit = this.lit;
      lit.fill(0);
      for (let i = Math.max(0, from - 40); i < to; i++) {
        const n = notes[i];
        if (n.t <= t && t <= n.t + Math.max(0.12, n.dur)) lit[n.string] = Math.max(lit[n.string], 1 - (t - n.t) / Math.max(0.3, n.dur + 0.2));
      }
      this.stringMats.forEach((m, s) => { m.emissiveIntensity = 0.25 + lit[s] * 1.0 + this.sustainLit[s] * 0.8; });
      // ...and vibrate a little (only visible while it rings).
      this.stringMeshes.forEach((m, s) => {
        m.position.y = this.stringY(s) + (state.playing ? lit[s] * 0.014 * Math.sin(nowMs * (0.11 - s * 0.012) + s) : 0);
      });

      // The lit hand lane pulses gently on every beat, stronger on the bar.
      const pulse = this.beatPulse(t, speed);
      // Section names: clear in the distance, fading out as they come close.
      for (const sp of this.sectionLabels) {
        const frac = (sp.userData.t - t) / look;      // 1 = far end, 0 = strings
        sp.visible = frac > 0.12 && frac < 1.05;
        sp.material.opacity = 0.9 * Math.max(0, Math.min(1, (frac - 0.12) / 0.25));
      }
      // ...and flashes briefly when a new section starts.
      const flash = this.sectionFlash(t, speed);
      if (this.anchorMat) this.anchorMat.opacity = this.theme().laneBase + 0.1 * pulse + 0.22 * flash;

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
      // The next hand position lights up a moment before you move there.
      const nextA = cur ? this.anchors[this.anchors.indexOf(cur) + 1] : null;
      const soon = nextA && nextA.fret !== hand && (nextA.t - t) / speed < 0.7 ? nextA.fret : null;
      const key = `${hand}|${soon}|${Math.round(frameLo * 2)}|${Math.round(frameHi * 2)}`;
      if (key !== this.labelKey) {
        this.labelKey = key;
        this.fretLabels.forEach((sp, i) => {
          const f = i + 1;
          const inHand = hand !== null && f >= hand && f <= hand + 3;
          const inNext = soon !== null && f >= soon && f <= soon + 3;
          const inFrame = f - 0.5 >= frameLo && f - 0.5 <= frameHi;
          sp.material = this.label(String(f), inHand ? '#f2c418' : inNext ? '#c9b25a' : inFrame ? '#7d8597' : '#2e3442');
        });
      }
    }

    // Nothing moves while paused: skip drawing the same picture again.
    const camX = this.follow.x, camSpan = this.follow.span;
    this.particles.update(dt);
    const gemsAnimating = this.updateHitAnims(nowMs);        // (each must run every frame)
    const stringsAnimating = this.updateStringWaves(nowMs);
    const animating = this.particles.active || gemsAnimating || stringsAnimating;
    const key = `${animating ? nowMs : ''}|${t.toFixed(4)}|${camX.toFixed(3)}|${camSpan.toFixed(3)}|${this.w}x${this.h}|${this.dpr}|${k.toFixed(4)}|${this.chart ? this.chart.notes.length : 0}`;
    if (!state.playing && key === this.lastRenderKey) return;
    this.lastRenderKey = key;

    // Camera: behind and above the strings, looking down the highway.
    const cam = this.camera;
    const C = globalThis.__btCam ? { ...CAM, ...globalThis.__btCam } : CAM; // dev preview override
    if (cam.fov !== C.fov) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
    const tanV = Math.tan(THREE.MathUtils.degToRad(C.fov) / 2);
    const halfW = camSpan * C.widthFactor + C.extraWidth;         // half width at the strings
    // Wide, short windows show more frets instead of zooming in.
    const d0 = halfW / (tanV * Math.min(1.9, Math.max(0.6, cam.aspect))); // distance to the strike line
    const place = (pitch) => {
      const down = pitch + Math.atan(C.strikeNdc * tanV);            // angle down to the strike line
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
      if (far.y > C.farNdc) hi = mid; else lo = mid;
    }
    place((lo + hi) / 2);
    this.horizon.position.set(camX, 3, -DEPTH - 6);
    for (const b of this.beams) {
      const sway = Math.sin(nowMs / 4200 + b.userData.phase);
      b.position.set(camX + b.userData.x + sway * 3, 14, -DEPTH - 14);
      b.material.rotation = sway * 0.22 + (b.userData.x < 0 ? -0.25 : 0.25);
      b.material.opacity = this.theme().beamOpacity * (1 + 0.45 * Math.sin(nowMs / 2600 + b.userData.phase * 2));
    }
    // Fog is measured from the camera: keep it on the far part of the lane.
    const fog = this.scene.fog;
    fog.near = d0 + DEPTH * C.fogStart;
    fog.far = d0 + DEPTH * 1.08;
    this.draw();
  }

  // Render, with the glow pass when it is on (and the PC can afford it).
  draw() {
    if (this.options.glow && !this.quality.noGlow && this.theme().glow > 0) {
      try {
        if (!this.bloom) {
          this.bloom = new Bloom(this.renderer);
          this.bloom.setSize(Math.round(this.w * this.dpr), Math.round(this.h * this.dpr));
        }
        this.bloom.add.uniforms.strength.value = this.theme().glow;
        this.bloom.render(this.scene, this.camera);
        return;
      } catch (err) {
        console.warn('[Bass Trainer] glow effect unavailable', err);
        this.quality.noGlow = true;
        this.renderer.setRenderTarget(null);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // A scored note (from the ScoringSession). Hits get a spark burst at the
  // strings; with timing marks on, a small dot shows where the note was when
  // you played it (beyond the strings = early, in front = late).
  onResult(r, { speed = 1 } = {}) {
    if (!this.chart || r.status !== 'hit') return;
    const o = this.noteObjs[r.index];
    if (!o) return;
    const color = this.colors[o.note.string] || '#ffffff';
    if (this.options.sparks) {
      this.particles.burst(o.obj.position.x, o.obj.position.y, color, o.note.fret === 0);
      this.hitGem(o, color);
      this.addStringWave(o.note.string, o.note.fret === 0 ? null : o.obj.position.x, o.note.fret === 0 ? 0.035 : 0.05);
    }
    if (this.options.timingMarks && r.offsetMs !== null) {
      const k = DEPTH / (this.options.lookahead * speed);
      const z = Math.max(-2.5, Math.min(1.2, (r.offsetMs / 1000) * speed * k));
      const c = r.rating === 'ontime' ? '#5fd38d' : r.rating === 'early' ? '#58b6ff' : '#ffa040';
      this.particles.spawn({ x: o.obj.position.x, y: o.obj.position.y + 0.3, z, color: c, life: 0.9, size: 0.32, opacity: 0.95 });
    }
    this.lastRenderKey = '';
  }

  // The hit gem flares and sinks into the string (a copy at the strike line:
  // the note itself has already passed when the hit is recognised).
  hitGem(o, color) {
    if (!this.gemGeo) return;
    if (!this.hitPool) this.hitPool = [];
    let a = this.hitPool.find((x) => !x.mesh.visible);
    if (!a) {
      if (this.hitPool.length >= 10) a = this.hitPool.reduce((p, x) => (x.t0 < p.t0 ? x : p));
      else {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, transparent: true, depthWrite: false });
        a = { mesh: new THREE.Mesh(this.gemGeo, mat), t0: 0 };
        a.mesh.renderOrder = 6;
        this.scene.add(a.mesh);
        this.hitPool.push(a);
      }
    }
    a.mesh.geometry = this.gemGeo;
    a.mesh.material.color.set(color);
    a.mesh.material.emissive.set(color);
    a.sx = (o.note.fret === 0 ? 4 / GEM_W * 0.96 : 1) * (this.options.largeNotes ? 1.3 : 1);
    a.sy = (o.note.fret === 0 ? 0.55 : 1) * (this.options.largeNotes ? 1.3 : 1);
    a.mesh.position.set(o.obj.position.x, o.obj.position.y, 0.06);
    a.t0 = performance.now();
    a.mesh.visible = true;
  }

  updateHitAnims(nowMs) {
    if (!this.hitPool) return false;
    let any = false;
    for (const a of this.hitPool) {
      if (!a.mesh.visible) continue;
      const k = (nowMs - a.t0) / 280;
      if (k >= 1) { a.mesh.visible = false; continue; }
      any = true;
      // 0–0.3: flare up; 0.3–1: squash flat into the string and fade.
      const up = k < 0.3 ? 1 + 0.35 * (k / 0.3) : 1.35;
      const flat = k < 0.3 ? 1 : 1 - 0.93 * ((k - 0.3) / 0.7);
      a.mesh.scale.set(a.sx * (up + 0.25 * Math.max(0, k - 0.3)), a.sy * up * flat, 1);
      a.mesh.material.opacity = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
      a.mesh.material.emissiveIntensity = 1.1 - 0.8 * k;
    }
    return any;
  }

  // A damped ripple on the string around the fret you hit (x = null: whole string).
  addStringWave(string, x, amp) {
    const m = this.stringMeshes && this.stringMeshes[string];
    if (!m) return;
    m.userData.waves.push({ x, amp, t0: performance.now() });
    if (m.userData.waves.length > 4) m.userData.waves.shift();
  }

  updateStringWaves(nowMs) {
    if (!this.stringMeshes) return false;
    let any = false;
    for (const m of this.stringMeshes) {
      const w = m.userData.waves;
      if (!w || (!w.length && !m.userData.bent)) continue;
      for (let i = w.length - 1; i >= 0; i--) if (nowMs - w[i].t0 > 900) w.splice(i, 1);
      const pos = m.geometry.attributes.position;
      const base = m.userData.base;
      const arr = pos.array;
      // Local y runs along the string; world x = centre − local y (rotated cylinder).
      for (let v = 0; v < pos.count; v++) {
        const ly = base[v * 3 + 1];
        const wx = MAX_FRET / 2 - ly;
        let d = 0;
        for (const wave of w) {
          const age = (nowMs - wave.t0) / 1000;
          const env = Math.exp(-age / 0.28) * Math.sin(age * 2 * Math.PI * 13);
          const shape = wave.x === null ? 1 : Math.exp(-((wx - wave.x) ** 2) / 1.6);
          d += wave.amp * env * shape;
        }
        arr[v * 3] = base[v * 3] + d;
      }
      pos.needsUpdate = true;
      m.userData.bent = w.length > 0;
      if (w.length) any = true;
    }
    return any;
  }

  // If the PC can't keep up (< ~50 fps for 2 s while playing), render at a
  // lower resolution instead of stuttering. Never raises it again in a session.
  adaptQuality(dt) {
    const q = this.quality;
    if (q.level === 'high' || q.level === 'low') return;
    if (dt > 1 / 50 && dt < 0.1) q.slowFor += dt; else q.slowFor = Math.max(0, q.slowFor - dt * 0.5);
    if (q.slowFor > 2 && (this.dpr || 1) > 1) {
      q.maxDpr = this.dpr > 1.5 ? 1.5 : 1;
      q.slowFor = 0;
      console.info(`[Bass Trainer] 3D highway: lowering resolution (pixel ratio ${q.maxDpr}) to keep it smooth`);
    } else if (q.slowFor > 2 && this.options.glow && !q.noGlow && this.bloom) {
      q.noGlow = true;
      q.slowFor = 0;
      console.info('[Bass Trainer] 3D highway: turning the glow effect off to keep it smooth');
    }
  }
}
