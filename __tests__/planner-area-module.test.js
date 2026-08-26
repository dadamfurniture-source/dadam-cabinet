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

  // ── Q4: 남은 폭이 기본 폭보다 좁을 때 ────────────────────────
  describe('Q4 — 자투리 폭', () => {
    test('남은 폭이 좁으면 그 폭에 맞춰 넣는다', () => {
      const { p, area } = withArea();          // 하부장 영역 1200
      const add = p.g('addModuleToArea');
      const a = add(area.id);                  // 600
      const b = add(area.id);                  // 600 → 딱 채움
      expect([a.W, b.W]).toEqual([600, 600]);
      expect(a.W + b.W).toBe(area.W);
    });

    test('600 이 안 들어가면 남은 폭으로 만든다', () => {
      const p = boot(seedFor(FIXTURES.straight, { modules: false }));
      // 1000짜리 하부장 영역 — 600 하나 넣으면 400 이 남는다
      const area = p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === 1000);
      expect(area).toBeDefined();
      const add = p.g('addModuleToArea');
      expect(add(area.id).W).toBe(600);
      expect(add(area.id).W).toBe(400);        // 자투리를 채운다
      expect(add(area.id)).toBeNull();         // 더는 자리가 없다
    });

    test('도어 최소 폭(350)보다 좁으면 만들지 않는다', () => {
      const p = boot(seedFor(FIXTURES.straight, { modules: false }));
      const area = p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === 1400);
      const add = p.g('addModuleToArea');
      add(area.id); add(area.id);              // 600 + 600 = 1200, 200 남음
      // 200 < 350 (MASTER_RULES.DOOR_W_MIN) — 도어를 못 넣는 조각은 만들지 않는다
      expect(add(area.id)).toBeNull();
      expect(p.g('modules').filter((m) => m.areaId === area.id)).toHaveLength(2);
    });
  });

  // ── Q5: 다른 섹션 모듈 ──────────────────────────────────────
  describe('Q5 — 영역에 넣을 수 있는 섹션', () => {
    test('바닥 기준 영역에는 바닥 기준 섹션만 고를 수 있다', () => {
      const p = boot(seedFor(FIXTURES.straight, { modules: false }));
      const lower = p.g('areas').find((a) => a.section === 'lower');
      const opts = p.g('sectionsFor')(lower);
      expect(opts).toContain('lower');
      expect(opts).toContain('sink');          // 하부장 라인에 개수대가 낀다
      expect(opts).toContain('dishwasher');
      expect(opts).not.toContain('upper');     // 천장 매달림은 Y 가 어긋난다
      expect(opts).not.toContain('hood');
      expect(opts[0]).toBe('lower');           // 영역 자기 섹션이 기본
    });

    test('마감재와 붙박이장은 목록에 없다', () => {
      const p = boot(seedFor(FIXTURES.straight, { modules: false }));
      const opts = p.g('sectionsFor')(p.g('areas').find((a) => a.section === 'lower'));
      // 마감재는 모듈이 아니라 부속이다 — loadAreas 가 영역에서 빼는 것과 같은 규칙
      ['ep', 'molding', 'filler'].forEach((k) => expect(opts).not.toContain(k));
      // 붙박이장은 배치 폭 정본이 없다 (planner-sections.js, 확장은 P11)
      expect(opts).not.toContain('wardrobe');
    });

    test('천장 매달림 영역에는 매달림 섹션만', () => {
      const p = boot(seedFor(FIXTURES.straight, { modules: false }));
      const upper = p.g('areas').find((a) => a.section === 'upper');
      const opts = p.g('sectionsFor')(upper);
      expect(opts).toContain('upper');
      expect(opts).toContain('hood');
      expect(opts).not.toContain('lower');
    });

    test('하부장 영역에 개수대를 넣을 수 있다', () => {
      const { p, area } = withArea();
      const m = p.g('addModuleToArea')(area.id, { section: 'sink' });
      expect(m).not.toBeNull();
      expect(m.section).toBe('sink');
      expect(m.id.startsWith('sink-')).toBe(true);
    });

    test('무리가 다른 섹션은 거부한다', () => {
      const { p, area } = withArea();
      expect(p.g('addModuleToArea')(area.id, { section: 'upper' })).toBeNull();
      expect(p.g('modules')).toHaveLength(0);
    });

    test('다른 섹션은 그 섹션의 기본 치수를 쓴다', () => {
      const { p, area } = withArea();
      const m = p.g('addModuleToArea')(area.id, { section: 'sink' });
      const cfg = p.g('SECTION_CONFIG').sink;
      expect(m.H).toBe(cfg.moduleH);
      expect(m.D).toBe(cfg.h);
    });

    test('손잡이·다리발은 모듈의 섹션을 따른다 (영역이 아니라)', () => {
      const { p, area } = withArea();
      const m = p.g('addModuleToArea')(area.id, { section: 'sink' });
      const s = p.g('getStructure')(m.id);
      expect(s.handlePosition).toBe('middle');   // 하부장이면 'top' 이었을 것
      expect(s.legH).toBe(0);                    // 다리발은 하부장만
    });
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

describe('버튼을 눌러도 플래너가 초기화되지 않는다', () => {
  // 도어 on/off 를 누르면 3D 에 모듈 하나만 남고 영역이 사라졌다.
  // renderFrontView 래퍼가 단일 모드에서 renderModule3D(활성 모듈) 를 부르는데,
  // 영역 보기에서는 그게 나머지를 다 지우는 셈이었다.
  // 2D 와 3D 가 같은 답(isAreaView)을 쓰게 해서 막는다.
  function withTwoModules() {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower' && a.W >= 1200);
    p.g('setActiveArea')(area.id);
    p.g('addModuleToArea')(area.id);
    p.g('addModuleToArea')(area.id);
    return p;
  }

  test('영역 보기 판정을 2D 와 3D 가 함께 쓴다', () => {
    const p = withTwoModules();
    expect(p.g('isAreaView')()).toBe(true);       // 영역을 고른 상태
    p.g('setActiveArea')(null);
    expect(p.g('isAreaView')()).toBe(false);      // 모듈 상세로 빠진다
  });

  test('모듈이 없으면 언제나 영역 보기다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('isAreaView')()).toBe(true);
  });

  test('도어 토글이 모듈이나 영역을 지우지 않는다', () => {
    const p = withTwoModules();
    p.g('renderFrontView')();          // 기준 상태를 먼저 그린다
    const before = {
      modules: p.g('modules').length,
      areas: p.g('areas').length,
      rects: p.document.querySelectorAll('#contentG [data-module-id]').length,
    };
    p.document.getElementById('doorToggleBtn').onclick();
    p.document.getElementById('doorToggleBtn').onclick();
    expect(p.g('modules')).toHaveLength(before.modules);
    expect(p.g('areas')).toHaveLength(before.areas);
    expect(p.document.querySelectorAll('#contentG [data-module-id]')).toHaveLength(before.rects);
    expect(p.document.querySelectorAll('#contentG [data-area-id]')).toHaveLength(before.areas);
  });

  test('renderFrontView 를 여러 번 불러도 상태가 유지된다', () => {
    // 버튼 대부분이 결국 이걸 부른다 — 여기가 안전하면 나머지도 안전하다.
    const p = withTwoModules();
    const n = p.g('modules').length;
    for (let i = 0; i < 5; i++) p.g('renderFrontView')();
    expect(p.g('modules')).toHaveLength(n);
    expect(p.document.querySelectorAll('#contentG [data-module-id]')).toHaveLength(n);
    expect(p.document.querySelectorAll('#contentG [data-area-id]')).toHaveLength(p.g('areas').length);
  });

  test('모듈을 고르면 영역 보기에서도 이웃 모듈이 남는다', () => {
    const p = withTwoModules();
    const [a, b] = p.g('modules');
    p.g('setActiveModule')(a.id);
    expect(p.document.querySelectorAll('#contentG [data-module-id]')).toHaveLength(2);
    p.g('setActiveModule')(b.id);
    expect(p.document.querySelectorAll('#contentG [data-module-id]')).toHaveLength(2);
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

describe('도어 갯수를 늘려도 수납장은 하나다', () => {
  // 예전엔 셀마다 뒤판·측판2·지판·천판을 만들어(W9-87 "도어 개수 = 독립 캐비넷 개수")
  // 도어를 2장으로 늘리면 수납장이 2개로 보였다. 몸통 껍데기는 한 벌이어야 하고,
  // 셀 경계에는 칸막이 한 장만 선다.
  //
  // 3D 는 three.js 가 필요해 jsdom 에서 못 돌린다 → 소스에서 "무엇을 근거로
  // 만드는가" 를 확인한다 (carcassH 가드와 같은 방식).
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('몸통 껍데기는 셀 루프 밖에서 한 번만 만든다', () => {
    // addCarcassShell 은 정의 1 + 두 3D 경로 호출 2 = 3회 등장
    expect((src.match(/addCarcassShell\(/g) || [])).toHaveLength(3);
    expect((src.match(/addCellDividers\(/g) || [])).toHaveLength(3);
  });

  test('셀 루프 안에서 측판·뒤판을 만들지 않는다', () => {
    // side: 'left'/'right'/'back'/'bottom'/'top' 을 cellIdx 와 함께 붙이면
    // 셀마다 몸통을 만들고 있다는 뜻이다.
    const bad = src.match(/side:\s*'(left|right|back|bottom|top)'\s*,\s*cellIdx/g) || [];
    expect(bad).toEqual([]);
  });

  test('칸막이는 안쪽 경계에만 선다', () => {
    // 마지막 경계는 우측판이 맡는다 — 그 가드가 없으면 우측판과 겹친다.
    const fn = src.slice(src.indexOf('function addCellDividers'));
    expect(fn.slice(0, 700)).toMatch(/cellWidths\.length\s*-\s*1/);
  });

  test('몸통 껍데기가 다섯 면을 모두 만든다', () => {
    // 예전엔 앞에서 1400자만 잘라 봤다. W12-5 로 함수가 길어지자 마지막 판재가
    // 잘려 나가 실패했다 — 길이가 아니라 **다음 함수까지**를 본문으로 삼는다.
    const from = src.indexOf('function addCarcassShell');
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('function addWoodChannel', from));
    expect(body.length).toBeGreaterThan(200);
    ['back', 'left', 'right', 'bottom', 'top'].forEach((side) => {
      expect(body).toContain(`'${side}'`);
    });
  });
});

describe('열 때는 언제나 영역 보기다', () => {
  // 새로고침했더니 계획(영역)이 사라지고 모듈 하나만 확대돼 있으면
  // 지금 어디를 보고 있는지 알 수 없다. 상세는 좌측 목록으로 들어간다.
  test('모듈이 있어도 영역이 그려진다', () => {
    const seed = seedFor(FIXTURES.straight);          // 모듈이 실린 상태
    const p = boot(seed);
    p.g('setActiveArea')(p.g('areas')[0].id);
    p.g('renderFrontView')();
    expect(p.g('isAreaView')()).toBe(true);
    expect(p.document.querySelectorAll('#contentG [data-area-id]').length)
      .toBe(p.g('areas').length);
  });

  test('좌측 목록으로 고르면 상세로 빠진다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    expect(p.g('isAreaView')()).toBe(true);
    p.g('setActiveArea')(null);                        // 목록 클릭이 하는 일
    expect(p.g('isAreaView')()).toBe(false);
  });
});

describe('클릭해도 화면이 초기화되지 않는다', () => {
  // renderAll3D 는 끝에서 카메라를 다시 맞추고 controls.target 을 리셋한다.
  // 원래는 '전체' 모드 진입에서만 불렸는데, 영역 보기를 만들며 거의 모든
  // 상호작용에 물리면서 클릭마다 화면이 초기화됐다.
  // 화면 맞추기는 "무엇을 보여줄지가 바뀌는 순간" 에만 할 일이다.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('renderAll3D 의 카메라 맞추기는 요청했을 때만 돈다', () => {
    const fn = src.slice(src.indexOf('function renderAll3D'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    expect(body).toMatch(/opts\.fit\s*!==\s*false/);
  });

  test('상호작용 경로는 fit:false 로 부른다', () => {
    // 초기 진입(fit:true) 하나만 예외다.
    const calls = src.match(/renderAll3D\(\{[^}]*\}\)/g) || [];
    expect(calls.length).toBeGreaterThan(4);
    expect(calls.filter((c) => c.includes('fit: true'))).toHaveLength(1);
  });

  test('영역은 다른 영역으로 옮길 때만 다시 맞춘다', () => {
    const fn = src.slice(src.indexOf('function setActiveArea'));
    const body = fn.slice(0, 900);
    expect(body).toMatch(/id\s*!==\s*activeAreaId/);   // 바뀐 경우만
    expect(body).toMatch(/if \(moved\)/);
  });

  test('모듈을 추가해도 화면을 다시 맞추지 않는다', () => {
    // 모듈은 지금 보고 있는 영역 안에 들어가므로 맞출 이유가 없다.
    const at = src.slice(src.indexOf("on('.at-add'"));
    expect(at.slice(0, 600)).not.toMatch(/fitCameraToAreas\(\)/);
  });
});

describe('영역 자동계산', () => {
  // 규칙은 새로 만들지 않는다 — distributeModules 가 이미 도어 폭 350~600,
  // 목표 450, 잔여 ≤10 을 지키며 양문 페어링까지 한다 (autocalc-rules.md §2).
  const engine = require('../js/planner/planner-engine');

  function areaOf(p, w) {
    return p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === w);
  }

  test('영역 도구에 자동계산 버튼이 있다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('setActiveArea')(p.g('areas')[0].id);
    expect(p.document.querySelector('.area-tools .at-auto')).not.toBeNull();
  });

  test('영역 폭을 자동계산 규칙대로 나눈다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1200);
    expect(area).toBeDefined();
    const n = p.g('autoCalcArea')(area.id);

    const want = engine.distributeModules(area.W);
    expect(n).toBe(want.modules.length);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    expect(made.map((m) => m.W)).toEqual(want.modules.map((d) => d.w));
  });

  test('영역을 빈틈없이 채운다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1200);
    p.g('autoCalcArea')(area.id);
    const sum = p.g('modules').filter((m) => m.areaId === area.id)
      .reduce((s, m) => s + m.W, 0);
    expect(sum).toBe(area.W);
  });

  test('양문 모듈은 방향 대신 both 를 갖는다', () => {
    // #471 규칙 — 양문은 방향 개념이 없다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1200);
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    const want = engine.distributeModules(area.W);
    made.forEach((m, i) => {
      const s = p.g('getStructure')(m.id);
      expect(s.areaIs2D).toEqual([!!want.modules[i].is2D]);
      expect(s.areaDirections).toEqual([want.modules[i].is2D ? 'both' : 'left']);
    });
  });

  test('고정 모듈은 건드리지 않는다', () => {
    // autoCalcForSet 이 isFixed 를 보존하는 것과 같은 규칙.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1400);
    const keep = p.g('addModuleToArea')(area.id);
    keep.isFixed = true;
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    expect(made.some((m) => m.id === keep.id)).toBe(true);
    // 고정 폭을 뺀 나머지만 다시 배치한다
    const rest = made.filter((m) => m.id !== keep.id).reduce((s, m) => s + m.W, 0);
    expect(rest).toBe(area.W - keep.W);
  });

  test('다시 돌려도 모듈이 쌓이지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1200);
    const n1 = p.g('autoCalcArea')(area.id);
    const n2 = p.g('autoCalcArea')(area.id);
    expect(n2).toBe(n1);
    expect(p.g('modules').filter((m) => m.areaId === area.id)).toHaveLength(n1);
  });

  test('자리가 없으면 만들지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = areaOf(p, 1200);
    p.g('autoCalcArea')(area.id);
    p.g('modules').forEach((m) => { if (m.areaId === area.id) m.isFixed = true; });
    expect(p.g('autoCalcArea')(area.id)).toBe(0);
  });
});

