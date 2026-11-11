// The landing: the table drawn live in 3D and driven by the scroll position.
// The leg as a line drawing -> small pieces of walnut pack into it -> four legs -> the two raw slabs ->
// they break into pieces and gather into the two halves of the top -> the black epoxy pour -> the table -> from above.
// Geometry is the same as the Blender scene (render/build_table.py): leg outline in (r, h) mm, 40 mm thick,
// legs at 45/135/225/315 degrees, top 1100 x 40 mm with its underside at 750 mm. Built z-up, then tipped to y-up.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const T = 0.040, CH = 0.003, TOP_R = 0.55, LEG_H = 0.75, TOP_T = 0.040;
const LEG_ANGLES = [45, 135, 225, 315].map(d => d * Math.PI / 180);
const LINE = 0xd37955, FOV = 28;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ramp = (v, a, b) => clamp((v - a) / (b - a));
const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- geometry
function legParts(raw) {
  let P = raw.map(([r, h]) => [r / 1000, h / 1000]);
  P = P.filter((p, i) => { const q = P[(i + P.length - 1) % P.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
  let area = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) P.reverse();                                   // counter-clockwise: the left normal points inward
  const n = P.length;
  const inw = P.map((_, i) => {
    const a = P[(i + n - 1) % n], b = P[(i + 1) % n], tx = b[0] - a[0], th = b[1] - a[1], l = Math.hypot(tx, th) || 1;
    return [-th / l, tx / l];
  });
  const pos = [], nor = [], uv = [], idx = [];
  const put = (i, d, y, nx, ny, nz, du) => {
    pos.push(P[i][0] + inw[i][0] * d, y, P[i][1] + inw[i][1] * d); nor.push(nx, ny, nz);
    uv.push((P[i][0] + inw[i][0] * du) / 0.52, (P[i][1] + inw[i][1] * du) / 0.76);
  };
  // four rings: front face edge, front of the side wall, back of the side wall, back face edge (a 3 mm eased edge)
  for (let i = 0; i < n; i++) put(i, CH, -T / 2, 0, -1, 0, CH);
  for (let i = 0; i < n; i++) put(i, 0, -T / 2 + CH, -inw[i][0], 0, -inw[i][1], 0.005 + CH);
  for (let i = 0; i < n; i++) put(i, 0, T / 2 - CH, -inw[i][0], 0, -inw[i][1], 0.005 + T - CH);
  for (let i = 0; i < n; i++) put(i, CH, T / 2, 0, 1, 0, CH);
  for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = k * n + i, b = k * n + j, c = (k + 1) * n + j, d = (k + 1) * n + i;
    idx.push(a, c, b, a, d, c);
  }
  const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []);
  for (const [a0, b0, c0] of tris) {
    const A = P[a0], B = P[b0], C = P[c0];
    const ccw = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0;
    const [a, b, c] = ccw ? [a0, b0, c0] : [a0, c0, b0];
    idx.push(a, b, c, 3 * n + a, 3 * n + c, 3 * n + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // the drawing: both faces' outlines, joined across the thickness at every corner
  const seg = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], z = P[(i + n - 1) % n];
    for (const y of [-T / 2, T / 2]) seg.push(a[0], y, a[1], b[0], y, b[1]);
    const u1 = [a[0] - z[0], a[1] - z[1]], u2 = [b[0] - a[0], b[1] - a[1]];
    const turn = Math.abs(Math.atan2(u1[0] * u2[1] - u1[1] * u2[0], u1[0] * u2[0] + u1[1] * u2[1]));
    if (turn > 0.45) seg.push(a[0], -T / 2, a[1], a[0], T / 2, a[1]);
  }
  return { geometry: g, segments: seg, outline: P };
}

function topParts() {
  const zt = LEG_H + TOP_T, zb = LEG_H, RT = 0.006, RU = 0.003, N = 192;
  const prof = [];                                              // [r, z, nr, nz] down the eased edge
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 * (1 - i / 8); prof.push([TOP_R - RT + RT * Math.cos(a), zt - RT + RT * Math.sin(a), Math.cos(a), Math.sin(a)]); }
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 * i / 8; prof.push([TOP_R - RU + RU * Math.cos(a), zb + RU + RU * Math.sin(a), Math.cos(a), Math.sin(a)]); }
  const arc = [0];
  for (let j = 1; j < prof.length; j++) arc.push(arc[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  const pos = [], nor = [], uv = [], idx = [];
  const planar = (x, y) => [x / (2 * TOP_R) + 0.5, y / (2 * TOP_R) + 0.5];
  const cap = (r, z, nz) => {
    const c = pos.length / 3; pos.push(0, 0, z); nor.push(0, 0, nz); uv.push(0.5, 0.5);
    for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / N, x = r * Math.cos(a), y = r * Math.sin(a); pos.push(x, y, z); nor.push(0, 0, nz); uv.push(...planar(x, y)); }
    for (let i = 0; i < N; i++) { const p = c + 1 + i, q = c + 1 + (i + 1) % N; nz > 0 ? idx.push(c, p, q) : idx.push(c, q, p); }
  };
  cap(prof[0][0], zt, 1);
  const base = pos.length / 3;
  prof.forEach(([r, z, nr, nz], j) => {
    for (let i = 0; i < N; i++) {
      const a = 2 * Math.PI * i / N, x = r * Math.cos(a), y = r * Math.sin(a), k = (TOP_R - 0.005 - arc[j]) / r;
      pos.push(x, y, z); nor.push(nr * Math.cos(a), nr * Math.sin(a), nz); uv.push(...planar(k * x, k * y));
    }
  });
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N, A = base + j * N + i, B = base + (j + 1) * N + i, C = base + (j + 1) * N + i2, D = base + j * N + i2;
    idx.push(A, B, C, A, C, D);
  }
  cap(prof[prof.length - 1][0], zb, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geometry: g };
}

