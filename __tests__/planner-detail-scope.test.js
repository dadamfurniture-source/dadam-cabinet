/**
 * D4: 디테일 **선택 범위** — 배치·모듈·품목을 고르면 그 범위 전체가 칠해진다.
 *
 *   · 3D 배치 상자를 누르면 그 배치가 범위가 되고, 좌측 목록이 '배치' 로 따라온다
 *   · 그 다음 색을 고르면 **배치 안 모듈마다 module 단계**로 적힌다 (모델에 배치 단계를 만들지 않는다 —
 *     js/detaildesign/extractors.js 가 같은 4단계를 한 벌 더 갖고 있어서다. planner-detail.js 머리 참고)
 *   · 범위를 칠하면 그 안의 아래 단계 지정을 지운다 (모듈/배치 → 부재, 품목 → 모듈·섹션·부재).
 *     안 지우면 아래 단계가 이겨서 "전체가 칠해졌다" 가 거짓말이 된다
 *   · 어느 슬롯이 실제로 있는지는 3D mesh 에서 읽는다 — 상판이 없는 모듈에 top 을 적지 않는다
 *   · 한 범위 = 되돌리기 한 장
 *   · 팔레트는 우측 패널, 좌측은 구조 단계와 같은 전체/배치/개별 목록
 *
 * jsdom 에는 three 가 없으므로 3D 는 가짜 group 으로 흉내 낸다 (planner-detail-mode.test.js 와 같은 방식).
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SCOPE = '::gold:1';
const KEY = 'dadam_detail_v1' + SCOPE;

/**
 * 배치 하나에 모듈이 여럿인 설계. 골든 픽스처(straight)의 배치를 그대로 쓰되,
 * `area-lower-2`(W1400) 안에 모듈 셋을 넣는다 — "배치 전체" 가 여러 모듈로 펼쳐지는 것을 보려면 필요하다.
 */
const MODULES = [
  { id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0,    y: 0, rotation: 0, areaId: 'area-lower-0', finishings: [] },
  { id: 'lower-1', section: 'lower', W: 500,  H: 870, D: 650, x: 2200, y: 0, rotation: 0, areaId: 'area-lower-2', finishings: [] },
  { id: 'lower-2', section: 'lower', W: 500,  H: 870, D: 650, x: 2700, y: 0, rotation: 0, areaId: 'area-lower-2', finishings: [] },
  { id: 'lower-3', section: 'lower', W: 400,  H: 870, D: 650, x: 3200, y: 0, rotation: 0, areaId: 'area-lower-2', finishings: [] },
  { id: 'upper-4', section: 'upper', W: 1800, H: 780, D: 320, x: 0,    y: 0, rotation: 0, areaId: 'area-upper-3', finishings: [] },
];

const AREA = 'area-lower-2';
const IN_AREA = ['lower-1', 'lower-2', 'lower-3'];

function boot(opt = {}) {
  const seed = seedFor(FIXTURES.straight);
  const search = seed._search + (opt.structure ? '' : '&stage=detail');
  delete seed._search;
  seed['dadam_struct_modules_v1' + SCOPE] = JSON.stringify(MODULES);
  Object.assign(seed, opt.storage || {});
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.PD = p.window.PlannerDetail;
  withFake3D(p);
  return p;
}

/** raycast 가 집은 것처럼 보이는 mesh (클릭용 — isMesh 는 필요 없다). */
const hit = (ud) => ({ userData: ud, parent: null });
/** 씬에 실제로 있는 mesh (범위 슬롯을 읽을 때 쓴다). */
const sceneMesh = (ud) => ({ isMesh: true, userData: ud, parent: null, material: { color: { set() {} } } });

const doorUd = (moduleId, areaIdx = 0) =>
  ({ entityKind: 'carcass', side: 'front', areaType: 'door', moduleId, areaIdx, areaPos: 'top' });
const drawerUd = (moduleId, areaIdx = 0) =>
  ({ entityKind: 'carcass', side: 'front', areaType: 'drawer', moduleId, areaIdx, areaPos: 'top' });

