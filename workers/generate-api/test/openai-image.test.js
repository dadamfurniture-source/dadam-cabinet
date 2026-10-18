/**
 * 연출컷 기본안·추천안을 GPT 로 (2026-10-18, 사장님 "기본안 추천안 둘다 GPT").
 *   - IMAGE_PROVIDER=openai + OPENAI_API_KEY 면 GPT, 키가 없으면 Gemini
 *   - GPT 가 실패하면 그 칸은 Gemini 가 대신 그리고 provider·fallback_reason 을 남긴다
 *   - 분석·검사(텍스트)는 Gemini 그대로
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAIImage, openaiSize, OPENAI_SIZES } from '../src/openai.js';
import { imageProvider, renderImage } from '../src/images.js';
import { GenerateJob } from '../src/job.js';

const ROW_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const GPT = 'gpt-image-2.5-sunburst';
const PRO = 'gemini-3-pro-image';
const BASE_ENV = {
  GEMINI_API_KEY: 'g',
  GEMINI_RETRY_DELAYS_MS: '0,0,0',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const ENV = { ...BASE_ENV, IMAGE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_IMAGE_MODEL: GPT };
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const GEMINI_IMG = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('GEM') } }] } }] };
const GPT_IMG = { data: [{ b64_json: b64('GPT') }], usage: { input_tokens: 7000, output_tokens: 6000 } };
const ROOM = { base64: b64('ROOM'), mimeType: 'image/jpeg' };

let realFetch;
let calls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** openai(form) 와 gemini(model) 응답을 갈아 끼운다 */
function mock({ openai = () => jsonRes(GPT_IMG), gemini = () => jsonRes(GEMINI_IMG) } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.openai.com/')) {
      const f = init.body;
      calls.push({
        to: 'openai',
        url: u,
        auth: init.headers.Authorization,
        model: f.get('model'),
        size: f.get('size'),
        quality: f.get('quality'),
        images: await Promise.all(f.getAll('image[]').map(async (b) => Buffer.from(await b.arrayBuffer()).toString())),
        prompt: f.get('prompt'),
      });
      return openai(calls.length);
    }
    const m = u.match(/models\/([^:]+):/);
    calls.push({ to: 'gemini', model: m && m[1] });
    return gemini(m && m[1]);
  };
}

test('사진 비율마다 GPT 크기는 16의 배수이고 비율이 맞는다', () => {
  for (const [ratio, size] of Object.entries(OPENAI_SIZES)) {
    const [w, h] = size.split('x').map(Number);
    const [rw, rh] = ratio.split(':').map(Number);
    assert.equal(w % 16, 0, size);
    assert.equal(h % 16, 0, size);
    assert.ok(Math.abs(w / h - rw / rh) / (rw / rh) < 0.02, `${ratio} → ${size}`);
    assert.ok(w * h <= 2560 * 1440, `${size} 은 실험 구간을 넘지 않는다`);
  }
  assert.equal(openaiSize('3:4'), '1536x2048');
  assert.equal(openaiSize(undefined), 'auto');
});

test('GPT 편집 호출: 이미지 여러 장을 image[] 로, 모델·크기·품질·키를 싣는다', async () => {
  mock();
  const r = await callOpenAIImage(ENV, { prompt: 'p', images: [ROOM, { base64: b64('REF'), mimeType: 'image/png' }], aspectRatio: '3:4' });
  const c = calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(c.auth, 'Bearer sk-test');
  assert.equal(c.model, GPT);
  assert.equal(c.size, '1536x2048');
  assert.equal(c.quality, 'high');
  assert.deepEqual(c.images, ['ROOM', 'REF']);
  assert.equal(Buffer.from(r.image, 'base64').toString(), 'GPT');
  assert.equal(r.model, GPT);
  assert.deepEqual(r.usage, GPT_IMG.usage);
});

