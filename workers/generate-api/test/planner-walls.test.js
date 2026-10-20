/**
 * 2026-10-19: ㄱ자·ㄷ자 벽별 줄 (design_spec.walls[]) — 꺾인 벽을 제 줄·제 입면으로 말한다.
 * 계약: docs/02-design/features/design-spec-prompt.md "꺾인 벽".
 *
 * 실측 (2026-10-19 GPT, 시드 evalc1): 뒷벽 하부 2400 + 왼쪽으로 꺾인 하부 1200(r90) + 상부 2400 + 싱크.
 * 패널은 꺾인 하부를 한 줄로 펴서 `650 436 936 842 421`(꺾인 936 이 가운데) · wallRunMm 3335 로 보냈고, 결과는
 * 기존 ㄱ자 주방 사진에 꺾인 쪽 상부장·없는 쿡탑/후드를 넣고, 공사현장 사진에는 꺾인 장을 방 안쪽으로 튀어나온 장으로 그렸다.
 *
 * 고정하는 것:
 *   1) normalizeDesignSpec — walls[] (side·corner·runMm·cornerEdge·sections(fromCornerMm)·appliances), 모르는 side 는 버림, 최대 2, 같은 side 한 번
 *   2) 프롬프트 — LAYOUT 실제 방향(BACK + LEFT, 모서리 차지, 꺾인 벽 상부장 없음, 반대쪽 벽 비움), 벽별 FIXED GEOMETRY,
 *      번호는 주벽에 이어서(L5), 모서리 유닛 한마디, 벽별 빈 구역, 자체 점검, EDIT ZONE, 꺾인 벽 입면 IMAGE D, DO NOT 글자
 *   3) 검사 LAYOUT 요약 — 꺾인 벽 줄
 *   4) 역판독 — 판독 계획에 꺾인 벽 줄(L5), 기대값 순서(주벽 → 꺾인 벽), 대조 ok, 꺾인 벽 입면 IMAGE 3
 *   5) 잡 — 꺾인 벽 입면을 3/4 뒤에 싣는다 (Gemini 는 번호 없는 것, GPT 는 번호 있는 것), 렌더 역할 저장
 *   6) walls 가 없으면 예전 그대로 (옛 모양 대조는 PR 본문)
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_WALL_CORNERS, buildPlannerPrompt, designSpecDigest, normalizeDesignSpec } from '../src/prompts.js';
import { expectedFromSpec, compareLayoutToSpec } from '../src/verify.js';
import { buildPlannerReadPrompt, normalizePlannerRead, plannerReadPlan } from '../src/layout.js';
import { GenerateJob } from '../src/job.js';

const one = (w, label = '도어') => ({ widthMm: w, kind: 'door', doorCount: 1, drawerCount: 0, label });
const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });

/** 시드 evalc1 「전체 자동계산」 뒤 패널이 보내는 모양 */
function cornerRaw() {
  return {
    category: 'sink',
    wallRunMm: 2400,
    sections: {
      lower: { widthMm: 2349, heightMm: 870, depthMm: 550, fromLeftMm: 50, modules: [one(650, '멍장'), one(436), two(842), one(421)], fromFloorMm: 0 },
      upper: { widthMm: 2400, heightMm: 780, depthMm: 290, fromLeftMm: 0, modules: [two(960), two(960), one(480)], fromFloorMm: 1520 },
    },
    appliances: [{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }],
    finishes: {},
    notes: 'ㄱ자 배치 — 왼쪽 벽으로 꺾인 하부 1개',
    layout: { shape: 'corner', walls: 2 },
    ceilingMm: 2300,
    walls: [
      {
        side: 'left', corner: 'main', runMm: 1574, cornerEdge: 'left',
        sections: { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, fromFloorMm: 0, modules: [two(936)] } },
      },
    ],
  };
}
const spec = () => normalizeDesignSpec(cornerRaw(), 'sink');
const prompt = (extra = {}) =>
  buildPlannerPrompt({
    category: 'sink', designSpec: spec(), wallW: 3000, wallH: 2400, confidence: 'high', massing: true, labeledElevation: true,
    returnElevations: [{ side: 'left', labeled: true }], ...extra,
  });

