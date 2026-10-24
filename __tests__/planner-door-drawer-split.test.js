/**
 * 2026-10-25 사장님 — 위 도어 + 아래 서랍은 **각각의 모듈(두 몸통)** 로 나누어 만든다 (bom-drawer-rules layout.split).
 *   도어 밑에 중간 목찬넬이 있으면(서랍 1 · 3단) 그 따내기 윗선에서, 없으면(2 · 4단) 도어와 첫 서랍 사이에서 나눈다.
 *   3D 는 명세로도, 예전 그리기(?asm=0)로도 몸통 둘을 그린다 — 측판 넷 · 지판 둘, 처짐방지목은 도어 모듈 안.
 *   합성 배치만 (planner-golden.js straight — lower-2 폭 1000, 몸통 708).
 */
global.dlog = global.dlog || (() => {});
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D } = require('../test-utils/scene-parts');

function meshesOf(p, id, pred) {
  const out = [];
  p.three.moduleGroup.traverse((o) => {
    if (o.isMesh && o.userData && String(o.userData.moduleId) === id && pred(o.userData)) out.push(o);
  });
  return out;
}
function yRangeOf(THREE, o) {
  o.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(o);
  return [Math.round(b.min.y), Math.round(b.max.y)];
}

function boot(drawerCount, extra) {
  const p = bootPlanner3D(FIXTURES.straight, Object.assign({ design: 'ledger', item: 'split' + drawerCount, assembly: true }, extra || {}));
  const s = p.g('getStructure')('lower-2');
  Object.assign(s, { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount });
  p.g('renderAll3D')({ fit: false });
  return p;
}

describe.each([['명세', ''], ['예전 그리기', '&asm=0']])('위 도어 + 아래 서랍 = 두 몸통 (%s)', (_, q) => {
  test.each([1, 2])('서랍 %i단 — 측판 넷 · 지판 둘, 나눈 자리에서 위아래로', (n) => {
    const p = boot(n, { searchExtra: q });
    const THREE = window.THREE;
    const m = p.g('modules').find((x) => x.id === 'lower-2');
    const L = p.g('drawerLayoutFor')(m, p.g('getStructure')('lower-2'));
    expect(L.split).toBeTruthy();
    expect(L.split.viaMid).toBe(n === 1);   // 서랍 1단은 도어 밑 중간 목찬넬에서 나눈다
    const legH = 150;
    const sides = meshesOf(p, 'lower-2', (ud) => ud.entityKind === 'carcass' && ud.side === 'left');
    expect(sides.map((o) => yRangeOf(THREE, o)).sort((a, b) => a[0] - b[0])).toEqual([
      [legH, legH + L.split.drawerH], [legH + L.split.drawerH, legH + 708],
    ]);
    expect(meshesOf(p, 'lower-2', (ud) => ud.entityKind === 'carcass' && ud.side === 'bottom')).toHaveLength(2);
    // 처짐방지목 — 도어 모듈 지판 위부터
    const br = meshesOf(p, 'lower-2', (ud) => ud.entityKind === 'brace');
    expect(br).toHaveLength(1);
    expect(yRangeOf(THREE, br[0])[0]).toBe(legH + L.split.drawerH + 15);
  });
});
