/**
 * W12-62: 비움 — 부재 없이 자리만 비워 두는 마감.
 *
 * 몰딩·휠라는 판이 서지만 비움은 **아무것도 안 선다.** 폭만 잡는다.
 * 그래서 다른 마감재와 두 가지가 다르다.
 *   ① 부재 폭이 0 이다 → BOM 자재가 없고, 3D 에 메쉬가 안 선다
 *   ② 폭을 사람이 정한다 (기본 50) → 비우는 이유가 현장마다 다르기 때문
 */
const sections = require('../js/planner/planner-sections.js');
const { bootPlanner } = require('../test-utils/planner-harness');

const D = 650;
/** ㅡ자 한 줄 — 코너와 무관한 자리에서 비움만 본다 */
const flat = {
  version: 1, savedAt: '2026-09-02T00:00:00.000Z', person: null,
  modules: [{ section:'lower', x:0, y:0, w:3600, h:D, moduleH:870, rotation:0, finishings:[] }],
};

function boot() {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(flat) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('autoCalcAllAreas')();
  return p;
}
const areaId = (p) => (p.g('areas') || []).filter((a) => !a.isFinishing)[0].id;
const finOn = (p, side) => p.g('areaFinishOn')(areaId(p), side);

describe('정의', () => {
  test('마감재 목록에 들어 있다 — 정본은 planner-sections.js', () => {
    expect(sections.FINISHING_SECTIONS).toEqual(['ep', 'molding', 'filler', 'gap']);
    expect(sections.PLANNER_SECTIONS.gap.label).toBe('비움');
    expect(sections.PLANNER_SECTIONS.gap.w).toBe(50);
  });

  test('부재가 없다 — 잡는 폭 50, 부재 폭 0', () => {
    const p = boot();
    expect(p.g('finishingWidthOf')('gap')).toBe(50);
    expect(p.g('finishingPartWidthOf')('gap')).toBe(0);
    expect(p.g('isFinishingSection')('gap')).toBe(true);
  });

  test('선택지 표기가 "부재 없음" 이라고 알려 준다', () => {
    const p = boot();
    expect(p.g('finishLabel')('gap')).toBe('비움 50mm · 부재 없음');
    expect(p.g('finishLabel')('filler')).toBe('휠라 60mm');
  });

  test('배치할 수 있는 모듈 목록에는 안 나온다 — 마감재지 장이 아니다', () => {
    const p = boot();
    const opts = p.g('sectionsFor')(p.g('areaById')(areaId(p)));
    expect(opts).not.toContain('gap');
    ['ep', 'molding', 'filler'].forEach((k) => expect(opts).not.toContain(k));
  });
});

describe('세우기', () => {
  test('기본 50 으로 선다', () => {
    const p = boot();
    p.g('setAreaFinish')(areaId(p), 'left', 'gap');
    const f = finOn(p, 'left');
    expect(f).toBeTruthy();
    expect(f.section).toBe('gap');
    expect(f.W).toBe(50);
  });

  test('폭을 정해서 세울 수 있다', () => {
    const p = boot();
    p.g('setAreaFinish')(areaId(p), 'left', 'gap', 120);
    expect(finOn(p, 'left').W).toBe(120);
  });

  test('나중에 폭만 바꿔도 된다', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'gap');
    expect(finOn(p, 'left').W).toBe(50);
    p.g('setAreaFinish')(id, 'left', 'gap', 200);
    expect(finOn(p, 'left').W).toBe(200);
    expect(p.g('modules').filter((m) => m.section === 'gap').length).toBe(1);   // 겹쳐 쌓이지 않는다
  });

  test('몰딩·휠라는 폭을 못 바꾼다 — 부재 규격이다', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'molding', 200);
    expect(finOn(p, 'left').W).toBe(60);
    p.g('setAreaFinish')(id, 'right', 'ep', 200);
    expect(finOn(p, 'right').W).toBe(20);
  });

  test('0 이나 쓰레기값을 주면 기본 50 으로 떨어진다', () => {
    const p = boot();
    const id = areaId(p);
    [0, -30, 'abc', null].forEach((bad, i) => {
      p.g('setAreaFinish')(id, i % 2 ? 'right' : 'left', 'gap', bad);
      expect(finOn(p, i % 2 ? 'right' : 'left').W).toBe(50);
    });
  });
});

