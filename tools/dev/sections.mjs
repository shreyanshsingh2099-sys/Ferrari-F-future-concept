// Print / plot body cross-sections (top surface y(z)) at given x stations, to judge crest sharpness.
import { surfaceY, surfaceZ } from '../../src/car/bodyShape.js';
import fs from 'fs';
const xs = (process.argv[2] || '2.2,2.0,1.8,1.6,1.4').split(',').map(Number);
const out = {};
for (const x of xs) {
  const pts = [];
  for (let z = 0; z <= 1.0; z += 0.01) { const y = surfaceY(x, z); if (y != null) pts.push([+z.toFixed(2), +y.toFixed(4)]); }
  // side wall below the last top point
  for (let y = 0.7; y >= 0.15; y -= 0.01) { const z = surfaceZ(x, y); if (z != null) pts.push([+z.toFixed(4), +y.toFixed(2)]); }
  out[x] = pts;
}
fs.writeFileSync(process.argv[3] || '/dev/stdout', JSON.stringify(out));
