/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 비율로 서랍 나누기 (ArchiWood 영상 분석 B, 2026-10-19 사장님 확정).
 *
 *   · 비율 문자열 "도어:서랍:…" — 1 = 소, 서랍 2 = 자동, 도어 2 = 도어 기본 등급. mm 고정은 받지 않는다.
 *   · 자동: 목찬넬 자리를 뺀 서랍 자리(존)가 250 이상이면 대, 아니면 들어가는 박스에 따라 중 또는 소.
 *   · 플래너 비율 입력칸 · BOM 이 같은 규칙 파일을 쓴다.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RULES = require(path.join(ROOT, 'js/detaildesign/bom-drawer-rules.js'));
const { DRAWER_RULES, autoGradeFor, gradesFromRatio, ratioOf, layoutByGrades, pickBox } = RULES;
const { bootPlanner } = require('../test-utils/planner-harness');

const SINK = { topT: 12, legH: 150, T: 15, rail: 'under' };
const frontsOf = (r) =>
  [{ kind: 'door', grade: r.doorGrade }].concat(
    r.grades.map((g) => ({ kind: 'drawer', grade: g }))
  );
const drawersOf = (L) => L.fronts.filter((f) => f.kind === 'drawer');

describe('autoGradeFor — 존 250 이상이면 대', () => {
  test('언더레일: 250 대 · 249 중 · 160 중 · 159 소', () => {
    expect(DRAWER_RULES.AUTO_LARGE_ZONE_MIN).toBe(250);
    expect(autoGradeFor(250, 'under')).toEqual({ size: 'large', h: 180, fits: true });
    expect(autoGradeFor(249, 'under')).toEqual({ size: 'medium', h: 120, fits: true });
    expect(autoGradeFor(160, 'under')).toEqual({ size: 'medium', h: 120, fits: true });
    expect(autoGradeFor(159, 'under')).toEqual({ size: 'small', h: 60, fits: true });
    expect(autoGradeFor(90, 'under')).toEqual({ size: 'small', h: 60, fits: false });
  });

  test('볼레일은 여유가 20 이라 중이 140 부터', () => {
    expect(autoGradeFor(140, 'ball').size).toBe('medium');
    expect(autoGradeFor(139, 'ball').size).toBe('small');
    expect(autoGradeFor(250, 'ball').size).toBe('large');
  });

  test('대 박스가 들어가도 250 미만이면 중이다 (pickBox 와 다르다)', () => {
    expect(pickBox(230, 'under').size).toBe('large');
    expect(autoGradeFor(230, 'under').size).toBe('medium');
  });
});

describe('gradesFromRatio · ratioOf', () => {
  test('첫 칸은 도어, 나머지는 서랍', () => {
    expect(gradesFromRatio('2:1:1')).toEqual({
      doorGrade: 'large',
      grades: ['small', 'small'],
      drawerCount: 2,
    });
    expect(gradesFromRatio(' 1 : 2 ')).toEqual({
      doorGrade: 'small',
      grades: ['auto'],
      drawerCount: 1,
    });
    expect(gradesFromRatio('2:2:2:2:2').drawerCount).toBe(4);
  });

  test('mm 고정 · 다른 수 · 칸 수가 맞지 않으면 받지 않는다', () => {
    expect(gradesFromRatio('1:200:1').error).toMatch(/mm 고정은 받지 않습니다/);
    expect(gradesFromRatio('3:1').error).toBeTruthy();
    expect(gradesFromRatio('2').error).toBeTruthy();
    expect(gradesFromRatio('2:1:1:1:1:1').error).toBeTruthy();
    expect(gradesFromRatio('').error).toBeTruthy();
  });

  test('등급 → 비율 글자 (소 1, 중·대·자동 2, 미지정은 기본 등급)', () => {
    expect(ratioOf('large', ['small', 'auto', 'medium'])).toBe('2:1:2:2');
    expect(ratioOf(null, [undefined])).toBe('2:2');
  });
});

