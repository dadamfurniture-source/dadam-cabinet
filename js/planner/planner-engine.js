// ============================================================
// P2: 플래너 계산 엔진 — planner-engine.js
//
// mockup-structure.html 인라인에 있던 **순수 계산 로직**만 옮겼다.
// 판단 기준은 딱 하나 — DOM 도 모듈 전역 상태(modules/structures/three)도
// 건드리지 않고, 인자만 보고 답을 내는가.
//
// 그래서 남겨둔 것들:
//   autoCalcForSet         showToast·getStructure·snapshotAutoCalc·persistPlannerState 호출
//   redistributeNonFixedWidths  showToast 호출
//   buildSets              모듈 전역 `modules` 를 클로저로 읽는다
//   buildPlannerPayload    같은 이유
// 이들은 상태를 인자로 받도록 바꾸는 별도 단계가 필요하다. 여기서 같이 하면
// "옮기기" 와 "설계 바꾸기" 가 한 diff 에 섞여 골든이 왜 바뀌었는지 못 읽는다.
//
// ⚠ mockup-shell.html 에는 싣지 않는다. 배치 단계는 이 중 **아무것도 쓰지 않는다**
//   (실측 0건). 공통이 아니라 구조 단계 전용이라서 planner-scope/view/sections 와
//   성격이 다르다 — planner-assets.test.js 가 이 구분을 강제한다.
//
// ⚠ 클래식 스크립트라 전역 렉시컬 스코프를 공유한다. 여기 최상위 이름을
//   HTML 인라인이 다시 선언하면 SyntaxError 로 **인라인 전체가 죽는다**(흰 화면).
// ============================================================

