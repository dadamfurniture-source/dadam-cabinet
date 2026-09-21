/**
 * POST /api/generate 에서 design_spec 이 실제로 generations 행까지 가는지.
 *
 * 고정하는 것:
 *   1) options.design_spec 에 정규화된 모양으로 들어가고, 잡(DO)에도 같은 값이 간다
 *   2) 없으면 null — 나머지 options 는 그대로다 (독립형 ai-design.html 경로 불변)
 *   3) 요약이 틀리면 400 bad_design_spec 이고, **크레딧은 차감되지 않는다**
 *   4) 크레딧 action 은 여전히 'generate' 하나다 (새 credit_costs 행을 만들지 않는다)
 *   5) 재생성(parent_id)은 원본의 요약을 이어받고, 품목을 바꾸면 조용히 버린다
 *
 * Supabase·Gemini 는 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};

let calls;
let realFetch;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** parent 행을 주면 그 행을 selectOne 이 돌려준다. */
function install({ parent = null } = {}) {
  calls = { rpc: [], inserted: null, patched: [], jobStart: null, uploads: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1];
      calls.rpc.push({ fn, body: init.body ? JSON.parse(init.body) : null });
      if (fn === 'consume_credit') return jsonRes([{ ref: 'credit-ref-1', balance: 80, cost: 20 }]);
      return jsonRes({});
    }
    if (u.includes('/storage/v1/object/')) {
      calls.uploads.push(u);
      return jsonRes({ Key: 'ok' });
    }
    if (u.includes('/rest/v1/generations')) {
      const method = init.method || 'GET';
      if (method === 'GET') {
        // 실행 중 잡 조회 → 없음 / 원본 조회 → parent
        if (parent && u.includes(`id=eq.${parent.id}`)) return jsonRes([parent]);
        return jsonRes([]);
      }
      if (method === 'POST') {
        calls.inserted = JSON.parse(init.body);
        return jsonRes([{ id: ROW_ID, ...calls.inserted }]);
      }
      if (method === 'PATCH') {
        calls.patched.push(JSON.parse(init.body));
        return jsonRes([{ id: ROW_ID }]);
      }
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

const env = () => ({
  ...ENV,
  GENERATE_JOB: {
    idFromName: (n) => ({ name: n }),
    get: () => ({
      fetch: async (_url, init) => {
        calls.jobStart = JSON.parse(init.body);
        return new Response('{"ok":true}', { status: 202 });
      },
    }),
  },
});

function post(body) {
  return worker.fetch(
    new Request('https://generate.example/api/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env()
  );
}

/** 1x1 투명 PNG. 업로드는 stub 이지만 base64 디코딩은 진짜로 돈다. */
const ROOM_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function goodSpec() {
  return {
    category: 'sink',
    wallRunMm: 3600,
    sections: {
      lower: {
        widthMm: 3600,
        heightMm: 870,
        depthMm: 600,
        fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'drawer', drawerCount: 3 },
          { widthMm: 600, kind: 'door', doorCount: 1 },
        ],
      },
    },
    appliances: [{ kind: 'sink', fromLeftMm: 900, widthMm: 700 }],
    finishes: { door: { nameEn: 'matte white PET laminate', vendorCode: 'SM-01' } },
  };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('design_spec 이 options 에 정규화되어 들어가고 잡에도 같은 값이 간다', async () => {
  install();
  const res = await post({
    room_image: ROOM_IMAGE,
    image_type: 'image/png',
    category: 'sink',
    design_spec: goodSpec(),
  });
  assert.equal(res.status, 202);

  const spec = calls.inserted.options.design_spec;
  assert.equal(spec.version, 1);
  assert.equal(spec.category, 'sink');
  assert.equal(spec.wallRunMm, 3600);
  assert.equal(spec.sections.lower.modules.length, 2);
  assert.deepEqual(spec.appliances, [{ kind: 'sink', fromLeftMm: 900, widthMm: 700 }]);
  assert.equal(spec.finishes.door.vendorCode, 'SM-01');
  // DO 로 넘어가는 options 도 같은 값이다 (잡이 프롬프트를 만든다)
  assert.deepEqual(calls.jobStart.options.design_spec, spec);
});

test('design_spec 이 없으면 null 이고 나머지 options 는 예전 그대로다', async () => {
  install();
  const res = await post({ room_image: ROOM_IMAGE, category: 'wardrobe', door_color: 'oak' });
  assert.equal(res.status, 202);
  assert.deepEqual(calls.inserted.options, {
    design_style: 'modern-minimal',
    door_color: 'oak',
    door_finish: 'matte',
    wall_width_override: null,
    fridge_options: null,
    design_spec: null,
  });
});

test('크레딧은 그대로 generate 하나 — 요약이 있어도 새 action 을 쓰지 않는다', async () => {
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink', design_spec: goodSpec() });
  const consumes = calls.rpc.filter((c) => c.fn === 'consume_credit');
  assert.equal(consumes.length, 1);
  assert.deepEqual(consumes[0].body, { p_reason: 'generate' });
  assert.equal(calls.inserted.credit_cost, 20);
});

test('망가진 요약은 400 bad_design_spec, 크레딧은 손대지 않는다', async () => {
  install();
  const res = await post({
    room_image: ROOM_IMAGE,
    category: 'sink',
    design_spec: { category: 'wardrobe', wallRunMm: 3000 },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'bad_design_spec');
  assert.match(body.error, /does not match category \(sink\)/);
  assert.equal(calls.rpc.length, 0); // consume_credit 도 refund_credit 도 부르지 않았다
  assert.equal(calls.inserted, null);
});

test('숫자가 유한하지 않아도 400 이고 잡은 만들어지지 않는다', async () => {
  install();
  const spec = goodSpec();
  spec.sections.lower.modules[0].widthMm = 'wide';
  const res = await post({ room_image: ROOM_IMAGE, category: 'sink', design_spec: spec });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'bad_design_spec');
  assert.equal(calls.jobStart, null);
});

test('재생성은 원본의 요약을 이어받는다', async () => {
  const parentSpec = {
    version: 1,
    category: 'sink',
    wallRunMm: 3600,
    appliances: [{ kind: 'sink' }],
  };
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: { room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' }, refs: [] },
    options: { design_spec: parentSpec },
  };
  install({ parent });
  const res = await post({ parent_id: parent.id });
  assert.equal(res.status, 202);
  assert.equal(calls.inserted.options.design_spec.wallRunMm, 3600);
  assert.equal(calls.uploads.length, 0); // 업로드 없이 원본 입력을 다시 쓴다
});

test('재생성에서 품목을 바꾸면 원본 요약을 조용히 버린다 (400 이 아니다)', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: { room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' }, refs: [] },
    options: { design_spec: { version: 1, category: 'sink', wallRunMm: 3600 } },
  };
  install({ parent });
  const res = await post({ parent_id: parent.id, category: 'wardrobe' });
  assert.equal(res.status, 202);
  assert.equal(calls.inserted.options.design_spec, null);
});