test('계약: walls[] 를 받는다 — side·corner·runMm·cornerEdge·fromCornerMm·appliances, 모르는 값은 버린다', () => {
  const s = spec();
  assert.deepEqual(s.walls, [
    {
      side: 'left', corner: 'main', runMm: 1574, cornerEdge: 'left',
      sections: { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, fromFloorMm: 0, modules: [{ kind: 'door', widthMm: 936, doorCount: 2, drawerCount: 0, label: '양문' }] } },
    },
  ]);
  assert.deepEqual(DESIGN_WALL_CORNERS, ['main', 'return', 'open']);
  const raw = cornerRaw();
  raw.walls = [
    { side: 'up', sections: { lower: { modules: [two(600)] } } },                      // 모르는 side — 버림
    { side: 'right', corner: 'weird', cornerEdge: 'middle', sections: { lower: { fromCornerMm: 99999, modules: [two(600)] } }, appliances: [{ kind: 'sink', fromCornerMm: 100, widthMm: 500 }, { kind: 'oven' }] },
    { side: 'right', sections: { lower: { modules: [two(700)] } } },                   // 같은 side 두 번 — 앞의 것
    { side: 'left', sections: {} },                                                    // 줄이 없으면 버림
  ];
  const w = normalizeDesignSpec(raw, 'sink').walls;
  assert.equal(w.length, 1);
  assert.deepEqual(w[0], {
    side: 'right',
    sections: { lower: { fromCornerMm: 12000, modules: [{ kind: 'door', widthMm: 600, doorCount: 2, drawerCount: 0, label: '양문' }] } },
    appliances: [{ kind: 'sink', fromCornerMm: 100, widthMm: 500 }],
  });
  assert.throws(() => normalizeDesignSpec({ ...cornerRaw(), walls: [{ side: 'left', sections: { lower: { fromCornerMm: 'abc', modules: [two(600)] } } }] }, 'sink'), /walls\[\]\.sections\.lower\.fromCornerMm/);
  // walls 가 없으면 키도 없다
  assert.equal('walls' in normalizeDesignSpec({ ...cornerRaw(), walls: undefined }, 'sink'), false);
  assert.equal('walls' in normalizeDesignSpec({ ...cornerRaw(), walls: [] }, 'sink'), false);
});

