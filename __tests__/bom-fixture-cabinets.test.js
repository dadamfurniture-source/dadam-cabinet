/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 설비장 — 개수대 · 가스대 · 후드장 (2026-10-26 사장님, js/detaildesign/bom-fixture-cabinet-rules.js).
 *
 *   개수대 1000  하부 2도어 · 선반 없음 · 밴드: 앞 50 눕힘 · 뒤 70 세움 (뒤끝)
 *   가스대 600   하부 서랍 2:2 (위 칸도 서랍) — 위 칸: 속서랍 60 (사쿠리 없음 · 볼레일) + 소서랍 75 (볼레일, 위 마이다),
 *                아래 칸: 서랍 (언더레일 · 큰 박스 우선). 밴드는 개수대와 같다. 쿡탑 인덕션 · 가스레인지
 *   후드장 600   상부 2도어 · 플랩 · 몸통 · 도어 = 상부장 − 60 (윗선 고정) · 선반 없음. 아래 60 자리에 후드 50
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
require('../js/detaildesign/bom-open-cabinet-rules.js');
const FX = require('../js/detaildesign/bom-fixture-cabinet-rules.js');
const DR = require('../js/detaildesign/bom-drawer-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const R = FX.FIXTURE_CABINET_RULES;
const SPECS = Object.assign({}, LEDGER_SPECS, { handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });
const T = 15, D = 550, BACK = 70, AREA_D = 650, UD = 295;
const doors = (W, n, dir, extra) => Object.assign({
  moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir || 'left'],
  areaWidths: [W], areaIs2D: [n === 2],
}, extra || {});
const gas = (cooktop) => ({
  moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorTopDrawerBottom', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [600], areaIs2D: [false],
  bottomType: 'drawer', drawerCount: 2,
  drawer: { rail: 'under', sakuri: true, boxT: 0, grades: ['auto', 'auto'], doorGrade: '', topDrawer: true, fronts: R.COOKTOP_DRAWER.FRONTS },
  fixture: 'cooktop', cooktop,
});

/** 하부 줄: 2도어 600 · 개수대 1000 · 가스대 600 · 2도어 600, 상부 줄: 2도어 600 · 후드장 600 (2도어 또는 플랩) · 2도어 600 */
function kitchen(hoodFlap) {
  const modules = [
    { id: 'l0', section: 'lower', W: 600, H: 870, D, x: 0, y: BACK, areaH: 870 },
    { id: 's1', section: 'lower', W: 1000, H: 870, D, x: 600, y: BACK, areaH: 870 },
    { id: 'g2', section: 'lower', W: 600, H: 870, D, x: 1600, y: BACK, areaH: 870 },
    { id: 'l3', section: 'lower', W: 600, H: 870, D, x: 2200, y: BACK, areaH: 870 },
    { id: 'u0', section: 'upper', W: 600, H: 780, D: UD, x: 0, y: 0, areaH: 780 },
    { id: 'h1', section: 'upper', W: 600, H: 780, D: UD, x: 600, y: 0, areaH: 780 },
    { id: 'u2', section: 'upper', W: 600, H: 780, D: UD, x: 1200, y: 0, areaH: 780 },
  ];
  const structures = {
    l0: doors(600, 2), s1: doors(1000, 2, 'left', { fixture: 'sink' }), g2: gas('induction'), l3: doors(600, 2),
    u0: doors(600, 2), h1: hoodFlap ? doors(600, 1, 'up', { fixture: 'hood' }) : doors(600, 2, 'left', { fixture: 'hood' }), u2: doors(600, 2),
  };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'sink', w: 2800, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
  const mk = (id) => `0-${key(id)}`;
  const lines = [[
    { key: 'area-lower-0', D: AREA_D, modules: ['l0', 's1', 'g2', 'l3'].map((id, i) => ({ moduleKey: mk(id), x0: [0, 600, 1600, 2200][i], back: BACK })) },
    { key: 'area-upper-0', D: 325, modules: ['u0', 'h1', 'u2'].map((id, i) => ({ moduleKey: mk(id), x0: i * 600, back: 30 })) },
  ]];
  const spec = Asm.of({ items: [item] }, { materials, hardware, lines });
  const rows = (id) => materials.filter((m) => m.moduleKey === mk(id));
  const modOf = (id) => spec.items[0].modules.find((m) => m.moduleKey === mk(id));
  return { conv, item, materials, hardware, spec, key, mk, rows, modOf };
}
const pick = (rows, part) => rows.filter((m) => m.part === part).map((m) => [m.w, m.h, m.qty]);

