// The landing: the table drawn live in 3D and driven by the scroll position.
// The leg as a line drawing -> small pieces of walnut pack into it -> four legs -> the two raw slabs ->
// the real cuts, the offcuts lifting away whole -> the two pieces laid for the pour -> the pour seen from the ground,
// looking along the gap -> flattened, sanded and cut round -> the table -> from above.
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
  const n = P.length, pos = [], nor = [], uv = [], row = [], idx = [];
  const uvOf = p => [p[0] * 1000 / o.w + 0.5, p[1] * 1000 / o.h + 0.5];
  for (const p of P) { const t = uvOf(p); pos.push(p[0], p[1], th); nor.push(0, 0, 1); uv.push(...t); row.push(t[1]); }
  for (const [a0, b0, c0] of THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), [])) {
    const A = P[a0], B = P[b0], C = P[c0];
    (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0 ? idx.push(a0, b0, c0) : idx.push(a0, c0, b0);
  }
  const nTop = idx.length;
  // the live edge leans: the underside reaches a little further out than the top, by an amount that wanders along the edge
  const out = P.map((_, i) => { const a = P[(i + n - 1) % n], b = P[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [ty / l, -tx / l]; });
  const arc = [0]; for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(P[i % n][0] - P[i - 1][0], P[i % n][1] - P[i - 1][1]));
  const lean = P.map((_, i) => { const a = arc[i] / arc[n] * 6.2832; return 0.010 + 0.005 * Math.sin(a * 7 + 1.3) + 0.003 * Math.sin(a * 19 + 0.4) + 0.0015 * Math.sin(a * 43); });
  const Q = P.map((p, i) => [p[0] + out[i][0] * lean[i], p[1] + out[i][1] * lean[i]]);
  const rings = [[0, th], [0.3, th * 0.72], [0.72, th * 0.3], [1, 0]], R = rings.length;      // how far out, at what height: a rounded lean
  for (let i = 0; i <= n; i++) for (const [f, z] of rings) {
    const j = i % n, s = lean[j] / th, l = Math.hypot(1, s);
    pos.push(P[j][0] + out[j][0] * lean[j] * f, P[j][1] + out[j][1] * lean[j] * f, z); nor.push(out[j][0] / l, out[j][1] / l, s / l);
    uv.push(arc[i] / 0.32, z / th); row.push(uvOf(P[j])[1]);
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < R - 1; k++) { const a = n + R * i + k, b = n + R * (i + 1) + k; idx.push(a, a + 1, b + 1, a, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("row", new THREE.Float32BufferAttribute(row, 1));
  g.setIndex(idx); g.addGroup(0, nTop, 0); g.addGroup(nTop, idx.length - nTop, 1);       // the face, then the live edge
  return { geometry: g, outline: P, under: Q };
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

// where a horizontal line at y crosses an outline: the leftmost and rightmost crossing
function spanAt(P, y) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y)) { const x = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  }
  return [lo, hi];
}

function tone(image) {                                         // the average colour of the wood in a picture
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(image, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : [124, 96, 74];
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function paint(w, h, at) {                                     // a texture drawn point by point; at(i, j) gives [r, g, b] 0..255
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), im = g.createImageData(w, h), d = im.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = (j * w + i) * 4, v = at(i, j); d[q] = v[0]; d[q + 1] = v[1]; d[q + 2] = v[2]; d[q + 3] = 255; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const grit = (i, j) => Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1);
// the sawn end of a slab cut near the heart of the tree: the year rings arc round a centre just under the board,
// each ring darkening toward its end; fine rays, saw marks, a slightly paler band at the two live edges
function endGrain(seed, rgb) {
  let s = seed; const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  const w = 2048, h = 192, px = 570 / w, py = 55 / h, cx = 570 * (0.38 + 0.24 * rnd()), cy = 80 + 45 * rnd(), q1 = rnd() * 6.28, q2 = rnd() * 6.28, out = [0, 0, 0];
  return paint(w, h, (i, j) => {
    const X = i * px, Y = j * py, dx = X - cx, dy = (Y - cy) * 1.12, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), n = grit(i, j);
    const rr = r + 2.4 * Math.sin(ang * 5 + q1) + 1.1 * Math.sin(ang * 13 + q2), ph = rr / 5.6 + 0.9 * Math.sin(rr * 0.035 + q1), v = ph - Math.floor(ph);
    const late = sstep(0.45, 0.95, v) * (1 - sstep(0.95, 1, v)), ray = Math.pow(0.5 + 0.5 * Math.sin(ang * 300 + n * 1.5), 10);
    const saw = 0.5 + 0.5 * Math.sin(Math.hypot(X - 820, Y + 300) * 2.1), edge = Math.min(X, 570 - X), sap = (1 - sstep(14, 40 + 8 * Math.sin(Y * 0.2 + q2), edge)) * 0.3;
    const broad = 0.05 * Math.sin(X * 0.017 + q1) + 0.04 * Math.sin(r * 0.03 + q2);
    const k = (1 - 0.15 * late + 0.025 * ray - 0.012 * saw + 0.06 * (n - 0.5) + broad) * (1 + 0.45 * sap) * (1 - 0.08 * Y / 55);
    out[0] = rgb[0] * 0.62 * k; out[1] = rgb[1] * 0.525 * k; out[2] = rgb[2] * 0.47 * k; return out;
  });
}
// the live edge: darker than the face, with long fibres running along it. It repeats along the edge.
function edgeGrain(rgb) {
  const w = 512, h = 128, T2 = 6.2832 / w, out = [0, 0, 0];
  const t = paint(w, h, (i, j) => {
    const a = i * T2, n = grit(i, j);
    const fib = 0.5 * Math.sin(j * 0.55 + 2.0 * Math.sin(a * 3 + 1)) + 0.3 * Math.sin(j * 1.9 + 3.0 * Math.sin(a * 7)) + 0.2 * Math.sin(j * 0.21 + a * 5);
    const k = 0.80 + 0.07 * fib + 0.14 * (n - 0.5) + 0.10 * sstep(0.2, 0.8, 0.5 + 0.5 * Math.sin(a * 4 + 2.0 * Math.sin(j * 0.07)));
    out[0] = rgb[0] * 0.56 * k; out[1] = rgb[1] * 0.47 * k; out[2] = rgb[2] * 0.41 * k; return out;
  });
  t.wrapS = THREE.RepeatWrapping; return t;
}

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
    const k = S.dust ? Math.sin(Math.PI * u) : born * (u >= 1 ? melt : 1);
    _s.set(size[i3] * k, size[i3 + 1] * k, size[i3 + 2] * k);
    _m.compose(_p, _qa, _s); _m.toArray(out, i * 16);
    if (S.recolour) { col[i3] = mix(cA[i3], cB[i3], e); col[i3 + 1] = mix(cA[i3 + 1], cB[i3 + 1], e); col[i3 + 2] = mix(cA[i3 + 2], cB[i3 + 2], e); }
  }
  S.mesh.instanceMatrix.needsUpdate = true; if (S.recolour) S.mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- the scroll story
// p: where in the story (0 to 1). az/el: camera angles. t: what it looks at. fw/fh: the size to keep in frame (m).
// sx: how far right of centre the subject sits on a wide screen. use: share of the width it may fill.
// sy: how far below its usual place the subject sits (share of the height). par: how much the pointer moves the camera.
const T_LEG = [0.04, 0.13], T_FAN = [0.16, 0.22], T_OUT = [0.235, 0.29], T_SLABS = [0.24, 0.31], T_CUT = [0.345, 0.515], T_EYE = [0.50, 0.545, 0.705, 0.75],
  T_POUR = [0.56, 0.70], T_FIN = [0.75, 0.835], T_BACK = [0.84, 0.895], T_LOOK = [0.93, 0.975];
