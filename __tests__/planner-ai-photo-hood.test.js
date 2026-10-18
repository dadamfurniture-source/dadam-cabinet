/**
 * 2026-10-19: 후드 칸 — 디테일 패널 도면 요약(design_spec 상부 modules[] 의 후드 칸)과 번호 입면.
 * 계약: docs/02-design/features/design-spec-prompt.md "후드 칸" (워커 #852).
 *
 * 실측 (2026-10-19 GPT, 시드 evalh1): 하부 800·600·800, 상부 U1 800(x0) | 후드 600(x800) | U2 800(x1400).
 * 요약이 상부를 [800, 800] 으로만 보내 워커가 U2 를 x800 에 이어 놓았고, 후드가 U2 밑으로 갔다.
 *
 * 고정하는 것:
 *   · 상부장과 x 가 겹치지 않는 후드 = 상부 줄 안의 후드 칸 { kind:'appliance', label:'후드' } — 이웃 상부장 사이 틈 전체
 *   · 상부장 밑에 겹치는 후드(내장형) = 칸 없음 (예전 그대로)
 *   · 줄 끝의 후드 = 후드 폭만큼 · 상부장이 없으면 칸 없음
 *   · 구간 깊이는 후드 마커 깊이를 섞지 않는다
 *   · 번호 입면: U1 · H1 · U2 — 워커 buildPlannerPrompt 의 번호와 같다
 */
const fs = require('fs');
const path = require('path');
const A = require('../js/planner/ai-photo');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadEsm('workers/generate-api/src/prompts.js', ['buildPlannerPrompt', 'normalizeDesignSpec']);

const two = { verticalCount: 1, areaTypes: ['door'], areaDirections: ['left'], areaWidths: [], areaIs2D: [true] };

