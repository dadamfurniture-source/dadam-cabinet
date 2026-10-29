/**
 * 수주 상태 바꾸기 규칙 · 기록 · 대표 승인 (src/order-events.js, database/migrations/0013_order_events.sql).
 *
 *   접수 → 생산 중 → 배송 → 완료, 그리고 취소.
 *   바로: 앞으로 가기. 사유가 있어야 바로: 취소 · 한 단계 뒤로.
 *   대표 승인 + 사유: 완료 되돌리기(완료 → 배송) · 되살리기(취소 → 접수).
 *     대표(그 업체 active owner)가 하면 바로, 다른 사람이 하면 요청(pending)만 — 수주는 그대로.
 *   그 밖의 짝은 422 와 바꿀 수 있는 상태 목록.
 *   바뀐 상태는 모두 order_events 에 한 줄 (가짜 DB 가 표의 CHECK · 고치기 막기 트리거를 흉내 낸다).
 *   고객 확인서 승인 전 작업지시서는 사유(early_reason)가 있어야 하고 설계에 기록 한 줄.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { TRANSITIONS, ORDER_STATUS_LABELS, allowedMoves, transitionRule, cleanReason, statusPatch, statusClears } from '../src/order-events.js';
import { issueDocument } from '../src/documents.js';
import worker from '../src/worker.js';
import * as fx from './fixtures/work-order-v2.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const OTHER = 'f0000000-0000-4000-8000-0000000000cc';

const P_OWNER = 'u-p-owner';
const P_MANAGER = 'u-p-manager';
const P_STAFF = 'u-p-staff';
const P_REMOVED_OWNER = 'u-p-removed-owner';
const HQ_OWNER = 'u-hq-owner';
const HQ_STAFF = 'u-hq-staff';
const ADMIN = 'u-admin';
const CREATOR = 'u-creator';
const OTHER_OWNER = 'u-other-owner';
const STRANGER = 'u-stranger';

const MEMBERS = [
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: P_MANAGER, company_id: PARTNER, role: 'manager', status: 'active' },
  { user_id: P_STAFF, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: P_REMOVED_OWNER, company_id: PARTNER, role: 'owner', status: 'removed' },
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
  { user_id: OTHER_OWNER, company_id: OTHER, role: 'owner', status: 'active' },
];

const DESIGNS = {
  'd-p': { id: 'd-p', user_id: P_STAFF, company_id: PARTNER, title: '협력업체 설계' },
  'd-hq': { id: 'd-hq', user_id: CREATOR, company_id: HQ, title: '본사 설계' },
};

const STATUSES = ['confirmed', 'in_production', 'delivered', 'completed', 'cancelled'];

/** 대표 결정 그대로 — now: 바로 · reason: 사유 있으면 바로 · approval: 대표 승인 + 사유 · no: 못 바꾼다 */
const EXPECT = {
  confirmed: { in_production: 'now', delivered: 'now', completed: 'now', cancelled: 'reason' },
  in_production: { confirmed: 'reason', delivered: 'now', completed: 'now', cancelled: 'reason' },
  delivered: { confirmed: 'no', in_production: 'reason', completed: 'now', cancelled: 'reason' },
  completed: { confirmed: 'no', in_production: 'no', delivered: 'approval', cancelled: 'no' },
  cancelled: { confirmed: 'approval', in_production: 'no', delivered: 'no', completed: 'no' },
};
const PAIRS = STATUSES.flatMap((from) => STATUSES.filter((to) => to !== from).map((to) => [from, to, EXPECT[from][to]]));

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});
const dbFail = (code, message) => ({
  ok: false,
  status: 400,
  headers: { get: () => 'application/json' },
  json: async () => ({ code, message }),
  text: async () => JSON.stringify({ code, message }),
});

/** PostgREST 필터 흉내 — eq · in · is.null */
function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'or'].includes(k)) continue;
    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
    const cell = row[k];
    if (op === 'eq' && String(cell) !== val) return false;
    if (op === 'in' && !val.replace(/^\(|\)$/g, '').split(',').includes(String(cell))) return false;
    if (op === 'is' && val === 'null' && cell !== null && cell !== undefined) return false;
  }
  return true;
}

const KINDS = ['status', 'revive', 'revert', 'early_work_order'];
const STATES = ['done', 'pending', 'approved', 'rejected'];

/** order_events 의 CHECK 제약 (0013) — 어기면 이유, 지키면 null */
function eventViolation(e) {
  if (!KINDS.includes(e.kind)) return 'kind';
  if (!STATES.includes(e.state)) return 'state';
  for (const s of [e.from_status, e.to_status]) if (s !== null && s !== undefined && !STATUSES.includes(s)) return 'status_values';
  if (e.kind === 'early_work_order') {
    if (!e.design_id || e.order_id) return 'target';
  } else if (!e.order_id || !e.from_status || !e.to_status || e.from_status === e.to_status) return 'target';
  if (e.kind === 'revive' && e.from_status !== 'cancelled') return 'revive';
  if (e.kind === 'revert' && e.from_status !== 'completed') return 'revert';
  if (e.reason !== null && e.reason !== undefined && e.reason.length > 500) return 'reason_length';
  if (e.kind !== 'status' && !String(e.reason || '').trim()) return 'reason_required';
  if (e.state === 'pending' && (e.decided_at || e.decided_by)) return 'decision';
  if ((e.state === 'approved' || e.state === 'rejected') && !e.decided_at) return 'decision';
  if (!e.company_id) return 'company_id';
  return null;
}

/**
 * 가짜 DB — 수주 · 기록 · 설계 · 구성원 · 관리자.
 *   failEventInsert: 기록 쓰기가 실패한다 (수주를 되돌리는지 본다)
 */
