/**
 * 검사 재생성은 큰 결함에만 (2026-10-13, 연출컷 점검 보고서 제안 4).
 * 생성 기록 22건 중 18건이 검사에 걸려 기본안을 한 번 더 그렸고, 그중 10건은
 * 천장 틈·글자·가전만 걸린 것이었다. 이 셋만 걸리면 기록만 남기고 첫 그림을 쓴다.
 *
 * planner-mode-job.test.js 와 같은 방식: Supabase·Gemini 는 global fetch 하나만 갈아 끼운다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateJob } from '../src/job.js';
import { QC_RECORD_ONLY, qcNeedsRetry } from '../src/prompts.js';

const ROW_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

let calls;
let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function install(qcIssues) {
  calls = { image: [], patched: [], qcImages: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      return new Response(Buffer.from('ROOM'), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        if (prompt.startsWith('You are checking')) {
          calls.qcImages.push(parts.filter((x) => x.inlineData).map((x) => Buffer.from(x.inlineData.data, 'base64').toString()));
        }
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3000, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
          : JSON.stringify({ ok: qcIssues.length === 0, issues: qcIssues, note: 'n' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      calls.image.push(prompt);
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

async function run() {
  const job = new GenerateJob(fakeState(), { ...ENV });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'wardrobe',
        options: { variants: false },
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] },
        startedAt: Date.now(),
      }),
    })
  );
  await job.alarm();
  return calls.patched[calls.patched.length - 1];
}

test('qcNeedsRetry: 천장 틈·글자·가전만이면 다시 그리지 않는다', () => {
  assert.deepEqual(QC_RECORD_ONLY, ['gap_to_ceiling', 'text', 'appliances_visible']);
  assert.equal(qcNeedsRetry({ ok: true, issues: [] }), false);
  assert.equal(qcNeedsRetry({ ok: false, issues: ['gap_to_ceiling', 'text', 'appliances_visible'] }), false);
  assert.equal(qcNeedsRetry({ ok: false, issues: ['gap_to_ceiling', 'handles'] }), true);
  for (const k of ['handles', 'doors_open', 'room_changed', 'wrong_category', 'split_frame', 'no_depth', 'faucet_missing', 'layout_mismatch']) {
    assert.equal(qcNeedsRetry({ ok: false, issues: [k] }), true, k);
  }
  assert.equal(qcNeedsRetry(null), false);
});

test('잡: 기록 전용 코드만 걸리면 설치 한 번 — qc 에 남기고 retried:false', async () => {
  install(['gap_to_ceiling', 'text']);
  const last = await run();
  assert.equal(calls.image.length, 1);
  assert.equal(last.status, 'done');
  assert.deepEqual(last.images[0].qc, { ok: false, issues: ['gap_to_ceiling', 'text'], note: 'n', retried: false });
});

test('잡: 큰 결함이 하나라도 있으면 FIX 를 붙여 다시 그린다 — retried:true', async () => {
  install(['gap_to_ceiling', 'handles']);
  const last = await run();
  assert.equal(calls.image.length, 2);
  assert.match(calls.image[1], /FIX \(the previous attempt failed these checks\)/);
  assert.match(calls.image[1], /Remove every handle/);
  assert.equal(last.images[0].qc.retried, true);
});

test('잡: 검사 통과면 설치 한 번, retried 키 없음', async () => {
  install([]);
  const last = await run();
  assert.equal(calls.image.length, 1);
  assert.deepEqual(last.images[0].qc, { ok: true, issues: [], note: 'n' });
});

test('잡: 검사에는 원본 방 사진과 결과를 그 순서로 보낸다 (깊이 비교)', async () => {
  install([]);
  await run();
  assert.deepEqual(calls.qcImages, [['ROOM', 'OUT']]);
});