function keys(wide, eyeAt) {
  const slabAz = wide ? Math.PI / 4 : -Math.PI / 4;             // slabs lie across a wide screen, upright on a tall one
  const slab = { t: [0, 0.78, 0], fw: wide ? 2.35 : 1.45, fh: wide ? 1.30 : 1.85, sx: wide ? 0.21 : 0.13, use: 0.55 };
  // from the ground: level with the two pieces, looking along the gap. The thickness of the wood is the height on screen.
  const eye = { az: -Math.PI / 4, el: 0.045, t: eyeAt, fw: 0.26, fh: 0.195, sx: 0, sy: 0.10, use: 0.60, par: 0.3 };
  return [
    { p: 0.00, az: 0.00, el: 0.05, t: [0.26, 0.375, 0], fw: 0.62, fh: 0.84, sx: 0, use: 0.80 },
    { p: 0.055, az: 0.60, el: 0.13, t: [0.26, 0.375, 0], fw: 0.70, fh: 0.92, sx: 0.19, use: 0.48 },
    { p: 0.14, az: 0.35, el: 0.10, t: [0.26, 0.375, 0], fw: 0.68, fh: 0.90, sx: 0.19, use: 0.48 },
    { p: 0.225, az: 0.15, el: 0.22, t: [0, 0.40, 0], fw: 1.22, fh: 0.98, sx: 0.17, use: 0.58 },
    Object.assign({ p: 0.31, az: slabAz, el: 0.92 }, slab),
    Object.assign({ p: 0.495, az: slabAz, el: 1.0 }, slab),
    Object.assign({ p: 0.548 }, eye),
    Object.assign({ p: 0.705 }, eye),
    { p: 0.775, az: -Math.PI / 4 + 0.2, el: 1.22, t: [0, 0.79, 0], fw: 1.55, fh: 1.4, sx: 0.15, use: 0.60 },
    { p: 0.83, az: -Math.PI / 4 + 0.28, el: 1.2, t: [0, 0.79, 0], fw: 1.55, fh: 1.4, sx: 0.15, use: 0.60 },
    { p: 0.895, az: -0.35, el: 0.42, t: [0, 0.45, 0], fw: 1.28, fh: 1.05, sx: 0.15, use: 0.60 },
    { p: 0.975, az: -Math.PI / 4, el: 1.45, t: [0, 0.79, 0], fw: 1.26, fh: 1.26, sx: 0.15, use: 0.62 },
  ];
}
function keyAt(K, p) {
  let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], t = smooth(ramp(p, a.p, b.p)), o = {};
  for (const k of ["az", "el", "fw", "fh", "sx", "use"]) o[k] = mix(a[k], b[k], t);
  o.sy = mix(a.sy || 0, b.sy || 0, t); o.par = mix(a.par ?? 1, b.par ?? 1, t);
  o.t = a.t.map((v, j) => mix(v, b.t[j], t));
  return o;
}