/** 시드 evalh1 의 구조 모듈 (페이지 modules 와 같은 모양) */
function seedModules(hoodX = 800) {
  return [
    { id: 'lower-0', section: 'lower', W: 800, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
    { id: 'lower-1', section: 'lower', W: 600, H: 870, D: 650, x: 800, y: 0, rotation: 0 },
    { id: 'lower-2', section: 'lower', W: 800, H: 870, D: 650, x: 1400, y: 0, rotation: 0 },
    { id: 'upper-3', section: 'upper', W: 800, H: 780, D: 320, x: 0, y: 0, rotation: 0 },
    { id: 'hood-6', section: 'hood', W: 600, H: 400, D: 450, x: hoodX, y: 0, rotation: 0 },
    { id: 'upper-4', section: 'upper', W: 800, H: 780, D: 320, x: 1400, y: 0, rotation: 0 },
    { id: 'sink-5', section: 'sink', W: 600, H: 500, D: 400, x: 1500, y: 0, rotation: 0 },
  ];
}
const STRUCT = { 'lower-0': two, 'lower-1': two, 'lower-2': two, 'upper-3': two, 'upper-4': two };
const baseYOf = (m) => (m.section === 'upper' ? 2300 - m.H : m.section === 'hood' ? 2300 - m.H : 0);
const traceOf = (mods = seedModules()) =>
  A.plannerAiPhotoSpecTrace({ modules: mods, structureOf: (id) => STRUCT[id] || null, baseYOf, ceilingMm: 2300 });

describe('후드 칸 — 도면 요약', () => {
  test('상부장 사이 노출 후드 → 상부 줄 [800, 후드 600, 800], 가전 목록에도 hood', () => {
    const { spec } = traceOf();
    const up = spec.sections.upper;
    expect(up.modules.map((m) => [m.widthMm, m.kind, m.label])).toEqual([
      [800, 'door', '양문'],
      [600, 'appliance', '후드'],
      [800, 'door', '양문'],
    ]);
    expect(up.modules[1]).toEqual({ widthMm: 600, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '후드' });
    expect([up.widthMm, up.fromLeftMm, up.depthMm, up.heightMm, up.fromFloorMm]).toEqual([2200, 0, 320, 780, 1520]);
    expect(spec.appliances).toEqual([
      { kind: 'hood', fromLeftMm: 800, widthMm: 600 },
      { kind: 'sink', fromLeftMm: 1500, widthMm: 600 },
    ]);
    expect(spec.wallRunMm).toBe(2200);
    expect(A.plannerAiPhotoIsHoodCell(up.modules[1])).toBe(true);
    expect(A.plannerAiPhotoIsHoodCell(up.modules[0])).toBe(false);
  });

  test('후드가 틈보다 좁으면 칸은 이웃 상부장 사이 틈 전체 (워커가 뒤 장을 당기지 않게)', () => {
    const mods = seedModules();
    mods.find((m) => m.id === 'hood-6').W = 500;
    mods.find((m) => m.id === 'hood-6').x = 850;
    const up = traceOf(mods).spec.sections.upper;
    expect(up.modules.map((m) => m.widthMm)).toEqual([800, 600, 800]);
  });

  test('상부장 밑에 겹치는 후드(내장형)는 칸이 아니다 — 예전 그대로', () => {
    const mods = seedModules(1500).filter((m) => m.id !== 'upper-4');
    mods.push({ id: 'upper-4', section: 'upper', W: 1400, H: 780, D: 320, x: 800, y: 0, rotation: 0 });
    const up = traceOf(mods).spec.sections.upper;
    expect(up.modules.map((m) => m.label)).toEqual(['양문', '양문']);
    expect(A.plannerAiPhotoHoodCells([{ m: { section: 'hood' }, b: { x: 900, w: 600 } }], [{ m: {}, b: { x: 800, w: 1400 } }])).toEqual([]);
  });

  test('줄 끝 후드는 후드 폭만큼, 상부장이 없으면 칸 없음', () => {
    const ups = [{ m: {}, b: { x: 0, w: 800 } }];
    expect(A.plannerAiPhotoHoodCells([{ m: { id: 'h', section: 'hood' }, b: { x: 800, w: 600 } }], ups))
      .toEqual([{ m: { id: 'h', section: 'hood' }, b: { x: 800, w: 600 }, hoodCell: true }]);
    expect(A.plannerAiPhotoHoodCells([{ m: { section: 'hood' }, b: { x: 800, w: 600 } }], [])).toEqual([]);
    expect(A.plannerAiPhotoHoodCells([{ m: { section: 'hood' }, b: { x: 800, w: 600 } }], undefined)).toEqual([]);
    const mods = seedModules().filter((m) => m.section !== 'upper');
    const { spec } = traceOf(mods);
    expect(spec.sections.upper).toBeUndefined();
    expect(spec.appliances.map((a) => a.kind)).toEqual(['hood', 'sink']);
  });
});

describe('후드 칸 — 번호 입면 · 워커 번호', () => {
  test('U1 · H1 · U2 — 후드 칸은 후드 모듈에 라벨이 선다', () => {
    const { spec, trace } = traceOf();
    const plan = A.plannerAiPhotoElevationLabels(spec, trace);
    const up = plan.rows.find((r) => r.key === 'upper');
    expect(up.items.map((it) => [it.id, it.moduleId])).toEqual([['U1', 'upper-3'], ['H1', 'hood-6'], ['U2', 'upper-4']]);
    expect(plan.rows.find((r) => r.key === 'lower').items.map((it) => it.id)).toEqual(['L1', 'L2', 'L3']);
  });

  test('워커 프롬프트의 번호와 같다 — U1 | H1 | U2, 후드 밑 L2 에 쿡탑', () => {
    const { spec, trace } = traceOf();
    const plan = A.plannerAiPhotoElevationLabels(spec, trace);
    const ids = plan.rows.flatMap((r) => r.items.map((it) => it.id));
    const p = P.buildPlannerPrompt({ category: 'sink', designSpec: P.normalizeDesignSpec(spec, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
    const said = [...p.matchAll(/^ {4}([LUTH]\d+) /gm)].map((m) => m[1]);
    expect(said).toEqual(ids);
    expect(p).toMatch(/H1 {3}600 mm {2}range hood — not a cabinet/);
    expect(p).toMatch(/L2 {3}600 mm {2}2-door cabinet, flush induction cooktop on the countertop, directly under the hood H1/);
  });
});
