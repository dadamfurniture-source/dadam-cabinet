/**
 * CD-1: 플래너 높이 모델 — 전체 높이 → 몸통(카카스) 높이 변환.
 *
 * 결함이었던 것: 플래너 도면의 사각형 높이는 다리발·상판·상몰딩을 포함한
 * **전체 높이**인데, extractors.js 는 `mod.h` 를 몸통 높이로 그대로 썼다.
 * 그래서 플래너를 거치는 것만으로 하부장 부재가 162mm, 상부장이 60mm
 * 크게 재단됐다. 그대로 발주하면 전량 불량이다.
 *
 * 결정적 계약: **같은 설계라면 플래너를 거치든 안 거치든 BOM 이 같아야 한다.**
 * 이 파일의 마지막 describe 가 그것을 직접 대조한다.
 *
 * 높이 규칙 출처
 *   하부장  몸통 = 전체 - 상판두께 - 다리발
 *   상부장  몸통 = 전체 - 상몰딩            (docs/design-rules/ACTIVE_RULES.md:203 패턴)
 *   키큰장  몸통 = 전체 - 상몰딩 - 좌대      (docs/design-rules/sink.md §5)
 */
global.dlog = () => {};

const fs = require('fs');
const path = require('path');
const { MaterialExtractor } = require('../js/detaildesign/extractors.js');

const SRC = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');

