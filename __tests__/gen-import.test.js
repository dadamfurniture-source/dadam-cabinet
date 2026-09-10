/**
 * @jest-environment node
 *
 * gen-to-planner 변환기 계약 (js/detaildesign/gen-import.js).
 *
 * 지키는 것:
 *   1) 영역 폭은 layout 의 세그먼트 mm 그대로, 깊이·높이·가전 폭은 PLANNER_SECTIONS 그대로 — 지어낸 값 없음
 *   2) 이어진 lower/dishwasher 는 하부장 영역 하나, tall/fridge/wardrobe 는 각자 영역, open 은 비움
 *   3) 상부장은 layout.uppers 구간대로 y:0 (평면도라 하부와 같은 y)
 *   4) 가전은 layout 의 x 에 정본 폭으로 놓인다, null 이면 없다
 *   5) payload 는 mockup-shell serializeLayout 형식 (version/savedAt/person/modules) — restoreLayout 이 그대로 읽는다
 *   6) 스코프 키·토큰 이름이 셸(fromStructure)·구조 단계(dadam_gen_autocalc_v1)와 같다
 */
const fs = require('fs');
const path = require('path');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');
const G = require('../js/detaildesign/gen-import');

const ROOT = path.join(__dirname, '..');
const sec = PLANNER_SECTIONS;

/** 3000 벽 싱크대 — 워커 normalizeLayout 이 내는 형식 그대로 */
function sinkLayout() {
  return {
    version: 1,
    category: 'sink',
    wall: { W: 3000, H: 2400 },
    segments: [
      { kind: 'lower', startPct: 0, endPct: 50, x: 0, w: 1500, doors: 3, drawers: 1 },
      { kind: 'dishwasher', startPct: 50, endPct: 70, x: 1500, w: 600, doors: 1, drawers: 0 },
      { kind: 'open', startPct: 70, endPct: 75, x: 2100, w: 150, doors: 0, drawers: 0 },
      { kind: 'tall', startPct: 75, endPct: 100, x: 2250, w: 750, doors: 1, drawers: 0 },
    ],
    uppers: [{ kind: 'upper', startPct: 0, endPct: 70, x: 0, w: 2100, doors: 4 }],
    appliances: {
      sink: { centerPct: 30, x: 550, w: 700, source: 'waterPct' },
      cooktop: { centerPct: 65, source: 'exhaustPct' },
      hood: { centerPct: 65, x: 1800, w: 300, source: 'exhaustPct' },
      dishwasher: { centerPct: 60, x: 1500, w: 600, source: 'segment' },
      refrigerator: null,
    },
    doorCounts: { lower: 4, upper: 4, tall: 1, fridge: 0, wardrobe: 0 },
    confidence: { overall: 0.8, segments: 0.9, uppers: 0.8, appliances: 0.8 },
    notes: [],
  };
}

const bySection = (mods, s) => mods.filter((m) => m.section === s);

describe('싱크대', () => {
  const out = G.genLayoutToPlanner(sinkLayout(), null, 'sink', sec, '2026-09-11T00:00:00.000Z');
  const mods = out.layout.modules;

  test('payload 형식은 셸 serializeLayout 과 같다', () => {
    expect(out.layout).toMatchObject({
      version: 1,
      savedAt: '2026-09-11T00:00:00.000Z',
      person: { cx: 1500, cy: G.GEN_IMPORT_PERSON_CY },
    });
    mods.forEach((m) => {
      expect(Object.keys(m).sort()).toEqual(
        ['finishings', 'h', 'moduleH', 'rotation', 'section', 'w', 'x', 'y'].sort()
      );
      expect(m.rotation).toBe(0);
      expect(m.finishings).toEqual([]);
      expect(m.y).toBe(0);
    });
  });

  test('이어진 lower+dishwasher 는 하부장 영역 하나, open 은 비움, tall 은 별도', () => {
    expect(bySection(mods, 'lower')).toEqual([
      expect.objectContaining({ x: 0, w: 2100, h: sec.lower.h, moduleH: sec.lower.moduleH }),
    ]);
    expect(bySection(mods, 'tall')).toEqual([
      expect.objectContaining({ x: 2250, w: 750, h: sec.tall.h, moduleH: sec.tall.moduleH }),
    ]);
    expect(mods.some((m) => m.section === 'open')).toBe(false);
  });

  test('상부장은 uppers 구간대로 y:0', () => {
    expect(bySection(mods, 'upper')).toEqual([
      expect.objectContaining({ x: 0, w: 2100, y: 0, h: sec.upper.h, moduleH: sec.upper.moduleH }),
    ]);
  });

  test('가전은 layout 의 x, 폭은 정본. null 인 냉장고는 없다', () => {
    expect(bySection(mods, 'sink')[0]).toMatchObject({
      x: 550,
      w: sec.sink.w,
      h: sec.sink.h,
      moduleH: sec.sink.moduleH,
    });
    expect(bySection(mods, 'hood')[0]).toMatchObject({
      x: 1800,
      w: sec.hood.w,
      h: sec.hood.h,
      moduleH: sec.hood.moduleH,
    });
    expect(bySection(mods, 'dishwasher')[0]).toMatchObject({ x: 1500, w: sec.dishwasher.w });
    expect(bySection(mods, 'refrigerator')).toEqual([]);
  });

  test('원점은 (0,0) 에 천장 = 벽 높이', () => {
    expect(out.origin).toEqual({ x: 0, y: 0, ceiling: 2400 });
  });
});

