/**
 * 모듈 옵션 팔레트 — 모듈을 고르면 캔버스 위에 뜨는 팔레트.
 *
 * 팔레트는 **아이콘만** 보여주고, 아이콘을 누르면 그 옵션의 팝업이 열린다.
 *
 * 가장 중요한 것은 "옵션이 보이는가" 가 아니라 **"바꾸면 실제로 반영되는가"** 다.
 * 이 저장소는 같은 함정을 세 번 밟았다:
 *   · areaDirections='both' 를 우측 패널이 "좌" 로 보여줬다 (#471)
 *   · legH/moldingH 는 편집은 되는데 정면도·3D·선반 계산이 상수를 직접 읽었다 (#472)
 *   · topT/pedestalH 를 안 빼서 3D 몸통이 12·60mm 길었다 (#473)
 * 그래서 표시 검사와 **반영 검사**를 나눠서 둔다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const engine = require('../js/planner/planner-engine');

function boot() {
  return bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
}

/** 구조 단계는 모듈 0개로 시작한다 — 영역에 하나 넣고 고른다. */
function pickLower(p, section = 'lower') {
  let m = p.g('modules').find((x) => x.section === section);
  if (!m) {
    const area = p.g('areas').find((a) => a.section === section);
    m = p.g('addModuleToArea')(area.id);
  }
  p.g('setActiveModule')(m.id);
  return { m, s: p.g('getStructure')(m.id) };
}

const palette = (p) => p.document.querySelector('.mod-palette');
const popup = (p) => p.document.querySelector('.mp-popup');
const icon = (p, key) => palette(p).querySelector(`.mp-ic[data-option="${key}"]`);

/** 아이콘을 눌러 그 옵션의 팝업을 연다 */
function openOpt(p, key) {
  const btn = icon(p, key);
  if (!btn) throw new Error(`아이콘이 없다: ${key}`);
  btn.onclick();
  return popup(p);
}
/** 팝업 안의 입력을 집는다 — 팔레트가 아니라 팝업에 들어 있다 */
function field(p, key, selector) {
  return openOpt(p, key).querySelector(selector);
}
/** 값을 넣고 change 를 흘린다 */
function setField(p, key, selector, value) {
  const inp = field(p, key, selector);
  inp.value = String(value);
  inp.onchange();
}

describe('팔레트가 뜨고 닫힌다', () => {
  test('모듈을 고르면 팔레트가 나타난다', () => {
    const p = boot();
    pickLower(p);
    expect(palette(p)).not.toBeNull();
  });

  test('닫기 버튼으로 팔레트와 팝업이 같이 사라진다', () => {
    const p = boot();
    pickLower(p);
    openOpt(p, 'size');
    expect(popup(p)).not.toBeNull();
    palette(p).querySelector('.mp-close').onclick();
    expect(palette(p)).toBeNull();
    expect(popup(p)).toBeNull();
  });

  test('닫은 뒤 같은 모듈을 다시 클릭하면 팔레트가 다시 뜬다', () => {
    // 3D 클릭 경로가 `moduleId !== activeId` 로 통째로 걸러져 있었다.
    // 모듈을 만들면 곧바로 활성 상태라, 팔레트를 닫고 그 모듈을 눌러도
    // 다시 열 방법이 없었다 (팔레트를 여는 유일한 길이 그 분기였다).
    const p = boot();
    const { m } = pickLower(p);
    palette(p).querySelector('.mp-close').onclick();
    expect(palette(p)).toBeNull();

    // 3D 에서 이 모듈의 mesh 를 눌렀을 때와 같은 입력
    p.g('handleEntityClick')({ userData: { entityKind: 'carcass', moduleId: m.id } });
    expect(palette(p)).not.toBeNull();
  });

  test('정면도에서 모듈을 다시 클릭해도 팔레트가 뜬다', () => {
    const p = boot();
    const { m } = pickLower(p);
    palette(p).querySelector('.mp-close').onclick();
    p.g('setActiveModule')(m.id);
    expect(palette(p)).not.toBeNull();
  });

  test('3D 클릭은 영역보다 안에 든 것을 먼저 고른다', () => {
    // 영역 상자가 모듈을 감싸고 있어 raycast 는 언제나 영역을 먼저 맞힌다.
    // hits[0] 을 그대로 쓰면 모듈을 눌러도 영역이 선택되고, setActiveArea 가
    // 팔레트를 닫는다 — 보고된 "팔레트를 다시 못 연다" 의 원인이었다.
    const p = boot();
    const pick = p.g('pickEntityHit');
    const area = { object: { userData: { entityKind: 'area', areaId: 'a1' } } };
    const carcass = { object: { userData: { entityKind: 'carcass', moduleId: 'lower-0' } } };

    // 영역이 앞에 맞아도 모듈을 고른다
    expect(pick([area, carcass]).userData.entityKind).toBe('carcass');
    // 영역만 맞으면 영역을 고른다 (빈 자리 클릭)
    expect(pick([area]).userData.entityKind).toBe('area');
    expect(pick([])).toBeNull();
    expect(pick(null)).toBeNull();
  });

  test('다른 모듈을 고르면 팔레트가 하나만 남는다', () => {
    const p = boot();
    const area = p.g('areas').find((a) => a.section === 'lower');
    const a1 = p.g('addModuleToArea')(area.id);
    const a2 = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(a1.id);
    p.g('setActiveModule')(a2.id);
    expect(p.document.querySelectorAll('.mod-palette')).toHaveLength(1);
  });
});

