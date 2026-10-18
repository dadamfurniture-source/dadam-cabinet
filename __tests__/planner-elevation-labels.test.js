/**
 * 2026-10-19: 번호 붙인 정면 입면 · design_spec 선택 필드 · 작은 사진 알림.
 *
 *   · 번호(순수, ai-photo.js): design_spec 구간 lower→upper→tall, 줄 안 왼→오 1부터, 칸마다 쪼갠 모듈은 칸마다,
 *     붙박이장은 한 줄 W — **워커 buildPlannerPrompt 가 실제로 쓰는 번호·폭과 대조한다** (prompts.js 를 export 떼고 평가)
 *   · layout / fromFloorMm / ceilingMm 계산, 모르면 키 없음, 기존 키 순서 그대로
 *   · 작은 사진 판정 (긴 변 < 1024)
 *   · 투영·라벨 자리·치수 글자·표시 목록(순수, planner-capture.js) — three 카메라의 project 와 같은 값
 *   · capture 파이프라인: annotate 가 없으면 예전과 바이트 같다, front 만, 그리기 실패면 번호 없는 입면 그대로
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const A = require('../js/planner/ai-photo');
const C = require('../js/planner/planner-capture');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadEsm('workers/generate-api/src/prompts.js', ['buildPlannerPrompt', 'normalizeDesignSpec']);

// ── 도면 ────────────────────────────────────────────────

const struct = (o = {}) => Object.assign({
  verticalCount: 1, areaTypes: ['door'], areaWidths: [], areaIs2D: [true], horizontalLayout: 'doorOnly',
}, o);
const one = struct({ areaIs2D: [false] });

/** 브라우저 확인과 같은 시드 — 하부 800·400·1000, 상부 900·900, 분배기 */
const SEED = [
  { id: 'lower-0', section: 'lower', W: 800, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
  { id: 'lower-1', section: 'lower', W: 400, H: 870, D: 650, x: 800, y: 0, rotation: 0 },
  { id: 'lower-2', section: 'lower', W: 1000, H: 870, D: 650, x: 1200, y: 0, rotation: 0 },
  { id: 'upper-3', section: 'upper', W: 900, H: 780, D: 320, x: 0, y: 0, rotation: 0 },
  { id: 'upper-4', section: 'upper', W: 900, H: 780, D: 320, x: 900, y: 0, rotation: 0 },
  { id: 'sink-5', section: 'sink', W: 700, H: 500, D: 400, x: 1350, y: 0, rotation: 0 },
];
const SEED_STRUCT = { 'lower-0': struct(), 'lower-1': one, 'lower-2': struct(), 'upper-3': struct(), 'upper-4': struct() };

const traceOf = (modules, structs, extra = {}) => A.plannerAiPhotoSpecTrace(Object.assign({
  modules, structureOf: (id) => (structs || {})[id] || null,
}, extra));
const labelsOf = (modules, structs, extra) => {
  const r = traceOf(modules, structs, extra);
  return A.plannerAiPhotoElevationLabels(r.spec, r.trace);
};
/** 라벨 plan → [[id, moduleId, widthMm], …] */
const flat = (plan) => [].concat(...plan.rows.map((r) => r.items.map((it) => [it.id, it.moduleId, it.widthMm])));

/** 워커 프롬프트가 실제로 쓰는 번호·폭 — FIXED GEOMETRY 의 "L1   800 mm" 줄들 */
function workerIds(spec) {
  const ds = P.normalizeDesignSpec(spec, spec.category);
  const prompt = P.buildPlannerPrompt({ category: spec.category, designSpec: ds, wallW: 0, wallH: 0 });
  const out = [];
  const re = /^\s+([LUTW]\d+)\s+(\d+) mm/gm;
  let m;
  while ((m = re.exec(prompt))) out.push([m[1], Number(m[2])]);
  return out;
}

// ── 번호 (순수) ─────────────────────────────────────────

describe('번호 — design_spec 구간·왼쪽부터, 워커 프롬프트와 같은 번호', () => {
  test('시드: 하부 L1·L2·L3 = 800·400·1000, 상부 U1·U2 = 900·900, 줄 폭·높이', () => {
    const plan = labelsOf(SEED, SEED_STRUCT);
    expect(flat(plan)).toEqual([
      ['L1', 'lower-0', 800], ['L2', 'lower-1', 400], ['L3', 'lower-2', 1000],
      ['U1', 'upper-3', 900], ['U2', 'upper-4', 900],
    ]);
    expect(plan.rows.map((r) => [r.key, r.prefix, r.widthMm, r.heightMm])).toEqual([
      ['lower', 'L', 2200, 870], ['upper', 'U', 1800, 780],
    ]);
    // 모듈 하나가 한 칸이면 0~1
    plan.rows.forEach((r) => r.items.forEach((it) => expect([it.from, it.to]).toEqual([0, 1])));
  });

  test('워커 buildPlannerPrompt 의 번호·폭과 순서까지 같다 (시드)', () => {
    const r = traceOf(SEED, SEED_STRUCT);
    const plan = A.plannerAiPhotoElevationLabels(r.spec, r.trace);
    expect(flat(plan).map(([id, , w]) => [id, w])).toEqual(workerIds(r.spec));
  });

  test('칸마다 쪼갠 모듈은 칸마다 번호 · from/to 는 칸 폭 비율 · 키큰장 T · 냉장고 칸도 번호 — 워커와 같다', () => {
    const mods = [
      // 일부러 x 순서를 섞는다 — 번호는 x 순서다
      { id: 'lower-2', section: 'lower', W: 600, H: 870, D: 650, x: 1000, y: 0, rotation: 0 },
      { id: 'lower-0', section: 'lower', W: 1000, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
      { id: 'tall-1', section: 'tall', W: 600, H: 2300, D: 650, x: 1600, y: 0, rotation: 0 },
      { id: 'fridge-1', section: 'refrigerator', W: 900, H: 1850, D: 700, x: 2200, y: 0, rotation: 0 },
      { id: 'upper-0', section: 'upper', W: 1600, H: 780, D: 320, x: 0, y: 0, rotation: 0 },
    ];
    const structs = {
      'lower-0': struct({ verticalCount: 2, areaTypes: ['door', 'door'], areaWidths: [400, 600], areaIs2D: [false, true] }),
      'lower-2': struct({ horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 3 }),
      'upper-0': struct({ verticalCount: 3, areaTypes: ['door', 'open', 'door'] }),
      'tall-1': struct(),
    };
    const r = traceOf(mods, structs);
    const plan = A.plannerAiPhotoElevationLabels(r.spec, r.trace);
    expect(flat(plan)).toEqual([
      ['L1', 'lower-0', 400], ['L2', 'lower-0', 600], ['L3', 'lower-2', 600],
      ['U1', 'upper-0', 533], ['U2', 'upper-0', 533], ['U3', 'upper-0', 533],
      ['T1', 'tall-1', 600], ['T2', 'fridge-1', 900],
    ]);
    const L = plan.rows[0].items;
    expect([L[0].from, L[0].to]).toEqual([0, 0.4]);
    expect([L[1].from, L[1].to]).toEqual([0.4, 1]);
    expect([L[2].from, L[2].to]).toEqual([0, 1]);   // 세로가 있는 모듈은 한 덩이
    const U = plan.rows[1].items;
    expect(U[1].from).toBeCloseTo(1 / 3, 9);
    expect(U[2].to).toBe(1);
    expect(flat(plan).map(([id, , w]) => [id, w])).toEqual(workerIds(r.spec));
  });

  test('붙박이장은 한 줄 W — 워커와 같다', () => {
    const mods = [
      { id: 'w-1', section: 'wardrobe', W: 900, H: 2310, D: 620, x: 900, y: 0, rotation: 0 },
      { id: 'w-0', section: 'wardrobe', W: 900, H: 2310, D: 620, x: 0, y: 0, rotation: 0 },
      { id: 'w-2', section: 'wardrobe', W: 1200, H: 2310, D: 620, x: 1800, y: 0, rotation: 0 },
    ];
    const structs = { 'w-2': struct({ verticalCount: 2, areaTypes: ['door', 'door'] }) };
    const r = traceOf(mods, structs);
    expect(r.spec.category).toBe('wardrobe');
    const plan = A.plannerAiPhotoElevationLabels(r.spec, r.trace);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ key: 'wardrobe', prefix: 'W', widthMm: 3000, heightMm: 2310 });
    expect(flat(plan)).toEqual([['W1', 'w-0', 900], ['W2', 'w-1', 900], ['W3', 'w-2', 600], ['W4', 'w-2', 600]]);
    expect(flat(plan).map(([id, , w]) => [id, w])).toEqual(workerIds(r.spec));
  });

  test('구간이 없으면 null · spec 은 BuildSpec 과 같은 값 (요약은 그대로)', () => {
    expect(A.plannerAiPhotoElevationLabels({ category: 'sink', sections: {} }, {})).toBeNull();
    const r = traceOf(SEED, SEED_STRUCT);
    expect(r.spec).toEqual(A.plannerAiPhotoBuildSpec({ modules: SEED, structureOf: (id) => SEED_STRUCT[id] || null }));
    // 자취는 spec 모듈과 한 줄씩 맞물린다
    ['lower', 'upper'].forEach((k) => expect(r.trace[k]).toHaveLength(r.spec.sections[k].modules.length));
    // 자취가 spec 으로 새지 않는다
    expect(JSON.stringify(r.spec)).not.toContain('moduleId');
  });
});

