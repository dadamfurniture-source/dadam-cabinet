/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, beforeAll */
/**
 * CAD 베타 PR14b — 붙박이장 통 · 오픈장/밥솥장 상자를 조립 명세로 (planner-assembly-mesh.js plannerAssemblyWholeModuleFor).
 *
 *   통째로 고른다 — 그 모듈 행이 하나도 자리 미정이 아니고 판재 종류를 다 알 때만 명세, 아니면 모듈 전체 예전 그리기.
 *   붙박이장: 몸통(여럿) · 좌대 상자 · 도어 · 내부/외부 서랍 · 칸막이 · 선반. 옷봉(철물) · 상단 몰딩(BOM 행 없음)은 예전 그리기.
 *     뒷판은 BOM 처럼 3T (예전 3D 는 15T 통판), 도어는 2026-10-20 카드 "바닥 20 띄움" (좌대를 덮는다).
 *   오픈장 · 밥솥장: 18T 상자 판 다섯 장 — 자리는 예전 그리기와 같다.
 * id 대조(±0.5mm)는 원장 시험이 붙박이장 픽스처로 본다. 여기서는 외부 서랍 통까지 같은 장치로 본다. 합성 데이터만.
 */
global.dlog = global.dlog || (() => {});
const THREE = require('three');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectSceneIdPieces } = require('../test-utils/scene-parts');
const { collectBomParts } = require('../test-utils/bom-parts');
const { diffById } = require('../test-utils/ledger-diff');

const EPS = 0.01;
const WARDROBE = { version: 1, savedAt: '2026-01-01T00:00:00.000Z', person: null,
  modules: [{ section: 'wardrobe', x: 0, y: 0, w: 2400, h: 620, moduleH: 2310, rotation: 0, finishings: [] }] };
const LEDGER = { category: 'wardrobe', specsExact: {} };

function groupOf(p, id) {
  return p.three.moduleGroup.children.find((g) => g.userData && g.userData.entityKind === 'module' && String(g.userData.moduleId) === String(id));
}
function partsOf(p, id) {
  const g = groupOf(p, id);
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const out = [];
  g.traverse((o) => {
    if (!o.isMesh || ['edge', 'reveal', 'doorEdge', 'carcass-line'].indexOf(o.userData.entityKind) >= 0) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    geo.computeBoundingBox();
    out.push({ ud: o.userData, min: geo.boundingBox.min.toArray(), max: geo.boundingBox.max.toArray() });
  });
  return out;
}
const KEEP_OLD = ['wardrobeRod', 'molding'];   // 철물 · BOM 행 없는 상단 몰딩

describe('붙박이장 (통 셋) — 통째로 명세', () => {
  let p;
  beforeAll(() => { p = bootPlanner3D(WARDROBE, { design: 'ledger', item: 'w', assembly: true, ledger: LEDGER }); });

  test.each(['wardrobe-0', 'wardrobe-1', 'wardrobe-2'])('%s — 옷봉 · 상단 몰딩 말고는 전부 명세 판재', (id) => {
    const list = partsOf(p, id);
    expect(list.filter((x) => x.ud.assembly).length).toBeGreaterThan(10);
    list.filter((x) => !x.ud.assembly).forEach((x) => expect(KEEP_OLD).toContain(x.ud.entityKind));
    expect(list.filter((x) => x.ud.entityKind === 'wardrobeRod').length).toBeGreaterThan(0);
  });

  test('뒷판은 BOM 처럼 3T (예전 3D 는 15T 통판)', () => {
    const backs = partsOf(p, 'wardrobe-0').filter((x) => x.ud.side === 'back');
    expect(backs.length).toBe(2);
    backs.forEach((b) => expect(Math.round((b.max[2] - b.min[2]) * 10) / 10).toBeCloseTo(3, 0));
  });

  test('도어 — 바닥에서 20 띄워 좌대를 덮고, 윗변 = 몸통 상단 (2026-10-20 카드)', () => {
    const list = partsOf(p, 'wardrobe-0');
    const doors = list.filter((x) => x.ud.side === 'front' && x.ud.areaType === 'door');
    expect(doors).toHaveLength(2);
    const top = Math.max(...list.filter((x) => x.ud.side === 'top' || x.ud.side === 'left').map((x) => x.max[1]));
    doors.forEach((d) => {
      expect(d.min[1]).toBeCloseTo(20, 6);
      expect(d.max[1]).toBeCloseTo(top, 6);
    });
  });

  test('도어를 끄면 도어만 빠진다 (예전 그리기와 같다)', () => {
    p.g('setDoorVisible')(false);
    p.g('renderAll3D')({ fit: false });
    const list = partsOf(p, 'wardrobe-0');
    expect(list.filter((x) => x.ud.side === 'front')).toHaveLength(0);
    expect(list.filter((x) => x.ud.assembly).length).toBeGreaterThan(10);
    p.g('setDoorVisible')(true);
    p.g('renderAll3D')({ fit: false });
    expect(partsOf(p, 'wardrobe-0').filter((x) => x.ud.side === 'front')).toHaveLength(2);
  });

  test('좌대는 상자 판재 (앞·뒤 · 좌·우 · 보강)', () => {
    const ped = partsOf(p, 'wardrobe-0').filter((x) => x.ud.entityKind === 'pedestal');
    expect(ped.every((x) => x.ud.assembly)).toBe(true);
    expect(ped.map((x) => x.ud.pedestalPart).sort()).toEqual(['brace', 'fb', 'fb', 'side', 'side']);
  });
});

