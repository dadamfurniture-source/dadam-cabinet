/**
 * 분기 목표 — 경영 대시보드 3단계 PR-13 (도구 18).
 *
 * 석 달에 셋. 대시보드 숫자에 묶으면 저절로 진도가 난다. 쌓이는 목표(매출 · 순이익 · 수주)는
 * 지난 날 비율과 견줘 '제 속도' / '뒤처짐', 비율 목표는 닿았는지만, 낮을수록 좋은 목표는 목표 이하면 끝.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { quarterStatsOf, okrsOf, monthsOfQuarter, buildManagementSummary } from '../src/management/summary.js';
import { validateOkr, quarterOf, createOkr, OKR_METRICS, OKR_MAX_PER_QUARTER } from '../src/okrs.js';
import { clearAdminCache } from '../src/reports/admin.js';

const TODAY = '2026-10-21';
const SNAPS = new Map([['s1', { quote_payload: { cost: { total: 1500000, fixed_recovery: 0 } } }]]);
const ORDERS = [
  { id: 'O1', order_no: 'SO-1', snapshot_id: 's1', contract_amount: 2200000, status: 'confirmed', ordered_at: '2026-10-05T01:00:00Z' }, // 200만, 공헌 50만
  { id: 'O2', order_no: 'SO-2', snapshot_id: null, contract_amount: 1100000, status: 'confirmed', ordered_at: '2026-10-15T01:00:00Z' }, // 100만, 원가 모름
  { id: 'O3', order_no: 'SO-3', snapshot_id: 's1', contract_amount: 9900000, status: 'confirmed', ordered_at: '2026-09-20T01:00:00Z' }, // 3분기
];
const C = (design_id, created_at, extra = {}) => ({ design_id, doc_type: 'customer_confirmation', created_at, status: 'issued', decision: null, ...extra });
const DOCS = [C('D1', '2026-10-02T01:00:00Z', { decision: 'approved', status: 'approved' }), C('D2', '2026-10-08T01:00:00Z')];
const P = { orders: ORDERS, snapshotsById: SNAPS, documents: DOCS, consultations: [], overheadMonthly: 1000000 };

test('분기: 2026-Q4 는 10 · 11 · 12월, 10월이면 Q4', () => {
  assert.deepEqual(monthsOfQuarter('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  assert.equal(quarterOf('2026-10'), '2026-Q4');
  assert.equal(quarterOf('2026-03'), '2026-Q1');
});

test('분기 누계: 10월만 더한다(11 · 12월은 아직) — 매출 300만 · 순이익 −50만 · 수주 2 · 공헌이익률 25% · 전환율 50% · 지난 날 22.8%', () => {
  assert.deepEqual(quarterStatsOf(P, '2026-Q4', TODAY), {
    quarter: '2026-Q4', revenue: 3000000, net: -500000, orders: 2, cmRate: 25, conversion: 50, elapsed: 22.8,
  });
  assert.equal(quarterStatsOf(P, '2026-Q3', TODAY).elapsed, 100);
});

const OKRS = [
  { id: 'a', objective: '가을 성수기 매출', metric: 'revenue_q', target: 30000000, direction: 'up', manual_value: null, sort: 0 },
  { id: 'b', objective: '수주 8건', metric: 'orders_q', target: 8, direction: 'up', manual_value: null, sort: 1 },
  { id: 'c', objective: 'A/S 줄이기', metric: 'as_rate', target: 5, direction: 'down', manual_value: null, sort: 2 },
  { id: 'd', objective: '소개받는 가구점', metric: 'nps', target: 50, direction: 'up', manual_value: null, sort: 3 },
  { id: 'e', objective: '쇼룸 열기', metric: 'manual', target: 3, direction: 'up', manual_value: null, sort: 4 },
];

test('진도: 매출 10% 뒤처짐 · 수주 25% 제 속도 · A/S 4% ≤ 5% 끝 · NPS 25/50 · 직접 적기는 값이 없으면 비움', () => {
  const stats = quarterStatsOf(P, '2026-Q4', TODAY);
  const o = okrsOf({ okrs: OKRS, stats, referral: { nps: 25 }, quality: { window: { asRate: 4 } }, leadTime: null });
  assert.equal(o.quarter, '2026-Q4');
  assert.equal(o.elapsed, 22.8);
  assert.deepEqual(o.items.map((i) => [i.id, i.current, i.progress, i.status]), [
    ['a', 3000000, 10, 'behind'], // 22.8 − 5 보다 낮다
    ['b', 2, 25, 'on_track'],
    ['c', 4, 100, 'done'],
    ['d', 25, 50, 'below'],
    ['e', null, null, null],
  ]);
  assert.deepEqual(o.items[0].label, '분기 매출 (VAT 제외)');
  assert.equal(o.metrics.length, Object.keys(OKR_METRICS).length);
});

test('낮을수록 좋은 목표가 넘으면 목표 ÷ 지금 · 직접 적기는 적은 값으로', () => {
  const stats = quarterStatsOf(P, '2026-Q4', TODAY);
  const o = okrsOf({ okrs: [{ ...OKRS[2] }, { ...OKRS[4], manual_value: 3 }], stats, referral: null, quality: { window: { asRate: 8 } }, leadTime: null });
  assert.deepEqual(o.items.map((i) => [i.progress, i.status]), [[62.5, 'below'], [100, 'done']]);
});

test('표가 없으면 null · 요약에 분기 목표가 실린다', () => {
  assert.equal(okrsOf({ okrs: null, stats: {} }), null);
  const s = buildManagementSummary({ orders: ORDERS, snapshotsById: SNAPS, documents: DOCS, consultations: [], okrs: OKRS.slice(0, 1), settings: { quote: { overheadMonthly: 1000000 } }, month: '2026-10', today: TODAY });
  assert.equal(s.okrs.quarter, '2026-Q4');
  assert.equal(s.okrs.items[0].progress, 10);
});

test('입력: 분기 · 목표 · 숫자, metric 은 정해진 것만 — 방향은 metric 이 정하고 직접 적기만 고른다', () => {
  assert.deepEqual(validateOkr({ quarter: '2026-Q4', objective: ' 매출 3천 ', metric: 'revenue_q', target: '30000000' }), {
    quarter: '2026-Q4', objective: '매출 3천', metric: 'revenue_q', direction: 'up', target: 30000000,
  });
  assert.equal(validateOkr({ quarter: '2026-Q4', objective: 'x', metric: 'as_rate', target: 5, direction: 'up' }).direction, 'down');
  assert.equal(validateOkr({ quarter: '2026-Q4', objective: 'x', metric: 'manual', target: 5, direction: 'down' }).direction, 'down');
  assert.throws(() => validateOkr({ quarter: '2026-4', objective: 'x', metric: 'nps', target: 1 }), /분기/);
  assert.throws(() => validateOkr({ quarter: '2026-Q4', objective: '', metric: 'nps', target: 1 }), /목표를/);
  assert.throws(() => validateOkr({ quarter: '2026-Q4', objective: 'x', metric: 'happiness', target: 1 }), /metric/);
  assert.throws(() => validateOkr({ quarter: '2026-Q4', objective: 'x', metric: 'nps', target: 'many' }), /숫자/);
});

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
beforeEach(() => clearAdminCache());

test(`한 분기에 ${OKR_MAX_PER_QUARTER}개까지`, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/admin_roles?')) return json([{ role: 'admin' }]);
    if (u.includes('/okrs?')) return json(Array.from({ length: OKR_MAX_PER_QUARTER }, (_, i) => ({ id: String(i) })));
    return null;
  };
  try {
    await assert.rejects(createOkr(ENV, { user: { id: 'U1' }, body: { quarter: '2026-Q4', objective: 'x', metric: 'nps', target: 1 } }), /5개까지/);
  } finally {
    globalThis.fetch = original;
  }
});
