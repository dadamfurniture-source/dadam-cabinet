/**
 * 배치 단계 — 변 드래그로 크기 바꾸기 (2026-09-22).
 *
 * 두 가지가 요구였다:
 *   1) 각 변을 끌면 그 변만 움직인다 (반대쪽 변은 제자리)
 *   2) 이웃과 겹쳐 보이면 그 변에 **딱 맞게** 붙는다
 *
 * 하네스가 실제 pointer 이벤트를 쏘므로 소스를 문자열로 뒤지지 않고 **진짜로 끌어 본다.**
 *
 * ⚠ 사각형은 놓일 때 **회전이 붙는다** (addSectionRect 가 벽에 맞춰 0·90·180·270 중 하나를 고른다).
 *   그래서 이 시험은 로컬 변 이름(n·e·s·w)이 아니라 **화면에서 보이는 변**(minX·maxX·minY·maxY)으로
 *   잡아 끈다 — 사용자가 하는 것과 같다. 회전은 0·90·180·270 네 가지를 모두 본다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

function boot() {
  const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 회전을 원하는 각도로 맞춘다 — rotateG 는 90씩 돈다 */
function setRot(p, g, deg) {
  const want = ((deg % 360) + 360) % 360;
  for (let i = 0; i < 4 && (p.g('rotations').get(g) || 0) !== want; i++) p.g('rotateG')(g);
  return (p.g('rotations').get(g) || 0);
}

/** 사각형 하나를 원하는 자리·크기로 놓는다 (회전 0 — 로컬과 화면이 같아진다) */
function place(p, section, x, y, w, h, rot = 0) {
  p.g('addSectionRect')(section);
  const all = p.document.querySelectorAll('g.sect-rect');
  const g = all[all.length - 1];
  const r = g.querySelector(':scope > rect:not(.resize-handle)');
  r.setAttribute('x', x); r.setAttribute('y', y);
  r.setAttribute('width', w); r.setAttribute('height', h);
  setRot(p, g, rot);
  // 회전 pivot 은 rotateG 가 옛 치수로 잡아 뒀을 수 있다 — 새 치수로 다시 앉힌다
  p.g('applyRectGeom')(g, { x, y, w, h });
  return g;
}

const bbox = (p, g) => {
  const b = p.g('getVisualBBox')(g);
  return {
    minX: Math.round(b.minX), maxX: Math.round(b.maxX),
    minY: Math.round(b.minY), maxY: Math.round(b.maxY),
  };
};

function handleHost(p, g) {
  p.g('selectG')(g);
  return g.querySelector(':scope > g.edge-handles');
}

/**
 * **화면에서 보이는 변**을 mm 만큼 끈다.
 * @param side 'minX' | 'maxX' | 'minY' | 'maxY'
 */
function dragSide(p, g, side, mm, opts) {
  // 줌을 1 로 고정한다 — 화면 px 와 mm 가 1:1 이라야 끌린 거리를 딱 떨어지게 셀 수 있다.
  //   사각형을 놓을 때마다 fitAll 이 줌을 다시 잡으므로 **끌기 직전에** 맞춘다.
  p.g('view').zoom = 1;
  const host = handleHost(p, g);
  const angle = p.g('rotations').get(g) || 0;
  const edge = ['n', 'e', 's', 'w'].find((e) => p.g('edgeVisualSide')(e, angle) === side);
  if (!edge) throw new Error(`화면 변 ${side} 에 해당하는 핸들이 없다 (회전 ${angle})`);
  const handle = host.querySelector(`rect[data-edge="${edge}"]`);
  const z = p.g('view').zoom || 1;
  const dx = side.endsWith('X') ? mm * z : 0;
  const dy = side.endsWith('Y') ? mm * z : 0;
  p.pointer.down(handle, 0, 0, opts);
  p.pointer.move(host, dx, dy, opts);
  p.pointer.up(host, dx, dy, opts);
}

describe('고른 사각형에만 변 핸들이 붙는다', () => {
  test('네 변 모두 — 고르면 생기고 풀면 사라진다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    const host = handleHost(p, g);
    expect(host).not.toBeNull();
    expect([...host.querySelectorAll('rect[data-edge]')].map((h) => h.getAttribute('data-edge')).sort())
      .toEqual(['e', 'n', 's', 'w']);
    p.g('selectG')(null);
    expect(g.querySelector(':scope > g.edge-handles')).toBeNull();
  });

  test('핸들은 "진짜 사각형" 선택자에 걸리지 않는다 — 문서 전체가 그 선택자로 사각형을 찾는다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    handleHost(p, g);
    expect(g.querySelector(':scope > rect:not(.resize-handle)').getAttribute('width')).toBe('1000');
    expect(p.document.querySelectorAll('g.content rect:not(.resize-handle)')).toHaveLength(1);
  });

  test('마감재(부재)에는 붙지 않는다 — 부모를 따라가는 종속물이다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    g.classList.add('finishing');
    expect(handleHost(p, g)).toBeNull();
  });

  test('커서는 화면에서 보이는 방향을 따른다 — 90도 돌면 좌우 변이 위아래로 보인다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600, 90);
    const host = handleHost(p, g);
    expect(host.querySelector('rect[data-edge="e"]').getAttribute('data-axis')).toBe('y');
    expect(host.querySelector('rect[data-edge="n"]').getAttribute('data-axis')).toBe('x');
  });
});

