// Home page only. The office island behind the headline and the voxel world map under the download counts, both drawn with
// the vendored three.js at low resolution and scaled up with hard pixels. Each pauses off screen, draws one still frame under
// reduced motion and stays hidden without WebGL. Also cycles the demo notch line and fills the counts.
import * as T from './vendor/three/three.module.min.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PIX = 3; // one world pixel = 3 screen pixels
const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const seeded = s => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; // same scene on every visit

function renderer(canvas) {
  canvas.hidden = false;
  try {
    const r = new T.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    r.setPixelRatio(1);
    return r;
  } catch { canvas.hidden = true; return null; }
}

// Runs frame(now) while the canvas is on screen and the tab visible; one frame under reduced motion.
function animate(canvas, resize, frame) {
  let running = false, visible = false;
  const loop = now => { if (!running) return; frame(now); requestAnimationFrame(loop); };
  const start = () => { if (still) { frame(performance.now()); return; } if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(loop); } };
  const stop = () => { running = false; };
  new ResizeObserver(() => { resize(); if (!running) frame(performance.now()); }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => frame(performance.now()));
  resize(); frame(performance.now());
}

// ---------- the office island ----------
function island(canvas) {
  const gl = renderer(canvas); if (!gl) return;
  const rnd = seeded(7), scene = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-8, 14, 6); scene.add(sun);
  const amb = new T.HemisphereLight(0xcfe3ff, 0x5a7a3a, 1.1); scene.add(amb);
  const R = 10.5, cells = [];
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    const d = Math.hypot(x, z * 1.15) + Math.sin(x * 1.7) * 0.6 + Math.cos(z * 1.3) * 0.6;
    if (d < R) cells.push({ x, z, d });
  }
  const pond = (x, z) => Math.hypot(x - 3.5, z - 3) < 2.4;
  const office = (x, z) => x >= -6 && x <= -1 && z >= -6 && z <= -2;
  const path = (x, z) => (x === -3 && z > -2 && z < 8) || (z === 1 && x > -3 && x < 1);
  const C = { grass: 0x5fb24a, grass2: 0x4ea43f, dirt: 0x8a5a3b, dirt2: 0x6f4630, stone: 0xb9bcc8, water: 0x4aa3e8, wall: 0xf1ede4, roof: 0x2b3566, window: 0xffb347, trunk: 0x7a4b2c, leaf: 0x3f9a46, leaf2: 0x57b552, tiro: 0xff7a1f, eye: 0x1a1230, door: 0x8f5a33 };
  const blocks = [], add = (x, y, z, c, sx = 1, sy = 1, sz = 1) => blocks.push({ x, y, z, c, sx, sy, sz });
  for (const { x, z, d } of cells) {
    const top = pond(x, z) ? C.water : path(x, z) ? C.stone : (rnd() < 0.5 ? C.grass : C.grass2);
    add(x, pond(x, z) ? -0.65 : -0.5, z, top, 1, pond(x, z) ? 0.7 : 1, 1);
    const depth = Math.max(1, Math.round((R - d) * 0.55 + rnd() * 1.5)); // the island narrows into a floating root
    for (let k = 1; k <= depth; k++) add(x, -0.5 - k, z, k > 2 ? C.dirt2 : C.dirt);
  }
  for (let x = -6; x <= -1; x++) for (let z = -6; z <= -2; z++) for (let y = 0; y < 3; y++) {
    if (!(x === -6 || x === -1 || z === -6 || z === -2)) continue;
    const win = y === 1 && ((z === -2 && x !== -3) || (x === -1 && z % 2 === 0)), door = z === -2 && x === -3 && y < 2;
    add(x, y + 0.5, z, door ? C.door : win ? C.window : C.wall);
  }
  add(-3.5, 3.15, -4, C.roof, 7.2, 0.3, 6.2);
  for (const [x, z] of [[6, -5], [7, -1], [-8, 3], [-7, 6], [2, -8], [8, 4], [-1, 7]]) {
    if (!cells.some(c => c.x === x && c.z === z)) continue;
    const h = 2 + Math.round(rnd());
    for (let y = 0; y < h; y++) add(x, y + 0.5, z, C.trunk, 0.6, 1, 0.6);
    add(x, h + 0.9, z, rnd() < 0.5 ? C.leaf : C.leaf2, 2.4, 1.8, 2.4);
    add(x, h + 2, z, C.leaf2, 1.4, 0.9, 1.4);
  }
  const blockMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ flatShading: true }), blocks.length);
  const m = new T.Matrix4(), col = new T.Color(), q = new T.Quaternion(), e = new T.Euler();
  blocks.forEach((b, i) => { m.compose(new T.Vector3(b.x, b.y, b.z), q.identity(), new T.Vector3(b.sx, b.sy, b.sz)); blockMesh.setMatrixAt(i, m); blockMesh.setColorAt(i, col.setHex(b.c)); });
  scene.add(blockMesh);
  const windows = blocks.map((b, i) => (b.c === C.window ? i : -1)).filter(i => i >= 0);

  // grass blades on every lawn cell, bent by a wind shader
  const blade = new T.BufferGeometry();
  blade.setAttribute('position', new T.Float32BufferAttribute([-0.07, 0, 0, 0.07, 0, 0, 0, 1, 0], 3));
  const spots = cells.filter(({ x, z }) => !pond(x, z) && !path(x, z) && !office(x, z));
  const N = Math.min(9000, spots.length * 24);
  const grass = new T.InstancedMesh(blade, new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
    side: T.DoubleSide,
    vertexShader: `uniform float uTime; attribute vec3 aTint; varying float vH; varying vec3 vTint;
      void main() { vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vec3 base = instanceMatrix[3].xyz; float h = position.y; vH = h; vTint = aTint;
        float w = sin(uTime * 1.5 + base.x * 0.45 + base.z * 0.3) * 0.6 + sin(uTime * 2.9 + base.x * 1.3) * 0.25;
        wp.x += w * h * h * 0.32; wp.z += w * h * h * 0.12; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uLight; varying float vH; varying vec3 vTint;
      void main() { vec3 c = mix(vec3(0.16, 0.36, 0.14), vTint, smoothstep(0.0, 1.0, vH)); gl_FragColor = vec4(c * uLight, 1.0); }`,
  }), N);
  const tint = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const s = spots[i % spots.length], h = 0.35 + rnd() * 0.45;
    m.compose(new T.Vector3(s.x + rnd() - 0.5, 0, s.z + rnd() - 0.5), q.setFromEuler(e.set(0, rnd() * Math.PI, 0)), new T.Vector3(1, h, 1));
    grass.setMatrixAt(i, m);
    const g = 0.55 + rnd() * 0.25; tint.set([0.45 * g, 0.85 * g + 0.1, 0.3 * g], i * 3);
  }
  grass.geometry.setAttribute('aTint', new T.InstancedBufferAttribute(tint, 3));
  grass.frustumCulled = false;
  scene.add(grass);

  // Tiro: an orange cube with eyes and six legs, walking round the pond
  const tiro = new T.Group(), lam = c => new T.MeshLambertMaterial({ color: c, flatShading: true });
  const body = new T.Mesh(new T.BoxGeometry(1, 0.9, 0.9), lam(C.tiro)); body.position.y = 0.95; tiro.add(body);
  for (const sx of [-0.2, 0.2]) { const eye = new T.Mesh(new T.BoxGeometry(0.12, 0.18, 0.05), lam(C.eye)); eye.position.set(sx, 1.05, 0.46); tiro.add(eye); }
  const legs = [];
  for (let i = 0; i < 6; i++) { const leg = new T.Mesh(new T.BoxGeometry(0.08, 0.55, 0.08), lam(0xe8661a)); leg.position.set(-0.35 + (i % 3) * 0.35, 0.3, i < 3 ? 0.3 : -0.3); tiro.add(leg); legs.push(leg); }
  tiro.scale.setScalar(0.8); scene.add(tiro);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    gl.setSize(Math.ceil(w / PIX), Math.ceil(h / PIX), false);
    // wide: the island sits right of the headline; narrow: zoomed out, below the text
    const wide = w >= 960, aspect = w / h, half = wide ? 15 : Math.max(17, 13 / aspect);
    const cx = wide ? -half * aspect * 0.42 : 0, cy = wide ? 1 : half * 0.5;
    cam.left = -half * aspect + cx; cam.right = half * aspect + cx; cam.top = half + cy; cam.bottom = -half + cy;
    cam.updateProjectionMatrix();
  }
  const t0 = performance.now(), center = new T.Vector3(0, -1, 0);
  function frame(now) {
    const t = (now - t0) / 1000, night = isDark();
    sun.intensity = night ? 0.55 : 2.2; amb.intensity = night ? 0.45 : 1.1;
    grass.material.uniforms.uLight.value = night ? 0.45 : 1;
    grass.material.uniforms.uTime.value = still ? 0 : t;
    const a = Math.PI / 4 + (still ? 0 : Math.sin(t * 0.08) * 0.35);
    cam.position.set(center.x + Math.cos(a) * 30, 22, center.z + Math.sin(a) * 30); cam.lookAt(center);
    blockMesh.position.y = grass.position.y = still ? 0 : Math.sin(t * 0.6) * 0.15;
    const p = still ? 0.6 : t * 0.35;
    tiro.position.set(3.5 + Math.cos(p) * 3.4, blockMesh.position.y, 3 + Math.sin(p) * 3.4); tiro.rotation.y = -p;
    legs.forEach((l, i) => { l.rotation.x = still ? 0 : Math.sin(t * 9 + i * 1.7) * 0.5; });
    body.position.y = 0.95 + (still ? 0 : Math.abs(Math.sin(t * 9)) * 0.06);
    windows.forEach(i => blockMesh.setColorAt(i, col.setHex(night ? 0xffd27a : C.window)));
    blockMesh.instanceColor.needsUpdate = true;
    gl.render(scene, cam);
  }
  animate(canvas, resize, frame);
}

