/**
 * 사업자등록증 첫 달 무료 (src/trial.js · POST /issue-billing-key 의 trial: true · lifecycle.js 의 trialing).
 * 2026-11-21 대표님 계획 승인 — 새 업체 · 모든 등급 / 카드 먼저 · 30일 뒤 자동 결제 / 사업자번호당 1회.
 *
 * 고정하는 것:
 *   - trial: true 를 실은 때만 본다. 싣지 않으면 확인된 사업자등록증이 있어도 지금처럼 바로 결제한다
 *   - 받을 수 없으면(사업자등록증 없음 · 이미 받은 번호 · 새 업체 아님 · 확인 못 함) 토스를 부르기 전에 멈춘다 — 결제도 카드 등록도 없다
 *   - 받을 수 있으면 빌링키만 받고 결제하지 않는다: 업체(사업자 정보 포함) → 대표 → 무료 준 기록 → 구독 trialing(마지막)
 *     결제 기록은 없다. 30일 뒤가 첫 결제일이다
 *   - 사업자번호당 1회는 trial_grants.biz_no 유니크가 지킨다 — 그 사이 다른 업체가 받았으면 되돌리고 trial_used
 *   - 저장이 실패하면 써 둔 행을 모두 되돌린다 (무료 준 기록 포함 — 번호가 「이미 받음」으로 남지 않게). 취소할 결제는 없다
 *   - 30일째 cron 이 첫 결제를 한다 → active. 거절되면 다른 구독과 같은 재시도(1일 · 3일) → 정지
 *   - 끝나기 7일 전 · 1일 전에 대표에게 trial_ending 알림 한 번씩
 *   - 무료 중 해지: 결제 없이 무료 기간 끝에 업체 closed. 무료 중에도 카드를 바꿀 수 있다
 *   - Agent 도 승인 뒤 같은 길로 무료 시작
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
import worker from '../src/worker.js';
import { runDailyLifecycle, clock, TRIAL_NOTICE_DAYS } from '../src/lifecycle.js';
import { trialEndingMessage, PUSH_URL } from '../src/push-outbox.js';
import { TRIAL_DAYS } from '../src/trial.js';
import { buildMessage, isValidMessage } from '../../workflow-api/src/push/messages.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '55555555-5555-4555-8555-555555555555';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const A1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CERT = '99999999-9999-4999-8999-999999999999';
const BIZ = '1234567890';
const COMPANY = { name: '좋은가구', sido: '서울특별시', gugun: '강남구' };
const decline = { status: 403, code: 'REJECT_CARD_PAYMENT', message: '한도 초과 또는 잔액 부족' };

let be;
let restoreFetch;
let quiet;
const realClock = clock.now;

function seed() {
  be.state.users['user-token'] = { id: U1, email: 'c@example.com', name: '고객' };
  be.db.profiles.push({ id: U1, email: 'c@example.com', tier: 'standard', tier_source: 'manual' });
}

/** 확인된 사업자등록증 (account-api 가 verified 로 바꾼 줄) */
function seedCert(extra = {}) {
  be.db.business_certificates.push({
    id: CERT,
    user_id: U1,
    status: 'verified',
    biz_no: BIZ,
    company_name: '좋은가구',
    representative_name: '홍길동',
    created_at: iso(Date.now() - DAY),
    ...extra,
  });
}