// ── design_spec 선택 필드 ────────────────────────────────

describe('design_spec — layout · fromFloorMm · ceilingMm', () => {
  const rot = (...rs) => rs.map((r, i) => ({ id: 'm' + i, section: 'lower', W: 600, H: 870, D: 650, x: i * 600, rotation: r }));

  test('layout — 회전 가짓수로 직선·ㄱ자·ㄷ자, 모르면 null', () => {
    expect(A.plannerAiPhotoLayoutOf(rot(0, 0, 0))).toEqual({ shape: 'straight', walls: 1 });
    expect(A.plannerAiPhotoLayoutOf(rot(90))).toEqual({ shape: 'straight', walls: 1 });
    expect(A.plannerAiPhotoLayoutOf(rot(0, 90, 0))).toEqual({ shape: 'corner', walls: 2 });
    expect(A.plannerAiPhotoLayoutOf(rot(270, 0))).toEqual({ shape: 'corner', walls: 2 });
    expect(A.plannerAiPhotoLayoutOf(rot(-90, 0))).toEqual({ shape: 'corner', walls: 2 });
    expect(A.plannerAiPhotoLayoutOf(rot(270, 0, 90))).toEqual({ shape: 'u', walls: 3 });
    expect(A.plannerAiPhotoLayoutOf(rot(0, 180))).toBeNull();          // 11자 — 계약에 없다
    expect(A.plannerAiPhotoLayoutOf(rot(0, 90, 180, 270))).toBeNull();
    expect(A.plannerAiPhotoLayoutOf(rot(0, 45))).toBeNull();
    expect(A.plannerAiPhotoLayoutOf([])).toBeNull();
    // 마감재는 판이라 세지 않는다
    const withEp = rot(0, 0).concat([{ id: 'ep', section: 'ep', W: 20, rotation: 90 }]);
    expect(A.plannerAiPhotoLayoutOf(withEp)).toEqual({ shape: 'straight', walls: 1 });
  });

  test('ㄱ자 도면이면 spec.layout 이 corner', () => {
    const mods = SEED.concat([{ id: 'lower-9', section: 'lower', W: 1200, H: 870, D: 650, x: 2200, y: 0, rotation: 90 }]);
    expect(A.plannerAiPhotoBuildSpec({ modules: mods }).layout).toEqual({ shape: 'corner', walls: 2 });
  });

  test('fromFloorMm · ceilingMm — 페이지가 주는 baseYOf·천장으로, 줄의 가장 낮은 값', () => {
    const ceiling = 2300;
    const baseYOf = (m) => (m.section === 'upper' ? ceiling - m.H : 0);
    const mods = SEED.concat([{ id: 'upper-9', section: 'upper', W: 600, H: 900, D: 320, x: 1800, y: 0, rotation: 0 }]);
    const spec = A.plannerAiPhotoBuildSpec({ modules: mods, structureOf: (id) => SEED_STRUCT[id] || null, baseYOf, ceilingMm: ceiling });
    expect(spec.sections.lower.fromFloorMm).toBe(0);
    expect(spec.sections.upper.fromFloorMm).toBe(1400);   // 2300 − 900 (더 긴 상부장의 아랫면)
    expect(spec.ceilingMm).toBe(2300);
    expect(spec.layout).toEqual({ shape: 'straight', walls: 1 });
    // 기존 키·순서 그대로, 새 키는 뒤에
    expect(Object.keys(spec)).toEqual(['category', 'wallRunMm', 'sections', 'appliances', 'finishes', 'layout', 'ceilingMm']);
    expect(Object.keys(spec.sections.upper)).toEqual(['widthMm', 'heightMm', 'depthMm', 'fromLeftMm', 'modules', 'fromFloorMm']);
  });

  test('모르면 넣지 않는다 — baseYOf·천장 없음, 천장 범위 밖, baseYOf 가 던지거나 NaN', () => {
    const plain = A.plannerAiPhotoBuildSpec({ modules: SEED });
    expect(plain).not.toHaveProperty('ceilingMm');
    expect(plain.sections.lower).not.toHaveProperty('fromFloorMm');
    expect(A.plannerAiPhotoBuildSpec({ modules: SEED, ceilingMm: 900 })).not.toHaveProperty('ceilingMm');
    expect(A.plannerAiPhotoBuildSpec({ modules: SEED, ceilingMm: NaN })).not.toHaveProperty('ceilingMm');
    const bad = A.plannerAiPhotoBuildSpec({ modules: SEED, baseYOf: (m) => { if (m.section === 'upper') throw new Error('x'); return NaN; } });
    expect(bad.sections.lower).not.toHaveProperty('fromFloorMm');
    expect(bad.sections.upper).not.toHaveProperty('fromFloorMm');
  });

  test('워커 normalizeDesignSpec 은 새 키를 400 으로 막지 않는다 (조용히 버린다)', () => {
    const spec = A.plannerAiPhotoBuildSpec({ modules: SEED, baseYOf: () => 0, ceilingMm: 2400 });
    expect(() => P.normalizeDesignSpec(spec, spec.category)).not.toThrow();
  });
});

