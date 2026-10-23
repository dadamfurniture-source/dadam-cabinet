/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, global */
/**
 * 모듈 라이브러리 검증 사슬 — 모듈 정의 하나를 **실제 경로**로 BOM·조립 명세까지 흘린다 (계획 §3 게이트).
 *
 *   모듈 정의 (js/module-library/module-library.js)
 *     → 플래너 payload (addModuleToArea 가 만드는 모듈 + 구조, 이 파일 payloadOf)
 *     → ui-step1.js `_convertPlannerModules`  (bom-parts.js 와 같은 절단)
 *     → MaterialExtractor / HardwareExtractor
 *     → planner-export.js `plannerExportCadSpec` → DadamAssembly.of (dadam.assembly/1)
 *     → DadamAssemblyCheck.check
 *
 * 플래너를 띄우지 않는 **순수 경로**다 — Node 명령줄(tools/module-library/*)에서도 돈다.
 * 같은 모듈을 실제 플래너(jsdom)에 넣은 결과와 같은지는 harness.js · __tests__/module-library-roundtrip.test.js 가 본다.
 *
 * 숫자를 새로 두지 않는다. 배치 공간·높이 모델은 플래너 정본(planner-sections · planner-engine MASTER_RULES)과
 * 조립 규칙(assembly-rules CARCASS), 품목 스펙은 원장 시험의 LEDGER_SPECS(= data-constants DEFAULT_SPECS 싱크 부분)에서 읽는다.
 */
global.dlog = global.dlog || (() => {});
// 브리지 변환기는 규칙 파일의 전역(DadamOpenCabinetRules …)을 찾는다 — UMD 가 globalThis 에 올린다
const AR = require('../../js/detaildesign/assembly-rules.js');
require('../../js/detaildesign/bom-drawer-rules.js');
require('../../js/detaildesign/bom-wardrobe-rules.js');
require('../../js/detaildesign/bom-open-cabinet-rules.js');
require('../../js/detaildesign/bom-rice-cabinet-rules.js');
require('../../js/detaildesign/bom-homecafe-rules.js');
require('../../js/detaildesign/bom-el-rules.js');
const engine = require('../../js/planner/planner-engine.js');
const { PLANNER_SECTIONS } = require('../../js/planner/planner-sections.js');
const Asm = require('../../js/detaildesign/bom-assembly.js');
const Check = require('../../js/detaildesign/assembly-check.js');
const { plannerExportCadSpec } = require('../../js/planner/planner-export.js');
const Lib = require('../../js/module-library/module-library.js');
const { loadConverter, LEDGER_SPECS } = require('../bom-parts');
const { loadExtractors } = require('../bom-golden/golden');

const MR = engine.MASTER_RULES;
/** 배치 공간 앞선에서 몸통 앞까지 — 물끊기 + 도어 자리 (seatModuleDepth · addModuleToArea 의 roomD) */
const FRONT_RESERVE = MR.CORNER_DRIP + MR.DOOR_SEAT_D;
/** 규칙 몸통 깊이 (계획 §1 — 하부 550 · 상부 295) */
const RULE_D = Object.freeze({ lower: AR.CARCASS.LOWER_D_DEFAULT, upper: AR.CARCASS.UPPER_D_DEFAULT });

/**
 * 품목 스펙 — 원장 LEDGER_SPECS 에서 **좌·우 마감만 None**. 좌·우 마감재는 모듈이 아니라 라인(배치, 3단계)의 것이다.
 * 손잡이·몸통 두께는 품목 단위 값이라 모듈마다 이 값으로 검증한다 (목찬넬 · 15T).
 */
const SPECS = Object.freeze(Object.assign({}, LEDGER_SPECS, {
  finishLeftType: 'None', finishLeftWidth: 0,
  finishRightType: 'None', finishRightWidth: 0,
}));

