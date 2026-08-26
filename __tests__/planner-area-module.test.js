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
    const fn = src.slice(src.indexOf('function addCarcassShell'));
    const body = fn.slice(0, 1400);
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
    const at = src.slice(src.indexOf(".at-add').onclick"));
    expect(at.slice(0, 600)).not.toMatch(/fitCameraToAreas\(\)/);
  });
});
