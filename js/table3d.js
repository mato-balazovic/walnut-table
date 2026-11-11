// The landing: the table drawn live in 3D and driven by the scroll position.
// One leg as a line drawing -> filled with walnut -> four legs -> the top lands -> seen from above.
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
  return { geometry: g, segments: seg };
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
  const seg = [];
  for (const z of [zt, zb]) for (let i = 0; i < N; i++) {
    const a = 2 * Math.PI * i / N, b = 2 * Math.PI * (i + 1) / N;
    seg.push(TOP_R * Math.cos(a), TOP_R * Math.sin(a), z, TOP_R * Math.cos(b), TOP_R * Math.sin(b), z);
  }
  return { geometry: g, segments: seg };
}

function lines(segments, width) {
  const g = new LineSegmentsGeometry(); g.setPositions(segments);
  const m = new LineMaterial({ color: LINE, linewidth: width, transparent: true, opacity: 1, depthWrite: false });
  return new LineSegments2(g, m);
}

// ---------------------------------------------------------------- the scroll story
// p: where in the story (0 to 1). az/el: camera angles. t: what it looks at. fw/fh: the size to keep in frame (m).
// sx: how far right of centre the subject sits on a wide screen. use: share of the width it may fill.
const KEYS = [
  { p: 0.00, az: 0.00, el: 0.02, t: [0.26, 0.375, 0], fw: 0.60, fh: 0.84, sx: 0.21, use: 0.44 },
  { p: 0.16, az: 0.78, el: 0.14, t: [0.26, 0.375, 0], fw: 0.66, fh: 0.90, sx: 0.20, use: 0.48 },
  { p: 0.36, az: 0.42, el: 0.10, t: [0.26, 0.375, 0], fw: 0.66, fh: 0.90, sx: 0.20, use: 0.48 },
  { p: 0.57, az: 0.15, el: 0.22, t: [0, 0.40, 0], fw: 1.22, fh: 0.98, sx: 0.17, use: 0.58 },
  { p: 0.77, az: -0.35, el: 0.42, t: [0, 0.45, 0], fw: 1.28, fh: 1.05, sx: 0.15, use: 0.60 },
  { p: 0.94, az: -Math.PI / 4, el: 1.45, t: [0, 0.79, 0], fw: 1.26, fh: 1.26, sx: 0.15, use: 0.62 },
];
function keyAt(p) {
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = smooth(ramp(p, a.p, b.p)), o = {};
  for (const k of ["az", "el", "fw", "fh", "sx", "use"]) o[k] = mix(a[k], b[k], t);
  o.t = a.t.map((v, j) => mix(v, b.t[j], t));
  return o;
}