describe('키큰장·냉장고장 자동계산 — 세로 스택', () => {
  // 높이 계산은 js/detaildesign/ui-fridge-el.js 가 정본이고 그대로 따른다.
  //   상부장 = min(FRIDGE_UPPER_H_MAX, 전체 − 냉장고 − 상단간격 − 상몰딩)
  //   몸통   = 전체 − 상몰딩 − 상부장 − 좌대
  //   중간장 = floor(몸통 × 0.55)      하부장 = 몸통 − 중간장
  const engine = require('../js/planner/planner-engine');

  function bootL() { return boot(seedFor(FIXTURES.lShape, { modules: false })); }

  test('키큰장은 하부·중간·상부 셋으로 쌓인다', () => {
    const p = bootL();
    const area = p.g('areas').find((a) => a.section === 'tall');
    expect(area).toBeDefined();
    const n = p.g('autoCalcArea')(area.id);
    expect(n).toBe(3);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    expect(made.map((m) => m.part)).toEqual(['하부장', '중간장', '상부장']);
  });

  test('키큰장 높이 합이 영역 높이와 맞는다', () => {
    const p = bootL();
    const area = p.g('areas').find((a) => a.section === 'tall');
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    const probe = { section: 'tall', H: area.H };
    const molding = p.g('heightPartOf')(probe, {}, 'moldingH');
    const pedestal = p.g('heightPartOf')(probe, {}, 'pedestalH');
    const sum = made.reduce((s, m) => s + m.H, 0);
    // 좌대는 맨 아래 단이, 상몰딩은 맨 위 단이 품는다 — 그래야 단이 서로 붙는다.
    expect(sum).toBe(area.H);
    expect(pedestal).toBeGreaterThan(0);
    expect(made[2].H).toBe(engine.MASTER_RULES.FRIDGE_UPPER_H_MAX + molding);
  });

  test('키큰장은 아래에서 위로 빈틈없이 쌓인다', () => {
    const p = bootL();
    const area = p.g('areas').find((a) => a.section === 'tall');
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    for (let i = 1; i < made.length; i++) {
      expect(made[i].baseY).toBe(made[i - 1].baseY + made[i - 1].H);
    }
    expect(p.g('baseYOf')(made[0])).toBe(made[0].baseY);   // 섹션 기본을 덮는다
  });

  test('중간장이 몸통의 55% 다', () => {
    const p = bootL();
    const area = p.g('areas').find((a) => a.section === 'tall');
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    const pedestal = p.g('heightPartOf')({ section: 'tall', H: area.H }, {}, 'pedestalH');
    const body = (made[0].H - pedestal) + made[1].H;   // 하부장은 좌대를 품고 있다
    expect(made[1].H).toBe(Math.floor(body * engine.MASTER_RULES.MIDDLE_BODY_RATIO));
  });

  test('냉장고장은 상부장 하나만 만들고 냉장고 자리를 비운다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    // straight 픽스처엔 냉장고장이 없다 — 영역을 하나 만들어 확인한다
    p.g('areas').push({ id:'area-fridge-x', section:'fridge', W:900, H:2300, D:700, x:0, y:0, rotation:0 });
    const n = p.g('autoCalcArea')('area-fridge-x');
    expect(n).toBe(1);
    const made = p.g('modules').filter((m) => m.areaId === 'area-fridge-x');
    expect(made[0].part).toBe('상부장');

    const fridgeH = p.g('SECTION_CONFIG').refrigerator.moduleH;
    // 냉장고 위 + 상단 간격부터 시작한다 — 그 아래는 비워 둔다
    expect(made[0].baseY).toBe(fridgeH + engine.MASTER_RULES.FRIDGE_TOP_GAP);
    const molding = p.g('heightPartOf')({ section:'fridge', H:2300 }, {}, 'moldingH');
    // 상몰딩은 이 단이 품는다 — 그래야 몰딩 mesh 가 그려진다.
    expect(made[0].H).toBe(Math.min(engine.MASTER_RULES.FRIDGE_UPPER_H_MAX,
      2300 - fridgeH - engine.MASTER_RULES.FRIDGE_TOP_GAP - molding) + molding);
  });

  test('상부장이 상몰딩을 침범하지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('areas').push({ id:'area-fridge-y', section:'fridge', W:900, H:2300, D:700, x:0, y:0, rotation:0 });
    p.g('autoCalcArea')('area-fridge-y');
    const m = p.g('modules').find((x) => x.areaId === 'area-fridge-y');
    const st = p.g('getStructure')(m.id);
    const molding = p.g('heightPartOf')({ section:'fridge', H:2300 }, {}, 'moldingH');
    // 몸통 상단이 상몰딩 아래여야 한다 (m.H 는 몰딩을 품은 값이다)
    const top = m.baseY + p.g('baseOffsetOf')(m, st) + p.g('bodyHeightOf')(m, st);
    expect(top).toBeLessThanOrEqual(2300 - molding);
  });

  test('하부장 영역은 여전히 가로로 나눈다', () => {
    // 스택은 키큰장·냉장고장만이다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === 1200);
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    expect(made.every((m) => m.part === undefined)).toBe(true);
    expect(made.reduce((s, m) => s + m.W, 0)).toBe(area.W);
  });
});