// W9-90: 마스터 규칙 (Supabase design_rules source=master-onedrive-2026-05 와 동기)
const MASTER_RULES = {
  DOOR_GAP: 4,                  // 도어 가로 갭 (장W - 4)
  // W12-7: 상부장 도어는 장H 보다 15 길고, 그 15 가 몸통 **아래로** 내려와
  // 도어 내림 손잡이가 된다 (design_rules 싱크상부장도어H, 2026-08-27 20→15).
  SINK_UPPER_DOOR_H_PLUS:  15,  // 싱크 상부장 도어 H = 장H + 15
  SINK_LOWER_DOOR_H_MINUS: 30,  // 싱크 하부장 도어 H = 장H - 30 (다리발 위)
  SINK_LEG: 150,                // 싱크 하부장 다리발 H (또는 120)
  // W9-113: 다리발 mesh 표준 (OBJ undermodule_sink_base.obj 측정)
  LEG_SIZE: 42,                 // 다리발 가로/세로 단면
  LEG_INSET: 25,                // 모듈 코너에서 안쪽 offset
  // W9-115: 상몰딩 (crown molding) — 상부장 상단 마감
  CROWN_MOLDING_SINK: 60,       // 싱크 상부장 상몰딩 H
  CROWN_MOLDING_FRIDGE: 50,     // 냉장고 상부장 상몰딩
  CROWN_MOLDING_WARDROBE: 15,   // 붙박이장 상몰딩
  // W9-117: 목찬넬 (channel handle) — 마스터 자재추출규칙
  CHANNEL_FRONT_W: 52,          // 전면판 높이 (design_rules 목찬넬전면 52 × effectiveW)
  CHANNEL_BACK_W: 40,           // 지면판 폭   (design_rules 목찬넬지면 40 × effectiveW)
  CHANNEL_DEPTH: 12,            // 목찬넬 매립 깊이 (도어 안쪽)
  // W12-5: 하부장 목찬넬 따내기 — 측판·칸막이 상단 전면 모서리를 도려낸다.
  // 도려낸 자리를 ㄴ자로 채운다: 지면판(40 × 18T)이 바닥에 깔리고 그 위에
  // 전면판(52 × 18T)이 얹힌다. 18 + 52 = 70 이 따내기 높이와 정확히 맞는다.
  // 처짐방지목이 목찬넬일 때 70 짧아지는 것(sink.md bandH = H-36-70)과 같은 70이다.
  CHANNEL_BOARD_T: 18,          // 목찬넬 부재 두께 (18T MDF)
  CHANNEL_NOTCH_H: 70,          // 따내기 높이 = CHANNEL_BOARD_T + CHANNEL_FRONT_W
  CHANNEL_NOTCH_D: 40,          // 따내기 깊이 = CHANNEL_BACK_W (지면판 폭)
  SINK_LOWER_H: 870,            // 싱크 하부장 표준 H (다리발 150 포함)
  SINK_UPPER_H: 720,            // 싱크 상부장 표준 H
  SINK_UPPER_D: 295,            // 싱크 상부장 표준 D
  SINK_LOWER_D: 600,            // 싱크 하부장 표준 D
  FRIDGE_UPPER_H_MAX: 400,      // 냉장고 상부장 H 최대
  FRIDGE_D: 550,                // 냉장고장 표준 D
  FRIDGE_NICHE_W: 900,          // W9-99: 표준 니치 폭 (LG/삼성/인피니트)
  FRIDGE_NICHE_W_TOL: 50,       // W9-99: 니치 허용 오차 ±50mm
  // 아래 둘은 js/detaildesign/data-constants.js 와 ui-fridge-el.js 가 정본이다.
  // 플래너에서 그 파일들을 읽지 않아 값을 옮겨 적었다 — 바뀌면 같이 고쳐야 한다.
  FRIDGE_TOP_GAP: 15,           // 냉장고 상단 간격 (FRIDGE_RULES.TOP_GAP)
  MIDDLE_BODY_RATIO: 0.55,      // 중간장이 차지하는 몸통 비율 (ui-fridge-el.js: moduleBodyH * 0.55)
  SHELF_SPACE_MIN: 300,         // 선반 분배 공간 최소 (일반)
  SHELF_SPACE_MAX: 450,         // 선반 분배 공간 최대 (일반)
  SHELF_SPACE_MIN_SHOE: 180,    // 선반 분배 공간 최소 (신발장)
  SHELF_SPACE_MAX_SHOE: 350,    // 선반 분배 공간 최대 (신발장)
  DOOR_W_MIN: 350,              // 도어 W 최소
  DOOR_W_MAX: 600,              // 도어 W 최대
  DOOR_W_TARGET: 450,           // 도어 W 목표
  SINK_BAND_THRESHOLD_UPPER: 700,   // 상부장 W > 700 → 처짐방지목 추가
  SINK_BAND_THRESHOLD_LOWER: 800,   // 하부장 W > 800 → 처짐방지목 추가
  // W9-101: 처짐방지목 — OBJ 측정 60mm, 마스터 명시 70mm (OBJ 우선)
  BAND_BRACE_W: 60,             // 처짐방지목 폭 (가운데 분리판)
  BAND_BRACE_THICK: 15,         // 처짐방지목 두께 (15T PB 동일)
  // W9-95: 가전 X 정밀 분할 + 먹장 자동
  BLANK_THRESHOLD: 350,         // 세그먼트 W < 350 → 'blank' 자동 (도어 최소와 동일)
  // W9-96: distributeModules 잔여 최적화 (calc-utils.ts 포팅)
  MIN_REMAINDER: 5,             // 최소 잔여 (mm)
  MAX_REMAINDER: 10,            // 최대 잔여 (gap > 10 면 후보 거부)
  // W12-49: 코너(멍장) — docs/design-rules/corner.md §3.
  //   정본은 js/detaildesign/data-constants.js 지만 플래너는 그 파일을 로드하지 않는다.
  //   값이 갈라지면 같은 코너를 화면과 BOM 이 다르게 계산한다 — 바뀌면 같이 고쳐야 한다.
  CORNER_DRIP: 10,              // 물끊기 여유 (§3.3)
  CORNER_WALL_GAP: 50,          // 멍장 측판 ↔ 코너 벽 여유 (§3.4)
  CORNER_MOLDING: 60,           // 코너 접합부 몰딩 기본값 (§3.3)
  CORNER_UPPER_MODULE: 320,     // 상부 멍 모듈값 — 몸통295+도어18 → 관례 320 (§3.6)
  CORNER_EP_W: 20,              // 멍장 라인 반대쪽 끝 EP (§3.4 예시)
  // W12-54: 멍장 도어 경첩을 달 목대. 멍 폭에 들어가고 BOM 부재로도 나간다.
  //   인접 라인 시작 offset(§3.7)에는 붙지 않는다 — 멍장 도어용이기 때문이다.
  CORNER_HINGE_BATTEN_T: 15,    // 목대 두께 15T — 멍 폭에 더해진다
  // 재단 가로(70)는 여기 두지 않는다. 플래너는 부재를 산출하지 않고 **폭만** 쓴다.
  // 자재표 치수는 data-constants.js 의 CORNER_HINGE_BATTEN_W 가 정본이다 (W12-60).
  // W12-54: 배치 공간 깊이 분해에서 도어가 차지하는 자리. **자재는 18T 그대로**이고
  //   (DOOR_T) 여기 20 은 시공 갭을 포함한 자리다 — 발주 치수가 아니다.
  //   배치 공간 깊이 = 물끊기 + 도어 자리 + 몸통 + 여유(뒤).  700 = 10 + 20 + 550 + 120
  DOOR_SEAT_D: 20,
  // 플래너 전용 — 레거시엔 없다. 라인이 선언돼 있지 않아 코너를 좌표로 찾기 때문에,
  // 사람이 손으로 그린 사각형의 어긋남을 얼마까지 코너로 볼지 정해야 한다.
  CORNER_TOUCH_TOL: 20,         // 두 배치 공간이 이 안쪽으로 만나면 코너로 본다
};

