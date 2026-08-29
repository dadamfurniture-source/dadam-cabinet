/**
 * W12-33: 모듈은 배치 공간 **앞선**에 맞춰 앉고, 남는 깊이는 **뒤**에 둔다.
 *
 * 배치 공간 깊이는 몸통 + 도어다 (W12-25). 앞선은 상판·걸레받이가 따라가는
 * 기준선이라 조립체 앞면이 거기 붙어야 하고, 뒤에 남는 자리는 배관이 지난다.
 *
 *   도어 앞면 = m.y + m.D + DOOR_T = area.y + area.D
 *
 * 예전엔 `m.y = area.y` 라 모듈이 뒤에 붙고 **앞이 비었다** — 영역 D700 에
 * 하부장 D550 이면 앞에 132mm 가 떠 있었다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

const DOOR_T = 18;

function boot(seed) {
  const st = Object.assign({}, seed);
  const search = st._search || '?design=fs&item=1';
  delete st._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: st });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 영역 하나에 모듈을 넣고 그 둘을 돌려준다 */
function withModule(opts) {
  const seed = seedFor(FIXTURES.straight, { modules: false });
  const search = seed._search;          // 저장소 범위 — 새로고침 때 같은 것을 써야 한다
  const p = boot(seed);
  const area = p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id, Object.assign(
    { section: 'lower', W: 900, x: area.x || 0 }, opts || {}));
  return { p, area, m, search };
}

const doorFront = (m) => (m.y || 0) + (m.D || 0) + DOOR_T;
const areaFront = (a) => (a.y || 0) + (a.D || 0);

describe('조립체 앞면이 배치 공간 앞선에 붙는다', () => {
  test('모듈을 넣자마자 앞선에 앉는다', () => {
    const { area, m } = withModule();
    expect(doorFront(m)).toBe(areaFront(area));
  });

  test('남는 깊이는 뒤에 있다', () => {
    const { area, m } = withModule();
    const backGap = (m.y || 0) - (area.y || 0);
    expect(backGap).toBe(area.D - DOOR_T - m.D);
    expect(backGap).toBeGreaterThan(0);   // straight 픽스처는 영역이 모듈보다 깊다
  });

  test('영역 앞으로는 아무것도 나가지 않는다', () => {
    const { area, m } = withModule();
    expect(doorFront(m)).toBeLessThanOrEqual(areaFront(area));
  });

  test('모듈이 영역만큼 깊으면 뒤에 붙는다 — 뒤로 밀어내지 않는다', () => {
    const { p, area, m } = withModule();
    // 깊이를 영역과 같게 만들면 앞선에 맞출 여유가 없다.
    m.D = area.D;
    p.g('seatModuleDepth')(m);
    expect(m.y).toBe(area.y || 0);
    // 이때 도어는 areaLimitsFor 가 물려 영역을 지킨다 (W12-24).
    const lim = p.g('areaLimitsFor')(m);
    expect(lim.frontLimit).toBeLessThan(m.D / 2 + DOOR_T);
  });
});

describe('깊이를 고치면 다시 앉는다', () => {
  test('모듈 깊이를 줄이면 뒤 여백이 늘어난다', () => {
    const { p, area, m } = withModule();
    p.g('applyModuleDim')(m, p.g('getStructure')(m.id), 'D', 400);
    p.g('persistPlannerState')();
    expect(m.D).toBe(400);
    expect(doorFront(m)).toBe(areaFront(area));
  });

  test('영역 깊이를 늘리면 모듈이 따라 앞으로 온다', () => {
    const { p, area, m } = withModule();
    area.D = 800;
    p.g('persistPlannerState')();
    expect(doorFront(m)).toBe(areaFront(area));
  });

  test('새로고침을 견딘다', () => {
    const { p, m, search } = withModule();
    p.g('persistPlannerState')();
    const again = boot(Object.assign(p.storage._dump(), { _search: search }));
    const back = again.g('modules').find((x) => x.id === m.id);
    const a2 = again.g('areas').find((x) => x.id === back.areaId);
    expect(doorFront(back)).toBe(areaFront(a2));
  });
});

describe('마감재는 배치 공간 앞뒤로 꽉 찬다', () => {
  test('마감재는 영역 앞선과 뒷선을 모두 쓴다', () => {
    const { p, area } = withModule();
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    const f = p.g('modules').find((x) => x.isFinishing);
    expect(f).toBeTruthy();
    expect(f.y).toBe(area.y || 0);
    expect(f.D).toBe(area.D);
    expect((f.y || 0) + f.D).toBe(areaFront(area));
  });

  test('호스트가 앞으로 가도 마감재는 뒤를 덮는다', () => {
    const { p, area, m } = withModule();
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    const f = p.g('modules').find((x) => x.isFinishing);
    expect(f.y).toBeLessThan(m.y);   // 마감재가 모듈보다 뒤에서 시작한다
  });
});

