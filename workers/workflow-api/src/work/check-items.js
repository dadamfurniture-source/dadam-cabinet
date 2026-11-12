/**
 * 작업자 필수 확인 목록 — 정본 (2026-11-04 사장님 「작업자들에게 필수 확인사항도 포함」, 승인 계획 2 · 3-3)
 *
 * 종이 작업지시서(templates/work-order.js 재단 꾸러미 원장 · 주문 확인 · ⑥ 조립 순서 체크, templates/installation-order.js 확인 · 서명 칸)와
 * 작업자 포털의 체크(work/checks.js)가 이 목록 하나를 쓴다. 표는 docs/design-rules/work-checks.md 와 같다 (시험이 대조한다).
 * 발행 때 documents.js 가 render_payload.check_list 에 그 판을 고정한다 — 판이 올라가도 이미 낸 문서는 낸 때 목록 그대로.
 * check_list 가 없는 옛 문서는 v0 (그때 인쇄된 것).
 *
 *   v0 = 이 정본 전에 종이에 인쇄되던 체크 그대로.
 *   v1 = 2026-11-04 12:14 사장님 확정 (추천안 https://claude.ai/artifact/7iRm4orYo2dQS496We24oW — 추천 항목 전부 넣음,
 *        필수 · 사진은 추천 그대로) + 정할 것 셋: 필수가 남으면 완료 기록을 막는다(block 'must') · 엣지 항목은 재단 기사 목록에
 *        (엣지 역할 칸 없음) · 사진은 「사진 필수」 항목만 받는다.
 *   v2 = 2026-11-06 사장님 확정 (작업지시서 마무리 「여러 날 걸리는 주문」 → 주문 끝 「완료」를 따로 둠): v1 + 주문 끝 항목 둘
 *        (재단 「이 주문 재단 · 엣지 끝」 · 조립 「이 주문 조립 끝」, finish). 공장 하루 기록은 막지 않고, 필수가 남으면
 *        주문 끝 항목 체크와 설치 · 조립 작업 완료 보고를 막는다.
 *   범위 scope: sheet (원장마다 — 재단 배치 원장 no) · module (모듈마다 — 품목 i · 모듈 j) · order (주문에 한 번).
 *   when: door (도어 있는 모듈만) · drawer (서랍 있는 모듈만) — 종이의 「—」 칸과 같다.
 *         confirm (지시서 BOM 에 [확인 필요]가 있을 때만) · outlet (콘센트를 넣은 하부장이 있을 때만 — 부자재 「전기」).
 *   at: start (주문 시작 전) · end (주문 끝) — 주문 범위 항목을 종이에 나눠 적을 때.
 *   paper: sign — 종이에서는 서명 칸으로 (시공 지시서 「설치 담당 · 검수 · 고객 확인」).
 *   must: 필수 · photo: none | opt | need. short = 종이 칸 머리 (긴 이름이 칸에 안 들어갈 때).
 *   finish: 주문 끝 항목 — 그 역할의 필수를 다 체크해야 체크된다 (work/checks.js). 필수 수에는 들지 않는다.
 * 항목 키는 DB 0035 work_checks.item_key 모양(소문자 · 숫자 · -)을 따른다.
 */

export const CHECK_ROLES = Object.freeze(['cut', 'edge', 'assembly', 'install']);
export const CHECK_SCOPES = Object.freeze(['sheet', 'module', 'order']);
export const CHECK_ROLE_LABEL = Object.freeze({ cut: '재단', edge: '엣지', assembly: '조립', install: '설치' });

const item = (key, label, scope, extra) => Object.freeze(Object.assign({ key, label, short: label, scope, must: true, photo: 'none' }, extra || {}));
const list = (block, roles) => Object.freeze(Object.assign({ block }, Object.fromEntries(Object.entries(roles).map(([r, xs]) => [r, Object.freeze(xs)]))));