// W9-115: 상몰딩 H — 섹션별. 선반 계산(autoCalcModule)과 3D 렌더 양쪽이 쓴다.
//   wardrobe 카테고리는 mockup 에서 다른 section 을 쓴다 (확장은 P11).
function getMoldingH(section) {
  if (section === 'upper') return MASTER_RULES.CROWN_MOLDING_SINK;     // 싱크 상부장 60
  if (section === 'fridge') return MASTER_RULES.CROWN_MOLDING_FRIDGE;  // 냉장고 50
  return 0;
}

// 구조가 지정한 높이 부위를 우선하고, 없으면 마스터 상수로 떨어진다.
//   구조 단계 UI 는 예전부터 s.legH / s.moldingH 를 편집하게 해뒀는데 계산·렌더가
//   상수를 직접 읽어 그 값이 아무 데도 닿지 않았다. 두 함수가 그 길을 잇는다.
function effectiveLegH(s) {
  const v = parseFloat(s && s.legH);
  return Number.isFinite(v) && v >= 0 ? v : MASTER_RULES.SINK_LEG;
}
function effectiveMoldingH(section, s) {
  const v = parseFloat(s && s.moldingH);
  return Number.isFinite(v) && v >= 0 ? v : getMoldingH(section);
}

function calcDoorCount(W) {
  if (W <= 600)  return 1;
  if (W <= 1000) return 2;
  if (W <= 1400) return 3;
  if (W <= 1800) return 4;
  if (W <= 2200) return 5;
  return Math.max(1, Math.round(W / MASTER_RULES.DOOR_W_TARGET));
}

