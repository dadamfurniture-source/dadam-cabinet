/**
 * 플래너(mockup-structure) 결과 → detaildesign 모듈 변환 테스트.
 *
 * 이 변환이 틀리면 BOM 이 틀리고, 그대로 공장에 발주된다.
 * ui-step1.js 는 전역 스크립트라 import 할 수 없으므로,
 * 순수 함수 블록만 소스에서 잘라내 실제 코드를 그대로 평가한다.
 *
 * ★ 가장 중요한 계약: 플래너 사각형 1개 = 제작 모듈 1개가 아니다.
 *   자동계산이 나눈 셀(areaWidths[i]) 하나가 제작 모듈 하나다.
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
  return new Function(`${block}; return { _convertPlannerModules, _xOverlaps };`)();
}

const raw = loadConverter();
const _xOverlaps = raw._xOverlaps;
const convert = (p) => raw._convertPlannerModules(p).modules;
const convertFull = (p) => raw._convertPlannerModules(p);

/** 자동계산이 끝난 상태의 payload — 하부 4260 을 셀로 나눈 모습. */
function payload(overrides = {}) {
  return {
    modules: [
      { id: 'lower-0', section: 'lower', W: 1800, H: 870, D: 650, x: 0, y: 0 },
      { id: 'upper-0', section: 'upper', W: 1800, H: 720, D: 320, x: 0, y: 1000 },
      { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 450, y: 0 },
      { id: 'hood-0', section: 'hood', W: 600, H: 300, D: 320, x: 450, y: 1000 },
    ],
    structures: {
      'lower-0': {
        horizontalLayout: 'doorTopDrawerBottom',
        bottomType: 'drawer',
        areaTypes: ['door', 'open', 'door'],
        areaWidths: [450, 600, 750],
        areaIs2D: [false, false, true],
        shelves: [400],
      },
      'upper-0': {
        horizontalLayout: 'doorOnly',
        areaTypes: ['door', 'open', 'door'],
        areaWidths: [450, 600, 750],
        areaIs2D: [false, false, false],
        shelves: [300, 600],
      },
    },
    ...overrides,
  };
}

describe('★ 플래너 사각형은 셀 단위로 펼쳐진다', () => {
  test('사각형 2개가 셀 4개(오픈 2 포함 6개)로 나뉜다', () => {
    const mods = convert(payload());
    // lower 3셀 + upper 3셀 = 6
    expect(mods).toHaveLength(6);
  });

  test('셀 폭이 areaWidths 를 그대로 따른다', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    expect(lower.map((m) => m.w)).toEqual([450, 600, 750]);
  });

  test('사각형 1개를 통짜 모듈 1개로 만들지 않는다', () => {
    // 4260mm 통짜 캐비닛은 원판 1220×2440 으로 제작 불가
    const p = payload({
      modules: [{ id: 'lower-0', section: 'lower', W: 4260, H: 870, D: 650, x: 0, y: 0 }],
      structures: {
        'lower-0': {
          horizontalLayout: 'doorOnly',
          areaTypes: Array(9).fill('door'),
          areaWidths: [470, 470, 470, 470, 470, 470, 470, 470, 500],
          areaIs2D: Array(9).fill(false),
          shelves: [],
        },
      },
    });
    const mods = convert(p);
    expect(mods).toHaveLength(9);
    expect(mods.every((m) => m.w < 1220)).toBe(true); // 전부 원판 폭 이내
  });

  test('셀 x 좌표가 누적된다', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    expect(lower.map((m) => m._x)).toEqual([0, 450, 1050]);
  });
});

describe('셀 종류별 처리', () => {
  test('open 셀은 도어 0장 · 서랍 없음', () => {
    const open = convert(payload()).find((m) => m.isOpen && m.pos === 'lower');
    expect(open.doorCount).toBe(0);
    expect(open.isDrawer).toBe(false);
    expect(open.w).toBe(600);
  });

  test('양문(areaIs2D) 셀은 도어 2장', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    expect(lower[2].doorCount).toBe(2);
    expect(lower[2].is2door).toBe(true);
  });

  test('단문 셀은 도어 1장', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    expect(lower[0].doorCount).toBe(1);
  });

  test('blank 셀(350mm 미만 잔여)은 캐비닛에서 제외된다', () => {
    const p = payload({
      modules: [{ id: 'lower-0', section: 'lower', W: 800, H: 870, D: 650, x: 0, y: 0 }],
      structures: {
        'lower-0': { areaTypes: ['door', 'blank'], areaWidths: [600, 200], areaIs2D: [false, false], shelves: [] },
      },
    });
    const r = convertFull(p);
    expect(r.modules).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('350mm'))).toBe(true);
  });
});

