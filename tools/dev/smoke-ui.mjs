// UI smoke test: loads the viewer normally, presses every control, reports console errors.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; import { execSync } from 'child_process';
let chromium; try { ({ chromium } = await import('playwright')); } catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?quality=${process.env.Q || "low"}`);
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('done') || window.__qaError, null, { timeout: 180000 });
const clicks = ['[data-toggle="doorL"]', '[data-toggle="doorR"]', '[data-toggle="hood"]', '[data-toggle="engineCover"]', '[data-toggle="wing"]', '[data-toggle="lights"]', '[data-toggle="labels"]', '[data-toggle="xray"]', '[data-toggle="autorotate"]', '[data-view="front"]', '[data-view="top"]', '#modes [data-mode="interior"]', '#modes [data-mode="engine"]', '#modes [data-mode="engineering"]', '#modes [data-mode="exterior"]', '[data-toggle="theme"]', '#resetCam'];
for (const sel of clicks) { await page.click(sel); await page.waitForTimeout(600); }
const state = await page.evaluate(() => ({ doorL: document.querySelector('[data-toggle="doorL"]').className, title: document.getElementById('modeSubtitle').textContent }));
await page.mouse.click(500, 330); await page.waitForTimeout(500);
console.log('state', JSON.stringify(state));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close(); server.close();