// W9-96: distributeModules — planner-vite/src/lib/calc-utils.ts 의 TS 알고리즘 vanilla 포팅
//   3가지 후보 (10단위 내림 / 짝수 내림 / 균등) 우선순위 정렬 + 잔여 0~10mm 최적화 + 2D 페어링
//   반환: { doorWidth, doorCount, modules: [{ w, is2D }], gap }
function distributeModules(totalSpace) {
  if (totalSpace < 100) return { modules: [], doorWidth: 0, doorCount: 0, gap: 0 };
  const DOOR_TARGET = MASTER_RULES.DOOR_W_TARGET;
  const DOOR_MAX = MASTER_RULES.DOOR_W_MAX;
  const DOOR_MIN = MASTER_RULES.DOOR_W_MIN;
  const MAX_REM = MASTER_RULES.MAX_REMAINDER;
  const minCount = Math.max(1, Math.ceil(totalSpace / DOOR_MAX));
  const baseCount = Math.round(totalSpace / DOOR_TARGET);
  const maxDoorCount = Math.floor(totalSpace / DOOR_MIN);
  const maxCount = Math.min(maxDoorCount, Math.max(baseCount + 3, minCount + 5));
  const allResults = [];
  for (let count = minCount; count <= maxCount; count++) {
    // 균등 분배 후보
    const evenWidth = Math.floor(totalSpace / count);
    const evenGap = totalSpace - evenWidth * count;
    if (evenWidth >= DOOR_MIN && evenWidth <= DOOR_MAX && evenGap >= 0 && evenGap <= MAX_REM) {
      allResults.push({ doorCount: count, doorWidth: evenWidth, gap: evenGap, targetDiff: Math.abs(evenWidth - DOOR_TARGET) });
    }
    // 10단위 내림 후보
    const floorWidth = Math.floor(totalSpace / count / 10) * 10;
    if (floorWidth >= DOOR_MIN && floorWidth <= DOOR_MAX) {
      const floorGap = totalSpace - floorWidth * count;
      if (floorGap >= 0 && floorGap <= MAX_REM) {
        allResults.push({ doorCount: count, doorWidth: floorWidth, gap: floorGap, targetDiff: Math.abs(floorWidth - DOOR_TARGET) });
      }
    }
    // 짝수 내림 후보
    const evenFloor = Math.floor(totalSpace / count / 2) * 2;
    if (evenFloor >= DOOR_MIN && evenFloor <= DOOR_MAX && evenFloor !== floorWidth) {
      const eg = totalSpace - evenFloor * count;
      if (eg >= 0 && eg <= MAX_REM) {
        allResults.push({ doorCount: count, doorWidth: evenFloor, gap: eg, targetDiff: Math.abs(evenFloor - DOOR_TARGET) });
      }
    }
  }
  // 정렬: 목표 450 근접 → 잔여 작은 순 → 도어 수 적은 순
  allResults.sort((a, b) => {
    if (a.targetDiff !== b.targetDiff) return a.targetDiff - b.targetDiff;
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.doorCount - b.doorCount;
  });
  const best = allResults.length > 0 ? allResults[0] : null;
  if (!best) {
    // 후보 없음 → fallback 단순 calcDoorCount
    const n = calcDoorCount(totalSpace);
    const w = Math.floor(totalSpace / n);
    return { modules: Array(n).fill(0).map(() => ({ w, is2D: false })), doorWidth: w, doorCount: n, gap: totalSpace - w * n };
  }
  // 2D 페어링: quotient = floor(N/2) 모듈은 폭 w*2, 1D 도어 2개
  const { doorCount, doorWidth, gap } = best;
  const quotient = Math.floor(doorCount / 2);
  const remainder = doorCount % 2;
  const modules = [];
  for (let i = 0; i < quotient; i++) modules.push({ w: doorWidth * 2, is2D: true });
  if (remainder > 0) modules.push({ w: doorWidth, is2D: false });
  return { modules, doorWidth, doorCount, gap };
}

