// Screenshots of the full app UI (QA mode with UI visible) for each workspace state.
// Usage: STEPS=showroom,engineering,eng-zebra,eng-flow,eng-section,drive,drive-go,drive-chase,drive-cockpit,drive-tv node tools/dev/ui-shots.mjs [outDir]
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module'; import { execSync } from 'child_process';
let chromium; try { ({ chromium } = await import('playwright')); } catch { const g = execSync('npm root -g').toString().trim(); ({ chromium } = createRequire(g + '/')('playwright')); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), out = process.argv[2] || 'qa/tmp/ui';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const W = +(process.env.W || 1440), H = +(process.env.H || 860);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?qa=1&ui=1&quality=${process.env.Q || 'balanced'}&${process.env.EXTRA || ''}`);
await page.waitForFunction(() => window.__qa?.ready || window.__qaError, null, { timeout: 240000 });

const steps = (process.env.STEPS || 'showroom').split(',');
for (const st of steps) {
  const t0 = Date.now();
  await page.evaluate(async (st) => {
    const q = window.__qa;
    if (st === 'showroom') { await q.setWorkspace('showroom'); }
    else if (st === 'engineering') { await q.setWorkspace('engineering'); q.step(1.5); }
    else if (st === 'eng-zebra') { q.eng.setShading('zebra'); }
    else if (st === 'eng-flow') { q.eng.setShading('flow'); q.eng.setDims(true); }
    else if (st === 'eng-section') { q.eng.setShading('shaded'); q.eng.setDims(false); q.eng.sectionAt('z', -0.25); q.eng.select(q.eng.assembly.find(a => a.name === 'Powertrain')?.items.slice(0, 1) || [], 'Powertrain'); }
    else if (st === 'eng-measure') {
      q.eng.setShading('shaded'); q.eng.setTool('measure');
      const r = q.renderer.domElement.getBoundingClientRect();
      const at = (fx, fy) => q.eng.onClick({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, shiftKey: false });
      at(0.42, 0.62); at(0.66, 0.52);
      window.__measure = document.getElementById('measureOut').textContent;
    }
    else if (st === 'drive') { await q.setWorkspace('drive'); }
    else if (st === 'drive-go') { await q.setWorkspace('drive'); document.getElementById('driveGo').click(); q.drive.qaRun(5, 'auto', 20, 0); }
    else if (st === 'drive-cockpit') { q.drive.setCam('cockpit'); q.drive.qaRun(3, 'auto', 560, 30); }
    else if (st === 'drive-tv') { q.drive.setCam('tv'); q.drive.qaRun(3, 'auto', 1500, 30); }
    else if (st === 'drive-chase') { q.drive.setCam('chase'); q.drive.qaRun(6, 'auto', 900, 30); document.getElementById('telemetry').hidden = false; }
    if (!st.startsWith('drive-')) q.step(+(window.__stepSec || 2)); else q.step(0.05); q.render();
  }, st);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${st}.png`, timeout: 120000 });
  console.log('shot', st, Date.now() - t0, 'ms', await page.evaluate(() => window.__measure || ''));
}
console.log(errors.length ? 'CONSOLE:\n' + [...new Set(errors)].slice(0, 20).join('\n') : 'no console errors/warnings');
await browser.close(); server.close();