describe('다른 품목', () => {
  test('붙박이장: 영역 하나 벽 전체, 가전·상부 없음', () => {
    const L = {
      category: 'wardrobe',
      wall: { W: 3600, H: 2310 },
      segments: [{ kind: 'wardrobe', x: 0, w: 3600, doors: 7, drawers: 0 }],
      uppers: [],
      appliances: { sink: null, cooktop: null, hood: null, dishwasher: null, refrigerator: null },
    };
    const mods = G.genLayoutToPlanner(L, null, 'wardrobe', sec).layout.modules;
    expect(mods).toEqual([
      expect.objectContaining({
        section: 'wardrobe',
        x: 0,
        w: 3600,
        h: sec.wardrobe.h,
        moduleH: sec.wardrobe.moduleH,
      }),
    ]);
  });

  test('냉장고장: fridge 영역 + tall + 브릿지 상부 + 냉장고 가전', () => {
    const L = {
      category: 'fridge',
      wall: { W: 2400, H: 2400 },
      segments: [
        { kind: 'tall', x: 0, w: 1680 },
        { kind: 'fridge', x: 1680, w: 720 },
      ],
      uppers: [{ kind: 'upper', x: 1680, w: 720 }],
      appliances: {
        sink: null,
        cooktop: null,
        hood: null,
        dishwasher: null,
        refrigerator: { x: 1680, w: 720, source: 'segment' },
      },
    };
    const mods = G.genLayoutToPlanner(L, null, 'fridge', sec).layout.modules;
    expect(mods.map((m) => m.section).sort()).toEqual(['fridge', 'refrigerator', 'tall', 'upper']);
    expect(bySection(mods, 'fridge')[0]).toMatchObject({
      x: 1680,
      w: 720,
      h: sec.fridge.h,
      moduleH: sec.fridge.moduleH,
    });
    expect(bySection(mods, 'refrigerator')[0]).toMatchObject({
      x: 1680,
      w: sec.refrigerator.w,
      moduleH: sec.refrigerator.moduleH,
    });
  });

  test('수납장: 키큰장만', () => {
    const L = {
      category: 'storage',
      wall: { W: 2400, H: 2400 },
      segments: [
        { kind: 'tall', x: 0, w: 1200 },
        { kind: 'tall', x: 1200, w: 1200 },
      ],
      uppers: [],
      appliances: { sink: null, cooktop: null, hood: null, dishwasher: null, refrigerator: null },
    };
    const mods = G.genLayoutToPlanner(L, null, 'storage', sec).layout.modules;
    expect(mods.every((m) => m.section === 'tall')).toBe(true);
    expect(mods.length).toBe(2);
  });

  test('세그먼트가 비면 품목 기본 영역 하나 (빈 도면으로 보내지 않는다)', () => {
    const mods = G.genLayoutToPlanner(
      { category: 'sink', wall: { W: 3000, H: 2400 } },
      null,
      'sink',
      sec
    ).layout.modules;
    expect(mods).toEqual([expect.objectContaining({ section: 'lower', x: 0, w: 3000 })]);
    const w = G.genLayoutToPlanner({}, { wallW: 3600, wallH: 2400 }, 'wardrobe', sec).layout
      .modules;
    expect(w).toEqual([expect.objectContaining({ section: 'wardrobe', x: 0, w: 3600 })]);
  });
});

