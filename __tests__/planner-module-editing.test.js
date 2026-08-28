/**
 * 모듈 편집 — 우측 패널.
 *
 * W12-32 전에는 모듈을 고르면 캔버스 위에 옵션 팔레트가 떴고, 우측 패널과
 * **두 곳**에서 같은 값을 고쳤다. 편집 지점은 이제 우측 패널 하나다.
 *
 * 가장 중요한 것은 "옵션이 보이는가" 가 아니라 **"바꾸면 실제로 반영되는가"** 다.
 * 이 저장소는 같은 함정을 세 번 밟았다:
 *   · areaDirections='both' 를 우측 패널이 "좌" 로 보여줬다 (#471)
 *   · legH/moldingH 는 편집은 되는데 정면도·3D·선반 계산이 상수를 직접 읽었다 (#472)
 *   · topT/pedestalH 를 안 빼서 3D 몸통이 12·60mm 길었다 (#473)
 * 그래서 표시 검사와 **반영 검사**를 나눠서 둔다.
 *
 * 도어 열림 방향은 정면도 칸 클릭이 맡는다 — `planner-front-cell-click.test.js`.
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

const panel = (p) => p.document.getElementById('rightPanel');
const field = (p, selector) => panel(p).querySelector(selector);

/** 값을 넣고 change 를 흘린다 */
function setField(p, selector, value) {
  const inp = field(p, selector);
  if (!inp) throw new Error(`입력이 없다: ${selector}`);
  if (inp.type === 'checkbox') inp.checked = value; else inp.value = String(value);
  inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}

/** 지금 보이는 섹션 키 */
const shownSecs = (p) =>
  [...panel(p).querySelectorAll('.section[data-sec]')]
    .filter((n) => n.style.display !== 'none')
    .map((n) => n.getAttribute('data-sec'));

describe('모듈을 고르면 우측 패널이 그 모듈이 된다', () => {
  test('떠 있는 팔레트는 없다', () => {
    const p = boot();
    pickLower(p);
    expect(p.document.querySelector('.mod-palette')).toBeNull();
    expect(p.document.querySelector('.mp-popup')).toBeNull();
  });

  test('모듈 모드의 섹션이 뜬다', () => {
    const p = boot();
    pickLower(p);
    expect(shownSecs(p)).toEqual(['size', 'height', 'split', 'areas', 'shelves', 'handle']);
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('구조 편집');
  });

  test('3D 에서 눌러도 같은 자리가 채워진다', () => {
    const p = boot();
    const area = p.g('areas').find((a) => a.section === 'lower');
    const a1 = p.g('addModuleToArea')(area.id);
    const a2 = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(a1.id);
    p.g('handleEntityClick')({ userData: { entityKind: 'carcass', moduleId: a2.id } });
    expect(Math.round(+field(p, '#sizeBody input[data-dim="W"]').value)).toBe(Math.round(a2.W));
  });

  test('3D 클릭은 영역보다 안에 든 것을 먼저 고른다', () => {
    // 영역 상자가 모듈을 감싸고 있어 raycast 는 언제나 영역을 먼저 맞힌다.
    // hits[0] 을 그대로 쓰면 모듈을 눌러도 영역이 선택된다.
    const p = boot();
    const pick = p.g('pickEntityHit');
    const area = { object: { userData: { entityKind: 'area', areaId: 'a1' } } };
    const carcass = { object: { userData: { entityKind: 'carcass', moduleId: 'lower-0' } } };

    expect(pick([area, carcass]).userData.entityKind).toBe('carcass');
    expect(pick([area]).userData.entityKind).toBe('area');
    expect(pick([])).toBeNull();
    expect(pick(null)).toBeNull();
  });
});