function slabParts(o, th) {
  // o.outline: [x, y] in mm, y down the photo. Local: x across, y along (far end = +y), z up.
  let P = o.outline.map(([x, y]) => [(x - o.w / 2) / 1000, (o.h / 2 - y) / 1000]);
  let area = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) P.reverse();
  const n = P.length, pos = [], nor = [], uv = [], idx = [];
  const uvOf = p => [p[0] * 1000 / o.w + 0.5, p[1] * 1000 / o.h + 0.5];
  for (const p of P) { pos.push(p[0], p[1], th); nor.push(0, 0, 1); uv.push(...uvOf(p)); }
  for (const [a0, b0, c0] of THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), [])) {
    const A = P[a0], B = P[b0], C = P[c0];
    (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0 ? idx.push(a0, b0, c0) : idx.push(a0, c0, b0);
  }
  for (let i = 0; i < n; i++) {                               // the edge, down to the underside
    const a = P[(i + n - 1) % n], b = P[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    const q = [P[i][0] * 0.97, P[i][1] * 0.995];
    for (const z of [th, 0]) { pos.push(P[i][0], P[i][1], z); nor.push(ty / l, -tx / l, 0); uv.push(...uvOf(q)); }
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = n + 2 * i, b = n + 2 * j; idx.push(a, a + 1, b + 1, a, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geometry: g, outline: P };
}

function lines(segments, width) {
  const g = new LineSegmentsGeometry(); g.setPositions(segments);
  const m = new LineMaterial({ color: LINE, linewidth: width, transparent: true, opacity: 1, depthWrite: false });
  return new LineSegments2(g, m);
}

function inside(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function bounds(P) { const xs = P.map(p => p[0]), ys = P.map(p => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; }
function pointIn(P, bb) { for (;;) { const x = mix(bb[0], bb[1], Math.random()), y = mix(bb[2], bb[3], Math.random()); if (inside(P, x, y)) return [x, y]; } }

// a picture's colours, readable point by point (u, v as on the 3D surface); values in linear light
function sampler(image, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(image, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, lin = v => Math.pow(v / 255, 2.2);
  return (u, v, out, o = 0, raw = false) => {
    const i = (clamp(Math.floor((1 - v) * h), 0, h - 1) * w + clamp(Math.floor(u * w), 0, w - 1)) * 4;
    if (raw) { out[o] = d[i] / 255; out[o + 1] = d[i + 1] / 255; out[o + 2] = d[i + 2] / 255; }
    else { out[o] = lin(d[i]); out[o + 1] = lin(d[i + 1]); out[o + 2] = lin(d[i + 2]); }
    return out;
  };
}

// ---------------------------------------------------------------- small pieces of wood
// Each piece flies from A through M to B (a curved path), tumbling on the way and lying flat at the end.
function pieces(n, opt) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6dcd4, roughness: 0.58, envMapIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.visible = false;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  const f = k => new Float32Array(n * k);
  return Object.assign({ n, mesh, A: f(3), M: f(3), B: f(3), size: f(3), qA: f(4), qB: f(4), axis: f(3), phase: f(1), delay: f(1), cA: f(3), cB: f(3), last: -1 }, opt);
}
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _ax = new THREE.Vector3(), _m = new THREE.Matrix4();
function setQ(arr, i, q) { arr[i * 4] = q.x; arr[i * 4 + 1] = q.y; arr[i * 4 + 2] = q.z; arr[i * 4 + 3] = q.w; }
function randomQ(q) { return q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); }
function movePieces(S, t, time) {
  const on = t > 0 && t < 1; S.mesh.visible = on;
  if (!on) return;
  const { n, A, M, B, size, qA, qB, axis, phase, delay, cA, cB } = S, D = S.spread, out = S.mesh.instanceMatrix.array, col = S.mesh.instanceColor.array;
  const melt = 1 - ramp(t, S.melt, 1), drift = time * 0.0007;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3, i4 = i * 4, t0 = delay[i] * D;
    const u = clamp((t - t0) / (1 - D)), e = u * u * (3 - 2 * u), a = (1 - e) * (1 - e), b = 2 * e * (1 - e), c = e * e;
    _p.set(a * A[i3] + b * M[i3] + c * B[i3], a * A[i3 + 1] + b * M[i3 + 1] + c * B[i3 + 1], a * A[i3 + 2] + b * M[i3 + 2] + c * B[i3 + 2]);
    _qa.set(qA[i4], qA[i4 + 1], qA[i4 + 2], qA[i4 + 3]); _qb.set(qB[i4], qB[i4 + 1], qB[i4 + 2], qB[i4 + 3]); _qa.slerp(_qb, e);
    const env = S.fromNothing ? 1 - e : Math.sin(Math.PI * e);
    if (env > 0.001) { _ax.set(axis[i3], axis[i3 + 1], axis[i3 + 2]); _qs.setFromAxisAngle(_ax, env * (S.tumble + phase[i] * 3 + drift * (1 + phase[i]))); _qa.premultiply(_qs); }
    const born = S.fromNothing ? ramp(u, 0, 0.14) : ramp(t, t0 - 0.035, t0);
    const k = born * (u >= 1 ? melt : 1);
    _s.set(size[i3] * k, size[i3 + 1] * k, size[i3 + 2] * k);
    _m.compose(_p, _qa, _s); _m.toArray(out, i * 16);
    if (S.recolour) { col[i3] = mix(cA[i3], cB[i3], e); col[i3 + 1] = mix(cA[i3 + 1], cB[i3 + 1], e); col[i3 + 2] = mix(cA[i3 + 2], cB[i3 + 2], e); }
  }
  S.mesh.instanceMatrix.needsUpdate = true; if (S.recolour) S.mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- the scroll story
// p: where in the story (0 to 1). az/el: camera angles. t: what it looks at. fw/fh: the size to keep in frame (m).
// sx: how far right of centre the subject sits on a wide screen. use: share of the width it may fill.
const T_LEG = [0.05, 0.17], T_FAN = [0.21, 0.29], T_OUT = [0.31, 0.38], T_SLABS = [0.32, 0.41], T_TOP = [0.45, 0.62], T_POUR = [0.65, 0.775], T_BACK = [0.79, 0.87], T_LOOK = [0.92, 0.97];
function keys(wide) {
  const slabAz = wide ? Math.PI / 4 : -Math.PI / 4;             // slabs lie across a wide screen, upright on a tall one
  return [
    { p: 0.00, az: 0.00, el: 0.05, t: [0.26, 0.375, 0], fw: 0.62, fh: 0.84, sx: 0, use: 0.80 },
    { p: 0.07, az: 0.60, el: 0.13, t: [0.26, 0.375, 0], fw: 0.70, fh: 0.92, sx: 0.19, use: 0.48 },
    { p: 0.18, az: 0.35, el: 0.10, t: [0.26, 0.375, 0], fw: 0.68, fh: 0.90, sx: 0.19, use: 0.48 },
    { p: 0.29, az: 0.15, el: 0.22, t: [0, 0.40, 0], fw: 1.22, fh: 0.98, sx: 0.17, use: 0.58 },
    { p: 0.41, az: slabAz, el: 0.92, t: [0, 0.78, 0], fw: wide ? 2.35 : 1.45, fh: wide ? 1.30 : 1.85, sx: wide ? 0.21 : 0.13, use: 0.55 },
    { p: 0.62, az: slabAz * 0.55, el: 1.02, t: [0, 0.80, 0], fw: 1.34, fh: 1.22, sx: 0.15, use: 0.60 },
    { p: 0.775, az: -0.15, el: 1.12, t: [0, 0.80, 0], fw: 1.26, fh: 1.16, sx: 0.15, use: 0.60 },
    { p: 0.88, az: -0.35, el: 0.42, t: [0, 0.45, 0], fw: 1.28, fh: 1.05, sx: 0.15, use: 0.60 },
    { p: 0.965, az: -Math.PI / 4, el: 1.45, t: [0, 0.79, 0], fw: 1.26, fh: 1.26, sx: 0.15, use: 0.62 },
  ];
}
function keyAt(K, p) {
  let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], t = smooth(ramp(p, a.p, b.p)), o = {};
  for (const k of ["az", "el", "fw", "fh", "sx", "use"]) o[k] = mix(a[k], b[k], t);
  o.t = a.t.map((v, j) => mix(v, b.t[j], t));
  return o;
}

async function start(canvas) {
  const stage = canvas.closest(".stage"), story = document.getElementById("story");
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  gl.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05;
  gl.debug.onShaderError = (g, prog, vs, fs) => console.warn("3D shader:", g.getShaderInfoLog(fs) || g.getShaderInfoLog(vs) || g.getProgramInfoLog(prog));
  const small = Math.min(innerWidth, innerHeight) < 700;       // phones get fewer pieces

  const base = canvas.dataset.base, v = "?v=" + canvas.dataset.v;
  const loader = new THREE.TextureLoader();
  const tex = async (name, colour = true) => {
    const t = await loader.loadAsync(base + name + v);
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = gl.capabilities.getMaxAnisotropy();
    return t;
  };
  const [data, topMap, topRough, topFlow, slabA, slabB, ...legMaps] = await Promise.all([
    fetch(base + "leg.json" + v).then(r => r.json()),
    tex("top.jpg"), tex("top-rough.jpg", false), tex("top-flow.png", false), tex("slab-a.jpg"), tex("slab-b.jpg"),
    tex("leg1.jpg"), tex("leg2.jpg"), tex("leg3.jpg"), tex("leg4.jpg"),
  ]);
  topFlow.generateMipmaps = false; topFlow.minFilter = THREE.LinearFilter; topFlow.anisotropy = 1;

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(gl);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffe6cc, 2.4); key.position.set(2.5, 3.2, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc09a, 2.4); rim.position.set(-3, 1.6, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);

  const spin = new THREE.Group(); spin.rotation.y = -Math.PI / 4;       // leg 1 lies along +x, facing the camera
  const zup = new THREE.Group(); zup.rotation.x = -Math.PI / 2; spin.add(zup); scene.add(spin);
  const wood = (map, extra) => new THREE.MeshPhysicalMaterial(Object.assign({
    map, color: 0xddd6cf, roughness: 0.42, clearcoat: 0.22, clearcoatRoughness: 0.28, envMapIntensity: 0.55, side: THREE.DoubleSide,
  }, extra));

  // ---- legs
  const leg = legParts(data.leg);
  const legsG = new THREE.Group(); zup.add(legsG);
  const legs = LEG_ANGLES.map((a, k) => {
    const g = new THREE.Group(); g.rotation.z = a;
    const mesh = new THREE.Mesh(leg.geometry, wood(legMaps[k]));
    g.add(mesh); legsG.add(g);
    return { g, mesh };
  });
  const legLines = lines(leg.segments, 1.8); legs[0].g.add(legLines);

  // the pieces that pack into the first leg: positions in the leg's own frame (x = out from the axis, z = up)
  const legPix = sampler(legMaps[0].image, 260, 380);
  const LP = pieces(small ? 1500 : 3200, { spread: 0.5, melt: 0.93, tumble: 5, fromNothing: true, recolour: false });
  {
    const bb = bounds(leg.outline), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), c = [0, 0, 0];
    for (let i = 0; i < LP.n; i++) {
      const [r, h] = pointIn(leg.outline, bb), i3 = i * 3, face = i % 2 ? 1 : -1;
      LP.B.set([r, face * (T / 2 + 0.0012), h], i3);
      const ang = Math.random() * 6.283, el = (Math.random() - 0.5) * 1.6, R = 0.5 + Math.random() * 0.6;
      const ax = 0.26 + R * Math.cos(ang) * Math.cos(el), ay = R * Math.sin(ang) * Math.cos(el), az = 0.375 + R * Math.sin(el);
      LP.A.set([ax, ay, az], i3);
      const a2 = ang + 1.5, R2 = R * 0.5;
      LP.M.set([0.26 + R2 * Math.cos(a2) * Math.cos(el), R2 * Math.sin(a2) * Math.cos(el), 0.375 + R2 * Math.sin(el) * 0.8], i3);
      LP.size.set([0.007 + Math.random() * 0.009, 0.0016 + Math.random() * 0.0026, 0.016 + Math.random() * 0.022], i3);
      setQ(LP.qA, i, randomQ(q)); setQ(LP.qB, i, q.setFromAxisAngle(yAxis, (Math.random() - 0.5) * 0.9));
      randomQ(q); LP.axis.set([q.x, q.y, q.z].map(v => v / (Math.hypot(q.x, q.y, q.z) || 1)), i3);
      LP.phase[i] = Math.random(); LP.delay[i] = 0.6 * h / 0.75 + 0.4 * Math.random();
      legPix(r / 0.52, h / 0.76, c); LP.mesh.instanceColor.array.set(c, i3);
    }
    LP.mesh.instanceColor.needsUpdate = true; legs[0].g.add(LP.mesh);
  }

  // ---- the top, with the gap, the knot and the hole open until the pour reaches them
  const pour = { value: 0 }, clock = { value: 0 }, landU = { value: new THREE.Vector3() };
  const rips = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) };     // x, y, start time, strength
  const topMat = wood(topMap, { roughnessMap: topRough, roughness: 1, clearcoat: 0.05, envMapIntensity: 0.2 });
  topMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uFlow: { value: topFlow }, uPour: pour, uTime: clock, uLand: landU, uRip: rips });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj; varying vec3 vTx; varying vec3 vTy;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position; vTx = normalMatrix * vec3(1.0, 0.0, 0.0); vTy = normalMatrix * vec3(0.0, 1.0, 0.0);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      uniform sampler2D uFlow; uniform float uPour; uniform float uTime; uniform vec3 uLand; uniform vec4 uRip[8];
      varying vec3 vObj; varying vec3 vTx; varying vec3 vTy;
      vec2 touch(vec2 p) {                                    // rings spreading from where the pointer touched
        vec2 g = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float age = uTime - uRip[i].z;
          if (uRip[i].w > 0.0 && age > 0.0 && age < 2.6) {
            vec2 d = p - uRip[i].xy; float dist = length(d) + 1e-4, r = age * 0.30;
            float q = (dist - r) / 0.04; g += d / dist * sin((dist - r) * 105.0) * exp(-q * q) * exp(-age * 1.4) * uRip[i].w;
          }
        }
        return g;
      }
      vec2 landing(vec2 p) {                                  // steady small rings where the stream lands
        vec2 d = p - uLand.xy; float dist = length(d) + 1e-4;
        return d / dist * sin(dist * 150.0 - uTime * 10.0) * exp(-dist * 13.0) * uLand.z;
      }`)
      .replace("#include <map_fragment>", `vec4 fl = texture2D(uFlow, vMapUv);
        if (fl.r > 0.5 && fl.g > uPour) discard;
        vec2 rip = touch(vObj.xy) + landing(vObj.xy) * fl.r;
        #ifdef USE_MAP
          diffuseColor *= texture2D(map, vMapUv + rip * 0.006);
        #endif
        float front = fl.r * smoothstep(0.05, 0.0, uPour - fl.g) * step(0.001, uPour) * step(uPour, 0.999);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.17, 0.10), front * 0.85);`)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + (vTx * rip.x + vTy * rip.y) * 0.95);");
  };
  const topG = new THREE.Group(); zup.add(topG);
  const topMesh = new THREE.Mesh(topParts().geometry, topMat); topG.add(topMesh);

  // the mould under the top for the pour: a pale board, so the open gap and the black epoxy read apart
  const form = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.24, 0.018), new THREE.MeshStandardMaterial({ color: 0x57493d, roughness: 0.8, envMapIntensity: 0.3 }));
  form.visible = false; zup.add(form);

  // the pour comes out of a pail, drawn in line like the first leg, and falls as a glossy black stream
  const POUR_H = 0.40, pourG = new THREE.Group(); pourG.visible = false; zup.add(pourG);
  const pail = (() => {
    const ax = new THREE.Vector3(Math.cos(-0.42), 0, Math.sin(-0.42)), up = new THREE.Vector3(0, 0, 1);       // the opening looks sideways and a little down
    const u = new THREE.Vector3().crossVectors(ax, up).normalize(), w = new THREE.Vector3().crossVectors(u, ax).normalize();
    const Rr = 0.085, Rb = 0.062, depth = 0.17, N = 40, lip = w.clone().multiplyScalar(-Rr), seg = [];
    const pt = (R, back, a) => u.clone().multiplyScalar(R * Math.cos(a)).addScaledVector(w, R * Math.sin(a)).addScaledVector(ax, -back).sub(lip);
    for (let i = 0; i < N; i++) {
      const a = 2 * Math.PI * i / N, b = 2 * Math.PI * (i + 1) / N;
      seg.push(...pt(Rr, 0, a).toArray(), ...pt(Rr, 0, b).toArray(), ...pt(Rb, depth, a).toArray(), ...pt(Rb, depth, b).toArray());
      if (i % 5 === 0) seg.push(...pt(Rr, 0, a).toArray(), ...pt(Rb, depth, a).toArray());
    }
    const l = lines(seg, 1.5); l.position.z = POUR_H; pourG.add(l); return l;
  })();
  const streamGeo = new THREE.CylinderGeometry(0.0075, 0.0045, 1, 12, 1, true); streamGeo.rotateX(Math.PI / 2); streamGeo.translate(0, 0, -0.5);   // hangs down from its top end
  const stream = new THREE.Mesh(streamGeo, new THREE.MeshPhysicalMaterial({ color: 0x0b0806, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }));
  stream.position.z = POUR_H; pourG.add(stream);
  const pourPath = data.pour, landAt = new THREE.Vector3();
  function pourPoint(v) {
    const f = clamp(v) * (pourPath.length - 1), i = Math.min(pourPath.length - 2, Math.floor(f)), t = smooth(f - i);
    return landAt.set(mix(pourPath[i][0], pourPath[i + 1][0], t), mix(pourPath[i][1], pourPath[i + 1][1], t), LEG_H + TOP_T);
  }

  // ---- the two raw slabs, lying side by side at the height of the top
  const SLAB_T = 0.055, SLAB_Z = LEG_H - 0.012, SLAB_X = 0.375;
  const gone = { value: 0 };
  const slabsG = new THREE.Group(); zup.add(slabsG);
  const slabs = [[data.slabs.A, slabA, -SLAB_X], [data.slabs.B, slabB, SLAB_X]].map(([o, map, x]) => {
    const part = slabParts(o, SLAB_T);
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.86, envMapIntensity: 0.45 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uGone = gone;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uGone;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec2 cell = floor(vMapUv * vec2(48.0, 134.0));
          float late = 0.6 * (1.0 - vMapUv.y) + 0.4 * fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          if (uGone > late * 0.5 + 0.004) discard;`);
    };
    const mesh = new THREE.Mesh(part.geometry, mat); mesh.position.set(x, 0, 0); slabsG.add(mesh);
    return { outline: part.outline, bb: bounds(part.outline), x, o, pix: sampler(map.image, 190, 532) };
  });

  // the pieces that leave the slabs and gather into the two halves of the top (positions in the table's frame)
  const TP = pieces(small ? 3200 : 7600, { spread: 0.5, melt: 0.94, tumble: 4, fromNothing: false, recolour: true });
  {
    const topPix = sampler(topMap.image, 550, 550), flowPix = sampler(topFlow.image, 550, 550);
    const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), c = [0, 0, 0], RT = TOP_R - 0.006;
    for (let i = 0; i < TP.n; i++) {
      const i3 = i * 3; let x, y;
      for (;;) {
        const a = Math.random() * 6.283, r = RT * Math.sqrt(Math.random()); x = r * Math.cos(a); y = r * Math.sin(a);
        if (flowPix(x / (2 * TOP_R) + 0.5, y / (2 * TOP_R) + 0.5, c, 0, true)[0] < 0.4) break;      // not where the resin goes
      }
      TP.B.set([x, y, LEG_H + TOP_T + 0.0015], i3);
      const s = slabs[x < 0 ? 0 : 1], [sx, sy] = pointIn(s.outline, s.bb);
      TP.A.set([s.x + sx, sy, SLAB_Z + SLAB_T + 0.0015], i3);
      const a2 = Math.random() * 6.283, r2 = 0.25 + Math.random() * 0.75;
      TP.M.set([r2 * Math.cos(a2), r2 * Math.sin(a2) * 1.3, LEG_H + 0.35 + Math.random() * 0.75], i3);
      TP.size.set([0.011 + Math.random() * 0.012, 0.022 + Math.random() * 0.03, 0.002 + Math.random() * 0.004], i3);
      setQ(TP.qA, i, q.setFromAxisAngle(zAxis, (Math.random() - 0.5) * 0.7)); setQ(TP.qB, i, q.setFromAxisAngle(zAxis, (Math.random() - 0.5) * 0.6));
      randomQ(q); TP.axis.set([q.x, q.y, q.z].map(v => v / (Math.hypot(q.x, q.y, q.z) || 1)), i3);
      TP.phase[i] = Math.random(); TP.delay[i] = 0.6 * (1 - (sy * 1000 / s.o.h + 0.5)) + 0.4 * Math.random();
      s.pix(sx * 1000 / s.o.w + 0.5, sy * 1000 / s.o.h + 0.5, c); TP.cA.set(c, i3);
      topPix(x / (2 * TOP_R) + 0.5, y / (2 * TOP_R) + 0.5, c); TP.cB.set(c, i3);
    }
    TP.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TP.n * 3), 3); TP.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    zup.add(TP.mesh);
  }

  // ---- the page around the canvas
  const land = stage.querySelector(".land");
  const chaps = [...stage.querySelectorAll(".chap")].map(el => ({ el, from: +el.dataset.from, to: +el.dataset.to }));
  for (const c of chaps) c.el.querySelectorAll("[data-split]").forEach(el => {
    const words = el.textContent.split(" "); el.textContent = "";
    words.forEach((w, i) => {
      const ws = document.createElement("span"); ws.className = "w";
      for (const ch of w) { const s = document.createElement("span"); s.className = "c"; s.textContent = ch; s.style.setProperty("--r", Math.random().toFixed(3)); ws.appendChild(s); }
      el.appendChild(ws); if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
  });
  const marks = [...stage.querySelectorAll(".marks li")].map(el => {
    const [x, y] = el.dataset.at.split(",").map(Number); return { el, at: new THREE.Vector3(x, y, LEG_H + TOP_T) };
  });
  const marksBox = stage.querySelector(".marks");

  let W = 1, H = 1, K = keys(true), p = 0, ps = 0, mx = 0, my = 0, mxs = 0, mys = 0, onscreen = true, first = true;
  function size() {
    W = stage.clientWidth; H = stage.clientHeight; gl.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix(); K = keys(W / H > 1.05);
    legLines.material.resolution.set(W, H); pail.material.resolution.set(W, H);
  }
  function where() { const r = story.getBoundingClientRect(); p = clamp(-r.top / Math.max(1, r.height - innerHeight)); }
  addEventListener("resize", () => { size(); where(); });
  addEventListener("scroll", where, { passive: true });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) addEventListener("pointermove", e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; });
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { onscreen = es[0].isIntersecting; }).observe(story);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), topPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(LEG_H + TOP_T)), hit = new THREE.Vector3();
  let ripI = 0, ripAt = [9, 9], ripT = 0;
  function touchTop(e, force) {
    if (ps < T_POUR[0] - 0.035 || ps > T_BACK[0] + 0.005) return;
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); if (!ray.ray.intersectPlane(topPlane, hit)) return;
    zup.worldToLocal(hit); if (hit.x * hit.x + hit.y * hit.y > TOP_R * TOP_R) return;
    const now = performance.now() * 0.001;
    if (!force && Math.hypot(hit.x - ripAt[0], hit.y - ripAt[1]) < 0.045 && now - ripT < 0.5) return;
    rips.value[ripI].set(hit.x, hit.y, now, force ? 1.3 : 0.8); ripI = (ripI + 1) % rips.value.length; ripAt = [hit.x, hit.y]; ripT = now;
  }
  addEventListener("pointermove", e => touchTop(e, false), { passive: true });
  addEventListener("pointerdown", e => touchTop(e, true), { passive: true });
  size(); where(); ps = p;

  const tmp = new THREE.Vector3(), R = (v, a) => ramp(v, a[0], a[1]);
  function draw(time) {
    requestAnimationFrame(draw);
    if (!onscreen) return;
    ps += (p - ps) * 0.11; if (Math.abs(p - ps) < 0.0002) ps = p;
    mxs += (mx - mxs) * 0.06; mys += (my - mys) * 0.06;
    const k = keyAt(K, ps), wide = W / H > 1.05;
    const tLeg = R(ps, T_LEG), fan = easeOut(R(ps, T_FAN)), away = smooth(R(ps, T_OUT)) - smooth(R(ps, T_BACK));
    const slabsIn = easeOut(R(ps, T_SLABS)), tTop = R(ps, T_TOP), look = R(ps, T_LOOK);

    // the first leg: drawing, then pieces, then solid
    movePieces(LP, tLeg, time);
    legs[0].mesh.visible = tLeg >= 0.86;
    legLines.material.opacity = 1 - ramp(tLeg, 0.55, 0.95); legLines.visible = legLines.material.opacity > 0.01;
    for (let i = 1; i < 4; i++) {
      legs[i].g.visible = fan > 0;
      legs[i].g.rotation.z = mix(LEG_ANGLES[0], i === 3 ? LEG_ANGLES[0] - Math.PI / 2 : LEG_ANGLES[i], fan);
    }
    legsG.visible = away < 0.995; legsG.position.z = -2.6 * away;

    // slabs come down, break into pieces, gather into the top; then the pour
    slabsG.visible = slabsIn > 0 && tTop < 0.52; slabsG.position.z = SLAB_Z + 2.4 * (1 - slabsIn);
    gone.value = tTop;
    movePieces(TP, tTop, time);
    topMesh.visible = tTop >= 0.9;
    const pt = R(ps, T_POUR); pour.value = pt * 1.01; clock.value = time * 0.001;
    const pouring = pt > 0.001 && pt < 0.999 && topMesh.visible;
    pourG.visible = pouring;
    if (pouring) {
      const L = pourPoint(pt + 0.012), start = ramp(pt, 0, 0.035), end = ramp(pt, 0.95, 0.999);
      pourG.position.set(L.x, L.y, L.z);
      pail.material.opacity = ramp(pt, 0, 0.02) * (1 - ramp(pt, 0.975, 0.999));
      pail.rotation.y = Math.sin(time * 0.0016) * 0.035; pail.rotation.z = Math.sin(time * 0.0011) * 0.05;
      stream.scale.set(1 + Math.sin(time * 0.013) * 0.08, 1 + Math.cos(time * 0.011) * 0.08, POUR_H * start * (1 - end));
      stream.position.z = POUR_H * (1 - end);
      landU.value.set(L.x, L.y, start >= 1 ? 1 - end : 0);
    } else landU.value.z = 0;
    const formIn = easeOut(ramp(tTop, 0.42, 0.8)), formOut = smooth(ramp(ps, T_POUR[1] + 0.004, T_BACK[0] + 0.035));
    form.visible = formIn > 0 && formOut < 1; form.position.z = LEG_H - 0.0095 - 1.4 * (1 - formIn) - 2.6 * formOut;

    const tanF = Math.tan(FOV * Math.PI / 360);
    const dist = Math.max(k.fh / (2 * tanF * (wide ? 0.74 : 0.50)), k.fw / (2 * tanF * cam.aspect * (wide ? k.use : 0.86)));
    const calm = 1 - 0.8 * look, idle = 1 - ramp(ps, 0, 0.06);
    const az = k.az + Math.sin(time * 0.0005) * 0.85 * idle + mxs * 0.22 * calm, el = clamp(k.el + Math.sin(time * 0.00037) * 0.06 * idle - mys * 0.10 * calm, -0.2, 1.5);
    cam.position.set(k.t[0] + dist * Math.sin(az) * Math.cos(el), k.t[1] + dist * Math.sin(el), k.t[2] + dist * Math.cos(az) * Math.cos(el));
    cam.lookAt(k.t[0], k.t[1], k.t[2]);
    cam.setViewOffset(W, H, wide ? -k.sx * W : 0, wide ? -0.03 * H : mix(0.03, 0.15, ramp(ps, 0.02, 0.07)) * H, W, H);
    gl.render(scene, cam);

    const goneCue = ramp(ps, 0.01, 0.045);
    land.style.opacity = 1 - goneCue; land.style.visibility = goneCue < 1 ? "visible" : "hidden";
    for (const c of chaps) {
      const q = ramp(ps, c.from, c.from + 0.045), out = 1 - ramp(ps, c.to - 0.03, c.to);
      c.el.style.setProperty("--q", q.toFixed(3)); c.el.style.opacity = q > 0 ? out : 0; c.el.style.visibility = q > 0 && out > 0 ? "visible" : "hidden";
    }
    marksBox.style.opacity = look; marksBox.style.visibility = look > 0 ? "visible" : "hidden";
    if (look > 0) for (const m of marks) {
      tmp.copy(m.at); zup.localToWorld(tmp); tmp.project(cam);
      m.el.style.transform = `translate3d(${((tmp.x + 1) / 2 * W).toFixed(1)}px, ${((1 - tmp.y) / 2 * H).toFixed(1)}px, 0)`;
    }
    if (first) { first = false; document.documentElement.classList.add("live"); }
  }
  requestAnimationFrame(draw);
}

