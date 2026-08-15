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

/** 하부장 모듈 하나를 고른 상태로 만든다 */
function pickLower(p) {
  const m = p.g('modules').find((x) => x.section === 'lower') || p.g('modules')[0];
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
    const mods = p.g('modules');
    p.g('setActiveModule')(mods[0].id);
    p.g('setActiveModule')(mods[1].id);
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

  test('다리발이 몸통을 삼키면 거부한다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const inp = palette(p).querySelector('.mp-legh');
    inp.value = String(m.H + 100);
    inp.onchange();
    expect(s.legH).toBeUndefined();       // 저장되지 않는다
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
