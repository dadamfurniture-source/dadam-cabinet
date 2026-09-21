/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 캔버스 비율 — 패널이 열리고 닫혀도 도면이 눌리거나 작아지지 않는다 (2026-09-22 사장님 지적).
 *
 * 무엇이 잘못됐었나 (브라우저에서 측정한 값):
 *   개별 모듈 패널(340px)이 열리면 캔버스 칸이 760 → 420 으로 줄었다. 그런데 크기 갱신이
 *   `window.resize` 에만 걸려 있어 아무도 못 잡았고, WebGL 그림 버퍼는 760 폭 그대로 남았다.
 *   `renderer.setSize(w, h, false)` 는 버퍼만 바꾸고 캔버스 CSS 는 100% 이므로
 *   760 짜리 그림이 420 칸에 밀려 들어가 **가로가 0.55 배로 눌렸다**.
 *
 * 두 갈래로 고쳤다:
 *   A) 캔버스 칸을 ResizeObserver 로 감시한다 — 패널 접기·펴기·창 크기를 한 곳에서 잡는다.
 *      (좌측 모듈 리스트 220→32, 우측 편집 패널 300→32 도 같은 길로 들어온다)
 *   B) 개별 모듈 패널을 캔버스 **안**으로 옮겨 겹친다 — 칸 크기가 아예 변하지 않는다.
 *
 * 여기서 지키는 계약:
 *   1) 캔버스 칸에 ResizeObserver 가 붙어 있다
 *   2) 그 콜백은 three.js 가 없어도 터지지 않는다
 *   3) 개별 모듈 패널은 #canvasWrap 의 자손이고 CSS 가 오버레이다
 *   4) 모듈을 고르면 캔버스에 mp-open 표식이 붙고, 풀면 떨어진다
 *   5) 카메라 비율을 만지는 곳은 한 군데(resize3D)뿐이다 — 중복 코드가 되살아나지 않게
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
/**
 * 주석을 뺀 소스. "이 호출은 한 군데뿐" 류를 셀 때 필요하다 —
 * 주석에 `renderer.setSize(...)` 를 설명으로 적어 두면 세다가 속는다 (실제로 한 번 속았다).
 */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\*|\/\/)/.test(l))
  .join('\n');
const SCOPE = '::c1:3';
const TOKEN = 'dadam_gen_autocalc_v1' + SCOPE;

function layout() {
  const s = PLANNER_SECTIONS.lower;
  return {
    version: 1, savedAt: '2026-09-22T00:00:00.000Z', person: { cx: 1800, cy: 1500 },
    modules: [{ section: 'lower', x: 0, y: 0, w: 1800, h: s.h, moduleH: s.moduleH, rotation: 0, finishings: [] }],
  };
}

function boot() {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=c1&item=3',
    storage: { ['dadam_layout_v1' + SCOPE]: JSON.stringify(layout()) },
    session: { [TOKEN]: '1' },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const byId = (p, id) => p.document.getElementById(id);

describe('A — 캔버스 칸 크기를 감시한다', () => {
  test('#canvasWrap 에 ResizeObserver 가 붙는다 (창 크기만으로는 패널 접기를 못 잡는다)', () => {
    const p = boot();
    const wrap = byId(p, 'canvasWrap');
    expect(wrap).toBeTruthy();
    const obs = p.window.__resizeObservers || [];
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.some((o) => o.targets.includes(wrap))).toBe(true);
  });

  test('three.js 가 없어도 감시 콜백이 터지지 않는다', () => {
    const p = boot();
    expect(p.g('three')).toBeNull();          // jsdom 은 THREE 를 안 싣는다
    const obs = (p.window.__resizeObservers || [])
      .filter((o) => o.targets.includes(byId(p, 'canvasWrap')));
    expect(obs.length).toBe(1);
    expect(() => obs[0].__fire()).not.toThrow();
    expect(() => p.window.resize3D()).not.toThrow();
  });

  test('감시는 init3D 안이 아니라 밖에 선다 — three.js 로딩과 무관하게 한 번', () => {
    // init3D 는 `if (three || !window.THREE) return;` 로 스스로 빠진다. 배선이 그 안에 있으면
    // three.js 를 못 실은 화면에서는 아예 서지 않고, 테스트도 확인할 수 없다.
    expect(CODE.match(/new ResizeObserver/g) || []).toHaveLength(1);
    const fn = SRC.slice(SRC.indexOf('function watchCanvasSize()'), SRC.indexOf('watchCanvasSize();'));
    expect(fn.length).toBeGreaterThan(100);    // 함수가 사라졌으면 아래가 거짓말한다
    expect(fn).toContain('new ResizeObserver');
    expect(fn).toContain("getElementById('canvasWrap')");
  });
});

