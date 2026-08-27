/**
 * W12-16: 영역 옵션 팔레트 — 크기 · 좌대 · 상몰딩 · 마감.
 *
 * 모듈 팔레트와 같은 껍데기를 쓰되 항목이 네 개다. 좌대·상몰딩은 그 부위가
 * 있는 섹션(키큰장·냉장고장·상부장)에서만 뜬다.
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

/** 섹션이 sec 인 영역을 골라 팔레트를 띄운다 */
function pick(p, sec) {
  const area = p.g('areas').find((a) => a.section === sec && !a.isFinishing);
  if (!area) return null;
  p.g('setActiveArea')(area.id);
  return area;
}

describe('영역을 고르면 팔레트가 뜬다', () => {
  test('도면 클릭·목록 클릭 어느 쪽이든 setActiveArea 를 지난다', () => {
    const fn = SRC.slice(SRC.indexOf('function setActiveArea'), SRC.indexOf('function setActiveArea') + 700);
    expect(fn).toContain('renderAreaPalette()');
  });

  test('팔레트가 실제로 생긴다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    expect(p.document.querySelector('.mod-palette')).not.toBeNull();
  });

  test('제목에 영역과 폭이 적힌다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    const title = p.document.querySelector('.mod-palette .mp-title').textContent;
    expect(title).toContain('영역');
    expect(title).toContain(`W${Math.round(area.W)}`);
  });
});

describe('항목은 네 가지뿐이다', () => {
  const FOUR = ['size', 'pedestalH', 'moldingH', 'finish'];

  test('어느 영역이든 늘 같은 네 개다 (W12-18)', () => {
    // 예전엔 섹션마다 2~4개가 떠서 무엇이 빠졌는지 알 수 없었다.
    const p = boot(seedFor(FIXTURES.lShape));
    const seen = new Set();
    p.g('areas').forEach((a) => {
      p.g('setActiveArea')(a.id);
      const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
      expect(keys).toEqual(FOUR);
      seen.add(a.section);
    });
    expect(seen.size).toBeGreaterThan(0);
  });

  test('마감재 영역에도 네 개가 뜬다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const fin = p.g('areas').find((a) => a.isFinishing);
    if (!fin) return;
    p.g('setActiveArea')(fin.id);
    const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
    expect(keys).toEqual(FOUR);
  });

  test('해당 없는 부위는 입력을 막고 이유를 적는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    pick(p, 'lower');   // 하부장 = 다리발·상판, 좌대 없음
    p.g('openAreaOptionPopup')('pedestalH');
    const pop = p.document.querySelector('.mp-popup');
    expect(pop.querySelector('.ap-part').disabled).toBe(true);
    expect(pop.textContent).toMatch(/이 부위가 없습니다/);
    expect(pop.textContent).toMatch(/다리발|상판/);
  });

  test('해당 되는 부위는 입력이 열려 있다', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    const area = pick(p, 'tall');
    if (!area) return;
    p.g('openAreaOptionPopup')('pedestalH');
    const inp = p.document.querySelector('.mp-popup .ap-part');
    expect(inp.disabled).toBe(false);
    expect(Number(inp.value)).toBeGreaterThan(0);
  });

  test('모듈 팔레트 항목은 섞이지 않는다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
    ['legH', 'doors', 'shelves', 'handle', 'fixed', 'topT'].forEach((k) => expect(keys).not.toContain(k));
  });

  test('AREA_OPTIONS 는 네 항목만 갖는다', () => {
    const arr = SRC.slice(SRC.indexOf('const AREA_OPTIONS'), SRC.indexOf('function areaOptionsFor'));
    const keys = (arr.match(/\{ key: '([a-zA-Z]+)'/g) || []).map((x) => x.split("'")[1]);
    expect(keys).toEqual(['size', 'pedestalH', 'moldingH', 'finish']);
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

  test('팝업이 좌·우 select 를 낸다 — 일괄 버튼은 없다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    p.g('openAreaOptionPopup')('finish');
    const pop = p.document.querySelector('.mp-popup');
    expect(pop.querySelectorAll('.ap-fin').length).toBe(2);
    expect(pop.querySelector('.ap-fin-go')).toBeNull();
    expect(pop.textContent).toMatch(/좌 끝/);
    expect(pop.textContent).toMatch(/우 끝/);
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
    p.g('openAreaOptionPopup')('finish');
    expect(p.document.querySelector('.mp-popup').textContent).toMatch(/모듈을 먼저 넣으세요/);
  });

  test('마감 입구는 배치 팔레트 하나다 (W12-21)', () => {
    // 모듈 팔레트의 마감 옵션·일괄 버튼은 없앴다.
    expect(SRC).not.toContain('mp-fin-all');
    const arr = SRC.slice(SRC.indexOf('const MODULE_OPTIONS'), SRC.indexOf('function heightNote'));
    expect(arr).not.toContain("key: 'finish'");
  });
});
