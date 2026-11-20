// Navigation grid for bots: a 1 m grid over the whole city built once from the map's
// solid boxes. Bots use A* on it to walk through doors and around buildings instead of
// pushing into walls. Build pieces are not in the grid (they come and go); bots handle
// those with their local unstick logic.
import { PLAYER, MAP_HALF } from '../shared/constants.js';
import { vehicleSpawns, vehicleBoxes, VEHICLE_TYPES } from '../shared/vehicles.js';

const N = MAP_HALF * 2;          // cells per side (1 m cells)
const STEP = PLAYER.stepUp + 0.05;
const SQ2 = Math.SQRT2;

export function buildNav(map) {
  const size = N * N;
  const floor = new Float32Array(size);
  const flags = new Uint8Array(size); // 1 = blocked, 2 = roof overhead
  const idx = (ix, iz) => iz * N + ix;
  const cellRange = (lo, hi) => [Math.max(0, Math.ceil(lo + MAP_HALF - 0.5)), Math.min(N - 1, Math.floor(hi + MAP_HALF - 0.5))];

  // 1) floor height = top of ground-standing boxes under each cell centre
  for (const b of map.boxes) {
    if (b.min[1] > 0.5 || b.ramp) continue;
    const [x0, x1] = cellRange(b.min[0], b.max[0]);
    const [z0, z1] = cellRange(b.min[2], b.max[2]);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = idx(ix, iz);
      if (b.max[1] > floor[i]) floor[i] = b.max[1];
    }
  }
  // 2) blocked = something solid at body height above that floor (player radius included)
  const r = PLAYER.radius + 0.05;
  // parked vehicles start at fixed spots: path around them (once driven away, bots' unstick
  // logic handles wherever they end up)
  const parked = vehicleSpawns(map, 'normal').flatMap((v) => vehicleBoxes({ ...v, y: 0 }, VEHICLE_TYPES[v.type]));
  for (const b of map.boxes.concat(parked)) {
    if (b.ramp) continue;
    const [x0, x1] = cellRange(b.min[0] - r, b.max[0] + r);
    const [z0, z1] = cellRange(b.min[2] - r, b.max[2] + r);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = idx(ix, iz), f = floor[i];
      if (b.max[1] > f + STEP && b.min[1] < f + PLAYER.height) flags[i] |= 1;
      else if (b.min[1] >= f + PLAYER.height) flags[i] |= 2;
    }
  }
  // map border
  for (let k = 0; k < N; k++) { flags[idx(k, 0)] |= 1; flags[idx(k, N - 1)] |= 1; flags[idx(0, k)] |= 1; flags[idx(N - 1, k)] |= 1; }

  // 3) connected areas you can walk both ways between (stairs ok, cliffs one-way)
  const comp = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let nComp = 0;
  const compSize = [];
  for (let s = 0; s < size; s++) {
    if (comp[s] >= 0 || flags[s] & 1) continue;
    let qh = 0, qt = 0;
    queue[qt++] = s; comp[s] = nComp;
    while (qh < qt) {
      const c = queue[qh++], cx = c % N, cz = (c / N) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = idx(nx, nz);
        if (comp[n] >= 0 || flags[n] & 1 || Math.abs(floor[n] - floor[c]) > STEP) continue;
        comp[n] = nComp; queue[qt++] = n;
      }
    }
    compSize.push(qt);
    nComp++;
  }
  let main = 0;
  for (let k = 1; k < nComp; k++) if (compSize[k] > compSize[main]) main = k;

  // tree canopies (bots can't see through leaves either)
  const TC = 8, trees = new Map();
  for (const t of map.trees || []) {
    const key = Math.floor(t.x / TC) * 4096 + Math.floor(t.z / TC);
    if (!trees.has(key)) trees.set(key, []);
    trees.get(key).push({ x: t.x, z: t.z, r2: (t.r * 0.75) ** 2, y0: t.h * 0.35, y1: t.h * 0.95 });
  }

  const nav = { N, floor, flags, comp, main, compSize };
  const cellOf = (x, z) => {
    const ix = Math.max(0, Math.min(N - 1, Math.floor(x + MAP_HALF)));
    const iz = Math.max(0, Math.min(N - 1, Math.floor(z + MAP_HALF)));
    return iz * N + ix;
  };
  nav.cellOf = cellOf;
  nav.center = (c) => [(c % N) - MAP_HALF + 0.5, ((c / N) | 0) - MAP_HALF + 0.5];
  nav.free = (c) => !(flags[c] & 1);
  nav.floorAt = (x, z) => floor[cellOf(x, z)];
  nav.roofed = (x, z) => !!(flags[cellOf(x, z)] & 2);

  // nearest free cell within `rad` cells (prefers same height)
  nav.nearFree = (x, z, rad = 2, y = null) => {
    const c0 = cellOf(x, z);
    if (!(flags[c0] & 1) && (y === null || Math.abs(floor[c0] - y) < 1.2)) return c0;
    const cx = c0 % N, cz = (c0 / N) | 0;
    let best = -1, bd = 1e9;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nz * N + nx;
      if (flags[n] & 1) continue;
      if (y !== null && Math.abs(floor[n] - y) > 1.2) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  // Can someone on the main walkable area reach a spot at (x, y, z)?
  nav.reachable = (x, y, z) => {
    const c = nav.nearFree(x, z, 3, y);
    return c >= 0 && comp[c] === main;
  };

  // Does a line pass through a tree canopy? (checked from 6 m out)
  nav.canopyBlocks = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dz);
    if (L < 8) return false;
    const n = Math.ceil(L / 2);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (k * L < 6 || (1 - k) * L < 4) continue;
      const x = ax + dx * k, y = ay + dy * k, z = az + dz * k;
      const list = trees.get(Math.floor(x / TC) * 4096 + Math.floor(z / TC));
      if (!list) continue;
      for (const t of list) {
        if (y > t.y0 && y < t.y1 && (x - t.x) ** 2 + (z - t.z) ** 2 < t.r2) return true;
      }
    }
    return false;
  };

  // Straight walk test on the grid (used to smooth paths).
  nav.clearLine = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(L / 0.5);
    let prev = cellOf(ax, az);
    for (let i = 1; i <= n; i++) {
      const c = cellOf(ax + (bx - ax) * i / n, az + (bz - az) * i / n);
      if (c === prev) continue;
      if (flags[c] & 1 || floor[c] - floor[prev] > STEP) return false;
      prev = c;
    }
    return true;
  };

  // ---- A* ----
  const g = new Float32Array(size);
  const seen = new Uint32Array(size);
  const from = new Int32Array(size);
  const closed = new Uint32Array(size);
  let stamp = 0;
  const heap = []; // [f, cell] pairs flattened
  const push = (f, c) => {
    heap.push(f, c);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p * 2] <= heap[i * 2]) break;
      const tf = heap[p * 2], tc = heap[p * 2 + 1];
      heap[p * 2] = heap[i * 2]; heap[p * 2 + 1] = heap[i * 2 + 1];
      heap[i * 2] = tf; heap[i * 2 + 1] = tc;
      i = p;
    }
  };
  const pop = () => {
    const c = heap[1];
    const lc = heap.pop(), lf = heap.pop(); // last pair: [f, cell]
    if (heap.length) {
      heap[0] = lf; heap[1] = lc;
      let i = 0;
      const n = heap.length / 2;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && heap[l * 2] < heap[m * 2]) m = l;
        if (r < n && heap[r * 2] < heap[m * 2]) m = r;
        if (m === i) break;
        const tf = heap[m * 2], tc = heap[m * 2 + 1];
        heap[m * 2] = heap[i * 2]; heap[m * 2 + 1] = heap[i * 2 + 1];
        heap[i * 2] = tf; heap[i * 2 + 1] = tc;
        i = m;
      }
    }
    return c;
  };
  nav.stats = { searches: 0, expanded: 0 };

  // Returns a list of [x, z] waypoints (smoothed) or null. Partial paths are returned
  // when the budget runs out (toward the node closest to the goal).
  nav.findPath = (sx, sz, tx, tz, budget = 5000, sy = null) => {
    const s = nav.nearFree(sx, sz, 2, sy);
    let goal = nav.nearFree(tx, tz, 3), moved = false;
    if (s < 0 || goal < 0) return null;
    // A goal in another walk area (on top of a box, inside a closed shell) would burn the
    // whole budget: aim for the nearest cell of our own area next to it instead.
    if (comp[goal] !== comp[s] && comp[s] === main) {
      const gx0 = goal % N, gz0 = (goal / N) | 0;
      let alt = -1, bd = 1e9;
      for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
        const nx = gx0 + dx, nz = gz0 + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = nz * N + nx, d = dx * dx + dz * dz;
        if (d < bd && comp[n] === main && !(flags[n] & 1)) { bd = d; alt = n; }
      }
      if (alt < 0) return null;
      goal = alt; moved = true;
    }
    nav.stats.searches++;
    if (++stamp >= 0xffffffff) { stamp = 1; seen.fill(0); closed.fill(0); }
    heap.length = 0;
    const gx = goal % N, gz = (goal / N) | 0;
    const h = (c) => {
      const dx = Math.abs((c % N) - gx), dz = Math.abs(((c / N) | 0) - gz);
      return (dx > dz ? dx + 0.414 * dz : dz + 0.414 * dx) * 1.25;
    };
    seen[s] = stamp; g[s] = 0; from[s] = -1;
    push(h(s), s);
    let best = s, bestH = h(s), expanded = 0;
    while (heap.length) {
      const c = pop();
      if (closed[c] === stamp) continue;
      closed[c] = stamp;
      if (c === goal) { best = c; break; }
      const hc = h(c);
      if (hc < bestH) { bestH = hc; best = c; }
      if (++expanded > budget) break;
      const cx = c % N, cz = (c / N) | 0, fc = floor[c];
      for (let k = 0; k < 8; k++) {
        const dx = k < 3 ? -1 : k < 5 ? 0 : 1;
        const dz = k === 0 || k === 3 || k === 5 ? -1 : k === 1 || k === 6 ? 0 : 1;
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = nz * N + nx;
        if (flags[n] & 1 || floor[n] - fc > STEP || closed[n] === stamp) continue;
        if (dx && dz) { // no corner cutting
          const a = cz * N + nx, b = nz * N + cx;
          if (flags[a] & 1 || flags[b] & 1 || floor[a] - fc > STEP || floor[b] - fc > STEP) continue;
        }
        const ng = g[c] + (dx && dz ? SQ2 : 1) + (floor[n] < fc - STEP ? 2 : 0);
        if (seen[n] === stamp && ng >= g[n]) continue;
        seen[n] = stamp; g[n] = ng; from[n] = c;
        push(ng + h(n), n);
      }
    }
    nav.stats.expanded += expanded;
    // walk back
    const cells = [];
    for (let c = best; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    if (cells.length < 2 && best !== goal) return null;
    // smooth: keep the furthest waypoint we can walk to in a straight line
    const pts = cells.map((c) => nav.center(c));
    if (best === goal && !moved) pts.push([tx, tz]);
    const out = [];
    let i = 0, cur = [sx, sz];
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 24);
      while (j > i + 1 && !nav.clearLine(cur[0], cur[1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); cur = pts[j]; i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    out.complete = best === goal;
    return out;
  };

  // Nearest walkable cell out from under a roof (bots stuck on rooftops above loot).
  nav.offRoof = (x, z, rad = 14) => {
    const c0 = cellOf(x, z), cx = c0 % N, cz = (c0 / N) | 0;
    let best = null, bd = 1e9;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      const d = dx * dx + dz * dz;
      if (d >= bd) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
      const n = nz * N + nx;
      if (flags[n] & 3 || comp[n] !== main) continue;
      bd = d; best = nav.center(n);
    }
    return best;
  };
  return nav;
}
