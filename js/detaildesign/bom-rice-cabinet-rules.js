/**
 * 밥솥장 규칙 (사장님 확정, 프로젝트 메모리 결정 8).
 *
 *   오픈장 + 슬라이딩 선반 · 도어 여닫이 · 포켓 · 리프트 · 최소 내경 W305 × H400 · 기본 외경 W450 × H500 ·
 *   밑에 무조건 서랍.
 *
 * 모듈 타입이다 (오픈장과 같은 자리 — 구조 s.moduleKind, BOM 모듈 mod.moduleKind).
 * 몸통은 도어가 있느냐로 나뉜다 (2026-10-25 사장님):
 *   오픈(도어 없음)  **오픈장 규칙 그대로** (js/detaildesign/bom-open-cabinet-rules.js — 18T MDF 측판 2 · 천지판 2 · 뒷판 1).
 *                    여기서 숫자를 다시 적지 않고 그 파일의 innerOf · partsOf 를 부른다.
 *   도어가 달리면    **일반 장 몸통** (측판 · 지판 · 밴드 2 · 3T 뒷판 — 하부장 · 키큰장 단과 같은 짜임), PB,
 *                    두께는 품목 몸통 두께 (기본 15T, 18T 옵션). 부재는 추출기(extractors.js addRiceCarcassParts)가 낸다.
 *
 * ── 슬라이딩 선반 (2026-10-25 사장님) ─────────────────
 *   재질  오픈이면 18T MDF (오픈장과 같은 색), 도어가 달리면 PB 몸통 두께 (몸통과 같은 색). 두께 말고 크기 식은 같다.
 *   선반      D = 레일 길이 − 10 · W = 내경 − 42 + 30 (문주 언더레일 서랍 설치 방식: 가구 내경 − 42 + 측판 15T × 2)
 *   보강목    레일 부속품 설치 — D = 선반 D · W = 80 · 2개 (바닥판 위 양옆에 눕힌다)
 *   마이다    W = 내경 − 5 · H = 95 (앞면 = 몸통 앞선, 밑단 = 선반 밑면)
 *   추가 목대 여닫이 도어일 때만 — 경첩에 서랍레일이 빠져나올 때 걸리지 않게. W = 레일 길이 + 30 · H = 100 · 1개 (경첩 쪽 측판에 세운다)
 *   레일      언더레일 1 SET. 길이는 서랍과 같은 규칙(모듈 깊이 − 50 이하의 최대 규격, bom-drawer-rules railLengthFor) — 부르는 쪽이 넘긴다.
 *   내경 = 몸통 안쪽 폭 (오픈 W − 2 × 18, 도어 W − 2 × 몸통 두께).
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamRiceCabinetRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js)과 플래너(mockup-structure)가 **같은 이 파일**을 읽는다. 오픈장 규칙 파일을 먼저 싣는다.
 *
 * ── 도어 ─────────────────────────────────────────────
 *   none 오픈(도어 없음) · swing 여닫이 · pocket 포켓 · liftup 리프트. id 는 data-constants.js EL_DOOR_TYPES 와 같다 —
 *   철물(extractors.js nonSwingHardwareOf)이 그 값을 그대로 읽는다: 리프트 = 가변철물 1 SET, 포켓 = 철물 미정이라 경첩으로 센다.
 *   도어 한 장 = (W − 4) × (H − 4). 키큰장 푸쉬 단 도어(bomTallTierDoorH H − 4)와 도어 폭(floor(W / 장수) − 4)의
 *   간격 4 를 그대로 쓴다 — 밥솥장은 밑에 서랍이 있어 바닥 단(목찬넬 H − 30)이 될 수 없다.
 *
 * ── 정해지지 않은 것 [확인 필요] ───────────────────────
 *   포켓 도어 철물 — 코드·문서에 값이 없다. 부재로 내지 않고 비고에만 적는다.
 */