function fakeDb({ orders = [], events = [], failEventInsert = false } = {}) {
  const db = {
    orders: new Map(orders.map((o) => [o.id, { note: null, delivered_at: null, completed_at: null, ...o }])),
    events: events.map((e) => ({ ...e })),
    violations: [],
    seq: 0,
  };
  db.order = (id) => db.orders.get(id);
  db.route = (u, method, body) => {
    const company = companyRoute(u, { hq: HQ, members: MEMBERS });
    if (company) return company;
    const url = new URL(u);
    const q = url.searchParams;
    const table = url.pathname.replace('/rest/v1/', '');
    if (table === 'admin_roles') return json(q.get('user_id') === `eq.${ADMIN}` ? [{ role: 'admin' }] : []);
    if (table === 'designs' && method === 'GET') {
      const id = (q.get('id') || '').replace(/^eq\./, '');
      return json(DESIGNS[id] ? [DESIGNS[id]] : []);
    }
    if (table === 'orders' && method === 'GET') return json([...db.orders.values()].filter((o) => matches(o, q)).map((o) => ({ ...o })));
    if (table === 'orders' && method === 'PATCH') {
      const hit = [...db.orders.values()].filter((o) => matches(o, q));
      for (const o of hit) {
        Object.assign(o, body);
        if (o.status === 'completed' && !o.completed_at) db.violations.push('orders_completed_chk');
      }
      return json(hit.map((o) => ({ ...o })));
    }
    if (table === 'order_events' && method === 'GET') {
      let rows = db.events.filter((e) => matches(e, q));
      const order = q.get('order') || '';
      rows = rows.slice().sort((a, b) => (order.endsWith('.desc') ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return json(rows.map((e) => ({ ...e })));
    }
    if (table === 'order_events' && method === 'POST') {
      if (failEventInsert) return dbFail('XX000', 'insert failed');
      db.seq += 1;
      const row = {
        id: `E${db.seq}`,
        order_id: null,
        design_id: null,
        from_status: null,
        to_status: null,
        reason: null,
        state: 'done',
        requested_by: null,
        decided_by: null,
        decided_at: null,
        created_at: `2026-10-29T00:00:${String(db.seq).padStart(2, '0')}Z`,
        ...body,
      };
      const bad = eventViolation(row);
      if (bad) {
        db.violations.push(bad);
        return dbFail('23514', `order_events check ${bad}`);
      }
      db.events.push(row);
      return json([{ ...row }], 201);
    }
    if (table === 'order_events' && method === 'PATCH') {
      const hit = db.events.filter((e) => matches(e, q));
      for (const e of hit) {
        // trg_order_events_guard — 기다리는 요청의 결정 칸만
        const onlyDecision = Object.keys(body).every((k) => ['state', 'decided_by', 'decided_at'].includes(k));
        if (e.state !== 'pending' || !['approved', 'rejected'].includes(body.state) || !onlyDecision) {
          db.violations.push('guard');
          return dbFail('P0001', 'order_events guard');
        }
      }
      for (const e of hit) {
        Object.assign(e, body);
        const bad = eventViolation(e);
        if (bad) db.violations.push(bad);
      }
      return json(hit.map((e) => ({ ...e })));
    }
    // 다시 계획하기(생산 계획 · 제안 · 보관함) — 읽으면 비어 있고, 쓰기는 받은 그대로
    if (/^production_/.test(table) || ['company_settings', 'work_reports', 'design_snapshots', 'design_schedules'].includes(table)) {
      if (method === 'POST') {
        db.seq += 1;
        return json([{ id: `${table}-${db.seq}`, ...(Array.isArray(body) ? body[0] : body) }], 201);
      }
      return json([]);
    }
    return null;
  };
  return db;
}

/** 다시 계획하기가 남긴 생산 계획 제안 (POST production_proposals) */
const proposalPosts = (calls) => calls.filter((c) => c.method === 'POST' && c.url.split('?')[0].endsWith('/production_proposals'));

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    const res = route(u, method, body);
    if (!res) throw new Error(`unexpected fetch ${method} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** worker.fetch — JWT 확인(/auth/v1/user)은 토큰 이름을 사용자 id 로 돌려준다 */
async function call(db, path, token, { method = 'GET', body } = {}) {
  const route = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: token }) : db.route(u, m, b));
  return withFetch(route, async (calls) => {
    const pending = [];
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      ENV,
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), calls };
  });
}

const patchOrder = (db, token, body, id = 'O1') => call(db, `/orders/${id}`, token, { method: 'PATCH', body });
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !c.url.includes('/auth/'));

function partnerOrder(status, extra = {}) {
  const at = {
    delivered_at: ['delivered', 'completed'].includes(status) ? '2026-10-20T00:00:00.000Z' : null,
    completed_at: status === 'completed' ? '2026-10-25T00:00:00.000Z' : null,
  };
  return { id: 'O1', order_no: 'SO-20261001-AAAA', customer_name: '김고객', design_id: 'd-p', company_id: PARTNER, contract_amount: 1100000, received_amount: 500000, status, ...at, ...extra };
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── 규칙 표 ──────────────────────────────────────────────────────

test('규칙 표가 대표 결정 그대로다 — 20 짝 전부', () => {
  assert.equal(PAIRS.length, 20);
  for (const [from, to, want] of PAIRS) {
    const rule = TRANSITIONS[from][to];
    if (want === 'no') {
      assert.equal(rule, undefined, `${from} → ${to} 는 없다`);
      assert.throws(() => transitionRule(from, to), (e) => e.statusCode === 422 && e.code === 'transition_not_allowed');
      continue;
    }
    assert.ok(rule, `${from} → ${to} 가 있다`);
    assert.equal(rule.approval, want === 'approval', `${from} → ${to} 승인`);
    assert.equal(rule.reason, want === 'reason' || want === 'approval', `${from} → ${to} 사유`);
    const kind = from === 'completed' ? 'revert' : from === 'cancelled' ? 'revive' : 'status';
    assert.equal(rule.kind, kind, `${from} → ${to} 종류`);
  }
  assert.deepEqual(ORDER_STATUS_LABELS, { confirmed: '접수', in_production: '생산 중', delivered: '배송', completed: '완료', cancelled: '취소' });
});

test('못 바꾸는 짝 — 바꿀 수 있는 상태를 우리말로 알려 준다', () => {
  assert.throws(
    () => transitionRule('completed', 'cancelled'),
    (e) => /완료 → 취소 로는 바꿀 수 없습니다/.test(e.message) && /배송\(대표 승인\)/.test(e.message) && e.details.allowed.join() === 'delivered',
  );
  assert.throws(
    () => transitionRule('delivered', 'confirmed'),
    (e) => /바꿀 수 있는 상태: 완료 · 취소 · 생산 중$/.test(e.message),
  );
  assert.deepEqual(allowedMoves('cancelled').map((m) => m.to), ['confirmed']);
});

test('사유 — 앞뒤 공백을 떼고 500자까지, 공백뿐이면 없음', () => {
  assert.equal(cleanReason('  고객 요청  '), '고객 요청');
  assert.equal(cleanReason('   '), '');
  assert.equal(cleanReason(null), '');
  assert.equal(cleanReason(undefined), '');
  assert.equal(cleanReason('가'.repeat(600)).length, 500);
  assert.equal(cleanReason(` ${'가'.repeat(499)}  나`).length, 499, '자른 뒤 끝 공백도 뗀다');
});

test('날짜 — 배송 · 완료에 들어가면 찍고, 완료에서 나가면 완료일 · 배송에서 생산 중으로 가면 배송일을 지운다', () => {
  const empty = { delivered_at: null, completed_at: null };
  assert.match(statusPatch(empty, 'delivered').delivered_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(statusPatch(empty, 'completed').completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(statusPatch({ delivered_at: 'x' }, 'delivered'), { status: 'delivered' }, '이미 있으면 그대로');
  assert.deepEqual(statusPatch(empty, 'completed', { completed_at: '2026-10-01' }), { status: 'completed' }, '보낸 날짜가 있으면 그 값');
  assert.deepEqual(statusClears('completed', 'delivered'), { completed_at: null });
  assert.deepEqual(statusClears('delivered', 'in_production'), { delivered_at: null });
  assert.deepEqual(statusClears('delivered', 'cancelled'), {});
  assert.deepEqual(statusClears('cancelled', 'confirmed'), { delivered_at: null }, '되살리면 배송일을 지운다');
});

// ── PATCH /orders/:id — 짝마다 ────────────────────────────────────

test('PATCH — 짝마다 규칙대로 (staff · 대표 아님): 바로 · 사유 필수 · 승인 요청 · 422', async () => {
  for (const [from, to, want] of PAIRS) {
    const tag = `${from} → ${to}`;
    if (want === 'no') {
      const db = fakeDb({ orders: [partnerOrder(from)] });
      const r = await patchOrder(db, P_STAFF, { status: to, reason: '그냥' });
      assert.equal(r.status, 422, tag);
      assert.equal(r.body.code, 'transition_not_allowed', tag);
      assert.deepEqual(r.body.details.allowed.slice().sort(), Object.keys(EXPECT[from]).filter((t) => EXPECT[from][t] !== 'no').sort(), tag);
      assert.equal(writes(r.calls).length, 0, `${tag} 쓰기 없음`);
      assert.equal(db.order('O1').status, from, tag);
      continue;
    }
    if (want !== 'now') {
      for (const reason of [undefined, '', '   ']) {
        const db = fakeDb({ orders: [partnerOrder(from)] });
        const r = await patchOrder(db, P_STAFF, { status: to, reason });
        assert.equal(r.status, 422, `${tag} 사유 ${JSON.stringify(reason)}`);
        assert.equal(r.body.code, 'reason_required', tag);
        assert.equal(writes(r.calls).length, 0, `${tag} 쓰기 없음`);
      }
    }
    const db = fakeDb({ orders: [partnerOrder(from)] });
    const r = await patchOrder(db, P_STAFF, { status: to, reason: want === 'now' ? undefined : '  고객 요청  ' });
    assert.deepEqual(db.violations, [], tag);
    assert.equal(db.events.length, 1, `${tag} 기록 한 줄`);
    const ev = db.events[0];
    assert.equal(ev.from_status, from, tag);
    assert.equal(ev.to_status, to, tag);
    assert.equal(ev.requested_by, P_STAFF, tag);
    assert.equal(ev.company_id, PARTNER, tag);
    assert.equal(ev.order_id, 'O1', tag);
    assert.equal(ev.reason, want === 'now' ? null : '고객 요청', tag);
    if (want === 'approval') {
      assert.equal(r.status, 202, tag);
      assert.equal(r.body.data.state, 'pending', tag);
      assert.equal(r.body.data.id, ev.id, tag);
      assert.ok(!('company_id' in r.body.data), tag);
      assert.equal(ev.state, 'pending', tag);
      assert.equal(ev.kind, from === 'completed' ? 'revert' : 'revive', tag);
      assert.equal(db.order('O1').status, from, `${tag} 수주는 그대로`);
      assert.ok(!r.calls.some((c) => c.method === 'PATCH'), `${tag} 수주 고치기 없음`);
    } else {
      assert.equal(r.status, 200, tag);
      assert.equal(r.body.data.status, to, tag);
      assert.ok(!('received_amount' in r.body.data), `${tag} staff 응답에 수금액 없음`);
      assert.equal(ev.state, 'done', tag);
      assert.equal(ev.kind, 'status', tag);
      assert.equal(db.order('O1').status, to, tag);
      // 수주는 지금 상태일 때만 고친다 (겹치면 409)
      const patch = r.calls.find((c) => c.method === 'PATCH' && c.url.includes('/orders?'));
      assert.equal(new URL(patch.url).searchParams.get('status'), `eq.${from}`, tag);
    }
  }
});

test('대표가 하면 되돌리기 · 되살리기도 바로 — 기록은 done, 사유가 남는다', async () => {
  for (const [from, to, kind] of [['completed', 'delivered', 'revert'], ['cancelled', 'confirmed', 'revive']]) {
    const db = fakeDb({ orders: [partnerOrder(from)] });
    const noReason = await patchOrder(db, P_OWNER, { status: to });
    assert.equal(noReason.status, 422);
    assert.equal(noReason.body.code, 'reason_required');
    const r = await patchOrder(db, P_OWNER, { status: to, reason: '고객이 다시 원함' });
    assert.equal(r.status, 200, r.body.message);
    assert.equal(r.body.data.status, to);
    assert.equal(r.body.data.received_amount, 500000, '대표는 수금액을 본다');
    assert.deepEqual(db.violations, []);
    assert.equal(db.events.length, 1);
    assert.deepEqual(
      { kind: db.events[0].kind, state: db.events[0].state, reason: db.events[0].reason, by: db.events[0].requested_by },
      { kind, state: 'done', reason: '고객이 다시 원함', by: P_OWNER },
    );
  }
});

test('대표 아님 — 실장 · 빠진 대표 · 본사 관리자 · 본사 설계를 만든 사람은 요청만, 본사 대표는 바로', async () => {
  for (const who of [P_MANAGER, P_REMOVED_OWNER]) {
    const db = fakeDb({ orders: [partnerOrder('completed')] });
    const r = await patchOrder(db, who, { status: 'delivered', reason: '설치 다시' });
    if (who === P_REMOVED_OWNER) {
      // 빠진 구성원은 수주 자체를 못 본다
      assert.equal(r.status, 403);
      assert.equal(db.events.length, 0);
      continue;
    }
    assert.equal(r.status, 202);
    assert.equal(db.order('O1').status, 'completed');
  }
  const hqOrder = partnerOrder('cancelled', { design_id: 'd-hq', company_id: HQ });
  for (const who of [ADMIN, CREATOR, HQ_STAFF]) {
    const db = fakeDb({ orders: [hqOrder] });
    const r = await patchOrder(db, who, { status: 'confirmed', reason: '다시 진행' });
    assert.equal(r.status, 202, who);
    assert.equal(db.events[0].state, 'pending', who);
    assert.equal(db.events[0].company_id, HQ, who);
  }
  const db = fakeDb({ orders: [hqOrder] });
  const r = await patchOrder(db, HQ_OWNER, { status: 'confirmed', reason: '다시 진행' });
  assert.equal(r.status, 200);
  assert.equal(db.order('O1').status, 'confirmed');
  assert.equal(db.events[0].state, 'done');
  // 다른 업체 대표는 이 수주를 못 본다
  const other = await patchOrder(fakeDb({ orders: [partnerOrder('completed')] }), OTHER_OWNER, { status: 'delivered', reason: 'x' });
  assert.equal(other.status, 403);
});

test('한 수주에 기다리는 요청은 하나 — 두 번째는 409 pending_exists', async () => {
  const db = fakeDb({ orders: [partnerOrder('completed')] });
  assert.equal((await patchOrder(db, P_STAFF, { status: 'delivered', reason: '첫 요청' })).status, 202);
  const second = await patchOrder(db, P_MANAGER, { status: 'delivered', reason: '두 번째' });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'pending_exists');
  assert.equal(db.events.length, 1);
  assert.ok(!second.calls.some((c) => c.method === 'POST'));
});

test('기다리는 요청이 있으면 누구도(대표도) 상태를 못 바꾼다 — 409 pending_exists, 아무것도 쓰지 않는다', async () => {
  const cases = [
    // [수주 상태, 요청 (from → to), 그 사이 시도하는 바꾸기]
    ['completed', 'delivered', [[P_OWNER, 'delivered', '대표가 직접'], [P_STAFF, 'delivered', '같은 요청 다시'], [P_MANAGER, 'delivered', '실장']]],
    ['cancelled', 'confirmed', [[P_OWNER, 'confirmed', '대표가 직접 되살리기']]],
  ];
  for (const [from, to, tries] of cases) {
    const db = fakeDb({ orders: [partnerOrder(from)] });
    const req = await patchOrder(db, P_STAFF, { status: to, reason: '첫 요청' });
    assert.equal(req.status, 202);
    for (const [who, target, reason] of tries) {
      const r = await patchOrder(db, who, { status: target, reason });
      assert.equal(r.status, 409, `${who} ${from} → ${target}`);
      assert.equal(r.body.code, 'pending_exists', who);
      assert.equal(r.body.message, '기다리는 요청을 먼저 승인 · 반려해 주세요', who);
      assert.equal(writes(r.calls).length, 0, `${who} 쓰기 없음`);
    }
    assert.equal(db.order('O1').status, from, '수주는 그대로');
    assert.equal(db.events.length, 1, '요청 한 줄뿐');
    assert.equal(db.events[0].state, 'pending');
  }

  // 사유가 필요 없는 앞으로 가기도 — 다른 경로로 생산 중이 된 수주에 기다리는 요청이 남아 있다
  const db = fakeDb({
    orders: [partnerOrder('in_production')],
    events: [{ id: 'E0', company_id: PARTNER, order_id: 'O1', kind: 'revive', from_status: 'cancelled', to_status: 'confirmed', reason: '다시', state: 'pending', requested_by: P_STAFF, created_at: '2026-10-28T00:00:00Z' }],
  });
  for (const [who, target, reason] of [[P_OWNER, 'delivered'], [HQ_OWNER, 'delivered'], [P_STAFF, 'cancelled', '취소'], [P_OWNER, 'confirmed', '한 단계 뒤로']]) {
    const r = await patchOrder(db, who, { status: target, reason });
    if (who === HQ_OWNER) {
      assert.equal(r.status, 403, '다른 업체는 수주를 못 본다');
      continue;
    }
    assert.equal(r.status, 409, `${who} → ${target}`);
    assert.equal(r.body.code, 'pending_exists');
    assert.equal(writes(r.calls).length, 0);
  }
  assert.equal(db.order('O1').status, 'in_production');

  // 상태가 아닌 칸(메모)은 그대로 고친다 · 지금 상태 그대로 보낸 것도 바꾸기가 아니다
  const note = await patchOrder(db, P_STAFF, { note: '메모' });
  assert.equal(note.status, 200);
  assert.equal(db.order('O1').note, '메모');
  assert.equal((await patchOrder(db, P_STAFF, { status: 'in_production' })).status, 200);

  // 반려하면 다시 바꿀 수 있다
  const rejected = await call(db, '/order-events/E0/decide', P_OWNER, { method: 'POST', body: { decision: 'rejected' } });
  assert.equal(rejected.status, 200);
  const after = await patchOrder(db, P_OWNER, { status: 'delivered' });
  assert.equal(after.status, 200, after.body.message);
  assert.equal(db.order('O1').status, 'delivered');
  assert.deepEqual(db.violations, []);
});

test('승인하면 다시 바꿀 수 있다 — 기다리는 요청이 없어진다', async () => {
  const db = fakeDb({ orders: [partnerOrder('completed')] });
  const req = await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자' });
  assert.equal((await patchOrder(db, P_OWNER, { status: 'delivered', reason: '직접' })).status, 409, '요청 중에는 대표도 막힌다');
  const ok =await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(ok.status, 200);
  assert.equal(db.order('O1').status, 'delivered');
  const next = await patchOrder(db, P_STAFF, { status: 'completed' });
  assert.equal(next.status, 200, next.body.message);
  assert.equal(db.order('O1').status, 'completed');
});

test('되살리기(취소 → 접수) — 배송일을 지운다 (대표가 바로 · 승인으로)', async () => {
  // 배송 뒤에 취소된 수주 — 배송일이 남아 있다
  const cancelledAfterDelivery = () => partnerOrder('cancelled', { delivered_at: '2026-10-20T00:00:00.000Z' });
  let db = fakeDb({ orders: [cancelledAfterDelivery()] });
  const direct = await patchOrder(db, P_OWNER, { status: 'confirmed', reason: '고객이 다시 원함' });
  assert.equal(direct.status, 200, direct.body.message);
  assert.equal(db.order('O1').status, 'confirmed');
  assert.equal(db.order('O1').delivered_at, null);
  assert.equal(db.order('O1').completed_at, null);
  assert.equal(direct.calls.find((c) => c.method === 'PATCH' && c.url.includes('/orders?')).body.delivered_at, null);

  // 배송일을 같이 보내도 지운다 (상태 규칙이 앞선다)
  db = fakeDb({ orders: [cancelledAfterDelivery()] });
  await patchOrder(db, P_OWNER, { status: 'confirmed', reason: '다시', delivered_at: '2026-10-21' });
  assert.equal(db.order('O1').delivered_at, null);

  db = fakeDb({ orders: [cancelledAfterDelivery()] });
  const req = await patchOrder(db, P_STAFF, { status: 'confirmed', reason: '다시 진행' });
  assert.equal(req.status, 202);
  assert.equal(db.order('O1').delivered_at, '2026-10-20T00:00:00.000Z', '요청만으로는 그대로');
  const ok = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(ok.status, 200, ok.body.message);
  assert.equal(db.order('O1').status, 'confirmed');
  assert.equal(db.order('O1').delivered_at, null);
  assert.equal(ok.body.data.order.delivered_at, null);
  assert.deepEqual(db.violations, []);
});

test('되살리기가 적용되면 취소 때처럼 다시 계획한다 — 본사 수주일 때만 (대표가 바로 · 승인으로)', async () => {
  const hqOrder = () => partnerOrder('cancelled', { design_id: 'd-hq', company_id: HQ });

  // 본사 대표가 바로
  let db = fakeDb({ orders: [hqOrder()] });
  const direct = await patchOrder(db, HQ_OWNER, { status: 'confirmed', reason: '다시 진행' });
  assert.equal(direct.status, 200, direct.body.message);
  const plan = proposalPosts(direct.calls);
  assert.equal(plan.length, 1, '다시 계획한다');
  assert.equal(plan[0].body.user_id, HQ_OWNER);
  assert.equal(plan[0].body.trigger, 'manual', '취소 때와 같은 방식');
  assert.equal(plan[0].body.plan.triggerLabel, '수주 되살리기 SO-20261001-AAAA');

  // 본사 직원이 요청 → 요청만으로는 계획하지 않는다 → 대표가 승인하면 그때
  db = fakeDb({ orders: [hqOrder()] });
  const req = await patchOrder(db, HQ_STAFF, { status: 'confirmed', reason: '다시 진행' });
  assert.equal(req.status, 202);
  assert.equal(proposalPosts(req.calls).length, 0);
  const approved = await call(db, `/order-events/${req.body.data.id}/decide`, HQ_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(approved.status, 200, approved.body.message);
  assert.equal(proposalPosts(approved.calls).length, 1);
  assert.equal(proposalPosts(approved.calls)[0].body.user_id, HQ_OWNER, '승인한 사람으로 계획한다');

  // 반려 — 계획하지 않는다
  db = fakeDb({ orders: [hqOrder()] });
  const req2 = await patchOrder(db, HQ_STAFF, { status: 'confirmed', reason: '다시 진행' });
  const rejected = await call(db, `/order-events/${req2.body.data.id}/decide`, HQ_OWNER, { method: 'POST', body: { decision: 'rejected' } });
  assert.equal(rejected.status, 200);
  assert.equal(proposalPosts(rejected.calls).length, 0);

  // 완료 되돌리기 승인 — 되살리기가 아니라 계획하지 않는다 (예전 그대로)
  db = fakeDb({ orders: [partnerOrder('completed', { design_id: 'd-hq', company_id: HQ })] });
  const req3 = await patchOrder(db, HQ_STAFF, { status: 'delivered', reason: '하자' });
  const revert = await call(db, `/order-events/${req3.body.data.id}/decide`, HQ_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(revert.status, 200);
  assert.equal(proposalPosts(revert.calls).length, 0);

  // 협력업체 수주 — 본사 계획을 건드리지 않는다 (바로 · 승인 모두)
  db = fakeDb({ orders: [partnerOrder('cancelled')] });
  const partnerDirect = await patchOrder(db, P_OWNER, { status: 'confirmed', reason: '다시' });
  assert.equal(partnerDirect.status, 200);
  assert.ok(!partnerDirect.calls.some((c) => c.url.includes('/production_')));
  db = fakeDb({ orders: [partnerOrder('cancelled')] });
  const partnerReq = await patchOrder(db, P_STAFF, { status: 'confirmed', reason: '다시' });
  const partnerOk = await call(db, `/order-events/${partnerReq.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(partnerOk.status, 200);
  assert.ok(!partnerOk.calls.some((c) => c.url.includes('/production_')));
});

test('취소하면 다시 계획한다 — 본사 수주 (예전 그대로)', async () => {
  const db = fakeDb({ orders: [partnerOrder('confirmed', { design_id: 'd-hq', company_id: HQ })] });
  const r = await patchOrder(db, HQ_STAFF, { status: 'cancelled', reason: '고객 변심' });
  assert.equal(r.status, 200, r.body.message);
  assert.equal(proposalPosts(r.calls).length, 1);
  assert.equal(proposalPosts(r.calls)[0].body.plan.triggerLabel, '수주 취소 SO-20261001-AAAA');
});

test('승인을 기다리면 같이 보낸 다른 칸도 쓰지 않는다 — 수주는 그대로', async () => {
  const db = fakeDb({ orders: [partnerOrder('completed', { note: '원래 메모' })] });
  const r = await patchOrder(db, P_MANAGER, { status: 'delivered', reason: '재설치', note: '새 메모', received_amount: 900000 });
  assert.equal(r.status, 202);
  assert.equal(db.order('O1').note, '원래 메모');
  assert.equal(db.order('O1').received_amount, 500000);
  assert.ok(!r.calls.some((c) => c.method === 'PATCH'));
});

test('지금 상태와 같은 status 는 바꾸기가 아니다 — 기록 없이 다른 칸만', async () => {
  const db = fakeDb({ orders: [partnerOrder('in_production')] });
  const same = await patchOrder(db, P_STAFF, { status: 'in_production' });
  assert.equal(same.status, 200);
  assert.equal(same.body.data.status, 'in_production');
  assert.equal(writes(same.calls).length, 0);
  const withNote = await patchOrder(db, P_STAFF, { status: 'in_production', note: '메모' });
  assert.equal(withNote.status, 200);
  assert.deepEqual(withNote.calls.find((c) => c.method === 'PATCH').body, { note: '메모' });
  assert.equal(db.events.length, 0);
  // 상태 없이 다른 칸만 — 예전 그대로 (협력업체 수주라 구분 대신 메모)
  const other = await patchOrder(db, P_STAFF, { note: '다른 메모' });
  assert.equal(other.status, 200);
  assert.equal(db.events.length, 0);
});

test('바로 바꿀 때 같이 보낸 칸도 한 번에 쓴다', async () => {
  const db = fakeDb({ orders: [partnerOrder('confirmed')] });
  const r = await patchOrder(db, P_OWNER, { status: 'in_production', note: '재단 시작', received_amount: 600000 });
  assert.equal(r.status, 200);
  const patches = r.calls.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].body, { status: 'in_production', received_amount: 600000, note: '재단 시작' });
});

