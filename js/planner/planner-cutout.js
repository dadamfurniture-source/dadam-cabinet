// ============================================================
// 기둥·배관 따내기 — planner-cutout.js (구조 페이지)
//
// ArchiWood 영상 분석 D (2026-10-19). 모듈의 측판·천판·지판 한 장에 사각 따내기를 단다.
//   s.cutouts = [{ panel, row, col, w, h }]
//     panel  'left' | 'right' | 'top' | 'bottom'  (좌측판 · 우측판 · 천판 · 지판)
//     row·col 3×3 격자 0·1·2 — 판을 그 판 쪽에서 본 위치 (PLANNER_CUTOUT_PANELS 의 rows·cols)
//     w·h    따내기 가로 × 세로 mm — 판 기준 u 방향 × v 방향
//   판 좌표 (u, v) 는 0 에서 시작한다.
//     측판   u = 깊이 (뒤 0 → 앞 D), v = 높이 (아래 0 → 위 몸통 H)
//     천·지판 u = 폭 (좌 0 → 우 W − 2T), v = 깊이 (뒤 0 → 앞)
//
// 규칙을 새로 두지 않는다 — 위치·치수는 사용자가 넣는 값이다. 재단기는 사각 판만 자르므로
// BOM 은 그 판의 비고에 따내기를 적는다 (extractors.js bomCutoutNoteOf).
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_CUTOUT_ / plannerCutout / plannerPanel 접두.
// ============================================================

const PLANNER_CUTOUT_PANELS = {
  left: {
    label: '좌측판',
    u: '깊이',
    v: '높이',
    cols: ['뒤', '가운데', '앞'],
    rows: ['아래', '가운데', '위'],
  },
  right: {
    label: '우측판',
    u: '깊이',
    v: '높이',
    cols: ['뒤', '가운데', '앞'],
    rows: ['아래', '가운데', '위'],
  },
  top: {
    label: '천판',
    u: '폭',
    v: '깊이',
    cols: ['좌', '가운데', '우'],
    rows: ['뒤', '가운데', '앞'],
  },
  bottom: {
    label: '지판',
    u: '폭',
    v: '깊이',
    cols: ['좌', '가운데', '우'],
    rows: ['뒤', '가운데', '앞'],
  },
};

/** 저장값 정규화 — 판·격자·치수가 맞지 않는 줄은 버린다. */
function plannerCutoutsOf(s) {
  const list = s && Array.isArray(s.cutouts) ? s.cutouts : [];
  const idx = (v) => {
    const n = Number(v);
    return n === 0 || n === 1 || n === 2 ? n : null;
  };
  return list
    .map((c) => ({
      panel: c && c.panel,
      row: idx(c && c.row),
      col: idx(c && c.col),
      w: Number(c && c.w),
      h: Number(c && c.h),
    }))
    .filter(
      (c) =>
        PLANNER_CUTOUT_PANELS[c.panel] && c.row !== null && c.col !== null && c.w > 0 && c.h > 0
    );
}

/** "좌측판 80×350 뒤·아래" */
function plannerCutoutLabel(c) {
  const P = PLANNER_CUTOUT_PANELS[c.panel];
  if (!P) return '';
  return `${P.label} ${c.w}×${c.h} ${P.cols[c.col]}·${P.rows[c.row]}`;
}

/** 판(A × B) 위 따내기 사각형. 격자 0 = 시작 끝에 붙음, 1 = 가운데, 2 = 반대 끝에 붙음. */
function plannerCutoutRect(c, A, B) {
  const at = (i, len, size) => (i === 0 ? 0 : i === 2 ? size - len : (size - len) / 2);
  const u0 = at(c.col, c.w, A);
  const v0 = at(c.row, c.h, B);
  return { u0, u1: u0 + c.w, v0, v1: v0 + c.h };
}

/** 판이 남는가 — 따내기가 판보다 작아야 한다. */
function plannerCutoutFits(c, A, B) {
  return c.w > 0 && c.h > 0 && c.w < A && c.h < B;
}

/**
 * 판(A × B)에서 사각형들을 뺀 윤곽. 순수 계산 — THREE 없음.
 *   사각형 경계로 판을 칸으로 나누고, 남는 칸의 바깥 변만 이어 고리를 만든다.
 *   반시계 고리(넓이 > 0) = 바깥선, 시계 고리 = 구멍.
 * @returns {{outer:Array<[number,number]>, holes:Array<Array<[number,number]>>}}
 */
