// Photographic studio sets for the F-Future.
//
// Lighting is image based: a real HDR photograph of a photo studio (CC0, Poly Haven, via
// pmndrs/assets) is projected onto a sphere, combined with crisp emissive strip lights for the
// long "car photography" highlights, and prefiltered into a PMREM environment. The visible set is
// a cyclorama with a polished epoxy floor that reflects the car (planar reflection with a rough
// blur and Fresnel falloff), a baked soft contact shadow and a soft key-light shadow.
//
// Sets: 'showroom' (dark, default), 'daylight' (white cove) and 'blueprint' (neutral grey with a
// measuring grid, used by the engineering workspace).
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const hdriCache = {};
/** Loads one of the bundled equirectangular HDRIs (assets/hdri/<name>.exr). */
export function loadHDRI(name) {
  if (!hdriCache[name]) {
    const url = new URL(`../../assets/hdri/${name}.exr`, import.meta.url).href;
    hdriCache[name] = new EXRLoader().setDataType(THREE.HalfFloatType).loadAsync(url).then((t) => {
      // sanitise: lossy (DWA) compression leaves negative texels, and any Inf/NaN would poison
      // the prefiltered environment and the bloom chain
      const d = t.image.data;
      if (d instanceof Uint16Array) for (let i = 0; i < d.length; i++) { const h = d[i]; if ((h & 0x7c00) === 0x7c00 || (h & 0x8000)) d[i] = (h & 0x7c00) === 0x7c00 && !(h & 0x03ff) && !(h & 0x8000) ? 0x7bff : 0; }
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      return t;
    });
  }
  return hdriCache[name];
}

const ENV_VERT = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }';
const ENV_FRAG = `uniform sampler2D map; uniform float rot, gain, hasMap; uniform vec3 lowCol, topCol, horCol; uniform float lowMix;
  varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    float c = cos(rot), s = sin(rot);
    vec3 r = vec3(c*d.x - s*d.z, d.y, s*d.x + c*d.z);
    vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, asin(clamp(r.y, -1., 1.)) * 0.31830989 + 0.5);
    // (lossy EXR compression leaves a few slightly negative texels: clamp them)
    vec3 col = hasMap > 0.5 ? min(max(texture2D(map, uv).rgb, vec3(0.0)), vec3(24.0)) * gain : mix(horCol, topCol, smoothstep(0., .7, d.y));
    // the set's own floor replaces the photographed one below the horizon
    float below = 1.0 - smoothstep(-0.12, 0.02, d.y);
    col = mix(col, lowCol, below * lowMix);
    gl_FragColor = vec4(col, 1.);
  }`;

/** Builds a PMREM environment from an HDRI (optional) plus emissive panels. */
export function buildEnvironment(renderer, { hdr = null, rotation = 0, gain = 1, low = 0x050505, lowMix = 0.9, top = 0x202226, hor = 0x50545a, panels = [], size = 512 } = {}) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      map: { value: hdr }, hasMap: { value: hdr ? 1 : 0 }, rot: { value: rotation }, gain: { value: gain },
      lowCol: { value: new THREE.Color(low) }, lowMix: { value: lowMix }, topCol: { value: new THREE.Color(top) }, horCol: { value: new THREE.Color(hor) },
    },
    vertexShader: ENV_VERT, fragmentShader: ENV_FRAG,
  })));
  for (const p of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color ?? 0xffffff).multiplyScalar(p.i), side: THREE.DoubleSide }));
    m.position.set(...p.pos); m.lookAt(...(p.look || [0, 0.6, 0]));
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0, 0.1, 100, { size });
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return rt;
}

