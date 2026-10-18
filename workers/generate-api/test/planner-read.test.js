/**
 * 플래너 모드 역판독 (2026-10-19, layout.js §4 · verify.js 플래너 판독).
 *
 * 고정하는 것:
 *   1) 판독 계획: design_spec → 줄마다 번호(L·U·T·W) — prompts.js plannerRows 와 같은 번호, 생성 모델이 받은 도어·서랍 수
 *   2) 프롬프트: [결과 사진, 정면 입면(번호 있으면 그것)] + 도면 목록, 모듈마다 세라
 *   3) 정규화: 모듈별 판독 → normalizeLayout 과 같은 모양(segments·uppers·appliances·doorCounts) + units·extraUnits·shape
 *   4) 대조: 정답 · 모듈 하나 잘못 셈 · 덤 유닛(이슈만) · 꺾임(shape 점수, ok 막음) · unclear/모양 모름(항목 없음)
 *   5) 화면 필드(ok·score·max·issues) 유지, 플래너가 아니면 옛 결과 그대로
 *   6) 잡: 플래너면 Claude 에 [base, 번호 입면] + 판독 스키마, 번호 입면이 없으면 번호 없는 입면, 플래너가 아니면 한 장 + 옛 스키마
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNER_READ_SCHEMA,
  buildPlannerReadPrompt,
  normalizeLayout,
  normalizePlannerRead,
  plannerReadPlan,
} from '../src/layout.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { buildPlannerPrompt } from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

/** D1 — 하부 800(2)·400(1)·1000(2, 싱크), 상부 900(2)·900(2), 런 2200, 일자 */
const D1 = {
  version: 1,
  category: 'sink',
  wallRunMm: 2200,
  layout: { shape: 'straight' },
  sections: {
    lower: {
      widthMm: 2200, heightMm: 870, fromLeftMm: 0,
      modules: [
        { widthMm: 800, kind: 'door', doorCount: 2 },
        { widthMm: 400, kind: 'door', doorCount: 1 },
        { widthMm: 1000, kind: 'door', doorCount: 2 },
      ],
    },
    upper: {
      widthMm: 1800, heightMm: 720, fromLeftMm: 400,
      modules: [
        { widthMm: 900, kind: 'door', doorCount: 2 },
        { widthMm: 900, kind: 'door', doorCount: 2 },
      ],
    },
  },
  appliances: [{ kind: 'sink', fromLeftMm: 1450, widthMm: 700 }],
};
const WA = { wallW: 3600, wallH: 2400, waterPct: 50, exhaustPct: 30 };

const unit = (id, doors, drawers = 0, seen = 'cabinet') => ({ id, seen, doors, drawers });
/** 사람이 센 정답 그대로의 판독 */
function goodRead() {
  return {
    rows: [
      { row: 'base', units: [unit('L1', 2), unit('L2', 1), unit('L3', 2)] },
      { row: 'wall', units: [unit('U1', 2), unit('U2', 2)] },
    ],
    extra_units: [],
    layout_shape: 'straight',
    confidence: 0.9,
    notes: [],
  };
}
const norm = (raw, spec = D1, extra = {}) =>
  normalizePlannerRead(raw, { category: 'sink', designSpec: spec, wallAnalysis: WA, model: 'm', now: 'T', elevation: 'labeled', ...extra });

test('판독 계획: 줄마다 번호 — 설치 프롬프트의 번호와 같고, 싱크는 걸린 모듈에 붙는다', () => {
  const p = plannerReadPlan(D1, 'sink');
  assert.deepEqual(p.rows.map((r) => r.row), ['base', 'wall']);
  assert.deepEqual(p.rows[0].units.map((u) => [u.id, u.widthMm, u.doors, u.drawers]), [
    ['L1', 800, 2, 0], ['L2', 400, 1, 0], ['L3', 1000, 2, 0],
  ]);
  assert.deepEqual(p.rows[1].units.map((u) => [u.id, u.startMm, u.endMm]), [['U1', 400, 1300], ['U2', 1300, 2200]]);
  assert.deepEqual(p.rows[0].units[2].attached, ['sink']);
  assert.equal(p.runMm, 2200);
  assert.equal(p.shape, 'straight');
  // 설치 프롬프트(prompts.js plannerRows)도 같은 번호를 쓴다
  const install = buildPlannerPrompt({ category: 'sink', designSpec: D1, wallW: 3600, wallH: 2400, confidence: 'high' });
  for (const id of ['L1', 'L2', 'L3', 'U1', 'U2']) assert.ok(install.includes(id), id);
});