(function (root, factory) {
  const oc = (typeof root !== 'undefined' && root.DadamOpenCabinetRules)
    || (typeof require === 'function' ? require('./bom-open-cabinet-rules.js') : null);
  const api = factory(oc);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamRiceCabinetRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OC) {
  'use strict';

  const RICE_CABINET_RULES = Object.freeze({
    KIND: 'rice',                 // 구조(structures)·BOM 모듈에 저장되는 모듈 타입 값
    LABEL: '밥솥장',
    MIN_INNER: Object.freeze({ W: 305, H: 400 }),
    DEFAULT_OUTER: Object.freeze({ W: 450, H: 500 }),
    DOOR_TYPES: Object.freeze([
      Object.freeze({ id: 'none', name: '오픈 (도어 없음)' }),
      Object.freeze({ id: 'swing', name: '여닫이' }),
      Object.freeze({ id: 'pocket', name: '포켓' }),
      Object.freeze({ id: 'liftup', name: '리프트' }),
    ]),
    DOOR_DEFAULT: 'none',
    DOOR_GAP: 4,                  // 도어 간격 — 키큰장 푸쉬 단 H − 4 · 도어 폭 W − 4 와 같은 값
    // 2026-10-25 사장님 — 슬라이딩 선반 (위 머리 주석)
    SHELF: Object.freeze({
      D_RAIL_MINUS: 10,           // 선반 D = 레일 길이 − 10
      W_RAIL_MINUS: 42,           // 선반 W = 내경 − 42 + 30 — 문주 언더레일 서랍 설치 (가구 내경 − 42 + 측판 15T × 2)
      W_SIDES_PLUS: 30,
      BATTEN_W: 80,               // 레일 부속품 설치 보강목 W (D = 선반 D)
      BATTEN_QTY: 2,
      FRONT_W_MINUS: 5,           // 마이다 W = 내경 − 5
      FRONT_H: 95,
      HINGE_BATTEN_PLUS: 30,      // 추가 목대 W = 레일 길이 + 30 (여닫이 도어일 때만)
      HINGE_BATTEN_H: 100,
      OPEN_MATERIAL: 'MDF',       // 오픈 — 18T MDF (오픈장과 같은 색)
      DOOR_MATERIAL: 'PB',        // 도어 — 몸통 PB · 몸통 두께 (몸통과 같은 색)
    }),
    SHELF_NOTE: '슬라이딩 선반 — 선반 · 보강목 2 · 마이다 (여닫이면 경첩 쪽 추가 목대) · 언더레일 1',
    POCKET_NOTE: '포켓 도어 [확인 필요] 철물',
  });

  const R = RICE_CABINET_RULES;

  /** 이 모듈이 밥솥장인가 — 플래너 구조(s.moduleKind)와 BOM 모듈(mod.moduleKind) 둘 다 같은 값을 쓴다. */
  function isRiceCabinet(o) {
    return !!o && String(o.moduleKind || '') === R.KIND;
  }

  /** 도어 종류 정규화 — 모르는 값·빈 값은 기본(오픈). 옛 표기 'lift' 는 리프트로 읽는다. */
  function doorTypeOf(v) {
    const raw = v && typeof v === 'object' ? (v.rice && v.rice.door) : v;
    const t = raw === 'lift' ? 'liftup' : raw;
    return R.DOOR_TYPES.some((d) => d.id === t) ? t : R.DOOR_DEFAULT;
  }

  function doorNameOf(type) {
    const d = R.DOOR_TYPES.find((x) => x.id === doorTypeOf(type));
    return d ? d.name : '';
  }

  /** 상자 내경 — 오픈장 규칙이 낸다. @param o {W,H,D} 몸통 외경 */
  function innerOf(o) {
    return OC ? OC.innerOf(o) : null;
  }

  /** 도어 한 장 (없으면 null). 가로 w × 세로 h. */
  function doorOf(o, doorType) {
    const t = doorTypeOf(doorType);
    if (t === 'none') return null;
    const W = Math.round(Number(o && o.W) || 0);
    const H = Math.round(Number(o && o.H) || 0);
    const w = W - R.DOOR_GAP;
    const h = H - R.DOOR_GAP;
    if (w <= 0 || h <= 0) return null;
    return { type: t, name: doorNameOf(t), w, h, qty: 1, note: t === 'pocket' ? R.POCKET_NOTE : '' };
  }

  /**
   * 오픈 밥솥장 상자 부재 — 오픈장 부재 그대로 (도어가 달리면 일반 장 몸통이라 추출기가 낸다 — hasDoorBody).
   * @returns {Array<{part,material,t,w,h,qty,edge,note}>}
   */
  function partsOf(o) {
    if (!OC) return [];
    return OC.partsOf(o).map((p) => Object.assign({}, p, { note: '' }));
  }

  /** 도어가 달린 밥솥장인가 — 몸통이 일반 장(PB, 몸통 두께)이다 (2026-10-25 사장님). */
  function hasDoorBody(doorType) {
    return doorTypeOf(doorType) !== 'none';
  }

  /**
   * 슬라이딩 선반 몫의 재질 · 두께 · 내경.
   * @param o        {W,H,D} 몸통 외경
   * @param doorType 도어 종류 (없으면 오픈)
   * @param bodyT    품목 몸통 두께 (도어가 달린 몸통 · 선반 몫 두께 — 기본 15)
   */
  function shelfGeomOf(o, doorType, bodyT) {
    const W = Math.round(Number(o && o.W) || 0);
    const door = hasDoorBody(doorType);
    const t = door ? (Number(bodyT) > 0 ? Number(bodyT) : 15) : (OC ? OC.RULES.T : 18);
    return {
      door, t,
      material: door ? R.SHELF.DOOR_MATERIAL : R.SHELF.OPEN_MATERIAL,
      bodyT: t,                       // 몸통 두께 — 오픈 18T MDF 상자 / 도어 PB 몸통 두께
      innerW: W - 2 * t,
    };
  }

  /**
   * 슬라이딩 선반 부재 — 선반 · 보강목 2 · 마이다 (+ 여닫이면 추가 목대 1). 레일 1 SET 은 철물(extractors.js)이 낸다.
   * @param railLength 언더레일 길이 (서랍과 같은 규칙 — bom-drawer-rules railLengthFor(모듈 깊이))
   * @returns {Array<{part,material,t,w,h,qty,edge,note}>}  w = 가로(폭) · h = 깊이 또는 높이
   */
  function shelfPartsOf(o, doorType, bodyT, railLength) {
    const g = shelfGeomOf(o, doorType, bodyT);
    const L = Number(railLength) || 0;
    const S = R.SHELF;
    if (!(g.innerW > 0) || !(L > 0)) return [];
    const shelfD = L - S.D_RAIL_MINUS;
    const base = { material: g.material, t: g.t, note: '' };
    const out = [
      Object.assign({}, base, { part: '밥솥장 선반', w: g.innerW - S.W_RAIL_MINUS + S.W_SIDES_PLUS, h: shelfD, qty: 1, edge: '1면(전)' }),
      Object.assign({}, base, { part: '밥솥장 보강목', w: S.BATTEN_W, h: shelfD, qty: S.BATTEN_QTY, edge: '-' }),
      Object.assign({}, base, { part: '밥솥장 마이다', w: g.innerW - S.FRONT_W_MINUS, h: S.FRONT_H, qty: 1, edge: '4면' }),
    ];
    if (doorTypeOf(doorType) === 'swing') {
      out.push(Object.assign({}, base, { part: '밥솥장 추가 목대', w: L + S.HINGE_BATTEN_PLUS, h: S.HINGE_BATTEN_H, qty: 1, edge: '-',
        note: '여닫이 — 경첩에 서랍레일이 걸리지 않게 경첩 쪽 측판에' }));
    }
    return out;
  }

  /**
   * 경고 문구.
   * @param o   {W,H,D} 몸통 외경
   * @param ctx {below: 'drawer'|'other'|'none'} 바로 밑에 무엇이 있는가 (모르면 생략 — 검사하지 않는다)
   */
  function warningsOf(o, ctx) {
    const out = [];
    if (!OC) return ['오픈장 규칙 파일을 싣지 못했습니다'];
    OC.warningsOf(o).forEach((t) => out.push(t.replace(/^오픈장/, R.LABEL)));
    const g = OC.innerOf(o);
    if (g.W && g.H && g.D) {
      if (g.innerW < R.MIN_INNER.W) out.push(`${R.LABEL} 내경 폭 ${g.innerW} 가 최소 ${R.MIN_INNER.W} 보다 좁습니다`);
      if (g.innerH < R.MIN_INNER.H) out.push(`${R.LABEL} 내경 높이 ${g.innerH} 가 최소 ${R.MIN_INNER.H} 보다 낮습니다`);
    }
    const below = ctx && ctx.below;
    if (below === 'none') out.push(`${R.LABEL} 밑에 서랍이 없습니다 — 밥솥장 밑에는 무조건 서랍이 들어갑니다`);
    else if (below === 'other') out.push(`${R.LABEL} 바로 밑 모듈이 서랍이 아닙니다 — 밥솥장 밑에는 무조건 서랍이 들어갑니다`);
    return out;
  }

  return { RULES: RICE_CABINET_RULES, isRiceCabinet, doorTypeOf, doorNameOf, innerOf, doorOf, partsOf, warningsOf,
    hasDoorBody, shelfGeomOf, shelfPartsOf };
});