function plannerPanelOutline(A, B, rects) {
  const clip = (x, max) => Math.max(0, Math.min(max, x));
  const rs = (rects || []).map((r) => ({
    u0: clip(r.u0, A),
    u1: clip(r.u1, A),
    v0: clip(r.v0, B),
    v1: clip(r.v1, B),
  }));
  const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);
  const us = uniq([0, A].concat(...rs.map((r) => [r.u0, r.u1])));
  const vs = uniq([0, B].concat(...rs.map((r) => [r.v0, r.v1])));
  const filled = (i, j) => {
    if (i < 0 || j < 0 || i >= us.length - 1 || j >= vs.length - 1) return false;
    const cu = (us[i] + us[i + 1]) / 2;
    const cv = (vs[j] + vs[j + 1]) / 2;
    return !rs.some((r) => cu > r.u0 && cu < r.u1 && cv > r.v0 && cv < r.v1);
  };
  // 채운 칸의 반시계 변 중 이웃이 비어 있는 것만 — 시작점 키 → 끝점
  const next = new Map();
  const key = (u, v) => `${u},${v}`;
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      if (!filled(i, j)) continue;
      const [a, b, c, d] = [us[i], us[i + 1], vs[j], vs[j + 1]];
      if (!filled(i, j - 1)) next.set(key(a, c), [b, c]);
      if (!filled(i + 1, j)) next.set(key(b, c), [b, d]);
      if (!filled(i, j + 1)) next.set(key(b, d), [a, d]);
      if (!filled(i - 1, j)) next.set(key(a, d), [a, c]);
    }
  }
  const loops = [];
  while (next.size) {
    const startKey = next.keys().next().value;
    const loop = [];
    let k = startKey;
    let guard = 0;
    while (next.has(k) && guard++ < 10000) {
      const [u, v] = k.split(',').map(Number);
      loop.push([u, v]);
      const to = next.get(k);
      next.delete(k);
      k = key(to[0], to[1]);
    }
    // 한 줄 위의 점은 뺀다
    const n = loop.length;
    const simple = loop.filter((p, i) => {
      const a = loop[(i - 1 + n) % n];
      const b = loop[(i + 1) % n];
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) !== 0;
    });
    loops.push(simple);
  }
  const area = (l) =>
    l.reduce(
      (s, p, i) => s + p[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * p[1],
      0
    ) / 2;
  const outer = loops.filter((l) => area(l) > 0).sort((a, b) => area(b) - area(a))[0] || [];
  const holes = loops.filter((l) => area(l) < 0);
  return { outer, holes };
}

/**
 * 따낸 판 한 장 (THREE.Mesh). 단면은 판 중심 기준 (u − A/2, v − B/2) 이고 두께 T 로 누른다.
 *   orient 'side'  측판 — 두께 축이 X, u 가 +Z(앞), v 가 +Y (makeNotchedPanel 과 같은 방향)
 *          'flat'  천·지판 — 두께 축이 Y, u 가 +X, v 가 +Z(앞)
 */
function plannerCutPanelMesh(THREE, o) {
  const A = o.A;
  const B = o.B;
  const T = o.T;
  const ol = plannerPanelOutline(A, B, o.rects);
  const pt = (p) => new THREE.Vector2(p[0] - A / 2, p[1] - B / 2);
  const shape = new THREE.Shape(ol.outer.map(pt));
  ol.holes.forEach((h) => shape.holes.push(new THREE.Path(h.map(pt))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
  geo.translate(0, 0, -T / 2);
  if (o.orient === 'side') geo.rotateY(-Math.PI / 2);
  else geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.color),
    metalness: 0.05,
    roughness: 0.65,
  });
  return new THREE.Mesh(geo, mat);
}

if (typeof window !== 'undefined') {
  window.PLANNER_CUTOUT_PANELS = PLANNER_CUTOUT_PANELS;
  window.plannerCutoutsOf = plannerCutoutsOf;
  window.plannerCutoutLabel = plannerCutoutLabel;
  window.plannerCutoutRect = plannerCutoutRect;
  window.plannerCutoutFits = plannerCutoutFits;
  window.plannerPanelOutline = plannerPanelOutline;
  window.plannerCutPanelMesh = plannerCutPanelMesh;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_CUTOUT_PANELS,
    plannerCutoutsOf,
    plannerCutoutLabel,
    plannerCutoutRect,
    plannerCutoutFits,
    plannerPanelOutline,
    plannerCutPanelMesh,
  };
}
