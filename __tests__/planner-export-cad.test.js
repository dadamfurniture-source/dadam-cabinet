/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, window, global, Buffer, setTimeout */
/**
 * CAD GLB — 조립 명세(js/detaildesign/bom-assembly.js)에서 바로 짓는 GLB (js/planner/planner-export.js, 관리자 전용).
 * 사장님 2026-10-19 "플래너를 캐드 시스템으로, 바로 GLB 로".
 *
 *   · 구조 페이지에 🧊 CAD GLB 버튼이 숨김으로 실리고 관리자에게만 보인다
 *   · 판재 = 명세 부재 하나씩, 이름 = partId#k, extras 에 BOM 행 (재단 치수·두께·자재)
 *   · 자리 — 측판·지판·천판·뒷판·처짐방지목의 월드 상자가 지금 3D 장면의 같은 판과 같다
 *     (명세는 BOM 에서, 3D 는 화면에서 따로 계산한다 — 둘이 맞으면 모듈을 세우는 자리(frameOf)가 맞다)
 *   · 배율 0.001, 루트 extras 에 schema · rulesVersion · 자리 미정 행 수
 */
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectScenePieces } = require('../test-utils/scene-parts');
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const Asm = require('../js/detaildesign/bom-assembly.js');
const {
  plannerExportCadSpec, plannerExportCadGlb, PLANNER_EXPORT_SCALE, PLANNER_EXPORT_CAD_ROOT_NAME,
} = require('../js/planner/planner-export.js');
const { GLTFExporter } = require('three/examples/jsm/exporters/GLTFExporter.js');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = require('util').TextEncoder;

function glbJson(buf) {
  const dv = new DataView(buf);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  const len = dv.getUint32(12, true);
  return JSON.parse(Buffer.from(buf, 20, len).toString('utf8'));
}

/** 상세설계 부모 창 대역 — 플래너가 부르는 전역만. */
function fakeParent(p) {
  const item = { categoryId: 'sink', w: 3600, h: 2310, d: 650, specs: Object.assign({}, LEDGER_SPECS), modules: [] };
  Object.assign(p.window.parent, {
    _convertPlannerModules: loadConverter()._convertPlannerModules,
    MaterialExtractor: loadExtractors().MaterialExtractor,
    _currentStep2Item: () => item,
    selectedItems: [item],
  });
  return item;
}

/** 명세 부재 → 3D 장면의 같은 판 (entityKind · side). */
const SCENE_OF = {
  '측판': (k) => ({ entityKind: 'carcass', side: k === 0 ? 'left' : 'right' }),
  '지판': () => ({ entityKind: 'carcass', side: 'bottom' }),
  '천판': () => ({ entityKind: 'carcass', side: 'top' }),
  '뒷판': () => ({ entityKind: 'carcass', side: 'back' }),
  '밴드(처짐방지)': () => ({ entityKind: 'brace', side: null }),
};

