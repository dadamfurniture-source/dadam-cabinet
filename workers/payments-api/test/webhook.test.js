/**
 * 토스 웹훅 확인이 그대로인지 (회귀 방지).
 * 본문은 믿지 않고 paymentKey 로 결제 조회 API 를 다시 불러, 주문번호·금액이 같을 때만 기록한다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, installFetch, quietConsole, ENV } from './helpers/fake-backend.js';
import worker from '../src/worker.js';

let be;
let restoreFetch;
let quiet;

function post(payload) {
  return worker.fetch(
    new Request('https://payments.example/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    ENV,
    {}
  );
}

beforeEach(() => {
  be = createBackend();
  restoreFetch = installFetch(be);
  quiet = quietConsole();
  be.state.payments.pk_ok = {
    paymentKey: 'pk_ok',
    orderId: 'order-1',
    totalAmount: 99000,
    status: 'CANCELED',
  };
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
});

test('조회 결과와 같으면 기록하고, 같은 상태는 한 번만', async () => {
  const payload = {
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_ok', orderId: 'order-1', totalAmount: 99000 },
  };
  let res = await post(payload);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
  assert.equal(be.db.payment_events.length, 1);
  assert.equal(be.db.payment_events[0].payload.data.status, 'CANCELED', '조회한 값을 남긴다');

  res = await post(payload);
  assert.equal((await res.json()).status, 'duplicate');
  assert.equal(be.db.payment_events.length, 1);
});

test('금액이나 주문번호가 다르면 401, 기록하지 않는다', async () => {
  const res = await post({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_ok', orderId: 'order-1', totalAmount: 1 },
  });
  assert.equal(res.status, 401);
  assert.equal(be.db.payment_events.length, 0);
});

test('토스에 없는 결제면 401', async () => {
  const res = await post({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_missing', orderId: 'x', totalAmount: 1 },
  });
  assert.equal(res.status, 401);
});

test('다른 이벤트는 200 으로 넘긴다', async () => {
  const res = await post({ eventType: 'DEPOSIT_CALLBACK', data: {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ignored');
});
