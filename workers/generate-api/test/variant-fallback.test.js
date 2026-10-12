/**
 * 과부하 때 추천안은 가벼운 모델로 (2026-10-13, 연출컷 점검 보고서 제안 3).
 * 10/12 밤 기본 모델이 503 을 내 추천안 3장이 빠졌다. 추천안은 색만 바꾸는 일이라
 * 기본 모델이 버티지 못하면 가벼운 모델이 대신 그린다. 기본안은 대신하지 않는다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callImageWithFallback, fallbackImageModel } from '../src/gemini.js';
import { GenerateJob } from '../src/job.js';

const ROW_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'k',
  GEMINI_RETRY_DELAYS_MS: '0,0,0',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const PRO = 'gemini-3-pro-image';
const FLASH = 'gemini-3.1-flash-image-preview';
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const IMG = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] };

let realFetch;
let models;
beforeEach(() => {
  realFetch = globalThis.fetch;
  models = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Gemini 만 흉내 — busy(model) 가 true 면 그 모델은 status 를 돌려준다 */
function gemini(busy, status = 503) {
  globalThis.fetch = async (url) => {
    const m = String(url).match(/models\/([^:]+):/)[1];
    models.push(m);
    if (busy(m)) return jsonRes({ error: { code: status, message: 'high demand' } }, status);
    return jsonRes(IMG);
  };
}

test('기본 모델이 되면 그대로 — fallback 표시 없음', async () => {
  gemini(() => false);
  const r = await callImageWithFallback(ENV, { prompt: 'p' });
  assert.deepEqual(models, [PRO]);
  assert.equal(r.model, PRO);
  assert.equal(r.fallback, undefined);
});

test('기본 모델이 503 이면 한 번만 더 기다려 보고 가벼운 모델로', async () => {
  gemini((m) => m === PRO);
  const r = await callImageWithFallback(ENV, { prompt: 'p' });
  assert.deepEqual(models, [PRO, PRO, FLASH]);
  assert.equal(r.model, FLASH);
  assert.equal(r.fallback, true);
  assert.ok(r.image);
});

test('400 같은 요청 오류는 가벼운 모델로 넘기지 않는다', async () => {
  gemini((m) => m === PRO, 400);
  await assert.rejects(callImageWithFallback(ENV, { prompt: 'p' }), /Gemini 400/);
  assert.deepEqual(models, [PRO]);
});

test("GEMINI_FALLBACK_IMAGE_MODEL='none' 이면 끈다 — 기본 재시도만", async () => {
  gemini((m) => m === PRO);
  await assert.rejects(callImageWithFallback({ ...ENV, GEMINI_FALLBACK_IMAGE_MODEL: 'none' }, { prompt: 'p' }), /Gemini 503/);
  assert.deepEqual(models, [PRO, PRO, PRO, PRO]);
  assert.equal(fallbackImageModel({}), FLASH);
  assert.equal(fallbackImageModel({ GEMINI_FALLBACK_IMAGE_MODEL: 'x-image' }), 'x-image');
});

// ─── 잡 흐름: 기본안은 기본 모델, 추천안은 과부하면 가벼운 모델 ───

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

test('잡: 기본안을 그린 뒤 기본 모델이 과부하면 추천안 3장을 가벼운 모델이 채운다', async () => {
  const patched = [];
  const imageCalls = [];
  let proBusy = false;
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
    const m = u.match(/models\/([^:]+):/)[1];
    const body = JSON.parse(init.body);
    if (body.generationConfig.responseModalities.length === 1) {
      const prompt = body.contents[0].parts.at(-1).text;
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: 3000, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    imageCalls.push(m);
    if (m === PRO && proBusy) return jsonRes({ error: { code: 503, message: 'high demand' } }, 503);
    proBusy = true; // 기본안 한 장을 그린 뒤부터 과부하
    return jsonRes(IMG);
  };

  const job = new GenerateJob(fakeState(), { ...ENV });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'storage', options: {},
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] },
        startedAt: Date.now(),
      }),
    })
  );
  await job.alarm();
  const last = patched.at(-1);

  assert.equal(imageCalls[0], PRO, '기본안은 기본 모델');
  assert.equal(imageCalls.filter((m) => m === FLASH).length, 3);
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
  const base = last.images.find((i) => i.slot === 'base');
  assert.equal(base.fallback, undefined);
  for (const slot of ['v1', 'v2', 'v3']) {
    const v = last.images.find((i) => i.slot === slot);
    assert.equal(v.fallback, true, slot);
    assert.equal(v.model, FLASH, slot);
  }
});