describe('붙박이장 외부 서랍 통 (긴옷 + 외부 서랍 2단)', () => {
  let p;
  beforeAll(() => {
    p = bootPlanner3D(WARDROBE, { design: 'ledger', item: 'wx', assembly: true, ledger: LEDGER });
    const s = p.g('getStructure')('wardrobe-1');
    s.wardrobe = Object.assign({}, s.wardrobe, { preset: 'longDrawer', externalDrawer: true });
    p.g('renderAll3D')({ fit: false });
  });

  test('모듈마다 명세 또는 예전 — 섞어 두 번 그리지 않는다', () => {
    ['wardrobe-0', 'wardrobe-1', 'wardrobe-2'].forEach((id) => {
      const list = partsOf(p, id).filter((x) => KEEP_OLD.indexOf(x.ud.entityKind) < 0);
      const asm = list.filter((x) => x.ud.assembly).length;
      expect(asm === 0 || asm === list.length).toBe(true);
    });
  });

  test('명세 판재는 BOM 낱장 id 와 맞고 명세 상자 ±0.5mm (원장 1단계와 같은 장치)', () => {
    const spec = p.g('plannerCadSpec')().spec;
    const materials = collectBomParts(p, LEDGER).materials;
    const r = diffById('wardrobeExt', collectSceneIdPieces(p), spec, materials);
    expect(r.issues).toEqual([]);
    expect(r.matched).toBeGreaterThan(30);
  });
});

describe.each(['open', 'rice'])('%s 상자 — 명세 판재 다섯 장, 자리는 예전과 같다', (kind) => {
  const boot = (extra) => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'o' + kind, assembly: true, searchExtra: extra || '' });
    const KIND = kind === 'open' ? p.window.DadamOpenCabinetRules.RULES.KIND : p.window.DadamRiceCabinetRules.RULES.KIND;
    Object.assign(p.g('getStructure')('lower-1'), { moduleKind: KIND });
    p.g('renderAll3D')({ fit: false });
    return p;
  };
  let asm, old;
  beforeAll(() => { asm = boot(); old = boot('&asm=0'); });

  test('판재 다섯 장 전부 명세 (openCabinet · partId)', () => {
    const list = partsOf(asm, 'lower-1').filter((x) => x.ud.entityKind === 'openCabinet');
    expect(list).toHaveLength(5);
    list.forEach((x) => { expect(x.ud.assembly).toBe(true); expect(typeof x.ud.partId).toBe('string'); });
  });

  test('AABB = 예전 그리기 (같은 규칙 파일)', () => {
    const sort = (l) => l.filter((x) => x.ud.entityKind === 'openCabinet').sort((a, b) => a.min[0] - b.min[0] || a.min[1] - b.min[1] || a.min[2] - b.min[2]);
    const a = sort(partsOf(asm, 'lower-1'));
    const o = sort(partsOf(old, 'lower-1'));
    expect(a).toHaveLength(o.length);
    a.forEach((x, i) => [0, 1, 2].forEach((k) => {
      expect(Math.abs(x.min[k] - o[i].min[k])).toBeLessThan(EPS);
      expect(Math.abs(x.max[k] - o[i].max[k])).toBeLessThan(EPS);
    }));
    o.forEach((x) => expect(x.ud.assembly).toBeUndefined());
  });
});
