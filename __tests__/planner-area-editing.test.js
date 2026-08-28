/**
 * 영역 편집 — 크기 · 좌대 · 상몰딩 · 마감.
 *
 * W12-16 에는 떠 있는 영역 팔레트였고, W12-32 에서 **우측 패널의 영역 모드**로
 * 옮겼다. 항목은 그대로 네 가지다 — 어떤 영역이든 개수가 달라지지 않는다(W12-18).
 * 좌대·상몰딩은 그 부위가 없는 섹션이면 숨기지 않고 막고 이유를 적는다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=ap&item=1';
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 섹션이 sec 인 영역을 골라 우측 패널을 영역 모드로 만든다 */
function pick(p, sec) {
  const area = p.g('areas').find((a) => a.section === sec && !a.isFinishing);
  if (!area) return null;
  p.g('setActiveArea')(area.id);
  return area;
}

describe('영역을 고르면 우측 패널이 영역 모드가 된다', () => {
  test('도면 클릭·목록 클릭 어느 쪽이든 setActiveArea 를 지난다', () => {
    const fn = SRC.slice(SRC.indexOf('function setActiveArea'), SRC.indexOf('function setActiveArea') + 700);
    expect(fn).toContain('renderRightPanel()');
    expect(fn).toContain("panelTarget = 'area'");
  });

  test('떠 있는 팔레트는 더 이상 없다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    expect(p.document.querySelector('.mod-palette')).toBeNull();
    expect(p.document.querySelector('.mp-popup')).toBeNull();
  });

  test('헤더가 영역 편집이라고 적는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    expect(p.document.querySelector('.panel-header-title').textContent).toBe('영역 편집');
  });

  test('영역 폭이 크기 칸에 들어 있다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    expect(+p.document.querySelector('#sizeBody input[data-dim="W"]').value).toBe(Math.round(area.W));
  });
});

describe('항목은 늘 같다 (W12-18)', () => {
  /** 지금 영역 모드가 내놓는 입력들 */
  const fields = (p) => ({
    dims: [...p.document.querySelectorAll('#sizeBody input[data-dim]')].map((n) => n.getAttribute('data-dim')),
    parts: [...p.document.querySelectorAll('#heightBody input[data-apart]')].map((n) => n.getAttribute('data-apart')),
    fins: [...p.document.querySelectorAll('#finishBody select[data-fin]')].map((n) => n.getAttribute('data-fin')),
  });

  test('어느 영역이든 같은 칸이 뜬다', () => {
    // 예전엔 섹션마다 2~4개가 떠서 무엇이 빠졌는지 알 수 없었다.
    const p = boot(seedFor(FIXTURES.lShape));
    const seen = new Set();
    p.g('areas').forEach((a) => {
      p.g('setActiveArea')(a.id);
      const f = fields(p);
      expect(f.dims).toEqual(['W', 'H', 'D']);
      expect(f.parts).toEqual(['pedestalH', 'moldingH']);
      expect(f.fins).toEqual(['left', 'right']);
      seen.add(a.section);
    });
    expect(seen.size).toBeGreaterThan(0);
  });

  test('마감재 영역에도 같은 칸이 뜬다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const fin = p.g('areas').find((a) => a.isFinishing);
    if (!fin) return;
    p.g('setActiveArea')(fin.id);
    expect(fields(p).parts).toEqual(['pedestalH', 'moldingH']);
  });

  test('해당 없는 부위는 입력을 막고 이유를 적는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    pick(p, 'lower');   // 하부장 = 다리발·상판, 좌대 없음
    const inp = p.document.querySelector('#heightBody input[data-apart="pedestalH"]');
    expect(inp.disabled).toBe(true);
    const body = p.document.getElementById('heightBody').textContent;
    expect(body).toMatch(/이 부위가 없습니다/);
    expect(body).toMatch(/다리발|상판/);
  });

  test('해당 되는 부위는 입력이 열려 있다', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    const area = pick(p, 'tall');
    if (!area) return;
    const inp = p.document.querySelector('#heightBody input[data-apart="pedestalH"]');
    expect(inp.disabled).toBe(false);
    expect(Number(inp.value)).toBeGreaterThan(0);
  });

  test('모듈 전용 섹션은 섞이지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    const shown = [...p.document.querySelectorAll('#rightPanel .section[data-sec]')]
      .filter((n) => n.style.display !== 'none').map((n) => n.getAttribute('data-sec'));
    ['split', 'areas', 'shelves', 'handle'].forEach((k) => expect(shown).not.toContain(k));
  });
});