test('기록을 못 남기면 수주를 되돌리고 실패를 돌려준다 — 기록 없는 상태 변경을 남기지 않는다', async () => {
  const db = fakeDb({ orders: [partnerOrder('delivered')], failEventInsert: true });
  const r = await patchOrder(db, P_STAFF, { status: 'completed' });
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(db.order('O1').status, 'delivered');
  assert.equal(db.order('O1').completed_at, null);
  const restore = r.calls.filter((c) => c.method === 'PATCH').pop();
  assert.equal(new URL(restore.url).searchParams.get('status'), 'eq.completed', '되돌리기도 바꾼 상태일 때만');
});

test('그 사이 상태가 바뀌었으면 409 stale — 기록도 남기지 않는다', async () => {
  const db = fakeDb({ orders: [partnerOrder('confirmed')] });
  const route = db.route;
  // 읽은 뒤 다른 요청이 먼저 바꾼 것처럼 — 고치기 직전에 상태를 바꿔 둔다
  db.route = (u, method, body) => {
    if (method === 'PATCH' && u.includes('/orders?')) db.order('O1').status = 'cancelled';
    return route(u, method, body);
  };
  const r = await patchOrder(db, P_STAFF, { status: 'in_production' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'stale');
  assert.equal(db.events.length, 0);
});

// ── 날짜 ─────────────────────────────────────────────────────────

test('날짜 — 배송 · 완료에 들어가면 찍는다 (예전 그대로), 보낸 날짜가 있으면 그 값', async () => {
  let db = fakeDb({ orders: [partnerOrder('confirmed')] });
  await patchOrder(db, P_STAFF, { status: 'delivered' });
  assert.match(db.order('O1').delivered_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.order('O1').completed_at, null);

  db = fakeDb({ orders: [partnerOrder('delivered')] });
  await patchOrder(db, P_STAFF, { status: 'completed' });
  assert.match(db.order('O1').completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.order('O1').delivered_at, '2026-10-20T00:00:00.000Z', '배송일은 그대로');

  db = fakeDb({ orders: [partnerOrder('confirmed')] });
  await patchOrder(db, P_STAFF, { status: 'completed', completed_at: '2026-10-28T09:00:00+09:00' });
  assert.equal(db.order('O1').completed_at, '2026-10-28T00:00:00.000Z');
  assert.equal(db.order('O1').delivered_at, null, '배송을 건너뛰면 배송일은 비어 있다');
  assert.deepEqual(db.violations, []);
});

test('날짜 — 배송에서 생산 중으로 돌아가면 배송일을 지운다 (보낸 날짜보다 앞선다)', async () => {
  const db = fakeDb({ orders: [partnerOrder('delivered')] });
  const r = await patchOrder(db, P_STAFF, { status: 'in_production', reason: '도어 다시 제작', delivered_at: '2026-10-21' });
  assert.equal(r.status, 200);
  assert.equal(db.order('O1').delivered_at, null);
  assert.equal(r.calls.find((c) => c.method === 'PATCH').body.delivered_at, null);
});

test('날짜 — 완료를 되돌리면 완료일을 지우고, 배송일이 비어 있었으면 그때 찍는다', async () => {
  // 대표가 바로
  let db = fakeDb({ orders: [partnerOrder('completed')] });
  await patchOrder(db, P_OWNER, { status: 'delivered', reason: '하자 보수' });
  assert.equal(db.order('O1').completed_at, null);
  assert.equal(db.order('O1').delivered_at, '2026-10-20T00:00:00.000Z');
  // 승인으로 — 배송을 건너뛰고 완료됐던 수주
  db = fakeDb({ orders: [partnerOrder('completed', { delivered_at: null })] });
  const req = await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자 보수' });
  const ok = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(ok.status, 200, ok.body.message);
  assert.equal(db.order('O1').completed_at, null);
  assert.match(db.order('O1').delivered_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(db.violations, []);
});

// ── 대표 승인 · 반려 ─────────────────────────────────────────────

test('승인 — 대표가 승인하면 그때 바뀌고, 요청 줄이 approved (결정한 사람 · 때). 새 줄은 없다', async () => {
  for (const [from, to] of [['completed', 'delivered'], ['cancelled', 'confirmed']]) {
    const db = fakeDb({ orders: [partnerOrder(from)] });
    const req = await patchOrder(db, P_STAFF, { status: to, reason: '고객 요청' });
    assert.equal(req.status, 202);
    const r = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
    assert.equal(r.status, 200, r.body.message);
    assert.equal(r.body.data.event.state, 'approved');
    assert.equal(r.body.data.event.decided_by, P_OWNER);
    assert.match(r.body.data.event.decided_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(r.body.data.event.requested_by, P_STAFF, '요청한 사람은 그대로');
    assert.equal(r.body.data.order.status, to);
    assert.equal(db.order('O1').status, to);
    assert.equal(db.events.length, 1);
    assert.deepEqual(db.violations, []);
    const patch = r.calls.find((c) => c.method === 'PATCH' && c.url.includes('/orders?'));
    assert.equal(new URL(patch.url).searchParams.get('status'), `eq.${from}`);
    // 이미 결정됨
    const again = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'already_decided');
  }
});

test('반려 — rejected, 수주는 그대로. 반려 뒤에는 새 요청을 낼 수 있다', async () => {
  const db = fakeDb({ orders: [partnerOrder('cancelled')] });
  const req = await patchOrder(db, P_STAFF, { status: 'confirmed', reason: '다시' });
  const r = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'rejected' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.event.state, 'rejected');
  assert.equal(r.body.data.event.decided_by, P_OWNER);
  assert.equal(r.body.data.order, null);
  assert.equal(db.order('O1').status, 'cancelled');
  assert.ok(!r.calls.some((c) => c.method === 'PATCH' && c.url.includes('/orders?')));
  assert.equal((await patchOrder(db, P_STAFF, { status: 'confirmed', reason: '정말 다시' })).status, 202);
  assert.deepEqual(db.violations, []);
});

test('승인할 때 수주 상태가 요청 때와 다르면 409 stale — 요청은 기다림 그대로, 반려는 된다', async () => {
  const db = fakeDb({ orders: [partnerOrder('completed')] });
  const req = await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자' });
  // 그 사이 다른 경로로 상태가 바뀌었다 (이 워커의 PATCH 는 기다리는 요청이 있으면 막는다)
  db.order('O1').status = 'delivered';
  const stale = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale');
  assert.match(stale.body.message, /지금 배송 상태/);
  assert.equal(db.events.find((e) => e.id === req.body.data.id).state, 'pending');
  assert.equal(db.order('O1').status, 'delivered');
  assert.ok(!stale.calls.some((c) => c.method === 'PATCH'));
  const rejected = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'rejected' } });
  assert.equal(rejected.status, 200);
  assert.equal(db.events.find((e) => e.id === req.body.data.id).state, 'rejected');
});

