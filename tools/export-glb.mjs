// Build the car in headless Chromium and export models/ferrari-f-future.glb
// Usage: node tools/export-glb.mjs [out.glb]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execSync } from 'child_process';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || path.join(root, 'models', 'ferrari-f-future.glb');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?qa=1&w=640&h=400&quality=low`);
await page.waitForFunction(() => (window.__qa && window.__qa.ready) || window.__qaError, null, { timeout: 180000 });
const b64 = await page.evaluate(() => window.__qa.exportGLB());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
await browser.close();
server.close();
