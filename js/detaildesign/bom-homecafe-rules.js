/**
 * 홈카페장 규칙 — fridge.md §11 "홈카페장" 부재표 (예전 냉장고장 전용 화면의 extractFridge 와 같은 식).
 *
 * 2026-10-20: 냉장고장이 플래너로 옮겨 오면서 홈카페장을 **모듈 타입**으로 고르게 했다 (결정 카드 추천안,
 * 사장님 답 전). 부재표는 문서에 있던 그대로 옮겼다 — 새로 정한 치수는 없다.
 *
 * 몸통 전체가 MDF 18T 이고 뒷판도 18T 통판이다 (일반 3T 우라가 아님 — fridge.md §11).
 * 오픈장(bom-open-cabinet-rules.js)과 다르다: 측판이 D+20, 천지판 깊이가 D, 선반 2 장, 도어가 달린다.
 * 둘을 합치려면 사장님 확인이 필요하다 (오픈장 규칙 파일 머리말).
 *
 * ── 부재 (몸통 외경 W × H × D, mm, 가로×세로) ──────────────────────────
 *   측판  MDF 18T  (D+20) × H         2  3면
 *   천판  MDF 18T  (W−36) × D         1  2면(가로)
 *   지판  MDF 18T  (W−36) × D         1  2면(가로)
 *   뒷판  MDF 18T  (W−36) × H         1  2면(가로)
 *   선반  MDF 18T  (W−36) × (D−15)    2  1면(전)
 *   도어  MDF 18T  (floor(W/n)−4) × (H+20)   n  4면   (n = 도어 수, 없으면 1)
 *
 * 순수 함수만 있다. 브라우저는 전역 `DadamHomecafeRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js)과 플래너(mockup-structure)가 같은 이 파일을 읽는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamHomecafeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOMECAFE_RULES = Object.freeze({
    KIND: 'homecafe',        // 구조(structures)·BOM 모듈의 moduleKind 값
    LABEL: '홈카페장',
    MATERIAL: 'MDF',
    T: 18,
    SIDE_D_PLUS: 20,         // 측판 = D + 20
    SHELF_D_MINUS: 15,       // 선반 = D − 15
    SHELF_QTY: 2,
    DOOR_W_MINUS: 4,         // 도어 = floor(W / n) − 4
    DOOR_H_PLUS: 20,         // 도어 = H + 20
    DEFAULT_W: 600,          // data-constants.js FRIDGE_RULES.HOMECAFE_W
  });

  const R = HOMECAFE_RULES;

  function dim(v) {
    const n = Math.round(Number(v) || 0);
    return n > 0 ? n : 0;
  }

  /** 이 모듈이 홈카페장인가 — 플래너 구조(s.moduleKind)와 BOM 모듈(mod.moduleKind) 둘 다 같은 값. 예전 화면 모듈은 type. */
  function isHomecafe(o) {
    return !!o && (String(o.moduleKind || '') === R.KIND || String(o.type || '') === R.KIND);
  }

  /** 몸통 부재 (도어 빼고). 치수가 안 잡히면 빈 배열. */
  function partsOf(o) {
    const W = dim(o && o.W), H = dim(o && o.H), D = dim(o && o.D);
    const innerW = W - 2 * R.T;
    if (!W || !H || !D || innerW <= 0 || D - R.SHELF_D_MINUS <= 0) return [];
    const M = R.MATERIAL, T = R.T;
    return [
      { part: '측판', material: M, t: T, w: D + R.SIDE_D_PLUS, h: H, qty: 2, edge: '3면' },
      { part: '천판', material: M, t: T, w: innerW, h: D, qty: 1, edge: '2면(가로)' },
      { part: '지판', material: M, t: T, w: innerW, h: D, qty: 1, edge: '2면(가로)' },
      { part: '뒷판', material: M, t: T, w: innerW, h: H, qty: 1, edge: '2면(가로)' },
      { part: '선반', material: M, t: T, w: innerW, h: D - R.SHELF_D_MINUS, qty: R.SHELF_QTY, edge: '1면(전)' },
    ];
  }

  /** 도어 — 수는 doorCount, 없거나 0 이하면 1 (extractFridge 와 같다). */
  function doorOf(o, doorCount) {
    const W = dim(o && o.W), H = dim(o && o.H);
    const n = Math.max(1, Math.round(Number(doorCount) || 0));
    if (!W || !H) return null;
    return { w: Math.floor(W / n) - R.DOOR_W_MINUS, h: H + R.DOOR_H_PLUS, qty: n };
  }

  return { RULES: HOMECAFE_RULES, isHomecafe, partsOf, doorOf };
});
