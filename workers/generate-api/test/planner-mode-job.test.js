/**
 * GenerateJob 파이프라인 — 플래너 모드(mode:'planner') 한 바퀴 (계획서 §6.2).
 *
 * 고정하는 것:
 *   1) 설치는 [방 사진, 입면, 3/4?] 순서 + buildPlannerPrompt + 온도 0.2 + aspectRatio
 *   2) 검사(QC)가 걸려도 재시도하지 않는다 — images[base].qc 에 기록만
 *   3) 추천안·mockup 슬롯 없음, 결과는 base 한 장
 *   4) 역판독 대조 단계는 그대로 돈다 (여기선 Claude 키가 없어 verify.error 로 남는다)
 *   5) 플래너가 아니면 옛 경로 그대로 — [방 사진] 한 장, 온도 기본, 비율 없음, QC 에 걸리면 재시도 1회
 *
 * Supabase·Gemini 는 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다. DO storage 는 Map 으로.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateJob } from '../src/job.js';

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};

/** 경로마다 다른 바이트 — 설치 호출에 어떤 순서로 실렸는지 알아볼 수 있게 */
const BYTES = { room: 'ROOM', 'render-elevation': 'ELEV', 'render-massing': 'MASS' };
const b64 = (s) => Buffer.from(s).toString('base64');

let calls;
let realFetch;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function install({ qcIssues = ['existing_left'], openai = null } = {}) {
  calls = { image: [], text: [], patched: [], uploads: [], openai: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.openai.com/')) {
      // GPT 편집 호출 (2026-10-18) — multipart 그대로 읽는다: 이미지 순서·크기·온도가 없는지
      const f = init.body;
      calls.openai.push({
        url: u,
        keys: [...new Set([...f.keys()])],
        model: f.get('model'),
        size: f.get('size'),
        prompt: f.get('prompt'),
        images: await Promise.all(f.getAll('image[]').map(async (b) => Buffer.from(await b.arrayBuffer()).toString())),
        types: f.getAll('image[]').map((b) => b.type),
      });
      return openai ? openai(calls.openai.length) : jsonRes({ data: [{ b64_json: b64('GPT') }], usage: { input_tokens: 9000, output_tokens: 6000 } });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') {
        calls.uploads.push(u.split('/generations/')[1]);
        return jsonRes({ Key: 'ok' });
      }
      const name = u.split('/').pop().split('.')[0];
      const mime = u.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return new Response(Buffer.from(BYTES[name] || 'X'), { headers: { 'Content-Type': mime } });
    }
    if (u.includes('/rest/v1/generations')) {
      // 내부 확인용 표시(§6.3)가 지금 행의 options 를 읽는다
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: PLANNER_OPTIONS }]);
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        calls.text.push(prompt);
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({
              wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium',
              existing_furniture: 'dark glossy kitchen cabinets', site_condition: 'finished',
            })
          : JSON.stringify({ ok: qcIssues.length === 0, issues: qcIssues, note: 'n' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      calls.image.push({ body, prompt, images: parts.filter((p) => p.inlineData).map((p) => p.inlineData) });
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

async function run(options, inputs, envExtra = {}) {
  const job = new GenerateJob(fakeState(), { ...ENV, ...envExtra });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options, inputs, startedAt: Date.now() }),
    })
  );
  await job.alarm();
  return calls.patched[calls.patched.length - 1];
}

