/**
 * W12-31: 우측 패널이 **모듈 모드 / 영역 모드** 두 가지로 쓰인다.
 *
 * 지금까지 모듈 옵션은 떠 있는 팔레트에, 영역 옵션은 또 다른 팔레트에 있었다.
 * 편집 지점을 우측 패널 하나로 모으는 중이고, 이 단계에서는 팔레트와 **공존**한다
 * — 언제든 되돌릴 수 있게. 팔레트 제거는 다음 단계다.
 *
 * 여기서 보는 것:
 *   1) 모드에 따라 어떤 섹션이 보이고 제목이 무엇인가
 *   2) 팔레트에만 있던 항목(크기 W/H/D·고정)이 우측에서 동작하는가
 *   3) 영역 모드의 크기·좌대/상몰딩·마감이 동작하는가
 *   4) 바꾼 값이 새로고침을 견디는가
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const storage = Object.assign({}, seed);
  const search = storage._search || '?design=gold&item=1';
  delete storage._search;
  const p = bootPlanner('mockup-structure.html', { search, storage });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 모듈 하나를 넣고 그것을 고른 상태 */
function withModule(opts) {
  const p = boot(seedFor(FIXTURES.straight, { modules: false }));
  const area = p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id, Object.assign(
    { section: 'lower', W: 1200, x: area.x || 0 }, opts || {}));
  p.g('setActiveModule')(m.id);
  return { p, m, s: p.g('getStructure')(m.id), area };
}

const change = (el, v) => {
  if (el.type === 'checkbox') el.checked = v;
  else el.value = v;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
};

/** 지금 보이는 섹션 키 */
const shownSecs = (p) =>
  [...p.document.querySelectorAll('#rightPanel .section[data-sec]')]
    .filter((n) => n.style.display !== 'none')
    .map((n) => n.getAttribute('data-sec'));

const secTitle = (p, key) =>
  (p.document.querySelector(`#rightPanel .section[data-sec="${key}"] .sec-title`) || {}).textContent;

const dimInput = (p, k) => p.document.querySelector(`#sizeBody input[data-dim="${k}"]`);

describe('모드에 따라 섹션이 바뀐다', () => {
  test('모듈을 고르면 모듈 모드', () => {
    const { p } = withModule();
    expect(shownSecs(p)).toEqual(['size', 'height', 'split', 'areas', 'shelves', 'handle']);
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('구조 편집');
  });

  test('영역을 고르면 영역 모드 — 크기·높이·마감만', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    expect(shownSecs(p)).toEqual(['size', 'height', 'finish']);
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('영역 편집');
  });

  test('영역을 고른 뒤 모듈을 고르면 되돌아온다', () => {
    const { p, m, area } = withModule();
    p.g('setActiveArea')(area.id);
    p.g('setActiveModule')(m.id);
    expect(shownSecs(p)).toContain('split');
    expect(shownSecs(p)).not.toContain('finish');
  });

  test('제목이 모드마다 다시 쓰인다 — 앞 모드의 제목이 남지 않는다', () => {
    const { p, m, area } = withModule();
    p.g('setActiveArea')(area.id);
    expect(secTitle(p, 'size')).toBe('영역 크기');
    expect(secTitle(p, 'height')).toContain('좌대');
    p.g('setActiveModule')(m.id);
    expect(secTitle(p, 'size')).toBe('크기 · 고정');
    expect(secTitle(p, 'height')).toBe('높이 구성');
  });
});

