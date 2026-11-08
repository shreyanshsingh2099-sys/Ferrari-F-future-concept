// Physically based materials for the F-Future, including procedurally generated
// textures (2x2 twill carbon fibre with anisotropy, metallic flake, leather grain,
// Alcantara, tyre sidewall, brushed aluminium, perforated mesh grilles).
import * as THREE from 'three';

const HAS_DOM = typeof document !== 'undefined';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function texFrom(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// deterministic PRNG for textures
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** 2x2 twill carbon weave. Returns { map, rough, aniso } textures. */
function makeCarbon({ cells = 8, size = 512, base = [22, 22, 24], hi = [70, 72, 78], tint = null } = {}) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const ca = canvas(size, size), cta = ca.getContext('2d');
  const cs = size / cells;
  const R = rng(7);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const horiz = ((i + j) % 4) < 2;
      const x = i * cs, y = j * cs;
      // shading across the tow
      const g = horiz ? ctx.createLinearGradient(x, y, x, y + cs) : ctx.createLinearGradient(x, y, x + cs, y);
      const k = 0.85 + R() * 0.3;
      const mid = hi.map((v, n) => Math.round(base[n] + (v - base[n]) * k));
      const col = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
      g.addColorStop(0, col(base)); g.addColorStop(0.5, col(mid)); g.addColorStop(1, col(base));
      ctx.fillStyle = g; ctx.fillRect(x, y, cs, cs);
      // fibre striations
      ctx.globalAlpha = 0.18;
      for (let s = 0; s < 18; s++) {
        const o = R() * cs;
        ctx.strokeStyle = R() > 0.5 ? '#000' : '#9aa';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(x, y + o); ctx.lineTo(x + cs, y + o); } else { ctx.moveTo(x + o, y); ctx.lineTo(x + o, y + cs); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // tow gaps
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      // anisotropy direction map: RG = direction (encoded 0..1), B = strength
      cta.fillStyle = horiz ? 'rgb(255,128,255)' : 'rgb(128,255,255)';
      cta.fillRect(x, y, cs, cs);
    }
  }
  if (tint) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint; ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
  return { map: texFrom(c), aniso: texFrom(ca, { srgb: false }) };
}

function makeFlakeNormal(size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const R = rng(3);
  for (let i = 0; i < size * size; i++) {
    const a = R() * Math.PI * 2, r = Math.pow(R(), 2) * 0.35;
    img.data[4 * i] = 128 + Math.cos(a) * r * 127;
    img.data[4 * i + 1] = 128 + Math.sin(a) * r * 127;
    img.data[4 * i + 2] = 255;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return texFrom(c, { srgb: false });
}

function makeNoiseTex(size, fn, srgb = true) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const R = rng(11);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fn(x, y, R);
    const i = 4 * (y * size + x);
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return texFrom(c, { srgb });
}

function makeLeatherBump() {
  return makeNoiseTex(256, (x, y, R) => {
    const v = 128 + (R() - 0.5) * 60 + Math.sin(x * 0.7) * Math.sin(y * 0.9) * 10;
    return [v, v, v];
  }, false);
}

function makeMesh(size = 256, cells = 16, round = false) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  const cs = size / cells;
  ctx.fillStyle = '#000';
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const ox = (j % 2) * cs * 0.5;
    if (round) { ctx.beginPath(); ctx.arc(i * cs + ox + cs / 2, j * cs + cs / 2, cs * 0.36, 0, Math.PI * 2); ctx.fill(); }
    else {
      // hexagonal-ish honeycomb hole
      const cx = i * cs + ox + cs / 2, cy = j * cs + cs / 2, r = cs * 0.42;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
    }
  }
  return texFrom(c, { srgb: false });
}

function makeTyreSidewall() {
  // radial texture (u around, v radial) with subtle lettering band and ribs
  const w = 2048, h = 128;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#7f7f7f'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8c8c8c';
  for (let i = 0; i < 360; i++) { ctx.fillRect((i / 360) * w, h * 0.82, 1, h * 0.12); }
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.fillStyle = '#9a9a9a';
  ctx.textBaseline = 'middle';
  const words = ['F-FUTURE  CORSA', '325/25 ZR22', 'F-FUTURE  CORSA', 'RADIAL  TUBELESS'];
  words.forEach((t, k) => ctx.fillText(t, (k / words.length) * w + 40, h * 0.45));
  return texFrom(c, { srgb: false });
}

