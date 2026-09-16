/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global */
/**
 * 런 단위 부재(상판·걸레받이) 도형 시험.
 *
 * 왜 있는가 — 구조 페이지를 열 때마다 콘솔에 이것이 떴다:
 *
 *   THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN.
 *
 * 범인은 **걸레받이**였다. `addToeKick` 은 영역을 `areaOfModule(m)` 로 찾아 놓고,
 * 그 영역의 모듈은 `x.areaId === area.id` 로 다시 모았다. `areaId` 가 없는 옛
 * 설계의 모듈에서는 **영역은 찾아지는데 멤버는 0명**이라, `Math.min(...[])` 이
 * Infinity · `Math.max(...[])` 이 -Infinity 가 되어 폭 -Infinity · 자리 NaN 인
 * 상자가 three.js 로 들어갔다. `addTopPanel` 은 같은 어긋남이 다른 증상으로 —
 * "런의 첫 모듈" 이 undefined 라 가드가 못 걸리고 **모듈마다** 영역 전폭짜리
 * 상판을 그려 겹쳤다 (폭은 `area.W` 라 NaN 이 되지 않아 콘솔에 안 보였다).
 *
 * 그래서 이 시험은 두 갈래를 모두 지킨다:
 *   1. 씬 어디에도 유한하지 않은 수가 없다 (회귀 가드 — 고치기 전에는 실패한다)
 *   2. 런 단위 부재는 런에 **한 장**이다 (상판·걸레받이)
 *
 * 두 경로를 모두 본다:
 *   · 옛 설계 — `dadam_struct_modules_v1` 에 심어진 모듈 (areaId **없음**)
 *   · 지금 설계 — 자동계산이 영역에 넣은 모듈 (areaId **있음**)
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');
const { bootPlanner3D, threeShim } = require('../test-utils/scene-parts');

const FIXTURE_NAMES = ['straight', 'lShape', 'oblique'];

/** three/addons OrbitControls 자리 — target·update 만 쓰인다. */
function makeStubOrbitControls(THREE) {
  return class StubOrbitControls {
    constructor() {
      this.target = new THREE.Vector3();
      this.enableDamping = false;
      this.dampingFactor = 0;
    }
    update() {}
    addEventListener() {}
    removeEventListener() {}
    dispose() {}
  };
}

/**
 * **옛 설계** 경로로 부팅한다 — 모듈을 `dadam_struct_modules_v1` 에 그대로 심는다.
 * `modulesFromFixture` 가 만드는 모듈에는 `areaId` 가 없다. 이것이 버그가 살던 자리다.
 * (`bootPlanner3D` 는 modules:false + 자동계산이라 areaId 가 붙은 모듈만 만든다)
 */
function bootLegacy(layout, item) {
  const win = global.window;
  const THREE = threeShim();
  win.THREE = THREE;
  win.OrbitControls = makeStubOrbitControls(THREE);
  win.requestAnimationFrame = () => 0;
  win.cancelAnimationFrame = () => {};

  const seed = seedFor(layout, { design: 'runpart', item, modules: true });
  const search = seed._search;
  delete seed._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  const three = p.g('three');
  if (!three || !three.moduleGroup) throw new Error('3D 가 초기화되지 않았습니다');
  p.three = three;
  p.g('renderAll3D')({ fit: false });
  return p;
}

/** 옛 설계 모듈에 areaId 가 정말 없는지 — 시험이 엉뚱한 경로를 보고 있으면 여기서 멈춘다. */
function assertLegacyShape(p) {
  const mods = p.g('modules') || [];
  expect(mods.length).toBeGreaterThan(0);
  expect(mods.filter((m) => m.areaId).length).toBe(0);
}

// ── 씬 순회 ────────────────────────────────────────────────────

