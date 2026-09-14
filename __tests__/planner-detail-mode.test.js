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
    expect(p.document.querySelector('.ml-header-title').textContent).toBe('마감 팔레트');
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

  test('팔레트는 카탈로그 7×7 스와치와 슬롯 7개, 우측에는 선택 부재 카드 자리가 있다', () => {
    const p = boot({ detail: true });
    const pal = p.document.getElementById('detailPalette');
    expect(pal.querySelectorAll('.pd-swatch')).toHaveLength(49);
    expect(pal.querySelectorAll('[data-slot]')).toHaveLength(7);
    expect(pal.querySelector('.pd-src').textContent).toBe('카탈로그 7×7');   // 정본을 script 로 실었다
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

  test('일괄 적용 — 품목 전체 / 상부 전체 / 하부 전체, 그리고 카드의 해제', () => {
    const p = boot({ detail: true });
    const lower = p.g('modules').find((x) => x.section === 'lower');
    const upper = p.g('modules').find((x) => x.section === 'upper');
    p.PD.selectSlot('body');
    p.PD.selectCode('MFB-WHT');
    p.document.querySelector('#detailPalette [data-bulk="item"]').onclick();
    p.PD.selectCode('PNT-WHT-M');
    p.document.querySelector('#detailPalette [data-bulk="section:upper"]').onclick();
    expect(p.PD.detail.item.body).toEqual({ code: 'MFB-WHT' });
    expect(p.PD.detail.sections.upper.body).toEqual({ code: 'PNT-WHT-M' });
    const R = p.window.plannerFinishResolve;
    expect(R(p.PD.detail, 'body', lower.id, lower.section, 'body:left')).toEqual({ code: 'MFB-WHT', level: 'item' });
    expect(R(p.PD.detail, 'body', upper.id, upper.section, 'body:left')).toEqual({ code: 'PNT-WHT-M', level: 'section' });
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

  test('renderAll3D · handleEntityClick 의 훅은 모드 밖에서 아무것도 하지 않는 한 줄이다', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive()) PlannerDetail.paintScene(modG);");
    expect(src).toContain("if (typeof PlannerDetail !== 'undefined' && PlannerDetail.isActive() && PlannerDetail.pickMesh(mesh, ev)) return;");
    // 색을 정하는 빌더(makeBox)는 손대지 않았다
    const at = src.indexOf('function makeBox(');
    expect(src.slice(at, at + 600)).not.toMatch(/PlannerDetail|plannerFinish/);
  });
});