test('판독 계획: 도어 수가 비면 생성 모델이 받은 수(문 1짝·서랍 1단), 붙박이장은 구간을 이어 W 한 줄', () => {
  const p = plannerReadPlan({ sections: { lower: { modules: [{ widthMm: 600, kind: 'door' }, { widthMm: 600, kind: 'drawer' }] } } }, 'sink');
  assert.deepEqual(p.rows[0].units.map((u) => [u.doors, u.drawers]), [[1, 0], [0, 1]]);
  const w = plannerReadPlan({
    sections: {
      tall: { fromLeftMm: 900, modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }] },
      lower: { fromLeftMm: 0, modules: [{ widthMm: 900, kind: 'drawer', drawerCount: 3 }] },
    },
  }, 'wardrobe');
  assert.deepEqual(w.rows.map((r) => r.row), ['wardrobe']);
  assert.deepEqual(w.rows[0].units.map((u) => [u.id, u.section, u.doors, u.drawers]), [['W1', 'lower', 0, 3], ['W2', 'tall', 2, 0]]);
  assert.equal(w.shape, null);
  // 모양은 notes 의 ㄱ자 문구로도 안다 (prompts.js plannerLayout 과 같은 규칙)
  assert.equal(plannerReadPlan({ notes: 'ㄱ자 주방', sections: {} }, 'sink').shape, 'corner');
});

test('스키마: 모든 object 가 additionalProperties:false 이고 required 가 properties 와 같다 (구조화 출력 요건)', () => {
  const walk = (s, path) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      Object.entries(s.properties).forEach(([k, v]) => walk(v, `${path}.${k}`));
    }
    if (s.items) walk(s.items, `${path}[]`);
  };
  walk(PLANNER_READ_SCHEMA, '$');
});