describe('아이콘이 먼저 보인다', () => {
  const WANT = [
    ['size', '크기'], ['legH', '다리발'], ['topT', '상판'],
    ['layout', '구성'], ['doors', '도어'], ['shelves', '선반'],
    ['handle', '손잡이'], ['fixed', '고정'],
  ];

  test.each(WANT)('%s (%s) 아이콘이 있다', (key) => {
    const p = boot();
    pickLower(p);
    expect(icon(p, key)).not.toBeNull();
  });

  test('팔레트에는 입력칸이 없다 — 상세는 팝업이 맡는다', () => {
    const p = boot();
    pickLower(p);
    expect(palette(p).querySelectorAll('input, select')).toHaveLength(0);
  });

  test('아이콘마다 그림이 들어 있다', () => {
    const p = boot();
    pickLower(p);
    palette(p).querySelectorAll('.mp-ic').forEach((b) => {
      expect(b.querySelector('svg')).not.toBeNull();
    });
  });

  test('상부장에는 다리발·상판 아이콘이 없다', () => {
    const p = boot();
    const up = p.g('areas').find((a) => a.section === 'upper');
    if (!up) return;
    const m = p.g('addModuleToArea')(up.id);
    p.g('setActiveModule')(m.id);
    expect(icon(p, 'legH')).toBeNull();
    expect(icon(p, 'topT')).toBeNull();
    expect(icon(p, 'moldingH')).not.toBeNull();   // 상부장은 상몰딩이 있다
  });
});

describe('팝업이 열린다', () => {
  test('아이콘을 누르면 그 옵션의 팝업이 뜬다', () => {
    const p = boot();
    pickLower(p);
    const pop = openOpt(p, 'shelves');
    expect(pop).not.toBeNull();
    expect(pop.dataset.option).toBe('shelves');
    expect(pop.querySelector('.mp-shelfc')).not.toBeNull();
  });

  test('다른 아이콘을 누르면 팝업이 하나만 남는다', () => {
    const p = boot();
    pickLower(p);
    openOpt(p, 'size');
    openOpt(p, 'handle');
    expect(p.document.querySelectorAll('.mp-popup')).toHaveLength(1);
    expect(popup(p).dataset.option).toBe('handle');
  });

  test('크기 팝업은 W·H·D 세 칸이다', () => {
    const p = boot();
    pickLower(p);
    const keys = [...openOpt(p, 'size').querySelectorAll('.mp-dim')].map((i) => i.dataset.k);
    expect(keys).toEqual(['W', 'H', 'D']);
  });

  test('서랍 단수는 상하 구성이 하부서랍일 때만 나온다', () => {
    const p = boot();
    const { s } = pickLower(p);
    expect(openOpt(p, 'layout').querySelector('.mp-drawerc')).toBeNull();
    s.horizontalLayout = 'doorTopDrawerBottom';
    p.g('renderModulePalette')();
    expect(openOpt(p, 'layout').querySelector('.mp-drawerc')).not.toBeNull();
  });
});

