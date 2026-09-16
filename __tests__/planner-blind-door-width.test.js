/**
 * corner.md §3.5.2 (2026-09-15 결정): **멍장 도어는 목대를 덮는다.**
 *
 *   정면 셀 = [멍 = 멍W−15][도어 = doorW+15]
 *   도어 재단 = 도어 자리 − 갭 4 = doorW + 11        ← BOM (corner-engine blindDoorPartW)
 *
 * P2(#652) 까지 3D 는 도어를 목대 **옆**에 `doorW − 4` 로 앉혀 목대 15 가 정면에 드러났다 — 도면↔BOM 원장에
 * "멍장 정면 치수" 1건(3D 414 vs BOM 429)으로 남아 있던 그림이다. 이제 3D 도어 칸은 표준 도어처럼
 * `칸 폭 − 4 = doorW + 11` 이고, 2D 정면도(renderFrontView)도 같은 값이라 도면·3D·BOM 이 한 값이다.
 *
 * 2D 정면도는 원장(scene-bom-ledger)이 보지 않으므로 여기서 따로 잠근다.
 */
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');
const { bootPlanner3D, collectSceneParts } = require('../test-utils/scene-parts');

const R = engine.MASTER_RULES;
const LOWER_D = 650;

/** ㄱ자 — 가로 3600(회전 0) + 세로 1970(회전 90). scene-bom-ledger.test.js 의 cornerL 과 같다 */
function lShapeLayout() {
  const legW = 1970;
  return {
    version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: LOWER_D / 2 - legW / 2, y: legW / 2 - LOWER_D / 2,
        w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
    ],
  };
}

/** 멍장 도어 재단 폭 — corner-engine `blindDoorPartW` 와 같은 식 (플래너는 detaildesign 스크립트를 안 싣는다) */
function blindDoorPartW(doorW) {
  return doorW + R.CORNER_HINGE_BATTEN_T - R.DOOR_GAP;
}

describe('멍장 도어 폭 = doorW + 11 — 도어가 목대를 덮는다 (corner.md §3.5.2)', () => {
  test('식 자체: 목대 15 − 갭 4 = +11', () => {
    expect(R.CORNER_HINGE_BATTEN_T).toBe(15);
    expect(R.DOOR_GAP).toBe(4);
    expect(blindDoorPartW(411)).toBe(422);
  });

  test('2D 정면도: 멍장 도어 rect 폭 = doorW + 11, 갭은 좌우 2 (멍 칸 rect 는 갭 없이 칸 폭 그대로)', () => {
    const p = bootPlanner('mockup-structure.html', {
      search: '?design=d1&item=1',
      storage: { 'dadam_layout_v1::d1:1': JSON.stringify(lShapeLayout()) },
    });
    if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
    p.g('autoCalcAllAreas')();
    const m = (p.g('modules') || []).find((x) => x.blind);
    expect(m).toBeTruthy();
    const s = p.g('structures')[m.id];
    const bi = s.areaTypes.indexOf('blind');
    const di = s.areaTypes.indexOf('door');
    expect(bi).toBeGreaterThanOrEqual(0);
    expect(di).toBeGreaterThanOrEqual(0);
    expect(s.areaWidths[di]).toBe(m.blind.doorW + R.CORNER_HINGE_BATTEN_T);   // 도어 칸 = doorW + 목대 15

    p.g('setActiveArea')(p.g('cornerPairs')()[0].owner.id);
    p.g('renderFrontView')();
    const cell = (idx) => p.document.querySelector(`#contentG rect.area-rect[data-cell-of="${m.id}"][data-cell-idx="${idx}"]`);
    const doorRect = cell(di);
    expect(doorRect).toBeTruthy();
    expect(+doorRect.getAttribute('width')).toBe(blindDoorPartW(m.blind.doorW));   // doorW + 11

    // 자리: 도어 칸 안에서 좌우 2 씩 — 목대 15 는 도어 뒤에 있어 정면엔 없다
    const xs = [];
    let acc = 0;
    s.areaWidths.forEach((w) => { xs.push(acc); acc += w; });
    const cellX0 = +doorRect.getAttribute('x') - R.DOOR_GAP / 2;
    const modX0 = cellX0 - xs[di];
    const blindRect = cell(bi);
    expect(blindRect).toBeTruthy();
    // 멍 칸: 표준 rect 는 갭 2 를 뺀 채 남지만 그 위에 멍가림판 box 가 칸 폭 그대로(갭 없음) 덮인다 — 멍 rect 폭 확인
    const covers = [...p.document.querySelectorAll('#contentG rect')]
      .filter((q) => q.getAttribute('pointer-events') === 'none')
      .map((q) => ({ x: +q.getAttribute('x'), w: +q.getAttribute('width') }));
    const zoneW = m.blind.zoneW;
    const coverW = zoneW - R.CORNER_HINGE_BATTEN_T;
    const cover = covers.find((q) => Math.abs(q.w - coverW) < 0.5 && Math.abs(q.x - (modX0 + xs[bi])) < 0.5);
    expect(cover).toBeTruthy();                                                   // 멍판 = 멍W − 15, 갭 없음
    // 마감재 끝(= 멍 칸 끝) 과 도어 사이는 갭 2 뿐
    const coverEnd = di > bi ? cover.x + cover.w : cover.x;
    const doorEdge = di > bi ? +doorRect.getAttribute('x') : +doorRect.getAttribute('x') + +doorRect.getAttribute('width');
    expect(Math.abs(doorEdge - coverEnd)).toBeCloseTo(R.DOOR_GAP / 2, 5);
  });

  test('3D: 멍장 도어 mesh 폭 = doorW + 11 · 멍가림판 = (멍W − 15) × 몸통 H (P2-5 그대로) — 원장(BOM 429)과 같다', () => {
    const p = bootPlanner3D(lShapeLayout(), { design: 'blind-door-w', item: '1' });
    const m = (p.g('modules') || []).find((x) => x.blind);
    expect(m).toBeTruthy();
    const parts = collectSceneParts(p).filter((r) => r.moduleId === m.id);
    const doors = parts.filter((r) => r.family === 'door');
    expect(doors.length).toBe(1);
    expect(doors[0].qty).toBe(1);
    expect(doors[0].b).toBe(blindDoorPartW(m.blind.doorW));                     // 폭 = doorW + 11
    expect(doors[0].b).not.toBe(m.blind.doorW - R.DOOR_GAP);                    // 옛 P2 그림(doorW − 4)이 아니다
    const cover = parts.find((r) => r.family === 'blind');
    expect(cover).toBeTruthy();
    expect(cover.b).toBe(m.blind.zoneW - R.CORNER_HINGE_BATTEN_T);               // 멍가림판 폭 = 멍W − 15 (갭 없음)
    const carcassH = p.g('bodyHeightOf')(m, p.g('structures')[m.id]);
    expect(cover.a).toBe(carcassH);                                               // 높이 = 몸통 H (P2-5 그대로)
    // 정면 원장: 멍가림판 + (도어 + 갭 4) = 멍장 W (corner.md §3.5.2)
    expect(cover.b + doors[0].b + R.DOOR_GAP).toBe(Math.round(m.W));
  });
});
