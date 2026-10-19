/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, window, location, MessageEvent, global, Buffer, setTimeout */
/**
 * CAD 베타 T4 (PR1b): 관리자 근사 GLB 내보내기 — js/planner/planner-export.js
 * (docs/01-plan/planner-cad.plan.md 단계 0 · 개정 #11, docs/01-plan/cad-beta/threads.md T4)
 *
 *   · 노드 수 — GLB 의 부재 노드 = T1 겹침 목록(collectScenePieces)의 부재 수. 같은 거름망이다
 *   · 화면용 메시 0 — 테두리·그림자판·선택 상자·배치 상자·다리발·가전 표시·검사 테두리가 없다
 *   · 배율 0.001 — 루트 노드 scale, 장면은 mm 그대로 (GLB 를 열면 m)
 *   · 관리자만 — 버튼은 숨김으로 시작, 같은 오리진 부모가 admin:true 라고 답할 때만 보인다
 */
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectScenePieces } = require('../test-utils/scene-parts');
const finish = require('../js/planner/planner-finish.js');
const {
  plannerExportBuildScene, plannerExportGlb, plannerExportServeRole, PlannerExport,
  PLANNER_EXPORT_SCALE, PLANNER_EXPORT_ROOT_NAME,
} = require('../js/planner/planner-export.js');
const { GLTFExporter } = require('three/examples/jsm/exporters/GLTFExporter.js');

// jest 의 jsdom 환경에는 TextEncoder 가 없다 (브라우저에는 있다). GLB 의 JSON 청크를 만들 때 쓰인다 —
//   없으면 FileReader 콜백 안에서 던져 parse 가 영영 끝나지 않는다.
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = require('util').TextEncoder;

const DISPLAY_KINDS = finish.PLANNER_FINISH_PAINT_SKIP.concat(['preflight', 'measure']);

/** GLB 의 JSON 덩어리 (헤더 12바이트 → 첫 청크 길이·형식 → JSON). */
function glbJson(buf) {
  const dv = new DataView(buf);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);            // 'glTF'
  expect(dv.getUint32(4, true)).toBe(2);
  const len = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a);           // 'JSON'
  return JSON.parse(Buffer.from(buf, 20, len).toString('utf8'));
}

describe.each(Object.keys(FIXTURES))('%s 장면 → 근사 GLB', (name) => {
  let p, THREE, pieces, built, gltf;
  beforeAll(async () => {
    p = bootPlanner3D(FIXTURES[name], { design: 'glb', item: name });
    // 플래너 첫 화면 타이머(setTimeout 100 → renderAll3D)가 장면을 다시 짓는다. 그 뒤의 장면으로 잰다 —
    //   아니면 await 사이에 메시가 갈려 원래 장면 쪽 matrixWorld 가 아직 계산되지 않은 채로 남는다.
    await new Promise((r) => setTimeout(r, 150));
    THREE = window.THREE;
    pieces = collectScenePieces(p);
    built = plannerExportBuildScene(THREE, p.three.moduleGroup, { exportedAt: '2026-10-19T00:00:00Z' });
    const r = await plannerExportGlb(THREE, GLTFExporter, p.three.moduleGroup, { exportedAt: '2026-10-19T00:00:00Z' });
    gltf = glbJson(r.glb);
  });

  test('부재 수 = T1 겹침 목록의 부재 수, 모듈 노드 = 플래너 모듈 수', () => {
    expect(pieces.length).toBeGreaterThan(20);
    expect(built.parts).toBe(pieces.length);
    expect(built.modules).toBe(new Set(pieces.map((r) => r.moduleId)).size);
    // 장면 안에 화면용 메시가 실제로 있어야 "0" 이 의미가 있다
    let display = 0;
    p.three.moduleGroup.traverse((o) => { if (o.isMesh && DISPLAY_KINDS.indexOf(o.userData && o.userData.entityKind) >= 0) display++; });
    expect(display).toBeGreaterThan(0);
  });

  test('GLB 노드 수 = 루트 1 + 모듈 + 부재, 메시 노드 = 부재', () => {
    expect(gltf.nodes.length).toBe(1 + built.modules + built.parts);
    expect(gltf.nodes.filter((n) => n.mesh != null).length).toBe(built.parts);
    expect(gltf.scenes[gltf.scene || 0].nodes.length).toBe(1);
  });

  test('화면용 메시 0 — 노드 이름·extras 에 표시용 종류가 없다', () => {
    const kinds = gltf.nodes.filter((n) => n.mesh != null).map((n) => n.extras && n.extras.entityKind);
    expect(kinds.every(Boolean)).toBe(true);
    expect(kinds.filter((k) => DISPLAY_KINDS.indexOf(k) >= 0)).toEqual([]);
    gltf.nodes.filter((n) => n.mesh != null).forEach((n) => {
      expect(n.name).toBe(`${n.extras.entityKind}${n.extras.side ? ':' + n.extras.side : ''}·${n.extras.moduleId}`);
    });
  });

  test('루트 배율 0.001 · 근사 표시', () => {
    const root = gltf.nodes[gltf.scenes[gltf.scene || 0].nodes[0]];
    expect(root.name).toBe(PLANNER_EXPORT_ROOT_NAME);
    expect(root.scale).toEqual([PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE, PLANNER_EXPORT_SCALE]);
    expect(root.extras.approx).toBe(true);
  });

  test('부재 위치가 장면과 같다 — 월드 바운딩 박스(mm)가 일치', () => {
    const a = new THREE.Box3();
    p.three.moduleGroup.updateMatrixWorld(true);   // 렌더 루프가 없으니 직접
    p.three.moduleGroup.traverse((o) => {
      if (window.plannerExportIsPart(o)) a.union(new THREE.Box3().setFromObject(o));
    });
    built.root.scale.setScalar(1);
    built.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(built.root);
    ['min', 'max'].forEach((k) => ['x', 'y', 'z'].forEach((ax) => expect(b[k][ax]).toBeCloseTo(a[k][ax], 3)));
  });
});