describe('작은 사진 알림 — 긴 변 1024px 미만', () => {
  test('판정', () => {
    expect(A.PLANNER_AI_PHOTO_SMALL_EDGE).toBe(1024);
    expect(A.plannerAiPhotoIsSmallPhoto(1023, 700)).toBe(true);
    expect(A.plannerAiPhotoIsSmallPhoto(583, 781)).toBe(true);
    expect(A.plannerAiPhotoIsSmallPhoto(1024, 768)).toBe(false);
    expect(A.plannerAiPhotoIsSmallPhoto(700, 1600)).toBe(false);
    expect(A.plannerAiPhotoIsSmallPhoto(0, 0)).toBe(false);       // 모르면 알리지 않는다
    expect(A.PLANNER_AI_PHOTO_SMALL_TEXT).toBe('사진이 작아 방이 바뀔 수 있습니다 — 더 큰 사진을 권합니다');
  });
});

// ── 투영·표시 목록 (순수, planner-capture.js) ───────────────

describe('투영 → 라벨 자리 · 치수 글자 (순수)', () => {
  const B = { min: { x: 0, y: 0, z: -325 }, max: { x: 2200, y: 2300, z: 325 } };

  test('plannerCaptureProjectPoint 는 three 카메라 project 와 같은 픽셀', () => {
    const f = C.plannerCaptureCleanFrame('front', B, 2200 / 2300, null, C.PLANNER_CAPTURE_ANNOTATE_FILL);
    const W = 1469, H = 1536;
    const cam = new THREE.PerspectiveCamera(f.fov, W / H, f.near, f.far);
    cam.position.set(...f.position);
    cam.up.set(...f.up);
    cam.lookAt(...f.target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    [[0, 0, 325], [2200, 2300, 325], [800, 870, 325], [1100, 1500, -160]].forEach((p) => {
      const v = new THREE.Vector3(...p).project(cam);
      const q = C.plannerCaptureProjectPoint(f, W, H, p);
      expect(q[0]).toBeCloseTo((v.x + 1) / 2 * W, 3);
      expect(q[1]).toBeCloseTo((1 - v.y) / 2 * H, 3);
    });
    // 카메라 뒤는 null
    expect(C.plannerCaptureProjectPoint(f, W, H, [1100, 1150, f.position[2] + 100])).toBeNull();
  });

  test('annotate 프레임은 가구가 80% — 위아래 여백에 치수선 자리가 있다', () => {
    const f = C.plannerCaptureCleanFrame('front', B, 2200 / 2300, null, C.PLANNER_CAPTURE_ANNOTATE_FILL);
    const box = C.plannerCaptureScreenBox(f, 1469, 1536, B);
    expect(box.y0).toBeGreaterThan(1536 * 0.08);
    expect(1536 - box.y1).toBeGreaterThan(1536 * 0.08);
    expect(box.x0).toBeGreaterThan(1469 * 0.08);
  });

  test('치수 글자 — 정수 mm, 단위 없이 · 모르면 빈 글자', () => {
    expect(C.plannerCaptureDimText(800)).toBe('800');
    expect(C.plannerCaptureDimText(533.33)).toBe('533');
    expect(C.plannerCaptureDimText(0)).toBe('');
    expect(C.plannerCaptureDimText(null)).toBe('');
    expect(C.plannerCaptureDimText('x')).toBe('');
  });

  test('annotate plan 다듬기 — 칸 없으면 null, from/to 0~1, 빈 id 버림', () => {
    expect(C.plannerCaptureAnnotatePlan(null)).toBeNull();
    expect(C.plannerCaptureAnnotatePlan(true)).toBeNull();
    expect(C.plannerCaptureAnnotatePlan({ rows: [] })).toBeNull();
    expect(C.plannerCaptureAnnotatePlan({ rows: [{ key: 'lower', items: [{ id: '', moduleId: 'a' }] }] })).toBeNull();
    const p = C.plannerCaptureAnnotatePlan({ rows: [{ key: 'lower', widthMm: 2200, heightMm: 870, items: [
      { id: 'L1', moduleId: 'lower-0', widthMm: 800 },
      { id: 'L2', moduleId: 'lower-1', from: -1, to: 2, widthMm: 400 },
      { id: 'L3', moduleId: 'lower-2', from: 0.6, to: 0.6 },
    ] }] });
    expect(p.rows[0].items).toEqual([
      { id: 'L1', moduleId: 'lower-0', from: 0, to: 1, widthMm: 800 },
      { id: 'L2', moduleId: 'lower-1', from: 0, to: 1, widthMm: 400 },
    ]);
  });

  test('표시 목록 — 라벨은 칸 가운데, 하부 치수는 아래·상부는 위, 줄 전체·높이 하나', () => {
    const plan = C.plannerCaptureAnnotatePlan({ rows: [
      { key: 'lower', widthMm: 2200, heightMm: 870, items: [
        { id: 'L1', moduleId: 'lower-0', from: 0, to: 0.5, widthMm: 400 },
        { id: 'L2', moduleId: 'lower-0', from: 0.5, to: 1, widthMm: 400 },
        { id: 'L3', moduleId: 'lower-1', widthMm: 1400 },
      ] },
      { key: 'upper', widthMm: 1800, heightMm: 780, items: [{ id: 'U1', moduleId: 'upper-0', widthMm: 1800 }] },
    ] });
    const boxes = {
      'lower-0': { x0: 100, x1: 500, y0: 1000, y1: 1400 },
      'lower-1': { x0: 500, x1: 1200, y0: 1000, y1: 1400 },
      'upper-0': { x0: 100, x1: 1000, y0: 200, y1: 560 },
    };
    const L = C.plannerCaptureAnnotationLayout(plan, boxes, 1300, 1536);
    expect(L.style.font).toBe(15);
    expect(L.style.color).toBe('#4a4a4a');
    expect(L.items.map((x) => [x.id, x.cx, x.cy])).toEqual([['L1', 200, 1200], ['L2', 400, 1200], ['L3', 850, 1200], ['U1', 550, 380]]);
    const dims = L.texts.filter((t) => t.kind === 'dim');
    const at = (text) => dims.filter((t) => t.text === text);
    // 하부: 칸 폭은 아래 첫 단, 줄 전체는 그 아래
    expect(at('400').map((t) => t.y)).toEqual([1418, 1418]);
    expect(at('1400')[0].y).toBe(1418);
    expect(at('2200')[0]).toMatchObject({ x: 650, y: 1448 });
    // 상부: 위로
    expect(at('1800').map((t) => t.y).sort((a, b) => a - b)).toEqual([152, 182]);
    // 높이 — 가구 왼쪽 끝에 닿은 줄이라 왼쪽 세로선
    expect(at('870')[0]).toMatchObject({ x: 82, y: 1200 });
    expect(at('780')[0]).toMatchObject({ x: 82, y: 380 });
    // 라벨 바탕은 반투명, 치수 바탕은 흰색
    expect(L.texts.find((t) => t.kind === 'label').bg).toBe('rgba(255,255,255,0.78)');
    expect(dims.every((t) => t.bg === '#ffffff')).toBe(true);
    // 상자가 없는 모듈의 칸은 건너뛴다
    const miss = C.plannerCaptureAnnotationLayout(plan, { 'lower-1': boxes['lower-1'] }, 1300, 1536);
    expect(miss.items.map((x) => x.id)).toEqual(['L3']);
  });

  test('오른쪽 끝 줄의 높이는 오른쪽에 · 글자는 긴 변에 비례', () => {
    const plan = C.plannerCaptureAnnotatePlan({ rows: [
      { key: 'lower', widthMm: 1000, heightMm: 870, items: [{ id: 'L1', moduleId: 'a', widthMm: 1000 }] },
      { key: 'tall', widthMm: 600, heightMm: 2300, items: [{ id: 'T1', moduleId: 'b', widthMm: 600 }] },
    ] });
    const L = C.plannerCaptureAnnotationLayout(plan, { a: { x0: 100, x1: 600, y0: 900, y1: 1300 }, b: { x0: 600, x1: 900, y0: 200, y1: 1300 } }, 3072, 2000);
    expect(L.style.font).toBe(30);
    const h = L.texts.find((t) => t.text === '2300');
    expect(h.x).toBe(900 + 36);
  });

  test('그리기 — 선 한 번에, 글자는 바탕 상자 다음 글자', () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: s.length * 8 });
        return (...a) => calls.push([k, ...a]);
      },
      set(t, k, v) { calls.push(['set', k, v]); t[k] = v; return true; },
    });
    const list = { style: { color: '#4a4a4a', line: 1.2, font: 15, fontFamily: 'Arial', labelBg: 'rgba(255,255,255,0.78)', dimBg: '#ffffff' },
      lines: [[0, 0, 10, 0]], texts: [{ x: 5, y: 5, text: 'L1', kind: 'label', bg: 'rgba(255,255,255,0.78)' }] };
    expect(C.plannerCaptureDrawAnnotation(ctx, list)).toBe(2);
    const names = calls.map((c) => (c[0] === 'set' ? 'set:' + c[1] : c[0]));
    expect(names.indexOf('stroke')).toBeLessThan(names.indexOf('fillRect'));
    expect(names.indexOf('fillRect')).toBeLessThan(names.indexOf('fillText'));
    expect(calls.find((c) => c[0] === 'fillText')).toEqual(['fillText', 'L1', 5, 5]);
    expect(calls.filter((c) => c[0] === 'set' && c[1] === 'font').map((c) => c[2])).toEqual(['600 15px Arial']);
    expect(C.plannerCaptureDrawAnnotation(null, list)).toBe(0);
  });
});