describe('폭 장부', () => {
  test('자리를 차지한다 — 영역 폭은 그대로고 모듈이 내놓는다', () => {
    const p = boot();
    const id = areaId(p);
    const area = p.g('areaById')(id);
    const before = p.g('modules').filter((m) => m.areaId === id && !m.isFinishing)
      .reduce((s, m) => s + m.W, 0);
    p.g('setAreaFinish')(id, 'left', 'gap', 80);
    const after = p.g('modules').filter((m) => m.areaId === id && !m.isFinishing)
      .reduce((s, m) => s + m.W, 0);
    expect(before - after).toBe(80);
    expect(p.g('areaById')(id).W).toBe(area.W);          // 영역은 안 바뀐다
  });

  test('finishWidthOf 가 비움도 센다 — 자리를 차지하므로', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'gap', 80);
    expect(p.g('finishWidthOf')(id)).toBe(80);
  });
});

describe('서는 높이 — 몰딩과 같은 자리다', () => {
  test('상판 아래까지 선다 — 영역 높이가 아니다', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'molding');
    const moldingH = finOn(p, 'left').H;
    p.g('setAreaFinish')(id, 'left', 'gap');
    // 같은 자리에 서는 부재이므로 높이가 튀면 안 된다.
    // 폴백(영역 H)으로 떨어지면 상판 두께만큼 올라와 상판을 침범한 것처럼 보인다.
    expect(finOn(p, 'left').H).toBe(moldingH);
    expect(finOn(p, 'left').H).toBeLessThan(p.g('areaById')(id).H);
  });

  test('키큰장(스택 영역)에도 선다 — 세 단이 함께 폭을 내놓는다', () => {
    const tall = {
      version: 1, savedAt: '2026-09-02T00:00:00.000Z', person: null,
      modules: [{ section:'tall', x:0, y:0, w:3000, h:650, moduleH:2300, rotation:0, finishings:[] }],
    };
    const p = bootPlanner('mockup-structure.html', {
      search: '?design=d1&item=1',
      storage: { 'dadam_layout_v1::d1:1': JSON.stringify(tall) },
    });
    p.g('autoCalcAllAreas')();
    const a = p.g('areas').filter((x) => !x.isFinishing)[0];
    expect(p.g('isStackedArea')(a)).toBe(true);
    const tiers = () => p.g('modules').filter((m) => m.areaId === a.id && !m.isFinishing);
    const before = tiers().map((m) => m.W);
    expect(before.length).toBeGreaterThan(1);
    p.g('setAreaFinish')(a.id, 'left', 'gap', 180);
    expect(p.g('areaFinishOn')(a.id, 'left').W).toBe(180);
    // 한 단만 줄면 나머지 단이 마감재를 뚫고 나온다 (W12-22)
    tiers().forEach((m, i) => expect(m.W).toBe(before[i] - 180));
  });
});

describe('그림 — 판이 아니라 빈 자리로 보인다', () => {
  test('정면도에 점선 테두리로, 칠하지 않고 그린다', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'gap');
    p.g('setActiveArea')(id);
    p.g('renderFrontView')();
    const g = p.document.getElementById('contentG');
    const gapId = p.g('modules').find((m) => m.section === 'gap').id;
    const r = [...g.querySelectorAll('rect')].find((x) => x.getAttribute('data-module-id') === gapId);
    expect(r).toBeTruthy();
    expect(r.getAttribute('fill')).toBe('none');
    expect(r.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(Math.round(+r.getAttribute('width'))).toBe(50);   // 잡은 자리 전체를 표시한다
  });

  test('휠라는 여전히 칠해서 그린다 — 비움과 구분된다', () => {
    const p = boot();
    const id = areaId(p);
    p.g('setAreaFinish')(id, 'left', 'filler');
    p.g('setActiveArea')(id);
    p.g('renderFrontView')();
    const g = p.document.getElementById('contentG');
    const fid = p.g('modules').find((m) => m.section === 'filler').id;
    const r = [...g.querySelectorAll('rect')].find((x) => x.getAttribute('data-module-id') === fid);
    expect(r.getAttribute('fill')).not.toBe('none');
    expect(r.getAttribute('stroke-dasharray')).toBeNull();
  });
});