describe('섹션 내용은 그 모듈의 높이 모델을 따른다', () => {
  test('하부장에는 다리발·상판 칸이 있다', () => {
    const p = boot();
    pickLower(p);
    const keys = [...panel(p).querySelectorAll('#heightBody input[data-hpart]')]
      .map((n) => n.getAttribute('data-hpart'));
    expect(keys).toContain('legH');
    expect(keys).toContain('topT');
  });

  test('상부장에는 다리발·상판이 없고 상몰딩이 있다', () => {
    const p = boot();
    const up = p.g('areas').find((a) => a.section === 'upper');
    if (!up) return;
    const m = p.g('addModuleToArea')(up.id);
    p.g('setActiveModule')(m.id);
    const keys = [...panel(p).querySelectorAll('#heightBody input[data-hpart]')]
      .map((n) => n.getAttribute('data-hpart'));
    expect(keys).not.toContain('legH');
    expect(keys).not.toContain('topT');
    expect(keys).toContain('moldingH');
  });

  test('크기는 W·H·D 세 칸이다', () => {
    const p = boot();
    pickLower(p);
    const keys = [...panel(p).querySelectorAll('#sizeBody input[data-dim]')]
      .map((n) => n.getAttribute('data-dim'));
    expect(keys).toEqual(['W', 'H', 'D']);
  });

  test('서랍 단수는 상하 구성이 하부서랍일 때만 나온다', () => {
    const p = boot();
    const { s } = pickLower(p);
    expect(field(p, '#inpDrawerCount')).toBeNull();
    s.horizontalLayout = 'doorTopDrawerBottom';
    p.g('renderRightPanel')();
    expect(field(p, '#inpDrawerCount')).not.toBeNull();
  });
});