describe('바꾸면 실제로 반영된다', () => {
  test('다리발을 바꾸면 s.legH 에 남는다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    setField(p, 'legH', '.mp-legh', 120);
    expect(s.legH).toBe(120);
    expect(p.g('legHOf')(m, s)).toBe(120);
  });

  test('다리발이 몸통을 삼키면 이전 값으로 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.legH;
    setField(p, 'legH', '.mp-legh', m.H + 100);
    expect(s.legH).toBe(before);
    expect(p.g('bodyHeightOf')(m, s)).toBeGreaterThanOrEqual(50);
  });

  test('다리발이 선반 계산까지 흘러간다 (배선 확인)', () => {
    // 예전엔 legH 를 바꿔도 선반이 그대로였다.
    const m = { id: 'x', section: 'lower', x: 0, W: 900, H: 870 };
    const base = {};
    engine.autoCalcModule(m, base, null);
    const tall = { legH: 0 };
    engine.autoCalcModule(m, tall, null);
    expect(engine.effectiveLegH(base)).toBe(engine.MASTER_RULES.SINK_LEG);
    expect(engine.effectiveLegH(tall)).toBe(0);
    expect(tall.shelves).not.toEqual(base.shelves);
  });

  test('도어 갯수를 바꾸면 cell 배열 길이가 함께 맞는다', () => {
    const p = boot();
    const { s } = pickLower(p);
    setField(p, 'doors', '.mp-vcount', 4);
    expect(s.verticalCount).toBe(4);
    expect(s.areaTypes).toHaveLength(4);
    expect(s.areaDirections).toHaveLength(4);
    // 폭·양문은 자동계산 파생값이라 비운다 — 길이가 어긋난 채 남으면
    // 정면도가 조용히 균등분할 fallback 으로 돌아간다.
    expect(s.areaWidths).toEqual([]);
    expect(s.areaIs2D).toEqual([]);
  });

  test('선반 갯수를 주면 몸통 높이에 균등 분배된다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    setField(p, 'shelves', '.mp-shelfc', 3);
    expect(s.shelves).toHaveLength(3);
    const gaps = s.shelves.map((v, i, a) => (i ? v - a[i - 1] : v));
    gaps.forEach((g) => expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(1));
    s.shelves.forEach((sh) => expect(sh).toBeLessThan(m.H));
  });

  test('손잡이·구성·고정이 그대로 저장된다', () => {
    const p = boot();
    const { m, s } = pickLower(p);

    let pop = openOpt(p, 'handle');
    const ht = pop.querySelector('.mp-htype'); ht.value = 'c-channel'; ht.onchange();
    pop = openOpt(p, 'handle');
    const hp = pop.querySelector('.mp-hpos'); hp.value = 'middle'; hp.onchange();
    expect(s.handleType).toBe('c-channel');
    expect(s.handlePosition).toBe('middle');

    const fx = openOpt(p, 'fixed').querySelector('.mp-fixed');
    fx.checked = true; fx.onchange();
    expect(m.isFixed).toBe(true);

    const hl = openOpt(p, 'layout').querySelector('.mp-hlayout');
    hl.value = 'doorTopDrawerBottom'; hl.onchange();
    expect(s.horizontalLayout).toBe('doorTopDrawerBottom');
  });
});

