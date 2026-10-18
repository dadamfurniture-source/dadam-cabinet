/**
 * 외주 발주 내역 (work-reports-archive.plan.md §2.1) — Step 4 [발주 처리] → outsource_order 보고.
 * 도어재 발주가 된 주문은 생산 계획 '도어 발주 마감' 추천 · 아침 경고에서 빠진다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutsourceOrder, listOutsourceOrders, expectedArrival } from '../src/reports/outsource.js';
import { reportFromOutsource, outsourceQtyText } from '../src/reports/record.js';
import { updateReportMeta } from '../src/reports/service.js';
import { mergeSettings, sanitizeSettings, buildJobs } from '../src/production/service.js';
import { planProduction } from '../src/production/planner.js';
import { buildDailyBlocks } from '../src/production/notify.js';
import { renderReportPrint } from '../src/templates/report-print.js';
import { clearAdminCache } from '../src/reports/admin.js';
import * as fx from './fixtures/work-order-v2.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const U1 = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const O1 = '44444444-4444-4444-8444-444444444444';
const R1 = '55555555-5555-4555-8555-555555555555';

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, method);
    if (!res) throw new Error(`unexpected fetch ${method} ${u}`);
    return res;
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}

const theDoc = () => fx.doc({ id: DOC, design_id: D1, snapshot_id: 's1' });

/** 문서 · 설계 · 스냅샷 · 설정 · 주문 — existing: 이미 있는 발주 행 */
function docRoutes({ existing = [], settings = null } = {}) {
  return (u, m) => {
    if (u.includes('/design_documents?')) return json([theDoc()]);
    if (u.includes('/designs?')) return json([{ id: D1, user_id: U1 }]);
    if (u.includes('/design_snapshots?')) return json([fx.snapshot({ id: 's1' })]);
    if (u.includes('/production_settings?')) return json(settings ? [{ settings }] : []);
    if (u.includes('/orders?')) return json([{ id: O1 }]);
    if (u.includes('/work_reports?') && m === 'GET') return json(existing);
    if (u.endsWith('/work_reports') && m === 'POST') return json([{ id: 'new' }], 201);
    return null;
  };
}

test('수량 한 줄 · 보고 행 — 꾸러미 · 업체 · 문서번호 · 입고 예정', () => {
  assert.equal(outsourceQtyText('door', { doorSheets: 2, doors: 6, doorParts: 9 }), '원장 2장 · 도어 6짝 · 부재 9장');
  assert.equal(outsourceQtyText('cut-vendor', { sheets: 5, edgeM: 41.2, parts: 60 }), '원판 5장 · 엣지 41.2m · 부재 60장');
  const r = reportFromOutsource({ ownerId: U1, doc: theDoc(), pack: 'door', vendor: '상일', orderedOn: '2026-10-19', expectedOn: '2026-10-22', quantities: { doors: 4 }, orderIds: [O1, 'x'] });
  assert.equal(r.kind, 'outsource_order');
  assert.equal(r.status, 'ordered');
  assert.equal(r.source_id, null, '한 문서에 꾸러미별로 여러 번 — source_id 는 비운다');
  assert.equal(r.body.document_id, DOC);
  assert.ok(r.title.startsWith('외주 발주 — 도어재 · 상일 · DD-'));
  assert.deepEqual(r.order_ids, [O1]);
  assert.deepEqual(r.design_ids, [D1]);
  assert.equal(r.metrics.pack, 'door');
  assert.deepEqual([r.period_start, r.period_end], ['2026-10-19', '2026-10-22']);
});

test('입고 예정 기본값 — 다음 날부터 납기 근무일 (주말 · 공휴일 건너뜀)', () => {
  assert.equal(expectedArrival('2026-10-16', 3), '2026-10-21'); // 금 → 월·화·수
  assert.equal(expectedArrival('2026-10-19', 2), '2026-10-21'); // 월 → 화·수
  assert.equal(expectedArrival('2026-10-19', 2, ['2026-10-20']), '2026-10-22');
});

