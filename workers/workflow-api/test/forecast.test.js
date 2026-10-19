/**
 * 계절 지수 · 수주 예측 — 경영 대시보드 3단계 PR-12 (도구 21).
 *
 * 열두 달이 있으면 같은 달 평균 ÷ 전체 달 평균으로 계절 지수를 내고, 최근 열두 달 평균 × 지수로
 * 이번 달과 다음 두 달을 내다본다. 사장님이 적은 과거 월 매출이 그 달의 시스템 숫자보다 먼저다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { forecastOf, buildManagementSummary, SEASON_MIN_MONTHS } from '../src/management/summary.js';
import { validateHistoryRow, saveSalesHistory } from '../src/sales-history.js';
import { clearAdminCache } from '../src/reports/admin.js';

const TODAY = '2026-10-21';
const M = 1000000;
// 2025-10 ~ 2026-09 — 가을이 성수기(10 · 11월 6,000만), 겨울 · 한여름이 비수기(2,000만)
const HISTORY = [
  ['2025-10', 60], ['2025-11', 60], ['2025-12', 40], ['2026-01', 20], ['2026-02', 20], ['2026-03', 30],
  ['2026-04', 40], ['2026-05', 40], ['2026-06', 30], ['2026-07', 20], ['2026-08', 20], ['2026-09', 40],
].map(([month, r]) => ({ month: `${month}-01`, revenue: r * M, orders: null }));
const SYS = [
  { contract_amount: 11000000, status: 'confirmed', ordered_at: '2026-10-03T01:00:00Z' }, // 이번 달 1,000만
  { contract_amount: 5500000, status: 'confirmed', ordered_at: '2026-10-10T01:00:00Z' }, // 이번 달 500만
  { contract_amount: 1100000, status: 'confirmed', ordered_at: '2026-09-10T01:00:00Z' }, // 9월은 사장님 숫자가 먼저
  { contract_amount: 9900000, status: 'cancelled', ordered_at: '2025-08-10T01:00:00Z' }, // 취소 — 세지 않는다
];
const C = (design_id, created_at, extra = {}) => ({ design_id, doc_type: 'customer_confirmation', created_at, status: 'issued', decision: null, ...extra });
const DOCS = [
  C('D1', '2026-05-10T01:00:00Z', { decision: 'approved', status: 'approved' }),
  C('D2', '2026-06-01T01:00:00Z', { decision: 'rejected', status: 'rejected' }),
  C('D3', '2026-09-25T01:00:00Z', { status: 'viewed' }), // 결정 대기
  C('D4', '2026-10-05T01:00:00Z'), // 이번 달 — 대기로만 센다
  C('D5', '2026-03-01T01:00:00Z', { decision: 'approved', status: 'approved' }), // 반년 밖
  C('D6', '2026-10-01T01:00:00Z', { status: 'revoked' }), // 회수
];

test('계절 지수: 열두 달 평균 3,500만 기준 — 10 · 11월 1.71, 1 · 2 · 7 · 8월 0.57', () => {
  const f = forecastOf({ history: HISTORY, sysOrders: SYS, documents: DOCS }, TODAY);
  assert.equal(f.coverage, 12);
  assert.equal(f.ready, true);
  assert.deepEqual(f.index.map((x) => x.value), [0.57, 0.57, 0.86, 1.14, 1.14, 0.86, 0.57, 0.57, 1.14, 1.71, 1.71, 1.14]);
  assert.deepEqual(f.peak, { m: 10, value: 1.71 });
  assert.deepEqual(f.low, { m: 1, value: 0.57 });
  assert.equal(f.base, 35000000);
});

test('예측: 이번 달 · 다음 두 달 = 3,500만 × 지수', () => {
  const f = forecastOf({ history: HISTORY, sysOrders: SYS, documents: DOCS }, TODAY);
  assert.deepEqual(f.next, [
    { month: '2026-10', index: 1.71, forecast: 59850000 },
    { month: '2026-11', index: 1.71, forecast: 59850000 },
    { month: '2026-12', index: 1.14, forecast: 39900000 },
  ]);
});

test('달별 매출: 적은 달은 사장님 숫자, 이번 달은 시스템 수주(아직 진행 중)', () => {
  const f = forecastOf({ history: HISTORY, sysOrders: SYS, documents: DOCS }, TODAY);
  assert.equal(f.months.length, 13);
  assert.deepEqual(f.months.find((x) => x.month === '2026-09'), { month: '2026-09', revenue: 40 * M, source: 'manual' });
  assert.deepEqual(f.months.at(-1), { month: '2026-10', revenue: 15000000, source: 'system', partial: true });
});

test('파이프라인: 결정 대기 2 × 최근 반년 전환율 33.3% × 평균 수주 533만(1,000 · 500 · 100만) = 356만', () => {
  const f = forecastOf({ history: HISTORY, sysOrders: SYS, documents: DOCS }, TODAY);
  assert.deepEqual(f.pipeline, { pending: 2, conversion: 33.3, avgContract: 5333333, expected: 3555555 });
});

test(`${SEASON_MIN_MONTHS}달이 안 되면 지수 · 예측을 내지 않는다 — 몇 달인지만`, () => {
  const f = forecastOf({ history: HISTORY.slice(0, 7), sysOrders: [], documents: [] }, TODAY);
  assert.equal(f.coverage, 7);
  assert.equal(f.ready, false);
  assert.equal(f.index, null);
  assert.equal(f.next, null);
  assert.deepEqual(f.pipeline, { pending: 0, conversion: null, avgContract: null, expected: null });
});

test('과거 매출 표가 없으면 needSql 을 세우고 시스템 수주만으로', () => {
  const f = forecastOf({ history: null, sysOrders: SYS, documents: [] }, TODAY);
  assert.equal(f.needSql, true);
  assert.equal(f.coverage, 1); // 9월 시스템 100만
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: {}, month: '2026-10', today: TODAY });
  assert.equal(s.forecast.needSql, true);
});

test('과거 매출 입력: YYYY-MM · 0 이상 정수, 빈 매출은 그 달 지우기', () => {
  assert.deepEqual(validateHistoryRow({ month: '2025-03', revenue: '30000000', orders: '4' }), { month: '2025-03', revenue: 30000000, orders: 4 });
  assert.deepEqual(validateHistoryRow({ month: '2025-03', revenue: '' }), { month: '2025-03', remove: true });
  assert.throws(() => validateHistoryRow({ month: '2025-13', revenue: 1 }), /YYYY-MM/);
  assert.throws(() => validateHistoryRow({ month: '2025-03', revenue: -1 }), /0 이상/);
  assert.throws(() => validateHistoryRow({ month: '2025-03', revenue: 1, orders: 1.5 }), /건수/);
});

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
beforeEach(() => clearAdminCache());

test('저장: 관리자만, 달의 1일로 upsert, 빈 달은 지운다', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('/admin_roles?')) return json([{ role: 'admin' }]);
    if (init.method === 'DELETE') return json([]);
    return json([{}]);
  };
  try {
    const out = await saveSalesHistory(ENV, { user: { id: 'U1' }, body: { rows: [{ month: '2025-03', revenue: 30000000 }, { month: '2025-04', revenue: '' }] } });
    assert.deepEqual(out, { saved: 1, removed: 1 });
    const up = calls.find((c) => c.method === 'POST');
    assert.match(up.url, /sales_history\?on_conflict=month/);
    assert.equal(up.body.month, '2025-03-01');
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('month=eq.2025-04-01')));
  } finally {
    globalThis.fetch = original;
  }
});
