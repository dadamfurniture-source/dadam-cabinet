/**
 * 2026-10-12 사장님 결정: 냉장고장 위장은 **냉장고 자리**에 맞춘다.
 *   자리 폭 = 냉장고 폭 + 양옆 설치 여유 × 2 + 전체 여유 5 (2026-10-20) — 예) 10 + 595 + 10 + 5 = 620 위장.
 *   나란히 붙은 여러 대는 한 자리, 사이 여유는 하나 — 10+595+10+595+10+595+10+5 = 1830.
 *   여유는 냉장고 모델에서 온다 (appliance_models side_gap_mm, 비면 브랜드 라인 기본값).
 * 같이: 위장 높이는 기본 모델(1870)이 아니라 **놓인 냉장고 높이 + 위 간격**에서 시작한다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

const FRIDGE_AREA = { section: 'fridge', x: 0, y: 0, w: 1500, h: 700, moduleH: 2300, rotation: 0, finishings: [] };
const fridge = (o) => Object.assign({ section: 'refrigerator', x: 100, y: 0, w: 595, h: 680, moduleH: 1780, rotation: 0, finishings: [] }, o);
const layout = (mods) => ({ version: 1, savedAt: '2026-10-12T00:00:00.000Z', person: null, modules: mods });
function boot(mods) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1', storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout(mods)) } });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  return p;
}
const fridgeArea = (p) => p.g('areas').find((a) => a.section === 'fridge');
const uppers = (p, a) => p.g('modules').filter((m) => m.areaId === a.id && !m.isFinishing).sort((x, y) => x.x - y.x);

describe('냉장고장 위장 = 냉장고 자리 (폭 + 양옆 여유)', () => {
  test('595 냉장고 · 여유 10 → 위장 620(+전체 여유 5) 이 냉장고 자리에 선다', () => {
    const p = boot([FRIDGE_AREA, fridge({ sideGap: 10, topGap: 15 })]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const niche = uppers(p, a).find((m) => Math.round(m.W) === 620);
    expect(niche).toBeDefined();
    expect(Math.round(niche.x)).toBe(90);              // 냉장고 x 100 − 여유 10
  });

  test('위장은 놓인 냉장고 높이 + 위 간격에서 시작한다 (기본 1870 이 아니라)', () => {
    const p = boot([FRIDGE_AREA, fridge({ sideGap: 10, topGap: 15 })]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const us = uppers(p, a);
    expect(us.length).toBeGreaterThan(0);
    us.forEach((m) => expect(m.baseY).toBe(1780 + 15));  // 자리 밖 통도 같은 아랫선
    us.forEach((m) => expect(m.baseY + m.H).toBeLessThanOrEqual(2300));
  });

  test('자리 위장은 한 통 — 620 을 310 두 칸으로 쪼개지 않는다', () => {
    const p = boot([FRIDGE_AREA, fridge({ sideGap: 10, topGap: 15 })]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const niche = uppers(p, a).find((m) => Math.round(m.W) === 620);
    const s = p.g('structures')[niche.id];
    const doors = (s.areaTypes || []).reduce((k, t, i) => k + (t === 'door' ? ((s.areaIs2D || [])[i] ? 2 : 1) : 0), 0);
    expect(doors).toBe(1);
  });

  test('여유가 없는 옛 배치는 냉장고 폭 + 전체 여유 5', () => {
    const p = boot([FRIDGE_AREA, fridge({})]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const niche = uppers(p, a).find((m) => Math.round(m.W) === 600);
    expect(niche).toBeDefined();
    expect(Math.round(niche.x)).toBe(100);
  });

  test('냉장고가 없으면 예전 그대로 — 도어 규칙 · 기본 높이', () => {
    const p = boot([FRIDGE_AREA]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const fH = p.g('SECTION_CONFIG').refrigerator.moduleH;
    uppers(p, a).forEach((m) => expect(m.baseY).toBe(fH + p.g('MASTER_RULES').FRIDGE_TOP_GAP));
  });

  test('회전한 배치에서도 냉장고 자리를 찾는다', () => {
    // 배치 공간을 90° 돌리고, 그 공간의 로컬 x 100..695 자리에 오도록 냉장고를 세계 좌표로 놓는다.
    const rot = Object.assign({}, FRIDGE_AREA, { rotation: 90 });
    const probe = boot([rot]);
    const ar = fridgeArea(probe);
    const s0 = probe.g('areaSlicePlane')(ar, 100), s1 = probe.g('areaSlicePlane')(ar, 694);
    const cx = (s0.cx + s1.cx) / 2, cy = (s0.cy + s1.cy) / 2;      // 냉장고 세계 중심
    // 냉장고도 90° 돌려 둔다 — 자기 중심으로 돌므로 사전 회전 사각형은 그 중심 ± (w/2, h/2)
    const f = fridge({ x: cx - 595 / 2, y: cy - 680 / 2, rotation: 90, sideGap: 10, topGap: 15 });
    const p = boot([rot, f]);
    const a = fridgeArea(p);
    p.g('autoCalcArea')(a.id);
    const niche = uppers(p, a).find((m) => Math.round(m.W) === 620);
    expect(niche).toBeDefined();
    expect(Math.abs(niche.x - 90)).toBeLessThanOrEqual(1);
  });

  test('삼성 1도어 3대 나란히 — 10+595+10+595+10+595+10+5 = 1830, 위장은 냉장고마다 한 통', () => {
    const WIDE = Object.assign({}, FRIDGE_AREA, { w: 2500 });
    // 몸통 사이 10 (여유 구간이 맞닿음) — 붙여 놓아도(사이 0) 같은 자리가 나와야 한다
    for (const xs of [[100, 705, 1310], [100, 695, 1290]]) {
      const p = boot([WIDE].concat(xs.map((x) => fridge({ x, sideGap: 10, topGap: 15 }))));
      const a = fridgeArea(p);
      const ns = p.g('fridgeNichesOf')(a, 0, 2500);
      expect(ns.map((n) => n.w)).toEqual([610, 605, 615]);   // 10+595+5 | 5+595+5 | 5+595+10+5
      expect(ns[0].x).toBe(90);
      expect(ns.reduce((t, n) => t + n.w, 0)).toBe(1830);
      expect(ns[2].x + ns[2].w).toBe(90 + 1830);
    }
  });

  test('떨어진 두 대는 각자 자리 (전체 여유 5 도 각자)', () => {
    const WIDE = Object.assign({}, FRIDGE_AREA, { w: 2500 });
    const p = boot([WIDE, fridge({ x: 100, sideGap: 10 }), fridge({ x: 1200, sideGap: 10 })]);
    const ns = p.g('fridgeNichesOf')(fridgeArea(p), 0, 2500);
    expect(ns.map((n) => [n.x, n.w])).toEqual([[90, 620], [1190, 620]]);
  });

  test('사이 여유는 양쪽 중 큰 값 · 홀수는 왼쪽 내림', () => {
    const WIDE = Object.assign({}, FRIDGE_AREA, { w: 2500 });
    const p = boot([WIDE, fridge({ x: 100, sideGap: 4 }), fridge({ x: 708, sideGap: 13 })]);
    const ns = p.g('fridgeNichesOf')(fridgeArea(p), 0, 2500);
    // 4 + 595 + 6 | 7 + 595 + 13 + 5  (사이 13 = max(4,13) → 6 | 7)
    expect(ns.map((n) => n.w)).toEqual([605, 620]);
    expect(ns[0].x).toBe(96);
  });

  test('구조 단계가 배치의 여유 값을 영역에 싣는다', () => {
    const p = boot([FRIDGE_AREA, fridge({ sideGap: 12, topGap: 20 })]);
    const r = p.g('areas').find((x) => x.section === 'refrigerator');
    expect(r.sideGap).toBe(12);
    expect(r.topGap).toBe(20);
  });
});

describe('배치 단계 — 모델의 설치 여유', () => {
  const shell = () => bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });

  test('모델 표에 값이 없으면 브랜드 라인 기본값', () => {
    const p = shell();
    const g = p.g('fridgeGapsOf');
    expect(g({ brand: '삼성', name: 'BESPOKE 1도어 키친핏 380L' })).toEqual({ side: 12, top: 15 });
    expect(g({ brand: 'LG', name: 'DIOS 빌트인 양문형' })).toEqual({ side: 4, top: 15 });
    expect(g({ brand: '삼성', name: '인피니트 냉장고' })).toEqual({ side: 5, top: 15 });
    expect(g({ brand: 'LG', name: '오브제컬렉션 양문형 870L' })).toEqual({ side: 50, top: 15 });
  });

  test('빌트인 — 장 안쪽 치수가 있으면 거기서 여유를 되돌린다 (데이코 604 → 장 610×2135)', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    const g = p.g('fridgeGapsOf')({ brand: '데이코', name: '컬럼 냉장고', w: 604, h: 2118, nicheW: 610, nicheH: 2135, sideGap: 50 });
    expect(g).toEqual({ side: 3, top: 17 });   // 구조 단계: 3 + 604 + 3 + 5 = 615 = 장 610 + 5
  });

  test('모델 표에 값이 있으면 그것을 쓴다', () => {
    const p = shell();
    expect(p.g('fridgeGapsOf')({ brand: '삼성', name: 'BESPOKE 1도어 키친핏', sideGap: 10, topGap: 15 }))
      .toEqual({ side: 10, top: 15 });
  });

  test('놓은 냉장고의 여유가 배치 저장에 남는다', () => {
    const p = shell();
    p.g('addSectionRect')('refrigerator', { w: 595, h: 680, moduleH: 1780, sideGap: 10, topGap: 15 });
    const saved = p.g('serializeLayout')();
    const r = saved.modules.find((m) => m.section === 'refrigerator');
    expect(r).toMatchObject({ sideGap: 10, topGap: 15, w: 595, moduleH: 1780 });
    // 여유가 없는 사각형(일반 장)에는 칸을 만들지 않는다
    p.g('addSectionRect')('lower', { w: 1200 });
    const lower = p.g('serializeLayout')().modules.find((m) => m.section === 'lower');
    expect(lower).not.toHaveProperty('sideGap');
  });
});