describe('변을 끌면 그 변만 움직인다', () => {
  test('오른쪽 변 — 오른쪽만 늘고 왼쪽·위·아래는 제자리', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    dragSide(p, g, 'maxX', 300);
    expect(bbox(p, g)).toEqual({ minX: 0, maxX: 1300, minY: 0, maxY: 600 });
  });

  test('왼쪽 변 — 왼쪽이 밀려 들어가고 오른쪽 끝은 그대로', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    dragSide(p, g, 'minX', 200);
    expect(bbox(p, g)).toEqual({ minX: 200, maxX: 1000, minY: 0, maxY: 600 });
  });

  test('아래 변 — 깊이만 바뀐다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    dragSide(p, g, 'maxY', 150);
    expect(bbox(p, g)).toEqual({ minX: 0, maxX: 1000, minY: 0, maxY: 750 });
  });

  test('최소 50 아래로는 줄지 않는다 — 붙잡은 변은 그대로', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    dragSide(p, g, 'maxX', -5000);
    expect(bbox(p, g)).toEqual({ minX: 0, maxX: 50, minY: 0, maxY: 600 });
  });
});

describe('이웃과 겹치면 그 변에 딱 맞춘다', () => {
  test('밀고 들어가면 이웃의 앞 변에서 멈춘다 — 겹치지 않는다', () => {
    const p = boot();
    const a = place(p, 'lower', 0, 0, 1000, 600);
    place(p, 'lower', 1500, 0, 800, 600);       // 오른쪽 이웃, 앞 변 x=1500
    dragSide(p, a, 'maxX', 900);                // 1900 까지 밀어붙인다 (이웃 속으로)
    expect(bbox(p, a).maxX).toBe(1500);
  });

  test('가까이 가면 끌어당겨 붙는다 — 격자(50) 위에 없는 이웃에도', () => {
    const p = boot();
    const a = place(p, 'lower', 0, 0, 1000, 600);
    place(p, 'lower', 1480, 0, 800, 600);
    dragSide(p, a, 'maxX', 475);                // 1475 → 이웃 앞 변 1480 이 5 앞
    expect(bbox(p, a).maxX).toBe(1480);
  });

  test('왼쪽으로 늘릴 때도 왼쪽 이웃 뒷 변에서 멈춘다', () => {
    const p = boot();
    const a = place(p, 'lower', 1000, 0, 1000, 600);
    place(p, 'lower', 0, 0, 700, 600);          // 왼쪽 이웃, 뒷 변 x=700
    dragSide(p, a, 'minX', -900);               // 100 까지 밀어붙인다
    expect(bbox(p, a).minX).toBe(700);
  });

  test('다른 축에서 마주 보지 않으면 막지 않는다', () => {
    const p = boot();
    const a = place(p, 'lower', 0, 0, 1000, 600);
    place(p, 'lower', 1500, 2000, 800, 600);    // 한참 아래 — 마주 보지 않는다
    dragSide(p, a, 'maxX', 900);
    expect(bbox(p, a).maxX).toBe(1900);
  });

  test('층이 다르면 막지 않는다 — 상부장은 하부장 위에 겹치는 것이 정상', () => {
    const p = boot();
    const a = place(p, 'lower', 0, 0, 1000, 600);
    place(p, 'upper', 1500, 0, 800, 600);
    dragSide(p, a, 'maxX', 900);
    expect(bbox(p, a).maxX).toBe(1900);
  });

  test('Shift 를 누르면 맞추지도 막지도 않는다 (1mm 자유)', () => {
    const p = boot();
    const a = place(p, 'lower', 0, 0, 1000, 600);
    place(p, 'lower', 1500, 0, 800, 600);
    dragSide(p, a, 'maxX', 913, { shiftKey: true });
    expect(bbox(p, a).maxX).toBe(1913);
  });
});

describe('회전해도 붙잡은 변이 제자리에 남는다', () => {
  // 회전한 사각형은 rotate(각, 중심) 으로 그려진다. 로컬 width 만 고치면 **회전 중심이 같이 움직여**
  // 반대쪽 변까지 밀린다 — 화면 bbox 로 계산하는 이유가 이것이다.
  [0, 90, 180, 270].forEach((rot) => {
    test(`${rot}도 — 오른쪽 변만 200 늘어난다`, () => {
      const p = boot();
      const g = place(p, 'lower', 0, 0, 1000, 600, rot);
      const before = bbox(p, g);
      dragSide(p, g, 'maxX', 200);
      const after = bbox(p, g);
      expect(after.maxX).toBe(before.maxX + 200);
      expect(after.minX).toBe(before.minX);
      expect(after.minY).toBe(before.minY);
      expect(after.maxY).toBe(before.maxY);
    });
  });
});

describe('되돌리기', () => {
  test('변 드래그도 되돌리기·다시하기가 된다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    dragSide(p, g, 'maxX', 300);
    expect(bbox(p, g).maxX).toBe(1300);
    p.g('undo')();
    expect(bbox(p, g).maxX).toBe(1000);
    p.g('redo')();
    expect(bbox(p, g).maxX).toBe(1300);
  });

  test('끌지 않고 톡 눌렀다 떼면 기록하지 않는다', () => {
    const p = boot();
    const g = place(p, 'lower', 0, 0, 1000, 600);
    const later = place(p, 'lower', 3000, 0, 800, 600);
    dragSide(p, g, 'maxX', 0);
    p.g('undo')();
    // 직전 기록은 두 번째 사각형 추가였다 — 그것이 되돌려져야 한다
    expect(later.parentElement).toBeNull();
    expect(bbox(p, g).maxX).toBe(1000);
  });
});