/**
 * 가짜 3D. 모듈마다 **다른 부재 구성**을 준다 — 상판이 없는 모듈에 top 이 적히지 않는 것을 보려면 필요하다.
 *   lower-0 도어·몸통          (범위 밖)
 *   lower-1 도어·몸통·상판
 *   lower-2 도어·몸통
 *   lower-3 서랍 앞판·몸통
 *   upper-4 도어·몸통
 * doorEdge·area 는 PLANNER_FINISH_PAINT_SKIP 이라 슬롯을 내지 않는다.
 */
function withFake3D(p) {
  const children = [
    sceneMesh(doorUd('lower-0', 0)), sceneMesh({ entityKind: 'carcass', side: 'left', moduleId: 'lower-0' }),
    sceneMesh(doorUd('lower-1', 0)), sceneMesh({ entityKind: 'carcass', side: 'left', moduleId: 'lower-1' }),
    sceneMesh({ entityKind: 'top-panel', moduleId: 'lower-1' }),
    sceneMesh(doorUd('lower-2', 0)), sceneMesh({ entityKind: 'carcass', side: 'left', moduleId: 'lower-2' }),
    sceneMesh(drawerUd('lower-3', 0)), sceneMesh({ entityKind: 'carcass', side: 'left', moduleId: 'lower-3' }),
    sceneMesh(doorUd('upper-4', 0)), sceneMesh({ entityKind: 'carcass', side: 'left', moduleId: 'upper-4' }),
    sceneMesh({ entityKind: 'doorEdge', moduleId: 'lower-1' }),          // 칠하지 않는 종류
    sceneMesh({ entityKind: 'area', areaId: AREA }),                     // 배치 상자
  ];
  const moduleGroup = { children, traverse(fn) { children.forEach(fn); } };
  p.PD._o.three = () => ({ moduleGroup });
  return moduleGroup;
}

/** 좌측 목록이 지금 보고 있는 모드 — `let viewMode` 는 부팅 시점 사본이라 DOM 에서 읽는다. */
function listMode(p) {
  const on = p.document.querySelector('.ml-mode-toggle button.active');
  return on ? on.dataset.mode : null;
}
const slotsOf = (p, id) => Object.keys(p.PD.detail.modules[id] || {}).sort();

