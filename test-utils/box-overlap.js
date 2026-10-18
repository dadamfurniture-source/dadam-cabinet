/* global module */
/**
 * T1 (PR1): 판재 겹침 판정 — 3D 장면의 부재가 서로 **파고드는가**를 숫자로 본다.
 * (docs/01-plan/planner-cad.plan.md 단계 0 · PR1, 개정 #5·#7·#8)
 *
 * 입력은 three 에 기대지 않는 평범한 값이다 — 합성 쌍 시험을 손으로 짤 수 있게.
 *   solid  { min:[x,y,z], max:[x,y,z], m:[16] }  로컬 축 상자 + 로컬→월드 행렬(three Matrix4.elements, 열 우선)
 *   piece  { id, solids:[solid…], …메타 }        부재 하나. 따낸 판은 서로 겹치지 않는 상자 여럿으로 쪼갠다
 *
 * 겹침 기준 (사장님 계획 T1):  부피 > 1mm³ **이고** 파고든 깊이 > 0.1mm.
 *   면 접촉(맞대기)은 부피 0 이라 겹침이 아니다. 깊이는 분리축(SAT) 중 가장 얕게 겹친 축의 겹친 길이 —
 *   두 판을 떼어 놓으려면 최소 얼마를 밀어야 하는가.
 *   부피는 한 상자를 다른 상자의 여섯 면으로 잘라 남은 볼록 다면체의 부피다 (축이 기울어도 정확).
 */

const DEFAULT_LIMITS = { minVolume: 1, minDepth: 0.1 };

// ── 작은 벡터 도구 ──────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** 열 우선 4×4 로 점을 옮긴다. */
function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** 상자의 여덟 꼭짓점 (월드). 순서: 비트 0=x, 1=y, 2=z (0 이면 min). */
function cornersOf(s) {
  const m = s.m || IDENTITY;
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(apply(m, [
      i & 1 ? s.max[0] : s.min[0],
      i & 2 ? s.max[1] : s.min[1],
      i & 4 ? s.max[2] : s.min[2],
    ]));
  }
  return out;
}

/** 월드 축 바운딩 박스 — 넓게 거르는 단계용. */
function worldAabbOf(solids) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  solids.forEach((s) => cornersOf(s).forEach((p) => {
    for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }));
  return { min: lo, max: hi };
}

/** 상자의 세 축(월드, 단위 벡터). 행렬에 배율이 있어도 방향만 쓴다. */
function axesOf(s) {
  const m = s.m || IDENTITY;
  return [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]].map((v) => scale(v, 1 / (len(v) || 1)));
}

/** 꼭짓점 목록을 축에 투영한 [min, max]. */
function project(points, axis) {
  let lo = Infinity, hi = -Infinity;
  points.forEach((p) => { const d = dot(p, axis); if (d < lo) lo = d; if (d > hi) hi = d; });
  return [lo, hi];
}

/**
 * 분리축 시험으로 파고든 깊이 — 15 축 중 겹친 길이가 가장 짧은 값. 떨어져 있으면 ≤ 0.
 */
function penetrationDepth(a, b) {
  const ca = cornersOf(a), cb = cornersOf(b);
  const A = axesOf(a), B = axesOf(b);
  const axes = A.concat(B);
  A.forEach((u) => B.forEach((v) => {
    const c = cross(u, v);
    const l = len(c);
    if (l > 1e-6) axes.push(scale(c, 1 / l));   // 평행한 축의 외적은 버린다
  }));
  let depth = Infinity;
  for (const ax of axes) {
    const [a0, a1] = project(ca, ax);
    const [b0, b1] = project(cb, ax);
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o < depth) depth = o;
    if (depth <= 0) return depth;
  }
  return depth;
}

// ── 볼록 다면체 자르기 (부피) ─────────────────────────────────────

/** 상자를 면(꼭짓점 고리) 여섯 개로. */
function facesOf(s) {
  const c = cornersOf(s);
  // 비트 순서 (x=1, y=2, z=4) 로 꼭짓점 번호를 붙였다 — 면마다 고리 순서로 넷
  return [
    [0, 2, 6, 4], [1, 5, 7, 3],   // x− · x+
    [0, 4, 5, 1], [2, 3, 7, 6],   // y− · y+
    [0, 1, 3, 2], [4, 6, 7, 5],   // z− · z+
  ].map((f) => f.map((i) => c[i]));
}

/** 상자의 반공간 여섯 개 {n, d} — 안쪽은 n·p ≤ d. */
function halfSpacesOf(s) {
  const c = cornersOf(s);
  return axesOf(s).flatMap((ax) => {
    const [lo, hi] = project(c, ax);
    return [{ n: ax, d: hi }, { n: scale(ax, -1), d: -lo }];
  });
}

/** 볼록 다면체(면 목록)를 반공간 n·p ≤ d 로 자른다. */
function clipPolyhedron(faces, h) {
  const EPS = 1e-7;
  // 바깥으로 나간 꼭짓점이 없으면 자를 것이 없다 — 면이 평면에 딱 붙은 경우 뚜껑을 또 만들면 부피가 두 번 센다
  if (!faces.some((poly) => poly.some((p) => dot(h.n, p) - h.d > EPS))) return faces;
  const out = [];
  const cap = [];
  faces.forEach((poly) => {
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const dp = dot(h.n, p) - h.d, dq = dot(h.n, q) - h.d;
      const pin = dp <= EPS, qin = dq <= EPS;
      if (pin) res.push(p);
      if (pin !== qin) {
        const t = dp / (dp - dq);
        const x = add(p, scale(sub(q, p), t));
        res.push(x);
        cap.push(x);
      } else if (pin && Math.abs(dp) <= EPS) {
        cap.push(p);
      }
    }
    if (res.length >= 3) out.push(res);
  });
  if (cap.length >= 3) {
    // 잘린 자리의 뚜껑 — 평면 위 점들을 중심 둘레 각도로 줄 세운다 (볼록이라 이것으로 고리가 된다)
    const c = scale(cap.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / cap.length);
    const u0 = Math.abs(h.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = (() => { const v = cross(h.n, u0); return scale(v, 1 / len(v)); })();
    const v = cross(h.n, u);
    const ring = cap
      .map((p) => ({ p, a: Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) }))
      .sort((x, y) => x.a - y.a)
      .map((o) => o.p);
    out.push(ring);
  }
  return out;
}

