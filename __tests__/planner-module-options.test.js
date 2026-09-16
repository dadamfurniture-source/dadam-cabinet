/**
 * CD-2: 모듈별 높이 구성 + 자동계산이 고정 모듈을 존중하는지.
 *
 * Central Dogma 의 출발점은 "사용자가 정한 모듈 크기가 BOM 까지 살아서 간다" 이다.
 * CD-1 이 높이 계산을 맞췄고 CD-3 이 저장·격리를 고쳤다면,
 * CD-2 는 **사용자가 값을 정할 수 있게** 하고 그 값이 지워지지 않게 한다.
 *
 * 지워지던 경로: '모듈 고정' 체크박스에 "자동계산 시 보존" 이라고 적혀 있는데,
 * autoCalcModule 이 areaTypes/areaWidths/areaIs2D/verticalCount 를 무조건
 * 재생성해서 손으로 맞춘 셀 폭이 자동계산 한 번에 사라졌다.
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
  return new Function(`${UI.slice(start, end)}; return { _carcassHeight, _heightPartsOf, _convertPlannerModules };`)();
}
const { _carcassHeight, _heightPartsOf, _convertPlannerModules } = loadConverter();

const SPECS = { moldingH: 60, sinkLegHeight: 150, topThickness: 12, wardrobePedestal: 60 };

describe('모듈별 높이 구성이 몸통에 반영된다', () => {
  test('다리발을 180 으로 올리면 몸통이 30 줄어든다', () => {
    expect(_carcassHeight(870, 'lower', SPECS, {})).toBe(708);
    expect(_carcassHeight(870, 'lower', SPECS, { legH: 180 })).toBe(678);
  });

  test('상판 두께도 몸통에서 빠진다', () => {
    expect(_carcassHeight(870, 'lower', SPECS, { topT: 30 })).toBe(690);
  });

  test('상부장은 상몰딩을 모듈별로 정한다', () => {
    expect(_carcassHeight(780, 'upper', SPECS, { moldingH: 0 })).toBe(780);
    expect(_carcassHeight(780, 'upper', SPECS, { moldingH: 100 })).toBe(680);
  });

  test('키큰장은 좌대와 상몰딩을 각각 정한다', () => {
    expect(_carcassHeight(2300, 'tall', SPECS, { pedestalH: 100, moldingH: 50 })).toBe(2150);
  });

  test('우선순위: 모듈 → 스펙 → 표준', () => {
    // 모듈값이 스펙을 이긴다
    expect(_carcassHeight(870, 'lower', { ...SPECS, sinkLegHeight: 150 }, { legH: 200 })).toBe(658);
    // 모듈값이 없으면 스펙을 쓴다
    expect(_carcassHeight(870, 'lower', { ...SPECS, sinkLegHeight: 200 }, {})).toBe(658);
    // 둘 다 없으면 표준
    expect(_carcassHeight(870, 'lower', {}, {})).toBe(708);
  });

  test('쓰레기값은 무시하고 다음 단계로 떨어진다', () => {
    for (const bad of [null, undefined, '', 'abc', -5]) {
      expect(_carcassHeight(870, 'lower', SPECS, { legH: bad })).toBe(708);
    }
  });
});

describe('적용된 높이 부위를 모듈에 남긴다', () => {
  test('하부장은 다리발·상판을 남긴다', () => {
    expect(_heightPartsOf('lower', SPECS, { legH: 180 })).toEqual({ legH: 180, topT: 12 });
  });

  test('상부장은 상몰딩만 남긴다', () => {
    expect(_heightPartsOf('upper', SPECS, {})).toEqual({ moldingH: 60 });
  });

  test('키큰장은 좌대와 상몰딩을 남긴다', () => {
    expect(_heightPartsOf('tall', SPECS, {})).toEqual({ moldingH: 60, pedestalH: 60 });
  });

  test('변환된 모듈이 몸통·전체·부위를 모두 갖는다', () => {
    const payload = {
      modules: [{ id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 }],
      structures: {
        'lower-0': {
          horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900],
          areaIs2D: [false], shelves: [], legH: 180,
        },
      },
    };
    const mod = _convertPlannerModules(payload, SPECS).modules[0];
    expect(mod.h).toBe(678);          // 몸통 (다리발 180 반영)
    expect(mod.totalH).toBe(870);     // 전체
    expect(mod.heightParts).toEqual({ legH: 180, topT: 12 });
  });
});

describe('플래너 높이 구성 패널', () => {
  test('패널 자리와 렌더 함수가 있다', () => {
    expect(STRUCT).toMatch(/id="heightBody"/);
    expect(STRUCT).toMatch(/function renderHeightPanel/);
    expect(STRUCT).toMatch(/function heightPartsOf/);
    expect(STRUCT).toMatch(/function bodyHeightOf/);
  });

  test('섹션마다 부위 구성이 다르다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function heightPartsOf'), STRUCT.indexOf('function bodyHeightOf'));
    expect(fn).toMatch(/'upper'/);
    expect(fn).toMatch(/'tall'/);
    expect(fn).toMatch(/legH/);
    expect(fn).toMatch(/pedestalH/);
    expect(fn).toMatch(/moldingH/);
  });

  test('몸통은 전체에서 부위를 뺀 값이다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function bodyHeightOf'), STRUCT.indexOf('function renderHeightPanel'));
    expect(fn).toMatch(/Number\(m\.H\)/);
    expect(fn).toMatch(/reduce/);
  });

  test('값을 바꾸면 즉시 저장한다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function renderHeightPanel'), STRUCT.indexOf('function renderRightPanel'));
    expect((fn.match(/persistPlannerState\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('몸통이 50mm 미만이 되는 입력은 막는다', () => {
    // W12-31: 가드는 applyHeightPart 한 곳으로 옮겼다. 예전엔 우측 패널과
    // 팔레트에 문구까지 다른 두 벌이 있어, 한쪽만 고치면 다른 쪽으로는 통과했다.
    const fn = STRUCT.slice(STRUCT.indexOf('function applyHeightPart'),
                            STRUCT.indexOf('function panelCommit'));
    expect(fn).toMatch(/bodyHeightOf\(m, s\) >= 50/);
    // 되돌릴 때 delete 가 아니라 이전 값을 되놓는다 — 미지정과 0 은 다르다.
    expect(fn).toMatch(/if \(prev === undefined\) delete s\[key\]; else s\[key\] = prev;/);
    expect(fn).toContain('showToast');
  });

  test('가드를 부르는 곳은 높이 패널 하나다', () => {
    // W12-32: 팔레트를 걷어냈다. 예전엔 팔레트에도 같은 가드가 문구까지 다르게
    // 한 벌 더 있었다 — 한쪽만 고치면 다른 쪽으로는 통과했다.
    const right = STRUCT.slice(STRUCT.indexOf('function renderHeightPanel'),
                               STRUCT.indexOf('const PANEL_SEC_TITLE'));
    expect(right).toContain('applyHeightPart(m, s, key, inp.value)');
    expect((STRUCT.match(/applyHeightPart\(/g) || []).length).toBe(2);   // 정의 1 + 호출 1
    // 손으로 다시 재는 곳이 없어야 한다.
    expect(STRUCT).not.toMatch(/bodyHeightOf\(m, s\) < 50/);
  });

  test('몸통을 직접 정하면 그 모듈을 고정 처리한다', () => {
    // 사용자가 명시한 높이를 자동계산이 다시 건드리면 안 된다
    const fn = STRUCT.slice(STRUCT.indexOf('function renderHeightPanel'), STRUCT.indexOf('function renderRightPanel'));
    expect(fn).toMatch(/m\.isFixed = true/);
  });
});

describe('서랍 단수를 사용자가 정한다', () => {
  function drawerPayload(drawerCount) {
    return {
      modules: [{ id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 }],
      structures: {
        'lower-0': {
          horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer',
          areaTypes: ['door'], areaWidths: [900], areaIs2D: [false], shelves: [],
          ...(drawerCount === undefined ? {} : { drawerCount }),
        },
      },
    };
  }

  test('지정한 단수가 그대로 넘어간다', () => {
    expect(_convertPlannerModules(drawerPayload(3), SPECS).modules[0].drawerCount).toBe(3);
  });

  test('미지정이면 1단 (기존 동작 유지)', () => {
    expect(_convertPlannerModules(drawerPayload(undefined), SPECS).modules[0].drawerCount).toBe(1);
  });

  test('오픈 구간은 서랍을 넣지 않는다', () => {
    const p = drawerPayload(3);
    p.structures['lower-0'].areaTypes = ['open'];
    expect(_convertPlannerModules(p, SPECS).modules[0].drawerCount).toBe(0);
  });

  test('비정상 값은 1단으로 떨어지고 상한은 4단 (2026-09-15 서랍 규칙)', () => {
    for (const bad of [0, -2, 'abc', null]) {
      expect(_convertPlannerModules(drawerPayload(bad), SPECS).modules[0].drawerCount).toBe(1);
    }
    expect(_convertPlannerModules(drawerPayload(99), SPECS).modules[0].drawerCount).toBe(4);
  });

  test('플래너에 서랍 단수 입력이 있다', () => {
    expect(STRUCT).toMatch(/id="inpDrawerCount"/);
    expect(STRUCT).toMatch(/s\.drawerCount = v/);
  });
});

describe('서랍 규칙 블록 — 레일·사쿠리·서랍 자재 두께가 BOM 모듈 drawer 로 넘어간다 (2026-09-15)', () => {
  function payloadWith(drawer, extra = {}) {
    return {
      modules: [{ id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 }],
      structures: {
        'lower-0': Object.assign({
          horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200, drawerCount: 2,
          areaTypes: ['door'], areaWidths: [900], areaIs2D: [false], shelves: [],
        }, drawer === undefined ? {} : { drawer }, extra),
      },
    };
  }
  const mod = (p) => _convertPlannerModules(p, SPECS).modules[0];

  test('플래너 s.drawer 블록이 정규화되어 그대로 실린다', () => {
    expect(mod(payloadWith({ rail: 'ball', sakuri: true, boxT: 18 })).drawer).toEqual({ rail: 'ball', sakuri: true, boxT: 18 });
  });

  test('미지정이면 기본값 {언더레일, 사쿠리 없음, 몸통 두께} — 옛 저장 구조도 BOM 이 같은 모양을 받는다', () => {
    expect(mod(payloadWith(undefined)).drawer).toEqual({ rail: 'under', sakuri: false, boxT: 0 });
  });

  test('옛 평면 필드 s.drawerRail 도 읽는다', () => {
    expect(mod(payloadWith(undefined, { drawerRail: 'ball' })).drawer.rail).toBe('ball');
  });

  test('모르는 레일·자재 두께는 기본으로', () => {
    expect(mod(payloadWith({ rail: 'x', boxT: 20 })).drawer).toEqual({ rail: 'under', sakuri: false, boxT: 0 });
  });

  test('서랍이 없는 모듈(오픈·도어만)에는 drawer 키가 없다 — payload 가 예전과 같다', () => {
    const open = payloadWith({ rail: 'ball' });
    open.structures['lower-0'].areaTypes = ['open'];
    expect('drawer' in mod(open)).toBe(false);
    const doorOnly = payloadWith({ rail: 'ball' });
    doorOnly.structures['lower-0'].horizontalLayout = 'doorOnly';
    expect('drawer' in mod(doorOnly)).toBe(false);
  });

  test('2026-09-16: 배치 높이와 전면 등급이 BOM 까지 닿아 배분식으로 재단된다', () => {
    global.dlog = () => {};
    const { MaterialExtractor } = require('../js/detaildesign/extractors.js');
    const pl = payloadWith({ grades: ['small', 'small'] });
    pl.modules[0].areaH = 870;                       // 플래너가 싣는 배치 높이
    const modules = _convertPlannerModules(pl, SPECS).modules;
    expect(modules[0].areaH).toBe(870);
    expect(modules[0].drawer.grades).toEqual(['small', 'small']);
    const item = { uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 900, h: 2310, d: 650,
      specs: Object.assign({}, SPECS, { handle: '찬넬 (목찬넬)', topSizes: [{ w: '900', d: '650' }] }), modules };
    const rows = new MaterialExtractor().extract({ items: [item] }).materials;
    // 영역 = (870 − 상판 12) − 다리발 150 − 30×2 = 648. 도어 대(2) + 소(1) + 소(1) = 4 버줌 → 324 · 162 · 162
    expect(rows.find((r) => r.part === '도어')).toMatchObject({ h: 324 });
    expect(rows.find((r) => r.part === '서랍도어')).toMatchObject({ h: 162, qty: 2 });
  });

  test('배치 높이를 안 싣는 옛 설계는 areaH 키가 없다', () => {
    expect('areaH' in mod(payloadWith(undefined))).toBe(false);
  });

  test('모르는 등급은 버린다 — 규칙 파일 기본값에 맡긴다', () => {
    expect(mod(payloadWith({ grades: ['small', 'xxx'] })).drawer.grades).toEqual(['small']);
    expect('grades' in mod(payloadWith({ grades: [] })).drawer).toBe(false);
    expect(mod(payloadWith({ doorGrade: 'medium' })).drawer.doorGrade).toBe('medium');
    expect('doorGrade' in mod(payloadWith({ doorGrade: 'zzz' })).drawer).toBe(false);
  });

  test('플래너 → 브리지 → BOM: 볼레일·사쿠리·18T 가 자재표까지 닿는다', () => {
    global.dlog = () => {};
    const { MaterialExtractor, HardwareExtractor } = require('../js/detaildesign/extractors.js');
    const modules = _convertPlannerModules(payloadWith({ rail: 'ball', sakuri: true, boxT: 18 }), SPECS).modules;
    const item = { uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 900, h: 2310, d: 650, specs: Object.assign({}, SPECS, { handle: '찬넬 (목찬넬)', topSizes: [{ w: '900', d: '650' }] }), modules };
    const rows = new MaterialExtractor().extract({ items: [item] }).materials;
    const side = rows.find((r) => r.part === '서랍측판');
    expect(side.thickness).toBe(18);                 // 서랍 자재 18T
    expect(side.w).toBe(500);                        // 볼레일 D550 → 레일 500, 측판 = 레일
    expect(side.note).toMatch(/댐핑 볼레일 500 · 사쿠리/);
    const fb = rows.find((r) => r.part === '서랍전후판');
    expect(fb.h).toBe(side.h - 18);                  // 사쿠리 −18
    const rail = new HardwareExtractor().extract({ items: [item] }).hardware.find((h) => h.category === '레일');
    expect(rail.item).toBe('댐핑 볼레일');
    expect(rail.qty).toBe(2);
  });
});

describe('자동계산이 고정 모듈을 존중한다', () => {
  test('고정 + 셀 정보 있으면 건너뛴다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('let preserved = 0'), STRUCT.indexOf('if (preserved > 0)'));
    expect(fn).toMatch(/m\.isFixed && hasCells/);
    expect(fn).toMatch(/preserved\+\+; return;/);
  });

  test('아직 계산된 적 없는 모듈은 고정이어도 최초 1회는 계산한다', () => {
    // 비워두면 브리지가 통짜 1개로 잡아 BOM 이 실제와 달라진다
    const fn = STRUCT.slice(STRUCT.indexOf('let preserved = 0'), STRUCT.indexOf('if (preserved > 0)'));
    expect(fn).toMatch(/hasCells = Array\.isArray\(s\.areaWidths\) && s\.areaWidths\.length > 0/);
  });

  test('몇 개를 보존했는지 사용자에게 알린다', () => {
    expect(STRUCT).toMatch(/고정 모듈 \$\{preserved\}개는 그대로/);
  });
});
