// Draws the Mega Dome (shared/megadome.js): glass, the vault roof, the giant arches, the
// center-hung video board, ribbon boards, seat backs, lights, signs and the elevators.
// Static parts are merged into a handful of meshes; the elevators are a few instanced meshes
// moved every frame from the server clock (shared/elevators.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOME, roofY, DOME_FOOT } from '/shared/megadome.js';
import { ELEVATOR, elevatorHeight, elevatorStop, doorRect } from '/shared/elevators.js';
import { rampHeight } from '/shared/physics.js';

const { HX, HZ, L1, L2 } = DOME;

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData = { canvas: c, g };
  return t;
}

// The Football Royale crown (our own logo: a three-point crown with a football on it).
export function drawCrown(g, cx, cy, s, gold = '#ffcc33', dark = '#7a4b00') {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.fillStyle = gold; g.strokeStyle = dark; g.lineWidth = 0.06; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-1, 0.55); g.lineTo(-1.1, -0.45); g.lineTo(-0.5, 0.05); g.lineTo(0, -0.75);
  g.lineTo(0.5, 0.05); g.lineTo(1.1, -0.45); g.lineTo(1, 0.55); g.closePath();
  g.fill(); g.stroke();
  for (const [x, y] of [[-1.1, -0.5], [0, -0.82], [1.1, -0.5]]) { g.beginPath(); g.arc(x, y, 0.14, 0, 7); g.fill(); g.stroke(); }
  g.fillStyle = '#8b4513'; g.beginPath(); g.ellipse(0, 0.28, 0.42, 0.22, 0, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 0.04; g.beginPath(); g.moveTo(-0.18, 0.28); g.lineTo(0.18, 0.28); g.stroke();
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 0.06, 0.22); g.lineTo(i * 0.06, 0.34); g.stroke(); }
  g.restore();
}

