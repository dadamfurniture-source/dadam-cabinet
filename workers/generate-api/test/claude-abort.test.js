/**
 * Claude 호출 시간 제한 (2026-10-20). 워커는 Claude 를 미국 콜로 DO(GeminiProxy)로 부른다.
 * SDK 의 시간 제한은 중단 신호로만 걸리는데, 예전 proxiedFetch 는 그 신호를 DO 로 넘기지 않아
 * 업스트림이 멈추면 끝없이 기다렸다(검토 에이전트가 실행으로 확인). 이제 신호를 넘긴다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxiedFetch } from '../src/claude.js';

/** 답을 주지 않는 DO stub — 신호가 오면 그때 끊긴다 */
function hangingEnv(seen) {
  return {
    GEMINI_PROXY: {
      idFromName: () => 'us-east',
      get: () => ({
        fetch: (url, init) => {
          seen.init = init;
          return new Promise((_, reject) => {
            if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted by signal')));
          });
        },
      }),
    },
  };
}

test('중단 신호를 DO 로 넘겨, 멈춘 업스트림도 신호가 오면 끊긴다', async () => {
  const seen = {};
  const f = proxiedFetch(hangingEnv(seen));
  const ac = new AbortController();
  const p = f('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { a: 'b' }, body: '{}', signal: ac.signal });
  assert.equal(seen.init.signal, ac.signal);
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, /aborted by signal/);
  const sent = JSON.parse(seen.init.body);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.bodyText, '{}');
});

test('신호가 없으면 예전 모양 그대로 (signal 키 없음)', async () => {
  const seen = {};
  const env = {
    GEMINI_PROXY: { idFromName: () => 'x', get: () => ({ fetch: async (u, init) => { seen.init = init; return new Response('{}'); } }) },
  };
  await proxiedFetch(env)('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
  assert.equal('signal' in seen.init, false);
  assert.equal(proxiedFetch({}), undefined, '바인딩이 없으면 기본 fetch');
});
