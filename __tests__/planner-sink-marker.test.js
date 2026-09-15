/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-09-15 결정: **'분배기'는 씽크볼이 앉는 자리 표시일 뿐 장이 아니다.**
 * 개수대 하부장은 하부 라인 안의 셀(브리지가 '개수대' 로 라벨)이다. 그래서
 *
 *   · 전체 자동계산은 분배기 공간에 장(측판·지판·뒷판·도어·처짐방지목·상판)을 세우지 않는다
 *   · structures['sink-N'] 은 없다 — getStructure 가 저장하지 않는 표시용 구조를 준다
 *   · 3D 는 몸통·도어 mesh 없이 반투명 상자(marker)만, 정면도는 점선 사각형 + 이름만 그린다
 *   · 모듈 자체는 남는다 — 브리지가 그 X 범위로 개수대 셀을 판정한다
 *
 * 후드도 같은 규칙이다 (PLANNER_MARKER_SECTIONS). 정본 상수의 주석과 planner-sections.js 참고.
 * 원장(scene-bom-ledger) 허용 목록의 "가전 영역 모듈" 14 건이 이 결정으로 사라졌다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { bootPlanner3D, collectSceneParts } = require('../test-utils/scene-parts');
const { FIXTURES, seedFor, modulesFromFixture } = require('../test-utils/planner-golden');
const sections = require('../js/planner/planner-sections.js');
const finish = require('../js/planner/planner-finish.js');

/** 부재로 셀 수 있는 종류 — 이 중 하나라도 표시 모듈에 붙으면 장을 그린 것이다. */
const CABINET_KINDS = ['carcass', 'shelf', 'top-panel', 'handle', 'leg', 'brace', 'blank', 'molding', 'toe-kick', 'pedestal', 'finishing'];

function meshesOf(p, moduleId) {
  const out = [];
  p.three.moduleGroup.traverse((o) => {
    if (!o.isMesh || !o.userData) return;
    if (o.userData.moduleId === moduleId) out.push(o.userData);
  });
  return out;
}

function sinkModule(p) {
  const list = p.g('modules').filter((m) => m.section === 'sink');
  expect(list).toHaveLength(1);
  return list[0];
}

describe('정본 — PLANNER_MARKER_SECTIONS', () => {
  test('분배기·후드가 자리 표시 섹션이다', () => {
    expect(sections.PLANNER_MARKER_SECTIONS).toEqual(['sink', 'hood']);
  });

  test('표시 상자(marker)는 부재가 아니다 — 원장·디테일 칠하기가 건너뛴다', () => {
    expect(finish.PLANNER_FINISH_PAINT_SKIP).toContain('marker');
    expect(finish.plannerFinishPartKeyOf({ entityKind: 'marker', moduleId: 'sink-0' })).toBeNull();
  });
});

describe.each([
  ['straight', FIXTURES.straight],
  ['lShape', FIXTURES.lShape],
])('전체 자동계산 뒤 — %s', (name, layout) => {
  const boot = () => bootPlanner3D(layout, { design: 'marker', item: name });

  test('분배기 모듈은 남고, 공간 폭 그대로다 (브리지가 개수대 셀을 판정한다)', () => {
    const p = boot();
    const m = sinkModule(p);
    const area = p.g('areas').find((a) => a.section === 'sink');
    expect(m.areaId).toBe(area.id);
    expect(m.W).toBe(area.W);
    expect(m.x).toBe(area.x);
    expect(m.id.startsWith('sink-')).toBe(true);
  });

  test("structures['sink-N'] 이 없다 — payload 도 같다", () => {
    const p = boot();
    const m = sinkModule(p);
    expect(p.g('structures')[m.id]).toBeUndefined();
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(payload.structures[m.id]).toBeUndefined();
    expect(Object.keys(payload.structures).some((k) => k.startsWith('sink-'))).toBe(false);
    // 모듈은 payload 에 실린다 — 개수대 셀 판정의 근거
    expect(payload.modules.some((x) => x.id === m.id && x.section === 'sink')).toBe(true);
  });

  test('getStructure 는 저장하지 않는 표시용 구조를 준다', () => {
    const p = boot();
    const m = sinkModule(p);
    const s = p.g('getStructure')(m.id);
    expect(s.handlePosition).toBe('middle');   // addModuleToArea 가 sink 에 주던 값 그대로
    expect(s.legH).toBe(0);
    expect(s.areaTypes).toEqual(['open']);
    expect(p.g('structures')[m.id]).toBeUndefined();
  });

  test('3D — 몸통·도어·상판 mesh 가 없고 표시 상자만 있다', () => {
    const p = boot();
    const m = sinkModule(p);
    const uds = meshesOf(p, m.id);
    expect(uds.length).toBeGreaterThan(0);
    const kinds = [...new Set(uds.map((u) => u.entityKind))];
    expect(kinds).toEqual(['marker']);
    CABINET_KINDS.forEach((k) => expect(kinds).not.toContain(k));
  });

  test('3D — 표시 상자는 모듈 외경 그대로이고 반투명이다', () => {
    const p = boot();
    const m = sinkModule(p);
    let marker = null;
    p.three.moduleGroup.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.entityKind === 'marker' && o.userData.moduleId === m.id) marker = o;
    });
    expect(marker).not.toBeNull();
    const prm = marker.geometry.parameters;
    expect([prm.width, prm.height, prm.depth]).toEqual([m.W, m.H, m.D]);
    expect(marker.material.transparent).toBe(true);
    expect(marker.material.opacity).toBeLessThan(1);
  });

  test('3D — 분배기 배치 공간 상자는 그대로 그려진다', () => {
    const p = boot();
    const area = p.g('areas').find((a) => a.section === 'sink');
    let found = false;
    p.three.moduleGroup.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.entityKind === 'area' && o.userData.areaId === area.id) found = true;
    });
    expect(found).toBe(true);
  });

  test('원장 — 분배기 모듈의 부재 행이 없다', () => {
    const p = boot();
    const m = sinkModule(p);
    const rows = collectSceneParts(p).filter((r) => r.moduleId === m.id);
    expect(rows).toEqual([]);
  });

  test('정면도 — 점선 사각형 + 이름만, 도어 칸은 없다', () => {
    const p = boot();
    const m = sinkModule(p);
    p.g('renderFrontView')();
    const rect = p.document.querySelector(`rect[data-marker="sink"][data-module-id="${m.id}"]`);
    expect(rect).not.toBeNull();
    expect(rect.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(Number(rect.getAttribute('width'))).toBe(m.W);
    const labels = [...p.document.querySelectorAll('#contentG text.area-label')].map((t) => t.textContent);
    expect(labels).toContain('분배기');
    // 다른 장의 도어 칸은 그대로 그려진다
    expect(p.document.querySelectorAll('#contentG rect.area-rect').length).toBeGreaterThan(0);
  });
});

