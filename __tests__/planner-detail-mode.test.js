/**
 * D0: 디테일 모드 (js/planner/planner-detail.js + mockup-structure.html 배선) — jsdom 부팅 시험.
 *
 *   · ?stage=detail / 🎨 버튼으로 들어가고 나온다 (body.detail-mode, 필 활성)
 *   · 3D 부재 클릭(handleEntityClick 을 흉내 낸 mesh)이 고른 마감을 그 부재에 칠한다 — Shift 면 모듈
 *   · 저장: 스코프 키 dadam_detail_v1::gold:1 · plannerAutosave('detail') → PlannerStore.save('detail')
 *           · 부모에 PLANNER_DETAIL_CHANGE
 *   · 불변조건 I1: 칠한 뒤에도 buildPlannerPayload 는 바이트 동일하고 detail 을 싣지 않는다
 *   · 불변조건 I2: 모드 밖에서는 paintScene 이 손대지 않고, 정면도(SVG)는 모드와 무관하게 같다
 *   · 되돌리기 10장, 새로고침(재부팅) 뒤에도 남는다, 스냅샷 되쓰기(새 형식 → 제자리 / 옛 형식 → 부모)
 *
 * three.js 는 jsdom 에서 스스로 건너뛰므로(three === null) 3D 색은 가짜 group 으로 paintScene 만 본다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor, canonical } = require('../test-utils/planner-golden');

const KEY = 'dadam_detail_v1::gold:1';

function boot(opts = {}) {
  const seed = Object.assign({}, seedFor(FIXTURES.straight), opts.storage || {});
  let search = seed._search;
  delete seed._search;
  if (opts.detail) search += '&stage=detail';
  const p = bootPlanner('mockup-structure.html', { search, storage: seed, session: opts.session });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.PD = p.window.PlannerDetail;
  p._search = search;
  return p;
}

/** raycast 가 집은 것처럼 보이는 mesh. moduleId 는 부모(모듈 그룹)에서 오기도 한다. */
function mesh(ud, parentUd) {
  return { userData: ud, parent: parentUd ? { userData: parentUd, parent: null } : null };
}

const doorUd = (moduleId, areaIdx = 0, extra = {}) =>
  Object.assign({ entityKind: 'carcass', side: 'front', areaType: 'door', moduleId, areaIdx, areaPos: 'top' }, extra);

/** 좌측 목록이 지금 보고 있는 모드 — `let viewMode` 는 부팅 시점 사본이라 DOM 에서 읽는다. */
function listMode(p) {
  const on = p.document.querySelector('.ml-mode-toggle button.active');
  return on ? on.dataset.mode : null;
}

function fakeMesh(ud, color) {
  return { isMesh: true, userData: ud, parent: null, material: { color: { value: color || '#000000', set(v) { this.value = v; } } } };
}
function fakeGroup(children) {
  return { children, traverse(fn) { children.forEach((c) => fn(c)); } };
}

describe('?stage=detail 쿼리 도우미', () => {
  const { plannerDetailSearchWith, plannerDetailWantsStage } = require('../js/planner/planner-detail');
  test('붙이고 떼도 design·item 은 그대로다', () => {
    expect(plannerDetailSearchWith('?design=d1&item=5', true)).toBe('?design=d1&item=5&stage=detail');
    expect(plannerDetailSearchWith('?design=d1&item=5&stage=detail', false)).toBe('?design=d1&item=5');
    expect(plannerDetailSearchWith('?stage=detail', false)).toBe('');
    expect(plannerDetailSearchWith('', true)).toBe('?stage=detail');
  });
  test('stage=detail 판정', () => {
    expect(plannerDetailWantsStage('?design=d1&item=5&stage=detail')).toBe(true);
    expect(plannerDetailWantsStage('?design=d1&item=5')).toBe(false);
    expect(plannerDetailWantsStage('')).toBe(false);
  });
});

