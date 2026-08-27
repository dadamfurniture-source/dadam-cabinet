/**
 * 마감재 엔진 (EP · 몰딩 · 휠라).
 *
 * W12-21 부터 입구는 **배치 팔레트 하나**다 (setAreaFinish → setModuleFinish).
 * 모듈 팔레트의 마감 옵션과 일괄 적용은 없앴다 — 마감재는 배치 공간 양 끝에
 * 한 장씩 서는 것이 맞고, 모듈마다 붙이면 사이에 두 장이 맞닿는다.
 * 아래는 그 엔진(setModuleFinish)이 폭을 정확히 주고받는지 본다.
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

  test('EP(공간 20mm)는 같은 모듈에 들어간다', () => {
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

describe('EP — 부재 18T · 공간 20mm (W12-19)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\r\n').join('\n');

  test('ep.h 는 부재 18T, spaceW 는 공간 20mm', () => {
    const src = read('js/planner/planner-sections.js');
    const row = src.match(/ep:\s*\{[^}]*\}/)[0];
    expect(Number(row.match(/h:\s*(\d+)/)[1])).toBe(18);
    expect(Number(row.match(/spaceW:\s*(\d+)/)[1])).toBe(20);
  });

  test('잡는 폭은 20 — 모듈이 그만큼 준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishingWidthOf')('ep')).toBe(20);
  });

  test('부재 폭은 18 — 판은 그만큼만 선다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishingPartWidthOf')('ep')).toBe(18);
  });

  test('여유 2mm 가 남는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishingWidthOf')('ep') - p.g('finishingPartWidthOf')('ep')).toBe(2);
  });

  test('몰딩·휠라는 둘이 같다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    ['molding', 'filler'].forEach((k) => {
      expect(p.g('finishingWidthOf')(k)).toBe(60);
      expect(p.g('finishingPartWidthOf')(k)).toBe(60);
    });
  });

  test('3D·정면도는 부재 폭으로 그린다', () => {
    const src = read('mockup-structure.html');
    expect((src.match(/finishingPartWidthOf\(m\.section\)/g) || []).length).toBe(2);
  });

  test('선택지에 둘 다 적힌다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishLabel')('ep')).toBe('EP 20mm · 부재 18T');
    expect(p.g('finishLabel')('molding')).toBe('몰딩 60mm');
  });

  test('design_rules·door.md 의 20mm 가 공간값임을 주석이 밝힌다', () => {
    const sec = read('js/planner/planner-sections.js');
    expect(sec).toContain('실제 설치 여유');
    expect(sec).toMatch(/design_rules 'EP기본값' 20mm/);
  });

  test('몰딩·휠라는 60 그대로다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishingWidthOf')('molding')).toBe(60);
    expect(p.g('finishingWidthOf')('filler')).toBe(60);
  });
});

describe('마감재는 판 한 장으로 그린다 (W12-13)', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('buildFinishingMesh 마커가 살아 있다', () => {
    expect(SRC.indexOf('function buildFinishingMesh')).toBeGreaterThan(-1);
  });

  test('판 하나만 만든다 — 측판·도어·다리발이 없다', () => {
    const fn = SRC.slice(SRC.indexOf('function buildFinishingMesh'),
      SRC.indexOf('function renderModule3D'));
    expect((fn.match(/makeBox\(/g) || [])).toHaveLength(1);
    ['addCarcassShell', 'addCellDividers', 'addFrontPanel', 'addLegs', 'addTopPanel']
      .forEach((f) => expect(fn).not.toContain(f));
  });

  test('H·D 는 그대로, 폭만 부재 기준 (W12-19)', () => {
    const fn = SRC.slice(SRC.indexOf('function buildFinishingMesh'),
      SRC.indexOf('function renderModule3D'));
    expect(fn).toMatch(/makeBox\(partW, m\.H, m\.D,/);
    expect(fn).toContain('finishingPartWidthOf(m.section)');
    // 잡아 둔 폭보다 넓게 그리면 옆 모듈을 파고든다
    expect(fn).toContain('Math.min(m.W,');
  });

  test('3D 두 경로 모두 캐비넷 경로를 타기 전에 갈라진다', () => {
    ['function renderModule3D', 'function createModuleMesh'].forEach((marker) => {
      const from = SRC.indexOf(marker);
      expect(from).toBeGreaterThan(-1);
      const head = SRC.slice(from, from + 1400);
      const branch = head.indexOf('isFinishingSection(m.section)');
      const carcass = head.indexOf('addCarcassShell');
      expect(branch).toBeGreaterThan(-1);
      if (carcass > -1) expect(branch).toBeLessThan(carcass);
    });
  });

  test('2D 정면도도 칸·도어를 그리지 않는다', () => {
    const from = SRC.indexOf('function renderModuleFront');
    const head = SRC.slice(from, from + 4000);
    const branch = head.indexOf('isFinishingSection(m.section)');
    const split = head.indexOf('horizontalLayout');   // 상하 분할 시작점
    expect(branch).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(split);               // 분기가 먼저여야 칸이 안 그려진다
  });

  test('마감재도 클릭해 고를 수 있다', () => {
    const from = SRC.indexOf('function renderModuleFront');
    const head = SRC.slice(from, from + 1200);
    expect(head).toContain("panel.setAttribute('data-module-id', m.id)");
    expect(head).toContain('setActiveModule(m.id)');
  });
});

describe('마감재는 배치 공간(영역) 치수로 선다 (W12-18)', () => {
  test('EP 는 영역 H × 영역 D × 18T', () => {
    // 냉장고장 영역 H2300 · D700 이면 EP 는 2300 × 700 × 18T 여야 한다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    area.H = 2300; area.D = 700;
    const m = p.g('addModuleToArea')(area.id, { section: area.section, W: 900, x: area.x || 0 });
    const f = p.g('setModuleFinish')(m.id, 'right', 'ep');
    expect(f.H).toBe(2300);
    expect(f.D).toBe(700);
    expect(f.W).toBe(20);          // 잡는 폭 (부재 18T + 여유 2)
  });

  test('스택 한 단짜리 모듈에 붙여도 영역 전체 높이로 선다', () => {
    // 호스트 모듈 치수를 쓰면 상부장 단(400) 만큼만 서서 반토막이 난다.
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    area.H = 2300; area.D = 700;
    const m = p.g('addModuleToArea')(area.id, { section: area.section, W: 900, x: area.x || 0 });
    m.H = 400; m.D = 550;          // 스택의 한 단처럼
    const f = p.g('setModuleFinish')(m.id, 'left', 'molding');
    expect(f.H).toBe(2300);
    expect(f.D).toBe(700);
    expect(f.H).not.toBe(m.H);
  });

  test('영역 마감재도 같은 기준이다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    area.H = 2300; area.D = 700;
    const f = p.g('addFinishingToArea')(area.id, 'ep');
    expect(f.H).toBe(2300);
    expect(f.D).toBe(700);
  });

  test('소스가 영역을 먼저 본다', () => {
    const fs2 = require('fs');
    const path2 = require('path');
    const SRC = fs2.readFileSync(path2.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    const fn = SRC.slice(SRC.indexOf('function setModuleFinish'), SRC.indexOf('function autoCalcArea'));
    expect(fn).toContain('(area && area.H) || m.H');
    expect(fn).toContain('(area && area.D) || m.D');
  });
});

describe('모듈 팔레트에서 마감이 사라졌다 (W12-21)', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const SRC = fs2.readFileSync(path2.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('MODULE_OPTIONS 에 finish 가 없다', () => {
    const arr = SRC.slice(SRC.indexOf('const MODULE_OPTIONS'), SRC.indexOf('function heightNote'));
    expect(arr).not.toContain("key: 'finish'");
  });

  test('.mp-fin / .mp-fin-all 이 없다 — 바인딩도 CSS도', () => {
    expect(SRC).not.toContain('mp-fin');
  });

  test('applyFinishToArea 를 부르는 곳이 없다', () => {
    const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('applyFinishToArea');
  });

  test('엔진은 남아 있다 — 배치 팔레트가 쓴다', () => {
    expect(SRC).toContain('function setModuleFinish(hostId, side, section)');
    expect(SRC).toContain('function setAreaFinish');
    expect(SRC).toContain('function moduleFinishOn');
  });

  test('배치 팔레트에는 마감이 있다', () => {
    const arr = SRC.slice(SRC.indexOf('const AREA_OPTIONS'), SRC.indexOf('function areaPartBody'));
    expect(arr).toContain("key: 'finish'");
  });
});
