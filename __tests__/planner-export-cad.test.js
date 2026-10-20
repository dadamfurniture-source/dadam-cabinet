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
const AssemblyCheck = require('../js/detaildesign/assembly-check.js');
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
  '도어': () => ({ entityKind: 'carcass', side: 'front' }),
  '서랍도어': () => ({ entityKind: 'carcass', side: 'front' }),
  '목찬넬(중간 전면)': () => ({ entityKind: 'carcass', side: 'channelFace' }),
  '목찬넬(중간 지면)': () => ({ entityKind: 'carcass', side: 'channelBase' }),
};

/** 하부장을 서랍장(도어 위 · 서랍 3단)으로 — __tests__/scene-overlap.test.js 의 drawer 장면과 같다. */
function toDrawer(p, drawer) {
  p.g('modules').filter((m) => m.section === 'lower').forEach((m) => {
    const s = p.g('getStructure')(m.id);
    s.horizontalLayout = 'doorTopDrawerBottom';
    s.bottomType = 'drawer';
    s.drawerCount = 3;
    if (drawer) s.drawer = drawer;
  });
  p.g('renderAll3D')({ fit: false });
  return p;
}
const SCENES = Object.assign({}, ...Object.keys(FIXTURES).map((k) => ({ [k]: (o) => bootPlanner3D(FIXTURES[k], o) })), {
  drawer: (o) => toDrawer(bootPlanner3D(FIXTURES.straight, o)),
  // 서랍 자재 18T · 볼레일 · 서랍 사쿠리 (우라가 측판 홈에)
  drawer18: (o) => toDrawer(bootPlanner3D(FIXTURES.straight, o), { rail: 'ball', sakuri: true, boxT: 18 }),
});

describe.each(Object.keys(SCENES))('%s 장면 → CAD GLB', (name) => {
  let p, THREE, cad, item, itemJson, pieces, built, gltf;
  beforeAll(async () => {
    p = SCENES[name]({ design: 'cad', item: name });
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

  test('서랍 박스 — 측판·앞뒷판을 합친 상자가 3D 장면의 서랍 박스 외경과 같다', () => {
    const box3 = (solids) => {
      const g = new THREE.Box3();
      solids.forEach((s) => g.union(new THREE.Box3(new THREE.Vector3(...s.min), new THREE.Vector3(...s.max)).applyMatrix4(new THREE.Matrix4().fromArray(s.m))));
      return g;
    };
    let n = 0;
    cad.spec.items.forEach((it) => it && it.modules.forEach((m) => {
      const M = cad.frameOf(m);
      const plannerId = cad.cells[m.moduleKey].plannerId;
      const byBox = {};
      m.parts.filter((pt) => pt.part === '서랍측판' || pt.part === '서랍전후판').forEach((pt) => {
        const b = new THREE.Box3(new THREE.Vector3(...pt.box.min), new THREE.Vector3(...pt.box.max)).applyMatrix4(M);
        byBox[pt.tags.box] = byBox[pt.tags.box] ? byBox[pt.tags.box].union(b) : b;
      });
      Object.keys(byBox).forEach((k) => {
        const b = byBox[k];
        const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === 'drawerBox').map((r) => box3(r.solids))
          .filter((g) => g.min.distanceTo(b.min) < 0.6 && g.max.distanceTo(b.max) < 0.6);
        expect({ module: m.moduleKey, box: k, hit: hits.length }).toEqual({ module: m.moduleKey, box: k, hit: 1 });
        n++;
      });
    }));
    if (/^drawer/.test(name)) expect(n).toBeGreaterThan(0);
    // 사쿠리 서랍 — 우라가 측판 홈에 낀다 (겹침 검사는 홈 자리 안이라 통과 — 위 조립 검사 시험)
    const bottoms = cad.spec.items.flatMap((it) => (it ? it.modules : [])).flatMap((m) => m.parts).filter((pt) => pt.part === '서랍밑판');
    if (name === 'drawer18') expect(bottoms.length > 0 && bottoms.every((pt) => pt.tags.mount === 'groove')).toBe(true);
    if (name === 'drawer') expect(bottoms.length > 0 && bottoms.every((pt) => !pt.tags.mount)).toBe(true);
  });

  test('조립 검사 (PR7) — 플래너 장면의 명세에 error 0', () => {
    const r = AssemblyCheck.check(cad.spec);
    expect(r.issues.filter((x) => x.level === 'error')).toEqual([]);
  });

  test('부모 품목은 건드리지 않는다', () => {
    expect(JSON.stringify(item)).toBe(itemJson);
  });

  test('측판·지판·천판·뒷판·처짐방지목·도어 — 월드 상자가 3D 장면의 같은 판과 같다', () => {
    const box3 = (solids) => {
      const g = new THREE.Box3();
      solids.forEach((s) => g.union(new THREE.Box3(new THREE.Vector3(...s.min), new THREE.Vector3(...s.max)).applyMatrix4(new THREE.Matrix4().fromArray(s.m))));
      return g;
    };
    let checked = 0, doors = 0, drawerParts = 0;
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
        if (pt.part === '도어') doors++;
        if (pt.part === '서랍도어' || /^목찬넬\(중간/.test(pt.part)) drawerParts++;
      });
    }));
    expect(checked).toBeGreaterThan(20);
    expect(doors).toBeGreaterThan(0);
    // 서랍장 장면 — 서랍 전면 · 중간 목찬넬도 3D 와 같은 자리
    if (name === 'drawer') expect(drawerParts).toBeGreaterThan(0);
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

// 붙박이장 — 통 하나에 몸통이 여럿 (규칙 파일 layoutWardrobeModule 의 carcasses). __tests__/scene-overlap.test.js 의 장면과 같다.
const WARDROBE_LAYOUT = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: null,
  modules: [{ section: 'wardrobe', x: 0, y: 0, w: 2400, h: 620, moduleH: 2310, rotation: 0, finishings: [] }],
};
const WARDROBE_SCENES = {
  wardrobe: (o) => bootPlanner3D(WARDROBE_LAYOUT, o),
  // 2번 통을 긴옷 + 외부 서랍 2단으로 — 서랍모듈 몸통이 맨 아래에 따로 선다
  wardrobeExt: (o) => {
    const p = bootPlanner3D(WARDROBE_LAYOUT, o);
    p.g('modules').filter((m) => m.id === 'wardrobe-1').forEach((m) => {
      const s = p.g('getStructure')(m.id);
      s.wardrobe = Object.assign({}, s.wardrobe, { preset: 'longDrawer', externalDrawer: true });
    });
    p.g('renderAll3D')({ fit: false });
    return p;
  },
};

