/**
 * 조립 규칙 한 표 (다담 CAD 베타 PR3 — docs/01-plan/planner-cad.plan.md §6 단계 1).
 *
 * 몸통(카카스) 판재의 크기·자리를 정하는 숫자를 한 곳에 둔다. BOM(extractors.js)이 지금 이 표로 재단 치수를 내고,
 * 다음 단계의 조립 명세(bom-assembly.js, `dadam.assembly/1`)가 같은 표로 판재마다 위치를 정한다.
 * 숫자는 모두 이미 있던 BOM 값이다 — 이 파일은 옮겨 모은 것이지 새 규칙이 아니다. 출처는 항목마다 적었다.
 *
 * 순수 데이터 + 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamAssemblyRules`
 * (detaildesign.html 이 extractors.js 보다 먼저 싣는다), Node(Jest)는 module.exports.
 *
 * 다른 규칙 파일과 나눈 몫 (같은 숫자를 두 군데 적지 않는다):
 *   서랍장 · 목찬넬 · 레일   js/detaildesign/bom-drawer-rules.js
 *   붙박이장 통 내부          js/detaildesign/bom-wardrobe-rules.js
 *   오픈장 18T 상자           js/detaildesign/bom-open-cabinet-rules.js
 *   품목 기본 스펙(상판 12 · 다리발 150 · 하부 870 · 상부 720 · 몸통 15T)   js/detaildesign/data-constants.js
 *
 * 아직 정하지 않은 것 (사장님 결정 대기 — 지금 BOM 동작을 그대로 둔다):
 *   D12  하부 선반 "D − 15" 가 상수인가 몸통 T 인가 — 지금 BOM 은 D − T (15T 에서 −15, 18T 에서 −18)
 *   D5   사쿠리 홈 깊이 — 뒷판이 W − 20 이고 안쪽 폭이 W − 2T 라 15T 에서 한쪽 5mm 씩 홈에 든다. 정확한 깊이는 실측 대기
 *   D2   서랍장에서 처짐방지목 위치
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAssemblyRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 규칙 판 — 이 표의 숫자가 바뀌면 올린다. 조립 명세·동결 스냅샷에 실려 어느 규칙으로 계산했는지 남긴다. */
  const RULES_VERSION = 'asm-2026.10.1';

  const CARCASS = Object.freeze({
    // 뒷판 — 2026-10-18 사장님: 우라 MDF 3T. 2026-10-19 (PR #832): 크기는 측판 사쿠리가 정한다.
    //   사쿠리 있음  측판 홈에 끼운다          (W − 20) × (H − 1)
    //   사쿠리 없음  측판 뒤끝에 덮어 붙인다   (W − 1) × (H − 1) — 측판 깊이를 먹지 않는다
    BACK_PANEL_T: 3,
    BACK_SAKURI_W_MINUS: 20,
    BACK_FLAT_W_MINUS: 1,
    BACK_H_MINUS: 1,
    // 사쿠리 홈 — 측판 뒤끝에서 15 들어와 폭 3 (BOM 측판 비고 'sakuri(15→3mm)'). 폭 = 뒷판 두께.
    SAKURI_FROM_BACK: 15,
    SAKURI_W: 3,
    // 사쿠리 측판 사이의 천판·지판 깊이 D − 18 (= 홈 앞까지 15 + 3)
    SAKURI_PANEL_D_MINUS: 18,
    // 상부장·키큰장(사쿠리) 선반 D − 34
    SAKURI_SHELF_D_MINUS: 34,
    // 붙박이장 통·외부 서랍모듈 선반 D − 18 − 70 = D − 88
    WARDROBE_SHELF_D_MINUS: 88,
    // 밴드(천판 대신 하부장 위 2장 · 상부장 보강목 2장) 폭
    BAND_W: 70,
    // 처짐방지목 — 2026-09-19 사장님: 폭이 문턱 이상인 모듈에만 1장, 모듈 폭 중앙, 측판 앞선에 맞대어 도어 바로 뒤.
    //   폭 70 × 길이 (H − 2T), 목찬넬 하부장이면 − 70 (bom-drawer-rules.js CHANNEL_TOP_NOTCH_H).
    BRACE_W: 70,
    BRACE_W_MIN_UPPER: 700,
    BRACE_W_MIN_LOWER: 800,   // 하부장 · 키큰장 단
    // 모듈 깊이 폴백 — 모듈에 d 가 없을 때 (싱크대 extractSink)
    UPPER_D_DEFAULT: 295,
    LOWER_D_DEFAULT: 550,
  });

  /** 뒷판 재단 크기 — 사쿠리 여부로 (모든 모듈 공통). */
  function backPanelSize(W, H, sakuri) {
    const C = CARCASS;
    return { w: W - (sakuri ? C.BACK_SAKURI_W_MINUS : C.BACK_FLAT_W_MINUS), h: H - C.BACK_H_MINUS };
  }

  /** 처짐방지목 장수 — 문턱 이상이면 1, 아니면 0. pos 'upper' 는 상부장 문턱, 그 밖은 하부장 문턱. */
  function braceQtyOf(W, pos) {
    const min = pos === 'upper' ? CARCASS.BRACE_W_MIN_UPPER : CARCASS.BRACE_W_MIN_LOWER;
    return (parseFloat(W) || 0) >= min ? 1 : 0;
  }

  return { RULES_VERSION, CARCASS, backPanelSize, braceQtyOf };
});