describe('바꾸면 실제로 반영된다', () => {
  test('다리발을 바꾸면 s.legH 에 남는다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    setField(p, '#heightBody input[data-hpart="legH"]', 120);
    expect(s.legH).toBe(120);
    expect(p.g('legHOf')(m, s)).toBe(120);
  });

  test('다리발이 몸통을 삼키면 이전 값으로 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.legH;
    setField(p, '#heightBody input[data-hpart="legH"]', m.H + 100);
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

  test('좌우 분할을 바꾸면 cell 배열 길이가 함께 맞는다', () => {
    const p = boot();
    const { s } = pickLower(p);
    setField(p, '#inpVCount', 4);
    expect(s.verticalCount).toBe(4);
    expect(s.areaTypes).toHaveLength(4);
    expect(s.areaDirections).toHaveLength(4);
    // 폭·양문은 자동계산 파생값이라 비운다 — 길이가 어긋난 채 남으면
    // 정면도가 조용히 균등분할 fallback 으로 돌아간다.
    expect(s.areaWidths).toEqual([]);
    expect(s.areaIs2D).toEqual([]);
  });

  test('분할은 1~6 을 벗어나지 않는다', () => {
    const p = boot();
    const { s } = pickLower(p);
    setField(p, '#inpVCount', 99);
    expect(s.verticalCount).toBe(6);
    setField(p, '#inpVCount', 0);
    expect(s.verticalCount).toBe(1);
  });

  test('균등 재배치는 몸통 높이에 고르게 나눈다', () => {
    // W12-32: 팔레트의 '선반 갯수' 입력이 하던 일. 개별 위치를 통째로 날리므로
    // 숫자 입력이 아니라 버튼이다 — 파괴적 동작임이 보여야 한다.
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.shelves.length;      // 새 모듈은 calcDefaultShelves 가 이미 채웠다
    field(p, '#addShelf').onclick();
    field(p, '#addShelf').onclick();
    expect(s.shelves).toHaveLength(before + 2);
    field(p, '#evenShelf').onclick();
    const after = p.g('getStructure')(m.id).shelves;
    expect(after).toHaveLength(before + 2);
    const gaps = after.map((v, i, a) => (i ? v - a[i - 1] : v));
    gaps.forEach((g) => expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(1));
    after.forEach((sh) => expect(sh).toBeLessThan(m.H));
  });

  test('선반이 없으면 균등 재배치 버튼도 없다', () => {
    const p = boot();
    const { s } = pickLower(p);
    s.shelves = [];
    p.g('renderRightPanel')();
    expect(field(p, '#evenShelf')).toBeNull();
  });

  test('손잡이·구성·고정이 그대로 저장된다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    setField(p, '#selHType', 'c-channel');
    setField(p, '#selHPos', 'middle');
    expect(s.handleType).toBe('c-channel');
    expect(s.handlePosition).toBe('middle');

    setField(p, '#chkFixed', true);
    expect(m.isFixed).toBe(true);

    setField(p, '#selHLayout', 'doorTopDrawerBottom');
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
    setField(p, '#heightBody input[data-hpart="topT"]', 30);
    expect(s.topT).toBe(30);
    expect(p.g('bodyHeightOf')(m, s)).toBe(before - 30);
  });

  test('부위가 몸통을 삼키면 되돌린다', () => {
    const p = boot();
    const { m, s } = pickLower(p);
    const before = s.topT;
    setField(p, '#heightBody input[data-hpart="topT"]', m.H);
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

describe('양문 cell 은 방향을 묻지 않는다', () => {
  test('is2D cell 에는 방향 select 대신 양문 라벨이 뜬다', () => {
    // #471 규칙 — 양문은 좌우가 이미 정해져 있다. 동작하지 않는 컨트롤 대신
    // 상태를 그대로 적는다.
    const p = boot();
    const { s } = pickLower(p);
    s.verticalCount = 2;
    s.areaTypes = ['door', 'door'];
    s.areaDirections = ['both', 'right'];
    s.areaIs2D = [true, false];
    p.g('renderRightPanel')();

    const rows = [...panel(p).querySelectorAll('#areasBody .area-row')];
    expect(rows[0].querySelector('.a-dir')).toBeNull();
    expect(rows[0].textContent).toContain('양문');
    expect(rows[1].querySelector('.a-dir').value).toBe('right');
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

describe('도어 경계가 보인다 (정적 가드)', () => {
  // 도어는 몸통과 같은 색이고 갭은 4mm 다. 경계를 나누는 건 WebGL 라인뿐인데
  // linewidth 는 대부분 1px 로 고정이라 줌을 줄이면 도어들이 뭉쳐 보였다.
  // 도어 뒤에 어두운 판(reveal)을 깔아 갭이 그림자로 읽히게 한다.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('도어를 그리는 모든 경로가 reveal 을 깐다', () => {
    // W12-27: 양문 셀이 **도어 한 장씩** 부르게 되어 2 → 3 회가 됐다.
    //   (양문 좌·우 2 + 그 밖의 경로 1)
    const fn = src.slice(src.indexOf('function addFrontPanel'), src.indexOf('function positionBox'));
    expect(fn.match(/addDoorReveal\(/g)).toHaveLength(3);
  });

  test('reveal 은 갭만큼 더 크고 도어보다 뒤에 있다', () => {
    const fn = src.slice(src.indexOf('function addDoorReveal'));
    const body = fn.slice(0, 600);
    expect(body).toMatch(/w \+ G, h \+ G/);        // 사방으로 갭만큼 넓다
    expect(body).toMatch(/frontZ - 1/);            // 도어 뒤
    // W12-17: 0.55 를 직접 박던 것을 DOOR_REVEAL_DARKEN 상수로 옮기고 0.9 로 낮췄다.
    // 뒷판과 테두리가 같은 값을 써야 한 덩어리로 읽힌다.
    expect(body).toMatch(/darken3\(cfg\.fill, DOOR_REVEAL_DARKEN\)/);
  });

  test('도어 외곽선이 흐리지 않다', () => {
    // 0.7 이던 것을 0.9 로 올렸다. 낮은 값이 남아 있으면 그 도어만 흐리다.
    // addFrontPanel 안만 본다 — 상판(addTopPanel)도 변수명이 panel 이라
    // 파일 전체를 훑으면 도어가 아닌 것까지 걸린다.
    const fn = src.slice(src.indexOf('function addFrontPanel'));
    const body = fn.slice(0, fn.indexOf('\n  function '));
    const doorEdges = body.match(/addEdgeOutline\((?:panel|dLeft|dRight), parent, 0x000000, ([0-9.]+)\)/g) || [];
    expect(doorEdges.length).toBeGreaterThanOrEqual(3);
    doorEdges.forEach((e) => {
      expect(parseFloat(e.match(/([0-9.]+)\)$/)[1])).toBeGreaterThanOrEqual(0.9);
    });
  });
});