// ---------- the downloads map ----------
const REGIONS = { NA: ['North America', -100, 42], SA: ['South America', -60, -15], EU: ['Europe', 14, 50], AF: ['Africa', 20, 5], AS: ['Asia', 100, 35], OC: ['Oceania', 134, -25] };
// rough continent outlines (longitude, latitude), enough for a 4-degree block map
const LAND = [
  [[-168, 66], [-140, 70], [-110, 72], [-85, 70], [-75, 62], [-60, 55], [-55, 48], [-70, 43], [-76, 35], [-81, 25], [-90, 29], [-97, 26], [-105, 20], [-95, 16], [-85, 12], [-80, 8], [-92, 15], [-105, 22], [-112, 30], [-118, 34], [-124, 40], [-124, 48], [-135, 57], [-150, 60], [-165, 60]],
  [[-55, 82], [-25, 82], [-20, 72], [-42, 60], [-52, 65], [-60, 76]],
  [[-80, 8], [-60, 10], [-50, 0], [-35, -6], [-40, -22], [-55, -35], [-65, -42], [-70, -54], [-75, -45], [-72, -30], [-70, -18], [-80, -5]],
  [[-10, 36], [-9, 43], [-2, 47], [-5, 48], [0, 50], [5, 53], [8, 57], [5, 62], [15, 69], [28, 71], [40, 67], [40, 55], [30, 45], [28, 41], [20, 40], [15, 38], [12, 44], [5, 43], [0, 38]],
  [[-6, 50], [2, 51], [0, 54], [-3, 58], [-6, 56]],
  [[-17, 15], [-16, 22], [-10, 30], [0, 36], [10, 37], [20, 32], [32, 31], [35, 25], [43, 12], [51, 11], [42, -2], [40, -15], [35, -25], [20, -35], [15, -28], [12, -15], [9, -1], [5, 4], [-8, 4]],
  [[44, -25], [50, -15], [48, -13], [43, -20]],
  [[40, 67], [60, 70], [80, 73], [100, 77], [120, 73], [140, 72], [170, 68], [178, 64], [160, 60], [155, 50], [140, 45], [130, 42], [122, 40], [120, 30], [110, 20], [106, 10], [100, 13], [98, 8], [95, 16], [90, 22], [80, 15], [77, 8], [72, 20], [66, 25], [57, 25], [52, 12], [43, 13], [35, 30], [30, 45], [40, 55]],
  [[130, 31], [136, 34], [141, 38], [142, 44], [140, 41], [135, 35]],
  [[95, 5], [105, -6], [115, -8], [125, -9], [120, -2], [110, 2], [100, 2]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -28], [150, -37], [140, -38], [132, -32], [115, -34]],
  [[172, -35], [178, -38], [172, -46], [167, -46]],
];
const inside = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

