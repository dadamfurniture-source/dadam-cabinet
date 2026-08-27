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

  test('EP(18T)는 같은 모듈에 들어간다', () => {
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
    // CSS 에도 `.mp-fin-all` 이 있으므로 JS 바인딩 자리를 정확히 집는다.
    const at = SRC.indexOf("querySelectorAll('.mp-fin')");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 320)).toContain('saveLayoutFromModules()');
  });
});

describe('EP 두께는 측판 18T (W12-18)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\r\n').join('\n');

  test('planner-sections 의 ep.h 가 18 (측판 두께)', () => {
    const m = read('js/planner/planner-sections.js').match(/ep:\s*\{[^}]*h:\s*(\d+)/);
    expect(Number(m[1])).toBe(18);
  });

  test('finishingWidthOf 가 18 을 돌려준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    expect(p.g('finishingWidthOf')('ep')).toBe(18);
  });

  test('폴백도 18 이다', () => {
    expect(read('mockup-structure.html')).toMatch(/cfg\.h \|\| 18/);
  });

  test('door.md 의 20mm 는 다른 모델임을 주석이 밝힌다', () => {
    // 상세설계 FINISH_TYPES 의 '기본 너비 20mm' 는 마감 스트립이고,
    // 플래너 EP 는 측판 한 장이다. 값이 다른 이유가 소스에 남아야 한다.
    const sec = read('js/planner/planner-sections.js');
    expect(sec).toContain('상세설계의 마감 스트립');
    expect(sec).toContain('측판 한 장');
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

  test('모듈 전체 H·D 를 그대로 쓴다 — 옆 모듈에 맞춰 선다', () => {
    const fn = SRC.slice(SRC.indexOf('function buildFinishingMesh'),
      SRC.indexOf('function renderModule3D'));
    expect(fn).toMatch(/makeBox\(m\.W, m\.H, m\.D,/);
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

describe('영역 전체 일괄 적용 (W12-14)', () => {
  /** 영역에 폭 W 모듈을 n개 넣는다 */
  function fill(p, n, W) {
    const area = p.g('areas')[0];
    const out = [];
    let x = area.x || 0;
    for (let i = 0; i < n; i++) {
      const m = p.g('addModuleToArea')(area.id, { section: 'lower', W, x });
      out.push(m); x += W;
    }
    return { area, mods: out };
  }

  test('모든 모듈의 좌·우에 한 번에 건다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 3, 600);
    const W0 = mods.map((m) => m.W);
    const r = p.g('applyFinishToArea')(area.id, { left: 'ep', right: 'molding' });
    expect(r.hosts).toBe(3);
    expect(r.applied).toBe(6);
    expect(r.skipped).toBe(0);
    const ep = p.g('finishingWidthOf')('ep');
    const mo = p.g('finishingWidthOf')('molding');
    mods.forEach((m, i) => expect(m.W).toBe(W0[i] - ep - mo));
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(6);
  });

  test('영역 안 총 폭은 그대로다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area } = fill(p, 3, 600);
    const before = sumW(p, area.id);
    p.g('applyFinishToArea')(area.id, { left: 'ep', right: 'molding' });
    expect(sumW(p, area.id)).toBe(before);
  });

  test('한쪽만 걸 수도 있다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 2, 600);
    const W0 = mods[0].W;
    const r = p.g('applyFinishToArea')(area.id, { right: 'filler' });
    expect(r.applied).toBe(2);
    expect(mods[0].W).toBe(W0 - p.g('finishingWidthOf')('filler'));
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(2);
  });

  test("''(없음)이면 그 쪽을 모두 뗀다", () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 3, 600);
    const W0 = mods.map((m) => m.W);
    p.g('applyFinishToArea')(area.id, { left: 'ep', right: 'molding' });
    const r = p.g('applyFinishToArea')(area.id, { left: '', right: '' });
    expect(r.removed).toBe(6);
    mods.forEach((m, i) => expect(m.W).toBe(W0[i]));
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(0);
  });

  test('폭이 모자란 모듈은 건너뛰고 세어 준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    const wide = p.g('addModuleToArea')(area.id, { section: 'lower', W: 600, x: area.x || 0 });
    const narrow = p.g('addModuleToArea')(area.id, { section: 'lower', W: MIN + 10, x: (area.x || 0) + 600 });
    const nW = narrow.W;
    const r = p.g('applyFinishToArea')(area.id, { left: 'molding' });
    expect(r.hosts).toBe(2);
    expect(r.applied).toBe(1);
    expect(r.skipped).toBe(1);
    expect(narrow.W).toBe(nW);              // 좁은 모듈은 그대로
    expect(wide.W).toBeLessThan(600);
  });

  test('마감재 모듈 자신에는 걸지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 2, 600);
    p.g('setModuleFinish')(mods[0].id, 'left', 'ep');
    const r = p.g('applyFinishToArea')(area.id, { right: 'molding' });
    expect(r.hosts).toBe(2);                // 마감재는 host 로 안 센다
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(3);
  });

  test('두 번 걸어도 폭이 새지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 3, 600);
    p.g('applyFinishToArea')(area.id, { left: 'ep', right: 'molding' });
    const afterFirst = mods.map((m) => m.W);
    p.g('applyFinishToArea')(area.id, { left: 'ep', right: 'molding' });
    mods.forEach((m, i) => expect(m.W).toBe(afterFirst[i]));
    expect(p.g('modules').filter((x) => x.isFinishing)).toHaveLength(6);
  });

  test('다른 영역은 건드리지 않는다', () => {
    const p = boot(seedFor(FIXTURES.lshape, { modules: false }));
    const areas = p.g('areas');
    if (areas.length < 2) return;   // ㄱ자 픽스처가 아니면 건너뛴다
    const a0 = areas[0], a1 = areas[1];
    p.g('addModuleToArea')(a0.id, { section: a0.section, W: 600, x: a0.x || 0 });
    const other = p.g('addModuleToArea')(a1.id, { section: a1.section, W: 600, x: a1.x || 0 });
    const w1 = other.W;
    p.g('applyFinishToArea')(a0.id, { left: 'ep' });
    expect(other.W).toBe(w1);
  });
});

describe('일괄 적용 버튼 (W12-14)', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
    .split('\r\n').join('\n');

  test('마감 팝업에 버튼이 있다', () => {
    const opt = SRC.slice(SRC.indexOf("{ key: 'finish'"), SRC.indexOf("{ key: 'fixed'"));
    expect(opt).toContain('mp-fin-all');
  });

  test('두 select 의 현재 값을 모아 넘긴다', () => {
    const bind = SRC.slice(SRC.indexOf(".mp-fin-all'"), SRC.indexOf(".mp-fin-all'") + 700);
    expect(bind).toContain("bySide[sl.dataset.side] = sl.value");
    expect(bind).toContain('applyFinishToArea(m.areaId, bySide)');
  });

  test('결과를 한 번만 알린다 — 모듈마다 토스트를 띄우지 않는다', () => {
    const fn = SRC.slice(SRC.indexOf('function applyFinishToArea'), SRC.indexOf('function isAreaView'));
    expect(fn).toContain('quiet: true');
    expect(fn).not.toContain('showToast');
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
    expect(f.W).toBe(18);          // 측판 두께
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