test('프롬프트: 번호 입면이면 라벨로 짝 짓고, 도면 목록을 줄·번호·폭·도어 수로 준다', () => {
  const t = buildPlannerReadPrompt({ category: 'sink', designSpec: D1, elevation: 'labeled' });
  assert.match(t, /^You are checking a generated photo/);
  assert.match(t, /IMAGE 1 — RESULT PHOTO/);
  assert.match(t, /IMAGE 2 — FRONT ELEVATION .* labelled by its ID \(L1, U1 …\)/);
  assert.ok(t.includes('  BASE ROW (row "base"):\n    L1   800 mm  2 doors\n    L2   400 mm  1 door\n    L3  1000 mm  2 doors, sink on the countertop'));
  assert.ok(t.includes('  WALL ROW (row "wall"):\n    U1   900 mm  2 doors\n    U2   900 mm  2 doors'));
  assert.match(t, /PLAN LAYOUT: one straight run on one wall\./);
  assert.match(t, /report the photo, never copy the plan's numbers/);
  assert.match(t, /extra_units/);
  // 번호 없는 입면 · 입면 없음
  const plain = buildPlannerReadPrompt({ category: 'sink', designSpec: D1, elevation: 'plain' });
  assert.match(plain, /It has no labels: the IDs below run left to right/);
  const none = buildPlannerReadPrompt({ category: 'sink', designSpec: D1, elevation: null });
  assert.doesNotMatch(none, /IMAGE 2/);
  // 모양을 모르면 PLAN LAYOUT 줄이 없다
  const { layout, ...noShape } = D1;
  void layout;
  assert.doesNotMatch(buildPlannerReadPrompt({ category: 'sink', designSpec: noShape, elevation: 'plain' }), /PLAN LAYOUT/);
});

test('정규화: 모듈별 판독 → normalizeLayout 과 같은 모양 (mm 는 도면 값)', () => {
  const l = norm(goodRead());
  assert.equal(l.reader, 'planner');
  assert.equal(l.elevation, 'labeled');
  assert.deepEqual(l.wall, { W: 3600, H: 2400 });
  assert.deepEqual(l.segments.map((s) => [s.id, s.kind, s.doors, s.x, s.w]), [
    ['L1', 'lower', 2, 0, 800], ['L2', 'lower', 1, 800, 400], ['L3', 'lower', 2, 1200, 1000],
  ]);
  assert.deepEqual(l.uppers.map((u) => [u.id, u.kind, u.doors, u.x, u.w]), [['U1', 'upper', 2, 400, 900], ['U2', 'upper', 2, 1300, 900]]);
  assert.deepEqual(l.doorCounts, { lower: 5, upper: 4, tall: 0, fridge: 0, wardrobe: 0 });
  assert.equal(l.appliances.sink.source, 'spec');
  assert.equal(l.appliances.sink.x, 1450);
  assert.equal(l.shape, 'straight');
  assert.equal(l.planShape, 'straight');
  assert.deepEqual(l.units[2].expected, { seen: 'cabinet', doors: 2, drawers: 0 });
  // 옛 판독(normalizeLayout) 이 내는 키를 다 갖는다 — /layout 캐시·gen-import 가 같은 모양을 읽는다
  const old = normalizeLayout({}, { category: 'sink', wallAnalysis: WA, now: 'T' });
  for (const k of Object.keys(old)) assert.ok(k in l, k);
});

test('대조: 사람이 센 정답이면 ok — 순서·개수·상부장·모양 네 항목 만점, 화면 필드 유지', () => {
  const v = compareLayoutToSpec(norm(goodRead()), D1, 'sink');
  assert.equal(v.ok, true);
  assert.equal(v.reader, 'planner');
  assert.deepEqual(Object.keys(v.parts).sort(), ['counts', 'order', 'shape', 'uppers']);
  assert.equal(v.score, 4);
  assert.equal(v.max, 4);
  assert.deepEqual(v.issues, []);
  // ai-photo.js 가 읽는 필드 + 옛 expected/read 필드
  for (const k of ['ok', 'score', 'max', 'issues', 'parts', 'expected', 'read', 'version']) assert.ok(k in v, k);
  assert.equal(v.read.floorDoors, 5);
  assert.equal(v.read.upperDoors, 4);
  assert.equal(v.expected.floorDoors, 5);
  assert.equal(v.expected.upperDoors, 4);
});

test('대조: 도면 밖 덤 유닛(냉장고 위 2짝)은 상부장 도어 수에 섞지 않고 이슈로만 — b9f48bfb 경우', () => {
  const raw = goodRead();
  raw.extra_units = [{ row: 'wall', where: 'above the refrigerator', doors: 2, drawers: 0 }];
  const v = compareLayoutToSpec(norm(raw), D1, 'sink');
  assert.equal(v.ok, true);
  assert.equal(v.parts.uppers, 1, '상부 U1·U2 는 4짝 그대로');
  assert.deepEqual(v.issues, ['extra: wall unit not in plan (above the refrigerator), 2 doors + 0 drawers']);
  assert.deepEqual(v.read.extraUnits, [{ row: 'wall', where: 'above the refrigerator', doors: 2, drawers: 0 }]);
});

test('대조: 모듈 하나를 잘못 세면 그 모듈 이름으로 이슈, 총수 점수는 옛 규칙(4/5 → 0.8, ok)', () => {
  const raw = goodRead();
  raw.rows[0].units[2].doors = 1;
  const v = compareLayoutToSpec(norm(raw), D1, 'sink');
  assert.equal(v.parts.counts, 0.8);
  assert.equal(v.ok, true);
  assert.equal(v.issues[0], 'counts: expected 5 doors + 0 drawers, read 4 + 0');
  assert.ok(v.issues.includes('L3: expected 2 doors + 0 drawers, read 1 + 0'));
});

test('대조: 일자 도면을 ㄱ자로 지었으면 shape 0 이고 ok 가 아니다 — 89e14762 경우', () => {
  const raw = goodRead();
  raw.layout_shape = 'corner';
  raw.rows[0].units[2] = unit('L3', 1, 3); // 도어 1 + 서랍 3단
  raw.extra_units = [{ row: 'wall', where: 'on the side wall after the corner', doors: 2, drawers: 0 }];
  const v = compareLayoutToSpec(norm(raw), D1, 'sink');
  assert.equal(v.parts.shape, 0);
  assert.equal(v.max, 4);
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('shape: expected straight, read corner'));
  assert.ok(v.issues.indexOf('shape: expected straight, read corner') < v.issues.findIndex((s) => s.startsWith('L3:')), '모양 이슈가 모듈 이슈보다 앞');
});

test('대조: 판독이 unclear 이거나 도면 모양을 모르면 shape 항목이 없다 (max 3)', () => {
  const raw = goodRead();
  raw.layout_shape = 'unclear';
  assert.equal(compareLayoutToSpec(norm(raw), D1, 'sink').max, 3);
  const { layout, ...noShape } = D1;
  void layout;
  const v = compareLayoutToSpec(norm(goodRead(), noShape), noShape, 'sink');
  assert.equal(v.max, 3);
  assert.equal(v.ok, true);
});

test('대조: 빠진 모듈 · 판독이 빠뜨린 모듈은 세그먼트에서 빠지고 이슈가 남는다 (도면 값으로 메우지 않는다)', () => {
  const raw = goodRead();
  raw.rows[0].units = [unit('L1', 2), unit('L2', 0, 0, 'missing')]; // L3 는 말하지 않았다
  const l = norm(raw);
  assert.deepEqual(l.segments.map((s) => s.id), ['L1']);
  assert.equal(l.units[2].seen, 'unread');
  assert.ok(l.notes.includes('L3 was not reported'));
  const v = compareLayoutToSpec(l, D1, 'sink');
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('L2: missing'));
  assert.ok(v.issues.includes('L3: not read'));
});