describe('모드 진입·이탈', () => {
  test('?stage=detail 이면 부팅하자마자 디테일 모드다 — 던지는 것 없이', () => {
    const p = boot({ detail: true });
    expect(p.errors).toEqual([]);
    expect(p.PD.isActive()).toBe(true);
    expect(p.document.body.classList.contains('detail-mode')).toBe(true);
    expect(p.document.getElementById('detailStageBtn').classList.contains('active')).toBe(true);
    expect(p.document.getElementById('structureStageBtn').classList.contains('active')).toBe(false);
    // 2026-09-16: 좌측은 팔레트가 아니라 **범위 목록**이다 (팔레트는 우측으로 갔다)
    expect(p.document.querySelector('.ml-header-title').textContent).toBe('칠할 범위');
    expect(p.document.getElementById('mlBody')).not.toBeNull();
  });

  test('stage 가 없으면 구조 모드 그대로 — 🎨 를 누르면 들어가고 다시 누르면 나온다', () => {
    const p = boot();
    expect(p.PD.isActive()).toBe(false);
    expect(p.document.body.classList.contains('detail-mode')).toBe(false);
    p.document.getElementById('detailStageBtn').onclick();
    expect(p.PD.isActive()).toBe(true);
    expect(p.document.body.classList.contains('detail-mode')).toBe(true);
    p.document.getElementById('detailStageBtn').onclick();
    expect(p.PD.isActive()).toBe(false);
    expect(p.document.body.classList.contains('detail-mode')).toBe(false);
    expect(p.document.getElementById('structureStageBtn').classList.contains('active')).toBe(true);
    expect(p.document.querySelector('.ml-header-title').textContent).toBe('배치된 모듈');
  });

  test('팔레트는 카탈로그 마감×색 스와치 전부와 슬롯 전체+7개, 우측에는 선택 부재 카드 자리가 있다', () => {
    const p = boot({ detail: true });
    const pal = p.document.getElementById('detailPalette');
    // 크기는 정본(bom-finish-color.js)이 정한다 — 숫자를 박지 않는다 (C0 가 색을 더하면 따라 바뀐다).
    const api = p.window.DadamBomFinishColor;
    const nF = api.DOOR_FINISH_CATALOG.length, nC = api.DOOR_COLOR_CATALOG.length;
    expect(nF).toBe(7);
    expect(nC).toBeGreaterThanOrEqual(7);
    // 마감×색 전부 + C2b 호환 코드 {COLOR}-M/G (색 × 2, planner-catalog.js plannerCatalogCompatToneEntries)
    expect(pal.querySelectorAll('.pd-swatch')).toHaveLength(Object.keys(api.buildFullMatrix()).length + api.DOOR_COLOR_CATALOG.length * 2);
    // 2026-09-16: 슬롯 7 + '전체'. 모듈·배치·품목 범위의 기본값이 '전체' 다.
    expect(pal.querySelectorAll('[data-slot]')).toHaveLength(8);
    expect(pal.querySelector('[data-slot="all"]')).not.toBeNull();
    expect(pal.querySelector('.pd-src').textContent).toBe(`카탈로그 ${nF}×${nC}`);   // 정본을 script 로 실었다
    expect(p.document.querySelector('#rightPanel .section[data-sec="detail"] #detailBody')).not.toBeNull();
    // 스와치를 누르면 고른 마감이 된다
    pal.querySelector('[data-code="PET-OAK-M"]').onclick();
    expect(p.PD.selectedCode).toBe('PET-OAK-M');
    expect(p.document.querySelector('#detailPalette [data-code="PET-OAK-M"]').classList.contains('on')).toBe(true);
    // 같은 것을 다시 누르면 풀린다
    p.document.querySelector('#detailPalette [data-code="PET-OAK-M"]').onclick();
    expect(p.PD.selectedCode).toBeNull();
  });
});

