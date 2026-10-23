/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
/**
 * 모듈 라이브러리 — **실제 플래너**(mockup-structure.html, jsdom)에 모듈을 넣어 본다 (계획 §3 게이트 8·9).
 *
 *   배치 공간 하나 (pipeline.js areaOf) 로 플래너를 띄운다  → scene-parts.js bootPlanner3D (자동계산 끔, 부모 창 = 상세설계)
 *   addModuleToArea(영역, {W, x})                           → 플래너가 높이·깊이·다리발·선반을 정한다
 *   구조에 라이브러리 structureOf 를 덮는다                 → 사람이 화면에서 같은 선택을 한 것과 같다
 *   buildPlannerPayload → plannerCadSpec                    → 플래너가 3D·CAD GLB 에 쓰는 바로 그 명세
 *
 * jest(jsdom) 안에서만 돈다. Node 명령줄은 pipeline.js 의 순수 경로를 쓴다.
 */
const { bootPlanner3D } = require('../scene-parts');
const Lib = require('../../js/module-library/module-library.js');
const pipeline = require('./pipeline');

/** 플래너 배치 JSON (dadam_layout_v1) — 영역 하나. planner-golden.js FIXTURES 와 같은 모양. */
function layoutOf(area) {
  return {
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    person: { cx: 1000, cy: 1000 },
    modules: [{ section: area.section, x: 0, y: 0, w: area.W, h: area.D, moduleH: area.H, rotation: 0, finishings: [] }],
  };
}

/** 품목 스펙을 파이프라인과 같게 — 좌·우 마감 None. */
const LEDGER = { specs: { finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0 } };

/**
 * 모듈 정의 하나를 실제 플래너에 넣고 명세·BOM 까지.
 * @returns {{ p, module, structure, defaultKeys: string[], payload, spec, materials, hardware, conv, check }}
 */
function runEntryInPlanner(entry) {
  const area = pipeline.areaOf(entry);
  const p = bootPlanner3D(layoutOf(area), { autoCalc: false, assembly: true, ledger: LEDGER });
  const areas = (p.g('areas') || []).filter((a) => !a.isFinishing);
  if (areas.length !== 1) throw new Error(`영역이 하나가 아니다: ${areas.length}`);
  const m = p.g('addModuleToArea')(areas[0].id, { W: entry.W, x: areas[0].x || 0 });
  if (!m) throw new Error(`${entry.id}: addModuleToArea 가 모듈을 넣지 못했다`);
  const s = p.g('getStructure')(m.id);
  Object.assign(s, JSON.parse(JSON.stringify(Lib.structureOf(entry))));
  p.g('persistPlannerState')();
  const payload = p.g('buildPlannerPayload')('PLANNER_DONE');
  const { spec } = p.g('plannerCadSpec')(payload);
  const item = p.parent._currentStep2Item();
  const chain = pipeline.chainOf(payload, item, null);
  return {
    p, module: m, structure: s,
    defaultKeys: Object.keys(p.g('defaultStructure')()),
    payload, spec,
    materials: chain.materials, hardware: chain.hardware, conv: chain.conv, check: chain.check,
  };
}

module.exports = { layoutOf, runEntryInPlanner };
