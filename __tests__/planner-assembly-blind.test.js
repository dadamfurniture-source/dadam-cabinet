/**
 * 2026-10-25 — 멍장도 3D 를 조립 명세로 그린다.
 *   몸통(측판 · 지판 · 밴드 · 뒷판) · ㄱ자 경첩목대 · 처짐방지목 · 선반은 명세 판재, 정면(멍가림판 · 멍판 마감재 · 도어)은 예전 그리기.
 *   멍장마다 벽 쪽이 다르다 — ㄷ자는 두 멍장이 서로 반대 (브리지 blindDoorRight, #1054). 목대는 도어 쪽 칸 경계에 선다.
 *   합성 배치만 (planner-corner-blind.test.js uShapeLayout 과 같은 모양).
 */
global.dlog = global.dlog || (() => {});
const { bootPlanner3D } = require('../test-utils/scene-parts');

const LOWER_D = 650;
/** ㄷ자 하부 — 가로 3600 · 세로 2800 · 가로 3000 (planner-corner-blind.test.js uShapeLayout(2800)) */
const U_SHAPE = {
  version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null,
  modules: [
    { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: LOWER_D / 2 - 2800 / 2, y: 2800 / 2 - LOWER_D / 2, w: 2800, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
    { section: 'lower', x: 0, y: 2800 - LOWER_D, w: 3000, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
  ],
};

function meshesOf(p, id, pred) {
  const out = [];
  p.three.moduleGroup.traverse((o) => {
    if (o.isMesh && o.userData && String(o.userData.moduleId) === id && (!pred || pred(o.userData))) out.push(o);
  });
  return out;
}
/** 모듈 로컬 x 범위 — 메쉬 위치(홀더 안이면 홀더 위치 더함) ± 기하 폭/2 */
function xSpanOf(o) {
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox;
  let x = o.position.x;
  if (o.parent && o.parent.userData && o.parent.userData.entityKind === 'assembly-holder') x += o.parent.position.x;
  return [Math.round(x + b.min.x), Math.round(x + b.max.x)];
}

describe('멍장 3D = 조립 명세 (2026-10-25)', () => {
  let p, q, blinds;
  beforeAll(() => {
    p = bootPlanner3D(U_SHAPE, { item: 'uShape', assembly: true });
    q = bootPlanner3D(U_SHAPE, { item: 'uShape', assembly: true, searchExtra: '&asm=0' });
    blinds = p.g('buildPlannerPayload')('PLANNER_DONE').modules.filter((m) => m.blind);
  });

  test('ㄷ자 멍장 둘 — 벽 쪽이 서로 반대', () => {
    expect(blinds).toHaveLength(2);
    const firsts = blinds.map((m) => p.g('getStructure')(m.id).areaTypes[0]).sort();
    expect(firsts).toEqual(['blind', 'door']);
  });

  test('몸통 · 경첩목대 · 선반은 명세 판재, 칸막이 없음', () => {
    blinds.forEach((m) => {
      const asm = meshesOf(p, m.id, (ud) => ud.assembly);
      const kinds = new Set(asm.map((o) => String(o.userData.side || o.userData.entityKind).split('#')[0]));
      ['left', 'right', 'bottom', 'band', 'back', 'batten', 'shelf'].forEach((k) => expect(kinds.has(k)).toBe(true));
      expect(meshesOf(p, m.id, (ud) => ud.side === 'divider')).toHaveLength(0);
      // 예전 몸통 · 예전 목대는 그리지 않는다 (두 번 그리지 않는다)
      expect(meshesOf(p, m.id, (ud) => !ud.assembly && (ud.side === 'batten' || ud.side === 'left' || ud.side === 'right'))).toHaveLength(0);
    });
  });

  test('경첩목대는 예전 그리기와 같은 칸 경계에 선다 — 벽이 오른쪽인 멍장도 뒤집히지 않는다', () => {
    blinds.forEach((m) => {
      ['front', 'side'].forEach((leg) => {
        const a = meshesOf(p, m.id, (ud) => ud.assembly && ud.side === 'batten' && ud.leg === leg);
        const b = meshesOf(q, m.id, (ud) => !ud.assembly && ud.side === 'batten' && ud.leg === leg);
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
        const [a0, a1] = xSpanOf(a[0]), [b0, b1] = xSpanOf(b[0]);
        expect(Math.abs(a0 - b0)).toBeLessThanOrEqual(1);
        expect(Math.abs(a1 - b1)).toBeLessThanOrEqual(1);
      });
    });
  });

  test('정면은 예전 그리기 — 멍가림판 · 도어 한 벌', () => {
    blinds.forEach((m) => {
      expect(meshesOf(p, m.id, (ud) => ud.assembly && (ud.areaType === 'door' || ud.areaType === 'blind'))).toHaveLength(0);
      expect(meshesOf(p, m.id, (ud) => !ud.assembly && ud.areaType === 'door').length).toBeGreaterThan(0);
    });
  });
});