describe('부재 클릭 → 칠하기', () => {
  test('고른 마감이 그 부재(부재 단계)에 적힌다 — 스코프 키에 저장되고 부모에 알린다', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[0];
    p.PD.selectCode('PET-OAK-M');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 1)), { shiftKey: false });
    expect(p.PD.detail.parts[m.id]['door#1']).toEqual({ code: 'PET-OAK-M' });
    expect(p.PD.detail.modules[m.id]).toBeUndefined();
    const saved = JSON.parse(p.storage.getItem(KEY));
    expect(saved.parts[m.id]['door#1'].code).toBe('PET-OAK-M');
    const msg = p.messages.filter((x) => x && x.type === 'PLANNER_DETAIL_CHANGE');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg[msg.length - 1].detail.parts[m.id]['door#1'].code).toBe('PET-OAK-M');
    // 우측 카드가 코드와 단계를 보여 준다
    const card = p.document.getElementById('detailBody').textContent;
    expect(card).toContain('PET-OAK-M');
    expect(card).toContain('부재 단계 지정');
  });

  test('Shift+클릭은 그 모듈의 같은 슬롯 전부 (모듈 단계)', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[0];
    p.PD.selectCode('VNR-WNT');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), { shiftKey: true });
    expect(p.PD.detail.modules[m.id]).toEqual({ door: { code: 'VNR-WNT' } });
    expect(p.PD.detail.parts).toEqual({});
    // 같은 모듈의 다른 도어도 그 색이다
    expect(p.window.plannerFinishResolve(p.PD.detail, 'door', m.id, m.section, 'door#3')).toEqual({ code: 'VNR-WNT', level: 'module' });
  });

  test('moduleId 가 부모 그룹에만 있어도 찾는다 · 고른 마감이 없으면 카드만 보여 준다(스포이드)', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[1];
    p.g('handleEntityClick')(mesh({ entityKind: 'top-panel' }, { entityKind: 'module', moduleId: m.id }), {});
    expect(p.PD.picked).toMatchObject({ moduleId: m.id, slot: 'top', partKey: 'top' });
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(0);
    expect(p.document.getElementById('detailBody').textContent).toContain('지정 없음');
  });

  // 2026-09-16: '품목 전체'·'이 모듈' 버튼은 **범위**(전체 / 개별)가 대신한다 — 팔레트에는
  //   섹션 두 줄만 남았다. applyBulk('item'|'module') 은 프로그램용으로 남아 있다.
  test('범위 = 품목이면 색을 고르는 순간 칠해진다 · 상부 전체 · 카드의 해제', () => {
    const p = boot({ detail: true });
    const lower = p.g('modules').find((x) => x.section === 'lower');
    const upper = p.g('modules').find((x) => x.section === 'upper');
    const R = p.window.plannerFinishResolve;
    p.PD.setScope('item');
    expect(listMode(p)).toBe('all');                      // 범위를 바꾸면 좌측 목록이 따라온다
    expect(p.PD.slot).toBe('all');                        // 품목 범위의 기본 슬롯은 '전체'
    p.PD.selectSlot('body');                              // 슬롯으로 좁힌다
    p.PD.selectCode('MFB-WHT');
    expect(p.PD.detail.item.body).toEqual({ code: 'MFB-WHT' });
    expect(R(p.PD.detail, 'body', lower.id, lower.section, 'body:left')).toEqual({ code: 'MFB-WHT', level: 'item' });
    // 섹션(상/하)은 목록에 없는 묶음이라 버튼으로 남는다 — 품목보다 세다
    p.PD.selectCode('PNT-WHT-M');                         // 품목 범위라 item.body 도 바뀐다
    p.document.querySelector('#detailPalette [data-bulk="section:upper"]').onclick();
    expect(p.PD.detail.sections.upper.body).toEqual({ code: 'PNT-WHT-M' });
    expect(R(p.PD.detail, 'body', upper.id, upper.section, 'body:left')).toEqual({ code: 'PNT-WHT-M', level: 'section' });
    expect(p.document.querySelector('#detailPalette [data-bulk="item"]')).toBeNull();
    expect(p.document.querySelector('#detailPalette [data-bulk="module"]')).toBeNull();
    // 품목 기본값 ✕ 로 해제
    p.document.querySelector('#detailBody [data-clear-item="body"]').onclick();
    expect(p.PD.detail.item.body).toBeUndefined();
    expect(R(p.PD.detail, 'body', lower.id, lower.section, 'body:left')).toBeNull();
  });

  test('되돌리기 — 최대 10장', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[0];
    p.PD.selectCode('PET-OAK-M');
    for (let i = 0; i < 12; i++) p.g('handleEntityClick')(mesh(doorUd(m.id, i)), {});
    expect(Object.keys(p.PD.detail.parts[m.id])).toHaveLength(12);
    expect(p.PD.undoStack).toHaveLength(10);
    expect(p.PD.undo()).toBe(true);
    expect(Object.keys(p.PD.detail.parts[m.id])).toHaveLength(11);
    for (let i = 0; i < 9; i++) p.PD.undo();
    expect(Object.keys(p.PD.detail.parts[m.id])).toHaveLength(2);   // 12 − 10
    expect(p.PD.undo()).toBe(false);
    expect(JSON.parse(p.storage.getItem(KEY)).parts[m.id]['door#1'].code).toBe('PET-OAK-M');   // 되돌린 것도 저장된다
  });

  test('구조 모드에서는 같은 클릭이 마감을 건드리지 않는다 (I2)', () => {
    const p = boot();
    const m = p.g('modules')[0];
    p.PD.selectedCode = 'PET-OAK-M';
    p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), {});
    expect(p.PD.picked).toBeNull();
    expect(p.window.plannerFinishCount(p.PD.detail)).toBe(0);
    expect(p.storage.getItem(KEY)).toBeNull();
  });
});

