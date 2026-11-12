/**
 * 일이 생길 때 앱 알림 넣기 (src/push/hooks.js · worker.js 의 수주 · 확인서 길).
 *
 *   - 대표가 아닌 사람이 되살리기 · 완료 되돌리기를 하면(요청만 남음) → 그 업체 active 대표들에게 order_request
 *     (실장 · 직원 · 빠진 대표 · 다른 업체 대표 없음). 대표가 바로 하면 알리지 않는다
 *   - 대표가 승인 · 반려하면 → 요청한 사람에게 order_request_decided (승인 · 반려 글)
 *   - 고객이 확인서를 승인 · 반려하면 → 설계 업체 대표 · 실장 + 설계를 만든 사람(그 업체 구성원일 때)에게 confirmation_decided
 *   - 글에 고객 이름 · 설계 제목 · 금액이 없다, 수주 번호는 서버 모양일 때만
 *   - 알림 넣기가 실패해도 원래 응답은 그대로 (상태 코드만 로그)
 *   - 같은 일은 한 번만 (ref_id = 요청 줄 · 확인서, dedupe)
 * 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { hashShareToken } from '../src/share.js';
import { sha256Hex } from '../src/util/hash.js';
import { buildMessage } from '../src/push/messages.js';
import { notifyOrderRequest, notifyOrderRequestDecided, notifyConfirmationDecided } from '../src/push/hooks.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  CORS_ORIGINS: 'https://dadamfurniture.com',
  SHARE_TOKEN_PEPPER: 'pepper-for-test',
};

const U = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  owner2: 'a0000000-0000-4000-8000-000000000002',
  manager: 'a0000000-0000-4000-8000-000000000003',
  staff: 'a0000000-0000-4000-8000-000000000004',
  creator: 'a0000000-0000-4000-8000-000000000005',
  removedOwner: 'a0000000-0000-4000-8000-000000000006',
  otherOwner: 'a0000000-0000-4000-8000-000000000007',
  outsider: 'a0000000-0000-4000-8000-000000000008',
};
const CO = {
  hq: 'c0000000-0000-4000-8000-000000000001',
  partner: 'c0000000-0000-4000-8000-000000000002',
  other: 'c0000000-0000-4000-8000-000000000003',
};
const D = 'd0000000-0000-4000-8000-000000000001';
const D_OUTSIDER = 'd0000000-0000-4000-8000-000000000002';
const O1 = 'b0000000-0000-4000-8000-000000000001';
const SNAP = '50000000-0000-4000-8000-000000000001';
const DOC = 'f0000000-0000-4000-8000-000000000001';
const TOKEN = 'share-token-for-test-0123456789abcdefghijklmn';

// 가짜 고객 정보 — 알림 줄 어디에도 나오면 안 된다
const PII = { customer: '홍길동', title: '홍길동네 거실 붙박이장', amount: '12345000' };

const USERS = Object.fromEntries(Object.values(U).map((id) => [`t-${id}`, { id, email: `${id}@example.test` }]));

function tables({ orderStatus = 'cancelled', orderNo = 'SO-20261029-A1B2' } = {}) {
  const mem = (user_id, company_id, role, status = 'active') => ({ id: `m-${user_id}`, user_id, company_id, role, status });
  return {
    companies: [
      { id: CO.hq, kind: 'hq', status: 'active' },
      { id: CO.partner, kind: 'partner', status: 'active' },
      { id: CO.other, kind: 'partner', status: 'active' },
    ],
    company_members: [
      mem(U.owner, CO.partner, 'owner'),
      mem(U.owner2, CO.partner, 'owner'),
      mem(U.manager, CO.partner, 'manager'),
      mem(U.staff, CO.partner, 'staff'),
      mem(U.creator, CO.partner, 'staff'),
      mem(U.removedOwner, CO.partner, 'owner', 'removed'),
      mem(U.otherOwner, CO.other, 'owner'),
    ],
    admin_roles: [],
    designs: [
      { id: D, user_id: U.creator, company_id: CO.partner, title: PII.title },
      { id: D_OUTSIDER, user_id: U.outsider, company_id: CO.partner, title: PII.title },
    ],
    orders: [
      {
        id: O1,
        order_no: orderNo,
        customer_name: PII.customer,
        design_id: D,
        company_id: CO.partner,
        contract_amount: 12345000,
        received_amount: 0,
        status: orderStatus,
        delivered_at: orderStatus === 'completed' ? '2026-10-20T00:00:00.000Z' : null,
        completed_at: orderStatus === 'completed' ? '2026-10-25T00:00:00.000Z' : null,
        note: null,
      },
    ],
    order_events: [],
    design_documents: [],
    design_snapshots: [{ id: SNAP, content_hash: 'snap-hash', design_id: D }],
    document_access_log: [],
    notification_outbox: [],
  };
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

async function call(fake, method, path, who, body, headers = {}) {
  return withFake(fake, async (lines) => {
    const waits = [];
    const h = { Origin: 'https://dadamfurniture.com', ...headers };
    if (who) h.Authorization = `Bearer t-${who}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://workflow.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      ENV,
      { waitUntil: (p) => waits.push(p) },
    );
    await Promise.all(waits);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, lines, waits: waits.length };
  });
}

const outbox = (fake) => fake.db.notification_outbox;
function assertNoPii(fake) {
  const txt = JSON.stringify(outbox(fake));
  for (const v of Object.values(PII)) assert.ok(!txt.includes(v), v);
}

// ── 수주 승인 요청 ─────────────────────────────────────

test('되살리기 요청(대표 아님) → 그 업체 active 대표들에게 order_request, 수주 번호 포함 · 고객 이름 없음', async () => {
  const fake = createFake({ tables: tables(), users: USERS });
  const r = await call(fake, 'PATCH', `/orders/${O1}`, U.staff, { status: 'confirmed', reason: '고객 요청' });
  assert.equal(r.status, 202, r.json && r.json.message);
  const event = fake.db.order_events[0];
  assert.equal(event.state, 'pending');
  const rows = outbox(fake);
  assert.deepEqual(rows.map((x) => x.user_id).sort(), [U.owner, U.owner2].sort());
  for (const row of rows) {
    assert.equal(row.kind, 'order_request');
    assert.equal(row.company_id, CO.partner);
    assert.equal(row.ref_id, event.id);
    assert.equal(row.dedupe_key, `order_request:${event.id}:${row.user_id}`);
    assert.equal(row.title, '승인 요청');
    assert.equal(row.body, '수주 SO-20261029-A1B2 되살리기 요청이 왔습니다. 확인해 주세요.');
    assert.equal(row.url, '/segan/me.html#partner');
  }
  assertNoPii(fake);
  assert.equal(r.waits, 1, '응답 뒤에 넣는다');
});

test('완료 되돌리기 요청(실장) → 대표들에게. 서버 모양이 아닌 수주 번호는 싣지 않는다', async () => {
  const fake = createFake({ tables: tables({ orderStatus: 'completed', orderNo: `${PII.customer}-0001` }), users: USERS });
  const r = await call(fake, 'PATCH', `/orders/${O1}`, U.manager, { status: 'delivered', reason: '하자 보수' });
  assert.equal(r.status, 202);
  assert.deepEqual(
    outbox(fake).map((x) => [x.user_id, x.body]).sort(),
    [
      [U.owner, '수주 완료 되돌리기 요청이 왔습니다. 확인해 주세요.'],
      [U.owner2, '수주 완료 되돌리기 요청이 왔습니다. 확인해 주세요.'],
    ].sort(),
  );
  assertNoPii(fake);
});

test('대표가 바로 되살리면 요청이 아니다 — 알리지 않는다. 보통 상태 바꾸기도 알리지 않는다', async () => {
  let fake = createFake({ tables: tables(), users: USERS });
  let r = await call(fake, 'PATCH', `/orders/${O1}`, U.owner, { status: 'confirmed', reason: '고객 요청' });
  assert.equal(r.status, 200, r.json && r.json.message);
  assert.equal(outbox(fake).length, 0);
  fake = createFake({ tables: tables({ orderStatus: 'confirmed' }), users: USERS });
  r = await call(fake, 'PATCH', `/orders/${O1}`, U.staff, { status: 'in_production' });
  assert.equal(r.status, 200, r.json && r.json.message);
  assert.equal(outbox(fake).length, 0);
});

// ── 요청 결과 ─────────────────────────────────────────

test('대표가 승인 · 반려하면 요청한 사람에게 order_request_decided (승인 · 반려 글)', async () => {
  for (const [decision, word] of [
    ['approved', '승인'],
    ['rejected', '반려'],
  ]) {
    const fake = createFake({ tables: tables(), users: USERS });
    const req = await call(fake, 'PATCH', `/orders/${O1}`, U.staff, { status: 'confirmed', reason: '고객 요청' });
    const eventId = req.json.data.id;
    const before = outbox(fake).length;
    const r = await call(fake, 'POST', `/order-events/${eventId}/decide`, U.owner, { decision });
    assert.equal(r.status, 200, r.json && r.json.message);
    const added = outbox(fake).slice(before);
    assert.equal(added.length, 1);
    assert.deepEqual(
      { user_id: added[0].user_id, company_id: added[0].company_id, kind: added[0].kind, ref_id: added[0].ref_id, dedupe_key: added[0].dedupe_key, title: added[0].title, body: added[0].body },
      {
        user_id: U.staff,
        company_id: CO.partner,
        kind: 'order_request_decided',
        ref_id: eventId,
        dedupe_key: `order_request_decided:${eventId}:${U.staff}`,
        title: '요청 결과',
        body: `수주 SO-20261029-A1B2 되살리기 요청이 ${word}되었습니다.`,
      },
    );
    assertNoPii(fake);
    // 다시 결정할 수 없다 — 알림도 그대로
    const again = await call(fake, 'POST', `/order-events/${eventId}/decide`, U.owner, { decision });
    assert.equal(again.status, 409);
    assert.equal(outbox(fake).length, before + 1);
  }
});

test('결정하지 못하면(대표 아님 · 이미 결정) 알리지 않는다', async () => {
  const fake = createFake({ tables: tables(), users: USERS });
  const req = await call(fake, 'PATCH', `/orders/${O1}`, U.staff, { status: 'confirmed', reason: '고객 요청' });
  const before = outbox(fake).length;
  const r = await call(fake, 'POST', `/order-events/${req.json.data.id}/decide`, U.manager, { decision: 'approved' });
  assert.equal(r.status, 403);
  assert.equal(outbox(fake).length, before);
});

// ── 고객 확인서 ───────────────────────────────────────

async function confirmationFake(designId = D, opts = {}) {
  const t = tables();
  t.design_documents.push({
    id: DOC,
    design_id: designId,
    snapshot_id: SNAP,
    doc_type: 'customer_confirmation',
    rev: 1,
    doc_no: 'DD-20261029-T1-CC-r1',
    title: PII.title,
    customer_name_masked: '홍*동',
    status: 'issued',
    decision: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    share_token_hash: await hashShareToken(ENV, TOKEN),
    content_hash: await sha256Hex('snap-hash|customer_confirmation|1'),
    access_pin_hash: null,
    render_payload: {},
    view_count: 0,
  });
  return createFake({ tables: t, users: USERS, ...opts });
}

test('고객이 확인서를 승인 · 반려 → 설계 업체 대표 · 실장 + 설계를 만든 사람 (다른 직원 · 빠진 대표 없음)', async () => {
  for (const [decision, body] of [
    ['approved', '고객이 확인서를 승인했습니다.'],
    ['rejected', '고객이 확인서를 반려했습니다. 수정 요청을 확인해 주세요.'],
  ]) {
    const fake = await confirmationFake();
    const r = await call(fake, 'POST', '/public/confirm/decision', null, { decision, signer_name: PII.customer }, { 'X-Share-Token': TOKEN });
    assert.equal(r.status, 200, r.json && r.json.message);
    assert.equal(r.json.data.decision, decision);
    const rows = outbox(fake);
    assert.deepEqual(rows.map((x) => x.user_id).sort(), [U.owner, U.owner2, U.manager, U.creator].sort());
    for (const row of rows) {
      assert.equal(row.kind, 'confirmation_decided');
      assert.equal(row.company_id, CO.partner);
      assert.equal(row.ref_id, DOC);
      assert.equal(row.dedupe_key, `confirmation_decided:${DOC}:${row.user_id}:${decision}`);
      assert.deepEqual({ title: row.title, body: row.body, url: row.url }, buildMessage('confirmation_decided', { approved: decision === 'approved' }));
      assert.equal(row.body, body);
    }
    assertNoPii(fake);
    assert.equal(r.waits, 1);
  }
});

test('확인서 — 설계를 만든 사람이 그 업체 구성원이 아니면 대표 · 실장만', async () => {
  const fake = await confirmationFake(D_OUTSIDER);
  const r = await call(fake, 'POST', '/public/confirm/decision', null, { decision: 'approved', signer_name: '고객' }, { 'X-Share-Token': TOKEN });
  assert.equal(r.status, 200);
  assert.deepEqual(outbox(fake).map((x) => x.user_id).sort(), [U.owner, U.owner2, U.manager].sort());
});

test('알림 넣기가 실패해도 응답은 그대로 — 로그는 종류 · 상태 코드만', async () => {
  const failing = await confirmationFake(D, { failDb: (m, p) => (p === 'notification_outbox' ? 503 : 0) });
  const r = await call(failing, 'POST', '/public/confirm/decision', null, { decision: 'approved', signer_name: PII.customer }, { 'X-Share-Token': TOKEN });
  assert.equal(r.status, 200);
  assert.equal(failing.db.design_documents[0].decision, 'approved');
  const pushLines = r.lines.filter((l) => l.includes('[push]'));
  assert.deepEqual(pushLines, ['warn: [push] enqueue failed: confirmation_decided 503']);
  assert.ok(!r.lines.join('\n').includes(PII.title));

  const orderFake = createFake({ tables: tables(), users: USERS, failDb: (m, p) => (p === 'notification_outbox' ? 500 : 0) });
  const req = await call(orderFake, 'PATCH', `/orders/${O1}`, U.staff, { status: 'confirmed', reason: '고객 요청' });
  assert.equal(req.status, 202);
  assert.equal(orderFake.db.order_events.length, 1);
});

// ── 함수 직접 ─────────────────────────────────────────

test('hooks — 맞지 않는 줄은 넣지 않는다 (요청 아님 · 결정 아님 · 확인서 아님 · 스스로 결정)', async () => {
  const fake = createFake({ tables: tables(), users: USERS });
  await withFake(fake, async (lines) => {
    const ev = { id: 'e0000000-0000-4000-8000-000000000001', order_id: O1, kind: 'revive', requested_by: U.staff };
    assert.equal(await notifyOrderRequest(ENV, { ...ev, state: 'done' }), 0);
    assert.equal(await notifyOrderRequest(ENV, { ...ev, state: 'pending', kind: 'status' }), 0);
    assert.equal(await notifyOrderRequest(ENV, null), 0);
    assert.equal(await notifyOrderRequestDecided(ENV, { ...ev, state: 'pending' }), 0);
    assert.equal(await notifyOrderRequestDecided(ENV, { ...ev, state: 'approved', requested_by: U.owner, decided_by: U.owner }), 0);
    assert.equal(await notifyOrderRequestDecided(ENV, { ...ev, state: 'approved', order_id: 'b0000000-0000-4000-8000-0000000000ff', decided_by: U.owner }), 0);
    assert.equal(await notifyConfirmationDecided(ENV, { id: DOC, design_id: D, doc_type: 'work_order', decision: 'approved' }), 0);
    assert.equal(await notifyConfirmationDecided(ENV, { id: DOC, design_id: D, doc_type: 'customer_confirmation', decision: null }), 0);
    assert.equal(await notifyConfirmationDecided(ENV, { id: DOC, design_id: 'd0000000-0000-4000-8000-0000000000ff', doc_type: 'customer_confirmation', decision: 'approved' }), 0);
    assert.equal(outbox(fake).length, 0);
    // 같은 요청을 두 번 → 한 번만
    assert.equal(await notifyOrderRequest(ENV, { ...ev, state: 'pending' }), 2);
    assert.equal(await notifyOrderRequest(ENV, { ...ev, state: 'pending' }), 2);
    assert.equal(outbox(fake).length, 2);
    assert.deepEqual(lines, []);
  });
});

test('hooks — 수주를 못 읽어도 던지지 않는다 (상태 코드만 로그)', async () => {
  const fake = createFake({ tables: tables(), users: USERS, failDb: (m, p) => (p === 'orders' ? 500 : 0) });
  await withFake(fake, async (lines) => {
    const ev = { id: 'e0000000-0000-4000-8000-000000000001', order_id: O1, kind: 'revert', requested_by: U.staff, decided_by: U.owner };
    assert.equal(await notifyOrderRequest(ENV, { ...ev, state: 'pending' }), 0);
    assert.equal(await notifyOrderRequestDecided(ENV, { ...ev, state: 'rejected' }), 0);
    assert.deepEqual(lines, ['warn: [push] order_request hook failed: 500', 'warn: [push] order_request_decided hook failed: 500']);
  });
});
