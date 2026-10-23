/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, jest, beforeEach, document */
/**
 * CAD 베타 PR11 — 플래너 조립 검사 배지 (js/planner/planner-cad-check.js).
 *
 * 완료 기준 (docs/01-plan/planner-cad.plan.md PR11):
 *   1. sink15 에서 배지가 모두 정상.
 *   2. 옛 뒷판 규칙(#832 이전)을 심으면 오류가 뜨고, 오류 줄을 누르면 그 모듈이 선택된다.
 *   관리자만 — 역할은 PlannerExport 가 부모 창에서 받아 onAdmin 으로 넘긴다.
 * 합성 데이터만 (골든 픽스처).
 */
const fs = require('fs');
const path = require('path');

global.dlog = global.dlog || (() => {});
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');
const { PlannerCadCheck, plannerCadCheckGroup } = require('../js/planner/planner-cad-check.js');
const { PlannerExport } = require('../js/planner/planner-export.js');
const { specOf } = require('../test-utils/assembly-fixtures.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** 플래너 모듈 = 명세 모듈 하나씩 (칸 키 → 플래너 id 'p-<moduleId>') */
function fixture(name) {
  const { spec } = specOf(name);
  const cells = {};
  const ids = [];
  spec.items.forEach((it) => it.modules.forEach((m) => {
    const id = 'p-' + m.moduleId;
    cells[m.moduleKey] = { plannerId: id, dx: 0 };
    ids.push(id);
  }));
  return { spec, cells, ids };
}

/** #832 이전 뒷판 — 측판 사이, 장 뒤끝, 옛 크기 (W−2T)×(H−T) (assembly-check.test.js 와 같다) */
function seedPre832(m) {
  const { W, H, D, T } = m.box;
  const back = m.parts.find((p) => p.part === '뒷판');
  back.frame = Object.assign({}, back.frame, { o: [-W / 2 + T, T, -D / 2] });
  back.cut = { w: W - 2 * T, h: H - T };
  back.box = Asm.boxOfFrame(back.frame, back.cut.w, back.cut.h, back.t);
  return back;
}

function mountWith(state) {
  document.body.innerHTML = '<div id="mlBody"></div><div id="mlCadCheck"></div>';
  const body = document.getElementById('mlBody');
  body.innerHTML = state.ids.map((id) => `<div class="module-item" data-id="${id}"><span class="mi-text">${id}</span></div>`).join('');
  const picked = [];
  PlannerCadCheck.admin = false;
  PlannerCadCheck.last = null;
  PlannerCadCheck.mount({
    list: () => document.getElementById('mlBody'),
    panel: document.getElementById('mlCadCheck'),
    compute: () => ({ spec: state.spec, cells: state.cells }),
    Check,
    onPick: (id) => picked.push(id),
    debounceMs: 5,
  });
  return { body, panel: document.getElementById('mlCadCheck'), picked };
}

const badges = (body) => [...body.querySelectorAll('.module-item')].map((el) => {
  const b = el.querySelector('.mi-cad');
  return b ? b.textContent : null;
});

describe('관리자만', () => {
  test('관리자가 아니면 배지·오류 칸이 없고 검사도 돌지 않는다', () => {
    const st = fixture('sink15');
    const compute = jest.fn(() => ({ spec: st.spec, cells: st.cells }));
    const ui = mountWith(st);
    PlannerCadCheck._o.compute = compute;
    PlannerCadCheck.schedule();
    expect(PlannerCadCheck.run()).toBeNull();
    PlannerCadCheck.decorate();
    expect(compute).not.toHaveBeenCalled();
    expect(badges(ui.body).every((b) => b === null)).toBe(true);
    expect(ui.panel.hidden).toBe(true);
  });

  test('PlannerExport.setAdmin 이 onAdmin 으로 넘긴다 — 관리자 해제면 배지를 지운다', () => {
    const st = fixture('sink15');
    const ui = mountWith(st);
    const prev = PlannerExport._o;
    PlannerExport._o = { onAdmin: (on) => PlannerCadCheck.setAdmin(on) };
    PlannerExport.setAdmin(true);
    expect(badges(ui.body).every((b) => b === '✓')).toBe(true);
    PlannerExport.setAdmin(false);
    expect(badges(ui.body).every((b) => b === null)).toBe(true);
    expect(ui.panel.hidden).toBe(true);
    PlannerExport._o = prev;
  });
});

describe('sink15', () => {
  test('배지가 모두 정상 (✓) — 자리 미정 경고는 배지 제목에만', () => {
    const st = fixture('sink15');
    const ui = mountWith(st);
    PlannerCadCheck.setAdmin(true);
    expect(badges(ui.body)).toEqual(st.ids.map(() => '✓'));
    expect(ui.panel.hidden).toBe(false);
    expect(ui.panel.textContent).toMatch(/오류 0/);
    expect(ui.panel.querySelectorAll('.cad-check-row')).toHaveLength(0);
  });

  test('옛 뒷판 규칙(#832 이전)을 심으면 그 모듈만 ⚠, 오류 줄을 누르면 그 모듈을 고른다', () => {
    const st = fixture('sink15');
    const victim = st.spec.items[0].modules.find((m) => m.parts.some((p) => p.part === '뒷판'));
    seedPre832(victim);
    const ui = mountWith(st);
    PlannerCadCheck.setAdmin(true);
    const vid = 'p-' + victim.moduleId;
    const got = badges(ui.body);
    st.ids.forEach((id, i) => {
      if (id === vid) expect(got[i]).toMatch(/^⚠ \d+$/);
      else expect(got[i]).toBe('✓');
    });
    const rows = [...ui.panel.querySelectorAll('.cad-check-row')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.dataset.id === vid)).toBe(true);
    expect(rows.map((r) => r.title)).toEqual(expect.arrayContaining(['back-cover']));
    rows[0].click();
    expect(ui.picked).toEqual([vid]);
  });

  test('목록을 새로 그려도 decorate 로 배지가 다시 붙는다', () => {
    const st = fixture('sink15');
    const ui = mountWith(st);
    PlannerCadCheck.setAdmin(true);
    ui.body.innerHTML = st.ids.map((id) => `<div class="module-item" data-id="${id}"></div>`).join('');
    PlannerCadCheck.decorate();
    expect(badges(ui.body)).toEqual(st.ids.map(() => '✓'));
  });

  test('schedule 은 디바운스 — 여러 번 불러도 한 번만 검사한다', async () => {
    const st = fixture('sink15');
    mountWith(st);
    PlannerCadCheck.setAdmin(true);
    const compute = jest.fn(() => ({ spec: st.spec, cells: st.cells }));
    PlannerCadCheck._o.compute = compute;
    PlannerCadCheck.schedule();
    PlannerCadCheck.schedule();
    PlannerCadCheck.schedule();
    await new Promise((r) => setTimeout(r, 30));
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe('명세를 못 만들면', () => {
  test('이유를 오류 칸에 적고 배지는 달지 않는다 (상세설계 밖에서 연 플래너)', () => {
    const st = fixture('sink15');
    const ui = mountWith(st);
    PlannerCadCheck._o.compute = () => { throw new Error('상세설계 화면에서 연 플래너에서만 CAD GLB 를 만들 수 있습니다'); };
    PlannerCadCheck.setAdmin(true);
    expect(badges(ui.body).every((b) => b === null)).toBe(true);
    expect(ui.panel.textContent).toMatch(/못 돌림/);
    expect(ui.panel.textContent).toMatch(/상세설계 화면/);
  });
});

describe('plannerCadCheckGroup', () => {
  test('칸 키 → 플래너 모듈, 못 돌아가는 이슈는 빈 키에 모은다', () => {
    const g = plannerCadCheckGroup({ issues: [
      { level: 'error', code: 'part-overlap', moduleKey: '0-a#0' },
      { level: 'warning', code: 'assembly-unplaced', moduleKey: '0-a#1' },
      { level: 'warning', code: 'assembly-unplaced', moduleKey: '0-ep' },
    ] }, { '0-a#0': { plannerId: 'A' }, '0-a#1': { plannerId: 'A' } });
    expect(g.A).toMatchObject({ error: 1, warning: 1 });
    expect(g['']).toMatchObject({ error: 0, warning: 1 });
  });
});

describe('구조 페이지에 걸렸다', () => {
  const html = read('mockup-structure.html');
  test('검사 파일을 싣는다 — 명세 · 규칙 뒤', () => {
    const at = (f) => html.indexOf(`src="js/${f}?v=`);
    ['detaildesign/assembly-check.js', 'planner/planner-cad-check.js'].forEach((f) => expect(at(f)).toBeGreaterThan(0));
    expect(at('detaildesign/assembly-check.js')).toBeGreaterThan(at('detaildesign/bom-assembly.js'));
    expect(at('planner/planner-cad-check.js')).toBeGreaterThan(at('detaildesign/assembly-check.js'));
  });
  test('명세는 CAD GLB 와 같은 함수, 역할은 PlannerExport onAdmin, 3D 재구성 때 schedule, 목록 그린 뒤 decorate', () => {
    expect(html).toMatch(/function plannerCadSpec\(\)/);
    expect(html).toMatch(/compute: plannerCadSpec/);
    expect(html).toMatch(/const r = plannerCadSpec\(\);/);
    expect(html).toMatch(/onAdmin: \(on\) => PlannerCadCheck\.setAdmin\(on\)/);
    expect(html).toMatch(/function renderAll3D\(opts\) \{\s*\/\/[^\n]*\n\s*if \(typeof PlannerCadCheck !== 'undefined'\) PlannerCadCheck\.schedule\(\);/);
    expect(html).toMatch(/PlannerCadCheck\.decorate\(\);\s*\}/);
    expect(html).toMatch(/id="mlCadCheck" hidden/);
  });
});
