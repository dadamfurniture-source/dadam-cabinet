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
  plannerExportStableJson, plannerExportAssemblyHash, PLANNER_EXPORT_CAD_VERSION,
} = require('../js/planner/planner-export.js');
const nodeCrypto = require('crypto');
const { plannerFinishCatalog } = require('../js/planner/planner-finish.js');
const FinishColor = require('../js/detaildesign/bom-finish-color.js');
const subtle = nodeCrypto.webcrypto.subtle;
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
    HardwareExtractor: loadExtractors().HardwareExtractor,
    _currentStep2Item: () => item,
    selectedItems: [item],
  });
  return item;
}

/** 명세 부재 → 3D 장면의 같은 판 (entityKind · side). */
const SCENE_OF = {
  // 좌·우는 명세 판의 tags.side 로 (2026-10-25 위 도어 + 아래 서랍은 두 몸통이라 측판이 넷)
  '측판': (k, pt) => ({ entityKind: 'carcass', side: (pt.tags && pt.tags.side) || (k === 0 ? 'left' : 'right') }),
  '지판': () => ({ entityKind: 'carcass', side: 'bottom' }),
  '천판': () => ({ entityKind: 'carcass', side: 'top' }),
  '뒷판': () => ({ entityKind: 'carcass', side: 'back' }),
  '밴드(처짐방지)': () => ({ entityKind: 'brace', side: null }),
  '도어': () => ({ entityKind: 'carcass', side: 'front' }),
  '서랍도어': () => ({ entityKind: 'carcass', side: 'front' }),
  '목찬넬(중간 전면)': () => ({ entityKind: 'carcass', side: 'channelFace' }),
  '목찬넬(중간 지면)': () => ({ entityKind: 'carcass', side: 'channelBase' }),
};

