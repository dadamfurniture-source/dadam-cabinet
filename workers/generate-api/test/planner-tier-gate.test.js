/**
 * POST /api/generate { mode:'planner' } — 등급 관문 (사장님 결정 2026-10-20).
 *
 * 플래너 「사진으로 만들기」는 profiles.tier 가 expert · agent 이거나 admin_roles 가 admin · super_admin 인
 * 사용자만 쓴다. 정본은 이 워커(src/tier-gate.js) — 화면(js/planner/ai-photo.js)은 같은 규칙의 사본이다.
 *
 * 고정하는 것:
 *   1) standard 는 403 planner_tier, **크레딧 차감 전** (rpc 0 · 행 0 · 업로드 0)
 *   2) expert · agent 는 통과, admin_roles 의 admin · super_admin 은 등급과 상관없이 통과
 *   3) profiles 조회가 실패하면 fail-closed (관리자도 아니면 403)
 *   4) 재생성(parent 가 planner)도 같은 관문
 *   5) 일반 경로(mode 없음)는 profiles · admin_roles 를 읽지도 않는다 — 바이트 그대로
 *
 * planner-mode-route.test.js 와 같은 방식: Supabase 는 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { plannerTierAllowed, PLANNER_MIN_TIER, TIER_RANK } from '../src/tier-gate.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_ID = '33333333-3333-4333-8333-333333333333';

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};

let calls;
let realFetch;
let warnings;
let realWarn;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * tier: profiles.tier 값 (null 이면 행 없음). profilesFail: profiles 조회가 500.
 * role: admin_roles.role (null 이면 행 없음). adminFail: admin_roles 조회가 500.
 */