function call(path, body, method = 'POST') {
  return worker.fetch(
    new Request(`https://payments.example${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer user-token',
        Origin: 'https://dadamfurniture.com',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    }),
    ENV,
    {}
  );
}
const start = (extra = {}) =>
  call('/issue-billing-key', {
    auth_key: 'ak',
    customer_key: `dadam-${U1}`,
    plan: 'manager',
    company: COMPANY,
    trial: true,
    ...extra,
  });
const tossCalls = () => be.calls.toss.map((c) => `${c.method} ${c.path}`);
const run = (t) => {
  clock.now = () => t + 1000;
  return runDailyLifecycle(ENV, t);
};

beforeEach(() => {
  be = createBackend();
  be.db.business_certificates = [];
  be.db.trial_grants = [];
  be.db.notification_outbox = [];
  restoreFetch = installFetch(be);
  quiet = quietConsole();
});
afterEach(() => {
  restoreFetch();
  quiet.restore();
  clock.now = realClock;
});

// ───────────── 무료로 시작 ─────────────

test('무료 시작: 빌링키만 받고 결제하지 않는다 — 업체(사업자 정보) → 대표 → 무료 준 기록 → 구독 trialing, 결제 기록 없음', async () => {
  seed();
  seedCert();
  const before = Date.now();
  const res = await start();
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  // 토스: 빌링키 발급 한 번뿐 — 결제 호출이 없다
  assert.deepEqual(tossCalls(), ['POST /v1/billing/authorizations/issue']);
  assert.equal(be.charges().length, 0);
  assert.equal(be.db.payment_history.length, 0, '결제 기록을 만들지 않는다');

  const [c] = be.db.companies;
  assert.equal(be.db.companies.length, 1);
  assert.equal(c.plan, 'manager');
  assert.equal(c.status, 'active');
  assert.equal(c.biz_no, BIZ);
  assert.equal(c.representative_name, '홍길동');
  assert.ok(c.biz_verified_at);
  assert.deepEqual(
    be.db.company_members.map((m) => [m.company_id, m.user_id, m.role, m.status]),
    [[c.id, U1, 'owner', 'active']]
  );

  const [sub] = be.db.subscriptions;
  assert.equal(be.db.subscriptions.length, 1);
  assert.equal(sub.status, 'trialing');
  assert.equal(sub.plan, 'manager');
  assert.equal(sub.amount_krw, 99000, '30일 뒤 처음 결제될 금액');
  assert.equal(sub.billing_key, 'bk_new');
  assert.equal(sub.company_id, c.id);
  assert.equal(sub.next_charge_at, sub.current_period_end);
  const days = (Date.parse(sub.next_charge_at) - before) / DAY;
  assert.ok(days > TRIAL_DAYS - 0.01 && days < TRIAL_DAYS + 0.01, `첫 결제일은 30일 뒤 (${days})`);

  const [g] = be.db.trial_grants;
  assert.equal(be.db.trial_grants.length, 1);
  assert.deepEqual(
    [g.biz_no, g.certificate_id, g.user_id, g.company_id, g.plan, g.subscription_id],
    [BIZ, CERT, U1, c.id, 'manager', sub.id]
  );
  assert.equal(g.ends_at, sub.next_charge_at);
  assert.equal(be.db.business_certificates[0].company_id, c.id, '사업자등록증 줄에 업체를 잇는다');

  // 넣은 차례 — 무료 준 기록이 구독보다 먼저, 구독이 맨 끝(이력 앞)
  const posts = be.calls.rest.filter((r) => r.method === 'POST').map((r) => r.path);
  assert.deepEqual(posts, [
    'companies',
    'company_members',
    'trial_grants',
    'subscriptions',
    'company_events',
  ]);
  assert.deepEqual(be.db.company_events[0].payload, { plan: 'manager', trial: true });

  // 응답 — 오늘 낸 돈 0원, 첫 결제 금액과 날짜
  assert.equal(body.success, true);
  assert.equal(body.data.amount_krw, 0);
  assert.equal(body.data.trial, true);
  assert.equal(body.data.trial_days, 30);
  assert.equal(body.data.first_charge_amount_krw, 99000);
  assert.equal(body.data.next_charge_at, sub.next_charge_at);
  assert.equal(body.data.receipt_url, null);
  assert.equal(body.data.company.status, 'active');
  // 등급 · 개인 크레딧은 쓰지 않는다 (트리거가 맞춘다)
  assert.equal(be.calls.rest.filter((r) => r.path === 'profiles').length, 0);
  assert.equal(be.calls.rest.filter((r) => r.path === 'user_credits').length, 0);
});

test('trial 을 싣지 않으면 확인된 사업자등록증이 있어도 지금처럼 바로 결제한다', async () => {
  seed();
  seedCert();
  const res = await start({ trial: undefined });
  assert.equal(res.status, 200);
  assert.equal(be.charges().length, 1);
  assert.equal(be.charges()[0].body.amount, 99000);
  assert.equal(be.db.subscriptions[0].status, 'active');
  assert.equal(be.db.trial_grants.length, 0);
  assert.equal(be.db.companies[0].biz_no, undefined);
  // trial 이 true 가 아닌 값도 마찬가지
  be.db.subscriptions.length = 0;
  be.db.companies.length = 0;
  be.db.company_members.length = 0;
  const res2 = await start({ trial: 'true' });
  assert.equal(res2.status, 200);
  assert.equal(be.db.subscriptions[0].status, 'active');
});

test('받을 수 없으면 토스를 부르기 전에 멈춘다 — 사업자등록증 없음 · 확인 전 · 이미 받은 번호', async () => {
  seed();
  // 사업자등록증이 없다
  let res = await start();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'trial_no_cert');
  // 아직 확인되지 않은 줄(검토 중 · 올리기만 함 · 반려)은 쓰지 못한다
  for (const status of ['uploaded', 'review', 'rejected', 'superseded']) {
    be.db.business_certificates = [];
    seedCert({ status });
    res = await start();
    assert.equal((await res.json()).code, 'trial_no_cert', status);
  }
  // 이미 무료를 받은 번호
  be.db.business_certificates = [];
  seedCert();
  be.db.trial_grants.push({ id: crypto.randomUUID(), biz_no: BIZ, company_id: C2, plan: 'expert' });
  res = await start();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'trial_used');

  assert.deepEqual(tossCalls(), [], '카드 등록도 결제도 하지 않았다');
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.db.subscriptions.length, 0);
});

test('확인하지 못하면(표 없음 · DB 오류) 결제하지 않고 멈춘다 — 무료인 줄 알고 눌렀는데 결제되는 일이 없다', async () => {
  seed();
  seedCert();
  be.state.failDb = (method, table) => table === 'business_certificates';
  const res = await start();
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'trial_unavailable');
  assert.deepEqual(tossCalls(), []);
  assert.equal(be.db.subscriptions.length, 0);
});

test('새 업체만 — 구독을 가진 적 있는 업체(다시 시작)는 못 받고, 관리자가 만들어 둔 업체의 첫 시작은 받는다', async () => {
  seed();
  seedCert();
  be.db.companies.push({
    id: C1,
    kind: 'partner',
    name: '좋은가구',
    plan: 'manager',
    next_plan: null,
    status: 'closed',
  });
  be.db.company_members.push({
    id: crypto.randomUUID(),
    company_id: C1,
    user_id: U1,
    role: 'owner',
    status: 'active',
  });
  be.db.subscriptions.push({
    id: crypto.randomUUID(),
    company_id: C1,
    user_id: U1,
    plan: 'manager',
    status: 'cancelled',
    provider: 'toss',
    ended_at: iso(Date.now() - DAY),
  });
  let res = await start({ company: undefined });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'trial_not_new');
  assert.deepEqual(tossCalls(), []);

  // 관리자가 만든 업체 — 구독이 한 번도 없었다
  be.db.subscriptions.length = 0;
  be.db.companies[0].status = 'active';
  res = await start({ company: undefined });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(be.db.companies.length, 1, '업체를 새로 만들지 않는다');
  assert.equal(be.db.companies[0].biz_no, BIZ, '그 업체에 사업자 정보를 적는다');
  assert.equal(be.db.subscriptions[0].status, 'trialing');
  assert.equal(be.db.trial_grants[0].company_id, C1);
  assert.equal(be.charges().length, 0);
});

test('사업자번호당 1회 — 그 사이 다른 업체가 받았으면(유니크) 되돌리고 trial_used, 남의 기록은 지우지 않는다', async () => {
  seed();
  seedCert();
  // 미리 보기(select)는 통과시키고, 넣을 때 겹치게 한다
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/company_members') && (init?.method || 'GET') === 'POST') {
      be.db.trial_grants.push({ id: 'other', biz_no: BIZ, company_id: C2, plan: 'expert' });
    }
    return realFetch(input, init);
  };
  const res = await start();
  globalThis.fetch = realFetch;
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, 'trial_used');
  assert.match(body.message, /결제된 금액은 없습니다/);
  assert.equal(be.charges().length, 0);
  assert.equal(be.db.subscriptions.length, 0);
  assert.equal(be.db.companies.length, 0, '만들던 업체를 지운다');
  assert.equal(be.db.company_members.length, 0);
  assert.deepEqual(
    be.db.trial_grants.map((g) => g.id),
    ['other'],
    '먼저 받은 업체의 기록은 그대로'
  );
});

test('구독 저장이 실패하면 모두 되돌린다 — 무료 준 기록도 지워 번호가 「이미 받음」으로 남지 않는다. 취소할 결제는 없다', async () => {
  seed();
  seedCert();
  be.state.failDb = (method, table) => method === 'POST' && table === 'subscriptions';
  const res = await start();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.code, 'SUBSCRIPTION_SAVE_FAILED');
  assert.match(body.message, /결제된 금액은 없습니다/);
  assert.equal(be.db.trial_grants.length, 0);
  assert.equal(be.db.companies.length, 0);
  assert.equal(be.db.company_members.length, 0);
  assert.equal(be.db.subscriptions.length, 0);
  assert.equal(be.db.company_events.length, 0, '이력은 남기지 않는다');
  assert.deepEqual(tossCalls(), ['POST /v1/billing/authorizations/issue'], '결제 취소 호출이 없다');
  // 다시 하면 받는다
  be.state.failDb = null;
  const again = await start();
  assert.equal(again.status, 200);
  assert.equal(be.db.subscriptions[0].status, 'trialing');
});

test('Agent — 승인된 신청이 있으면 같은 길로 무료 시작 (이름 · 지역은 신청 값, 신청은 쓴 것으로)', async () => {
  seed();
  seedCert();
  be.db.partner_applications.push({
    id: A1,
    user_id: U1,
    company_id: null,
    kind: 'new',
    plan: 'agent',
    status: 'approved',
    company_name: '바른인테리어',
    sido: '경기도',
    gugun: '성남시',
    used_at: null,
    created_at: iso(Date.now() - 3 * DAY),
  });
  const res = await start({ plan: 'agent', company: undefined });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(be.charges().length, 0);
  assert.equal(be.db.companies[0].name, '바른인테리어');
  assert.equal(be.db.companies[0].plan, 'agent');
  assert.equal(be.db.subscriptions[0].status, 'trialing');
  assert.equal(be.db.subscriptions[0].amount_krw, 299000);
  assert.ok(be.db.partner_applications[0].used_at);
  assert.equal(body.data.first_charge_amount_krw, 299000);
  // 승인이 없으면 무료 여부를 보기 전에 막힌다
  be.db.partner_applications[0].used_at = null;
  be.db.partner_applications[0].status = 'meeting';
  be.state.users['user-token'] = { id: U2, email: 'd@example.com' };
  const no = await call('/issue-billing-key', {
    auth_key: 'ak',
    customer_key: `dadam-${U2}`,
    plan: 'agent',
    trial: true,
  });
  assert.equal((await no.json()).code, 'agent_not_approved');
});

// ───────────── 30일째 첫 결제 · 알림 ─────────────

const T0 = Date.UTC(2026, 10, 25, 19, 0, 0); // cron: KST 04:00
const S1 = '22222222-2222-4222-8222-222222222222';

/** 무료 이용 중인 업체 구독 — 첫 결제일 endMs */
function seedTrialing(endMs, extra = {}) {
  be.db.profiles.push({ id: U1, email: 'owner@example.com', name: '대표', tier: 'manager' });
  be.db.companies.push({
    id: C1,
    kind: 'partner',
    name: '좋은가구',
    plan: 'manager',
    next_plan: null,
    status: 'active',
    biz_no: BIZ,
  });
  be.db.company_members.push({
    id: crypto.randomUUID(),
    company_id: C1,
    user_id: U1,
    role: 'owner',
    status: 'active',
  });
  be.db.company_credits.push({ company_id: C1, balance: 100, period_end: iso(endMs) });
  be.db.subscriptions.push({
    id: S1,
    company_id: C1,
    user_id: U1,
    plan: 'manager',
    status: 'trialing',
    provider: 'toss',
    billing_key: 'bk_1',
    provider_customer_id: `dadam-${U1}`,
    amount_krw: 99000,
    current_period_start: iso(endMs - 30 * DAY),
    current_period_end: iso(endMs),
    next_charge_at: iso(endMs),
    cancel_at: null,
    cancel_reason: null,
    ended_at: null,
    failed_attempts: 0,
    first_failed_at: null,
    charge_lock_until: null,
    charge_order_id: null,
    created_at: iso(endMs - 30 * DAY),
    ...extra,
  });
}
const sub = () => be.db.subscriptions[0];
const outbox = () =>
  be.db.notification_outbox.map((n) => [n.kind, n.user_id, n.dedupe_key, n.body]);

test('30일째 cron: 무료 이용 중인 구독의 첫 결제 → active · 기간 +30일 · 결제 기록 · 새 달 크레딧', async () => {
  const end = T0 - 5 * 3600_000;
  seedTrialing(end);
  // 하루 전에는 결제하지 않는다
  let summary = await run(T0 - DAY);
  assert.equal(summary.due, 0);
  assert.equal(be.charges().length, 0);
  assert.equal(sub().status, 'trialing');

  summary = await run(T0);
  assert.equal(summary.due, 1);
  assert.equal(summary.charged, 1);
  const [charge] = be.charges();
  assert.equal(charge.body.amount, 99000);
  assert.equal(sub().status, 'active');
  assert.equal(sub().current_period_start, iso(end), '유료 기간은 무료가 끝난 때부터');
  assert.equal(sub().current_period_end, iso(end + 30 * DAY));
  assert.equal(sub().next_charge_at, iso(end + 30 * DAY));
  assert.equal(be.db.payment_history.length, 1);
  assert.equal(be.db.payment_history[0].status, 'done');
  assert.equal(be.db.payment_history[0].amount_krw ?? be.db.payment_history[0].amount, 99000);
  assert.equal(
    be.db.company_credits[0].period_end,
    iso(T0),
    '새 달 크레딧 — 업체 통장 기간을 끊는다'
  );
  assert.equal(be.db.companies[0].status, 'active');
});

test('첫 결제가 거절되면 다른 구독과 같다 — past_due · 1일 뒤 · 3일 뒤 재시도 → 끝내 안 되면 업체 정지', async () => {
  const end = T0 - 5 * 3600_000;
  seedTrialing(end);
  be.state.chargeQueue.push(decline, decline, decline);
  await run(T0);
  assert.equal(sub().status, 'past_due');
  assert.equal(sub().failed_attempts, 1);
  assert.equal(sub().next_charge_at, iso(T0 + DAY));
  assert.equal(be.db.companies[0].status, 'active', '재시도 동안은 그대로 쓴다');
  await run(T0 + DAY);
  assert.equal(sub().failed_attempts, 2);
  assert.equal(sub().next_charge_at, iso(T0 + 3 * DAY));
  const summary = await run(T0 + 3 * DAY);
  assert.equal(summary.cancelled_payment_failed, 1);
  assert.equal(sub().status, 'cancelled');
  assert.equal(sub().cancel_reason, 'payment_failed');
  assert.equal(be.db.companies[0].status, 'suspended');
  // 무료를 준 기록은 남는다 — 같은 번호로 다시 무료를 받지 못한다
  assert.equal(be.charges().length, 3);
});

test('끝나기 7일 전 · 1일 전 알림 — 대표에게 한 번씩, 그 밖의 날에는 넣지 않는다. 글에 금액이 없다', async () => {
  const end = T0 + 10 * DAY + 3600_000;
  seedTrialing(end);
  be.db.company_members.push({
    id: crypto.randomUUID(),
    company_id: C1,
    user_id: U2,
    role: 'staff',
    status: 'active',
  });
  assert.deepEqual(TRIAL_NOTICE_DAYS, [7, 1]);

  // 10일 · 8일 전 — 아직
  assert.equal((await run(T0)).trial_notices, 0);
  await run(T0 + 2 * DAY);
  assert.deepEqual(outbox(), []);
  // 7일 전(남은 날 ≤ 7) — 「7일 뒤」 한 줄, 대표에게만
  const s7 = await run(T0 + 4 * DAY);
  assert.equal(s7.trial_notices, 1);
  const d7 = trialEndingMessage(7);
  assert.deepEqual(outbox(), [['trial_ending', U1, `trial_ending:${S1}:${U1}:d7`, d7.body]]);
  assert.equal(d7.title, '무료 이용 종료 예정');
  assert.equal(
    d7.body,
    '무료 이용이 7일 뒤 끝나고 첫 결제가 진행됩니다. 결제 관리에서 결제일과 금액을 확인해 주세요.'
  );
  assert.equal(d7.url, PUSH_URL);
  assert.doesNotMatch(
    d7.title + d7.body,
    /[0-9],[0-9]{3}|원\b|좋은가구/,
    '금액 · 업체 이름을 싣지 않는다'
  );
  assert.equal(be.db.notification_outbox[0].company_id, C1);
  assert.equal(be.db.notification_outbox[0].ref_id, S1);
  // 그 뒤 날마다 다시 돌아도 같은 알림은 한 번
  await run(T0 + 5 * DAY);
  await run(T0 + 8 * DAY);
  assert.equal(be.db.notification_outbox.length, 1);
  // 1일 전(남은 날 ≤ 1) — 「내일」 한 줄
  await run(T0 + 10 * DAY);
  const d1 = trialEndingMessage(1);
  assert.equal(
    d1.body,
    '무료 이용이 내일 끝나고 첫 결제가 진행됩니다. 결제 관리에서 결제일과 금액을 확인해 주세요.'
  );
  assert.deepEqual(
    outbox().map((o) => o[2]),
    [`trial_ending:${S1}:${U1}:d7`, `trial_ending:${S1}:${U1}:d1`]
  );
  assert.equal(be.charges().length, 0, '알림만 — 결제는 첫 결제일에');
  // 결제일이 된 날에는 알리지 않고 결제한다
  const sPay = await run(T0 + 11 * DAY);
  assert.equal(sPay.trial_notices, 0);
  assert.equal(sPay.charged, 1);
  assert.equal(be.db.notification_outbox.length, 2);
});

test('알림 넣기가 실패해도(0077 적용 전 등) 결제 · 만료는 그대로 돈다', async () => {
  const end = T0 - 3600_000;
  seedTrialing(end);
  be.db.subscriptions.push({
    ...sub(),
    id: crypto.randomUUID(),
    company_id: C2,
    next_charge_at: iso(T0 + 2 * DAY),
    current_period_end: iso(T0 + 2 * DAY),
  });
  be.db.companies.push({
    id: C2,
    kind: 'partner',
    name: '다른가구',
    plan: 'manager',
    next_plan: null,
    status: 'active',
  });
  be.db.company_members.push({
    id: crypto.randomUUID(),
    company_id: C2,
    user_id: U2,
    role: 'owner',
    status: 'active',
  });
  be.state.failDb = (method, table) => table === 'notification_outbox';
  const summary = await run(T0);
  assert.equal(summary.errors, 0);
  assert.equal(summary.charged, 1);
  assert.equal(be.db.notification_outbox.length, 0);
});

// ───────────── 무료 중 해지 · 카드 바꾸기 ─────────────

test('무료 중 해지: 결제 없이 무료 기간 끝까지 쓰고, 기간이 끝나면 업체 closed. 첫 결제는 나가지 않는다', async () => {
  const end = T0 + 10 * DAY;
  be.state.users['user-token'] = { id: U1, email: 'owner@example.com' };
  seedTrialing(end);
  const res = await call('/cancel', { reason: '안 맞음' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.data.trial, true);
  assert.equal(body.data.cancel_at, iso(end));
  assert.match(body.message, /결제 없이/);
  assert.equal(sub().status, 'cancelled');
  assert.equal(sub().next_charge_at, null);
  assert.equal(be.db.companies[0].status, 'active', '무료 기간 끝까지는 쓴다');
  // 무료 기간 중 — 그대로, 알림도 없다
  await run(T0 + 5 * DAY);
  assert.equal(be.db.companies[0].status, 'active');
  assert.equal(be.db.notification_outbox.length, 0);
  // 기간이 끝난 뒤
  const summary = await run(end + DAY);
  assert.equal(summary.ended, 1);
  assert.equal(be.db.companies[0].status, 'closed');
  assert.equal(be.charges().length, 0, '한 번도 결제하지 않았다');
  assert.equal(be.db.payment_history.length, 0);
});

test('무료 중에도 카드를 바꿀 수 있다 — 그 자리에서 결제하지는 않는다', async () => {
  be.state.users['user-token'] = { id: U1, email: 'owner@example.com' };
  seedTrialing(T0 + 10 * DAY);
  be.state.issueResult = { billingKey: 'bk_card2', customerKey: null };
  const res = await call('/subscription/card', { auth_key: 'ak2', customer_key: `dadam-${U1}` });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(sub().billing_key, 'bk_card2');
  assert.equal(sub().status, 'trialing');
  assert.equal(be.charges().length, 0);
});

test('GET /subscription · /plans — 무료 이용 중 상태와 첫 결제일 · 금액, 무료 기간 30일', async () => {
  be.state.users['user-token'] = { id: U1, email: 'owner@example.com' };
  const end = T0 + 10 * DAY;
  seedTrialing(end);
  const res = await call('/subscription', null, 'GET');
  const body = await res.json();
  assert.equal(body.data.status, 'trialing');
  assert.equal(body.data.amount_krw, 99000);
  assert.equal(body.data.next_charge_at, iso(end));
  assert.equal(body.data.billing_key, undefined);
  const plans = await (await call('/plans', null, 'GET')).json();
  assert.equal(plans.data.trial_days, 30);
});

test('알림 글은 workflow-api 의 정본(src/push/messages.js)과 같다 — 7일 전 · 1일 전', () => {
  for (const days of TRIAL_NOTICE_DAYS) {
    const mine = trialEndingMessage(days);
    assert.deepEqual(mine, buildMessage('trial_ending', { daysLeft: days }), `${days}일 전`);
    assert.equal(isValidMessage(mine), true);
  }
});