test('GPT 503 은 기다렸다 다시, 크레딧 소진(insufficient_quota)은 바로 던진다', async () => {
  mock({ openai: (n) => (n < 3 ? jsonRes({ error: { message: 'busy' } }, 503) : jsonRes(GPT_IMG)) });
  await callOpenAIImage(ENV, { prompt: 'p', images: [ROOM] });
  assert.equal(calls.length, 3);

  calls = [];
  mock({ openai: () => jsonRes({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 429) });
  await assert.rejects(callOpenAIImage(ENV, { prompt: 'p', images: [ROOM] }), (e) => e.quota === true && e.status === 429);
  assert.equal(calls.length, 1);
});

test('공급자: openai + 키 → GPT, 키가 없거나 gemini 면 Gemini', () => {
  assert.equal(imageProvider(ENV), 'openai');
  assert.equal(imageProvider({ ...ENV, OPENAI_API_KEY: '' }), 'gemini');
  assert.equal(imageProvider({ ...ENV, IMAGE_PROVIDER: 'gemini' }), 'gemini');
  assert.equal(imageProvider(BASE_ENV), 'gemini');
});

test('GPT 가 실패하면 Gemini 가 대신 그리고 사유를 남긴다', async () => {
  mock({ openai: () => jsonRes({ error: { message: 'model not found' } }, 404) });
  const r = await renderImage(ENV, { prompt: 'p', images: [ROOM], aspectRatio: '3:4' }, 'base');
  assert.deepEqual(calls.map((c) => c.to), ['openai', 'gemini']);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.model, PRO);
  assert.equal(r.fallback, true);
  assert.match(r.fallback_reason, /OpenAI 404/);
});

// ─── 잡 흐름 ───

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

async function runJob(env, { openai } = {}) {
  const patched = [];
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      return new Response(Buffer.from('ROOM'), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.startsWith('https://api.openai.com/')) {
      seen.push('openai:image');
      return openai ? openai() : jsonRes(GPT_IMG);
    }
    const body = JSON.parse(init.body);
    if (body.generationConfig.responseModalities.length === 1) {
      seen.push('gemini:text');
      const prompt = body.contents[0].parts.at(-1).text;
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: 3000, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    seen.push('gemini:image');
    return jsonRes(GEMINI_IMG);
  };
  const job = new GenerateJob(fakeState(), { ...env });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'wardrobe', options: {},
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] },
        startedAt: Date.now(),
      }),
    })
  );
  await job.alarm();
  return { last: patched.at(-1), seen };
}

test('잡: 기본안·추천안 4장은 GPT, 분석·검사는 Gemini 텍스트', async () => {
  const { last, seen } = await runJob(ENV);
  assert.equal(seen.filter((s) => s === 'openai:image').length, 4);
  assert.equal(seen.filter((s) => s === 'gemini:image').length, 0);
  assert.ok(seen.includes('gemini:text'));
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
  assert.equal(last.model, GPT);
  for (const img of last.images) {
    assert.equal(img.provider, 'openai', img.slot);
    assert.equal(img.model, GPT, img.slot);
    assert.equal(img.fallback, undefined, img.slot);
  }
});

test('잡: GPT 크레딧이 떨어져도 Gemini 가 4장을 다 그린다 — 칸마다 fallback', async () => {
  const { last, seen } = await runJob(ENV, {
    openai: () => jsonRes({ error: { code: 'insufficient_quota', message: 'quota' } }, 429),
  });
  assert.equal(seen.filter((s) => s === 'gemini:image').length, 4);
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
  for (const img of last.images) {
    assert.equal(img.provider, 'gemini', img.slot);
    assert.equal(img.fallback, true, img.slot);
  }
});

test('잡: 키가 없으면 지금처럼 Gemini — 칸에 공급자 표시를 남기지 않는다', async () => {
  const { last, seen } = await runJob({ ...BASE_ENV, IMAGE_PROVIDER: 'openai' });
  assert.equal(seen.filter((s) => s === 'openai:image').length, 0);
  assert.equal(last.model, PRO);
  for (const img of last.images) assert.equal(img.provider, undefined, img.slot);
});