describe('저장 경로', () => {
  test('칠하면 plannerAutosave(detail) 이 PlannerStore.save("detail", {autosave}) 를 부른다', () => {
    jest.useFakeTimers();
    try {
      const p = boot({ detail: true });
      const spy = jest.spyOn(p.window.PlannerStore, 'save');
      const m = p.g('modules')[0];
      p.PD.selectCode('PET-OAK-M');
      p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), {});
      expect(spy).not.toHaveBeenCalled();          // 디바운스 — 바로 보내지 않는다
      jest.advanceTimersByTime(2000);
      const calls = spy.mock.calls.filter((c) => c[0] === 'detail');
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ autosave: true });
      spy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('새로고침(재부팅)해도 마감이 남는다 — 스코프 키로 읽는다', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[0];
    p.PD.selectCode('PET-OAK-M');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 2)), {});
    const dump = p.storage._dump();
    const again = bootPlanner('mockup-structure.html', { search: p._search, storage: dump });
    expect(again.errors).toEqual([]);
    expect(again.window.PlannerDetail.detail.parts[m.id]['door#2']).toEqual({ code: 'PET-OAK-M' });
    // 다른 품목 스코프에서는 보이지 않는다
    const other = bootPlanner('mockup-structure.html', { search: '?design=gold&item=2&stage=detail', storage: dump });
    expect(other.window.plannerFinishCount(other.window.PlannerDetail.detail)).toBe(0);
  });

  test('스냅샷 되쓰기 — 새 형식은 제자리에서 다시 읽고, 옛 형식은 부모(상세설계)로 넘긴다', () => {
    const p = boot({ detail: true });
    const m = p.g('modules')[0];
    const detail = { version: 1, item: { door: { code: 'LPM-GRP' } }, sections: { upper: {}, lower: {} }, modules: {}, parts: {} };
    // loadAny 가 한 일을 흉내 낸다: 키 되쓰기 + applied
    p.storage.setItem(KEY, JSON.stringify(detail));
    expect(p.PD.applySnapshotResult({ ok: true, applied: ['detail'], row: { payload: { detail } } })).toBe(true);
    expect(p.PD.detail.item.door).toEqual({ code: 'LPM-GRP' });
    expect(p.window.plannerFinishResolve(p.PD.detail, 'door', m.id, m.section, 'door#0')).toEqual({ code: 'LPM-GRP', level: 'item' });
    // 옛 형식
    const before = p.messages.length;
    expect(p.PD.applySnapshotResult({ ok: true, applied: [], row: { payload: { specs: { doorColorUpper: 'white' }, modules: [] } } })).toBe(true);
    const legacy = p.messages.slice(before).find((x) => x && x.type === 'DADAM_RESTORE_DETAIL');
    expect(legacy).toBeDefined();
    expect(legacy.payload.specs.doorColorUpper).toBe('white');
    expect(p.PD.detail.item.door).toEqual({ code: 'LPM-GRP' });   // 옛 형식은 이 페이지의 모델을 건드리지 않는다
  });
});

describe('불변조건', () => {
  test('I1: 칠해도 buildPlannerPayload 는 바이트 동일하고 detail 을 싣지 않는다', () => {
    const p = boot({ detail: true });
    const before = canonical(p.g('buildPlannerPayload')('PLANNER_STATE'));
    const m = p.g('modules')[0];
    p.PD.selectCode('PET-OAK-M');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), {});
    p.g('handleEntityClick')(mesh(doorUd(m.id, 1)), { shiftKey: true });
    p.PD.applyBulk('item');
    p.g('persistPlannerState')();
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(canonical(payload)).toBe(before);
    expect(JSON.stringify(payload)).not.toMatch(/detail|PET-OAK-M/);
  });

  test('I2: 정면도(SVG)는 모드에 들어가고 칠해도 그대로다', () => {
    const p = boot();
    p.g('setViewMode')('all');
    p.g('renderFrontView')();
    const base = p.document.getElementById('contentG').innerHTML;
    p.PD.enter();
    const m = p.g('modules')[0];
    p.PD.selectCode('PET-BLK-G');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), {});
    p.g('renderFrontView')();
    expect(p.document.getElementById('contentG').innerHTML).toBe(base);
    p.PD.exit();
    p.g('renderFrontView')();
    expect(p.document.getElementById('contentG').innerHTML).toBe(base);
  });

  test('I2: paintScene 은 모드에서만 색을 바꾸고, 표시용 mesh 와 지정 없는 부재는 두지 않는다', () => {
    const p = boot();
    const m = p.g('modules')[0];
    const door0 = fakeMesh(doorUd(m.id, 0), '#b8956c');
    const door1 = fakeMesh(doorUd(m.id, 1), '#b8956c');
    const side = fakeMesh({ entityKind: 'carcass', side: 'left', moduleId: m.id }, '#af8e67');
    const edge = fakeMesh({ entityKind: 'doorEdge', axis: 'left' }, '#111111');
    const reveal = fakeMesh({ entityKind: 'reveal', moduleId: m.id }, '#222222');
    const orphan = fakeMesh({ entityKind: 'top-panel' }, '#333333');   // moduleId 없고 부모도 없다
    const group = fakeGroup([door0, door1, side, edge, reveal, orphan]);
    const snapshot = () => group.children.map((c) => c.material.color.value);
    const base = snapshot();

    // 구조 모드 — 지정이 있어도 손대지 않는다
    p.PD.detail.parts[m.id] = { 'door#0': { code: 'PET-OAK-M' } };
    p.PD.detail.item.body = { code: 'MFB-WHT' };
    expect(p.PD.paintScene(group)).toBe(0);
    expect(snapshot()).toEqual(base);

    // 디테일 모드 — 지정된 것만, 표시용은 그대로
    p.PD.enter();
    expect(p.PD.paintScene(group)).toBe(2);
    expect(door0.material.color.value).toBe('#d1b089');     // PET-OAK-M → 오크
    expect(door1.material.color.value).toBe('#b8956c');     // 지정 없음 → 구조 색
    expect(side.material.color.value).toBe('#ffffff');      // 품목 body → 화이트
    expect(edge.material.color.value).toBe('#111111');
    expect(reveal.material.color.value).toBe('#222222');
    expect(orphan.material.color.value).toBe('#333333');

    // 나오면 다시 손대지 않는다
    p.PD.exit();
    door0.material.color.value = '#b8956c'; side.material.color.value = '#af8e67';
    expect(p.PD.paintScene(group)).toBe(0);
    expect(snapshot()).toEqual(base);
  });

  test('renderAll3D · handleEntityClick 의 훅은 모드 밖에서 아무것도 하지 않는 한 줄이다 — mount 는 three 를 넘긴다', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive()) PlannerDetail.paintScene(modG);");
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive() && PlannerDetail.pickMesh(mesh, ev)) return;");
    // 색을 정하는 빌더(makeBox)는 손대지 않았다
    const at = src.indexOf('function makeBox(');
    expect(src.slice(at, at + 600)).not.toMatch(/PlannerDetail|plannerFinish/);
    // D2: 씬 설정을 켜고 끄려면 three 묶음이 필요하다 — mount 가 getter 로 넘긴다 (init3D 전이면 null)
    expect(src).toContain('three: () => three,');
    expect(src).toContain("import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';");
    expect(src).toContain('window.RoomEnvironment = RoomEnvironment;');
  });
});

