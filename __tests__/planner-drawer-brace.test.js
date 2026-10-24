/**
 * 2026-10-25 사장님 D2 (b) — 전부 서랍인 서랍장(위 칸도 서랍)은 처짐방지목이 없다 (BOM extractors bomAllDrawers 와 같다).
 *   3D 예전 그리기(addBraces)도, 조립 명세 그리기도 처짐방지목을 그리지 않는다. 위 도어 + 아래 서랍 · 일반 양문은 그대로.
 *   합성 배치만 (planner-golden.js straight — lower-2 폭 1000).
 */
global.dlog = global.dlog || (() => {});
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D } = require('../test-utils/scene-parts');

function bracesOf(p, id) {
  const out = [];
  p.three.moduleGroup.traverse((o) => {
    if (o.isMesh && o.userData && String(o.userData.moduleId) === id && o.userData.entityKind === 'brace') out.push(o);
  });
  return out;
}

/** lower-2 를 서랍 모듈로 — topDrawer 면 전부 서랍, 아니면 위 도어 + 아래 서랍 */
function boot(topDrawer, extra) {
  const p = bootPlanner3D(FIXTURES.straight, Object.assign({ design: 'ledger', item: 'drawerBrace', assembly: true }, extra || {}));
  const s = p.g('getStructure')('lower-2');
  if (topDrawer != null) {
    Object.assign(s, { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 3 });
    s.drawer = Object.assign({}, s.drawer || {}, { topDrawer });
  }
  p.g('renderAll3D')({ fit: false });
  return p;
}

describe('서랍 모듈 처짐방지목 (D2)', () => {
  test.each([['명세', ''], ['예전 그리기', '&asm=0']])('전부 서랍 1000 — 처짐방지목 없음 (%s)', (_, q) => {
    expect(bracesOf(boot(true, { searchExtra: q }), 'lower-2')).toHaveLength(0);
  });
  test.each([['명세', ''], ['예전 그리기', '&asm=0']])('일반 양문 1000 — 1장 그대로 (%s)', (_, q) => {
    expect(bracesOf(boot(null, { searchExtra: q }), 'lower-2')).toHaveLength(1);
  });
});
