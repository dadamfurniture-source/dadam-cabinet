/**
 * 내부 확인용 (options.internal_only) — 계획서 docs/01-plan/planner-render-realize.plan.md §6.3 · §11-⑦.
 *
 * 고정하는 것:
 *   1) 잡: planner + 대조 ok → 키 없음 / 불일치 → true / 대조 실패(throw) → true / 플래너가 아니면 마무리 패치 그대로
 *      true 는 done 과 같은 PATCH 에 실리고, 지금 행의 options 에 더해진다(덮어쓰지 않는다). 환불 없음
 *   2) 공유 발급: internal_only 면 409 internal_only, 토큰을 만들지 않고 행도 건드리지 않는다
 *   3) 공유 열람: 이미 나간 링크라도 internal_only 면 410
 *
 * planner-mode-job.test.js 와 같은 방식: Supabase·Gemini·Anthropic 은 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateJob } from '../src/job.js';
import worker from '../src/worker.js';
import { checkShareAccessible, isInternalOnly } from '../src/share.js';

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
  SHARE_TOKEN_PEPPER: 'pepper',
};

const b64 = (s) => Buffer.from(s).toString('base64');

let calls;
let realFetch;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 싱크대 하부장 세 칸, 도어 5짝 — 벽 3600 중 2200 */
const SPEC = {
  version: 1,
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
};

/** Claude 가 읽어 낸 구성 — doors 로 맞음/어긋남을 고른다 */
function claudeLayout(doors) {
  return {
    segments: [
      { kind: 'lower', start_pct: 0, end_pct: 61, doors, drawers: 0 },
      { kind: 'open', start_pct: 61, end_pct: 100, doors: 0, drawers: 0 },
    ],
    uppers_status: 'none',
    uppers: [],
    appliances: {},
    confidence: { segments: 0.9, uppers: 0.9, appliances: 0.9 },
  };
}

/**
 * claude: null → Anthropic 호출 없음(키도 안 줌) / { doors } → 그 구성으로 답 / 'throw' → 500
 * rowOptions: 지금 행의 options (잡이 받은 것과 다르게 줘서 "읽어서 더한다" 를 확인)
 */