// ── capture 파이프라인 ────────────────────────────────────

function renderer() {
  return {
    capabilities: { maxTextureSize: 8192 },
    _rt: null,
    getRenderTarget() { return this._rt; },
    setRenderTarget(rt) { this._rt = rt; },
    render() {},
    readRenderTargetPixels(rt, x, y, w, h, buf) { for (let i = 0; i < buf.length; i++) buf[i] = (i * 7) % 251; },
    getSize(v) { return v.set(1200, 800); },
  };
}

/** 하부 둘(800·400) · 상부 하나 — 모듈 그룹 원점은 바닥 가운데 */
function scene() {
  const s = new THREE.Scene();
  const mg = new THREE.Group();
  s.add(mg);
  const mod = (id, x, y, W, H, D, z) => {
    const g = new THREE.Group();
    g.userData = { entityKind: 'module', moduleId: id };
    g.position.set(x + W / 2, y, z || 0);
    const door = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial());
    door.position.y = H / 2;
    door.userData = { entityKind: 'carcass', side: 'front', areaType: 'door', moduleId: id };
    g.add(door);
    mg.add(g);
    return g;
  };
  const l0 = mod('lower-0', 0, 0, 800, 870, 650);
  mod('lower-1', 800, 0, 400, 870, 650);
  // 실제 플래너처럼 런 전체(0~1200)의 상판·걸레받이가 첫 모듈 그룹에 붙는다 (브라우저 확인)
  const span = (kind, y, h) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1200, h, 650), new THREE.MeshStandardMaterial());
    m.position.set(200, y, 0);
    m.userData = { entityKind: kind, moduleId: 'lower-0' };
    l0.add(m);
  };
  span('top-panel', 876, 12);
  span('toe-kick', 75, 140);
  mod('upper-3', 0, 1520, 900, 780, 320, -165);
  return { scene: s, moduleGroup: mg };
}

