// Offline render of the V12 engine model in headless Chromium (OfflineAudioContext + AudioWorklet).
// Writes a stereo WAV of a scripted run (start, idle, rev to the limiter, overrun, cabin view,
// shut-down) and prints per-segment level and spectral statistics.
//   node tools/dev/engine-audio.mjs [out.wav]
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; import { execSync } from 'child_process';
let chromium; try { ({ chromium } = await import('playwright')); } catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = process.argv[2] || path.join(root, 'build/engine_demo.wav');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const PAGE = `<!doctype html><meta charset=utf-8><script type=module>
import { EngineAudio, starterRPM } from '/src/viewer/audio/engine.js';
window.run = async () => {
  const sr = 48000, T = 12.5;
  const ctx = new OfflineAudioContext(2, sr * T, sr);
  const a = new EngineAudio({ context: ctx });
  await a.loading;
  a.setVolume(0.8); a.setLimiter(9000);
  if (window.RAW) { a.node.disconnect(); a.node.connect(ctx.destination); }
  const ev = (t, f) => f(t);
  const lerp = (a, b, u) => a + (b - a) * Math.min(1, Math.max(0, u));
  let rpm = 0;
  a.startEngine(0.3);
  for (let t = 0; t < T; t += 1 / 120) {
    let thr = 0.08, cabin = t > 8.5 && t < 10.5 ? 1 : 0;
    if (t < 2.0) rpm = starterRPM(t - 0.3);
    else if (t < 3.5) rpm = 950 + 30 * Math.sin(t * 3);
    else if (t < 5.0) { thr = 1; rpm = lerp(950, 9150, Math.pow((t - 3.5) / 1.5, 0.8)); }
    else if (t < 5.6) { thr = 1; rpm = 9050 + 120 * Math.sin(t * 60); }
    else if (t < 7.5) { thr = 0; rpm = 950 + (9050 - 950) * Math.exp(-(t - 5.6) / 0.45); }
    else if (t < 8.5) { const u = (t - 7.5); thr = u < 0.25 ? 1 : 0; rpm = u < 0.25 ? lerp(950, 5200, u / 0.25) : 950 + 4250 * Math.exp(-(u - 0.25) / 0.3); }
    else if (t < 10.5) { const u = t - 8.5; thr = u < 1.1 ? 1 : 0; rpm = u < 1.1 ? lerp(950, 7600, u / 1.1) : 950 + 6650 * Math.exp(-(u - 1.1) / 0.35); }
    else rpm = Math.max(0, rpm - 1500 / 120);
    if (Math.abs(t - 10.5) < 1 / 240) a.stopEngine(t);
    a.setRPM(rpm, thr, t);
    a.setPerspective(cabin, t);
  }
  const buf = await ctx.startRendering();
  return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1)), sr];
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/__audio.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  const f = path.join(root, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/__audio.html`);
await page.waitForFunction(() => window.ready);
const t0 = Date.now();
if (process.env.RAW) await page.evaluate(() => { window.RAW = true; });
const [L, R, sr] = await page.evaluate(() => window.run());
console.log(`rendered ${(L.length / sr).toFixed(1)} s in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close(); server.close();

// ---- WAV ----
fs.mkdirSync(path.dirname(out), { recursive: true });
const n = L.length, wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
let nan = 0;
for (let i = 0; i < n; i++) {
  for (const [k, ch] of [[0, L], [1, R]]) { let v = ch[i]; if (!Number.isFinite(v)) { nan++; v = 0; } wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 4 + k * 2); }
}
fs.writeFileSync(out, wav);

// ---- stats ----
const fft = (re) => { const N = re.length, im = new Float64Array(N); for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } } for (let len = 2; len <= N; len <<= 1) { const a = (-2 * Math.PI) / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } } return [re, im]; };
const seg = (name, a, b) => {
  const i0 = Math.floor(a * sr), i1 = Math.floor(b * sr);
  let s2 = 0, pk = 0; for (let i = i0; i < i1; i++) { const v = (L[i] + R[i]) / 2; s2 += v * v; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rms = Math.sqrt(s2 / (i1 - i0));
  const N = 16384, mid = Math.floor((i0 + i1) / 2) - N / 2, re = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = ((L[mid + i] || 0) + (R[mid + i] || 0)) / 2 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const [x, y] = fft(re); let num = 0, den = 0, best = 0, bf = 0;
  for (let k = 1; k < N / 2; k++) { const m = Math.hypot(x[k], y[k]), f = (k * sr) / N; num += f * m; den += m; if (f > 40 && f < 2000 && m > best) { best = m; bf = f; } }
  const bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000].map((fc) => { let e = 0; for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; if (f >= fc / Math.SQRT2 && f < fc * Math.SQRT2) e += x[k] * x[k] + y[k] * y[k]; } return e; });
  const bmax = Math.max(...bands);
  console.log(`${name.padEnd(22)} bands ` + bands.map((e) => (10 * Math.log10(e / bmax + 1e-12)).toFixed(0).padStart(4)).join(''));
  console.log(`${name.padEnd(22)} rms ${(20 * Math.log10(rms + 1e-9)).toFixed(1).padStart(6)} dBFS  peak ${pk.toFixed(2)}  centroid ${(num / den).toFixed(0).padStart(5)} Hz  strongest ${bf.toFixed(0)} Hz`);
};
seg('cranking', 0.35, 0.9);
seg('idle 950', 2.2, 3.4);
seg('pull 3-7k', 4.2, 4.8);
seg('limiter 9000', 5.05, 5.55);
seg('overrun', 5.7, 6.4);
seg('blip', 7.5, 8.2);
seg('cabin pull', 9.0, 9.6);
seg('off', 11.8, 12.4);
console.log('non-finite samples:', nan, ' clipped:', L.filter((v) => Math.abs(v) >= 0.999).length);
console.log(errors.length ? 'console:\n' + errors.join('\n') : 'no console errors');
console.log('wrote', out);