function worldMap(box, canvas) {
  const gl = renderer(canvas); if (!gl) return null;
  box.hidden = false;
  const S = 4, toX = lon => lon / S, toZ = lat => -lat / S, rnd = seeded(3); // one block per 4 degrees
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xdfeaff, 0x3a5a2a, 1.2));
  const sun = new T.DirectionalLight(0xffffff, 1.8); sun.position.set(-20, 40, 20); scene.add(sun);
  const geo = new T.BoxGeometry(1, 1, 1), land = [];
  for (let lat = -56; lat <= 82; lat += S) for (let lon = -178; lon <= 178; lon += S) if (LAND.some(p => inside(lon, lat, p))) land.push([lon, lat]);
  const lm = new T.InstancedMesh(geo, new T.MeshLambertMaterial({ flatShading: true }), land.length), m = new T.Matrix4(), c = new T.Color(), q = new T.Quaternion();
  land.forEach(([lon, lat], i) => {
    const h = 0.5 + rnd() * 0.5, snow = Math.abs(lat) > 62;
    m.compose(new T.Vector3(toX(lon), h / 2, toZ(lat)), q, new T.Vector3(0.94, h, 0.94)); lm.setMatrixAt(i, m);
    lm.setColorAt(i, c.setHex(snow ? 0xe9eef7 : Math.abs(lat) < 18 && rnd() < 0.5 ? 0x4e9e3c : rnd() < 0.5 ? 0x5fb24a : 0x6cbf55));
  });
  scene.add(lm);
  const water = new T.Mesh(new T.BoxGeometry(260, 0.2, 160), new T.MeshLambertMaterial({ color: 0x5aa9ec })); water.position.set(0, -0.1, -3); scene.add(water); // larger than any view: the frame is all ocean and land, never sky
  const cam = new T.OrthographicCamera(-1, 1, 1, -1, -200, 200);
  let towers = [], t0 = performance.now();
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    gl.setSize(Math.ceil(w / PIX), Math.ceil(h / PIX), false);
    const aspect = w / h, half = Math.max(47 / aspect, 15);
    cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
  }
  const v = new T.Vector3();
  function frame(now) {
    const t = (now - t0) / 1000, a = still ? 0 : Math.sin(t * 0.15) * 0.12;
    cam.position.set(Math.sin(a) * 60, 52, 60 * Math.cos(a) - 3); cam.lookAt(0, 0, -3);
    towers.forEach((tw, i) => { tw.grow = still ? 1 : Math.min(1, Math.max(0, (t - i * 0.12) / 0.9)); tw.g.scale.y = Math.max(0.001, 1 - Math.pow(1 - tw.grow, 3)); });
    gl.render(scene, cam);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    towers.forEach(tw => { v.set(tw.g.position.x, tw.top * tw.g.scale.y, tw.g.position.z).project(cam); tw.pin.style.left = ((v.x + 1) / 2 * W) + 'px'; tw.pin.style.top = ((1 - v.y) / 2 * H) + 'px'; tw.pin.style.opacity = tw.grow > 0.6 ? 1 : 0; });
  }
  animate(canvas, resize, frame);
  // Orange towers, one per region with downloads; the tallest has nine blocks. Called once the counter answers.
  return byRegion => {
    const list = Object.keys(REGIONS).map(k => ({ k, n: Number(byRegion[k]) || 0 })).filter(r => Number.isInteger(r.n) && r.n > 0);
    if (!list.length) return;
    const max = Math.max(...list.map(r => r.n));
    towers = list.map(({ k, n }) => {
      const [, lon, lat] = REGIONS[k], g = new T.Group(), h = Math.max(1, Math.round(n / max * 9));
      for (let i = 0; i < h; i++) { const b = new T.Mesh(geo, new T.MeshLambertMaterial({ color: i % 2 ? 0xff8f3f : 0xff7a1f, flatShading: true })); b.scale.set(1.3, 1, 1.3); b.position.y = 1 + i; g.add(b); }
      g.position.set(toX(lon), 0, toZ(lat)); scene.add(g);
      const pin = document.createElement('span'); pin.className = 'pin'; pin.textContent = n.toLocaleString('en-US'); pin.setAttribute('aria-hidden', 'true'); box.appendChild(pin);
      return { g, top: h + 1.6, pin, grow: 0 };
    });
    canvas.setAttribute('role', 'img'); canvas.removeAttribute('aria-hidden');
    canvas.setAttribute('aria-label', 'Downloads by region: ' + list.sort((a, b) => b.n - a.n).map(r => `${REGIONS[r.k][0]} ${r.n.toLocaleString('en-US')}`).join(', '));
    t0 = performance.now(); frame(t0);
  };
}

