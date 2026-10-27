/**
 * 설비장 규칙 — 개수대 · 가스대 · 후드장 (2026-10-26 사장님 확정).
 *
 * 설비(싱크볼 · 수전 · 쿡탑 · 후드)가 들어가는 장이다. 몸통은 보통 하부장 · 상부장 짜임 그대로이고, 아래만 다르다.
 * 구조(structures) `s.fixture` · BOM 모듈 `mod.fixture` 로 알아본다 (모듈 타입 moduleKind 와 다른 축 — 도어 · 서랍 칸은 셀 규칙 그대로).
 * 예전 상세설계 화면의 type 'sink' · 'cook' · 'hood' 와도 다르다: 그쪽 'cook' · 'hood' 는 몸통 없는 자리라 BOM 에서 빠진다 (sink.md §4).
 *
 *   개수대 (fixture 'sink')     하부장 · 2도어 · 선반 없음 (sink.md §9 "싱크 제외") · 싱크볼 · 수전 (그림)
 *   가스대 (fixture 'cooktop')  하부장 · 서랍 2:2 (위 칸도 서랍) · 상판 위 쿡탑 — 인덕션 · 가스레인지 (그림)
 *       위 칸   맨 위에 속서랍 (박스 60 · 사쿠리 없음 · 댐핑 볼레일, 앞판 없음) + 그 아래 소서랍 (소 75 · 댐핑 볼레일) — 위 마이다는 소서랍에 달린다
 *       아래 칸 서랍 (댐핑 언더레일 — 들어가는 가장 큰 박스, 서랍장 규칙 그대로)
 *   후드장 (fixture 'hood')     상부장 · 2도어 또는 플랩 · 선반 없음 (덕트 자리) ·
 *       몸통 · 도어 = 상부장 − 60 (윗선은 이웃 상부장과 같다 — 밑이 60 올라간다). 그 60 자리에 후드 50 이 도어 바로 밑에 붙고 아래 10 이 남는다.
 *       상부장 높이는 후드 종류에 따라 정해진다 — 지금 60 · 50 은 기준값이다 (사장님 "지금은 기준값으로").
 *   양념망장 (fixture 'spice')  하부장 200 · 300 (2026-10-27 사장님) · 앞판이 양념망 철물에 달려 앞으로 당겨 나오는 풀아웃 —
 *       경첩 없음 · 재단은 도어와 같다 (W − 4) × (H − 30) · 보통 하부장 몸통 (밴드 눕힘 그대로) · 선반 없음 ·
 *       양념망 철물 1 SET — 품명 · 규격은 정해지지 않았다 [확인 필요] (사장님 "나중에 정합니다"). 폭은 철물이 정한다.
 *
 * ── 밴드 (개수대 · 가스대, 2026-10-26 사장님) ─────────────────
 *   보통 하부장은 밴드 70 두 장이 상단 앞 · 뒤에 눕는다 (sink.md §9 "뒤 눕힘").
 *   개수대 · 가스대는 **앞 밴드 50 눕힘** (자리는 보통 앞 밴드와 같다 — 목찬넬이면 지면판 바로 아래) ·
 *   **뒤 밴드 70 은 뒤끝에 세운다** (70 이 높이 방향, 윗면 = 몸통 상단, 뒷면 = 측판 뒤끝). 두께는 몸통 T, 길이는 W − 2T.
 *
 * 순수 값 · 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamFixtureCabinetRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js) · 브리지(ui-step1.js) · 조립 명세(bom-assembly.js) · 모듈 라이브러리가 같은 이 파일을 읽는다.
 *
 * ── 정해지지 않은 것 [확인 필요] ───────────────────────
 *   싱크볼 · 쿡탑 타공 치수 — 상판 업체 몫. 부재로 내지 않는다.
 *   후드 종류별 상부장 높이 — 지금은 기준값 하나 (HOOD.CUT 60 · HOOD.APPLIANCE_H 50).
 *   양념망 철물 품명 · 규격 — 철물 행 비고에 [확인 필요] (SPICE.HARDWARE).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamFixtureCabinetRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIXTURE_CABINET_RULES = Object.freeze({
    FIXTURES: Object.freeze(['sink', 'cooktop', 'hood', 'spice']),
    LABEL: Object.freeze({ sink: '개수대', cooktop: '가스대', hood: '후드장', spice: '양념망장' }),
    // 설비가 서는 줄 — 개수대 · 가스대 · 양념망장은 하부, 후드장은 상부
    POS: Object.freeze({ sink: 'lower', cooktop: 'lower', hood: 'upper', spice: 'lower' }),
    // 개수대 · 가스대 밴드 — 앞 50 눕힘 · 뒤는 보통 밴드 폭(assembly-rules CARCASS.BAND_W 70)을 세운다
    BAND: Object.freeze({ FRONT_W: 50, BACK: 'stand' }),
    // 쿡탑 종류 (그림 · 표시) — 상판 위에 놓인다
    COOKTOPS: Object.freeze(['induction', 'gas']),
    COOKTOP_LABEL: Object.freeze({ induction: '인덕션', gas: '가스레인지' }),
    // 가스대 서랍 — 서랍 2:2 · 위 칸도 서랍 (구조 drawer.ratio · topDrawer) · 칸마다 레일 · 박스 · 속서랍 (위 → 아래)
    //   fronts[i]  rail 그 칸 박스 레일 · box 박스 크기 고정 (bom-drawer-rules BOX_H 키) · inner 그 칸 맨 위 속서랍
    //   inner      h 박스 높이 · sakuri 측판 사쿠리 · rail 레일 — 앞판이 없다 (위 칸 마이다는 그 아래 소서랍에 달린다)
    COOKTOP_DRAWER: Object.freeze({
      RATIO: '2:2',
      FRONTS: Object.freeze([
        Object.freeze({ rail: 'ball', box: 'small', inner: Object.freeze({ h: 60, sakuri: false, rail: 'ball' }) }),
        Object.freeze({ rail: 'under' }),
      ]),
    }),
    // 후드장 — 몸통 · 도어를 이만큼 짧게 (윗선 고정, 밑이 올라간다). 그 자리에 후드 APPLIANCE_H 가 도어 바로 밑에 붙는다
    HOOD: Object.freeze({ CUT: 60, APPLIANCE_H: 50 }),
    // 양념망장 — 앞판은 철물에 달린 풀아웃 (BOM 도어 종류 'pullout' — 경첩 대신 이 철물 1 SET)
    SPICE: Object.freeze({
      DOOR_TYPE: 'pullout',
      HARDWARE: Object.freeze({ category: '양념망', item: '양념망 (풀아웃)', unit: 'SET', qty: 1 }),
      FRONT_NOTE: '양념망 앞판 — 풀아웃 (경첩 없음)',
    }),
    // 선반 — 개수대 · 후드장 · 양념망장은 없다 (가스대는 전부 서랍이라 선반이 없다)
    NO_SHELF: Object.freeze(['sink', 'hood', 'spice']),
  });

  const R = FIXTURE_CABINET_RULES;

  /** 구조 · BOM 모듈의 설비 — 모르는 값이면 null. */
  function fixtureOf(x) {
    const f = x && x.fixture;
    return R.FIXTURES.indexOf(f) >= 0 ? f : null;
  }

  /** 쿡탑 종류 — 모르는 값이면 null. */
  function cooktopOf(x) {
    const c = x && x.cooktop;
    return R.COOKTOPS.indexOf(c) >= 0 ? c : null;
  }

  /** 개수대 · 가스대 — 앞 밴드 50 눕힘 · 뒤 밴드 세움 */
  function hasStandingBackBand(x) {
    const f = fixtureOf(x);
    return f === 'sink' || f === 'cooktop';
  }

  /** 선반을 내지 않는 설비 (개수대 · 후드장) */
  function noShelf(x) {
    return R.NO_SHELF.indexOf(fixtureOf(x)) >= 0;
  }

  /** 후드장이면 몸통에서 뺄 높이 (아니면 0) */
  function heightCutOf(x) {
    return fixtureOf(x) === 'hood' ? R.HOOD.CUT : 0;
  }

  /** 여닫이가 아닌 앞판 종류 — 양념망장 'pullout' (아니면 null) */
  function doorTypeOf(x) {
    return fixtureOf(x) === 'spice' ? R.SPICE.DOOR_TYPE : null;
  }

  return { FIXTURE_CABINET_RULES, fixtureOf, cooktopOf, hasStandingBackBand, noShelf, heightCutOf, doorTypeOf };
});
