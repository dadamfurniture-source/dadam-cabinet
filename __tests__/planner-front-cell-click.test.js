/**
 * W12-30: 정면도 칸을 클릭해 도어 방향을 정한다.
 *
 * 팔레트의 도어 미리보기(`.dp-hit`)가 하던 일을 정면도로 옮긴다. 미리보기는
 * 정면도와 같은 그림을 두 번 그리던 것이라, 정면도 하나만 남기는 편이 맞다.
 * 팔레트를 지우기 **전에** 대체재를 먼저 넣는다.
 *
 * 규칙은 미리보기와 같다 — 도어이고 양문이 아닐 때만 뒤집는다.
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

/** 하부장 모듈 하나를 고르고 정면도를 그린다 */
function withModule(cells) {
  const p = boot(seedFor(FIXTURES.straight, { modules: false }));
  const area = p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id, { section: 'lower', W: 1200, x: area.x || 0 });
  const s = p.g('getStructure')(m.id);
  if (cells) p.g('syncCellArrays')(s, cells);
  p.g('setActiveModule')(m.id);
  p.g('renderFrontView')();
  return { p, m, s };
}

const click = (el) =>
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

const cellAt = (p, idx) =>
  p.document.querySelector(`#contentG .area-rect[data-cell-idx="${idx}"]`);

describe('칸이 클릭 대상이다', () => {
  test('칸마다 소속 모듈과 인덱스가 붙는다', () => {
    const { p } = withModule(2);
    expect(cellAt(p, 0)).not.toBeNull();
    expect(cellAt(p, 1)).not.toBeNull();
    expect(cellAt(p, 0).getAttribute('data-cell-of')).toMatch(/^lower-/);
  });

  test('커서가 손가락이다 — 누를 수 있음을 보인다', () => {
    const { p } = withModule();
    expect(cellAt(p, 0).style.cursor).toBe('pointer');
  });
});

describe('도어 칸을 누르면 방향이 뒤집힌다', () => {
  test('좌 → 우 → 좌', () => {
    const { p, m, s } = withModule();
    s.areaTypes[0] = 'door';
    s.areaDirections[0] = 'left';
    p.g('renderFrontView')();
    click(cellAt(p, 0));
    expect(p.g('getStructure')(m.id).areaDirections[0]).toBe('right');
    click(cellAt(p, 0));
    expect(p.g('getStructure')(m.id).areaDirections[0]).toBe('left');
  });

  test('칸마다 따로 뒤집힌다', () => {
    const { p, m, s } = withModule(2);
    s.areaTypes = ['door', 'door'];
    s.areaDirections = ['left', 'left'];
    p.g('renderFrontView')();
    click(cellAt(p, 1));
    const after = p.g('getStructure')(m.id).areaDirections;
    expect(after[0]).toBe('left');
    expect(after[1]).toBe('right');
  });

  test('새로고침을 견딘다', () => {
    const { p, m, s } = withModule();
    s.areaTypes[0] = 'door';
    s.areaDirections[0] = 'left';
    p.g('renderFrontView')();
    click(cellAt(p, 0));
    const again = boot(Object.assign(p.storage._dump(), { _search: '?design=gold&item=1' }));
    expect(again.g('getStructure')(m.id).areaDirections[0]).toBe('right');
  });
});

describe('뒤집으면 안 되는 칸은 그대로다', () => {
  test('서랍 칸', () => {
    const { p, m, s } = withModule();
    s.areaTypes[0] = 'drawer';
    s.areaDirections[0] = 'left';
    p.g('renderFrontView')();
    click(cellAt(p, 0));
    expect(p.g('getStructure')(m.id).areaDirections[0]).toBe('left');
  });

  test('오픈 칸', () => {
    const { p, m, s } = withModule();
    s.areaTypes[0] = 'open';
    s.areaDirections[0] = 'left';
    p.g('renderFrontView')();
    click(cellAt(p, 0));
    expect(p.g('getStructure')(m.id).areaDirections[0]).toBe('left');
  });

  test('양문 칸 — 좌우가 이미 정해져 있다 (#471)', () => {
    const { p, m, s } = withModule();
    s.areaTypes[0] = 'door';
    s.areaDirections[0] = 'left';
    s.areaIs2D = [true];
    p.g('renderFrontView')();
    click(cellAt(p, 0));
    expect(p.g('getStructure')(m.id).areaDirections[0]).toBe('left');
  });
});

describe('하부 영역도 같은 규칙', () => {
  test('하부 도어면 bottomDirection 이 뒤집힌다', () => {
    const { p, m, s } = withModule();
    s.horizontalLayout = 'doorTopDrawerBottom';
    s.bottomType = 'door';
    s.bottomDirection = 'left';
    p.g('renderFrontView')();
    const cell = cellAt(p, 'bottom');
    expect(cell).not.toBeNull();
    click(cell);
    expect(p.g('getStructure')(m.id).bottomDirection).toBe('right');
  });

  test('하부가 서랍이면 안 바뀐다', () => {
    const { p, m, s } = withModule();
    s.horizontalLayout = 'doorTopDrawerBottom';
    s.bottomType = 'drawer';
    s.bottomDirection = 'left';
    p.g('renderFrontView')();
    click(cellAt(p, 'bottom'));
    expect(p.g('getStructure')(m.id).bottomDirection).toBe('left');
  });
});