describe('높이 부위 — 상판·좌대·상몰딩', () => {
  test('문서화된 높이 모델과 맞는다 — 하부장 870 = 다리발 150 + 몸통 708 + 상판 12', () => {
    // data-constants.js 의 전체높이 모델이 정본이다. 구조에 값을 지정하지 않은
    // 모듈이 이 경우다. (새로 추가한 모듈은 상판이 옵션이라 topT 0 으로 시작한다)
    const p = boot();
    const m = { section: 'lower', H: 870 };
    expect(p.g('legHOf')(m, {})).toBe(150);
    expect(p.g('topTOf')(m, {})).toBe(12);
    expect(p.g('bodyHeightOf')(m, {})).toBe(708);
    expect(p.g('baseOffsetOf')(m, {})).toBe(150);
  });

  test('새 모듈은 상판이 옵션이라 850 = 다리발 150 + 몸통 700 이 성립한다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    expect([m.W, m.H, m.D]).toEqual([600, 850, 550]);
    expect(p.g('legHOf')(m, s)).toBe(150);
    expect(p.g('topTOf')(m, s)).toBe(0);
    expect(p.g('bodyHeightOf')(m, s)).toBe(700);
  });

  test('상판을 켜면 몸통이 그만큼 줄어든다 (배선 확인)', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = p.g('bodyHeightOf')(m, s);
    setField(p, 'topT', '.mp-topt', 30);
    expect(s.topT).toBe(30);
    expect(p.g('bodyHeightOf')(m, s)).toBe(before - 30);
  });

  test('부위가 몸통을 삼키면 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.topT;
    setField(p, 'topT', '.mp-topt', m.H);
    expect(s.topT).toBe(before);
    expect(p.g('bodyHeightOf')(m, s)).toBeGreaterThanOrEqual(50);
  });

  test('바닥 offset 은 섹션마다 다른 부위를 본다', () => {
    const p = boot();
    const legHOf = p.g('legHOf'), baseOffsetOf = p.g('baseOffsetOf');
    const lower = { section: 'lower', H: 870 };
    const upper = { section: 'upper', H: 780 };
    const fridge = { section: 'fridge', H: 2310 };
    expect(baseOffsetOf(lower, {})).toBe(legHOf(lower, {}));
    expect(baseOffsetOf(upper, {})).toBe(0);
    expect(baseOffsetOf(fridge, {})).toBe(60);
  });

  test('키큰장·냉장고장 몸통은 좌대와 상몰딩을 모두 뺀다', () => {
    const p = boot();
    const bodyHeightOf = p.g('bodyHeightOf');
    const fridge = { section: 'fridge', H: 2310 };
    expect(bodyHeightOf(fridge, {})).toBe(2310 - 60 - p.g('moldingHOf')(fridge, {}));
  });
});

describe('렌더러가 몸통 계산을 직접 하지 않는다 (정적 가드)', () => {
  // 3D 경로는 three.js 가 필요해 jsdom 에서 돌릴 수 없다. 그래서 "무엇을 그렸나" 대신
  // "무엇을 근거로 삼았나" 를 소스에서 확인한다.
  const fs = require('fs');
  const path = require('path');
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('carcassH 는 전부 bodyHeightOf 로 구한다', () => {
    const assigns = src.match(/const carcassH\s*=\s*[^;]+;/g) || [];
    expect(assigns.length).toBeGreaterThan(0);
    expect(assigns.filter((a) => !a.includes('bodyHeightOf'))).toEqual([]);
  });

  test('몸통 바닥 offset 은 baseOffsetOf 로 구한다', () => {
    const assigns = src.match(/const legH\s*=\s*[^;]+;/g) || [];
    expect(assigns.filter((a) => !a.includes('baseOffsetOf'))).toEqual([]);
  });
});

describe('양문 cell 은 팔레트에서도 방향을 묻지 않는다', () => {
  test('is2D cell 에는 방향 select 대신 양문 라벨이 뜬다', () => {
    const p = boot();
    const { s } = pickLower(p);
    s.verticalCount = 2;
    s.areaTypes = ['door', 'door'];
    s.areaDirections = ['both', 'right'];
    s.areaIs2D = [true, false];
    p.g('renderModulePalette')();

    const cells = [...openOpt(p, 'doors').querySelectorAll('.mp-cell')];
    expect(cells[0].querySelector('.mp-dir')).toBeNull();
    expect(cells[0].textContent).toContain('양문');
    expect(cells[1].querySelector('.mp-dir').value).toBe('right');
  });
});
