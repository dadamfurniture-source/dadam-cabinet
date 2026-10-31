/**
 * 업체 장부 요약 (GET /books/summary — src/books.js) · 작업 기록의 업체 (production/worker-access.js).
 *   작업 기록에 적는 주문은 링크 주인의 본사 수주만 — 남의 주문 · 협력업체 주문은 422, 기록은 남기지 않는다
 *
 *   그 업체 active 대표 · 실장만 → 그 업체 것 (본사 포함). staff 403 not_money, 구성원이 아니면(관리자여도) 403 not_member
 *   숫자는 본사 월 손익(summarizeMonth)과 같은 식 — 매출 = 계약금 ÷ 1.1, 견적 원가 = 스냅샷 cost.total − fixed_recovery
 *   달 묶음 = ordered_at (KST), 취소 뺌 · 받은 돈 = paid_on 이 그 달 · 실적 마진은 실적 원가가 있는 수주만
 *   밀린 돈 = 받기로 한 날 < 오늘(KST) · 안 받음 · 취소 수주 뺌 · 받을 돈 = 오늘 ~ +30일, 20개, 날짜 순
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { summarizeBooks, booksCompanyOf, UPCOMING_MAX } from '../src/books.js';
import { summarizeMonth, kstDate } from '../src/production/service.js';
import { addWorklog, worklogCompanyOf, createWorkerLink } from '../src/production/worker-access.js';
import worker from '../src/worker.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const P_OWNER = 'u-p-owner';
const P_MANAGER = 'u-p-manager';
const P_STAFF = 'u-p-staff';
const P_REMOVED = 'u-p-removed';
const HQ_OWNER = 'u-hq-owner';
const HQ_MANAGER = 'u-hq-manager';
const HQ_STAFF = 'u-hq-staff';
const ADMIN = 'u-admin';
const STRANGER = 'u-stranger';

const MEMBERS = [
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: P_MANAGER, company_id: PARTNER, role: 'manager', status: 'active' },
  { user_id: P_STAFF, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: P_REMOVED, company_id: PARTNER, role: 'owner', status: 'removed' },
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: HQ_MANAGER, company_id: HQ, role: 'manager', status: 'active' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
];

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

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

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── 숫자 (순수) ──────────────────────────────────────────────────

const SNAPS = new Map([
  ['sA', { id: 'sA', quote_payload: { cost: { total: 1500000, fixed_recovery: 100000 } } }], // 견적 원가 140만
  ['sE', { id: 'sE', quote_payload: { cost: { total: 2000000 } } }],
]);
const ORDERS = [
  { id: 'A', order_no: 'SO-A', snapshot_id: 'sA', contract_amount: 2200000, status: 'confirmed', ordered_at: '2026-10-05T01:00:00Z' },
  { id: 'B', order_no: 'SO-B', snapshot_id: null, contract_amount: 990000, status: 'in_production', ordered_at: '2026-10-31T15:30:00Z' }, // KST 11-01
  { id: 'C', order_no: 'SO-C', snapshot_id: 'sC', contract_amount: 1100000, status: 'completed', ordered_at: '2026-09-30T15:30:00Z' }, // KST 10-01, 견적 원가 모름
  { id: 'D', order_no: 'SO-D', snapshot_id: 'sA', contract_amount: 5500000, status: 'cancelled', ordered_at: '2026-10-07T01:00:00Z' },
  { id: 'E', order_no: 'SO-E', snapshot_id: 'sE', contract_amount: 3300000, status: 'delivered', ordered_at: '2026-09-10T01:00:00Z' },
];
const COSTS = [
  { order_id: 'A', amount: 600000 },
  { order_id: 'A', amount: 400000 },
  { order_id: 'E', amount: 2500000 },
  { order_id: 'D', amount: 999999 }, // 취소 — 달 묶음에 없다
];
const pay = (order_id, stage, amount, due_on, paid_on = null) => ({ order_id, stage, amount, due_on, paid_on });
const PAYMENTS = [
  pay('A', 'deposit', 500000, '2026-10-01', '2026-10-03'),
  pay('E', 'balance', 1000000, '2026-09-30', '2026-09-30'),
  pay('D', 'deposit', 300000, '2026-10-08', '2026-10-08'), // 취소 수주라도 받은 돈은 받은 돈
  pay('B', 'balance', 50000, '2026-11-01', '2026-10-25'), // 미리 받음 — 받을 돈 아님
  pay('A', 'interim', 700000, '2026-10-20'), // 밀림
  pay('C', 'balance', 400000, '2026-10-28'), // 밀림
  pay('D', 'balance', 1000000, '2026-10-01'), // 취소 — 밀린 돈 아님
  pay('B', 'deposit', 200000, '2026-10-29'), // 오늘 — 받을 돈
  pay('E', 'other', 300000, '2026-11-28'), // +30일 — 받을 돈
  pay('E', 'other', 100000, '2026-11-29'), // +31일 — 아님
  pay('D', 'other', 100000, '2026-11-05'), // 취소 — 아님
  pay('A', 'balance', 1000000, '2026-11-10'),
  pay('B', 'other', 10000, null), // 날짜 없음
];

const books = (over = {}) => summarizeBooks({
  company: { id: PARTNER, name: '한빛인테리어' },
  month: '2026-10',
  orders: ORDERS,
  snapshotsById: SNAPS,
  costs: COSTS,
  payments: PAYMENTS,
  today: '2026-10-29',
  ...over,
});

test('장부 요약 — 응답 모양 그대로 (앱이 이 모양으로 만든다)', () => {
  const b = books();
  assert.deepEqual(Object.keys(b), ['company', 'month', 'months', 'outstanding', 'status_counts', 'upcoming']);
  assert.deepEqual(b.company, { id: PARTNER, name: '한빛인테리어' });
  assert.equal(b.month, '2026-10');
  assert.deepEqual(b.months.map((m) => Object.keys(m)), Array(2).fill(['month', 'contract_total', 'received_total', 'quote_margin', 'actual_margin', 'actual_cost_missing']));
  assert.deepEqual(Object.keys(b.outstanding), ['total', 'count']);
  assert.deepEqual(Object.keys(b.status_counts), ['confirmed', 'in_production', 'delivered', 'completed', 'cancelled']);
  for (const u of b.upcoming) assert.deepEqual(Object.keys(u), ['order_id', 'order_no', 'stage', 'amount', 'due_on']);
});

test('달 칸 — 이달 · 지난달, ordered_at(KST)로 묶고 취소는 뺀다', () => {
  const [oct, sep] = books().months;
  assert.deepEqual(oct, {
    month: '2026-10',
    contract_total: 3300000, // A 220만 + C 110만 (B 는 KST 11월, D 는 취소)
    received_total: 850000, // paid_on 10월: A 50만 + D 30만 + B 5만
    quote_margin: 600000, // A 매출 200만 − 견적 원가 140만 (C 는 견적 원가를 몰라 뺀다)
    actual_margin: 1000000, // A 매출 200만 − 실적 원가 100만
    actual_cost_missing: 1, // C — 견적 원가로 채우지 않는다
  });
  assert.deepEqual(sep, { month: '2026-09', contract_total: 3300000, received_total: 1000000, quote_margin: 1000000, actual_margin: 500000, actual_cost_missing: 0 });
});

test('견적 마진 = 월 손익(summarizeMonth)의 남는 돈 — 같은 식', () => {
  for (const month of ['2026-10', '2026-09']) {
    const monthly = summarizeMonth(ORDERS, SNAPS, { month, overheadMonthly: 0 });
    const b = books({ month: '2026-10' }).months.find((m) => m.month === month);
    assert.equal(b.quote_margin, monthly.totals.gross, month);
  }
  // 1월이면 지난달은 지난해 12월
  assert.deepEqual(books({ month: '2027-01' }).months.map((m) => m.month), ['2027-01', '2026-12']);
});

test('밀린 돈 — 받기로 한 날이 오늘 전 · 안 받음 · 취소 수주 뺌', () => {
  assert.deepEqual(books().outstanding, { total: 1100000, count: 2 });
  // 오늘이 바뀌면 오늘 받기로 한 돈은 다음 날부터 밀린 돈
  assert.deepEqual(books({ today: '2026-10-30' }).outstanding, { total: 1300000, count: 3 });
});

test('받을 돈 — 안 받았고 오늘 ~ 30일 뒤, 날짜 순, 취소 수주 뺌', () => {
  assert.deepEqual(books().upcoming, [
    { order_id: 'B', order_no: 'SO-B', stage: 'deposit', amount: 200000, due_on: '2026-10-29' },
    { order_id: 'A', order_no: 'SO-A', stage: 'balance', amount: 1000000, due_on: '2026-11-10' },
    { order_id: 'E', order_no: 'SO-E', stage: 'other', amount: 300000, due_on: '2026-11-28' },
  ]);
  const many = Array.from({ length: 25 }, (_, i) => pay('A', 'other', 1000 + i, `2026-11-${String(25 - i).padStart(2, '0')}`));
  const up = books({ payments: many }).upcoming;
  assert.equal(up.length, UPCOMING_MAX);
  assert.equal(UPCOMING_MAX, 20);
  assert.deepEqual(up.map((p) => p.due_on), [...up.map((p) => p.due_on)].sort());
  assert.equal(up[0].due_on, '2026-11-01');
});

test('상태별 수 — 그 업체 수주 전부의 지금 상태', () => {
  assert.deepEqual(books().status_counts, { confirmed: 1, in_production: 1, delivered: 1, completed: 1, cancelled: 1 });
  assert.deepEqual(books({ orders: [] }).status_counts, { confirmed: 0, in_production: 0, delivered: 0, completed: 0, cancelled: 0 });
});

// ── 누가 보나 ────────────────────────────────────────────────────

const people = (u) => companyRoute(u, { members: MEMBERS }) || (u.includes('/admin_roles?') ? json(u.includes(`user_id=eq.${ADMIN}`) ? [{ role: 'admin' }] : []) : null);

test('누가 보나 — 그 업체 대표 · 실장 → 그 업체 (본사 포함)', async () => {
  for (const [who, company] of [[P_OWNER, PARTNER], [P_MANAGER, PARTNER], [HQ_OWNER, HQ], [HQ_MANAGER, HQ]]) {
    await withFetch(people, async () => {
      assert.equal(await booksCompanyOf(ENV, { id: who }), company, who);
    });
  }
  for (const [who, code] of [[P_STAFF, 'not_money'], [HQ_STAFF, 'not_money'], [P_REMOVED, 'not_member'], [STRANGER, 'not_member'], [ADMIN, 'not_member']]) {
    await withFetch(people, async () => {
      await assert.rejects(booksCompanyOf(ENV, { id: who }), (e) => e.statusCode === 403 && e.code === code, who);
    });
  }
});

// ── GET /books/summary ───────────────────────────────────────────

/** 오늘(KST) 기준 날짜 — 경로 시험은 진짜 오늘로 돈다 */
function shift(days) {
  return new Date(Date.parse(`${kstDate()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function booksDb({ company = PARTNER } = {}) {
  const thisMonth = kstDate().slice(0, 7);
  const orders = [
    { id: 'O1', order_no: 'SO-1', snapshot_id: 'S1', contract_amount: 1100000, status: 'confirmed', ordered_at: `${thisMonth}-01T03:00:00Z` },
    { id: 'O2', order_no: 'SO-2', snapshot_id: null, contract_amount: 550000, status: 'cancelled', ordered_at: `${thisMonth}-01T03:00:00Z` },
  ];
  return (u, method) => {
    // 업체 이름 (본사 행 찾기 kind=eq.hq 는 아래 people 이 답한다)
    if (u.includes('/companies?id=eq.')) return json([{ id: company, name: company === HQ ? '다담가구' : '한빛인테리어' }]);
    const hit = people(u);
    if (hit) return hit;
    if (method !== 'GET') return null;
    if (u.includes('/orders?')) return json(orders);
    if (u.includes('/order_payments?')) {
      return json([
        { order_id: 'O1', stage: 'deposit', amount: 300000, due_on: shift(-3), paid_on: null, orders: { company_id: company } },
        { order_id: 'O1', stage: 'balance', amount: 800000, due_on: shift(5), paid_on: null, orders: { company_id: company } },
      ]);
    }
    if (u.includes('/design_snapshots?')) return json([{ id: 'S1', quote_payload: { cost: { total: 600000 } } }]);
    if (u.includes('/order_costs?')) return json([{ order_id: 'O1', amount: 700000 }]);
    return null;
  };
}

async function callWorker(path, token, route) {
  const auth = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: token }) : route(u, m, b));
  return withFetch(auth, async (calls) => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), headers: res.headers, calls };
  });
}

test('GET /books/summary — { success, data } 로 감싸서, 그 업체 것만 읽는다 · 캐시에 남기지 않는다', async () => {
  const r = await callWorker('/books/summary', P_OWNER, booksDb());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
  assert.deepEqual(Object.keys(r.body.data), ['company', 'month', 'months', 'outstanding', 'status_counts', 'upcoming']);
  const d = r.body.data;
  assert.deepEqual(d.company, { id: PARTNER, name: '한빛인테리어' });
  assert.equal(d.month, kstDate().slice(0, 7), '기본은 이달 (KST)');
  assert.deepEqual(d.months[0], { month: d.month, contract_total: 1100000, received_total: 0, quote_margin: 400000, actual_margin: 300000, actual_cost_missing: 0 });
  assert.deepEqual(d.outstanding, { total: 300000, count: 1 });
  assert.deepEqual(d.upcoming, [{ order_id: 'O1', order_no: 'SO-1', stage: 'balance', amount: 800000, due_on: shift(5) }]);
  assert.deepEqual(d.status_counts, { confirmed: 1, in_production: 0, delivered: 0, completed: 0, cancelled: 1 });
  assert.match(r.headers.get('Cache-Control') || '', /no-store/);

  const q = (table) => new URL(r.calls.find((c) => c.url.includes(`/rest/v1/${table}?`)).url).searchParams;
  assert.equal(q('orders').get('company_id'), `eq.${PARTNER}`);
  assert.ok(q('order_payments').get('select').endsWith(',orders!inner(company_id)'));
  assert.equal(q('order_payments').get('orders.company_id'), `eq.${PARTNER}`);
  assert.equal(q('order_costs').get('order_id'), 'in.(O1)', '실적 원가는 두 달(취소 뺌) 수주만');
  assert.equal(q('companies').get('id'), `eq.${PARTNER}`);
  assert.ok(!r.calls.some((c) => c.method !== 'GET' && !c.url.includes('/auth/')), '읽기만 한다');
});

test('GET /books/summary — month 를 주면 그 달, 모양이 틀리면 이달', async () => {
  const r = await callWorker('/books/summary?month=2026-03', HQ_MANAGER, booksDb({ company: HQ }));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.month, '2026-03');
  assert.deepEqual(r.body.data.months.map((m) => m.month), ['2026-03', '2026-02']);
  assert.deepEqual(r.body.data.company, { id: HQ, name: '다담가구' });
  assert.equal(new URL(r.calls.find((c) => c.url.includes('/rest/v1/orders?')).url).searchParams.get('company_id'), `eq.${HQ}`);
  const bad = await callWorker('/books/summary?month=2026-3', HQ_OWNER, booksDb({ company: HQ }));
  assert.equal(bad.body.data.month, kstDate().slice(0, 7));
});

test('GET /books/summary — staff · 구성원 아님(관리자 포함)은 403, 장부를 읽지 않는다', async () => {
  for (const [who, code] of [[P_STAFF, 'not_money'], [HQ_STAFF, 'not_money'], [ADMIN, 'not_member'], [STRANGER, 'not_member']]) {
    const r = await callWorker('/books/summary', who, booksDb());
    assert.equal(r.status, 403, who);
    assert.equal(r.body.code, code, who);
    assert.ok(!r.calls.some((c) => /\/rest\/v1\/(orders|order_payments|order_costs|design_snapshots)\?/.test(c.url)), who);
  }
});

// ── 작업 기록의 업체 ─────────────────────────────────────────────

const LINK_P = { id: 'L1', user_id: P_OWNER, label: '재단 김' };
const LINK_HQ = { id: 'L2', user_id: HQ_OWNER, label: '재단 이' };
const LINK_ADMIN = { id: 'L3', user_id: ADMIN, label: '재단 박' };

function worklogDb() {
  return (u, method, body) => {
    const hit = people(u);
    if (hit) return hit;
    // 주문 — O-HQ 는 HQ_OWNER 가 만든 본사 설계 D-HQ 의 본사 수주, O-P 는 협력업체 수주
    const order = u.includes('/orders?id=eq.O-HQ') ? { id: 'O-HQ', company_id: HQ, design_id: 'D-HQ' } : u.includes('/orders?id=eq.O-P') ? { id: 'O-P', company_id: PARTNER, design_id: 'D-P' } : null;
    if (method === 'GET' && u.includes('/orders?')) {
      if (!order) return json([]);
      return json(u.includes(`company_id=eq.${HQ}`) && order.company_id !== HQ ? [] : [order]);
    }
    if (method === 'GET' && u.includes('/designs?')) {
      return json(u.includes('id=eq.D-HQ') && u.includes(`user_id=eq.${HQ_OWNER}`) && u.includes(`company_id=eq.${HQ}`) ? [{ id: 'D-HQ' }] : []);
    }
    if (method === 'POST' && u.endsWith('/production_worklogs')) return json([{ id: 'W1', ...body }], 201);
    return null;
  };
}

test('작업 기록의 업체 — 주문에 묶이면 그 주문의 업체, 아니면 링크(만든 사람)의 업체, 구성원이 아니면 본사', async () => {
  const cases = [
    [LINK_HQ, 'O-P', PARTNER],
    [LINK_P, 'O-HQ', HQ],
    [LINK_P, null, PARTNER],
    [LINK_HQ, null, HQ],
    [LINK_ADMIN, null, HQ],
    [LINK_P, 'O-NONE', PARTNER], // 없는 주문 — 링크의 업체
  ];
  for (const [link, orderId, want] of cases) {
    await withFetch(worklogDb(), async () => {
      assert.equal(await worklogCompanyOf(ENV, { link, orderId }), want, `${link.id} ${orderId}`);
    });
  }
});

test('작업 기록 — 주문 없이, 또는 링크 주인의 본사 수주면 남긴다 (그 업체 · 링크로)', async () => {
  for (const [link, orderId, want] of [
    [LINK_HQ, 'O-HQ', HQ],
    [LINK_HQ, null, HQ],
    [LINK_P, null, PARTNER],
    [LINK_ADMIN, null, HQ],
  ]) {
    await withFetch(worklogDb(), async (calls) => {
      clearHqCompanyCache();
      await addWorklog(ENV, { link, body: { role: 'cutter', units: 2, minutes: 30, order_id: orderId } });
      const post = calls.find((c) => c.method === 'POST').body;
      assert.equal(post.company_id, want, `${link.id} ${orderId} 기록`);
      assert.equal(post.link_id, link.id);
      assert.equal(post.order_id, orderId);
    });
  }
});

test('작업 기록 — 남의 주문 · 협력업체 주문 · 없는 주문은 422, 기록을 남기지 않는다', async () => {
  for (const [link, orderId] of [
    [LINK_HQ, 'O-P'], // 협력업체 수주
    [LINK_P, 'O-HQ'], // 본사 수주지만 링크 주인이 만든 설계가 아님
    [LINK_ADMIN, 'O-HQ'],
    [LINK_HQ, 'O-NONE'],
  ]) {
    await withFetch(worklogDb(), async (calls) => {
      clearHqCompanyCache();
      await assert.rejects(
        addWorklog(ENV, { link, body: { role: 'cutter', units: 2, minutes: 30, order_id: orderId } }),
        (e) => e.statusCode === 422 && e.details && e.details.field === 'order_id',
        `${link.id} ${orderId}`
      );
      assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    });
  }
});

// ── 작업자 링크 만들기 ───────────────────────────────────────────

test('작업자 링크 — 본사 대표 · 실장 · 관리자만 만든다, 그 밖은 403 not_link_maker', async () => {
  const env = { ...ENV, SHARE_TOKEN_PEPPER: 'test-pepper', PUBLIC_BASE_URL: 'https://dadam.test' };
  const route = (u, method, body) =>
    people(u) || (method === 'POST' && u.endsWith('/production_worker_links') ? json([{ id: 'L9', ...body }], 201) : null);
  for (const who of [HQ_OWNER, HQ_MANAGER, ADMIN]) {
    await withFetch(route, async (calls) => {
      clearHqCompanyCache();
      clearAdminCache();
      const out = await createWorkerLink(env, { user: { id: who }, body: { label: '재단 김', days: 30 } });
      assert.equal(out.label, '재단 김', who);
      assert.ok(out.url.startsWith('https://dadam.test/production-worker.html#t='), who);
      assert.equal(calls.find((c) => c.method === 'POST').body.user_id, who);
    });
  }
  for (const who of [HQ_STAFF, P_OWNER, P_MANAGER, P_STAFF, STRANGER]) {
    await withFetch(route, async (calls) => {
      clearHqCompanyCache();
      clearAdminCache();
      await assert.rejects(
        createWorkerLink(env, { user: { id: who }, body: { label: '재단 김' } }),
        (e) => e.statusCode === 403 && e.code === 'not_link_maker',
        who
      );
      assert.equal(calls.filter((c) => c.method === 'POST').length, 0, who);
    });
  }
});
