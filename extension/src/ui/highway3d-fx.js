// Visual extras for the 3D highway: rounded gem geometry, floor shadows,
// hit sparks, timing dots, wide text labels and a glow (bloom) pass.
import * as THREE from '../../vendor/three/three.module.min.js';

// Box with rounded corners (front view) and bevelled edges.
export function roundedGemGeometry(w, h, d, r = 0.07, bevel = 0.025) {
  const iw = w - 2 * bevel, ih = h - 2 * bevel, rr = Math.min(r, iw / 2, ih / 2);
  const s = new THREE.Shape();
  const x = -iw / 2, y = -ih / 2;
  s.moveTo(x + rr, y);
  s.lineTo(x + iw - rr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + rr);
  s.lineTo(x + iw, y + ih - rr); s.quadraticCurveTo(x + iw, y + ih, x + iw - rr, y + ih);
  s.lineTo(x + rr, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - rr);
  s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
  const depth = Math.max(0.01, d - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  // Outline around the front face.
  const pts = s.getPoints(4).map((p) => new THREE.Vector3(p.x * (w / iw), p.y * (h / ih), d / 2 + 0.004));
  const outline = new THREE.BufferGeometry().setFromPoints(pts);
  return { geo, outline };
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function shadowTexture() {
  return radialTexture([[0, 'rgba(0,0,0,0.6)'], [0.5, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]);
}

export function sparkTexture() {
  return radialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
}

// Wide text (section names): canvas 512x128.
export function wideLabelTexture(text, color = '#dfe5ff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '800 66px system-ui, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 256, 68, 500);
  g.fillStyle = color;
  g.fillText(text, 256, 68, 500);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Short-lived additive particles: sparks when a note is hit, timing dots.
export class Particles {
  constructor(scene, size = 120) {
    this.tex = sparkTexture();
    this.pool = Array.from({ length: size }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
      sp.visible = false;
      sp.renderOrder = 7;
      scene.add(sp);
      return { sp, life: 0, age: 0, v: new THREE.Vector3(), size: 0, grow: 0, g: 0 };
    });
    this.next = 0;
  }

  get active() { return this.pool.some((p) => p.sp.visible); }

  spawn({ x, y, z, color, vx = 0, vy = 0, vz = 0, life = 0.4, size = 0.15, grow = 0, gravity = 0, opacity = 1 }) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.sp.position.set(x, y, z);
    p.sp.material.color.set(color);
    p.sp.material.opacity = opacity;
    p.opacity = opacity;
    p.v.set(vx, vy, vz);
    p.life = life; p.age = 0; p.size = size; p.grow = grow; p.g = gravity;
    p.sp.scale.set(size, size, 1);
    p.sp.visible = true;
  }

  // RS-style burst where a note was hit: a quick flash plus sparks.
  burst(x, y, color, wide = false) {
    this.spawn({ x, y, z: 0.05, color: '#ffffff', life: 0.16, size: wide ? 1.6 : 0.9, grow: 2.5, opacity: 0.8 });
    this.spawn({ x, y, z: 0.04, color, life: 0.28, size: wide ? 2.2 : 1.2, grow: 1.5, opacity: 0.7 });
    const n = wide ? 14 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.2;
      this.spawn({
        x: x + (wide ? (Math.random() - 0.5) * 3 : 0), y, z: 0.05, color: i % 3 ? color : '#fff6d0',
        vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp + 1.2, vz: (Math.random() - 0.3) * 1.2,
        life: 0.3 + Math.random() * 0.25, size: 0.09 + Math.random() * 0.07, gravity: -7,
      });
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.sp.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.sp.visible = false; continue; }
      const k = p.age / p.life;
      p.v.y += p.g * dt;
      p.sp.position.addScaledVector(p.v, dt);
      const s = p.size * (1 + p.grow * k);
      p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = p.opacity * (1 - k) * (1 - k * 0.3);
    }
  }

  clear() { for (const p of this.pool) p.sp.visible = false; }
}

// Bloom: bright parts of the picture (strings, gems, sparks) get a soft glow.
// The scene is drawn to the screen as usual; a half-size copy goes through a
// bright pass and a blur (1/4 size) and is added on top. (Drawing the main
// picture through a linear target would change how see-through parts blend.)
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Bloom {
  constructor(renderer, { strength = 0.38, threshold = 0.65 } = {}) {
    this.renderer = renderer;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.rtB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.bright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: threshold } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(threshold, threshold + 0.3, l); gl_FragColor = vec4(c * k, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
          c += (texture2D(tDiffuse, vUv + dir * 1.385).rgb + texture2D(tDiffuse, vUv - dir * 1.385).rgb) * 0.316;
          c += (texture2D(tDiffuse, vUv + dir * 3.231).rgb + texture2D(tDiffuse, vUv - dir * 3.231).rgb) * 0.070;
          gl_FragColor = vec4(c, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.add = new THREE.ShaderMaterial({
      uniforms: { tBloom: { value: null }, strength: { value: strength } },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tBloom; uniform float strength; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tBloom, vUv).rgb * strength, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
  }

  setSize(w, h) {
    this.rtScene.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.texel = [1 / bw, 1 / bh];
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera) {
    const r = this.renderer;
    // Glow source: the scene at half size.
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    this.bright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.pass(this.bright, this.rtA);
    for (const spread of [1, 1.6]) {
      this.blur.uniforms.tDiffuse.value = this.rtA.texture;
      this.blur.uniforms.dir.value.set(this.texel[0] * spread, 0);
      this.pass(this.blur, this.rtB);
      this.blur.uniforms.tDiffuse.value = this.rtB.texture;
      this.blur.uniforms.dir.value.set(0, this.texel[1] * spread);
      this.pass(this.blur, this.rtA);
    }
    // The picture as usual, then the glow added on top.
    r.setRenderTarget(null);
    r.render(scene, camera);
    this.add.uniforms.tBloom.value = this.rtA.texture;
    const auto = r.autoClear;
    r.autoClear = false;
    this.quad.material = this.add;
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.dispose();
    for (const m of [this.bright, this.blur, this.add]) m.dispose();
  }
}