function installJob({ claude = null, rowOptions = null } = {}) {
  calls = { image: 0, patched: [], reads: 0, claude: 0, refunds: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      return new Response(Buffer.from('IMG'), { headers: { 'Content-Type': u.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/rpc/refund_credit_svc')) {
      calls.refunds++;
      return jsonRes({});
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') {
        calls.reads++;
        return jsonRes([{ options: rowOptions }]);
      }
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('api.anthropic.com')) {
      calls.claude++;
      if (claude === 'throw') return jsonRes({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 400);
      return jsonRes({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(claudeLayout(claude.doors)) }],
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
      calls.image++;
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

const INPUTS = {
  room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
  refs: [],
  renders: [{ role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' }],
};
const PLANNER_OPTIONS = { design_spec: SPEC, mode: 'planner', aspect: '16:9', variants: false };

async function runJob(options, { withKey = true } = {}) {
  const job = new GenerateJob(fakeState(), { ...ENV, ...(withKey ? { ANTHROPIC_API_KEY: 'k' } : {}) });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options, inputs: INPUTS, startedAt: Date.now() }),
    })
  );
  await job.alarm();
  const done = calls.patched.filter((p) => p.status === 'done');
  assert.equal(done.length, 1, 'done 패치는 한 번');
  return done[0];
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── 잡 ───

test('잡: planner + 대조 ok → internal_only 를 넣지 않는다 (options 를 건드리지도 않는다)', async () => {
  installJob({ claude: { doors: 5 }, rowOptions: { ...PLANNER_OPTIONS } });
  const done = await runJob(PLANNER_OPTIONS);
  const verify = calls.patched.find((p) => p.layout).layout.verify;
  assert.equal(verify.ok, true, `대조가 맞아야 한다: ${JSON.stringify(verify.issues)}`);
  assert.equal('options' in done, false);
  assert.ok(calls.patched.every((p) => !('options' in p)), '어떤 패치도 options 를 쓰지 않는다');
  assert.equal(calls.reads, 0, 'ok 면 행을 읽을 일도 없다');
});

test('잡: planner + 대조 불일치 → done 과 같은 패치에 internal_only:true, 지금 행 options 에 더한다', async () => {
  // 행에는 잡이 받은 것에 없는 키가 있다 — 덮어쓰면 사라진다
  const rowOptions = { ...PLANNER_OPTIONS, design_style: 'modern', extra_from_row: 1 };
  installJob({ claude: { doors: 2 }, rowOptions });
  const done = await runJob(PLANNER_OPTIONS);
  assert.equal(calls.patched.find((p) => p.layout).layout.verify.ok, false);
  assert.deepEqual(done.options, { ...rowOptions, internal_only: true });
  assert.equal(done.progress, 100);
  assert.equal(calls.refunds, 0, '크레딧은 환불하지 않는다');
});

test('잡: planner + 대조 실패(Claude 오류) → internal_only:true', async () => {
  installJob({ claude: 'throw', rowOptions: { ...PLANNER_OPTIONS } });
  const done = await runJob(PLANNER_OPTIONS);
  const verify = calls.patched.find((p) => p.layout).layout.verify;
  assert.equal(verify.ok, null);
  assert.ok(verify.error);
  assert.equal(done.options.internal_only, true);
  assert.equal(calls.refunds, 0);
});

test('잡: planner + 키 없음(대조를 못 돌림) → internal_only:true · 행을 못 읽으면 잡 options 에 더한다', async () => {
  installJob({ claude: null, rowOptions: null });
  const done = await runJob(PLANNER_OPTIONS, { withKey: false });
  assert.equal(calls.claude, 0);
  assert.deepEqual(done.options, { ...PLANNER_OPTIONS, internal_only: true });
});

test('잡: 플래너가 아니면 대조가 어긋나도 options 를 쓰지 않는다 — 마무리 패치 키 그대로', async () => {
  installJob({ claude: { doors: 2 }, rowOptions: { design_spec: SPEC, variants: false } });
  const done = await runJob({ design_spec: SPEC, variants: false });
  assert.equal(calls.patched.find((p) => p.layout).layout.verify.ok, false);
  assert.deepEqual(Object.keys(done), [
    'status', 'progress', 'step_label', 'error', 'images', 'quote', 'model', 'elapsed_ms', 'completed_at',
  ]);
  assert.equal(calls.reads, 0);
});

// ─── 공유 ───

function installRoute(row) {
  calls = { patched: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes(row ? [row] : []);
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

const future = () => new Date(Date.now() + 86400000).toISOString();
const DONE_ROW = { id: ROW_ID, user_id: USER_ID, status: 'done', category: 'sink', images: [], options: { mode: 'planner' } };

function shareReq() {
  return new Request(`https://api.test/api/generate/${ROW_ID}/share`, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: '{}',
  });
}

test('공유 발급: internal_only 면 409 internal_only — 토큰을 만들지 않고 행을 건드리지 않는다', async () => {
  installRoute({ ...DONE_ROW, options: { mode: 'planner', internal_only: true } });
  const res = await worker.fetch(shareReq(), { ...ENV });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.deepEqual(body, {
    success: false,
    error: 'internal_only',
    code: 'internal_only',
    message: '도면과 다른 결과는 공유할 수 없습니다',
  });
  assert.equal(calls.patched.length, 0, 'share_token_hash 를 쓰지 않는다');
});

test('공유 발급: ok 인 플래너 결과(키 없음)는 그대로 발급된다', async () => {
  installRoute(DONE_ROW);
  const res = await worker.fetch(shareReq(), { ...ENV });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.share_url, /design-share\.html#t=/);
  assert.equal(calls.patched.length, 1);
  assert.ok(calls.patched[0].share_token_hash);
});

test('공유 열람: 이미 나간 링크라도 internal_only 면 410 internal_only', async () => {
  installRoute({ ...DONE_ROW, share_expires_at: future(), options: { mode: 'planner', internal_only: true } });
  const res = await worker.fetch(
    new Request('https://api.test/api/share', { headers: { 'X-Share-Token': 'tok' } }),
    { ...ENV }
  );
  assert.equal(res.status, 410);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'internal_only');
  assert.equal(body.generation, undefined);
});

test('checkShareAccessible / isInternalOnly — true 일 때만', () => {
  const ok = { status: 'done', share_expires_at: future() };
  assert.equal(checkShareAccessible(ok).ok, true);
  assert.equal(checkShareAccessible({ ...ok, options: { internal_only: false } }).ok, true);
  assert.equal(checkShareAccessible({ ...ok, options: { internal_only: 'true' } }).ok, true, '문자열은 표시가 아니다');
  assert.deepEqual(checkShareAccessible({ ...ok, options: { internal_only: true } }), {
    ok: false, reason: 'internal_only', status: 410,
  });
  assert.equal(isInternalOnly(null), false);
  assert.equal(isInternalOnly({ options: null }), false);
});
