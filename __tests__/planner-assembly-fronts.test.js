/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, beforeAll */
/**
 * CAD 베타 PR13 — 앞판(도어·서랍 전면) · 서랍장 중간 목찬넬 · 서랍 박스 판을 조립 명세로 (planner-assembly-mesh.js).
 *
 * 완료 기준 (docs/01-plan/planner-cad.plan.md PR13):
 *   · 서랍 전면마다 id 가 하나씩 다르다
 *   · collectSceneParts 가 userData.partId 를 읽는다 (행마다 partIds)
 * 그리고 — 앞판 자리·크기와 마감 칠하기 이름(planner-finish.js partKey)은 예전 그리기와 같다,
 *   서랍 박스는 예전 덩어리 한 개 대신 명세 판재(5판 + 박스 처짐방지),
 *   명세가 못 놓은 묶음(서랍장 처짐방지목 D2)은 그 묶음만 예전 그리기.
 * 합성 데이터만 (planner-golden.js 배치).
 */
global.dlog = global.dlog || (() => {});
const THREE = require('three');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectSceneParts } = require('../test-utils/scene-parts');
const finish = require('../js/planner/planner-finish.js');

const EPS = 0.01;
const SKIP = ['edge', 'reveal', 'doorEdge', 'carcass-line', 'pick', 'area', 'module', 'leg', 'marker'];

function groupOf(p, id) {
  return p.three.moduleGroup.children.find((g) => g.userData && g.userData.entityKind === 'module' && String(g.userData.moduleId) === String(id));
}

/** 모듈 로컬 AABB 를 갖춘 부재 메시 목록 */
function partsOf(p, id) {
  const g = groupOf(p, id);
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const out = [];
  g.traverse((o) => {
    if (!o.isMesh || !o.userData || SKIP.indexOf(o.userData.entityKind) >= 0) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    geo.computeBoundingBox();
    out.push({ ud: o.userData, min: geo.boundingBox.min.toArray(), max: geo.boundingBox.max.toArray(), key: finish.plannerFinishPartKeyOf(o.userData) });
  });
  return out;
}

const fronts = (list) => list.filter((x) => x.ud.side === 'front' && x.ud.areaType !== 'open');
const sameBox = (a, b) => [0, 1, 2].every((i) => Math.abs(a.min[i] - b.min[i]) < EPS && Math.abs(a.max[i] - b.max[i]) < EPS);
const sortByKey = (list) => list.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.min[0] - b.min[0]));

describe('straight — 도어는 명세 판재, 자리·크기·칠하기 이름은 예전과 같다', () => {
  let asm, old;
  beforeAll(() => {
    asm = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true });
    old = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight' });
  });

  test('명세로 그린 모듈의 앞판은 전부 명세 판재 (assembly · partId)', () => {
    const mods = asm.g('modules').filter((m) => m.section === 'lower' || m.section === 'upper');
    let n = 0;
    mods.forEach((m) => fronts(partsOf(asm, m.id)).forEach((f) => {
      expect(f.ud.assembly).toBe(true);
      expect(typeof f.ud.partId).toBe('string');
      n++;
    }));
    expect(n).toBeGreaterThan(10);
  });

  test.each(['lower-0', 'lower-1', 'lower-2', 'lower-3', 'lower-4', 'upper-0', 'upper-1', 'upper-2', 'upper-3'])('%s 앞판 AABB · partKey = 예전 그리기', (id) => {
    const a = sortByKey(fronts(partsOf(asm, id)));
    const o = sortByKey(fronts(partsOf(old, id)));
    expect(a.map((x) => x.key)).toEqual(o.map((x) => x.key));
    a.forEach((x, i) => expect(sameBox(x, o[i])).toBe(true));
  });

  test('도어를 끄면 명세 앞판도 그리지 않는다', () => {
    asm.g('setDoorVisible')(false);
    asm.g('renderAll3D')({ fit: false });
    expect(fronts(partsOf(asm, 'lower-0'))).toHaveLength(0);
    asm.g('setDoorVisible')(true);
    asm.g('renderAll3D')({ fit: false });
    expect(fronts(partsOf(asm, 'lower-0')).length).toBeGreaterThan(0);
  });

  test('collectSceneParts 가 partId 를 읽는다 — 명세 판재 행에 partIds, 서로 다르다', () => {
    const rows = collectSceneParts(asm);
    const doors = rows.filter((r) => r.family === 'door');
    expect(doors.length).toBeGreaterThan(0);
    doors.forEach((r) => expect(r.partIds).toHaveLength(r.qty));
    const all = rows.flatMap((r) => r.partIds);
    expect(new Set(all).size).toBe(all.length);
    expect(rows.filter((r) => r.family === 'body:side').every((r) => r.partIds.length === r.qty)).toBe(true);
  });
});