describe.each(Object.keys(FIXTURES))('%s 장면 → CAD GLB', (name) => {
  let p, THREE, cad, item, itemJson, pieces, built, gltf;
  beforeAll(async () => {
    p = bootPlanner3D(FIXTURES[name], { design: 'cad', item: name });
    await new Promise((r) => setTimeout(r, 150));
    THREE = window.THREE;
    item = fakeParent(p);
    itemJson = JSON.stringify(item);
    cad = p.g('PlannerExport')._o.cad();
    pieces = collectScenePieces(p);
    built = await plannerExportCadGlb(THREE, GLTFExporter, cad.spec, cad.frameOf, { solidsOf: cad.solidsOf, exportedAt: '2026-10-20T00:00:00Z' });
    gltf = glbJson(built.glb);
  });

  test('명세가 플래너 모듈마다 판재를 놓는다 — 자리 못 찾은 모듈 0', () => {
    expect(cad.spec.schema).toBe('dadam.assembly/1');
    expect(built.modules).toBeGreaterThan(3);
    expect(built.skipped).toBe(0);
    expect(built.parts).toBe(cad.spec.items.reduce((s, it) => s + (it ? it.modules.reduce((a, m) => a + m.parts.length, 0) : 0), 0));
    expect(built.unplaced).toBe(cad.spec.unplaced.length);
  });

  test('부모 품목은 건드리지 않는다', () => {
    expect(JSON.stringify(item)).toBe(itemJson);
  });

  test('측판·지판·천판·뒷판·처짐방지목 — 월드 상자가 3D 장면의 같은 판과 같다', () => {
    const box3 = (solids) => {
      const g = new THREE.Box3();
      solids.forEach((s) => g.union(new THREE.Box3(new THREE.Vector3(...s.min), new THREE.Vector3(...s.max)).applyMatrix4(new THREE.Matrix4().fromArray(s.m))));
      return g;
    };
    let checked = 0;
    cad.spec.items.forEach((it) => it && it.modules.forEach((m) => {
      const M = cad.frameOf(m);
      const plannerId = cad.cells[m.moduleKey].plannerId;
      const k = {};
      m.parts.forEach((pt) => {
        const want = SCENE_OF[pt.part];
        if (!want) return;
        const n = (k[pt.part] = (k[pt.part] || 0) + 1) - 1;
        const w = want(n);
        const b = new THREE.Box3(new THREE.Vector3(...pt.box.min), new THREE.Vector3(...pt.box.max)).applyMatrix4(M);
        const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === w.entityKind && (w.side == null || r.side === w.side))
          .map((r) => box3(r.solids))
          .filter((g) => g.min.distanceTo(b.min) < 0.6 && g.max.distanceTo(b.max) < 0.6);
        expect({ id: pt.id, hit: hits.length }).toEqual({ id: pt.id, hit: 1 });
        checked++;
      });
    }));
    expect(checked).toBeGreaterThan(20);
  });

  test('GLB — 루트 배율 0.001 · 판재 노드 이름 partId#k · extras 에 BOM 행', () => {
    const root = gltf.nodes[gltf.scenes[gltf.scene || 0].nodes[0]];
    expect(root.name).toBe(PLANNER_EXPORT_CAD_ROOT_NAME);
    expect(root.scale).toEqual([PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE]);
    expect(root.extras).toMatchObject({ schema: 'dadam.assembly/1', source: 'dadam.assembly', unplaced: cad.spec.unplaced.length, skippedModules: 0 });
    const partNodes = gltf.nodes.filter((n) => n.extras && n.extras.rowPartId);
    expect(partNodes).toHaveLength(built.parts);
    const rows = new Map(cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => m.parts) : [])).map((pt) => [pt.id, pt]));
    partNodes.forEach((n) => {
      const pt = rows.get(n.name);
      expect(pt).toBeDefined();
      expect(n.extras).toMatchObject({ rowPartId: pt.rowPartId, part: pt.part, t: pt.t, cutW: pt.cut.w, cutH: pt.cut.h });
    });
    // 따낸 판은 상자 여럿 — 메시 수 = 부재마다 solidsOf 의 상자 수
    const solids = [...rows.values()].reduce((s, pt) => s + Asm.solidsOf(pt).length, 0);
    expect(gltf.nodes.filter((n) => n.mesh != null)).toHaveLength(solids);
  });
});

describe('관리자만 · 부모 창', () => {
  test('구조 페이지: CAD 버튼은 숨김으로 실리고, 관리자일 때만 보인다', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'cad-btn', item: 'x' });
    const btn = p.document.getElementById('glbCadBtn');
    expect(btn).not.toBeNull();
    expect(btn.hidden).toBe(true);
    const PE = p.g('PlannerExport');
    PE.setAdmin(true);
    expect(btn.hidden).toBe(false);
    PE.setAdmin(false);
    expect(btn.hidden).toBe(true);
  });

  test('관리자가 아니면 downloadCad 는 아무것도 하지 않는다', async () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'cad-na', item: 'x' });
    const PE = p.g('PlannerExport');
    PE.setAdmin(false);
    await expect(PE.downloadCad()).resolves.toBeNull();
  });

  test('상세설계 밖(변환기 없는 부모)에서는 이유를 말하고 멈춘다', () => {
    expect(() => plannerExportCadSpec({}, { payload: {}, Assembly: Asm })).toThrow('상세설계 화면에서 연 플래너에서만');
  });
});