const SETS = {
  showroom: {
    hdri: 'studio', rotation: 2.2, gain: 0.42, envIntensity: 1.0, low: 0x060607, lowMix: 0.92,
    // two long ceiling strips along the car and a broad overhead softbox: the classic long streak
    // highlights down the flanks and a soft sheen on the roof and bonnet
    panels: [
      { w: 9, h: 0.22, pos: [0, 4.6, 3.2], i: 7 }, { w: 9, h: 0.22, pos: [0, 4.6, -3.2], i: 7 },
      // low side strips: the long horizontal streaks down the doors and sills
      { w: 11, h: 0.3, pos: [0, 1.7, 6.0], i: 3.2 }, { w: 11, h: 0.3, pos: [0, 1.7, -6.0], i: 3.2 },
      { w: 5.5, h: 2.2, pos: [0, 6.5, 0], i: 1.4, look: [0, 0, 0] },
      { w: 2.2, h: 1.4, pos: [7.5, 1.6, -3.5], i: 1.0, color: 0xfff1e0 },
      { w: 2.0, h: 1.2, pos: [-7.5, 1.4, 3.0], i: 0.7, color: 0xdfe8ff },
    ],
    floor: 0x2c2d31, hor: 0x111215, top: 0x070708, refl: 1.0, grid: 0, shadow: 0.92, catcher: 0.5, pool: 1,
    key: 1.3, hemi: [0x30343a, 0x050505, 0.15], exposure: 1.12,
  },
  daylight: {
    hdri: 'studio', rotation: 2.2, gain: 0.75, envIntensity: 1.0, low: 0x9a9da2, lowMix: 0.75,
    panels: [
      { w: 9, h: 0.4, pos: [0, 4.6, 3.2], i: 6 }, { w: 9, h: 0.4, pos: [0, 4.6, -3.2], i: 6 },
      { w: 6, h: 3, pos: [0, 6.5, 0], i: 3, look: [0, 0, 0] },
    ],
    floor: 0xc9ccd0, hor: 0xd9dce0, top: 0xe9ebee, refl: 0.35, grid: 0, shadow: 0.7, catcher: 0.22, pool: 0.15,
    key: 1.3, hemi: [0xe8eef5, 0x6c6f73, 0.18], exposure: 0.95,
  },
  blueprint: {
    hdri: 'studio', rotation: 2.2, gain: 0.5, envIntensity: 0.95, low: 0x2a2c30, lowMix: 0.85,
    panels: [{ w: 9, h: 0.3, pos: [0, 4.6, 3.2], i: 7 }, { w: 9, h: 0.3, pos: [0, 4.6, -3.2], i: 7 }, { w: 6, h: 3, pos: [0, 6.5, 0], i: 2.4, look: [0, 0, 0] }],
    floor: 0x1e2024, hor: 0x16171a, top: 0x1c1e22, refl: 0.25, grid: 1, shadow: 0.85, catcher: 0.35, pool: 0.4,
    key: 1.2, hemi: [0x30343a, 0x080808, 0.15], exposure: 1.0,
  },
};
const THEME_ALIAS = { dark: 'showroom', light: 'daylight', engineering: 'blueprint' };