// ---- geometry helpers (everything static ends up in a few merged meshes) ----
function paint(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function boxGeo(x0, y0, z0, x1, y1, z1, color) {
  const g = new THREE.BoxGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return color == null ? g : paint(g, color);
}
// a quad p0..p3 (counter-clockwise seen from the front) with uv from (u,v) per corner
function quadGeo(p, uv, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return color == null ? g : paint(g, color);
}
function cyl(a, b, r, color, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
}
const merge = (list) => { const m = mergeGeometries(list); list.forEach((g) => g.dispose()); return m; };

// side -> how to place things on a ring band (o = offset out from the podium, a = along)
function ringRect(side, o0, o1, a0, a1) {
  if (side === 'S') return [a0, HZ + o0, a1, HZ + o1];
  if (side === 'N') return [a0, -(HZ + o1), a1, -(HZ + o0)];
  if (side === 'E') return [HX + o0, a0, HX + o1, a1];
  return [-(HX + o1), a0, -(HX + o0), a1];
}
// a vertical plane facing the field at offset o along a side (from a0 to a1), y0..y1
function facePlane(side, o, a0, a1, y0, y1, uRep = 1, color = 0xffffff) {
  let p;
  if (side === 'S') p = [[a1, y0, HZ + o], [a0, y0, HZ + o], [a0, y1, HZ + o], [a1, y1, HZ + o]];
  else if (side === 'N') p = [[a0, y0, -(HZ + o)], [a1, y0, -(HZ + o)], [a1, y1, -(HZ + o)], [a0, y1, -(HZ + o)]];
  else if (side === 'E') p = [[HX + o, y0, a0], [HX + o, y0, a1], [HX + o, y1, a1], [HX + o, y1, a0]];
  else p = [[-(HX + o), y0, a1], [-(HX + o), y0, a0], [-(HX + o), y1, a0], [-(HX + o), y1, a1]];
  return quadGeo(p, [[0, 0], [uRep, 0], [uRep, 1], [0, 1]], color);
}

export function buildStadium(scene, map, detailOn = true) {
  const steel = [], lights = [], seatBacks = [], ribbons = [], banners = [];
  const detail = new THREE.Group(); // hidden on Low quality
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fd4ff, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.3,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4,
  });
  const steelMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  // ---- glass: suite fronts, outer curtain walls, elevator shafts (one transparent mesh) ----
  const glass = [];
  for (const b of map.boxes) if (b.kind === 'glass') glass.push(boxGeo(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]));
  // the end walls: smooth arched glass under the vault (collision is stepped just below it)
  const endX = HX + DOME.OUT + 0.15, zEnd = HZ + DOME.OUT;
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-zEnd, L2);
    for (let z = -zEnd; z <= zEnd + 1e-6; z += zEnd / 30) shape.lineTo(z, roofY(Math.abs(z)));
    shape.lineTo(zEnd, L2); shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(Math.PI / 2); // shape x -> world -z
    g.scale(1, 1, -1);
    g.translate(sx * endX, 0, 0);
    glass.push(g);
    // mullions and a crown medallion frame
    for (let z = -zEnd; z <= zEnd + 1e-6; z += zEnd / 12) steel.push(boxGeo(sx * endX - 0.25, L2, z - 0.18, sx * endX + 0.25, roofY(Math.abs(z)), z + 0.18, 0x9aa3b2));
    for (const y of [L2 + 12, L2 + 24]) {
      const zz = Math.sqrt(Math.max(0, DOME.R ** 2 - (DOME.R - DOME.CROWN + y) ** 2));
      if (zz > 1) steel.push(boxGeo(sx * endX - 0.25, y - 0.15, -zz, sx * endX + 0.25, y + 0.15, zz, 0x9aa3b2));
    }
  }
  const glassMesh = new THREE.Mesh(merge(glass), glassMat);
  glassMesh.renderOrder = 1;
  scene.add(glassMesh);
  // ---- solid parts (seats, floors, walls, stairs, furniture): one mesh with baked, neutral
  // face shading, so ceilings aren't tinted green by the sky/ground light like outdoors ----
  const solid = [];
  const col = new THREE.Color();
  for (const b of map.boxes) {
    if (!b.dome || b.ramp || b.kind === 'glass' || b.kind === 'endglass' || b.kind === 'board') continue;
    const g = boxGeo(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]);
    const nrm = g.attributes.normal, p = g.attributes.position, cnt = p.count, a = new Float32Array(cnt * 3);
    const tall = b.max[1] - b.min[1] > 2;
    col.setHex(b.color);
    for (let i = 0; i < cnt; i++) {
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      let k = ny > 0.5 ? 1.08 : ny < -0.5 ? 0.95 : Math.abs(nx) > 0.5 ? (nx > 0 ? 0.9 : 0.84) : (nz > 0 ? 1.0 : 0.94);
      if (tall && p.getY(i) <= b.min[1] + 0.01) k *= 0.8;
      a[i * 3] = col.r * k; a[i * 3 + 1] = col.g * k; a[i * 3 + 2] = col.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    solid.push(g);
  }
  scene.add(new THREE.Mesh(merge(solid), new THREE.MeshBasicMaterial({ vertexColors: true })));

  // ---- wall cladding: concourse walls (team colors) ----
  const cladTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d3d8f'; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#ffcc33'; g.fillRect(0, h * 0.58, w, h * 0.05);
    g.fillStyle = '#2a55b0'; g.fillRect(0, h * 0.9, w, h * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h * 0.58);
  });
  cladTex.wrapS = THREE.RepeatWrapping;
  const clad = [];
  // planes along a side from -lim..lim at offset o, leaving out `cuts` (gates, doors, tunnels)
  const strip = (side, o, lim, cuts, y0, y1, flip) => {
    let a = -lim;
    for (const [c0, c1] of cuts.concat([[lim, lim]])) {
      if (c0 > a) clad.push(flip ? facePlane(side, o, c0, a, y0, y1, (c0 - a) / 8) : facePlane(side, o, a, c0, y0, y1, (c0 - a) / 8));
      a = Math.max(a, c1);
    }
  };
  for (const side of ['S', 'N', 'E', 'W']) {
    const long = side === 'S' || side === 'N';
    const tunnels = long ? [[-32, -28], [28, 32]] : [[-2, 2]];
    strip(side, 20.42, long ? HX + 20.4 : HZ + 20.4, tunnels, 0, L1 - DOME.SLAB, true);        // inner wall of L0
    const gates = long ? [[-39, -33], [-3, 3], [33, 39]] : [[-3, 3]];
    strip(side, DOME.OUT - 0.02, long ? HX + DOME.OUT : HZ + DOME.OUT, gates, 0, 2.2, false);   // outer wall, low band
    const sl = long ? DOME.SUITES_X : DOME.SUITES_Z, doors = [];
    for (let a = -sl; a < sl; a += DOME.SUITE_W) doors.push([a + DOME.SUITE_W / 2 - 0.9, a + DOME.SUITE_W / 2 + 0.9]);
    strip(side, 26.92, sl, doors, L1, L1 + 1.2, true);                                          // suite corridor
    const trenches = long ? [[-42, -38], [-2, 2], [38, 42]] : [[-2, 2]];
    strip(side, 27.42, long ? HX + 27.4 : HZ + 27.4, trenches, L2, L2 + 3.08, true);             // upper concourse
  }
  scene.add(new THREE.Mesh(merge(clad), new THREE.MeshBasicMaterial({ map: cladTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));

  // ---- plaza around the dome and the turf apron round the field (depth-offset over the roads) ----
  for (const d of map.decor) {
    if (!d.dome) continue;
    const g = new THREE.PlaneGeometry(d.w, d.d); g.rotateX(-Math.PI / 2); g.translate(d.x, d.type === 'pavement' ? 0.01 : 0.03, d.z);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: d.type === 'pavement' ? 0xa9a9a2 : d.color, polygonOffset: true, polygonOffsetFactor: d.type === 'pavement' ? -1 : -1.5, polygonOffsetUnits: d.type === 'pavement' ? -4 : -6 }));
    scene.add(m);
  }

  // ---- concourse floor (L0): polished tiles with a royal-blue walkway ----
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c2b3'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = ['#bdb5a5', '#d6cfc0', '#b0a898', '#e0d9ca'][i % 4]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(80,70,60,0.25)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  const floors = [], walk = [];
  for (const side of ['S', 'N', 'E', 'W']) {
    const long = side === 'S' || side === 'N';
    const lim = long ? HX + DOME.OUT : HZ + 20.4;
    const [x0, z0, x1, z1] = ringRect(side, 20.4, DOME.OUT, -lim, lim);
    floors.push(quadGeo([[x0, 0.06, z0], [x0, 0.06, z1], [x1, 0.06, z1], [x1, 0.06, z0]], [[x0 / 4, z0 / 4], [x0 / 4, z1 / 4], [x1 / 4, z1 / 4], [x1 / 4, z0 / 4]]));
    const wl = long ? HX + 27 : HZ + 26;
    const r = ringRect(side, 26.2, 27.8, -wl, wl);
    walk.push(boxGeo(r[0], 0.06, r[1], r[2], 0.075, r[3], 0x2a55b0));
    for (const o of [26.05, 27.95]) { const q = ringRect(side, o - 0.1, o + 0.1, -wl, wl); walk.push(boxGeo(q[0], 0.06, q[1], q[2], 0.08, q[3], 0xffcc33)); }
  }
  // L1 corridor carpet and L2 concourse tiles: the tops of the floor slabs (so the stairwells
  // and elevator shafts stay open), clipped to the corridor / concourse part
  const carpet = [];
  for (const b of map.boxes) {
    if (b.kind !== 'slab') continue;
    const lvl = b.max[1], o = lvl === L1 ? 26.9 : 27.4, list = lvl === L1 ? carpet : floors;
    let [x0, z0, x1, z1] = [b.min[0], b.min[2], b.max[0], b.max[2]];
    if (z0 >= HZ + 20.4 - 1e-6) z0 = Math.max(z0, HZ + o);
    else if (z1 <= -(HZ + 20.4) + 1e-6) z1 = Math.min(z1, -(HZ + o));
    else if (x0 >= HX + 20.4 - 1e-6) x0 = Math.max(x0, HX + o);
    else if (x1 <= -(HX + 20.4) + 1e-6) x1 = Math.min(x1, -(HX + o));
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
    const y = lvl + 0.03, k = lvl === L1 ? 3 : 4;
    list.push(quadGeo([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [[x0 / k, z0 / k], [x0 / k, z1 / k], [x1 / k, z1 / k], [x1 / k, z0 / k]]));
  }
  const carpetTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#26356b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2e4183'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) g.fillRect(i * 32, j * 32, 32, 32);
    drawCrown(g, 64, 66, 9, 'rgba(255,204,51,0.55)', 'rgba(0,0,0,0)');
  });
  carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(merge(carpet), new THREE.MeshBasicMaterial({ map: carpetTex, polygonOffset: true, polygonOffsetFactor: -1 })));
  scene.add(new THREE.Mesh(merge(floors), new THREE.MeshLambertMaterial({ map: floorTex, polygonOffset: true, polygonOffsetFactor: -1 })));
  scene.add(new THREE.Mesh(merge(walk), new THREE.MeshBasicMaterial({ vertexColors: true })));
  // stair handrails (gold) along the open side of every staircase
  for (const b of map.boxes) if (b.stairRail) {
    const L = b.stairRail; // floor heights at the bottom and top of the stairs
    const zc = (b.min[2] + b.max[2]) / 2;
    const near = Math.abs(b.min[0]) < Math.abs(b.max[0]) ? b.min[0] : b.max[0], far = near === b.min[0] ? b.max[0] : b.min[0];
    const zs = zc + Math.sign(zc) * 0.25;
    steel.push(cyl(new THREE.Vector3(near, L[0] + 1.0, zs), new THREE.Vector3(far, L[1] + 0.95, zs), 0.05, 0xffcc33));
    for (let k = 0; k <= 4; k++) {
      const x = near + (far - near) * k / 4, y = L[0] + (L[1] - L[0]) * k / 4;
      steel.push(boxGeo(x - 0.04, y, zs - 0.04, x + 0.04, y + 1.0, zs + 0.04, 0xffcc33));
    }
  }
  // snack stand menu boards
  const snackTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#20232b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffcc33'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#ffcc33'; g.font = 'bold 64px Impact, Arial Black'; g.textAlign = 'center';
    g.fillText('SNACK SHACK', w / 2, 80);
    g.font = '72px serif'; g.fillText('\u{1F32D} \u{1F37F} \u{1F964} \u{1F355}', w / 2, 190);
  });
  const snackMat = new THREE.MeshBasicMaterial({ map: snackTex, toneMapped: false, side: THREE.DoubleSide });
  const snackGeos = [];
  for (const d of map.decor) {
    if (d.type !== 'snacksign') continue;
    const g = new THREE.PlaneGeometry(4.4, 2.2);
    g.rotateY({ S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[d.side]);
    g.translate(d.x, d.y, d.z);
    snackGeos.push(g);
  }
  if (snackGeos.length) scene.add(new THREE.Mesh(merge(snackGeos), snackMat));

  // outer curtain mullions (long sides)
  for (const sz of [-1, 1]) {
    const z = sz * (HZ + DOME.OUT + 0.32), top = roofY(HZ + DOME.OUT + 0.3);
    for (let x = -(HX + DOME.OUT); x <= HX + DOME.OUT + 1e-6; x += 6.6) steel.push(boxGeo(x - 0.18, L1, z - 0.12, x + 0.18, top, z + 0.12, 0x9aa3b2));
    for (const y of [L2, 16, 20.5]) steel.push(boxGeo(-(HX + DOME.OUT), y - 0.2, z - 0.15, HX + DOME.OUT, y + 0.2, z + 0.15, 0x9aa3b2));
  }

  // suite fronts: steel frames between the glass panes
  for (const side of ['S', 'N', 'E', 'W']) {
    const lim = side === 'S' || side === 'N' ? DOME.SUITES_X : DOME.SUITES_Z;
    for (let a = -lim; a <= lim + 1e-6; a += DOME.SUITE_W / 2) {
      const r = ringRect(side, 20.35, 20.65, a - 0.09, a + 0.09);
      steel.push(boxGeo(r[0], L1, r[1], r[2], L2 - DOME.SLAB, r[3], 0x3a4150));
    }
    const r = ringRect(side, 20.33, 20.67, -lim, lim);
    steel.push(boxGeo(r[0], L1 + 1.05, r[1], r[2], L1 + 1.15, r[3], 0x3a4150));
  }
  // L2 drop ceiling under the raised upper-deck rows
  const ceil = [];
  for (const side of ['S', 'N', 'E', 'W']) {
    const lim = side === 'S' || side === 'N' ? HX + DOME.OUT : HZ + 27.4;
    const [x0, z0, x1, z1] = ringRect(side, 27.4, DOME.OUT, -lim, lim);
    const y = L2 + 3.08;
    ceil.push(quadGeo([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [[0, 0], [1, 0], [1, 1], [0, 1]]));
  }
  scene.add(new THREE.Mesh(merge(ceil), new THREE.MeshBasicMaterial({ color: 0xc9c4b8, side: THREE.DoubleSide })));

  // ---- the roof: faceted vault panels exactly on the walkable ramps ----
  const roofTop = [], roofUnder = [];
  const T = 0.9;
  for (const b of map.boxes) {
    if (!b.ramp || b.kind !== 'roof') continue;
    const x0 = b.min[0], x1 = b.max[0], za = b.min[2], zb = b.max[2];
    const ya = rampHeight(b, (x0 + x1) / 2, za), yb = rampHeight(b, (x0 + x1) / 2, zb);
    const mid = Math.abs((za + zb) / 2);
    const tint = mid > DOME.OPEN.z && mid < 32 ? 0xc6ccd6 : 0xf0f2f5; // the slid-back roof panels
    const U = (x) => x / 9, V = (z) => z / 9;
    roofTop.push(quadGeo([[x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]], [[U(x0), V(za)], [U(x0), V(zb)], [U(x1), V(zb)], [U(x1), V(za)]], tint));
    roofUnder.push(quadGeo([[x0, ya - T, za], [x1, ya - T, za], [x1, yb - T, zb], [x0, yb - T, zb]], [[U(x0), V(za)], [U(x1), V(za)], [U(x1), V(zb)], [U(x0), V(zb)]], 0xffffff));
    // end caps (at the opening rim and at the ends)
    for (const x of [x0, x1]) roofUnder.push(quadGeo([[x, ya - T, za], [x, yb - T, zb], [x, yb, zb], [x, ya, za]], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], 0xffffff));
  }
  // rim beams around the opening, the roof edge fascia
  const rimY = roofY(DOME.OPEN.z);
  for (const sz of [-1, 1]) steel.push(boxGeo(-DOME.OPEN.x - 0.6, rimY - 2.2, sz * DOME.OPEN.z - 0.6, DOME.OPEN.x + 0.6, rimY + 0.15, sz * DOME.OPEN.z + 0.6, 0xd9dde4));
  for (const sx of [-1, 1]) for (let z = -DOME.OPEN.z; z < DOME.OPEN.z - 1e-6; z += 2) {
    const top = Math.min(roofY(Math.abs(z)), roofY(Math.abs(z + 2))) + 0.1;
    steel.push(boxGeo(sx * DOME.OPEN.x - 0.6, top - 2.2, z, sx * DOME.OPEN.x + 0.6, top, z + 2, 0xd9dde4));
  }
  const roofTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d7dbe2'; g.fillRect(0, 0, w, 6); g.fillRect(0, 0, 6, h);
    g.fillStyle = '#e8ebf0'; g.fillRect(0, h / 2, w, 3);
  }, null);
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  const trussTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c8ccd3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#59606d'; g.lineWidth = 7;
    g.strokeRect(0, 0, w, h);
    g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    g.fillStyle = '#fff6d8'; g.fillRect(w / 2 - 14, h / 2 - 5, 28, 10); // light fixtures
  }, null);
  trussTex.wrapS = trussTex.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(merge(roofTop), new THREE.MeshLambertMaterial({ map: roofTex, vertexColors: true })));
  scene.add(new THREE.Mesh(merge(roofUnder), new THREE.MeshBasicMaterial({ map: trussTex, side: THREE.DoubleSide, color: 0xd8dbe0 })));
  // big MEGA DOME lettering on the roof crown (seen from the blimp)
  {
    const tex = canvasTex(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = 'bold italic 150px Impact, Arial Black'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 14; g.strokeStyle = '#1d3d8f'; g.strokeText('MEGA DOME', w / 2, h / 2 + 6);
      g.fillStyle = '#ffcc33'; g.fillText('MEGA DOME', w / 2, h / 2 + 6);
    });
    const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false });
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 12);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), v = pos.getY(i); // -0.5..0.5 (both read the same way from the south)
        const z = -v * 34, x = sx * 74 + u * 44;
        pos.setXYZ(i, x, roofY(Math.abs(z)) + 0.08, z);
      }
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 1;
      scene.add(mesh);
    }
  }

  // ---- the two giant arches (box trusses) landing outside the ends ----
  const A = DOME.ARCH;
  const arcPt = (t, F, H, z) => { const th = Math.PI * t; return new THREE.Vector3(F * Math.cos(th), H * Math.sin(th), z); };
  for (const sz of [-1, 1]) {
    const z0 = sz * A.z;
    const chords = [[A.foot, A.h, z0 - 1.6], [A.foot, A.h, z0 + 1.6], [A.foot - 4, A.h - 4.5, z0 - 1.6], [A.foot - 4, A.h - 4.5, z0 + 1.6]];
    for (const [F, H, z] of chords) {
      const curve = new (class extends THREE.Curve { getPoint(t, out = new THREE.Vector3()) { return out.copy(arcPt(t, F, H, z)); } })();
      steel.push(paint(new THREE.TubeGeometry(curve, 120, 0.85, 6, false), 0xe8e8ec));
    }
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      for (const z of [z0 - 1.6, z0 + 1.6]) {
        detail.userData.list ||= [];
        detail.userData.list.push(cyl(arcPt(t0, A.foot, A.h, z), arcPt(t1, A.foot - 4, A.h - 4.5, z), 0.28, 0xd0d0d6));
        detail.userData.list.push(cyl(arcPt(t1, A.foot - 4, A.h - 4.5, z), arcPt(t1, A.foot, A.h, z), 0.24, 0xd0d0d6));
      }
      detail.userData.list.push(cyl(arcPt(t0, A.foot, A.h, z0 - 1.6), arcPt(t0, A.foot, A.h, z0 + 1.6), 0.24, 0xd0d0d6));
    }
  }

  // ---- center-hung video board ----
  const B = DOME.BOARD;
  const boardTex = canvasTex(2048, 512, () => {});
  const endTex = canvasTex(512, 512, () => {});
  const ringTex = canvasTex(2048, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#1d3d8f'); grd.addColorStop(0.5, '#3a6fe0'); grd.addColorStop(1, '#1d3d8f');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.font = 'bold 44px Impact, Arial Black'; g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#ffcc33'; g.fillText(i % 2 ? 'MEGA DOME' : 'FOOTBALL ROYALE', 40 + i * 512, h / 2 + 2);
      drawCrown(g, 470 + i * 512, h / 2, 14);
    }
  }, [1, 1]);
  ringTex.wrapS = THREE.RepeatWrapping;
  const screenMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  const endMat = new THREE.MeshBasicMaterial({ map: endTex, toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, toneMapped: false });
  {
    const bx = [];
    bx.push(boxGeo(-B.x, B.y0, -B.z, B.x, B.y1, B.z, 0x1b1f27));
    bx.push(boxGeo(-B.x - 0.4, B.y1 - 0.2, -B.z - 0.4, B.x + 0.4, B.y1 + 0.3, B.z + 0.4, 0x2b313d)); // top frame
    bx.push(boxGeo(-B.x - 0.4, B.y0 - 0.3, -B.z - 0.4, B.x + 0.4, B.y0 + 0.2, B.z + 0.4, 0x2b313d));
    steel.push(...bx);
    const H = B.y1 - B.y0 - 1.2, cy = (B.y0 + B.y1) / 2;
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(B.x * 2 - 1.2, H), screenMat);
      p.position.set(0, cy, sz * (B.z + 0.03)); if (sz < 0) p.rotation.y = Math.PI;
      scene.add(p);
    }
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(B.z * 2 - 1, H), endMat);
      p.position.set(sx * (B.x + 0.03), cy, 0); p.rotation.y = sx * Math.PI / 2;
      scene.add(p);
    }
    // LED halo ring under the board
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.2, 48, 1, true), ringMat);
    ring.scale.set(B.x * 0.8, 1, B.z * 1.25); ring.position.y = B.y0 - 1.6;
    scene.add(ring);
    steel.push(boxGeo(-B.x * 0.6, B.y0 - 2.8, -B.z * 0.6, B.x * 0.6, B.y0 - 0.3, B.z * 0.6, 0x1b1f27));
    // hung from the arches
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const top = new THREE.Vector3(sx * 20, A.h * Math.sin(Math.acos(20 / A.foot)) - 4, sz * A.z);
      steel.push(cyl(new THREE.Vector3(sx * (B.x - 2), B.y1, sz * (B.z - 1)), top, 0.12, 0x30343c, 4));
    }
  }
  let boardKey = '';
  const drawBoard = (info) => {
    const key = `${info.alive}|${info.kind}|${info.clock}`;
    if (key === boardKey) return;
    boardKey = key;
    { // long screens
      const { g } = boardTex.userData, w = 2048, h = 512;
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0b1d4d'); bg.addColorStop(1, '#13317a');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.05)'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
      drawCrown(g, 210, 230, 120);
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = 'bold italic 150px Impact, Arial Black';
      g.lineWidth = 10; g.strokeStyle = '#7a4b00'; g.strokeText('FOOTBALL ROYALE', 380, 170);
      g.fillStyle = '#ffcc33'; g.fillText('FOOTBALL ROYALE', 380, 170);
      g.font = 'bold 72px Arial Black, Arial'; g.fillStyle = '#ffffff';
      g.fillText(info.kind === 'island' ? 'PARTY ISLAND  \u{1F389}' : 'WELCOME TO THE MEGA DOME', 384, 300);
      // score box
      g.fillStyle = '#000'; g.fillRect(1500, 330, 500, 150);
      g.strokeStyle = '#ffcc33'; g.lineWidth = 6; g.strokeRect(1500, 330, 500, 150);
      g.textAlign = 'center'; g.fillStyle = '#ff7a2a'; g.font = 'bold 88px Courier New, monospace';
      g.fillText(info.alive != null ? String(info.alive).padStart(2, '0') : '75', 1620, 410);
      g.fillStyle = '#7fe0ff'; g.fillText(info.clock || '0:00', 1860, 410);
      g.font = 'bold 36px Arial'; g.fillStyle = '#ffffff';
      g.fillText('LEFT', 1620, 352); g.fillText('TIME', 1860, 352);
      g.textAlign = 'left'; g.font = 'bold 54px Arial Black, Arial'; g.fillStyle = '#9fd8ff';
      g.fillText('\u{1F3C8}  LAST ONE STANDING WINS!', 384, 410);
      boardTex.needsUpdate = true;
    }
    { // end screens
      const { g } = endTex.userData, w = 512, h = 512;
      g.fillStyle = '#0b1d4d'; g.fillRect(0, 0, w, h);
      drawCrown(g, w / 2, 150, 110);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffcc33'; g.font = 'bold 64px Impact, Arial Black'; g.fillText('MEGA DOME', w / 2, 310);
      g.fillStyle = '#ff7a2a'; g.font = 'bold 110px Courier New, monospace';
      g.fillText(info.alive != null ? String(info.alive) : '75', w / 2, 425);
      endTex.needsUpdate = true;
    }
  };
  drawBoard({ alive: null, kind: 'normal', clock: '0:00' });

  // ---- ribbon boards on the front of the upper deck (and the suite level) ----
  const ribbonTex = canvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#0d1f55'; g.fillRect(0, 0, w, h);
    g.font = 'bold 40px Impact, Arial Black'; g.textBaseline = 'middle';
    g.fillStyle = '#ffcc33'; g.fillText('FOOTBALL ROYALE', 20, h / 2 + 2);
    drawCrown(g, 380, h / 2, 16);
    g.fillStyle = '#7fe0ff'; g.fillText('MEGA DOME', 430, h / 2 + 2);
    drawCrown(g, 700, h / 2, 16, '#ffffff', '#333');
    g.fillStyle = '#ff7a2a'; g.fillText('GO TEAM!', 760, h / 2 + 2);
  });
  ribbonTex.wrapS = THREE.RepeatWrapping;
  for (const side of ['S', 'N', 'E', 'W']) {
    const lim = side === 'S' || side === 'N' ? HX + 20.4 : HZ + 20.4;
    ribbons.push(facePlane(side, 20.38, -lim, lim, L2 - 0.4, L2 + 0.62, (2 * lim) / 24));
  }
  const ribbonMat = new THREE.MeshBasicMaterial({ map: ribbonTex, toneMapped: false, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(merge(ribbons), ribbonMat));

  // ---- seat backs on every row (alpha-tested seat shapes, one mesh) ----
  const seatTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(6, 4, w - 12, h - 8, 12); g.fill();
    g.fillStyle = '#d8d8d8'; g.fillRect(10, h - 22, w - 20, 8);
  });
  for (const b of map.boxes) {
    if (!b.seat) continue;
    const side = b.face, top = b.max[1];
    const c = new THREE.Color(b.color).multiplyScalar(1.15).getHex();
    let o, a0, a1;
    if (side === 'S') { o = b.max[2] - HZ - 0.3; a0 = b.min[0]; a1 = b.max[0]; }
    else if (side === 'N') { o = -b.min[2] - HZ - 0.3; a0 = b.min[0]; a1 = b.max[0]; }
    else if (side === 'E') { o = b.max[0] - HX - 0.3; a0 = b.min[2]; a1 = b.max[2]; }
    else { o = -b.min[0] - HX - 0.3; a0 = b.min[2]; a1 = b.max[2]; }
    seatBacks.push(facePlane(side, o, a0, a1, top, top + 0.55, (a1 - a0) / 0.6, c));
  }
  const seatMesh = new THREE.Mesh(merge(seatBacks), new THREE.MeshLambertMaterial({ map: seatTex, alphaTest: 0.5, vertexColors: true, side: THREE.DoubleSide }));
  detail.add(seatMesh);

  // ---- lights: concourse and suite ceilings ----
  for (const side of ['S', 'N', 'E', 'W']) {
    const lim = side === 'S' || side === 'N' ? HX + 30 : HZ + 18;
    for (let a = -lim; a <= lim; a += 6) {
      const r0 = ringRect(side, 24, 25, a - 1.5, a + 1.5), r1 = ringRect(side, 33, 34, a - 1.5, a + 1.5);
      lights.push(boxGeo(r0[0], L1 - DOME.SLAB - 0.06, r0[1], r0[2], L1 - DOME.SLAB - 0.01, r0[3]));
      lights.push(boxGeo(r1[0], L1 - DOME.SLAB - 0.06, r1[1], r1[2], L1 - DOME.SLAB - 0.01, r1[3]));
      const r3 = ringRect(side, 32, 33, a - 1.5, a + 1.5);
      lights.push(boxGeo(r3[0], L2 + 3.0, r3[1], r3[2], L2 + 3.06, r3[3]));
      const r2 = ringRect(side, 31, 32, a - 1.5, a + 1.5);
      lights.push(boxGeo(r2[0], L2 - DOME.SLAB - 0.06, r2[1], r2[2], L2 - DOME.SLAB - 0.01, r2[3]));
    }
    const sl = side === 'S' || side === 'N' ? DOME.SUITES_X : DOME.SUITES_Z;
    for (let a = -sl + 4; a < sl; a += DOME.SUITE_W) {
      const r = ringRect(side, 22.5, 24.5, a - 1.5, a + 1.5);
      lights.push(boxGeo(r[0], L2 - DOME.SLAB - 0.06, r[1], r[2], L2 - DOME.SLAB - 0.01, r[3]));
    }
  }
  const lightMesh = new THREE.Mesh(merge(lights), new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false }));
  scene.add(lightMesh);

  // ---- banners in the concourse (backs of the lower deck), signs, ▲▼ elevator signs ----
  const bannerTex = canvasTex(256, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#1d3d8f'); grd.addColorStop(1, '#3a6fe0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcc33'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
    drawCrown(g, w / 2, 150, 80);
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = 'bold 54px Impact, Arial Black';
    g.fillText('MEGA', w / 2, 320); g.fillText('DOME', w / 2, 385);
    g.fillStyle = '#ffcc33'; g.font = 'bold 30px Arial Black, Arial'; g.fillText('FOOTBALL ROYALE', w / 2, 450);
  });
  for (const side of ['S', 'N', 'E', 'W']) {
    const lim = side === 'S' || side === 'N' ? 84 : 46;
    for (let a = -lim; a <= lim; a += side === 'S' || side === 'N' ? 21 : 23) {
      if (Math.abs(Math.abs(a) - 30) < 4 || Math.abs(a) < 3) continue;
      const g = facePlane(side, 20.45, a + 1.4, a - 1.4, 3.2, 6.2); // faces the concourse (outward)
      banners.push(g);
    }
  }
  scene.add(new THREE.Mesh(merge(banners), new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide })));
  const signTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#0d1f55'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffcc33'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    drawCrown(g, 110, h / 2, 62); drawCrown(g, w - 110, h / 2, 62);
    g.font = 'bold italic 118px Impact, Arial Black'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffcc33'; g.fillText('MEGA DOME', w / 2, h / 2 + 8);
  });
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  for (const d of map.decor) {
    if (d.type !== 'domesign') continue;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), signMat);
    p.position.set(d.x, d.y, d.z);
    p.rotation.y = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[d.side];
    scene.add(p);
  }
  // giant facade signs on the long sides and crowns on the end glass (seen from far away)
  for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(56, 14), signMat);
    p.position.set(0, 16.5, sz * (HZ + DOME.OUT + 0.6));
    if (sz < 0) p.rotation.y = Math.PI;
    scene.add(p);
  }
  const crownTex = canvasTex(512, 512, (g, w, h) => { g.clearRect(0, 0, w, h); drawCrown(g, w / 2, h / 2 + 30, 190); });
  const crownMat = new THREE.MeshBasicMaterial({ map: crownTex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), crownMat);
    p.position.set(sx * (HX + DOME.OUT + 0.6), 32, 0);
    p.rotation.y = sx * Math.PI / 2;
    scene.add(p);
  }
  // blue LED band along the roof edge of the long sides
  {
    const led = [];
    for (const sz of [-1, 1]) led.push(boxGeo(-(HX + DOME.OUT + 0.6), roofY(DOME.EDGE_Z) - 1.0, sz * DOME.EDGE_Z - 0.15, HX + DOME.OUT + 0.6, roofY(DOME.EDGE_Z) - 0.3, sz * DOME.EDGE_Z + 0.15));
    scene.add(new THREE.Mesh(merge(led), new THREE.MeshBasicMaterial({ color: 0x4f8dff, toneMapped: false })));
  }
  const arrowTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#111827'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fe0ff'; g.font = 'bold 84px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('▲▼', w / 2, h / 2 + 4);
  });
  const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex, toneMapped: false });
  const arrows = [];

  // ---- elevators: cabs, pistons and doors (instanced, moved every frame) ----
  const E = map.elevators || [];
  const n = E.length, S = E.reduce((s, e) => s + e.stops.length, 0);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cabFloor = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color: 0x6b7382 }), n * 2);
  const cabGlass = new THREE.InstancedMesh(unit, glassMat, n * 3);
  const cabPost = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xffcc33 }), n * 4);
  const piston = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), new THREE.MeshLambertMaterial({ color: 0xc0c6d0 }), n);
  const doors = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xb8c2d0, emissive: 0x111111 }), S * 2);
  const cabLight = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false }), n);
  const dyn = [cabFloor, cabGlass, cabPost, piston, doors, cabLight];
  for (const m of dyn) { m.frustumCulled = false; scene.add(m); }
  const doorOpen = new Float32Array(S);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const set = (mesh, i, x, y, z, sx, sy, sz) => { m4.compose(pos.set(x, y, z), q, scl.set(sx, sy, sz)); mesh.setMatrixAt(i, m4); };
  for (const e of E) {
    for (let i = 0; i < e.stops.length; i++) {
      const r = doorRect(e, i);
      const along = e.door < 2 ? 0 : 2;
      const cx = (r.min[0] + r.max[0]) / 2, cz = (r.min[2] + r.max[2]) / 2, top = r.max[1];
      const out = e.door === 2 ? -1 : e.door === 3 ? 1 : 0, outZ = e.door === 0 ? -1 : e.door === 1 ? 1 : 0;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), arrowMat);
      p.position.set(cx + out * 0.2, top + 0.5, cz + outZ * 0.2);
      p.rotation.y = along === 2 ? (out > 0 ? Math.PI / 2 : -Math.PI / 2) : (outZ > 0 ? 0 : Math.PI);
      arrows.push(p); scene.add(p);
    }
  }
  let lastT = null;
  const updateElevators = (t) => {
    const dt = lastT == null ? 1 : Math.min(0.2, Math.max(0, t - lastT)); lastT = t;
    let di = 0;
    E.forEach((e, k) => {
      const h = elevatorHeight(e, t);
      const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2, w = e.x1 - e.x0 - 0.1, d = e.z1 - e.z0 - 0.1;
      set(cabFloor, k * 2, cx, h - 0.15, cz, w, 0.3, d);
      set(cabFloor, k * 2 + 1, cx, h + 2.75, cz, w, 0.15, d);
      set(cabLight, k, cx, h + 2.66, cz, w * 0.5, 0.04, d * 0.5);
      set(piston, k, cx, (h - 0.3) / 2 - 0.5, cz, 1, Math.max(0.01, h - 0.3 + 1), 1);
      // glass on the three closed sides, gold posts on the corners
      let gi = 0;
      for (const side of [0, 1, 2, 3]) {
        if (side === e.door) continue;
        const x = side === 2 ? e.x0 + 0.06 : side === 3 ? e.x1 - 0.06 : cx;
        const z = side === 0 ? e.z0 + 0.06 : side === 1 ? e.z1 - 0.06 : cz;
        set(cabGlass, k * 3 + gi++, x, h + 1.3, z, side < 2 ? w : 0.06, 2.6, side < 2 ? 0.06 : d);
      }
      [[e.x0, e.z0], [e.x1, e.z0], [e.x0, e.z1], [e.x1, e.z1]].forEach(([x, z], i) => set(cabPost, k * 4 + i, x + (x > cx ? -0.1 : 0.1), h + 1.3, z + (z > cz ? -0.1 : 0.1), 0.14, 2.7, 0.14));
      // doors: slide open while the cab rests at that stop
      for (let i = 0; i < e.stops.length; i++, di++) {
        const want = elevatorStop(e, t) === i ? 1 : 0;
        doorOpen[di] += Math.max(-dt * 3, Math.min(dt * 3, want - doorOpen[di]));
        const r = doorRect(e, i), op = doorOpen[di] * (ELEVATOR.door / 2 - 0.05);
        const along = e.door < 2 ? 0 : 2, half = ELEVATOR.door / 4;
        const cxr = (r.min[0] + r.max[0]) / 2, czr = (r.min[2] + r.max[2]) / 2, cy = (r.min[1] + r.max[1]) / 2;
        for (const s of [-1, 1]) {
          const off = s * (half + op);
          set(doors, di * 2 + (s > 0 ? 1 : 0), cxr + (along === 0 ? off : 0), cy, czr + (along === 2 ? off : 0),
            along === 0 ? ELEVATOR.door / 2 : 0.08, ELEVATOR.doorH, along === 2 ? ELEVATOR.door / 2 : 0.08);
        }
      }
    });
    for (const m of dyn) m.instanceMatrix.needsUpdate = true;
  };
  updateElevators(0);

  // ---- merge the static steel/props, attach the detail group ----
  const lace = detail.userData.list || [];
  if (lace.length) detail.add(new THREE.Mesh(merge(lace), steelMat));
  scene.add(new THREE.Mesh(merge(steel), steelMat));
  scene.add(detail);
  const applyQuality = (on) => { detail.visible = on !== false; };
  applyQuality(detailOn);

  let scroll = 0;
  return {
    dynamic: dyn,
    applyQuality,
    // t: server clock (s); info: { alive, kind, clock }
    update(t, dt, info) {
      updateElevators(t);
      scroll += dt * 0.03;
      ribbonTex.offset.x = scroll; ringTex.offset.x = -scroll * 0.7;
      if (info) drawBoard(info);
    },
  };
}