// ────────────────────────────────────────────────────────────
describe('범위 고르기', () => {
  test('3D 배치 상자를 누르면 그 배치가 범위가 되고 좌측 목록이 배치로 따라온다 — 칠하지는 않는다', () => {
    const p = boot();
    expect(listMode(p)).toBe('single');
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    expect(p.PD.scope).toBe('area');
    expect(p.PD.areaId).toBe(AREA);
    expect(listMode(p)).toBe('area');
    expect(p.g('areaById')(AREA).id).toBe(AREA);
    // 구조 단계의 배치 선택과 **같은 것**이다 — 노란 윤곽선(areaIsPicked)이 따라온다
    expect(p.g('areaIsPicked')(p.g('areaById')(AREA))).toBe(true);
    // 목록은 그 배치의 모듈 수를 보여 준다
    const on = p.document.querySelector('#mlBody .set-item.active');
    expect(on.dataset.areaPick).toBe(AREA);
    expect(on.textContent).toContain('모듈 3개');
    // 아직 아무것도 칠하지 않았다
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(0);
    // 팔레트 머리가 다음 색 클릭이 무엇을 칠할지 말한다
    expect(p.document.querySelector('#detailPalette .pd-scope').textContent).toMatch(/배치 ".*" 전체 \(모듈 3개\)/);
  });

  test('배치 목록 모드에서는 부재를 눌러도 그 부재가 속한 배치가 골라진다', () => {
    const p = boot();
    p.g('setViewMode')('area');
    p.g('handleEntityClick')(hit(doorUd('lower-2', 0)), {});
    expect(p.PD.scope).toBe('area');
    expect(p.PD.areaId).toBe(AREA);
  });

  test('전체 목록 모드에서는 부재를 눌러도 품목 범위다', () => {
    const p = boot();
    p.g('setViewMode')('all');
    expect(p.PD.scope).toBe('item');
    p.g('handleEntityClick')(hit(doorUd('lower-2', 0)), {});
    expect(p.PD.scope).toBe('item');
    expect(p.document.querySelector('#detailPalette .pd-scope').textContent).toContain('품목 전체');
  });

  test('모드 버튼은 범위를 바꾸고, 범위는 모드 버튼을 바꾼다 (양방향)', () => {
    const p = boot();
    const btn = (m) => p.document.querySelector(`.ml-mode-toggle button[data-mode="${m}"]`);
    btn('all').onclick();
    expect(p.PD.scope).toBe('item');
    btn('area').onclick();
    expect(p.PD.scope).toBe('area');
    btn('single').onclick();
    expect(p.PD.scope).toBe('module');
    // 되돌아오는 길 — 범위를 바꾸면 목록이 따라온다
    p.PD.setScope('area');
    expect(listMode(p)).toBe('area');
    p.PD.setScope('item');
    expect(listMode(p)).toBe('all');
    // 부재 범위는 '개별' 안에 있다 — 목록을 되돌리지 않는다
    p.g('handleEntityClick')(hit(doorUd('lower-1', 0)), {});
    expect(p.PD.scope).toBe('item');   // 전체 모드에서는 부재를 눌러도 품목이다
    p.PD.setScope('module');
    expect(listMode(p)).toBe('single');
    p.g('handleEntityClick')(hit(doorUd('lower-1', 0)), {});
    expect(p.PD.scope).toBe('part');
    expect(listMode(p)).toBe('single');
  });

  test('범위를 바꾸면 슬롯은 전체로 돌아가고, 부재 범위만 슬롯 하나다', () => {
    const p = boot();
    p.PD.setScope('area');
    expect(p.PD.slot).toBe('all');
    p.PD.selectSlot('door');
    p.PD.renderPalette();
    expect(p.PD.slot).toBe('door');
    p.PD.setScope('item');
    expect(p.PD.slot).toBe('all');          // 범위가 바뀌면 되돌아온다
    p.g('handleEntityClick')(hit(doorUd('lower-1', 0)), {});   // 전체 모드 → 품목 (부재 아님)
    p.PD.setScope('module');
    p.g('handleEntityClick')(hit({ entityKind: 'top-panel', moduleId: 'lower-1' }), {});
    expect(p.PD.scope).toBe('part');
    expect(p.PD.slot).toBe('top');          // 부재 범위는 누른 부재의 슬롯
  });
});