const PLAN = { rows: [
  { key: 'lower', widthMm: 1200, heightMm: 870, items: [{ id: 'L1', moduleId: 'lower-0', from: 0, to: 1, widthMm: 800 }, { id: 'L2', moduleId: 'lower-1', from: 0, to: 1, widthMm: 400 }] },
  { key: 'upper', widthMm: 900, heightMm: 780, items: [{ id: 'U1', moduleId: 'upper-3', from: 0, to: 1, widthMm: 900 }] },
] };

describe('capture — annotate', () => {
  const PC = C.PlannerCapture;
  beforeEach(() => {
    window.THREE = THREE;
    PC._encode = (px, w, h) => ({ type: 'image/png', w, h, px: Uint8ClampedArray.from(px) });
    PC._outputPass = null;
    window.OutputPass = class { render(r, write) { r.setRenderTarget(write); } };
    const s = scene();
    PC.mount({ three: () => ({ renderer: renderer(), scene: s.scene, moduleGroup: s.moduleGroup }) });
  });
  afterEach(() => { window.THREE = undefined; PC._encode = null; PC._overlay = null; PC._outputPass = null; delete window.OutputPass; PC.mount(null); });

  test('annotate 가 없으면(또는 그릴 칸이 없으면) 예전과 바이트 같다 · front 가 아니면 무시', () => {
    const a = PC.capturePixels({ kind: 'front', longEdge: 96, clean: true });
    const b = PC.capturePixels({ kind: 'front', longEdge: 96, clean: true, annotate: { rows: [] } });
    expect(b.annotation).toBeUndefined();
    expect(Buffer.from(b.pixels).equals(Buffer.from(a.pixels))).toBe(true);
    expect(b.camera).toEqual(a.camera);
    expect(a.camera).not.toHaveProperty('annotate');
    const m1 = PC.capturePixels({ kind: 'massing', longEdge: 64, clean: true });
    const m2 = PC.capturePixels({ kind: 'massing', longEdge: 64, clean: true, annotate: PLAN });
    expect(m2.annotation).toBeUndefined();
    expect(m2.camera).toEqual(m1.camera);
  });

  test('front + annotate: 덜 채운 프레임, 라벨이 그 모듈 앞면 가운데 · 치수 글자', () => {
    const plain = PC.capturePixels({ kind: 'front', longEdge: 1536, clean: true });
    const shot = PC.capturePixels({ kind: 'front', longEdge: 1536, clean: true, annotate: PLAN });
    expect(shot.ok).toBe(true);
    expect(shot.camera.annotate).toBe(true);
    expect([shot.width, shot.height]).toEqual([plain.width, plain.height]);   // 크기·종횡비는 그대로
    expect(shot.frame.dist).toBeGreaterThan(plain.frame.dist);                 // 더 멀리서 — 여백
    const items = shot.annotation.items;
    expect(items.map((x) => x.id)).toEqual(['L1', 'L2', 'U1']);
    // 라벨 = 모듈 앞면 상자 투영의 가운데
    const center = (x0, x1, y0, y1, z) =>
      C.plannerCaptureProjectPoint(shot.frame, shot.width, shot.height, [(x0 + x1) / 2, (y0 + y1) / 2, z]);
    const at = (id) => { const it = items.find((x) => x.id === id); return [it.cx, it.cy]; };
    const near = (a, b) => { expect(a[0]).toBeCloseTo(b[0], 1); expect(a[1]).toBeCloseTo(b[1], 1); };
    // 가로는 몸통으로(런 전체 상판·걸레받이 빼고), 세로는 상판 윗면(882)까지
    near(at('L1'), center(0, 800, 0, 882, 325));
    near(at('L2'), center(800, 1200, 0, 870, 325));
    near(at('U1'), center(0, 900, 1520, 2300, -5));
    // L1 은 L2 왼쪽, U1 은 L1 위
    expect(at('L1')[0]).toBeLessThan(at('L2')[0]);
    expect(at('U1')[1]).toBeLessThan(at('L1')[1]);
    expect(shot.annotation.texts.filter((t) => t.kind === 'dim').map((t) => t.text).sort())
      .toEqual(['1200', '400', '780', '800', '870', '900', '900'].sort());
    // 치수선은 그림 안
    shot.annotation.lines.forEach((l) => l.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(i % 2 ? shot.height : shot.width);
    }));
  });

  test('capture() — 그린 픽셀을 PNG 로, labels·annotated 를 돌려준다', async () => {
    const seen = [];
    PC._overlay = (px, w, h, list) => { seen.push(list); const o = Uint8ClampedArray.from(px); o[0] = 1; return o; };
    const r = await PC.capture({ kind: 'front', longEdge: 256, clean: true, annotate: PLAN });
    expect(r.ok).toBe(true);
    expect(r.annotated).toBe(true);
    expect(r.labels.map((x) => x.id)).toEqual(['L1', 'L2', 'U1']);
    expect(seen).toHaveLength(1);
    expect(r.blob.px[0]).toBe(1);
  });

  test('capture() — 그리기 실패면 번호 없는 입면 그대로 (annotated:false) · annotate 없으면 키도 없다', async () => {
    PC._overlay = () => null;
    const r = await PC.capture({ kind: 'front', longEdge: 128, clean: true, annotate: PLAN });
    expect(r.ok).toBe(true);
    expect(r.annotated).toBe(false);
    PC._overlay = () => { throw new Error('no canvas'); };
    const r2 = await PC.capture({ kind: 'front', longEdge: 128, clean: true, annotate: PLAN });
    expect(r2.annotated).toBe(false);
    const plain = await PC.capture({ kind: 'front', longEdge: 128, clean: true });
    expect(plain).not.toHaveProperty('annotated');
    expect(plain).not.toHaveProperty('labels');
  });
});