describe('기본 냉장고 높이', () => {
  const sections = require('../js/planner/planner-sections');
  const engine = require('../js/planner/planner-engine');

  test('기본 냉장고 모델 높이는 1870 이다', () => {
    expect(sections.PLANNER_SECTIONS.refrigerator.moduleH).toBe(1870);
  });

  test('냉장고장 상부장이 그 높이를 기준으로 잡힌다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('areas').push({ id:'area-fridge-h', section:'fridge', W:900, H:2300, D:700, x:0, y:0, rotation:0 });
    p.g('autoCalcArea')('area-fridge-h');
    const m = p.g('modules').find((x) => x.areaId === 'area-fridge-h');
    const fH = sections.PLANNER_SECTIONS.refrigerator.moduleH;
    expect(m.baseY).toBe(fH + engine.MASTER_RULES.FRIDGE_TOP_GAP);
    // 상부장 365 + 상몰딩 50 — 몰딩은 이 단이 품는다
    expect(m.H).toBe(2300 - fH - engine.MASTER_RULES.FRIDGE_TOP_GAP);
  });

  test('샘플 냉장고장 영역은 기본 냉장고가 들어갈 높이다', () => {
    // 영역이 냉장고보다 낮으면 자동계산이 "높이가 모자라" 로 아무것도 못 만든다.
    const p = boot();                                   // 배치 없음 → 샘플 영역
    const area = p.g('areas').find((a) => a.section === 'fridge');
    expect(area.H).toBeGreaterThan(sections.PLANNER_SECTIONS.refrigerator.moduleH
      + engine.MASTER_RULES.FRIDGE_TOP_GAP + engine.MASTER_RULES.CROWN_MOLDING_FRIDGE);
    expect(p.g('autoCalcArea')(area.id)).toBe(1);
  });
});