export function createMaterials({ paint = 0x8a0710 } = {}) {
  const M = {};
  const carbon = HAS_DOM ? makeCarbon({}) : null;
  const carbonRed = HAS_DOM ? makeCarbon({ base: [26, 8, 10], hi: [96, 24, 30] }) : null;
  const flakes = HAS_DOM ? makeFlakeNormal() : null;
  if (flakes) flakes.repeat.set(60, 60);
  if (carbon) { carbon.map.repeat.set(22, 22); carbon.aniso.repeat.set(22, 22); }
  if (carbonRed) { carbonRed.map.repeat.set(22, 22); carbonRed.aniso.repeat.set(22, 22); }

  M.paint = new THREE.MeshPhysicalMaterial({
    name: 'Paint_RossoFuture', color: paint, metalness: 0.55, roughness: 0.3,
    clearcoat: 1.0, clearcoatRoughness: 0.035, envMapIntensity: 1.0,
    normalMap: flakes, normalScale: new THREE.Vector2(0.06, 0.06),
  });
  M.paintInner = new THREE.MeshStandardMaterial({ name: 'Paint_Inner', color: 0x5a060c, metalness: 0.3, roughness: 0.6 });
  M.carbon = new THREE.MeshPhysicalMaterial({
    name: 'Carbon_Gloss', color: 0xb8b8b8, map: carbon?.map ?? null, metalness: 0.1, roughness: 0.42,
    clearcoat: 0.9, clearcoatRoughness: 0.06, envMapIntensity: 0.55,
    anisotropy: carbon ? 0.6 : 0, anisotropyMap: carbon?.aniso ?? null,
  });
  M.carbonMatte = new THREE.MeshPhysicalMaterial({
    name: 'Carbon_Satin', color: 0x9a9a9a, map: carbon?.map ?? null, metalness: 0.1, roughness: 0.55,
    clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.45,
  });
  M.carbonRed = new THREE.MeshPhysicalMaterial({
    name: 'Carbon_RossoTint', color: 0xd0d0d0, map: carbonRed?.map ?? null, metalness: 0.2, roughness: 0.4,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 0.7, anisotropy: carbonRed ? 0.5 : 0, anisotropyMap: carbonRed?.aniso ?? null,
  });
  // Tinted glazing: transparent with strong (Fresnel) reflections. Cheaper and more robust
  // than screen-space transmission and lets the cockpit be seen from outside.
  M.glass = new THREE.MeshPhysicalMaterial({
    name: 'Glass_Tinted', color: 0x0e1114, metalness: 0.0, roughness: 0.03, transparent: true, opacity: 0.32,
    envMapIntensity: 1.6, specularIntensity: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false,
  });
  M.glassClear = new THREE.MeshPhysicalMaterial({
    name: 'Glass_Lens', color: 0xdfe6ee, metalness: 0, roughness: 0.0, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, envMapIntensity: 2.0, clearcoat: 1, depthWrite: false,
  });
  M.glassRed = new THREE.MeshPhysicalMaterial({
    name: 'Glass_RedLens', color: 0xb01010, metalness: 0, roughness: 0.05, transmission: 0.6, thickness: 0.004,
    ior: 1.5, side: THREE.DoubleSide,
  });
  M.blackGloss = new THREE.MeshPhysicalMaterial({ name: 'Black_Gloss', color: 0x040405, metalness: 0.2, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
  M.blackSatin = new THREE.MeshStandardMaterial({ name: 'Black_Satin', color: 0x0c0c0d, metalness: 0.1, roughness: 0.55 });
  M.blackMatte = new THREE.MeshStandardMaterial({ name: 'Black_Matte', color: 0x060606, metalness: 0.0, roughness: 0.9 });
  M.cavity = new THREE.MeshStandardMaterial({ name: 'Cavity_Dark', color: 0x020202, metalness: 0, roughness: 1 });
  M.chrome = new THREE.MeshStandardMaterial({ name: 'Chrome', color: 0xf2f2f2, metalness: 1, roughness: 0.06 });
  M.darkChrome = new THREE.MeshStandardMaterial({ name: 'Chrome_Dark', color: 0x55585e, metalness: 1, roughness: 0.12 });
  M.alu = new THREE.MeshPhysicalMaterial({ name: 'Aluminium_Brushed', color: 0xc9ccd1, metalness: 1, roughness: 0.32, anisotropy: 0.7 });
  M.aluDark = new THREE.MeshStandardMaterial({ name: 'Aluminium_Cast', color: 0x8b8e93, metalness: 1, roughness: 0.42 });
  M.titanium = new THREE.MeshStandardMaterial({ name: 'Titanium_Exhaust', color: 0x9c8f86, metalness: 1, roughness: 0.28 });
  M.gold = new THREE.MeshStandardMaterial({ name: 'Gold_Foil', color: 0xd9a33a, metalness: 1, roughness: 0.25 });
  M.rim = new THREE.MeshPhysicalMaterial({ name: 'Rim_Gunmetal', color: 0x3c3f45, metalness: 1, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  M.rimMachined = new THREE.MeshStandardMaterial({ name: 'Rim_Machined', color: 0xa9adb3, metalness: 1, roughness: 0.18 });
  M.tyre = new THREE.MeshStandardMaterial({ name: 'Tyre_Rubber', color: 0x141414, metalness: 0, roughness: 0.82 });
  if (HAS_DOM) {
    const sw = makeTyreSidewall();
    M.tyreSide = new THREE.MeshStandardMaterial({ name: 'Tyre_Sidewall', color: 0x141414, roughness: 0.8, bumpMap: sw, bumpScale: 1.5 });
  } else M.tyreSide = M.tyre;
  M.brakeDisc = new THREE.MeshStandardMaterial({ name: 'Brake_CarbonCeramic', color: 0x3b3b3e, metalness: 0.4, roughness: 0.55 });
  M.caliper = new THREE.MeshPhysicalMaterial({ name: 'Caliper_Nero', color: 0x101012, metalness: 0.3, roughness: 0.3, clearcoat: 1 });
  M.yellow = new THREE.MeshPhysicalMaterial({ name: 'Badge_Giallo', color: 0xf2c200, metalness: 0.1, roughness: 0.25, clearcoat: 1 });
  M.badgeBlack = new THREE.MeshStandardMaterial({ name: 'Badge_Black', color: 0x050505, metalness: 0.5, roughness: 0.3 });
  M.tricolorG = new THREE.MeshStandardMaterial({ name: 'Badge_Green', color: 0x0a7a32, roughness: 0.3 });
  M.tricolorW = new THREE.MeshStandardMaterial({ name: 'Badge_White', color: 0xf0f0f0, roughness: 0.3 });
  M.tricolorR = new THREE.MeshStandardMaterial({ name: 'Badge_Red', color: 0xc8102e, roughness: 0.3 });

  // lights
  M.ledWhite = new THREE.MeshStandardMaterial({ name: 'LED_White', color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 2.2, roughness: 0.2 });
  M.ledAmber = new THREE.MeshStandardMaterial({ name: 'LED_Amber', color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 0.0, roughness: 0.3 });
  M.ledRed = new THREE.MeshStandardMaterial({ name: 'LED_Red', color: 0xff1010, emissive: 0xff0a0a, emissiveIntensity: 2.6, roughness: 0.3 });
  M.ledRedDim = new THREE.MeshStandardMaterial({ name: 'LED_RedDim', color: 0x400404, emissive: 0x7a0000, emissiveIntensity: 0.6, roughness: 0.35 });
  M.lampChrome = new THREE.MeshStandardMaterial({ name: 'Lamp_Reflector', color: 0x9aa0a8, metalness: 1, roughness: 0.15 });

  // grilles
  if (HAS_DOM) {
    const hex = makeMesh(256, 12, false);
    hex.repeat.set(30, 30);
    M.grille = new THREE.MeshStandardMaterial({ name: 'Grille_Honeycomb', color: 0x111113, metalness: 0.6, roughness: 0.4, alphaMap: hex, alphaTest: 0.5, side: THREE.DoubleSide });
  } else M.grille = M.blackSatin;

  // interior
  const leatherBump = HAS_DOM ? makeLeatherBump() : null;
  if (leatherBump) leatherBump.repeat.set(8, 8);
  M.leather = new THREE.MeshPhysicalMaterial({ name: 'Leather_Nero', color: 0x121212, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color(0x333333), bumpMap: leatherBump, bumpScale: 0.3 });
  M.leatherRed = new THREE.MeshPhysicalMaterial({ name: 'Leather_Rosso', color: 0x6e0b10, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0x552222), bumpMap: leatherBump, bumpScale: 0.3 });
  M.alcantara = new THREE.MeshPhysicalMaterial({ name: 'Alcantara_Nero', color: 0x161616, roughness: 0.95, sheen: 1.0, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x4a4a4a) });
  M.stitch = new THREE.MeshStandardMaterial({ name: 'Stitch_Rosso', color: 0xd01820, roughness: 0.6, emissive: 0x200000 });
  M.rubberTrim = new THREE.MeshStandardMaterial({ name: 'Seal_Rubber', color: 0x0a0a0a, roughness: 0.9 });
  M.screen = new THREE.MeshStandardMaterial({ name: 'Display', color: 0x000000, roughness: 0.15, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 0.9 });
  M.ambient = new THREE.MeshStandardMaterial({ name: 'Ambient_Light', color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 2.0 });
  M.belt = new THREE.MeshStandardMaterial({ name: 'Seatbelt_Webbing', color: 0x161616, roughness: 0.85 });
  M.beltRed = new THREE.MeshStandardMaterial({ name: 'Seatbelt_Rosso', color: 0x8a0f14, roughness: 0.8 });

  // engine
  M.engineBlock = new THREE.MeshStandardMaterial({ name: 'Engine_Block', color: 0x5d6066, metalness: 0.85, roughness: 0.45 });
  M.engineRed = new THREE.MeshPhysicalMaterial({ name: 'Engine_RossoCrackle', color: 0x9a0c12, metalness: 0.3, roughness: 0.55, clearcoat: 0.3 });
  M.engineBlack = new THREE.MeshStandardMaterial({ name: 'Engine_BlackAnodised', color: 0x18191b, metalness: 0.7, roughness: 0.4 });
  M.hose = new THREE.MeshStandardMaterial({ name: 'Hose_Braided', color: 0x26272a, metalness: 0.4, roughness: 0.6 });
  M.heatShield = new THREE.MeshStandardMaterial({ name: 'Heat_Shield_Gold', color: 0xc7a14a, metalness: 1, roughness: 0.32 });
  M.coolant = new THREE.MeshStandardMaterial({ name: 'Radiator_Core', color: 0x2a2c30, metalness: 0.7, roughness: 0.5 });
  M.spring = new THREE.MeshStandardMaterial({ name: 'Spring_Yellow', color: 0xe8b400, metalness: 0.5, roughness: 0.35 });
  M.damper = new THREE.MeshStandardMaterial({ name: 'Damper_Body', color: 0x2b2d31, metalness: 0.9, roughness: 0.3 });

  // Body panels are double sided: the inside of the shell renders as a dark trim lining
  // (so the cockpit and open door apertures never reveal the background through a panel).
  for (const k of ['paint', 'carbonRed', 'blackGloss', 'carbon']) lineBackface(M[k]);

  M.liner = new THREE.MeshStandardMaterial({ name: 'Wheelarch_Liner', color: 0x0b0b0c, roughness: 0.95, side: THREE.DoubleSide });
  M.underbody = new THREE.MeshStandardMaterial({ name: 'Underbody', color: 0x0d0d0e, roughness: 0.8 });
  M.paintInterior = new THREE.MeshStandardMaterial({ name: 'Body_InnerLining', color: 0x0d0d0d, roughness: 0.85, side: THREE.BackSide });
  return M;
}

function lineBackface(mat) {
  mat.side = THREE.DoubleSide;
  mat.shadowSide = THREE.FrontSide;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.016, 0.016, 0.018);`);
  };
  mat.customProgramCacheKey = () => 'lined-' + mat.name;
}

/** Planar/box UV projection in metres for generated parts (for textures like carbon). */
export function boxUV(geometry, scale = 1) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  if (!n) geometry.computeVertexNormals();
  const N = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[2 * i] = u * scale; uv[2 * i + 1] = v * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