describe('관리자만 — 역할은 부모 창이 postMessage 로', () => {
  test('구조 페이지: 버튼은 숨김으로 실리고, 부모에게 역할을 묻는다', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'glb', item: 'role' });
    const btn = window.document.getElementById('glbExportBtn');
    expect(btn).not.toBeNull();
    expect(btn.hidden).toBe(true);
    expect(btn.closest('.pdm-wrap')).not.toBeNull();
    expect(p.messages).toContainEqual({ type: 'DADAM_PLANNER_ROLE_REQUEST' });
  });

  test('버튼은 숨김으로 시작, 같은 오리진 admin:true 에만 보인다', () => {
    const btn = window.document.createElement('button');
    PlannerExport.mount({ three: () => null, button: btn });
    expect(btn.hidden).toBe(true);
    const send = (data, origin) => window.dispatchEvent(new MessageEvent('message', { data, origin, source: window.parent }));
    send({ type: 'DADAM_PLANNER_ROLE', admin: true }, 'https://evil.example');
    expect(btn.hidden).toBe(true);
    send({ type: 'DADAM_PLANNER_ROLE', admin: 'yes' }, location.origin);
    expect(btn.hidden).toBe(true);
    send({ type: 'DADAM_PLANNER_ROLE', admin: true }, location.origin);
    expect(btn.hidden).toBe(false);
    send({ type: 'DADAM_PLANNER_ROLE', admin: false }, location.origin);
    expect(btn.hidden).toBe(true);
  });

  test('관리자가 아니면 download 는 아무것도 하지 않는다', async () => {
    PlannerExport.setAdmin(false);
    await expect(PlannerExport.download()).resolves.toBeNull();
  });

  test('부모 쪽: 같은 오리진 요청에만 isAdmin 결과로 답한다', async () => {
    let handler = null;
    const win = { location: { origin: 'https://dadam.test' }, addEventListener: (t, fn) => { if (t === 'message') handler = fn; } };
    let admin = true;
    expect(plannerExportServeRole(win, async () => admin)).toBe(true);
    expect(plannerExportServeRole(win, async () => admin)).toBe(false);   // 두 번 걸지 않는다
    const posted = [];
    const source = { postMessage: (msg, origin) => posted.push([msg, origin]) };
    await handler({ data: { type: 'DADAM_PLANNER_ROLE_REQUEST' }, origin: 'https://evil.example', source });
    expect(posted).toEqual([]);
    await handler({ data: { type: 'DADAM_PLANNER_ROLE_REQUEST' }, origin: 'https://dadam.test', source });
    admin = false;
    await handler({ data: { type: 'DADAM_PLANNER_ROLE_REQUEST' }, origin: 'https://dadam.test', source });
    const failing = async () => { throw new Error('rpc'); };
    let h2 = null;
    plannerExportServeRole({ location: win.location, addEventListener: (t, fn) => { h2 = fn; } }, failing);
    await h2({ data: { type: 'DADAM_PLANNER_ROLE_REQUEST' }, origin: 'https://dadam.test', source });
    expect(posted).toEqual([
      [{ type: 'DADAM_PLANNER_ROLE', admin: true }, 'https://dadam.test'],
      [{ type: 'DADAM_PLANNER_ROLE', admin: false }, 'https://dadam.test'],
      [{ type: 'DADAM_PLANNER_ROLE', admin: false }, 'https://dadam.test'],
    ]);
  });
});
