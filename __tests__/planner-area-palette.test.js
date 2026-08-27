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
  test('하부장 영역 — 크기·마감 (좌대·상몰딩 없음)', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = pick(p, 'lower');
    expect(area).not.toBeNull();
    const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
    expect(keys).toEqual(['size', 'finish']);
  });

  test('키큰장 영역 — 크기·좌대·상몰딩·마감 네 개', () => {
    const p = boot(seedFor(FIXTURES.lShape));
    const area = pick(p, 'tall');
    if (!area) return;   // 픽스처에 키큰장이 없으면 건너뛴다
    const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
    expect(keys).toEqual(['size', 'pedestalH', 'moldingH', 'finish']);
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

describe('마감 — 영역 전체 일괄', () => {
  test('팝업이 좌·우 select 와 적용 버튼을 낸다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('setActiveArea')(p.g('areas')[0].id);
    p.g('openAreaOptionPopup')('finish');
    const pop = p.document.querySelector('.mp-popup');
    expect(pop).not.toBeNull();
    expect(pop.querySelectorAll('.ap-fin').length).toBe(2);
    expect(pop.querySelector('.ap-fin-go')).not.toBeNull();
  });

  test('applyFinishToArea 로 간다 — 모듈 팔레트와 같은 함수', () => {
    const fn = SRC.slice(SRC.indexOf('function bindAreaOptionInputs'));
    expect(fn.slice(0, 1400)).toContain('applyFinishToArea(a.id, bySide)');
  });

  test('버튼에 대상 모듈 수가 적힌다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const area = p.g('areas')[0];
    p.g('setActiveArea')(area.id);
    p.g('addModuleToArea')(area.id, { section: area.section, W: 600, x: area.x || 0 });
    p.g('openAreaOptionPopup')('finish');
    expect(p.document.querySelector('.ap-fin-go').textContent).toMatch(/모듈 1개에 적용/);
  });
});

describe('마감재 영역에는 마감 항목이 없다', () => {
  test('isFinishing 영역은 finish 를 안 낸다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const fin = p.g('areas').find((a) => a.isFinishing);
    if (!fin) return;
    p.g('setActiveArea')(fin.id);
    const keys = [...p.document.querySelectorAll('.mod-palette .mp-ic')].map((b) => b.dataset.option);
    expect(keys).not.toContain('finish');
  });
});