function install({ tier = 'standard', profilesFail = false, role = null, adminFail = false, parent = null } = {}) {
  calls = { rpc: [], inserted: null, jobStart: null, uploads: 0, profiles: 0, admin: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/rest/v1/profiles')) {
      calls.profiles++;
      assert.ok(u.includes(`id=eq.${USER_ID}`), 'profiles 는 본인 행만');
      if (profilesFail) return new Response('boom', { status: 500 });
      return jsonRes(tier == null ? [] : [{ tier }]);
    }
    if (u.includes('/rest/v1/admin_roles')) {
      calls.admin++;
      assert.ok(u.includes(`user_id=eq.${USER_ID}`), 'admin_roles 는 본인 행만');
      if (adminFail) return new Response('boom', { status: 500 });
      return jsonRes(role == null ? [] : [{ role }]);
    }
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1];
      calls.rpc.push(fn);
      if (fn === 'consume_credit') return jsonRes([{ ref: 'credit-ref-1', balance: 80, cost: 20 }]);
      return jsonRes({});
    }
    if (u.includes('/storage/v1/object/')) {
      calls.uploads++;
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
      if (method === 'PATCH') return jsonRes([{ id: ROW_ID }]);
      if (method === 'DELETE') return new Response(null, { status: 204 });
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

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SPEC = {
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

function plannerBody(extra = {}) {
  return {
    mode: 'planner',
    room_image: PNG,
    image_type: 'image/jpeg',
    category: 'sink',
    design_spec: SPEC,
    renders: [{ role: 'elevation', base64: PNG, mime: 'image/png' }],
    ...extra,
  };
}

const PLANNER_PARENT = {
  id: PARENT_ID,
  user_id: USER_ID,
  category: 'sink',
  inputs: {
    room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' },
    refs: [],
    renders: [{ role: 'elevation', path: 'p/render-elevation.png', url: 'u2', mime: 'image/png' }],
  },
  options: { design_spec: SPEC, mode: 'planner', aspect: '16:9', variants: false },
};

beforeEach(() => {
  realFetch = globalThis.fetch;
  realWarn = console.warn;
  warnings = [];
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

function assertUntouched() {
  assert.equal(calls.rpc.length, 0, '크레딧 차감 없음');
  assert.equal(calls.inserted, null, '행 없음');
  assert.equal(calls.uploads, 0, '업로드 없음');
  assert.equal(calls.jobStart, null, '잡 없음');
}

// ─── 1. 순수 판정 ───

test('plannerTierAllowed — expert · agent · admin · super_admin 만 참, 모르는 값은 거짓', () => {
  assert.equal(PLANNER_MIN_TIER, 'expert');
  assert.deepEqual(TIER_RANK, { standard: 0, expert: 1, agent: 2 });
  assert.equal(plannerTierAllowed({ tier: 'standard' }), false);
  assert.equal(plannerTierAllowed({ tier: 'expert' }), true);
  assert.equal(plannerTierAllowed({ tier: 'agent' }), true);
  assert.equal(plannerTierAllowed({ tier: null }), false);
  assert.equal(plannerTierAllowed({ tier: 'vip' }), false);
  assert.equal(plannerTierAllowed({}), false);
  assert.equal(plannerTierAllowed({ tier: 'standard', role: 'admin' }), true);
  assert.equal(plannerTierAllowed({ tier: null, role: 'super_admin' }), true);
  assert.equal(plannerTierAllowed({ tier: 'standard', role: 'viewer' }), false);
});

// ─── 2. 경로 ───

test('standard 는 403 planner_tier — 크레딧 차감 전, 한국어 메시지', async () => {
  install({ tier: 'standard' });
  const res = await post(plannerBody());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'planner_tier');
  assert.match(body.error, /Expert 등급부터/);
  assertUntouched();
});

test('profiles 에 행이 없어도 403 (관리자가 아니면)', async () => {
  install({ tier: null });
  const res = await post(plannerBody());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'planner_tier');
  assertUntouched();
});

test('expert 는 통과 — admin_roles 는 묻지 않는다', async () => {
  install({ tier: 'expert' });
  const res = await post(plannerBody());
  assert.equal(res.status, 202);
  assert.equal(calls.profiles, 1);
  assert.equal(calls.admin, 0);
  assert.deepEqual(calls.rpc.filter((f) => f === 'consume_credit').length, 1);
  assert.equal(calls.inserted.options.mode, 'planner');
});

test('agent 는 통과', async () => {
  install({ tier: 'agent' });
  const res = await post(plannerBody());
  assert.equal(res.status, 202);
  assert.ok(calls.jobStart);
});

test('standard 라도 admin_roles 가 admin · super_admin 이면 통과', async () => {
  for (const role of ['admin', 'super_admin']) {
    install({ tier: 'standard', role });
    const res = await post(plannerBody());
    assert.equal(res.status, 202, role);
    assert.equal(calls.admin, 1, role);
  }
  install({ tier: 'standard', role: 'viewer' });
  assert.equal((await post(plannerBody())).status, 403);
});

test('profiles 조회 실패는 fail-closed — 403 + 콘솔 경고, 크레딧 무차감', async () => {
  install({ profilesFail: true });
  const res = await post(plannerBody());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'planner_tier');
  assert.ok(warnings.some((w) => /profiles/.test(w)), '경고: ' + JSON.stringify(warnings));
  assertUntouched();
});

test('profiles 조회가 실패해도 관리자면 통과, admin_roles 까지 실패하면 403', async () => {
  install({ profilesFail: true, role: 'admin' });
  assert.equal((await post(plannerBody())).status, 202);
  install({ profilesFail: true, adminFail: true });
  assert.equal((await post(plannerBody())).status, 403);
  assertUntouched();
});

test('재생성(parent 가 planner)도 같은 관문 — standard 403, expert 202', async () => {
  install({ tier: 'standard', parent: PLANNER_PARENT });
  const res = await post({ parent_id: PARENT_ID });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'planner_tier');
  assertUntouched();

  install({ tier: 'expert', parent: PLANNER_PARENT });
  assert.equal((await post({ parent_id: PARENT_ID })).status, 202);
  assert.equal(calls.inserted.parent_id, PARENT_ID);
});

test('일반 경로(mode 없음)는 standard 도 그대로 202 — profiles · admin_roles 를 읽지 않는다', async () => {
  install({ tier: 'standard' });
  const res = await post({ room_image: PNG, category: 'sink' });
  assert.equal(res.status, 202);
  assert.equal(calls.profiles, 0);
  assert.equal(calls.admin, 0);
  assert.equal('mode' in calls.inserted.options, false);
});

test('관문은 플래너 진입 직후 — design_spec 이 없어도 standard 는 400 이 아니라 403', async () => {
  install({ tier: 'standard' });
  const res = await post(plannerBody({ design_spec: undefined }));
  assert.equal(res.status, 403);
  assert.equal(calls.profiles, 1);
  install({ tier: 'expert' });
  assert.equal((await post(plannerBody({ design_spec: undefined }))).status, 400);
});
