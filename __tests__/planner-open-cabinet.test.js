/**
 * 오픈장 — 플래너에서 고른 것이 BOM 까지 가는가 (2026-09-19).
 *
 * 규칙 자체는 bom-open-cabinet-rules.test.js 가 본다. 여기서는 **배선**을 본다:
 *   플래너 구조(structures[id].moduleKind = 'open')
 *     → ui-step1 브리지(_convertPlannerModules)
 *     → MaterialExtractor.extractOpenCabinets
 *     → 자재표 세 줄 (측판·천지판·뒷판, 전부 18T MDF)
 *
 * 한 군데라도 필드명이 어긋나면 **오픈장이 일반 장으로 산출된다** — 도어가 없는데 도어가 나간다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const OC = require('../js/detaildesign/bom-open-cabinet-rules.js');

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

/** 브리지를 실제 소스 그대로 평가한다 (전역 스크립트라 import 가 안 된다). */
function setup() {
  const item = {
    uniqueId: 7,
    categoryId: 'storage',
    labelName: '수납장 #1',
    name: '수납장',
    w: 1000, h: 450, d: 570,
    specs: {
      upperH: 720, lowerH: 870, moldingH: 0, sinkLegHeight: 0,
      upperDoorOverlap: 15, topSizes: [{ w: '1000', d: '570' }],
      layoutShape: 'I', lowerLayoutShape: 'I',
      finishLeftType: 'None', finishRightType: 'None',
    },
    modules: [],
  };
  const listeners = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    confirm: () => true,
    // 브리지는 전역이 없으면 window 에서 규칙을 찾는다 — 하네스에서는 이쪽으로 넣는다
    DadamOpenCabinetRules: OC,
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
    win, [item], 7, () => {}, () => {}, () => {}, () => {}, [{ id: 'storage' }],
    () => {}, { error() {}, warn() {}, debug() {} }, () => {},
    { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {} }) }
  );
  return { item, dispatch: (data) => listeners.forEach((fn) => fn({ data })) };
}

/** 오픈장 하나 + 일반 하부장 하나. 오픈장 치수는 사장님 예시(W500 H450 D570). */
function plannerMessage() {
  return {
    type: 'PLANNER_DONE',
    source: 'mockup-structure',
    modules: [
      { id: 'lower-open', section: 'lower', W: 500, H: 450, D: 570, x: 0, y: 0, rotation: 0 },
      { id: 'lower-normal', section: 'lower', W: 600, H: 450, D: 570, x: 500, y: 0, rotation: 0 },
    ],
    structures: {
      // 오픈장 — 칸·서랍 값이 남아 있어도 무시되어야 한다 (타입을 되돌릴 수 있게 지우지 않는다)
      'lower-open': {
        moduleKind: 'open', horizontalLayout: 'doorOnly',
        areaTypes: ['door'], areaWidths: [500], areaIs2D: [false], shelves: [200],
      },
      'lower-normal': {
        horizontalLayout: 'doorOnly',
        areaTypes: ['door'], areaWidths: [600], areaIs2D: [false], shelves: [],
      },
    },
  };
}

describe('플래너 — 오픈장 배선', () => {
  test('mockup-structure 가 모듈 타입을 구조에 저장하고 오픈장 경로를 갖는다', () => {
    expect(STRUCT).toMatch(/moduleKind: 'normal'/);                 // defaultStructure
    expect(STRUCT).toMatch(/bom-open-cabinet-rules\.js/);           // 규칙 파일을 싣는다
    expect(STRUCT).toMatch(/function renderOpenCabinetFront/);      // 정면도
    expect(STRUCT).toMatch(/function buildOpenCabinetMesh/);        // 3D
    expect(STRUCT).toMatch(/data-mp="kind"/);                       // 모듈 타입 섹션
    expect(STRUCT).toMatch(/id="selModuleKind"/);                   // 고르는 곳
  });

  test('오픈장은 그 아래 섹션(칸·서랍·선반·손잡이)을 닫는다 — 고를 것이 없다', () => {
    const sync = sliceBalanced(STRUCT, STRUCT.indexOf('function syncModulePanelSections'));
    expect(sync).toMatch(/const open = isOpenCabinet\(s\)/);
    ['split', 'areas', 'drawer', 'shelves', 'handle'].forEach((k) => {
      expect(sync).toMatch(new RegExp(`${k}: !open`));
    });
  });
});

describe('브리지 — 오픈장 모듈 하나가 그대로 넘어간다', () => {
  test('셀로 쪼개지 않고 모듈 하나, 도어 0, moduleKind 를 달고 간다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    const open = item.modules.filter((m) => m.moduleKind === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].doorCount).toBe(0);
    expect(open[0].isDrawer).toBe(false);
    expect(open[0].shelfCount).toBe(0);
    expect(open[0].name).toBe('오픈장');
    // 치수는 플래너가 준 그대로 (높이는 몸통 높이로 환산된다)
    expect(open[0].w).toBe(500);
    expect(open[0].d).toBe(570);
    // 일반 모듈은 예전처럼 간다 — 오픈장이 다른 모듈을 삼키지 않는다
    expect(item.modules.filter((m) => m.moduleKind !== 'open')).toHaveLength(1);
  });
});

describe('BOM — 오픈장은 18T MDF 세 줄이다', () => {
  test('측판·천지판·뒷판이 규칙대로 나오고, 도어는 한 장도 없다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    const openMod = item.modules.find((m) => m.moduleKind === 'open');
    // 몸통 높이 환산분을 규칙에 그대로 먹인다 — 자재표와 같은 숫자여야 한다
    const expected = OC.partsOf({ W: openMod.w, H: openMod.h, D: openMod.d });

    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const result = new MaterialExtractor().extract({ items: [item] });

    const rows = result.materials.filter((r) => String(r.module).includes('오픈장'));
    expect(rows.map((r) => r.part)).toEqual(['측판', '천지판', '뒷판']);
    rows.forEach((r, i) => {
      expect(r.material).toBe('MDF');
      expect(Number(r.thickness)).toBe(18);
      expect([Number(r.w), Number(r.h), Number(r.qty)])
        .toEqual([expected[i].w, expected[i].h, expected[i].qty]);
    });
    // 오픈장 몫의 도어·선반은 없다 (일반 모듈 것만 남는다)
    expect(rows.some((r) => r.part === '도어' || r.part === '선반')).toBe(false);
  });

  test('오픈장은 카테고리 추출기를 타지 않는다 — 한 상자가 두 벌 나가지 않는다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const withOpen = new MaterialExtractor().extract({ items: [item] });

    // 같은 품목에서 오픈장 모듈만 뺀 것과 견준다. 카테고리 추출기가 오픈장을 또 냈다면
    // 차이가 3줄보다 커진다 (PB 몸통·도어·선반이 딸려 나온다).
    const withoutOpen = new MaterialExtractor().extract({
      items: [Object.assign({}, item, { modules: item.modules.filter((m) => m.moduleKind !== 'open') })],
    });

    expect(withOpen.materials.filter((r) => String(r.module).includes('오픈장'))).toHaveLength(3);
    expect(withoutOpen.materials.filter((r) => String(r.module).includes('오픈장'))).toHaveLength(0);
    expect(withOpen.materials.length - withoutOpen.materials.length).toBe(3);
  });
});
