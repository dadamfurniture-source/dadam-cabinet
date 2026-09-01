/**
 * W12-61: 멍판 마감재.
 *
 * 멍 폭에는 마감재 **자리** 60 이 이미 들어가 있다 (corner.md §3.3). 그 자리에
 * 설 부재를 라인 마감재에서 유도해 자동으로 세운다.
 *
 *   자리 seatW  60   — 멍 공식이 잡은 값. **바뀌면 안 된다**
 *   재단 partW  100  — 실제 부재. 멍가림판 2.7T 를 덮고 붙으므로 접착면 40 을 더 문다
 *
 * 이 파일이 지키는 것은 세 가지다.
 *   ① 마감재가 생겨도 **폭 계산이 하나도 안 바뀐다** (멍 · 도어 · 원장)
 *   ② 종류가 라인 마감을 따라간다 — 바꾸면 같이 바뀐다
 *   ③ 마감재 자리를 **두 번 빼지 않는다** (finishWidthOf → epW 이중 차감)
 */
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');

const LOWER_D = 650;
const R = engine.MASTER_RULES;

/** ㄱ자 — 가로 3600(회전 0) + 세로 1970(회전 90). 코너는 세로 다리가 갖는다. */
function lShapeLayout() {
  const legW = 1970;
  return {
    version: 1, savedAt: '2026-09-02T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: LOWER_D / 2 - legW / 2, y: legW / 2 - LOWER_D / 2,
        w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
    ],
  };
}

function boot(layout) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout || lShapeLayout()) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 자동계산을 돌린 뒤 멍장 하나와 그 배치 공간을 돌려준다 */
function withBlind(p) {
  p.g('autoCalcAllAreas')();
  const m = (p.g('modules') || []).find((x) => x.blind);
  expect(m).toBeTruthy();
  return { m, areaId: m.areaId, s: p.g('structures')[m.id] };
}

describe('상수 — 자리와 재단은 다른 값이다', () => {
  test('자리 60, 재단 100, 차이 40 이 겹침이다', () => {
    expect(R.CORNER_MOLDING).toBe(60);
    expect(R.CORNER_FINISH_PART_W).toBe(100);
    expect(R.CORNER_FINISH_PART_W - R.CORNER_MOLDING).toBe(40);
  });

  test('멍 공식은 재단(100)이 아니라 자리(60)를 쓴다', () => {
    // 이게 뒤집히면 멍장이 40 넓어지고 원장이 깨진다
    const d = engine.deriveCornerArea({ ownerW: 1970, ownerD: LOWER_D, adjD: 700 });
    expect(d.blindZoneWs[0]).toBe(700 - R.CORNER_DRIP + R.CORNER_MOLDING + R.CORNER_HINGE_BATTEN_T);
    expect(d.blindZoneWs[0]).toBe(765);
  });
});

describe('멍판 마감재가 자동으로 선다', () => {
  test('멍장마다 마감재가 파생된다 — 사람이 붙이지 않는다', () => {
    const { m } = withBlind(boot());
    expect(m.blind.finish).toBeTruthy();
    expect(m.blind.finish.seatW).toBe(R.CORNER_MOLDING);
    expect(m.blind.finish.partW).toBe(R.CORNER_FINISH_PART_W);
  });

  test('마감재 칸이 도어 **바로 옆**에 있다', () => {
    const { s } = withBlind(boot());
    const fin = s.areaTypes.indexOf('blindfin');
    const door = s.areaTypes.indexOf('door');
    expect(fin).toBeGreaterThanOrEqual(0);
    expect(Math.abs(fin - door)).toBe(1);      // 사이에 아무 칸도 없다
  });

  test('마감재는 멍 **안에서** 자리를 받는다 — 멍장이 넓어지지 않는다', () => {
    const p = boot();
    const { m, s } = withBlind(p);
    const blind = s.areaWidths[s.areaTypes.indexOf('blind')];
    const fin = s.areaWidths[s.areaTypes.indexOf('blindfin')];
    expect(blind + fin).toBe(m.blind.zoneW);
    expect(fin).toBe(R.CORNER_FINISH_PART_W);
    // 카카스 폭 = 멍 + 도어. 마감재가 여기 끼어들지 않는다.
    expect(m.W).toBe(m.blind.zoneW + m.blind.doorW);
    expect(s.areaWidths.reduce((a, b) => a + b, 0)).toBe(m.W);
  });
});

