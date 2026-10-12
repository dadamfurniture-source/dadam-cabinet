/**
 * 2026-10-12: 「전체 자동계산」은 모든 배치의 **빈 자리만** 채운다. 있는 모듈은 지킨다.
 *   전부 걷어내고 다시 까는 것은 「전부 다시 깔기」로 따로 둔다 (사장님 결정).
 * 아울러 모듈이 하나도 없는 배치는 빈 자리 채우기가 아니라 **처음 계산**을 한다 —
 *   코너 배치는 멍장을 먼저 세워야 하는데 빈 자리 채우기는 멍장을 모른다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8').split('\r\n').join('\n');
const LOWER_D = 650;
function lShape() {
  const legW = 1970 - LOWER_D;
  return { version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null, modules: [
    { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: LOWER_D / 2 - legW / 2, y: LOWER_D + legW / 2 - LOWER_D / 2, w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
  ] };
}
const bootLayout = (layout) => bootPlanner('mockup-structure.html', {
  search: '?design=d1&item=1', storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout) } });
/** planner-area-module 과 같은 부팅 — seedFor 가 범위(_search)를 함께 넘긴다 */
function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=ap&item=1';
  delete s._search;
  return bootPlanner('mockup-structure.html', { search, storage: s });
}
const mods = (p, id) => p.g('modules').filter((m) => m.areaId === id && !m.isFinishing);

describe('빈 배치는 처음 계산 — 코너면 멍장부터', () => {
  test('코너 주인 배치가 비어 있으면 영역 ⚡ 가 멍장을 세운다', () => {
    const p = bootLayout(lShape());
    const owner = p.g('cornerPairs')()[0].owner;
    expect(mods(p, owner.id)).toHaveLength(0);
    p.g('setActiveArea')(owner.id);
    p.g('autoCalcTarget')(owner).run();
    expect(mods(p, owner.id).some((m) => m.blind)).toBe(true);
  });
});

describe('전체 자동계산 = 빈 자리만 채우기', () => {
  test('있던 모듈은 그대로 두고 빈 자리만 채운다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower' && a.W === 1400);
    const keep = p.g('addModuleToArea')(area.id, { section: 'lower', W: 600, x: area.x || 0 });
    const before = { id: keep.id, W: keep.W, x: keep.x };
    p.g('fillAllAreaGaps')();
    expect(mods(p, area.id).find((m) => m.id === before.id)).toMatchObject({ W: before.W, x: before.x });
    expect(p.g('areaFreeSpans')(area.id)).toEqual([]);
  });

  test('비어 있는 배치는 전부 다시 깔기와 같은 결과다', () => {
    const a = boot(seedFor(FIXTURES.straight, { modules: false }));
    const b = boot(seedFor(FIXTURES.straight, { modules: false }));
    a.g('fillAllAreaGaps')();
    b.g('autoCalcAllAreas')();
    const sig = (p) => p.g('areas').filter((x) => !x.isFinishing)
      .map((x) => mods(p, x.id).map((m) => Math.round(m.W)).sort((p1, p2) => p1 - p2).join('+')).join(' | ');
    expect(sig(a)).toBe(sig(b));
  });

  test('코너 배치가 비어 있으면 멍장까지 세운다', () => {
    const p = bootLayout(lShape());
    p.g('fillAllAreaGaps')();
    const owner = p.g('cornerPairs')()[0].owner;
    expect(mods(p, owner.id).some((m) => m.blind)).toBe(true);
  });

  test('상단바 「전체 자동계산」은 빈 자리 채우기, 「전부 다시 깔기」는 확인 뒤 다시 깐다', () => {
    expect(SRC).toMatch(/autoCalcAllBtn[\s\S]{0,200}fillAllAreaGaps\(\)/);
    expect(SRC).toContain('id="rebuildAllBtn"');
    expect(SRC).toMatch(/rebuildAllBtn[\s\S]{0,400}confirm\([\s\S]{0,400}autoCalcAllAreas\(\)/);
  });
});
