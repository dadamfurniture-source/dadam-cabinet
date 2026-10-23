/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, beforeAll */
/**
 * CAD 베타 PR12 — 플래너 3D 몸통·처짐방지목·선반을 조립 명세로 (js/planner/planner-assembly-mesh.js).
 *
 * 완료 기준 (docs/01-plan/planner-cad.plan.md PR12):
 *   · 메시 AABB 가 부재 AABB 와 ±0.01mm 안에서 맞는다
 *   · 원장 감소 — __tests__/scene-bom-ledger.test.js 허용 목록 186 → 105 (천판↔밴드 · 선반 · 상부 보강목)
 *   · 다칸 모듈은 결정 D1 전까지 예전 그리기
 *   · `?asm=0` 이면 예전 그리기 (되돌리기), 플래너를 따로 열면(부모 창 없음) 예전 그리기
 * 합성 데이터만 (planner-golden.js 배치).
 */
global.dlog = global.dlog || (() => {});
const THREE = require('three');
const Mesh = require('../js/planner/planner-assembly-mesh.js');
const { plannerPanelOutline } = require('../js/planner/planner-cutout.js');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D } = require('../test-utils/scene-parts');

const EPS = 0.01;

/** 명세 판재 메시만 — userData.assembly */
function asmMeshes(p) {
  const out = [];
  p.three.moduleGroup.traverse((o) => { if (o.isMesh && o.userData && o.userData.assembly) out.push(o); });
  return out;
}

/** 메시 AABB 를 모듈 그룹 로컬로 (그룹 → 홀더 → 메시) */
function localBoxOf(mesh, group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
  g.computeBoundingBox();
  return g.boundingBox;
}

function moduleGroupOf(p, id) {
  return p.three.moduleGroup.children.find((g) => g.userData && g.userData.entityKind === 'module' && String(g.userData.moduleId) === String(id));
}

describe('plannerAssemblyMeshOf — 판재 하나', () => {
  const plain = {
    id: 'm-body:side-0#0', rowPartId: 'm-body:side-0', cut: { w: 550, h: 708 }, t: 15,
    frame: { o: [-400, 0, -275], u: '+z', v: '+y', n: '+x' }, features: [],
  };
  plain.box = { min: [-400, 0, -275], max: [-385, 708, 275] };

  test('따내기 없음 → box 크기 BoxGeometry, box 가운데', () => {
    const m = Mesh.plannerAssemblyMeshOf(THREE, plain, '#ccc', plannerPanelOutline);
    expect(m.geometry.parameters).toMatchObject({ width: 15, height: 708, depth: 550 });
    expect(m.position.toArray()).toEqual([-392.5, 354, 0]);
  });

  test('따내기 → 윤곽을 n 으로 누르고 frame 으로 옮긴다 — AABB = box, 따낸 자리는 비었다', () => {
    const notched = Object.assign({}, plain, { features: [{ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708 }] });
    const m = Mesh.plannerAssemblyMeshOf(THREE, notched, '#ccc', plannerPanelOutline);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    expect(bb.min.toArray().map((v, i) => Math.abs(v - plain.box.min[i]) < EPS)).toEqual([true, true, true]);
    expect(bb.max.toArray().map((v, i) => Math.abs(v - plain.box.max[i]) < EPS)).toEqual([true, true, true]);
    // 따낸 자리 (앞 위 40 × 70) 안쪽 점 — 어느 꼭짓점도 그 안에 있지 않다
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      expect(y > 638 + EPS && z > -275 + 510 + EPS).toBe(false);
    }
  });

  test('거울 축(행렬식 < 0)이면 면을 뒤집어 바깥을 향하게 한다', () => {
    const mirror = Object.assign({}, plain, {
      frame: { o: [-385, 0, 275], u: '-z', v: '+y', n: '-x' },
      features: [{ type: 'notch', u0: 0, u1: 40, v0: 638, v1: 708 }],
    });
    const m = Mesh.plannerAssemblyMeshOf(THREE, mirror, '#ccc', plannerPanelOutline);
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingBox();
    const c = new THREE.Vector3();
    m.geometry.boundingBox.getCenter(c);
    // 삼각형 법선이 판 가운데에서 바깥을 향한다
    const pos = m.geometry.attributes.position;
    let outward = 0, total = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
      n.crossVectors(b.clone().sub(a), d.clone().sub(a));
      if (n.lengthSq() < 1e-9) continue;
      mid.copy(a).add(b).add(d).divideScalar(3).sub(c);
      total++;
      if (n.dot(mid) > 0) outward++;
    }
    expect(outward / total).toBeGreaterThan(0.9);
  });

  test('userData — 원장 이름 (측판 left/right · 밴드 band#0 · 뒷판 back · 처짐방지목 brace · 선반 shelf)', () => {
    const mk = '0-planner-lower-0-0';
    const ud = (rowPartId, tags, id) => Mesh.plannerAssemblyUserData({ id: id || rowPartId + '#0', rowPartId, tags: tags || {} }, mk, 'lower-0');
    expect(ud(`${mk}-body:side-0`, { side: 'right' }, `${mk}-body:side-0#1`)).toMatchObject({ entityKind: 'carcass', side: 'right', moduleId: 'lower-0', partId: `${mk}-body:side-0#1`, key3d: `${mk}|${mk}-body:side-0#1` });
    expect(ud(`${mk}-body:band#0-0`)).toMatchObject({ entityKind: 'carcass', side: 'band#0' });
    expect(ud(`${mk}-back-0`)).toMatchObject({ entityKind: 'carcass', side: 'back' });
    expect(ud(`${mk}-body:brace#0-0`)).toMatchObject({ entityKind: 'brace', braceIdx: 0 });
    expect(ud(`${mk}-shelf#0-0`, {}, `${mk}-shelf#0-0#1`)).toMatchObject({ entityKind: 'shelf', shelfIdx: 1, cellIdx: 0 });
  });
});

