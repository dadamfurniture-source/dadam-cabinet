/**
 * 냉장고장이 플래너에서 BOM 까지 간다 (2026-09-22).
 *
 * 플래너는 진작부터 냉장고장을 1급 섹션으로 그리고 있었다 — 배치 공간을 놓으면 자동계산이
 * 냉장고 자리(바닥~1870)를 비우고 그 위에 상부장 한 단을 세운다 (stackForArea).
 * 그런데 브리지의 `PLANNER_CABINET_SECTIONS` 에 fridge 가 없어서 그 모듈이 **조용히 버려졌다** —
 * 화면에는 보이는데 자재표에는 한 줄도 없었다. 게다가 냉장고장(fridge)이 냉장고(refrigerator)와
 * 함께 **가전** 목록에 묶여 있었다.
 *
 * 사장님 확정: 냉장고 위 상부장은 전용 화면의 '냉장고상부장' 별도 규칙이 아니라
 * **일반 상부장 규칙**으로 낸다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}
function sliceBetween(src, a, b) {
  const s = src.indexOf(a);
  const e = src.indexOf(b, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${a}`);
  return src.slice(s, e);
}

function setup() {
  const item = {
    uniqueId: 9,
    categoryId: 'sink',
    labelName: '싱크대 #1',
    name: '싱크대',
    w: 3900, h: 2300, d: 650,
    specs: {
      upperH: 720, lowerH: 870, moldingH: 60, sinkLegHeight: 150,
      upperDoorOverlap: 15, topSizes: [{ w: '3900', d: '650' }],
      layoutShape: 'I', lowerLayoutShape: 'I',
      finishLeftType: 'None', finishRightType: 'None',
    },
    modules: [],
  };
  const listeners = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    confirm: () => true,
  };
  const src = `
    ${sliceBetween(UI, 'const NATIVE_ONLY_CATEGORIES', 'function _setStep2Mode')}
    ${sliceBalanced(UI, UI.indexOf('function _currentStep2Item'))}
    ${sliceBetween(UI, 'const PLANNER_CABINET_SECTIONS', 'function _appendV2Payload')}
    ${sliceBalanced(UI, UI.indexOf("window.addEventListener('message', function (e) {"))});
  `;
  // eslint-disable-next-line no-new-func
  new Function(
    'window', 'selectedItems', 'currentItemId', 'dlog', 'updateUI', 'proceedToBOM',
    'incrementCategory', 'CATEGORIES', 'alert', 'console', 'showToast', 'document', src
  )(
    win, [item], 9, () => {}, () => {}, () => {}, () => {}, [{ id: 'sink' }],
    () => {}, { error() {}, warn() {}, debug() {} }, () => {},
    { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {} }) }
  );
  return { item, dispatch: (data) => listeners.forEach((fn) => fn({ data })) };
}

/** 플래너가 보내는 것과 같은 모양 — 냉장고장 상부장 한 단 + 일반 하부장 하나 */
function plannerMessage() {
  return {
    type: 'PLANNER_DONE',
    source: 'mockup-structure',
    modules: [
      { id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
      // stackForArea 가 내는 모양: 냉장고 자리 위에 얹힌 상부장 한 단 (part '상부장')
      { id: 'fridge-0', section: 'fridge', part: '상부장', W: 680, H: 416, D: 670, x: 3200, y: 0, rotation: 0 },
      // 냉장고 **자체**는 가전이다 — 장이 아니다
      { id: 'refrigerator-0', section: 'refrigerator', W: 720, H: 1870, D: 700, x: 3200, y: 0, rotation: 0 },
    ],
    structures: {
      'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [1200], areaIs2D: [false], shelves: [] },
      // 자동계산이 fridge 모듈의 셀은 나누지 않는다 — areaWidths 가 비어 있는 것이 정상이다
      'fridge-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [], areaIs2D: [], shelves: [] },
    },
  };
}

describe('냉장고장은 가전이 아니라 장이다', () => {
  test('캐비닛 목록에 fridge 가 있고, 가전 목록에는 없다', () => {
    const chunk = sliceBetween(UI, 'const PLANNER_CABINET_SECTIONS', 'function _xOverlaps');
    const cab = chunk.match(/PLANNER_CABINET_SECTIONS = \[([^\]]*)\]/)[1];
    const app = chunk.match(/PLANNER_APPLIANCE_SECTIONS = \[([^\]]*)\]/)[1];
    expect(cab).toContain("'fridge'");
    expect(app).not.toContain("'fridge'");
    // 냉장고(가전) 는 그대로 가전이다 — 둘은 다른 섹션이다
    expect(app).toContain("'refrigerator'");
    expect(cab).not.toContain("'refrigerator'");
  });
});

describe('브리지가 냉장고장을 넘긴다', () => {
  test('예전에는 버려졌다 — 이제 모듈로 나온다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    const fridge = item.modules.filter((m) => String(m.id).includes('fridge-0'));
    expect(fridge).toHaveLength(1);
  });

  test('일반 상부장으로 낸다 — pos upper · 이름 상부장 (사장님 확정)', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    const m = item.modules.find((x) => String(x.id).includes('fridge-0'));
    expect(m.pos).toBe('upper');
    expect(m.name).toBe('상부장');
    expect(m.type).toBe('storage');
    expect(m.w).toBe(680);
    expect(m.d).toBe(670);
    expect(m.doorCount).toBe(1);
  });

  test('냉장고 자체는 여전히 모듈이 아니다 — 가전이다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    expect(item.modules.some((m) => String(m.id).includes('refrigerator'))).toBe(false);
  });

  test('"통짜" 헛경고를 내지 않는다 — 냉장고장은 셀을 나누지 않는 것이 정상', () => {
    const warn = sliceBetween(UI, '자동계산 전이라', '통짜로 잡혔습니다');
    const guard = UI.slice(UI.indexOf('if (cells.length === 1 && cells[0].noAutoCalc)'), UI.indexOf('자동계산 전이라'));
    expect(warn).toBeTruthy();
    expect(guard).toContain("m.section !== 'fridge'");
  });
});

describe('BOM — 일반 상부장 부재가 나온다', () => {
  test('냉장고장 몫이 상부장 규칙으로 산출된다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const withFridge = new MaterialExtractor().extract({ items: [item] });
    const withoutFridge = new MaterialExtractor().extract({
      items: [Object.assign({}, item, {
        modules: item.modules.filter((m) => !String(m.id).includes('fridge-0')),
      })],
    });

    // 냉장고장 한 단이 자재를 실제로 늘린다 (예전엔 0 이었다)
    expect(withFridge.materials.length).toBeGreaterThan(withoutFridge.materials.length);
    // 늘어난 부재는 상부장 몸통 — 깊이 670 짜리 측판이 그 증거다
    const added = withFridge.materials.length - withoutFridge.materials.length;
    expect(added).toBeGreaterThanOrEqual(4);          // 측판·천판·지판·뒷판 최소
    expect(withFridge.materials.some((r) => r.part === '측판' && Number(r.w) === 670)).toBe(true);
    // '냉장고상부장' 이라는 별도 이름으로는 나오지 않는다 — 일반 상부장이다
    expect(withFridge.materials.some((r) => String(r.module).includes('냉장고상부장'))).toBe(false);
  });
});