/**
 * 모듈 하나를 받는 배치 공간 — 폭 = 모듈 폭, 높이 = 플래너 섹션 기본 높이,
 * 깊이 = 플래너 섹션 기본 깊이와 "규칙 몸통 깊이 + 앞 자리" 중 큰 것 (상부 기본 320 은 몸통 290 으로 앉는다 — 계획 Q3).
 */
function areaOf(entry) {
  const sec = PLANNER_SECTIONS[entry.section];
  return { section: entry.section, W: entry.W, H: sec.moduleH, D: Math.max(sec.h, RULE_D[entry.section] + FRONT_RESERVE) };
}

/**
 * 플래너 높이 모델 — addModuleToArea 가 섹션마다 넣는 다리발과, 그 아래 몸통 높이.
 *   하부  다리발 = 품목 다리발(sinkLegHeight) · 상판 = topThickness   → 870 − 150 − 12 = 708
 *   상부  상몰딩 = moldingH                                          → 780 − 60 = 720
 */
function heightModelOf(entry, area) {
  if (entry.section === 'lower') {
    const legH = SPECS.sinkLegHeight;
    return { legH, bodyH: area.H - legH - SPECS.topThickness };
  }
  return { legH: 0, bodyH: area.H - SPECS.moldingH };
}

/**
 * 플래너 payload — 영역 하나에 모듈 하나. 모듈 필드는 buildPlannerPayload 가 브리지에 넘기는 것 중 변환이 읽는 몫이다.
 * 구조 = addModuleToArea 가 만드는 기본(다리발·선반) + 라이브러리 structureOf.
 */
function payloadOf(entry) {
  const area = areaOf(entry);
  const id = `${entry.section}-0`;
  const D = Math.min(RULE_D[entry.section], area.D - FRONT_RESERVE);
  const { legH, bodyH } = heightModelOf(entry, area);
  const structure = Object.assign({
    legH,
    shelves: engine.calcDefaultShelves(entry.section, bodyH),
  }, Lib.structureOf(entry));
  const module_ = {
    id, section: entry.section, W: entry.W, H: area.H, D,
    x: 0, y: area.D - FRONT_RESERVE - D, rotation: 0,
    isFixed: false, finishings: [], areaH: area.H,
  };
  return {
    area,
    payload: {
      type: 'PLANNER_DONE', source: 'module-library',
      modules: [module_], structures: { [id]: structure }, hasStructures: true, areaCount: 1,
    },
  };
}

/** 상세설계 품목 — bom-parts.js ledgerItemOf 와 같은 모양 (폭 = 영역 오른쪽 끝, 깊이 = 영역 깊이). */
function itemOf(entry, area) {
  return { categoryId: 'sink', w: area.W, h: 2310, d: area.D, specs: Object.assign({}, SPECS) };
}

/** 부모 창(상세설계) 자리 — plannerExportCadSpec 이 읽는 것만. */
function parentOf(item) {
  const ex = loadExtractors();
  return {
    _convertPlannerModules: loadConverter()._convertPlannerModules,
    MaterialExtractor: ex.MaterialExtractor,
    HardwareExtractor: ex.HardwareExtractor,
    _currentStep2Item: () => item,
    selectedItems: [item],
  };
}

/**
 * 라인(벽) 하나 — 플래너 plannerCadSpec 의 lines() 와 같은 모양. 라인 부재(상판·걸레받이·목찬넬)를 놓는다.
 * 키는 플래너가 영역에 주는 id (`'area-' + section + '-' + i`, mockup-structure.html loadAreas).
 */
function linesOf(payload, area) {
  return () => [{
    key: `area-${area.section}-0`, D: area.D,
    modules: payload.modules.map((m) => ({ plannerId: String(m.id), x: m.x })),
  }];
}

/**
 * payload → 변환 · BOM · 명세 · 검사. 순수 경로와 하네스 경로가 같이 쓴다.
 * @returns {{ conv, design, materials, hardware, spec, check }}
 */
