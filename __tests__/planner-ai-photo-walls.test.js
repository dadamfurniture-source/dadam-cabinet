/**
 * 2026-10-19: ㄱ자·ㄷ자 — 디테일 패널 도면 요약의 벽별 줄(design_spec.walls[])과 벽별 입면.
 * 계약: docs/02-design/features/design-spec-prompt.md "꺾인 벽" (워커 #861).
 *
 * 시드 evalc1 「전체 자동계산」 결과 (브라우저, modulePlaneBox):
 *   뒷벽 하부 corner-blind 1086@50(멍장 650 + 도어 436) · 842@1136 · 421@1978, 상부 960/960/480, 싱크 x1300
 *   꺾인 하부 lower-2 W936 r90 — 평면 상자 x305 w550 · y638 d936 (앞면 −X)
 * 예전 요약: 하부를 한 줄로 펴서 650 436 936 842 421 · wallRunMm 3335.
 *
 * 고정하는 것:
 *   · 벽 가르기 (plannerAiPhotoWallGroups) — 주벽 회전 0, 꺾인 벽 side·corner·facing·cornerEdge·runMm, 모서리에서 잰 자리
 *   · 요약: 주벽 sections 는 주벽만(wallRunMm 2400), walls[0] = 왼쪽 벽 L5 936 (fromCornerMm 638)
 *   · 번호: 주벽 L1–L4 · U1–U3, 왼쪽 벽 L5 — 워커 buildPlannerPrompt 번호와 같다
 *   · 캡처 지시: 주벽 입면은 주벽 모듈만, 왼쪽 벽 입면은 lower-2 만 facing x-, 3/4 는 −30°
 *   · renders(): elevation · elevation_labeled · elevation_left · elevation_left_labeled · massing
 *   · 마주 보는 벽(0·180)·앞뒤 범위를 모르면 예전처럼 편다
 */
const fs = require('fs');
const path = require('path');
const A = require('../js/planner/ai-photo');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadEsm('workers/generate-api/src/prompts.js', ['buildPlannerPrompt', 'normalizeDesignSpec']);

const struct = (o = {}) => Object.assign({ verticalCount: 1, areaTypes: ['door'], areaWidths: [], areaIs2D: [false], horizontalLayout: 'doorOnly' }, o);
const STRUCT = {
  'corner-blind': struct({ verticalCount: 2, areaTypes: ['blind', 'door'], areaWidths: [650, 436], areaIs2D: [false, false] }),
  'lower-0': struct({ areaIs2D: [true] }),
  'lower-1': struct(),
  'upper-0': struct({ areaIs2D: [true] }),
  'upper-1': struct({ areaIs2D: [true] }),
  'upper-2': struct(),
  'lower-2': struct({ areaIs2D: [true] }),
};
/** 브라우저에서 읽은 자동계산 결과 + 평면 상자 (modulePlaneBox) */
const SEED = [
  { m: { id: 'corner-blind', section: 'lower', W: 1086, H: 870, D: 550, x: 50, y: 70, rotation: 0 }, b: { x: 50, y: 70, w: 1086, d: 550 } },
  { m: { id: 'lower-0', section: 'lower', W: 842, H: 870, D: 550, x: 1136, y: 70, rotation: 0 }, b: { x: 1136, y: 70, w: 842, d: 550 } },
  { m: { id: 'lower-1', section: 'lower', W: 421, H: 870, D: 550, x: 1978, y: 70, rotation: 0 }, b: { x: 1978, y: 70, w: 421, d: 550 } },
  { m: { id: 'upper-0', section: 'upper', W: 960, H: 780, D: 290, x: 0, y: 0, rotation: 0 }, b: { x: 0, y: 0, w: 960, d: 290 } },
  { m: { id: 'upper-1', section: 'upper', W: 960, H: 780, D: 290, x: 960, y: 0, rotation: 0 }, b: { x: 960, y: 0, w: 960, d: 290 } },
  { m: { id: 'upper-2', section: 'upper', W: 480, H: 780, D: 290, x: 1920, y: 0, rotation: 0 }, b: { x: 1920, y: 0, w: 480, d: 290 } },
  { m: { id: 'sink-0', section: 'sink', W: 700, H: 500, D: 370, x: 1300, y: 0, rotation: 0 }, b: { x: 1300, y: 0, w: 700, d: 370 } },
  { m: { id: 'lower-2', section: 'lower', W: 936, H: 870, D: 550, x: 263, y: 720, rotation: 90 }, b: { x: 305, y: 638, w: 550, d: 936 } },
];
const boxById = (id) => SEED.find((x) => x.m.id === id).b;
const baseYOf = (m) => (m.section === 'upper' ? 2300 - m.H : 0);
const traceOf = (mods = SEED.map((x) => x.m)) => A.plannerAiPhotoSpecTrace({
  modules: mods, structureOf: (id) => STRUCT[id] || null, boxOf: (m) => boxById(m.id), baseYOf, ceilingMm: 2300,
});