// ────────────────────────────────────────────────────────────
// D2: 카탈로그 팔레트(그룹·슬롯 필터·검색) · 모드 전환의 씬 복원 · PBR 재질 스왑
// ────────────────────────────────────────────────────────────
describe('D2: 팔레트 그룹 (예림 LUX 카탈로그)', () => {
  const dbRow = (over) => Object.assign({
    code: 'YR-SM-01', vendor: 'yerim', vendor_code: 'SM-01', series: 'Supreme', finish: 'Supreme PET Matt', tone: 'matte',
    color_name: '매트 화이트', color_hex: '#f4f4f4', roughness: 0.75, metalness: 0, clearcoat: 0, grain: 'none',
    texture_url: null, tile_mm: null, slot: ['door', 'drawer_front'], category: 'door_material', sort: 2000,
  }, over);
  const ROWS = [
    dbRow(),
    dbRow({ code: 'YR-SM-02', vendor_code: 'SM-02', color_name: '매트 오크', color_hex: '#d1b089', sort: 2001 }),
    dbRow({ code: 'YR-SG-01', vendor_code: 'SG-01', finish: 'Supreme PET Glossy', tone: 'gloss', color_name: '글로시 화이트', roughness: 0.25, clearcoat: 0.6, sort: 2100 }),
    dbRow({ code: 'YR-B-01', vendor_code: 'B-01', series: 'Body', finish: 'Body PVC', tone: 'single', color_name: '바디 오크', color_hex: '#c9a577', slot: ['body'], category: 'body_material', sort: 5000 }),
    { code: 'TOP-SNW', vendor: null, tone: 'gloss', color_name: '스노우', color_hex: '#FAFAFA', roughness: 0.25, metalness: 0, clearcoat: 0.6, grain: 'none', slot: ['top'], category: 'countertop', sort: 1 },
  ];
  /** DB 카탈로그를 붙인 채 부팅한다 — 팔레트는 그것으로 그려진다. */
  function bootDb() {
    const p = boot({ detail: true });
    p.cat = p.window.plannerCatalogBuild(ROWS, p.window.DadamBomFinishColor);
    p.PD.catalog = p.cat;
    // 2026-09-16: 기본 슬롯이 '전체' 가 됐다 (범위 칠하기). 이 절은 **슬롯 필터**를 보는 곳이라
    //   D2 때와 같은 출발점(도어)에 맞춰 둔다 — '전체' 의 동작은 범위 시험이 따로 본다.
    p.PD.selectSlot('door');
    p.PD.renderPalette();
    return p;
  }
  const groupsOf = (p) => [...p.document.querySelectorAll('#detailPalette details.pd-group')];
  const labelsOf = (p) => groupsOf(p).map((d) => d.querySelector('summary span').textContent);
  const oakCodes = (p) => p.window.plannerFinishCatalog(p.window.DadamBomFinishColor).entries.filter((e) => e.colorLabel === '오크').map((e) => e.code);

  test('부팅 직후(DB 없음)는 호환 그룹 하나가 펼쳐져 있고 출처는 D0 그대로 "카탈로그 7×10"', () => {
    const p = boot({ detail: true });
    expect(p.PD.catalog.source).toBe('local');
    expect(labelsOf(p)).toEqual(['기타(호환)']);
    expect(groupsOf(p)[0].open).toBe(true);
    expect(p.document.querySelector('#detailPalette .pd-search')).not.toBeNull();
  });

  test('그룹은 series · finish 로 접히는 섹션, 스와치는 hex 칩 + 이름 + 공급사 코드, 호환은 맨 뒤·접힘', () => {
    const p = bootDb();
    expect(p.document.querySelector('#detailPalette .pd-src').textContent).toBe('예림 LUX 4');
    // 기본 슬롯 door → 도어재 그룹 + 호환 (바디·상판은 숨는다)
    expect(labelsOf(p)).toEqual(['Supreme · PET Matt', 'Supreme · PET Glossy', '기타(호환)']);
    const gs = groupsOf(p);
    expect(gs.map((d) => d.open)).toEqual([true, true, false]);
    expect(gs[0].querySelector('.pd-count').textContent).toBe('2');
    const sw = gs[0].querySelector('[data-code="YR-SM-02"]');
    expect(sw.querySelector('.pd-chipbox').getAttribute('style')).toContain('#d1b089');
    expect(sw.querySelector('.pd-name').textContent).toBe('매트 오크');
    expect(sw.querySelector('.pd-code').textContent).toBe('SM-02');
    // 호환 그룹의 스와치도 DOM 에는 있다 (접혀 있을 뿐) — 구 7×7 + C2b 호환 코드 {COLOR}-M/G (색 × 2)
    expect(gs[2].querySelectorAll('.pd-swatch').length).toBe(Object.keys(p.window.DadamBomFinishColor.buildFullMatrix()).length
      + p.window.DadamBomFinishColor.DOOR_COLOR_CATALOG.length * 2);
    // 고르면 선택 카드에 라벨·코드
    sw.onclick();
    expect(p.PD.selectedCode).toBe('YR-SM-02');
    expect(p.document.querySelector('#detailPalette .pd-sel').textContent).toContain('PET Matt · 매트 오크');
    expect(p.document.querySelector('#detailPalette [data-code="YR-SM-02"]').classList.contains('on')).toBe(true);
  });

  test('슬롯 필터 — 몸통은 body_material, 상판은 countertop, 손잡이는 호환뿐', () => {
    const p = bootDb();
    p.PD.selectSlot('body');
    expect(labelsOf(p)).toEqual(['Body · PVC', '기타(호환)']);
    p.PD.selectSlot('top');
    expect(labelsOf(p)).toEqual(['상판', '기타(호환)']);
    expect(p.document.querySelector('#detailPalette [data-code="TOP-SNW"]')).not.toBeNull();
    p.PD.selectSlot('handle');
    expect(labelsOf(p)).toEqual(['기타(호환)']);
    p.PD.selectSlot('drawerFront');
    expect(labelsOf(p)).toEqual(['Supreme · PET Matt', 'Supreme · PET Glossy', '기타(호환)']);
  });

  test('검색 — 입력칸을 다시 만들지 않고 그룹만 다시 그린다, 빈 그룹은 빠지고 맞는 그룹은 펼친다', () => {
    const p = bootDb();
    const input = p.document.querySelector('#detailPalette [data-search]');
    input.value = '오크';
    input.oninput();
    expect(p.PD.query).toBe('오크');
    expect(p.document.querySelector('#detailPalette [data-search]')).toBe(input);   // 같은 노드 — 포커스가 남는다
    expect(labelsOf(p)).toEqual(['Supreme · PET Matt', '기타(호환)']);
    expect(groupsOf(p).map((d) => d.open)).toEqual([true, true]);
    // C2b 호환 코드 OAK-M/OAK-G 도 '오크' 라벨이라 걸린다 — 구 7×7 뒤에
    expect([...p.document.querySelectorAll('#detailPalette .pd-swatch')].map((b) => b.dataset.code)).toEqual(['YR-SM-02', ...oakCodes(p), 'OAK-M', 'OAK-G']);
    p.PD.setQuery('없는것');
    expect(groupsOf(p)).toHaveLength(0);
    expect(p.document.querySelector('#detailPalette [data-groups]').textContent).toContain('검색 결과가 없습니다');
    // 다시 그려도(스와치 선택 등 전체 렌더) 검색어는 남는다
    p.PD.setQuery('sg-01');
    p.PD.renderPalette();
    expect(p.document.querySelector('#detailPalette [data-search]').value).toBe('sg-01');
    expect(labelsOf(p)).toEqual(['Supreme · PET Glossy']);
  });

  test('그룹 접힘 상태는 다시 그려도 남는다 (ontoggle → groupOpen)', () => {
    const p = bootDb();
    const first = groupsOf(p)[0];
    first.open = false; first.ontoggle();
    const last = groupsOf(p)[2];
    last.open = true; last.ontoggle();
    p.PD.renderPalette();
    expect(groupsOf(p).map((d) => d.open)).toEqual([false, true, true]);
  });

  test('loadCatalog 가 DB 카탈로그를 받으면 팔레트를 갈아 끼우고 재질 캐시를 비운다 — 실패해도 지금 것을 지킨다', async () => {
    const p = boot({ detail: true });
    const cat = p.window.plannerCatalogBuild(ROWS, p.window.DadamBomFinishColor);
    const disposed = jest.spyOn(p.window.PlannerMaterials, 'dispose');
    p.window.PlannerCatalog.load = async () => cat;
    await p.PD.loadCatalog();
    expect(p.PD.catalog).toBe(cat);
    expect(disposed).toHaveBeenCalled();
    expect(labelsOf(p)[0]).toBe('Supreme · PET Matt');
    p.window.PlannerCatalog.load = async () => { throw new Error('down'); };
    await p.PD.loadCatalog();
    expect(p.PD.catalog).toBe(cat);
    p.window.PlannerCatalog.load = async () => null;
    await p.PD.loadCatalog();
    expect(p.PD.catalog).toBe(cat);
    disposed.mockRestore();
  });

  test('DB 코드로 칠해도 저장·해석·카드는 D0 와 같은 길이다', () => {
    const p = bootDb();
    const m = p.g('modules')[0];
    p.PD.selectCode('YR-SG-01');
    p.g('handleEntityClick')(mesh(doorUd(m.id, 0)), {});
    expect(p.PD.detail.parts[m.id]['door#0']).toEqual({ code: 'YR-SG-01' });
    expect(JSON.parse(p.storage.getItem(KEY)).parts[m.id]['door#0'].code).toBe('YR-SG-01');
    expect(p.document.getElementById('detailBody').textContent).toContain('PET Glossy · 글로시 화이트');
    expect(p.PD.colorFor(doorUd(m.id, 0))).toBe('#f4f4f4');
  });
});

