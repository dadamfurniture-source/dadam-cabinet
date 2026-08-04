/**
 * 플래너(mockup-structure) 결과 → detaildesign 모듈 변환 테스트.
 *
 * 이 변환이 틀리면 BOM 이 틀리고, 그대로 공장에 발주된다.
 * ui-step1.js 는 전역 스크립트라 import 할 수 없으므로,
 * 순수 함수 블록만 소스에서 잘라내 실제 코드를 그대로 평가한다.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');

function loadConverter() {
  const start = SRC.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = SRC.indexOf('function _applyPlannerResult');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('변환 함수 블록을 찾지 못했습니다 — ui-step1.js 구조가 바뀌었는지 확인하세요.');
  }
  const block = SRC.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return { _convertPlannerModules, _doorCountFromStructure, _xOverlaps };`)();
}

const { _convertPlannerModules, _doorCountFromStructure, _xOverlaps } = loadConverter();

/** 하부장 2개 + 상부장 1개 + 분배기 + 후드 */
function payload(overrides = {}) {
  return {
    modules: [
      { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 650, x: 0, y: 0 },
      { id: 'lower-1', section: 'lower', W: 1200, H: 870, D: 650, x: 900, y: 0 },
      { id: 'upper-0', section: 'upper', W: 800, H: 720, D: 320, x: 0, y: 1000 },
      // 가전 — 캐비닛이 아니라 X 범위 판정용
      { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 100, y: 0 },
      { id: 'hood-0', section: 'hood', W: 600, H: 300, D: 320, x: 100, y: 1000 },
    ],
    structures: {
      'lower-0': {
        verticalCount: 2,
        horizontalLayout: 'doorTopDrawerBottom',
        bottomType: 'drawer',
        drawerHeight: 200,
        areaTypes: ['door', 'door'],
        areaIs2D: [false, false],
        shelves: [400],
      },
      'lower-1': {
        verticalCount: 1,
        horizontalLayout: 'doorOnly',
        areaTypes: ['door'],
        areaIs2D: [true], // 양문
        shelves: [],
      },
      'upper-0': {
        verticalCount: 2,
        horizontalLayout: 'doorOnly',
        areaTypes: ['door', 'open'],
        areaIs2D: [false, false],
        shelves: [300, 600],
      },
    },
    ...overrides,
  };
}

const byId = (mods, plannerId) => mods.find((m) => m.id === `planner-${plannerId}`);

describe('section → pos 매핑', () => {
  test('upper 는 상부, lower 는 하부', () => {
    const mods = _convertPlannerModules(payload());
    expect(byId(mods, 'upper-0').pos).toBe('upper');
    expect(byId(mods, 'lower-0').pos).toBe('lower');
  });

  test('tall / wardrobe 도 하부로 간다 (_appendV2Payload 의 lowerSection 매핑의 역)', () => {
    const p = payload({
      modules: [
        { id: 'tall-0', section: 'tall', W: 600, H: 2300, D: 650, x: 0, y: 0 },
        { id: 'wardrobe-0', section: 'wardrobe', W: 1200, H: 2300, D: 600, x: 700, y: 0 },
      ],
      structures: {},
    });
    const mods = _convertPlannerModules(p);
    expect(mods).toHaveLength(2);
    expect(mods.every((m) => m.pos === 'lower')).toBe(true);
  });

  test('가전 section 은 캐비닛 모듈로 변환되지 않는다', () => {
    const mods = _convertPlannerModules(payload());
    expect(mods).toHaveLength(3); // lower×2 + upper×1
    expect(mods.some((m) => m.id.includes('sink-0'))).toBe(false);
    expect(mods.some((m) => m.id.includes('hood-0'))).toBe(false);
  });
});

describe('가전 X 범위 겹침 → 라벨(name) 판정', () => {
  test('분배기와 겹치는 하부장은 "개수대" 로 라벨링된다', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-0'); // x 0~900, 분배기 100~700
    expect(m.name).toBe('개수대');
  });

  test('분배기와 안 겹치는 하부장은 "하부장"', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-1'); // x 900~2100 → 안 겹침
    expect(m.name).toBe('하부장');
  });

  test('후드와 겹치는 상부장은 "후드장" 으로 라벨링된다', () => {
    const m = byId(_convertPlannerModules(payload()), 'upper-0'); // x 0~800, 후드 100~700
    expect(m.name).toBe('후드장');
  });

  test('후드는 상부에만, 분배기는 하부에만 적용된다', () => {
    const p = payload();
    p.modules.push({ id: 'sink-1', section: 'sink', W: 800, H: 100, D: 500, x: 0, y: 1000 });
    expect(byId(_convertPlannerModules(p), 'upper-0').name).toBe('후드장'); // 개수대 아님
  });

  test('경계가 닿기만 하면 겹침이 아니다', () => {
    const p = payload({
      modules: [
        { id: 'lower-0', section: 'lower', W: 600, H: 870, D: 650, x: 0, y: 0 },
        { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 600, y: 0 },
      ],
      structures: {},
    });
    expect(_convertPlannerModules(p)[0].name).toBe('하부장');
    expect(_xOverlaps({ x: 0, W: 600 }, { x: 600, W: 600 })).toBe(false);
    expect(_xOverlaps({ x: 0, W: 601 }, { x: 600, W: 600 })).toBe(true);
  });
});