/** 하부장을 서랍장(도어 위 · 서랍 2단)으로 — __tests__/scene-overlap.test.js 의 drawer 장면과 같다 (3단은 소 75 가 안 들어간다, 2026-10-24). */
function toDrawer(p, drawer) {
  p.g('modules').filter((m) => m.section === 'lower').forEach((m) => {
    const s = p.g('getStructure')(m.id);
    s.horizontalLayout = 'doorTopDrawerBottom';
    s.bottomType = 'drawer';
    s.drawerCount = 2;
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
  let p, THREE, cad, item, itemJson, pieces, built, gltf, ext, extGltf;
  beforeAll(async () => {
    p = SCENES[name]({ design: 'cad', item: name });
    await new Promise((r) => setTimeout(r, 150));
    THREE = window.THREE;
    item = fakeParent(p);
    itemJson = JSON.stringify(item);
    cad = p.g('PlannerExport')._o.cad();
    pieces = collectScenePieces(p);
    built = await plannerExportCadGlb(THREE, GLTFExporter, cad.spec, cad.frameOf, { solidsOf: cad.solidsOf, exportedAt: '2026-10-20T00:00:00Z', subtle });
    gltf = glbJson(built.glb);
    ext = await plannerExportCadGlb(THREE, GLTFExporter, cad.spec, cad.frameOf, { solidsOf: cad.solidsOf, exportedAt: '2026-10-20T00:00:00Z', subtle, vis: 'exterior' });
    extGltf = glbJson(ext.glb);
  });

  // PR16 완료 기준 — 노드 수 = 명세 부재 수 · 화면용 메시 0 · 배율 0.001 · 외관 거름망 1MB 이하
  test('PR16 — 판재 노드 수 = 명세 부재 수 (모듈 부재 + 라인 부재), 화면용 메시 0', () => {
    const specParts = cad.spec.items.reduce((n, it) => n + (it ? it.modules.reduce((k, m) => k + m.parts.length, 0) + it.runs.reduce((k, r) => k + r.parts.length, 0) : 0), 0);
    expect(built.skipped).toBe(0);
    expect(built.parts).toBe(specParts);
    expect(gltf.nodes.filter((n) => n.extras && n.extras.rowPartId)).toHaveLength(specParts);
    // 메시는 모두 판재(이름 partId#k 또는 따낸 판의 partId#k/i)이거나 철물 상자 — 3D 화면의 메시는 하나도 없다
    const ids = new Set(cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => m.parts).concat(it.runs.flatMap((r) => r.parts)) : [])).map((pt) => pt.id));
    const meshes = gltf.nodes.filter((n) => n.mesh != null);
    expect(meshes.filter((n) => !(ids.has(n.name) || ids.has(String(n.name).replace(/\/\d+$/, '')) || (n.extras && n.extras.hardware)))).toEqual([]);
  });

  test('PR16 — 루트 extras: 명세 해시(assemblyHash) = SHA-256(키 정렬 직렬화) · 만든 쪽 버전', async () => {
    const root = gltf.nodes[gltf.scenes[gltf.scene || 0].nodes[0]];
    const want = nodeCrypto.createHash('sha256').update(plannerExportStableJson(cad.spec), 'utf8').digest('hex');
    expect(root.extras.assemblyHash).toBe(want);
    expect(await plannerExportAssemblyHash(JSON.parse(JSON.stringify(cad.spec)), subtle)).toBe(want);
    expect(root.extras).toMatchObject({ generator: PLANNER_EXPORT_CAD_VERSION, vis: 'all' });
  });

  test('PR16 — 외관 거름망(vis exterior): 외관 판재만 · 철물 없음 · 1MB 이하 · 배율 0.001', () => {
    const want = cad.spec.items.reduce((n, it) => n + (it ? it.modules.reduce((k, m) => k + m.parts.filter((pt) => pt.vis === 'exterior').length, 0) + it.runs.reduce((k, r) => k + r.parts.filter((pt) => pt.vis === 'exterior').length, 0) : 0), 0);
    expect(want).toBeGreaterThan(0);
    expect(ext.parts).toBe(want);
    expect(ext.hardware).toBe(0);
    // 고객용 — 판재 노드는 part-N, 모듈은 module-N, extras 없음
    const partNodes = extGltf.nodes.filter((n) => /^part-\d+$/.test(n.name));
    expect(partNodes).toHaveLength(want);
    expect(extGltf.nodes.filter((n) => n.extras && Object.keys(n.extras).length && n !== extGltf.nodes[extGltf.scenes[extGltf.scene || 0].nodes[0]])).toEqual([]);
    const root = extGltf.nodes[extGltf.scenes[extGltf.scene || 0].nodes[0]];
    expect(root.scale).toEqual([PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE]);
    expect(root.extras).toMatchObject({ vis: 'exterior', generator: PLANNER_EXPORT_CAD_VERSION, assemblyHash: gltf.nodes[gltf.scenes[gltf.scene || 0].nodes[0]].extras.assemblyHash });
    expect(Object.keys(root.extras).sort()).toEqual(['assemblyHash', 'exportedAt', 'generator', 'schema', 'source', 'units', 'vis']);
    expect(ext.glb.byteLength).toBeLessThanOrEqual(1024 * 1024);
    // 판재가 없는 모듈 노드는 싣지 않는다
    const mods = extGltf.nodes.filter((n) => /^module-\d+$/.test(n.name));
    expect(mods.length).toBeGreaterThan(0);
    mods.forEach((n) => expect((n.children || []).length).toBeGreaterThan(0));
    // 고객 화면 규칙 — GLB JSON 어디에도 partId · moduleKey · 행 id 가 없다
    const txt = JSON.stringify(extGltf);
    const ids = cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => [m.moduleKey].concat(m.parts.map((pt) => pt.rowPartId))) : []));
    expect(ids.filter((id) => txt.includes(id))).toEqual([]);
    expect(/rowPartId|moduleKey|partId/.test(txt)).toBe(false);
    // 따낸 판은 모양 그대로 (상자 여럿) — 메시 수 = 외관 판재 solidsOf 합
    const solids = cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => m.parts).concat(it.runs.flatMap((r) => r.parts)) : [])).filter((pt) => pt.vis === 'exterior').reduce((n, pt) => n + Asm.solidsOf(pt).length, 0);
    expect(extGltf.nodes.filter((n) => n.mesh != null)).toHaveLength(solids);
  });

  test('명세가 플래너 모듈마다 판재를 놓는다 — 자리 못 찾은 모듈 0', () => {
    expect(cad.spec.schema).toBe('dadam.assembly/1');
    expect(built.modules).toBeGreaterThan(3);
    expect(built.skipped).toBe(0);
    expect(built.parts).toBe(cad.spec.items.reduce((s, it) => s + (it ? it.modules.reduce((a, m) => a + m.parts.length, 0) + it.runs.reduce((a, r) => a + r.parts.length, 0) : 0), 0));
    expect(built.unplaced).toBe(cad.spec.unplaced.length);
  });

  test('라인 부재 — 상판·목찬넬 EP·상몰딩이 벽(배치 공간 묶음) 단위로 호스트 모듈 노드 아래에 실린다', () => {
    const it = cad.spec.items.find(Boolean);
    const runs = it.runs.map((r) => [r.parts[0].part, r.lineKey, r.hostModuleKey]);
    const ep = cad.spec.unplaced.filter((u) => /-ep$/.test(u.moduleKey)).map((u) => [u.part, u.reason]);
    expect(built.runs).toBe(it.runs.length);
    // 걸레받이 — 벽마다 바닥에 붙여(다리발 150 아래, 윗단 −5) · 앞면 = 몸통 앞선 −32, 2440 넘는 벽은 왼쪽부터 2440 조각 (2026-10-22 카드·사장님 글)
    expect(ep.filter((e) => e[0] === '걸레받이')).toEqual([]);
    it.runs.filter((r) => r.parts[0].part === '걸레받이').forEach((r) => {
      const b = r.parts[0].box;
      expect([b.min[1], b.max[1], b.min[2], b.max[2]]).toEqual([-150, -5, 550 / 2 - 32 - 18, 550 / 2 - 32]);
    });
    if (/^(straight|drawer)/.test(name)) {
      // 한 벽: 하부 1200·1000·1400 + 개수대 — 목찬넬 EP 두 장과 상판이 첫 하부 칸 아래에.
      //   상몰딩은 상부 1800 과 1200 사이 빈 자리(1800~2400)를 건너 한 장 — 2026-10-26 사장님 확정 "상부장이 있다면 위에는 상몰딩이 있다고 보면됨. 가능한 이어지게."
      //   좌우 휠라 — 2026-10-24 D9: 도면(플래너에 놓은 마감재)이 정본인데 이 배치에는 마감재가 없다 → 행이 없다 (스펙 휠라 60 은 발주 안 함)
      expect(runs).toEqual([
        ['상몰딩', 'area-lower-0', '0-planner-upper-0-0'],
        ['걸레받이', 'area-lower-0', '0-planner-lower-0-0'], ['걸레받이', 'area-lower-0', '0-planner-lower-0-0'],
        ['목찬넬(전면)', 'area-lower-0', '0-planner-lower-0-0'], ['목찬넬(지면)', 'area-lower-0', '0-planner-lower-0-0'],
        ['상판', 'area-lower-0', '0-planner-lower-0-0']]);
      // 하부 3598 → 2440 왼쪽부터, 1158 오른쪽 끝 (호스트 800 가운데 → 왼쪽 끝 x −400)
      expect(it.runs.filter((r) => r.parts[0].part === '걸레받이').map((r) => [r.parts[0].cut.w, r.parts[0].box.min[0], r.parts[0].box.max[0]]))
        .toEqual([[2440, -400, 2040], [1158, 2040, 3198]]);
      expect(ep.filter((e) => e[0] === '상몰딩')).toEqual([]);
      // 상몰딩 0 ~ 3600 (상부 900 · 900 · 빈 자리 600 · 800 · 400) — 호스트 upper-0 칸 900 가운데 → x −450 … 3150,
      //   몸통 위 720 … 780, 앞면 = 도어 앞면 (상부 몸통 D 290 / 2 … + 18)
      const mold = it.runs.find((r) => r.parts[0].part === '상몰딩').parts[0];
      expect(mold.cut).toEqual({ w: 60, h: 3600 });
      expect(mold.box).toEqual({ min: [-450, 720, 290 / 2], max: [3150, 780, 290 / 2 + 18] });
      expect(ep.filter((e) => /휠라|몰딩\(|EP\(/.test(e[0]))).toEqual([]);
      const top = it.runs.find((r) => r.parts[0].part === '상판').parts[0];
      expect(top.box.min[1]).toBe(708);   // 하부장 몸통 위
      expect(top.box.max[1]).toBe(720);
      expect(top.box.max[0] - top.box.min[0]).toBe(top.cut.w);   // 하부 폭 합 + 좌우 휠라
      // D3 (2026-10-24): 뒤 = 벽 (몸통 뒤 여유만큼 뒤), 깊이 = 행 h → 앞선 = 도어 앞면(550/2 + 18) + 12 — 오버행 없음
      expect(top.box.max[2] - top.box.min[2]).toBe(top.cut.h);
      expect(top.box.max[2]).toBe(550 / 2 + 18 + 12);
      // GLB: 라인 부재는 호스트 모듈 노드 아래, extras.run 에 벽 키
      const node = gltf.nodes.find((n) => n.name === top.id);
      expect(node.extras).toMatchObject({ part: '상판', run: 'area-lower-0', moduleKey: '0-ep' });
      const host = gltf.nodes.find((n) => n.name === 'module·0-planner-lower-0-0');
      expect(host.children.map((c) => gltf.nodes[c].name)).toContain(top.id);
    } else {
      // ㄱ자·사선: 상부장 한 벽의 상몰딩, 벽마다 걸레받이 · 목찬넬 EP (도면 마감재 없음 → 휠라 행 없음, D9)
      //   목찬넬은 2026-10-25 사장님 확정 "보통 벽마다 한장씩, 두장으로 나뉨" — 벽(라인)마다 한 장.
      //   상판은 품목당 한 장이라 두 벽에 걸쳐 놓지 않는다 — 2026-10-26 사장님 확정 "ㄱ자 한 장으로 보내면 업체에서 알아서 나눔" (발주 = ㄱ자 한 장)
      expect(runs[0]).toEqual(['상몰딩', 'area-lower-0', '0-planner-upper-0-0']);
      expect(ep.filter((e) => /걸레받이|목찬넬/.test(e[0]))).toEqual([]);
      expect(ep).toContainEqual(['상판', 'run-layout-unknown']);
      expect(ep.filter((e) => /휠라/.test(e[0]))).toEqual([]);
      ['목찬넬(전면)', '목찬넬(지면)'].forEach((part) => {
        const mine = it.runs.filter((r) => r.parts[0].part === part);
        expect(mine).toHaveLength(2);
        expect(new Set(mine.map((r) => r.lineKey)).size).toBe(2);   // 두 벽에 한 장씩
        mine.forEach((r) => {
          expect(r.hostModuleKey).toMatch(/^0-planner-lower-\d+-0$/);   // 호스트 = 그 벽 첫 하부 모듈
          expect(r.parts[0].box.max[0] - r.parts[0].box.min[0]).toBe(r.parts[0].cut.h);   // 판 길이 = 그 벽 하부 폭 합
        });
      });
    }
  });

  test('철물 — 하부 모듈마다 다리발 4 코너가 3D 장면 다리발(entityKind leg)과 같은 자리, 가운데 다리는 명세만 (3D 는 4 코너), 경첩은 도어마다 변·컵 자리', () => {
    const it = cad.spec.items.find(Boolean);
    const lowers = it.modules.filter((m) => m.kind === 'lower');
    expect(lowers.length).toBeGreaterThan(0);
    lowers.forEach((m) => {
      const all = m.hardware.filter((h) => h.kind === 'leg');
      expect(all.every((h) => h.at && h.size)).toBe(true);
      // 가운데 다리 (6·8개, 2026-10-23 4-1 B) — 3D addLegs 는 4 코너만 그린다. 3D 를 근거로 명세를 고치지 않는다
      const mids = all.filter((h) => /^mid/.test(h.tags.side));
      expect(all.length - mids.length).toBe(4);
      const legs = all.filter((h) => !/^mid/.test(h.tags.side));
      expect(legs.map((h) => h.tags.side)).toEqual(['leftFront', 'leftBack', 'rightFront', 'rightBack']);
      // 3D addLegs 의 다리발 mesh (모듈 그룹 로컬 x·z — 3D 는 바닥이 y 0, 명세는 몸통 바닥이 y 0 이라 y 는 비교하지 않는다)
      const scene = [];
      const plannerId = cad.cells[m.moduleKey].plannerId;
      (p.three || p.g('three')).moduleGroup.traverse((o) => {
        // 3D addLegs 의 side 이름은 앞뒤가 바뀌어 있다 ("이름과 달리 zBack 이 월드 앞쪽") — 자리로 맞춘다
        if (o.isMesh && o.userData && o.userData.entityKind === 'leg' && String(o.userData.moduleId) === plannerId) {
          scene.push([o.userData.side.replace(/(Front|Back)$/, (w) => (w === 'Front' ? 'Back' : 'Front')), Math.round(o.position.x), Math.round(o.position.z)]);
        }
      });
      expect(scene).toHaveLength(4);
      // x 와 뒷줄 z 는 3D 와 같다. 앞줄은 3D 가 제 걸레받이(앞선 −40) 뒤에 두어 다르다 — 명세는 명세 걸레받이(앞선 −32, 18T) 바로 뒤
      const back = (a) => a.filter((r) => /Back$/.test(r[0])).sort();
      expect(back(legs.map((h) => [h.tags.side, Math.round(h.at[0]), Math.round(h.at[2])]))).toEqual(back(scene));
      expect(legs.map((h) => Math.round(h.at[0])).sort()).toEqual(scene.map((r) => r[1]).sort());
      legs.filter((h) => /Front$/.test(h.tags.side)).forEach((h) => expect(h.at[2] + 21).toBe(m.box.D / 2 - 32 - 18));
      expect(legs.every((h) => h.at[1] === -150)).toBe(true);
    });
    // 서랍장(마이다 전면)은 BOM 이 경첩 행을 안 낸다 (extractHinges bomIsMaidaModule) — 위 도어가 있어도 철물이 없으니 뺀다
    const doors = it.modules.filter((m) => m.hardware.some((h) => h.kind === 'hinge'))
      .flatMap((m) => m.parts.filter((p) => p.tags.doorIdx !== undefined && /도어$/.test(p.part)).map((p) => [m, p]));
    expect(doors.length).toBeGreaterThan(0);
    doors.forEach(([m, p]) => {
      const hs = m.hardware.filter((x) => x.kind === 'hinge' && x.partId === p.id);
      expect(hs.length).toBeGreaterThan(0);
      // 변이 정해진 도어는 컵마다 자리 (2개 이상), 외짝인데 설계에 hingeSide 가 없으면 한 항목에 방향 미정
      if (hs[0].pending) expect(hs).toEqual([expect.objectContaining({ at: null, pending: 'hinge-side-unknown' })]);
      else {
        expect(hs.length).toBeGreaterThanOrEqual(2);
        expect(hs.every((h) => h.at && h.at[2] === p.box.min[2] && h.backset === 21.5 && h.depth === 12.5)).toBe(true);
      }
    });
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
        const w = want(n, pt);
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
    const rows = new Map(cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => m.parts).concat(it.runs.flatMap((r) => r.parts)) : [])).map((pt) => [pt.id, pt]));
    partNodes.forEach((n) => {
      const pt = rows.get(n.name);
      expect(pt).toBeDefined();
      expect(n.extras).toMatchObject({ rowPartId: pt.rowPartId, part: pt.part, t: pt.t, cutW: pt.cut.w, cutH: pt.cut.h });
    });
    // 따낸 판은 상자 여럿 — 메시 수 = 부재마다 solidsOf 의 상자 수 + 철물 상자(다리발)
    const solids = [...rows.values()].reduce((s, pt) => s + Asm.solidsOf(pt).length, 0);
    expect(gltf.nodes.filter((n) => n.mesh != null)).toHaveLength(solids + built.hardware);
  });

  test('GLB — 철물은 자리·치수가 있는 다리발만 상자로, 모듈 노드 아래 (extras.hardware), 레일·경첩은 싣지 않는다', () => {
    const placed = cad.spec.items.flatMap((it) => (it ? it.modules.flatMap((m) => m.hardware.filter((h) => h.at && h.size).map((h) => [m.moduleKey, h])) : []));
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every(([, h]) => h.kind === 'leg')).toBe(true);
    expect(built.hardware).toBe(placed.length);
    const hwNodes = gltf.nodes.filter((n) => n.extras && typeof n.extras.hardware === 'string');
    expect(hwNodes).toHaveLength(placed.length);
    expect(hwNodes.every((n) => n.extras.hardware === 'leg' && n.mesh != null)).toBe(true);
    // 다리발 상자 가운데 = at + 높이/2 (at 는 밑면 가운데) — 모듈 노드 로컬 (mm)
    const nodeOf = new Map(gltf.nodes.map((n) => [n.name, n]));
    placed.forEach(([mk, h]) => {
      const k = cad.spec.items.flatMap((it) => (it ? it.modules : [])).find((m) => m.moduleKey === mk).hardware.indexOf(h);
      const n = nodeOf.get(`${mk}·leg#${k}`);
      expect(n).toBeDefined();
      expect(n.translation.map(Math.round)).toEqual([h.at[0], h.at[1] + h.size[1] / 2, h.at[2]].map(Math.round));
      expect(n.extras).toMatchObject({ moduleKey: mk, category: '다리발' });
      const parent = gltf.nodes.find((x) => x.children && x.children.includes(gltf.nodes.indexOf(n)));
      expect(parent.name).toBe(`module·${mk}`);
    });
    // 레일·경첩은 메시가 없다
    expect(gltf.nodes.filter((n) => n.extras && /rail|hinge/.test(String(n.extras.hardware)))).toEqual([]);
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

  test('측판 — 월드 상자가 3D 장면 몸통(carcassIdx)의 측판과 같다 · 선반·칸막이는 가로·높이가 같다', () => {
    let sides = 0, shelves = 0, dividers = 0;
    cad.spec.items[0].modules.forEach((m) => {
      const M = cad.frameOf(m);
      const plannerId = cad.cells[m.moduleKey].plannerId;
      m.parts.forEach((pt) => {
        const b = worldOf(pt, M);
        // 내부 서랍장 측판은 몸통이 아니다 (3D 는 wardrobeInnerModule 로, 아직 예전 앞뒤 자리에 그린다)
        if (pt.part === '측판' && !pt.tags.innerDrawer) {
          const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === 'carcass' && r.ud.carcassIdx === pt.tags.carcass)
            .map((r) => box3(r.solids)).filter((g) => g.min.distanceTo(b.min) < 0.6 && g.max.distanceTo(b.max) < 0.6);
          expect({ id: pt.id, hit: hits.length }).toEqual({ id: pt.id, hit: 1 });
          sides++;
        } else if (pt.part === '선반' || pt.part === '세로칸막이' || pt.part === '중간칸막이') {
          // 앞뒤는 다르다 — 3D 는 선반·칸막이를 깊이 가운데(D−T)에 그리고, 명세는 천지판 뒤끝에 맞춘다 (wardrobe.md §6 전면 여유 70)
          const kind = pt.part === '선반' ? 'shelf' : 'wardrobeDivider';
          const hits = pieces.filter((r) => r.moduleId === plannerId && r.entityKind === kind).map((r) => box3(r.solids))
            .filter((g) => Math.abs(g.min.x - b.min.x) < 0.6 && Math.abs(g.max.x - b.max.x) < 0.6 && Math.abs(g.min.y - b.min.y) < 0.6 && Math.abs(g.max.y - b.max.y) < 0.6);
          expect({ id: pt.id, hit: hits.length }).toEqual({ id: pt.id, hit: 1 });
          if (kind === 'shelf') shelves++; else dividers++;
        }
      });
    });
    expect(sides).toBeGreaterThanOrEqual(6);
    expect(shelves).toBeGreaterThan(0);
    // 3번 통(반 분할) — 세로 칸막이도 3D 와 같은 가로·높이
    expect(dividers).toBeGreaterThan(0);
    expect(cad.spec.unplaced.filter((u) => /칸막이/.test(u.part))).toEqual([]);
  });
});

