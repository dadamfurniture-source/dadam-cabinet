/**
 * 영역(배치 사각형) + 모듈 추가 방식.
 *
 * 바뀐 계약:
 *   예전 — 배치 사각형 하나가 곧 모듈 하나. 구조 단계는 모듈이 가득 찬 채로 시작했다.
 *   지금 — 사각형은 **영역**(읽기 전용 그릇). 모듈은 사용자가 영역에 넣는다.
 *
 * 이 파일이 지키는 것:
 *   · 새 설계는 모듈 0개로 시작한다 (영역만 보이는 첫 화면)
 *   · 예전 방식으로 만든 설계는 그대로 열린다 (데이터를 잃은 것처럼 보이면 안 된다)
 *   · 영역을 넘치게 넣지 않는다 (치수를 지어내지 않는다)
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor, modulesFromFixture } = require('../test-utils/planner-golden');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=t&item=1';
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('첫 화면 — 영역만 보인다', () => {
  test('배치만 있고 구조를 짠 적이 없으면 모듈이 0개다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('modules')).toHaveLength(0);
    expect(p.g('areas').length).toBeGreaterThan(0);
  });

  test('영역은 배치의 사각형에서 온다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const sections = p.g('areas').map((a) => a.section).sort();
    expect(sections).toEqual(['hood', 'lower', 'lower', 'lower', 'sink', 'upper', 'upper']);
  });

  test('영역만 있어도 정면도가 오류 없이 그려진다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(() => p.g('renderFrontView')()).not.toThrow();
    const rects = p.document.querySelectorAll('#contentG [data-area-id]');
    expect(rects.length).toBe(p.g('areas').length);
  });

  test('빈 화면 안내가 영역을 가리지 않는다', () => {
    // 예전엔 "활성 모듈이 없으면" 안내를 띄웠다. 새 방식은 모듈 0개로 시작하므로
    // 그대로 두면 첫 화면이 안내 문구에 통째로 가려진다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('syncCanvasEmpty')();
    expect(p.document.getElementById('canvasEmpty').style.display).toBe('none');
  });
});

describe('영역이 배치 좌표대로 그려진다', () => {
  // 처음 구현은 영역을 임의로 좌→우 나열해서(ox += W + 300) ㄱ자 배치가 일렬로
  // 보였다. 영역은 모듈과 **같은 좌표 규약**을 써야 계획이 그대로 표현된다.

  test('X 는 사람(원점) 기준이다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const rectOf = p.g('areaFrontRect');
    const ox = p.g('getFrontViewOriginX')();
    p.g('areas').forEach((a) => {
      if ((a.rotation || 0) % 360 === 0) expect(rectOf(a).x).toBe((a.x || 0) - ox);
    });
  });

  test('상부장은 천장 매달림이라 Y 가 다르다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const rectOf = p.g('areaFrontRect');
    const lower = p.g('areas').find((a) => a.section === 'lower');
    const upper = p.g('areas').find((a) => a.section === 'upper');
    // 천장에서 잰 거리 — 상부장이 위(작은 y), 하부장이 아래
    expect(rectOf(upper).y).toBeLessThan(rectOf(lower).y);
  });

  test('ㄱ자 배치에서 회전 90 영역은 깊이가 폭이 된다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const rectOf = p.g('areaFrontRect');
    const rot90 = p.g('areas').find((a) => (a.rotation || 0) === 90);
    expect(rot90).toBeDefined();
    // 정면에서 보면 회전 90 모듈은 W 가 아니라 D 만큼 폭을 차지한다
    expect(rectOf(rot90).w).toBe(rot90.D);
  });

  test('서로 다른 영역이 겹쳐 그려지지 않는다 (하부장끼리)', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const rectOf = p.g('areaFrontRect');
    const lows = p.g('areas').filter((a) => a.section === 'lower')
      .map(rectOf).sort((a, b) => a.x - b.x);
    for (let i = 1; i < lows.length; i++) {
      expect(lows[i].x).toBeGreaterThanOrEqual(lows[i - 1].x + lows[i - 1].w - 1);
    }
  });
});

describe('영역 보기와 모듈 상세는 다른 화면이다', () => {
  test('모듈을 추가해도 영역이 계속 보인다', () => {
    // 예전엔 "모듈이 없을 때만" 영역을 그려서, 하나 넣는 순간 영역이 사라졌다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    p.g('setActiveArea')(area.id);
    p.g('addModuleToArea')(area.id);
    p.g('renderFrontView')();
    expect(p.document.querySelectorAll('#contentG [data-area-id]').length)
      .toBe(p.g('areas').length);
  });

  test('영역 보기에서는 모듈이 한 번만 그려진다', () => {
    // 영역 안에서 한 번, 뒤이어 single 경로에서 또 한 번 그려지던 문제.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    p.g('setActiveArea')(area.id);
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    p.g('renderFrontView')();
    expect(p.document.querySelectorAll(`#contentG [data-module-id="${m.id}"]`)).toHaveLength(1);
  });

  test('영역 보기 모듈은 배치 좌표에 놓인다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    p.g('setActiveArea')(area.id);
    const m = p.g('addModuleToArea')(area.id);
    p.g('renderFrontView')();
    const rect = p.document.querySelector(`#contentG [data-module-id="${m.id}"]`);
    expect(Number(rect.getAttribute('x'))).toBe(p.g('areaFrontRect')(m).x);
  });
});

describe('예전 설계는 그대로 열린다', () => {
  test('구조를 짜 둔 설계는 모듈이 실려서 나온다', () => {
    // 예전 방식: 배치 + structures 는 있지만 구조 단계 모듈 목록은 없다.
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_structure_v1::gold:1'] = JSON.stringify({ 'lower-0': { verticalCount: 2 } });
    const p = boot(seed);
    // 열자마자 빈 화면이 되면 사용자에겐 데이터를 잃은 것과 같다.
    expect(p.g('modules').length).toBeGreaterThan(0);
  });

  test('레거시로 읽으면 현재 배치 도장을 찍어 둔다', () => {
    // 안 찍으면 이 설계는 영원히 레거시로 열려, 배치를 새로 만들어도
    // 영역 화면을 보지 못한다 (구조가 한 번이라도 있으면 계속 걸린다).
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_structure_v1::gold:1'] = JSON.stringify({ 'lower-0': { verticalCount: 2 } });
    const p = boot(seed);
    const raw = p.storage.getItem('dadam_struct_modules_v1::gold:1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).layoutSavedAt).toBe(FIXTURES.straight.savedAt);
  });

  test('부분만 저장된 구조도 흰 화면이 되지 않는다', () => {
    // areaTypes 하나만 없어도 renderModuleFront 가 터지고 렌더 전체가 멈춘다.
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_structure_v1::gold:1'] = JSON.stringify({ 'lower-0': { verticalCount: 2 } });
    const p = boot(seed);
    const s = p.g('getStructure')('lower-0');
    expect(Array.isArray(s.areaTypes)).toBe(true);
    expect(Array.isArray(s.areaDirections)).toBe(true);
    expect(s.verticalCount).toBe(2);            // 저장돼 있던 값은 그대로 둔다
    expect(() => p.g('renderFrontView')()).not.toThrow();
  });
});

describe('모듈은 그 배치에 속한다', () => {
  test('배치를 새로 만들면 영역만 있는 첫 화면으로 연다', () => {
    // 이게 안 되면 기존 사용자는 새로 배치해도 예전 모듈이 실린 화면을 본다.
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_struct_modules_v1::gold:1'] = JSON.stringify({
      layoutSavedAt: '2020-01-01T00:00:00.000Z',   // 다른 배치의 것
      modules: [{ id: 'lower-0', section: 'lower', W: 600, H: 850, D: 550, x: 0, y: 0, rotation: 0 }],
    });
    const p = boot(seed);
    expect(p.g('modules')).toHaveLength(0);
    expect(p.g('areas').length).toBeGreaterThan(0);
  });

  test('같은 배치를 다시 열면 짜 둔 모듈이 남는다', () => {
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_struct_modules_v1::gold:1'] = JSON.stringify({
      layoutSavedAt: FIXTURES.straight.savedAt,
      modules: [{ id: 'lower-0', section: 'lower', W: 600, H: 850, D: 550, x: 0, y: 0, rotation: 0 }],
    });
    const p = boot(seed);
    expect(p.g('modules')).toHaveLength(1);
  });

  test('예전 배열 형식도 읽는다', () => {
    const seed = seedFor(FIXTURES.straight, { modules: false });
    seed['dadam_struct_modules_v1::gold:1'] = JSON.stringify(
      [{ id: 'lower-0', section: 'lower', W: 600, H: 850, D: 550, x: 0, y: 0, rotation: 0 }]
    );
    const p = boot(seed);
    expect(p.g('modules')).toHaveLength(1);
  });
});

describe('영역에 모듈 넣기', () => {
  function withArea() {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    return { p, area };
  }

  test('추가한 모듈은 W600 · H850 · D550 이다', () => {
    const { p, area } = withArea();
    const m = p.g('addModuleToArea')(area.id);
    expect([m.W, m.H, m.D]).toEqual([600, 850, 550]);
    expect(m.section).toBe('lower');
    expect(m.areaId).toBe(area.id);
  });

  test('선반은 1개다 — 새 상수가 아니라 기존 간격 규칙의 결과', () => {
    const { p, area } = withArea();
    const m = p.g('addModuleToArea')(area.id);
    const s = p.g('getStructure')(m.id);
    expect(s.shelves).toHaveLength(1);
    // 몸통(700) 안에 있어야 한다
    expect(s.shelves[0]).toBeLessThan(p.g('bodyHeightOf')(m, s));
  });

  test('상판은 옵션이라 850 = 다리발 150 + 몸통 700 이 성립한다', () => {
    const { p, area } = withArea();
    const m = p.g('addModuleToArea')(area.id);
    const s = p.g('getStructure')(m.id);
    expect(p.g('legHOf')(m, s)).toBe(150);
    expect(p.g('topTOf')(m, s)).toBe(0);
    expect(p.g('bodyHeightOf')(m, s)).toBe(700);
  });

  test('모듈은 영역 안에서 왼쪽부터 이어 붙는다', () => {
    const { p, area } = withArea();
    const a = p.g('addModuleToArea')(area.id);
    const b = p.g('addModuleToArea')(area.id);
    expect(b.x - a.x).toBe(600);
  });

  test('영역을 넘치면 만들지 않는다 — 폭을 임의로 줄이지 않는다', () => {
    const { p, area } = withArea();
    const fit = Math.floor(area.W / 600);
    for (let i = 0; i < fit; i++) expect(p.g('addModuleToArea')(area.id)).not.toBeNull();
    expect(p.g('addModuleToArea')(area.id)).toBeNull();
    expect(p.g('modules')).toHaveLength(fit);
  });

  test('제거하면 모듈과 구조가 같이 사라진다', () => {
    const { p, area } = withArea();
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    expect(p.g('removeActiveModule')()).toBe(true);
    expect(p.g('modules')).toHaveLength(0);
    expect(p.g('structures')[m.id]).toBeUndefined();
  });
});

describe('영역 도구', () => {
  test('영역을 고르면 추가·제거 버튼이 뜬다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    const tools = p.document.querySelector('.area-tools');
    expect(tools).not.toBeNull();
    expect(tools.querySelector('.at-add')).not.toBeNull();
    expect(tools.querySelector('.at-del')).not.toBeNull();
  });

  test('사용 폭이 표시된다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    p.g('addModuleToArea')(area.id);
    p.g('setActiveArea')(area.id);
    expect(p.document.querySelector('.area-tools .at-room').textContent)
      .toContain(`600 / ${Math.round(area.W)}`);
  });
});

describe('브리지 계약', () => {
  test('모듈이 0개면 payload 도 0개다', () => {
    // 배치만 하고 구조를 짜지 않으면 부모(BOM)에게 넘어가는 모듈이 없다.
    // 예전에는 배치 사각형이 자동으로 모듈이 되어 넘어갔다 — 의도된 변경이다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('buildPlannerPayload')('PLANNER_STATE').modules).toHaveLength(0);
  });

  test('모듈이 있으면 예전과 같은 형태로 실린다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(payload.modules).toHaveLength(modulesFromFixture(FIXTURES.straight).length);
    expect(payload.modules[0]).toHaveProperty('section');
    expect(payload.modules[0]).toHaveProperty('W');
  });
});
