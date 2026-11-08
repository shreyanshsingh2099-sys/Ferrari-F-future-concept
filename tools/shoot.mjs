// Render QA screenshots of the viewer with headless Chromium (SwiftShader WebGL).
// Usage: node tools/shoot.mjs out_dir view1,view2 [extra query]   (views: hero, side, front, ... or ortho:side)
import { createRequire } from 'module';
import { execSync } from 'child_process';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.argv[2] || 'qa/tmp';
const views = (process.argv[3] || 'hero').split(',');
const extra = process.argv[4] || '';
const W = +(process.env.W || 1376), H = +(process.env.H || 768);
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error' || process.env.VERBOSE) console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const v of views) {
  const [kind, name] = v.includes(':') ? v.split(':') : ['view', v];
  const q = kind === 'ortho' ? `ortho=${name}` : kind === 'mode' ? `mode=${name}` : `view=${name}`;
  const url = `http://localhost:${port}/index.html?qa=1&w=${W}&h=${H}&${q}&${extra}`;
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__qa && window.__qa.ready, null, { timeout: 180000 });
  await page.evaluate(() => { window.__qa.step(4); window.__qa.render(); });
  const file = path.join(outDir, `${v.replace(':', '_')}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  const stats = await page.evaluate(() => window.__qa.car.stats);
  console.log('shot', file, (Date.now() - t0) + 'ms', JSON.stringify(stats));
}
await browser.close();
server.close();