test('[발주 처리] — 업체 비우면 설정 기본값(상일), 수량은 동결 문서에서, 주문 연결', async () => {
  await withFetch(docRoutes(), async (calls) => {
    await createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'door' } });
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.metrics.vendor, '상일');
    assert.equal(post.metrics.doors, 4);
    assert.equal(post.metrics.doorSheets, 1);
    assert.deepEqual(post.order_ids, [O1]);
    assert.ok(post.period_end > post.period_start, '입고 예정은 오늘 뒤');
    const dup = calls.find((c) => c.method === 'GET' && c.url.includes('/work_reports?')).url;
    assert.ok(dup.includes(`design_ids=cs.{${D1}}`));
    assert.ok(dup.includes('metrics->>pack=eq.door'));
    assert.ok(dup.includes('status=in.(ordered,received)'));
  });
});

test('[발주 처리] — 설정에서 바꾼 업체 · 직접 넣은 업체 · 재단 의뢰', async () => {
  await withFetch(docRoutes({ settings: { vendors: { cutEdge: '한솔재단' } } }), async (calls) => {
    await createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'cut-vendor' } });
    assert.equal(calls.find((c) => c.method === 'POST').body.metrics.vendor, '한솔재단');
    assert.equal(calls.find((c) => c.method === 'POST').body.metrics.edgeM, 4.6);
  });
  await withFetch(docRoutes(), async (calls) => {
    await createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'door', vendor: '  우드원 ', expected_on: '2099-01-05', note: '급함' } });
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.metrics.vendor, '우드원');
    assert.equal(post.period_end, '2099-01-05');
    assert.equal(post.note, '급함');
  });
});

test('[발주 처리] — 이미 살아 있는 같은 꾸러미 발주면 409, force 면 한 번 더', async () => {
  const existing = [{ id: 'e1', status: 'ordered', period_start: '2026-10-17', metrics: { vendor: '상일' } }];
  await withFetch(docRoutes({ existing }), async (calls) => {
    await assert.rejects(
      createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'door' } }),
      (e) => e.statusCode === 409 && /이미 발주 처리/.test(e.message) && /2026-10-17/.test(e.message),
    );
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    await createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'door', force: true } });
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  });
});

test('[발주 처리] — 잘못된 꾸러미 · 지난 날짜 · 작업지시서 아님 · 남의 설계', async () => {
  const user = { id: U1 };
  await withFetch(docRoutes(), async () => {
    await assert.rejects(createOutsourceOrder(ENV, { user, documentId: DOC, body: { pack: 'cut' } }), /door · cut-vendor · top/);
    await assert.rejects(createOutsourceOrder(ENV, { user, documentId: DOC, body: { pack: 'door', expected_on: '2001-01-01' } }), /오늘 이후/);
  });
  await withFetch((u, m) => (u.includes('/design_documents?') ? json([{ ...theDoc(), doc_type: 'installation_order' }]) : docRoutes()(u, m)), async () => {
    await assert.rejects(createOutsourceOrder(ENV, { user, documentId: DOC, body: { pack: 'door' } }), /작업지시서에서만/);
  });
  await withFetch((u, m) => (u.includes('/designs?') ? json([{ id: D1, user_id: 'other' }]) : docRoutes()(u, m)), async () => {
    await assert.rejects(createOutsourceOrder(ENV, { user, documentId: DOC, body: { pack: 'door' } }), (e) => e.statusCode === 403);
  });
});

test('Step 4 목록 — 이 설계의 외주 발주, 꾸러미 · 업체 · 상태 · 수량', async () => {
  const rows = [{ id: R1, status: 'received', period_start: '2026-10-15', period_end: '2026-10-18', metrics: { pack: 'door', vendor: '상일', qty: '도어 4짝' }, body: { doc_no: 'WO-r1' }, created_at: 'x' }];
  await withFetch(docRoutes({ existing: rows }), async () => {
    const items = await listOutsourceOrders(ENV, { user: { id: U1 }, documentId: DOC });
    assert.deepEqual(items[0], { id: R1, pack: 'door', vendor: '상일', status: 'received', ordered_on: '2026-10-15', expected_on: '2026-10-18', doc_no: 'WO-r1', qty: '도어 4짝', created_at: 'x' });
  });
});