describe('서랍장 (도어 + 서랍 2단, 목찬넬) — 서랍 전면 · 중간 목찬넬 · 서랍 박스 판', () => {
  let asm, old;
  const ID = 'lower-2';
  const drawerise = (p) => {
    Object.assign(p.g('getStructure')(ID), { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200, drawerCount: 2 });
    p.g('renderAll3D')({ fit: false });
  };
  beforeAll(() => {
    asm = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true });
    old = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight' });
    drawerise(asm);
    drawerise(old);
  });

  test('서랍 전면마다 id 가 하나씩 다르다 (명세 판재)', () => {
    const drawers = partsOf(asm, ID).filter((x) => x.ud.areaType === 'drawer');
    expect(drawers).toHaveLength(2);
    drawers.forEach((d) => expect(d.ud.assembly).toBe(true));
    expect(new Set(drawers.map((d) => d.ud.partId)).size).toBe(2);
    expect(drawers.map((d) => d.ud.drawerIdx).sort()).toEqual([0, 1]);
  });

  test('앞판 AABB · partKey = 예전 그리기 (도어 2 · 서랍 2)', () => {
    const a = sortByKey(fronts(partsOf(asm, ID)));
    const o = sortByKey(fronts(partsOf(old, ID)));
    expect(a).toHaveLength(4);
    expect(a.map((x) => x.key)).toEqual(o.map((x) => x.key));
    a.forEach((x, i) => expect(sameBox(x, o[i])).toBe(true));
  });

  test('중간 목찬넬 ㄴ자 두 장 = 예전 그리기 자리', () => {
    const mid = (list) => sortByKey(list.filter((x) => x.ud.mid != null && (x.ud.side === 'channelFace' || x.ud.side === 'channelBase')));
    const a = mid(partsOf(asm, ID));
    const o = mid(partsOf(old, ID));
    expect(a).toHaveLength(2);
    a.forEach((x) => expect(x.ud.assembly).toBe(true));
    expect(a.map((x) => x.key)).toEqual(o.map((x) => x.key));
    a.forEach((x, i) => expect(sameBox(x, o[i])).toBe(true));
  });

  test('서랍 박스 — 예전 덩어리 대신 박스마다 명세 판재 6장 (앞·뒤 · 좌·우 · 바닥 · 박스 처짐방지)', () => {
    const boxes = partsOf(asm, ID).filter((x) => x.ud.entityKind === 'drawerBox');
    expect(boxes.every((b) => b.ud.assembly)).toBe(true);
    [1, 2].forEach((k) => {
      const mine = boxes.filter((b) => b.ud.drawerIdx === k);
      expect(mine.map((b) => b.ud.boxPart).sort()).toEqual(['bottom', 'brace', 'fb', 'fb', 'side', 'side']);
      const block = partsOf(old, ID).find((x) => x.ud.entityKind === 'drawerBox' && x.ud.drawerIdx === k);
      expect(block).toBeTruthy();
      // 앞·뒤 · 좌·우 판은 예전 박스 덩어리(외경) 그대로. 바닥판 · 박스 처짐방지는 2026-10-20 짜임대로 측판 밑에 붙는다
      //   (bom-assembly.js drawerBoxesOf — 바닥은 측판 아래, 처짐방지는 바닥 아래) — 예전 덩어리는 이 둘을 그리지 않았다
      mine.filter((b) => b.ud.boxPart === 'fb' || b.ud.boxPart === 'side').forEach((b) => [0, 1, 2].forEach((i) => {
        expect(b.min[i]).toBeGreaterThanOrEqual(block.min[i] - EPS);
        expect(b.max[i]).toBeLessThanOrEqual(block.max[i] + EPS);
      }));
      const sides = mine.filter((b) => b.ud.boxPart === 'side');
      expect(Math.min(...sides.map((b) => b.min[1]))).toBeCloseTo(block.min[1], 6);
      mine.filter((b) => b.ud.boxPart === 'bottom' || b.ud.boxPart === 'brace')
        .forEach((b) => expect(b.max[1]).toBeLessThanOrEqual(block.min[1] + EPS));
    });
  });

  test('명세가 못 놓은 처짐방지목(D2)은 예전 그리기로 남는다', () => {
    const braces = partsOf(asm, ID).filter((x) => x.ud.entityKind === 'brace');
    expect(braces).toHaveLength(1);
    expect(braces[0].ud.assembly).toBeUndefined();
  });

  test('서랍장 선반 — BOM 에 행이 없어 그리지 않는다 (예전 그리기는 s.shelves 로 그렸다)', () => {
    expect(partsOf(asm, ID).filter((x) => x.ud.entityKind === 'shelf')).toHaveLength(0);
    expect(partsOf(old, ID).filter((x) => x.ud.entityKind === 'shelf').length).toBeGreaterThan(0);
  });
});

describe('도어 칸이 아니면 앞판은 예전 그리기', () => {
  test('오픈 칸 — 명세 앞판이 없고 예전 오픈 틀(와이어)이 선다', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true });
    const s = p.g('getStructure')('lower-1');
    s.areaTypes = ['open'];
    p.g('renderAll3D')({ fit: false });
    const list = partsOf(p, 'lower-1');
    expect(list.filter((x) => x.ud.side === 'front' && x.ud.assembly)).toHaveLength(0);
    expect(list.filter((x) => x.ud.side === 'front' && x.ud.areaType === 'open')).toHaveLength(1);
  });
});
