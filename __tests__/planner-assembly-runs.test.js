/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, beforeAll */
/**
 * CAD 베타 PR14 (정해진 것만) — 라인 부재를 조립 명세로 (planner-assembly-mesh.js plannerAssemblyRunsFor).
 *
 *   걸레받이 · 상단 목찬넬 · 상몰딩 — 품목에서 그 묶음 행이 **전부** 놓였을 때만 명세 판재로 그리고 예전 그리기를 끈다.
 *     하나라도 놓이지 않으면(run-layout-unknown) 그 묶음은 예전 그리기 그대로 (두 번 그리지도, 지어내지도 않는다).
 *   좌우 마감재(휠라 · 몰딩 · EP) — 결정 D9 전이라 아직 그리지 않는다.
 *   상판 — 2026-10-24 사장님 D3 부터 명세로 (몸통 뒤 여유 back 을 넘겨 상판 뒤 = 벽). 예전 그리기와 같은 자리여야 한다.
 *   라인 부재는 호스트 모듈(라인 첫 모듈) 그룹과 같은 자리·회전의 형제 그룹에 — 모듈 선택 상자가 라인 폭으로 커지지 않게.
 * 합성 데이터만 (planner-golden.js 배치).
 */
global.dlog = global.dlog || (() => {});
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D } = require('../test-utils/scene-parts');
const Mesh = require('../js/planner/planner-assembly-mesh.js');

function meshes(p, pred) {
  const out = [];
  p.three.moduleGroup.traverse((o) => { if (o.isMesh && o.userData && pred(o.userData, o)) out.push(o); });
  return out;
}
const topChannel = (ud) => ud.entityKind === 'carcass' && (ud.side === 'channelFace' || ud.side === 'channelBase') && ud.mid == null;
const KIND = {
  top: (ud) => ud.entityKind === 'top-panel',
  kick: (ud) => ud.entityKind === 'toe-kick',
  channel: topChannel,
  molding: (ud) => ud.entityKind === 'molding',
};
const isUpperModule = (p, id) => (p.g('modules').find((m) => String(m.id) === String(id)) || {}).section === 'upper';
/** 키큰장 단이 제 폭으로 내는 상단 목찬넬 (모듈 행 — 라인 부재가 아니다, addTallTierParts) */
const isTallModule = (p, id) => (p.g('modules').find((m) => String(m.id) === String(id)) || {}).section === 'tall';

describe('plannerAssemblyRunsFor — 묶음마다 다 놓였을 때만', () => {
  const part = (fam, n) => ({ id: `0-ep-${fam}-${n}#0`, rowPartId: `0-ep-${fam}-${n}`, box: { min: [0, 0, 0], max: [1, 1, 1] } });
  const asm = (unplaced, host) => ({
    spec: { items: [{ itemIdx: 0, modules: [], runs: [
      { hostModuleKey: host || '0-a', parts: [part('top', 0)] },
      { hostModuleKey: '0-a', parts: [part('kick', 0)] },
      { hostModuleKey: '0-a', parts: [part('filler:left', 0)] },
    ] }], unplaced: unplaced || [] },
    cells: { '0-a': { plannerId: 'A', dx: 5 } },
  });
  test('다 놓이면 drawn, 호스트 플래너 id · dx 를 단다', () => {
    const r = Mesh.plannerAssemblyRunsFor(asm());
    expect(r.epKey).toBe('0-ep');
    expect(r.groups.kick).toMatchObject({ drawn: true });
    expect(r.groups.kick.parts[0]).toMatchObject({ host: 'A', dx: 5 });
    expect(r.groups.top.parts).toHaveLength(1);
    expect(r.groups.top.drawn).toBe(true);   // D3 (2026-10-24) 부터 상판도 명세
    expect(r.groups.molding.drawn).toBe(false);   // 판재가 없다
  });
  test('그 묶음 행이 하나라도 unplaced 면 drawn 아님 (예전 그리기)', () => {
    const r = Mesh.plannerAssemblyRunsFor(asm([{ moduleKey: '0-ep', rowPartId: '0-ep-kick-1', reason: 'run-layout-unknown' }]));
    expect(r.groups.kick.drawn).toBe(false);
  });
  test('좌우 마감재는 놓였어도 그리지 않는다 (결정 D9 전)', () => {
    const r = Mesh.plannerAssemblyRunsFor(asm());
    expect(r.groups.finish.parts).toHaveLength(1);
    expect(r.groups.finish.drawn).toBe(false);
  });
  test('호스트 모듈을 못 찾으면 drawn 아님', () => {
    const r = Mesh.plannerAssemblyRunsFor({ spec: { items: [{ itemIdx: 0, modules: [], runs: [{ hostModuleKey: '0-zz', parts: [part('kick', 0)] }] }], unplaced: [] }, cells: {} });
    expect(r.groups.kick.drawn).toBe(false);
  });
});