function chainOf(payload, item, lines) {
  const conv = loadConverter()._convertPlannerModules(JSON.parse(JSON.stringify(payload)), JSON.parse(JSON.stringify(item.specs)));
  const design = { items: [Object.assign({}, item, { modules: conv.modules })] };
  const ex = loadExtractors();
  const materials = new ex.MaterialExtractor().extract(design).materials;
  const hardware = new ex.HardwareExtractor().extract(design).hardware;
  const { spec } = plannerExportCadSpec(parentOf(item), {
    payload, structureOf: (pid) => payload.structures[pid], Assembly: Asm, lines,
  });
  return { conv, design, materials, hardware, spec, check: Check.check(spec) };
}

/** 이 모듈 몫의 명세 모듈 키 — 품목 단위 라인 부재(ep 행)는 빼고 본다 (계획 §3 게이트 6). */
function moduleKeysOf(spec) {
  return new Set((spec.items || []).flatMap((it) => (it.modules || []).map((m) => m.moduleKey)));
}

/**
 * 게이트 1~6 (계획 §3). 7(Text-to-CAD)은 CI module-library-cad.yml, 8·9(드리프트·왕복)는 하네스 시험.
 * @returns {{ code: string, ok: boolean, detail: string }[]}
 */
function gatesOf(entry, r) {
  const dist = engine.distributeModules(entry.W);
  const doors = Lib.doorsOf(entry);
  const split = dist.modules.length === 1 && dist.modules[0].w === entry.W && dist.modules[0].is2D === (doors === 2);
  const s = r.payload.structures[r.payload.modules[0].id];
  const keys = moduleKeysOf(r.spec);
  const mods = (r.spec.items || []).flatMap((it) => it.modules || []);
  const unplaced = (r.spec.unplaced || []).filter((u) => keys.has(u.moduleKey));
  const pending = mods.flatMap((m) => (m.pending || []).map((p) => `${m.moduleKey}:${typeof p === 'string' ? p : JSON.stringify(p)}`));
  const hwPending = mods.flatMap((m) => (m.hardware || []).filter((h) => h.pending).map((h) => `${h.kind}:${h.pending}`));
  const errors = r.check.issues.filter((i) => i.level === 'error');
  return [
    { code: 'G1-split', ok: split, detail: `distributeModules(${entry.W}) = ${JSON.stringify(dist.modules)}` },
    { code: 'G2-single-cell', ok: s.verticalCount === 1, detail: `verticalCount ${s.verticalCount}` },
    { code: 'G3-bridge-warnings', ok: r.conv.warnings.length === 0, detail: JSON.stringify(r.conv.warnings) },
    { code: 'G4-bom', ok: r.materials.length > 0, detail: `자재 ${r.materials.length}행` },
    { code: 'G5-check', ok: errors.length === 0, detail: errors.map((i) => `${i.code} ${i.message}`).join(' | ') },
    {
      code: 'G6-unplaced',
      ok: unplaced.length === 0 && pending.length === 0 && hwPending.length === 0,
      detail: [...unplaced.map((u) => `${u.part}:${u.reason}`), ...pending, ...hwPending].join(' | '),
    },
  ];
}

/** 모듈 정의 하나를 순수 경로로 끝까지. */
function runEntry(entry) {
  const problems = Lib.problemsOf(entry);
  if (problems.length) throw new Error(`${entry.id} 형식: ${problems.join(' · ')}`);
  const { area, payload } = payloadOf(entry);
  const item = itemOf(entry, area);
  const r = Object.assign({ entry, area, payload, item }, chainOf(payload, item, linesOf(payload, area)));
  r.gates = gatesOf(entry, r);
  r.ok = r.gates.every((g) => g.ok);
  return r;
}

module.exports = {
  SPECS, FRONT_RESERVE, RULE_D,
  areaOf, heightModelOf, payloadOf, itemOf, parentOf, linesOf, chainOf, moduleKeysOf, gatesOf, runEntry,
};