const FLOOR_SHADER = {
  name: 'StudioFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
    base: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, line: { value: new THREE.Color() },
    shadowMap: { value: null }, shadowSize: { value: new THREE.Vector2(7, 4.2) }, shadowStrength: { value: 0.9 },
    gridOffset: { value: new THREE.Vector2() }, grid: { value: 0 }, refl: { value: 1 }, hasRefl: { value: 0 }, pool: { value: 1 },
    texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform sampler2D tDiffuse, shadowMap; uniform vec3 base, hor, line; uniform vec2 shadowSize, gridOffset, texel;
    uniform float shadowStrength, grid, refl, hasRefl, pool;
    varying vec4 vUv; varying vec3 vW;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
    float gridLine(vec2 p, float s){ vec2 g = abs(fract(p/s - 0.5) - 0.5) * s; vec2 fw = fwidth(p) * 1.2; vec2 l = 1.0 - smoothstep(vec2(0.0), fw, g); return max(l.x, l.y); }
    void main(){
      float r = length(vW.xz);
      // polished epoxy / concrete: faint large-scale mottling and trowel marks
      float n = vnoise(vW.xz * 0.45) * 0.5 + vnoise(vW.xz * 1.9 + 7.) * 0.32 + vnoise(vW.xz * 11.) * 0.18;
      vec3 c = base * (0.82 + 0.36 * n);
      // pool of light from the overhead softbox, falling off into the dark set
      vec2 e = vW.xz / vec2(4.2, 2.8);
      c *= mix(1.0, 0.25 + 1.6 * exp(-dot(e, e)), pool);
      if (grid > 0.5) {
        vec2 gp = vW.xz + gridOffset;
        float gl = gridLine(gp, 1.0) * 0.6 + gridLine(gp, 0.25) * 0.2;
        c = mix(c, line, gl * (1.0 - smoothstep(6.0, 16.0, r)));
      }
      float sh = 0.0;
      vec2 suv = 0.5 - vW.xz / shadowSize;
      if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) sh = texture2D(shadowMap, suv).r;
      c *= 1.0 - sh * shadowStrength;
      vec3 V = normalize(cameraPosition - vW);
      float F = 0.035 + 0.965 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
      if (hasRefl > 0.5) {
        vec2 uv = vUv.xy / vUv.w;
        // rough reflection: rotated Poisson taps, wider for distant floor and where the floor is worn
        float rad = 1.0 + 4.0 * smoothstep(1.0, 7.0, r) + 2.0 * n;
        float a = h21(floor(gl_FragCoord.xy * 0.5)) * 6.2831;
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec3 rc = vec3(0.0);
        const int N = 12;
        for (int i = 0; i < N; i++) {
          float t = (float(i) + 0.5) / float(N);
          vec2 o = R * vec2(cos(t * 15.4), sin(t * 15.4)) * sqrt(t);
          rc += texture2D(tDiffuse, uv + o * texel * rad).rgb;
        }
        rc /= float(N);
        c += rc * refl * F * (1.0 - 0.6 * sh);
      } else {
        c += hor * refl * F * 0.5;
      }
      c = mix(c, hor, smoothstep(8.0, 32.0, r));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Studio {
  constructor(renderer, scene, { theme = 'showroom', reflections = true } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Studio';
    scene.add(this.group);
    this.reflections = reflections;
    this.gridOffset = new THREE.Vector2();
    this.hdr = null;
    this._buildSet();
    this.setTheme(theme);
  }

  /** Loads the HDRI and rebuilds the environment with it. */
  async init() {
    try { this.hdr = await loadHDRI('studio'); } catch (e) { console.warn('[studio] HDRI unavailable, using the procedural environment', e); }
    this.setTheme(this.theme);
  }

  _buildSet() {
    // backdrop cyclorama (gradient dome)
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top,hor; varying vec3 vP; void main(){ float h=clamp(vP.y,0.,1.); gl_FragColor=vec4(mix(hor,top,smoothstep(0.0,0.45,h)),1.); }',
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 64, 32), this.domeMat);
    dome.name = 'Backdrop'; dome.renderOrder = -10;
    this.group.add(dome);

    // polished floor: planar reflection when enabled, otherwise the same shader without it
    const geo = new THREE.CircleGeometry(58, 128);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.floorR = new Reflector(geo, { shader: FLOOR_SHADER, textureWidth: Math.max(256, size.x >> 1), textureHeight: Math.max(256, size.y >> 1), multisample: 0, clipBias: 0.0005 });
    this.floorR.rotation.x = -Math.PI / 2; this.floorR.name = 'StudioFloor';
    const render = this.floorR.onBeforeRender;
    this.floorR.onBeforeRender = (r, s, c) => { if (s.overrideMaterial) return; render.call(this.floorR, r, s, c); };
    this.floorP = new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...FLOOR_SHADER, uniforms: THREE.UniformsUtils.clone(FLOOR_SHADER.uniforms) }));
    this.floorP.rotation.x = -Math.PI / 2; this.floorP.name = 'StudioFloor';
    this.floorR.material.uniforms.hasRefl.value = 1;
    for (const f of [this.floorR, this.floorP]) { f.material.uniforms.gridOffset.value = this.gridOffset; this.group.add(f); }
    // Kept for compatibility: callers read shadowSize from floorMat.
    this.floorMat = this.floorP.material;

    // soft key-light shadow
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.4 }));
    this.catcher.rotation.x = -Math.PI / 2; this.catcher.position.y = 0.0015; this.catcher.receiveShadow = true;
    this.catcher.name = 'ShadowCatcher';
    this.group.add(this.catcher);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1.5, 9, 2.0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const sc = key.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 20;
    key.shadow.radius = 6; key.shadow.blurSamples = 16;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;
    this.group.add(key, key.target);
    this.key = key;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.1);
    this.group.add(this.hemi);
    this._applyReflections();
  }

  _uniforms(fn) { for (const f of [this.floorR, this.floorP]) fn(f.material.uniforms); }

  setTheme(theme) {
    theme = THEME_ALIAS[theme] || theme;
    if (!SETS[theme]) theme = 'showroom';
    this.theme = theme;
    const S = SETS[theme];
    this.set = S;
    const old = this.envRT;
    this.envRT = buildEnvironment(this.renderer, { hdr: this.hdr, rotation: S.rotation, gain: S.gain, low: S.low, lowMix: S.lowMix, top: S.top, hor: S.hor, panels: S.panels });
    this.envTex = this.envRT.texture;
    old?.dispose();
    if (this.active !== false) this._applyScene();
    this.domeMat.uniforms.top.value.set(S.top);
    this.domeMat.uniforms.hor.value.set(S.hor);
    this._uniforms((u) => {
      u.base.value.set(S.floor); u.hor.value.set(S.hor); u.line.value.set(theme === 'blueprint' ? 0x3a3d43 : 0x2a2c30);
      u.grid.value = S.grid; u.refl.value = S.refl; u.shadowStrength.value = S.shadow; u.pool.value = S.pool ?? 0;
    });
    this.catcher.material.opacity = S.catcher;
    this.key.intensity = S.key;
    this.hemi.color.set(S.hemi[0]); this.hemi.groundColor.set(S.hemi[1]); this.hemi.intensity = S.hemi[2];
    this.renderer.toneMappingExposure = S.exposure;
  }

  _applyScene() {
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = this.set.envIntensity;
    this.scene.background = new THREE.Color(this.set.hor);
    this.scene.fog = null;
  }

  /** Show or hide the whole set (the drive workspace uses its own world). */
  setActive(on) {
    this.active = on;
    this.group.visible = on;
    if (on) { this._applyScene(); this.renderer.toneMappingExposure = this.set.exposure; }
  }

  setReflections(on) { this.reflections = !!on; this._applyReflections(); }
  _applyReflections() { this.floorR.visible = this.reflections; this.floorP.visible = !this.reflections; }

  /** Keep the reflection buffer at half the drawing-buffer resolution. */
  resize(w, h) {
    const rt = this.floorR.getRenderTarget();
    const rw = Math.max(256, Math.round(w / 2)), rh = Math.max(256, Math.round(h / 2));
    rt.setSize(rw, rh);
    this.floorR.material.uniforms.texel.value.set(1 / rw, 1 / rh);
  }

  /** Render a soft contact-shadow texture of `object` seen from below. */
  bakeContactShadow(object, { size = 1024, blur = 3 } = {}) {
    const r = this.renderer;
    const w = this.floorMat.uniforms.shadowSize.value;
    const cam = new THREE.OrthographicCamera(-w.x / 2, w.x / 2, w.y / 2, -w.y / 2, 0, 0.9);
    cam.position.set(0, 0, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 1, 0);
    cam.updateProjectionMatrix();
    const rtA = new THREE.WebGLRenderTarget(size, Math.round((size * w.y) / w.x));
    const rtB = rtA.clone();
    const depthMat = new THREE.ShaderMaterial({
      vertexShader: 'varying float vy; void main(){ vec4 w=modelMatrix*vec4(position,1.); vy=w.y; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: 'varying float vy; void main(){ float a=1.0-smoothstep(0.0,0.75,vy); gl_FragColor=vec4(a*a,0.,0.,1.); }',
      side: THREE.DoubleSide,
    });
    const scene = new THREE.Scene();
    const prevParent = object.parent;
    scene.overrideMaterial = depthMat;
    scene.add(object);
    depthMat.blending = THREE.CustomBlending; depthMat.blendEquation = THREE.MaxEquation; depthMat.blendSrc = THREE.OneFactor; depthMat.blendDst = THREE.OneFactor;
    depthMat.depthTest = false; depthMat.depthWrite = false;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(rtA); r.clear(); r.render(scene, cam);
    scene.remove(object);
    if (prevParent) prevParent.add(object);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }',
      fragmentShader: `uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ float s=0.; float wsum=0.; for(int i=-8;i<=8;i++){ float w=exp(-float(i*i)/24.); s+=texture2D(t,vUv+d*float(i)).r*w; wsum+=w; } gl_FragColor=vec4(s/wsum,0.,0.,1.); }`,
    }));
    const qs = new THREE.Scene(); qs.add(quad);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    for (let i = 0; i < blur; i++) {
      const sp = (i + 1) * 1.0;
      quad.material.uniforms.t.value = rtA.texture; quad.material.uniforms.d.value.set(sp / rtA.width, 0);
      r.setRenderTarget(rtB); r.render(qs, qc);
      quad.material.uniforms.t.value = rtB.texture; quad.material.uniforms.d.value.set(0, sp / rtA.height);
      r.setRenderTarget(rtA); r.render(qs, qc);
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    rtB.dispose(); quad.geometry.dispose(); quad.material.dispose(); depthMat.dispose();
    if (this.contactRT) this.contactRT.dispose();
    this.contactRT = rtA;
    this._uniforms((u) => { u.shadowMap.value = rtA.texture; });
  }
}