describe.each([
  // straight: 걸레받이 · 상단 목찬넬 · 상판은 명세 (상몰딩은 상부 라인이 끊겨 run-layout-unknown → 예전)
  ['straight', ['kick', 'channel', 'top'], ['molding']],
  // lShape: 상몰딩 · 걸레받이 · 목찬넬은 명세 — 목찬넬은 2026-10-25 사장님 확정으로 벽마다 한 장.
  //   상판은 BOM 이 아직 품목당 한 장이라 하부 라인이 둘이면 run-layout-unknown → 예전 (상판 발주 요청서 양식 확인 전)
  ['lShape', ['kick', 'molding', 'channel'], ['top']],
])('%s', (name, specKinds, oldKinds) => {
  let p;
  beforeAll(() => { p = bootPlanner3D(FIXTURES[name], { design: 'ledger', item: name, assembly: true }); });

  test.each(specKinds)('%s — 명세 판재만 (예전 그리기 없음)', (k) => {
    const list = meshes(p, (ud) => KIND[k](ud) && !(k === 'molding' && !isUpperModule(p, ud.moduleId) && !ud.assembly)
      && !(k === 'channel' && isTallModule(p, ud.moduleId) && !ud.assembly));
    expect(list.length).toBeGreaterThan(0);
    list.forEach((o) => {
      expect(o.userData.assembly).toBe(true);
      expect(o.userData.rowPartId).toMatch(/^0-ep-/);
    });
  });

  test.each(oldKinds)('%s — 명세가 다 못 놓아 예전 그리기 그대로', (k) => {
    const list = meshes(p, (ud) => KIND[k](ud));
    expect(list.length).toBeGreaterThan(0);
    list.forEach((o) => expect(o.userData.assembly).toBeUndefined());
  });

  if (name === 'lShape') {
    test('ㄱ자 상단 목찬넬은 벽마다 한 장 (2026-10-25 사장님 확정) — 본 줄 2700 · 옆 줄 1500, 모듈마다가 아니다', () => {
      // 명세 판재는 따내기가 없으면 BoxGeometry (plannerAssemblyMeshOf) — 긴 변 = 재단 길이
      const lens = (pred) => meshes(p, (ud) => pred(ud) && /^0-ep-/.test(ud.rowPartId || '')).map((o) => {
        const g = o.geometry.parameters;
        return [o.userData.rowPartId, Math.round(Math.max(g.width, g.height, g.depth))];
      });
      expect(lens((ud) => topChannel(ud) && ud.side === 'channelFace')).toEqual([['0-ep-channel:front-0', 2700], ['0-ep-channel:front-1', 1500]]);
      expect(lens((ud) => topChannel(ud) && ud.side === 'channelBase')).toEqual([['0-ep-channel:back-0', 2700], ['0-ep-channel:back-1', 1500]]);
    });
  }

  test('라인 부재는 호스트 모듈 그룹 밖 (같은 자리·회전의 형제 그룹)', () => {
    const runs = meshes(p, (ud) => ud.assembly && /^0-ep-/.test(ud.rowPartId || ''));
    expect(runs.length).toBeGreaterThan(0);
    runs.forEach((o) => {
      let g = o.parent;
      while (g && g.userData.entityKind !== 'assembly-runs') {
        expect(g.userData.entityKind).not.toBe('module');
        g = g.parent;
      }
      expect(g).toBeTruthy();
      const host = p.three.moduleGroup.children.find((c) => c.userData.entityKind === 'module' && String(c.userData.moduleId) === String(g.userData.moduleId));
      expect(g.position.toArray()).toEqual(host.position.toArray());
      expect(g.rotation.y).toBe(host.rotation.y);
    });
  });
});

describe('상판 — 명세 판재가 예전 그리기(addTopPanel)와 같은 자리 (D3: 뒤 = 벽, 앞 = 배치 앞선)', () => {
  const worldBox = (o) => {
    o.updateWorldMatrix(true, false);
    const THREE = require('three');
    return new THREE.Box3().setFromObject(o);
  };
  const round = (b) => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => Math.round(v));
  test('straight — 앞뒤 · 높이가 ?asm=0 의 상판과 같고, 가로는 예전 모듈 상판들을 덮는다 (이 배치는 도면 마감재 없음)', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true });
    const q = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true, searchExtra: '&asm=0' });
    const a = meshes(p, KIND.top), b = meshes(q, KIND.top);
    expect(a).toHaveLength(1);   // 명세 — 하부 라인 한 장
    expect(b.length).toBeGreaterThan(0);   // 예전 — 이 배치에서는 모듈마다
    expect(a[0].userData.assembly).toBe(true);
    const n = round(worldBox(a[0]));
    const olds = b.map((o) => round(worldBox(o)));
    olds.forEach((o) => {
      expect([n[1], n[2], n[4], n[5]]).toEqual([o[1], o[2], o[4], o[5]]);   // y · z (뒤 = 벽, 앞 = 배치 앞선)
      // 하부 폭 합 3598 vs 도면 3600 — 원장의 기존 2mm 차이 (planner-export-cad 시험 주석)
      expect(n[0]).toBeLessThanOrEqual(o[0] + 2);
      expect(n[3]).toBeGreaterThanOrEqual(o[3] - 2);
    });
  });
});

describe('좌우 마감재 · 되돌리기', () => {
  test('straight — 도면에 마감재가 없으면 좌우 마감재 행도 그림도 없다 (D9: 도면이 정본, 스펙 휠라 60 은 발주 안 함)', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true });
    const spec = p.g('plannerCadSpec')().spec;
    expect(spec.items[0].runs.some((r) => /filler:|molding:(left|right)|ep:/.test(r.key))).toBe(false);
    expect(spec.unplaced.some((u) => /filler:|ep:/.test(u.rowPartId))).toBe(false);
    expect(meshes(p, (ud) => ud.entityKind === 'finishing')).toHaveLength(0);
  });

  test('?asm=0 이면 라인 부재도 전부 예전 그리기', () => {
    const p = bootPlanner3D(FIXTURES.straight, { design: 'ledger', item: 'straight', assembly: true, searchExtra: '&asm=0' });
    expect(meshes(p, (ud) => ud.assembly)).toHaveLength(0);
    ['top', 'kick', 'channel', 'molding'].forEach((k) => expect(meshes(p, KIND[k]).length).toBeGreaterThan(0));
    expect(meshes(p, (ud) => ud.entityKind === 'finishing')).toHaveLength(0);
  });
});
