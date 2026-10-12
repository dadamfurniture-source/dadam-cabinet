/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-13 사장님 결정: 위로 여는 도어(플랩).
 *   냉장고 위장 도어는 천판 쪽에 경첩이 달리고 쇼바가 같이 들어간다 — 보링은 도어 **폭** 변.
 *   그래서 615 자리 위장은 도어 한 장 611 그대로다. 싱크대 상부장도 모듈마다 '위 ▲ 플랩'을 고를 수 있다.
 *   쇼바: 도어당 양쪽 1개씩 2개, 규격은 도어 무게(MDF 18T · 750kg/m³)로 자동 — 산 것만 1·5·7·9kg.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');

const X = Object.assign({}, require('../js/detaildesign/extractors.js'), loadExtractors());

function bootStraight() {
  const p = bootPlanner('mockup-structure.html', { search: '?design=gold&item=1', storage: seedFor(FIXTURES.straight, { modules: false }) });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  return p;
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

describe('플래너 — 열림 방향에 "위"가 있다 (상부장만)', () => {
  function withModule(section) {
    const p = bootStraight();
    const area = p.g('areas').find((a) => a.section === section);
    const m = p.g('addModuleToArea')(area.id, { section, W: 600, x: area.x || 0 });
    const s = p.g('getStructure')(m.id);
    s.areaTypes[0] = 'door'; s.areaDirections[0] = 'left';
    p.g('setActiveModule')(m.id);
    p.g('renderFrontView')();
    const cell = () => p.document.querySelector('#contentG .area-rect[data-cell-idx="0"]');
    return { p, m, cell };
  }

  test('상부장 칸은 좌 → 우 → 위 → 좌', () => {
    const { p, m, cell } = withModule('upper');
    const dir = () => p.g('getStructure')(m.id).areaDirections[0];
    click(cell()); expect(dir()).toBe('right');
    p.g('renderFrontView')(); click(cell()); expect(dir()).toBe('up');
    p.g('renderFrontView')(); click(cell()); expect(dir()).toBe('left');
  });

  test('하부장 칸은 좌 ↔ 우 그대로', () => {
    const { p, m, cell } = withModule('lower');
    const dir = () => p.g('getStructure')(m.id).areaDirections[0];
    click(cell()); expect(dir()).toBe('right');
    p.g('renderFrontView')(); click(cell()); expect(dir()).toBe('left');
  });

  test('정면도에 ▲ 가 그려진다', () => {
    const { p, m } = withModule('upper');
    p.g('getStructure')(m.id).areaDirections[0] = 'up';
    p.g('renderFrontView')();
    const arrows = [...p.document.querySelectorAll('#contentG .open-direction')].map((t) => t.textContent);
    expect(arrows).toContain('▲');
  });
});

describe('냉장고 자리 위장은 자동계산이 플랩으로 둔다', () => {
  const FRIDGE_AREA = { section: 'fridge', x: 0, y: 0, w: 1500, h: 700, moduleH: 2300, rotation: 0, finishings: [] };
  const fridge = { section: 'refrigerator', x: 100, y: 0, w: 595, h: 680, moduleH: 1780, rotation: 0, finishings: [], sideGap: 10, topGap: 15 };
  test('615 위장 — 도어 한 장, 열림 "위"', () => {
    const layout = { version: 1, savedAt: '2026-10-13T00:00:00.000Z', person: null, modules: [FRIDGE_AREA, fridge] };
    const p = bootPlanner('mockup-structure.html', { search: '?design=d1&item=1', storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout) } });
    const a = p.g('areas').find((x) => x.section === 'fridge');
    p.g('autoCalcArea')(a.id);
    const niche = p.g('modules').find((m) => m.areaId === a.id && !m.isFinishing && Math.round(m.W) === 615);
    const s = p.g('structures')[niche.id];
    expect(s.areaDirections).toEqual(['up']);
    // 옆 통(냉장고 자리 아님)은 예전처럼 옆으로 연다
    const others = p.g('modules').filter((m) => m.areaId === a.id && !m.isFinishing && m.id !== niche.id);
    others.forEach((m) => expect(p.g('structures')[m.id].areaDirections).not.toContain('up'));
  });
});

