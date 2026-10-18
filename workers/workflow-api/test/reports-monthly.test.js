/**
 * 월 생산 마감 보고 (work-reports-archive.plan.md §2 · 사장님 결정 Q4 — 매월 자동).
 * 평일 07시 cron 은 1일이 주말이면 돌지 않는다 → "그 달 7일까지 + 아직 없음" 으로 첫 근무일에 만든다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFromMonth, monthEnd } from '../src/reports/record.js';
import { prevMonthOf, runMonthlyCloses } from '../src/production/service.js';
import { renderReportPrint } from '../src/templates/report-print.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const O1 = '44444444-4444-4444-8444-444444444444';

const json = (rows) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init.method || 'GET');
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}

const SUMMARY = {
  month: '2026-10',
  rows: [{ id: O1, label: '김OO (DD-1)', revenue: 9000000, cost: 6000000, gross: 3000000 }, { id: 'x', label: '옛', revenue: 1000000, cost: null, gross: null }],
  totals: { orders: 2, unknownCost: 1, revenue: 10000000, cost: 6000000, gross: 3000000, grossRate: 33.3, overhead: 3800000, net: -800000, shortfall: 800000 },
};

test('월 마감 보고 — 제목 · 그 달 기간 · 손익 숫자 · 지시 완료율(취소 제외) · 추가 인건비', () => {
  const r = reportFromMonth({
    ownerId: U1,
    summary: SUMMARY,
    assignments: [
      { status: 'done', cost: 200000 }, { status: 'done', cost: 0 }, { status: 'instructed', cost: 24000 }, { status: 'cancelled', cost: 999999 },
    ],
  });
  assert.equal(r.kind, 'monthly_close');
  assert.equal(r.title, '월 생산 마감 — 2026년 10월');
  assert.deepEqual([r.period_start, r.period_end], ['2026-10-01', '2026-10-31']);
  assert.deepEqual(r.order_ids, [O1]);
  assert.equal(r.metrics.net, -800000);
  assert.equal(r.metrics.assignments, 3);
  assert.equal(r.metrics.completion, 66.7);
  assert.equal(r.metrics.extraCost, 224000);
  assert.equal(reportFromMonth({ ownerId: U1, summary: SUMMARY }).metrics.completion, null, '지시 없으면 완료율 없음');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
  assert.equal(prevMonthOf('2026-01-05'), '2025-12');
  assert.equal(prevMonthOf('2026-11-02'), '2026-10');
});

test('월 마감 인쇄 — 손익 숫자와 주문별 줄', () => {
  const html = renderReportPrint({ ...reportFromMonth({ ownerId: U1, summary: SUMMARY }), created_at: '2026-11-02T22:00:00Z' });
  assert.ok(html.includes('월 생산 마감'));
  assert.ok(html.includes('김OO (DD-1)'));
  assert.ok(html.includes('-80만원'));
  assert.ok(html.includes('모름'));
});

test('그 달 8일 이후엔 돌지 않는다 (DB 를 읽지도 않는다)', async () => {
  await withFetch(() => null, async (calls) => {
    assert.deepEqual(await runMonthlyCloses(ENV, { today: '2026-11-09' }), []);
    assert.equal(calls.length, 0);
  });
});

test('첫 근무일(11/2 월) — 전월 수주 계정마다 만들고, 이미 있는 계정은 건너뛴다', async () => {
  await withFetch((u, m) => {
    if (u.includes('/orders?') && u.includes('ordered_at.gte.2026-10-01')) return json([{ design_id: 'd1' }, { design_id: 'd2' }]);
    if (u.includes('/orders?') && u.includes('status=in.(confirmed,in_production)')) return json([]);
    if (u.includes('/designs?') && u.includes('id=in.(d1,d2)')) return json([{ user_id: U1 }, { user_id: U2 }]);
    if (u.includes('/work_reports?') && u.includes(`owner_id=eq.${U2}`)) return json([{ id: 'exists' }]);
    if (u.includes('/work_reports?') && m === 'GET') return json([]);
    if (u.includes('/production_settings?')) return json([]);
    if (u.includes('/designs?') && u.includes(`user_id=eq.${U1}`)) return json([{ id: 'd1' }]);
    if (u.includes('/orders?') && u.includes('design_id=in.(d1)')) return json([{ id: O1, order_no: 'DD-1', design_id: 'd1', snapshot_id: 's1', status: 'in_production', contract_amount: 9900000, ordered_at: '2026-10-05T01:00:00Z' }]);
    if (u.includes('/design_snapshots?')) return json([{ id: 's1', quote_payload: { cost: { total: 6000000, fixed_recovery: 0 } } }]);
    if (u.includes('/production_assignments?')) return json([{ id: 'a', status: 'done', cost: 200000, work_date: '2026-10-21' }]);
    if (u.endsWith('/work_reports') && m === 'POST') return json([{ id: 'new' }]);
    return null;
  }, async (calls) => {
    const out = await runMonthlyCloses(ENV, { today: '2026-11-02' });
    assert.deepEqual(out.map((r) => [r.userId, r.created ?? r.skipped]).sort(), [[U1, true], [U2, 'exists']].sort());
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.kind, 'monthly_close');
    assert.equal(post.owner_id, U1);
    assert.equal(post.period_start, '2026-10-01');
    assert.equal(post.metrics.revenue, 9000000);
    assert.equal(post.metrics.completion, 100);
    const asg = calls.find((c) => c.url.includes('/production_assignments?')).url;
    assert.ok(asg.includes('and=(work_date.gte.2026-10-01,work_date.lte.2026-10-31)'));
  });
});