describe('D2: 모드 전환이 씬을 켜고 되돌린다 · PBR 재질 스왑', () => {
  const THREE = require('three');

  /** init3D 가 만든 것과 같은 모양의 three 묶음 — WebGLRenderer 만 값 주머니로 흉내 낸다. */
  function fakeThree() {
    const scene = new THREE.Scene();
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
    scene.add(amb, d1, d2);
    const moduleGroup = new THREE.Group();
    scene.add(moduleGroup);
    const renderer = { outputColorSpace: THREE.LinearSRGBColorSpace, toneMapping: THREE.NoToneMapping, toneMappingExposure: 1 };
    return { renderer, scene, moduleGroup, lights: { amb, d1, d2 } };
  }
  function withThree(p, t) {
    p.window.THREE = THREE;
    p.PD._o.three = () => t;
    const target = { texture: new THREE.Texture(), dispose: jest.fn() };
    p.PD._makeEnv = () => ({ texture: target.texture, target });
    return target;
  }
  function meshOf(ud, parentGroup) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 18), new THREE.MeshStandardMaterial({ color: 0xb8956c }));
    m.userData = ud;
    if (parentGroup) parentGroup.add(m);
    return m;
  }
  afterEach(() => { window.THREE = undefined; });

  test('enter: sRGB · ACES · 노출 1 · 환경맵 · 조명 절반 → exit: 전부 원래 값, 환경맵 target 은 놓는다', () => {
    const p = boot();
    const t = fakeThree();
    const target = withThree(p, t);
    const before = { cs: t.renderer.outputColorSpace, tm: t.renderer.toneMapping, ex: t.renderer.toneMappingExposure, env: t.scene.environment };
    expect(p.PD.enter()).toBe(true);
    expect(t.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(t.renderer.toneMappingExposure).toBe(1);
    expect(t.scene.environment).toBe(target.texture);
    expect(t.lights.amb.intensity).toBeCloseTo(0.3);
    expect(t.lights.d1.intensity).toBeCloseTo(0.9);
    expect(t.lights.d2.intensity).toBeCloseTo(0.3);
    expect(p.PD._sceneSaved).not.toBeNull();
    // 두 번 켜도 저장본은 처음 것
    expect(p.PD.applyScene(true)).toBe(false);
    expect(p.PD.exit()).toBe(true);
    expect(t.renderer.outputColorSpace).toBe(before.cs);
    expect(t.renderer.toneMapping).toBe(before.tm);
    expect(t.renderer.toneMappingExposure).toBe(before.ex);
    expect(t.scene.environment).toBe(before.env);
    expect(t.lights.amb.intensity).toBe(0.6);
    expect(t.lights.d1.intensity).toBe(1.8);
    expect(t.lights.d2.intensity).toBe(0.6);
    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(p.PD._sceneSaved).toBeNull();
    expect(p.PD.applyScene(false)).toBe(false);   // 두 번 꺼도 무해
  });

  test('three 가 늦게 오면(init3D 가 three-ready 뒤) 첫 paintScene 이 씬을 켠다 — 구조 모드에서는 켜지 않는다', () => {
    const p = boot();
    const t = fakeThree();
    p.window.THREE = THREE;
    p.PD._makeEnv = () => null;    // RoomEnvironment 없음 → 환경맵만 건너뛴다
    // 구조 모드: 아무것도 안 한다
    p.PD._o.three = () => t;
    expect(p.PD.paintScene(t.moduleGroup)).toBe(0);
    expect(p.PD._sceneSaved).toBeNull();
    expect(t.renderer.toneMapping).toBe(THREE.NoToneMapping);
    // 디테일 모드로, three 는 없다가
    p.PD._o.three = () => null;
    p.PD.enter();
    expect(p.PD._sceneSaved).toBeNull();
    // init3D 가 온 뒤 renderAll3D → paintScene
    p.PD._o.three = () => t;
    p.PD.paintScene(t.moduleGroup);
    expect(p.PD._sceneSaved).not.toBeNull();
    expect(t.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(t.scene.environment).toBeNull();   // 환경맵은 없었으니 그대로
    p.PD.exit();
    expect(t.renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(t.scene.environment).toBeNull();
  });

  test('paintScene: three 가 있으면 재질을 코드별 MeshPhysicalMaterial 로 바꿔 끼우고, exit 가 원래 재질로 되돌린다', () => {
    const p = boot();
    const t = fakeThree();
    withThree(p, t);
    const m = p.g('modules')[0];
    const modG = new THREE.Group();
    modG.userData = { entityKind: 'module', moduleId: m.id };
    t.moduleGroup.add(modG);
    const door0 = meshOf(doorUd(m.id, 0), modG);
    const door1 = meshOf(doorUd(m.id, 1), modG);
    const side = meshOf({ entityKind: 'carcass', side: 'left', moduleId: m.id }, modG);
    const top = meshOf({ entityKind: 'top-panel' }, modG);              // moduleId 는 부모 그룹에서
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(door0.geometry), new THREE.LineBasicMaterial({ color: 0 }));
    edge.userData = { entityKind: 'edge' };
    modG.add(edge);
    const orig = { door0: door0.material, door1: door1.material, side: side.material, top: top.material, edge: edge.material };

    p.PD.enter();
    p.PD.detail.parts[m.id] = { 'door#0': { code: 'PET-OAK-M' } };
    p.PD.detail.item.body = { code: 'PET-WHT-G' };
    p.PD.detail.item.top = { code: 'MFB-BLK' };
    expect(p.PD.paintScene(t.moduleGroup)).toBe(3);
    expect(door0.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(door0.material.name).toBe('finish:PET-OAK-M');
    expect(door0.material.roughness).toBe(0.75);
    expect(door0.userData._origMaterial).toBe(orig.door0);
    expect(door1.material).toBe(orig.door1);                         // 지정 없음
    expect(side.material.name).toBe('finish:PET-WHT-G');
    expect(side.material.clearcoat).toBe(0.6);                        // 광택
    expect(top.material.name).toBe('finish:MFB-BLK');
    expect(edge.material).toBe(orig.edge);                            // 테두리는 mesh 가 아니다
    // 같은 코드는 같은 재질 객체 (캐시)
    const again = meshOf(doorUd(m.id, 2), modG);
    p.PD.detail.parts[m.id]['door#2'] = { code: 'PET-OAK-M' };
    p.PD.paintScene(t.moduleGroup);
    expect(again.material).toBe(door0.material);
    // 다시 칠해도 _origMaterial 은 처음 것
    expect(door0.userData._origMaterial).toBe(orig.door0);

    p.PD.exit();
    expect(door0.material).toBe(orig.door0);
    expect(side.material).toBe(orig.side);
    expect(top.material).toBe(orig.top);
    expect(again.userData._origMaterial).toBeUndefined();
    // 나온 뒤에는 손대지 않는다
    expect(p.PD.paintScene(t.moduleGroup)).toBe(0);
    expect(door0.material).toBe(orig.door0);
  });

  test('I2: three 가 있어도 구조 모드의 재질·renderer 는 그대로다', () => {
    const p = boot();
    const t = fakeThree();
    withThree(p, t);
    const m = p.g('modules')[0];
    const door = meshOf(doorUd(m.id, 0), t.moduleGroup);
    const orig = door.material;
    p.PD.detail.parts[m.id] = { 'door#0': { code: 'PET-OAK-M' } };
    expect(p.PD.paintScene(t.moduleGroup)).toBe(0);
    expect(door.material).toBe(orig);
    expect(t.renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(t.scene.environment).toBeNull();
    expect(p.window.PlannerMaterials.size()).toBe(0);
  });
});
