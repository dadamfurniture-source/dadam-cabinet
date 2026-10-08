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

function install({ qcIssues = ['existing_left'] } = {}) {
  calls = { image: [], text: [], patched: [], uploads: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
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

async function run(options, inputs) {
  const job = new GenerateJob(fakeState(), { ...ENV });
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
    assert.match(call.prompt, /^Edit the first photo: install a built-in/);
  }
  assert.ok(calls.image[1].prompt.includes('FIX (the previous attempt failed these checks)'));
  const qcPrompt = calls.text.find((t) => t.startsWith('You are checking'));
  assert.doesNotMatch(qcPrompt, /existing_left|pasted_reference/);
  assert.equal(last.status, 'done');
});