const PLANNER_INPUTS = {
  room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
  refs: [],
  renders: [
    { role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' },
    { role: 'massing', path: `${USER_ID}/${ROW_ID}/render-massing.jpg`, url: 'u', mime: 'image/jpeg' },
  ],
};
const PLANNER_OPTIONS = { design_spec: SPEC, mode: 'planner', aspect: '16:9', variants: false };

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('planner: [방, 입면, 3/4] + 프롬프트 v2 + 온도 0.2 + 16:9, QC 에 걸려도 재시도 없이 기록만', async () => {
  install({ qcIssues: ['existing_left'] });
  const last = await run(PLANNER_OPTIONS, PLANNER_INPUTS);

  assert.equal(calls.image.length, 1, '설치 한 번 — 재시도 없음, 추천안 없음');
  const call = calls.image[0];
  assert.deepEqual(call.images.map((i) => Buffer.from(i.data, 'base64').toString()), ['ROOM', 'ELEV', 'MASS']);
  assert.deepEqual(call.images.map((i) => i.mimeType), ['image/jpeg', 'image/png', 'image/jpeg']);
  assert.equal(call.body.generationConfig.temperature, 0.2);
  assert.deepEqual(call.body.generationConfig.imageConfig, { imageSize: '2K', aspectRatio: '16:9' });
  assert.match(call.prompt, /^You receive three images\./);
  assert.match(call.prompt, /COUNT CHECK: exactly 3 base units with 5 doors/);
  // 분석 결과(벽 3600·기존 가구)가 남는 벽 문장으로 들어간다
  assert.ok(call.prompt.includes('the cabinets end at 61 % of the wall. Remove all existing furniture on the rest of the wall (dark glossy kitchen cabinets)'));

  // 검사 프롬프트에 플래너 코드가 실렸고, 결과는 기록만
  const qcPrompt = calls.text.find((t) => t.startsWith('You are checking'));
  assert.match(qcPrompt, /- existing_left:/);
  assert.match(qcPrompt, /- pasted_reference:/);

  assert.equal(last.status, 'done');
  assert.deepEqual(last.images.map((i) => i.slot), ['base']);
  assert.deepEqual(last.images[0].qc, { ok: false, issues: ['existing_left'], note: 'n' });
  // 역판독 단계는 돈다 (키가 없어 error 로 남는다 — 잡은 깨지지 않는다)
  const verifyPatch = calls.patched.find((p) => p.layout);
  assert.ok(verifyPatch, '대조 결과를 남긴다');
  assert.match(verifyPatch.layout.verify.error, /ANTHROPIC_API_KEY/);
  // 대조가 ok 가 아니니 내부 확인용 (internal-only.test.js 가 자세히 본다)
  assert.equal(last.options.internal_only, true);
  assert.equal(calls.uploads.filter((p) => /\/base\./.test(p)).length, 1);
});

test('planner: 3/4 렌더가 없으면 두 장 + C 문장 없음, 비율은 options.aspect', async () => {
  install({ qcIssues: [] });
  await run({ ...PLANNER_OPTIONS, aspect: '4:3' }, { ...PLANNER_INPUTS, renders: PLANNER_INPUTS.renders.slice(0, 1) });
  const call = calls.image[0];
  assert.deepEqual(call.images.map((i) => Buffer.from(i.data, 'base64').toString()), ['ROOM', 'ELEV']);
  assert.match(call.prompt, /^You receive two images\./);
  assert.doesNotMatch(call.prompt, /IMAGE C/);
  assert.equal(call.body.generationConfig.imageConfig.aspectRatio, '4:3');
});

test('planner: 급수·배기 수동값은 wall_analysis 에 들어가고, 프롬프트는 도면을 따르므로 그대로다', async () => {
  install({ qcIssues: [] });
  await run(PLANNER_OPTIONS, PLANNER_INPUTS);
  const plain = calls.image[0].prompt;

  install({ qcIssues: [] });
  await run({ ...PLANNER_OPTIONS, water_from_left_override: 1800, exhaust_from_left_override: 900 }, PLANNER_INPUTS);
  const wall = calls.patched.find((p) => p.wall_analysis).wall_analysis;
  assert.equal(wall.wallW, 3600);
  assert.equal(wall.waterPct, 50);   // 1800 / 3600
  assert.equal(wall.exhaustPct, 25); // 900 / 3600
  assert.equal(wall.confidence, 'user');
  assert.equal(calls.image[0].prompt, plain);
});

test('planner: 입면 렌더가 없으면 설치 전에 실패하고 환불한다', async () => {
  install();
  const refunds = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/rpc/refund_credit_svc')) {
      refunds.push(1);
      return jsonRes({});
    }
    return inner(url, init);
  };
  const job = new GenerateJob(fakeState(), { ...ENV });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options: PLANNER_OPTIONS, inputs: { ...PLANNER_INPUTS, renders: [] }, startedAt: Date.now() }),
    })
  );
  await job.alarm(); // 1회차 실패 → 재시도 예약
  await job.alarm(); // 2회차 실패 → failed + 환불
  assert.equal(calls.image.length, 0);
  assert.ok(calls.patched.some((p) => p.status === 'failed'));
  assert.equal(refunds.length, 1);
});

