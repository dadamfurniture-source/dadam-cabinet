/**
 * W12-72: 코너에서 **모듈끼리 맞닿는다.**
 *
 *   배치 공간은 상판 기준이라 서로 겹치지 않게 그린다. 그런데 몸통은 앞선에서
 *   물끊기 10 + 도어 자리 20 만큼 물러나 앉는다(seatModuleDepth). 도어 자재가
 *   18T 라 앞선과 도어 앞면 사이에 **12 의 공기층**이 남는다.
 *
 *   그래서 상판끼리 맞닿아도 몸통은 12 떠 보였다 — 하부장도 상부장도 같은 이유.
 *   이제 옆 라인이 그 12 를 메운다. 상판(배치 공간)은 그대로 두고 몸통만
 *   앞으로 내미는 것이라, 배치 공간 밖으로 나가는 것을 허용하되 20 을 넘지 않는다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const engine = require('../js/planner/planner-engine.js');
const R = engine.MASTER_RULES;

/** 겹치지 않게 그린 ㄱ자 — 프라임(가로, 벽은 위) + 트리밍(세로, 오른쪽 벽) */
function LSHAPE(section, D, H) {
  // 세로 다리를 rot90 으로 놓으면 평면 상자가 [2300..3000] × [D..(D+1500)] 이 된다.
  const W = 1500;
  return [
    { section, x: 0, y: 0, w: 3000, h: D, moduleH: H, rotation: 0, finishings: [] },
    { section, x: 3000 - D / 2 - W / 2, y: D + W / 2 - D / 2,
      w: W, h: D, moduleH: H, rotation: 90, finishings: [] },
  ];
}
function boot(mods) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify({
      version: 1, savedAt: '2026-09-10T00:00:00.000Z', person: { cx: 1200, cy: 2600 }, modules: mods }) },
  });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}
/** 트리밍(인접) 라인의 코너 쪽 첫 모듈이 어디서 시작하나 — 평면 y */
function adjHeadY(p) {
  const pair = p.g('cornerPairs')()[0];
  const mods = p.g('modules').filter((m) => m.areaId === pair.adj.id && !m.isFinishing);
  return Math.min(...mods.map((m) => p.g('modulePlaneBox')(m).y));
}

describe('앞선 공기층은 12 다', () => {
  test('물끊기 10 + 도어 자리 20 − 도어 두께 18', () => {
    expect(engine.cornerFrontAir()).toBe(12);
    expect(R.CORNER_DRIP + R.DOOR_SEAT_D - R.DOOR_T).toBe(12);
  });

  test('배치 공간 밖으로 나갈 수 있는 한계는 20 이다', () => {
    expect(R.CORNER_AREA_OVERRUN).toBe(20);
    expect(engine.cornerFrontAir()).toBeLessThanOrEqual(R.CORNER_AREA_OVERRUN);
  });
});

describe('하부장 ㄱ자 — 몸통끼리 붙는다', () => {
  const mods = () => LSHAPE('lower', 700, 870);

  test('트리밍 라인이 프라임 도어 면(688)에서 시작한다 — 예전엔 700', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    expect(adjHeadY(p)).toBe(700 - 12);
  });

  test('밀림은 음수 — 배치 공간 밖으로 12 나간다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const off = p.g('adjCornerOffsetOf')(p.g('cornerPairs')()[0].adj.id);
    expect(off).toMatchObject({ air: 12, need: 688, already: 700, offset: -12 });
  });

  test('원장이 맞는다 — 나간 만큼이 예약에서 빠진다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    p.g('areas').filter((a) => !a.isFinishing).forEach((a) => {
      const L = p.g('cornerLedger')(a.id);
      if (L) { expect(Math.abs(L.diff)).toBeLessThanOrEqual(1); expect(L.missing).toBe(0); }
    });
  });

  test('붙였는데 겹치지는 않는다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });
});

