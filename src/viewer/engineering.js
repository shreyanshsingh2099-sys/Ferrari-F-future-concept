// Engineering workspace: assembly tree, part inspector, distance measurement, section plane,
// overall-dimension overlay and surface analysis shading (clay, zebra, wireframe, X-ray, flow
// incidence). All numbers shown are measured from the model itself or from dims.js.
import * as THREE from 'three';
import { DIMS } from '../car/dims.js';

const EYE = '<svg><use href="#i-eye"/></svg>';
const mm = (m) => `${Math.round(m * 1000).toLocaleString('en-US')} mm`;
const triCount = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
function visibleInTree(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

// ---------- analysis materials ----------
function zebraMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Analysis_Zebra', side: THREE.DoubleSide,
    uniforms: { freq: { value: 9.0 } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      #include <clipping_planes_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `uniform float freq; varying vec3 vN; varying vec3 vW;
      #include <clipping_planes_pars_fragment>
      void main(){
        #include <clipping_planes_fragment>
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(vW - cameraPosition);
        vec3 r = reflect(v, n);
        // reflection of an infinite set of horizontal light tubes: stripes continuous across a
        // panel join mean tangent (G1) continuity, kinks mean a crease
        float s = r.y * freq;
        float w = fwidth(s) * 1.2;
        float band = smoothstep(0.5 - w, 0.5 + w, abs(fract(s) - 0.5) * 2.0);
        float shade = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.3, 1.0, 0.2))), 0.0);
        gl_FragColor = vec4(mix(vec3(0.03), vec3(0.95) * shade, band), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
function flowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Analysis_FlowIncidence', side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN;
      #include <clipping_planes_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `varying vec3 vN;
      #include <clipping_planes_pars_fragment>
      vec3 ramp(float t){ // blue (leeward) - teal - green (tangential) - yellow - red (facing the flow)
        vec3 a = vec3(0.10, 0.25, 0.85), b = vec3(0.05, 0.70, 0.75), c = vec3(0.35, 0.80, 0.30), d = vec3(0.98, 0.80, 0.10), e = vec3(0.90, 0.12, 0.10);
        t = clamp(t, 0.0, 1.0);
        if (t < 0.25) return mix(a, b, t / 0.25); if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25); if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25); return mix(d, e, (t - 0.75) / 0.25);
      }
      void main(){
        #include <clipping_planes_fragment>
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        // the car drives towards +x, so the oncoming flow travels along -x
        float c = dot(n, vec3(1.0, 0.0, 0.0));
        // signed Newtonian incidence: sin^2 of the angle between surface and flow, + facing, - leeward
        float t = 0.5 + 0.5 * sign(c) * c * c;
        float shade = 0.75 + 0.25 * max(dot(n, normalize(vec3(0.3, 1.0, 0.2))), 0.0);
        gl_FragColor = vec4(ramp(t) * shade, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function createEngineering({ car, scene, camera, controls, canvas, flyTo, toast, renderer }) {
  const $ = (id) => document.getElementById(id);
  if (renderer) renderer.localClippingEnabled = true;
  const root = car.root;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let active = false;
  let tool = 'select';
  let shading = 'shaded';

  // ---------------------------------------------------------------- assembly model
  // top-level groups -> unique part names (instances merged), each with its meshes
  const assembly = [];
  for (const g of root.children) {
    if (/^ExhaustFlame|^ContactShadow/.test(g.name)) continue; // effects, not parts
    const items = new Map();
    g.traverse((o) => {
      if (!o.isMesh || o.userData.engHelper) return;
      const name = o.name || o.material?.name || 'Part';
      if (!items.has(name)) items.set(name, { name, meshes: [], tris: 0 });
      const it = items.get(name); it.meshes.push(o); it.tris += triCount(o.geometry);
    });
    if (!items.size) continue;
    const list = [...items.values()].sort((a, b) => b.tris - a.tris);
    assembly.push({ name: g.name || 'Group', group: g, items: list, tris: list.reduce((s, i) => s + i.tris, 0), meshes: list.reduce((s, i) => s + i.meshes.length, 0) });
  }
  const meshToItem = new Map();
  for (const a of assembly) for (const it of a.items) { it.parent = a; for (const m of it.meshes) meshToItem.set(m, it); }
  const allMeshes = [...meshToItem.keys()];

  // ---------------------------------------------------------------- tree UI
  const treeBody = $('treeBody');
  const nodes = new Map();
  function buildTree() {
    treeBody.innerHTML = '';
    $('treeCount').textContent = `${allMeshes.length} meshes`;
    for (const a of assembly) {
      const wrap = document.createElement('div'); wrap.className = 'grp';
      const row = document.createElement('div'); row.className = 'node'; row.setAttribute('role', 'treeitem');
      row.innerHTML = `<span class="tw">▶</span><span class="name">${a.name.replace(/_/g, ' ')}</span><span class="cnt">${fmtK(a.tris)}</span><button class="vis" title="Show / hide">${EYE}</button>`;
      const kids = document.createElement('div'); kids.className = 'kids';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.vis')) return;
        if (e.target.closest('.tw')) { wrap.classList.toggle('open'); return; }
        select(a.items, a.name); wrap.classList.add('open');
      });
      row.querySelector('.vis').addEventListener('click', () => { const on = !a.items.every((i) => i.meshes.every((m) => !m.visible)); setVisible(a.items, !on); });
      for (const it of a.items) {
        const r = document.createElement('div'); r.className = 'node leaf'; r.setAttribute('role', 'treeitem');
        r.innerHTML = `<span class="tw"></span><span class="name" title="${it.name}">${it.name.replace(/_/g, ' ')}${it.meshes.length > 1 ? ` <span class="cnt">×${it.meshes.length}</span>` : ''}</span><span class="cnt">${fmtK(it.tris)}</span><button class="vis" title="Show / hide">${EYE}</button>`;
        r.addEventListener('click', (e) => { if (e.target.closest('.vis')) return; select([it], it.name); });
        r.addEventListener('dblclick', () => frame());
        r.querySelector('.vis').addEventListener('click', () => setVisible([it], !it.meshes[0].visible));
        kids.appendChild(r); nodes.set(it, r);
      }
      nodes.set(a, row);
      wrap.append(row, kids); treeBody.appendChild(wrap);
    }
    $('treeSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const wrap of treeBody.children) {
        let any = false;
        for (const leaf of wrap.querySelectorAll('.leaf')) { const hit = !q || leaf.textContent.toLowerCase().includes(q); leaf.style.display = hit ? '' : 'none'; any ||= hit; }
        wrap.style.display = any ? '' : 'none';
        wrap.classList.toggle('open', !!q && any);
      }
    });
  }
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k` : `${Math.round(n)}`);
  function syncTreeVis() {
    for (const [k, el] of nodes) {
      const items = k.items || [k];
      el.classList.toggle('hid', items.every((i) => i.meshes.every((m) => !m.visible)));
    }
  }
  function setVisible(items, on) {
    for (const it of items) for (const m of it.meshes) m.visible = on;
    syncTreeVis();
  }
  function showAll() { for (const m of allMeshes) m.visible = true; syncTreeVis(); }
  function isolate() {
    if (!sel.length) return;
    const keep = new Set(sel.flatMap((i) => i.meshes));
    for (const m of allMeshes) m.visible = keep.has(m);
    syncTreeVis();
    toast('Isolated · Shift+H to show all');
  }

  // ---------------------------------------------------------------- selection
  let sel = [], selName = '';
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const overlays = [];
  const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffc400);
  boxHelper.userData.engHelper = true; boxHelper.visible = false; boxHelper.material.depthTest = false; boxHelper.material.transparent = true; boxHelper.material.opacity = 0.6; boxHelper.renderOrder = 10;
  scene.add(boxHelper);
  function clearOverlays() { for (const o of overlays) o.parent?.remove(o); overlays.length = 0; }
  function select(items, name) {
    for (const it of sel) nodes.get(it)?.classList.remove('sel');
    for (const a of assembly) nodes.get(a)?.classList.remove('sel');
    clearOverlays();
    sel = items || []; selName = name || '';
    if (!sel.length) { boxHelper.visible = false; renderInspector(); return; }
    for (const it of sel) {
      nodes.get(it)?.classList.add('sel');
      for (const m of it.meshes) {
        const o = new THREE.Mesh(m.geometry, hiMat); o.userData.engHelper = true; o.raycast = () => {}; o.renderOrder = 5;
        m.add(o); overlays.push(o);
      }
    }
    if (sel.length === 1) { const el = nodes.get(sel[0]); el?.parentElement?.parentElement?.classList.add('open'); el?.scrollIntoView({ block: 'nearest' }); }
    else { const a = sel[0].parent; if (a && a.items.length === sel.length) nodes.get(a)?.classList.add('sel'); }
    boxHelper.visible = true;
    renderInspector();
  }
  function selBox() {
    const b = new THREE.Box3();
    for (const it of sel) for (const m of it.meshes) b.expandByObject(m);
    return b;
  }
  function frame() {
    if (!sel.length) return;
    const b = selBox(), c = b.getCenter(new THREE.Vector3()), r = Math.max(0.25, b.getSize(new THREE.Vector3()).length() * 0.5);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const d = r / Math.sin((camera.fov * Math.PI) / 360) * 1.1;
    flyTo(c.clone().add(dir.multiplyScalar(d)).toArray(), c.toArray(), 0.9, { direct: true, fov: camera.fov });
  }

  function renderInspector() {
    const el = $('insPart');
    if (!sel.length) { el.innerHTML = '<h2>Selection</h2><p class="empty">Click a part in the viewport or the assembly tree.</p>'; return; }
    const meshes = sel.flatMap((i) => i.meshes);
    const tris = sel.reduce((s, i) => s + i.tris, 0);
    let verts = 0; for (const m of meshes) verts += m.geometry.attributes.position.count;
    const b = selBox(), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const mats = [...new Set(meshes.map((m) => (m.userData.engMat0 || m.userData.mat0 || m.material)))];
    const m0 = mats[0];
    const matRows = mats.length === 1 && m0 ? [
      ['Material', m0.name || m0.type], ['Shader', m0.type.replace('Mesh', '').replace('Material', '')],
      ...(m0.metalness !== undefined ? [['Metalness', m0.metalness.toFixed(2)], ['Roughness', m0.roughness.toFixed(2)]] : []),
      ...(m0.clearcoat ? [['Clear coat', `${m0.clearcoat.toFixed(2)} · r ${m0.clearcoatRoughness.toFixed(2)}`]] : []),
      ...(m0.transmission ? [['Transmission', m0.transmission.toFixed(2)]] : []),
      ...(m0.opacity < 1 ? [['Opacity', m0.opacity.toFixed(2)]] : []),
    ] : [['Materials', `${mats.length}`]];
    const rows = [
      ['Group', sel[0].parent?.name?.replace(/_/g, ' ') ?? ''], ['Instances', `${meshes.length}`],
      ['Triangles', Math.round(tris).toLocaleString('en-US')], ['Vertices', verts.toLocaleString('en-US')],
      ['Extent X', mm(s.x)], ['Extent Y', mm(s.y)], ['Extent Z', mm(s.z)],
      ['Centre', `${Math.round(c.x * 1000)}, ${Math.round(c.y * 1000)}, ${Math.round(c.z * 1000)}`],
      ...matRows,
    ];
    el.innerHTML = `<h2>Selection <span class="aside">${selName.replace(/_/g, ' ')}</span></h2><dl class="kv mono">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="grid three" style="margin-top:10px"><button data-eng="frame">Frame</button><button data-eng="isolate">Isolate</button><button data-eng="hide">Hide</button></div>`;
    el.querySelector('[data-eng="frame"]').onclick = frame;
    el.querySelector('[data-eng="isolate"]').onclick = isolate;
    el.querySelector('[data-eng="hide"]').onclick = () => { setVisible(sel, false); select([]); };
  }

  // ---------------------------------------------------------------- vehicle data
  function renderSpecs() {
    const D = DIMS;
    const rows = [
      ['Length', mm(D.length)], ['Width', mm(D.width)], ['Height', mm(D.height)], ['Wheelbase', mm(D.wheelbase)],
      ['Track F / R', `${Math.round(D.front.track * 1000)} / ${Math.round(D.rear.track * 1000)}`],
      ['Overhang F / R', `${Math.round((D.XTIP - D.XF) * 1000)} / ${Math.round((D.XR - D.XTAIL) * 1000)}`],
      ['Floor height', mm(D.rideFloor)],
      ['Tyres F', '255/30 R21'], ['Tyres R', '325/25 R22'],
      ['Engine', 'V12 65°, NA, mid-rear'], ['Doors', 'Butterfly'],
      ['Model', `${car.stats.meshes} meshes · ${(car.stats.tris / 1e6).toFixed(2)} M tris`],
    ];
    $('specs').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  // ---------------------------------------------------------------- shading
  const clayMat = new THREE.MeshStandardMaterial({ name: 'Analysis_Clay', color: 0xb9b6b0, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const clayDark = new THREE.MeshStandardMaterial({ name: 'Analysis_ClayDark', color: 0x2b2d31, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const wireMat = new THREE.MeshBasicMaterial({ name: 'Analysis_Wire', color: 0x8fa3ba, wireframe: true, transparent: true, opacity: 0.32, depthWrite: false });
  const zebraMat = zebraMaterial();
  const flowMat = flowMaterial();
  const analysisMats = [clayMat, clayDark, wireMat, zebraMat, flowMat];
  const isGlass = (m) => m && (m.transparent && m.opacity < 0.95);
  const NOTES = {
    clay: 'Matte design clay: judge form and highlights without colour or material distraction.',
    zebra: 'Reflection of parallel light tubes. Continuous stripes across a join show tangent continuity; a kink or offset shows a crease or step.',
    wire: 'Tessellation of the generated surfaces. Density follows curvature and trim lines.',
    xray: 'Translucent body to show the chassis, cockpit and V12 packaging.',
    flow: 'Geometric flow incidence (Newtonian sin² of the angle between surface and oncoming flow). Indicative only: not a CFD result and not a pressure measurement.',
  };
  function setShading(name) {
    // restore originals
    if (car.xray) car.setXray(false);
    for (const m of allMeshes) if (m.userData.engMat0) { m.material = m.userData.engMat0; delete m.userData.engMat0; }
    shading = name;
    if (name === 'xray') car.setXray(true);
    else if (name !== 'shaded') {
      for (const m of allMeshes) {
        const orig = m.material;
        m.userData.engMat0 = orig;
        if (name === 'clay') m.material = isGlass(orig) ? clayDark : clayMat;
        else if (name === 'zebra') m.material = isGlass(orig) ? clayDark : zebraMat;
        else if (name === 'wire') m.material = wireMat;
        else if (name === 'flow') m.material = isGlass(orig) ? clayDark : flowMat;
      }
    }
    applyClipping();
    document.querySelectorAll('[data-shade]').forEach((b) => b.classList.toggle('active', b.dataset.shade === name));
    const sec = $('insAnalysis');
    sec.hidden = name === 'shaded';
    $('analysisNote').textContent = NOTES[name] || '';
    const lg = $('analysisLegend');
    if (name === 'flow') {
      lg.style.background = 'linear-gradient(90deg,#1a40d9,#0db3bf,#59cc4d,#facc1a,#e61f1a)';
      lg.style.display = '';
      lg.nextElementSibling?.classList.contains('legend-labels') || lg.insertAdjacentHTML('afterend', '<div class="legend-labels"><span>leeward</span><span>tangential</span><span>facing flow</span></div>');
    } else { lg.style.display = 'none'; lg.nextElementSibling?.classList.contains('legend-labels') && lg.nextElementSibling.remove(); }
  }

  // ---------------------------------------------------------------- section plane
  const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  let secOn = false, secAxis = 'x', secFlip = false;
  const planeViz = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
  const planeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.7 }));
  planeViz.add(planeEdge); planeViz.userData.engHelper = true; planeViz.visible = false; planeViz.raycast = () => {};
  scene.add(planeViz);
  const carMaterials = () => { const s = new Set(); for (const m of allMeshes) s.add(m.material); for (const x of [...analysisMats, hiMat]) s.add(x); return s; };
  function applyClipping() {
    const planes = secOn ? [plane] : null;
    for (const mat of carMaterials()) { if (mat.clippingPlanes !== planes) { mat.clippingPlanes = planes; mat.clipShadows = true; mat.needsUpdate = true; } }
  }
  function updatePlane() {
    const v = +$('secPos').value;
    const n = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[secAxis].clone();
    if (secFlip) n.negate();
    // keep the half-space on the "behind" side of the plane: points with n·p + c >= 0 are kept
    plane.normal.copy(n).negate(); plane.constant = secFlip ? -v : v;
    $('secOut').textContent = `${Math.round(v * 1000)} mm`;
    // visualiser sized to the car
    planeViz.position.set(secAxis === 'x' ? v : 0, secAxis === 'y' ? v : 0.6, secAxis === 'z' ? v : 0);
    planeViz.rotation.set(0, 0, 0);
    if (secAxis === 'x') { planeViz.rotation.y = Math.PI / 2; planeViz.scale.set(2.4, 1.5, 1); }
    else if (secAxis === 'z') { planeViz.scale.set(5.0, 1.5, 1); }
    else { planeViz.rotation.x = -Math.PI / 2; planeViz.scale.set(5.0, 2.4, 1); }
  }
  function setSection(on) {
    secOn = on;
    planeViz.visible = on;
    $('insSection').hidden = !on && tool !== 'section';
    if (on) updatePlane();
    applyClipping();
  }
  function setAxis(a) {
    secAxis = a;
    const r = { x: [-2.6, 2.6, 0], y: [0.02, 1.2, 0.6], z: [-1.05, 1.05, 0] }[a];
    const s = $('secPos'); s.min = r[0]; s.max = r[1]; s.value = r[2];
    document.querySelectorAll('#secAxis button').forEach((b) => b.classList.toggle('active', b.dataset.axis === a));
    updatePlane();
  }

  // ---------------------------------------------------------------- measuring
  const mGroup = new THREE.Group(); mGroup.userData.engHelper = true; scene.add(mGroup);
  const mLabels = $('measureLabels');
  const measures = [];
  let pending = null;
  const dotGeo = new THREE.SphereGeometry(0.008, 12, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffc400, depthTest: false, transparent: true });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffc400, depthTest: false, transparent: true });
  function addPoint(p) {
    const d = new THREE.Mesh(dotGeo, dotMat); d.position.copy(p); d.renderOrder = 20; d.raycast = () => {}; mGroup.add(d);
    if (!pending) { pending = { a: p.clone(), dot: d }; $('measureHint').textContent = 'Click the second point.'; return; }
    const a = pending.a, b = p.clone();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat); line.renderOrder = 20; line.raycast = () => {};
    mGroup.add(line);
    const el = document.createElement('div'); el.className = 'mlabel'; el.textContent = mm(a.distanceTo(b)); mLabels.appendChild(el);
    measures.push({ a, b, el, mid: a.clone().lerp(b, 0.5) });
    pending = null;
    $('measureHint').textContent = 'Click two points on the model.';
    renderMeasures();
  }
  function renderMeasures() {
    const m = measures[measures.length - 1];
    if (!m) { $('measureOut').innerHTML = ''; return; }
    const d = m.b.clone().sub(m.a);
    $('measureOut').innerHTML = [['Distance', mm(d.length())], ['Δx (long.)', mm(Math.abs(d.x))], ['Δy (height)', mm(Math.abs(d.y))], ['Δz (lateral)', mm(Math.abs(d.z))], ['Count', `${measures.length}`]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  function clearMeasures() {
    for (const m of measures) m.el.remove();
    measures.length = 0; pending = null;
    while (mGroup.children.length) { const c = mGroup.children.pop(); if (c.isLine) c.geometry.dispose(); }
    renderMeasures();
  }

  // ---------------------------------------------------------------- dimension overlay
  const dimGroup = new THREE.Group(); dimGroup.userData.engHelper = true; dimGroup.visible = false; scene.add(dimGroup);
  const dimLabels = [];
  let dimsOn = false;
  (function buildDims() {
    const D = DIMS, mat = new THREE.LineBasicMaterial({ color: 0xf2c200, transparent: true, opacity: 0.85 });
    const ext = new THREE.LineBasicMaterial({ color: 0xf2c200, transparent: true, opacity: 0.35 });
    const seg = (pts, m = mat) => { const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), m); l.raycast = () => {}; dimGroup.add(l); };
    const dim = (a, b, label, ticks, t = 0.5) => {
      seg([a, b]);
      for (const [p, q] of ticks) seg([p, q], ext);
      const mid = new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), t);
      const el = document.createElement('div'); el.className = 'mlabel dim'; el.textContent = label; el.style.display = 'none'; mLabels.appendChild(el);
      dimLabels.push({ el, p: mid });
    };
    const zS = -D.width / 2 - 0.35, y0 = 0.004;
    dim([D.XTIP, y0, zS], [D.XTAIL, y0, zS], `Length ${mm(D.length)}`, [[[D.XTIP, y0, zS - 0.06], [D.XTIP, y0, -0.6]], [[D.XTAIL, y0, zS - 0.06], [D.XTAIL, y0, -0.6]]], 0.18);
    const zW = zS - 0.28;
    dim([D.XF, y0, zW], [D.XR, y0, zW], `Wheelbase ${mm(D.wheelbase)}`, [[[D.XF, y0, zW - 0.06], [D.XF, y0, -D.front.track / 2]], [[D.XR, y0, zW - 0.06], [D.XR, y0, -D.rear.track / 2]]], 0.62);
    const xFr = D.XTIP + 0.35;
    dim([xFr, y0, -D.width / 2], [xFr, y0, D.width / 2], `Width ${mm(D.width)}`, [[[xFr + 0.06, y0, -D.width / 2], [D.XTIP - 0.3, y0, -D.width / 2]], [[xFr + 0.06, y0, D.width / 2], [D.XTIP - 0.3, y0, D.width / 2]]]);
    const xH = D.XTAIL - 0.35;
    dim([xH, 0, 0], [xH, D.height, 0], `Height ${mm(D.height)}`, [[[xH - 0.06, D.height, 0], [-0.2, D.height, 0]], [[xH - 0.06, 0, 0], [D.XTAIL + 0.1, 0, 0]]]);
    const xT = D.XF;
    dim([xT, y0, -D.front.track / 2], [xT, y0, D.front.track / 2], `Track F ${mm(D.front.track)}`, []);
    dim([D.XR, y0, -D.rear.track / 2], [D.XR, y0, D.rear.track / 2], `Track R ${mm(D.rear.track)}`, []);
  })();
  function setDims(on) {
    dimsOn = on; dimGroup.visible = on;
    for (const d of dimLabels) d.el.style.display = on ? '' : 'none';
    document.querySelector('[data-tool="dims"]').classList.toggle('active', on);
  }

  // ---------------------------------------------------------------- tools
  function setTool(t) {
    tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => { if (b.dataset.tool !== 'dims') b.classList.toggle('active', b.dataset.tool === t); });
    $('insMeasure').hidden = t !== 'measure' && !measures.length;
    if (t === 'section' && !secOn) setSection(true);
    $('insSection').hidden = !secOn;
    canvas.style.cursor = t === 'measure' ? 'crosshair' : '';
  }

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(allMeshes, false);
    for (const h of hits) {
      if (!visibleInTree(h.object)) continue;
      if (secOn && plane.distanceToPoint(h.point) < 0) continue; // clipped away
      return h;
    }
    return null;
  }

  // ---------------------------------------------------------------- wiring
  buildTree(); renderSpecs(); renderInspector();
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tool === 'dims') setDims(!dimsOn); else setTool(b.dataset.tool);
  }));
  document.querySelectorAll('[data-shade]').forEach((b) => b.addEventListener('click', () => setShading(b.dataset.shade)));
  $('fitBtn').addEventListener('click', () => (sel.length ? frame() : flyTo([4.4, 2.6, -5.0], [0, 0.45, 0], 1.1, { fov: 32 })));
  document.querySelectorAll('#secAxis button').forEach((b) => b.addEventListener('click', () => setAxis(b.dataset.axis)));
  $('secPos').addEventListener('input', updatePlane);
  $('secFlip').addEventListener('click', () => { secFlip = !secFlip; updatePlane(); });
  $('secOff').addEventListener('click', () => { setSection(false); setTool('select'); });
  $('measureClear').addEventListener('click', clearMeasures);
  setAxis('x');

  const api = {
    get active() { return active; },
    enter() {
      active = true;
      setTool(tool);
      if (secOn) setSection(true);
      if (dimsOn) setDims(true);
      setShading(shading);
      mGroup.visible = true; for (const m of measures) m.el.style.display = '';
    },
    exit() {
      active = false;
      setShading('shaded');
      select([]);
      showAll();
      planeViz.visible = false;
      const keep = secOn; secOn = false; applyClipping(); secOn = keep;
      dimGroup.visible = false; for (const d of dimLabels) d.el.style.display = 'none';
      mGroup.visible = false; for (const m of measures) m.el.style.display = 'none';
      canvas.style.cursor = '';
    },
    /** Click in the viewport (already filtered for drags). Returns true when consumed. */
    onClick(e) {
      if (!active) return false;
      const h = hit(e);
      if (tool === 'measure') { if (h) addPoint(h.point); return true; }
      if (!h) { select([]); return true; }
      const it = meshToItem.get(h.object);
      if (it) select(e.shiftKey ? [...new Set([...sel, it])] : [it], it.name);
      return true;
    },
    onDblClick(e) { if (!active) return false; const h = hit(e); if (h) { const it = meshToItem.get(h.object); if (it) { select([it], it.name); frame(); } } return true; },
    onKey(e) {
      if (!active) return false;
      const k = e.key.toLowerCase();
      if (k === 'escape') { select([]); pending = null; return true; }
      if (k === 'v') { setTool('select'); return true; }
      if (k === 'g') { setTool('measure'); return true; }
      if (k === 'c') { if (secOn && tool === 'section') { setSection(false); setTool('select'); } else setTool('section'); return true; }
      if (k === 'd') { setDims(!dimsOn); return true; }
      if (k === 'f') { if (sel.length) frame(); else flyTo([4.4, 2.6, -5.0], [0, 0.45, 0], 1.1, { fov: 32 }); return true; }
      if (k === 'h') { if (e.shiftKey) showAll(); else if (sel.length) { setVisible(sel, false); select([]); } return true; }
      if (k === 'i') { isolate(); return true; }
      if (k === 'x') { setShading(shading === 'xray' ? 'shaded' : 'xray'); return true; }
      return false;
    },
    update() {
      if (!active) return;
      if (sel.length && boxHelper.visible) { boxHelper.box.copy(selBox()); }
      const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3();
      const place = (el, p) => {
        v.copy(p).project(camera);
        const vis = v.z < 1 && v.z > -1;
        el.style.visibility = vis ? 'visible' : 'hidden';
        el.style.left = `${(v.x * 0.5 + 0.5) * w}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      };
      for (const m of measures) place(m.el, m.mid);
      if (dimsOn) for (const d of dimLabels) place(d.el, d.p);
    },
    setShading, setTool, setDims, select, assembly,
    get shading() { return shading; },
    sectionAt(axis, v) { setAxis(axis); $('secPos').value = v; setSection(true); updatePlane(); },
  };
  return api;
}