describe('배치 전체 칠하기 — 모듈 단계로 펼친다', () => {
  test('색을 고르면 배치 안 모듈마다 있는 슬롯에 module 단계로 적힌다 — 상판 없는 모듈에는 top 이 없다', () => {
    const p = boot();
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.PD.selectCode('PET-OAK-M');
    // 모델에는 배치 단계가 없다 — 모듈 단계 셋이다
    expect(Object.keys(p.PD.detail.modules).sort()).toEqual(IN_AREA);
    expect(slotsOf(p, 'lower-1')).toEqual(['body', 'door', 'top']);
    expect(slotsOf(p, 'lower-2')).toEqual(['body', 'door']);
    expect(slotsOf(p, 'lower-3')).toEqual(['body', 'drawerFront']);   // 서랍장 — 도어·상판 없음
    IN_AREA.forEach((id) => Object.keys(p.PD.detail.modules[id]).forEach((s) => {
      expect(p.PD.detail.modules[id][s]).toEqual({ code: 'PET-OAK-M' });
    }));
    // 배치 밖은 그대로
    expect(p.PD.detail.modules['lower-0']).toBeUndefined();
    expect(p.PD.detail.modules['upper-4']).toBeUndefined();
    expect(p.PD.detail.item).toEqual({});
    expect(p.PD.detail.sections).toEqual({ upper: {}, lower: {} });
    // 저장·알림은 D0 와 같은 길
    expect(JSON.parse(p.storage.getItem(KEY)).modules['lower-2'].door.code).toBe('PET-OAK-M');
    const msg = p.messages.filter((x) => x && x.type === 'PLANNER_DETAIL_CHANGE');
    expect(msg[msg.length - 1].detail.modules['lower-3'].drawerFront.code).toBe('PET-OAK-M');
    // 해석도 모듈 단계로 나온다
    expect(p.window.plannerFinishResolve(p.PD.detail, 'door', 'lower-2', 'lower', 'door#0'))
      .toEqual({ code: 'PET-OAK-M', level: 'module' });
  });

  test('범위 안의 부재 지정은 지운다 — 안 지우면 아래 단계가 이겨 "전체" 가 거짓말이 된다', () => {
    const p = boot();
    p.PD.detail.parts['lower-1'] = { 'door#0': { code: 'MFB-WHT' }, 'body:left': { code: 'MFB-WHT' } };
    p.PD.detail.parts['lower-0'] = { 'door#0': { code: 'MFB-WHT' } };   // 배치 밖
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.PD.selectCode('PET-OAK-M');
    expect(p.PD.detail.parts['lower-1']).toBeUndefined();
    expect(p.PD.detail.parts['lower-0']).toEqual({ 'door#0': { code: 'MFB-WHT' } });
    expect(p.window.plannerFinishResolve(p.PD.detail, 'door', 'lower-1', 'lower', 'door#0'))
      .toEqual({ code: 'PET-OAK-M', level: 'module' });
  });

  test('슬롯을 좁히면 그 슬롯만 — 그 슬롯이 없는 모듈은 건너뛴다', () => {
    const p = boot();
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.PD.selectSlot('door');
    p.PD.selectCode('VNR-WNT');
    expect(slotsOf(p, 'lower-1')).toEqual(['door']);
    expect(slotsOf(p, 'lower-2')).toEqual(['door']);
    expect(p.PD.detail.modules['lower-3']).toBeUndefined();   // 서랍장에는 도어가 없다
  });

  test('슬롯을 좁히면 그 슬롯의 부재 지정만 지운다', () => {
    const p = boot();
    p.PD.detail.parts['lower-1'] = { 'door#0': { code: 'MFB-WHT' }, 'body:left': { code: 'MFB-WHT' } };
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.PD.selectSlot('door');
    p.PD.selectCode('VNR-WNT');
    expect(p.PD.detail.parts['lower-1']).toEqual({ 'body:left': { code: 'MFB-WHT' } });
  });

  test('되돌리기 한 장이 배치 전체를 되돌린다', () => {
    const p = boot();
    p.PD.detail.parts['lower-1'] = { 'door#0': { code: 'MFB-WHT' } };
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    const before = JSON.stringify(p.PD.detail);
    p.PD.selectCode('PET-OAK-M');
    expect(p.PD.undoStack).toHaveLength(1);                  // 모듈 7칸을 적어도 한 장이다
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(7);
    expect(p.PD.undo()).toBe(true);
    expect(JSON.stringify(p.PD.detail)).toBe(before);
    expect(p.PD.undo()).toBe(false);
  });
});