test('대조: 냉장고 칸은 refrigerator 로 보이면 가전 순서·위치까지 맞는다', () => {
  const spec = {
    category: 'fridge',
    wallRunMm: 2400,
    sections: {
      tall: {
        fromLeftMm: 0,
        modules: [
          { widthMm: 600, kind: 'door', doorCount: 1 },
          { widthMm: 900, kind: 'appliance', label: '냉장고' },
          { widthMm: 900, kind: 'door', doorCount: 2 },
        ],
      },
    },
    appliances: [{ kind: 'fridge', fromLeftMm: 600, widthMm: 900 }],
  };
  const raw = {
    rows: [{ row: 'tall', units: [unit('T1', 1), unit('T2', 0, 0, 'refrigerator'), unit('T3', 2)] }],
    extra_units: [], layout_shape: 'straight', confidence: 0.8, notes: [],
  };
  const l = normalizePlannerRead(raw, { category: 'fridge', designSpec: spec, wallAnalysis: WA });
  assert.deepEqual(l.segments.map((s) => s.kind), ['tall', 'refrigerator', 'tall']);
  assert.equal(l.appliances.refrigerator.source, 'unit');
  assert.equal(l.appliances.refrigerator.centerPct, 43.8);
  const v = compareLayoutToSpec(l, spec, 'fridge');
  assert.equal(v.ok, true);
  assert.equal(v.parts.appliances, 1);
  assert.equal(v.parts.positions, 1);
  assert.equal('shape' in v.parts, false, '도면 모양을 모르면 항목 없음');
  // 냉장고 칸을 문짝 달린 장으로 그렸으면
  raw.rows[0].units[1] = unit('T2', 2);
  const bad = compareLayoutToSpec(normalizePlannerRead(raw, { category: 'fridge', designSpec: spec, wallAnalysis: WA }), spec, 'fridge');
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes('T2: expected refrigerator, read cabinet'));
});

test('정규화: 붙박이장은 벽 전체 한 세그먼트에 도어·서랍을 합친다', () => {
  const spec = { category: 'wardrobe', wallRunMm: 1800, sections: { tall: { modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }, { widthMm: 900, kind: 'drawer', doorCount: 1, drawerCount: 2 }] } } };
  const raw = { rows: [{ row: 'wardrobe', units: [unit('W1', 2), unit('W2', 1, 2)] }], extra_units: [], layout_shape: 'straight', confidence: 1, notes: [] };
  const l = normalizePlannerRead(raw, { category: 'wardrobe', designSpec: spec, wallAnalysis: WA });
  assert.deepEqual(l.segments.map((s) => [s.kind, s.doors, s.drawers, s.x, s.w]), [['wardrobe', 3, 2, 0, 3600]]);
  const v = compareLayoutToSpec(l, spec, 'wardrobe');
  assert.equal(v.ok, true);
  assert.equal(v.parts.counts, 1);
});

test('정규화: 깨진 입력에 던지지 않는다 — 아는 번호만, 모르는 번호는 note', () => {
  for (const raw of [null, 'x', 42, { rows: 'no' }, { rows: [{ units: [null, { id: 7 }] }] }]) {
    const l = norm(raw);
    assert.equal(l.reader, 'planner');
    assert.equal(l.units.length, 5);
    assert.equal(l.shape, 'unclear');
    assert.equal(compareLayoutToSpec(l, D1, 'sink').ok, false);
  }
  const l = norm({ rows: [{ row: 'base', units: [{ id: ' l1 ', seen: 'weird', doors: -3, drawers: 1.6 }, { id: 'Z9', seen: 'cabinet', doors: 1, drawers: 0 }] }] });
  assert.deepEqual([l.units[0].seen, l.units[0].doors, l.units[0].drawers], ['cabinet', 0, 2]);
  assert.ok(l.notes.includes('unknown unit id "Z9" ignored'));
});

test('플래너가 아니면 옛 판독 그대로 — reader 도 shape 항목도 없다', () => {
  const l = normalizeLayout(
    { segments: [{ kind: 'lower', start_pct: 0, end_pct: 61, doors: 5, drawers: 0 }], uppers: [], uppers_status: 'none', appliances: {}, confidence: {} },
    { category: 'sink', wallAnalysis: WA, now: 'T' }
  );
  assert.equal('reader' in l, false);
  const v = compareLayoutToSpec(l, D1, 'sink');
  assert.equal('reader' in v, false);
  assert.equal('shape' in v.parts, false);
  assert.equal('units' in v.read, false);
  assert.equal(v.expected.upperDoors, 4);
});