/** 유한하지 않은 수를 가진 객체를 전부 찾는다 (mesh 든 테두리선이든). */
function nonFiniteNodes(three) {
  const bad = [];
  three.moduleGroup.traverse((o) => {
    if (!o.geometry) return;
    const ud = o.userData || {};
    const why = [];

    const prm = o.geometry.parameters || {};
    Object.keys(prm).forEach((k) => {
      const v = prm[k];
      if (typeof v === 'number' && !Number.isFinite(v)) why.push(`geometry.parameters.${k}=${v}`);
    });

    ['position', 'scale'].forEach((field) => {
      const v = o[field];
      if (!v) return;
      ['x', 'y', 'z'].forEach((axis) => {
        if (!Number.isFinite(v[axis])) why.push(`${field}.${axis}=${v[axis]}`);
      });
    });

    // 실제 정점까지 본다 — parameters 가 멀쩡해도 정점이 NaN 이면 three 가 여기서 운다.
    o.geometry.computeBoundingSphere();
    const bs = o.geometry.boundingSphere;
    if (!bs || !Number.isFinite(bs.radius)) why.push(`boundingSphere.radius=${bs && bs.radius}`);

    if (why.length) bad.push(`${ud.entityKind || o.type}(${ud.moduleId || '?'}): ${why.join(' · ')}`);
  });
  return bad;
}

/** entityKind 로 mesh 를 모은다. */
function meshesOfKind(three, kind) {
  const out = [];
  three.moduleGroup.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.entityKind === kind) out.push(o);
  });
  return out;
}

/** 그 부재를 그린 모듈이 속한 영역 id — 플래너 자신의 규칙(areaOfModule)으로 묻는다. */
function areaIdOfPart(p, mesh) {
  const m = (p.g('modules') || []).find((x) => x.id === mesh.userData.moduleId);
  const a = m && p.g('areaOfModule')(m);
  return a ? a.id : null;
}

/** 영역에 속한 몸통 모듈들 — 플래너의 helper 를 그대로 쓴다 (같은 규칙인지 보는 것이 목적). */
function hostsOf(p, areaId) {
  const area = (p.g('areas') || []).find((a) => a.id === areaId);
  return p.g('modulesOfArea')(area);
}

// ── 1. 유한하지 않은 도형이 없다 (회귀 가드) ───────────────────

describe('씬에 유한하지 않은 수가 없다 — computeBoundingSphere NaN 회귀 가드', () => {
  test.each(FIXTURE_NAMES)('%s — 옛 설계(areaId 없음): 불러온 직후', (name) => {
    const p = bootLegacy(FIXTURES[name], 'nan-load-' + name);
    assertLegacyShape(p);
    expect(nonFiniteNodes(p.three)).toEqual([]);
  });

  test.each(FIXTURE_NAMES)('%s — 옛 설계(areaId 없음): ⚡ 전체 자동계산 뒤', (name) => {
    const p = bootLegacy(FIXTURES[name], 'nan-auto-' + name);
    p.g('autoCalcAllAreas')();
    p.g('renderAll3D')({ fit: false });
    expect(nonFiniteNodes(p.three)).toEqual([]);
  });

  test.each(FIXTURE_NAMES)('%s — 지금 설계(areaId 있음): 자동계산 뒤', (name) => {
    const p = bootPlanner3D(FIXTURES[name], { design: 'runpart-id', item: 'nan-' + name });
    // 자동계산이 넣은 모듈에는 areaId 가 붙는다 — 이쪽 경로도 같이 지킨다.
    expect((p.g('modules') || []).every((m) => !!m.areaId)).toBe(true);
    expect(nonFiniteNodes(p.three)).toEqual([]);
  });
});

// ── 2. 걸레받이 — 런에 한 장 · 폭은 런의 모듈 구간 ─────────────

