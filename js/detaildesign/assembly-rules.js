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
 *   D5   경첩 컵 자리(2026-10-23 추천값 — HINGE_CUP_EDGE·HINGE_CUP_DEPTH) · 사쿠리 홈 깊이(2026-10-25 — sakuriGrooveDepth)는
 *        정했다. 둘 다 실측이 오면 숫자만 고친다
 *   D2   서랍장에서 처짐방지목 위치
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAssemblyRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 규칙 판 — 이 표의 숫자가 바뀌면 올린다. 조립 명세·동결 스냅샷에 실려 어느 규칙으로 계산했는지 남긴다. */
  const RULES_VERSION = 'asm-2026.10.3';

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
    // 사쿠리 홈 깊이 — 2026-10-25 사장님 D5 (A 추천대로): 뒷판이 홈에 드는 만큼 + 여유 1.
    //   뒷판 W − 20 · 측판 사이 W − 2T 라 한쪽에 T − 10 이 든다 → 15T 6 · 18T 9 (sakuriGrooveDepth). 실측이 오면 여유만 고친다
    SAKURI_DEPTH_CLEARANCE: 1,
    // 사쿠리 측판 사이의 천판·지판 깊이 D − 18 (= 홈 앞까지 15 + 3)
    SAKURI_PANEL_D_MINUS: 18,
    // 상부장·키큰장(사쿠리) 선반 D − 34
    SAKURI_SHELF_D_MINUS: 34,
    // 붙박이장 통·외부 서랍모듈 선반 D − 18 − 70 = D − 88
    WARDROBE_SHELF_D_MINUS: 88,
    // 밴드 — 천판 대신 하부장 위 2장 폭
    BAND_W: 70,
    // 상부장 보강목 2장 폭 — 2026-10-20 사장님: 70 이 아니라 60 (W − 2T × 60). 자리는 사쿠리 홈 뒤, 장의 맨 뒤.
    UPPER_BAND_W: 60,
    // 상부장 보강목 판 두께 — 2026-10-20 사장님 "15T 고정": 몸통이 18T 여도 15T (홈 뒤 15 자리에 맞는다). 길이 W − 2T 는 몸통 T.
    UPPER_BAND_T: 15,
    // 처짐방지목 — 2026-09-19 사장님: 폭이 문턱 이상인 모듈에만 1장, 모듈 폭 중앙, 측판 앞선에 맞대어 도어 바로 뒤.
    //   폭 70 × 길이 (H − 2T), 목찬넬 하부장이면 − 70 (bom-drawer-rules.js CHANNEL_TOP_NOTCH_H).
    BRACE_W: 70,
    BRACE_W_MIN_UPPER: 700,
    BRACE_W_MIN_LOWER: 800,   // 하부장 · 키큰장 단
    // 모듈 깊이 폴백 — 모듈에 d 가 없을 때 (싱크대 extractSink)
    // 도어 갭 — 도어 가로 = 칸 폭 − 4 (extractors.js floor(W/n) − 4 · 플래너 MASTER_RULES.DOOR_GAP). 좌우 2 씩, 양문 가운데 4.
    DOOR_GAP: 4,
    // 멍장 (corner.md §3.3·§3.5) — data-constants.js CORNER_* 와 같은 값 (drift 금지).
    //   멍가림판 MDF 3T (2026-10-26 사장님, 예전 2.7T) 는 멍 W − 목대 15, 마감재(휠라·몰딩) 150 은 멍판 위에 겹쳐 붙는다 (자리 60 + 겹침 90).
    //   ㄱ자 기둥 15T: 앞판 = 처짐방지 밴드 60 (멍판 바로 뒤), 그 뒤에 경첩목대 깊이 60 이 멍·도어 경계에서 도어 쪽으로 15 — 앞선에서 75.
    //   멍장에는 모듈 가운데 처짐방지 밴드가 따로 없다 — 이 기둥이 처짐방지 밴드다 (2026-10-26 사장님).
    BLIND_COVER_T: 3,
    BLIND_BATTEN_T: 15,
    BLIND_BATTEN_LEG: 60,
    BLIND_FINISH_W: 150,
    UPPER_D_DEFAULT: 295,
    LOWER_D_DEFAULT: 550,
    // 하부장 걸레받이 MDF 18T (sink.md 자재표: 벽 길이 × (다리발 − 5), 2440 넘으면 2440 단위로 나눔) — 바닥에 붙여 세운다. 높이의 −5 는 위에
    //   (몸통 밑단과의 틈, 2026-10-22 사장님 "바닥에서 5 띄울 필요 없음, 틈은 캐쳐(걸레받이 홀더)로"). 3D KICK_FLOOR_GAP(바닥 띄움)과 다른 그림.
    //   앞면 = 몸통 앞선 − 32 (2026-10-22 사장님 카드 "몸통 앞선에서 32 안쪽" — 좌대 걸레받이가 앞 50 들어간 상자 앞면에 붙어 32 남는 것과 같다)
    KICK_T: 18,
    KICK_H_MINUS: 5,
    KICK_SETBACK: 32,
    KICK_CUT_UNIT: 2440,
    // 다리발 — 플래너 MASTER_RULES.LEG_SIZE·LEG_INSET (js/planner/planner-engine.js, OBJ 실측) 과 같은 값 (drift 금지).
    //   4 코너, 모듈 외곽에서 25 안쪽, 앞줄은 걸레받이 뒤 (3D addLegs). 6·8개면 앞줄·뒷줄마다 두 코너 사이를 균등 분할 (2026-10-23 사장님 4-1 B).
    LEG_SIZE: 42,
    LEG_INSET: 25,
    // 경첩 컵 지름 (hardware.md §1, H052W).
    HINGE_CUP_D: 35,
    // 경첩 컵 자리 — 2026-10-23 사장님 4-1 A (추천대로): 도어 변에서 컵 가장자리까지 4 → 컵 중심 4 + 35/2 = 21.5, 컵 깊이 12.5.
    //   결정 D5 의 경첩 부분. 실측 값이 오면 이 두 숫자만 고친다.
    HINGE_CUP_EDGE: 4,
    HINGE_CUP_DEPTH: 12.5,
  });

  /** 뒷판 재단 크기 — 사쿠리 여부로 (모든 모듈 공통). */
  function backPanelSize(W, H, sakuri) {
    const C = CARCASS;
    return { w: W - (sakuri ? C.BACK_SAKURI_W_MINUS : C.BACK_FLAT_W_MINUS), h: H - C.BACK_H_MINUS };
  }

  /** 몸통 측판 사쿠리 홈 깊이 (mm) — 뒷판이 한쪽에 드는 만큼 (W−20 − (W−2T)) / 2 = T − 10, 더하기 여유 (2026-10-25 D5). */
  function sakuriGrooveDepth(T) {
    const C = CARCASS;
    return (2 * (parseFloat(T) || 0) - C.BACK_SAKURI_W_MINUS) / 2 + C.SAKURI_DEPTH_CLEARANCE;
  }

  /** 처짐방지목 장수 — 문턱 이상이면 1, 아니면 0. pos 'upper' 는 상부장 문턱, 그 밖은 하부장 문턱. */
  function braceQtyOf(W, pos) {
    const min = pos === 'upper' ? CARCASS.BRACE_W_MIN_UPPER : CARCASS.BRACE_W_MIN_LOWER;
    return (parseFloat(W) || 0) >= min ? 1 : 0;
  }

  return { RULES_VERSION, CARCASS, backPanelSize, braceQtyOf, sakuriGrooveDepth };
});
