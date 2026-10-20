/**
 * 2026-10-20: 고른 냉장고 모델 → design_spec appliances[].model (사장님 결정 2026-10-20 — 냉장고가 특정되면 그 냉장고를 보여 준다).
 * 계약: docs/02-design/features/design-spec-prompt.md "냉장고 모델".
 *
 * 흐름: 배치 단계(mockup-shell.html W9-44)에서 모델을 고르면 냉장고 사각형에 fridgeModel 이 실린다
 *   → 배치 저장(dadam_layout_v1 modules[].fridgeModel) → 구조 단계 영역(area.fridgeModel)
 *   → PlannerAiPhoto.mount 의 fridgeModelOf(모듈) — 그 모듈과 평면이 겹치는 냉장고 영역의 모델.
 *
 * 고정하는 것:
 *   · 냉장고장 냉장고 자리(본체 없음)의 fridge 가전에 model — fridgeModelOf(통의 맨 아래 단)
 *   · 냉장고 본체가 놓여 있으면 그 본체의 fridge 가전에 model — fridgeModelOf(본체)
 *   · 다듬기: 이름·코드 둘 다 없으면 키 없음, 글자 자르기, mm 정수, 모르는 subtype 버림
 *   · fridgeModelOf 가 없거나 던지면 예전 그대로 (키 없음)
 *   · 워커가 그 모델로 T2 줄을 만든다
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

const struct = (o = {}) => Object.assign({
  verticalCount: 1, areaTypes: ['door'], areaWidths: [], areaIs2D: [false], horizontalLayout: 'doorOnly',
}, o);
const two = struct({ areaIs2D: [true] });

/** planner-ai-photo-tiers 의 사이트 도면 — 키큰장 세 단 + 냉장고장(냉장고 자리 1885 + 위 박스) */
function siteModules() {
  return [
    { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
    { id: 'lower-1', section: 'lower', W: 900, H: 870, D: 650, x: 900, y: 0, rotation: 0 },
    { id: 'tall-0', section: 'tall', W: 600, H: 861, D: 650, x: 1800, y: 0, rotation: 0, baseY: 0, part: '하부장' },
    { id: 'tall-1', section: 'tall', W: 600, H: 979, D: 650, x: 1800, y: 0, rotation: 0, baseY: 861, part: '중간장' },
    { id: 'tall-2', section: 'tall', W: 600, H: 460, D: 650, x: 1800, y: 0, rotation: 0, baseY: 1840, part: '상부장' },
    { id: 'fridge-0', section: 'fridge', W: 680, H: 415, D: 700, x: 2400, y: 0, rotation: 0, baseY: 1885, part: '상부장' },
  ];
}
const STRUCT = {
  'lower-0': two, 'lower-1': two, 'tall-0': struct(), 'tall-1': struct(), 'tall-2': struct(), 'fridge-0': two,
};

/** 배치에서 고른 모델 (mockup-shell 이 냉장고 사각형에 싣는 모양) */
const PICKED = {
  brand: '삼성', name: 'BESPOKE 1도어 키친핏 409L', code: 'RR40C7805AP',
  widthMm: 595, heightMm: 1853, depthMm: 700, subtype: 'one_door',
};

const traceOf = (mods, extra = {}) => A.plannerAiPhotoSpecTrace(Object.assign({
  modules: mods, structureOf: (id) => STRUCT[id] || null,
}, extra));

const fridgeApps = (spec) => spec.appliances.filter((a) => a.kind === 'fridge');

describe('냉장고 모델 → appliances[].model', () => {
  test('냉장고장 냉장고 자리(본체 없음) — 통의 맨 아래 단으로 물어 모델을 싣는다', () => {
    const asked = [];
    const { spec } = traceOf(siteModules(), {
      fridgeModelOf: (m) => { asked.push(m.id); return m.id === 'fridge-0' ? PICKED : null; },
    });
    expect(fridgeApps(spec)).toEqual([{ kind: 'fridge', fromLeftMm: 2400, widthMm: 680, model: PICKED }]);
    expect(asked).toEqual(['fridge-0']);
  });

  test('냉장고 본체가 놓여 있으면 본체로 물어 그 가전에 싣는다 (가전은 하나)', () => {
    const mods = siteModules().concat([
      { id: 'refrigerator-0', section: 'refrigerator', W: 595, H: 1870, D: 700, x: 2442, y: 0, rotation: 0 },
    ]);
    const { spec } = traceOf(mods, { fridgeModelOf: (m) => (m.id === 'refrigerator-0' ? PICKED : null) });
    expect(fridgeApps(spec)).toEqual([{ kind: 'fridge', fromLeftMm: 2442, widthMm: 595, model: PICKED }]);
  });

  test('다듬기 — 글자 자르기·mm 정수·모르는 subtype 버림, 이름·코드가 없으면 키 없음', () => {
    const odd = { brand: ' 삼성 ', name: 'x'.repeat(120), widthMm: '595.4', heightMm: null, depthMm: 'deep', subtype: 'rocket', extra: 1 };
    expect(A.plannerAiPhotoFridgeModel(odd)).toEqual({ brand: '삼성', name: 'x'.repeat(80), widthMm: 595 });
    expect(A.plannerAiPhotoFridgeModel({ brand: 'LG', widthMm: 900 })).toBeNull();
    expect(A.plannerAiPhotoFridgeModel('RR40')).toBeNull();
    expect(A.plannerAiPhotoFridgeModel(null)).toBeNull();
    const { spec } = traceOf(siteModules(), { fridgeModelOf: () => ({ brand: 'LG' }) });
    expect(fridgeApps(spec)).toEqual([{ kind: 'fridge', fromLeftMm: 2400, widthMm: 680 }]);
  });

  test('fridgeModelOf 가 없거나 던지면 예전 그대로 — model 키 없음', () => {
    expect(fridgeApps(traceOf(siteModules()).spec)).toEqual([{ kind: 'fridge', fromLeftMm: 2400, widthMm: 680 }]);
    const { spec } = traceOf(siteModules(), { fridgeModelOf: () => { throw new Error('boom'); } });
    expect(fridgeApps(spec)).toEqual([{ kind: 'fridge', fromLeftMm: 2400, widthMm: 680 }]);
  });

  test('냉장고가 아닌 가전(싱크)에는 묻지 않는다', () => {
    const mods = siteModules().concat([{ id: 'sink-0', section: 'sink', W: 700, H: 500, D: 400, x: 900, y: 0, rotation: 0 }]);
    const asked = [];
    traceOf(mods, { fridgeModelOf: (m) => { asked.push(m.id); return PICKED; } });
    expect(asked).toEqual(['fridge-0']);
  });

  test('PlannerAiPhoto.mount 의 fridgeModelOf 가 요약까지 간다', () => {
    const ap = Object.create(A.PlannerAiPhoto);
    ap.mount({
      modules: () => siteModules(),
      structureOf: (id) => STRUCT[id] || null,
      fridgeModelOf: (m) => (m.id === 'fridge-0' ? PICKED : null),
      detail: () => null,
    });
    expect(fridgeApps(ap.spec())[0].model).toEqual(PICKED);
  });

  test('워커가 그 모델로 냉장고 자리 줄을 만든다', () => {
    const { spec } = traceOf(siteModules(), { fridgeModelOf: (m) => (m.id === 'fridge-0' ? PICKED : null) });
    const ds = P.normalizeDesignSpec(spec, spec.category);
    const prompt = P.buildPlannerPrompt({ category: spec.category, designSpec: ds, wallW: 0, wallH: 0 });
    expect(prompt).toContain('T2   680 mm  refrigerator opening (open from the floor up to 1885 mm');
    expect(prompt).toContain('otherwise draw this refrigerator: Samsung BESPOKE 409L, model RR40C7805AP, 595 × 1853 × 700 mm (W × H × D), single-door type)');
  });
});

describe('계약 — 보내는 키가 문서에 있다', () => {
  test('model 과 그 안의 키가 design-spec-prompt.md 에 있다', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs/02-design/features/design-spec-prompt.md'), 'utf8');
    expect(doc).toContain('#### `appliances[].model`');
    ['brand', 'name', 'code', 'widthMm', 'heightMm', 'depthMm', 'subtype'].forEach((k) => expect(doc).toContain(`\`${k}\``));
  });
});