describe('후드 — 같은 규칙', () => {
  test('기본 후드(300)는 예전처럼 비워 둔다 — 도어 최소폭 문턱은 그대로 (규칙을 새로 만들지 않는다)', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'marker', item: 'hood300' });
    expect(p.g('modules').filter((m) => m.section === 'hood')).toHaveLength(0);
  });

  test('넓은 후드 공간(900)에는 표시 모듈 하나 — 구조도 몸통도 없다', () => {
    const layout = JSON.parse(JSON.stringify(FIXTURES.straight));
    layout.modules.find((m) => m.section === 'hood').w = 900;
    const p = bootPlanner3D(layout, { design: 'marker', item: 'hood900' });
    const hoods = p.g('modules').filter((m) => m.section === 'hood');
    expect(hoods).toHaveLength(1);
    expect(hoods[0].W).toBe(900);
    expect(p.g('structures')[hoods[0].id]).toBeUndefined();
    const kinds = [...new Set(meshesOf(p, hoods[0].id).map((u) => u.entityKind))];
    expect(kinds).toEqual(['marker']);
    expect(collectSceneParts(p).filter((r) => r.moduleId === hoods[0].id)).toEqual([]);
  });
});

describe('다른 길로 들어온 표시 모듈도 같다', () => {
  function bootPlain(seed) {
    const st = Object.assign({}, seed);
    const search = st._search;
    delete st._search;
    const p = bootPlanner('mockup-structure.html', { search, storage: st });
    if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
    return p;
  }

  test('addModuleToArea 로 고정 분배기를 넣어도(연출컷 가져오기 경로) 구조가 생기지 않는다', () => {
    const p = bootPlain(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'sink');
    const m = p.g('addModuleToArea')(area.id, { section: 'sink', W: area.W, x: area.x });
    expect(m).not.toBeNull();
    m.isFixed = true;
    expect(p.g('structures')[m.id]).toBeUndefined();
    // 전체 자동계산은 고정 표시 모듈을 그대로 둔다
    p.g('autoCalcAllAreas')();
    expect(p.g('modules').filter((x) => x.section === 'sink')).toHaveLength(1);
    expect(p.g('structures')[m.id]).toBeUndefined();
  });

  test('이 결정 전에 저장된 분배기 구조는 열 때 버린다', () => {
    const seed = seedFor(FIXTURES.straight);
    const sinkId = modulesFromFixture(FIXTURES.straight).find((m) => m.section === 'sink').id;
    const lowerId = modulesFromFixture(FIXTURES.straight).find((m) => m.section === 'lower').id;
    seed['dadam_structure_v1::gold:1'] = JSON.stringify({
      [sinkId]: { verticalCount: 2, areaTypes: ['door', 'door'], areaDirections: ['left', 'right'], areaWidths: [350, 350], areaIs2D: [false, false], shelves: [200], handleType: 'channel', handlePosition: 'top' },
      [lowerId]: { verticalCount: 1, areaTypes: ['door'], areaDirections: ['left'], areaWidths: [], areaIs2D: [], shelves: [], handleType: 'auto', handlePosition: 'top' },
    });
    const p = bootPlain(seed);
    expect(p.g('structures')[sinkId]).toBeUndefined();
    expect(p.g('structures')[lowerId]).toBeDefined();   // 장의 구조는 그대로
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(payload.structures[sinkId]).toBeUndefined();
  });

  test('우측 패널 — 분배기를 고르면 치수만 있고 칸·선반·손잡이는 없다고 알린다', () => {
    const p = bootPlain(seedFor(FIXTURES.straight));
    const m = p.g('modules').find((x) => x.section === 'sink');
    p.g('setActiveModule')(m.id);
    p.g('renderRightPanel')();
    expect(p.document.getElementById('sizeBody').querySelector('input[data-dim]')).not.toBeNull();
    ['splitBody', 'shelvesBody', 'handleBody'].forEach((id) => {
      expect(p.document.getElementById(id).textContent).toContain('자리 표시');
    });
    expect(p.g('structures')[m.id]).toBeUndefined();
  });
});
