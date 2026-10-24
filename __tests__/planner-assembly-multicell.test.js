/**
 * 2026-10-24 사장님 D1 (a) — 다칸 모듈은 **칸마다 별도 상자** (지금 BOM 그대로).
 *   3D 도 조립 명세로 칸마다 상자를 그린다 (측판 둘 · 지판 · 뒷판 · 선반 · 도어가 칸마다). 한 몸통 + 칸막이(예전 그리기)는
 *   명세가 칸 하나라도 못 그릴 때만. 합성 배치만 (planner-golden.js).
 */
global.dlog = global.dlog || (() => {});
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D } = require('../test-utils/scene-parts');
const Mesh = require('../js/planner/planner-assembly-mesh.js');

function meshesOf(p, id, pred) {
  const out = [];
  p.three.moduleGroup.traverse((o) => {
    if (o.isMesh && o.userData && String(o.userData.moduleId) === id && (!pred || pred(o.userData))) out.push(o);
  });
  return out;
}

/** straight 의 하부 lower-2 를 3칸(도어)으로 */
function bootThreeCells(extra) {
  const p = bootPlanner3D(FIXTURES.straight, Object.assign({ design: 'ledger', item: 'multiCell', assembly: true }, extra || {}));
  const s = p.g('getStructure')('lower-2');
  s.verticalCount = 3;
  s.areaWidths = [333, 333, 334];   // 자동계산이 정한 칸 폭 (비우면 브리지가 통짜로 본다 — '자동계산 전' 경고)
  s.areaTypes = ['door', 'door', 'door'];
  s.areaIs2D = [false, false, false];
  p.g('renderAll3D')({ fit: false });
  return p;
}

describe('plannerAssemblyCellsFor', () => {
  const hit = (mk, dx) => ({ mk, dx });
  test('칸이 둘 이상이고 칸 수가 맞을 때만, dx 순서', () => {
    const asm = {
      spec: { items: [{ modules: ['0-planner-X-0', '0-planner-X-1'].map((moduleKey) => ({ moduleKey, parts: [{ id: moduleKey + '-body:side-0#0', rowPartId: moduleKey + '-body:side-0', tags: { side: 'left' } }] })) }], unplaced: [] },
      cells: { '0-planner-X-1': { plannerId: 'X', dx: 200 }, '0-planner-X-0': { plannerId: 'X', dx: -200 } },
    };
    const r = Mesh.plannerAssemblyCellsFor(asm, 'X', 2);
    expect(r.map((h) => [h.module.moduleKey, h.dx])).toEqual([['0-planner-X-0', -200], ['0-planner-X-1', 200]]);
    expect(Mesh.plannerAssemblyCellsFor(asm, 'X', 3)).toBeNull();     // 칸 수가 다르다 (잔여 칸을 뺐다 등)
    expect(Mesh.plannerAssemblyModuleFor(asm, 'X')).toBeNull();      // 한 칸 함수는 다칸을 받지 않는다
    void hit;
  });
});

describe('다칸 모듈 3D = 칸마다 상자 (D1 a)', () => {
  let p;
  beforeAll(() => { p = bootThreeCells(); });

  test('명세 판재로 그리고 칸막이는 없다 — 측판 좌 3 · 우 3', () => {
    const all = meshesOf(p, 'lower-2');
    expect(all.some((o) => o.userData.assembly)).toBe(true);
    expect(meshesOf(p, 'lower-2', (ud) => ud.side === 'divider')).toHaveLength(0);
    const sides = meshesOf(p, 'lower-2', (ud) => ud.assembly && ud.entityKind === 'carcass' && (ud.side === 'left' || ud.side === 'right'));
    expect(sides.filter((o) => o.userData.side === 'left')).toHaveLength(3);
    expect(sides.filter((o) => o.userData.side === 'right')).toHaveLength(3);
  });

  test('도어는 칸마다 한 장, 칸 번호(areaIdx) 0 · 1 · 2 — 예전 그리기와 같은 이름', () => {
    const doors = meshesOf(p, 'lower-2', (ud) => ud.assembly && ud.areaType === 'door');
    expect(doors.map((o) => o.userData.areaIdx).sort()).toEqual([0, 1, 2]);
  });

  test('칸 상자는 BOM 칸 모듈과 같은 판재 — 명세 모듈 3개가 그 자리에', () => {
    const asm = p.g('plannerCadSpec')();
    const cells = Mesh.plannerAssemblyCellsFor(asm, 'lower-2', 3);
    expect(cells).toHaveLength(3);
    const ids = new Set(meshesOf(p, 'lower-2', (ud) => ud.assembly).map((o) => o.userData.partId));
    cells.forEach((c) => c.groups.shell.forEach((pt) => expect(ids.has(pt.id)).toBe(true)));
    // 칸 상자 가운데가 왼쪽→오른쪽으로 놓인다
    const holders = [];
    p.three.moduleGroup.traverse((o) => { if (o.userData && o.userData.entityKind === 'assembly-holder' && o.userData.moduleId === 'lower-2') holders.push(o.position.x); });
    expect(holders).toHaveLength(3);
    expect(holders).toEqual(cells.map((c) => c.dx));
  });

  test('?asm=0 이면 예전 그리기 (한 몸통 + 칸막이 2)', () => {
    const q = bootThreeCells({ searchExtra: '&asm=0' });
    expect(meshesOf(q, 'lower-2', (ud) => ud.assembly)).toHaveLength(0);
    expect(meshesOf(q, 'lower-2', (ud) => ud.side === 'divider')).toHaveLength(2);
  });
});
