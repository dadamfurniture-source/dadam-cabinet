/**
 * 조립 검사 — 조립 명세 `dadam.assembly/1` 의 판재가 서로 파고들거나, 붙어야 할 곳에 붙지 않았는가
 * (다담 CAD 베타 PR7, docs/01-plan/planner-cad.plan.md §PR7 · 개정 #5).
 *
 * 규칙을 새로 정하지 않는다. 명세가 이미 정한 자리(frame · box · features · tags)끼리 맞는지만 본다.
 *
 * 검사 (code → 수준):
 *   part-overlap       error    한 모듈 안 두 판재가 파고든다 — 부피 > 1mm³ 이고 깊이 > 0.1mm (T1 기준).
 *                               면 접촉(맞대기)은 부피 0 이라 겹침이 아니다. 사쿠리 뒷판이 측판 홈(groove) 자리 안에서만
 *                               측판과 겹치는 것은 홈에 끼운 것이라 뺀다 (홈 깊이 D5 미정이라 명세가 측판에서 홈을 빼지 않았다).
 *   back-cover         error    뒷판이 양쪽 측판에 걸치지 않는다 — 뒷판 가로 범위가 두 측판 안쪽 면을 모두 넘어야 한다
 *                               (홈에 끼우든 뒤에 덮든). #832 이전처럼 측판 사이에 끼운 옛 크기 (W−2T) 뒷판을 잡는다.
 *   back-contact       error    뒷판이 붙을 자리에 없다 — mount 'groove' 면 측판 홈의 깊이 방향 범위 안,
 *                               'behind-sides' 면 측판 뒤끝 면에 맞닿아야 한다.
 *   part-detached      error    어느 판재에도 닿지 않고 떠 있는 판재 (모듈 안).
 *   assembly-unplaced  warning  명세가 아직 자리를 못 정한 BOM 행 — 모듈마다 한 줄 (사유별 개수).
 *
 * 아직 두지 않는 검사: clearance (도어·서랍 틈 문턱이 정본에 없다 — 문턱이 정해지면 넣는다), dfm-*.
 *
 * 출력 이슈: { level, code, message, partId?, other?, moduleKey?, volumeMm3?, depthMm? } — bom-preflight 와 같은 모양.
 *
 * 겹침 판정 핵심(T1, 옛 test-utils/box-overlap.js) 도 여기 있다 — 입력은 three 에 기대지 않는 값:
 *   solid  { min:[x,y,z], max:[x,y,z], m:[16] }  로컬 축 상자 + 로컬→월드 행렬(열 우선)
 *   piece  { id, solids:[solid…], …메타 }        부재 하나. 따낸 판은 서로 겹치지 않는 상자 여럿
 *   깊이는 분리축(SAT) 중 가장 얕게 겹친 축의 겹친 길이, 부피는 볼록 다면체 자르기로 (축이 기울어도 정확).
 *
 * 브라우저는 전역 `DadamAssemblyCheck`, Node(Jest)는 module.exports. DOM 없음.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAssemblyCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  /* global require */
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

  // ── 조립 명세 검사 ───────────────────────────────────────────────

  const EPS = 1e-6;
  const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

  function assemblyApi() {
    return root.DadamAssembly
      || (typeof require === 'function' ? require('./bom-assembly.js') : null);
  }

  /** 두 상자가 함께 차지하는 상자 (없으면 null). */
  function boxAnd(a, b) {
    const min = [0, 1, 2].map((i) => Math.max(a.min[i], b.min[i]));
    const max = [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]));
    return min.every((v, i) => v < max[i]) ? { min, max } : null;
  }

  function boxInside(inner, outer, eps) {
    return [0, 1, 2].every((i) => inner.min[i] >= outer.min[i] - eps && inner.max[i] <= outer.max[i] + eps);
  }

  /** 두 상자 사이 거리가 eps 이하 (닿거나 겹친다). */
  function boxTouch(a, b, eps) {
    return [0, 1, 2].every((i) => a.min[i] <= b.max[i] + eps && b.min[i] <= a.max[i] + eps);
  }

  const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

  /** 판재의 홈(groove) 자리 — 재단면 u0..u1 × v0..v1, 두께 전체 (홈 깊이 D5 미정). 모듈 로컬 상자. */
  function grooveBoxesOf(Asm, part) {
    const U = AXES[part.frame.u], V = AXES[part.frame.v];
    return (part.features || []).filter((f) => f.type === 'groove').map((f) => {
      const o = [0, 1, 2].map((i) => part.frame.o[i] + U[i] * f.u0 + V[i] * f.v0);
      return Asm.boxOfFrame(Object.assign({}, part.frame, { o }), f.u1 - f.u0, f.v1 - f.v0, part.t);
    });
  }

  /** 뒷판이 측판 홈 자리 안에서만 측판과 겹치는가. */
  function seatedInGroove(Asm, back, side) {
    if (!back.tags || back.tags.mount !== 'groove') return false;
    const both = boxAnd(back.box, side.box);
    if (!both) return false;
    return grooveBoxesOf(Asm, side).some((g) => boxInside(both, g, EPS));
  }

  /**
   * 한 모듈의 판재 검사.
   * @returns {Array} 이슈
   */
  function checkModule(Asm, m, limits) {
    const issues = [];
    const mk = m.moduleKey;
    const parts = m.parts || [];
    const name = (p) => `${p.part}(${p.id})`;

    // 겹침
    const pieces = parts.map((p) => ({ id: p.id, part: p, solids: Asm.solidsOf(p).map((s) => Object.assign({ m: IDENTITY }, s)) }));
    findOverlaps(pieces, limits).forEach(({ a, b, volume, depth }) => {
      const A = a.part, B = b.part;
      if (seatedInGroove(Asm, A, B) || seatedInGroove(Asm, B, A)) return;
      issues.push({
        level: 'error',
        code: 'part-overlap',
        message: `${mk}: ${A.part} 와 ${B.part} 가 ${round1(depth)}mm 파고듭니다 (${Math.round(volume)}mm³)`,
        partId: A.id,
        other: B.id,
        moduleKey: mk,
        volumeMm3: Math.round(volume),
        depthMm: round1(depth),
      });
    });

    // 뒷판 덮개 · 접촉 — 뒷판 자리(mount)는 명세가 정했다
    const sides = parts.filter((p) => p.tags && (p.tags.side === 'left' || p.tags.side === 'right'));
    if (sides.length === 2) {
      const inner = { lo: Math.max(...sides.filter((s) => s.tags.side === 'left').map((s) => s.box.max[0])),
        hi: Math.min(...sides.filter((s) => s.tags.side === 'right').map((s) => s.box.min[0])) };
      const sideBack = Math.max(...sides.map((s) => s.box.min[2]));
      parts.filter((p) => p.tags && (p.tags.mount === 'groove' || p.tags.mount === 'behind-sides')).forEach((p) => {
        if (!(p.box.min[0] < inner.lo - EPS && p.box.max[0] > inner.hi + EPS)) {
          issues.push({
            level: 'error',
            code: 'back-cover',
            message: `${mk}: ${p.part} 가 양쪽 측판에 걸치지 않습니다 (가로 ${round1(p.box.min[0])}~${round1(p.box.max[0])}, 측판 안쪽 ${round1(inner.lo)}~${round1(inner.hi)})`,
            partId: p.id,
            moduleKey: mk,
          });
        }
        let seated;
        if (p.tags.mount === 'groove') {
          const grooves = sides.flatMap((s) => grooveBoxesOf(Asm, s));
          seated = grooves.length > 0 && grooves.every((g) => p.box.min[2] >= g.min[2] - EPS && p.box.max[2] <= g.max[2] + EPS);
        } else {
          seated = Math.abs(p.box.max[2] - sideBack) <= EPS;
        }
        if (!seated) {
          issues.push({
            level: 'error',
            code: 'back-contact',
            message: `${mk}: ${p.part} 가 ${p.tags.mount === 'groove' ? '측판 홈' : '측판 뒤끝'}에 붙어 있지 않습니다 (깊이 ${round1(p.box.min[2])}~${round1(p.box.max[2])})`,
            partId: p.id,
            moduleKey: mk,
          });
        }
      });
    }

    // 떠 있는 판재
    if (parts.length > 1) {
      parts.forEach((p) => {
        if (!parts.some((q) => q !== p && boxTouch(p.box, q.box, 0.1))) {
          issues.push({ level: 'error', code: 'part-detached', message: `${mk}: ${name(p)} 가 어느 판재에도 닿지 않습니다`, partId: p.id, moduleKey: mk });
        }
      });
    }
    return issues;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /**
   * 조립 명세 검사.
   * @param {object} spec  DadamAssembly.of() 결과
   * @param {{limits?:{minVolume?:number, minDepth?:number}}} [opts]
   * @returns {{ok:boolean, counts:{error:number, warning:number, info:number}, issues:Array}}
   */
  function check(spec, opts) {
    const o = opts || {};
    const Asm = assemblyApi();
    const issues = [];
    ((spec && spec.items) || []).forEach((it) => (it.modules || []).forEach((m) => {
      checkModule(Asm, m, o.limits).forEach((x) => issues.push(x));
    }));

    // 자리 못 정한 행 — 모듈마다 한 줄
    const byMk = new Map();
    ((spec && spec.unplaced) || []).forEach((u) => {
      const mk = u.moduleKey || '';
      if (!byMk.has(mk)) byMk.set(mk, new Map());
      const r = byMk.get(mk);
      r.set(u.reason, (r.get(u.reason) || 0) + 1);
    });
    byMk.forEach((reasons, mk) => {
      const n = [...reasons.values()].reduce((s, v) => s + v, 0);
      const why = [...reasons.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([r, c]) => `${r} ${c}`).join(' · ');
      issues.push({
        level: 'warning',
        code: 'assembly-unplaced',
        message: `${mk || '(모듈 없음)'}: CAD 자리를 아직 못 정한 행 ${n}개 (${why})`,
        moduleKey: mk || undefined,
      });
    });

    issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    const counts = { error: 0, warning: 0, info: 0 };
    issues.forEach((x) => { counts[x.level]++; });
    return { ok: counts.error === 0, counts, issues };
  }

  return {
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
    check,
  };
});
