// Turns the shared map data into a three.js scene.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_HALF } from '/shared/constants.js';
import { mat, createFootball, bakeGroup, propMaterial } from './models.js';
import { buildStadium, drawCrown } from './stadium.js';

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function fieldTexture(small) {
  return canvasTex(1024, 512, (g, w, h) => {
    for (let i = 0; i < 22; i++) { g.fillStyle = i % 2 ? '#3f9c3f' : '#47a847'; g.fillRect((i * w) / 22, 0, w / 22 + 1, h); }
    if (!small) {
      g.fillStyle = '#c0392b'; g.fillRect(0, 0, w / 11, h);
      g.fillStyle = '#2a5bb3'; g.fillRect(w - w / 11, 0, w / 11, h);
      g.save(); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 60px Impact, Arial Black'; g.textAlign = 'center';
      g.translate(w / 22, h / 2); g.rotate(-Math.PI / 2); g.fillText('ROYALE', 0, 20); g.restore();
      g.save(); g.translate(w - w / 22, h / 2); g.rotate(Math.PI / 2); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 60px Impact, Arial Black'; g.textAlign = 'center'; g.fillText('FOOTBALL', 0, 20); g.restore();
    }
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    for (let i = 1; i <= 10; i++) { const x = (w / 11) * 0.5 + (i * w * 10) / 11 / 10 * 0.9 + w / 22; g.beginPath(); g.moveTo(x, 6); g.lineTo(x, h - 6); g.stroke(); }
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#fff'; g.font = 'bold 34px Arial'; g.textAlign = 'center';
    const nums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    nums.forEach((n, i) => { const x = w / 11 + ((i + 1) * (w * 9) / 11) / 10; g.fillText(n, x, 60); g.fillText(n, x, h - 34); });
    if (!small) { // Football Royale crown at midfield
      g.fillStyle = 'rgba(20,40,110,.85)'; g.beginPath(); g.arc(w / 2, h / 2, 62, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = '#ffcc33'; g.stroke();
      drawCrown(g, w / 2, h / 2 + 6, 36);
    }
  });
}

export function buildWorld(scene, map) {
  // ---- sky & light ----
  scene.background = new THREE.Color(0x8fd0ff);
  scene.fog = new THREE.Fog(0x9fd6ff, 120, 650);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y; vec3 top = vec3(0.22,0.52,0.95); vec3 hor = vec3(0.68,0.86,1.0); gl_FragColor = vec4(mix(hor, top, clamp(h*1.6,0.0,1.0)), 1.0); }',
  }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4a7a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  // ---- ground & ocean ----
  const grass = canvasTex(256, 256, (g) => {
    g.fillStyle = '#5aa448'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) { g.fillStyle = ['#539c42', '#62ad4f', '#4f9440'][i % 3]; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  }, [120, 120]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2 + 60, MAP_HALF * 2 + 60), mat('#e8d49a'));
  beach.rotation.x = -Math.PI / 2; beach.position.y = -0.3;
  scene.add(beach);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat('#2a83c9'));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -1.2;
  scene.add(ocean);

  // ---- flat decorations ----
  // Untextured flats and all the small props (goal posts, tents, trophy...) are collected in `props`
  // and baked into ONE vertex-colored mesh at the end: ~2 draw calls instead of ~150.
  const props = new THREE.Group();
  const flat = (x, z, w, d, material, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    if (material.map) scene.add(m); else props.add(m);
    return m;
  };
  // (depth offset: fields win over the roads under them even from the blimp)
  const fieldBig = new THREE.MeshLambertMaterial({ map: fieldTexture(false), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  const fieldSmall = new THREE.MeshLambertMaterial({ map: fieldTexture(true), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  for (const d of map.decor) {
    if (d.dome) continue; // the Mega Dome's plaza/apron are drawn by stadium.js
    switch (d.type) {
      case 'field': flat(d.x, d.z, d.w, d.d, d.small ? fieldSmall : fieldBig, 0.04); break;
      case 'road': flat(d.x, d.z, d.w, d.d, mat('#4a4d52'), 0.02); break;
      case 'asphalt': flat(d.x, d.z, d.w, d.d, mat('#5b5e63'), 0.025); break;
      case 'pavement': flat(d.x, d.z, d.w, d.d, mat('#a9a9a2'), 0.015); break;
      case 'floor': flat(d.x, d.z, d.w, d.d, mat(d.color), d.y ?? 0.05); break;
      case 'goalpost': {
        const s = d.small ? 0.6 : 1, y = mat('#ffd23f');
        const g = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.15 * s, 3 * s), y); post.position.y = 1.5 * s; g.add(post);
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 5.6 * s), y); bar.rotation.x = Math.PI / 2; bar.position.y = 3 * s; g.add(bar);
        for (const k of [-1, 1]) { const u = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 6 * s), y); u.position.set(0, 6 * s, k * 2.8 * s); g.add(u); }
        g.position.set(d.x, 0, d.z);
        if (d.rot) g.rotation.y = Math.PI / 2;
        props.add(g); break;
      }
      case 'scoreboard': {
        const tex = canvasTex(512, 256, (g, w, h) => {
          g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#ffcc33'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
          g.fillStyle = '#ffcc33'; g.font = 'bold italic 56px Impact'; g.textAlign = 'center'; g.fillText('FOOTBALL ROYALE', w / 2, 80);
          g.fillStyle = '#ff5a2a'; g.font = 'bold 90px Courier New'; g.fillText('75 : 1', w / 2, 200);
        });
        const sb = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 1), [mat('#222'), mat('#222'), mat('#222'), mat('#222'), new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })]);
        sb.position.set(d.x, d.h + 6, d.z + 2);
        scene.add(sb);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(1, d.h, 1), mat('#555')); pole.position.set(d.x, d.h / 2, d.z + 2); props.add(pole);
        break;
      }
      case 'tent': {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.6, 4), mat(d.color));
        roof.position.set(d.x, 3.4, d.z); roof.rotation.y = Math.PI / 4; props.add(roof);
        for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6), mat('#ddd')); leg.position.set(d.x + a, 1.3, d.z + b); props.add(leg);
        }
        break;
      }
      case 'trophy': {
        const g = new THREE.Group(), gold = mat('#ffcc33', { emissive: 0x553300 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 0.6), gold); base.position.y = 0.3; g.add(base);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.4), gold); stem.position.y = 1.3; g.add(stem);
        const ball = createFootball(1.4); ball.position.y = 2.4; ball.rotation.x = 0.6; g.add(ball);
        g.position.set(d.x, d.y, d.z); props.add(g); break;
      }
      case 'bigball': {
        const b = createFootball(10); b.position.set(d.x, d.y + 2.6, d.z); b.rotation.x = 0.3; props.add(b); break;
      }
      case 'tank': {
        const t = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 10), mat('#c8d3e0'));
        t.scale.y = 0.7; t.position.set(d.x, d.y + 8, d.z); props.add(t);
        break;
      }
    }
  }

  {
    const baked = bakeGroup(props);
    scene.add(new THREE.Mesh(baked, propMaterial));
  }

  // ---- solid boxes merged into one mesh (fast!) ----
  const geos = [];
  const col = new THREE.Color();
  // (the Mega Dome's glass, sloped roof and video board are drawn by stadium.js)
  const special = new Set(['trunk', 'glass', 'endglass', 'board']);
  for (const b of map.boxes) {
    if (special.has(b.kind) || b.ramp || b.dome) continue;
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    col.setHex(b.color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // slightly darken bottoms for a nicer look
      const shade = g.attributes.position.getY(i) <= b.min[1] + 0.01 && h > 2 ? 0.75 : 1;
      colors[i * 3] = col.r * shade; colors[i * 3 + 1] = col.g * shade; colors[i * 3 + 2] = col.b * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  }
  const merged = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(merged);
  geos.forEach((g) => g.dispose());

  // windows on towers (simple stripes)
  const winMat = new THREE.MeshLambertMaterial({ color: 0x9fd4ff, emissive: 0x223344 });
  const winGeos = [];
  for (const b of map.boxes) {
    if (b.kind !== 'tower') continue;
    const h = b.max[1];
    for (let y = 3; y < h - 2; y += 4) {
      for (const side of [0, 1]) {
        const w = side ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
        const g = new THREE.BoxGeometry(side ? w * 0.9 : 0.1, 1.4, side ? 0.1 : w * 0.9);
        const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
        g.translate(side ? cx : b.min[0] - 0.05, y, side ? b.min[2] - 0.05 : cz); winGeos.push(g);
        const g2 = g.clone(); g2.translate(side ? 0 : b.max[0] - b.min[0] + 0.1, 0, side ? b.max[2] - b.min[2] + 0.1 : 0); winGeos.push(g2);
      }
    }
  }
  if (winGeos.length) scene.add(new THREE.Mesh(mergeGeometries(winGeos), winMat));

  // ---- trees (instanced) ----
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 1, 6), mat('#6b4423'), map.trees.length);
  const pines = map.trees.filter((t) => t.pine), rounds = map.trees.filter((t) => !t.pine);
  const pineMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), mat('#2e7d32'), pines.length);
  const roundMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat('#4caf50'), rounds.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  map.trees.forEach((t, i) => {
    m4.compose(p.set(t.x, t.h * 0.3, t.z), q.identity(), s.set(1, t.h * 0.6, 1)); trunks.setMatrixAt(i, m4);
  });
  pines.forEach((t, i) => { m4.compose(p.set(t.x, t.h * 0.6, t.z), q.identity(), s.set(t.r, t.h * 0.8, t.r)); pineMesh.setMatrixAt(i, m4); });
  rounds.forEach((t, i) => { m4.compose(p.set(t.x, t.h * 0.7, t.z), q.setFromEuler(new THREE.Euler(0, i, 0)), s.set(t.r * 1.2, t.r, t.r * 1.2)); roundMesh.setMatrixAt(i, m4); });
  scene.add(trunks, pineMesh, roundMesh);

  // ---- the Overtime Storm wall ----
  const stormTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(140, 60, 230, 0.32)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${200 + Math.random() * 55}, ${120 + Math.random() * 80}, 255, ${0.2 + Math.random() * 0.3})`;
      g.lineWidth = 2 + Math.random() * 6;
      g.beginPath(); const x = Math.random() * w; g.moveTo(x, 0); g.bezierCurveTo(x + 30, h / 3, x - 30, (2 * h) / 3, x, h); g.stroke();
    }
  }, [40, 2]);
  const storm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 400, 96, 1, true), new THREE.MeshBasicMaterial({
    map: stormTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
  }));
  storm.position.y = 150;
  storm.renderOrder = 2;
  scene.add(storm);

  const stadium = map.decor.some((d) => d.type === 'megadome') ? buildStadium(scene, map) : null;

  // nothing but the storm and the elevators ever moves: skip the per-frame matrix updates of the static city
  for (const o of scene.children) {
    if (o === storm || (stadium && stadium.dynamic.includes(o))) continue;
    o.updateMatrixWorld(true);
    o.traverse((x) => { x.matrixAutoUpdate = false; x.matrixWorldAutoUpdate = false; });
  }
  return { storm, stormTex, sun, stadium };
}

// Turn the map into a 2D picture for the minimap.
export function drawMapImage(map, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const k = size / (MAP_HALF * 2);
  const X = (x) => (x + MAP_HALF) * k, Z = (z) => (z + MAP_HALF) * k;
  g.fillStyle = '#2a83c9'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#5aa448'; g.fillRect(2, 2, size - 4, size - 4);
  for (const d of map.decor) {
    const fill = { field: '#3f9c3f', road: '#666', asphalt: '#777', pavement: '#aaa', floor: null }[d.type];
    if (!fill || d.w == null) continue;
    g.fillStyle = fill; g.fillRect(X(d.x - d.w / 2), Z(d.z - d.d / 2), d.w * k, d.d * k);
  }
  g.fillStyle = '#2e7d32';
  for (const t of map.trees) { g.beginPath(); g.arc(X(t.x), Z(t.z), Math.max(1, t.r * k), 0, 7); g.fill(); }
  for (const b of map.boxes) {
    if (b.kind === 'trunk') continue;
    g.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
    g.fillRect(X(b.min[0]), Z(b.min[2]), Math.max(1, (b.max[0] - b.min[0]) * k), Math.max(1, (b.max[2] - b.min[2]) * k));
  }
  return c;
}
