/**
 * 결제가 멈춘 업체(정지 · 해지)의 구성원은 연출컷을 만들 수 없다.
 *
 * consume_credit 이 'company_inactive' 로 막으면 POST /api/generate 는 402 company_inactive —
 * 잡 · 행을 만들지 않고 환불할 차감도 없다 (insufficient_credit 처리와 같은 자리).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};

/** 1x1 투명 PNG */
const ROOM_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let calls;
let realFetch;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = { rpc: [], inserted: null, jobStart: null, uploads: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/rest/v1/rpc/')) {
      const fn = u.split('/rpc/')[1];
      calls.rpc.push(fn);
      if (fn === 'consume_credit') {
        // PostgREST 가 RAISE EXCEPTION 을 돌려주는 모양
        return jsonRes(
          { code: 'P0001', details: null, hint: null, message: 'company_inactive' },
          400
        );
      }
      return jsonRes({});
    }
    if (u.includes('/storage/v1/object/')) {
      calls.uploads += 1;
      return jsonRes({ Key: 'ok' });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'POST') calls.inserted = JSON.parse(init.body);
      return jsonRes([]);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('업체가 정지 · 해지면 402 company_inactive — 행 · 업로드 · 잡 · 환불 없음', async () => {
  const res = await worker.fetch(
    new Request('https://generate.example/api/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_image: ROOM_IMAGE, image_type: 'image/png', category: 'sink' }),
    }),
    {
      ...ENV,
      GENERATE_JOB: {
        idFromName: (n) => ({ name: n }),
        get: () => ({
          fetch: async (_url, init) => {
            calls.jobStart = JSON.parse(init.body);
            return new Response('{"ok":true}', { status: 202 });
          },
        }),
      },
    }
  );
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'company_inactive');
  assert.equal(
    body.error,
    '업체 구독이 멈춰 있어 연출컷을 만들 수 없습니다. 결제를 확인해 주세요.'
  );
  assert.deepEqual(calls.rpc, ['consume_credit'], '환불(refund_credit)을 부르지 않는다');
  assert.equal(calls.inserted, null);
  assert.equal(calls.uploads, 0);
  assert.equal(calls.jobStart, null);
});