// ─── 잡: Claude 에 무엇을 싣나 ───

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'test-key',
  ANTHROPIC_API_KEY: 'k',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const BYTES = { room: 'ROOM', 'render-elevation': 'ELEV', 'render-elevation_labeled': 'LABEL', base: 'OUT' };
const b64 = (s) => Buffer.from(s).toString('base64');
let calls;
let realFetch;
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function installJob({ failRead = null } = {}) {
  calls = { claude: [], patched: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      if (failRead && u.includes(failRead)) return new Response('boom', { status: 500 });
      const name = u.split('/').pop().split('.')[0];
      return new Response(Buffer.from(BYTES[name] || 'X'), { headers: { 'Content-Type': u.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ options: {} }]);
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('api.anthropic.com')) {
      const body = JSON.parse(init.body);
      const content = body.messages[0].content;
      calls.claude.push({
        images: content.filter((c) => c.type === 'image').map((c) => Buffer.from(c.source.data, 'base64').toString()),
        types: content.map((c) => c.type),
        prompt: content[content.length - 1].text,
        planner: body.output_config.format.schema.required.includes('rows'),
      });
      const answer = calls.claude[calls.claude.length - 1].planner
        ? goodRead()
        : { segments: [{ kind: 'lower', start_pct: 0, end_pct: 61, doors: 5, drawers: 0 }], uppers: [], uppers_status: 'none', appliances: {}, confidence: {}, notes: [] };
      return jsonRes({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium', existing_furniture: 'none', site_condition: 'finished' })
          : JSON.stringify({ ok: true, issues: [], note: '' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

function fakeState() {
  const m = new Map();
  return {
    storage: {
      get: async (k) => m.get(k),
      put: async (k, v) => void m.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAll: async () => m.clear(),
      deleteAlarm: async () => {},
    },
  };
}

const RENDERS = [
  { role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' },
  { role: 'elevation_labeled', path: `${USER_ID}/${ROW_ID}/render-elevation_labeled.png`, url: 'u', mime: 'image/png' },
];

async function runJob(options, renders) {
  const job = new GenerateJob(fakeState(), ENV);
  const inputs = { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [], renders };
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options, inputs, startedAt: Date.now() }),
    })
  );
  await job.alarm();
  return calls.patched.find((p) => p.layout).layout;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PLANNER = { design_spec: D1, mode: 'planner', aspect: '16:9', variants: false };

test('잡: 플래너(Gemini 가 그림)도 판독에는 번호 입면을 쓴다 — [결과, 번호 입면, 글] + 판독 스키마', async () => {
  installJob();
  const layout = await runJob(PLANNER, RENDERS);
  assert.equal(calls.claude.length, 1);
  const c = calls.claude[0];
  assert.equal(c.planner, true);
  assert.deepEqual(c.images, ['OUT', 'LABEL']);
  assert.deepEqual(c.types, ['image', 'image', 'text']);
  assert.match(c.prompt, /labelled by its ID/);
  assert.equal(layout.reader, 'planner');
  assert.equal(layout.elevation, 'labeled');
  assert.equal(layout.verify.ok, true);
  assert.equal(layout.verify.max, 4);
});

test('잡: 번호 입면이 없거나 못 읽으면 번호 없는 입면으로 읽는다', async () => {
  installJob();
  let layout = await runJob(PLANNER, RENDERS.slice(0, 1));
  assert.deepEqual(calls.claude[0].images, ['OUT', 'ELEV']);
  assert.match(calls.claude[0].prompt, /It has no labels/);
  assert.equal(layout.elevation, 'plain');

  installJob({ failRead: 'render-elevation_labeled' });
  layout = await runJob(PLANNER, RENDERS);
  assert.deepEqual(calls.claude[0].images, ['OUT', 'ELEV']);
  assert.equal(layout.verify.ok, true);
});

test('잡: 플래너가 아니면 옛 판독 그대로 — 결과 한 장 + 옛 스키마', async () => {
  installJob();
  const layout = await runJob({ design_spec: D1, variants: false }, []);
  assert.equal(calls.claude.length, 1);
  assert.equal(calls.claude[0].planner, false);
  assert.deepEqual(calls.claude[0].types, ['image', 'text']);
  assert.match(calls.claude[0].prompt, /^You are reading an AI-rendered photo/);
  assert.equal('reader' in layout, false);
});