// ---------- counts ----------
const getJson = url => fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const isCount = n => Number.isInteger(n) && n >= 0;
function fillCounts(s) {
  const p = (s && s.byPlatform) || {};
  if (!isCount(s && s.total) || !['windows', 'macos', 'linux'].every(k => isCount(p[k]))) return false;
  const set = (k, n) => document.querySelectorAll(`[data-count="${k}"]`).forEach(e => { e.textContent = n.toLocaleString('en-US'); });
  set('total', s.total); for (const k of ['windows', 'macos', 'linux']) set(k, p[k]);
  return true;
}

// ---------- the demo notch line ----------
function notchLine(el) {
  if (!el || still) return;
  const lines = ['Forge is running npm test', 'Warden asks to read .env', 'Stand-up in 12 min', 'Pixel finished the onboarding screen', 'Tiro is planning your next goal'];
  let i = 0;
  setInterval(() => { el.style.opacity = 0; setTimeout(() => { i = (i + 1) % lines.length; el.textContent = lines[i]; el.style.opacity = 1; }, 250); }, 2800);
}

const world = document.getElementById('world');
if (world) island(world);
notchLine(document.getElementById('notch-line'));
const box = document.getElementById('dl-map');
if (box) {
  const towers = worldMap(box, document.getElementById('mapc'));
  const edge = box.dataset.edge || '';
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(edge)) {
    getJson(edge + '/stats').then(s => { if (!fillCounts(s)) throw new Error('shape'); if (towers && s.byRegion && typeof s.byRegion === 'object') towers(s.byRegion); })
      .catch(() => getJson(new URL('../stats.json', import.meta.url)).then(fillCounts).catch(() => {}));
  }
}