// ─────────────────────────────────────────────────────────────
// 2026-09-19 실사화(realize): 첫 사진에 도면 입면이 이미 얹혀 있음. options.realize 로 잡에 간다.
// ─────────────────────────────────────────────────────────────
test('realize:true 면 options.realize 가 true 이고 잡에도 같이 간다', async () => {
  install();
  const res = await post({ room_image: ROOM_IMAGE, category: 'sink', realize: true });
  assert.equal(res.status, 202);
  assert.equal(calls.inserted.options.realize, true);
  assert.equal(calls.jobStart.options.realize, true);
});

test('realize 를 안 보내면 options 에 키 자체가 없다 (옛 모양 그대로)', async () => {
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink' });
  assert.equal('realize' in calls.inserted.options, false);
});

test('재생성은 원본의 realize 를 잇고, 요청이 false 를 주면 끈다', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: { room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' }, refs: [] },
    options: { design_spec: null, realize: true },
  };
  install({ parent });
  await post({ parent_id: parent.id });
  assert.equal(calls.inserted.options.realize, true);
  install({ parent });
  await post({ parent_id: parent.id, realize: false });
  assert.equal('realize' in calls.inserted.options, false);
});

// 2026-09-22 추천안 끄기 — 디테일 실사화는 한 장만
test('variants:false 면 options.variants 가 false 이고, 없으면 키 자체가 없다', async () => {
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink', variants: false });
  assert.equal(calls.inserted.options.variants, false);
  assert.equal(calls.jobStart.options.variants, false);
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink' });
  assert.equal('variants' in calls.inserted.options, false);
  // true 를 보내도 키는 안 생긴다 — 기본이 켜짐이다
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink', variants: true });
  assert.equal('variants' in calls.inserted.options, false);
});

test('재생성은 원본의 variants:false 를 잇는다', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: { room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' }, refs: [] },
    options: { design_spec: null, variants: false },
  };
  install({ parent });
  await post({ parent_id: parent.id });
  assert.equal(calls.inserted.options.variants, false);
});

// 2026-09-22 ControlNet 경로 — 구조 조건 이미지가 inputs.control 로 올라가고 options.engine 이 붙는다
test('engine:controlnet + control_image → control 업로드, options.engine·control_size', async () => {
  install();
  const res = await post({ room_image: ROOM_IMAGE, category: 'sink', realize: true, engine: 'controlnet', control_image: ROOM_IMAGE, control_type: 'image/png', control_size: { width: 1600, height: 1200 } });
  assert.equal(res.status, 202);
  assert.equal(calls.inserted.options.engine, 'controlnet');
  assert.deepEqual(calls.inserted.options.control_size, { width: 1600, height: 1200 });
  assert.ok(calls.uploads.some((u) => /\/control\.png$/.test(String(u))), 'control.png 이 올라간다');
  assert.equal(calls.jobStart.options.engine, 'controlnet');
});

test('engine:controlnet 인데 control_image 가 없으면 400 이고 크레딧을 안 건드린다', async () => {
  install();
  const res = await post({ room_image: ROOM_IMAGE, category: 'sink', engine: 'controlnet' });
  assert.equal(res.status, 400);
  assert.equal(calls.inserted, null);
  assert.equal(calls.rpc.filter((c) => c.fn === 'consume_credit').length, 0);
});

test('engine 을 안 보내면 options 에 engine 키가 없다 (Gemini 경로 그대로)', async () => {
  install();
  await post({ room_image: ROOM_IMAGE, category: 'sink' });
  assert.equal('engine' in calls.inserted.options, false);
  assert.equal('control' in (calls.inserted.inputs || {}), false);
});