describe('ㄱ자 — 벽 가르기', () => {
  test('주벽 회전 0 · 왼쪽 벽 r90: 모서리는 주벽(L1 이 모서리까지) · 앞면 −X 라 입면은 −X 쪽에서 · 모서리는 그림 왼쪽', () => {
    const g = A.plannerAiPhotoWallGroups(SEED);
    expect(g.mainIds).toEqual(['corner-blind', 'lower-0', 'lower-1', 'upper-0', 'upper-1', 'upper-2', 'sink-0']);
    expect(g.returns).toHaveLength(1);
    const w = g.returns[0];
    expect([w.side, w.corner, w.facing, w.cornerEdge, w.runMm]).toEqual(['left', 'main', 'x-', 'left', 1574]);
    expect(w.ids).toEqual(['lower-2']);
    expect(w.list.map((x) => x.b)).toEqual([{ x: 638, w: 936 }]);
    expect(w.flip()).toBe(false);
    expect(g.massingYawDeg).toBe(-30);
  });

  test('모서리: 꺾인 런이 뒷벽까지 가면 return, 둘 다 안 닿으면 open · 오른쪽 벽 r270 은 앞면 +X, 칸 순서 뒤집기', () => {
    const ret = SEED.map((x) => (x.m.id === 'corner-blind' ? { m: x.m, b: { ...x.b, x: 900, w: 236 } } : x.m.id === 'lower-2' ? { m: x.m, b: { ...x.b, y: 70 } } : x));
    expect(A.plannerAiPhotoWallGroups(ret).returns[0].corner).toBe('return');
    const open = SEED.map((x) => (x.m.id === 'corner-blind' ? { m: x.m, b: { ...x.b, x: 900, w: 236 } } : x));
    expect(A.plannerAiPhotoWallGroups(open).returns[0].corner).toBe('open');
    const right = SEED.map((x) => (x.m.id === 'lower-2' ? { m: { ...x.m, rotation: 270 }, b: { x: 2400, y: 638, w: 550, d: 936 } } : x));
    const w = A.plannerAiPhotoWallGroups(right).returns[0];
    expect([w.side, w.facing, w.cornerEdge, w.flip()]).toEqual(['right', 'x+', 'right', true]);
    expect(A.plannerAiPhotoWallGroups(right).massingYawDeg).toBe(30);
  });

  test('일자 · 마주 보는 벽(0·180) · 앞뒤 범위 모름 → null (예전처럼 편다)', () => {
    expect(A.plannerAiPhotoWallGroups(SEED.filter((x) => x.m.id !== 'lower-2'))).toBeNull();
    const facing = SEED.map((x) => (x.m.id === 'lower-2' ? { m: { ...x.m, rotation: 180 }, b: x.b } : x));
    expect(A.plannerAiPhotoWallGroups(facing)).toBeNull();
    expect(A.plannerAiPhotoWallGroups(SEED.map((x) => ({ m: x.m, b: { x: x.b.x, w: x.b.w } })))).toBeNull();
  });
});

