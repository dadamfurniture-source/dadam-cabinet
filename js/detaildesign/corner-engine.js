// ============================================================
// W10-1: 멍장(코너장) 파생 엔진 — corner-engine.js
// 규칙 원본: docs/design-rules/corner.md §3 (2026-07-17 확정)
// 설계 문서: docs/02-design/features/corner-autocalc.design.md
//
// 원칙: 멍장 치수는 어디에도 "입력"되지 않는다.
//       specs가 바뀔 때마다 deriveCorner()가 유일하게 재계산한다.
//
// 브라우저: 전역 함수로 노출 (data-constants.js 이후 로드)
// Jest:     module.exports 이중 노출 (__tests__/corner-engine.test.js)
// ============================================================

// data-constants.js 전역 상수 참조 + Jest(CommonJS) 환경 fallback.
// fallback 값은 data-constants.js 정의와 반드시 일치해야 한다 (drift 금지).
/* eslint-disable no-undef */
function _cornerDrip()    { return typeof CORNER_DRIP        !== 'undefined' ? CORNER_DRIP        : 10; }
function _cornerWallGap() { return typeof CORNER_WALL_GAP    !== 'undefined' ? CORNER_WALL_GAP    : 50; }
function _cornerUpperMod(){ return typeof CORNER_UPPER_MODULE!== 'undefined' ? CORNER_UPPER_MODULE : 320; }
function _cornerEpW()     { return typeof CORNER_EP_W        !== 'undefined' ? CORNER_EP_W        : 20; }
function _cornerMinDoorW(){ return typeof DOOR_MIN_WIDTH     !== 'undefined' ? DOOR_MIN_WIDTH     : 350; }
/* eslint-enable no-undef */

/**
 * 멍장 파생 계산 (순수 함수) — corner.md §3.3~3.7
 *
 * @param {object} p
 * @param {number} p.lineW        멍장 라인 전체 W (예: 1970)
 * @param {number} p.adjTopD      인접 라인 상판 깊이 (예: 650) — 하부장 멍 계산용
 * @param {number} p.blindLineTopD 멍장 라인 상판 깊이 — 인접 라인 시작 offset 계산용 (§3.7)
 * @param {number} [p.molding=60] 코너 몰딩 폭 (finishCorner)
 * @param {number} [p.epW=20]     멍장 라인 반대편 끝 EP 폭 (§3.4 예시)
 * @param {boolean} [p.isUpper=false] 상부장 여부 — 상부: 멍 = 320 + 몰딩, 물끊기 없음 (§3.6)
 * @param {number} [p.minDoorW=350]   도어 최소 폭 (DOOR_MIN_WIDTH)
 * @returns {{
 *   blindZoneW:number, doorAvail:number, nDoors:number, doorW:number,
 *   remainder:number, blindW:number, adjStartOffset:number, warnings:string[]
 * }}
 */
function deriveCorner(p) {
  const molding = Number.isFinite(p.molding) ? p.molding : 60;
  const epW = Number.isFinite(p.epW) ? p.epW : _cornerEpW();
  const drip = _cornerDrip();
  const wallGap = _cornerWallGap();
  const upperModule = _cornerUpperMod();
  const minDoorW = Number.isFinite(p.minDoorW) ? p.minDoorW : _cornerMinDoorW();
  const warnings = [];

  // ① 멍 (blind zone) — §3.3 / §3.6
  //    하부: 인접 상판깊이 − 물끊기 + 몰딩 (예: 650−10+60 = 700)
  //    상부: 320(몸통295+도어18→관례) + 몰딩 (예: 380), 물끊기 없음
  const blindZoneW = p.isUpper
    ? upperModule + molding
    : p.adjTopD - drip + molding;

  // ② 도어 균등 분배 — §3.4 라인 원장
  //    도어 가용폭 = 라인 W − EP − 벽여유(50) − 멍
  const doorAvail = p.lineW - epW - wallGap - blindZoneW;

  let nDoors, doorW;
  if (doorAvail < minDoorW) {
    // 도어 1개도 최소폭 미달 — 경고 후 가용폭 전체를 멍장 도어로
    nDoors = 1;
    doorW = Math.max(0, Math.floor(doorAvail));
    warnings.push(
      '도어 가용폭 ' + doorAvail + 'mm < 최소 도어폭 ' + minDoorW + 'mm — 라인 W 확인 필요'
    );
  } else {
    // 최소 350을 만족하는 최대 도어 수 (예: floor(1200/350)=3 → 도어 400)
    nDoors = Math.floor(doorAvail / minDoorW);
    doorW = Math.floor(doorAvail / nDoors);
  }
  const remainder = Math.max(0, doorAvail - doorW * nDoors); // 마지막 수납 모듈이 흡수 (W9 관례)

  // ③ 멍장 W = 멍 + 도어 (§3.4)
  const blindW = blindZoneW + doorW;

  // ④ 인접 라인 시작 offset — §3.7: 멍장 라인 상판깊이 − 물끊기 + 몰딩
  //    상부는 물끊기 없음 (§3.6과 동일 원리)
  const adjStartOffset = p.isUpper
    ? upperModule + molding
    : (Number.isFinite(p.blindLineTopD) ? p.blindLineTopD : p.adjTopD) - drip + molding;

  return { blindZoneW, doorAvail, nDoors, doorW, remainder, blindW, adjStartOffset, warnings };
}

