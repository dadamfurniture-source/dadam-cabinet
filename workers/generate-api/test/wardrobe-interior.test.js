/**
 * 붙박이장 내부 보기 (2026-10-19 사장님 "4장 중 2장은 내부 사진").
 * 기본안(문 닫힘) + 색 추천안 1장 + 내부 보기 2장(문을 전부 연다 — 기본안 색 / 추천안 색). 통 구성은 정본 기본형.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { INTERIOR_SAMPLE_PRESETS, buildWardrobeInteriorPrompt, wardrobeInteriorPlan } from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

test('통 구성: 정본 기본형(SAMPLE_PRESETS·samplePresetFor)과 같다 — 도어 한 쌍 = 한 통', () => {
  const require = createRequire(import.meta.url);
  const W = require('../../../js/detaildesign/bom-wardrobe-rules.js');
  assert.deepEqual(INTERIOR_SAMPLE_PRESETS, [...W.SAMPLE_PRESETS]);
  for (const wallW of [2400, 3000, 3600]) {
    const plan = wardrobeInteriorPlan(wallW);
    assert.deepEqual(plan, plan.map((_, i) => W.samplePresetFor(i, plan.length)), String(wallW));
  }
  assert.deepEqual(wardrobeInteriorPlan(3600), ['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);
  assert.equal(wardrobeInteriorPlan(2400).length, 2);
});

test('프롬프트: 문을 전부 연다 — 기본안 색 한 장, 추천 색 한 장, 내부는 같다', () => {
  const A = buildWardrobeInteriorPrompt(3600);
  const B = buildWardrobeInteriorPrompt(3600, { body: 'deep navy matte', tone: '네이비' });
  for (const p of [A.prompt, B.prompt]) {
    assert.match(p, /^Open every door of the built-in wardrobe/);
    assert.match(p, /The wardrobe has 4 pairs of doors/);
    assert.match(p, /1\. two short-hanging tiers[\s\S]*2\. long hanging[\s\S]*two internal drawers[\s\S]*3\. split into left and right halves[\s\S]*4\. one clothes rail across the full width/);
    assert.match(p, /all sections are visible at once/);
    assert.match(p, /Handleless doors stay handleless/);
    assert.doesNotMatch(p, /stay closed/);
  }
  assert.match(A.prompt, /its door colour/);
  assert.doesNotMatch(A.prompt, /Also change the colour/);
  assert.match(B.prompt, /Also change the colour of every door[\s\S]*deep navy matte/);
  assert.equal(A.label, '내부 보기');
  assert.equal(B.label, '내부 보기 · 네이비');
  // 내부 칸 구성 줄은 두 장이 같다
  const sections = (p) => p.split('\n').filter((l) => /^\d\. /.test(l)).join('\n');
  assert.equal(sections(A.prompt), sections(B.prompt));
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
  const recolour = prompts.filter((p) => p.startsWith('Recolour'));
  const inside = prompts.filter((p) => p.startsWith('Open every door'));
  assert.equal(recolour.length, 1);
  assert.equal(inside.length, 2);
  // 둘째 내부 보기는 색 추천안과 같은 색
  const body = recolour[0].match(/plinth and trim: (.+), one continuous colour/)[1];
  assert.equal(inside.filter((p) => p.includes(`to ${body}, one continuous colour`)).length, 1);
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
  const v = Object.fromEntries(last.images.map((i) => [i.slot, i]));
  assert.match(v.v1.label, /^AI 추천/);
  assert.equal(v.v2.finish_key, 'interior');
  assert.equal(v.v3.finish_key, `interior:${v.v1.finish_key}`);
  assert.equal(v.v2.label, '내부 보기');
  assert.match(v.v3.label, /^내부 보기 · /);
});

test('잡(다른 품목): 색 추천안 3장 그대로', async () => {
  const { prompts } = await runJob('storage');
  assert.equal(prompts.filter((p) => p.startsWith('Recolour')).length, 3);
  assert.equal(prompts.filter((p) => p.startsWith('Open every door')).length, 0);
});