// ---------------------------------------------------------------- the leg, measured
// One leg as a line drawing with its dimensions (mm) and angles, taken from the final leg outline. Drag to turn it.
// Each dimension draws itself as the picture scrolls into view; the numbers count up.
const DIMS = [   // lin: from a to b (r, h in m), drawn off to the side by `off`; ang: arc round c from `from` to `to` degrees
  { kind: "lin", a: [0.395, 0], b: [0.51, 0.75], off: [0.105, 0], axis: "h", value: 750 },
  { kind: "lin", a: [0.04, 0.75], b: [0.51, 0.75], off: [0, 0.07], axis: "r", value: 470 },
  { kind: "lin", a: [0, 0.75], b: [0.04, 0.75], off: [0, 0.07], axis: "r", value: 40, ext: [0, 0.107] },
  { kind: "lin", a: [0.04, 0.72], b: [0.04, 0.75], off: [-0.06, 0], axis: "h", value: 30 },
  { kind: "ang", c: [0.48, 0.72], from: 0, to: 45, rad: 0.075, value: 45 },
  { kind: "ang", c: [0.395, 0], from: 113, to: 180, rad: 0.10, value: 67 },
  { kind: "ang", c: [0.2602, 0.1595], from: 118, to: 180, rad: 0.085, value: 62 },
  { kind: "lin", a: [0.345, 0], b: [0.395, 0], off: [0, -0.06], axis: "r", value: 50 },
  { kind: "lin", a: [0, 0], b: [0.345, 0], off: [0, -0.06], axis: "r", value: 345, ext: [0, 0.077] },
  { kind: "lin", a: [0, 0.077], b: [0, 0.107], off: [-0.06, 0], axis: "h", value: 30 },
  { kind: "deep", at: [0.51, 0.75], off: [0.045, 0.03], value: 40 },
];
async function legViewer(canvas) {
  const box = canvas.parentNode, labels = box.querySelector(".lv-labels");
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  gl.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const data = await fetch(canvas.dataset.base + "leg.json?v=" + canvas.dataset.v).then(r => r.json());
  const leg = legParts(data.leg);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
  const turn = new THREE.Group(), zup = new THREE.Group(); zup.rotation.x = -Math.PI / 2; turn.add(zup); scene.add(turn);
  const legG = new THREE.Group(); legG.position.set(-0.255, 0, -0.375); zup.add(legG);        // turn about the middle of the leg
  const mats = [];
  const draw = (seg, width, colour, opacity) => { const l = lines(seg, width); l.material.color.set(colour); l.material.opacity = opacity; mats.push(l.material); return l; };
  legG.add(draw(leg.segments, 2, LINE, 1));
  legG.add(draw([0, 0, -0.05, 0, 0, 0.84], 1, LINE, 0.35));                                     // the table's axis
  const Y = -T / 2, INK = 0xf2e8d4, items = [];
  for (const d of DIMS) {
    const seg = [], g = new THREE.Group(); let pivot, at;
    if (d.kind === "lin") {
      const a2 = [d.a[0] + d.off[0], d.a[1] + d.off[1]], b2 = [d.b[0] + d.off[0], d.b[1] + d.off[1]];
      if (d.axis === "h") a2[0] = b2[0] = Math.max(a2[0], b2[0]) * (d.off[0] > 0 ? 1 : 0) + (d.off[0] > 0 ? 0 : Math.min(a2[0], b2[0]));
      else a2[1] = b2[1] = d.off[1] > 0 ? Math.max(a2[1], b2[1]) : Math.min(a2[1], b2[1]);
      pivot = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
      const P = (p) => [p[0] - pivot[0], 0, p[1] - pivot[1]], tk = 0.012;
      const ea = d.ext ? [d.a[0], d.ext[1]] : d.a, eb = d.b;
      seg.push(...P(a2), ...P(b2), ...P(ea), ...P(a2), ...P(eb), ...P(b2));
      for (const e of [a2, b2]) seg.push(...P([e[0] - tk, e[1] - tk]), ...P([e[0] + tk, e[1] + tk]));       // slashes at the ends
      const n = Math.hypot(d.off[0], d.off[1]) || 1; at = [pivot[0] + d.off[0] / n * 0.034, Y, pivot[1] + d.off[1] / n * 0.03];
    } else if (d.kind === "ang") {
      pivot = d.c; const N = 24;
      for (let i = 0; i < N; i++) {
        const t0 = (d.from + (d.to - d.from) * i / N) * Math.PI / 180, t1 = (d.from + (d.to - d.from) * (i + 1) / N) * Math.PI / 180;
        seg.push(d.rad * Math.cos(t0), 0, d.rad * Math.sin(t0), d.rad * Math.cos(t1), 0, d.rad * Math.sin(t1));
      }
      for (const t of [d.from, d.to]) { const a = t * Math.PI / 180; seg.push(0, 0, 0, d.rad * 1.18 * Math.cos(a), 0, d.rad * 1.18 * Math.sin(a)); }
      const mid = (d.from + d.to) / 2 * Math.PI / 180; at = [d.c[0] + d.rad * 1.42 * Math.cos(mid), Y, d.c[1] + d.rad * 1.42 * Math.sin(mid)];
    } else {                                                   // the thickness, across the leg
      pivot = [d.at[0] + d.off[0], d.at[1] + d.off[1]];
      seg.push(0, -T / 2 - Y, 0, 0, T / 2 - Y, 0, -d.off[0], -T / 2 - Y, -d.off[1], 0, -T / 2 - Y, 0, -d.off[0], T / 2 - Y, -d.off[1], 0, T / 2 - Y, 0);
      at = [pivot[0] + 0.03, 0, pivot[1] + 0.012];
    }
    g.position.set(pivot[0], Y, pivot[1]);
    const l = draw(seg, 1.2, d.kind === "ang" ? LINE : INK, 0); g.add(l); legG.add(g);
    const el = document.createElement("span"); el.className = "lv-n" + (d.kind === "ang" ? " ang" : ""); labels.appendChild(el);
    items.push({ d, g, l, el, at: new THREE.Vector3(...at), shown: -1 });
  }

  let W = 1, H = 1, az = -0.5, el = 0.1, drag = null, vel = 0, seen = false, prog = 0;
  function size() {
    W = box.clientWidth; H = box.clientHeight; gl.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    for (const m of mats) m.resolution.set(W, H);
  }
  addEventListener("resize", size); size();
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); box.classList.add("held"); });
  canvas.addEventListener("pointermove", e => {
    if (!drag) return;
    az = clamp(az - (e.clientX - drag.x) * 0.005, -0.95, 0.95); el = clamp(el + (e.clientY - drag.y) * 0.004, -0.35, 0.7); vel = 0;
    drag = { x: e.clientX, y: e.clientY };
  });
  const drop = () => { drag = null; box.classList.remove("held"); };
  canvas.addEventListener("pointerup", drop); canvas.addEventListener("pointercancel", drop);
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { seen = es[0].isIntersecting; }).observe(box); else seen = true;

  const v = new THREE.Vector3();
  function frame(time) {
    requestAnimationFrame(frame);
    if (!seen) return;
    const r = box.getBoundingClientRect();
    prog += (clamp((innerHeight * 0.92 - r.top) / (innerHeight * 0.75)) - prog) * 0.1;
    const sway = drag ? 0 : Math.sin(time * 0.0004) * 0.10;
    const tanF = Math.tan(24 * Math.PI / 360), dist = Math.max(1.02 / (2 * tanF), 0.95 / (2 * tanF * cam.aspect));
    const a = az + sway;
    cam.position.set(dist * Math.sin(a) * Math.cos(el), dist * Math.sin(el) + 0.01, dist * Math.cos(a) * Math.cos(el)); cam.lookAt(0, 0.01, 0);
    items.forEach((it, i) => {
      const t = easeOut(ramp(prog, 0.12 + i * 0.065, 0.34 + i * 0.065));
      it.l.material.opacity = t * (it.d.kind === "ang" ? 0.95 : 0.6); it.l.visible = t > 0.01; it.g.scale.setScalar(Math.max(t, 0.001));
      const n = Math.round(it.d.value * t);
      if (n !== it.shown) { it.shown = n; it.el.textContent = n + (it.d.kind === "ang" ? "°" : ""); }
      v.copy(it.at); legG.localToWorld(v); v.project(cam);
      it.el.style.opacity = t; it.el.style.transform = `translate3d(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px, 0) translate(-50%, -50%)`;
    });
    gl.render(scene, cam);
  }
  requestAnimationFrame(frame);
  box.classList.add("live");
}

const canvas = document.getElementById("table3d");
const still = () => document.documentElement.classList.add("static");
if (!canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) still();
else start(canvas).catch(e => { console.warn("3D landing off:", e); still(); });

// the measured leg starts when it comes near the screen; without WebGL the flat drawing under it stays
const lv = document.getElementById("leg3d");
if (lv) {
  const go = () => legViewer(lv).catch(e => console.warn("3D leg off:", e));
  if ("IntersectionObserver" in window) { const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: "600px 0px" }); io.observe(lv); }
  else go();
}
