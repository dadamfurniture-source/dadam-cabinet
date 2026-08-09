// ============================================================
// P1: 플래너 저장 스코프 — planner-scope.js
//
// 배치(mockup-shell)와 구조(mockup-structure)가 **글자 그대로 같은 코드**를
// 각자 갖고 있던 것을 하나로 모았다. 두 단계가 같은 키를 봐야 배치가 이어진다.
//
// 왜 스코프가 필요한가 (CD-3):
//   예전엔 키가 전역 단일('dadam_layout_v1')이라 품목이 2개 이상이면 서로의 배치를
//   덮어썼다. 품목 A 에서 그린 배치가 B 에도 보이고, 각각 BOM 을 산출하면
//   같은 자재가 두 번 잡혀 **발주량이 2배**가 됐다.
//
// 부모(detaildesign)가 iframe URL 로 ?design=&item= 을 넘긴다.
// 파라미터가 없으면(플래너를 단독으로 열어본 경우) 예전 키를 그대로 써서
// 기존에 저장해둔 배치가 사라지지 않게 한다.
//
// ⚠ 클래식 스크립트라 최상위 const 가 **전역 렉시컬 스코프**에 들어간다.
//   두 HTML 의 인라인에서 같은 이름을 다시 선언하면 SyntaxError 로
//   그 인라인 스크립트 전체가 죽어 흰 화면이 된다. 추출과 원본 삭제는 같은 커밋에.
//
// 브라우저: 전역 노출 (인라인 스크립트보다 먼저 로드)
// Jest:     module.exports 이중 노출 (__tests__/planner-scope-persist.test.js)
// ============================================================

/** 스코프 접미사. `::{design}:{item}` 또는 빈 문자열(레거시 전역 키). */
const PLANNER_SCOPE = (function () {
  try {
    const q = new URLSearchParams(location.search);
    const design = q.get('design') || '';
    const item = q.get('item') || '';
    if (!design && !item) return '';
    return `::${design || 'local'}:${item || '0'}`;
  } catch (e) {
    return '';
  }
})();

/** 스코프가 붙은 저장 키. 스코프가 없으면 예전 키 그대로. */
function scopedKey(base) {
  return base + PLANNER_SCOPE;
}

/** 플래너가 쓰는 저장 키 3종. 두 단계가 반드시 같은 값을 봐야 한다. */
const PLANNER_LAYOUT_KEY = scopedKey('dadam_layout_v1');
const PLANNER_STRUCTURE_KEY = scopedKey('dadam_structure_v1');
const PLANNER_ORIGIN_KEY = scopedKey('dadam_origin_v1');

/**
 * 스코프 도입 전에 저장해둔 배치를 **한 번만** 첫 스코프로 옮긴다.
 *
 * 안 옮기면 기존 사용자에겐 작업하던 배치가 사라진 것처럼 보이고,
 * 모든 스코프에 복사하면 예전의 중복 산출(자재 2배) 문제가 그대로 재현된다.
 * 그래서 마커 키로 딱 한 번만 이관한다.
 */
function migrateLegacyScope() {
  if (!PLANNER_SCOPE) return false;
  const MARK = 'dadam_scope_migrated_v1';
  try {
    if (localStorage.getItem(MARK)) return false;
    let moved = false;
    ['dadam_layout_v1', 'dadam_origin_v1', 'dadam_structure_v1'].forEach((base) => {
      const legacy = localStorage.getItem(base);
      if (legacy && !localStorage.getItem(base + PLANNER_SCOPE)) {
        localStorage.setItem(base + PLANNER_SCOPE, legacy);
        moved = true;
      }
    });
    if (moved) localStorage.setItem(MARK, new Date().toISOString());
    return moved;
  } catch (e) {
    return false;
  }
}

// 로드 시점에 1회 실행 — 두 페이지 중 먼저 열리는 쪽이 이관한다.
migrateLegacyScope();

if (typeof window !== 'undefined') {
  window.PLANNER_SCOPE = PLANNER_SCOPE;
  window.scopedKey = scopedKey;
  window.PLANNER_LAYOUT_KEY = PLANNER_LAYOUT_KEY;
  window.PLANNER_STRUCTURE_KEY = PLANNER_STRUCTURE_KEY;
  window.PLANNER_ORIGIN_KEY = PLANNER_ORIGIN_KEY;
  window.migrateLegacyScope = migrateLegacyScope;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_SCOPE,
    scopedKey,
    PLANNER_LAYOUT_KEY,
    PLANNER_STRUCTURE_KEY,
    PLANNER_ORIGIN_KEY,
    migrateLegacyScope,
  };
}
