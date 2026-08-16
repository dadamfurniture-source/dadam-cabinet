/**
 * 모듈 옵션 팔레트 — 모듈을 고르면 캔버스 위에 뜨는 팔레트.
 *
 * 가장 중요한 것은 "옵션이 보이는가" 가 아니라 **"바꾸면 실제로 반영되는가"** 다.
 * 이 저장소는 같은 함정을 두 번 밟았다:
 *   · areaDirections='both' 를 우측 패널이 "좌" 로 보여줬다 (#471)
 *   · legH/moldingH 는 편집은 되는데 정면도·3D·선반 계산이 상수를 직접 읽어
 *     값이 아무 데도 닿지 않았다 (이 PR 에서 배선)
 * 그래서 표시 검사와 **반영 검사**를 나눠서 둔다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const engine = require('../js/planner/planner-engine');

function boot() {
  return bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
}

/** 하부장 모듈 하나를 고른 상태로 만든다.
 *  구조 단계는 이제 모듈 0개로 시작하므로, 영역에 하나 넣고 고른다. */
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

describe('팔레트가 뜨고 닫힌다', () => {
  test('모듈을 고르면 팔레트가 나타난다', () => {
    const p = boot();
    pickLower(p);
    expect(palette(p)).not.toBeNull();
  });

  test('닫기 버튼으로 사라진다', () => {
    const p = boot();
    pickLower(p);
    palette(p).querySelector('.mp-close').onclick();
    expect(palette(p)).toBeNull();
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

describe('요청한 옵션이 전부 있다', () => {
  const WANT = [
    ['.mp-dim', '모듈 크기 W/H/D'],
    ['.mp-legh', '다리발 높이'],
    ['.mp-vcount', '도어 갯수'],
    ['.mp-type', '영역 타입'],
    ['.mp-shelfc', '선반 갯수'],
    ['.mp-htype', '손잡이 타입'],
    ['.mp-hpos', '손잡이 위치'],
    ['.mp-hlayout', '상하 구성'],
    ['.mp-fixed', '모듈 고정'],
  ];

  test.each(WANT)('%s (%s) 가 있다', (selector) => {
    const p = boot();
    pickLower(p);
    expect(palette(p).querySelector(selector)).not.toBeNull();
  });

  test('크기는 W·H·D 세 칸이다', () => {
    const p = boot();
    pickLower(p);
    const keys = [...palette(p).querySelectorAll('.mp-dim')].map((i) => i.dataset.k);
    expect(keys).toEqual(['W', 'H', 'D']);
  });

  test('상부장에는 다리발 칸이 없다', () => {
    const p = boot();
    const up = p.g('modules').find((x) => x.section === 'upper');
    if (!up) return;                       // 샘플에 상부장이 없으면 건너뛴다
    p.g('setActiveModule')(up.id);
    expect(palette(p).querySelector('.mp-legh')).toBeNull();
  });

  test('서랍 단수는 상하 구성이 하부서랍일 때만 나온다', () => {
    const p = boot();
    const { s } = pickLower(p);
    s.horizontalLayout = 'doorOnly';
    p.g('renderModulePalette')();
    expect(palette(p).querySelector('.mp-drawerc')).toBeNull();

    s.horizontalLayout = 'doorTopDrawerBottom';
    p.g('renderModulePalette')();
    expect(palette(p).querySelector('.mp-drawerc')).not.toBeNull();
  });
});

describe('바꾸면 실제로 반영된다', () => {
  test('다리발을 바꾸면 s.legH 에 남는다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const inp = palette(p).querySelector('.mp-legh');
    inp.value = '120';
    inp.onchange();
    expect(s.legH).toBe(120);
    expect(p.g('legHOf')(m, s)).toBe(120);
  });

  test('다리발이 몸통을 삼키면 이전 값으로 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.legH;                // 새 모듈은 150 을 명시적으로 갖고 시작한다
    const inp = palette(p).querySelector('.mp-legh');
    inp.value = String(m.H + 100);
    inp.onchange();
    expect(s.legH).toBe(before);
    expect(p.g('bodyHeightOf')(m, s)).toBeGreaterThanOrEqual(50);
  });

  test('다리발이 선반 계산까지 흘러간다 (배선 확인)', () => {
    // 이 검사가 이 PR 의 핵심이다. 예전엔 legH 를 바꿔도 선반이 그대로였다.
    const m = { id: 'x', section: 'lower', x: 0, W: 900, H: 870 };
    const base = {};
    engine.autoCalcModule(m, base, null);

    const tall = { legH: 0 };             // 다리발을 없애면 몸통이 커진다
    engine.autoCalcModule(m, tall, null);

    expect(engine.effectiveLegH(base)).toBe(engine.MASTER_RULES.SINK_LEG);
    expect(engine.effectiveLegH(tall)).toBe(0);
    expect(tall.shelves).not.toEqual(base.shelves);   // 값이 닿았다는 증거
  });

  test('도어 갯수를 바꾸면 cell 배열 길이가 함께 맞는다', () => {
    const p = boot();
    const { s } = pickLower(p);
    const inp = palette(p).querySelector('.mp-vcount');
    inp.value = '4';
    inp.onchange({ target: inp });
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
    const inp = palette(p).querySelector('.mp-shelfc');
    inp.value = '3';
    inp.onchange({ target: inp });
    expect(s.shelves).toHaveLength(3);
    // 간격이 일정한지 — calcDefaultShelves 와 같은 step = H/(n+1) 규칙
    const gaps = s.shelves.map((v, i, a) => (i ? v - a[i - 1] : v));
    gaps.forEach((g) => expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(1));
    s.shelves.forEach((sh) => expect(sh).toBeLessThan(m.H));
  });

  test('손잡이·상하구성·고정이 그대로 저장된다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const el = palette(p);

    el.querySelector('.mp-htype').onchange({ target: { value: 'c-channel' } });
    el.querySelector('.mp-hpos').onchange({ target: { value: 'middle' } });
    expect(s.handleType).toBe('c-channel');
    expect(s.handlePosition).toBe('middle');

    el.querySelector('.mp-fixed').onchange({ target: { checked: true } });
    expect(m.isFixed).toBe(true);

    p.g('renderModulePalette')();
    palette(p).querySelector('.mp-hlayout').onchange({ target: { value: 'doorTopDrawerBottom' } });
    expect(s.horizontalLayout).toBe('doorTopDrawerBottom');
  });
});

describe('높이 부위 — 상판·좌대·상몰딩', () => {
  test('하부장에는 다리발과 상판 칸이 같이 있다', () => {
    const p = boot();
    pickLower(p);
    expect(palette(p).querySelector('.mp-legh')).not.toBeNull();
    expect(palette(p).querySelector('.mp-topt')).not.toBeNull();
    expect(palette(p).querySelector('.mp-pedestal')).toBeNull();   // 하부장엔 좌대가 없다
  });

  test('문서화된 높이 모델과 맞는다 — 하부장 870 = 다리발 150 + 몸통 708 + 상판 12', () => {
    // data-constants.js 의 전체높이 모델이 정본이다. 렌더러가 이 합과 어긋나면
    // 3D 몸통이 상판 두께만큼 길어진다 (예전 상태).
    //
    // 구조에 값을 지정하지 않은 모듈로 확인한다 — 이때가 마스터 기본값이 적용되는 경우다.
    // (새로 추가한 모듈은 상판을 옵션으로 두어 topT 0 으로 시작하므로 이 경우가 아니다)
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
    expect(p.g('topTOf')(m, s)).toBe(0);      // 상판은 켜야 생긴다
    expect(p.g('bodyHeightOf')(m, s)).toBe(700);
  });

  test('상판을 켜면 몸통이 그만큼 줄어든다 (배선 확인)', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = p.g('bodyHeightOf')(m, s);   // 700
    const inp = palette(p).querySelector('.mp-topt');
    inp.value = '30';
    inp.onchange();
    expect(s.topT).toBe(30);
    expect(p.g('bodyHeightOf')(m, s)).toBe(before - 30);
  });

  test('부위가 몸통을 삼키면 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.topT;                 // 새 모듈은 0 을 명시적으로 갖고 시작한다
    const inp = palette(p).querySelector('.mp-topt');
    inp.value = String(m.H);
    inp.onchange();
    expect(s.topT).toBe(before);
    expect(p.g('bodyHeightOf')(m, s)).toBeGreaterThanOrEqual(50);
  });

  test('바닥 offset 은 섹션마다 다른 부위를 본다', () => {
    const p = boot();
    const legHOf = p.g('legHOf'), baseOffsetOf = p.g('baseOffsetOf');
    const lower = { section: 'lower', H: 870 };
    const upper = { section: 'upper', H: 780 };
    const fridge = { section: 'fridge', H: 2310 };
    expect(baseOffsetOf(lower, {})).toBe(legHOf(lower, {}));  // 다리발
    expect(baseOffsetOf(upper, {})).toBe(0);                  // 매달림 — 없음
    expect(baseOffsetOf(fridge, {})).toBe(60);                // 좌대
  });

  test('키큰장·냉장고장 몸통은 좌대와 상몰딩을 모두 뺀다', () => {
    const p = boot();
    const bodyHeightOf = p.g('bodyHeightOf');
    const fridge = { section: 'fridge', H: 2310 };
    // 예전엔 좌대를 빼먹어 60mm 길었다.
    expect(bodyHeightOf(fridge, {})).toBe(2310 - 60 - p.g('moldingHOf')(fridge, {}));
  });
});

