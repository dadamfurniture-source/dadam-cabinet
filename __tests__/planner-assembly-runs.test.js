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
  test('2026-10-26: 상몰딩이 이어 덮은 키큰장 단(asm.moldingJoined) — 플래너 모듈의 명세 모듈(칸)이 모두 이어졌을 때만 molding.joined', () => {
    const a = asm();
    a.cells = { '0-a': { plannerId: 'A', dx: 5 }, '0-t': { plannerId: 'T', dx: 0 }, '0-u-0': { plannerId: 'U', dx: -150 }, '0-u-1': { plannerId: 'U', dx: 150 } };
    a.moldingJoined = ['0-t', '0-u-0'];   // U 는 칸 하나만 — BOM 이 다른 칸 상몰딩을 아직 낸다
    expect(Mesh.plannerAssemblyRunsFor(a).groups.molding.joined).toEqual(['T']);
    expect(Mesh.plannerAssemblyRunsFor(asm()).groups.molding.joined).toEqual([]);   // 계획이 없으면 빈 목록
  });
});

describe.each([
  // straight: 걸레받이 · 상단 목찬넬 · 상판 · 상몰딩 모두 명세 — 상몰딩은 상부 1800 과 1200 사이 빈 자리를 건너 한 장
  //   (2026-10-26 사장님 확정 "상부장이 있다면 위에는 상몰딩이 있다고 보면됨. 가능한 이어지게.")
  ['straight', ['kick', 'channel', 'top', 'molding'], []],
  // lShape: 상몰딩 · 걸레받이 · 목찬넬은 명세 — 목찬넬은 2026-10-25 사장님 확정으로 벽마다 한 장.
  //   상판은 품목당 한 장(2026-10-26 사장님 확정 "ㄱ자 한 장으로 보내면 업체에서 알아서 나눔")이라 하부 라인이 둘이면
  //   명세가 놓지 않고(run-layout-unknown) 3D 는 배치 공간마다 예전 그리기 — 그림일 뿐, 발주는 ㄱ자 한 장
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

  if (oldKinds.length) {
    test.each(oldKinds)('%s — 명세가 다 못 놓아 예전 그리기 그대로', (k) => {
      const list = meshes(p, (ud) => KIND[k](ud));
      expect(list.length).toBeGreaterThan(0);
      list.forEach((o) => expect(o.userData.assembly).toBeUndefined());
    });
  }

  if (name === 'straight') {
    test('상몰딩은 상부장 사이 빈 자리를 건너 잇는다 (2026-10-26 사장님 확정) — 0 ~ 3600 한 자리, 모듈 경계 조각 2400 (빈 자리 끝) + 1200. 상부 모듈마다가 아니다', () => {
      const list = meshes(p, (ud) => KIND.molding(ud));
      expect(list.map((o) => {
        const g = o.geometry.parameters;
        return [o.userData.rowPartId, Math.round(Math.max(g.width, g.height, g.depth))];
      }).sort()).toEqual([['0-ep-molding-0', 2400], ['0-ep-molding-1', 1200]]);
    });
  }

  if (name === 'lShape') {
    test('ㄱ자 상단 목찬넬은 벽마다 (2026-10-25 사장님 확정) — 본 줄 2700 은 모듈 경계 1800 + 900 (2026-10-26), 옆 줄 1500. 모듈마다가 아니다', () => {
      // 명세 판재는 따내기가 없으면 BoxGeometry (plannerAssemblyMeshOf) — 긴 변 = 재단 길이
      const lens = (pred) => meshes(p, (ud) => pred(ud) && /^0-ep-/.test(ud.rowPartId || '')).map((o) => {
        const g = o.geometry.parameters;
        return [o.userData.rowPartId, Math.round(Math.max(g.width, g.height, g.depth))];
      });
      expect(lens((ud) => topChannel(ud) && ud.side === 'channelFace').sort()).toEqual([['0-ep-channel:front-0', 1800], ['0-ep-channel:front-1', 1500], ['0-ep-channel:front-2', 900]]);
      expect(lens((ud) => topChannel(ud) && ud.side === 'channelBase').sort()).toEqual([['0-ep-channel:back-0', 1800], ['0-ep-channel:back-1', 1500], ['0-ep-channel:back-2', 900]]);
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

describe('ㄱ자 상부 — 상몰딩은 벽마다 한 장 (2026-10-26 사장님 확정 "벽을 기준으로 나눠야함.")', () => {
  // cornerL 과 같은 ㄱ자 하부(가로 3600 · 세로 1970) 위에 상부 두 다리 — 가로 2400, 세로 1200 (회전 90). 겹친 코너에 상부 멍장이 선다
  const layout = {
    version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: 650, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: 325 - 1970 / 2, y: 1970 / 2 - 325, w: 1970, h: 650, moduleH: 870, rotation: 90, finishings: [] },
      { section: 'upper', x: 0, y: 0, w: 2400, h: 320, moduleH: 780, rotation: 0, finishings: [] },
      { section: 'upper', x: 160 - 1200 / 2, y: 1200 / 2 - 160, w: 1200, h: 320, moduleH: 780, rotation: 90, finishings: [] },
    ],
  };
  let p, spec;
  beforeAll(() => {
    p = bootPlanner3D(layout, { design: 'ledger', item: 'lUpper', assembly: true });
    spec = p.g('plannerCadSpec')().spec;
  });

  test('BOM 상몰딩 두 행 — 가로 벽 2080 (832 · 832 · 416), 세로 벽 1149 (멍장 747 + 402, 모서리는 멍장 벽 몫). 예전엔 합 3229 한 행이라 명세가 못 놓았다', () => {
    const it = spec.items[0];
    expect(it.runs.filter((r) => r.parts[0].part === '상몰딩').map((r) => [r.key, r.parts[0].cut.h, r.hostModuleKey]))
      .toEqual([['0-ep-molding-0', 2080, '0-planner-upper-0-0'], ['0-ep-molding-1', 1149, '0-corner-blind-upper']]);
    expect(spec.unplaced.filter((u) => u.part === '상몰딩')).toEqual([]);
  });

  test('3D 는 명세 판재 두 장만 그린다 — 상부 모듈마다 예전 그리기 없음 (3D = BOM)', () => {
    const list = meshes(p, (ud) => KIND.molding(ud));
    expect(list.map((o) => {
      const g = o.geometry.parameters;
      return [o.userData.rowPartId, !!o.userData.assembly, Math.round(Math.max(g.width, g.height, g.depth))];
    })).toEqual([['0-ep-molding-0', true, 2080], ['0-ep-molding-1', true, 1149]]);
  });
});

describe('깊이가 같은 키큰장 위 상몰딩 — 3D 는 명세 띠(모듈 경계 조각)만, 그 키큰장의 예전 상몰딩은 끈다 (2026-10-26 사장님 확정 "깊이가 다르면 따로 함." · "잇는다.")', () => {
  // 한 벽 (회전 0 · 뒷선 y 0). 상부 배치 깊이 320 → 몸통 290, 윗면 1520 + 780 = 2300. 키큰장 배치 깊이 320 이면 몸통도 290 ·
  //   단 높이 합 861 + 979 + 460 = 2300 이라 상부장과 깊이 · 앞면 · 윗면이 같다 (BOM 계획이 잇는다). 키큰장 배치 깊이 650 이면 몸통 620 — 잇지 않는다.
  //   예전엔 이어진 키큰장 상부단(tall-2)이 제 상몰딩 블록(addCrownMolding)을 명세 띠 위에 겹쳐 그렸다 (BOM 에는 그 단 상몰딩이 없다)
  const area = (section, x, w, h, moduleH) => ({ section, x, y: 0, w, h, moduleH, rotation: 0, finishings: [] });
  const moldings = (p) => meshes(p, (ud) => KIND.molding(ud))
    .map((o) => [String(o.userData.moduleId), !!o.userData.assembly, o.userData.rowPartId || null, Math.round(o.geometry.parameters.width)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[2]) < String(b[2]) ? -1 : 1));
  // 2026-10-26 조각 — 상부 2400 배치는 상부장 960 · 960 · 480, 1200 배치는 600 · 600 (자동 분배). 3000 한 자리를 모듈 경계에서 나눈다
  //   (장 수가 가장 적게 · 앞 조각이 가장 길게 · 800~2400 — "자르는 건 모듈길이별로 잘라야해")
  test.each([
    ['줄 끝 (상부 0 … 2400 · 키큰장 2400 … 3000 → 1920 + 1080)', [area('lower', 0, 2400, 650, 870), area('upper', 0, 2400, 320, 780), area('tall', 2400, 600, 320, 2300)],
      [['upper-0', true, '0-ep-molding-0', 1920], ['upper-0', true, '0-ep-molding-1', 1080]]],
    ['줄 시작 (키큰장 0 … 600 · 상부 600 … 3000 → 1560 + 1440)', [area('lower', 600, 2400, 650, 870), area('upper', 600, 2400, 320, 780), area('tall', 0, 600, 320, 2300)],
      [['upper-0', true, '0-ep-molding-0', 1560], ['upper-0', true, '0-ep-molding-1', 1440]]],
    ['상부장 사이 (상부 0 … 1200 · 키큰장 1200 … 1800 · 상부 1800 … 3000 → 1800 + 1200)', [area('lower', 0, 1200, 650, 870), area('lower', 1800, 1200, 650, 870),
      area('upper', 0, 1200, 320, 780), area('upper', 1800, 1200, 320, 780), area('tall', 1200, 600, 320, 2300)],
    [['upper-0', true, '0-ep-molding-0', 1800], ['upper-0', true, '0-ep-molding-1', 1200]]],
    // 깊이가 다르면 따로 — 상부 라인 명세 띠 2400 + 키큰장 상부단 제 상몰딩 블록 600 (BOM 도 두 행)
    ['깊이가 다른 줄 끝 키큰장 (배치 깊이 650)', [area('lower', 0, 2400, 650, 870), area('upper', 0, 2400, 320, 780), area('tall', 2400, 600, 650, 2300)],
      [['tall-2', false, null, 600], ['upper-0', true, '0-ep-molding-0', 2400]]],
  ])('%s', (name, mods, want) => {
    const p = bootPlanner3D({ version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null, modules: mods }, { design: 'ledger', item: 'tallMold', assembly: true });
    const asm = p.g('plannerCadSpec')();
    expect(asm.spec.unplaced.filter((u) => u.part === '상몰딩')).toEqual([]);
    expect(asm.spec.items[0].runs.filter((r) => r.parts[0].part === '상몰딩').map((r) => r.parts[0].cut.h)).toEqual(want.filter((w) => w[1]).map((w) => w[3]));
    expect(moldings(p)).toEqual(want);
    // 3D = BOM — 키큰장 상부단 상몰딩 행은 예전 블록을 그릴 때만 있다 (이어지면 BOM 에도 없다)
    const tallTop = '0-planner-tall-2-0';
    const tallRows = asm.spec.items[0].modules.filter((m) => m.moduleKey === tallTop).flatMap((m) => m.parts.filter((pt) => pt.part === '상몰딩'))
      .concat(asm.spec.unplaced.filter((u) => u.moduleKey === tallTop && u.part === '상몰딩'));
    expect(tallRows.length > 0).toBe(want.some((w) => w[0] === 'tall-2'));
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