describe('section → pos 매핑', () => {
  test('upper 는 상부, lower 는 하부', () => {
    const mods = convert(payload());
    expect(mods.filter((m) => m.pos === 'upper')).toHaveLength(3);
    expect(mods.filter((m) => m.pos === 'lower')).toHaveLength(3);
  });

  test('tall / wardrobe 도 하부로 간다', () => {
    const p = payload({
      modules: [
        { id: 'tall-0', section: 'tall', W: 600, H: 2300, D: 650, x: 0, y: 0 },
        { id: 'wardrobe-0', section: 'wardrobe', W: 1200, H: 2300, D: 600, x: 700, y: 0 },
      ],
      structures: {},
    });
    expect(convert(p).every((m) => m.pos === 'lower')).toBe(true);
  });

  test('가전 section 은 캐비닛으로 변환되지 않는다', () => {
    const mods = convert(payload());
    expect(mods.some((m) => m.id.includes('sink-0'))).toBe(false);
    expect(mods.some((m) => m.id.includes('hood-0'))).toBe(false);
  });
});

describe('가전 X 범위 겹침 → 라벨(name)', () => {
  test('분배기와 겹치는 셀만 "개수대" 로 라벨링된다', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    // 분배기 450~1050 = 두 번째 셀(450~1050)
    expect(lower[0].name).toBe('하부장');
    expect(lower[1].name).toBe('개수대');
    expect(lower[2].name).toBe('하부장');
  });

  test('후드와 겹치는 셀만 "후드장" 으로 라벨링된다', () => {
    const upper = convert(payload()).filter((m) => m.pos === 'upper');
    expect(upper[1].name).toBe('후드장');
    expect(upper[0].name).toBe('상부장');
  });

  test('경계가 닿기만 하면 겹침이 아니다', () => {
    expect(_xOverlaps({ x: 0, W: 600 }, { x: 600, W: 600 })).toBe(false);
    expect(_xOverlaps({ x: 0, W: 601 }, { x: 600, W: 600 })).toBe(true);
  });
});

describe('★ type 은 항상 storage — hood 로 주면 BOM 에서 사라진다', () => {
  test('후드장 라벨이어도 type 은 storage', () => {
    // extractors.js:132 는 `m.pos === 'upper' && m.type !== 'hood'` 로 거른다.
    // docs/design-rules/sink.md:37 "hood | 후드 영역 (도어 없음)" — 가구가 아니다.
    const hood = convert(payload()).find((m) => m.name === '후드장');
    expect(hood.type).toBe('storage');
    expect(hood.type).not.toBe('hood');
  });

  test('변환된 모든 모듈의 type 이 storage 다', () => {
    expect(convert(payload()).every((m) => m.type === 'storage')).toBe(true);
  });
});

describe('서랍 · 선반', () => {
  test('doorTopDrawerBottom 은 오픈 아닌 셀에만 서랍 1단', () => {
    const lower = convert(payload()).filter((m) => m.pos === 'lower');
    expect(lower[0].isDrawer).toBe(true);
    expect(lower[0].drawerCount).toBe(1);
    expect(lower[1].isDrawer).toBe(false); // open 셀
  });

  test('doorOnly 는 서랍 없음', () => {
    const upper = convert(payload()).filter((m) => m.pos === 'upper');
    expect(upper.every((m) => m.isDrawer === false)).toBe(true);
  });

  test('shelfCount 는 사각형의 shelves.length 를 셀들이 공유한다', () => {
    const mods = convert(payload());
    expect(mods.filter((m) => m.pos === 'lower').every((m) => m.shelfCount === 1)).toBe(true);
    expect(mods.filter((m) => m.pos === 'upper').every((m) => m.shelfCount === 2)).toBe(true);
  });
});

describe('경고 — 조용히 틀리지 않게', () => {
  test('자동계산 전이면 통짜 1개 + 경고', () => {
    const p = payload({
      modules: [{ id: 'lower-0', section: 'lower', W: 4260, H: 870, D: 650, x: 0, y: 0 }],
      structures: {},
    });
    const r = convertFull(p);
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].w).toBe(4260);
    expect(r.warnings.some((w) => w.includes('자동계산 전'))).toBe(true);
  });

  test('셀 폭 합이 모듈 폭과 다르면 경고 (배치 변경 후 재계산 누락)', () => {
    const p = payload({
      modules: [{ id: 'lower-0', section: 'lower', W: 2000, H: 870, D: 650, x: 0, y: 0 }],
      structures: {
        'lower-0': { areaTypes: ['door', 'door'], areaWidths: [450, 450], areaIs2D: [false, false], shelves: [] },
      },
    });
    const r = convertFull(p);
    expect(r.warnings.some((w) => w.includes('셀 폭 합'))).toBe(true);
  });

  test('폭이 맞으면 경고 없음', () => {
    expect(convertFull(payload()).warnings).toHaveLength(0);
  });

  test('빈 payload 는 빈 배열 (crash 금지)', () => {
    expect(convert({})).toEqual([]);
    expect(convert({ modules: [], structures: {} })).toEqual([]);
  });
});

describe('BOM 이 요구하는 필드가 모두 채워진다', () => {
  test('extractors.js 가 읽는 필드가 빠지지 않는다', () => {
    const m = convert(payload())[0];
    for (const f of ['pos', 'type', 'name', 'w', 'h', 'd', 'doorCount', 'isDrawer', 'drawerCount']) {
      expect(m[f]).toBeDefined();
    }
    expect(typeof m.w).toBe('number');
    expect(typeof m.doorCount).toBe('number');
  });
});
