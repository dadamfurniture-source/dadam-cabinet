/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, jest, document, window, __dirname */
/**
 * 사전 오류 검사 → 플래너 표시 (ArchiWood REA 2번, 2026-10-18).
 *
 *   · bom-preflight.js plannerModuleOf / plannerMarksOf — BOM 모듈 id 를 브리지(ui-step1.js)의 역으로 플래너 모듈 id 로 돌린다
 *   · publishToPlanners — 품목 uniqueId 의 플래너 iframe 으로 DADAM_PREFLIGHT_MARKS 를 보낸다 (깨끗한 품목엔 빈 표시)
 *   · planner-preflight.js — 표시 받기(같은 오리진만), 테두리 색, 목록 상자, HTML 배선
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const { snapshotOf } = require('../test-utils/bom-golden/golden');
const BomPreflight = require('../js/detaildesign/bom-preflight.js');
const {
  PlannerPreflight,
  plannerPreflightNormalize,
  PLANNER_PREFLIGHT_COLORS,
} = require('../js/planner/planner-preflight.js');

const ROOT = path.join(__dirname, '..');
const clone = (x) => JSON.parse(JSON.stringify(x));

describe('BOM 모듈 id → 플래너 모듈 id', () => {
  test.each([
    ['planner-x-0', { id: 'x', cell: 0 }],
    ['planner-m-12-3', { id: 'm-12', cell: 3 }],
    ['planner-abc-open', { id: 'abc', cell: null }],
    ['u1', { id: 'u1', cell: null }],
    ['corner-blind-lower', null],
    ['corner-blind-upper-2', null],
    ['', null],
  ])('%s', (input, want) => {
    expect(BomPreflight.plannerModuleOf(input)).toEqual(want);
  });
});

describe('plannerMarksOf', () => {
  const s = snapshotOf(designOf(FIXTURES.warehouse));
  const design = { items: [{ uniqueId: 'item-A' }] };

  test('깨끗한 설계는 표시가 없다', () => {
    expect(
      BomPreflight.plannerMarksOf(BomPreflight.check(s.materials, s.hardware), design)
    ).toEqual({});
  });

  test('칸 셀 모듈의 문제는 플래너 모듈 하나로 모이고 칸 번호가 붙는다', () => {
    const hw = clone(s.hardware);
    hw.find((h) => h.moduleKey === '0-planner-x-1').boring = [110, 5000];
    const marks = BomPreflight.plannerMarksOf(BomPreflight.check(s.materials, hw), design);
    expect(Object.keys(marks)).toEqual(['item-A']);
    const x = marks['item-A'].modules.x;
    expect(x.level).toBe('error');
    expect(x.messages[0]).toMatch(/^칸 2: /);
    expect(marks['item-A'].counts.error).toBe(1);
  });

  test('경고만 있으면 경고, 멍장은 other 로 간다', () => {
    const corner = snapshotOf(designOf(FIXTURES.sinkCorner));
    const mats = clone(corner.materials).filter(
      (m) => !(m.moduleKey === '0-corner-blind-lower' && m.slot === 'back')
    );
    const r = BomPreflight.check(mats, corner.hardware);
    const marks = BomPreflight.plannerMarksOf(r, { items: [{ uniqueId: 7 }] });
    expect(marks['7'].other.length).toBe(1);
    expect(marks['7'].modules).toEqual({});
    expect(marks['7'].counts.warning).toBe(1);
  });
});

describe('publishToPlanners', () => {
  test('품목 iframe 마다 보낸다 — 문제 없는 품목엔 빈 표시', () => {
    document.body.innerHTML =
      '<div id="__planner-overlay-A"><iframe data-planner></iframe></div>' +
      '<div id="__planner-overlay-B"><iframe data-planner></iframe></div>';
    const frames = [...document.querySelectorAll('iframe')];
    const posts = frames.map((f) => {
      const spy = jest.fn();
      Object.defineProperty(f, 'contentWindow', { value: { postMessage: spy } });
      return spy;
    });
    const s = snapshotOf(designOf(FIXTURES.sink15));
    const mats = clone(s.materials).filter((m) => !(m.moduleKey === '0-u1' && m.slot === 'back'));
    const n = BomPreflight.publishToPlanners({
      design: { items: [{ uniqueId: 'A' }, { uniqueId: 'B' }] },
      materials: { materials: mats },
      hardware: { hardware: s.hardware },
    });
    expect(n).toBe(2);
    const a = posts[0].mock.calls[0][0];
    expect(a.type).toBe('DADAM_PREFLIGHT_MARKS');
    expect(a.marks.modules.u1.level).toBe('warning');
    expect(posts[1].mock.calls[0][0].marks).toEqual({
      counts: { error: 0, warning: 0 },
      modules: {},
      other: [],
    });
  });
});

describe('planner-preflight.js', () => {
  const marks = {
    counts: { error: 1, warning: 1 },
    modules: {
      7: { level: 'error', messages: ['측판 너무 큼'] },
      b: { level: 'warning', messages: ['<b>뒷판</b> 없음'] },
    },
    other: ['멍장: 경고'],
  };

  test('normalize — 모르는 모양은 빈 표시, 숫자 id 는 문자열 키', () => {
    expect(plannerPreflightNormalize(null)).toEqual({
      counts: { error: 0, warning: 0 },
      modules: {},
      other: [],
    });
    expect(plannerPreflightNormalize(marks).modules['7'].level).toBe('error');
  });

  test('set → 다시 그리기 · 알림 · 목록 상자, 빈 표시면 상자를 지운다', () => {
    document.body.innerHTML = '';
    const renderAll3D = jest.fn();
    const toast = jest.fn();
    const selectModule = jest.fn();
    PlannerPreflight.mount({ renderAll3D, toast, selectModule, moduleLabel: (id) => '모듈 ' + id });
    PlannerPreflight.set(marks);
    expect(renderAll3D).toHaveBeenCalledWith({ fit: false });
    expect(toast.mock.calls[0][0]).toMatch(/오류 1 · 경고 1/);
    const box = document.getElementById('plannerPreflightBox');
    expect(box.textContent).toContain('모듈 7');
    expect(box.innerHTML).toContain('&lt;b&gt;뒷판'); // 메시지는 이스케이프
    box.querySelector('[data-pf-module="b"]').click();
    expect(selectModule).toHaveBeenCalledWith('b');
    PlannerPreflight.set({});
    expect(document.getElementById('plannerPreflightBox')).toBeNull();
  });

  test('다른 오리진의 메시지는 무시한다', () => {
    PlannerPreflight.set({});
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { type: 'DADAM_PREFLIGHT_MARKS', marks },
        origin: 'https://evil.example',
      })
    );
    expect(PlannerPreflight.levelOf(7)).toBeNull();
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { type: 'DADAM_PREFLIGHT_MARKS', marks },
        origin: window.location.origin,
      })
    );
    expect(PlannerPreflight.levelOf(7)).toBe('error');
  });

  test('outline — 표시가 있는 모듈에만 수준 색 테두리', () => {
    PlannerPreflight.set(marks);
    const parent = new THREE.Group();
    const mesh = new THREE.Object3D();
    mesh.position.set(100, 0, 50);
    expect(
      PlannerPreflight.outline(parent, { id: 'zz', W: 600, H: 700, D: 550 }, mesh, THREE)
    ).toBeNull();
    const box = PlannerPreflight.outline(parent, { id: 7, W: 600, H: 700, D: 550 }, mesh, THREE);
    expect(parent.children).toContain(box);
    expect(box.material.color.getHex()).toBe(PLANNER_PREFLIGHT_COLORS.error);
    expect(box.position.y).toBe(350);
    expect(box.userData.entityKind).toBe('preflight');
    const warn = PlannerPreflight.outline(parent, { id: 'b', W: 600, H: 700, D: 550 }, mesh, THREE);
    expect(warn.material.color.getHex()).toBe(PLANNER_PREFLIGHT_COLORS.warning);
  });

  test('HTML 배선 — 스크립트 · mount · renderAll3D 훅 · 상세설계 송신', () => {
    const html = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(html).toMatch(/<script src="js\/planner\/planner-preflight\.js\?v=[\d.]+"><\/script>/);
    expect(html).toContain('PlannerPreflight.mount({');
    expect(html).toContain('PlannerPreflight.outline(modG, m, moduleMesh, THREE)');
    const step1 = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
    expect(step1).toContain('window.BomPreflight.publishToPlanners(window._reportData)');
  });
});
