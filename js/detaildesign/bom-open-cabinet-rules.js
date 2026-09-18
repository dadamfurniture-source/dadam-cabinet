/**
 * 오픈장 규칙 (2026-09-19 사장님 확정).
 *
 * 도어가 없는 상자 하나다. 몸통 전체가 **18T MDF** 다 — PB 가 아니다.
 * 모듈 타입으로 고르며, 카테고리(싱크대·붙박이장·수납장…)와 무관하게 규칙이 같다.
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamOpenCabinetRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js)과 플래너(mockup-structure)가 **같은 이 파일**을 읽는다.
 *
 * ── 부재 (몸통 외경 W × H × D, mm) ──────────────────────────────
 *   측판   = D × H                2장
 *   천지판 = (W − 2×18) × (D − 20) 2장   (천판·지판이 같은 치수라 한 줄로 낸다)
 *   뒷판   = (W − 2×18) × H        1장   ← 2.7T 가림판이 아니라 **18T 통판**이다
 *
 * 천지판이 깊이에서 20 짧은 자리에 18T 뒷판이 선다 (18 + 여유 2).
 * 측판은 깊이 전체를 덮으므로 뒷판은 측판 **사이**에 들어간다 — 그래서 가로가 W − 2×18 이다.
 *
 * 예 (W500 × H450 × D570):
 *   측판 570×450 2장 · 천지판 464×550 2장 · 뒷판 464×450 1장
 *   사장님 표기는 "측판 450×570 · 천지판 464×550 · 뒷판 450×464" 로 **세로를 먼저** 적은 것이고,
 *   이 파일과 BOM 은 저장소 관례대로 **가로×세로**로 적는다 — 같은 판이다.
 *
 * ── 홈카페장(extractors extractFridge)과 다른 점 ────────────────
 * 냉장고장 안의 홈카페장도 주석에 "오픈장 규칙" 이라 적혀 있지만 치수가 다르다
 * (측판 D+20, 천지판 깊이 D). 그쪽은 도어가 달리는 냉장고장 전용 모듈이라 그대로 두고,
 * 여기 오픈장과 섞지 않는다. 둘을 합치려면 사장님 확인이 필요하다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamOpenCabinetRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OPEN_CABINET_RULES = Object.freeze({
    KIND: 'open',                 // 구조(structures)에 저장되는 모듈 타입 값
    LABEL: '오픈장',
    MATERIAL: 'MDF',
    T: 18,                        // 몸통 두께 — 18T MDF 전체
    BACK_GAP: 20,                 // 천지판이 깊이에서 물러나는 값 (18T 뒷판 + 여유 2)
    // 엣지는 냉장고장 홈카페장(= 같은 "오픈장 규칙")과 같은 면을 쓴다. 오픈장은 앞이 트여 있어
    // 확정이 필요하면 여기만 고치면 BOM·도면이 함께 따라온다.
    EDGE: Object.freeze({ side: '3면', topBottom: '2면(가로)', back: '2면(가로)' }),
  });

  const R = OPEN_CABINET_RULES;

  /** 숫자로 읽되 음수·NaN 은 0 으로 (치수를 아직 안 정한 모듈이 들어와도 터지지 않게) */
  function dim(v) {
    const n = Math.round(Number(v) || 0);
    return n > 0 ? n : 0;
  }

  /** 이 모듈이 오픈장인가 — 플래너 구조(s.moduleKind)와 BOM 모듈(mod.moduleKind) 둘 다 같은 값을 쓴다. */
  function isOpenCabinet(o) {
    return !!o && String(o.moduleKind || '') === R.KIND;
  }

  /**
   * 내경 — 천지판·뒷판이 서는 자리. 플래너 3D·정면도가 이걸로 그린다.
   * @param o {W,H,D}
   */
  function innerOf(o) {
    const W = dim(o && o.W), H = dim(o && o.H), D = dim(o && o.D);
    return {
      W, H, D,
      T: R.T,
      innerW: Math.max(0, W - 2 * R.T),          // 측판 사이
      innerH: Math.max(0, H - 2 * R.T),          // 천판·지판 사이
      innerD: Math.max(0, D - R.BACK_GAP),       // 천지판 깊이 (뒷판 앞까지)
      backT: R.T,
    };
  }

  /**
   * 부재 목록. BOM(extractors)과 플래너가 같은 이 함수를 쓴다.
   * 가로(w) × 세로(h) — 저장소 자재표 관례.
   *
   * @param o {W,H,D}
   * @returns {Array<{part,material,t,w,h,qty,edge}>} 치수가 안 잡히면 빈 배열
   */
  function partsOf(o) {
    const g = innerOf(o);
    if (!g.W || !g.H || !g.D || !g.innerW || !g.innerD) return [];
    return [
      { part: '측판',   material: R.MATERIAL, t: R.T, w: g.D,      h: g.H,      qty: 2, edge: R.EDGE.side },
      { part: '천지판', material: R.MATERIAL, t: R.T, w: g.innerW, h: g.innerD, qty: 2, edge: R.EDGE.topBottom },
      { part: '뒷판',   material: R.MATERIAL, t: R.T, w: g.innerW, h: g.H,      qty: 1, edge: R.EDGE.back },
    ];
  }

  /**
   * 치수가 규칙을 못 채우면 경고 문구 (플래너가 화면에, BOM 이 경고 목록에 쓴다).
   * @returns {string[]}
   */
  function warningsOf(o) {
    const g = innerOf(o);
    const out = [];
    if (!g.W || !g.H || !g.D) {
      out.push('오픈장 치수(W·H·D)가 아직 정해지지 않았습니다');
      return out;
    }
    if (g.innerW <= 0) out.push(`오픈장 폭 ${g.W} 는 측판 두께(${2 * R.T})보다 좁아 칸이 남지 않습니다`);
    if (g.innerD <= 0) out.push(`오픈장 깊이 ${g.D} 는 뒷판 자리(${R.BACK_GAP})보다 얕아 천지판이 남지 않습니다`);
    if (g.innerH <= 0) out.push(`오픈장 높이 ${g.H} 는 천지판 두께(${2 * R.T})보다 낮아 칸이 남지 않습니다`);
    return out;
  }

  return { RULES: OPEN_CABINET_RULES, isOpenCabinet, innerOf, partsOf, warningsOf };
});
