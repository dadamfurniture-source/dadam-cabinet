/**
 * 밥솥장 규칙 (사장님 확정, 프로젝트 메모리 결정 8).
 *
 *   오픈장 + 슬라이딩 선반 · 도어 여닫이 · 포켓 · 리프트 · 최소 내경 W305 × H400 · 기본 외경 W450 × H500 ·
 *   밑에 무조건 서랍.
 *
 * 모듈 타입이다 (오픈장과 같은 자리 — 구조 s.moduleKind, BOM 모듈 mod.moduleKind).
 * 상자는 **오픈장 규칙 그대로**다 (js/detaildesign/bom-open-cabinet-rules.js — 18T MDF 측판 2 · 천지판 2 · 뒷판 1).
 * 여기서 숫자를 다시 적지 않고 그 파일의 innerOf · partsOf 를 부른다.
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
 *   슬라이딩 선반 판 치수 · 레일 규격, 포켓 도어 철물 — 코드·문서에 값이 없다. 부재로 내지 않고 비고에만 적는다.
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
    SHELF_NOTE: '슬라이딩 선반 [확인 필요] 선반 판 치수 · 레일 규격',
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
   * 상자 부재 — 오픈장 부재 그대로. 슬라이딩 선반은 치수가 정해지지 않아 지판(천지판) 비고로만 남긴다.
   * @returns {Array<{part,material,t,w,h,qty,edge,note}>}
   */
  function partsOf(o) {
    if (!OC) return [];
    return OC.partsOf(o).map((p) => Object.assign({}, p, { note: p.part === '천지판' ? R.SHELF_NOTE : '' }));
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

  return { RULES: RICE_CABINET_RULES, isRiceCabinet, doorTypeOf, doorNameOf, innerOf, doorOf, partsOf, warningsOf };
});