describe('민 만큼은 도어 분배가 먹는다 — 반대편이 비지 않는다', () => {
  const mods = () => LSHAPE('lower', 700, 870);

  /** 트리밍 라인의 **코너 반대쪽** 끝과 배치 공간 끝 사이 거리 */
  function farEndGap(p) {
    const pair = p.g('cornerPairs')()[0];
    const area = p.g('areas').find((a) => a.id === pair.adj.id);
    const AB = p.g('planeBoxOf')(area);
    const ms = p.g('modules').filter((m) => m.areaId === pair.adj.id && !m.isFinishing);
    const end = Math.max(...ms.map((m) => { const B = p.g('modulePlaneBox')(m); return B.y + B.d; }));
    return (AB.y + AB.d) - end;
  }

  test('반대쪽 끝이 배치 공간 끝에 정확히 닿는다 — 빈 자리 0', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    expect(farEndGap(p)).toBe(0);
  });

  test('나간 12 가 모듈 폭 합에 들어간다 — 원장이 그것을 말한다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const pair = p.g('cornerPairs')()[0];
    const L = p.g('cornerLedger')(pair.adj.id);
    expect(L.reserved).toBe(-12);          // 예약이 음수 = 밖으로 나간 만큼
    expect(L.sum).toBe(L.areaW + 12);      // 모듈 합이 배치 공간보다 12 크다
    expect(L.diff).toBe(0);
  });

  test('도어 폭이 그만큼 커진다 — 잔여로 남지 않는다', () => {
    // 분배는 넓어진 room 을 그대로 받는다. 1500 → [1000, 500], 1512 → [1008, 504].
    const bare = engine.distributeModules(1500);
    const wide = engine.distributeModules(1500 + engine.cornerFrontAir());
    expect(bare.modules.map((m) => m.w)).toEqual([1000, 500]);
    expect(wide.modules.map((m) => m.w)).toEqual([1008, 504]);
    expect(bare.gap).toBe(0);
    expect(wide.gap).toBe(0);

    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const pair = p.g('cornerPairs')()[0];
    const ws = p.g('modules').filter((m) => m.areaId === pair.adj.id && !m.isFinishing)
      .map((m) => Math.round(m.W)).sort((x, y) => y - x);
    expect(ws).toEqual([1008, 504]);
  });
});

describe('상부장도 같은 이유로 떠 있었다 — 같이 붙는다', () => {
  const mods = () => LSHAPE('upper', 320, 780);

  test('트리밍 라인이 프라임 도어 면(308)에서 시작한다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    expect(adjHeadY(p)).toBe(320 - 12);
  });

  test('겹치지 않는다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });
});

describe('공기층은 주인의 도어 쪽에만 있다', () => {
  test('벽 쪽에 붙는 다리는 12 를 빼지 않는다 — 빼면 파고든다', () => {
    // 가로가 rot180 이면 도어는 −y, 벽은 +y. 세로 다리는 +y(벽 쪽)에 온다.
    const D = 700;
    const p = boot([
      { section: 'lower', x: 0, y: 0, w: 2800, h: D, moduleH: 870, rotation: 180, finishings: [] },
      { section: 'lower', x: D / 2 - (2200 - D) / 2, y: D + (2200 - D) / 2 - D / 2,
        w: 2200 - D, h: D, moduleH: 870, rotation: 270, finishings: [] },
    ]);
    p.g('autoCalcAllAreas')();
    const off = p.g('adjCornerOffsetOf')(p.g('cornerPairs')()[0].adj.id);
    expect(off.air).toBe(0);
    expect(off.need).toBe(D);
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });
});

describe('멍판 마감재 재단은 150 이다 (W12-72)', () => {
  test('자리 60 · 재단 150 · 겹침 90', () => {
    expect(R.CORNER_MOLDING).toBe(60);
    expect(R.CORNER_FINISH_PART_W).toBe(150);
  });

  test('정면 덮개도 150 으로 얹힌다 — 멍판 위, 이어서 도어', () => {
    const L = engine.blindFrontLayout(715);
    expect(L.cover).toEqual([0, 700]);
    expect(L.finish).toEqual([550, 700]);      // 700 − 150
    expect(L.doorFrom).toBe(700);
  });

  test('멍이 좁으면 덮개 폭에 맞춰 잘린다 — 음수 폭이 되면 안 된다', () => {
    const L = engine.blindFrontLayout(100);    // coverEnd 85 < 150
    expect(L.finish).toEqual([0, 85]);
  });

  test('플래너와 BOM 이 같은 값을 본다', () => {
    const fs = require('fs');
    const path = require('path');
    const dc = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'data-constants.js'), 'utf8');
    expect(dc).toMatch(/CORNER_FINISH_PART_W = 150\b/);
  });
});