test('보관함 상태 — 외주 발주만 ordered/received/cancelled, 다른 종류는 거절', async () => {
  clearAdminCache();
  const row = (kind) => ({ id: R1, owner_id: U1, kind, status: kind === 'outsource_order' ? 'ordered' : 'pending' });
  for (const [kind, status, ok] of [['outsource_order', 'received', true], ['outsource_order', 'bogus', false], ['production_plan', 'received', false]]) {
    await withFetch((u, m) => {
      if (u.includes('/admin_roles?')) return json([]);
      if (u.includes('/work_reports?') && m === 'GET') return json([row(kind)]);
      if (u.includes('/work_reports?') && m === 'PATCH') return json([{ ...row(kind), status }]);
      return null;
    }, async (calls) => {
      const p = updateReportMeta(ENV, { user: { id: U1 }, id: R1, body: { status } });
      if (ok) {
        await p;
        assert.equal(calls.find((c) => c.method === 'PATCH').body.status, 'received');
      } else {
        await assert.rejects(p, (e) => e.statusCode === 422);
      }
    });
  }
});

test('설정 — 업체 이름 기본값 · 저장 검증', () => {
  assert.deepEqual(mergeSettings(null).vendors, { door: '상일', cutEdge: '일성합판', topMarble: '', topStone: '', topCeramic: '' });
  assert.equal(mergeSettings({ vendors: { door: '우드원', gone: 'x' } }).vendors.door, '우드원');
  assert.deepEqual(sanitizeSettings({ vendors: { door: ' 우드원 ' } }), { vendors: { door: '우드원' } });
  assert.throws(() => sanitizeSettings({ vendors: { door: '' } }), /1~40자/);
  assert.throws(() => sanitizeSettings({ vendors: { top: 'x' } }), /알 수 없는 설정/);
});

test('도어 발주 처리된 주문 — 계획 추천 · 아침 경고에서 빠진다', () => {
  const snap = { id: 's1', bom_payload: { materials: [{ part: '도어', qty: 4, partId: 'x-door#0-0', w: 400, h: 700 }, { part: '측판', qty: 2, partId: '0-l1-body:side-0', w: 560, h: 720 }] } };
  const orders = [
    { id: O1, order_no: 'A', customer_name: '가', status: 'in_production', snapshot_id: 's1', design_id: 'd1', ordered_at: '2026-10-19T00:00:00Z' },
    { id: 'o2', order_no: 'B', customer_name: '나', status: 'in_production', snapshot_id: 's1', design_id: 'd2', ordered_at: '2026-10-19T00:00:00Z' },
  ];
  const schedules = [
    { design_id: 'd1', type: 'installation', status: 'scheduled', scheduled_at: '2026-10-26T01:00:00Z' },
    { design_id: 'd2', type: 'installation', status: 'scheduled', scheduled_at: '2026-10-26T01:00:00Z' },
  ];
  const { jobs } = buildJobs(orders, new Map([['s1', snap]]), schedules, mergeSettings(null).standards, new Set([O1]));
  assert.deepEqual(jobs.map((j) => j.doorOrdered), [true, false]);
  const s = mergeSettings(null);
  const plan = planProduction({ today: '2026-10-19', jobs, crew: s.crew, costs: s.costs, leads: s.leads, holidays: [] });
  const doorSugg = plan.suggestions.filter((x) => x.type === 'door_order').map((x) => x.jobId);
  assert.deepEqual(doorSugg, ['o2']);
  assert.equal(plan.jobs.find((j) => j.id === O1).doorOrdered, true);
  // 아침 요약: 마감이 오늘·내일인 것처럼 당겨도 발주된 주문은 안 나온다
  const forced = { ...plan, jobs: plan.jobs.map((j) => ({ ...j, doorOrderBy: '2026-10-19' })) };
  const text = JSON.stringify(buildDailyBlocks({ plan: forced, assignments: [], today: '2026-10-19' }));
  assert.ok(text.includes('나 (B)'));
  assert.ok(!text.includes('가 (A): 도어 발주'));
});

test('외주 발주 인쇄 — 꾸러미 · 업체 · 입고 예정 · 수량', () => {
  const r = reportFromOutsource({ ownerId: U1, doc: theDoc(), pack: 'cut-vendor', vendor: '일성<합판>', orderedOn: '2026-10-19', expectedOn: '2026-10-21', quantities: { sheets: 3, edgeM: 12.5, parts: 20 } });
  const html = renderReportPrint({ ...r, created_at: '2026-10-19T01:00:00Z' });
  assert.ok(html.includes('재단·엣지'));
  assert.ok(html.includes('일성&lt;합판&gt;'));
  assert.ok(html.includes('10/21(수)'));
  assert.ok(html.includes('원판 3장 · 엣지 12.5m · 부재 20장'));
});