describe('라인 마감재를 따라간다', () => {
  const cases = [
    ['filler', 'filler'],
    ['molding', 'molding'],
  ];
  cases.forEach(([pick, want]) => {
    test(`라인 양끝을 ${pick} 로 고르면 멍판도 ${want}`, () => {
      const p = boot();
      const { areaId } = withBlind(p);
      p.g('setAreaFinish')(areaId, 'left', pick);
      p.g('setAreaFinish')(areaId, 'right', pick);
      const m = (p.g('modules') || []).find((x) => x.blind);
      expect(m.blind.finish.section).toBe(want);
    });
  });

  test('바꾸면 따라 바뀐다 — 휠라 → 몰딩', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    p.g('setAreaFinish')(areaId, 'left', 'filler');
    p.g('setAreaFinish')(areaId, 'right', 'filler');
    expect((p.g('modules') || []).find((x) => x.blind).blind.finish.section).toBe('filler');
    p.g('setAreaFinish')(areaId, 'left', 'molding');
    p.g('setAreaFinish')(areaId, 'right', 'molding');
    expect((p.g('modules') || []).find((x) => x.blind).blind.finish.section).toBe('molding');
  });

  // 2026-09-02 확정 규칙:
  //   하나라도 휠라 → 휠라  ·  아니고 EP/몰딩 → 몰딩  ·  그 외 → 휠라
  // 좌우 어느 쪽이 코너에 가까운지는 **보지 않는다.**
  const matrix = [
    ['filler',  'filler',  'filler'],
    ['molding', 'molding', 'molding'],
    ['filler',  'molding', 'filler'],   // 하나라도 휠라면 휠라
    ['molding', 'filler',  'filler'],   // 순서를 바꿔도 같다
    ['ep',      'molding', 'molding'],
    ['ep',      'ep',      'molding'],  // EP 는 코너에서 몰딩으로 본다
    ['ep',      'filler',  'filler'],
    ['',        '',        'filler'],   // 없음 → 기본 휠라
    ['gap',     'gap',     'filler'],   // 비움도 멍판에는 못 온다
    ['gap',     'molding', 'molding'],
  ];
  matrix.forEach(([L, R, want]) => {
    test(`좌 ${L || '없음'} · 우 ${R || '없음'} → ${want}`, () => {
      const p = boot();
      const { areaId } = withBlind(p);
      p.g('setAreaFinish')(areaId, 'left', L);
      p.g('setAreaFinish')(areaId, 'right', R);
      const m = (p.g('modules') || []).find((x) => x.blind);
      expect(m.blind.finish.section).toBe(want);
    });
  });

  test('멍판에는 비움이 서지 않는다 — 자리 60 은 반드시 덮인다', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    p.g('setAreaFinish')(areaId, 'left', 'gap');
    p.g('setAreaFinish')(areaId, 'right', 'gap');
    const m = (p.g('modules') || []).find((x) => x.blind);
    expect(m.blind.finish.section).not.toBe('gap');
    expect(['molding', 'filler']).toContain(m.blind.finish.section);
  });
});

describe('폭 계산은 하나도 안 바뀐다', () => {
  test('라인 마감재는 한 번만 빠진다 — 멍판 마감재가 epW 에 얹히지 않는다', () => {
    const p = boot();
    const { m, areaId } = withBlind(p);
    const zoneBefore = m.blind.zoneW;

    // 라인 마감재(몰딩 60)를 실제로 붙인다. finishWidthOf 가 이걸 epW 로 넘겨
    // 도어 몫에서 뺀다 — 여기까지는 원래 동작이고 옳다.
    // 위험한 것은 멍판 마감재까지 거기 얹혀 **자리 60 이 두 번** 빠지는 것이다.
    p.g('setAreaFinish')(areaId, 'left', 'molding');
    p.g('autoCalcAllAreas')();

    const area = p.g('areaById')(areaId);
    const epW = p.g('finishWidthOf')(areaId);
    expect(epW).toBe(60);            // 라인 몰딩 하나뿐 — 멍판 마감재는 안 세어진다

    // 엔진에 같은 epW 를 주고 나온 값과 화면이 세운 값이 같아야 한다.
    const adjD = p.g('areaById')(m.blind.adjAreaId).D;
    const want = engine.deriveCornerArea({
      ownerW: area.W, ownerD: area.D, adjDs: [adjD], epW,
    });
    const after = (p.g('modules') || []).find((x) => x.blind);
    expect(after.blind.zoneW).toBe(zoneBefore);       // 멍은 마감재와 무관하다
    expect(after.blind.doorW).toBe(want.doorW);
    expect(after.W).toBe(want.blindWs[0]);
  });

  test('멍판 마감재는 finishWidthOf 에 안 잡힌다 — 독립 모듈이 아니다', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    // 라인 마감을 하나도 안 붙인 상태에서도 멍판 마감재는 이미 서 있다
    expect((p.g('modules') || []).find((x) => x.blind).blind.finish).toBeTruthy();
    expect(p.g('finishWidthOf')(areaId)).toBe(0);
  });

  test('원장이 그대로 맞는다 — 마감재가 폭을 훔치지 않는다', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    p.g('setAreaFinish')(areaId, 'left', 'filler');
    p.g('autoCalcAllAreas')();
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const L = p.g('cornerLedger')(a.id);
      if (!L) return;
      expect(Math.abs(L.diff)).toBeLessThanOrEqual(1);
      expect(L.missing).toBe(0);
    });
  });

  test('배치 공간끼리 안 겹친다', () => {
    const p = boot();
    withBlind(p);
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });
});

describe('정면도에 마감재가 보인다', () => {
  test('멍 옆에 마감재 라벨이 그려진다', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    p.g('setAreaFinish')(areaId, 'left', 'molding');
    p.g('setAreaFinish')(areaId, 'right', 'molding');
    p.g('setActiveArea')(areaId);
    p.g('renderFrontView')();
    const texts = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    expect(texts).toContain('멍');
    expect(texts).toContain('몰딩');
  });

  test('휠라를 고르면 정면도도 휠라라고 적는다', () => {
    const p = boot();
    const { areaId } = withBlind(p);
    p.g('setAreaFinish')(areaId, 'left', 'filler');
    p.g('setAreaFinish')(areaId, 'right', 'filler');
    p.g('setActiveArea')(areaId);
    p.g('renderFrontView')();
    const texts = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    expect(texts).toContain('휠라');
    expect(texts).not.toContain('몰딩');
  });
});