// rings that spread over the screen from where the pointer touched the epoxy: xy is the push, z the crest. Only the liquid draws them.
const RINGS = `uniform vec4 uDrop[8]; uniform vec2 uRes;
  vec3 rings(vec2 fc) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.0), uv = fc / uRes, push = vec2(0.0); float crest = 0.0;
    for (int i = 0; i < 8; i++) {
      float age = uTime - uDrop[i].z;
      if (uDrop[i].w > 0.0 && age > 0.0 && age < 3.4) {
        vec2 d = (uv - uDrop[i].xy) * asp; float dist = length(d) + 1e-4, r = 0.02 + age * 0.17, q = (dist - r) / 0.055;
        float w = sin((dist - r) * 58.0) * exp(-q * q) * exp(-age * 1.25) * smoothstep(0.0, 0.25, age) * uDrop[i].w;
        push += d / dist * w; crest += w;
      }
    }
    return vec3(push, crest);
  }`;

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
  const [data, topMap, topRough, topFlow, slabA, slabB, layFin, layMask, ...legMaps] = await Promise.all([
    fetch(base + "leg.json" + v).then(r => r.json()),
    tex("top.jpg"), tex("top-rough.jpg", false), tex("top-flow.png", false), tex("slab-a.jpg"), tex("slab-b.jpg"), tex("layout-fin.jpg"), tex("layout-mask.png", false),
    tex("leg1.jpg"), tex("leg2.jpg"), tex("leg3.jpg"), tex("leg4.jpg"),
  ]);
  for (const t of [topFlow, layMask]) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 1; }

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(gl);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.fog = new THREE.Fog(0x0b0a09, 100, 200);                // only drawn in for the pour: the far end of the gap sinks into the dark
  const key = new THREE.DirectionalLight(0xffe6cc, 2.4); key.position.set(2.5, 3.2, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc09a, 2.4); rim.position.set(-3, 1.6, -3); scene.add(rim);
  const front = new THREE.DirectionalLight(0xffe4c8, 0); front.position.set(-2.3, 1.7, 0.6); scene.add(front);   // only for the pour: lights the sawn ends facing the camera
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

  // ---- the round top (the finished table): filled, with the water touch
  const pour = { value: 1.01 }, clock = { value: 0 }, landU = { value: new THREE.Vector3() };
  const rips = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) };     // x, y, start time, strength
  const dropU = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) }, resU = { value: new THREE.Vector2(1, 1) };     // the same on the screen, for the pour
  const nearU = { value: 0 }, gapU = { value: 0 };             // 1 while the pour is watched from the ground; where the gap is
  // from the ground the light sits on the gap and falls away to the sides
  const VIG = "mix(1.0, mix(0.20, 1.0, smoothstep(0.38, 0.07, abs(vWx - uGx))), uNear)";
  const stageLit = sh => {
    sh.uniforms.uNear = nearU; sh.uniforms.uGx = gapU;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWx; varying float vWy;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec4 wp4 = modelMatrix * vec4(transformed, 1.0); vWx = 0.7071 * (wp4.x + wp4.z); vWy = 0.7071 * (wp4.x - wp4.z);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNear; uniform float uGx; varying float vWx; varying float vWy;");
  };
  const topMat = wood(topMap, { roughnessMap: topRough, roughness: 1, clearcoat: 0.05, envMapIntensity: 0.2 });
  topMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uFlow: { value: topFlow }, uPour: pour, uTime: clock, uLand: landU, uRip: rips });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj; varying vec3 vTx; varying vec3 vTy;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position; vTx = normalMatrix * vec3(1.0, 0.0, 0.0); vTy = normalMatrix * vec3(0.0, 1.0, 0.0);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      uniform float uTime; uniform vec4 uRip[8];
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
      }`)
      .replace("#include <map_fragment>", `vec2 rip = touch(vObj.xy);
        #ifdef USE_MAP
          diffuseColor *= texture2D(map, vMapUv + rip * 0.006);
        #endif`)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(normal + (vTx * rip.x + vTy * rip.y) * 0.95);");
  };
  const topG = new THREE.Group(); zup.add(topG);
  const topMesh = new THREE.Mesh(topParts().geometry, topMat); topMesh.visible = false; topG.add(topMesh);

  // ---- the two raw slabs: sawn where they really were (25 Oct), the offcuts lifted away whole, the two pieces laid for the pour
  // Layout frame (slabs/pieces.py): mm, x to the right, y down from piece A's top cut; the circle's centre is (cx, cy).
  const LY = data.layout, SLAB_T = 0.055, PIECE_TOP = LEG_H + TOP_T - 0.002, SLAB_Z = PIECE_TOP - SLAB_T, SLAB_X = 0.375;
  const Y_SECT = (LY.cy - LY.piece) / 1000;                     // piece A's near sawn end: the plane the pour is watched at
  const lineMats = [legLines.material];
  const slabsG = new THREE.Group(); zup.add(slabsG);
  const capMats = { A: endGrain(7, tone(slabA.image)), B: endGrain(23, tone(slabB.image)) };
  for (const n in capMats) {
    capMats[n] = new THREE.MeshStandardMaterial({ map: capMats[n], roughness: 0.8, envMapIntensity: 0.35, side: THREE.DoubleSide });
    capMats[n].onBeforeCompile = sh => {
      stageLit(sh);
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= " + VIG + " * mix(1.0, mix(0.58, 1.0, smoothstep(0.0, 0.9, vMapUv.y)), uNear);");
    };
  }
  // the sawn ends mirrored in the bench, fading out a little way down
  const reflMat = n => {
    const m = new THREE.MeshBasicMaterial({ map: capMats[n].map, color: 0x9a8f88, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
    m.onBeforeCompile = sh => {
      stageLit(sh);
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= " + VIG + "; diffuseColor.a *= uNear * 0.20 * exp(-vMapUv.y * 3.6);");
    };
    return m;
  };
  const slabs = [["A", slabA, -SLAB_X, 0, 0], ["B", slabB, SLAB_X, LY.ox, LY.off]].map(([n, map, x0, dx, dy]) => {
    const o = data.slabs[n], part = slabParts(o, SLAB_T), [ra, rb] = LY.cuts[n].rows, st = LY.piece / (rb - ra), edgeMap = edgeGrain(tone(map.image));
    const mk = (lo, hi) => {                                    // one stretch of the slab between two rows of its picture
      const u = { lo: { value: 1 - hi / o.h }, hi: { value: 1 - lo / o.h } };
      const rows = (mat, extra = "") => {
        mat.onBeforeCompile = sh => {
          Object.assign(sh.uniforms, { uLo: u.lo, uHi: u.hi });
          sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float row; varying float vRow;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRow = row;");
          sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uLo; uniform float uHi; varying float vRow;")
            .replace("#include <map_fragment>", "if (vRow < uLo || vRow > uHi) discard;\n#include <map_fragment>\ndiffuseColor.rgb *= " + VIG + ";" + extra);
          stageLit(sh);
        };
        mat.customProgramCacheKey = () => "slab" + extra;
        return mat;
      };
      const mats = [rows(new THREE.MeshStandardMaterial({ map, roughness: 0.86, envMapIntensity: 0.45 })),
        rows(new THREE.MeshStandardMaterial({ map: edgeMap, roughness: 0.92, envMapIntensity: 0.3 }), "\ndiffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 0.8, vMapUv.y)) * mix(1.0, 0.10 * mix(1.0, 0.35, smoothstep(0.0, 0.5, vWy - (" + Y_SECT.toFixed(4) + "))), uNear);")];   // the edge is darker toward its foot; inside the gap it stands in shadow, deeper the further in
      const g = new THREE.Group(); g.add(new THREE.Mesh(part.geometry, mats)); g.position.set(x0, 0, 0); slabsG.add(g);
      return { g, u };
    };
    const setCap = (m, ly) => {                                 // a sawn face across the slab at y: as wide as the top at the top, as the underside at the foot
      const [lt, rt] = spanAt(part.outline, ly), [lb, rb2] = spanAt(part.under, ly), a = m.geometry.attributes, wd = rb2 - lb;
      a.position.array.set([lt, ly, SLAB_T, rt, ly, SLAB_T, rb2, ly, 0, lb, ly, 0]); a.position.needsUpdate = true;
      a.uv.array.set([(lt - lb) / wd, 1, (rt - lb) / wd, 1, 1, 0, 0, 0]); a.uv.needsUpdate = true; m.geometry.computeBoundingSphere();
    };
    const cap = (q, i) => {                                     // the fresh sawn face at a cut
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(12, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(8, 2));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
      const m = new THREE.Mesh(g, capMats[n]); setCap(m, (o.h / 2 - LY.cuts[n].rows[i]) / 1000); q.g.add(m); return m;
    };
    const piece = mk(ra, rb), offs = [mk(-1, ra), mk(rb, o.h + 1)];
    cap(piece, 0); const nearCap = cap(piece, 1); cap(offs[0], 0); cap(offs[1], 1);
    const mirror = new THREE.Mesh(nearCap.geometry, reflMat(n)); mirror.scale.z = -1; mirror.renderOrder = 2; mirror.visible = false; piece.g.add(mirror);
    const saws = [0, 1].map(i => {                              // the saw line across the slab at each cut
      const [l, r] = LY.cuts[n].x[i], row = LY.cuts[n].rows[i], len = (r - l + 50) / 1000;
      const g = new THREE.Group(), ln = lines([0, 0, 0, len, 0, 0], 2.6); lineMats.push(ln.material);
      g.position.set(x0 + (l - 25 - o.w / 2) / 1000, (o.h / 2 - row) / 1000, SLAB_T + 0.004); g.add(ln); slabsG.add(g);
      return { g, ln };
    });
    // where the piece goes for the pour: its rows stretched to 1270 mm, placed in the layout
    const to = { x: (o.w / 2 + dx - LY.cx) / 1000, y: (LY.cy - dy + ra * st - st * o.h / 2) / 1000, s: st };
    // for the view from the ground both pieces end in one plane: the row of this slab that lies in that plane
    const sectRow = o.h / 2 - (Y_SECT - to.y) / to.s * 1000;
    return { n, o, x0, outline: part.outline, piece, offs, saws, rows: [ra, rb], to, nearCap, mirror, setCap, sect: Math.abs(sectRow - rb) > 1 ? sectRow : null };
  });

  // the bench under the pieces: a wide matte board. For the view from the ground it runs on toward the camera and fades out,
  // darker, with the shadow the two pieces throw where they stand on it.
  const formU = { uNear: nearU, uGx: gapU, uMask: { value: layMask }, uL: { value: new THREE.Vector4(LY.cx, LY.cy, LY.size, Y_SECT) } };
  const formMat = new THREE.MeshStandardMaterial({ color: 0x4d4037, roughness: 0.78, envMapIntensity: 0.3, transparent: true });
  formMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, formU);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vF;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvF = position.xy;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNear; uniform float uGx; uniform sampler2D uMask; uniform vec4 uL; varying vec2 vF;")
      .replace("#include <map_fragment>", `float formA = smoothstep(mix(-0.861, -1.02, uNear), mix(-0.859, -0.62, uNear), vF.y);
        if (formA < 0.004) discard;
        #include <map_fragment>
        float gap = texture2D(uMask, vec2((vF.x * 1000.0 + uL.x) / uL.z, 1.0 - (uL.y - vF.y * 1000.0) / uL.z)).r * step(uL.w, vF.y);
        float dn = uL.w - vF.y;                                                 // metres toward the camera from the sawn ends
        float lit = mix(1.0, 0.07, smoothstep(0.0, 0.26, dn)) * mix(1.0, 0.22, smoothstep(0.08, 0.42, abs(vF.x - uGx)));
        float shade = mix(mix(0.16, 1.0, smoothstep(0.0, 0.03, dn)) * lit, 0.10, gap);
        diffuseColor.rgb *= mix(1.0, 0.30 * shade, uNear);`)
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.a *= formA;");
  };
  const form = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.91, 0.018).translate(0, -0.095, 0), formMat);
  form.visible = false; zup.add(form);

  // ---- the pour, seen from the ground. The camera sits level with the two pieces and looks along the gap:
  // one sawn end on the left, one on the right, and between them the black epoxy falls in from above and rises to the top.
  const finGeo = new THREE.PlaneGeometry(LY.size / 1000, LY.size / 1000);
  const finPos = [(LY.size / 2 - LY.cx) / 1000, (LY.cy - LY.size / 2) / 1000];
  const LAND = (() => {                                         // where the stream lands: in the gap, a little way in from the front
    const y = Y_SECT + 0.21, r = LY.river, i = clamp(Math.round((LY.cy - y * 1000 - r.y0) / r.step), 0, r.c.length - 1);
    return [(r.c[i] - LY.cx) / 1000, y];
  })();
  const GAP = (() => {                                          // the gap at the front: from piece A's edge to piece B's
    const [a, b] = slabs, at = s => (s.o.h / 2 - (s.sect === null ? s.rows[1] : s.sect)) / 1000;
    const l = a.to.x + spanAt(a.outline, at(a))[1], r = b.to.x + spanAt(b.outline, at(b))[0];
    return { x: (l + r) / 2, w: r - l };
  })();
  gapU.value = GAP.x;
  const liq = { uMask: { value: layMask }, uLevel: { value: 0 }, uSpread: { value: 0 }, uFlow: { value: 0 }, uTime: clock, uRip: rips,
    uFog: { value: new THREE.Vector2(100, 200) }, uLand: { value: new THREE.Vector2(LAND[0], LAND[1]) }, uOff: { value: new THREE.Vector2(finPos[0], finPos[1]) } };
  const pool = new THREE.Mesh(finGeo, new THREE.ShaderMaterial({                    // the surface of the liquid
    uniforms: liq,
    vertexShader: `uniform vec2 uOff; varying vec2 vP; varying vec2 vU; varying vec3 vW;
      void main() { vU = uv; vP = position.xy + uOff; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uMask; uniform float uLevel; uniform float uSpread; uniform float uFlow; uniform float uTime; uniform vec2 uLand; uniform vec2 uFog; uniform vec4 uRip[8];
      varying vec2 vP; varying vec2 vU; varying vec3 vW;
      void main() {
        float m = texture2D(uMask, vU).r;
        if (uLevel < 0.97) { float d = 9.0 / 1400.0; m = max(m, max(texture2D(uMask, vU + vec2(d, 0.0)).r, texture2D(uMask, vU - vec2(d, 0.0)).r)); }   // below the top the wood hides the overlap
        if (m < 0.5) discard;
        float away = abs(vP.y - uLand.y);
        if (away > uSpread) discard;                                             // it spreads along the gap from where it lands
        vec3 V = normalize(cameraPosition - vW);
        float f = 1.0 - clamp(V.y, 0.0, 1.0), sheen = f * f * f;                 // seen from the ground the surface catches the light; from above it is matt black
        float dl = length(vP - uLand);
        float ring = sin((dl - uTime * 0.10) * 52.0) * exp(-dl * 9.0) * uFlow * 0.5;
        float t = 0.0;
        for (int i = 0; i < 8; i++) {
          float age = uTime - uRip[i].z;
          if (uRip[i].w > 0.0 && age > 0.0 && age < 2.6) { float d = length(vP - uRip[i].xy), q = (d - age * 0.30) / 0.03; t += sin((d - age * 0.30) * 105.0) * exp(-q * q) * exp(-age * 1.4); }
        }
        vec3 col = vec3(0.020, 0.017, 0.015);
        float mirror = 1.0 - 0.85 * uFlow * smoothstep(0.016, 0.008, abs(vP.x - uLand.x)) * step(vP.y, uLand.y);      // the stream, mirrored in the surface
        col += vec3(0.082, 0.052, 0.033) * sheen * mirror * clamp(0.62 + 0.30 * ring + 0.6 * t, 0.0, 2.0);
        col += vec3(0.05, 0.04, 0.03) * max(t, 0.0);
        col += vec3(0.10, 0.08, 0.06) * smoothstep(0.03, 0.0, uSpread - away) * step(uSpread, 1.19);
        col = mix(col, vec3(0.0033, 0.0030, 0.0027), smoothstep(uFog.x, uFog.y, length(cameraPosition - vW)));      // the far end sinks into the dark
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
  pool.position.set(finPos[0], finPos[1], SLAB_Z); pool.visible = false; zup.add(pool);
  // the liquid's front face, where the view cuts through it: black glass, one soft reflection, a fine line where the surface stands
  const faceU = { uH: { value: 0.01 }, uW: { value: GAP.w + 0.08 }, uTime: clock, uDrop: dropU, uRes: resU };
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: faceU,
    vertexShader: "varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uH; uniform float uW; uniform float uTime; varying vec2 vU;
      ${RINGS}
      void main() {
        float d = (1.0 - vU.y) * uH, x = (vU.x - 0.5) * uW;                      // metres under the surface, metres from the middle
        vec3 rp = rings(gl_FragCoord.xy);
        vec3 col = vec3(0.0016, 0.0013, 0.0012);
        col += vec3(0.020, 0.016, 0.012) * smoothstep(0.016, 0.0, abs(x + 0.022 + rp.x * 0.010)) * (0.35 + 0.65 * exp(-d / 0.03));     // a strip light, standing in the glass
        col += vec3(0.070, 0.056, 0.042) * max(0.0, rp.z * 0.4 - rp.x * 0.8 + rp.y * 0.5);                 // the rings, lit from the left
        col += vec3(0.34, 0.25, 0.17) * smoothstep(0.0011, 0.0002, d);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
  face.rotation.x = Math.PI / 2; face.visible = false; face.position.set(GAP.x, Y_SECT + 0.001, SLAB_Z); zup.add(face);

  // the pour itself. Black epoxy hangs across the whole top of the page like a heavy sheet; it sags toward the middle and drains
  // into the gap as one stream. It is drawn flat, in the upright plane the stream falls in: a clean outline, a round edge, studio light.
  const R0 = 0.014, C0 = 0.036;                                 // the stream's half-width where it lands; how wide the sheet funnels into it (m)
  const sheetU = { uTime: clock, uDrop: dropU, uRes: resU, uSize: { value: new THREE.Vector2(1, 1) }, uCeil: { value: 1 }, uR: { value: R0 }, uC: { value: C0 },
    uHead: { value: 9 }, uFoot: { value: 0 } };
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: sheetU, transparent: true, depthWrite: false,
    vertexShader: "varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uTime; uniform vec2 uSize; uniform float uCeil; uniform float uR; uniform float uC; uniform float uHead; uniform float uFoot;
      varying vec2 vU;
      ${RINGS}
      vec3 studio(vec3 n, float tip) {                                                      // what a black mirror shows of the room: n faces the camera at (0, 0, 1)
        vec3 r = vec3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
        float fore = smoothstep(-0.3, 0.2, r.z);
        float body = 1.0 - smoothstep(0.25, 0.85, tip);
        vec3 c = vec3(1.0, 0.87, 0.72) * 0.40 * smoothstep(0.07, 0.0, abs(r.x + 0.60)) * smoothstep(-0.7, -0.1, r.y) * fore * body;        // a tall strip light on the left
        c += vec3(0.86, 0.74, 0.62) * 0.07 * smoothstep(0.09, 0.0, abs(r.x - 0.70)) * smoothstep(-0.7, -0.1, r.y) * fore * body;                                         // a soft fill on the right
        c += vec3(1.0, 0.82, 0.62) * 0.30 * smoothstep(0.05, 0.0, abs(r.y + 0.50)) * smoothstep(0.80, 0.35, abs(r.x)) * fore * (1.0 - tip);      // a low strip in front: the line along the lip
        c += vec3(0.30, 0.165, 0.09) * 0.030 * smoothstep(-0.3, -0.95, r.y);                                                        // the wood below
        c += vec3(0.0030, 0.0025, 0.0021) * clamp(0.5 + 1.7 * r.x + 0.9 * r.y, 0.0, 2.0) * smoothstep(0.4, 1.0, r.z);              // the dim room behind the camera
        return c;
      }
      float ceilAt(float u) { return uCeil + 0.0028 * sin(u * 6.5 + uTime * 0.42) + 0.0014 * sin(u * 17.0 - uTime * 0.66); }      // the sheet's lower edge, far from the middle
      float fullW(float h, float ceilH) {                                        // half the width of the liquid at this height
        float b = ceilH - h;
        return uR + uFoot * 0.00003 / (h + 0.005) + uC * uC * uC / max(b * b, 1e-6);          // the stream; wider where it lands; the sheet funnels into it
      }
      float tipAt(float h) { float rc = 2.0 * uR + 0.006; return clamp((uHead + rc - h) / rc, 0.0, 1.0); }      // the round head of the stream while it is still falling
      float halfW(float h, float ceilH) { float t = tipAt(h); return fullW(h, ceilH) * sqrt(max(1.0 - t * t, 0.0)); }
      void main() {
        float u = (vU.x - 0.5) * uSize.x, h = vU.y * uSize.y, au = abs(u), su = u < 0.0 ? -1.0 : 1.0;      // metres from the stream's axis, metres above the liquid
        float ceilH = ceilAt(u), c3 = uC * uC * uC, a = au - uR, b = ceilH - h, tip = 0.0, wc = 1.0;
        float d = 1.0; vec2 o = vec2(0.0);                                       // d: how far inside the outline (m); o: which way the outline faces
        if (b > 0.0) {                                                           // below the sheet's edge
          tip = tipAt(h); wc = halfW(h, ceilH);
          float dw = (halfW(h + 0.0005, ceilH) - wc) / 0.0005; o = vec2(su, -dw) / sqrt(1.0 + dw * dw);
          float dU = wc - au, dD = 1000.0;                                       // to the outline sideways, and straight down
          if (a > 0.0) dD = sqrt(c3 / a) - b;
          if (tip > 0.0) { float wf = fullW(h, ceilH); dD = min(dD, h - uHead - (2.0 * uR + 0.006) * (1.0 - sqrt(max(1.0 - au * au / (wf * wf), 0.0)))); }
          d = dU > 0.0 && dD > 0.0 ? dU * dD / length(vec2(dU, dD)) : min(dU, dD);
        } else if (a > 0.0) {                                                    // inside the sheet itself: only its lower edge counts
          float de = 0.5 * sqrt(c3) * pow(a, -1.5), l = sqrt(1.0 + de * de);
          d = sqrt(c3 / a) - b; o = vec2(su * de, -1.0) / l;
        }
        float al = clamp(d / fwidth(u) + 0.5, 0.0, 1.0);
        if (al < 0.003) discard;
        float lip = min(0.018, b > 0.0 ? max(wc, 1e-4) : 0.018);                   // the edge is round: the stream a full cylinder, the sheet a soft lip
        float k = 1.0 - clamp(d / lip, 0.0, 1.0);
        vec3 rp = rings(gl_FragCoord.xy);
        float flow = 0.030 * sin(u * 29.0 + 1.3 * sin(h * 8.0 - uTime * 0.45)) + 0.016 * sin(u * 77.0 + 2.0 * sin(h * 5.0 - uTime * 0.3));
        vec3 N = normalize(vec3(o * k + (rp.xy * 0.26 + vec2(flow, 0.0)) * (1.0 - k * k), sqrt(max(1.0 - k * k, 0.0)) + 0.001));
        vec3 col = vec3(0.0013, 0.0011, 0.0010) + studio(N, tip);
        col += vec3(0.070, 0.050, 0.036) * pow(k, 9.0);                            // the outline itself catches the glow behind
        col += vec3(0.075, 0.060, 0.045) * max(0.0, rp.z * 0.4 - rp.x * 0.8 + rp.y * 0.5) * (1.0 - k * k);      // the rings, lit from the left
        gl_FragColor = vec4(col, al);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
  sheet.rotation.x = Math.PI / 2; sheet.frustumCulled = false; sheet.visible = false; sheet.renderOrder = 4; zup.add(sheet);
  const inSheet = (u, h) => {                                    // is this point of the pour's plane inside the liquid (for the pointer)
    const S = sheetU, a = Math.abs(u) - S.uR.value, b = S.uCeil.value - h;
    if (h < Math.max(S.uHead.value, 0)) return false;
    return a <= 0 || b <= 0 || a * b * b < S.uC.value ** 3;
  };
  // a low warm glow far behind the pieces: the stream and the wood stand against it
  const glowU = { uK: { value: 0 } };
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.4), new THREE.ShaderMaterial({
    uniforms: glowU, transparent: true, depthWrite: false,
    vertexShader: "varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uK; varying vec2 vP;
      void main() {
        float e = length(vP / vec2(1.0, 0.24)), f = length(vP / vec2(2.2, 1.25));
        float g = (0.50 * exp(-e * e * 2.3) + 0.085 * exp(-f * f * 2.0)) * uK;      // a core along the horizon, and a faint lift of the whole wall
        gl_FragColor = vec4(vec3(0.115, 0.066, 0.040), g);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 190.0;      // no banding in the dark
      }` }));
  glow.rotation.x = Math.PI / 2; glow.position.set(GAP.x, 2.0, PIECE_TOP + 0.025); glow.renderOrder = -2; glow.frustumCulled = false; glow.visible = false; zup.add(glow);
  scene.updateMatrixWorld(true);
  const pourN = new THREE.Vector3(0.7071, 0, -0.7071);          // the way the camera looks along the gap
  const pourPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(pourN, zup.localToWorld(new THREE.Vector3(LAND[0], LAND[1], 0)));
  const sectPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(pourN, zup.localToWorld(new THREE.Vector3(0, Y_SECT, 0)));
  const zupInv = zup.getWorldQuaternion(new THREE.Quaternion()).invert();

  // ---- after the pour: flattened and sanded (the raw wood turns into the finished look), then the circle is cut
  const finU = { wipe: { value: 0 } };
  const finMat = side => {
    const m = wood(layFin, { roughness: 0.5, clearcoat: 0.05, envMapIntensity: 0.2 });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uMask: { value: layMask }, uWipe: finU.wipe, uSide: { value: side },
        uC: { value: new THREE.Vector3(LY.cx / LY.size, 1 - LY.cy / LY.size, 550 / LY.size) } });
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uMask; uniform float uWipe; uniform float uSide; uniform vec3 uC;")
        .replace("#include <map_fragment>", `if (texture2D(uMask, vMapUv).g < 0.5) discard;
          float rr = length(vMapUv - uC.xy);
          if (uSide > 0.5 && rr > uC.z) discard;
          if (uSide < -0.5 && rr <= uC.z) discard;
          float edge = 1.0 - vMapUv.y, front = uWipe * 1.1 - edge;
          if (front < 0.0) discard;
          #include <map_fragment>
          diffuseColor.rgb += vec3(0.55, 0.32, 0.18) * smoothstep(0.03, 0.0, front) * step(uWipe, 0.999);`);
    };
    return m;
  };
  const finIn = new THREE.Mesh(finGeo, finMat(0)), finOut = new THREE.Mesh(finGeo, finMat(-1));     // finOut: what is left outside the circle, lifted away whole
  for (const m of [finIn, finOut]) { m.position.set(finPos[0], finPos[1], LEG_H + TOP_T); m.visible = false; zup.add(m); }
  const ring = (() => {                                         // the cut line of the circle
    const N = 160, seg = [];
    for (let i = 0; i < N; i++) { const a = Math.PI / 2 - 2 * Math.PI * i / N, b = Math.PI / 2 - 2 * Math.PI * (i + 1) / N; seg.push(TOP_R * Math.cos(a), TOP_R * Math.sin(a), 0, TOP_R * Math.cos(b), TOP_R * Math.sin(b), 0); }
    const l = lines(seg, 2.6); l.position.z = LEG_H + TOP_T + 0.003; l.visible = false; l.userData.n = N; lineMats.push(l.material); zup.add(l); return l;
  })();

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

  // ---- the water touch: where the pointer crosses the epoxy, slow rings spread through the liquid. The wood and the page stay still.
  const drops = dropU.value; let dropI = 0, dropAt = [9, 9], dropT = 0, eyeNow = 0, lzNow = 0;
  function splash(e, force) {
    if (eyeNow < 0.6 || !(sheet.visible || face.visible)) return;
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = 1 - (e.clientY - r.top) / r.height, now = performance.now() * 0.001;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (!force && Math.hypot((x - dropAt[0]) * r.width / r.height, y - dropAt[1]) < 0.07 && now - dropT < 0.55) return;
    ndc.set(x * 2 - 1, y * 2 - 1); ray.setFromCamera(ndc, cam);
    let on = false;
    if (sheet.visible && ray.ray.intersectPlane(pourPlane, hit)) { zup.worldToLocal(hit); on = inSheet(hit.x - LAND[0], hit.z - lzNow); }
    if (!on && face.visible && ray.ray.intersectPlane(sectPlane, hit)) { zup.worldToLocal(hit); on = Math.abs(hit.x - GAP.x) < GAP.w / 2 && hit.z > SLAB_Z && hit.z < lzNow; }
    if (!on) return;
    drops[dropI].set(x, y, now, force ? 1.0 : 0.6); dropI = (dropI + 1) % drops.length; dropAt = [x, y]; dropT = now;
  }
  addEventListener("pointermove", e => splash(e, false), { passive: true });
  addEventListener("pointerdown", e => splash(e, true), { passive: true });
  // from the last frame: screen-up in the table's frame, the height in view, and where the screen's edges cut the plane the pour falls in
  const upL = new THREE.Vector3(0, 0, 1); let visH = 2, topZ = 1.2, botZ = 0.6, sideW = 0.5;

  const EYE_AT = [0.7071 * (GAP.x + Y_SECT), SLAB_Z + SLAB_T * 0.62, 0.7071 * (GAP.x - Y_SECT)];
  let W = 1, H = 1, K = keys(true, EYE_AT), lastEye = -1, p = 0, ps = 0, mx = 0, my = 0, mxs = 0, mys = 0, onscreen = true, first = true;
  function size() {
    W = stage.clientWidth; H = stage.clientHeight; gl.setSize(W, H, false);
    gl.getDrawingBufferSize(resU.value);
    cam.aspect = W / H; cam.updateProjectionMatrix(); K = keys(W / H > 1.05, EYE_AT);
    for (const m of lineMats) m.resolution.set(W, H);
  }
  function where() { const r = story.getBoundingClientRect(); p = clamp(-r.top / Math.max(1, r.height - innerHeight)); }
  addEventListener("resize", () => { size(); where(); });
  addEventListener("scroll", where, { passive: true });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) addEventListener("pointermove", e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; });
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { onscreen = es[0].isIntersecting; }).observe(story);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), topPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(LEG_H + TOP_T)), hit = new THREE.Vector3();
  let ripI = 0, ripAt = [9, 9], ripT = 0;
  function touchTop(e, force) {
    if (ps < T_POUR[0] || ps > T_LOOK[0]) return;
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
  function draw(time) { requestAnimationFrame(draw); if (onscreen) frame(time); }
  function frame(time) {
    ps += (p - ps) * 0.11; if (Math.abs(p - ps) < 0.0002) ps = p;
    mxs += (mx - mxs) * 0.06; mys += (my - mys) * 0.06;
    const k = keyAt(K, ps), wide = W / H > 1.05, tanF = Math.tan(FOV * Math.PI / 360);
    const dist = Math.max(k.fh / (2 * tanF * (wide ? 0.74 : 0.50)), k.fw / (2 * tanF * cam.aspect * (wide ? k.use : 0.86)));
    const tLeg = R(ps, T_LEG), fan = easeOut(R(ps, T_FAN)), away = smooth(R(ps, T_OUT)) - smooth(R(ps, T_BACK));
    const slabsIn = easeOut(R(ps, T_SLABS)), tc = R(ps, T_CUT), tp = R(ps, T_POUR), tf = R(ps, T_FIN), look = R(ps, T_LOOK);

    // the first leg: drawing, then pieces, then solid
    movePieces(LP, tLeg, time);
    legs[0].mesh.visible = tLeg >= 0.86;
    legLines.material.opacity = 1 - ramp(tLeg, 0.55, 0.95); legLines.visible = legLines.material.opacity > 0.01;
    for (let i = 1; i < 4; i++) {
      legs[i].g.visible = fan > 0;
      legs[i].g.rotation.z = mix(LEG_ANGLES[0], i === 3 ? LEG_ANGLES[0] - Math.PI / 2 : LEG_ANGLES[i], fan);
    }
    legsG.visible = away < 0.995; legsG.position.z = -2.6 * away;

    // the slabs come down; the saw crosses them; each offcut lifts and leaves through the top of the screen; the two pieces slide into the pour layout
    const arr = smooth(ramp(tc, 0.70, 1.0));
    const eye = smooth(R(ps, T_EYE)) * (1 - smooth(ramp(ps, T_EYE[2], T_EYE[3])));       // 1 while the pour is watched from the ground
    slabsG.visible = slabsIn > 0 && tf < 0.38; slabsG.position.z = SLAB_Z + 2.4 * (1 - slabsIn);
    slabs.forEach((s, si) => {
      s.piece.g.position.set(mix(s.x0, s.to.x, arr), mix(0, s.to.y, arr), 0); s.piece.g.scale.y = mix(1, s.to.s, arr);
      s.offs.forEach((o, i) => {
        const c = si * 2 + i, t = ramp(tc, 0.25 + c * 0.055, 0.63 + c * 0.055), lift = smooth(ramp(t, 0, 0.3)), fly = Math.pow(ramp(t, 0.15, 1), 2.2) * visH * 1.3;
        o.g.visible = t < 1; o.g.rotation.x = (i ? -1 : 1) * 0.05 * lift;
        o.g.position.set(s.x0 + upL.x * fly, (i ? -1 : 1) * 0.05 * lift + upL.y * fly, 0.10 * lift + upL.z * fly);
      });
      s.saws.forEach((w, i) => {
        const c = si * 2 + i, sweep = ramp(tc, 0.05 + c * 0.055, 0.23 + c * 0.055);
        w.g.scale.x = Math.max(sweep, 0.0001); w.ln.material.opacity = (sweep > 0 ? 1 : 0) * (1 - ramp(tc, 0.40, 0.50)); w.g.visible = w.ln.material.opacity > 0.01;
      });
      if (s.sect !== null && eye !== lastEye) {                 // from the ground, both pieces end in one plane
        const row = mix(s.rows[1], s.sect, eye);
        s.piece.u.lo.value = 1 - row / s.o.h; s.setCap(s.nearCap, (s.o.h / 2 - row) / 1000);
      }
    });
    lastEye = eye; front.intensity = 2.4 * eye; nearU.value = eye; eyeNow = eye;
    glow.visible = eye > 0.01; glowU.uK.value = eye; for (const s of slabs) s.mirror.visible = eye > 0.01;
    if (eye > 0.01) { scene.fog.near = dist + 0.12; scene.fog.far = scene.fog.near + 1.5 / (eye * eye); } else { scene.fog.near = 100; scene.fog.far = 200; }
    liq.uFog.value.set(scene.fog.near, scene.fog.far);
    const formIn = easeOut(ramp(tc, 0.64, 0.97)), formOut = smooth(ramp(tf, 0.56, 0.9));
    form.visible = formIn > 0 && formOut < 1; form.position.set(0, 0, SLAB_Z - 0.0095 - 1.4 * (1 - formIn) - 2.8 * formOut);

    // the pour: black epoxy comes down across the whole top of the screen, sags, and drains into the gap as one stream;
    // it spreads along the gap, rises to the top, and the stream thins to a thread and is gone
    clock.value = time * 0.001;
    const level = ramp(tp, 0.14, 0.90), lz = mix(SLAB_Z + 0.0015, PIECE_TOP + 0.0012, level), run = 1 - ramp(tp, 0.88, 0.96);
    lzNow = lz;
    pool.visible = tp > 0.115 && tf < 0.38; pool.position.z = lz;
    liq.uLevel.value = level; liq.uSpread.value = Math.pow(ramp(tp, 0.115, 0.32), 0.8) * 1.2; liq.uFlow.value = tp > 0.115 ? run : 0;
    face.visible = pool.visible && level > 0;
    face.scale.set(faceU.uW.value, lz - SLAB_Z, 1); face.position.z = (lz + SLAB_Z) / 2; faceU.uH.value = lz - SLAB_Z;
    sheet.visible = tp > 0 && tp < 0.995;
    if (sheet.visible) {
      const band = (wide ? 0.15 : 0.11) * Math.max(0.05, topZ - botZ);          // how far the sheet hangs into the screen
      const ceil = topZ + mix(mix(0.03, -band, easeOut(ramp(tp, 0, 0.08))), 0.035, smooth(ramp(tp, 0.90, 0.995))) - lz;
      const tall = Math.max(0.05, topZ + 0.08 - lz), wideM = Math.max(0.6, sideW * 2.4);
      sheet.position.set(LAND[0], LAND[1], lz + tall / 2); sheet.scale.set(wideM, tall, 1);
      sheetU.uSize.value.set(wideM, tall); sheetU.uCeil.value = ceil;
      sheetU.uHead.value = mix(ceil + 0.002, -0.03, Math.pow(ramp(tp, 0.045, 0.115), 1.8));      // the first of it falls, faster and faster
      sheetU.uFoot.value = ramp(tp, 0.115, 0.15) * run;
      sheetU.uR.value = R0 * Math.pow(run, 1.4); sheetU.uC.value = C0 * mix(0.22, 1, smooth(run));
    }

    // flattened and sanded, then the circle is cut; what is left outside lifts and leaves through the top of the screen
    const cut = tf >= 0.56, waste = ramp(tf, 0.56, 1), wfly = Math.pow(ramp(waste, 0.12, 1), 2.2) * visH * 1.6;
    finU.wipe.value = ramp(tf, 0, 0.36);
    finIn.visible = tf > 0 && !cut; finOut.visible = cut && waste < 1;
    finOut.position.set(finPos[0] + upL.x * wfly, finPos[1] + upL.y * wfly, LEG_H + TOP_T + 0.10 * smooth(ramp(waste, 0, 0.25)) + upL.z * wfly);
    topMesh.visible = cut;
    const drawn = ramp(tf, 0.36, 0.56);
    ring.visible = drawn > 0 && tf < 0.8; ring.geometry.instanceCount = Math.max(1, Math.round(ring.userData.n * drawn)); ring.material.opacity = 1 - ramp(tf, 0.60, 0.8);

    const calm = 1 - 0.8 * look, idle = 1 - ramp(ps, 0, 0.06);
    const az = k.az + Math.sin(time * 0.0005) * 0.85 * idle + mxs * 0.22 * calm * k.par, el = clamp(k.el + Math.sin(time * 0.00037) * 0.06 * idle - mys * 0.10 * calm * k.par, -0.2, 1.5);
    cam.position.set(k.t[0] + dist * Math.sin(az) * Math.cos(el), k.t[1] + dist * Math.sin(el), k.t[2] + dist * Math.cos(az) * Math.cos(el));
    cam.lookAt(k.t[0], k.t[1], k.t[2]);
    cam.setViewOffset(W, H, wide ? -k.sx * W : 0, ((wide ? -0.03 : mix(0.03, 0.15, ramp(ps, 0.02, 0.07))) - k.sy) * H, W, H);
    // for the next frame: which way is up on the screen, how much height is in view, and where the screen's edges meet the pour
    upL.set(0, 1, 0).applyQuaternion(cam.quaternion).applyQuaternion(zupInv); visH = 2 * dist * tanF;
    if (eye > 0.01) {
      cam.updateMatrixWorld();
      ndc.set(0, 1); ray.setFromCamera(ndc, cam); if (ray.ray.intersectPlane(pourPlane, hit)) { zup.worldToLocal(hit); topZ = hit.z; }
      ndc.set(0, -1); ray.setFromCamera(ndc, cam); if (ray.ray.intersectPlane(pourPlane, hit)) { zup.worldToLocal(hit); botZ = hit.z; }
      let tw = 0;
      for (const sx of [-1, 1]) { ndc.set(sx, 1); ray.setFromCamera(ndc, cam); if (ray.ray.intersectPlane(pourPlane, hit)) { zup.worldToLocal(hit); tw = Math.max(tw, Math.abs(hit.x - LAND[0])); } }
      if (tw > 0) sideW = tw;
    }
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
  const leg = legParts(data.leg), P = leg.outline, n = P.length;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
  const zup = new THREE.Group(); zup.rotation.x = -Math.PI / 2; scene.add(zup);
  const legG = new THREE.Group(); legG.position.set(-0.255, 0, -0.375); zup.add(legG);        // turn about the middle of the leg
  const mats = [], INK = 0xf2e8d4, Y = -T / 2;
  const draw = (seg, width, colour, opacity) => { const l = lines(seg, width); l.material.color.set(colour); l.material.opacity = opacity; mats.push(l.material); return l; };
  const label = cls => { const el = document.createElement("span"); el.className = "lv-n " + cls; labels.appendChild(el); return el; };

  // always there: the leg itself (a faint body and its outline, which draws itself in), and the table's axis
  const body = new THREE.Mesh(leg.geometry, new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })); legG.add(body);
  const outline = draw(leg.segments, 2, LINE, 1); legG.add(outline); const outlineN = leg.segments.length / 6;
  legG.add(draw([0, 0, -0.06, 0, 0, 0.86], 1, LINE, 0.35));
  { const tick = [];                                             // a height scale on the axis, every 50 mm
    for (let h = 0; h <= 750; h += 50) { const w = h % 250 === 0 ? 0.022 : 0.010; tick.push(-w, 0, h / 1000, 0, 0, h / 1000); }
    legG.add(draw(tick, 1, LINE, 0.5)); }

  // ---- numbers that come from the outline itself
  let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2;
  const tangent = i => { const a = P[(i + n - 1) % n], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const corner = P.map((p, i) => { const a = P[(i + n - 1) % n], b = P[(i + 1) % n], u = [p[0] - a[0], p[1] - a[1]], w = [b[0] - p[0], b[1] - p[1]];
    return Math.abs(Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1])) > 0.45; });
  const raw = P.map((p, i) => {                                  // how tightly the outline bends at each point (1 / radius, per metre)
    const a = P[(i + n - 1) % n], c = P[(i + 1) % n], ab = Math.hypot(p[0] - a[0], p[1] - a[1]), bc = Math.hypot(c[0] - p[0], c[1] - p[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cr = (p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0]);
    return corner[i] || ab * bc * ca < 1e-12 ? 0 : 2 * cr / (ab * bc * ca);
  });
  const kap = raw.map((_, i) => { let s = 0, m = 0; for (let j = -2; j <= 2; j++) { const q = (i + j + n) % n; if (!corner[q]) { s += raw[q]; m++; } } return corner[i] || !m ? 0 : s / m; });

  // ---- layer 1: the dimensions
  const items = [], dimsG = new THREE.Group(); legG.add(dimsG);
  for (const d of DIMS) {
    const seg = [], g = new THREE.Group(); let pivot, at;
    if (d.kind === "lin") {
      const a2 = [d.a[0] + d.off[0], d.a[1] + d.off[1]], b2 = [d.b[0] + d.off[0], d.b[1] + d.off[1]];
      if (d.axis === "h") a2[0] = b2[0] = d.off[0] > 0 ? Math.max(a2[0], b2[0]) : Math.min(a2[0], b2[0]);
      else a2[1] = b2[1] = d.off[1] > 0 ? Math.max(a2[1], b2[1]) : Math.min(a2[1], b2[1]);
      pivot = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
      const Q = p => [p[0] - pivot[0], 0, p[1] - pivot[1]], tk = 0.012, ea = d.ext ? [d.a[0], d.ext[1]] : d.a;
      seg.push(...Q(a2), ...Q(b2), ...Q(ea), ...Q(a2), ...Q(d.b), ...Q(b2));
      for (const e of [a2, b2]) seg.push(...Q([e[0] - tk, e[1] - tk]), ...Q([e[0] + tk, e[1] + tk]));
      const m = Math.hypot(d.off[0], d.off[1]) || 1; at = [pivot[0] + d.off[0] / m * 0.034, Y, pivot[1] + d.off[1] / m * 0.03];
    } else if (d.kind === "ang") {
      pivot = d.c; const N = 24;
      for (let i = 0; i < N; i++) { const t0 = (d.from + (d.to - d.from) * i / N) * Math.PI / 180, t1 = (d.from + (d.to - d.from) * (i + 1) / N) * Math.PI / 180;
        seg.push(d.rad * Math.cos(t0), 0, d.rad * Math.sin(t0), d.rad * Math.cos(t1), 0, d.rad * Math.sin(t1)); }
      for (const t of [d.from, d.to]) { const a = t * Math.PI / 180; seg.push(0, 0, 0, d.rad * 1.18 * Math.cos(a), 0, d.rad * 1.18 * Math.sin(a)); }
      const mid = (d.from + d.to) / 2 * Math.PI / 180; at = [d.c[0] + d.rad * 1.42 * Math.cos(mid), Y, d.c[1] + d.rad * 1.42 * Math.sin(mid)];
    } else {
      pivot = [d.at[0] + d.off[0], d.at[1] + d.off[1]];
      seg.push(0, -T / 2 - Y, 0, 0, T / 2 - Y, 0, -d.off[0], -T / 2 - Y, -d.off[1], 0, -T / 2 - Y, 0, -d.off[0], T / 2 - Y, -d.off[1], 0, T / 2 - Y, 0);
      at = [pivot[0] + 0.03, 0, pivot[1] + 0.012];
    }
    g.position.set(pivot[0], Y, pivot[1]);
    const l = draw(seg, 1.2, d.kind === "ang" ? LINE : INK, 0); g.add(l); dimsG.add(g);
    items.push({ d, g, l, el: label(d.kind === "ang" ? "ang" : ""), at: new THREE.Vector3(...at), shown: -1 });
  }

  // ---- layer 2: the curves. A comb shows how tightly the outline bends; where a stretch is a true arc, its radius is given
  const curvesG = new THREE.Group(); legG.add(curvesG);
  const comb = [], tips = P.map((p, i) => { const t = tangent(i), len = Math.min(Math.abs(kap[i]) * 0.0042, 0.085); return Math.abs(kap[i]) > 0.35 ? [p[0] + t[1] * len, p[1] - t[0] * len] : null; });
  for (let i = 0; i < n; i++) {
    const a = tips[i], b = tips[(i + 1) % n];
    if (a) comb.push(P[i][0], Y, P[i][1], a[0], Y, a[1]);
    if (a && b) comb.push(a[0], Y, a[1], b[0], Y, b[1]);
  }
  const combL = draw(comb.length ? comb : [0, 0, 0, 0, 0, 0], 1, LINE, 0); curvesG.add(combL);
  const arcs = [];
  for (let i = 0; i < n;) {                                      // stretches that bend one way: fit a circle, keep it if the fit is true to 1.5 mm
    if (Math.abs(kap[i]) < 1.1) { i++; continue; }
    let j = i; while (j < n && Math.abs(kap[j]) >= 1.1 && Math.sign(kap[j]) === Math.sign(kap[i])) j++;
    if (j - i >= 6) {
      const pts = P.slice(i, j); let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0; const m = pts.length;
      for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z; }
      const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, m]], B = [-sxz, -syz, -sz];
      const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D = det(A), col = k => det(A.map((r, ri) => r.map((v, ci) => ci === k ? B[ri] : v)));
      if (Math.abs(D) > 1e-18) {
        const a = col(0) / D, b = col(1) / D, c = col(2) / D, cx = -a / 2, cy = -b / 2, R = Math.sqrt(Math.max(cx * cx + cy * cy - c, 0));
        const rms = Math.sqrt(pts.reduce((t, [x, y]) => t + (Math.hypot(x - cx, y - cy) - R) ** 2, 0) / m);
        if (rms < 0.0015 && R > 0.02 && R < 0.8) arcs.push({ cx, cy, R, mid: pts[m >> 1], len: m, pts });
      }
    }
    i = j;
  }
  arcs.sort((a, b) => b.len - a.len); arcs.length = Math.min(arcs.length, 5);
  for (const a of arcs) {
    const seg = [], k = 0.012;
    seg.push(a.cx - k, Y, a.cy, a.cx + k, Y, a.cy, a.cx, Y, a.cy - k, a.cx, Y, a.cy + k, a.cx, Y, a.cy, a.mid[0], Y, a.mid[1]);
    for (let i = 0; i < a.pts.length - 1; i++) seg.push(a.pts[i][0], Y - 0.001, a.pts[i][1], a.pts[i + 1][0], Y - 0.001, a.pts[i + 1][1]);
    a.l = draw(seg, 1.4, INK, 0); curvesG.add(a.l);
    a.el = label("rad"); a.el.textContent = "R " + Math.round(a.R * 1000);
    a.at = new THREE.Vector3((a.cx + a.mid[0]) / 2, Y, (a.cy + a.mid[1]) / 2);
  }

  // ---- layer 3: a cut through the leg that travels up and down, with its height and width
  const sectG = new THREE.Group(); legG.add(sectG);
  const sPos = new Float32Array(3 * 24), sGeo = new THREE.BufferGeometry(); sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  const sLine = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0 })); sectG.add(sLine);
  const fPos = new Float32Array(3 * 12), fGeo = new THREE.BufferGeometry(); fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3));
  const sFill = new THREE.Mesh(fGeo, new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); sectG.add(sFill);
  const plane = draw([-0.05, -0.09, 0, 0.56, -0.09, 0, 0.56, -0.09, 0, 0.56, 0.09, 0, 0.56, 0.09, 0, -0.05, 0.09, 0, -0.05, 0.09, 0, -0.05, -0.09, 0], 1, LINE, 0); sectG.add(plane);
  const sectEl = label("sect"), sectAt = new THREE.Vector3();
  function section(h) {
    const xs = [];
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; if ((a[1] > h) !== (b[1] > h)) xs.push(a[0] + (h - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b); sPos.fill(0); fPos.fill(0);
    const spans = [];
    for (let k = 0; k + 1 < xs.length && k < 4; k += 2) {
      const x0 = xs[k], x1 = xs[k + 1], q = [[x0, -T / 2], [x1, -T / 2], [x1, T / 2], [x0, T / 2]], o = (k / 2) * 24, f = (k / 2) * 18;
      for (let e = 0; e < 4; e++) { const p = q[e], r = q[(e + 1) % 4]; sPos.set([p[0], p[1], h, r[0], r[1], h], o + e * 6); }
      fPos.set([x0, -T / 2, h, x1, -T / 2, h, x1, T / 2, h, x0, -T / 2, h, x1, T / 2, h, x0, T / 2, h], f);
      spans.push(Math.round((x1 - x0) * 1000));
    }
    sGeo.attributes.position.needsUpdate = true; fGeo.attributes.position.needsUpdate = true; plane.position.z = h;
    sectEl.textContent = "H " + Math.round(h * 1000) + "  W " + spans.join(" + "); sectAt.set(0.59, 0.09, h);
  }

  // ---- layer 4: where the leg sits: the three other legs and the top, drawn faintly
  const tableG = new THREE.Group(); legG.add(tableG);
  for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2]) { const g = new THREE.Group(); g.rotation.z = a; g.add(draw(leg.segments, 1, LINE, 0)); tableG.add(g); }
  { const ringSeg = [], N = 120;
    for (const z of [LEG_H, LEG_H + TOP_T]) for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / N, b = 2 * Math.PI * (i + 1) / N; ringSeg.push(TOP_R * Math.cos(a), TOP_R * Math.sin(a), z, TOP_R * Math.cos(b), TOP_R * Math.sin(b), z); }
    tableG.add(draw(ringSeg, 1.2, INK, 0)); }
  const tableLines = []; tableG.traverse(o => { if (o.material) tableLines.push(o); });

  // ---- the panel: facts from the outline, and the four views
  const set = (k, v) => { const el = box.querySelector(`[data-lv="${k}"]`); if (el) el.textContent = v; };
  set("pts", n); set("area", (area * 1e4).toFixed(0)); set("vol", (area * T * 1000).toFixed(1)); set("arcs", arcs.length); set("ratio", (0.75 / 0.47).toFixed(2));
  const MODES = ["measure", "curves", "section", "table"], alpha = { measure: 0, curves: 0, section: 0, table: 0 };
  const tabs = [...box.querySelectorAll(".lv-tabs button")]; let mode = "measure", auto = true, since = 0;
  const pick = (m, byHand) => { mode = m; if (byHand) auto = false; tabs.forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false")); };
  tabs.forEach(b => b.addEventListener("click", () => pick(b.dataset.mode, true)));

  let W = 1, H = 1, az = -0.5, el = 0.1, drag = null, seen = false, prog = 0, zoom = 1, tx = 0, last = 0;
  function size() { W = box.clientWidth; H = box.clientHeight; gl.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); for (const m of mats) m.resolution.set(W, H); }
  addEventListener("resize", size); size();
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); box.classList.add("held"); auto = false; });
  canvas.addEventListener("pointermove", e => {
    if (!drag) return;
    az = clamp(az - (e.clientX - drag.x) * 0.005, -0.95, 0.95); el = clamp(el + (e.clientY - drag.y) * 0.004, -0.35, 0.7); drag = { x: e.clientX, y: e.clientY };
  });
  const drop = () => { drag = null; box.classList.remove("held"); };
  canvas.addEventListener("pointerup", drop); canvas.addEventListener("pointercancel", drop);
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { seen = es[0].isIntersecting; }).observe(box); else seen = true;

  const v = new THREE.Vector3();
  const place = (elm, at, a) => { v.copy(at); legG.localToWorld(v); v.project(cam); elm.style.opacity = a; elm.style.transform = `translate3d(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px, 0) translate(-50%, -50%)`; };
  function frame(time) {
    requestAnimationFrame(frame);
    if (!seen) return;
    const dt = Math.min(time - last, 100); last = time;
    const r = box.getBoundingClientRect();
    prog += (clamp((innerHeight * 0.92 - r.top) / (innerHeight * 0.75)) - prog) * 0.1;
    if (auto && prog > 0.95) { since += dt; if (since > 6500) { since = 0; pick(MODES[(MODES.indexOf(mode) + 1) % MODES.length], false); } }
    for (const m of MODES) alpha[m] += ((m === mode ? 1 : 0) - alpha[m]) * 0.09;

    outline.geometry.instanceCount = Math.max(1, Math.round(outlineN * easeOut(ramp(prog, 0, 0.45))));
    body.material.opacity = 0.07 * ramp(prog, 0.3, 0.6);

    const tanF = Math.tan(24 * Math.PI / 360), fit = Math.max(1.02 / (2 * tanF), 0.95 / (2 * tanF * cam.aspect));
    zoom += ((mode === "table" ? 1.85 : mode === "curves" ? 0.92 : 1) - zoom) * 0.06; tx += ((mode === "table" ? -0.255 : 0) - tx) * 0.06;
    const a = az + (drag ? 0 : Math.sin(time * 0.0004) * 0.10) + alpha.section * -0.25 + alpha.table * 0.25, e2 = el + alpha.section * 0.22 + alpha.table * 0.2, dist = fit * zoom;
    const c = Math.cos(a), sn = Math.sin(a);
    cam.position.set(tx * c + dist * sn * Math.cos(e2), dist * Math.sin(e2) + 0.01 + alpha.table * 0.03, -tx * sn * 0 + dist * c * Math.cos(e2)); cam.lookAt(tx, 0.01 + alpha.table * 0.03, 0);

    items.forEach((it, i) => {
      const t = easeOut(ramp(prog, 0.3 + i * 0.05, 0.5 + i * 0.05)) * alpha.measure;
      it.l.material.opacity = t * (it.d.kind === "ang" ? 0.95 : 0.6); it.l.visible = t > 0.01; it.g.scale.setScalar(Math.max(t, 0.001));
      const num = Math.round(it.d.value * t);
      if (num !== it.shown) { it.shown = num; it.el.textContent = num + (it.d.kind === "ang" ? "°" : ""); }
      place(it.el, it.at, t);
    });
    combL.material.opacity = 0.75 * alpha.curves; combL.visible = alpha.curves > 0.01;
    for (const k of arcs) { k.l.material.opacity = 0.85 * alpha.curves; k.l.visible = alpha.curves > 0.01; place(k.el, k.at, alpha.curves); }
    const sa = alpha.section; sLine.material.opacity = sa; sFill.material.opacity = 0.5 * sa; plane.material.opacity = 0.5 * sa; sectG.visible = sa > 0.01;
    if (sectG.visible) section(0.02 + 0.71 * (0.5 - 0.5 * Math.cos(time * 0.0007)));
    place(sectEl, sectAt, sa);
    for (const o of tableLines) { o.material.opacity = (o.material.color.getHex() === INK ? 0.55 : 0.32) * alpha.table; } tableG.visible = alpha.table > 0.01;
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