describe('모듈 · 품목 범위', () => {
  test('모듈 범위는 그 모듈 하나를 통째로 칠한다 (목록에서 모듈을 고르면 모듈 범위다)', () => {
    const p = boot();
    p.g('setActiveModule')('lower-1');
    expect(p.PD.scope).toBe('module');
    expect(p.PD.slot).toBe('all');
    p.PD.selectCode('PET-OAK-M');
    expect(Object.keys(p.PD.detail.modules)).toEqual(['lower-1']);
    expect(slotsOf(p, 'lower-1')).toEqual(['body', 'door', 'top']);
    expect(p.PD.undoStack).toHaveLength(1);
  });

  test('Shift+부재 클릭은 D0 그대로 — 그 모듈의 **같은 슬롯** 전부', () => {
    const p = boot();
    p.PD.selectCode('VNR-WNT');
    p.g('handleEntityClick')(hit(doorUd('lower-1', 0)), { shiftKey: true });
    expect(p.PD.scope).toBe('module');
    expect(p.PD.detail.modules['lower-1']).toEqual({ door: { code: 'VNR-WNT' } });
    expect(p.PD.detail.parts).toEqual({});
  });

  test('품목 범위는 item 단계에 적고 모듈·섹션·부재 지정을 정리한다', () => {
    const p = boot();
    p.PD.detail.parts['lower-1'] = { 'door#0': { code: 'MFB-WHT' } };
    p.PD.detail.modules['lower-2'] = { door: { code: 'MFB-WHT' } };
    p.PD.detail.sections.lower = { body: { code: 'MFB-WHT' } };
    p.g('setViewMode')('all');
    expect(p.PD.scope).toBe('item');
    p.PD.selectCode('PET-OAK-M');
    // 씬에 있는 슬롯의 합집합 — 도어·서랍앞판·몸통·상판
    expect(Object.keys(p.PD.detail.item).sort()).toEqual(['body', 'door', 'drawerFront', 'top']);
    expect(p.PD.detail.modules).toEqual({});
    expect(p.PD.detail.sections).toEqual({ upper: {}, lower: {} });
    expect(p.PD.detail.parts).toEqual({});
    expect(p.PD.undoStack).toHaveLength(1);
    expect(p.window.plannerFinishResolve(p.PD.detail, 'door', 'lower-0', 'lower', 'door#0'))
      .toEqual({ code: 'PET-OAK-M', level: 'item' });
  });

  test('3D 를 아직 못 읽었고 슬롯도 고르지 않았으면 적지 않고 이유를 말한다', () => {
    const p = boot();
    p.PD._o.three = () => null;
    p.PD._paintMap = null;
    p.g('setViewMode')('all');
    expect(p.PD.selectCode('PET-OAK-M')).toBe('PET-OAK-M');
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(0);
    // 슬롯을 고르면 그것만은 적는다
    p.PD.selectSlot('door');
    p.PD.selectCode('VNR-WNT');
    expect(p.PD.detail.item).toEqual({ door: { code: 'VNR-WNT' } });
  });
});

describe('패널 배치', () => {
  test('팔레트는 우측 패널 안, 좌측 목록은 디테일 모드에서도 그대로 산다', () => {
    const p = boot();
    const pal = p.document.getElementById('detailPalette');
    expect(p.document.querySelector('#rightPanel .section[data-sec="detail-palette"]').contains(pal)).toBe(true);
    // '선택 부재 마감' 카드보다 **위**에 온다 — 고르는 곳이 먼저다
    const secs = [...p.document.querySelectorAll('#rightPanel .section[data-sec]')].map((n) => n.getAttribute('data-sec'));
    expect(secs.indexOf('detail-palette')).toBeLessThan(secs.indexOf('detail'));
    expect(secs.indexOf('detail')).toBeLessThan(secs.indexOf('detail-renders'));
    // 좌측: 목록과 모드 버튼이 살아 있다
    expect(p.document.querySelector('#moduleList #mlBody')).not.toBeNull();
    expect(p.document.querySelectorAll('#moduleList .ml-mode-toggle button')).toHaveLength(3);
    expect(p.document.querySelector('#moduleList #detailPalette')).toBeNull();
  });

  test('CSS: 목록은 더 이상 숨지 않고, 구조를 고치는 개별 모듈 패널만 숨는다', () => {
    const { PLANNER_DETAIL_CSS } = require('../js/planner/planner-detail');
    expect(PLANNER_DETAIL_CSS).not.toMatch(/body\.detail-mode #mlBody/);
    expect(PLANNER_DETAIL_CSS).toContain('body.detail-mode #modulePanel{display:none!important}');
    expect(PLANNER_DETAIL_CSS).toContain('[data-sec="detail-palette"]');
    // 우측 패널 안에서 스와치가 따로 구른다 (머리는 붙어 있어야 지금 무엇을 칠하는지 보인다)
    expect(PLANNER_DETAIL_CSS).toMatch(/#detailPalette \.pd-groups\{max-height:[^}]*overflow-y:auto/);
  });

  test('개별 모듈 패널의 "적용" 은 디테일 모드에서 구조를 바꾸지 않는다', () => {
    const p = boot({ structure: true });
    p.g('setActiveModule')('lower-1');
    const s = p.g('getStructure')('lower-1');
    const before = JSON.stringify(s);
    const draft = p.g('moduleDraftFor')(p.g('modules').find((m) => m.id === 'lower-1'));
    draft.s.verticalCount = (draft.s.verticalCount || 1) + 1;
    draft.dirty = true;
    p.PD.enter();
    expect(p.g('applyModuleDraft')()).toBe(false);
    expect(JSON.stringify(p.g('getStructure')('lower-1'))).toBe(before);
    // 모드를 나가면 다시 된다
    p.PD.exit();
    expect(p.g('applyModuleDraft')()).not.toBe(false);
    expect(JSON.stringify(p.g('getStructure')('lower-1'))).not.toBe(before);
  });

  test('HTML 배선 — 팔레트 섹션과 범위 훅 세 줄', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    expect(src).toContain('data-sec="detail-palette"');
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive()) PlannerDetail.onListMode(mode);");
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive()) PlannerDetail.onModulePick(id);");
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive()) PlannerDetail.onAreaPick(id);");
    expect(src).toContain('listMode: () => viewMode,');
    expect(src).toContain('areaIdOf: (m) => areaIdOfModule(m),');
    expect(src).toContain('selectArea: (id) => setActiveArea(id),');
  });
});