// W9-90: 선반 — 마스터 규칙 (분배공간 300~450, 신발장 180~350) 안 최대 갯수
// ── 코너 (멍장) ──────────────────────────────────────────────
//
// W12-49: 멍장 파생 계산 — docs/design-rules/corner.md §3.3~§3.7.
//
// 이 계산의 정본은 `js/detaildesign/corner-engine.js` 의 `deriveCorner` 다.
// 두 함수는 **같은 입력에 같은 값을 내야 한다** (planner-corner-blind.test.js 가
// 대조한다). 여기 따로 두는 이유는 하나뿐이다 — 플래너는 detaildesign 의
// 스크립트를 로드하지 않는다.
//
// 다른 점은 입력의 모양이다. 레거시는 `item.specs` 의 **선언된 라인**
// (layoutShape:'L', secondaryW)을 읽고, 플래너에는 그런 선언이 없다.
// 사각형만 있다. 그래서 라인 대신 배치 공간의 W·D 를 받는다.
//
// @param {object} p
// @param {number} p.ownerW  멍장이 설 배치 공간의 폭
// @param {number} p.ownerD  같은 공간의 깊이 — 인접 공간이 밀려날 거리를 정한다
// @param {number} p.adjD    인접(가로지르는) 배치 공간의 깊이 — 멍의 크기를 정한다
// @param {boolean} [p.isUpper=false] 상부장이면 물끊기 없이 320 + 몰딩 (§3.6)
// @param {number} [p.molding]  코너 몰딩 (기본 60)
// @param {number} [p.epW]      멍장 반대쪽 끝 EP (기본 20)
// @param {number} [p.minDoorW] 도어 최소폭 (기본 350)
//
// W12-54: `ownerD`·`adjD` 는 **배치 공간 깊이 = 상판 깊이**다. 평면도에서 위에서
//   내려다보면 상판이 제일 바깥이므로, 배치 단계에서 그리는 사각형이 곧 상판
//   외곽이다. 그 깊이는 이렇게 나뉜다:
//
//     배치 공간 깊이 = 물끊기 + 도어 자리 + 몸통 깊이 + 여유(뒤)
//              700  =     10 +       20 +      550 +      120
//
//   여유공간은 입력이 아니라 **남는 값**이다.
function deriveCornerArea(p) {
  const R = MASTER_RULES;
  const molding  = Number.isFinite(p.molding)  ? p.molding  : R.CORNER_MOLDING;
  const epW      = Number.isFinite(p.epW)      ? p.epW      : R.CORNER_EP_W;
  const minDoorW = Number.isFinite(p.minDoorW) ? p.minDoorW : R.DOOR_W_MIN;
  const ownerW = Number(p.ownerW) || 0;
  const warnings = [];

  // 한 배치 공간이 **두 코너의 주인**일 수 있다 (ㄷ자 가운데 다리). 그때는 양끝에서
  // 각각 멍이 빠지고 벽 여유도 둘이다. 코너가 하나면 배열 길이가 1일 뿐 식은 같다.
  const adjDs = Array.isArray(p.adjDs) ? p.adjDs : [Number(p.adjD) || 0];
  const n = Math.max(1, adjDs.length);

  // ① 멍 (blind zone) — §3.3 / §3.6
  //   목대 15T 는 멍장 도어 경첩을 달 자리다 (W12-54). 마감재 60 은 몰딩 **또는
  //   휠라** — 코너 마감 선택값이다. 상부는 상판이 없어 물끊기를 빼지 않는다.
  const batten = R.CORNER_HINGE_BATTEN_T;
  const blindZoneWs = adjDs.map((d) => p.isUpper
    ? R.CORNER_UPPER_MODULE + molding + batten
    : (Number(d) || 0) - R.CORNER_DRIP + molding + batten);
  const zoneSum = blindZoneWs.reduce((a, b) => a + b, 0);

  // ② 도어 균등 분배 — §3.4 라인 원장. 도어 폭은 라인 하나에 하나다.
  const doorAvail = ownerW - epW - R.CORNER_WALL_GAP * n - zoneSum;

  // 멍장마다 최소 도어 한 장씩 들어가는 최소 폭. 거부할 때 이 값을 안내한다.
  const minOwnerW = epW + R.CORNER_WALL_GAP * n + zoneSum + minDoorW * n;

  // 멍이 라인을 다 먹었다 — 멍장을 세울 자리가 없다.
  // 반쯤 세우면 도어 없는 장이 서고 원장도 안 맞는다. 아예 만들지 않는다.
  if (doorAvail <= 0) {
    return { ok: false, reason: 'no-room', corners: n, blindZoneWs, blindZoneW: blindZoneWs[0],
             doorAvail, minOwnerW, warnings };
  }

  let nDoors, doorW;
  if (doorAvail < minDoorW * n) {
    // 코너마다 도어 한 장씩도 최소폭에 못 미친다 — 경고를 남기고 균등하게 쪼갠다
    // (레거시는 코너가 하나뿐이라 nDoors=1 이었다. n=1 이면 같은 값이다.)
    nDoors = n;
    doorW = Math.max(0, Math.floor(doorAvail / n));
    warnings.push('도어 가용폭 ' + Math.round(doorAvail) + 'mm < 최소 '
      + minDoorW + 'mm × 코너 ' + n);
  } else {
    // 최소폭을 만족하는 **최대** 도어 수 (1200 / 350 → 3장 → 400)
    nDoors = Math.floor(doorAvail / minDoorW);
    doorW = Math.floor(doorAvail / nDoors);
  }
  const remainder = Math.max(0, doorAvail - doorW * nDoors);

  // ③ 멍장 W = 멍 + 도어 1장 (§3.4). 코너마다 도어를 한 장씩 갖는다.
  const blindWs = blindZoneWs.map((z) => z + doorW);

  // ④ 인접 공간이 코너에서 밀려 시작하는 거리 — §3.7.
  //    멍장 라인의 깊이만 보므로 코너가 둘이어도 값은 하나다.
  //    **목대는 안 붙는다** — 멍장 도어 경첩용이라 인접 공간이 시작하는 자리와
  //    무관하다 (W12-54 확정).
  const adjStartOffset = p.isUpper
    ? R.CORNER_UPPER_MODULE + molding
    : (Number(p.ownerD) || 0) - R.CORNER_DRIP + molding;

  return {
    ok: true,
    corners: n,
    blindZoneWs, blindWs,
    // 코너가 하나인 쪽에서 읽기 쉽도록 첫 값을 그대로도 낸다
    blindZoneW: blindZoneWs[0], blindW: blindWs[0],
    doorAvail, nDoors, doorW, remainder,
    adjStartOffset, epW, minOwnerW,
    // 멍장들을 뺀 나머지 수납이 나눠 가질 폭
    restBudget: doorAvail - doorW * n,
    warnings,
  };
}

