/**
 * POST /api/generate { mode:'planner' } — 접수 계약 (계획서 docs/01-plan/planner-render-realize.plan.md §6.1).
 *
 * 고정하는 것:
 *   1) design_spec 이 없거나 elevation 렌더가 없으면 400 — **크레딧 차감 전에**
 *   2) 렌더는 버킷에 render-{role}.{ext} 로 올라가고 inputs.renders[] = {role, path, url, mime}
 *   3) options.mode='planner', options.aspect (허용값 밖이면 16:9), variants 는 항상 false
 *   4) realize · engine · control_* · reference_images 는 받지 않는다
 *   5) mode 가 없으면 options·inputs 는 옛 모양 그대로
 *
 * generate-design-spec-route.test.js 와 같은 방식: Supabase 는 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다.
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

/** failUpload: 이 문자열이 든 경로의 업로드는 500 */
function install({ parent = null, failUpload = null } = {}) {
  calls = { rpc: [], inserted: null, patched: [], jobStart: null, uploads: [], deleted: 0 };
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
      if (failUpload && u.includes(failUpload)) return new Response('boom', { status: 500 });
      calls.uploads.push({ url: u, type: init.headers && init.headers['Content-Type'] });
      return jsonRes({ Key: 'ok' });
    }
    if (u.includes('/rest/v1/generations')) {
      const method = init.method || 'GET';
      if (method === 'GET') {
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
      if (method === 'DELETE') {
        calls.deleted++;
        return new Response(null, { status: 204 });
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

/** 1x1 투명 PNG */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function spec() {
  return {
    category: 'sink',
    wallRunMm: 2200,
    sections: {
      lower: {
        widthMm: 2200, heightMm: 870, fromLeftMm: 0,
        modules: [
          { widthMm: 800, kind: 'door', doorCount: 2 },
          { widthMm: 400, kind: 'door', doorCount: 1 },
          { widthMm: 1000, kind: 'door', doorCount: 2 },
        ],
      },
    },
    appliances: [{ kind: 'sink', fromLeftMm: 1350, widthMm: 700 }],
  };
}

function plannerBody(extra = {}) {
  return {
    mode: 'planner',
    room_image: PNG,
    image_type: 'image/jpeg',
    category: 'sink',
    design_spec: spec(),
    renders: [
      { role: 'elevation', base64: PNG, mime: 'image/png' },
      { role: 'massing', base64: PNG, mimeType: 'image/jpeg' },
    ],
    ...extra,
  };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── 1. 검증은 크레딧 전에 ───

test('planner 인데 design_spec 이 없으면 400 이고 크레딧·행·잡을 건드리지 않는다', async () => {
  install();
  const res = await post(plannerBody({ design_spec: undefined }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'bad_design_spec');
  assert.match(body.error, /design_spec is required/);
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.inserted, null);
  assert.equal(calls.jobStart, null);
  assert.equal(calls.uploads.length, 0);
});

test('planner 의 망가진 design_spec 도 400 bad_design_spec, 크레딧 무차감', async () => {
  install();
  const res = await post(plannerBody({ design_spec: { category: 'wardrobe', wallRunMm: 3000 } }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'bad_design_spec');
  assert.equal(calls.rpc.length, 0);
});

test('elevation 렌더가 없으면 400 — massing 만 있어도, 모르는 role 만 있어도', async () => {
  for (const renders of [
    undefined,
    [],
    [{ role: 'massing', base64: PNG, mime: 'image/jpeg' }],
    [{ role: 'plan', base64: PNG }],
    [{ role: 'elevation', base64: '' }],
  ]) {
    install();
    const res = await post(plannerBody({ renders }));
    assert.equal(res.status, 400, JSON.stringify(renders));
    const body = await res.json();
    assert.equal(body.code, 'missing_render');
    assert.equal(calls.rpc.length, 0);
    assert.equal(calls.inserted, null);
  }
});

// ─── 2. 렌더 업로드 ───

test('렌더는 render-{role}.{ext} 로 올라가고 inputs.renders 에 남는다 — 잡에도 같은 값', async () => {
  install();
  const res = await post(plannerBody());
  assert.equal(res.status, 202);
  const paths = calls.uploads.map((x) => x.url.split('/generations/')[1]);
  assert.deepEqual(paths, [
    `${USER_ID}/${ROW_ID}/room.jpg`,
    `${USER_ID}/${ROW_ID}/render-elevation.png`,
    `${USER_ID}/${ROW_ID}/render-massing.jpg`,
  ]);
  const inputs = calls.patched.find((p) => p.inputs).inputs;
  assert.deepEqual(inputs.renders, [
    {
      role: 'elevation',
      path: `${USER_ID}/${ROW_ID}/render-elevation.png`,
      url: `https://example.supabase.co/storage/v1/object/public/generations/${USER_ID}/${ROW_ID}/render-elevation.png`,
      mime: 'image/png',
    },
    {
      role: 'massing',
      path: `${USER_ID}/${ROW_ID}/render-massing.jpg`,
      url: `https://example.supabase.co/storage/v1/object/public/generations/${USER_ID}/${ROW_ID}/render-massing.jpg`,
      mime: 'image/jpeg',
    },
  ]);
  assert.deepEqual(inputs.refs, []);
  assert.deepEqual(calls.jobStart.inputs, inputs);
});

test('역할마다 한 장·최대 2장, 모르는 role 은 버리고 순서는 elevation → massing', async () => {
  install();
  await post(
    plannerBody({
      renders: [
        { role: 'massing', base64: PNG, mime: 'image/jpeg' },
        { role: 'top', base64: PNG },
        { role: 'elevation', base64: PNG },
        { role: 'elevation', base64: PNG, mime: 'image/webp' },
      ],
    })
  );
  const inputs = calls.jobStart.inputs;
  assert.deepEqual(inputs.renders.map((r) => [r.role, r.mime]), [
    ['elevation', 'image/png'],
    ['massing', 'image/jpeg'],
  ]);
});

test('massing 없이 elevation 만 와도 된다', async () => {
  install();
  const res = await post(plannerBody({ renders: [{ role: 'elevation', base64: PNG, mime: 'image/png' }] }));
  assert.equal(res.status, 202);
  assert.deepEqual(calls.jobStart.inputs.renders.map((r) => r.role), ['elevation']);
});

test('elevation 업로드가 실패하면 차감을 되돌리고 행을 지운다', async () => {
  install({ failUpload: 'render-elevation' });
  const res = await post(plannerBody());
  assert.equal(res.status, 500);
  assert.ok(calls.rpc.some((c) => c.fn === 'refund_credit'), 'refund_credit');
  assert.equal(calls.deleted, 1);
  assert.equal(calls.jobStart, null);
});

test('massing 업로드가 실패해도 잡은 간다 (입면만으로 그린다)', async () => {
  install({ failUpload: 'render-massing' });
  const res = await post(plannerBody());
  assert.equal(res.status, 202);
  assert.deepEqual(calls.jobStart.inputs.renders.map((r) => r.role), ['elevation']);
});

// ─── 3. options ───

test('options.mode·aspect, variants 는 항상 false, 크레딧은 generate 하나', async () => {
  install();
  await post(plannerBody({ variants: true }));
  const o = calls.inserted.options;
  assert.equal(o.mode, 'planner');
  assert.equal(o.aspect, '16:9');
  assert.equal(o.variants, false);
  assert.equal(o.design_spec.wallRunMm, 2200);
  assert.deepEqual(calls.jobStart.options, o);
  const consumes = calls.rpc.filter((c) => c.fn === 'consume_credit');
  assert.equal(consumes.length, 1);
  assert.deepEqual(consumes[0].body, { p_reason: 'generate' });
});

test('aspect 는 허용값만 받고 나머지는 16:9', async () => {
  for (const [given, want] of [['4:3', '4:3'], ['9:16', '9:16'], ['1:1', '1:1'], ['21:9', '16:9'], [169, '16:9']]) {
    install();
    await post(plannerBody({ aspect: given }));
    assert.equal(calls.inserted.options.aspect, want, String(given));
  }
});

test('realize · engine · control_* · reference_images 는 받지 않는다', async () => {
  install();
  const res = await post(
    plannerBody({
      realize: true,
      engine: 'controlnet',
      control_image: PNG,
      control_type: 'image/png',
      control_size: { width: 1600, height: 900 },
      reference_images: [{ base64: PNG, mimeType: 'image/png' }],
    })
  );
  assert.equal(res.status, 202); // controlnet 인데 control 이 있어도/없어도 상관없이 planner 로 간다
  const o = calls.inserted.options;
  for (const k of ['realize', 'engine', 'control_size']) assert.equal(k in o, false, k);
  assert.ok(!calls.uploads.some((x) => /\/(control|ref-\d+)\./.test(x.url)), 'control·ref 업로드 없음');
  const inputs = calls.jobStart.inputs;
  assert.equal('control' in inputs, false);
  assert.deepEqual(inputs.refs, []);
});

test('mode 가 없으면 options·inputs 는 옛 모양 그대로 — renders 를 보내도 무시', async () => {
  install();
  const res = await post({
    room_image: PNG,
    category: 'wardrobe',
    door_color: 'oak',
    renders: [{ role: 'elevation', base64: PNG }],
    aspect: '4:3',
  });
  assert.equal(res.status, 202);
  assert.deepEqual(calls.inserted.options, {
    design_style: 'modern-minimal',
    door_color: 'oak',
    door_finish: 'matte',
    wall_width_override: null,
    fridge_options: null,
    design_spec: null,
  });
  assert.deepEqual(Object.keys(calls.jobStart.inputs), ['room', 'refs']);
  assert.ok(!calls.uploads.some((x) => /render-/.test(x.url)));
});

test('mode 가 planner 가 아닌 다른 값이면 옛 경로다 (design_spec 없어도 202)', async () => {
  install();
  const res = await post({ mode: 'studio', room_image: PNG, category: 'sink' });
  assert.equal(res.status, 202);
  assert.equal('mode' in calls.inserted.options, false);
});

// ─── 4. 재생성 ───

test('재생성은 원본의 planner 모드·요약·렌더·비율을 잇는다 (업로드 없음)', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: {
      room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' },
      refs: [],
      renders: [{ role: 'elevation', path: 'p/render-elevation.png', url: 'u2', mime: 'image/png' }],
    },
    options: { design_spec: { version: 1, category: 'sink', wallRunMm: 2200 }, mode: 'planner', aspect: '4:3', variants: false },
  };
  install({ parent });
  const res = await post({ parent_id: parent.id });
  assert.equal(res.status, 202);
  const o = calls.inserted.options;
  assert.equal(o.mode, 'planner');
  assert.equal(o.aspect, '4:3');
  assert.equal(o.variants, false);
  assert.equal(o.design_spec.wallRunMm, 2200);
  assert.equal(calls.uploads.length, 0);
  assert.deepEqual(calls.jobStart.inputs, parent.inputs);
});

test('재생성 원본에 입면 렌더가 없으면 planner 로 다시 그릴 수 없다 (400)', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: { room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' }, refs: [] },
    options: { design_spec: { version: 1, category: 'sink', wallRunMm: 2200 } },
  };
  install({ parent });
  const res = await post({ parent_id: parent.id, mode: 'planner' });
  assert.equal(res.status, 400);
  assert.equal(calls.rpc.length, 0);
});
