/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, jest, document, __dirname */
/**
 * 칸 내경 측정 (ArchiWood 영상 분석 A, 2026-10-18).
 *
 *   · plannerMeasureFromHits — 뒷판 안쪽 면에서 ±X · ±Y 로 판까지 재서 칸 안쪽 가로 × 세로
 *   · 도어는 건너뛰고, 옆이 트였거나 뒷판이 아닌 면이면 null
 *   · 모듈이 돌아가 있어도 모듈 기준 축으로 잰다
 *   · 버튼 · 딱지 · HTML 배선
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const {
  PlannerMeasure,
  plannerMeasureFromHits,
  plannerMeasureFmt,
} = require('../js/planner/planner-measure.js');

const ROOT = path.join(__dirname, '..');

function box(w, h, d, x, y, z, kind) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z);
  m.userData = { entityKind: kind, moduleId: 'm1' };
  return m;
}

/** 600 × 720 × 560 하부장, T18, 가운데 선반 하나, 앞에 도어. 정면 = +Z. */
function cabinet({ rightSide = true, shelf = true } = {}) {
  const g = new THREE.Group();
  g.userData = { entityKind: 'module', moduleId: 'm1' };
  g.add(box(18, 720, 560, -291, 360, 0, 'carcass'));
  if (rightSide) g.add(box(18, 720, 560, 291, 360, 0, 'carcass'));
  g.add(box(564, 18, 560, 0, 9, 0, 'carcass'));
  g.add(box(564, 18, 560, 0, 711, 0, 'carcass'));
  g.add(box(564, 684, 18, 0, 360, -271, 'carcass')); // 뒷판 안쪽 면 z = -262
  if (shelf) g.add(box(564, 18, 542, 0, 360, 9, 'shelf')); // 351 ~ 369
  g.add(box(596, 716, 18, 0, 360, 290, 'door'));
  const root = new THREE.Group();
  root.add(g);
  root.updateMatrixWorld(true);
  return { root, g };
}

function hitsFrom(root, origin, dir) {
  const r = new THREE.Raycaster(origin, dir.clone().normalize());
  return r.intersectObjects(root.children, true);
}

describe('plannerMeasureFromHits', () => {
  test('선반 아래 칸 — 안쪽 564 × 333, 도어는 건너뛴다', () => {
    const { root } = cabinet();
    const hits = hitsFrom(root, new THREE.Vector3(0, 200, 1500), new THREE.Vector3(0, 0, -1));
    expect(hits[0].object.userData.entityKind).toBe('door');
    const r = plannerMeasureFromHits(hits, THREE);
    expect(r.w).toBeCloseTo(564, 6);
    expect(r.h).toBeCloseTo(333, 6);
    expect(r.moduleId).toBe('m1');
    expect(r.ends.up.y).toBeCloseTo(351, 6);
    expect(r.ends.down.y).toBeCloseTo(18, 6);
  });

  test('선반이 없으면 몸통 안쪽 전체 564 × 684', () => {
    const { root } = cabinet({ shelf: false });
    const r = plannerMeasureFromHits(
      hitsFrom(root, new THREE.Vector3(100, 500, 1500), new THREE.Vector3(0, 0, -1)),
      THREE
    );
    expect(r.w).toBeCloseTo(564, 6);
    expect(r.h).toBeCloseTo(684, 6);
  });

  test('모듈이 90° 돌아가 있어도 모듈 축으로 잰다', () => {
    const { root, g } = cabinet();
    g.rotation.y = Math.PI / 2; // 정면이 +X 를 본다
    g.position.set(2000, 0, 0);
    root.updateMatrixWorld(true);
    const r = plannerMeasureFromHits(
      hitsFrom(root, new THREE.Vector3(4000, 600, 0), new THREE.Vector3(-1, 0, 0)),
      THREE
    );
    expect(r.w).toBeCloseTo(564, 6);
    expect(r.h).toBeCloseTo(333, 6);
  });

  test('옆이 트였으면 칸이 아니다', () => {
    const { root } = cabinet({ rightSide: false });
    expect(
      plannerMeasureFromHits(
        hitsFrom(root, new THREE.Vector3(0, 200, 1500), new THREE.Vector3(0, 0, -1)),
        THREE
      )
    ).toBeNull();
  });

  test('선반 윗면에 맞으면 그 위 칸을 잰다', () => {
    const { root } = cabinet();
    const hits = hitsFrom(root, new THREE.Vector3(0, 500, 100), new THREE.Vector3(0, -1, 0));
    expect(hits[0].object.userData.entityKind).toBe('shelf');
    const r = plannerMeasureFromHits(hits, THREE);
    expect(r.w).toBeCloseTo(564, 6);
    expect(r.h).toBeCloseTo(333, 6);
    expect(r.by.down).toBe('shelf');
  });

  test('측판 바깥 면 · 천판 윗면처럼 몸통 밖이면 표시하지 않는다', () => {
    const { root } = cabinet();
    const side = hitsFrom(root, new THREE.Vector3(-1500, 200, 0), new THREE.Vector3(1, 0, 0));
    expect(side[0].object.userData.entityKind).toBe('carcass');
    expect(plannerMeasureFromHits(side, THREE)).toBeNull();
    const top = hitsFrom(root, new THREE.Vector3(0, 1500, 0), new THREE.Vector3(0, -1, 0));
    expect(plannerMeasureFromHits(top, THREE)).toBeNull();
  });

  test('아무것도 안 맞으면 null', () => {
    expect(plannerMeasureFromHits([], THREE)).toBeNull();
  });
});

describe('PlannerMeasure', () => {
  test('숫자 글자는 0.1mm 반올림', () => {
    expect(plannerMeasureFmt(564)).toBe('564');
    expect(plannerMeasureFmt(333.04)).toBe('333');
    expect(plannerMeasureFmt(442.36)).toBe('442.4');
  });

  test('버튼으로 켜고 끈다 — 켜면 안내, 끄면 선·딱지를 지운다', () => {
    document.body.innerHTML =
      '<div id="wrap"><canvas id="c"></canvas></div><button id="b"></button>';
    const toast = jest.fn();
    const btn = document.getElementById('b');
    PlannerMeasure.mount({
      canvas: document.getElementById('c'),
      button: btn,
      toast,
      three: () => null,
    });
    btn.click();
    expect(PlannerMeasure.on).toBe(true);
    expect(btn.classList.contains('active')).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);

    const { root } = cabinet();
    const scene = new THREE.Scene();
    const r = plannerMeasureFromHits(
      hitsFrom(root, new THREE.Vector3(0, 200, 1500), new THREE.Vector3(0, 0, -1)),
      THREE
    );
    const lines = PlannerMeasure.draw(r, scene, THREE);
    expect(scene.children).toContain(lines);
    expect(lines.userData.entityKind).toBe('measure');
    const el = PlannerMeasure.label(r, 10, 20);
    expect(el.textContent).toBe('안쪽 564 × 333');
    expect(el.parentElement.id).toBe('wrap');

    btn.click();
    expect(PlannerMeasure.on).toBe(false);
    expect(scene.children).not.toContain(lines);
    expect(document.getElementById('plannerMeasureLabel')).toBeNull();
  });

  test('HTML 배선 — 스크립트 · 버튼 · mount', () => {
    const html = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(html).toMatch(/<script src="js\/planner\/planner-measure\.js\?v=[\d.]+"><\/script>/);
    expect(html).toContain('id="measureToggleBtn"');
    expect(html).toContain('PlannerMeasure.mount({');
  });
});
