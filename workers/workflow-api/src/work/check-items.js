/**
 * 작업자 필수 확인 목록 — 정본 (2026-11-04 사장님 「작업자들에게 필수 확인사항도 포함」, 승인 계획 2 · 3-3)
 *
 * 종이 작업지시서(templates/work-order.js 재단 꾸러미 원장 · ⑥ 조립 순서 체크, templates/installation-order.js 서명 칸)와
 * 작업자 포털의 체크(다음 PR)가 이 목록 하나를 쓴다. 표는 docs/design-rules/work-checks.md 와 같다 (시험이 대조한다).
 * 발행 때 documents.js 가 render_payload.check_list 에 그 판을 고정한다 — 판이 올라가도 이미 낸 문서는 낸 때 목록 그대로.
 * check_list 가 없는 옛 문서는 v0 (그때 인쇄된 것).
 *
 *   v0 = 지금 종이에 인쇄되는 체크 그대로. v1 = 사장님이 확정한 추천안 — 확정 전이라 아직 없다.
 *   범위 scope: sheet (원장마다 — 재단 배치 원장 no) · module (모듈마다 — 품목 i · 모듈 j) · order (주문에 한 번).
 *   when: door (도어 있는 모듈만) · drawer (서랍 있는 모듈만) — 종이의 「—」 칸과 같다.
 *   must: 필수 · photo: none | opt | need — v0 은 종이 칸이라 모두 필수 · 사진 없음.
 * 항목 키는 DB 0035 work_checks.item_key 모양(소문자 · 숫자 · -)을 따른다.
 */

export const CHECK_ROLES = Object.freeze(['cut', 'edge', 'assembly', 'install']);
export const CHECK_SCOPES = Object.freeze(['sheet', 'module', 'order']);
export const CHECK_ROLE_LABEL = Object.freeze({ cut: '재단', edge: '엣지', assembly: '조립', install: '설치' });

const item = (key, label, scope, extra) => Object.freeze(Object.assign({ key, label, scope, must: true, photo: 'none' }, extra || {}));

export const CHECK_LISTS = Object.freeze({
  v0: Object.freeze({
    cut: Object.freeze([
      item('cut-sheet-cut', '재단', 'sheet'),
      item('cut-sheet-edgemark', '엣지 표시', 'sheet'),
    ]),
    edge: Object.freeze([]),
    assembly: Object.freeze([
      item('asm-module-cut', '재단', 'module'),
      item('asm-module-edge', '엣지', 'module'),
      item('asm-module-build', '조립', 'module'),
      item('asm-module-door', '도어 달기', 'module', { when: 'door' }),
      item('asm-module-drawer', '서랍', 'module', { when: 'drawer' }),
      item('asm-module-pack', '검수·포장', 'module'),
    ]),
    install: Object.freeze([
      item('inst-order-sign', '설치 담당', 'order'),
      item('inst-order-inspect', '검수', 'order'),
      item('inst-order-customer', '고객 확인', 'order'),
    ]),
  }),
});

/** 새로 발행하는 문서에 고정하는 판 */
export const CHECK_LIST_VERSION = 'v0';

/** 문서에 고정하는 모양 — { version, roles: { cut: [...], … } } (얕은 복사, 판 자체는 얼어 있다) */
export function frozenCheckList(version = CHECK_LIST_VERSION) {
  const roles = CHECK_LISTS[version];
  if (!roles) throw new Error(`모르는 확인 목록 판: ${version}`);
  return { version, roles: Object.fromEntries(CHECK_ROLES.map((r) => [r, roles[r].map((x) => ({ ...x }))])) };
}

/** 문서가 고정한 목록 — 없으면(옛 문서) v0 */
export function checkListOfDoc(doc) {
  const cl = doc && doc.render_payload && doc.render_payload.check_list;
  return cl && cl.roles && typeof cl.version === 'string' ? cl : frozenCheckList('v0');
}

/** 한 역할 · 범위의 항목 */
export function itemsFor(list, role, scope) {
  const roles = (list && list.roles) || {};
  return (Array.isArray(roles[role]) ? roles[role] : []).filter((x) => !scope || x.scope === scope);
}

/** 모듈 칸에 해당하는가 — 도어 · 서랍 조건 (종이의 「—」) */
export function itemApplies(it, module) {
  if (!it || !it.when) return true;
  if (it.when === 'door') return Number(module && module.doorCount) > 0;
  if (it.when === 'drawer') return Boolean(module && module.isDrawer);
  return true;
}