describe('★ type 은 항상 storage — hood 로 주면 BOM 에서 사라진다', () => {
  test('후드와 겹쳐도 type 은 hood 가 아니다', () => {
    // extractors.js:132 는 `m.pos === 'upper' && m.type !== 'hood'` 로 상부장을 거른다.
    // 'hood' 로 주면 몸통(측판/천판/지판/뒷판)까지 BOM 에서 통째로 빠져 제작 누락이 된다.
    // docs/design-rules/sink.md:37 "hood | 후드 영역 (도어 없음)" — 가구가 아니라 빈 영역이다.
    const m = byId(_convertPlannerModules(payload()), 'upper-0');
    expect(m.name).toBe('후드장');
    expect(m.type).not.toBe('hood');
    expect(m.type).toBe('storage');
  });

  test('변환된 모든 모듈의 type 이 storage 다', () => {
    const mods = _convertPlannerModules(payload());
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.every((m) => m.type === 'storage')).toBe(true);
  });

  test('가전 영역은 type 이 아니라 areaTypes:open 으로 표현된다', () => {
    // 플래너의 splitModuleByAppliance 가 가전 X 범위를 kind:'open' 으로 잘라
    // areaTypes 에 'open' 을 넣으므로 그 구간에는 도어가 잡히지 않는다.
    const p = payload();
    p.structures['upper-0'] = { areaTypes: ['door', 'open'], areaIs2D: [false, false], shelves: [] };
    const m = byId(_convertPlannerModules(p), 'upper-0');
    expect(m.doorCount).toBe(1); // open 구간은 도어 없음
    expect(m.type).toBe('storage'); // 그래도 캐비닛은 캐비닛
  });
});

describe('doorCount — 도어 장수', () => {
  test('door 2칸 = 2장', () => {
    expect(byId(_convertPlannerModules(payload()), 'lower-0').doorCount).toBe(2);
  });

  test('양문(areaIs2D) 1칸 = 2장', () => {
    expect(byId(_convertPlannerModules(payload()), 'lower-1').doorCount).toBe(2);
  });

  test('open 영역은 도어를 세지 않는다', () => {
    // upper-0: ['door','open'] → 1장
    expect(byId(_convertPlannerModules(payload()), 'upper-0').doorCount).toBe(1);
  });

  test('areaTypes 가 없으면 verticalCount 로 폴백', () => {
    expect(_doorCountFromStructure({ verticalCount: 3 })).toBe(3);
    expect(_doorCountFromStructure({ verticalCount: 3, areaTypes: [] })).toBe(3);
  });

  test('구조 자체가 없으면 1장', () => {
    expect(_doorCountFromStructure(null)).toBe(1);
    const p = payload({ structures: {} });
    expect(byId(_convertPlannerModules(p), 'lower-0').doorCount).toBe(1);
  });

  test('전부 open 이면 0장', () => {
    expect(_doorCountFromStructure({ areaTypes: ['open', 'open'], areaIs2D: [false, false] })).toBe(0);
  });
});

describe('서랍 · 선반', () => {
  test('doorTopDrawerBottom + bottomType=drawer → 서랍장 1단', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-0');
    expect(m.isDrawer).toBe(true);
    expect(m.drawerCount).toBe(1);
  });

  test('doorOnly 는 서랍 없음', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-1');
    expect(m.isDrawer).toBe(false);
    expect(m.drawerCount).toBe(0);
  });

  test('bottomType 이 door 면 서랍이 아니다', () => {
    const p = payload();
    p.structures['lower-0'].bottomType = 'door';
    expect(byId(_convertPlannerModules(p), 'lower-0').isDrawer).toBe(false);
  });

  test('shelfCount = shelves.length', () => {
    const mods = _convertPlannerModules(payload());
    expect(byId(mods, 'lower-0').shelfCount).toBe(1);
    expect(byId(mods, 'lower-1').shelfCount).toBe(0);
    expect(byId(mods, 'upper-0').shelfCount).toBe(2);
  });
});

describe('치수와 순서', () => {
  test('W/H/D 가 그대로 옮겨진다', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-1');
    expect(m.w).toBe(1200);
    expect(m.h).toBe(870);
    expect(m.d).toBe(650);
  });

  test('같은 pos 안에서는 x 순으로 정렬된다', () => {
    const p = payload({
      modules: [
        { id: 'lower-1', section: 'lower', W: 600, H: 870, D: 650, x: 2000, y: 0 },
        { id: 'lower-0', section: 'lower', W: 600, H: 870, D: 650, x: 0, y: 0 },
      ],
      structures: {},
    });
    const mods = _convertPlannerModules(p);
    expect(mods.map((m) => m._x)).toEqual([0, 2000]);
  });

  test('빈 payload 는 빈 배열 (crash 금지)', () => {
    expect(_convertPlannerModules({})).toEqual([]);
    expect(_convertPlannerModules({ modules: [], structures: {} })).toEqual([]);
  });
});

describe('BOM 이 요구하는 필드가 모두 채워진다', () => {
  test('extractors.js 가 읽는 필드가 빠지지 않는다', () => {
    const m = byId(_convertPlannerModules(payload()), 'lower-0');
    // extractors.js 가 실제로 참조하는 모듈 필드
    for (const f of ['pos', 'type', 'name', 'w', 'h', 'd', 'doorCount', 'isDrawer', 'drawerCount']) {
      expect(m[f]).toBeDefined();
    }
    expect(typeof m.w).toBe('number');
    expect(typeof m.doorCount).toBe('number');
  });
});
