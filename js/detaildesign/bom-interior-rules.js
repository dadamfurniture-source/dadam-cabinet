/**
 * 모듈 속 부재 규칙 — 세로칸막이 · 선반 · 속서랍 (2026-10-29 사장님 확정, 2026-10-30 세로칸막이로).
 *
 * 간편 플래너(dadam-planner-lite)의 "세로칸막이 · 서랍(속서랍 · 일반서랍) · 선반" 단추로 사람이 모듈마다 더하고 뺀다.
 * 구조(structures) `s.interior` { mids: 세로칸막이 장수, cols: [나뉜 칸마다 선반 장수], inner: 속서랍 단수 } 와 원래 자리 `s.shelves`
 * (선반 중심 y — 나뉜 칸 차례로 이어 적는다) · BOM 모듈 `mod.interior` 로 알아본다. 표시가 없는 모듈은 예전과 같다.
 * y 는 몸통 밑면에서 판 **중심**까지 (planner-engine.js shelvesEvenInner 와 같은 자리 — 지판 T 를 포함한다). x 는 몸통 왼쪽 겉면부터.
 *
 *   세로칸막이 (2026-10-30 사장님 "중간판을 세로칸막이로 바꿔줘" — 그 전 가로 중간판은 "선반으로 생성됨" 이라 없앴다)
 *     판    몸통 PB T (「몸통과 같은 판」) · 높이 = 처짐방지목과 같은 사이 — 지판(속서랍 상판) 윗면 ~ 천판(밴드) 아랫면,
 *           목찬넬 하부장은 앞 밴드 아랫면까지 (topCut = 상단 따내기 높이 — 처짐방지목 bandH 와 같다)
 *           · 깊이 = 천지판 깊이 (사쿠리 몸통 D − 18, 하부장 짜임은 지판 D) — 앞까지.
 *     자리  몸통 안 폭(W − 2T)을 n + 1 칸으로 좌우 고르게 (「칸 균등」) — 칸 폭 = ⌊(W − 2T − n × T) / (n + 1)⌋, 나머지 1~2 는 맨 오른쪽 칸
 *           (붙박이장 cellSplits 와 같은 셈). 칸 폭이 붙박이장 MIN_CELL_W(200) 보다 좁으면 막는다 (사장님 「붙박이장과 같은 200」).
 *     처짐방지목  가운데에 칸막이가 서면(판이 모듈 가운데를 덮으면) 처짐방지목을 빼고 칸막이를 앞까지 (사장님 「가운데 칸막이가 있으면 처짐방지목 빼기」).
 *           가운데가 비면(칸막이 2장 등) 처짐방지목은 그대로 — 칸막이와 겹치지 않는다.
 *   선반 (「1장씩, 간격 균등」 · 나뉜 칸은 「나뉜 칸마다 따로」)
 *     칸막이가 없으면 몸통 안 한 칸에 고르게. 있으면 나뉜 칸마다 cols[i] 장 (없는 칸은 모듈 선반 수를 받는다) — 폭 = 그 칸 폭.
 *     칸 간격 = 칸 안 높이 ÷ (그 칸 선반 + 1) 이 최소(일반 200 · 신발장 150)보다 좁으면 막는다 (errors).
 *     2026-10-30 사장님 「200 으로 낮추기」 — 단추 칸 간격 최소는 기본 선반 수 규칙(planner-engine MASTER_RULES.SHELF_SPACE_MIN 300 ~ MAX 450 —
 *     calcDefaultShelves · BOM 기본 선반)과 따로 간다. 신발장은 MASTER_RULES.SHELF_SPACE_MIN_SHOE 150 그대로.
 *   속서랍 (「붙박이장 속서랍 규칙」 — bom-wardrobe-rules.js innerDrawerLayout 그대로)
 *     통 내경 = W − 2T, 구역 = 350 × 단수, 통 깊이 = 몸통 D → 모듈 W = 내경 − 120 · D = 몸통 D − 110 · 전면 = 앞선 − 70.
 *     몸통 지판 위에 놓인다 — 차지하는 높이 350 × 단수 + 상판 T. 세로칸막이 · 선반은 그 위에 선다.
 *     처짐방지목은 속서랍 상판 위부터 천판까지 (「처짐방지목을 속서랍 위부터」) — 서랍이 앞 가운데 목대에 걸리지 않는다.
 *     레일(여유 30)이 들어가지 않는 깊이 · 박스가 들어가지 않는 전면 · 몸통에 안 들어가는 단수는 막는다 (errors).
 *   일반 서랍은 이 파일 몫이 아니다 — 구조 doorTopDrawerBottom · drawerCount (bom-drawer-rules.js) 그대로.
 *
 * 순수 값 · 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamInteriorRules`, Node(Jest)는 module.exports.
 * bom-wardrobe-rules.js 다음에 싣는다. BOM(extractors.js) · 브리지(ui-step1.js) · 조립 명세(bom-assembly.js) · 모듈 라이브러리가 같은 이 파일을 읽는다.
 * 문서: docs/design-rules/interior-parts.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamInteriorRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 붙박이장 규칙 (속서랍) — 브라우저는 전역, Node 는 require. */
  function wardrobeRules() {
    if (typeof DadamWardrobeRules !== 'undefined') return DadamWardrobeRules;
    if (typeof window !== 'undefined' && window.DadamWardrobeRules) return window.DadamWardrobeRules;
    if (typeof require === 'function') {
      try { return require('./bom-wardrobe-rules.js'); } catch (e) { return null; }
    }
    return null;
  }

  const INTERIOR_RULES = Object.freeze({
    // 칸 간격 최소 — 일반 200 (2026-10-30 사장님 「200 으로 낮추기」 — 상부장 기본 2장 230 · 하부장 선반 2 226 이 들어간다),
    //   신발장 = planner-engine.js MASTER_RULES.SHELF_SPACE_MIN_SHOE (시험이 대 본다). 기본 선반 수 규칙(MASTER_RULES.SHELF_SPACE_MIN 300)과는 따로다
    SPACE_MIN: Object.freeze({ general: 200, shoe: 150 }),
    PANEL_T: 15,            // 몸통 두께 기본 (MASTER_RULES.BODY_T)
    INNER_RAIL: 'under',    // 속서랍 레일 — 붙박이장 속서랍과 같은 언더레일 (bom-wardrobe-rules INNER_DRAWER RAIL_*)
  });
  const R = INTERIOR_RULES;

  const int0 = (v) => Math.max(0, Math.round(Number(v) || 0));
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

  /**
   * 구조 · BOM 모듈의 속 부재 표시 — { mids: 세로칸막이 장수, cols: 나뉜 칸마다 선반 장수 (칸막이가 있을 때만), inner: 속서랍 단수 }. 표시가 없으면 null.
   *   표시가 있으면(칸막이 · 속서랍이 0 이어도) 사람이 속을 정한 모듈이다 — 선반 수도 구조(s.shelves) 그대로 낸다.
   *   mids 가 배열이면(가로 중간판 시절 중심 y) 장수만 읽는다.
   * @param {{mids?: number|number[], cols?: number[], inner?: number}} raw
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const mids = Array.isArray(raw.mids) ? raw.mids.filter((v) => Number.isFinite(Number(v))).length : int0(raw.mids);
    const cols = mids > 0 && Array.isArray(raw.cols) ? Array.from({ length: mids + 1 }, (_, i) => (raw.cols[i] == null ? null : int0(raw.cols[i]))) : null;
    return { mids, cols, inner: int0(raw.inner) };
  }

  /** 붙박이장 최소 칸 폭 (사장님 「붙박이장과 같은 200」 — bom-wardrobe-rules.js MIN_CELL_W) */
  function minColW() {
    const WR = wardrobeRules();
    return WR ? WR.WARDROBE_RULES.MIN_CELL_W : null;
  }

  /**
   * 세로칸막이로 나뉜 칸 — 몸통 안 폭을 n + 1 칸으로 좌우 고르게 (나머지는 맨 오른쪽 칸). x 는 몸통 왼쪽 겉면부터.
   * @returns {{cols:{x0:number,w:number}[], divs:{x0:number}[], colW:number, braceOff:boolean}}
   *   divs[i].x0 = i 번째 칸막이 왼쪽 면, braceOff = 칸막이가 모듈 가운데를 덮는다 (처짐방지목을 뺀다)
   */
  function columnsOf(W, T, n) {
    const Wi = num(W, 0) - 2 * T;
    const m = int0(n);
    const colW = Math.floor((Wi - m * T) / (m + 1));
    const cols = Array.from({ length: m + 1 }, (_, i) => ({ x0: T + i * (colW + T), w: i === m ? Wi - m * (colW + T) : colW }));
    const divs = cols.slice(0, m).map((c) => ({ x0: c.x0 + c.w }));
    const mid = num(W, 0) / 2;
    return { cols, divs, colW, braceOff: divs.some((d) => d.x0 <= mid && mid <= d.x0 + T) };
  }

  /**
   * 속서랍 구역 — 붙박이장 속서랍 규칙 그대로 (innerDrawerLayout). 통 내경 = W − 2T, 구역 = 350 × 단수, 통 깊이 = 몸통 D.
   * @param {{W:number, D:number, T?:number, inner:number, rail?:string}} o
   * @returns {object|null} innerDrawerLayout 결과 + errors (레일 · 박스 · 전면이 안 되면)
   */
  function innerZoneOf(o) {
    const WR = wardrobeRules();
    const n = int0(o && o.inner);
    if (!WR || n <= 0) return null;
    const T = num(o.T, R.PANEL_T);
    const L = WR.innerDrawerLayout({ Wi: num(o.W, 0) - 2 * T, zoneH: n * WR.WARDROBE_RULES.DRAWER_MOD_H, drawers: n, T, D: num(o.D, 0), rail: o.rail || R.INNER_RAIL });
    if (!L) return null;
    const errors = [];
    if (n > WR.WARDROBE_RULES.MAX_DRAWER_COUNT) errors.push(`속서랍은 ${WR.WARDROBE_RULES.MAX_DRAWER_COUNT}단까지입니다`);
    if (!L.fronts.length) errors.push(`속서랍 ${n}단 자리가 나오지 않습니다${L.warnings.length ? ` — ${L.warnings[0]}` : ''}`);
    if (WR.innerRailLengthFor(L.moduleD) == null) errors.push(`속서랍 모듈 깊이 ${L.moduleD} 에는 가장 짧은 레일도 들어가지 않습니다 (여유 ${WR.WARDROBE_RULES.INNER_DRAWER.RAIL_MARGIN})`);
    if (L.boxes.some((b) => !b.fits)) errors.push(`속서랍 전면 뒤에 가장 작은 서랍 박스도 들어가지 않습니다`);
    return Object.assign(L, { errors });
  }

  /**
   * 칸 안 선반 중심 y — 칸 [y0, y1] (판 사이 빈 높이) 에 k 장을 고르게 (shelvesEvenInner 와 같은 식).
   */
  function shelvesInCell(y0, y1, k, T) {
    if (k <= 0) return [];
    const space = (y1 - y0 - k * T) / (k + 1);
    return Array.from({ length: k }, (_, i) => Math.round(y0 + (i + 1) * space + i * T + T / 2));
  }

  /**
   * 몸통 속 배치 — 속서랍 (지판 위) · 세로칸막이 (좌우 칸 균등) · 선반 (칸마다 균등).
   * @param {{H:number, W:number, D:number, T?:number, shelves?:number, mids?:number, cols?:(number|null)[], inner?:number, shoe?:boolean, topCut?:number}} o
   *   H 몸통 높이 · W 몸통 폭 · D 몸통 깊이 (측판) · mids 세로칸막이 장수 · cols 나뉜 칸마다 선반 (없는 칸은 shelves) · shoe 신발장 칸 간격 (150)
   *   · topCut 칸막이 윗단을 내릴 높이 (목찬넬 하부장 상단 따내기 — 앞 밴드 밑, 처짐방지목과 같다)
   * @returns {{shelves:number[], cols:{x0:number,w:number,shelves:number,ys:number[]}[], divs:{x0:number}[], divY0:number, divH:number,
   *   braceOff:boolean, inner:object|null, innerTop:number, spaceMin:number, errors:string[], warnings:string[]}}
   *   shelves = 선반 중심 y (나뉜 칸 차례로 이어서), innerTop = 속서랍 상판 윗면 (처짐방지목 · 칸막이 밑단 — 속서랍이 없으면 지판 윗면 T)
   */
  function interiorLayoutOf(o) {
    const opt = o || {};
    const T = num(opt.T, R.PANEL_T);
    const H = num(opt.H, 0);
    const k = int0(opt.shelves), m = int0(opt.mids), n = int0(opt.inner);
    const spaceMin = opt.shoe ? R.SPACE_MIN.shoe : R.SPACE_MIN.general;
    const errors = [], warnings = [];
    const lo = T, hi = H - T;   // 지판 윗면 ~ 천판(밴드) 아랫면
    let a = lo;
    const inner = n > 0 ? innerZoneOf({ W: opt.W, D: opt.D, T, inner: n }) : null;
    if (n > 0) {
      if (!inner) errors.push('속서랍 규칙을 읽지 못했습니다');
      else {
        errors.push(...inner.errors);
        inner.warnings.forEach((w) => { if (!warnings.includes(w)) warnings.push(w); });
        a = lo + inner.totalH;
        if (a > hi) errors.push(`속서랍 ${n}단 (${inner.totalH}) 이 몸통 안 높이 ${hi - lo} 에 들어가지 않습니다`);
      }
    }
    const span = Math.max(0, hi - a);
    const C = columnsOf(opt.W, T, m);
    const colMin = minColW();
    if (m > 0 && colMin != null && C.colW < colMin) errors.push(`세로칸막이 ${m}장이면 칸 폭 ${C.colW} 이 최소 ${colMin} 보다 좁습니다`);
    const want = Array.isArray(opt.cols) ? opt.cols : [];
    const cols = C.cols.map((c, i) => {
      const s = m > 0 && want[i] != null ? int0(want[i]) : k;
      return Object.assign({}, c, { shelves: s, ys: shelvesInCell(a, hi, s, T) });
    });
    cols.forEach((c, i) => {
      const gap = Math.floor(span / (c.shelves + 1));
      if (gap < spaceMin) errors.push(`${cols.length > 1 ? `${i + 1}번째 칸 ` : ''}칸 간격 ${gap} 이 최소 ${spaceMin} 보다 좁습니다`);
    });
    const shelves = [].concat(...cols.map((c) => c.ys));
    const divH = Math.max(0, span - Math.max(0, Number(opt.topCut) || 0));
    return { shelves, cols, divs: C.divs, divY0: a, divH, braceOff: m > 0 && C.braceOff, inner, innerTop: a, spaceMin, errors, warnings };
  }

  /**
   * 붙박이장 통 칸마다 선반 (2026-10-30 사장님 간편 플래너 「칸마다 바꾸기」 — bom-wardrobe-rules.js cellShelves) — 사람이 바꾼 칸에
   *   그 장수가 들어가는가. 선반 자리는 붙박이장 shelfPositions 그대로다 (옷봉 칸은 첫 선반 = 칸 상단 − 315, 나머지 그 아래 균등).
   *   칸 간격 최소는 두지 않는다 — 위 선반 단추의 칸 간격 최소(SPACE_MIN)는 붙박이장 규칙이 아니다 (사장님 기본형 4번 통 하부 선반 3단이 260 간격).
   *   [확인 필요] 붙박이장 칸 선반 간격 최소. 그때까지는 들어가지 않는 장수(칸 밖으로 밀리는 선반 · 겹치는 선반)만 막는다.
   * @param layout       layoutWardrobeModule 결과 (cellShelves 를 넣어 지은 것)
   * @param cellShelves  칸마다 선반 수 (null 칸은 기본형 그대로 — 보지 않는다)
   * @returns {string[]}
   */
  function wardrobeShelfErrorsOf(layout, cellShelves) {
    const out = [];
    const L = layout || {};
    (L.cells || []).forEach((c, i) => {
      const want = Array.isArray(cellShelves) ? cellShelves[i] : null;
      if (want == null) return;
      const name = c.label || `${i + 1}번째 칸`;
      const rows = (L.shelves || []).filter((s) => s.cell === i).sort((a, b) => a.y - b.y);
      if (rows.length !== want) { out.push(`${name} 높이 ${c.h} 에 선반 ${want}장이 들어가지 않습니다`); return; }
      let prev = c.y0;
      const gaps = rows.map((s) => { const g = s.y - prev; prev = s.y + s.t; return g; });
      if (!(c.rods > 0) && rows.length) gaps.push(c.y0 + c.h - prev);
      if (gaps.some((g) => g <= 0)) out.push(`${name} 높이 ${c.h} 에 선반 ${want}장이 겹칩니다`);
    });
    return out;
  }

  return { INTERIOR_RULES, normalize, innerZoneOf, columnsOf, shelvesInCell, interiorLayoutOf, wardrobeShelfErrorsOf };
});