describe('브리지 — 칸 "위" → BOM 모듈 doorOpen', () => {
  const convert = (section, dirs, is2D = [false]) => {
    const payload = {
      modules: [{ id: 'u1', section, W: 600, H: 780, D: 320, x: 0, y: 0 }],
      structures: { u1: { verticalCount: 1, areaTypes: ['door'], areaWidths: [600], areaIs2D: is2D, areaDirections: dirs } },
    };
    return loadConverter()._convertPlannerModules(payload, Object.assign({}, LEDGER_SPECS)).modules;
  };
  test('상부장 단문 "위" 는 doorOpen up', () => {
    expect(convert('upper', ['up'])[0].doorOpen).toBe('up');
  });
  test('좌·우·양문·하부장에는 필드가 없다 (예전 payload 그대로)', () => {
    expect(convert('upper', ['left'])[0]).not.toHaveProperty('doorOpen');
    expect(convert('upper', ['up'], [true])[0]).not.toHaveProperty('doorOpen');
    expect(convert('lower', ['up'])[0]).not.toHaveProperty('doorOpen');
  });
});

describe('BOM — 플랩 철물', () => {
  const sinkWith = (mod) => ({
    items: [{ categoryId: 'sink', w: 2400, h: 2310, d: 650, specs: Object.assign({}, LEDGER_SPECS), modules: [mod] }],
  });
  const hw = (mod) => new X.HardwareExtractor().extract(sinkWith(mod)).hardware;

  test('615 냉장고 자리 위장: 경첩 2구 폭 611 변 보링 + 쇼바 5kg × 2', () => {
    const rows = hw({ id: 'n', type: 'storage', name: '상부장', pos: 'upper', w: 615, h: 400, d: 700, doorCount: 1, doorOpen: 'up' });
    const hinge = rows.find((r) => r.category === '경첩');
    expect(hinge).toMatchObject({ spec: '2구', qty: 2 });
    expect(hinge.note).toMatch(/천판 쪽, 도어 폭 611 변 \(보링: 110, 501\)/);
    const strut = rows.find((r) => r.category === '가스쇼바');
    expect(strut).toMatchObject({ item: '가스쇼바 5kg', spec: 'MJG180-50', qty: 2 });
  });

  test('양문 상부장 플랩은 도어마다 쇼바 2', () => {
    const rows = hw({ id: 'u', type: 'storage', name: '상부장', pos: 'upper', w: 1200, h: 720, d: 320, doorCount: 2, doorOpen: 'up' });
    expect(rows.find((r) => r.category === '가스쇼바').qty).toBe(4);
  });

  test('여닫이는 예전 그대로 — 높이 기준 보링, 쇼바 없음', () => {
    const rows = hw({ id: 'u', type: 'storage', name: '상부장', pos: 'upper', w: 600, h: 720, d: 320, doorCount: 1 });
    expect(rows.some((r) => r.category === '가스쇼바')).toBe(false);
    expect(rows.find((r) => r.category === '경첩').note).toMatch(/보링: 110, 625/);
  });

  test('냉장고장 옛 화면의 doorType flap 도 같다', () => {
    const f = { categoryId: 'fridge', w: 900, h: 2290, d: 700, specs: { bodyThickness: 15 },
      modules: [{ id: 't', type: 'tall', name: '키큰장', w: 600, h: 400, d: 700, doorCount: 1, doorType: 'flap' }] };
    const rows = new X.HardwareExtractor().extract({ items: [f] }).hardware;
    expect(rows.some((r) => r.category === '가스쇼바')).toBe(true);
  });

  test.each([
    [600, 100, 1, false],   // 0.8kg
    [611, 415, 5, false],   // 3.4kg
    [596, 735, 7, false],   // 5.9kg
    [896, 735, 9, false],   // 8.9kg
    [1000, 800, 9, true],   // 10.8kg — 9kg 로도 모자람
  ])('도어 %i×%i → 쪽당 %ikg', (w, h, kg, over) => {
    const g = X.bomGasStrutFor(w, h);
    expect(g.kg).toBe(kg);
    expect(g.over).toBe(over);
  });

  test('쇼바 규격은 산 것만 — 1·5·7·9kg', () => {
    expect(X.BOM_GAS_STRUTS.map((g) => g.kg)).toEqual([1, 5, 7, 9]);
  });
});
