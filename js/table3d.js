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
const T_LEG = [0.04, 0.13], T_FAN = [0.16, 0.22], T_OUT = [0.235, 0.29], T_SLABS = [0.24, 0.31], T_CUT = [0.345, 0.515], T_POUR = [0.545, 0.705], T_FIN = [0.72, 0.825], T_BACK = [0.835, 0.895], T_LOOK = [0.93, 0.975];
function keys(wide) {
  const slabAz = wide ? Math.PI / 4 : -Math.PI / 4;             // slabs lie across a wide screen, upright on a tall one
  const slab = { t: [0, 0.78, 0], fw: wide ? 2.35 : 1.45, fh: wide ? 1.30 : 1.85, sx: wide ? 0.21 : 0.13, use: 0.55 };
  const face = { az: -Math.PI / 4, el: 1.5, t: [0.0707, 0.79, -0.0707], fw: 1.44, fh: wide ? 1.30 : 1.0, sx: 0.15, use: 0.58 };   // straight on: the pieces fill most of the height, with room above for the pour
  return [
    { p: 0.00, az: 0.00, el: 0.05, t: [0.26, 0.375, 0], fw: 0.62, fh: 0.84, sx: 0, use: 0.80 },
    { p: 0.055, az: 0.60, el: 0.13, t: [0.26, 0.375, 0], fw: 0.70, fh: 0.92, sx: 0.19, use: 0.48 },
    { p: 0.14, az: 0.35, el: 0.10, t: [0.26, 0.375, 0], fw: 0.68, fh: 0.90, sx: 0.19, use: 0.48 },
    { p: 0.225, az: 0.15, el: 0.22, t: [0, 0.40, 0], fw: 1.22, fh: 0.98, sx: 0.17, use: 0.58 },
    Object.assign({ p: 0.31, az: slabAz, el: 0.92 }, slab),
    Object.assign({ p: 0.45, az: slabAz, el: 1.0 }, slab),
    Object.assign({ p: 0.535 }, face),
    Object.assign({ p: 0.715 }, face),
    { p: 0.81, az: -Math.PI / 4 + 0.2, el: 1.22, t: [0, 0.79, 0], fw: 1.55, fh: 1.4, sx: 0.15, use: 0.60 },
    { p: 0.895, az: -0.35, el: 0.42, t: [0, 0.45, 0], fw: 1.28, fh: 1.05, sx: 0.15, use: 0.60 },
    { p: 0.975, az: -Math.PI / 4, el: 1.45, t: [0, 0.79, 0], fw: 1.26, fh: 1.26, sx: 0.15, use: 0.62 },
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
  const [data, topMap, topRough, topFlow, slabA, slabB, layFin, layMask, ...legMaps] = await Promise.all([
    fetch(base + "leg.json" + v).then(r => r.json()),
    tex("top.jpg"), tex("top-rough.jpg", false), tex("top-flow.png", false), tex("slab-a.jpg"), tex("slab-b.jpg"), tex("layout-fin.jpg"), tex("layout-mask.png", false),
    tex("leg1.jpg"), tex("leg2.jpg"), tex("leg3.jpg"), tex("leg4.jpg"),
  ]);
  for (const t of [topFlow, layMask]) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 1; }

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

  // ---- the round top (the finished table): filled, with the water touch
  const pour = { value: 1.01 }, clock = { value: 0 }, landU = { value: new THREE.Vector3() };
  const rips = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) };     // x, y, start time, strength
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

  // ---- the two raw slabs: sawn where they really were (25 Oct), offcuts lifted away, the two pieces laid for the pour
  // Layout frame (slabs/pieces.py): mm, x to the right, y down from piece A's top cut; the circle's centre is (cx, cy).
  const LY = data.layout, SLAB_T = 0.055, PIECE_TOP = LEG_H + TOP_T - 0.002, SLAB_Z = PIECE_TOP - SLAB_T, SLAB_X = 0.375;
  const lineMats = [legLines.material];
  const slabsG = new THREE.Group(); zup.add(slabsG);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8a6248, roughness: 0.8, side: THREE.DoubleSide });
  const slabs = [["A", slabA, -SLAB_X, 0, 0], ["B", slabB, SLAB_X, LY.ox, LY.off]].map(([n, map, x0, dx, dy]) => {
    const o = data.slabs[n], part = slabParts(o, SLAB_T), [ra, rb] = LY.cuts[n].rows, st = LY.piece / (rb - ra);
    const mk = (lo, hi) => {                                    // one stretch of the slab between two rows of its picture
      const u = { lo: { value: 1 - hi / o.h }, hi: { value: 1 - lo / o.h }, gone: { value: 0 } };
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.86, envMapIntensity: 0.45 });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uLo: u.lo, uHi: u.hi, uGone: u.gone });
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uLo; uniform float uHi; uniform float uGone;")
          .replace("#include <map_fragment>", `if (vMapUv.y < uLo || vMapUv.y > uHi) discard;
            if (uGone > 0.0) { vec2 cell = floor(vMapUv * vec2(40.0, 112.0)); if (uGone > 0.15 + 0.85 * fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453)) discard; }
            #include <map_fragment>`);
      };
      const g = new THREE.Group(); g.add(new THREE.Mesh(part.geometry, mat)); g.position.set(x0, 0, 0); slabsG.add(g);
      return { g, u };
    };
    const cap = (g, i) => {                                     // the fresh sawn face at a cut
      const [l, r] = LY.cuts[n].x[i], row = LY.cuts[n].rows[i], w = (r - l) / 1000;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, SLAB_T), capMat); m.rotation.x = Math.PI / 2;
      m.position.set(((l + r) / 2 - o.w / 2) / 1000, (o.h / 2 - row) / 1000, SLAB_T / 2); g.add(m);
    };
    const piece = mk(ra, rb), offs = [mk(-1, ra), mk(rb, o.h + 1)];
    cap(piece.g, 0); cap(piece.g, 1); cap(offs[0].g, 0); cap(offs[1].g, 1);
    const saws = [0, 1].map(i => {                              // the saw line across the slab at each cut
      const [l, r] = LY.cuts[n].x[i], row = LY.cuts[n].rows[i], len = (r - l + 50) / 1000;
      const g = new THREE.Group(), ln = lines([0, 0, 0, len, 0, 0], 2.6); lineMats.push(ln.material);
      g.position.set(x0 + (l - 25 - o.w / 2) / 1000, (o.h / 2 - row) / 1000, SLAB_T + 0.004); g.add(ln); slabsG.add(g);
      return { g, ln, y: (o.h / 2 - row) / 1000, x: x0 + (l - o.w / 2) / 1000, w: (r - l) / 1000 };
    });
    // where the piece goes for the pour: its rows stretched to 1270 mm, placed in the layout
    const to = { x: (o.w / 2 + dx - LY.cx) / 1000, y: (LY.cy - dy + ra * st - st * o.h / 2) / 1000, s: st };
    return { n, o, x0, outline: part.outline, bb: bounds(part.outline), pix: sampler(map.image, 190, 532), piece, offs, saws, rows: [ra, rb], to };
  });

  // sawdust at the cuts, and the offcuts breaking into pieces as they lift away
  const tan = [0.50, 0.33, 0.20];
  const DUST = pieces(small ? 260 : 520, { spread: 0.8, melt: 2, tumble: 6, fromNothing: true, recolour: false, dust: true });
  {
    const q = new THREE.Quaternion();
    for (let i = 0; i < DUST.n; i++) {
      const i3 = i * 3, c = i % 4, s = slabs[c >> 1], saw = s.saws[c & 1], f = Math.random();
      const ax = saw.x + f * saw.w, ay = saw.y + (Math.random() - 0.5) * 0.01, az = SLAB_T + 0.004;
      DUST.A.set([ax, ay, az], i3);
      DUST.M.set([ax + (Math.random() - 0.5) * 0.10, ay + (Math.random() - 0.5) * 0.22, az + 0.10 + Math.random() * 0.22], i3);
      DUST.B.set([ax + (Math.random() - 0.5) * 0.22, ay + (Math.random() - 0.5) * 0.5, az + 0.02 + Math.random() * 0.10], i3);
      DUST.size.set([0.004 + Math.random() * 0.006, 0.006 + Math.random() * 0.012, 0.0012 + Math.random() * 0.002], i3);
      setQ(DUST.qA, i, randomQ(q)); setQ(DUST.qB, i, randomQ(q));
      randomQ(q); DUST.axis.set([q.x, q.y, q.z].map(v => v / (Math.hypot(q.x, q.y, q.z) || 1)), i3);
      DUST.phase[i] = Math.random(); DUST.delay[i] = clamp((0.10 + c * 0.11 + f * 0.36) / 0.8, 0, 0.999);
      const k = 0.7 + Math.random() * 0.6; DUST.mesh.instanceColor.array.set([tan[0] * k, tan[1] * k, tan[2] * k], i3);
    }
    DUST.mesh.instanceColor.needsUpdate = true; slabsG.add(DUST.mesh);
  }
  const OFF = pieces(small ? 1200 : 2800, { spread: 0.55, melt: 2, tumble: 5, fromNothing: false, recolour: false, dust: true });
  {
    const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), c = [0, 0, 0];
    for (let i = 0; i < OFF.n; i++) {
      const i3 = i * 3; let s, sx, sy, row;
      for (;;) { s = slabs[Math.random() < 0.52 ? 0 : 1]; [sx, sy] = pointIn(s.outline, s.bb); row = s.o.h / 2 - sy * 1000; if (row < s.rows[0] || row > s.rows[1]) break; }
      const ax = s.x0 + sx, az = SLAB_T + 0.002;
      OFF.A.set([ax, sy, az], i3);
      OFF.M.set([ax + (Math.random() - 0.5) * 0.3, sy + (Math.random() - 0.5) * 0.3, az + 0.35 + Math.random() * 0.4], i3);
      OFF.B.set([ax + (Math.random() - 0.5) * 0.9, sy + (Math.random() - 0.5) * 0.9, az + 1.0 + Math.random() * 0.9], i3);
      OFF.size.set([0.012 + Math.random() * 0.014, 0.024 + Math.random() * 0.034, 0.003 + Math.random() * 0.005], i3);
      setQ(OFF.qA, i, q.setFromAxisAngle(zAxis, (Math.random() - 0.5) * 0.7)); setQ(OFF.qB, i, randomQ(q));
      randomQ(q); OFF.axis.set([q.x, q.y, q.z].map(v => v / (Math.hypot(q.x, q.y, q.z) || 1)), i3);
      OFF.phase[i] = Math.random(); OFF.delay[i] = Math.random();
      s.pix(sx * 1000 / s.o.w + 0.5, sy * 1000 / s.o.h + 0.5, c); OFF.mesh.instanceColor.array.set(c, i3);
    }
    OFF.mesh.instanceColor.needsUpdate = true; slabsG.add(OFF.mesh);
  }

  // the mould under the pieces: a wide matte board, so the open gap and the dark epoxy read apart
  const form = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.72, 0.018), new THREE.MeshStandardMaterial({ color: 0x4d4037, roughness: 0.9, envMapIntensity: 0.25 }));
  form.visible = false; zup.add(form);

  // ---- the pour, seen straight on: a dark matte liquid runs in from the top of the page, down the gap, and fills it from the bottom up
  const riverTex = (() => {
    const r = LY.river, n = r.c.length, d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { d[i * 4] = clamp(Math.round(r.c[i] - 560), 0, 255); d[i * 4 + 1] = clamp(Math.round(r.hw[i] * 4), 0, 255); d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  })();
  const liq = { uMask: { value: layMask }, uRiver: { value: riverTex }, uHead: { value: 2 }, uLevel: { value: 0 }, uFlow: { value: 1 }, uTime: clock, uRip: rips,
    uC: { value: new THREE.Vector4(LY.cx, LY.cy, LY.size, LY.river.y0) }, uOff: { value: new THREE.Vector2(0, 0.5) } };
  const liquid = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.6), new THREE.ShaderMaterial({
    uniforms: liq, transparent: false,
    vertexShader: "uniform vec2 uOff; varying vec2 vP; void main() { vP = position.xy + uOff; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform sampler2D uMask; uniform sampler2D uRiver; uniform float uHead; uniform float uLevel; uniform float uFlow; uniform float uTime; uniform vec4 uC; uniform vec4 uRip[8];
      varying vec2 vP;
      void main() {
        float Yl = uC.y - vP.y * 1000.0;                                       // mm down from piece A's top cut
        vec2 uv = vec2((vP.x * 1000.0 + uC.x) / uC.z, 1.0 - Yl / uC.z);
        float inMap = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float resin = inMap * texture2D(uMask, uv).r;
        vec2 rv = texture2D(uRiver, vec2(clamp((Yl - uC.w) / 1140.0, 0.002, 0.998), 0.5)).rg;
        float cx = (560.0 + rv.r * 255.0 - uC.x) / 1000.0, hw = rv.g * 255.0 / 4000.0;
        float settle = 1.0 - smoothstep(0.96, 1.0, uLevel);
        float surf = mix(-0.60, 0.60, uLevel) + (sin(vP.x * 46.0 + uTime * 2.6) * 0.0035 + sin(vP.x * 19.0 - uTime * 1.7) * 0.003) * settle;
        float filled = step(0.5, resin) * step(vP.y, surf);
        // the flow: a wide sheet from the top of the page that funnels into the gap, then runs down it
        float up = smoothstep(0.60, 1.04, vP.y);
        float wide = mix(min(hw * 0.9, 0.03), 0.84, pow(up, 1.7)) * (1.0 + 0.05 * sin(vP.y * 8.0 - uTime * 3.0) * up);
        float sw = (vP.y > 0.60 ? wide : min(hw * 0.9, 0.03 + 0.004 * sin(vP.y * 31.0 + uTime * 9.0))) * uFlow;
        float sx = cx + 0.004 * sin(vP.y * 23.0 - uTime * 7.0) * (1.0 - up);
        float off = abs(vP.x - sx) / max(sw, 1e-4);
        float head = max(surf - 0.004, uHead + 0.03 * sin(vP.x * 14.0 + uTime * 2.0) * up);
        float stream = (1.0 - smoothstep(0.86, 1.0, off)) * step(head, vP.y) * step(0.002, sw);
        if (max(filled, stream) < 0.5) discard;
        vec3 col = vec3(0.020, 0.017, 0.015);
        float lip = filled * smoothstep(0.024, 0.0, surf - vP.y) * settle;                // the lighter edge of the rising surface
        col += vec3(0.13, 0.10, 0.075) * lip;
        float run = (1.0 - filled) * stream;
        float streak = 0.5 + 0.5 * sin(vP.x * 130.0 + sin(vP.y * 6.0 + uTime * 2.4) * 2.2);          // the liquid's own slow streaks
        col = mix(col, vec3(0.040, 0.032, 0.027) + vec3(0.030, 0.023, 0.018) * streak, run);
        col = mix(col, vec3(0.11, 0.085, 0.066), run * smoothstep(0.55, 1.0, off));             // a soft lighter edge: it reads as a body of liquid
        float t = 0.0;
        for (int i = 0; i < 8; i++) {
          float age = uTime - uRip[i].z;
          if (uRip[i].w > 0.0 && age > 0.0 && age < 2.6) { float d = length(vP - uRip[i].xy), q = (d - age * 0.30) / 0.03; t += sin((d - age * 0.30) * 105.0) * exp(-q * q) * exp(-age * 1.4); }
        }
        col += vec3(0.05, 0.04, 0.03) * t * filled;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` }));
  liquid.position.set(0, 0.5, PIECE_TOP + 0.0012); liquid.visible = false; zup.add(liquid);

  // ---- after the pour: flattened and sanded (the raw wood turns into the finished look), then the circle is cut
  const finU = { wipe: { value: 0 }, side: { value: 0 }, gone: { value: 0 } };
  const finMat = side => {
    const m = wood(layFin, { roughness: 0.5, clearcoat: 0.05, envMapIntensity: 0.2 });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uMask: { value: layMask }, uWipe: finU.wipe, uSide: { value: side }, uGone: side < 0 ? finU.gone : { value: 0 },
        uC: { value: new THREE.Vector3(LY.cx / LY.size, 1 - LY.cy / LY.size, 550 / LY.size) } });
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uMask; uniform float uWipe; uniform float uSide; uniform float uGone; uniform vec3 uC;")
        .replace("#include <map_fragment>", `if (texture2D(uMask, vMapUv).g < 0.5) discard;
          float rr = length(vMapUv - uC.xy);
          if (uSide > 0.5 && rr > uC.z) discard;
          if (uSide < -0.5 && rr <= uC.z) discard;
          float edge = 1.0 - vMapUv.y, front = uWipe * 1.1 - edge;
          if (front < 0.0) discard;
          if (uGone > 0.0) { vec2 cell = floor(vMapUv * vec2(70.0, 70.0)); if (uGone > 0.1 + 0.9 * fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453)) discard; }
          #include <map_fragment>
          diffuseColor.rgb += vec3(0.55, 0.32, 0.18) * smoothstep(0.03, 0.0, front) * step(uWipe, 0.999);`);
    };
    return m;
  };
  const finGeo = new THREE.PlaneGeometry(LY.size / 1000, LY.size / 1000);
  const finPos = [(LY.size / 2 - LY.cx) / 1000, (LY.cy - LY.size / 2) / 1000];
  const finIn = new THREE.Mesh(finGeo, finMat(0)), finOut = new THREE.Mesh(finGeo, finMat(-1));
  for (const m of [finIn, finOut]) { m.position.set(finPos[0], finPos[1], LEG_H + TOP_T); m.visible = false; zup.add(m); }
  const ring = (() => {                                         // the cut line of the circle
    const N = 160, seg = [];
    for (let i = 0; i < N; i++) { const a = Math.PI / 2 - 2 * Math.PI * i / N, b = Math.PI / 2 - 2 * Math.PI * (i + 1) / N; seg.push(TOP_R * Math.cos(a), TOP_R * Math.sin(a), 0, TOP_R * Math.cos(b), TOP_R * Math.sin(b), 0); }
    const l = lines(seg, 2.6); l.position.z = LEG_H + TOP_T + 0.003; l.visible = false; l.userData.n = N; lineMats.push(l.material); zup.add(l); return l;
  })();
  const WASTE = pieces(small ? 700 : 1600, { spread: 0.5, melt: 2, tumble: 5, fromNothing: false, recolour: false, dust: true });
  {
    const maskPix = sampler(layMask.image, 350, 350), finPix = sampler(layFin.image, 350, 350);
    const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), c = [0, 0, 0];
    for (let i = 0; i < WASTE.n; i++) {
      const i3 = i * 3; let u, v, x, y;
      for (;;) {
        u = Math.random(); v = Math.random(); x = (u * LY.size - LY.cx) / 1000; y = (LY.cy - (1 - v) * LY.size) / 1000;
        if (x * x + y * y > TOP_R * TOP_R && maskPix(u, v, c, 0, true)[1] > 0.5) break;
      }
      const z = LEG_H + TOP_T + 0.002;
      WASTE.A.set([x, y, z], i3);
      WASTE.M.set([x * 1.25 + (Math.random() - 0.5) * 0.2, y * 1.25 + (Math.random() - 0.5) * 0.2, z + 0.25 + Math.random() * 0.35], i3);
      WASTE.B.set([x * 1.7 + (Math.random() - 0.5) * 0.6, y * 1.7 + (Math.random() - 0.5) * 0.6, z + 0.8 + Math.random() * 0.8], i3);
      WASTE.size.set([0.012 + Math.random() * 0.014, 0.024 + Math.random() * 0.03, 0.003 + Math.random() * 0.004], i3);
      setQ(WASTE.qA, i, q.setFromAxisAngle(zAxis, (Math.random() - 0.5) * 0.7)); setQ(WASTE.qB, i, randomQ(q));
      randomQ(q); WASTE.axis.set([q.x, q.y, q.z].map(w => w / (Math.hypot(q.x, q.y, q.z) || 1)), i3);
      WASTE.phase[i] = Math.random(); WASTE.delay[i] = Math.random();
      finPix(u, v, c); WASTE.mesh.instanceColor.array.set(c, i3);
    }
    WASTE.mesh.instanceColor.needsUpdate = true; zup.add(WASTE.mesh);
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
  function draw(time) {
    requestAnimationFrame(draw);
    if (!onscreen) return;
    ps += (p - ps) * 0.11; if (Math.abs(p - ps) < 0.0002) ps = p;
    mxs += (mx - mxs) * 0.06; mys += (my - mys) * 0.06;
    const k = keyAt(K, ps), wide = W / H > 1.05;
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

    // the slabs come down; the saw crosses them; the offcuts lift away in pieces; the two pieces slide into the pour layout
    const arr = smooth(ramp(tc, 0.62, 1.0)), apart = smooth(ramp(tc, 0.36, 0.5)), lift = ramp(tc, 0.42, 0.86);
    slabsG.visible = slabsIn > 0 && tf < 0.44; slabsG.position.z = SLAB_Z + 2.4 * (1 - slabsIn);
    slabs.forEach((s, si) => {
      s.piece.g.position.set(mix(s.x0, s.to.x, arr), mix(0, s.to.y, arr), 0); s.piece.g.scale.y = mix(1, s.to.s, arr);
      s.offs.forEach((o, i) => {
        o.g.visible = lift < 1; o.g.position.set(s.x0, (i ? -1 : 1) * 0.035 * apart, easeOut(lift) * 0.22); o.u.gone.value = ramp(lift, 0.02, 0.62);
      });
      s.saws.forEach((w, i) => {
        const c = si * 2 + i, sweep = ramp(tc, 0.05 + c * 0.055, 0.23 + c * 0.055);
        w.g.scale.x = Math.max(sweep, 0.0001); w.ln.material.opacity = (sweep > 0 ? 1 : 0) * (1 - ramp(tc, 0.40, 0.50)); w.g.visible = w.ln.material.opacity > 0.01;
      });
    });
    movePieces(DUST, ramp(tc, 0, 0.5), time);
    movePieces(OFF, ramp(tc, 0.40, 0.92), time);
    const formIn = easeOut(ramp(tc, 0.55, 0.96)), formOut = smooth(ramp(tf, 0.62, 0.95));
    form.visible = formIn > 0 && formOut < 1; form.position.set(0, 0, SLAB_Z - 0.0095 - 1.4 * (1 - formIn) - 2.8 * formOut);

    // the pour: the stream runs down from the top of the page, then the gap fills from the bottom up
    clock.value = time * 0.001;
    liquid.visible = tp > 0 && tf < 0.44;
    liq.uHead.value = mix(1.95, -0.63, ramp(tp, 0, 0.2)); liq.uLevel.value = ramp(tp, 0.18, 0.9); liq.uFlow.value = 1 - smooth(ramp(tp, 0.88, 0.99));

    // flattened and sanded, then the circle is cut; what is left outside lifts away in pieces
    const cut = tf >= 0.66, waste = ramp(tf, 0.66, 1);
    finU.wipe.value = ramp(tf, 0, 0.42); finU.gone.value = ramp(waste, 0, 0.5);
    finIn.visible = tf > 0 && !cut; finOut.visible = cut && waste < 0.5; finOut.position.z = LEG_H + TOP_T + easeOut(waste) * 0.15;
    topMesh.visible = cut;
    const drawn = ramp(tf, 0.42, 0.66);
    ring.visible = drawn > 0 && tf < 0.9; ring.geometry.instanceCount = Math.max(1, Math.round(ring.userData.n * drawn)); ring.material.opacity = 1 - ramp(tf, 0.70, 0.9);
    movePieces(WASTE, ramp(tf, 0.64, 1), time);

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