function loadConverter() {
  const start = SRC.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = SRC.indexOf('function _applyPlannerResult');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('변환 블록을 찾지 못했습니다 — ui-step1.js 구조 확인 필요');
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${SRC.slice(start, end)}; return { _convertPlannerModules, _carcassHeight };`)();
}

const { _convertPlannerModules, _carcassHeight } = loadConverter();

/** 다담 표준 specs (data-constants.js DEFAULT_SPECS 와 같은 값) */
const SPECS = {
  lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
  moldingH: 60, wardrobePedestal: 60, upperDoorOverlap: 15,
  finishLeftType: 'None', finishRightType: 'None',
};

describe('플래너 기본값과 제조 표준이 어긋나지 않는다', () => {
  // 이 둘이 갈라진 것이 바로 이번 결함의 원인이었다
  // (플래너 860/800 vs 표준 870/780). 다른 문서라 자동으로는 못 맞춘다.
  const SHELL = fs.readFileSync(path.join(__dirname, '../mockup-shell.html'), 'utf8');
  const CONSTANTS = fs.readFileSync(path.join(__dirname, '../js/detaildesign/data-constants.js'), 'utf8');

  function sectionH(section) {
    const m = SHELL.match(new RegExp(`${section}:\\s*\\{[^}]*moduleH:\\s*(\\d+)`));
    return m ? Number(m[1]) : null;
  }
  function constant(name) {
    const m = CONSTANTS.match(new RegExp(`const ${name} = (\\d+)`));
    return m ? Number(m[1]) : null;
  }

  test('하부장 전체높이가 양쪽 모두 870', () => {
    expect(constant('TOTAL_H_LOWER')).toBe(870);
    expect(sectionH('lower')).toBe(870);
  });

  test('상부장 전체높이가 양쪽 모두 780', () => {
    expect(constant('TOTAL_H_UPPER')).toBe(780);
    expect(sectionH('upper')).toBe(780);
  });

  test('DEFAULT_SPECS 에 설계별 편집용 필드가 있다', () => {
    expect(CONSTANTS).toMatch(/lowerTotalH:\s*870/);
    expect(CONSTANTS).toMatch(/upperTotalH:\s*780/);
  });

  test('플래너 moduleH 가 전체 높이임을 주석으로 못박는다', () => {
    expect(SHELL).toMatch(/moduleH = 모듈 \*\*전체 높이\*\*/);
  });
});

describe('전체 높이 → 몸통 높이', () => {
  test('하부장 870 → 708 (다리발 150 + 몸통 708 + 상판 12)', () => {
    expect(_carcassHeight(870, 'lower', SPECS)).toBe(708);
  });

  test('상부장 780 → 720 (몸통 720 + 상몰딩 60)', () => {
    expect(_carcassHeight(780, 'upper', SPECS)).toBe(720);
  });

  test('키큰장은 상몰딩과 좌대를 뺀다 (sink.md §5)', () => {
    expect(_carcassHeight(2300, 'tall', SPECS)).toBe(2300 - 60 - 60);
    expect(_carcassHeight(2300, 'wardrobe', SPECS)).toBe(2180);
  });

  test('설계별 값을 따른다 — 다리발 180 이면 몸통이 30 줄어든다', () => {
    expect(_carcassHeight(870, 'lower', { ...SPECS, sinkLegHeight: 180 })).toBe(678);
    expect(_carcassHeight(780, 'upper', { ...SPECS, moldingH: 0 })).toBe(780);
  });

  test('specs 가 없으면 표준 기본값으로 떨어진다', () => {
    expect(_carcassHeight(870, 'lower', undefined)).toBe(708);
    expect(_carcassHeight(780, 'upper', null)).toBe(720);
  });

  test('음수로 내려가지 않는다', () => {
    expect(_carcassHeight(100, 'lower', SPECS)).toBe(0);
    expect(_carcassHeight(0, 'lower', SPECS)).toBe(0);
  });
});

describe('변환이 브리지를 통해 실제로 적용된다', () => {
  const payload = {
    modules: [
      { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 },
      { id: 'upper-0', section: 'upper', W: 900, H: 780, D: 295, x: 0, y: 1000 },
    ],
    structures: {
      'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
      'upper-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
    },
  };

  test('모듈 h 가 몸통 높이로 바뀐다', () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    expect(modules.find((m) => m.pos === 'lower').h).toBe(708);
    expect(modules.find((m) => m.pos === 'upper').h).toBe(720);
  });

  test('전체 높이도 함께 보존된다 (도면·검증·학습용)', () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    expect(modules.find((m) => m.pos === 'lower').totalH).toBe(870);
    expect(modules.find((m) => m.pos === 'upper').totalH).toBe(780);
  });

  test('변환 전 값(870/780)이 그대로 새어나가지 않는다', () => {
    const { modules } = _convertPlannerModules(payload, SPECS);
    for (const m of modules) {
      expect(m.h).not.toBe(870);
      expect(m.h).not.toBe(780);
    }
  });
});

describe('🔴 핵심 계약 — 플래너 경유 BOM == 플래너 미경유 BOM', () => {
  /** 플래너를 안 쓰고 직접 만든 모듈 (기존 방식) */
  function directModules() {
    return [
      { id: 1, name: '900/2도어', type: 'storage', pos: 'upper', w: 900, h: 720, d: 295, doorCount: 2, is2door: true },
      { id: 2, name: '900/2도어', type: 'storage', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, is2door: true },
    ];
  }

  /** 같은 가구를 플래너로 그렸을 때 오는 payload (H = 전체 높이) */
  function plannerPayload() {
    return {
      modules: [
        { id: 'upper-0', section: 'upper', W: 900, H: 780, D: 295, x: 0, y: 1000 },
        { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 },
      ],
      structures: {
        'upper-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
        'lower-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900], areaIs2D: [true], shelves: [] },
      },
    };
  }

  function bomOf(modules) {
    const item = { categoryId: 'sink', labelName: '싱크대', w: 900, h: 2310, d: 650, modules, specs: { ...SPECS } };
    return new MaterialExtractor()
      .extract({ items: [item] })
      .materials
      // 이름은 다를 수 있으므로(플래너는 '상부장/하부장' 라벨) 치수 계약만 비교한다
      .map((m) => `${m.part}|${m.material}|${m.thickness}|${m.w}|${m.h}|${m.qty}|${m.edge}`)
      .sort();
  }

  test('두 경로의 자재 치수가 완전히 일치한다', () => {
    const direct = bomOf(directModules());
    const viaPlanner = bomOf(_convertPlannerModules(plannerPayload(), SPECS).modules);
    expect(viaPlanner).toEqual(direct);
  });

  test('변환이 없었다면 불일치했음을 보인다 (회귀 방지)', () => {
    // 예전 동작 재현 — H 를 그대로 몸통으로 쓴 경우
    const broken = _convertPlannerModules(plannerPayload(), SPECS).modules.map((m) => ({ ...m, h: m.totalH }));
    expect(bomOf(broken)).not.toEqual(bomOf(directModules()));
  });

  test('하부 측판이 708, 상부 측판이 720 으로 나온다', () => {
    const mats = new MaterialExtractor().extract({
      items: [{
        categoryId: 'sink', labelName: '싱크대', w: 900, h: 2310, d: 650,
        modules: _convertPlannerModules(plannerPayload(), SPECS).modules,
        specs: { ...SPECS },
      }],
    }).materials;
    const side = (pos) => mats.find((m) => m.module.includes(pos) && m.part === '측판');
    expect(side('하부장').h).toBe(708);
    expect(side('상부장').h).toBe(720);
  });
});