/** v1 항목 — v2 가 이어 쓴다 */
const V1 = {
  cut: [
    item('cut-order-material', '원장 자재 · 두께 · 색이 지시서와 같다', 'order', { at: 'start', photo: 'opt' }),
    item('edge-order-thickness', '엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6', 'order', { at: 'start' }),
    item('edge-order-color', '엣지 색이 판 색과 같다', 'order', { at: 'start', photo: 'opt' }),
    item('cut-sheet-cut', '재단', 'sheet'),
    item('cut-sheet-edgemark', '엣지 표시 (붙일 면)', 'sheet', { short: '엣지 표시' }),
    item('cut-sheet-label', '조각마다 부재 라벨을 붙였다', 'sheet', { short: '라벨' }),
    item('cut-sheet-grain', '↻ 표시 없는 결 판 조각은 돌리지 않았다', 'sheet', { short: '결', must: false }),
    item('edge-sheet-mark', '엣지 표시대로 붙였다', 'sheet', { short: '엣지 붙임' }),
    item('cut-order-small', '소부품(한 변 70 이하)을 잔재에서 뽑았다', 'order', { at: 'end' }),
    item('edge-order-finish', '끝 마감 · 들뜸 없음', 'order', { at: 'end', photo: 'opt' }),
    item('cut-order-offcut', '쓸 만한 잔재에 크기를 적어 보관', 'order', { at: 'end', must: false }),
  ],
  edge: [],
  assembly: [
    item('asm-module-kit', '키팅 — 모듈 부재 · 부자재가 다 있다', 'module', { short: '키팅' }),
    item('asm-module-cut', '재단', 'module'),
    item('asm-module-edge', '엣지', 'module'),
    item('asm-module-build', '조립', 'module'),
    item('asm-module-hinge', '경첩 자리 = 지시서 보링 자리 (받은 도어 확인)', 'module', { short: '경첩 자리', when: 'door' }),
    item('asm-module-door', '도어 달기', 'module', { when: 'door' }),
    item('asm-module-drawer', '서랍', 'module', { when: 'drawer' }),
    item('asm-module-gap', '도어 · 서랍 간격 · 높이 맞춤', 'module', { short: '간격 · 높이' }),
    item('asm-module-pack', '검수·포장', 'module'),
    item('asm-module-photo', '포장 전 정면 사진', 'module', { short: '사진', must: false, photo: 'need' }),
    item('asm-order-confirm', '[확인 필요] 줄은 담당자에게 물어 답을 받았다', 'order', { when: 'confirm' }),
  ],
  install: [
    item('inst-order-arrive', '반입 전 모듈 수 · 파손 확인', 'order', { photo: 'opt' }),
    item('inst-order-level', '수평 · 벽 고정', 'order'),
    item('inst-order-adjust', '도어 · 서랍 조정', 'order'),
    item('inst-order-trim', '상판 · 걸레받이 · 몰딩 · 마감재 마감', 'order'),
    item('inst-order-outlet', '콘센트 타공 자리', 'order', { must: false, when: 'outlet' }),
    item('inst-order-photo', '완료 사진 (정면)', 'order', { photo: 'need' }),
    item('inst-order-sign', '설치 담당', 'order', { paper: 'sign' }),
    item('inst-order-inspect', '검수', 'order', { paper: 'sign' }),
    item('inst-order-customer', '고객 확인', 'order', { paper: 'sign' }),
  ],
};

export const CHECK_LISTS = Object.freeze({
  v0: list('none', {
    cut: [
      item('cut-sheet-cut', '재단', 'sheet'),
      item('cut-sheet-edgemark', '엣지 표시', 'sheet'),
    ],
    edge: [],
    assembly: [
      item('asm-module-cut', '재단', 'module'),
      item('asm-module-edge', '엣지', 'module'),
      item('asm-module-build', '조립', 'module'),
      item('asm-module-door', '도어 달기', 'module', { when: 'door' }),
      item('asm-module-drawer', '서랍', 'module', { when: 'drawer' }),
      item('asm-module-pack', '검수·포장', 'module'),
    ],
    install: [
      item('inst-order-sign', '설치 담당', 'order', { paper: 'sign' }),
      item('inst-order-inspect', '검수', 'order', { paper: 'sign' }),
      item('inst-order-customer', '고객 확인', 'order', { paper: 'sign' }),
    ],
  }),
  v1: list('must', V1),
  v2: list('must', Object.assign({}, V1, {
    cut: V1.cut.concat([item('cut-order-done', '이 주문 재단 · 엣지 끝', 'order', { at: 'end', must: false, finish: true, short: '재단 끝' })]),
    assembly: V1.assembly.concat([item('asm-order-done', '이 주문 조립 끝', 'order', { at: 'end', must: false, finish: true, short: '조립 끝' })]),
  })),
});

/** 새로 발행하는 문서에 고정하는 판 */
export const CHECK_LIST_VERSION = 'v2';

/** 문서에 고정하는 모양 — { version, block, roles: { cut: [...], … } } (얕은 복사, 판 자체는 얼어 있다) */
export function frozenCheckList(version = CHECK_LIST_VERSION) {
  const roles = CHECK_LISTS[version];
  if (!roles) throw new Error(`모르는 확인 목록 판: ${version}`);
  return { version, block: roles.block, roles: Object.fromEntries(CHECK_ROLES.map((r) => [r, roles[r].map((x) => ({ ...x }))])) };
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

/** 동결본 BOM 줄 · 부자재 (bom_payload.hardware 또는 hardware_payload.hardware) */
function snapshotRows(snapshot) {
  const bom = (snapshot && snapshot.bom_payload) || {};
  const materials = Array.isArray(bom.materials) ? bom.materials : [];
  const hw = Array.isArray(bom.hardware) ? bom.hardware : (snapshot && snapshot.hardware_payload && Array.isArray(snapshot.hardware_payload.hardware) ? snapshot.hardware_payload.hardware : []);
  return { materials, hardware: hw };
}

/**
 * 칸에 해당하는가 — 도어 · 서랍 (모듈), [확인 필요] · 콘센트 (동결본).
 * @param {object} it      항목
 * @param {object} [module] 모듈 범위 칸의 모듈
 * @param {object} [snapshot] 동결본 (confirm · outlet)
 */
export function itemApplies(it, module, snapshot) {
  if (!it || !it.when) return true;
  if (it.when === 'door') return Number(module && module.doorCount) > 0;
  if (it.when === 'drawer') return Boolean(module && module.isDrawer);
  if (it.when === 'confirm') {
    const { materials, hardware } = snapshotRows(snapshot);
    return materials.concat(hardware).some((r) => /확인 필요/.test(String((r && r.note) || '')));
  }
  if (it.when === 'outlet') return snapshotRows(snapshot).hardware.some((h) => h && h.category === '전기');
  return true;
}
