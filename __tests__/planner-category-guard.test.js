/**
 * CD-3b: 카테고리 가드 · 키큰장 정체성 · 마감재 전달.
 *
 * 가장 위험했던 것: `_applyPlannerResult` 가 카테고리를 보지 않고
 * `item.modules` 를 통째로 교체했다. 붙박이장 품목에 플래너 결과가 들어오면
 * 기존 모듈이 지워지는데, extractWardrobe 는 pos 'wardrobe'/'tall' 만 보므로
 * 플래너가 만든 'lower'/'upper' 는 하나도 안 잡혀 **BOM 이 조용히 0건**이 됐다.
 * 화면엔 아무 오류도 안 뜬다.
 *
 * 2026-09-17: 붙박이장 차단을 풀었다 — 브리지가 통을 pos 'wardrobe' 로 보내고 통 구조까지 옮긴다
 * (planner-to-bom-wardrobe.test.js). 그 사고를 막던 자리는 **"붙박이장 통이 0개면 거부"** 로 바뀌었다.
 * 냉장고장은 그대로 막혀 있다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');

function loadConverter() {
  const start = UI.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = UI.indexOf('function _applyPlannerResult');
  // eslint-disable-next-line no-new-func
  return new Function(`${UI.slice(start, end)}; return { _convertPlannerModules };`)();
}
const { _convertPlannerModules } = loadConverter();

const SPECS = { moldingH: 60, sinkLegHeight: 150, topThickness: 12, wardrobePedestal: 60 };

describe('붙박이장·냉장고장에 플래너 결과를 적용하지 않는다', () => {
  const applyFn = () => UI.slice(UI.indexOf('function _applyPlannerResult'), UI.indexOf('function _showPlannerSummary'));

  test('_applyPlannerResult 가 결과를 못 받는 카테고리를 막는다', () => {
    const fn = applyFn();
    expect(fn).toMatch(/_plannerResultBlocked\(item\)/);
    // 막기만 하고 넘어가면 안 된다 — 교체 전에 throw 해야 한다
    expect(fn.indexOf('_plannerResultBlocked(item)')).toBeLessThan(fn.indexOf('item.modules = modules'));
  });

  test('막는 이유를 사용자에게 설명한다', () => {
    expect(applyFn()).toMatch(/냉장고장은 전용 화면/);
  });

  test('붙박이장은 통이 0개일 때만 거부한다 — 그 사고를 막던 자리', () => {
    const fn = applyFn();
    expect(fn).toMatch(/categoryId === 'wardrobe' && !modules\.some/);
    expect(fn).toMatch(/붙박이장 통이 없습니다/);
    // 이 검사도 교체 전에 있어야 한다
    expect(fn.indexOf('붙박이장 통이 없습니다')).toBeLessThan(fn.indexOf('item.modules = modules'));
  });

  test('결과를 못 받는 목록·화면 예외 목록 모두 냉장고장만 남았다', () => {
    expect(UI).toMatch(/PLANNER_RESULT_BLOCKED = \['fridge'\]/);
    // 2026-09-17: 화면도 옮겼다 — 붙박이장은 싱크대와 같은 플래너 화면이다
    expect(UI).toMatch(/NATIVE_ONLY_CATEGORIES = \['fridge'\]/);
  });
});

describe('키큰장 정체성', () => {
  const payload = {
    modules: [
      { id: 'tall-0', section: 'tall', W: 600, H: 2300, D: 550, x: 0, y: 0 },
      { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 700, y: 0 },
    ],
    structures: {
      'tall-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [600], areaIs2D: [false], shelves: [] },
      'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
    },
  };

  test("type 이 'tall' 로 남아 일반 하부장과 구분된다", () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    const tall = modules.find((m) => m.id.startsWith('planner-tall-0'));
    expect(tall.type).toBe('tall');
    expect(tall.name).toBe('키큰장');
  });

  test("pos 는 'lower' 다 (sink.md §3 — 키큰장은 하부 라인)", () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    expect(modules.find((m) => m.id.startsWith('planner-tall-0')).pos).toBe('lower');
  });

  test('키큰장 높이는 상몰딩·좌대를 뺀 몸통이다 (sink.md §5)', () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    expect(modules.find((m) => m.id.startsWith('planner-tall-0')).h).toBe(2300 - 60 - 60);
  });

  test('일반 하부장은 그대로 storage 다', () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    expect(modules.find((m) => m.id.startsWith('planner-lower-0')).type).toBe('storage');
  });
});

describe('마감재(EP·몰딩·휠라) 전달', () => {
  test('플래너가 finishings 를 payload 에 싣는다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function buildPlannerPayload'), STRUCT.indexOf('function sendPlannerState'));
    expect(fn).toMatch(/finishings:/);
    expect(fn).toMatch(/isFixed:/);
  });

  test('도면에 마감재가 있는데 스펙이 없음이면 경고한다', () => {
    // EP·몰딩 자재는 모듈이 아니라 specs.finishLeft/RightType 에서 나온다.
    // 플래너에 그리기만 해선 발주되지 않으므로 조용히 빠지면 안 된다.
    const payload = {
      modules: [{
        id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0,
        finishings: [{ section: 'molding', W: 60, H: 870, D: 18, x: 900, y: 0 }],
      }],
      structures: {
        'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
      },
    };
    const { warnings } = _convertPlannerModules(payload, { ...SPECS, finishLeftType: 'None', finishRightType: 'None' });
    expect(warnings.join('\n')).toMatch(/마감재 1개/);
  });

  test('스펙에 마감이 지정돼 있으면 경고하지 않는다', () => {
    const payload = {
      modules: [{
        id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0,
        finishings: [{ section: 'molding', W: 60, H: 870, D: 18, x: 900, y: 0 }],
      }],
      structures: {
        'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
      },
    };
    const { warnings } = _convertPlannerModules(payload, { ...SPECS, finishLeftType: 'Molding', finishLeftWidth: 60 });
    expect(warnings.join('\n')).not.toMatch(/마감재/);
  });

  test('마감재가 없으면 경고도 없다', () => {
    const payload = {
      modules: [{ id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 }],
      structures: {
        'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
      },
    };
    const { warnings } = _convertPlannerModules(payload, SPECS);
    expect(warnings.join('\n')).not.toMatch(/마감재/);
  });
});