async function start(canvas) {
  const stage = canvas.closest(".stage"), story = document.getElementById("story");
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  gl.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05;
  gl.localClippingEnabled = true;

  const base = canvas.dataset.base, v = "?v=" + canvas.dataset.v;
  const loader = new THREE.TextureLoader();
  const tex = async (name, colour = true) => {
    const t = await loader.loadAsync(base + name + v);
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = gl.capabilities.getMaxAnisotropy();
    return t;
  };
  const [data, topMap, topRough, ...legMaps] = await Promise.all([
    fetch(base + "leg.json" + v).then(r => r.json()),
    tex("top.jpg"), tex("top-rough.jpg", false), tex("leg1.jpg"), tex("leg2.jpg"), tex("leg3.jpg"), tex("leg4.jpg"),
  ]);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(gl);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffe6cc, 2.4); key.position.set(2.5, 3.2, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb088, 2.6); rim.position.set(-3, 1.6, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);

  const spin = new THREE.Group(); spin.rotation.y = -Math.PI / 4;       // leg 1 lies along +x, facing the camera
  const zup = new THREE.Group(); zup.rotation.x = -Math.PI / 2; spin.add(zup); scene.add(spin);

  const fillPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);     // keeps what is below this height
  const wood = (map, extra) => new THREE.MeshPhysicalMaterial(Object.assign({
    map, color: 0xe6dcd4, roughness: 0.42, clearcoat: 0.22, clearcoatRoughness: 0.28, envMapIntensity: 0.55, side: THREE.DoubleSide,
  }, extra));

  const leg = legParts(data.leg);
  const legs = LEG_ANGLES.map((a, k) => {
    const g = new THREE.Group(); g.rotation.z = a;
    const mesh = new THREE.Mesh(leg.geometry, wood(legMaps[k], { clippingPlanes: [fillPlane] }));
    g.add(mesh); zup.add(g);
    return { g, mesh };
  });
  const legLines = lines(leg.segments, 1.8); legs[0].g.add(legLines);

  const top = topParts();
  const topG = new THREE.Group(); zup.add(topG);
  topG.add(new THREE.Mesh(top.geometry, wood(topMap, { roughnessMap: topRough, roughness: 1, clearcoat: 0.08, envMapIntensity: 0.32 })));
  const topLines = lines(top.segments, 1.3); topG.add(topLines);

  // the page around the canvas
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

  let W = 1, H = 1, p = 0, ps = 0, mx = 0, my = 0, mxs = 0, mys = 0, onscreen = true, first = true;
  function size() {
    W = stage.clientWidth; H = stage.clientHeight; gl.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    legLines.material.resolution.set(W, H); topLines.material.resolution.set(W, H);
  }
  function where() { const r = story.getBoundingClientRect(); p = clamp(-r.top / Math.max(1, r.height - innerHeight)); }
  addEventListener("resize", () => { size(); where(); });
  addEventListener("scroll", where, { passive: true });
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) addEventListener("pointermove", e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; });
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { onscreen = es[0].isIntersecting; }).observe(story);
  size(); where(); ps = p;

  const tmp = new THREE.Vector3();
  function draw(time) {
    requestAnimationFrame(draw);
    if (!onscreen) return;
    ps += (p - ps) * 0.11; if (Math.abs(p - ps) < 0.0002) ps = p;
    mxs += (mx - mxs) * 0.06; mys += (my - mys) * 0.06;
    const k = keyAt(ps), wide = W / H > 1.05;
    const fill = ramp(ps, 0.20, 0.38), fan = easeOut(ramp(ps, 0.43, 0.58)), drop = ramp(ps, 0.61, 0.77), look = ramp(ps, 0.88, 0.95);

    fillPlane.constant = mix(-0.01, 0.80, fill);
    legs[0].mesh.visible = fill > 0;
    legLines.material.opacity = 1 - ramp(ps, 0.34, 0.45); legLines.visible = legLines.material.opacity > 0.01;
    for (let i = 1; i < 4; i++) {
      legs[i].g.visible = fan > 0;
      const target = i === 3 ? LEG_ANGLES[0] - Math.PI / 2 : LEG_ANGLES[i];
      legs[i].g.rotation.z = mix(LEG_ANGLES[0], target, fan);
    }
    topG.visible = drop > 0; topG.position.z = (1 - easeOut(drop)) * 0.75;
    topLines.material.opacity = ramp(drop, 0, 0.15) * (1 - ramp(ps, 0.76, 0.84)); topLines.visible = topLines.material.opacity > 0.01;

    const tanF = Math.tan(FOV * Math.PI / 360);
    const dist = Math.max(k.fh / (2 * tanF * (wide ? 0.74 : 0.50)), k.fw / (2 * tanF * cam.aspect * (wide ? k.use : 0.86)));
    const calm = 1 - 0.8 * look, sway = Math.sin(time * 0.00045) * 0.07 * (1 - ramp(ps, 0, 0.12));
    const az = k.az + sway + mxs * 0.22 * calm, el = clamp(k.el - mys * 0.10 * calm, -0.2, 1.5);
    cam.position.set(k.t[0] + dist * Math.sin(az) * Math.cos(el), k.t[1] + dist * Math.sin(el), k.t[2] + dist * Math.cos(az) * Math.cos(el));
    cam.lookAt(k.t[0], k.t[1], k.t[2]);
    cam.setViewOffset(W, H, wide ? -k.sx * W : 0, wide ? -0.03 * H : 0.17 * H, W, H);
    gl.render(scene, cam);

    const gone = ramp(ps, 0.015, 0.07);
    land.style.opacity = 1 - gone; land.style.transform = `translate3d(0, ${-gone * 40}px, 0)`; land.style.visibility = gone < 1 ? "visible" : "hidden";
    for (const c of chaps) {
      const q = ramp(ps, c.from, c.from + 0.06), out = 1 - ramp(ps, c.to - 0.035, c.to);
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

const canvas = document.getElementById("table3d");
const still = () => document.documentElement.classList.add("static");
if (!canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) still();
else start(canvas).catch(e => { console.warn("3D landing off:", e); still(); });