describe('렌더러가 몸통 계산을 직접 하지 않는다 (정적 가드)', () => {
  // 3D 경로는 three.js 가 필요해 jsdom 에서 돌릴 수 없다. 그래서 "무엇을 그렸나" 대신
  // "무엇을 근거로 삼았나" 를 소스에서 확인한다.
  //
  // 예전엔 세 경로가 carcassH = H - legH - moldingH 로 직접 계산해
  // 하부장 상판 12mm·키큰장 좌대 60mm 를 빠뜨렸다. heightPartsOf 합이 정본이므로
  // 몸통은 bodyHeightOf 로만 구해야 한다.
  const fs = require('fs');
  const path = require('path');
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('carcassH 는 전부 bodyHeightOf 로 구한다', () => {
    const assigns = src.match(/const carcassH\s*=\s*[^;]+;/g) || [];
    expect(assigns.length).toBeGreaterThan(0);        // 대상이 사라지면 가드가 무의미해진다
    const bad = assigns.filter((a) => !a.includes('bodyHeightOf'));
    expect(bad).toEqual([]);
  });

  test('몸통 바닥 offset 은 baseOffsetOf 로 구한다', () => {
    // legHOf 는 다리발 mesh 자체의 높이라 addLegs 에서만 쓰인다.
    const assigns = src.match(/const legH\s*=\s*[^;]+;/g) || [];
    const bad = assigns.filter((a) => !a.includes('baseOffsetOf'));
    expect(bad).toEqual([]);
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

    const cells = [...palette(p).querySelectorAll('.mp-cell')];
    expect(cells[0].querySelector('.mp-dir')).toBeNull();
    expect(cells[0].textContent).toContain('양문');
    // 단문 cell 은 저장된 방향이 그대로 선택돼 있어야 한다
    expect(cells[1].querySelector('.mp-dir').value).toBe('right');
  });
});