describe('불변조건', () => {
  test('I1: 범위로 칠해도 buildPlannerPayload 는 바이트 동일하고 detail 을 싣지 않는다', () => {
    const { canonical } = require('../test-utils/planner-golden');
    const p = boot();
    // 구조는 처음 만져질 때 만들어진다 (getStructure) — 칠하기와 무관한 그 차이를 먼저 지운다
    p.g('modules').forEach((m) => p.g('getStructure')(m.id));
    const before = canonical(p.g('buildPlannerPayload')('PLANNER_STATE'));
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.PD.selectCode('PET-OAK-M');
    p.g('setViewMode')('all');
    p.PD.selectCode('VNR-WNT');
    p.g('persistPlannerState')();
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(canonical(payload)).toBe(before);
    expect(JSON.stringify(payload)).not.toMatch(/detail|PET-OAK-M|VNR-WNT/);
  });

  test('I2: 구조 모드에서는 배치·모듈을 골라도 마감이 움직이지 않는다', () => {
    const p = boot({ structure: true });
    p.PD.selectedCode = 'PET-OAK-M';
    p.g('setViewMode')('area');
    p.g('handleEntityClick')(hit({ entityKind: 'area', areaId: AREA }), {});
    p.g('setActiveModule')('lower-1');
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(0);
    expect(p.storage.getItem(KEY)).toBeNull();
  });

  test('옛 저장본(부재·섹션 지정)은 그대로 읽힌다 — 범위는 모델을 바꾸지 않았다', () => {
    const old = {
      version: 1,
      item: { door: { code: 'LPM-GRP' } },
      sections: { upper: { body: { code: 'MFB-WHT' } }, lower: {} },
      modules: { 'lower-1': { top: { code: 'VNR-WNT' } } },
      parts: { 'lower-2': { 'door#0': { code: 'PET-BLK-G' } } },
    };
    const p = boot({ storage: { [KEY]: JSON.stringify(old) } });
    expect(p.PD.detail).toEqual(old);
    const R = p.window.plannerFinishResolve;
    expect(R(p.PD.detail, 'door', 'lower-2', 'lower', 'door#0')).toEqual({ code: 'PET-BLK-G', level: 'part' });
    expect(R(p.PD.detail, 'top', 'lower-1', 'lower', 'top')).toEqual({ code: 'VNR-WNT', level: 'module' });
    expect(R(p.PD.detail, 'body', 'upper-4', 'upper', 'body:left')).toEqual({ code: 'MFB-WHT', level: 'section' });
    expect(R(p.PD.detail, 'door', 'lower-0', 'lower', 'door#0')).toEqual({ code: 'LPM-GRP', level: 'item' });
  });
});