describe('걸레받이는 런에 한 장이고 폭은 런의 모듈 구간이다 (W12-43)', () => {
  test.each(FIXTURE_NAMES)('%s — 옛 설계(areaId 없음)', (name) => {
    const p = bootLegacy(FIXTURES[name], 'kick-legacy-' + name);
    assertLegacyShape(p);
    const kicks = meshesOfKind(p.three, 'toe-kick');
    expect(kicks.length).toBeGreaterThan(0);

    const byArea = new Map();
    kicks.forEach((k) => {
      const areaId = areaIdOfPart(p, k);
      expect(areaId).not.toBeNull();
      byArea.set(areaId, (byArea.get(areaId) || 0) + 1);
    });
    // 런에 한 장 — 영역마다 걸레받이가 정확히 하나다 (= 영역 수와 걸레받이 수가 같다)
    expect(byArea.size).toBe(kicks.length);

    kicks.forEach((k) => {
      const hosts = hostsOf(p, areaIdOfPart(p, k));
      expect(hosts.length).toBeGreaterThan(0);
      const x0 = Math.min(...hosts.map((x) => x.x || 0));
      const x1 = Math.max(...hosts.map((x) => (x.x || 0) + (x.W || 0)));
      expect(k.geometry.parameters.width).toBeCloseTo(x1 - x0, 6);
      ['x', 'y', 'z'].forEach((axis) => expect(Number.isFinite(k.position[axis])).toBe(true));
    });
  });

  test.each(FIXTURE_NAMES)('%s — 지금 설계(areaId 있음)', (name) => {
    const p = bootPlanner3D(FIXTURES[name], { design: 'runpart-id', item: 'kick-' + name });
    const kicks = meshesOfKind(p.three, 'toe-kick');
    expect(kicks.length).toBeGreaterThan(0);
    const seen = new Set();
    kicks.forEach((k) => {
      const areaId = areaIdOfPart(p, k);
      expect(seen.has(areaId)).toBe(false);      // 런에 한 장
      seen.add(areaId);
      const hosts = hostsOf(p, areaId);
      const x0 = Math.min(...hosts.map((x) => x.x || 0));
      const x1 = Math.max(...hosts.map((x) => (x.x || 0) + (x.W || 0)));
      expect(k.geometry.parameters.width).toBeCloseTo(x1 - x0, 6);
      ['x', 'y', 'z'].forEach((axis) => expect(Number.isFinite(k.position[axis])).toBe(true));
    });
  });
});

// ── 3. 상판 — 런에 한 장 (모듈마다가 아니다) ───────────────────

describe('상판은 런에 한 장이다 — 모듈마다 그리지 않는다 (W12-38)', () => {
  test.each(FIXTURE_NAMES)('%s — 옛 설계(areaId 없음)', (name) => {
    const p = bootLegacy(FIXTURES[name], 'top-legacy-' + name);
    assertLegacyShape(p);
    const tops = meshesOfKind(p.three, 'top-panel');
    expect(tops.length).toBeGreaterThan(0);
    const seen = new Set();
    tops.forEach((t) => {
      const areaId = areaIdOfPart(p, t);
      expect(areaId).not.toBeNull();
      expect(seen.has(areaId)).toBe(false);      // 런에 한 장 — 겹치지 않는다
      seen.add(areaId);
      ['x', 'y', 'z'].forEach((axis) => expect(Number.isFinite(t.position[axis])).toBe(true));
    });
    // 상판을 그린 모듈은 언제나 그 런의 **첫 모듈**이다
    tops.forEach((t) => {
      const hosts = hostsOf(p, areaIdOfPart(p, t));
      expect(hosts[0].id).toBe(t.userData.moduleId);
    });
  });

  test.each(FIXTURE_NAMES)('%s — 지금 설계(areaId 있음)', (name) => {
    const p = bootPlanner3D(FIXTURES[name], { design: 'runpart-id', item: 'top-' + name });
    const tops = meshesOfKind(p.three, 'top-panel');
    expect(tops.length).toBeGreaterThan(0);
    const seen = new Set();
    tops.forEach((t) => {
      const areaId = areaIdOfPart(p, t);
      expect(seen.has(areaId)).toBe(false);
      seen.add(areaId);
      const hosts = hostsOf(p, areaId);
      expect(hosts[0].id).toBe(t.userData.moduleId);
    });
  });
});

// ── 4. 멤버십이 한 규칙이다 ────────────────────────────────────

describe('modulesOfArea 는 areaOfModule 과 같은 규칙이다', () => {
  test.each(FIXTURE_NAMES)('%s — 모든 몸통 모듈은 제 영역의 멤버다', (name) => {
    const p = bootLegacy(FIXTURES[name], 'member-' + name);
    const modulesOfArea = p.g('modulesOfArea');
    const areaOfModule = p.g('areaOfModule');
    (p.g('modules') || []).forEach((m) => {
      if (m.isFinishing) return;
      const a = areaOfModule(m);
      if (!a) return;                       // 영역 밖 모듈은 런 부재도 제 폭으로 그린다
      expect(modulesOfArea(a).map((x) => x.id)).toContain(m.id);
    });
  });
});