describe('스택은 서로 붙어 있다', () => {
  // 좌대·상몰딩은 **장 전체**의 것이다. 단마다 또 빼면 그만큼 빈 틈이 생겨
  // 단이 서로 떠 보인다 (실제로 120mm 씩 벌어져 있었다).
  // 맨 아래 단이 좌대를, 맨 위 단이 상몰딩을 짊어진다.
  function stackOf(p, section) {
    const area = p.g('areas').find((a) => a.section === section);
    p.g('autoCalcArea')(area.id);
    const made = p.g('modules').filter((m) => m.areaId === area.id);
    return { area, rows: made.map((m) => {
      const s = p.g('getStructure')(m.id);
      const base = m.baseY + p.g('baseOffsetOf')(m, s);
      return { part: m.part, 하단: base, 상단: base + p.g('bodyHeightOf')(m, s) };
    }) };
  }

  test('키큰장 세 단이 빈틈없이 맞닿는다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const { rows } = stackOf(p, 'tall');
    expect(rows).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].하단).toBe(rows[i - 1].상단);   // 틈도 겹침도 없다
    }
  });

  test('맨 아래는 좌대 위에서 시작하고 맨 위는 상몰딩 밑에서 끝난다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const { area, rows } = stackOf(p, 'tall');
    const probe = { section: 'tall', H: area.H };
    const pedestal = p.g('heightPartOf')(probe, {}, 'pedestalH');
    const molding = p.g('heightPartOf')(probe, {}, 'moldingH');
    expect(rows[0].하단).toBe(pedestal);
    expect(rows[rows.length - 1].상단).toBe(area.H - molding);
  });

  test('좌대와 상몰딩은 한 번씩만 잡힌다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'tall');
    p.g('autoCalcArea')(area.id);
    const parts = p.g('modules').filter((m) => m.areaId === area.id)
      .map((m) => p.g('heightPartsOf')(m, p.g('getStructure')(m.id)));
    const ped = parts.filter((ps) => ps.find((x) => x.key === 'pedestalH').value > 0);
    const mol = parts.filter((ps) => ps.find((x) => x.key === 'moldingH').value > 0);
    expect(ped).toHaveLength(1);
    expect(mol).toHaveLength(1);
  });

  test('모듈 높이 합이 영역 높이와 같다', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'tall');
    p.g('autoCalcArea')(area.id);
    const sum = p.g('modules').filter((m) => m.areaId === area.id)
      .reduce((s, m) => s + m.H, 0);
    expect(sum).toBe(area.H);      // 좌대·상몰딩까지 단이 품는다
  });

  test('냉장고장 상부장도 상몰딩 밑에서 끝난다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('areas').push({ id:'area-fridge-g', section:'fridge', W:900, H:2300, D:700, x:0, y:0, rotation:0 });
    p.g('autoCalcArea')('area-fridge-g');
    const m = p.g('modules').find((x) => x.areaId === 'area-fridge-g');
    const s = p.g('getStructure')(m.id);
    const molding = p.g('heightPartOf')({ section:'fridge', H:2300 }, {}, 'moldingH');
    const top = m.baseY + p.g('baseOffsetOf')(m, s) + p.g('bodyHeightOf')(m, s);
    expect(top).toBe(m.baseY + m.H - molding);
  });
});

