/**
 * EL장 모듈 타입 — 2026-10-20 사장님 카드 "모듈 타입으로" (홈카페장과 같이).
 *
 * 예전 냉장고장 화면에서 EL장은 키큰장 중간장 안의 칸(전동수납)이고, 정해진 것은 **도어 종류**뿐이다
 * (data-constants.js EL_DOOR_TYPES · fridge.md §7). 부재는 fridge.md §11 "EL장은 뒷판만 있는 간소 구조" 한 줄과
 * extractFridge 의 'el' 가지(PB 측판·천판·지판 + 뒷판, 도어 없음)뿐이라 BOM 도 그 몸통만 낸다.
 * 몸통·도어 치수 규칙은 문서에 없다 — 지어내지 않고 측판 비고에 [확인 필요] 를 단다 (사장님 카드: "도어 종류만, 치수는 [확인 필요]").
 *
 * 이 파일은 표시값과 도어 종류 목록만 갖는다. 몸통 부재는 extractors.js 가 extractFridge 'el' 과 같은 식으로 낸다.
 * 브라우저 전역 `DadamElRules`, Node(Jest) module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamElRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EL_RULES = Object.freeze({
    KIND: 'el',
    LABEL: 'EL장',
    // data-constants.js EL_DOOR_TYPES 와 같은 id·이름 (플래너 iframe 은 data-constants 를 싣지 않아 여기 옮겨 둔다)
    DOOR_TYPES: Object.freeze([
      Object.freeze({ id: 'liftup', name: '리프트업' }),
      Object.freeze({ id: 'flap', name: '플랩도어' }),
      Object.freeze({ id: 'pocket', name: '포켓도어' }),
      Object.freeze({ id: 'swing', name: '여닫이' }),
      Object.freeze({ id: 'sliding', name: '슬라이딩' }),
    ]),
    NOTE: '[확인 필요] EL장 몸통·도어 치수',
  });

  /** 이 모듈이 (플래너) EL장인가 — 구조(s.moduleKind)·BOM 모듈(mod.moduleKind) 같은 값. */
  function isEl(o) {
    return !!o && String(o.moduleKind || '') === EL_RULES.KIND;
  }

  /** 구조에 저장된 도어 종류 id — 목록에 없으면 null (고르지 않음). */
  function doorTypeOf(s) {
    const id = s && s.el && s.el.door;
    return EL_RULES.DOOR_TYPES.some((d) => d.id === id) ? id : null;
  }

  function doorTypeName(id) {
    const d = EL_RULES.DOOR_TYPES.find((x) => x.id === id);
    return d ? d.name : '';
  }

  return { RULES: EL_RULES, isEl, doorTypeOf, doorTypeName };
});
