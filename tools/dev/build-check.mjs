// Node-side smoke test of the full car build (no textures/DOM): timings + stats.
import { buildCar } from '../../src/car/car.js';
const t0 = performance.now();
const car = await buildCar({ onProgress: (p, l) => console.log((performance.now() - t0).toFixed(0).padStart(6), 'ms', l) });
console.log('total', (performance.now() - t0).toFixed(0), 'ms', car.stats);