/**
 * W12-49: 멍장이 있는 배치 공간의 수납 분배 — **도어 우선**.
 *
 * 일반 `distributeModules` 는 폭을 보고 도어 수를 정한다. 멍장 라인에서는 그럴 수
 * 없다 — 라인 전체의 도어가 같은 폭이어야 하기 때문이다(§3.4). 그래서 폭이 아니라
 * **도어 장수**를 나눈다. 모듈 W 는 언제나 `도어 수 × doorW` 다.
 *
 * 잔여는 마지막 모듈이 흡수한다 (W9 관례 · `autoCalcArea` 와 같은 처리).
 */
function distributeByDoorW(budget, doorW) {
  const total = Math.max(0, Number(budget) || 0);
  const w = Number(doorW) || 0;
  if (w <= 0 || total < w) return { modules: [], gap: total };
  let left = Math.floor(total / w);
  const mods = [];
  while (left > 0) {
    const take = left >= 2 ? 2 : 1;      // 양문 우선, 홀수면 마지막이 단문
    mods.push({ doors: take, w: take * w, is2D: take === 2 });
    left -= take;
  }
  const remainder = total - mods.reduce((s, m) => s + m.w, 0);
  if (remainder > 0) mods[mods.length - 1].w += remainder;
  // 잔여는 여기서 이미 흡수했다. `gap` 을 0 이 아닌 값으로 돌려주면 호출부가
  // 한 번 더 나눠 붙여 **두 번 더해진다** (autoCalcArea 의 잔여 분배).
  return { modules: mods, gap: 0, remainder };
}

function calcDefaultShelves(section, H) {
  const isShoe = section === 'shoe';
  const MIN = isShoe ? MASTER_RULES.SHELF_SPACE_MIN_SHOE : MASTER_RULES.SHELF_SPACE_MIN;
  const MAX = isShoe ? MASTER_RULES.SHELF_SPACE_MAX_SHOE : MASTER_RULES.SHELF_SPACE_MAX;
  // 분배공간 space = H / (count+1). MIN ≤ space ≤ MAX 안 최대 count
  //   space ≥ MIN → count ≤ H/MIN - 1
  //   space ≤ MAX → count ≥ H/MAX - 1
  let count = Math.floor(H / MIN) - 1;       // 최대 가능 count (space ≥ MIN)
  count = Math.max(0, count);
  if (count === 0) return [];
  let step = H / (count + 1);
  if (step > MAX) {                          // 단일 선반도 분배공간 > MAX → count 늘려서 MAX 만족
    count = Math.ceil(H / MAX) - 1;
    if (count < 1) return [];
    step = H / (count + 1);
  }
  return Array.from({ length: count }, (_, i) => Math.round(step * (i + 1)));
}