describe('plannerAssemblyModuleFor — 어느 모듈을 명세로', () => {
  const part = (mk, key) => ({ id: `${mk}-${key}-0#0`, rowPartId: `${mk}-${key}-0`, tags: {} });
  const spec = (unplaced) => ({
    items: [{ modules: [
      { moduleKey: '0-a', parts: [part('0-a', 'body:side'), part('0-a', 'door#0')] },
      { moduleKey: '0-b0', parts: [part('0-b0', 'body:side')] },
      { moduleKey: '0-b1', parts: [part('0-b1', 'body:side')] },
    ] }],
    unplaced: unplaced || [],
  });
  const cells = { '0-a': { plannerId: 'A', dx: 0 }, '0-b0': { plannerId: 'B', dx: -100 }, '0-b1': { plannerId: 'B', dx: 100 } };

  test('한 칸 모듈 → 몸통 판만 (도어는 PR13)', () => {
    const hit = Mesh.plannerAssemblyModuleFor({ spec: spec(), cells }, 'A');
    expect(hit.parts.map((p) => p.rowPartId)).toEqual(['0-a-body:side-0']);
  });
  test('다칸 모듈(명세 모듈 둘) → null (D1 전까지 예전 그리기)', () => {
    expect(Mesh.plannerAssemblyModuleFor({ spec: spec(), cells }, 'B')).toBeNull();
  });
  test('몸통·선반 행이 하나라도 자리 미정이면 null — 지어내지 않는다', () => {
    expect(Mesh.plannerAssemblyModuleFor({ spec: spec([{ moduleKey: '0-a', rowPartId: '0-a-shelf#0-0', reason: 'shelf-height-unknown' }]), cells }, 'A')).toBeNull();
    // 이 단계 밖 부재(도어)의 자리 미정은 몸통 그리기를 막지 않는다
    expect(Mesh.plannerAssemblyModuleFor({ spec: spec([{ moduleKey: '0-a', rowPartId: '0-a-door#1-0', reason: 'x' }]), cells }, 'A')).not.toBeNull();
  });
  test('서랍 박스 판(tags.box)은 빼고 그린다 (PR13)', () => {
    const s = spec();
    s.items[0].modules[0].parts.push(Object.assign(part('0-a', 'body:side'), { tags: { box: 0 } }));
    expect(Mesh.plannerAssemblyModuleFor({ spec: s, cells }, 'A').parts).toHaveLength(1);
  });
});

