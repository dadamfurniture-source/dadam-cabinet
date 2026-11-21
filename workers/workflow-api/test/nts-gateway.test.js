/**
 * 국세청 조회 다리 (src/nts-gateway.js · 들머리 src/index.js 의 NtsGateway).
 * 2026-11-21 대표님: 회계 쪽에 등록해 둔 국세청 키를 사업자등록증 확인(account-api)이 함께 쓴다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ntsGatewayPost, NTS_GATEWAY_URLS, NTS_GATEWAY_MAX_BODY } from '../src/nts-gateway.js';

const KEY = 'abc+/def==';

function withFetch(impl, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  };
  const quiet = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  return Promise.resolve(run(calls, logs)).finally(() => {
    globalThis.fetch = real;
    console.error = quiet;
  });
}
const ok = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('상태조회 · 진위확인 — 이 워커의 키를 붙여 본문을 그대로 전하고 응답 본문을 돌려준다', async () => {
  await withFetch(
    () => ok({ status_code: 'OK', data: [{ b_no: '1234567891', b_stt_cd: '01' }] }),
    async (calls) => {
      const payload = { b_no: ['1234567891'] };
      const out = await ntsGatewayPost({ NTS_SERVICE_KEY: KEY }, 'status', payload);
      assert.deepEqual(out, { status_code: 'OK', data: [{ b_no: '1234567891', b_stt_cd: '01' }] });
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        `${NTS_GATEWAY_URLS.status}?serviceKey=${encodeURIComponent(KEY)}`
      );
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.body, JSON.stringify(payload));

      await ntsGatewayPost({ NTS_SERVICE_KEY: KEY }, 'validate', {
        businesses: [{ b_no: '1234567891' }],
      });
      assert.equal(
        calls[1].url,
        `${NTS_GATEWAY_URLS.validate}?serviceKey=${encodeURIComponent(KEY)}`
      );
    }
  );
});

test('주소는 국세청 두 곳뿐 — 회계장부 조회(src/ledger/review.js)와 같은 서비스', () => {
  assert.deepEqual(Object.keys(NTS_GATEWAY_URLS), ['status', 'validate']);
  for (const u of Object.values(NTS_GATEWAY_URLS))
    assert.match(u, /^https:\/\/api\.odcloud\.kr\/api\/nts-businessman\/v1\/(status|validate)$/);
  assert.ok(
    fs
      .readFileSync(new URL('../src/ledger/review.js', import.meta.url), 'utf8')
      .includes(NTS_GATEWAY_URLS.status)
  );
});

test('부르지 않고 null — 키 없음 · 모르는 kind · 본문이 객체가 아님 · 본문이 너무 큼', async () => {
  await withFetch(
    () => ok({}),
    async (calls) => {
      assert.equal(await ntsGatewayPost({}, 'status', { b_no: ['1'] }), null);
      assert.equal(await ntsGatewayPost({ NTS_SERVICE_KEY: '' }, 'status', { b_no: ['1'] }), null);
      assert.equal(await ntsGatewayPost(null, 'status', { b_no: ['1'] }), null);
      for (const kind of [
        '',
        'other',
        'constructor',
        '__proto__',
        'toString',
        null,
        undefined,
        1,
        {},
      ]) {
        assert.equal(
          await ntsGatewayPost({ NTS_SERVICE_KEY: KEY }, kind, { b_no: ['1'] }),
          null,
          String(kind)
        );
      }
      for (const payload of [null, undefined, 'x', 1, ['a']]) {
        assert.equal(await ntsGatewayPost({ NTS_SERVICE_KEY: KEY }, 'status', payload), null);
      }
      const big = { b_no: ['1'], pad: 'x'.repeat(NTS_GATEWAY_MAX_BODY) };
      assert.equal(await ntsGatewayPost({ NTS_SERVICE_KEY: KEY }, 'status', big), null);
      assert.equal(calls.length, 0);
    }
  );
});

test('실패는 null — 연결 · 상태 코드 · 본문. 던지지 않고, 로그에 키 · 번호를 남기지 않는다', async () => {
  const env = { NTS_SERVICE_KEY: KEY };
  const payload = { b_no: ['1234567891'] };
  await withFetch(
    () => {
      throw new Error('down ' + KEY);
    },
    async (_c, logs) => {
      assert.equal(await ntsGatewayPost(env, 'status', payload), null);
      assert.deepEqual(logs, ['[NtsGateway] status failed: network']);
    }
  );
  await withFetch(
    () => new Response('no', { status: 401 }),
    async (_c, logs) => {
      assert.equal(await ntsGatewayPost(env, 'validate', payload), null);
      assert.deepEqual(logs, ['[NtsGateway] validate failed: 401']);
    }
  );
  await withFetch(
    () => new Response('<html>', { status: 200 }),
    async (_c, logs) => {
      assert.equal(await ntsGatewayPost(env, 'status', payload), null);
      assert.deepEqual(logs, ['[NtsGateway] status failed: body']);
      for (const l of logs) {
        assert.ok(!l.includes(KEY));
        assert.ok(!l.includes('1234567891'));
      }
    }
  );
});

test('들머리 — wrangler main 은 src/index.js, NtsGateway 가 이 다리를 부르고 HTTP · cron 은 worker.js 그대로', () => {
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^main = "src\/index\.js"$/m);
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /export class NtsGateway extends WorkerEntrypoint/);
  assert.match(index, /return ntsGatewayPost\(this\.env, kind, payload\);/);
  assert.match(index, /import worker from '\.\/worker\.js';/);
  assert.match(index, /export default worker;/);
});