/** 볼록 다면체의 부피 — 무게중심에서 면마다 사면체 부채꼴, 절댓값 합 (방향을 몰라도 된다). */
function polyhedronVolume(faces) {
  const pts = faces.flat();
  if (pts.length < 4) return 0;
  const c = scale(pts.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / pts.length);
  let v = 0;
  faces.forEach((f) => {
    for (let i = 1; i + 1 < f.length; i++) {
      v += Math.abs(dot(sub(f[0], c), cross(sub(f[i], c), sub(f[i + 1], c)))) / 6;
    }
  });
  return v;
}

/** 두 상자가 함께 차지하는 부피 (mm³). */
function intersectionVolume(a, b) {
  let faces = facesOf(b);
  for (const h of halfSpacesOf(a)) {
    faces = clipPolyhedron(faces, h);
    if (!faces.length) return 0;
  }
  return polyhedronVolume(faces);
}

/** 상자 한 쌍: {volume, depth}. 깊이가 0 이하면 부피도 0 으로 둔다 (떨어져 있거나 면만 닿는다). */
function boxPairOverlap(a, b) {
  const depth = penetrationDepth(a, b);
  if (!(depth > 0)) return { volume: 0, depth: Math.max(0, depth) };
  return { volume: intersectionVolume(a, b), depth };
}

/**
 * 부재 한 쌍. 부재마다 상자 여럿(따낸 판)일 수 있다 — 한 부재 안 상자들은 서로 겹치지 않으므로
 * 부피는 쌍마다 더한 값이 정확하다. 깊이는 쌍 가운데 가장 깊은 값.
 */
function pieceOverlap(A, B) {
  let volume = 0, depth = 0;
  A.solids.forEach((a) => B.solids.forEach((b) => {
    const r = boxPairOverlap(a, b);
    volume += r.volume;
    if (r.volume > 0 && r.depth > depth) depth = r.depth;
  }));
  return { volume, depth };
}

function isOverlap(r, limits) {
  const L = Object.assign({}, DEFAULT_LIMITS, limits);
  return r.volume > L.minVolume && r.depth > L.minDepth;
}

/**
 * 부재 목록에서 겹치는 쌍을 모두 찾는다.
 * @param {Array<{id:string, solids:Array}>} pieces
 * @param {{minVolume?:number, minDepth?:number}} [limits]
 * @returns {Array<{a, b, volume, depth}>} a·b 는 piece 그대로
 */
function findOverlaps(pieces, limits) {
  const boxes = pieces.map((p) => worldAabbOf(p.solids));
  // x 로 정렬해 쓸어 가며 넓게 거른다 (부재 수백 개 — 쌍 전부를 자르면 느리다)
  const order = pieces.map((_, i) => i).sort((i, j) => boxes[i].min[0] - boxes[j].min[0]);
  const out = [];
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (boxes[j].min[0] >= boxes[i].max[0]) break;
      const bi = boxes[i], bj = boxes[j];
      if (bj.min[1] >= bi.max[1] || bi.min[1] >= bj.max[1]) continue;
      if (bj.min[2] >= bi.max[2] || bi.min[2] >= bj.max[2]) continue;
      const r = pieceOverlap(pieces[i], pieces[j]);
      if (isOverlap(r, limits)) {
        const [a, b] = String(pieces[i].id) < String(pieces[j].id) ? [pieces[i], pieces[j]] : [pieces[j], pieces[i]];
        out.push({ a, b, volume: r.volume, depth: r.depth });
      }
    }
  }
  return out;
}

/**
 * 직각 다각형(따낸 판 단면)을 서로 겹치지 않는 직사각형으로 쪼갠다.
 * 꼭짓점의 y 값마다 띠를 나누고, 띠 가운데 높이에서 세로 변과 만나는 x 를 짝지어 구간을 얻는다.
 * @param {Array<[number, number]>} pts 닫힌 고리 (마지막 점이 첫 점과 같아도 된다)
 * @returns {Array<{x0, x1, y0, y1}>}
 */
function rectilinearRects(pts) {
  const ring = pts.slice();
  if (ring.length > 1) {
    const f = ring[0], l = ring[ring.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) ring.pop();
  }
  const ys = [...new Set(ring.map((p) => p[1]))].sort((a, b) => a - b);
  const rects = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const y0 = ys[k], y1 = ys[k + 1];
    const ym = (y0 + y1) / 2;
    const xs = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if ((p[1] - ym) * (q[1] - ym) < 0) xs.push(p[0] + (q[0] - p[0]) * (ym - p[1]) / (q[1] - p[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) rects.push({ x0: xs[i], x1: xs[i + 1], y0, y1 });
  }
  return rects;
}

module.exports = {
  DEFAULT_LIMITS,
  IDENTITY,
  apply,
  cornersOf,
  worldAabbOf,
  penetrationDepth,
  intersectionVolume,
  boxPairOverlap,
  pieceOverlap,
  isOverlap,
  findOverlaps,
  rectilinearRects,
};
