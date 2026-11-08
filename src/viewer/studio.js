// Premium automotive studio: HDR-like softbox environment for reflections,
// seamless cyclorama floor with a faint design-grid, key light with soft shadows,
// and a baked contact shadow rendered from underneath the car.
import * as THREE from 'three';

function softboxEnvironment(renderer, theme) {
  const env = new THREE.Scene();
  const light = theme === 'dark';
  // gradient dome
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(light ? 0x1c1e22 : 0x2c2f35) },
      mid: { value: new THREE.Color(light ? 0x0e0f12 : 0x1a1c20) },
      bot: { value: new THREE.Color(light ? 0x060607 : 0x0b0c0e) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top,mid,bot; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0.0 ? mix(mid,top,smoothstep(0.0,0.7,h)) : mix(mid,bot,smoothstep(0.0,-0.25,h)); gl_FragColor=vec4(c,1.); }',
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), domeMat));
  const box = (w, h, x, y, z, intensity, color = 0xffffff, lookAt = [0, 0.6, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(...lookAt);
    env.add(m);
    return m;
  };
  const k = light ? 0.8 : 1.0;
  // overhead softbox (narrower than before so the paint keeps deep, dark reflections around it)
  box(7, 2.0, 0, 7.5, 0, 5 * k, 0xffffff, [0, 0, 0]);
  // long strip lights running along the car - produce the characteristic streak highlights
  box(10, 0.35, 0, 4.4, 4.0, 10 * k);
  box(10, 0.35, 0, 4.4, -4.0, 10 * k);
  box(10, 0.22, 0, 1.9, 6.5, 5 * k);
  box(10, 0.22, 0, 1.9, -6.5, 5 * k);
  // front and rear panels
  box(4, 2.2, 8, 2.5, 0, 3 * k, 0xf4f6ff);
  box(4, 2.2, -8, 2.5, 0, 3 * k, 0xf4f6ff);
  // warm kicker
  box(2.5, 2.5, 5, 1.2, -6, 2.2 * k, 0xffe2c4);
  box(2.5, 2.5, -5, 1.2, 6, 2.0 * k, 0xdfe8ff);
  // floor bounce
  const fl = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(light ? 0x0c0c0e : 0x26282c) }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -0.01; env.add(fl);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  return rt.texture;
}

export class Studio {
  constructor(renderer, scene, { theme = 'light' } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Studio';
    scene.add(this.group);
    this.setTheme(theme);
  }

  setTheme(theme) {
    this.theme = theme;
    const dark = theme === 'dark';
    if (this.envTex) this.envTex.dispose();
    this.envTex = softboxEnvironment(this.renderer, theme);
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = dark ? 0.9 : 1.0;
    // clear previous
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.traverse?.((o) => { o.geometry?.dispose?.(); });
    }
    const bgTop = new THREE.Color(dark ? 0x17181b : 0xdfe3e8);
    const bgHorizon = new THREE.Color(dark ? 0x0d0e10 : 0xc9ced4);
    this.scene.background = bgHorizon.clone();
    this.scene.fog = null;

    // backdrop dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: bgTop }, hor: { value: bgHorizon } },
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top,hor; varying vec3 vP; void main(){ float h=clamp(vP.y,0.,1.); gl_FragColor=vec4(mix(hor,top,smoothstep(0.0,0.6,h)),1.); }',
    }));
    dome.name = 'Backdrop';
    dome.renderOrder = -10;
    this.group.add(dome);

    // floor with faint grid fading into the horizon
    const floorMat = new THREE.ShaderMaterial({
      uniforms: {
        base: { value: new THREE.Color(dark ? 0x1b1c1f : 0xd3d7dc) },
        line: { value: new THREE.Color(dark ? 0x2a2c30 : 0xbfc4ca) },
        hor: { value: bgHorizon },
        shadowMap: { value: null },
        shadowSize: { value: new THREE.Vector2(7, 4.2) },
        shadowStrength: { value: dark ? 0.9 : 0.75 },
        keyShadow: { value: null },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 base,line,hor; uniform sampler2D shadowMap; uniform vec2 shadowSize; uniform float shadowStrength; varying vec3 vW;
        float gridLine(vec2 p, float s){ vec2 g=abs(fract(p/s-0.5)-0.5)*s; vec2 fw=fwidth(p)*1.2; vec2 l=1.0-smoothstep(vec2(0.0),fw,g); return max(l.x,l.y); }
        void main(){
          float r=length(vW.xz);
          vec3 c=base;
          float gl=gridLine(vW.xz,1.0)*0.55+gridLine(vW.xz,0.25)*0.18;
          c=mix(c,line,gl*(1.0-smoothstep(6.0,18.0,r)));
          vec2 suv=0.5-vW.xz/shadowSize;
          if(suv.x>0.0&&suv.x<1.0&&suv.y>0.0&&suv.y<1.0){ float s=texture2D(shadowMap,suv).r; c*=1.0-s*shadowStrength; }
          c=mix(c,hor,smoothstep(10.0,40.0,r));
          gl_FragColor=vec4(c,1.0);
          #include <colorspace_fragment>
        }`,
    });
    floorMat.toneMapped = true;
    this.floorMat = floorMat;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(58, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'StudioFloor';
    this.group.add(floor);

    // shadow-catcher for the key light (soft directional shadow)
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: dark ? 0.45 : 0.22 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.0015; catcher.receiveShadow = true;
    catcher.name = 'ShadowCatcher';
    this.group.add(catcher);

    // lights
    const key = new THREE.DirectionalLight(0xffffff, dark ? 1.6 : 1.4);
    key.position.set(2.5, 9, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const sc = key.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 20;
    key.shadow.radius = 6; key.shadow.blurSamples = 16;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;
    this.group.add(key, key.target);
    this.key = key;
    const hemi = new THREE.HemisphereLight(dark ? 0x30343a : 0xe8eef5, dark ? 0x050505 : 0x6c6f73, dark ? 0.15 : 0.18);
    this.group.add(hemi);
  }

  /** Render a soft contact-shadow texture of `object` seen from below. */
  bakeContactShadow(object, { size = 1024, blur = 3 } = {}) {
    const r = this.renderer;
    const w = this.floorMat.uniforms.shadowSize.value;
    const cam = new THREE.OrthographicCamera(-w.x / 2, w.x / 2, w.y / 2, -w.y / 2, 0, 0.9);
    cam.position.set(0, 0, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 1, 0);
    // map world x->u, z->v ; camera looks up (+y): image x = world x, image y = -world z
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
    // only blend max: use additive-like max via MAX blending
    depthMat.blending = THREE.CustomBlending; depthMat.blendEquation = THREE.MaxEquation; depthMat.blendSrc = THREE.OneFactor; depthMat.blendDst = THREE.OneFactor;
    depthMat.depthTest = false; depthMat.depthWrite = false;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(rtA); r.clear(); r.render(scene, cam);
    scene.remove(object);
    if (prevParent) prevParent.add(object);
    // blur passes
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
    rtB.dispose();
    if (this.contactRT) this.contactRT.dispose();
    this.contactRT = rtA;
    // the render looked upward with image-x = world x, image-y = -world z -> flip v
    rtA.texture.repeat.set(1, 1);
    this.floorMat.uniforms.shadowMap.value = rtA.texture;
    this.floorMat.fragmentShader = this.floorMat.fragmentShader; // no-op, keeps intent explicit
  }
}