describe('크기 — 배치 원본에 되쓴다', () => {
  test('영역이 원본 자리를 들고 있다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('areas').forEach((a) => expect(Number.isInteger(a._srcIndex)).toBe(true));
  });

  test('id 번호와 원본 index 는 다를 수 있다 — _srcIndex 로 되쓴다', () => {
    const fn = SRC.slice(SRC.indexOf('function saveLayoutFromAreas'), SRC.indexOf('function saveLayoutFromAreas') + 900);
    expect(fn).toContain('layout.modules[a._srcIndex]');
    expect(fn).toContain('entry.w = a.W');
  });

  test('폭을 고치면 배치 저장소에 반영된다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = p.g('areas')[0];
    area.W = 2222;
    expect(p.g('saveLayoutFromAreas')()).toBe(true);
    // 하네스 storage 는 Map 래퍼다 — _dump() 로 꺼낸다.
    const dump = p.storage._dump();
    const key = Object.keys(dump).find((k) => k.indexOf('dadam_layout_v1') === 0);
    const layout = JSON.parse(dump[key]);
    expect(layout.modules[area._srcIndex].w).toBe(2222);
  });
});

describe('좌대·상몰딩이 자동계산에 닿는다', () => {
  test('stackForArea 가 영역 값을 본다', () => {
    const fn = SRC.slice(SRC.indexOf('function stackForArea'), SRC.indexOf('function stackForArea') + 600);
    expect(fn).toContain('pedestalH: area.pedestalH');
    expect(fn).toContain('moldingH: area.moldingH');
  });

  test('영역 좌대를 바꾸면 스택 맨 아래 단이 따라온다', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    const area = p.g('areas').find((a) => a.section === 'tall');
    if (!area) return;
    const base = p.g('stackForArea')(area);
    if (!base) return;
    area.pedestalH = 100;
    const after = p.g('stackForArea')(area);
    expect(after[0].pedestalH).toBe(100);
    expect(after[0].pedestalH).not.toBe(base[0].pedestalH);
  });

  test('값을 지우면 마스터 기본값으로 돌아간다', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    const area = p.g('areas').find((a) => a.section === 'tall');
    if (!area) return;
    const before = p.g('stackForArea')(area)[0].pedestalH;
    area.pedestalH = 100;
    area.pedestalH = undefined;
    expect(p.g('stackForArea')(area)[0].pedestalH).toBe(before);
  });
});