test('mode 가 없으면 옛 경로 그대로 — 방 사진 한 장, 온도·비율 지정 없음, QC 에 걸리면 재시도 1회', async () => {
  install({ qcIssues: ['handles'] });
  const last = await run(
    { design_spec: SPEC, variants: false },
    { room: PLANNER_INPUTS.room, refs: [] }
  );
  assert.equal(calls.image.length, 2, '설치 + 재시도');
  for (const call of calls.image) {
    assert.deepEqual(call.images.map((i) => Buffer.from(i.data, 'base64').toString()), ['ROOM']);
    assert.equal(call.body.generationConfig.temperature, 0.4);
    assert.deepEqual(call.body.generationConfig.imageConfig, { imageSize: '2K' });
    assert.match(call.prompt, /^Edit the first photo: add a built-in .+ that occupies the space in front of the main wall/);
  }
  assert.ok(calls.image[1].prompt.includes('FIX (the previous attempt failed these checks)'));
  const qcPrompt = calls.text.find((t) => t.startsWith('You are checking'));
  assert.doesNotMatch(qcPrompt, /existing_left|pasted_reference/);
  assert.equal(last.status, 'done');
});

// ─── 이미지 공급자 (2026-10-18, options.image_provider) ───

const GPT = 'gpt-image-2.5-sunburst';
const OPENAI_ENV = { OPENAI_API_KEY: 'sk-test', OPENAI_IMAGE_MODEL: GPT, GEMINI_RETRY_DELAYS_MS: '0,0,0' };