describe.each(Object.keys(WARDROBE_SCENES))('%s 장면 → CAD 명세 (붙박이장)', (name) => {
  let p, THREE, cad, pieces;
  beforeAll(async () => {
    p = WARDROBE_SCENES[name]({ design: 'cad', item: name });
    await new Promise((r) => setTimeout(r, 150));
    THREE = window.THREE;
    // 품목 높이 = 플래너 모듈 높이 (좌대 60 + 몸통 + 상몰딩 20 — 규칙 파일 기본값)
    const item = { categoryId: 'wardrobe', w: 2400, h: 2310, d: 620, specs: {}, modules: [] };
    Object.assign(p.window.parent, {
      _convertPlannerModules: loadConverter()._convertPlannerModules,
      MaterialExtractor: loadExtractors().MaterialExtractor,
      _currentStep2Item: () => item,
      selectedItems: [item],
    });
    cad = p.g('PlannerExport')._o.cad();
    pieces = collectScenePieces(p);
  });
  const worldOf = (pt, M) => new THREE.Box3(new THREE.Vector3(...pt.box.min), new THREE.Vector3(...pt.box.max)).applyMatrix4(M);
  const box3 = (solids) => {
    const g = new THREE.Box3();
    solids.forEach((s) => g.union(new THREE.Box3(new THREE.Vector3(...s.min), new THREE.Vector3(...s.max)).applyMatrix4(new THREE.Matrix4().fromArray(s.m))));
    return g;
  };

  test('통마다 몸통 판재가 놓이고 조립 검사 error 0 · 선반은 모두 자리를 받는다', () => {
    const mods = cad.spec.items[0].modules;
    expect(mods.map((m) => m.kind)).toEqual(['wardrobe', 'wardrobe', 'wardrobe']);
    expect(AssemblyCheck.check(cad.spec).issues.filter((x) => x.level === 'error')).toEqual([]);
    expect(cad.spec.unplaced.filter((u) => u.part === '선반')).toEqual([]);
    if (name === 'wardrobeExt') expect(mods[1].carcasses.map((c) => c.group)).toEqual(['서랍모듈', '통']);
  });

  test('측판 — 월드 상자가 3D 장면 몸통(carcassIdx)의 측판과 같다 · 선반은 가로·높이가 같다', () => {
    let sides = 0, shelves = 0;
    cad.spec.items[0].modules.forEach((m) => {
      const M = cad.frameOf(m);
      const plannerId = cad.cells[m.moduleKey].plannerId;
      m.parts.forEach((pt) => {
        const b = worldOf(pt, M);
        if (pt.part === '측판') {
          const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === 'carcass' && r.ud.carcassIdx === pt.tags.carcass)
            .map((r) => box3(r.solids)).filter((g) => g.min.distanceTo(b.min) < 0.6 && g.max.distanceTo(b.max) < 0.6);
          expect({ id: pt.id, hit: hits.length }).toEqual({ id: pt.id, hit: 1 });
          sides++;
        } else if (pt.part === '선반') {
          // 앞뒤는 다르다 — 3D 는 선반을 깊이 가운데에 그리고, 명세는 천지판 뒤끝에 맞춘다 (wardrobe.md §6 전면 여유 70)
          const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === 'shelf').map((r) => box3(r.solids))
            .filter((g) => Math.abs(g.min.x - b.min.x) < 0.6 && Math.abs(g.max.x - b.max.x) < 0.6 && Math.abs(g.min.y - b.min.y) < 0.6 && Math.abs(g.max.y - b.max.y) < 0.6);
          expect({ id: pt.id, hit: hits.length }).toEqual({ id: pt.id, hit: 1 });
          shelves++;
        }
      });
    });
    expect(sides).toBeGreaterThanOrEqual(6);
    expect(shelves).toBeGreaterThan(0);
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
