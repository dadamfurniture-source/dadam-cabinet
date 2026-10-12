/**
 * 과부하 재시도·시간 제한 (2026-10-13).
 * 10/12 밤 gemini-3-pro-image 가 503 "high demand" 를 내자 기본안은 바로 실패했고,
 * 추천안은 4초 뒤 한 번 더 시도하다 빠졌다. 150초 제한은 느리지만 살아 있는 응답을 끊었다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callGemini, geminiTimeoutMs, retryDelaysMs } from '../src/gemini.js';

const ENV = { GEMINI_API_KEY: 'k', GEMINI_RETRY_DELAYS_MS: '0,0,0' };
const OK = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'fine' }] } }] });

let realFetch;
let calls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 차례대로 응답한다. 숫자는 그 상태 코드, 'ok' 는 200, Error 는 던진다. */
function script(...steps) {
  globalThis.fetch = async () => {
    const s = steps[Math.min(calls, steps.length - 1)];
    calls++;
    if (s instanceof Error) throw s;
    if (s === 'ok') return new Response(OK, { status: 200 });
    if (typeof s === 'object') return new Response('busy', { status: s.status, headers: s.headers });
    return new Response(`{"error":{"code":${s},"message":"high demand"}}`, { status: s });
  };
}

test('503 이 이어져도 기다렸다 다시 보내 성공한다', async () => {
  script(503, 503, 'ok');
  const r = await callGemini(ENV, { prompt: 'p', want: 'text' });
  assert.equal(r.text, 'fine');
  assert.equal(calls, 3);
});

test('429·500 도 재시도한다', async () => {
  script(429, 500, 'ok');
  assert.equal((await callGemini(ENV, { prompt: 'p', want: 'text' })).text, 'fine');
  assert.equal(calls, 3);
});

test('재시도를 다 쓰면 마지막 503 을 던진다 (처음 1번 + 재시도 3번)', async () => {
  script(503);
  await assert.rejects(callGemini(ENV, { prompt: 'p', want: 'text' }), /Gemini 503/);
  assert.equal(calls, 4);
});

test('400 같은 요청 오류는 다시 보내지 않는다', async () => {
  script(400);
  await assert.rejects(callGemini(ENV, { prompt: 'p', want: 'text' }), /Gemini 400/);
  assert.equal(calls, 1);
});

test('시간 초과는 여기서 다시 보내지 않는다 — 잡 단위 재시도가 맡는다', async () => {
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  script(timeout, 'ok');
  await assert.rejects(callGemini(ENV, { prompt: 'p', want: 'text' }), /timeout/);
  assert.equal(calls, 1);
});

test('Retry-After 가 있으면 그 시간을 따른다', async () => {
  // 기본 간격은 60초지만 서버가 0초라고 하면 바로 다시 보낸다
  script({ status: 503, headers: { 'retry-after': '0' } }, 'ok');
  const t0 = Date.now();
  await callGemini({ GEMINI_API_KEY: 'k', GEMINI_RETRY_DELAYS_MS: '60000' }, { prompt: 'p', want: 'text' });
  assert.ok(Date.now() - t0 < 5_000);
  assert.equal(calls, 2);
});

test('호출마다 재시도 간격을 줄 수 있다 (채팅은 짧게 한 번)', async () => {
  script(503, 503, 'ok');
  await assert.rejects(
    callGemini({ GEMINI_API_KEY: 'k' }, { prompt: 'p', want: 'text', retryDelaysMs: [0] }),
    /Gemini 503/
  );
  assert.equal(calls, 2);
});

test('기본 재시도 간격은 10·30·60초, env 로 바꾼다', () => {
  assert.deepEqual(retryDelaysMs({}), [10_000, 30_000, 60_000]);
  assert.deepEqual(retryDelaysMs({ GEMINI_RETRY_DELAYS_MS: '1000, 2000' }), [1000, 2000]);
});

test('시간 제한: 이미지 210초, 텍스트 150초', () => {
  assert.equal(geminiTimeoutMs({}, 'image'), 210_000);
  assert.equal(geminiTimeoutMs({}, 'text'), 150_000);
  assert.equal(geminiTimeoutMs({}), 150_000);
  assert.equal(geminiTimeoutMs({ GEMINI_IMAGE_TIMEOUT_MS: '240000' }, 'image'), 240_000);
  assert.equal(geminiTimeoutMs({ GEMINI_TIMEOUT_MS: '90000' }, 'text'), 90_000);
});
