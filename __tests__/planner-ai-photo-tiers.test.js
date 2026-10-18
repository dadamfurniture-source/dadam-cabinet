/**
 * 2026-10-19: 쌓인 단 — 디테일 패널 도면 요약(design_spec modules[].tiers)과 번호 입면.
 * 계약: docs/02-design/features/design-spec-prompt.md "쌓인 단".
 *
 * 실제 사이트에서 본 실패 (2026-10-19, 「전체 자동계산」 뒤):
 *   키큰장 x1800 w600 높이 2300 → tall-0 H861 base 0 · tall-1 H979 base 861 · tall-2 H460 base 1840 (한 통)
 *   냉장고장 x2400 w720 → fridge W680 (냉장고 자리 위 박스, 2도어)
 *   요약이 tall "600:door/d1 ×3 + 680:door/d2" (가로로 나란한 넷), 냉장고 없음, wallRunMm 4280.
 *
 * 고정하는 것:
 *   · 같은 섹션·x·폭으로 쌓인 모듈 = 통 하나 (base 순서), doorCount·drawerCount 는 단의 합
 *   · 냉장고장 통 = 냉장고 자리(appliance 단, 바닥~박스 아랫면) + 박스, 가전 목록에 fridge
 *   · 냉장고 본체가 그 자리에 있으면 통에 들어간다 (따로 세우지 않고 가전도 하나)
 *   · 구간 높이·바닥 높이·런 폭이 통 기준
 *   · 번호 입면: 통 하나에 번호 하나 (moduleIds) — 워커 buildPlannerPrompt 의 번호와 같다
 *   · planner-capture: moduleIds 의 상자를 합친다
 *   · 쌓인 것이 없으면 예전 그대로
 */
const fs = require('fs');
const path = require('path');
const A = require('../js/planner/ai-photo');
const C = require('../js/planner/planner-capture');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadEsm('workers/generate-api/src/prompts.js', ['buildPlannerPrompt', 'normalizeDesignSpec']);

const struct = (o = {}) => Object.assign({
  verticalCount: 1, areaTypes: ['door'], areaWidths: [], areaIs2D: [false], horizontalLayout: 'doorOnly',
}, o);
const two = struct({ areaIs2D: [true] });