test('승인 · 반려는 그 업체 대표만 — 실장 · staff · 관리자 · 다른 업체 대표는 403 not_owner', async () => {
  const db = fakeDb({ orders: [partnerOrder('completed')] });
  const req = await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자' });
  for (const who of [P_MANAGER, P_STAFF, P_REMOVED_OWNER, ADMIN, OTHER_OWNER, HQ_OWNER]) {
    const r = await call(db, `/order-events/${req.body.data.id}/decide`, who, { method: 'POST', body: { decision: 'approved' } });
    assert.equal(r.status, 403, who);
    assert.equal(r.body.code, 'not_owner', who);
    assert.equal(writes(r.calls).length, 0, who);
  }
  const bad = await call(db, `/order-events/${req.body.data.id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'maybe' } });
  assert.equal(bad.status, 422);
  const missing = await call(db, '/order-events/E404/decide', P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.equal(missing.status, 404);
  assert.equal(db.order('O1').status, 'completed');
});

// ── 읽기 ─────────────────────────────────────────────────────────

test('GET /orders/:id/events — 수주를 보는 사람 누구나, 최근 것 먼저, 금액 · 업체 칸 없음', async () => {
  const db = fakeDb({ orders: [partnerOrder('confirmed')] });
  await patchOrder(db, P_STAFF, { status: 'in_production' });
  await patchOrder(db, P_STAFF, { status: 'delivered' });
  await patchOrder(db, P_STAFF, { status: 'completed' });
  await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자' });

  const staff = await call(db, '/orders/O1/events', P_STAFF);
  assert.equal(staff.status, 200);
  const d = staff.body.data;
  assert.deepEqual(d.items.map((e) => `${e.from_status}>${e.to_status}:${e.state}`), [
    'completed>delivered:pending',
    'delivered>completed:done',
    'in_production>delivered:done',
    'confirmed>in_production:done',
  ]);
  for (const e of d.items) {
    assert.deepEqual(Object.keys(e).filter((k) => /amount|company/.test(k)), [], '금액 · 업체 칸 없음');
  }
  assert.equal(d.status, 'completed');
  assert.equal(d.can_decide, false);
  assert.equal(d.pending.id, d.items[0].id);
  assert.deepEqual(d.moves, [{ to: 'delivered', label: '배송', kind: 'revert', approval: true, reason_required: true, request: true }]);

  const owner = await call(db, '/orders/O1/events', P_OWNER);
  assert.equal(owner.body.data.can_decide, true);
  assert.equal(owner.body.data.moves[0].request, false, '대표가 고르면 바로 바뀐다');

  for (const who of [STRANGER, OTHER_OWNER, ADMIN]) {
    assert.equal((await call(db, '/orders/O1/events', who)).status, 403, who);
  }
  assert.equal((await call(db, '/orders/O404/events', P_STAFF)).status, 404);
});

test('GET /orders/:id/events — 지금 상태에서 바꿀 수 있는 것만 moves 에 (사유 필수 표시)', async () => {
  const db = fakeDb({ orders: [partnerOrder('delivered')] });
  const r = await call(db, '/orders/O1/events', P_STAFF);
  assert.deepEqual(
    r.body.data.moves.map((m) => [m.to, m.label, m.reason_required, m.request]),
    [['completed', '완료', false, false], ['cancelled', '취소', true, false], ['in_production', '생산 중', true, false]],
  );
  assert.equal(r.body.data.pending, null);
  assert.deepEqual(r.body.data.items, []);
});

test('GET /order-requests?state=pending — 내가 대표인 업체의 요청만, 수주번호 · 고객 이름만 붙인다', async () => {
  const db = fakeDb({
    orders: [partnerOrder('completed'), partnerOrder('cancelled', { id: 'O2', order_no: 'SO-2', customer_name: '이고객', contract_amount: 9 }),
      partnerOrder('cancelled', { id: 'O3', order_no: 'SO-3', design_id: 'd-hq', company_id: HQ })],
  });
  await patchOrder(db, P_STAFF, { status: 'delivered', reason: '하자' });
  await patchOrder(db, P_MANAGER, { status: 'confirmed', reason: '다시' }, 'O2');
  await patchOrder(db, ADMIN, { status: 'confirmed', reason: '본사 다시' }, 'O3');

  const owner = await call(db, '/order-requests?state=pending', P_OWNER);
  assert.equal(owner.status, 200);
  const items = owner.body.data.items;
  assert.deepEqual(items.map((i) => [i.order_id, i.order_no, i.customer_name, i.kind, i.reason]), [
    ['O1', 'SO-20261001-AAAA', '김고객', 'revert', '하자'],
    ['O2', 'SO-2', '이고객', 'revive', '다시'],
  ]);
  for (const i of items) assert.deepEqual(Object.keys(i).filter((k) => /amount|company/.test(k)), []);
  const orderRead = owner.calls.find((c) => c.method === 'GET' && c.url.includes('/orders?id=in.'));
  assert.equal(new URL(orderRead.url).searchParams.get('select'), 'id,order_no,customer_name');

  const hq = await call(db, '/order-requests', HQ_OWNER);
  assert.deepEqual(hq.body.data.items.map((i) => i.order_id), ['O3']);
  for (const who of [P_MANAGER, P_STAFF, ADMIN, STRANGER]) {
    const r = await call(db, '/order-requests?state=pending', who);
    assert.deepEqual(r.body.data.items, [], who);
  }
  assert.equal((await call(db, '/order-requests?state=approved', P_OWNER)).status, 422);
  // 승인하면 목록에서 빠진다
  await call(db, `/order-events/${items[0].id}/decide`, P_OWNER, { method: 'POST', body: { decision: 'approved' } });
  assert.deepEqual((await call(db, '/order-requests', P_OWNER)).body.data.items.map((i) => i.order_id), ['O2']);
});

test('취소하면 예전처럼 다시 계획한다 — 협력업체 수주는 본사 계획을 건드리지 않는다', async () => {
  const db = fakeDb({ orders: [partnerOrder('confirmed')] });
  const r = await patchOrder(db, P_STAFF, { status: 'cancelled', reason: '고객 변심' });
  assert.equal(r.status, 200);
  assert.equal(db.events[0].reason, '고객 변심');
  assert.ok(!r.calls.some((c) => c.url.includes('/production_')), '본사 일이 아니면 계획을 돌리지 않는다');
});

// ── 승인 전 작업지시서 ───────────────────────────────────────────

/** 문서 발행 가짜 — 협력업체 설계 D1. approvedCC: 고객이 승인한 확인서가 있다 */
function issueDb({ approvedCC = false } = {}) {
  const events = [];
  const route = (u, method, body) => {
    const company = companyRoute(u, { hq: HQ, members: MEMBERS });
    if (company) return company;
    const path = u.split('?')[0];
    if (u.includes('/admin_roles?')) return json([]);
    if (/\/designs\?/.test(u)) return json([{ id: 'D1', user_id: P_STAFF, title: '테스트 설계', company_id: PARTNER }]);
    if (/\/design_snapshots\?id=eq\./.test(u)) return json([fx.snapshot()]);
    if (/\/design_snapshots\?/.test(u)) return json([]);
    if (method === 'POST' && /\/order_events$/.test(path)) {
      const row = { id: `EW${events.length + 1}`, order_id: null, from_status: null, to_status: null, state: 'done', ...body };
      const bad = eventViolation(row);
      if (bad) return dbFail('23514', bad);
      events.push(row);
      return json([row], 201);
    }
    if (method === 'POST' && /\/design_documents$/.test(path)) return json([{ id: 'DOC-NEW', ...body }], 201);
    if (method === 'PATCH' && /\/design_documents$/.test(path)) return json([]);
    if (/\/design_documents\?/.test(u)) {
      const q = new URL(u).searchParams;
      if (q.get('doc_type') === 'eq.customer_confirmation' && q.get('decision') === 'eq.approved') return json(approvedCC ? [{ id: 'CC1' }] : []);
      return json([]);
    }
    if (/\/(design_renders|materials|orders|work_reports)\?/.test(u) || /\/work_reports$/.test(path)) return json([]);
    return null;
  };
  return { route, events };
}

const posts = (calls, table) => calls.filter((c) => c.method === 'POST' && c.url.split('?')[0].endsWith(`/${table}`));

test('승인 전 작업지시서 — 사유(early_reason)가 없으면 422 reason_required, 아무것도 쓰지 않는다', async () => {
  for (const early of [undefined, '', '   ']) {
    const fake = issueDb();
    await withFetch(fake.route, async (calls) => {
      await assert.rejects(
        issueDocument(ENV, { user: { id: P_STAFF }, body: { doc_type: 'work_order', snapshot_id: 'S2', early_reason: early } }),
        (e) => e.statusCode === 422 && e.code === 'reason_required' && /승인 전/.test(e.message),
      );
      assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
    });
  }
  // 예전 화면처럼 특기사항에만 적어 보내도 사유로 치지 않는다
  const fake = issueDb();
  await withFetch(fake.route, async () => {
    await assert.rejects(
      issueDocument(ENV, { user: { id: P_STAFF }, body: { doc_type: 'work_order', snapshot_id: 'S2', instructions: '고객 승인 전 발행 — 사유: 급함' } }),
      (e) => e.code === 'reason_required',
    );
  });
});

test('승인 전 작업지시서 — 설계 업체로 기록 한 줄(early_work_order) 먼저, 사유는 특기사항 첫 줄에', async () => {
  const fake = issueDb();
  await withFetch(fake.route, async (calls) => {
    await issueDocument(ENV, { user: { id: P_STAFF, email: 's@x' }, body: { doc_type: 'work_order', snapshot_id: 'S2', early_reason: '  급한 현장  ' } });
    assert.equal(fake.events.length, 1);
    const ev = fake.events[0];
    assert.deepEqual(
      { company_id: ev.company_id, design_id: ev.design_id, order_id: ev.order_id, kind: ev.kind, reason: ev.reason, state: ev.state, requested_by: ev.requested_by },
      { company_id: PARTNER, design_id: 'D1', order_id: null, kind: 'early_work_order', reason: '급한 현장', state: 'done', requested_by: P_STAFF },
    );
    assert.ok(!('order_id' in posts(calls, 'order_events')[0].body), '수주 칸은 보내지 않는다');
    const doc = posts(calls, 'design_documents')[0];
    assert.equal(doc.body.render_payload.instructions, '고객 승인 전 발행 — 사유: 급한 현장');
    assert.ok(calls.indexOf(posts(calls, 'order_events')[0]) < calls.indexOf(doc), '기록이 문서보다 먼저');
  });
  const withNote = issueDb();
  await withFetch(withNote.route, async (calls) => {
    await issueDocument(ENV, { user: { id: P_STAFF }, body: { doc_type: 'work_order', snapshot_id: 'S2', early_reason: '급한 현장', instructions: ' 문 쪽 조심 ' } });
    assert.equal(posts(calls, 'design_documents')[0].body.render_payload.instructions, '고객 승인 전 발행 — 사유: 급한 현장\n문 쪽 조심');
  });
});

test('고객이 확인서를 승인했으면 사유를 묻지 않고 기록도 남기지 않는다 · 확인서 발행은 상관없다', async () => {
  const approved = issueDb({ approvedCC: true });
  await withFetch(approved.route, async (calls) => {
    await issueDocument(ENV, { user: { id: P_STAFF }, body: { doc_type: 'work_order', snapshot_id: 'S2', early_reason: '필요 없음' } });
    assert.equal(approved.events.length, 0);
    assert.equal(posts(calls, 'design_documents')[0].body.render_payload.instructions, '');
  });
  const cc = issueDb();
  await withFetch(cc.route, async (calls) => {
    await issueDocument(ENV, { user: { id: P_STAFF }, body: { doc_type: 'customer_confirmation', snapshot_id: 'S2' } });
    assert.equal(cc.events.length, 0);
    assert.ok(!calls.some((c) => c.url.includes('decision=eq.approved')), '확인서는 승인 여부를 보지 않는다');
  });
});

test('POST /snapshots/:id/documents — 승인 전 사유가 없으면 422 와 code reason_required', async () => {
  const fake = issueDb();
  const route = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: P_STAFF }) : fake.route(u, m, b));
  await withFetch(route, async () => {
    const res = await worker.fetch(
      new Request('https://api.test/snapshots/S2/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${P_STAFF}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: 'work_order' }),
      }),
      ENV,
      { waitUntil: () => {} },
    );
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, 'reason_required');
  });
});