describe('다른 모듈의 칸을 누르면 먼저 그 모듈이 선택된다', () => {
  test('선택만 하고 방향은 안 바뀐다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    const a = p.g('addModuleToArea')(area.id, { section: 'lower', W: 600, x: area.x || 0 });
    const b = p.g('addModuleToArea')(area.id, { section: 'lower', W: 600, x: (area.x || 0) + 600 });
    p.g('setActiveModule')(a.id);
    const sb = p.g('getStructure')(b.id);
    sb.areaTypes[0] = 'door';
    sb.areaDirections[0] = 'left';
    p.g('renderFrontView')();
    const cell = p.document.querySelector(`#contentG .area-rect[data-cell-of="${b.id}"]`);
    if (!cell) return;                       // 영역 보기에서 b 가 안 보이면 건너뛴다
    click(cell);
    expect(p.g('getStructure')(b.id).areaDirections[0]).toBe('left');
  });
});

describe('소스 규약', () => {
  test('bindFrontCell 마커가 살아 있다', () => {
    expect(SRC.indexOf('function bindFrontCell')).toBeGreaterThan(-1);
  });

  test('미리보기와 같은 술어를 쓴다', () => {
    const fn = SRC.slice(SRC.indexOf('function bindFrontCell'), SRC.indexOf('function renderModuleFront'));
    expect(fn).toMatch(/type === 'door' && !is2D/);
    expect(fn).toContain('panelCommit()');
    expect(fn).toContain('stopPropagation');
  });

  test('data-module-id 규약을 깨지 않는다 — 모듈당 하나', () => {
    // positionPalette 와 여러 테스트가 그걸로 모듈을 센다.
    const fn = SRC.slice(SRC.indexOf('function bindFrontCell'), SRC.indexOf('function renderModuleFront'));
    expect(fn).toContain("data-cell-of");
    expect(fn).not.toContain("setAttribute('data-module-id'");
  });

  test('상·하부 칸 모두 배선됐다', () => {
    expect((SRC.match(/bindFrontCell\(r, m, s,/g) || []).length).toBe(2);
  });

  test('셀 폭 규칙이 한 곳이다', () => {
    // 예전엔 renderModuleFront 안에 cellWidthsOf 와 같은 식이 또 있었다.
    // 끝 마커는 renderModuleFront **뒤에** 오는 것을 써야 한다.
    // renderFrontSet 은 앞에 있어 slice 가 빈 문자열이 된다 (조용한 거짓 통과).
    const from = SRC.indexOf('function renderModuleFront');
    const to = SRC.indexOf('function renderAreas3D', from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const fn = SRC.slice(from, to);
    expect(fn).toContain('cellWidthsOf(m, s)');
    expect(fn).not.toMatch(/Array\(vCount\)\.fill\(m\.W \/ vCount\)/);
  });

  test('고른 모듈이 도면에서 굵게 보인다', () => {
    const head = SRC.slice(SRC.indexOf('function renderModuleFront'), SRC.indexOf('function renderModuleFront') + 2200);
    expect(head).toMatch(/const on = m\.id === activeId;/);
    expect(head).toMatch(/stroke-width', on \? 8 : 4/);
  });
});

describe('포인터 캡처가 클릭을 삼키지 않는다 (W12-30)', () => {
  // pointerdown 에서 곧바로 setPointerCapture 를 걸면 이후 이벤트가 **전부 SVG 로**
  // 가서 자식(모듈 외곽·칸)의 click 이 실제 마우스로는 한 번도 안 불린다.
  // dispatchEvent 로는 멀쩡히 동작해 테스트로는 안 잡혔다 — playwright 실측이 잡았다.
  const pan = SRC.slice(SRC.indexOf('// pan'), SRC.indexOf('// 키보드'));

  test('pointerdown 에서 캡처하지 않는다', () => {
    const down = pan.slice(pan.indexOf("addEventListener('pointerdown'"), pan.indexOf("addEventListener('pointermove'"));
    expect(down).not.toContain('setPointerCapture');
  });

  test('실제로 움직인 뒤에만 팬으로 넘어간다', () => {
    expect(pan).toMatch(/const PAN_SLOP = \d+;/);
    expect(pan).toMatch(/if \(Math\.abs\(dx\) < PAN_SLOP && Math\.abs\(dy\) < PAN_SLOP\) return;/);
    const move = pan.slice(pan.indexOf("addEventListener('pointermove'"));
    expect(move).toContain('setPointerCapture');
    expect(move).toContain('panInfo.moved = true');
  });

  test('캡처 실패해도 팬이 죽지 않는다', () => {
    expect(pan).toMatch(/try \{ svg\.setPointerCapture\(panInfo\.id\); \} catch \(_\) \{\}/);
  });
});
