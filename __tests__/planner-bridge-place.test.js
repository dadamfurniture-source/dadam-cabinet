/**
 * 작업지시서 아이소메트릭(코너 품목, 사장님 결정 Q4) — 플래너 → 브리지 자리 전달.
 *
 * 플래너(mockup-structure)가 모듈마다 `plane`(영역 회전 반영 평면 상자) · `baseY` · payload `ceilingHeight` 를 싣고,
 * 브리지(ui-step1.js _plannerPlaceOf)가 칸마다 `_place` {cx, cy, w, d, run, front, z0, h, ceil} 로 푼다.
 * 실제 플래너를 부팅해 ㄱ자 골든 배치의 payload 를 받아 검사한다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const UI = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

const placeOf = new Function(`${sliceBalanced(UI, UI.indexOf('function _plannerPlaceOf'))}; return _plannerPlaceOf;`)();

function lShapePayload() {
  const seed = seedFor(FIXTURES.lShape);
  const search = seed._search;
  delete seed._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  return p.g('buildPlannerPayload')('PLANNER_STATE');
}

describe('플래너 payload — 평면 자리 · 바닥 높이 · 천장', () => {
  const payload = lShapePayload();

  test('모듈마다 plane · baseY, payload 에 ceilingHeight', () => {
    expect(payload.ceilingHeight).toBe(2300);
    for (const m of payload.modules) {
      expect(m.plane).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), d: expect.any(Number) }));
      // 회전이 90° 면 평면 상자의 가로·세로가 바뀐다
      const swap = m.rotation === 90 || m.rotation === 270;
      expect(m.plane.w).toBe(swap ? m.D : m.W);
      expect(m.plane.d).toBe(swap ? m.W : m.D);
    }
    const upper = payload.modules.find((m) => m.section === 'upper');
    expect(upper.baseY).toBe(2300 - upper.H); // 상부장은 천장에 매달린다
    expect(payload.modules.find((m) => m.section === 'lower').baseY).toBe(0);
  });

  test('브리지 자리 — 모듈 하나를 통째로 풀면 평면 상자와 같고, 0°는 앞 +y · 90°는 앞 −x', () => {
    for (const m of payload.modules) {
      const pl = placeOf(m, 0, m.W, payload.ceilingHeight);
      expect(pl.cx).toBeCloseTo(m.plane.cx, 5);
      expect(pl.cy).toBeCloseTo(m.plane.cy, 5);
      expect(pl.w).toBe(m.W);
      expect(pl.z0).toBe(m.baseY);
      expect(pl.h).toBe(m.H);
      expect(pl.ceil).toBe(2300);
      if (m.rotation === 0) { expect(pl.run).toEqual([1, 0]); expect(pl.front).toEqual([0, 1]); }
      if (m.rotation === 90) { expect(pl.run).toEqual([0, 1]); expect(pl.front).toEqual([-1, 0]); }
    }
  });

  test('칸은 진행 방향으로 늘어선다 — 두 칸의 중심 사이 = 두 폭의 반의 합', () => {
    const m = payload.modules.find((x) => x.rotation === 90 && x.section === 'lower');
    const a = placeOf(m, 0, 600, 2300);
    const b = placeOf(m, 600, 900, 2300);
    expect(b.cx - a.cx).toBeCloseTo(0, 5);
    expect(b.cy - a.cy).toBeCloseTo((600 + 900) / 2, 5);
  });
});

describe('브리지 — 옛 payload 는 그대로', () => {
  test('plane 이 없으면 null (모듈에 _place 를 싣지 않는다)', () => {
    expect(placeOf({ W: 600, D: 600, H: 870, rotation: 0 }, 0, 600, 2300)).toBeNull();
    expect(placeOf({ W: 600, plane: { cx: 1, cy: 1 }, rotation: 45 }, 0, 600, 2300)).toBeNull();
  });

  test('네 갈래(오픈장 · 밥솥장 · 멍장 · 칸) 모두 자리를 단다', () => {
    const conv = sliceBalanced(UI, UI.indexOf('function _convertPlannerModules'));
    expect(conv.split('placeLast(').length - 1).toBe(4); // 오픈장 · 밥솥장 · 멍장 · 칸 (정의는 'placeLast = (')
    expect(conv).toMatch(/placeLast\(m, \(Number\(c\.x\) \|\| 0\) - \(Number\(m\.x\) \|\| 0\), c\.w\)/);
  });
});
