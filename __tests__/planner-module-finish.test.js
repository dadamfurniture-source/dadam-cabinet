/**
 * W12-11: 모듈 좌·우 마감재 (EP · 몰딩 · 휠라).
 *
 * 핵심 불변식:
 *   영역 폭은 그대로 두고 **모듈이 줄어든다**. 마감재가 가져간 폭을 모듈에서
 *   빼지 않으면 마지막 모듈이 영역 밖으로 나가고, 뗄 때 안 돌려주면 모듈이
 *   조금씩 좁아진다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=fin&item=1';
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 영역 하나에 하부장 모듈 하나를 넣은 상태로 만든다 */
function withModule(p) {
  const areas = p.g('areas');
  expect(areas.length).toBeGreaterThan(0);
  const area = areas[0];
  const m = p.g('addModuleToArea')(area.id, { section: 'lower', W: 900, x: area.x || 0 });
  expect(m).not.toBeNull();
  return { area, m };
}

const sumW = (p, areaId) => p.g('modules')
  .filter((x) => x.areaId === areaId).reduce((s, x) => s + x.W, 0);

describe('마감재를 붙이면 모듈이 그만큼 줄어든다', () => {
  test('우측 EP — 모듈 폭이 EP 폭만큼 준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const W0 = m.W;
    const epW = p.g('finishingWidthOf')('ep');
    const f = p.g('setModuleFinish')(m.id, 'right', 'ep');
    expect(f).not.toBeNull();
    expect(f.section).toBe('ep');
    expect(f.W).toBe(epW);
    expect(m.W).toBe(W0 - epW);
  });

  test('영역 안 총 폭은 변하지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, m } = withModule(p);
    const before = sumW(p, area.id);
    p.g('setModuleFinish')(m.id, 'right', 'molding');
    expect(sumW(p, area.id)).toBe(before);
    p.g('setModuleFinish')(m.id, 'left', 'filler');
    expect(sumW(p, area.id)).toBe(before);
  });

  test('좌측이면 모듈이 오른쪽으로 물러나고 마감재가 그 자리를 쓴다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const x0 = m.x, W0 = m.W;
    const f = p.g('setModuleFinish')(m.id, 'left', 'molding');
    expect(f.x).toBe(x0);              // 마감재가 원래 왼쪽 끝
    expect(m.x).toBe(x0 + f.W);        // 모듈은 그만큼 물러남
    expect(m.W).toBe(W0 - f.W);
    expect(m.x + m.W).toBe(x0 + W0);   // 오른쪽 끝은 그대로
  });

  test('우측이면 모듈 자리는 그대로고 줄어든 끝에 선다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const x0 = m.x, W0 = m.W;
    const f = p.g('setModuleFinish')(m.id, 'right', 'filler');
    expect(m.x).toBe(x0);
    expect(f.x).toBe(x0 + m.W);
    expect(f.x + f.W).toBe(x0 + W0);   // 오른쪽 끝은 그대로
  });

  test('좌·우를 같이 붙일 수 있다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const W0 = m.W;
    const l = p.g('setModuleFinish')(m.id, 'left', 'ep');
    const r = p.g('setModuleFinish')(m.id, 'right', 'molding');
    expect(m.W).toBe(W0 - l.W - r.W);
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(2);
  });
});

describe('떼면 폭을 정확히 돌려준다', () => {
  test('붙였다 떼면 원래 폭·자리로 돌아온다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const x0 = m.x, W0 = m.W;
    p.g('setModuleFinish')(m.id, 'left', 'molding');
    p.g('setModuleFinish')(m.id, 'left', '');
    expect(m.W).toBe(W0);
    expect(m.x).toBe(x0);
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(0);
  });

  test('같은 쪽을 바꿔 달아도 폭이 새지 않는다', () => {
    // 먼저 떼고(폭 복원) 붙이지 않으면 바꿀 때마다 모듈이 좁아진다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const W0 = m.W;
    p.g('setModuleFinish')(m.id, 'right', 'molding');
    p.g('setModuleFinish')(m.id, 'right', 'ep');
    p.g('setModuleFinish')(m.id, 'right', 'filler');
    expect(m.W).toBe(W0 - p.g('finishingWidthOf')('filler'));
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(1);
  });

  test('여러 번 붙였다 떼도 원래대로다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const x0 = m.x, W0 = m.W;
    for (let i = 0; i < 3; i++) {
      p.g('setModuleFinish')(m.id, 'left', 'ep');
      p.g('setModuleFinish')(m.id, 'right', 'molding');
      p.g('setModuleFinish')(m.id, 'left', '');
      p.g('setModuleFinish')(m.id, 'right', '');
    }
    expect(m.W).toBe(W0);
    expect(m.x).toBe(x0);
  });
});