describe('마감재 (EP · 몰딩 · 휠라)', () => {
  function withArea(w = 1200) {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === w);
    p.g('setActiveArea')(area.id);
    return { p, area };
  }

  test('배치에 놓은 마감재도 영역으로 보인다', () => {
    // 예전엔 loadAreas 가 걸러 내서 구조 단계에서 아예 사라졌다 — 클릭도 못 했다.
    const fixture = JSON.parse(JSON.stringify(FIXTURES.straight));
    fixture.modules.push({ section: 'ep', x: 3600, y: 0, w: 650, h: 18, moduleH: 870, rotation: 0, finishings: [] });
    const seed = seedFor(fixture, { modules: false });
    const p = boot(seed);
    const ep = p.g('areas').find((a) => a.section === 'ep');
    expect(ep).toBeDefined();
    expect(ep.isFinishing).toBe(true);
  });

  test('마감재 영역에는 모듈 버튼이 없다', () => {
    const fixture = JSON.parse(JSON.stringify(FIXTURES.straight));
    fixture.modules.push({ section: 'ep', x: 3600, y: 0, w: 650, h: 18, moduleH: 870, rotation: 0, finishings: [] });
    const p = boot(seedFor(fixture, { modules: false }));
    p.g('setActiveArea')(p.g('areas').find((a) => a.section === 'ep').id);
    const tools = p.document.querySelector('.area-tools');
    expect(tools.querySelector('.at-add')).toBeNull();
    expect(tools.querySelector('.at-auto')).toBeNull();
    expect(tools.querySelector('.at-note')).not.toBeNull();
  });

  test('폭은 adjacent 정의를 따른다', () => {
    // EP 는 depthAndHeight — w 가 깊이라 런에서 차지하는 건 두께 h(18).
    // 몰딩·휠라는 heightOnly — w(60) 가 곧 폭.
    const { p } = withArea();
    expect(p.g('finishingWidthOf')('ep')).toBe(p.g('SECTION_CONFIG').ep.h);
    expect(p.g('finishingWidthOf')('molding')).toBe(p.g('SECTION_CONFIG').molding.w);
    expect(p.g('finishingWidthOf')('filler')).toBe(p.g('SECTION_CONFIG').filler.w);
  });

  test('영역에 마감재를 넣는다', () => {
    const { p, area } = withArea();
    const m = p.g('addFinishingToArea')(area.id, 'molding');
    expect(m).not.toBeNull();
    expect(m.section).toBe('molding');
    expect(m.W).toBe(p.g('finishingWidthOf')('molding'));
    expect(m.H).toBe(area.H);
    expect(m.areaId).toBe(area.id);
  });

  test('영역 밖으로 튀어나가지 않는다', () => {
    const { p, area } = withArea();
    // 영역을 모듈로 가득 채운다
    p.g('autoCalcArea')(area.id);
    const used = p.g('usedWidthOf')(area.id);
    expect(used).toBe(area.W);
    // 남은 폭 0 — 마감재가 들어갈 자리가 없다
    expect(p.g('addFinishingToArea')(area.id, 'molding')).toBeNull();
    expect(p.g('usedWidthOf')(area.id)).toBe(area.W);   // 넘치지 않았다
  });

  test('남은 폭보다 두꺼우면 만들지 않는다 — 깎아 넣지도 않는다', () => {
    const { p, area } = withArea();
    // 몰딩 60 만 남기고 채운다
    const room = area.W - 60;
    p.g('addModuleToArea')(area.id, { W: room, x: area.x });
    expect(p.g('addFinishingToArea')(area.id, 'molding')).not.toBeNull();   // 딱 맞음
    expect(p.g('addFinishingToArea')(area.id, 'ep')).toBeNull();            // 더는 없음
  });

  test('마감재끼리 이어 붙어도 영역을 넘지 않는다', () => {
    const { p, area } = withArea();
    let n = 0;
    while (p.g('addFinishingToArea')(area.id, 'ep')) n++;
    expect(n).toBeGreaterThan(0);
    expect(p.g('usedWidthOf')(area.id)).toBeLessThanOrEqual(area.W);
  });

  test('마감재 영역에는 마감재를 넣을 수 없다', () => {
    const fixture = JSON.parse(JSON.stringify(FIXTURES.straight));
    fixture.modules.push({ section: 'ep', x: 3600, y: 0, w: 650, h: 18, moduleH: 870, rotation: 0, finishings: [] });
    const p = boot(seedFor(fixture, { modules: false }));
    const ep = p.g('areas').find((a) => a.section === 'ep');
    expect(p.g('addFinishingToArea')(ep.id, 'molding')).toBeNull();
  });

  test('브리지에는 모듈이 아니라 부속으로 실린다', () => {
    // 마감재는 모듈이 아니라 모듈에 붙는 것이다 — 계약을 그대로 지킨다.
    const { p, area } = withArea();
    const mod = p.g('addModuleToArea')(area.id);
    p.g('addFinishingToArea')(area.id, 'molding');
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(payload.modules.some((m) => m.section === 'molding')).toBe(false);
    const host = payload.modules.find((m) => m.id === mod.id);
    expect(host.finishings.some((f) => f.section === 'molding')).toBe(true);
  });

  test('자동계산 섹션 목록에는 마감재가 없다', () => {
    const { p, area } = withArea();
    const opts = p.g('sectionsFor')(area);
    ['ep', 'molding', 'filler'].forEach((k) => expect(opts).not.toContain(k));
  });
});