describe('ㄱ자 — 도면 요약 · 번호', () => {
  test('주벽 sections 는 주벽만, 꺾인 하부는 walls[0] (모서리에서 638)', () => {
    const { spec, views } = traceOf();
    expect(spec.wallRunMm).toBe(2400);
    expect(spec.sections.lower.modules.map((m) => [m.widthMm, m.label])).toEqual([[650, '멍장'], [436, '도어'], [842, '양문'], [421, '도어']]);
    expect(spec.sections.lower.fromLeftMm).toBe(50);
    expect(spec.walls).toEqual([{
      side: 'left', corner: 'main', runMm: 1574, cornerEdge: 'left',
      sections: { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, modules: [{ widthMm: 936, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' }], fromFloorMm: 0 } },
    }]);
    expect(spec.layout).toEqual({ shape: 'corner', walls: 2 });
    expect(spec.notes).toBe('ㄱ자 배치 — 꺾인 벽: 왼쪽');
    expect(views.walls).toEqual([{ side: 'left', facing: 'x-', moduleIds: ['lower-2'] }]);
  });

  test('번호: 주벽 L1–L4 · U1–U3, 왼쪽 벽 L5 — 워커 프롬프트 번호와 같다', () => {
    const st = traceOf();
    const main = A.plannerAiPhotoElevationLabels(st.spec, st.trace);
    const left = A.plannerAiPhotoElevationLabels(st.spec, st.trace, 'left');
    expect(main.rows.map((r) => r.items.map((i) => `${i.id}:${i.moduleId}`))).toEqual([
      ['L1:corner-blind', 'L2:corner-blind', 'L3:lower-0', 'L4:lower-1'],
      ['U1:upper-0', 'U2:upper-1', 'U3:upper-2'],
    ]);
    expect(left.rows.map((r) => r.items.map((i) => `${i.id}:${i.moduleId}`))).toEqual([['L5:lower-2']]);
    const ids = main.rows.concat(left.rows).flatMap((r) => r.items.map((i) => i.id));
    const p = P.buildPlannerPrompt({ category: 'sink', designSpec: P.normalizeDesignSpec(st.spec, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
    expect([...p.matchAll(/^ {4}([LUTH]\d+) /gm)].map((m) => m[1])).toEqual(ids);
    expect(p).toMatch(/LAYOUT: L-shape — the main run stands on the BACK wall of IMAGE A and a return run stands on the LEFT wall/);
    expect(A.plannerAiPhotoElevationLabels(st.spec, st.trace, 'right')).toBeNull();
  });

  test('캡처 지시: 주벽 모듈 · 왼쪽 벽(lower-2, x-) 번호 plan · 3/4 −30°', () => {
    const v = A.plannerAiPhotoWallViews(traceOf());
    expect(v.main).toEqual(['corner-blind', 'lower-0', 'lower-1', 'upper-0', 'upper-1', 'upper-2', 'sink-0']);
    expect(v.massingYawDeg).toBe(-30);
    expect(v.walls).toHaveLength(1);
    expect(v.walls[0]).toMatchObject({ side: 'left', facing: 'x-', moduleIds: ['lower-2'] });
    expect(v.walls[0].plan.rows[0].items[0].id).toBe('L5');
    expect(A.plannerAiPhotoWallViews(A.plannerAiPhotoSpecTrace({ modules: SEED.slice(0, 7).map((x) => x.m), boxOf: (m) => boxById(m.id) }))).toBeNull();
  });
});

describe('ㄱ자 — renders()', () => {
  afterEach(() => { A.PlannerAiPhoto._capture = null; A.PlannerAiPhoto._toJpeg = null; });

  test('주벽 입면은 주벽만, 왼쪽 벽 입면 두 장(번호 없음·있음, x-), 3/4 는 −30°', async () => {
    const calls = [];
    A.PlannerAiPhoto._capture = {
      async capture(opt) {
        calls.push(opt);
        return { ok: true, blob: new Blob(['PNG'], { type: 'image/png' }), width: 10, height: 10 };
      },
    };
    A.PlannerAiPhoto._toJpeg = async () => ({ base64: 'JPG', mime: 'image/jpeg' });
    const st = traceOf();
    const out = await A.PlannerAiPhoto.renders(A.plannerAiPhotoElevationLabels(st.spec, st.trace), A.plannerAiPhotoWallViews(st));
    expect(out.ok).toBe(true);
    expect(out.renders.map((r) => r.role)).toEqual(['elevation', 'elevation_labeled', 'elevation_left', 'elevation_left_labeled', 'massing']);
    expect(out.walls).toEqual([{ side: 'left', plain: true, labeled: true }]);
    expect(calls[0].only).toEqual(st.views.main);
    expect(calls[1].only).toEqual(st.views.main);
    expect(calls[2]).toMatchObject({ kind: 'front', clean: true, only: ['lower-2'], facing: 'x-' });
    expect(calls[2].annotate).toBeUndefined();
    expect(calls[3].annotate.rows[0].items[0].id).toBe('L5');
    expect(calls[4]).toMatchObject({ kind: 'massing', yawDeg: -30 });
  });
});
