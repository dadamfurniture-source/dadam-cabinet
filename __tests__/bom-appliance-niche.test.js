/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 가전 칸 — 고른 가전에 맞춘 단 높이 · 빌트인 오븐장 · 냉장고 위장 선반 (2026-10-30 사장님, docs/design-rules/sink.md §5.1 · fridge.md).
 *
 *   「가전에 맞춰 단 높이」   전자레인지 · 니치 없는 오븐: 내경 = 가전 H + 위 여유(제조사 값, 없으면 20), 상자 = 내경 + 18 × 2
 *                             빌트인 오븐(니치 W · H 가 있는 오븐): 내경 = 니치 H, 상자 = 내경 + 15 × 2
 *                             밥솥: 내경 = 밥솥 H + 선반 · 레일 70 (최소 400), 상자 = 내경 + 18 × 2
 *   빌트인 오븐장             "오픈장을 15T로" — PB 15T, 뒷판 = 15T 통판(측판 사이) 높이 절반 ("반은 뚫려있게", 아래 절반 [확인 필요])
 *   냉장고 위장 선반 「0장」  구조 선반 수 그대로 (플래너 calcDefaultShelves('fridge') = 없음)
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const OC = require('../js/detaildesign/bom-open-cabinet-rules.js');
const RC = require('../js/detaildesign/bom-rice-cabinet-rules.js');
const engine = require('../js/planner/planner-engine.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');

const BI = OC.RULES.BUILTIN_OVEN;
const SPECS = Object.assign({}, LEDGER_SPECS, { handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 });

describe('규칙 파일 — 가전 칸 상자 높이', () => {
  test('전자레인지: 내경 = 가전 H + 20 (여유가 없으면), 상자 = 내경 + 18 × 2', () => {
    expect(OC.applianceBoxOf({ category: 'microwave', h: 300 })).toEqual({ builtinOven: false, T: 18, innerH: 320, H: 356 });
  });
  test('제조사 위 여유가 있으면 그 값', () => {
    expect(OC.applianceBoxOf({ category: 'microwave', h: 300, topGap: 100 })).toMatchObject({ innerH: 400, H: 436 });
    expect(OC.applianceBoxOf({ category: 'microwave', h: 300, topGap: 0 })).toMatchObject({ innerH: 300, H: 336 });
  });
  test('니치가 있는 오븐 = 빌트인 오븐장 — 내경 = 니치 H, 상자 = + 15 × 2', () => {
    const app = { category: 'oven', h: 595, nicheW: 560, nicheH: 590 };
    expect(OC.isBuiltinOvenModel(app)).toBe(true);
    expect(OC.applianceBoxOf(app)).toEqual({ builtinOven: true, T: 15, innerH: 590, H: 620 });
  });
  test('니치가 없는 오븐 · 니치가 한쪽만 있는 오븐 · 니치가 있는 전자레인지는 오픈장', () => {
    expect(OC.applianceBoxOf({ category: 'oven', h: 400 })).toMatchObject({ builtinOven: false, H: 456 });
    expect(OC.isBuiltinOvenModel({ category: 'oven', h: 400, nicheW: 560 })).toBe(false);
    expect(OC.isBuiltinOvenModel({ category: 'microwave', h: 400, nicheW: 560, nicheH: 450 })).toBe(false);
  });
  test('가전 높이를 모르면 null (지어내지 않는다)', () => {
    expect(OC.applianceBoxOf({ category: 'microwave' })).toBeNull();
    expect(OC.applianceBoxOf(null)).toBeNull();
  });
  test('밥솥: 내경 = 밥솥 H + 70, 최소 내경 400 보다 낮으면 400', () => {
    expect(RC.cookerBoxOf({ h: 336 })).toEqual({ innerH: 406, H: 442, T: 18 });
    expect(RC.cookerBoxOf({ h: 250 })).toEqual({ innerH: RC.RULES.MIN_INNER.H, H: 436, T: 18 });
    expect(RC.cookerBoxOf({})).toBeNull();
    // 맞춘 상자는 밥솥장 경고(최소 내경)에도 밥솥 경고에도 걸리지 않는다
    const box = { W: 600, H: RC.cookerBoxOf({ h: 336 }).H, D: 560 };
    expect(RC.warningsOf(box)).toEqual([]);
    expect(RC.cookerWarningsOf(box, { w: 300, h: 336, d: 400 })).toEqual([]);
  });
  test('하부 밥솥장(밑 서랍 — 내경 392)에 336 밥솥은 높이 경고, 300 은 들어간다', () => {
    const box = { W: 450, H: 428, D: 550 };
    expect(RC.cookerWarningsOf(box, { h: 336 }, '쿠쿠 대용량')).toEqual(['밥솥장 내경 높이 392 가 쿠쿠 대용량 높이 336 + 선반 · 레일 70 = 406 보다 낮습니다']);
    expect(RC.cookerWarningsOf(box, { h: 300 })).toEqual([]);
    expect(RC.cookerWarningsOf(box, { w: 420, h: 300, d: 600 })).toHaveLength(2);
  });
});

