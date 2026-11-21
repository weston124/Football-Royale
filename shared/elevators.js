// Elevators (Mega Dome): moving platforms whose height is a pure function of the server
// clock, so the server, every browser and the tests always agree where a cab is.
//
// An elevator is a square shaft (`x0..x1, z0..z1` = the inside of the shaft) that serves
// `stops` (floor heights, lowest first). The cab runs up and down through every stop on a
// fixed cycle: wait at a stop, glide to the next one (eased), wait, ... and back down.
//
// Collision (used by shared/physics.js through World.elevators + World.time):
//  - the cab is a solid COLUMN from below ground up to the cab floor, so nobody can ever be
//    underneath it (no crushing): if you stand in the shaft you are always standing on it,
//    and it carries you up and down. Only players whose centre is over it ride it.
//  - each stop has a DOOR box in the shaft's doorway that is closed whenever the cab is not
//    resting at that stop, so nobody walks into the empty shaft (and falls) or under the cab.
//    Doors closing on someone don't trap them: stepPlayer ignores boxes you already overlap.
export const ELEVATOR = {
  wait: 4,        // seconds the cab rests at each stop
  speed: 2.2,     // average travel speed (m/s); eased, so the peak is ~3.5 m/s
  door: 2.2,      // doorway width
  doorH: 2.7,     // doorway height
  wall: 0.25,     // shaft wall thickness
};

// The cab's travel plan: [{ t0, t1, y0, y1 }] segments over one period (waits have y0 === y1).
function plan(e) {
  if (e._plan) return e._plan;
  const s = e.stops, order = s.slice();
  for (let i = s.length - 2; i > 0; i--) order.push(s[i]); // up through every stop, then back down
  const segs = [];
  let t = 0;
  for (let i = 0; i < order.length; i++) {
    const a = order[i], b = order[(i + 1) % order.length];
    segs.push({ t0: t, t1: t + ELEVATOR.wait, y0: a, y1: a }); t += ELEVATOR.wait;
    const travel = Math.abs(b - a) / ELEVATOR.speed;
    segs.push({ t0: t, t1: t + travel, y0: a, y1: b }); t += travel;
  }
  e._plan = { segs, period: t };
  return e._plan;
}

export const elevatorPeriod = (e) => plan(e).period;

// Cab floor height at server time t (seconds).
export function elevatorHeight(e, t) {
  const { segs, period } = plan(e);
  let u = ((t + (e.phase || 0)) % period + period) % period;
  for (const s of segs) {
    if (u <= s.t1) {
      if (s.y0 === s.y1) return s.y0;
      const k = (u - s.t0) / (s.t1 - s.t0);
      return s.y0 + (s.y1 - s.y0) * (1 - Math.cos(Math.PI * k)) / 2;
    }
  }
  return segs[0].y0;
}

// Index of the stop the cab is resting at, or -1 while it moves.
export function elevatorStop(e, t) {
  const y = elevatorHeight(e, t);
  return e.stops.findIndex((s) => Math.abs(s - y) < 0.01);
}

// Door rectangle for stop i (in the shaft wall on side e.door: 0 -z, 1 +z, 2 -x, 3 +x).
export function doorRect(e, i) {
  const { door, doorH, wall } = ELEVATOR;
  const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2, y = e.stops[i];
  const h = door / 2;
  switch (e.door) {
    case 0: return { min: [cx - h, y, e.z0 - wall], max: [cx + h, y + doorH, e.z0] };
    case 1: return { min: [cx - h, y, e.z1], max: [cx + h, y + doorH, e.z1 + wall] };
    case 2: return { min: [e.x0 - wall, y, cz - h], max: [e.x0, y + doorH, cz + h] };
    default: return { min: [e.x1, y, cz - h], max: [e.x1 + wall, y + doorH, cz + h] };
  }
}

// Solid boxes of an elevator at time t: the cab column (lift: true) and closed doors.
export function elevatorBoxes(e, t, out = []) {
  const y = elevatorHeight(e, t);
  out.push({ min: [e.x0, -1, e.z0], max: [e.x1, y, e.z1], lift: true, elevator: e });
  for (let i = 0; i < e.stops.length; i++) {
    if (Math.abs(e.stops[i] - y) < 0.01) continue; // cab is here: door open
    const r = doorRect(e, i);
    out.push({ min: r.min, max: r.max, door: true, elevator: e });
  }
  return out;
}

// The static shaft walls (map boxes) with a doorway at every stop. `top` = height of the walls.
export function shaftWalls(e, top) {
  const { wall: w, door, doorH } = ELEVATOR;
  const out = [];
  const B = (x0, y0, z0, x1, y1, z1) => out.push({ min: [x0, y0, z0], max: [x1, y1, z1] });
  const X0 = e.x0 - w, X1 = e.x1 + w, Z0 = e.z0 - w, Z1 = e.z1 + w;
  const sides = [
    [0, () => [X0, Z0, X1, e.z0]], [1, () => [X0, e.z1, X1, Z1]],
    [2, () => [X0, e.z0, e.x0, e.z1]], [3, () => [e.x1, e.z0, X1, e.z1]],
  ];
  for (const [side, rect] of sides) {
    const [a0, b0, a1, b1] = rect();
    if (side !== e.door) { B(a0, 0, b0, a1, top, b1); continue; }
    // doorway side: solid on both sides of the door, and between/above the doorways
    const along = side < 2 ? 0 : 2; // axis the wall runs along
    const c = along === 0 ? (e.x0 + e.x1) / 2 : (e.z0 + e.z1) / 2, h = door / 2;
    const lo = along === 0 ? a0 : b0, hi = along === 0 ? a1 : b1;
    const seg = (s0, s1, y0, y1) => (along === 0 ? B(s0, y0, b0, s1, y1, b1) : B(a0, y0, s0, a1, y1, s1));
    seg(lo, c - h, 0, top); seg(c + h, hi, 0, top);
    let y = 0;
    for (const s of e.stops) { if (s > y) seg(c - h, c + h, y, s); y = s + doorH; }
    if (top > y) seg(c - h, c + h, y, top);
  }
  return out;
}