describe('모듈이 너무 좁아지면 막는다', () => {
  test('도어 최소 폭보다 좁아지면 안 붙는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const areas = p.g('areas');
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const m = p.g('addModuleToArea')(areas[0].id, { section: 'lower', W: MIN + 10, x: areas[0].x || 0 });
    const W0 = m.W;
    const f = p.g('setModuleFinish')(m.id, 'right', 'molding');   // 60mm — 들어가면 300
    expect(f).toBeNull();
    expect(m.W).toBe(W0);
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(0);
  });

  test('EP(18mm)는 같은 모듈에 들어간다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const areas = p.g('areas');
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const m = p.g('addModuleToArea')(areas[0].id, { section: 'lower', W: MIN + 60, x: areas[0].x || 0 });
    expect(p.g('setModuleFinish')(m.id, 'right', 'ep')).not.toBeNull();
  });
});

describe('마감재 모듈에는 마감재를 못 붙인다', () => {
  test('isFinishing 모듈은 거른다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    const f = p.g('setModuleFinish')(m.id, 'right', 'ep');
    expect(p.g('setModuleFinish')(f.id, 'right', 'ep')).toBeNull();
  });

  test('없는 쪽 이름은 거른다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    expect(p.g('setModuleFinish')(m.id, 'top', 'ep')).toBeNull();
  });
});

describe('주인이 사라지면 마감재도 정리된다', () => {
  test('모듈을 지우면 붙어 있던 마감재도 사라진다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { m } = withModule(p);
    p.g('setModuleFinish')(m.id, 'left', 'ep');
    p.g('setModuleFinish')(m.id, 'right', 'molding');
    expect(p.g('modules')).toHaveLength(3);
    p.g('setActiveModule')(m.id);
    expect(p.g('removeActiveModule')()).toBe(true);
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(0);
    expect(p.g('modules')).toHaveLength(0);
  });

  test('자동계산은 마감재를 영역 마감재로 승격시킨다', () => {
    // 마감재는 사람이 놓은 것이라 보존한다. 다만 호스트가 사라지므로
    // 연결(hostId)을 끊어 유령이 되지 않게 한다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, m } = withModule(p);
    p.g('setModuleFinish')(m.id, 'right', 'molding');
    const fin = p.g('modules').find((x) => x.isFinishing);
    expect(fin.hostId).toBe(m.id);
    p.g('autoCalcArea')(area.id);
    const after = p.g('modules').find((x) => x.isFinishing);
    expect(after).toBeDefined();
    expect(after.hostId).toBeUndefined();
    expect(after.hostSide).toBeUndefined();
  });
});

describe('팔레트에 마감 옵션이 있다', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test("key 가 'finish' 인 옵션이 있다", () => {
    expect(SRC).toMatch(/\{ key: 'finish', label: '마감'/);
  });

  test('마감재 모듈에는 안 뜬다', () => {
    expect(SRC).toMatch(/key: 'finish'[\s\S]{0,120}when: \(m\) => !m\.isFinishing/);
  });

  test('좌·우 두 줄을 FINISH_SIDES 로 만든다', () => {
    const opt = SRC.slice(SRC.indexOf("{ key: 'finish'"), SRC.indexOf("{ key: 'fixed'"));
    expect(opt).toContain('FINISH_SIDES.map');
    expect(opt).toContain('FINISHING_SECTIONS.map');
    expect(opt).toContain("data-side=");
  });

  test('고르면 setModuleFinish 로 간다', () => {
    expect(SRC).toMatch(/\.mp-fin[\s\S]{0,240}setModuleFinish\(m\.id, sl\.dataset\.side, sl\.value\)/);
  });

  test('도면도 같이 갱신한다', () => {
    // 폭이 바뀌므로 saveLayoutFromModules 를 안 부르면 배치 단계와 어긋난다.
    const bind = SRC.slice(SRC.indexOf(".mp-fin"), SRC.indexOf(".mp-fin") + 320);
    expect(bind).toContain('saveLayoutFromModules()');
  });
});