describe('규칙 파일 — 빌트인 오븐장 (PB 15T · 뒷판 절반)', () => {
  const box = { W: 600, H: 620, D: 560, builtinOven: true };
  test('부재 — 측판 D × H 2 · 천지판 (W − 30) × (D − 17) 2 · 뒷판 (W − 30) × ⌊H/2⌋ 1, 전부 PB 15T', () => {
    const parts = OC.partsOf(box);
    expect(parts.map((p) => [p.part, p.material, p.t, p.w, p.h, p.qty])).toEqual([
      ['측판', 'PB', 15, 560, 620, 2],
      ['천지판', 'PB', 15, 570, 543, 2],
      ['뒷판', 'PB', 15, 570, 310, 1],
    ]);
    expect(parts[2].note).toMatch(/높이 절반 \(아래\)/);
    expect(OC.innerOf(box)).toMatchObject({ T: 15, innerW: 570, innerH: 590, innerD: 543, backH: 310, backY: 0 });
    expect(BI.BACK_AT).toBe('bottom');
    expect(OC.innerOf({ W: 600, H: 621, D: 560, builtinOven: true }).backH).toBe(310);   // 내림
  });
  test('표시가 없는 오픈장은 예전 그대로 (18T MDF · 뒷판 전체 높이)', () => {
    expect(OC.partsOf({ W: 500, H: 450, D: 570 }).map((p) => [p.part, p.material, p.t, p.w, p.h, p.qty])).toEqual([
      ['측판', 'MDF', 18, 570, 450, 2], ['천지판', 'MDF', 18, 464, 550, 2], ['뒷판', 'MDF', 18, 464, 450, 1],
    ]);
    expect(OC.partsOf({ W: 500, H: 450, D: 570 }).some((p) => 'note' in p)).toBe(false);
    expect(OC.isBuiltinOven({ moduleKind: 'open' })).toBe(false);
  });
  test('경고 — 빌트인은 니치 (폭 · 높이), 그 밖은 외경 + 여유', () => {
    expect(OC.applianceWarningsOf(box, { nicheW: 560, nicheH: 590, W: 595, H: 595, D: 570 })).toEqual([]);
    expect(OC.applianceWarningsOf(box, { nicheW: 575, nicheH: 600 }, '오븐 A')).toEqual([
      '빌트인 오븐장 내경 폭 570 가 오븐 A 설치 공간 폭 575 보다 작습니다',
      '빌트인 오븐장 내경 높이 590 가 오븐 A 설치 공간 높이 600 보다 작습니다',
    ]);
    expect(OC.warningsOf({ W: 20, H: 620, D: 560, builtinOven: true })[0]).toMatch(/^빌트인 오븐장 폭 20 는 측판 두께\(30\)/);
  });
  test('맞춘 상자는 고른 가전에 경고가 없다', () => {
    const mw = { category: 'microwave', W: 480, H: 280, D: 380, h: 280 };
    const b = OC.applianceBoxOf(mw);
    expect(OC.applianceWarningsOf({ W: 600, H: b.H, D: 560 }, mw)).toEqual([]);
    const ov = { category: 'oven', h: 595, nicheW: 560, nicheH: 590 };
    const bo = OC.applianceBoxOf(ov);
    expect(OC.applianceWarningsOf({ W: 600, H: bo.H, D: 560, builtinOven: true }, ov)).toEqual([]);
  });
});