describe('규칙 · 브리지', () => {
  test('설비 판별 — 구조 s.fixture · 쿡탑 · 후드장 −60', () => {
    expect([FX.fixtureOf({ fixture: 'sink' }), FX.fixtureOf({ fixture: 'x' }), FX.fixtureOf(null)]).toEqual(['sink', null, null]);
    expect([FX.hasStandingBackBand({ fixture: 'sink' }), FX.hasStandingBackBand({ fixture: 'cooktop' }), FX.hasStandingBackBand({ fixture: 'hood' })]).toEqual([true, true, false]);
    expect([FX.noShelf({ fixture: 'sink' }), FX.noShelf({ fixture: 'hood' }), FX.noShelf({ fixture: 'cooktop' })]).toEqual([true, true, false]);
    expect([FX.heightCutOf({ fixture: 'hood' }), FX.heightCutOf({ fixture: 'sink' })]).toEqual([60, 0]);
  });

  test('브리지 — fixture · 이름 · 쿡탑 · 후드장 몸통 720 − 60 = 660, 표시 없는 모듈은 예전 payload', () => {
    const { conv, key } = kitchen();
    const m = (id) => conv.modules.find((x) => x.id === key(id));
    expect([m('s1').fixture, m('s1').name, m('s1').h]).toEqual(['sink', '개수대', 708]);
    expect([m('g2').fixture, m('g2').cooktop, m('g2').name, m('g2').drawerLayout]).toEqual(['cooktop', 'induction', '가스대', 'all']);
    expect(m('g2').drawer.fronts).toEqual([{ rail: 'ball', box: 'small', inner: { h: 60, sakuri: false, rail: 'ball' } }, { rail: 'under' }]);
    expect([m('h1').fixture, m('h1').name, m('h1').h, m('u0').h]).toEqual(['hood', '후드장', 660, 720]);
    expect(m('l0')).not.toHaveProperty('fixture');
    expect(m('l0').drawer).toBeUndefined();
  });
});

