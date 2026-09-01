/**
 * W12-58: 멍은 먹장이 아니다.
 *
 *   먹장 blank   폭이 도어 최소(350)보다 좁아 도어 대신 막는 판. 코너와 무관. 18T
 *   멍   blind   옆 라인에 가려 도어를 못 다는 구간. **2.7T MDF** 로 가린다 (§3.5)
 *
 * 둘을 한 타입으로 두면 화면이 멍을 "먹장" 이라 부르고, 나중에 셀 타입만 보고
 * 자재를 뽑으면 두께가 틀린다 (18T vs 2.7T).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');

const LOWER_D = 650;

/** ㄱ자 — 가로 3600(회전 0) + 세로 1970(회전 90) */
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

function boot() {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(lShapeLayout()) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('멍과 먹장을 가른다', () => {
  /**
   * 먹장(blank)  폭이 도어 최소(350)보다 좁아 도어 대신 막는 판. 코너와 무관하다
   * 멍  (blind)  옆 라인에 가려 도어를 못 다는 구간. 2.7T MDF 로 가린다 (§3.5)
   *
   * 둘을 한 타입으로 두면 화면이 멍을 "먹장" 이라 부르고, 나중에 셀 타입만 보고
   * 자재를 뽑으면 두께가 틀린다 (18T vs 2.7T).
   */
  test('멍장의 가려진 칸은 blind 다', () => {
    const p = boot();
    p.g('autoCalcAllAreas')();
    const m = (p.g('modules') || []).find((x) => x.blind);
    const s = p.g('structures')[m.id];
    const idx = s.areaTypes.indexOf('blind');
    const fin = s.areaTypes.indexOf('blindfin');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(fin).toBeGreaterThanOrEqual(0);
    // W12-61: 멍 칸 + 마감재 칸 = 멍 폭. 마감재는 멍 **안에서** 자리를 받는다.
    expect(s.areaWidths[idx] + s.areaWidths[fin]).toBe(m.blind.zoneW);
    expect(s.areaWidths[fin]).toBe(m.blind.finish.partW);
  });

  test('정면도가 "멍" 이라고 적는다 — "먹장" 이 아니다', () => {
    const p = boot();
    p.g('autoCalcAllAreas')();
    p.g('setActiveArea')(p.g('cornerPairs')()[0].owner.id);
    p.g('renderFrontView')();
    const texts = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    expect(texts).toContain('멍');
    expect(texts).not.toContain('먹장');
  });

  test('멍가림판 두께가 2.7T 다', () => {
    const p = boot();
    expect(p.g('BLIND_COVER_T')).toBe(2.7);
  });

  test('먹장은 그대로 남아 있다 — 좁은 칸에는 여전히 먹장이 붙는다', () => {
    // 규칙(BLANK_THRESHOLD)은 건드리지 않았다
    expect(engine.MASTER_RULES.BLANK_THRESHOLD).toBe(350);
    const src = fs.readFileSync(path.join(ROOT, 'js/planner/planner-engine.js'), 'utf8');
    expect(src).toContain("areaTypes.push('blank')");
  });
});
