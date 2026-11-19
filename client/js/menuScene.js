// The home-screen background: a packed stadium at night under bright lights,
// seen from field level at the 50-yard line. Everything is drawn with code.
import * as THREE from 'three';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Field: green stripes, yard lines, hash marks and big yard numbers
function fieldTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? '#2f7d2c' : '#36892f'; g.fillRect((i * w) / 24, 0, w / 24 + 1, h); }
    // grass grain
    for (let i = 0; i < 40000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.fillStyle = 'rgba(255,255,255,0.92)';
    const yard = w / 120; // 120 yards long incl. end zones
    for (let y = 10; y <= 110; y += 5) { g.lineWidth = y % 10 === 0 ? 7 : 5; g.beginPath(); g.moveTo(y * yard, 0); g.lineTo(y * yard, h); g.stroke(); }
    for (let y = 10; y <= 110; y++) for (const hy of [0.06, 0.38, 0.62, 0.94]) g.fillRect(y * yard - 2, hy * h - 10, 4, 20);
    g.font = 'bold 120px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const nums = ['1 0', '2 0', '3 0', '4 0', '5 0', '4 0', '3 0', '2 0', '1 0'];
    nums.forEach((n, i) => {
      const x = (20 + i * 10) * yard;
      g.save(); g.translate(x, h * 0.82); g.fillText(n, 0, 0); g.restore();         // near side (upright for the camera)
      g.save(); g.translate(x, h * 0.18); g.rotate(Math.PI); g.fillText(n, 0, 0); g.restore();
    });
  });
}

// Crowd: rows of people (little colored shapes) with camera flashes
function crowdTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#0b1424'; g.fillRect(0, 0, w, h);
    const colors = ['#c9d6e8', '#8fa7c9', '#3d5a85', '#e8e3d6', '#b33a3a', '#e8a33a', '#5e7da8', '#2b3d5c', '#d9d9d9', '#7a5a8a'];
    for (let row = 0; row < 40; row++) {
      const y = row * (h / 40);
      g.fillStyle = 'rgba(30,45,70,0.9)'; g.fillRect(0, y + h / 40 - 3, w, 3); // seat row
      for (let x = 0; x < w; x += 6 + Math.random() * 3) {
        g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        g.globalAlpha = 0.55 + Math.random() * 0.45;
        g.fillRect(x, y + 2 + Math.random() * 2, 4, 6);         // body
        g.beginPath(); g.arc(x + 2, y + 2, 2, 0, 7); g.fill();  // head
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 90; i++) { g.fillStyle = '#ffffff'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } // flashes
  });
}

function glowTexture() {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(230,245,255,0.95)');
    gr.addColorStop(0.35, 'rgba(120,190,255,0.35)'); gr.addColorStop(1, 'rgba(60,120,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

export function createMenuScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x6aa8e8, 120, 420);
  // sky: deep blue up top, bright blue haze near the rim, with soft clouds
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform float t;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float y = clamp(vP.y, 0.0, 1.0);
        vec3 col = mix(vec3(0.55,0.8,1.0), vec3(0.03,0.12,0.38), pow(y, 0.55));
        vec2 uv = vP.xz / (vP.y + 0.25) * 2.0 + vec2(t*0.01, 0.0);
        float c = n(uv) * 0.6 + n(uv*2.3) * 0.3 + n(uv*5.1) * 0.1;
        col += vec3(0.25,0.35,0.5) * smoothstep(0.45, 0.85, c) * (1.0 - y) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a3a1a, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0, 80, 40); scene.add(key);

  // field (x = length, z = width); camera stands near the +z sideline
  const field = new THREE.Mesh(new THREE.PlaneGeometry(110, 55), new THREE.MeshLambertMaterial({ map: fieldTexture() }));
  field.rotation.x = -Math.PI / 2;
  scene.add(field);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(170, 110), new THREE.MeshLambertMaterial({ color: 0x2c6e2a }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; scene.add(apron);

  // stadium bowl: wall, lower deck, concourse, upper deck
  const crowd = crowdTexture();
  crowd.wrapS = crowd.wrapT = THREE.RepeatWrapping;
  const bowl = new THREE.Group();
  const deck = (rBottom, rTop, y0, h, rep) => {
    const t = crowd.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 96, 1, true), new THREE.MeshLambertMaterial({ map: t, side: THREE.BackSide }));
    m.position.y = y0 + h / 2;
    bowl.add(m);
    return t;
  };
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(66, 66, 3, 96, 1, true), new THREE.MeshLambertMaterial({ color: 0x1f3b6b, side: THREE.BackSide }));
  wall.position.y = 1.5; bowl.add(wall);
  const t1 = deck(66, 92, 3, 16, 10);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(93, 93, 3.5, 96, 1, true), new THREE.MeshLambertMaterial({ color: 0xd8dde6, side: THREE.BackSide, emissive: 0x223355 }));
  band.position.y = 20.7; bowl.add(band);
  const t2 = deck(94, 122, 22.5, 22, 12);
  bowl.scale.set(1.0, 1, 0.62);
  scene.add(bowl);

  // roof ring with rows of lights, plus the big light banks
  const glow = glowTexture();
  const lights = new THREE.Group();
  const ringMat = new THREE.MeshLambertMaterial({ color: 0x9fb3cf, emissive: 0x334466 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(124, 1.6, 8, 120), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 46; ring.scale.set(1, 0.62, 1); lights.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(118, 0.8, 6, 120), ringMat);
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 49; ring2.scale.set(1, 0.62, 1); lights.add(ring2);
  const sprites = [];
  const spriteMat = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    const s = new THREE.Sprite(spriteMat.clone());
    s.position.set(Math.cos(a) * 124, 46.5, Math.sin(a) * 124 * 0.62);
    const big = Math.sin(a) < -0.2 || Math.abs(Math.cos(a)) > 0.8; // far side + corners are big banks
    s.scale.setScalar(big ? 26 : 13);
    s.userData.base = s.scale.x; s.userData.phase = Math.random() * 6;
    lights.add(s); sprites.push(s);
  }
  // giant corner light towers (top-left / top-right of the view like a broadcast shot)
  for (const sx of [-1, 1]) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const s = new THREE.Sprite(spriteMat.clone());
      s.position.set(sx * (78 + c * 9), 58 + r * 7 - c * 3.5, 30 + c * 5);
      s.scale.setScalar(22); s.userData.base = 22; s.userData.phase = Math.random() * 6;
      lights.add(s); sprites.push(s);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(60, 1.2, 8, 40, Math.PI * 0.5), ringMat);
    arch.position.set(sx * 120, 0, 40); arch.rotation.y = sx > 0 ? Math.PI : 0;
    lights.add(arch);
  }
  scene.add(lights);
  // soft light haze over the field
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(400, 120), new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  haze.position.set(0, 30, -60); scene.add(haze);

  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 1500);
  let time = 0;
  return {
    scene, camera,
    update(dt) {
      time += dt;
      // slow broadcast-style drift along the sideline
      camera.position.set(Math.sin(time * 0.05) * 6, 2.2 + Math.sin(time * 0.11) * 0.25, 30);
      camera.lookAt(Math.sin(time * 0.05) * 4, 13, -40);
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      sky.material.uniforms.t.value = time;
      for (const s of sprites) s.scale.setScalar(s.userData.base * (0.92 + Math.sin(time * 3 + s.userData.phase) * 0.08));
      t1.offset.x = Math.floor(time * 4) % 2 ? 0.0005 : 0; t2.offset.x = Math.floor(time * 4 + 1) % 2 ? 0.0005 : 0; // crowd flicker
    },
  };
}