/**
 * item.specs → deriveCorner 입력 추출 (하부장, blindLine 기준)
 * W10-1: blindLine = 'secondary' 만 지원. 'prime' 배치는 W10-2 (토글 UI와 함께).
 */
function cornerParamsFromItem(item, pos) {
  const specs = item.specs || {};
  const isUpper = pos === 'upper';
  const primeTopD =
    parseFloat(specs.topSizes && specs.topSizes[0] && specs.topSizes[0].d) ||
    parseFloat(item.d) || 650;
  const secTopD =
    parseFloat(specs.topSizes && specs.topSizes[1] && specs.topSizes[1].d) ||
    parseFloat(specs.lowerSecondaryD) || primeTopD;
  return {
    lineW: parseFloat(isUpper ? specs.upperSecondaryW : specs.lowerSecondaryW) || 1800,
    adjTopD: primeTopD,       // 인접 = prime (blindLine=secondary 고정, W10-1)
    blindLineTopD: secTopD,
    molding: parseFloat(specs.finishCorner1Width) || 60,
    isUpper: isUpper,
  };
}

/**
 * ㄱ자/ㄷ자 전환 시 하부 멍장 + secondary 수납 시드를 item.modules에 영속화 (멱등)
 * - 멍장(isDerived)은 항상 재계산, 기존 secondary 수납 모듈은 보존
 * - 호출처: ui-workspace.js changeLowerLayoutShape()
 */