describe('B — 패널은 캔버스 위에 겹친다 (칸 크기가 변하지 않는다)', () => {
  test('개별 모듈 패널이 #canvasWrap 의 자손이다', () => {
    const p = boot();
    const wrap = byId(p, 'canvasWrap');
    const panel = byId(p, 'modulePanel');
    expect(panel).toBeTruthy();
    expect(wrap.contains(panel)).toBe(true);
    // 패널 안의 알맹이도 같이 따라왔다 (껍데기만 옮기고 내용을 잃지 않았다)
    expect(panel.querySelector('#mpPreviewSvg')).toBeTruthy();
    expect(panel.querySelector('#btnApplyModule')).toBeTruthy();
    expect(panel.querySelector('#mpTitle')).toBeTruthy();
  });

  test('CSS 가 오버레이다 — position:absolute · left:0 · z-index', () => {
    const rule = SRC.match(/\n\s*\.module-panel\{([^}]*)\}/);
    expect(rule).toBeTruthy();                 // 규칙 자체가 사라지면 아래 검사가 거짓말한다
    const decl = rule[1];
    expect(decl).toContain('position:absolute');
    expect(decl).toContain('left:0');
    expect(decl).toContain('top:0');
    expect(decl).toContain('bottom:0');
    expect(decl).toMatch(/z-index:\d+/);
    // ruler(10~13)·섹션 복원 패널(20) 위, ruler 치수 편집기(100) 아래여야 한다
    const z = Number(decl.match(/z-index:(\d+)/)[1]);
    expect(z).toBeGreaterThan(20);
    expect(z).toBeLessThan(100);
    // flex 형제 시절의 자리 차지는 사라졌다
    expect(decl).not.toContain('flex-shrink');
  });

  test('패널이 접혀도(32px) 캔버스 칸을 밀지 않는다 — 접기 규칙은 그대로', () => {
    expect(SRC).toMatch(/\.module-panel\.collapsed\{width:32px\}/);
  });
});

describe('패널 표식 — 단축키 안내가 패널 밑에 깔리지 않게', () => {
  test('모듈을 고르면 mp-open 이 붙고 풀면 떨어진다', () => {
    const p = boot();
    const wrap = byId(p, 'canvasWrap');
    const mods = p.g('modules');
    expect(mods.length).toBeGreaterThan(0);

    expect(wrap.classList.contains('mp-open')).toBe(false);
    p.g('setActiveModule')(mods[0].id);
    expect(byId(p, 'modulePanel').style.display).not.toBe('none');
    expect(wrap.classList.contains('mp-open')).toBe(true);

    p.g('clearSelection')();
    expect(wrap.classList.contains('mp-open')).toBe(false);
  });

  test('CSS 가 그 표식으로 안내를 비켜 준다', () => {
    expect(SRC).toMatch(/\.canvas-wrap\.mp-open \.canvas-help\{left:\d+px\}/);
  });
});

describe('비율을 만지는 곳은 한 군데', () => {
  test('camera.aspect 대입은 resize3D 안에서만 한다', () => {
    const hits = CODE.match(/\.camera\.aspect\s*=/g) || [];
    expect(hits).toHaveLength(1);
    const fn = SRC.slice(SRC.indexOf('function resize3D()'), SRC.indexOf('window.resize3D'));
    expect(fn.length).toBeGreaterThan(100);    // 함수가 사라졌으면 아래가 거짓말한다
    expect(fn).toContain('camera.aspect');
    expect(fn).toContain('renderer.setSize');
  });

  test('renderer.setSize 는 init3D 의 첫 설정과 resize3D 둘뿐이다', () => {
    const hits = CODE.match(/renderer\.setSize\(/g) || [];
    expect(hits).toHaveLength(2);
  });

  test('같은 크기면 헛일을 하지 않는다 — 전환 애니메이션 동안 프레임마다 불린다', () => {
    const fn = SRC.slice(SRC.indexOf('function resize3D()'), SRC.indexOf('window.resize3D'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toContain('lastCanvasSize');
  });

  test('requestAnimationFrame 으로 미루지 않는다 — 관찰자가 이미 프레임당 한 번이다', () => {
    // 처음에는 rAF 로 묶었다. ResizeObserver 가 이미 프레임당 한 번만 오므로 한 프레임만
    // 늦어질 뿐이었다 — 콜백에서 바로 적용하고, 헛일은 크기 비교로 막는다.
    // 주석 제거본으로 본다 — 왜 rAF 를 걷어냈는지 설명이 주석에 남아 있다.
    const fn = CODE.slice(CODE.indexOf('function watchCanvasSize()'), CODE.indexOf('watchCanvasSize();'));
    expect(fn.length).toBeGreaterThan(50);
    expect(fn).not.toContain('requestAnimationFrame');
    const r3d = CODE.slice(CODE.indexOf('function resize3D()'), CODE.indexOf('window.resize3D'));
    expect(r3d.length).toBeGreaterThan(100);
    expect(r3d).not.toContain('requestAnimationFrame');
  });
});