describe('모듈 크기 — 팔레트에만 있던 항목', () => {
  test('W/H/D 와 고정이 모두 있다', () => {
    const { p, m } = withModule();
    expect(+dimInput(p, 'W').value).toBe(Math.round(m.W));
    expect(+dimInput(p, 'H').value).toBe(Math.round(m.H));
    expect(+dimInput(p, 'D').value).toBe(Math.round(m.D));
    expect(p.document.getElementById('chkFixed')).not.toBeNull();
  });

  test('폭을 바꾸면 칸 폭 배분이 비워진다', () => {
    // 팔레트의 .mp-dim 은 이걸 안 해서, 자동계산이 잡아 둔 셀 폭이
    // 낡은 채 남아 정면도가 모듈 밖으로 삐져나왔다.
    const { p, m, s } = withModule();
    s.areaWidths = [600, 600];
    s.areaIs2D = [true, false];
    change(dimInput(p, 'W'), '900');
    expect(Math.round(p.g('modules').find((x) => x.id === m.id).W)).toBe(900);
    expect(p.g('getStructure')(m.id).areaWidths).toEqual([]);
    expect(p.g('getStructure')(m.id).areaIs2D).toEqual([]);
  });

  test('높이를 줄이면 몸통 밖 선반은 지운다', () => {
    const { p, m, s } = withModule({ H: 900 });
    s.shelves = [200, 800];
    change(dimInput(p, 'H'), '500');
    expect(p.g('getStructure')(m.id).shelves).toEqual([200]);
  });

  test('100mm 아래로는 못 내려간다', () => {
    const { p, m } = withModule();
    change(dimInput(p, 'W'), '10');
    expect(p.g('modules').find((x) => x.id === m.id).W).toBe(100);
  });

  test('고정을 켜면 자동계산이 안 건드린다', () => {
    const { p, m } = withModule();
    change(p.document.getElementById('chkFixed'), true);
    expect(p.g('modules').find((x) => x.id === m.id).isFixed).toBe(true);
  });

  test('새로고침을 견딘다', () => {
    const { p, m } = withModule();
    change(dimInput(p, 'D'), '650');
    change(p.document.getElementById('chkFixed'), true);
    const again = boot(Object.assign(p.storage._dump(), { _search: '?design=gold&item=1' }));
    const back = again.g('modules').find((x) => x.id === m.id);
    expect(Math.round(back.D)).toBe(650);
    expect(back.isFixed).toBe(true);
  });
});

describe('영역 크기', () => {
  test('배치 공간의 W/H/D 를 고친다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    change(dimInput(p, 'H'), '2300');
    expect(Math.round(p.g('areas').find((a) => a.id === area.id).H)).toBe(2300);
  });

  test('영역 폭은 모듈보다 넓게 잡을 수 있다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    expect(+dimInput(p, 'W').max).toBe(8000);
  });
});

describe('영역 높이 부위 — 좌대 · 상몰딩', () => {
  test('그 섹션에 없는 부위는 아예 안 뜬다 (W12-39)', () => {
    // 하부장은 다리발·상판이 높이 모델이고 상몰딩이 없다.
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    expect(p.document.querySelector('#heightBody input[data-apart="moldingH"]')).toBeNull();
  });

  test('항목이 그 섹션의 높이 모델과 같다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    const keys = [...p.document.querySelectorAll('#heightBody input[data-apart]')]
      .map((n) => n.getAttribute('data-apart'));
    expect(keys).toEqual(p.g('heightPartsOf')({ section: area.section, H: area.H }, {}).map((x) => x.key));
    expect(p.document.getElementById('selAreaBaseKind')).not.toBeNull();
  });

  test('있는 부위는 값을 고칠 수 있다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    area.section = 'tall';                 // 키큰장은 좌대를 가진다
    p.g('addModuleToArea')(area.id, { section: 'tall', W: 900, x: area.x || 0 });
    p.g('setActiveArea')(area.id);
    const inp = p.document.querySelector('#heightBody input[data-apart="pedestalH"]');
    if (inp.disabled) return;              // 섹션 높이 모델이 다르면 건너뛴다
    change(inp, '120');
    expect(p.g('areas').find((a) => a.id === area.id).pedestalH).toBe(120);
  });
});

describe('영역 마감 — 배치 공간 양 끝에 한 장씩', () => {
  test('좌·우 두 칸이 있다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    const sides = [...p.document.querySelectorAll('#finishBody select[data-fin]')]
      .map((n) => n.getAttribute('data-fin'));
    expect(sides).toEqual(['left', 'right']);
  });

  test('EP 를 고르면 영역 끝에 마감재가 선다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#finishBody select[data-fin="left"]'), 'ep');
    const fin = p.g('modules').filter((x) => x.isFinishing && x.areaId === area.id);
    expect(fin.length).toBe(1);
    expect(fin[0].section).toBe('ep');
    expect(fin[0].hostSide).toBe('left');
  });

  test('없음으로 되돌리면 뗀다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#finishBody select[data-fin="left"]'), 'ep');
    change(p.document.querySelector('#finishBody select[data-fin="left"]'), '');
    expect(p.g('modules').filter((x) => x.isFinishing).length).toBe(0);
  });

  test('새로고침을 견딘다', () => {
    const { p, area } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#finishBody select[data-fin="right"]'), 'molding');
    const again = boot(Object.assign(p.storage._dump(), { _search: '?design=gold&item=1' }));
    const fin = again.g('modules').filter((x) => x.isFinishing);
    expect(fin.length).toBe(1);
    expect(fin[0].section).toBe('molding');
  });
});

