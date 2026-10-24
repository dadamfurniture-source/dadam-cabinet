/**
 * 2026-10-24 사장님 D9 — 좌·우 마감재(휠라 · 몰딩 · EP)는 도면이 정본이다.
 *   buildPlannerPayload 가 마감재마다 부모(BOM)가 발주에 쓸 값을 싣는다:
 *   side(붙은 모듈의 쪽) · edge(배치 공간 끝) · baseY(바닥 높이) · area(배치 공간 종류) · partW(부재 폭).
 * 합성 배치만 (planner-golden.js).
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

function boot(seed) {
  const p = bootPlanner('mockup-structure.html', { search: '?design=ap&item=1', storage: Object.assign({}, seed) });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

function fill(p, n) {
  const area = p.g('areas')[0];
  const w = Math.floor(area.W / n);
  let x = area.x || 0;
  for (let i = 0; i < n; i++) { p.g('addModuleToArea')(area.id, { section: area.section, W: w, x }); x += w; }
  return area;
}

const finsOf = (payload) => payload.modules.flatMap((m) => m.finishings || []);

describe('buildPlannerPayload — 마감재 메타 (D9)', () => {
  test('배치 공간 양 끝 EP · 휠라: 쪽 · 끝 · 바닥 · 영역 · 부재 폭', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = fill(p, 3);
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'right', 'filler');
    const fins = finsOf(p.g('buildPlannerPayload')('PLANNER_STATE'));
    expect(fins).toHaveLength(2);
    const ep = fins.find((f) => f.section === 'ep');
    const fil = fins.find((f) => f.section === 'filler');
    expect(ep).toMatchObject({ side: 'left', edge: 'left', area: area.section, partW: p.g('finishingPartWidthOf')('ep') });
    expect(fil).toMatchObject({ side: 'right', edge: 'right', area: area.section, partW: p.g('finishingPartWidthOf')('filler') });
    // 바닥 높이는 플래너가 그 마감재를 세운 자리 그대로 (baseYOf)
    const mods = p.g('modules').filter((m) => m.isFinishing);
    expect(ep.baseY).toBe(p.g('baseYOf')(mods.find((m) => m.section === 'ep')));
    expect(fil.baseY).toBe(p.g('baseYOf')(mods.find((m) => m.section === 'filler')));
    // EP 는 18T 판 (잡는 폭 20 과 다르다), 휠라는 60 이 부재이자 자리
    expect(ep.partW).toBeLessThan(ep.W);
    expect(fil.partW).toBe(fil.W);
  });

  test('마감재가 없는 배치의 payload 는 예전과 같다 (finishings 빈 배열)', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    fill(p, 2);
    expect(finsOf(p.g('buildPlannerPayload')('PLANNER_STATE'))).toEqual([]);
  });
});
