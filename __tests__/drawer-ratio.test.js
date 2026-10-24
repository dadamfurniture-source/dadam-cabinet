/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 비율로 서랍 나누기 (ArchiWood 영상 분석 B, 2026-10-19 사장님 확정).
 *
 *   · 비율 문자열 "도어:서랍:…" — 1 = 소, 서랍 2 = 자동, 도어 2 = 도어 기본 등급. mm 고정은 받지 않는다.
 *   · 자동: 목찬넬 자리를 뺀 서랍 자리(존)에 들어가는 가장 큰 박스 (2026-10-24 사장님 "큰 서랍 우선" —
 *     예전 "존 250 이상이면 대" 기준은 없앴다). 박스 소 75 · 중 120 · 대 180.
 *   · 서랍장 위 칸 (2026-10-24): gradesFromRatio(…, {topDrawer}) — 첫 칸도 서랍.
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

describe('autoGradeFor — 존에 들어가는 가장 큰 박스 (2026-10-24 큰 서랍 우선)', () => {
  test('언더레일(+40): 220 대 · 219 중 · 160 중 · 159 소 75 · 114 는 소도 안 들어간다', () => {
    expect(autoGradeFor(220, 'under')).toEqual({ size: 'large', h: 180, fits: true });
    expect(autoGradeFor(219, 'under')).toEqual({ size: 'medium', h: 120, fits: true });
    expect(autoGradeFor(160, 'under')).toEqual({ size: 'medium', h: 120, fits: true });
    expect(autoGradeFor(159, 'under')).toEqual({ size: 'small', h: 75, fits: true });
    expect(autoGradeFor(114, 'under')).toEqual({ size: 'small', h: 75, fits: false });
  });

  test('볼레일(+20): 대 200 · 중 140 부터', () => {
    expect(autoGradeFor(200, 'ball').size).toBe('large');
    expect(autoGradeFor(199, 'ball').size).toBe('medium');
    expect(autoGradeFor(140, 'ball').size).toBe('medium');
    expect(autoGradeFor(139, 'ball').size).toBe('small');
  });

  test('pickBox 와 같은 답이다 — 예전 "250 미만이면 중" 기준은 없다', () => {
    [100, 115, 159, 160, 219, 220, 230, 249, 250, 400].forEach((z) => ['under', 'ball'].forEach((rail) => {
      expect([z, rail, autoGradeFor(z, rail)]).toEqual([z, rail, pickBox(z, rail)]);
    }));
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

  test('서랍장 위 칸 (topDrawer) — 첫 칸도 서랍, 서랍 2~4 장, 도어 등급 없음', () => {
    expect(gradesFromRatio('2:1:1', { topDrawer: true })).toEqual({
      doorGrade: '',
      grades: ['auto', 'small', 'small'],
      drawerCount: 3,
    });
    expect(gradesFromRatio('1:2', { topDrawer: true })).toEqual({ doorGrade: '', grades: ['small', 'auto'], drawerCount: 2 });
    expect(gradesFromRatio('2:2:2:2', { topDrawer: true }).drawerCount).toBe(4);
    expect(gradesFromRatio('2:2:2:2:2', { topDrawer: true }).error).toMatch(/서랍 2~4 칸/);
    expect(gradesFromRatio('2', { topDrawer: true }).error).toBeTruthy();
    expect(ratioOf('', ['auto', 'small', 'small'], { topDrawer: true })).toBe('2:1:1');
    // 왕복 — 비율 → 등급 → 비율
    ['2:2', '1:2', '2:1:1', '1:2:1:2'].forEach((r) => {
      const g = gradesFromRatio(r, { topDrawer: true });
      expect(ratioOf(g.doorGrade, g.grades, { topDrawer: true })).toBe(r);
    });
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

  test('배치 780, 2:2 — 존 224 에 대 박스(180 + 40)가 들어가서 대 180 (2026-10-24 큰 서랍 우선)', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 780, fronts: frontsOf(gradesFromRatio('2:2')) }, SINK)
    );
    const [d] = drawersOf(L);
    expect(d.zone.h).toBe(224);
    expect(d).toMatchObject({ grade: 'large', gradeAuto: true });
    expect(d.box.h).toBe(180);
  });

  test('배치 780, 2:2:2 — 위 서랍 중, 아래 서랍 소 75 (존 131 은 중 박스 160 이 안 들어간다)', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 780, fronts: frontsOf(gradesFromRatio('2:2:2')) }, SINK)
    );
    const ds = drawersOf(L);
    expect(ds.map((f) => [f.zone.h, f.grade, f.box.h])).toEqual([
      [166, 'medium', 120],
      [131, 'small', 75],
    ]);
    // 전면 높이는 버줌 2 그대로 — 자동 등급이 소가 돼도 전면은 바뀌지 않는다
    expect(L.front.fronts.map((f) => f.weight)).toEqual([2, 2, 2]);
  });

  test('서랍장 위 칸 (topDrawer) — 첫 서랍 존은 상단 따내기 70 + 앞 밴드 T 아래부터', () => {
    const L = layoutByGrades(
      Object.assign({ areaH: 870, fronts: gradesFromRatio('2:2', { topDrawer: true }).grades.map((g) => ({ kind: 'drawer', grade: g })) }, SINK)
    );
    const ds = drawersOf(L);
    expect(L.fronts.every((f) => f.kind === 'drawer')).toBe(true);
    expect(ds.map((f) => f.h)).toEqual([324, 324]);
    expect(ds[0].zone.top).toBe(DRAWER_RULES.CHANNEL_TOP_NOTCH_H + SINK.T);
    expect(L.boxes.map((b) => [b.size, b.fits])).toEqual([['large', true], ['large', true]]);
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
  test('배치 780, 도어 + 서랍 1 (자동) → 대 박스 180 (존 224 에 180 + 40 이 들어간다, 2026-10-24 큰 서랍 우선)', () => {
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
    expect(rows.filter((r) => r.part === '서랍측판').map((r) => r.h)).toEqual([180]);
    expect(rows.find((r) => r.part === '서랍측판').note).toMatch(/^대 박스/);
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
