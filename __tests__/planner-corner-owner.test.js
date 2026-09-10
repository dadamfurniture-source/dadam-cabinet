/**
 * W12-63: 멍장 주인은 **코너 사각형을 가진 라인**이다.
 *
 * 예전 규칙("회전한 다리가 주인")은 회전을 "주선/차선" 으로 읽었는데, 회전은
 * `alignToPerson` 이 정하는 **도어 방향**(= 벽이 어느 쪽인가)이다. 그래서 같은
 * ㄱ자라도 방의 어느 코너에 놓이느냐에 따라 주인이 뒤집혔고, 트리밍된 배치에서는
 * 코너를 가진 라인이 밀려나 **아무도 채우지 않는 구멍**이 남았다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

const D = 700, LEFT = 2800, RIGHT = 2200, TRIMMED_RIGHT = RIGHT - D;

function boot(mods) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify({
      version: 1, savedAt: '2026-09-09T00:00:00.000Z', person: null, modules: mods }) },
  });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  return p;
}
/** 가로 다리는 벽이 위(rot0)나 아래(rot180) — 세로 다리는 늘 꺾여 있다 */
const horiz = (rot) => ({ section:'lower', x:0, y:0, w:LEFT, h:D, moduleH:870, rotation:rot, finishings:[] });
/** 겹친 세로 다리 (트리밍 전) */
const vertOverlap = (rot) => ({ section:'lower', x:D/2-RIGHT/2, y:RIGHT/2-D/2,
  w:RIGHT, h:D, moduleH:870, rotation:rot, finishings:[] });
/** 잘라낸 세로 다리 — 코너 사각형을 가로에 넘긴다 */
const vertTrimmed = (rot) => ({ section:'lower', x:D/2-TRIMMED_RIGHT/2, y:D+TRIMMED_RIGHT/2-D/2,
  w:TRIMMED_RIGHT, h:D, moduleH:870, rotation:rot, finishings:[] });

const isHoriz = (a) => (((a.rotation || 0) % 180) + 180) % 180 === 0;

describe('트리밍된 ㄱ자 — 코너를 가진 라인이 멍장을 갖는다', () => {
  [0, 180].forEach((rot) => {
    test(`가로 rot${rot} 이어도 가로가 주인이다`, () => {
      const p = boot([horiz(rot), vertTrimmed(270)]);
      const c = p.g('cornerPairs')()[0];
      expect(c).toBeTruthy();
      // 코너 사각형(x0..700, y0..700)은 잘라낸 뒤 가로 라인에만 속한다
      expect(isHoriz(c.owner)).toBe(true);
    });
  });

  test('코너 사각형을 멍장이 덮는다 — 구멍이 없다', () => {
    const p = boot([horiz(180), vertTrimmed(270)]);
    p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    const sq = p.g('cornerSquareOf')(c.owner, c.adj);
    const blind = (p.g('modules') || []).find((m) => m.blind);
    expect(blind).toBeTruthy();
    const covered = p.g('boxOverlapArea')(p.g('modulePlaneBox')(blind), sq);
    // 벽 여유 50 과 모듈 깊이(550 < 영역 700) 때문에 100% 는 될 수 없다.
    // 절반을 넘으면 코너가 멍장 것이라는 뜻이다 — 예전엔 0 이었다.
    expect(covered / (sq.w * sq.d)).toBeGreaterThan(0.5);
  });

  test('인접 라인은 이미 물러난 만큼만 더 밀린다', () => {
    const p = boot([horiz(180), vertTrimmed(270)]);
    p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    const off = p.g('adjCornerOffsetOf')(c.adj.id);
    // W12-72: 앞선 공기층 12 는 주인의 **도어 쪽**에만 있다. 이 픽스처는 가로가
    //   rot180 이라 도어가 −y 를 보고, 세로 다리는 +y(벽 쪽)에 붙는다 —
    //   그쪽에는 공기층이 없으므로 요구 거리는 배치 공간 깊이 그대로다.
    expect(off.air).toBe(0);
    expect(off.need).toBe(700);        // 규칙이 요구하는 거리 = 멍장 라인 깊이 (§3.7)
    expect(off.already).toBe(700);     // 트리밍으로 이미 비켜 준 거리
    expect(off.offset).toBe(0);        // 트리밍된 라인엔 여유가 없다 — 예전엔 750 을 또 밀었다
  });
});

describe('겹친 ㄱ자 — 예전 동작 그대로', () => {
  test('둘 다 코너를 가지면 회전 규칙으로 결정한다', () => {
    const p = boot([horiz(0), vertOverlap(270)]);
    const c = p.g('cornerPairs')()[0];
    expect(isHoriz(c.owner)).toBe(false);   // 회전한 세로가 주인 (기존 규칙)
  });

  test('인접 밀림은 주인 도어 면까지 688 이다 (700 − 공기층 12)', () => {
    const p = boot([horiz(0), vertOverlap(270)]);
    p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    const off = p.g('adjCornerOffsetOf')(c.adj.id);
    expect(off.already).toBe(0);
    expect(off.offset).toBe(688);   // W12-72: 700 − 앞선 공기층 12
  });
});

describe('원장과 겹침은 두 배치 모두 성립한다', () => {
  [['트리밍', [horiz(180), vertTrimmed(270)]], ['겹침', [horiz(0), vertOverlap(270)]]]
    .forEach(([tag, mods]) => {
      test(`${tag} — diff 0 · missing 0 · 모듈 충돌 없음`, () => {
        const p = boot(mods);
        p.g('autoCalcAllAreas')();
        (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
          const L = p.g('cornerLedger')(a.id);
          if (!L) return;
          expect(L.withinSlack).toBe(true);   // W12-73: 모듈당 1mm 조립 여유
          expect(L.missing).toBe(0);
        });
        expect(p.g('crossAreaOverlaps')()).toEqual([]);
      });
    });
});