/**
 * PR16b 동결본 GLB — 동결 때(workflow-client.js createSnapshot)처럼 `DadamAssembly.of(design, { materials })` 로 만든 명세에
 *   플래너 자리(frameOf)만 입혀 전체 · 외관 두 벌을 짓고 워커 창구(DadamWorkflow.cad)로 보낸다.
 *   moduleKey 가 플래너 칸(cells)과 맞아야 자리를 받는다 — 자리 못 찾은 모듈 0 이어야 한다.
 */
describe.each(['straight', 'drawer'])('%s 장면 → 동결본 GLB 올리기', (name) => {
  let p, PE, frozen, sent, catalog;
  beforeAll(async () => {
    p = SCENES[name]({ design: 'frozen', item: name });
    await new Promise((r) => setTimeout(r, 150));
    const item = fakeParent(p);
    // 동결 명세 — 상세설계가 플래너 결과를 품목에 적용한 뒤(ui-step1.js) createSnapshot 이 내는 것과 같은 모양
    const P = p.window.parent;
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    const specs = JSON.parse(JSON.stringify(item.specs || {}));
    const conv = P._convertPlannerModules(payload, specs);
    // 디테일 마감 모델(planner-finish.js) — 품목 도어 · 서랍 앞판 · 몸통 코드. 추출기가 BOM 행 finishCode 로 낸다
    const detail = { version: 1, item: { door: { code: 'PET-OAK-M' }, drawerFront: { code: 'PET-WNT-M' }, body: { code: 'MFB-WHT' } }, sections: {}, modules: {}, parts: {} };
    const design = { items: [Object.assign({}, item, { specs, detail, modules: conv.modules })] };
    const materials = new P.MaterialExtractor().extract(design).materials;
    const assembly = JSON.parse(JSON.stringify(Asm.of(design, { materials })));   // JSONB 왕복
    // 마감 코드 — 워커 finishCodesOf 와 같은 규칙 (BOM 행 partId → finishCode, 빈 코드는 뺀다)
    const finishCodes = {};
    materials.forEach((m) => { if (m.partId && m.finishCode) finishCodes[String(m.partId)] = String(m.finishCode); });
    frozen = {
      snapshot_id: 'S-frozen', rev: 4, assembly, finish_codes: finishCodes,
      assembly_hash: nodeCrypto.createHash('sha256').update(plannerExportStableJson(assembly), 'utf8').digest('hex'),
    };
    // 카탈로그 — 디테일 모드 로컬 정본 (PlannerCatalog 가 DB 를 못 읽을 때와 같은 표)
    const cat = plannerFinishCatalog(FinishColor);
    catalog = { byCode: Object.fromEntries(cat.entries.map((e) => [e.code, e])) };
    sent = [];
    PE = p.g('PlannerExport');
    PE._o.workflow = {
      frozenAssembly: async () => frozen,
      upload: async (snapshotId, kind, glb) => { sent.push({ snapshotId, kind, glb }); return { artifact: { kind }, reused: false }; },
    };
    PE._o.subtle = subtle;
    PE._o.GLTFExporter = GLTFExporter;
    PE._o.finishCatalog = async () => catalog;
    PE.setAdmin(true);
  });

  test('마감 색 — 도어 · 서랍 전면 판재는 BOM 마감 코드의 카탈로그 색, 재질 이름 = 마감 코드', async () => {
    sent.length = 0;
    await PE.uploadFrozen();
    const ext = glbJson(sent.find((x) => x.kind === 'exterior').glb);
    const want = [...new Set(Object.values(frozen.finish_codes))].filter((c) => catalog.byCode[c]);
    expect(want.length).toBeGreaterThan(0);
    const mats = new Map((ext.materials || []).map((m) => [m.name, m]));
    const used = want.filter((c) => mats.has(c));
    expect(used.length).toBeGreaterThan(0);
    // sRGB hex → 선형 baseColorFactor (three ColorManagement)
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    used.forEach((c) => {
      const hex = catalog.byCode[c].hex.replace('#', '');
      const rgb = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
      const f = (mats.get(c).pbrMetallicRoughness || {}).baseColorFactor || [1, 1, 1, 1];   // 흰색은 glTF 기본값이라 빠진다
      rgb.forEach((v, i) => expect(f[i]).toBeCloseTo(v, 3));
    });
    // 도어 메시는 마감 재질을 쓴다
    const doorParts = frozen.assembly.items[0].modules.flatMap((m) => m.parts).filter((pt) => pt.vis === 'exterior' && frozen.finish_codes[pt.rowPartId] && catalog.byCode[frozen.finish_codes[pt.rowPartId]]);
    expect(doorParts.length).toBeGreaterThan(0);
    const finishMatIdx = new Set((ext.materials || []).map((m, i) => (want.includes(m.name) ? i : -1)).filter((i) => i >= 0));
    const finishedMeshes = (ext.meshes || []).filter((m) => m.primitives.some((pr) => finishMatIdx.has(pr.material)));
    expect(finishedMeshes.length).toBeGreaterThan(0);
    // 고객용 규칙은 그대로 — 마감 코드 말고는 partId · moduleKey 가 없다
    const txt = JSON.stringify(ext);
    expect(/rowPartId|moduleKey|partId/.test(txt)).toBe(false);
  });

  test('전체 · 외관 두 벌 — 루트 assemblyHash = 동결 명세 해시, 자리 못 찾은 모듈 0, 외관 1MB 이하', async () => {
    sent.length = 0;
    const r = await PE.uploadFrozen();
    expect(r).not.toBeNull();
    expect(sent.map((x) => [x.snapshotId, x.kind])).toEqual([['S-frozen', 'cad'], ['S-frozen', 'exterior']]);
    sent.forEach((x) => {
      const root = glbJson(x.glb).nodes[0];
      expect(root.extras).toMatchObject({ assemblyHash: frozen.assembly_hash, vis: x.kind === 'exterior' ? 'exterior' : 'all', schema: 'dadam.assembly/1' });
    });
    expect(r.cad.skipped).toBe(0);
    expect(r.cad.parts).toBe(frozen.assembly.items.reduce((n, it) => n + (it ? it.modules.reduce((k, m) => k + m.parts.length, 0) + it.runs.reduce((k, x) => k + x.parts.length, 0) : 0), 0));
    expect(r.exterior.parts).toBeGreaterThan(0);
    expect(sent[1].glb.byteLength).toBeLessThanOrEqual(1024 * 1024);
  });

  test('관리자가 아니면 아무것도 보내지 않는다 · 버튼도 숨긴다', async () => {
    sent.length = 0;
    PE.setAdmin(false);
    expect(p.document.getElementById('glbFrozenBtn').hidden).toBe(true);
    await expect(PE.uploadFrozen()).resolves.toBeNull();
    expect(sent).toEqual([]);
    PE.setAdmin(true);
    expect(p.document.getElementById('glbFrozenBtn').hidden).toBe(false);
  });

  test('해시가 동결본과 다르면 올리지 않는다', async () => {
    sent.length = 0;
    const keep = frozen.assembly_hash;
    frozen.assembly_hash = '0'.repeat(64);
    await expect(PE.uploadFrozen()).resolves.toBeNull();
    frozen.assembly_hash = keep;
    expect(sent).toEqual([]);
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

  test('plannerExportStableJson — 키 순서와 무관 · undefined 키는 뺀다 (워커 해시와 같은 규칙)', () => {
    expect(plannerExportStableJson({ b: 1, a: [1, { d: 'x', c: null }], e: undefined })).toBe('{"a":[1,{"c":null,"d":"x"}],"b":1}');
    expect(plannerExportStableJson({ a: 1, b: 2 })).toBe(plannerExportStableJson({ b: 2, a: 1 }));
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