function seedCornerModules(item) {
  const specs = item.specs || {};
  const startSide = specs.secondaryStartSide || 'left';
  const d = deriveCorner(cornerParamsFromItem(item, 'lower'));

  const specLowerH = parseFloat(specs.lowerH) || 870;
  const specLegH = parseFloat(specs.sinkLegHeight) || 150;
  const specTopT = parseFloat(specs.topThickness) || 12;
  const bodyH = specLowerH - specTopT - specLegH;
  const bodyD = parseFloat(specs.lowerSecondaryD) || parseFloat(item.d) || 550;

  // ① 멍장 — 결정적 id, 있으면 치수만 갱신 (파생값)
  let blind = item.modules.find((m) => m.id === 'corner-blind-lower');
  const legacyBlind = item.modules.find(
    (m) => m.name === 'LT망장' && m.pos === 'lower' && m.orientation === 'secondary' && m.id !== 'corner-blind-lower'
  );
  if (!blind && legacyBlind) {
    // 구식 멍장(w=secondaryD 저장) → 파생 모듈로 승격
    legacyBlind.id = 'corner-blind-lower';
    blind = legacyBlind;
  }
  if (!blind) {
    blind = {
      id: 'corner-blind-lower',
      type: 'storage', name: 'LT망장', pos: 'lower',
      isFixed: true,
      orientation: 'secondary',
    };
    if (startSide === 'left') {
      item.modules.unshift(blind);
    } else {
      const lastLowerIdx = item.modules.reduce((last, m, i) => (m.pos === 'lower' ? i : last), -1);
      item.modules.splice(lastLowerIdx + 1, 0, blind);
    }
  }
  blind.line = 'secondary';
  blind.isDerived = true;
  blind.isFixed = true;
  blind.isDrawer = false;          // 구규칙(isDrawer 기본) 폐기 — 내부 선반 기본 (corner.md §3.5)
  blind.w = d.blindW;
  blind.h = bodyH;
  blind.d = bodyD;
  blind.blindZoneW = d.blindZoneW; // BOM: 2.7T MDF 가림판 폭
  blind.doorW = d.doorW;           // BOM: 도어 부재 폭 (카카스 W 아님)
  blind.doorCount = 1;

  // ② secondary 수납 시드 — 기존 수납이 하나도 없을 때만 생성
  const existingSec = item.modules.filter(
    (m) => m.pos === 'lower' && (m.line === 'secondary' || m.orientation === 'secondary') && m.id !== 'corner-blind-lower'
  );
  if (existingSec.length === 0 && d.nDoors > 1) {
    const seeds = [];
    for (let i = 0; i < d.nDoors - 1; i++) {
      seeds.push({
        id: 'corner-sec-lower-' + i,
        type: 'storage', name: '수납장', pos: 'lower',
        line: 'secondary', orientation: 'secondary',
        w: d.doorW + (i === d.nDoors - 2 ? d.remainder : 0), // 잔여는 마지막 시드가 흡수
        h: bodyH, d: bodyD,
        doorCount: 1,
      });
    }
    const blindIdx = item.modules.indexOf(blind);
    // 멍장이 코너쪽 — 도어 모듈들은 멍장에서 먼 쪽(EP 방향)에 배치
    if (startSide === 'left') {
      item.modules.splice(blindIdx + 1, 0, ...seeds);
    } else {
      item.modules.splice(blindIdx, 0, ...seeds);
    }
  }

  if (d.warnings.length && typeof console !== 'undefined') {
    d.warnings.forEach((w) => console.warn('[corner-engine]', w));
  }
  return d;
}

/** ㅡ자(I) 복귀 시 secondary 라인 모듈 제거 */
function removeCornerModules(item) {
  item.modules = item.modules.filter(
    (m) => !(m.pos === 'lower' && (m.line === 'secondary' || m.orientation === 'secondary'))
  );
}

/**
 * W10-2: 상부장 멍장 + secondary 수납 시드 영속화 (멱등)
 * 멍 = 320(몸통295+도어18→관례) + 몰딩 = 380, 물끊기 없음 (corner.md §3.6)
 * 원장 구조(EP20 + 도어들 + 멍장 + 여유50)는 하부와 동일 가정 — §3.4 준용
 */
function seedUpperCornerModules(item) {
  const specs = item.specs || {};
  if (specs.secondaryUpperEnabled === false) return null;
  const startSide = specs.secondaryStartSide || 'left';
  const d = deriveCorner(cornerParamsFromItem(item, 'upper'));

  const bodyH = parseFloat(specs.upperH) || 720;
  const bodyD = parseFloat(specs.upperSecondaryD) || 295;

  // ① 상부 멍장 — 결정적 id
  let blind = item.modules.find((m) => m.id === 'corner-blind-upper');
  const legacyBlind = item.modules.find(
    (m) => m.name === 'LT망장' && m.pos === 'upper' && m.orientation === 'secondary' && m.id !== 'corner-blind-upper'
  );
  if (!blind && legacyBlind) {
    legacyBlind.id = 'corner-blind-upper';
    blind = legacyBlind;
  }
  if (!blind) {
    blind = {
      id: 'corner-blind-upper',
      type: 'storage', name: 'LT망장', pos: 'upper',
      isFixed: true,
      orientation: 'secondary',
    };
    const firstUpperIdx = item.modules.findIndex((m) => m.pos === 'upper');
    if (startSide === 'left') {
      if (firstUpperIdx === -1) item.modules.push(blind);
      else item.modules.splice(firstUpperIdx, 0, blind);
    } else {
      const lastUpperIdx = item.modules.reduce((last, m, i) => (m.pos === 'upper' ? i : last), -1);
      if (lastUpperIdx === -1) item.modules.push(blind);
      else item.modules.splice(lastUpperIdx + 1, 0, blind);
    }
  }
  blind.line = 'secondary';
  blind.isDerived = true;
  blind.isFixed = true;
  blind.isDrawer = false;
  blind.w = d.blindW;
  blind.h = bodyH;
  blind.d = bodyD;
  blind.blindZoneW = d.blindZoneW;
  blind.doorW = d.doorW;
  blind.doorCount = 1;

  // ② 상부 secondary 수납 시드 — 기존 수납이 없을 때만
  const existingSec = item.modules.filter(
    (m) => m.pos === 'upper' && (m.line === 'secondary' || m.orientation === 'secondary') && m.id !== 'corner-blind-upper'
  );
  if (existingSec.length === 0 && d.nDoors > 1) {
    const seeds = [];
    for (let i = 0; i < d.nDoors - 1; i++) {
      seeds.push({
        id: 'corner-sec-upper-' + i,
        type: 'storage', name: '수납장', pos: 'upper',
        line: 'secondary', orientation: 'secondary',
        w: d.doorW + (i === d.nDoors - 2 ? d.remainder : 0),
        h: bodyH, d: bodyD,
        doorCount: 1,
      });
    }
    const blindIdx = item.modules.indexOf(blind);
    if (startSide === 'left') {
      item.modules.splice(blindIdx + 1, 0, ...seeds);
    } else {
      item.modules.splice(blindIdx, 0, ...seeds);
    }
  }

  if (d.warnings.length && typeof console !== 'undefined') {
    d.warnings.forEach((w) => console.warn('[corner-engine:upper]', w));
  }
  return d;
}