// 세트의 가전 X 범위 수집
function collectXRanges(set, section) {
  return set.modules.filter(m => m.section === section).map(m => ({ x0: m.x, x1: m.x + m.W }));
}

// W9-95: 모듈 X 범위를 가전 분할점으로 세그먼트화
//   가전 영역 = kind:'open', 나머지 = kind:'general'
function splitModuleByAppliance(m, ranges) {
  const Mx0 = m.x, Mx1 = m.x + m.W;
  const appliances = (ranges || [])
    .map(r => ({ x0: Math.max(Mx0, r.x0), x1: Math.min(Mx1, r.x1) }))
    .filter(r => r.x1 > r.x0)
    .sort((a, b) => a.x0 - b.x0);
  const segs = [];
  let cursor = Mx0;
  appliances.forEach(a => {
    if (a.x0 > cursor) segs.push({ x0: cursor, x1: a.x0, kind: 'general' });
    segs.push({ x0: a.x0, x1: a.x1, kind: 'open' });
    cursor = a.x1;
  });
  if (cursor < Mx1) segs.push({ x0: cursor, x1: Mx1, kind: 'general' });
  if (!segs.length) segs.push({ x0: Mx0, x1: Mx1, kind: 'general' });
  return segs;
}

// 단일 모듈 자동계산 — 가전 위치 (sink/hood/dishwasher) 고려
//   s 를 **제자리에서 고친다**(반환값 없음). 호출부가 getStructure(m.id) 로 얻은
//   구조 객체를 그대로 넘기기 때문 — 이 부수효과가 계약이라 옮기면서도 유지했다.
function autoCalcModule(m, s, applianceRanges) {
  const W = m.W, H = m.H;
  const moduleX0 = m.x;
  // W9-90: 마스터 H 표준 검증 (경고만, 변경 안 함)
  if (m.section === 'lower' && Math.abs(H - MASTER_RULES.SINK_LOWER_H) > 50) {
    console.warn('[STRUCT] ' + m.id + ' H=' + H + ' ≠ 마스터 ' + MASTER_RULES.SINK_LOWER_H + ' (싱크 하부장 표준)');
  }
  if (m.section === 'upper' && Math.abs(H - MASTER_RULES.SINK_UPPER_H) > 50) {
    console.warn('[STRUCT] ' + m.id + ' H=' + H + ' ≠ 마스터 ' + MASTER_RULES.SINK_UPPER_H + ' (싱크 상부장 표준)');
  }
  // 1. 소구조
  if (m.section === 'lower') {
    s.horizontalLayout = 'doorTopDrawerBottom';
    s.drawerHeight = 200;
    s.bottomType = 'drawer';
    s.bottomDirection = 'left';
  } else {
    s.horizontalLayout = 'doorOnly';
  }
  // 2. W9-95/99: 가전 X 정밀 분할 — 일반 부엌 모듈 (lower/upper) 만
  //   W9-99: 냉장고 (fridge) 는 바닥~천장 전체 차지 → lower+upper 양쪽에 적용
  const isKitchen = m.section === 'lower' || m.section === 'upper';
  const myRanges = isKitchen && applianceRanges
    ? [
        ...((m.section === 'lower') ? (applianceRanges.sink || []) : []),
        ...((m.section === 'lower') ? (applianceRanges.dishwasher || []) : []),
        ...((m.section === 'upper') ? (applianceRanges.hood || []) : []),
        ...(applianceRanges.fridge || []),     // W9-99: 냉장고 니치 (lower+upper 모두)
      ]
    : [];
  const segs = splitModuleByAppliance(m, myRanges);
  // 3. 세그먼트별 도어/오픈/먹장 결정 — areaTypes / areaDirections / areaWidths
  const areaTypes = [];
  const areaDirections = [];
  const areaWidths = [];
  const areaIs2D = [];   // W9-101: 양문 여부
  segs.forEach(seg => {
    const segW = seg.x1 - seg.x0;
    if (seg.kind === 'open') {
      areaTypes.push('open');
      areaDirections.push('left');
      areaWidths.push(segW);
      areaIs2D.push(false);
      return;
    }
    // 일반 세그먼트
    if (segW < MASTER_RULES.BLANK_THRESHOLD) {
      areaTypes.push('blank');
      areaDirections.push('left');
      areaWidths.push(segW);
      areaIs2D.push(false);
      return;
    }
    // W9-96/101: distributeModules — 잔여 0~10mm + 2D 페어링
    //   W9-101: 양문 모듈은 1 cell 유지 (areaIs2D=true), 가운데 처짐방지목 시각화
    const dist = distributeModules(segW);
    if (!dist.modules.length) {
      areaTypes.push('blank');
      areaDirections.push('left');
      areaWidths.push(segW);
      areaIs2D.push(false);
      return;
    }
    // 양문 (is2D) 1 cell 로 유지 + 단문 1 cell
    const cells = dist.modules.map(mod => ({
      w: mod.w,
      dir: mod.is2D ? 'both' : 'left',
      is2D: !!mod.is2D,
    }));
    // 잔여 gap 균등 분배 (마스터 common: Math.floor(gap/N) + 끝 cell 잉여)
    const N = cells.length;
    if (dist.gap > 0 && N > 0) {
      const per = Math.floor(dist.gap / N);
      const extra = dist.gap - per * N;
      cells.forEach((c, i) => { c.w += per + (i === N - 1 ? extra : 0); });
    }
    cells.forEach(c => {
      areaTypes.push('door');
      areaDirections.push(c.dir);
      areaWidths.push(c.w);
      areaIs2D.push(c.is2D);
    });
  });
  s.areaTypes = areaTypes;
  s.areaDirections = areaDirections;
  s.areaWidths = areaWidths;
  s.areaIs2D = areaIs2D;   // W9-101
  s.verticalCount = areaTypes.length;
  // 4. 선반 — W9-114/115: 본체 H 기준 (다리발 + 상몰딩 빼고)
  //   구조에 legH/moldingH 가 지정돼 있으면 그 값을 쓴다. 지정이 없으면 마스터 상수로
  //   떨어지므로 기존 계산과 같다 — 골든이 바뀌지 않는 이유다.
  const legH4Shelf = (m.section === 'lower') ? effectiveLegH(s) : 0;
  const moldingH4Shelf = effectiveMoldingH(m.section, s);
  const shelfH = H - legH4Shelf - moldingH4Shelf;
  s.shelves = calcDefaultShelves(m.section, shelfH);
  // 5. 손잡이 (다담 매립형)
  s.handleType = 'channel';
  s.handlePosition = (m.section === 'upper') ? 'bottom'
                   : (m.section === 'lower') ? 'top'
                   : 'middle';
}