describe('개수대 1000', () => {
  test('밴드 — 앞 50 눕힘 1장 · 뒤 70 세움 1장 (W − 2T 970), 선반 없음 · 2도어 496 · 처짐방지 1', () => {
    const { rows } = kitchen();
    const r = rows('s1');
    expect(r.filter((x) => x.part === '밴드').map((x) => [x.thickness, x.w, x.h, x.qty, x.note])).toEqual([[T, 50, 970, 1, '앞 · 눕힘'], [T, 70, 970, 1, '뒤 · 세움']]);
    expect(pick(r, '선반')).toEqual([]);
    expect(pick(r, '도어')).toEqual([[496, 678, 2]]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([[70, 708 - 2 * T - 70, 1]]);   // W ≥ 800 → 1장, 목찬넬이면 H − 2T − 70
  });

  test('보통 하부장 밴드는 그대로 70 × 2 (눕힘)', () => {
    const { rows } = kitchen();
    expect(pick(rows('l0'), '밴드')).toEqual([[70, 570, 2]]);
  });

  test('조립 — 앞 밴드는 앞선에서 50 눕고, 뒤 밴드는 뒤끝에 70 서 있다 (윗면 = 몸통 상단)', () => {
    const { modOf } = kitchen();
    const bands = modOf('s1').parts.filter((p) => p.part === '밴드');
    const box = (end) => bands.find((p) => p.tags && p.tags.end === end).box;
    expect(box('front')).toEqual({ min: [-485, 708 - 70 - T, D / 2 - 50], max: [485, 708 - 70, D / 2] });
    expect(box('back')).toEqual({ min: [-485, 708 - 70, -D / 2], max: [485, 708, -D / 2 + T] });
  });
});

describe('가스대 600', () => {
  test('서랍 레이아웃 — 위 칸 속서랍 60 (볼) + 소서랍 75 (볼), 아래 칸 대 180 (언더)', () => {
    const g = DR.gradesFromRatio(R.COOKTOP_DRAWER.RATIO, { topDrawer: true });
    const L = DR.layoutByGrades({ areaH: 870, topT: 12, legH: 150, T, fronts: g.grades.map((x) => ({ kind: 'drawer', grade: x })), rail: 'under', frontSpecs: R.COOKTOP_DRAWER.FRONTS });
    expect(L.boxes.map((b) => [b.frontIndex, b.size, b.h, b.rail, b.fits, !!b.inner])).toEqual([
      [0, 'inner', 60, 'ball', true, true], [0, 'small', 75, 'ball', true, false], [1, 'large', 180, 'under', true, false],
    ]);
    expect(L.warnings).toEqual([]);
    // 칸마다 값이 없으면 예전 그대로 (대 · 대, 박스 항목에 새 필드 없음)
    const L0 = DR.layoutByGrades({ areaH: 870, topT: 12, legH: 150, T, fronts: g.grades.map((x) => ({ kind: 'drawer', grade: x })), rail: 'under' });
    expect(L0.boxes).toEqual([
      { frontIndex: 0, size: 'large', h: 180, fits: true, zoneH: 249, rail: 'under' },
      { frontIndex: 1, size: 'large', h: 180, fits: true, zoneH: 269, rail: 'under' },
    ]);
  });

  test('BOM — 박스 셋 묶음 (속서랍 · 소 볼 · 대 언더) · 밑판 셋 · 서랍도어 2 · 밴드 앞 50 · 뒤 70 · 처짐방지 없음', () => {
    const { rows } = kitchen();
    const r = rows('g2');
    expect(pick(r, '서랍도어')).toEqual([[596, 324, 2]]);
    // 볼레일 앞뒷판 = W − 2T − 2×14 − 2×서랍T = 512, 언더 = W − 2T − 2×서랍T − 12 = 528. 사쿠리면 높이 −18
    expect(pick(r, '서랍전후판')).toEqual([[512, 60, 2], [512, 57, 2], [528, 162, 2]]);
    expect(pick(r, '서랍측판')).toEqual([[500, 60, 2], [500, 75, 2], [490, 180, 2]]);
    expect(r.filter((x) => x.part === '서랍측판').map((x) => x.note)).toEqual([
      '속서랍 박스 60 · 댐핑 볼레일 500', '소 박스 · 댐핑 볼레일 500 · 사쿠리', '대 박스 · 댐핑 언더레일 500 · 사쿠리',
    ]);
    // 밑판 — 사쿠리 없음 = 외경 − 1 (542 − 1), 사쿠리 = 앞뒷판 + 20
    expect(pick(r, '서랍밑판')).toEqual([[541, 499, 1], [532, 499, 1], [548, 489, 1]]);
    expect(r.filter((x) => x.part === '밴드').map((x) => [x.w, x.qty])).toEqual([[50, 1], [70, 1]]);
    expect(pick(r, '밴드(처짐방지)')).toEqual([]);
  });

  test('레일 철물 — 댐핑 볼레일 2 (속서랍 · 소서랍) · 댐핑 언더레일 1', () => {
    const { hardware, key } = kitchen();
    const rails = hardware.filter((h) => h.category === '레일' && h.moduleKey === `0-${key('g2')}`);
    expect(rails.map((h) => [h.item, h.qty, h.spec])).toEqual([['댐핑 볼레일', 2, '500mm'], ['댐핑 언더레일', 1, '500mm']]);
  });

  test('조립 — 속서랍은 위 칸 맨 위 (앞 밴드 아래 레일 여유 10), 소서랍은 칸 바닥 + 10, 레일 자리 종류대로', () => {
    const { modOf } = kitchen();
    const m = modOf('g2');
    // 몸통 위에서: 위 칸 85 … 334. 속서랍 윗단 = 85 + 10 → y 708 − 95 = 613, 소서랍 밑단 = 708 − 334 + 10 = 384
    expect(m.drawerBoxes.map((b) => [b.y0, b.rail])).toEqual([[613 - 60, 'ball'], [384, 'ball'], [708 - 693 + 30, 'under']]);
    const rails = (m.hardware || []).filter((h) => h.kind === 'rail');
    expect(rails.filter((h) => h.pending)).toEqual([]);
    expect(rails.map((h) => h.tags.box)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('후드장 600 (상부)', () => {
  test.each([[false, [[296, 675, 2]]], [true, [[596, 675, 1]]]])('플랩 %s — 몸통 660 · 도어 675 (보통 상부장 735 − 60) · 선반 없음', (flap, door) => {
    const { rows } = kitchen(flap);
    const r = rows('h1');
    expect(pick(r, '측판')).toEqual([[UD, 660, 2]]);
    expect(pick(r, '도어')).toEqual(door);
    expect(pick(r, '선반')).toEqual([]);
    expect(pick(rows('u0'), '도어')).toEqual([[296, 735, 2]]);
    expect(pick(rows('u0'), '선반')).toEqual([[570, UD - 34, 2]]);
  });
});

describe('조립 검사', () => {
  test.each([[false], [true]])('후드 플랩 %s — 못 놓은 행 없음 · 조립 검사 오류 없음', (flap) => {
    const { spec } = kitchen(flap);
    expect(spec.unplaced.filter((u) => u.reason !== 'shelf-height-unknown')).toEqual([]);
    expect(Check.check(spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('양념망장 200 · 300 (2026-10-27 사장님)', () => {
  /** 하부 줄: 1도어 450 · 양념망장 200 · 양념망장 300 */
  function spiceLine() {
    const modules = [
      { id: 'd0', section: 'lower', W: 450, H: 870, D, x: 0, y: BACK, areaH: 870 },
      { id: 'p1', section: 'lower', W: 200, H: 870, D, x: 450, y: BACK, areaH: 870 },
      { id: 'p2', section: 'lower', W: 300, H: 870, D, x: 650, y: BACK, areaH: 870 },
    ];
    const structures = { d0: doors(450, 1), p1: doors(200, 1, 'left', { fixture: 'spice' }), p2: doors(300, 1, 'left', { fixture: 'spice' }) };
    const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
    const item = { categoryId: 'sink', w: 950, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
    const { MaterialExtractor, HardwareExtractor } = loadExtractors();
    const materials = new MaterialExtractor().extract({ items: [item] }).materials;
    const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
    const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
    const mk = (id) => `0-${key(id)}`;
    const lines = [[{ key: 'area-lower-0', D: AREA_D, modules: ['d0', 'p1', 'p2'].map((id, i) => ({ moduleKey: mk(id), x0: [0, 450, 650][i], back: BACK })) }]];
    const spec = Asm.of({ items: [item] }, { materials, hardware, lines });
    return { conv, materials, hardware, spec, key, mk };
  }

  test('브리지 — fixture spice · 이름 양념망장 · 도어 종류 pullout · 경첩 방향 없음', () => {
    const { conv, key } = spiceLine();
    const m = conv.modules.find((x) => x.id === key('p1'));
    expect([m.fixture, m.name, m.doorType, m.hingeSide]).toEqual(['spice', '양념망장', 'pullout', undefined]);
    expect(conv.modules.find((x) => x.id === key('d0')).hingeSide).toBe('left');
  });

  test('BOM — 앞판 (W − 4) × (H − 30) 비고 풀아웃 · 선반 없음 · 밴드는 보통 하부장 (70 × 2 눕힘)', () => {
    const { materials, mk } = spiceLine();
    const r = (id) => materials.filter((m) => m.moduleKey === mk(id));
    expect(r('p1').filter((m) => m.part === '도어').map((m) => [m.w, m.h, m.qty, m.note])).toEqual([[196, 678, 1, R.SPICE.FRONT_NOTE]]);
    expect(r('p2').filter((m) => m.part === '도어').map((m) => [m.w, m.h])).toEqual([[296, 678]]);
    expect(pick(r('p1'), '선반')).toEqual([]);
    expect(pick(r('p1'), '밴드')).toEqual([[70, 170, 2]]);
    expect(pick(r('d0'), '선반').length).toBe(1);
  });

  test('철물 — 경첩 없이 양념망 1 SET (품명 · 규격 [확인 필요]), 1도어 450 은 경첩 그대로', () => {
    const { hardware, mk } = spiceLine();
    const hw = (id) => hardware.filter((h) => h.moduleKey === mk(id));
    expect(hw('p1').filter((h) => h.category === '경첩')).toEqual([]);
    expect(hw('p1').filter((h) => h.category === '양념망').map((h) => [h.item, h.spec, h.qty, h.unit])).toEqual([['양념망 (풀아웃)', '폭 200', 1, 'SET']]);
    expect(hw('p1').find((h) => h.category === '양념망').note).toMatch(/\[확인 필요\]/);
    expect(hw('d0').filter((h) => h.category === '경첩').length).toBe(1);
  });

  test('조립 — 못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    const { spec } = spiceLine();
    expect(spec.unplaced.filter((u) => u.reason !== 'shelf-height-unknown')).toEqual([]);
    expect(Check.check(spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