test('LAYOUT: 뒷벽 + 왼쪽 벽 꺾임 · 모서리는 L1 · 꺾인 벽 상부장 없음 · 오른쪽 벽 비움 · 반도형 금지', () => {
  const p = prompt();
  const layout = p.split('\n\n').find((x) => x.startsWith('LAYOUT:'));
  assert.match(layout, /^LAYOUT: L-shape — the main run stands on the BACK wall of IMAGE A and a return run stands on the LEFT wall, joined to it at the left corner\./);
  assert.match(layout, /fronts facing into the room — never a free-standing block or peninsula/);
  assert.match(layout, /At the left corner L1 runs into the corner; L5 starts in front of it, its side against L1's front\./);
  assert.match(layout, /No wall units on the left wall\./);
  assert.match(layout, /The right wall gets no cabinets\./);
  assert.doesNotMatch(p, /unfolded/);
});

test('FIXED GEOMETRY: 벽마다 — 뒷벽 L1–L4·U1–U3, 왼쪽 벽 L5 (주벽에 이어서), 모서리 유닛 한마디', () => {
  const p = prompt();
  assert.match(p, /FIXED GEOMETRY — each wall exactly as its own elevation shows:\n {2}BACK WALL \(IMAGE B\), left to right:\n {2}BASE ROW/);
  assert.match(p, /\n {4}L1 {3}650 mm {2}single-door cabinet, in the left corner — L5 stands in front of it\n/);
  assert.match(p, /\n {2}LEFT WALL — the return \(IMAGE D\), from the corner toward the room:\n {2}BASE ROW \(936 mm long, starts 638 mm out from the back wall; bottom at 0 mm, top at 870 mm from the floor\):\n {4}L5 {3}936 mm {2}2-door cabinet\n/);
  assert.match(p, /CLOSED LIST: L1–L4, U1–U3 and L5 are the only built-in units in the result\./);
  assert.match(p, /against the reference row of its own wall/);
  // 펴진 한 줄(650 436 936 842 421)이 아니다
  assert.doesNotMatch(p, /L3 {3}936/);
  // 2026-10-20: 벽 % 는 주벽 기준 줄에만 — 꺾인 벽 줄에는 없다
  assert.equal(p.split('% of the wall,').length - 1, 1);
  assert.doesNotMatch(p, /936 mm long — /);
});

test('빈 구역·자체 점검·편집 구역: 벽 이름으로, 꺾인 벽 위는 상부장 없이 천장까지', () => {
  const p = prompt();
  assert.match(p, /left wall: above the return \(L5\) — no wall units, bare wall up to the ceiling/);
  assert.match(p, /back wall: between the top of the base row \(870 mm\) and the bottom of the wall row \(1520 mm\)/);
  assert.match(p, /FINAL SELF-CHECK before you answer: back wall base row 4 units, L1 1 \+ L2 1 \+ L3 2 \+ L4 1 = 5 doors, 0 drawers; back wall wall row 3 units, U1 2 \+ U2 2 \+ U3 1 = 5 doors; back wall base row ends at about 80 % of the wall \(2400 mm\); left wall base row 1 unit, 2 doors, 0 drawers; no wall units on the left wall;/);
  assert.match(p, /EDIT ZONE: the back wall and the left wall only/);
  // 도면에 없는 쿡탑·후드는 계속 막는다
  assert.match(p, /add a dishwasher, refrigerator, oven, cooktop or hood that is not listed/);
});

// 2026-10-20 실측(싱크대 연출컷 mm 측정): ㄱ자 walls[] 에서 벽의 55 % 인 주벽 줄을 84~88 % 까지 늘렸다 — 주벽 줄 길이·남는 벽을
//   아예 말하지 않았다(oneWall 게이트). 이제 주벽 줄 길이(mm·벽 %)와 꺾인 벽 반대쪽 끝 너머 남는 벽을 말하고 배율 문장을 뺀다.
test('ㄱ자 주벽 줄 길이: 왼쪽 꺾임 — 줄 길이 mm·%, 오른쪽 남는 벽, 배율 문장 없음, 자체 점검에 끝 %', () => {
  const p = prompt();
  assert.ok(p.includes('  BASE ROW (2349 mm long — 78 % of the wall, starts 50 mm from the left end of the run; bottom at 0 mm, top at 870 mm from the floor):'));
  assert.ok(p.includes(
    'against the reference row of its own wall. The back-wall run is 2400 mm long — about 80 % of the back wall (about 3000 mm in IMAGE A). ' +
      'Do not stretch the units to fill the wall; keep the remaining 600 mm (about 20 %) right of the run as bare wall. ' +
      "Keep each door's proportions as IMAGE B shows — do not widen any door.\n"
  ));
  assert.doesNotMatch(p, /Only the overall scale/);
  assert.match(p, /\n {2}\d+\. back wall: right of the run, floor to ceiling\n/);
  assert.match(p, /U3 1 = 5 doors; back wall base row ends at about 80 % of the wall \(2400 mm\); left wall base row 1 unit,/);
  // 꺾인 벽 줄에는 % 가 없다 (옆벽 폭은 모른다)
  assert.ok(p.includes('  BASE ROW (936 mm long, starts 638 mm out from the back wall;'));
});

test('ㄱ자 주벽 줄 길이: 오른쪽 꺾임 — 주벽 줄이 모서리까지(main)면 왼쪽 남는 벽, return·open·ㄷ자·벽 모름이면 예전 배율 문장', () => {
  const raw = cornerRaw();
  raw.walls[0].side = 'right';
  raw.walls[0].cornerEdge = 'right';
  const ctx = (r, extra = {}) => ({ category: 'sink', designSpec: normalizeDesignSpec(r, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high', ...extra });
  const p = buildPlannerPrompt(ctx(raw));
  assert.ok(p.includes('keep the remaining 600 mm (about 20 %) left of the run as bare wall.'));
  assert.match(p, /\d+\. back wall: left of the run, floor to ceiling\n/);
  assert.match(p, /; back wall base row ends at about 80 % of the wall \(2400 mm\) counted from the right corner;/);
  // 꺾인 장이 모서리를 차지하면(return) 주벽 좌표의 0 이 벽 끝이 아니다 — 남는 벽을 재지 않는다
  for (const corner of ['return', 'open']) {
    raw.walls[0].corner = corner;
    const q = buildPlannerPrompt(ctx(raw));
    assert.match(q, /Only the overall scale may change to fit the real wall in IMAGE A\./);
    assert.doesNotMatch(q, /Do not stretch|of the run, floor to ceiling|ends at about/);
  }
  // ㄷ자(꺾인 벽 둘) — 주벽 줄은 양 모서리 사이, 남는 벽을 말하지 않는다
  const u = cornerRaw();
  u.layout = { shape: 'u', walls: 3 };
  u.walls.push({ side: 'right', corner: 'main', sections: { lower: { fromCornerMm: 600, modules: [two(800)] } } });
  const q = buildPlannerPrompt(ctx(u));
  assert.match(q, /Only the overall scale may change to fit the real wall in IMAGE A\./);
  assert.doesNotMatch(q, /Do not stretch|of the run, floor to ceiling|ends at about/);
  // 벽 폭을 모르면(분석 실패) 배율 문장 그대로, 남는 벽은 % 없이
  const r = prompt({ confidence: null });
  assert.match(r, /Only the overall scale may change to fit the real wall in IMAGE A\./);
  assert.doesNotMatch(r, /% of the wall|Do not stretch/);
  assert.match(r, /\d+\. back wall: beyond the right end of the run, wherever the run is shorter than the wall\n/);
});

// 2026-10-19 실측(GPT): 기존 ㄱ자 주방 사진 — 새 장은 ㄱ자로 맞게 지었지만 옛 가스레인지·슬림 후드가 남았다 (도면에 없음).
//   공사현장 사진 — 상부 960·960·480(2·2·1)을 6짝으로 그렸다.
test('ㄱ자 보강: 두 벽의 옛 붙박이 가전 철거 · 외문이 섞인 줄은 칸별 문 수', () => {
  const p = prompt();
  assert.ok(p.includes(
    'Remove that cabinetry completely, with no demolition marks or ghost outlines. ' +
      'The old built-in appliances on the back wall and the left wall go with it: remove any old gas range or cooktop, range hood, built-in oven and built-in dishwasher — the new design has none — ' +
      'and close each place with the new countertop, fronts or bare wall. The sink is new, only where the list above puts it.\n'
  ));
  assert.ok(p.includes('every movable object — a free-standing refrigerator, microwave, carts,'));
  assert.ok(p.includes('    → widths U1 : U2 : U3 = 2 : 2 : 1\n    → doors U1 2 + U2 2 + U3 1 = 5 doors\n'));
  assert.ok(p.includes('    → doors L1 1 + L2 1 + L3 2 + L4 1 = 5 doors\n'));
  // 꺾인 벽 한 칸(2짝)은 고른 줄 — 합계만
  assert.match(p, /left wall base row 1 unit, 2 doors, 0 drawers/);
  // 꺾인 벽에 놓인 가전(fromCornerMm)도 도면에 있는 셈 — 철거 목록·DO NOT 에서 빠진다
  const raw = cornerRaw();
  raw.walls[0].appliances = [{ kind: 'cooktop', fromCornerMm: 700, widthMm: 600 }];
  const q = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
  assert.match(q, /remove any old range hood, built-in oven and built-in dishwasher — .* The sink and cooktop are new/);
  assert.match(q, /add a dishwasher, refrigerator, oven or hood that is not listed/);
});

test('그림: 꺾인 벽 입면은 3/4 다음 글자 (D, 3/4 가 없으면 C) · 모서리 쪽 가장자리 · DO NOT 글자', () => {
  const p = prompt();
  assert.match(p, /^You receive four images\./);
  assert.match(p, /IMAGE B — FRONT ELEVATION from our planner: the back wall run, seen straight on\./);
  assert.match(p, /IMAGE C — 3\/4 VIEW of the whole design: shows how the runs meet at the corner/);
  assert.match(p, /IMAGE D — FRONT ELEVATION of the left wall run \(the return\), seen straight on\. Its left edge is the corner\. Its ID labels and dimension lines are annotations too/);
  assert.match(p, /IMAGE B, C and D are design references\./);
  assert.match(p, /paste IMAGE B, C or D into the photo/);
  const q = prompt({ massing: false, labeledElevation: false, returnElevations: [{ side: 'left', labeled: false }] });
  assert.match(q, /^You receive three images\./);
  assert.match(q, /IMAGE C — FRONT ELEVATION of the left wall run \(the return\), seen straight on\. Its left edge is the corner\.\n/);
  assert.match(q, /LEFT WALL — the return \(IMAGE C\)/);
  // 꺾인 벽 입면이 없으면 글 목록으로
  const r = prompt({ returnElevations: [] });
  assert.match(r, /^You receive three images\./);
  assert.match(r, /IMAGE B shows only the back wall; build the return from the list below\./);
  assert.match(r, /LEFT WALL — the return, from the corner toward the room:/);
});

test('모서리: return 이면 꺾인 장이 모서리까지, open 이면 모서리 비움', () => {
  const raw = cornerRaw();
  raw.walls[0].corner = 'return';
  const p = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
  assert.match(p, /At the left corner L5 runs into the corner; the back-wall run starts beside it with L1\./);
  assert.match(p, /L5 {3}936 mm {2}2-door cabinet, in the left corner\n/);
  raw.walls[0].corner = 'open';
  const q = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
  assert.match(q, /At the left corner the two runs do not meet — leave the corner itself without cabinets\./);
});

test('검사 LAYOUT 요약: 꺾인 벽 줄이 뒤에', () => {
  assert.match(designSpecDigest(spec()), / \| left wall lower \(from the corner\) = 936 mm 2-door cabinet$/);
});

test('역판독: 판독 계획에 꺾인 벽 줄(L5), 기대값은 주벽 → 꺾인 벽 순서, 꺾인 벽 입면 IMAGE 3', () => {
  const plan = plannerReadPlan(spec(), 'sink');
  assert.deepEqual(plan.rows.map((r) => [r.row, r.wall || 'main', r.units.map((u) => u.id).join(' ')]), [
    ['base', 'main', 'L1 L2 L3 L4'],
    ['wall', 'main', 'U1 U2 U3'],
    ['base', 'left', 'L5'],
  ]);
  assert.deepEqual(plan.rows[2].units[0], {
    id: 'L5', section: 'lower', widthMm: 936, startMm: 638, endMm: 1574, seen: 'cabinet', doors: 2, drawers: 0, attached: [],
  });
  const e = expectedFromSpec(spec(), 'sink');
  assert.equal(e.floorKinds.length, 5);
  assert.equal(e.floorDoors, 7);
  const rp = buildPlannerReadPrompt({ category: 'sink', designSpec: spec(), elevation: 'labeled', returnElevations: [{ side: 'left', labeled: true }] });
  assert.match(rp, /IMAGE 3 — FRONT ELEVATION of the LEFT wall return of the same plan, seen straight on, with its unit IDs\./);
  assert.match(rp, /BASE ROW — LEFT WALL, the return \(from the corner outward\) \(row "base"\):\n {4}L5 {3}936 mm {2}2 doors/);
  assert.match(rp, /PLAN LAYOUT: one L-shaped run — the back wall run plus a return on the LEFT wall/);
  // 사람이 센 정답이면 ok
  const raw = {
    rows: plan.rows.map((r) => ({ row: r.row, units: r.units.map((u) => ({ id: u.id, seen: u.seen, doors: u.doors, drawers: u.drawers })) })),
    extra_units: [], layout_shape: 'corner', confidence: 0.9, notes: [],
  };
  const layout = normalizePlannerRead(raw, { category: 'sink', designSpec: spec() });
  assert.deepEqual(layout.segments.map((x) => x.id), ['L1', 'L2', 'L3', 'L4', 'L5']);
  const v = compareLayoutToSpec(layout, spec(), 'sink');
  assert.equal(v.ok, true);
  assert.equal(v.parts.shape, 1);
});

test('walls 가 없으면 예전 그대로 — 펴진 ㄱ자 문단', () => {
  const raw = cornerRaw();
  delete raw.walls;
  const p = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high', returnElevations: [{ side: 'left', labeled: true }] });
  assert.match(p, /LAYOUT: one L-shaped run on 2 walls\. IMAGE B shows it unfolded into one flat strip/);
  assert.match(p, /^You receive two images\./);
  assert.doesNotMatch(p, /LEFT WALL|IMAGE C/);
});

// ─── 잡: 꺾인 벽 입면을 3/4 뒤에 ───
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const BYTES = {
  room: 'ROOM', 'render-elevation': 'ELEV', 'render-elevation_labeled': 'LABEL', 'render-massing': 'MASS',
  'render-elevation_left': 'LEFT', 'render-elevation_left_labeled': 'LEFTLAB',
};
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let calls;
let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

function install() {
  calls = { image: [], openai: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.openai.com/')) {
      const f = init.body;
      calls.openai.push({
        prompt: f.get('prompt'),
        images: await Promise.all(f.getAll('image[]').map(async (b) => Buffer.from(await b.arrayBuffer()).toString())),
      });
      return jsonRes({ data: [{ b64_json: b64('GPT') }] });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      const name = u.split('/').pop().split('.')[0];
      return new Response(Buffer.from(BYTES[name] || 'X'), { headers: { 'Content-Type': u.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
          : JSON.stringify({ ok: true, issues: [], note: 'n' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      calls.image.push({ prompt, images: parts.filter((p) => p.inlineData).map((p) => Buffer.from(p.inlineData.data, 'base64').toString()) });
      return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}
function fakeState() {
  const m = new Map();
  return { storage: { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, structuredClone(v)), setAlarm: async () => {}, deleteAll: async () => m.clear(), deleteAlarm: async () => {} } };
}
const render = (role, ext = 'png') => ({ role, path: `${USER_ID}/${ROW_ID}/render-${role}.${ext}`, url: 'u', mime: ext === 'png' ? 'image/png' : 'image/jpeg' });
async function runJob(options, renders, env = {}) {
  const job = new GenerateJob(fakeState(), {
    GEMINI_API_KEY: 'k', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's', GENERATIONS_BUCKET: 'generations', ...env,
  });
  await job.fetch(new Request('https://generate-job/start', {
    method: 'POST',
    body: JSON.stringify({
      id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options,
      inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [], renders },
      startedAt: Date.now(),
    }),
  }));
  await job.alarm();
}
const RENDERS = [render('elevation'), render('elevation_labeled'), render('massing', 'jpg'), render('elevation_left'), render('elevation_left_labeled')];

test('잡 (Gemini): [방, 입면, 3/4, 왼쪽 벽 입면(번호 없음)] + IMAGE D 문장', async () => {
  install();
  await runJob({ design_spec: spec(), mode: 'planner', aspect: '16:9', variants: false }, RENDERS);
  assert.equal(calls.image.length, 1);
  assert.deepEqual(calls.image[0].images, ['ROOM', 'ELEV', 'MASS', 'LEFT']);
  assert.match(calls.image[0].prompt, /^You receive four images\./);
  assert.match(calls.image[0].prompt, /IMAGE D — FRONT ELEVATION of the left wall run \(the return\), seen straight on\. Its left edge is the corner\.\n/);
});

test('잡 (GPT): 번호 입면들 — [방, 번호 입면, 3/4, 왼쪽 벽 번호 입면]', async () => {
  install();
  await runJob(
    { design_spec: spec(), mode: 'planner', aspect: '16:9', variants: false, image_provider: 'openai' },
    RENDERS,
    { OPENAI_API_KEY: 'sk-test', OPENAI_IMAGE_MODEL: 'gpt-image-2.5-sunburst', GEMINI_RETRY_DELAYS_MS: '0,0,0' }
  );
  assert.equal(calls.openai.length, 1);
  assert.deepEqual(calls.openai[0].images, ['ROOM', 'LABEL', 'MASS', 'LEFTLAB']);
  assert.match(calls.openai[0].prompt, /Its ID labels and dimension lines are annotations too/);
});

test('잡: walls 가 없으면 꺾인 벽 렌더가 와도 싣지 않는다 (예전 그대로 세 장)', async () => {
  install();
  const raw = cornerRaw();
  delete raw.walls;
  await runJob({ design_spec: normalizeDesignSpec(raw, 'sink'), mode: 'planner', aspect: '16:9', variants: false }, RENDERS);
  assert.deepEqual(calls.image[0].images, ['ROOM', 'ELEV', 'MASS']);
  assert.match(calls.image[0].prompt, /^You receive three images\./);
});