/** 사이트 도면의 자동계산 결과 (모듈 목록은 페이지 modules 와 같은 모양 — 일부러 순서를 섞는다) */
function siteModules() {
  return [
    { id: 'tall-2', section: 'tall', W: 600, H: 460, D: 650, x: 1800, y: 0, rotation: 0, baseY: 1840, part: '상부장' },
    { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
    { id: 'lower-1', section: 'lower', W: 900, H: 870, D: 650, x: 900, y: 0, rotation: 0 },
    { id: 'upper-0', section: 'upper', W: 900, H: 780, D: 320, x: 0, y: 0, rotation: 0 },
    { id: 'upper-1', section: 'upper', W: 900, H: 780, D: 320, x: 900, y: 0, rotation: 0 },
    { id: 'sink-0', section: 'sink', W: 700, H: 500, D: 400, x: 900, y: 0, rotation: 0 },
    { id: 'tall-0', section: 'tall', W: 600, H: 861, D: 650, x: 1800, y: 0, rotation: 0, baseY: 0, part: '하부장' },
    { id: 'tall-1', section: 'tall', W: 600, H: 979, D: 650, x: 1800, y: 0, rotation: 0, baseY: 861, part: '중간장' },
    { id: 'ep-0', section: 'ep', W: 20, H: 2300, D: 700, x: 2400, y: 0, rotation: 0 },
    { id: 'fridge-0', section: 'fridge', W: 680, H: 415, D: 700, x: 2420, y: 0, rotation: 0, baseY: 1885, part: '상부장' },
    { id: 'ep-1', section: 'ep', W: 20, H: 2300, D: 700, x: 3100, y: 0, rotation: 0 },
  ];
}
const SITE_STRUCT = {
  'lower-0': struct({ horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 3, areaTypes: ['drawer'] }),
  'lower-1': two, 'upper-0': two, 'upper-1': two,
  'tall-0': struct(), 'tall-1': struct(), 'tall-2': struct(),
  'fridge-0': two,
};
const traceOf = (mods = siteModules(), extra = {}) => A.plannerAiPhotoSpecTrace(Object.assign({
  modules: mods, structureOf: (id) => SITE_STRUCT[id] || null,
}, extra));

/** 워커 프롬프트가 실제로 쓰는 번호·폭 */
function workerIds(spec) {
  const ds = P.normalizeDesignSpec(spec, spec.category);
  const prompt = P.buildPlannerPrompt({ category: spec.category, designSpec: ds, wallW: 0, wallH: 0 });
  const out = [];
  const re = /^\s+([LUTW]\d+)\s+(\d+) mm/gm;
  let m;
  while ((m = re.exec(prompt))) out.push([m[1], Number(m[2])]);
  return { out, prompt };
}

describe('쌓인 단 — 통 하나 = 계약 모듈 하나', () => {
  test('키큰장 세 단(순서가 섞여 와도 base 순) → T 한 통, 도어 3 = 단의 합', () => {
    const { spec } = traceOf();
    const t = spec.sections.tall.modules;
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({
      widthMm: 600, kind: 'door', doorCount: 3, drawerCount: 0, label: '키큰장 3단',
      tiers: [
        { heightMm: 861, kind: 'door', doorCount: 1, drawerCount: 0, label: '하부장' },
        { heightMm: 979, kind: 'door', doorCount: 1, drawerCount: 0, label: '중간장' },
        { heightMm: 460, kind: 'door', doorCount: 1, drawerCount: 0, label: '상부장' },
      ],
    });
  });

  test('냉장고장 통 = 냉장고 자리(바닥~1885) + 위 박스 2도어, 가전 목록에 fridge', () => {
    const { spec } = traceOf();
    // 2026-10-19 (C-1): 싱크대 + 키큰장 + 냉장고장 주방은 품목 sink (예전 fridge — TASK 가 "refrigerator surround" 였다)
    expect(spec.category).toBe('sink');
    expect(spec.sections.tall.modules[1]).toEqual({
      widthMm: 680, kind: 'appliance', doorCount: 2, drawerCount: 0, label: '냉장고장',
      tiers: [
        { heightMm: 1885, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '냉장고' },
        { heightMm: 415, kind: 'door', doorCount: 2, drawerCount: 0, label: '상부장' },
      ],
    });
    expect(spec.appliances).toEqual([
      { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
      { kind: 'fridge', fromLeftMm: 2420, widthMm: 680 },
    ]);
  });

  test('구간 높이·런 폭이 통 기준 — 2300 (단 하나의 979 가 아니다), 런 3120 (4280 이 아니다)', () => {
    const { spec } = traceOf();
    expect(spec.sections.tall).toMatchObject({ widthMm: 1300, heightMm: 2300, depthMm: 700, fromLeftMm: 1800 });
    expect(spec.wallRunMm).toBe(3120);
  });

  test('바닥 높이 — 페이지 baseYOf 가 있으면 그것으로 쌓고, 냉장고 자리 통은 바닥(0)에서 선다', () => {
    const base = { 'tall-0': 0, 'tall-1': 861, 'tall-2': 1840, 'fridge-0': 1885, 'upper-0': 1520, 'upper-1': 1520 };
    const mods = siteModules().map((m) => Object.assign({}, m, { baseY: undefined }));   // 모듈엔 없고 페이지만 안다
    const { spec } = traceOf(mods, { baseYOf: (m) => (m.id in base ? base[m.id] : 0) });
    expect(spec.sections.tall.fromFloorMm).toBe(0);
    expect(spec.sections.tall.modules[0].tiers.map((t) => t.heightMm)).toEqual([861, 979, 460]);
    expect(spec.sections.tall.modules[1].tiers[0]).toMatchObject({ kind: 'appliance', heightMm: 1885 });
    // 냉장고장만 있는 도면도 줄 아랫면은 바닥
    const only = traceOf([mods.find((m) => m.id === 'fridge-0')], { baseYOf: () => 1885 }).spec;
    expect(only.sections.tall).toMatchObject({ fromFloorMm: 0, heightMm: 2300 });
  });

  test('냉장고 본체가 그 자리에 놓여 있으면 통에 들어간다 — 따로 세우지 않고, 가전은 본체 하나', () => {
    const mods = siteModules().concat([
      { id: 'refrigerator-0', section: 'refrigerator', W: 595, H: 1870, D: 700, x: 2462, y: 0, rotation: 0 },
    ]);
    const r = traceOf(mods);
    expect(r.spec.sections.tall.modules.map((m) => [m.widthMm, m.kind])).toEqual([[600, 'door'], [680, 'appliance']]);
    expect(r.spec.appliances.filter((a) => a.kind === 'fridge')).toEqual([{ kind: 'fridge', fromLeftMm: 2462, widthMm: 595 }]);
    expect(r.trace.tall[1]).toEqual({ moduleId: 'refrigerator-0', moduleIds: ['refrigerator-0', 'fridge-0'], from: 0, to: 1 });
  });

  test('통 안에 서랍 단이 섞이면 통 kind 는 drawer, 단마다 제 kind', () => {
    const mods = [
      { id: 't0', section: 'tall', W: 900, H: 700, D: 650, x: 0, baseY: 0 },
      { id: 't1', section: 'tall', W: 900, H: 1600, D: 650, x: 0, baseY: 700 },
    ];
    const structs = { t0: struct({ verticalCount: 2, areaTypes: ['drawer', 'open'] }), t1: two };
    const { spec } = A.plannerAiPhotoSpecTrace({ modules: mods, structureOf: (id) => structs[id] });
    expect(spec.sections.tall.modules[0]).toMatchObject({ kind: 'drawer', doorCount: 2, drawerCount: 1, label: '키큰장 2단' });
    expect(spec.sections.tall.modules[0].tiers.map((t) => [t.kind, t.doorCount, t.drawerCount, t.label]))
      .toEqual([['drawer', 0, 1, '2칸'], ['door', 2, 0, '양문']]);
  });
});

describe('쌓인 것이 없으면 예전 그대로', () => {
  test('바닥에 선 냉장고장 한 장(baseY 없음)·가로로 나란한 키큰장 — tiers 없음', () => {
    const { spec } = A.plannerAiPhotoSpecTrace({
      modules: [
        { id: 'tall-0', section: 'tall', W: 600, H: 2300, D: 650, x: 0 },
        { id: 'tall-1', section: 'tall', W: 600, H: 2300, D: 650, x: 600 },
        { id: 'fridge-0', section: 'fridge', W: 900, H: 2300, D: 700, x: 1200 },
      ],
      structureOf: () => struct(),
    });
    spec.sections.tall.modules.forEach((m) => expect('tiers' in m).toBe(false));
    expect(spec.sections.tall.modules.map((m) => m.widthMm)).toEqual([600, 600, 900]);
    expect(spec.appliances).toEqual([]);
  });

  test('같은 x·폭이라도 겹쳐 선 모듈은 쌓인 것이 아니다 — 하나씩', () => {
    const { spec } = A.plannerAiPhotoSpecTrace({
      modules: [
        { id: 'a', section: 'tall', W: 600, H: 2000, D: 650, x: 0, baseY: 0 },
        { id: 'b', section: 'tall', W: 600, H: 900, D: 650, x: 0, baseY: 1000 },
      ],
      structureOf: () => struct(),
    });
    expect(spec.sections.tall.modules).toHaveLength(2);
    spec.sections.tall.modules.forEach((m) => expect('tiers' in m).toBe(false));
  });
});

describe('번호 입면 — 통 하나에 번호 하나', () => {
  test('T1 = 키큰장 세 단, T2 = 냉장고장 — 워커 프롬프트의 번호·폭과 같다', () => {
    const r = traceOf();
    const plan = A.plannerAiPhotoElevationLabels(r.spec, r.trace);
    const tall = plan.rows.find((x) => x.key === 'tall');
    expect(tall).toMatchObject({ prefix: 'T', widthMm: 1300, heightMm: 2300 });
    expect(tall.items).toEqual([
      { id: 'T1', moduleId: 'tall-0', moduleIds: ['tall-0', 'tall-1', 'tall-2'], from: 0, to: 1, widthMm: 600 },
      { id: 'T2', moduleId: 'fridge-0', moduleIds: ['fridge-0'], from: 0, to: 1, widthMm: 680 },
    ]);
    // 하부·상부 칸은 moduleIds 가 없다 (예전 모양)
    plan.rows.filter((x) => x.key !== 'tall').forEach((row) => row.items.forEach((it) => expect('moduleIds' in it).toBe(false)));
    const ids = [].concat(...plan.rows.map((x) => x.items.map((it) => [it.id, it.widthMm])));
    const w = workerIds(r.spec);
    expect(ids).toEqual(w.out);
    // 그리고 그 워커 프롬프트가 통을 말한다
    expect(w.prompt).toContain('T1   600 mm  tall column — 3 stacked doors (bottom 861 mm, middle 979 mm, top 460 mm)');
    expect(w.prompt).toContain('T2   680 mm  refrigerator opening (keep it open from the floor up to 1885 mm');
  });

  test('planner-capture — moduleIds 를 다듬어 넘기고, 칸 상자는 그 모듈 상자들을 합친 것', () => {
    const plan = C.plannerCaptureAnnotatePlan({ rows: [
      { key: 'tall', widthMm: 1300, heightMm: 2300, items: [
        { id: 'T1', moduleId: 'tall-0', moduleIds: ['tall-0', 'tall-1', '', null, 'tall-2'], widthMm: 600 },
        { id: 'T2', moduleId: 'fridge-0', moduleIds: [], widthMm: 680 },
      ] },
    ] });
    expect(plan.rows[0].items[0].moduleIds).toEqual(['tall-0', 'tall-1', 'tall-2']);
    expect('moduleIds' in plan.rows[0].items[1]).toBe(false);
    const boxes = {
      'tall-0': { x0: 100, x1: 400, y0: 900, y1: 1300 },
      'tall-1': { x0: 100, x1: 400, y0: 500, y1: 900 },
      'tall-2': { x0: 101, x1: 399, y0: 300, y1: 500 },
      'fridge-0': { x0: 400, x1: 740, y0: 300, y1: 480 },
    };
    const L = C.plannerCaptureAnnotationLayout(plan, boxes, 1300, 1536);
    expect(L.items.map((x) => [x.id, x.cx, x.cy])).toEqual([['T1', 250, 800], ['T2', 570, 390]]);
    expect(L.items[0].box).toEqual({ x0: 100, x1: 400, y0: 300, y1: 1300 });
    // 높이 치수선은 통 전체 (300~1300)
    const h = L.texts.find((t) => t.text === '2300');
    expect(h.y).toBe(800);
    // 찾은 상자만 합친다 · 하나도 없으면 그 칸은 건너뛴다
    expect(C.plannerCaptureUnionBox([null, boxes['tall-1'], undefined])).toEqual(boxes['tall-1']);
    expect(C.plannerCaptureUnionBox([null])).toBeNull();
    const miss = C.plannerCaptureAnnotationLayout(plan, { 'fridge-0': boxes['fridge-0'] }, 1300, 1536);
    expect(miss.items.map((x) => x.id)).toEqual(['T2']);
  });
});

describe('계약 — 보내는 키가 문서에 있다', () => {
  test('tiers 와 그 안의 키가 design-spec-prompt.md "## 필드" 에 있다', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', '02-design', 'features', 'design-spec-prompt.md'), 'utf8')
      .split('\r\n').join('\n');
    const body = md.slice(md.indexOf('\n## 필드'), md.indexOf('\n## 검증'));
    const names = new Set();
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(body))) String(m[1]).split(/[^A-Za-z0-9_]+/).forEach((t) => t && names.add(t));
    const keys = new Set();
    const walk = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach(walk); return; }
      Object.keys(v).forEach((k) => { keys.add(k); walk(v[k]); });
    };
    walk(traceOf().spec);
    expect(keys.has('tiers')).toBe(true);
    expect([...keys].filter((k) => !names.has(k))).toEqual([]);
  });
});