/** 키큰장 가운데 단 하나 — 구조가 정한 상자 (모듈 라이브러리가 내는 단 구조 모양: 다리발 · 좌대 · 상몰딩 0) */
function tallTier(structure, H) {
  const modules = [{ id: 't', section: 'tall', W: 600, H, D: 560, x: 0, y: 70, areaH: 2300, isFixed: true }];
  const structures = { t: Object.assign({ legH: 0, pedestalH: 0, moldingH: 0, shelves: [] }, structure) };
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
  const item = { categoryId: 'sink', w: 600, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const spec = Asm.of({ items: [item] }, { materials, hardware });
  return { conv, materials, spec, mod: conv.modules[0] };
}

describe('배선 — 구조 → 브리지 → BOM → 조립', () => {
  const OVEN = { category: 'oven', name: '오븐 A', w: 595, h: 595, d: 570, nicheW: 560, nicheH: 590 };
  test('빌트인 오븐장: 브리지 표시 · 이름, BOM PB 15T 세 줄, 조립 뒷판 밑단 0 · 높이 절반, 검사 오류 없음', () => {
    const H = OC.applianceBoxOf(OVEN).H;
    const r = tallTier({ moduleKind: 'open', builtinOven: true, appliance: OVEN }, H);
    expect(r.mod).toMatchObject({ moduleKind: 'open', builtinOven: true, name: BI.LABEL, h: H, doorCount: 0 });
    expect(r.conv.warnings.filter((w) => /설치 공간/.test(w))).toEqual([]);
    const body = r.materials.filter((m) => ['측판', '천지판', '뒷판'].includes(m.part));
    expect(body.map((m) => [m.part, m.material, m.thickness, m.w, m.h, m.qty])).toEqual([
      ['측판', 'PB', 15, 560, 620, 2], ['천지판', 'PB', 15, 570, 543, 2], ['뒷판', 'PB', 15, 570, 310, 1],
    ]);
    expect(body[0].module).toMatch(/빌트인 오븐장/);
    const m = r.spec.items[0].modules[0];
    const back = m.parts.find((p) => p.part === '뒷판');
    expect(back.frame.o[1]).toBe(0);
    expect(back.cut.h).toBe(310);
    expect(back.box.max[1] - back.box.min[1]).toBe(310);
    expect(r.spec.unplaced.filter((u) => u.moduleKey === m.moduleKey)).toEqual([]);   // 줄 부재(run-part)는 lines 가 없어 빠진다
    expect(Check.check(r.spec).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  test('니치보다 작은 상자는 브리지가 경고한다', () => {
    const r = tallTier({ moduleKind: 'open', builtinOven: true, appliance: OVEN }, 600);
    expect(r.conv.warnings.some((w) => /설치 공간 높이 590/.test(w))).toBe(true);
  });
  test('전자레인지 오픈장: 표시가 없으면 payload 는 예전과 같다 (builtinOven 없음 · 18T MDF), 맞춘 높이에 경고 없음', () => {
    const MW = { category: 'microwave', name: '전자레인지 A', w: 480, h: 280, d: 380 };
    const H = OC.applianceBoxOf(MW).H;
    const r = tallTier({ moduleKind: 'open', appliance: MW }, H);
    expect('builtinOven' in r.mod).toBe(false);
    expect(r.mod.name).toBe(OC.RULES.LABEL);
    expect(r.materials.filter((m) => m.part === '뒷판').map((m) => [m.material, m.thickness, m.h])).toEqual([['MDF', 18, H]]);
    expect(r.conv.warnings.filter((w) => /전자레인지 A/.test(w))).toEqual([]);
    const small = tallTier({ moduleKind: 'open', appliance: MW }, 300);
    expect(small.conv.warnings.some((w) => /전자레인지 A 높이 280/.test(w))).toBe(true);
  });
  test('밥솥장: 고른 밥솥이 안 들어가면 브리지 경고', () => {
    const r = tallTier({ moduleKind: 'rice', appliance: { category: 'rice_cooker', name: '밥솥 A', w: 300, h: 336, d: 400 } }, 436);
    expect(r.conv.warnings.some((w) => /밥솥 A 높이 336/.test(w))).toBe(true);
    const ok = tallTier({ moduleKind: 'rice', appliance: { category: 'rice_cooker', name: '밥솥 A', w: 300, h: 336, d: 400 } }, RC.cookerBoxOf({ h: 336 }).H);
    expect(ok.conv.warnings.filter((w) => /밥솥 A/.test(w))).toEqual([]);
  });
});

describe('냉장고 위장 선반 「0장」 — 구조 그대로', () => {
  const doors = (W, extra) => Object.assign({
    moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['up'],
    areaWidths: [W], areaIs2D: [false],
  }, extra || {});
  function shelvesOf(section, structure) {
    const modules = [{ id: 'f', section, W: 720, H: 450, D: 675, x: 0, y: 0, areaH: 2300 }];
    const conv = loadConverter()._convertPlannerModules({ modules, structures: { f: structure }, hasStructures: true }, Object.assign({}, SPECS));
    const item = { categoryId: 'fridge', w: 720, h: 2300, d: 700, specs: Object.assign({}, SPECS), modules: conv.modules };
    const { MaterialExtractor } = loadExtractors();
    const materials = new MaterialExtractor().extract({ items: [item] }).materials;
    return { mod: conv.modules[0], qty: materials.filter((m) => m.part === '선반').reduce((s, m) => s + m.qty, 0) };
  }
  test('플래너 calcDefaultShelves(\'fridge\') 는 위장(최대 400)에 선반을 두지 않는다', () => {
    expect(engine.calcDefaultShelves('fridge', engine.MASTER_RULES.FRIDGE_UPPER_H_MAX)).toEqual([]);
  });
  test('냉장고장 위장 — 브리지 fridgeUpper, 선반 0 (구조 그대로), 사람이 넣으면 그 수', () => {
    const none = shelvesOf('fridge', doors(720, { shelves: engine.calcDefaultShelves('fridge', 400) }));
    expect(none.mod.fridgeUpper).toBe(true);
    expect(none.qty).toBe(0);
    expect(shelvesOf('fridge', doors(720, { shelves: [200] })).qty).toBe(1);
  });
  test('일반 상부장은 예전 그대로 2장 (표시 없음)', () => {
    const up = shelvesOf('upper', doors(720, { shelves: [] }));
    expect('fridgeUpper' in up.mod).toBe(false);
    expect(up.qty).toBe(2);
  });
});