describe('건드리지 않는 것', () => {
  test('회전 영역은 그대로 둔다', () => {
    // 회전 다리는 규약이 둘 섞여 있다 — addModuleToArea 는 m.x 를 따라 늘어놓는데
    // 배치 단계에서 온 모듈은 m.y 를 런 좌표로 쓴다(실측: 영역 y650·D650 인데
    // 모듈 y2150). 깊이로 보고 옮기면 벽을 따라 1500mm 미끄러진다.
    const p = boot(seedFor(FIXTURES.lShape));
    const rotated = p.g('modules').filter((m) => ((m.rotation || 0) % 360 + 360) % 360 !== 0);
    if (!rotated.length) return;
    const before = rotated.map((m) => m.y);
    p.g('seatAllModuleDepths')();
    expect(rotated.map((m) => m.y)).toEqual(before);
  });

  test('areaId 가 없어도 앞선으로 온다 (W12-34)', () => {
    // 옛 설계의 모듈은 areaId 가 없고 areaOfModule 의 X 겹침 추정으로 영역을
    // 찾는다. 그것도 **모든 모듈**이므로 앞선에 앉는다.
    const p = boot(seedFor(FIXTURES.straight));
    const orphan = p.g('modules').filter((m) => !m.areaId
      && ((m.rotation || 0) % 360 + 360) % 360 === 0
      && p.g('areaOfModule')(m));
    if (!orphan.length) return;
    orphan.forEach((m) => {
      const a = p.g('areaOfModule')(m);
      // 앞으로 갈 수 있는 만큼 간다. 옛 설계에는 몸통이 영역만큼 깊은 것이 있어
      // (addModuleToArea 의 `영역 D − 도어` 규칙 이전) 더 갈 자리가 없다.
      expect(m.y).toBe((a.y || 0) + Math.max(0, a.D - DOOR_T - m.D));
    });
    // 자리가 있는 모듈은 정확히 앞선에 붙는다.
    const roomy = orphan.filter((m) => {
      const a = p.g('areaOfModule')(m);
      return a.D - DOOR_T - m.D > 0;
    });
    expect(roomy.length).toBeGreaterThan(0);
    roomy.forEach((m) => expect(doorFront(m)).toBe(areaFront(p.g('areaOfModule')(m))));
  });

  test('멱등이다 — 두 번 앉혀도 안 움직인다', () => {
    const { p } = withModule();
    p.g('seatAllModuleDepths')();
    expect(p.g('seatAllModuleDepths')()).toBe(0);
  });
});

describe('소스 규약', () => {
  test('저장 전에 반드시 앉힌다', () => {
    const fn = SRC.slice(SRC.indexOf('function persistPlannerState'), SRC.indexOf('function getStructure'));
    expect(fn).toContain('seatAllModuleDepths()');
  });

  test('열 때도 앉힌다 — 옛 설계가 뒤에 붙은 채 열리지 않게', () => {
    const fn = SRC.slice(SRC.indexOf('function loadModules()'), SRC.indexOf('function loadModulesLegacy'));
    expect((fn.match(/seatAllModuleDepths\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('규칙이 한 곳이다', () => {
    const fn = SRC.slice(SRC.indexOf('function seatModuleDepth'), SRC.indexOf('function seatAllModuleDepths'));
    expect(fn).toContain('(area.D || 0) - DOOR_T - (m.D || 0)');
    // 깊이 자리를 직접 대입하는 곳은 이 함수뿐이어야 한다.
    expect(fn).toContain('m.y = y;');
  });
});

describe('우측 패널을 끝까지 내릴 수 있다 (W12-33)', () => {
  const css = SRC.slice(SRC.indexOf('.right-panel{'), SRC.indexOf('.empty-msg{'));

  test('마지막 줄이 바닥에 붙지 않도록 끝에 여백이 있다', () => {
    expect(css).toMatch(/\.sections\{[^}]*padding-bottom:\d+px/);
  });

  test('스크롤 컨테이너가 실제로 줄어들 수 있다', () => {
    expect(css).toMatch(/\.sections\{[^}]*overflow-y:auto/);
    expect(css).toMatch(/\.sections\{[^}]*min-height:0/);
    expect(css).toMatch(/\.right-panel\{[^}]*min-height:0/);
  });

  test('섹션 머리말이 스크롤 중에도 붙어 있다', () => {
    const head = css.slice(css.indexOf('.section-header{'), css.indexOf('.section-header:hover'));
    expect(head).toContain('position:sticky');
    expect(head).toMatch(/top:0/);
  });

  test('스크롤바 자리를 늘 잡아 둔다 — 내용이 좌우로 안 흔들리게', () => {
    expect(css).toMatch(/scrollbar-gutter:stable/);
  });
});