/** 상부장 ㅡ자(I) 복귀 시 상부 secondary 모듈 제거 */
function removeUpperCornerModules(item) {
  item.modules = item.modules.filter(
    (m) => !(m.pos === 'upper' && (m.line === 'secondary' || m.orientation === 'secondary'))
  );
}

/**
 * 저장된 설계 로드 시 마이그레이션 (멱등) — persistence-init.js에서 호출
 * 1. orientation만 있는 모듈 → line 부여
 * 2. L/U인데 secondary 수납 0개 or 구식 멍장 → seedCornerModules로 보정
 */
function migrateCornerModules(item) {
  if (!item || !Array.isArray(item.modules)) return;
  item.modules.forEach((m) => {
    if (m.orientation && !m.line) m.line = m.orientation;
  });
  const specs = item.specs || {};
  const lowerShape = specs.lowerLayoutShape || specs.layoutShape || 'I';
  if (lowerShape === 'L' || lowerShape === 'U') {
    seedCornerModules(item);
  }
  // W10-2: 상부장 — 분리 모드는 upperLayoutShape, 통합 모드는 하부 shape 따름
  const upperShape = specs.dimensionMode === 'split'
    ? (specs.upperLayoutShape || 'I')
    : lowerShape;
  if (upperShape === 'L' || upperShape === 'U') {
    seedUpperCornerModules(item);
  }
}

// ============================================================
// W10-3: 멍장 라인 자동계산 — 도어 우선 분배 + 원장 불변식
// (calc-engine.js runAutoCalcSection에서 호출)
// ============================================================

/**
 * 멍장 라인 도어 우선(door-first) 분배 — design §4.2
 * 각 수납 모듈 W = 도어 수 × doorW. 잔여(반올림/도어 수 차이)는 마지막 모듈이 흡수 (W9 관례).
 * 분배·갭 흡수는 라인 내부에서만 — 라인 간 이동 금지.
 *
 * @param {Array}  mods    멍장 제외 secondary 수납 모듈 (라인 배치 순서)
 * @param {object} derived deriveCorner() 결과
 * @returns {number} 수납 예산 (= doorAvail − 멍장 도어)
 */
function distributeBlindLine(mods, derived) {
  const budget = derived.doorAvail - derived.doorW;
  if (!mods.length) return budget;
  let assigned = 0;
  mods.forEach((m) => {
    const n = parseInt(m.doorCount, 10) || 1;
    m.w = n * derived.doorW;
    assigned += m.w;
  });
  const last = mods[mods.length - 1];
  last.w += budget - assigned;
  if (last.w < _cornerMinDoorW() && typeof console !== 'undefined') {
    console.warn(
      '[corner-engine] 마지막 수납 모듈 ' + last.w + 'mm < 최소 도어폭 ' +
      _cornerMinDoorW() + 'mm — 도어 수/라인 W 확인 필요'
    );
  }
  return budget;
}