describe('마감 — 배치 공간 양 끝에 한 장씩 (W12-20)', () => {
  /** 영역에 폭 W 모듈 n개 */
  function fill(p, n, W) {
    const area = p.g('areas')[0];
    let x = area.x || 0;
    const mods = [];
    for (let i = 0; i < n; i++) { mods.push(p.g('addModuleToArea')(area.id, { section: area.section, W, x })); x += W; }
    return { area, mods };
  }

  test('좌·우 select 를 낸다 — 일괄 버튼은 없다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    const host = p.document.getElementById('finishBody');
    expect(host.querySelectorAll('select[data-fin]').length).toBe(2);
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toMatch(/좌 끝/);
    expect(host.textContent).toMatch(/우 끝/);
  });

  test('모듈이 몇 개든 마감재는 한 장이다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 3, 600);
    p.g('setAreaFinish')(area.id, 'right', 'molding');
    expect(p.g('modules').filter((m) => m.isFinishing)).toHaveLength(1);
    expect(mods[2].W).toBe(600 - p.g('finishingWidthOf')('molding'));
    expect(mods[0].W).toBe(600);
    expect(mods[1].W).toBe(600);
  });

  test('좌·우 각각 한 장 — 양 끝 모듈이 낸다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 3, 600);
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'right', 'ep');
    expect(p.g('modules').filter((m) => m.isFinishing)).toHaveLength(2);
    const w = p.g('finishingWidthOf')('ep');
    expect(mods[0].W).toBe(600 - w);
    expect(mods[1].W).toBe(600);
    expect(mods[2].W).toBe(600 - w);
  });

  test('영역 안 총 폭은 그대로다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area } = fill(p, 3, 600);
    const sum = () => p.g('modules').filter((m) => m.areaId === area.id).reduce((t, m) => t + m.W, 0);
    const before = sum();
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'right', 'molding');
    expect(sum()).toBe(before);
  });

  test('마감재는 영역 바깥 끝에 선다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area } = fill(p, 3, 600);
    const x0 = area.x || 0;
    const l = p.g('setAreaFinish')(area.id, 'left', 'ep');
    const r = p.g('setAreaFinish')(area.id, 'right', 'ep');
    expect(l.x).toBe(x0);
    expect(r.x + r.W).toBe(x0 + 1800);
  });

  test("''(없음)이면 뗀다", () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area, mods } = fill(p, 2, 600);
    p.g('setAreaFinish')(area.id, 'right', 'ep');
    p.g('setAreaFinish')(area.id, 'right', '');
    expect(p.g('modules').filter((m) => m.isFinishing)).toHaveLength(0);
    expect(mods[1].W).toBe(600);
  });

  test('지금 붙어 있는 것을 select 가 보여준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const { area } = fill(p, 2, 600);
    p.g('setAreaFinish')(area.id, 'left', 'filler');
    expect(p.g('areaFinishOn')(area.id, 'left').section).toBe('filler');
    expect(p.g('areaFinishOn')(area.id, 'right')).toBeNull();
  });

  test('모듈이 없으면 안내한다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas')[0];
    expect(p.g('setAreaFinish')(area.id, 'left', 'ep')).toBeNull();
    p.g('setActiveArea')(area.id);
    expect(p.document.getElementById('finishBody').textContent).toMatch(/모듈을 먼저 넣으세요/);
  });

  test('마감 입구는 영역 하나다 (W12-21)', () => {
    // 모듈 편집에는 마감이 없다 — 나란한 모듈 사이에 두 장이 맞닿는다.
    expect(SRC).not.toContain('mp-fin-all');
    const mod = SRC.slice(SRC.indexOf('function renderSizePanel'), SRC.indexOf('function renderAreaPanel'));
    expect(mod).not.toContain('Finish');
    // 반대로 영역 모드에는 있어야 한다.
    const area = SRC.slice(SRC.indexOf('function renderAreaFinishPanel'), SRC.indexOf('function renderRightPanel'));
    expect(area).toContain('setAreaFinish(a.id');
  });
});

