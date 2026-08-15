/**
 * 우측 패널의 도어 방향 표시 — 저장된 값과 화면이 어긋나지 않는지.
 *
 * 무엇을 막는가:
 *   autoCalcModule 은 양문 cell 에 areaDirections='both' 를 넣는다(W>600 인 거의 모든 모듈).
 *   그런데 우측 패널의 방향 <select> 에는 left/right 옵션밖에 없었다.
 *   selected 가 붙은 옵션이 하나도 없으면 브라우저는 **첫 옵션을 고른 것처럼 보여준다** —
 *   값은 'both' 인데 화면은 "좌 ◀" 라고 말한다.
 *
 *   게다가 그 select 로 좌/우를 바꿔도 정면도는 is2D 로 먼저 분기해 양문을 그리므로
 *   아무 효과가 없었다. 동작하지 않는 컨트롤이 거짓 정보까지 보여주던 셈이다.
 *
 * 이 결함이 오래 남은 이유는 우측 패널을 지나가는 테스트가 없었기 때문이다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

/** 활성 모듈 하나를 잡고 그 구조를 주어진 모양으로 맞춘 뒤 우측 패널을 그린다 */
function renderWith(cells) {
  const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
  const m = p.g('modules')[0];
  p.g('setActiveModule')(m.id);
  const s = p.g('getStructure')(m.id);

  s.verticalCount = cells.length;
  s.areaTypes = cells.map((c) => c.type || 'door');
  s.areaDirections = cells.map((c) => c.dir);
  s.areaIs2D = cells.map((c) => !!c.is2D);

  p.g('renderRightPanel')();
  return { p, rows: [...p.document.querySelectorAll('#areasBody .area-row')] };
}

describe('양문 cell', () => {
  test('방향 select 대신 양문 라벨을 보여준다', () => {
    const { rows } = renderWith([{ dir: 'both', is2D: true }]);
    expect(rows).toHaveLength(1);
    // 동작하지 않는 컨트롤을 아예 두지 않는다
    expect(rows[0].querySelector('.a-dir')).toBeNull();
    expect(rows[0].textContent).toContain('양문');
  });
});

describe('단문 cell', () => {
  test.each(['left', 'right'])('저장된 방향 %s 가 그대로 선택돼 있다', (dir) => {
    const { rows } = renderWith([{ dir, is2D: false }]);
    const sel = rows[0].querySelector('.a-dir');
    expect(sel).not.toBeNull();
    expect(sel.value).toBe(dir);
  });
});

describe('회귀 가드 — select 가 뜨면 저장된 값이 반드시 옵션에 있다', () => {
  // 이 불변식이 깨지는 순간이 곧 "화면이 거짓말하는" 순간이다.
  // select.value 는 일치하는 옵션이 없으면 첫 옵션 값을 돌려주므로,
  // 저장값과 비교하면 어긋남이 그대로 잡힌다.
  const MIXED = [
    { dir: 'left',  is2D: false },
    { dir: 'both',  is2D: true  },
    { dir: 'right', is2D: false },
    { dir: 'both',  is2D: true  },
    { dir: 'left',  is2D: false, type: 'open' },
  ];

  test('섞인 구성에서도 표시가 저장값과 일치한다', () => {
    const { rows } = renderWith(MIXED);
    expect(rows).toHaveLength(MIXED.length);
    rows.forEach((row, i) => {
      const sel = row.querySelector('.a-dir');
      if (!sel) return;                       // 라벨로 표시된 cell 은 대상이 아니다
      expect(sel.value).toBe(MIXED[i].dir);   // 첫 옵션으로 흘러내리면 여기서 잡힌다
    });
  });

  test('자동계산이 실제로 내는 구조에서도 어긋남이 없다', () => {
    // 하드코딩한 모양이 아니라 엔진이 만든 값으로 확인한다.
    const engine = require('../js/planner/planner-engine');
    const s0 = {};
    engine.autoCalcModule({ id: 'x', section: 'lower', x: 0, W: 1800, H: 870 }, s0, null);
    expect(s0.areaDirections).toContain('both');   // 전제가 유지되는지부터 확인

    const { rows } = renderWith(
      s0.areaDirections.map((dir, i) => ({ dir, is2D: s0.areaIs2D[i], type: s0.areaTypes[i] }))
    );
    rows.forEach((row, i) => {
      const sel = row.querySelector('.a-dir');
      if (!sel) return;
      expect(sel.value).toBe(s0.areaDirections[i]);
    });
  });
});