/**
 * 원장 불변식 검증 — design §4.3
 * 멍장 라인: EP + Σ(수납 W) + 멍장 W + 벽여유(50) === lineW (±1)
 * 위반 시: strict(개발/테스트)면 throw, 아니면 경고 + 마지막 수납 모듈 보정.
 */
function assertCornerLedger(item, pos, opts) {
  const strict = !!(opts && opts.strict);
  const specs = item.specs || {};
  const isUpper = pos === 'upper';
  const lineW = parseFloat(isUpper ? specs.upperSecondaryW : specs.lowerSecondaryW) || 0;
  const blindId = isUpper ? 'corner-blind-upper' : 'corner-blind-lower';
  const blind = item.modules.find((m) => m.id === blindId);
  if (!blind || !lineW) return { ok: true, diff: 0 };
  const mods = item.modules.filter(
    (m) => m.pos === pos && (m.line === 'secondary' || m.orientation === 'secondary') && m.id !== blindId
  );
  const storageW = mods.reduce((s, m) => s + (parseFloat(m.w) || 0), 0);
  const sum = _cornerEpW() + storageW + (parseFloat(blind.w) || 0) + _cornerWallGap();
  const diff = lineW - sum;
  if (Math.abs(diff) <= 1) return { ok: true, diff };
  const msg =
    '[corner-engine] 원장 불변식 위반(' + pos + '): EP' + _cornerEpW() + ' + 수납' + storageW +
    ' + 멍장' + blind.w + ' + 여유' + _cornerWallGap() + ' = ' + sum +
    ' ≠ 라인 ' + lineW + ' (차이 ' + diff + 'mm)';
  if (strict) throw new Error(msg);
  if (typeof console !== 'undefined') console.warn(msg);
  if (mods.length) {
    const last = mods[mods.length - 1];
    last.w = (parseFloat(last.w) || 0) + diff; // 마지막 수납 모듈 보정 (프로덕션)
    return { ok: false, diff: diff, corrected: true };
  }
  return { ok: false, diff: diff, corrected: false };
}

/**
 * 자동계산 시 secondary(멍장) 라인 재계산 — 파생 → 도어 우선 분배 → 원장 불변식.
 * prime 라인과 독립 (라인 = 계산 단위). 상부 secondary 비활성 시 null.
 */
function recalcBlindLine(item, pos, opts) {
  const derived = pos === 'upper' ? seedUpperCornerModules(item) : seedCornerModules(item);
  if (!derived) return null;
  const blindId = pos === 'upper' ? 'corner-blind-upper' : 'corner-blind-lower';
  const mods = item.modules.filter(
    (m) => m.pos === pos && (m.line === 'secondary' || m.orientation === 'secondary') && m.id !== blindId
  );
  distributeBlindLine(mods, derived);
  const ledger = assertCornerLedger(item, pos, opts);
  return { derived: derived, ledger: ledger };
}

/**
 * 인접(prime) 라인 시작 offset — corner.md §3.7 / design §4.1 budgets[adj]
 * 하부: 멍장 라인 상판깊이 − 물끊기 + 몰딩 (예: 700) / 상부: 320 + 몰딩 (예: 380)
 * calc-engine calcEffectiveSpace가 기존 fC1(몰딩만) 차감 대신 사용.
 */
function cornerAdjOffset(item, pos) {
  return deriveCorner(cornerParamsFromItem(item, pos || 'lower')).adjStartOffset;
}

// ── 노출 ─────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.deriveCorner = deriveCorner;
  window.seedCornerModules = seedCornerModules;
  window.removeCornerModules = removeCornerModules;
  window.seedUpperCornerModules = seedUpperCornerModules;
  window.removeUpperCornerModules = removeUpperCornerModules;
  window.migrateCornerModules = migrateCornerModules;
  window.cornerParamsFromItem = cornerParamsFromItem;
  window.distributeBlindLine = distributeBlindLine;
  window.assertCornerLedger = assertCornerLedger;
  window.recalcBlindLine = recalcBlindLine;
  window.cornerAdjOffset = cornerAdjOffset;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deriveCorner, cornerParamsFromItem,
    seedCornerModules, removeCornerModules,
    seedUpperCornerModules, removeUpperCornerModules,
    migrateCornerModules,
    distributeBlindLine, assertCornerLedger, recalcBlindLine, cornerAdjOffset,
  };
}
