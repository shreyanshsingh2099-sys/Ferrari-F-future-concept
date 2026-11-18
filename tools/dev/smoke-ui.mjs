// UI smoke test: loads the app normally (live render loop), exercises every workspace and the main
// controls, and reports console errors. Usage: node tools/dev/smoke-ui.mjs   (Q=low|balanced|high)
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; import { execSync } from 'child_process';
let chromium; try { ({ chromium } = await import('playwright')); } catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?quality=${process.env.Q || 'low'}`);
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('done') || window.__qaError, null, { timeout: 240000 });
const click = async (sel, wait = 350) => { await page.click(sel, { timeout: 60000 }); await page.waitForTimeout(wait); };
const report = {};
// ---- showroom ----
for (const sel of ['[data-toggle="doorL"]', '[data-toggle="doorR"]', '[data-toggle="hood"]', '[data-toggle="engineCover"]', '[data-toggle="wing"]', '[data-toggle="lights"]', '[data-toggle="labels"]', '[data-toggle="autorotate"]', '[data-view="front"]', '[data-view="top"]', '#modes [data-mode="interior"]', '#modes [data-mode="engine"]', '#modes [data-mode="exterior"]', '[data-set="daylight"]', '[data-set="blueprint"]', '[data-set="showroom"]', '#resetCam']) await click(sel);
for (const sel of ['[data-fun="engine"]', '[data-fun="rolling"]', '[data-fun="wind"]', '[data-fun="explode"]', '[data-fun="explode"]', '#paints button:nth-child(3)', '#paints button:nth-child(1)']) await click(sel, 500);
await page.keyboard.down(' '); await page.waitForTimeout(900); await page.keyboard.up(' ');
for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
await page.waitForTimeout(300);
for (const k of ['v', '1', '2']) await page.keyboard.press(k);
await page.waitForTimeout(500);
report.showroom = await page.evaluate(() => {
  const q = window.__qa, out = {};
  for (const o of q.car.fun.eggs) { const before = q.fun.secrets().size; const knocks = o.userData.egg === 'motto' ? 5 : 1; for (let i = 0; i < knocks; i++) q.fun.onEgg(o); out[o.userData.egg] = q.fun.secrets().size - before; }
  return { eggs: out, secrets: document.getElementById('secretCount').textContent, paint: q.fun.state.paint, rpm: Math.round(q.fun.state.rpm), audio: q.sound.ctx ? q.sound.ctx.state : 'none', worklet: !!q.sound.node };
});
await click('[data-fun="engine"]', 300);
// ---- engineering ----
await click('#workspaces [data-ws="engineering"]', 1500);
for (const sel of ['[data-shade="clay"]', '[data-shade="zebra"]', '[data-shade="wire"]', '[data-shade="xray"]', '[data-shade="flow"]', '[data-shade="shaded"]', '[data-tool="dims"]', '[data-tool="section"]', '#secAxis [data-axis="z"]', '#secFlip', '#secOff', '[data-tool="measure"]']) await click(sel, 400);
const box = await page.locator('#stage').boundingBox();
await page.mouse.click(box.x + box.width * 0.48, box.y + box.height * 0.55); await page.waitForTimeout(400);
await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.5); await page.waitForTimeout(400);
await click('[data-tool="select"]');
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.52); await page.waitForTimeout(500);
await page.locator('#treeBody .node').first().click(); await page.waitForTimeout(400);
report.engineering = await page.evaluate(() => ({ measure: document.getElementById('measureOut').textContent.slice(0, 40), selection: document.querySelector('#insPart h2 .aside')?.textContent || '', clipping: window.__qa.renderer.localClippingEnabled, tree: document.querySelectorAll('#treeBody .leaf').length }));
// ---- drive ----
await click('#workspaces [data-ws="drive"]', 2500);
await click('#driveGo', 2200);
await page.keyboard.down('w'); await page.waitForTimeout(2500); await page.keyboard.down('d'); await page.waitForTimeout(600); await page.keyboard.up('d'); await page.keyboard.up('w');
for (const k of ['c', 'c', 'c', 'c', 't', 'g']) { await page.keyboard.press(k); await page.waitForTimeout(250); }
await click('#setupToggle', 300);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
report.drive = await page.evaluate(() => { const v = window.__qa.drive.vehicle; return { kmh: v.kmh.toFixed(1), gear: v.gear, mode: v.mode, hudSpeed: document.getElementById('hudSpeed').textContent, paused: !document.getElementById('driveIntro').classList.contains('gone') }; });
await click('#workspaces [data-ws="showroom"]', 1500);
report.back = await page.evaluate(() => ({ ws: document.body.dataset.ws, carAt: window.__qa.car.root.position.toArray().map((v) => +v.toFixed(2)) }));
console.log(JSON.stringify(report, null, 1));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
await browser.close(); server.close();