// 브라우저에서는 클래식 스크립트의 최상위 선언이 전역 렉시컬 스코프에 올라가
// 뒤따르는 인라인이 그대로 참조한다. 하지만 테스트 하네스는 스크립트마다
// 함수 스코프를 만들기 때문에 그 연결이 끊긴다 — window 에 실어야 인라인이 찾는다.
// 이 블록이 빠지면 브라우저는 멀쩡한데 골든만 ReferenceError 로 죽는다.
if (typeof window !== 'undefined') {
  window.MASTER_RULES = MASTER_RULES;
  window.getMoldingH = getMoldingH;
  window.effectiveLegH = effectiveLegH;
  window.effectiveMoldingH = effectiveMoldingH;
  window.calcDoorCount = calcDoorCount;
  window.distributeModules = distributeModules;
  window.calcDefaultShelves = calcDefaultShelves;
  window.collectXRanges = collectXRanges;
  window.splitModuleByAppliance = splitModuleByAppliance;
  window.autoCalcModule = autoCalcModule;
  window.deriveCornerArea = deriveCornerArea;
  window.distributeByDoorW = distributeByDoorW;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MASTER_RULES,
    getMoldingH, effectiveLegH, effectiveMoldingH,
    calcDoorCount, distributeModules, calcDefaultShelves,
    collectXRanges, splitModuleByAppliance, autoCalcModule,
    deriveCornerArea, distributeByDoorW,
  };
}
