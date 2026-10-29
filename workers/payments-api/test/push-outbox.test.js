/**
 * 업체 구독 앱 알림 (src/push-outbox.js · src/lifecycle.js 의 결제 실패 · 업체 정지).
 *
 * 고정하는 것:
 *   1) 정기 결제가 처음 실패해 재시도가 시작되면 billing_failed — 업체 대표(active owner)에게만, 한 사람 한 줄
 *   2) 중간 재시도 실패는 알리지 않는다. 마지막 실패는 billing_failed(마지막) + 업체가 정지되면 company_suspended
 *   3) 같은 일은 한 번만 (dedupe_key: kind:구독 id:대표 id[:기간:단계]) — 같은 날 다시 돌아도
 *   4) 개인 구독(업체 없음) · 해지 만료(closed) 는 알리지 않는다
 *   5) 넣기가 실패해도 결제 처리는 그대로 — 로그는 종류 · 상태 코드만
 *   6) 글은 workflow-api 의 정본(src/push/messages.js)과 같다 — 금액 · 업체 이름이 없다
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackend,
  installFetch,
  quietConsole,
  ENV,
  DAY,
  iso,
} from './helpers/fake-backend.js';
import { runDailyLifecycle, clock } from '../src/lifecycle.js';
import { endCompany } from '../src/company.js';
import {
  billingFailedMessage,
  companySuspendedMessage,
  notifyCompanyOwners,
  PUSH_URL,
} from '../src/push-outbox.js';
import { buildMessage, isValidMessage } from '../../workflow-api/src/push/messages.js';

const realClock = clock.now;
function run(t) {
  clock.now = () => t + 1000;
  return runDailyLifecycle(ENV, t);
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OWNER2 = '33333333-3333-4333-8333-333333333333';
const STAFF = '55555555-5555-4555-8555-555555555555';
const S1 = '22222222-2222-4222-8222-222222222222';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T0 = Date.UTC(2026, 10, 25, 19, 0, 0);
const PERIOD_END = iso(T0 - 5 * 3600_000);
const STAMP = '202611251400';
const decline = { status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과 또는 잔액 부족' };

let be;
let restoreFetch;
let quiet;

function seed({ companyId = C1, extra = {} } = {}) {
  be.db.profiles.push({ id: OWNER, email: 'owner@example.com', name: '대표', tier: 'expert' });
  be.db.companies.push({
    id: C1,
    kind: 'partner',
    name: '좋은가구',
    plan: 'expert',
    next_plan: null,
    status: 'active',
  });
  be.db.company_members.push(
    { id: 'm1', company_id: C1, user_id: OWNER, role: 'owner', status: 'active' },
    { id: 'm2', company_id: C1, user_id: STAFF, role: 'staff', status: 'active' },
    { id: 'm3', company_id: C1, user_id: OWNER2, role: 'owner', status: 'removed' }
  );
  be.db.subscriptions.push({
    id: S1,
    company_id: companyId,
    user_id: OWNER,
    plan: 'expert',
    status: 'active',
    provider: 'toss',
    billing_key: 'bk_1',
    provider_customer_id: `dadam-${OWNER}`,
    amount_krw: 99000,
    current_period_start: iso(Date.parse(PERIOD_END) - 30 * DAY),
    current_period_end: PERIOD_END,
    next_charge_at: PERIOD_END,
    cancel_at: null,
    cancel_reason: null,
    ended_at: null,
    failed_attempts: 0,
    first_failed_at: null,
    created_at: iso(Date.parse(PERIOD_END) - 30 * DAY),
    ...extra,
  });
  be.db.company_credits.push({ company_id: C1, balance: 600, period_end: iso(T0 + 20 * DAY) });
}

const outbox = () => be.db.notification_outbox || [];
const outboxPosts = () =>
  be.calls.rest.filter((c) => c.path === 'notification_outbox' && c.method === 'POST');

beforeEach(() => {
  be = createBackend({ nowMs: T0 });
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
  clock.now = realClock;
});

test('첫 실패(재시도 시작) — 업체 대표에게만 billing_failed 한 줄 (직원 · 나간 대표 없음)', async () => {
  seed();
  be.state.chargeQueue = [decline];
  const summary = await run(T0);
  assert.equal(summary.retry_scheduled, 1);
  assert.equal(outbox().length, 1);
  const row = outbox()[0];
  assert.deepEqual(
    { ...row, id: undefined, created_at: undefined },
    {
      id: undefined,
      created_at: undefined,
      user_id: OWNER,
      company_id: C1,
      kind: 'billing_failed',
      title: '결제 실패',
      body: '업체 구독 결제가 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.',
      url: '/segan/me.html#partner',
      ref_id: S1,
      dedupe_key: `billing_failed:${S1}:${OWNER}:${STAMP}:past_due`,
    }
  );
  const [post] = outboxPosts();
  assert.equal(post.query, '?on_conflict=dedupe_key');
});

test('중간 재시도 실패는 알리지 않고, 마지막 실패는 결제 실패(마지막) + 업체 정지', async () => {
  seed();
  be.state.chargeQueue = [decline, decline, decline];
  await run(T0);
  await run(T0 + DAY);
  assert.equal(outbox().length, 1, '두 번째 실패는 알리지 않는다');
  const summary = await run(T0 + 3 * DAY);
  assert.equal(summary.cancelled_payment_failed, 1);
  assert.equal(be.db.companies[0].status, 'suspended');
  assert.deepEqual(
    outbox().map((r) => [r.kind, r.user_id, r.dedupe_key, r.body]),
    [
      [
        'billing_failed',
        OWNER,
        `billing_failed:${S1}:${OWNER}:${STAMP}:past_due`,
        billingFailedMessage().body,
      ],
      [
        'billing_failed',
        OWNER,
        `billing_failed:${S1}:${OWNER}:${STAMP}:final`,
        billingFailedMessage({ final: true }).body,
      ],
      [
        'company_suspended',
        OWNER,
        `company_suspended:${S1}:${OWNER}`,
        companySuspendedMessage().body,
      ],
    ]
  );
  // 다시 돌아도 더 넣지 않는다 (이미 정지 · 끝난 구독)
  await run(T0 + 4 * DAY);
  assert.equal(outbox().length, 3);
});

test('같은 일은 한 번만 — 같은 dedupe_key 는 넘긴다', async () => {
  seed();
  for (let i = 0; i < 2; i++) {
    const n = await notifyCompanyOwners(ENV, {
      companyId: C1,
      kind: 'company_suspended',
      refId: S1,
      message: companySuspendedMessage(),
    });
    assert.equal(n, 1);
  }
  assert.equal(outbox().length, 1);
  assert.match(
    be.calls.rest.find((c) => c.path === 'notification_outbox').query,
    /on_conflict=dedupe_key/
  );
});

test('개인 구독(업체 없음)은 알리지 않는다 · 해지 만료(closed)는 정지 알림이 없다', async () => {
  seed({ companyId: null });
  be.state.chargeQueue = [decline];
  await run(T0);
  assert.equal(outbox().length, 0);
  assert.equal(outboxPosts().length, 0);

  be = createBackend({ nowMs: T0 });
  restoreFetch();
  restoreFetch = installFetch(be);
  const end = iso(T0 + 2 * DAY);
  seed({
    extra: {
      status: 'cancelled',
      current_period_end: end,
      next_charge_at: null,
      cancel_reason: 'user_request',
      cancel_at: end,
    },
  });
  await run(T0 + 2 * DAY);
  assert.equal(be.db.companies[0].status, 'closed');
  assert.equal(outbox().length, 0);
});

test('넣기가 실패해도 결제 처리는 그대로 — 로그는 종류 · 상태 코드만', async () => {
  seed();
  be.state.failDb = (method, table) => table === 'notification_outbox';
  be.state.chargeQueue = [decline];
  const summary = await run(T0);
  assert.equal(summary.retry_scheduled, 1);
  assert.equal(be.db.subscriptions[0].status, 'past_due');
  const warn = quiet.lines.filter(([k, l]) => k === 'warn' && l.includes('notification_outbox'));
  assert.deepEqual(warn, [['warn', '[payments] notification_outbox: billing_failed 500']]);
  const all = quiet.lines.map((l) => l[1]).join('\n');
  assert.ok(!all.includes('결제 수단을 확인'), '알림 글은 로그에 없다');
});

test('구성원을 못 읽거나 · 대표가 없거나 · id 가 틀리면 0, 던지지 않는다', async () => {
  seed();
  const msg = companySuspendedMessage();
  assert.equal(
    await notifyCompanyOwners(ENV, {
      companyId: 'x',
      kind: 'company_suspended',
      refId: S1,
      message: msg,
    }),
    0
  );
  be.db.company_members = [];
  assert.equal(
    await notifyCompanyOwners(ENV, {
      companyId: C1,
      kind: 'company_suspended',
      refId: S1,
      message: msg,
    }),
    0
  );
  be.state.failDb = (method, table) => table === 'company_members';
  assert.equal(
    await notifyCompanyOwners(ENV, {
      companyId: C1,
      kind: 'company_suspended',
      refId: S1,
      message: msg,
    }),
    0
  );
  assert.equal(outbox().length, 0);
});

test('업체 끝내기 — 이번에 바꿨을 때만 true (이미 정지 · 살아 있는 구독이면 false)', async () => {
  seed({ extra: { status: 'cancelled' } });
  assert.equal(await endCompany(ENV, C1, 'suspended'), true);
  assert.equal(await endCompany(ENV, C1, 'suspended'), false);
  assert.equal(await endCompany(ENV, C1, 'closed'), true);
  be.db.companies[0].status = 'active';
  be.db.subscriptions[0].status = 'active';
  assert.equal(await endCompany(ENV, C1, 'suspended'), false);
  assert.equal(be.db.companies[0].status, 'active');
});

test('글 — workflow-api 정본과 같다, DB 글자 수 안, 금액 · 업체 이름 없음', () => {
  assert.deepEqual(billingFailedMessage(), buildMessage('billing_failed', {}));
  assert.deepEqual(
    billingFailedMessage({ final: true }),
    buildMessage('billing_failed', { final: true })
  );
  assert.deepEqual(companySuspendedMessage(), buildMessage('company_suspended', {}));
  assert.equal(PUSH_URL, '/segan/me.html#partner');
  for (const m of [
    billingFailedMessage(),
    billingFailedMessage({ final: true }),
    companySuspendedMessage(),
  ]) {
    assert.ok(isValidMessage(m));
    assert.ok(!/\d/.test(m.body), '숫자(금액)가 없다');
    assert.ok(!m.body.includes('좋은가구'));
  }
});
