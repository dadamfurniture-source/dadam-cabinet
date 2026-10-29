/**
 * 모듈 속 부재 규칙 — 석가(중간판) · 선반 · 속서랍 (2026-10-29 사장님 확정).
 *
 * 간편 플래너(dadam-planner-lite)의 "석가 · 서랍(속서랍 · 일반서랍) · 선반" 단추로 사람이 모듈마다 더하고 뺀다.
 * 구조(structures) `s.interior` { mids: [석가 중심 y], inner: 속서랍 단수 } 와 원래 자리 `s.shelves` (선반 중심 y) ·
 * BOM 모듈 `mod.interior` 로 알아본다. 표시가 없는 모듈은 예전과 같다.
 * y 는 몸통 밑면에서 판 **중심**까지 (planner-engine.js shelvesEvenInner 와 같은 자리 — 지판 T 를 포함한다).
 *
 *   석가 (「몸통과 같은 판 · 칸 균등」)
 *     판    몸통 PB T · 가로 = 측판 사이 (W − 2T) · 깊이 = 천지판 깊이 (사쿠리 몸통 D − 18, 하부장 짜임은 지판 D)
 *           처짐방지목이 있는 폭(상부 700 · 하부 800 이상 — assembly-rules.js braceQtyOf)이면 그 두께 T 만큼 짧다
 *           (「석가를 처짐방지목 뒤까지」 — 처짐방지목은 지판 ~ 천판 그대로). 멍장은 ㄱ자 기둥 깊이만큼 (선반과 같은 blindShelfCut).
 *     자리  고정 (선반 핀 없음). n 장이면 몸통 안(속서랍 위)을 n + 1 칸으로 고르게 나눈다.
 *   선반 (「1장씩, 간격 균등」)
 *     칸마다 고르게 놓는다 — 장수는 칸에 고르게 나누고 남는 장은 아래 칸부터. 판은 각 품목 선반 규칙 그대로 (BOM 이 낸다).
 *     칸 간격 = 칸 안 높이 ÷ (그 칸 선반 + 1) 이 엔진 최소(일반 300 · 신발장 150 —
 *     planner-engine.js MASTER_RULES.SHELF_SPACE_MIN · SHELF_SPACE_MIN_SHOE 와 같은 값)보다 좁으면 막는다 (errors).
 *   속서랍 (「붙박이장 속서랍 규칙」 — bom-wardrobe-rules.js innerDrawerLayout 그대로)
 *     통 내경 = W − 2T, 구역 = 350 × 단수, 통 깊이 = 몸통 D → 모듈 W = 내경 − 120 · D = 몸통 D − 110 · 전면 = 앞선 − 70.
 *     몸통 지판 위에 놓인다 — 차지하는 높이 350 × 단수 + 상판 T. 석가 · 선반은 그 위 칸에 선다.
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
    // 칸 간격 최소 — planner-engine.js MASTER_RULES.SHELF_SPACE_MIN (일반) · SHELF_SPACE_MIN_SHOE (신발장) 와 같은 값 (시험이 대 본다)
    SPACE_MIN: Object.freeze({ general: 300, shoe: 150 }),
    PANEL_T: 15,            // 몸통 두께 기본 (MASTER_RULES.BODY_T)
    INNER_RAIL: 'under',    // 속서랍 레일 — 붙박이장 속서랍과 같은 언더레일 (bom-wardrobe-rules INNER_DRAWER RAIL_*)
  });
  const R = INTERIOR_RULES;

  const int0 = (v) => Math.max(0, Math.round(Number(v) || 0));
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

  /**
   * 구조 · BOM 모듈의 속 부재 표시 — { mids: 석가 장수, inner: 속서랍 단수, midYs: 석가 중심 y (있으면) }. 표시가 없으면 null.
   *   표시가 있으면(석가 · 속서랍이 0 이어도) 사람이 속을 정한 모듈이다 — 선반 수도 구조(s.shelves) 그대로 낸다.
   * @param {{mids?: number|number[], inner?: number}} raw
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const midYs = Array.isArray(raw.mids) ? raw.mids.map(Number).filter(Number.isFinite) : null;
    const mids = midYs ? midYs.length : int0(raw.mids);
    return { mids, inner: int0(raw.inner), midYs };
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
   * 석가 깊이 — 천지판 깊이에서 앞 기둥(처짐방지목 T · 멍장 ㄱ자 기둥) 만큼 짧다.
   * @param {number} panelD 천지판 깊이
   * @param {number} frontCut 앞 기둥 깊이 (처짐방지목이면 T, 멍장이면 blindShelfCut, 없으면 0)
   */
  function midDepthOf(panelD, frontCut) {
    return Math.max(0, num(panelD, 0) - Math.max(0, Number(frontCut) || 0));
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
   * 몸통 속 배치 — 속서랍 (지판 위) · 석가 (칸 균등) · 선반 (칸마다 균등).
   * @param {{H:number, W:number, D:number, T?:number, shelves?:number, mids?:number, inner?:number, shoe?:boolean}} o
   *   H 몸통 높이 · W 몸통 폭 · D 몸통 깊이 (측판) · shoe 신발장 칸 간격 (150)
   * @returns {{shelves:number[], mids:number[], cells:{y0:number,y1:number,shelves:number}[], inner:object|null, innerTop:number, spaceMin:number, errors:string[], warnings:string[]}}
   *   innerTop = 속서랍 상판 윗면 (처짐방지목 밑단 — 속서랍이 없으면 지판 윗면 T)
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
    const clear = (span - m * T) / (m + 1);
    const mids = Array.from({ length: m }, (_, i) => Math.round(a + (i + 1) * clear + i * T + T / 2));
    const cells = [];
    const base = Math.floor(k / (m + 1)), rem = k % (m + 1);
    for (let i = 0; i <= m; i++) {
      const y0 = a + i * (clear + T), y1 = y0 + clear;
      cells.push({ y0: Math.round(y0), y1: Math.round(y1), shelves: base + (i < rem ? 1 : 0) });
    }
    if (clear <= 0) errors.push(`석가 ${m}장이 들어갈 높이가 없습니다`);
    cells.forEach((c, i) => {
      const gap = Math.floor((c.y1 - c.y0) / (c.shelves + 1));
      if (gap < spaceMin) errors.push(`${cells.length > 1 ? `${i + 1}번째 칸 ` : ''}칸 간격 ${gap} 이 최소 ${spaceMin} 보다 좁습니다`);
    });
    const shelves = [].concat(...cells.map((c) => shelvesInCell(c.y0, c.y1, c.shelves, T)));
    return { shelves, mids, cells, inner, innerTop: a, spaceMin, errors, warnings };
  }

  return { INTERIOR_RULES, normalize, innerZoneOf, midDepthOf, shelvesInCell, interiorLayoutOf };
});