describe('layoutByGrades — 자동 등급', () => {
  test('배치 870, 1:2 — 서랍 존 377 → 대 180', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 870, fronts: frontsOf(gradesFromRatio('1:2')) }, SINK)
    );
    const [d] = drawersOf(L);
    expect(d).toMatchObject({ h: 432, grade: 'large', gradeAuto: true });
    expect(d.zone.h).toBe(377);
    expect(L.boxes).toEqual([expect.objectContaining({ size: 'large', h: 180, fits: true })]);
  });

  test('배치 780, 2:2 — 존 224 는 대 박스가 들어가도 250 미만이라 중 120', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 780, fronts: frontsOf(gradesFromRatio('2:2')) }, SINK)
    );
    const [d] = drawersOf(L);
    expect(d.zone.h).toBe(224);
    expect(d).toMatchObject({ grade: 'medium', gradeAuto: true });
    expect(d.box.h).toBe(120);
  });

  test('배치 780, 2:2:2 — 위 서랍 중, 아래 서랍 소 (존 131 은 중 박스 160 이 안 들어간다)', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 780, fronts: frontsOf(gradesFromRatio('2:2:2')) }, SINK)
    );
    const ds = drawersOf(L);
    expect(ds.map((f) => [f.zone.h, f.grade, f.box.h])).toEqual([
      [166, 'medium', 120],
      [131, 'small', 60],
    ]);
    // 전면 높이는 버줌 2 그대로 — 자동 등급이 소가 돼도 전면은 바뀌지 않는다
    expect(L.front.fronts.map((f) => f.weight)).toEqual([2, 2, 2]);
  });

  test('자동이 아닌 등급은 예전 그대로 (가장 큰 박스)', () => {
    const L = layoutByGrades(
      Object.assign(
        { areaH: 780, fronts: frontsOf({ doorGrade: 'large', grades: ['medium'] }) },
        SINK
      )
    );
    const [d] = drawersOf(L);
    expect(d.gradeAuto).toBeUndefined();
    expect(d.grade).toBe('medium');
    expect(d.box.size).toBe('large');
  });
});

describe('BOM 이 자동 등급을 그대로 쓴다 (extractors.js)', () => {
  global.dlog = () => {};
  const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
  const specs = {
    layoutShape: 'I',
    bodyThickness: 15,
    lowerH: 780,
    upperH: 720,
    sinkLegHeight: 150,
    topThickness: 12,
    moldingH: 60,
    upperDoorOverlap: 15,
    handle: '찬넬 (목찬넬)',
    topSizes: [{ w: '2400', d: '650' }],
  };
  test('배치 780, 도어 + 서랍 1 (자동) → 중 박스 120', () => {
    const mod = {
      id: 'la',
      type: 'storage',
      name: '자동',
      pos: 'lower',
      w: 800,
      h: 618,
      d: 550,
      doorCount: 1,
      isDrawer: true,
      drawerCount: 1,
      areaH: 780,
      totalH: 780,
      heightParts: { legH: 150, topT: 12 },
      drawer: { grades: ['auto'], doorGrade: 'large' },
    };
    const item = {
      uniqueId: 1,
      categoryId: 'sink',
      name: '싱크대',
      w: 2400,
      h: 2310,
      d: 650,
      specs,
      modules: [mod],
    };
    const rows = new MaterialExtractor()
      .extract({ items: [item] })
      .materials.filter((m) => m.module === '하부장-자동');
    expect(rows.filter((r) => r.part === '서랍측판').map((r) => r.h)).toEqual([120]);
    expect(rows.find((r) => r.part === '서랍측판').note).toMatch(/^중 박스/);
  });
});

describe('플래너 — 전면 비율 입력칸', () => {
  function pickLower(p) {
    const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    return { m, s: p.g('getStructure')(m.id) };
  }

  test('비율을 넣으면 단수·도어 등급·서랍 등급이 한 번에 바뀌고, 자동 서랍은 결과 등급을 보여 준다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dr1&item=1', storage: {} });
    const { m, s } = pickLower(p);
    Object.assign(s, {
      horizontalLayout: 'doorTopDrawerBottom',
      bottomType: 'drawer',
      drawerCount: 1,
    });
    p.g('renderRightPanel')();
    const inp = p.document.getElementById('inpDrawerRatio');
    expect(inp).not.toBeNull();
    expect(inp.value).toBe('2:2');
    inp.value = '1:2:1';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    expect(s.drawerCount).toBe(2);
    expect(p.g('drawerRulesOf')(s)).toMatchObject({
      doorGrade: 'small',
      grades: ['auto', 'small'],
    });
    p.g('renderRightPanel')();
    expect(p.document.getElementById('inpDrawerRatio').value).toBe('1:2:1');
    expect(p.document.getElementById('selDrawerGrade0').value).toBe('auto');
    const L = p.g('drawerLayoutFor')(m, s);
    const d0 = L.fronts[1];
    expect(d0.gradeAuto).toBe(true);
    const row = p.document.getElementById('selDrawerGrade0').parentElement.textContent;
    expect(row).toContain('→ ' + DRAWER_RULES.FRONT_GRADE_LABEL[d0.grade]);
    expect(p.errors).toEqual([]);
  });

  test('mm 고정 비율은 받지 않고 원래 값으로 돌린다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=dr2&item=1', storage: {} });
    const { s } = pickLower(p);
    Object.assign(s, {
      horizontalLayout: 'doorTopDrawerBottom',
      bottomType: 'drawer',
      drawerCount: 2,
    });
    p.g('renderRightPanel')();
    const inp = p.document.getElementById('inpDrawerRatio');
    inp.value = '1:200:1';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(inp.value).toBe('2:2:2');
    expect(s.drawerCount).toBe(2);
  });
});