describe.each(['straight', 'lShape', 'oblique'])('플래너 %s — 명세로 그린다', (name) => {
  let p;
  beforeAll(() => { p = bootPlanner3D(FIXTURES[name], { design: 'ledger', item: name, assembly: true }); });

  test('명세 판재 메시가 있고, 메시 AABB = 부재 AABB (±0.01mm, 모듈 로컬)', () => {
    const meshes = asmMeshes(p);
    expect(meshes.length).toBeGreaterThan(20);
    // 같은 명세를 다시 만들어 판재 box 와 대조 — 홀더는 (dx, 몸통 바닥 높이, 0) 에 있다
    const spec = p.g('plannerCadSpec')();
    const byId = new Map();
    spec.spec.items.forEach((it) => it.modules.forEach((m) => m.parts.forEach((pt) => byId.set(pt.id, { pt, mk: m.moduleKey }))));
    meshes.forEach((mesh) => {
      const hit = byId.get(mesh.userData.partId);
      expect(hit).toBeTruthy();
      const holder = mesh.parent;
      const off = holder.position.toArray();
      expect(off[0]).toBeCloseTo(spec.cells[hit.mk].dx, 6);
      const bb = localBoxOf(mesh, moduleGroupOf(p, mesh.userData.moduleId));
      [0, 1, 2].forEach((i) => {
        expect(Math.abs(bb.min.getComponent(i) - (hit.pt.box.min[i] + off[i]))).toBeLessThan(EPS);
        expect(Math.abs(bb.max.getComponent(i) - (hit.pt.box.max[i] + off[i]))).toBeLessThan(EPS);
      });
    });
  });

  test('명세 판재의 테두리 선은 화면용(display) — 부재가 아니다', () => {
    let lines = 0;
    p.three.moduleGroup.traverse((o) => {
      if (o.parent && o.parent.userData && o.parent.userData.entityKind === 'assembly-holder' && o.userData.entityKind === 'edge') {
        expect(o.userData.display).toBe(true);
        lines++;
      }
    });
    expect(lines).toBe(asmMeshes(p).length);
  });

  test('하부장에는 천판 대신 밴드 2장 (BOM 과 같다)', () => {
    const lowers = p.g('modules').filter((m) => m.section === 'lower' && !m.blind);
    lowers.forEach((m) => {
      const own = asmMeshes(p).filter((x) => String(x.userData.moduleId) === String(m.id));
      if (!own.length) return;
      expect(own.filter((x) => x.userData.side === 'top')).toHaveLength(0);
      expect(own.filter((x) => /^band#/.test(x.userData.side || ''))).toHaveLength(2);
    });
  });
});

describe('되돌리기', () => {
  test('?asm=0 이면 명세 판재가 하나도 없다 (예전 그리기)', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true, searchExtra: '&asm=0' });
    expect(asmMeshes(p)).toHaveLength(0);
    let tops = 0;
    p.three.moduleGroup.traverse((o) => { if (o.isMesh && o.userData.entityKind === 'carcass' && o.userData.side === 'top') tops++; });
    expect(tops).toBeGreaterThan(0);
  });

  test('부모 창(상세설계)이 없으면 예전 그리기 — 플래너를 따로 연 것', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight' });
    expect(asmMeshes(p)).toHaveLength(0);
  });

  test('명세를 못 만들면 예전 그리기 (부모 변환이 던짐)', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true, autoCalc: false });
    p.parent._convertPlannerModules = () => { throw new Error('boom'); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      p.g('autoCalcAllAreas')();
      p.g('renderAll3D')({ fit: false });
    } finally { console.warn = warn; }
    expect(asmMeshes(p)).toHaveLength(0);
  });
});

describe('구조 페이지에 걸렸다', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'mockup-structure.html'), 'utf8');
  test('planner-assembly-mesh.js 를 planner-cutout.js · bom-assembly.js 뒤에 싣는다', () => {
    const at = (f) => html.indexOf(`src="js/${f}?v=`);
    expect(at('planner/planner-assembly-mesh.js')).toBeGreaterThan(at('planner/planner-cutout.js'));
    expect(at('planner/planner-assembly-mesh.js')).toBeGreaterThan(at('detaildesign/bom-assembly.js'));
  });
});
