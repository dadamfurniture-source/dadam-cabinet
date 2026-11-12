/**
 * 수주 온라인 결제 (src/order-pay.js — DB 0025 payment_transactions).
 *
 * 고정하는 것:
 *   - 결제창은 그 수주 프로젝트의 고객 본인만 (아니면 404), 다담 공장 수주만 (협력업체 수주 403 not_payable),
 *     받은 줄 · 취소 수주 409, 가상계좌 입금 기다림이 있으면 409 + 입금 안내, 열린 ready 는 닫고 새로 연다
 *   - 승인은 연 사람 본인 · 금액이 같을 때만 토스에 (멱등키 confirm-orderId). 다르면 422, 토스는 부르지 않는다
 *   - 받은 금액이 수금 줄과 같고 아직 안 받은 줄이면 수금 줄 받음(한국 날짜 · 방법) + 수주 수금액, 다르면 check_needed
 *   - 가상계좌: 승인하면 waiting_deposit + 입금 안내, 입금 웹훅(PAYMENT_STATUS_CHANGED · DEPOSIT_CALLBACK)이 오면 받음
 *   - 웹훅은 조회 API 로 다시 확인한 값만 믿고, 같은 상태가 다시 와도 그대로. 기한 지남 expired, 받은 뒤 취소는 check_needed
 * 사람 · 번호는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, installFetch, quietConsole, ENV } from './helpers/fake-backend.js';
import worker from '../src/worker.js';
import { ORDER_PAY_PREFIX, kstDay, virtualAccountOf } from '../src/order-pay.js';

const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const PARTNER = 'f0000000-0000-4000-8000-0000000000bb';
const U_CUST = '11111111-1111-4111-8111-111111111111';
const U_OTHER = '22222222-2222-4222-8222-222222222222';
const CUST = '33333333-3333-4333-8333-333333333333';
const PROJ = '44444444-4444-4444-8444-444444444444';
const PROJ_P = '44444444-4444-4444-8444-444444444445';
const ORDER = '55555555-5555-4555-8555-555555555555';
const ORDER_P = '55555555-5555-4555-8555-555555555556';
const LINE = '66666666-6666-4666-8666-666666666661';
const LINE_PAID = '66666666-6666-4666-8666-666666666662';
const LINE_P = '66666666-6666-4666-8666-666666666663';

let be;
let restoreFetch;
let quiet;

function seed() {
  be.db.companies.push(
    { id: HQ, kind: 'hq', name: '다담 공장' },
    { id: PARTNER, kind: 'partner', name: '협력' }
  );
  be.db.customers = [{ id: CUST, user_id: U_CUST }];
  be.db.projects = [
    { id: PROJ, customer_id: CUST, company_id: HQ },
    { id: PROJ_P, customer_id: CUST, company_id: PARTNER },
  ];
  be.db.orders = [
    {
      id: ORDER,
      order_no: 'SO-1',
      company_id: HQ,
      project_id: PROJ,
      status: 'confirmed',
      received_amount: 0,
    },
    {
      id: ORDER_P,
      order_no: 'SO-2',
      company_id: PARTNER,
      project_id: PROJ_P,
      status: 'confirmed',
      received_amount: 0,
    },
  ];
  be.db.order_payments = [
    {
      id: LINE,
      order_id: ORDER,
      stage: 'deposit',
      amount: 3000000,
      due_on: '2026-11-10',
      paid_on: null,
    },
    {
      id: LINE_PAID,
      order_id: ORDER,
      stage: 'interim',
      amount: 1000000,
      due_on: '2026-11-20',
      paid_on: '2026-11-01',
    },
    {
      id: LINE_P,
      order_id: ORDER_P,
      stage: 'deposit',
      amount: 500000,
      due_on: '2026-11-10',
      paid_on: null,
    },
  ];
  be.db.payment_transactions = [];
  be.state.users['tok-cust'] = { id: U_CUST, email: 'c@example.com' };
  be.state.users['tok-other'] = { id: U_OTHER, email: 'o@example.com' };
}

const call = (path, token, body) =>
  worker.fetch(
    new Request(`https://payments.example${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    }),
    ENV,
    {}
  );
const webhook = (payload) => call('/webhook', null, payload);
const tx = () => be.db.payment_transactions;
const line = (id) => be.db.order_payments.find((p) => p.id === id);

beforeEach(() => {
  be = createBackend({ nowMs: Date.parse('2026-11-02T01:00:00Z') });
  restoreFetch = installFetch(be);
  quiet = quietConsole();
  seed();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
});

test('결제창 열기 — 고객 본인 · 다담 공장 수주 · 안 받은 줄: 토스 결제창 값, 결제 기록 ready', async () => {
  const res = await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(data.order_id.startsWith(ORDER_PAY_PREFIX));
  assert.ok(data.order_id.length <= 64);
  assert.deepEqual(
    [data.amount, data.order_name, data.customer_key, data.client_key],
    [3000000, '다담 계약금 · SO-1', `dadam-${U_CUST}`, ENV.TOSS_CLIENT_KEY]
  );
  assert.equal(tx().length, 1);
  assert.deepEqual(
    [
      tx()[0].status,
      tx()[0].provider,
      tx()[0].payment_id,
      tx()[0].company_id,
      tx()[0].requested_by,
      tx()[0].amount_requested,
    ],
    ['ready', 'toss', LINE, HQ, U_CUST, 3000000]
  );
  assert.equal(be.tossCalls('/v1').length, 0, '결제창 열기는 토스를 부르지 않는다');
});

test('결제창 열기 — 남 · 없는 줄 404, 협력업체 수주 403 not_payable, 받은 줄 · 취소 수주 409, 로그인 없으면 401', async () => {
  const cases = [
    ['tok-other', LINE, 404, 'not_found'],
    ['tok-cust', 'nope', 404, 'not_found'],
    ['tok-cust', LINE_P, 403, 'not_payable'],
    ['tok-cust', LINE_PAID, 409, 'already_paid'],
  ];
  for (const [token, id, status, code] of cases) {
    const res = await call('/order-payments/checkout', token, { payment_id: id });
    assert.equal(res.status, status, `${token} ${id}`);
    assert.equal((await res.json()).code, code);
  }
  be.db.orders[0].status = 'cancelled';
  assert.equal(
    (await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE })).status,
    409
  );
  assert.equal((await call('/order-payments/checkout', null, { payment_id: LINE })).status, 401);
  assert.equal(tx().length, 0);
});

test('결제창을 다시 열면 열린 ready 는 닫고 새로 연다 · 가상계좌 입금 기다림이 있으면 409 + 입금 안내', async () => {
  await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE });
  await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE });
  assert.deepEqual(
    tx().map((t) => t.status),
    ['canceled', 'ready']
  );
  tx()[1].status = 'waiting_deposit';
  tx()[1].virtual_account = {
    bank: '88',
    account_number: 'X0000000000',
    holder: '김고객',
    due_at: '2026-11-05T00:00:00+09:00',
  };
  const res = await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'waiting_deposit');
  assert.equal(body.transaction.virtual_account.account_number, 'X0000000000');
  assert.equal(tx().length, 2);
});

async function opened() {
  const { data } = await (
    await call('/order-payments/checkout', 'tok-cust', { payment_id: LINE })
  ).json();
  return data;
}

test('카드 승인 — 금액이 같으면 토스 승인(멱등키) → 수금 줄 받음(한국 날짜 · 카드) · 수주 수금액 · 결제 기록 paid', async () => {
  const d = await opened();
  be.state.confirmResult = { approvedAt: '2026-11-02T15:30:00Z' }; // 한국 11/3 00:30
  const res = await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_1',
    orderId: d.order_id,
    amount: d.amount,
  });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.transaction.status, 'paid');
  const confirm = be.tossCalls('/v1/payments/confirm');
  assert.equal(confirm.length, 1);
  assert.equal(confirm[0].idempotencyKey, `confirm-${d.order_id}`);
  assert.deepEqual([line(LINE).paid_on, line(LINE).method], ['2026-11-03', 'card']);
  assert.equal(be.db.orders[0].received_amount, 4000000, '받은 줄 둘의 합');
  assert.deepEqual(
    [tx()[0].status, tx()[0].amount_received, tx()[0].provider_payment_ref],
    ['paid', 3000000, 'pk_1']
  );
  // 같은 결제창을 다시 승인하면 토스를 부르지 않고 그대로
  const again = await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_1',
    orderId: d.order_id,
    amount: d.amount,
  });
  assert.equal((await again.json()).data.transaction.status, 'paid');
  assert.equal(be.tossCalls('/v1/payments/confirm').length, 1);
});

test('승인 — 금액이 다르면 422 · 토스 안 부름 · failed, 남이 승인하면 404, 토스가 거절하면 failed', async () => {
  let d = await opened();
  let res = await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_x',
    orderId: d.order_id,
    amount: 100,
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'amount_mismatch');
  assert.equal(be.tossCalls('/v1/payments/confirm').length, 0);
  assert.equal(tx()[0].status, 'failed');
  assert.equal(line(LINE).paid_on, null);

  d = await opened();
  res = await call('/order-payments/confirm', 'tok-other', {
    paymentKey: 'pk_y',
    orderId: d.order_id,
    amount: d.amount,
  });
  assert.equal(res.status, 404);

  be.state.confirmResult = {
    error: { status: 400, code: 'REJECT_CARD_COMPANY', message: '카드사 거절' },
  };
  res = await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_y',
    orderId: d.order_id,
    amount: d.amount,
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'REJECT_CARD_COMPANY');
  assert.equal(tx()[1].status, 'failed');
  assert.equal(line(LINE).paid_on, null);
  assert.equal(
    (
      await call('/order-payments/confirm', 'tok-cust', {
        paymentKey: 'pk',
        orderId: 'other-1',
        amount: 1,
      })
    ).status,
    422
  );
});

test('가상계좌 — 승인하면 입금 기다림 + 안내, 입금 웹훅(조회 API 로 확인)이 오면 받음, 같은 웹훅은 다시 와도 그대로', async () => {
  const d = await opened();
  be.state.confirmResult = {
    status: 'WAITING_FOR_DEPOSIT',
    method: '가상계좌',
    approvedAt: null,
    virtualAccount: {
      bankCode: '88',
      accountNumber: 'X1234567890',
      customerName: '김고객',
      dueDate: '2026-11-05T23:59:59+09:00',
    },
  };
  const res = await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_va',
    orderId: d.order_id,
    amount: d.amount,
  });
  const { data } = await res.json();
  assert.equal(data.transaction.status, 'waiting_deposit');
  assert.deepEqual(data.transaction.virtual_account, {
    bank: '88',
    account_number: 'X1234567890',
    holder: '김고객',
    due_at: '2026-11-05T23:59:59+09:00',
  });
  assert.equal(line(LINE).paid_on, null);

  // 입금 — 토스 조회 결과를 DONE 으로
  Object.assign(be.state.payments.pk_va, { status: 'DONE', approvedAt: '2026-11-04T02:00:00Z' });
  const hook = {
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_va', orderId: d.order_id, totalAmount: d.amount },
  };
  assert.equal((await webhook(hook)).status, 200);
  assert.deepEqual([line(LINE).paid_on, line(LINE).method], ['2026-11-04', 'virtual_account']);
  assert.equal(tx()[0].status, 'paid');
  assert.equal(be.db.orders[0].received_amount, 4000000);
  assert.equal(be.db.payment_events.length, 1, '웹훅 기록도 남긴다');
  // 같은 웹훅 · 입금 알림이 다시 와도 그대로
  await webhook(hook);
  const dep = await webhook({
    eventType: 'DEPOSIT_CALLBACK',
    orderId: d.order_id,
    status: 'DONE',
    secret: 'x',
    transactionKey: 't',
  });
  assert.equal((await dep.json()).status, 'ok');
  assert.equal(tx().filter((t) => t.status === 'paid').length, 1);
  assert.equal(be.db.orders[0].received_amount, 4000000);
});

test('입금 알림(DEPOSIT_CALLBACK)만 와도 orderId 로 다시 조회해 받음 · 모르는 주문은 넘기고 토스에 없으면 401', async () => {
  const d = await opened();
  be.state.confirmResult = {
    status: 'WAITING_FOR_DEPOSIT',
    method: '가상계좌',
    virtualAccount: { bankCode: '04', accountNumber: 'X9', dueDate: '2026-11-05T23:59:59+09:00' },
  };
  await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_va2',
    orderId: d.order_id,
    amount: d.amount,
  });
  Object.assign(be.state.ordersById[d.order_id], {
    status: 'DONE',
    approvedAt: '2026-11-03T03:00:00Z',
  });
  let res = await webhook({
    eventType: 'DEPOSIT_CALLBACK',
    orderId: d.order_id,
    status: 'DONE',
    secret: 's',
  });
  assert.equal((await res.json()).status, 'ok');
  assert.equal(line(LINE).paid_on, '2026-11-03');

  res = await webhook({ eventType: 'DEPOSIT_CALLBACK', orderId: 'dadam-sub-x', status: 'DONE' });
  assert.equal((await res.json()).status, 'ignored');
  res = await webhook({
    eventType: 'DEPOSIT_CALLBACK',
    orderId: `${ORDER_PAY_PREFIX}nope`,
    status: 'DONE',
  });
  assert.equal(res.status, 401);
});

test('받은 금액이 다르거나 이미 받은 줄이면 check_needed (수금 줄은 그대로), 기한 지남 expired, 받은 뒤 취소 check_needed', async () => {
  // 승인 뒤 관리자가 줄 금액을 바꿨다 → 들어온 돈이 다르다
  let d = await opened();
  be.state.confirmResult = {
    status: 'WAITING_FOR_DEPOSIT',
    method: '가상계좌',
    virtualAccount: { bankCode: '88', accountNumber: 'X1' },
  };
  await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_a',
    orderId: d.order_id,
    amount: d.amount,
  });
  line(LINE).amount = 2500000;
  Object.assign(be.state.payments.pk_a, { status: 'DONE', approvedAt: '2026-11-03T00:00:00Z' });
  await webhook({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_a', orderId: d.order_id, totalAmount: d.amount },
  });
  assert.equal(line(LINE).paid_on, null);
  assert.deepEqual(
    [tx()[0].status, tx()[0].amount_received, tx()[0].status_note],
    ['check_needed', 3000000, '받은 금액이 수금 일정과 다릅니다']
  );

  // 입금 기한이 지남
  line(LINE).amount = 3000000;
  d = await opened();
  be.state.confirmResult = {
    status: 'WAITING_FOR_DEPOSIT',
    method: '가상계좌',
    virtualAccount: { bankCode: '88', accountNumber: 'X2' },
  };
  await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_b',
    orderId: d.order_id,
    amount: d.amount,
  });
  be.state.payments.pk_b.status = 'EXPIRED';
  await webhook({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_b', orderId: d.order_id, totalAmount: d.amount },
  });
  assert.equal(tx()[1].status, 'expired');

  // 카드로 받은 뒤 결제사에서 취소
  d = await opened();
  be.state.confirmResult = null;
  await call('/order-payments/confirm', 'tok-cust', {
    paymentKey: 'pk_c',
    orderId: d.order_id,
    amount: d.amount,
  });
  assert.equal(tx()[2].status, 'paid');
  be.state.payments.pk_c.status = 'CANCELED';
  await webhook({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_c', orderId: d.order_id, totalAmount: d.amount },
  });
  assert.equal(tx()[2].status, 'check_needed');
  assert.match(tx()[2].status_note, /취소/);
  assert.notEqual(line(LINE).paid_on, null, '받음을 저절로 되돌리지 않는다');
});

test('구독 결제 웹훅은 결제 기록을 건드리지 않는다 · 날짜 · 입금 안내 (순수)', async () => {
  be.state.payments.pk_sub = {
    paymentKey: 'pk_sub',
    orderId: 'dadam-sub-u-1',
    totalAmount: 99000,
    status: 'DONE',
  };
  const res = await webhook({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pk_sub', orderId: 'dadam-sub-u-1', totalAmount: 99000 },
  });
  assert.equal((await res.json()).status, 'ok');
  assert.equal(tx().length, 0);
  assert.equal(kstDay('2026-11-02T15:30:00Z'), '2026-11-03');
  assert.equal(virtualAccountOf({}), null);
  assert.deepEqual(
    virtualAccountOf({
      virtualAccount: { bankCode: '20', accountNumber: 'A', customerName: 'B', dueDate: 'C' },
    }),
    {
      bank: '20',
      account_number: 'A',
      holder: 'B',
      due_at: 'C',
    }
  );
});
