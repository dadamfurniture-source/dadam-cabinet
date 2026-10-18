/**
 * 붙박이장 내부 보기 (2026-10-19 사장님 "4장 중 2장은 내부 사진").
 * 기본안(문 닫힘) + 색 추천안 1장 + 내부 보기 2장(왼쪽 절반·오른쪽 절반 문을 연다). 칸 구성은 두 장이 같다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildWardrobeInteriorPrompt, wardrobeInteriorPlan } from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

test('칸 구성: 도어 한 쌍이 한 칸 — 벽 폭에 따라 2·3·4칸, 첫 칸은 긴 옷', () => {
  assert.deepEqual(wardrobeInteriorPlan(2400), ['long', 'shelves']);
  assert.deepEqual(wardrobeInteriorPlan(3000), ['long', 'double', 'shelves']);
  assert.deepEqual(wardrobeInteriorPlan(3600), ['long', 'double', 'shelves', 'double']);
});

test('프롬프트: 두 장 모두 같은 칸 구성을 싣고, 왼쪽·오른쪽 절반만 연다', () => {
  const L = buildWardrobeInteriorPrompt(3600, 'left');
  const R = buildWardrobeInteriorPrompt(3600, 'right');
  for (const p of [L.prompt, R.prompt]) {
    assert.match(p, /The wardrobe has 4 pairs of doors/);
    assert.match(p, /1\. long hanging[\s\S]*2\. double hanging[\s\S]*3\. shelves and drawers[\s\S]*4\. double hanging/);
    assert.match(p, /every other pair stay closed/);
    assert.match(p, /Handleless doors stay handleless/);
  }
  assert.match(L.prompt, /Open both doors of pairs 1 and 2 \(the left side\)/);
  assert.match(R.prompt, /Open both doors of pairs 3 and 4 \(the right side\)/);
  assert.equal(L.label, '내부 보기 · 긴 옷·2단 옷걸이');
  assert.equal(R.label, '내부 보기 · 선반·서랍·2단 옷걸이');
  // 3칸이면 왼쪽 2칸 · 오른쪽 1칸
  assert.match(buildWardrobeInteriorPrompt(3000, 'right').prompt, /Open both doors of pair 3 \(the right side\)/);
});

// ─── 잡 흐름 ───

const ROW_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'k', GEMINI_RETRY_DELAYS_MS: '0',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
function fakeState() {
  const m = new Map();
  return { storage: {
    get: async (k) => m.get(k), put: async (k, v) => void m.set(k, structuredClone(v)),
    setAlarm: async () => {}, deleteAll: async () => m.clear(), deleteAlarm: async () => {},
  } };
}

async function runJob(category) {
  const prompts = [];
  const patched = [];
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
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts.at(-1).text;
    if (body.generationConfig.responseModalities.length === 1) {
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    prompts.push(prompt);
    return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') } }] } }] });
  };
  const job = new GenerateJob(fakeState(), { ...ENV });
  await job.fetch(new Request('https://generate-job/start', { method: 'POST', body: JSON.stringify({
    id: ROW_ID, userId: USER_ID, creditRef: 'c', category, options: {},
    inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] }, startedAt: Date.now(),
  }) }));
  await job.alarm();
  return { prompts, last: patched.at(-1) };
}

test('잡(붙박이장): 기본안 + 색 추천안 1장 + 내부 보기 2장', async () => {
  const { prompts, last } = await runJob('wardrobe');
  assert.equal(prompts.length, 4);
  assert.equal(prompts.filter((p) => p.startsWith('Recolour')).length, 1);
  assert.equal(prompts.filter((p) => p.startsWith('Open some doors')).length, 2);
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
  const v = Object.fromEntries(last.images.map((i) => [i.slot, i]));
  assert.match(v.v1.label, /^AI 추천/);
  assert.equal(v.v2.finish_key, 'interior:left');
  assert.equal(v.v3.finish_key, 'interior:right');
  assert.match(v.v2.label, /^내부 보기/);
});

test('잡(다른 품목): 색 추천안 3장 그대로', async () => {
  const { prompts } = await runJob('storage');
  assert.equal(prompts.filter((p) => p.startsWith('Recolour')).length, 3);
  assert.equal(prompts.filter((p) => p.startsWith('Open some doors')).length, 0);
});