describe('스코프 seed', () => {
  const mem = () => {
    const m = new Map();
    return {
      setItem: (k, v) => m.set(k, String(v)),
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      _m: m,
    };
  };

  test('배치·원점 키와 두 토큰을 iframe 스코프 문자열로 쓴다', () => {
    const ls = mem();
    const ss = mem();
    const seed = G.genLayoutToPlanner(sinkLayout(), null, 'sink', sec);
    G.genImportSeedScope('local:1757550000000.123', seed, ls, ss);
    expect(JSON.parse(ls.getItem('dadam_layout_v1::local:1757550000000.123'))).toEqual(seed.layout);
    expect(JSON.parse(ls.getItem('dadam_origin_v1::local:1757550000000.123'))).toEqual(seed.origin);
    expect(ss.getItem(G.GEN_IMPORT_RESTORE_TOKEN)).toBe('1');
    expect(ss.getItem(G.GEN_IMPORT_AUTOCALC_BASE + '::local:1757550000000.123')).toBe('1');
  });

  test('키 base 는 planner-store 정본과 같다', () => {
    const { PLANNER_STAGE_KEYS } = require('../js/planner/planner-store');
    expect(G.genImportKeyBases()).toEqual({
      layout: PLANNER_STAGE_KEYS.layout.layout,
      origin: PLANNER_STAGE_KEYS.layout.origin,
    });
  });

  test('토큰 이름이 셸·구조 단계와 같다', () => {
    const shell = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
    const struct = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(shell).toContain(`sessionStorage.getItem('${G.GEN_IMPORT_RESTORE_TOKEN}')`);
    expect(struct).toContain(`scopedKey('${G.GEN_IMPORT_AUTOCALC_BASE}')`);
  });
});

describe('소스 규약', () => {
  test('품목 매핑은 워커 LAYOUT_CATEGORIES 와 같고 detaildesign CATEGORIES 에 있다', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'workers/generate-api/src/layout.js'), 'utf8');
    const m = worker.match(/LAYOUT_CATEGORIES = \[([^\]]+)\]/);
    const workerKinds = m[1].match(/'(\w+)'/g).map((s) => s.replace(/'/g, ''));
    expect(Object.keys(G.GEN_IMPORT_CATEGORY_TO_ITEM).sort()).toEqual(workerKinds.sort());
    const dc = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    Object.values(G.GEN_IMPORT_CATEGORY_TO_ITEM).forEach((id) =>
      expect(dc).toMatch(new RegExp(`id:\\s*'${id}'`))
    );
  });

  test('ai-design 버튼과 my-designs 액션의 품목 목록이 같다', () => {
    const ai = fs.readFileSync(path.join(ROOT, 'ai-design.html'), 'utf8');
    const my = fs.readFileSync(path.join(ROOT, 'my-designs.html'), 'utf8');
    const pick = (src, name) =>
      src
        .match(new RegExp(`var ${name} = \\[([^\\]]+)\\]`))[1]
        .match(/'(\w+)'/g)
        .map((s) => s.replace(/'/g, ''));
    expect(pick(ai, 'GEN_TO_PLANNER_KINDS').sort()).toEqual(
      Object.keys(G.GEN_IMPORT_CATEGORY_TO_ITEM).sort()
    );
    expect(pick(my, 'PLANNER_KINDS').sort()).toEqual(
      Object.keys(G.GEN_IMPORT_CATEGORY_TO_ITEM).sort()
    );
    expect(ai).toMatch(/detaildesign\.html\?gen=/);
    expect(my).toMatch(/detaildesign\.html\?gen=/);
  });

  test('detaildesign 은 planner-sections 와 gen-import 를 persistence-init 앞에 싣고 ?gen= 을 처리한다', () => {
    const html = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
    const i1 = html.indexOf('js/planner/planner-sections.js');
    const i2 = html.indexOf('js/detaildesign/gen-import.js');
    const i3 = html.indexOf('js/detaildesign/persistence-init.js');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    const pi = fs.readFileSync(path.join(ROOT, 'js/detaildesign/persistence-init.js'), 'utf8');
    expect(pi).toMatch(/urlParams\.get\('gen'\)/);
    expect(pi).toMatch(/await genImportRun\(genId\)/);
  });
});