test('planner + image_provider openai: GPT 편집 한 번 — 이미지 3장 순서 그대로, 크기는 비율에서, 온도 없음', async () => {
  install({ qcIssues: [] });
  const last = await run({ ...PLANNER_OPTIONS, image_provider: 'openai' }, PLANNER_INPUTS, OPENAI_ENV);

  assert.equal(calls.image.length, 0, 'Gemini 이미지는 부르지 않는다');
  assert.equal(calls.openai.length, 1, '재시도·추천안 없음');
  const c = calls.openai[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(c.model, GPT);
  assert.deepEqual(c.images, ['ROOM', 'ELEV', 'MASS'], '방 사진이 첫 장(편집 대상), 입면·3/4 는 뒤');
  assert.deepEqual(c.types, ['image/jpeg', 'image/png', 'image/jpeg']);
  assert.equal(c.size, '2048x1152', '16:9');
  assert.ok(!c.keys.includes('temperature') && !c.keys.includes('input_fidelity'), c.keys.join(','));
  // 프롬프트는 Gemini 와 같은 빌더 그대로
  assert.match(c.prompt, /^You receive three images\./);
  assert.match(c.prompt, /COUNT CHECK: exactly 3 base units with 5 doors/);

  // 분석·검사는 Gemini 텍스트 그대로
  assert.ok(calls.text.some((t) => t.startsWith('Measure and describe')));
  assert.ok(calls.text.some((t) => t.startsWith('You are checking')));

  assert.equal(last.status, 'done');
  assert.equal(last.model, GPT, 'generations.model 에 GPT');
  const base = last.images[0];
  assert.equal(base.slot, 'base');
  assert.equal(base.provider, 'openai');
  assert.equal(base.model, GPT);
  assert.equal(base.fallback, undefined);
  assert.deepEqual(base.usage, { input_tokens: 9000, output_tokens: 6000 });
  // 대조·internal_only 는 그대로 (Claude 키가 없어 대조 실패 → 내부 확인용)
  assert.match(calls.patched.find((p) => p.layout).layout.verify.error, /ANTHROPIC_API_KEY/);
  assert.equal(last.options.internal_only, true);
});

test('planner + openai: 세로 비율이면 세로 크기, 3/4 가 없으면 두 장', async () => {
  for (const [aspect, size] of [['3:4', '1536x2048'], ['9:16', '1152x2048'], ['4:3', '2048x1536'], ['1:1', '1760x1760']]) {
    install({ qcIssues: [] });
    await run({ ...PLANNER_OPTIONS, aspect, image_provider: 'openai' }, { ...PLANNER_INPUTS, renders: PLANNER_INPUTS.renders.slice(0, 1) }, OPENAI_ENV);
    assert.equal(calls.openai[0].size, size, aspect);
    assert.deepEqual(calls.openai[0].images, ['ROOM', 'ELEV']);
    assert.match(calls.openai[0].prompt, /^You receive two images\./);
  }
});

test('planner + openai: GPT 가 실패하면 Gemini 가 같은 인자로 대신 그리고 칸에 fallback·사유', async () => {
  install({ qcIssues: [], openai: () => jsonRes({ error: { message: 'model not found' } }, 404) });
  const last = await run({ ...PLANNER_OPTIONS, image_provider: 'openai' }, PLANNER_INPUTS, OPENAI_ENV);
  assert.equal(calls.openai.length, 1);
  assert.equal(calls.image.length, 1, 'Gemini 가 한 번 대신');
  const g = calls.image[0];
  assert.deepEqual(g.images.map((i) => Buffer.from(i.data, 'base64').toString()), ['ROOM', 'ELEV', 'MASS']);
  assert.equal(g.body.generationConfig.temperature, 0.2);
  assert.deepEqual(g.body.generationConfig.imageConfig, { imageSize: '2K', aspectRatio: '16:9' });
  assert.equal(last.status, 'done');
  assert.equal(last.model, 'gemini-3-pro-image');
  const base = last.images[0];
  assert.equal(base.provider, 'gemini');
  assert.equal(base.model, 'gemini-3-pro-image');
  assert.equal(base.fallback, true);
  assert.match(base.fallback_reason, /OpenAI 404/);
});

test('planner + openai 인데 키가 없으면 Gemini 가 그리고 사유에 키 없음', async () => {
  install({ qcIssues: [] });
  const last = await run({ ...PLANNER_OPTIONS, image_provider: 'openai' }, PLANNER_INPUTS);
  assert.equal(calls.openai.length, 0);
  assert.equal(calls.image.length, 1);
  const base = last.images[0];
  assert.equal(base.provider, 'gemini');
  assert.equal(base.fallback, true);
  assert.match(base.fallback_reason, /OPENAI_API_KEY not configured/);
});

test('planner 기본(공급자 없음)은 키가 있어도 Gemini — 칸 표시 없이 예전 모양 그대로', async () => {
  install({ qcIssues: [] });
  const last = await run(PLANNER_OPTIONS, PLANNER_INPUTS, { ...OPENAI_ENV, IMAGE_PROVIDER: 'openai' });
  assert.equal(calls.openai.length, 0, '전역 IMAGE_PROVIDER 는 플래너 모드에 닿지 않는다');
  assert.equal(calls.image.length, 1);
  const base = last.images[0];
  for (const k of ['provider', 'model', 'fallback', 'fallback_reason', 'usage']) assert.equal(k in base, false, k);
  assert.equal(last.model, 'gemini-3-pro-image');
});