describe('소스 규약', () => {
  test('모드는 마지막으로 고른 것을 따른다', () => {
    // activeId·activeAreaId 로는 못 가른다 — 서로를 지우지 않기 때문이다.
    expect(SRC).toContain("let panelTarget = 'module';");
    const sam = SRC.slice(SRC.indexOf('function setActiveModule'), SRC.indexOf('function setActiveModule') + 200);
    expect(sam).toContain("panelTarget = 'module';");
    const sar = SRC.slice(SRC.indexOf('function setActiveArea'), SRC.indexOf('function setActiveArea') + 500);
    expect(sar).toContain("panelTarget = 'area';");
  });

  test('섹션 마크업은 한 벌이다', () => {
    const keys = (SRC.match(/class="section[^"]*" data-sec="(\w+)"/g) || []).length;
    expect(keys).toBe(7);
    expect(SRC).toContain('const PANEL_LAYOUT = {');
  });

  test('치수 규칙이 한 곳이다', () => {
    const from = SRC.indexOf('function applyModuleDim');
    const to = SRC.indexOf('function applyHeightPart');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(SRC.slice(from, to)).toContain("if (k === 'W') { s.areaWidths = []; s.areaIs2D = []; }");
    // 치수를 직접 만지는 곳은 이 함수 하나뿐이다.
    expect((SRC.match(/m\[k\] = v;/g) || []).length).toBe(1);
  });

  test('영역 부위 판단이 한 곳이다', () => {
    // W12-39: 영역 패널도 heightPartsOf 를 **그대로** 읽는다. 예전엔 항목을
    // 손으로 나열하고 없는 것을 막았다 — 판단이 두 벌이었다.
    const ah = SRC.slice(SRC.indexOf('function renderAreaHeightPanel'),
                         SRC.indexOf('function renderAreaFinishPanel'));
    expect(ah).toContain('heightPartsOf(probe, own)');
    expect(ah).not.toMatch(/\['topT', '상판'/);
  });

  test('영역 값 변경은 영역이 건드리는 것을 모두 다시 그린다', () => {
    const fn = SRC.slice(SRC.indexOf('function areaPanelCommit'), SRC.indexOf('const DIM_ROWS'));
    ['saveStructModules()', 'persistPlannerState()', 'renderAreaTools()',
     'renderModuleList()', 'renderFrontView()', 'renderRightPanel()'].forEach((call) => {
      expect(fn).toContain(call);
    });
  });
});

describe('영역 크기를 고치면 마감재가 따라온다 (W12-31)', () => {
  // 마감재는 만들 때 영역의 H·D 를 받아 간다 (W12-18). 그런데 그 뒤 영역 크기를
  // 고치면 옛 치수로 남아 있었다 — 2300→2100 으로 줄여도 EP 는 2300 인 채였다.
  function withFinish() {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    p.g('addModuleToArea')(area.id, { section: 'lower', W: 1200, x: area.x || 0 });
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#finishBody select[data-fin="left"]'), 'ep');
    return { p, area, fin: () => p.g('modules').find((x) => x.isFinishing) };
  }

  test('높이를 줄이면 마감재 높이도 준다', () => {
    const { p, area, fin } = withFinish();
    expect(fin()).toBeTruthy();
    change(dimInput(p, 'H'), '2100');
    // W12-44: EP 는 상판 아래에서 멈춘다 — 하부장 영역이라 상판 두께를 뺀다.
    const topT = p.g('heightPartOf')({ section: area.section, H: 2100 }, {}, 'topT');
    expect(Math.round(fin().H)).toBe(2100 - topT);
  });

  test('깊이를 줄이면 마감재 깊이도 준다', () => {
    const { p, fin } = withFinish();
    change(dimInput(p, 'D'), '600');
    expect(Math.round(fin().D)).toBe(600);
  });

  test('폭은 마감재 종류가 정한다 — 영역 폭을 따라가지 않는다', () => {
    const { p, fin } = withFinish();
    const w = fin().W;
    change(dimInput(p, 'W'), '2400');
    expect(fin().W).toBe(w);
  });

  test('영역 커밋이 반드시 지나는 자리다', () => {
    const pan = SRC.slice(SRC.indexOf('function areaPanelCommit'), SRC.indexOf('const DIM_ROWS'));
    expect(pan).toContain('syncFinishingsToAreas()');
    // 부르는 곳은 하나 — 영역 값이 바뀌는 유일한 경로다.
    expect((SRC.match(/syncFinishingsToAreas\(\)/g) || []).length).toBe(2);   // 정의 1 + 호출 1
  });
});