describe('자동계산이 마감재를 지우지 않는다', () => {
  // 마감재는 자동계산이 만들어 내는 것이 아니라 사람이 놓은 것이다.
  // 고정 모듈과 같이 보존하고, 그 폭을 뺀 나머지만 다시 채운다.
  function withArea() {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').filter((a) => a.section === 'lower').find((a) => a.W === 1200);
    p.g('setActiveArea')(area.id);
    return { p, area };
  }

  test('자동계산 뒤에도 마감재가 남는다', () => {
    const { p, area } = withArea();
    const fin = p.g('addFinishingToArea')(area.id, 'molding');
    p.g('autoCalcArea')(area.id);
    expect(p.g('modules').some((m) => m.id === fin.id)).toBe(true);
  });

  test('마감재 폭을 뺀 나머지만 채운다', () => {
    const { p, area } = withArea();
    const fin = p.g('addFinishingToArea')(area.id, 'molding');
    p.g('autoCalcArea')(area.id);
    const rest = p.g('modules')
      .filter((m) => m.areaId === area.id && m.id !== fin.id)
      .reduce((s, m) => s + m.W, 0);
    expect(rest).toBe(area.W - fin.W);
    expect(p.g('usedWidthOf')(area.id)).toBe(area.W);   // 넘치지도 모자라지도 않는다
  });

  test('자동계산을 두 번 돌려도 마감재가 늘지 않는다', () => {
    const { p, area } = withArea();
    p.g('addFinishingToArea')(area.id, 'ep');
    p.g('autoCalcArea')(area.id);
    p.g('autoCalcArea')(area.id);
    const fins = p.g('modules').filter((m) => m.areaId === area.id && m.section === 'ep');
    expect(fins).toHaveLength(1);
  });

  test('자동계산 뒤에도 브리지에 부속으로 실린다', () => {
    const { p, area } = withArea();
    p.g('addFinishingToArea')(area.id, 'molding');
    p.g('autoCalcArea')(area.id);
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    expect(payload.modules.some((m) => m.section === 'molding')).toBe(false);
    expect(payload.modules.flatMap((m) => m.finishings).some((f) => f.section === 'molding')).toBe(true);
  });

  test('고른 마감재가 다시 그려도 유지된다', () => {
    const { p, area } = withArea();
    const tools = () => p.document.querySelector('.area-tools');
    const sel = tools().querySelector('.at-fintype');
    sel.value = 'molding';
    tools().querySelector('.at-finadd').onclick();
    // 도구가 다시 그려진 뒤에도 몰딩이 골라져 있어야 한다
    expect(tools().querySelector('.at-fintype').value).toBe('molding');
  });
});
