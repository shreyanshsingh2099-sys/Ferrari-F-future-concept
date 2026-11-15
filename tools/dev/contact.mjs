// Render a set of named camera shots in ONE page load (fast audit / contact sheet).
// Usage: node tools/dev/contact.mjs out_dir [extra query]   (W,H env for size)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; import { execSync } from 'child_process';
let chromium; try { ({ chromium } = await import('playwright')); } catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = process.argv[2] || 'qa/tmp/audit'; const extra = process.argv[3] || 'quality=high';
const W = +(process.env.W || 1100), H = +(process.env.H || 620);
fs.mkdirSync(out, { recursive: true });
const SHOTS = JSON.parse(process.env.SHOTS || 'null') || {
  front34: { cam: [4.6, 1.5, -3.4], target: [0.3, 0.5, 0], fov: 30 },
  side: { cam: [0.1, 0.9, -7.4], target: [0.1, 0.55, 0], fov: 28 },
  rear34: { cam: [-4.9, 1.6, -3.6], target: [-0.3, 0.55, 0], fov: 30 },
  rear: { cam: [-6.6, 1.0, 0.0], target: [0, 0.55, 0], fov: 26 },
  front: { cam: [6.8, 0.9, 0.0], target: [0, 0.55, 0], fov: 26 },
  top: { cam: [0.1, 8.6, 0.001], target: [0.1, 0, 0], fov: 32 },
  wheel: { cam: [1.75, 0.5, -2.6], target: [1.35, 0.34, -0.9], fov: 26 },
  rearclose: { cam: [-3.6, 1.15, -1.7], target: [-1.7, 0.6, 0], fov: 32 },
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`http://localhost:${server.address().port}/index.html?qa=1&w=${W}&h=${H}&${extra}`);
await page.waitForFunction(() => (window.__qa && window.__qa.ready) || window.__qaError, null, { timeout: 240000 });
const err = await page.evaluate(() => window.__qaError); if (err) { console.log('BUILD ERROR', err); process.exit(1); }
for (const [name, s] of Object.entries(SHOTS)) {
  await page.evaluate((s) => { const q = window.__qa; if (s.mode) { q.setMode(s.mode); q.step(4); q.render(); return; } for (const k of ['doorL', 'doorR', 'hood', 'engineCover', 'wing']) q.car.set(k, (s.open || []).includes(k), true); q.flyTo(s.cam, s.target, 0, { fov: s.fov || 30 }); q.step(0.2); q.render(); }, s);
  await page.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });
  console.log('shot', name);
}
console.log(JSON.stringify(await page.evaluate(() => window.__qa.car.stats)));
await browser.close(); server.close();