describe('스택 영역(키큰장·냉장고장)의 마감재 (W12-22)', () => {
  /** 키큰장 영역을 만들고 자동계산으로 3단을 채운다 */
  function tallStack() {
    const p = boot({
      'dadam_layout_v1::ap:1': JSON.stringify({
        version: 1, savedAt: '2026-08-28T00:00:00.000Z', person: { cx: 900, cy: 1500 },
        modules: [{ section: 'tall', x: 0, y: 0, w: 900, h: 700, moduleH: 2300, rotation: 0, finishings: [] }],
      }),
    });
    const area = p.g('areas')[0];
    p.g('autoCalcArea')(area.id);
    return { p, area };
  }
  const parts = (p) => p.g('modules').filter((m) => !m.isFinishing);
  const fins = (p) => p.g('modules').filter((m) => m.isFinishing);

  test('자동계산이 3단을 같은 자리에 쌓는다', () => {
    const { p } = tallStack();
    const ps = parts(p);
    expect(ps.length).toBe(3);
    expect(new Set(ps.map((m) => m.x)).size).toBe(1);   // 같은 x
    expect(new Set(ps.map((m) => m.W)).size).toBe(1);   // 같은 W
  });

  test('스택 영역으로 판별한다', () => {
    const { p, area } = tallStack();
    expect(p.g('isStackedArea')(area)).toBe(true);
    const lower = p.g('areas').find((a) => a.section === 'lower');
    if (lower) expect(p.g('isStackedArea')(lower)).toBe(false);
  });

  test('모든 단이 함께 폭을 내놓는다', () => {
    // 한 단만 줄이면 나머지가 마감재를 뚫고 나온다 (실제로 그랬다).
    const { p, area } = tallStack();
    const W0 = parts(p)[0].W;
    const f = p.g('setAreaFinish')(area.id, 'left', 'ep');
    expect(f).not.toBeNull();
    const w = p.g('finishingWidthOf')('ep');
    parts(p).forEach((m) => {
      expect(m.W).toBe(W0 - w);
      expect(m.x).toBe((area.x || 0) + w);
    });
    expect(fins(p)).toHaveLength(1);
  });

  test('마감재는 영역 전체 높이·깊이로 끝에 선다', () => {
    const { p, area } = tallStack();
    const f = p.g('setAreaFinish')(area.id, 'left', 'ep');
    expect(f.H).toBe(area.H);
    expect(f.D).toBe(area.D);
    expect(f.x).toBe(area.x || 0);
  });

  test('우측이면 줄어든 끝에 선다', () => {
    const { p, area } = tallStack();
    const x0 = parts(p)[0].x, W0 = parts(p)[0].W;
    const f = p.g('setAreaFinish')(area.id, 'right', 'molding');
    parts(p).forEach((m) => { expect(m.x).toBe(x0); expect(m.W).toBe(W0 - f.W); });
    expect(f.x + f.W).toBe(x0 + W0);
  });

  test('떼면 모든 단이 폭을 되찾는다', () => {
    const { p, area } = tallStack();
    const x0 = parts(p)[0].x, W0 = parts(p)[0].W;
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'left', '');
    parts(p).forEach((m) => { expect(m.W).toBe(W0); expect(m.x).toBe(x0); });
    expect(fins(p)).toHaveLength(0);
  });

  test('바꿔 달아도 폭이 새지 않는다', () => {
    const { p, area } = tallStack();
    const W0 = parts(p)[0].W;
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'left', 'molding');
    const w = p.g('finishingWidthOf')('molding');
    parts(p).forEach((m) => expect(m.W).toBe(W0 - w));
    expect(fins(p)).toHaveLength(1);
  });

  test('마감재를 놓고 자동계산해도 겹치지 않는다', () => {
    // 자동계산은 마감재를 보존한다. 새 단이 영역 폭 그대로 만들어지면 뚫고 나온다.
    const { p, area } = tallStack();
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setAreaFinish')(area.id, 'right', 'molding');
    const w = p.g('finishingWidthOf')('ep') + p.g('finishingWidthOf')('molding');
    p.g('autoCalcArea')(area.id);
    expect(fins(p)).toHaveLength(2);
    parts(p).forEach((m) => {
      expect(m.W).toBe(area.W - w);
      expect(m.x).toBe((area.x || 0) + p.g('finishingWidthOf')('ep'));
    });
  });

  test('단이 도어 최소보다 좁아지면 막는다', () => {
    const { p, area } = tallStack();
    const MIN = p.g('MASTER_RULES').DOOR_W_MIN;
    parts(p).forEach((m) => { m.W = MIN + 10; });
    const before = parts(p).map((m) => m.W);
    expect(p.g('setAreaFinish')(area.id, 'left', 'molding')).toBeNull();
    expect(parts(p).map((m) => m.W)).toEqual(before);
    expect(fins(p)).toHaveLength(0);
  });
});
