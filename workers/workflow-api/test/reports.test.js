/**
 * 작업 지시 보고 보관함 (docs/01-plan/work-reports-archive.plan.md) — 빌더 · 목록 필터 · 권한 · 멱등 · 실패 무시 · 기록 지점 · 인쇄 · 라우트.
 * DB 는 PostgREST 경로별로 응답하는 가짜 fetch 로 대신한다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_KINDS, reportFromProposal, reportFromDecision, reportFromDailyBrief, reportFromDocument, reportNote, isUuid,
} from '../src/reports/record.js';
import {
  buildListQuery, recordReport, safeRecord, listReports, getReport, updateReportMeta, recordDocumentIssued, backfillReports,
} from '../src/reports/service.js';
import { clearAdminCache, canEditRole } from '../src/reports/admin.js';
import { decideProposal } from '../src/production/service.js';
import { renderReportPrint } from '../src/templates/report-print.js';
import worker from '../src/worker.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', CORS_ORIGINS: 'https://dadamfurniture.com' };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const O1 = '44444444-4444-4444-8444-444444444444';
const D1 = '55555555-5555-4555-8555-555555555555';
const R1 = '66666666-6666-4666-8666-666666666666';

const json = (rows, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const fail = (status, text) => ({ ok: false, status, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => text });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init.method || 'GET', calls);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const PLAN = {
  days: [
    { date: '2026-10-19', cut: { load: 3600, cap: 28800 }, edge: { load: 30000, cap: 28800, overtimeHours: 0 }, asm: { load: 14400, cap: 28800, people: 1, extra: 0 } },
    { date: '2026-10-20', cut: { load: 0, cap: 28800 }, edge: { load: 0, cap: 28800 }, asm: { load: 0, cap: 28800, people: 0 } },
  ],
  jobs: [{ id: O1, label: '김OO (DD-1)', due: '2026-10-23', finish: '2026-10-21', late: false, doorOrderBy: '2026-10-19' }, { id: 'not-a-uuid', label: '옛 주문' }],
  suggestions: [
    { type: 'asm_extra', date: '2026-10-21', people: 1, cost: 200000, text: '10/21 조립 일당 +1', jobId: O1 },
    { type: 'edge_overtime', date: '2026-10-19', hours: 2, cost: 24000, text: '10/19 알바 연장 2h' },
  ],
  summary: { jobs: 2, lateBefore: 1, lateAfter: 0, needsReschedule: 0, asmCallDays: 2, extraCost: 224000 },
  triggerLabel: '새 수주 DD-1',
};
const PROPOSAL = { id: P1, user_id: U1, trigger: 'order_created', plan: PLAN, status: 'pending', created_at: '2026-10-18T23:00:00Z' };

beforeEach(() => clearAdminCache());

// ── 빌더 ─────────────────────────────────────────────────────────

test('생산 계획 보고 — 계기 · 기간 · 숫자 · uuid 주문만 · 동결 본문', () => {
  const r = reportFromProposal(PROPOSAL);
  assert.equal(r.kind, 'production_plan');
  assert.equal(r.owner_id, U1);
  assert.equal(r.title, '생산 계획 — 새 수주 DD-1');
  assert.deepEqual([r.period_start, r.period_end], ['2026-10-19', '2026-10-20']);
  assert.deepEqual(r.order_ids, [O1]);
  assert.deepEqual(r.metrics, { jobs: 2, lateBefore: 1, lateAfter: 0, needsReschedule: 0, extraCost: 224000, suggestions: 2 });
  assert.equal(r.source_id, P1);
  assert.equal(r.body.plan, PLAN);
  assert.ok(REPORT_KINDS.includes(r.kind));
});

test('인력 승인 보고 — 고른 추천 · 지시 · 비용 합 · 승인자, 무시는 지시 없음', () => {
  const assignments = [
    { id: 'a1', work_date: '2026-10-21', kind: 'asm_extra', text: '10/21 조립 일당 +1', cost: 200000 },
    { id: 'a2', work_date: '2026-10-19', kind: 'edge_overtime', text: '알바 연장', cost: 24000 },
  ];
  const r = reportFromDecision(PROPOSAL, { decision: 'approve', selected: [0, 1], chosen: PLAN.suggestions, assignments, deciderId: U1, decidedAt: '2026-10-19T00:10:00Z' });
  assert.equal(r.kind, 'staffing_decision');
  assert.equal(r.status, 'approved');
  assert.match(r.title, /^인력 승인 — 10\/21 조립 일당 \+1 · 10\/19 알바 연장 2h$/);
  assert.deepEqual([r.period_start, r.period_end], ['2026-10-19', '2026-10-21']);
  assert.deepEqual(r.metrics, { assignments: 2, cost: 224000, suggestions: 2 });
  assert.deepEqual(r.body.selected, [0, 1]);
  assert.equal(r.created_by, U1);
  assert.deepEqual(r.order_ids, [O1]);
  const d = reportFromDecision(PROPOSAL, { decision: 'dismiss', chosen: [], assignments: [], deciderId: U1, decidedAt: '2026-10-19T00:10:00Z' });
  assert.equal(d.status, 'dismissed');
  assert.equal(d.title, '인력 추천 무시 — 새 수주 DD-1');
  assert.equal(d.period_start, '2026-10-19');
});

test('아침 요약 보고 — 그날 부하 % · 조립 인원 · 오늘 지시 · 지연 · Slack 결과', () => {
  const r = reportFromDailyBrief({ ownerId: U1, day: '2026-10-19', plan: PLAN, todays: [{ id: 'a2', text: '알바 연장', status: 'instructed', work_date: '2026-10-19' }], blocks: [{ type: 'header' }], sent: true, workersSent: false });
  assert.equal(r.kind, 'daily_brief');
  assert.equal(r.title, '아침 생산 요약 — 10/19(월)');
  assert.deepEqual(r.metrics, { cut: 13, edge: 104, asm: 50, asmPeople: 1, todays: 1, late: 1, jobs: 2 });
  assert.equal(r.status, 'sent');
  assert.equal(r.source_id, null);
  assert.deepEqual(r.body.slack, { owner: true, workers: false, blocks: [{ type: 'header' }] });
});

test('문서 보고 — 작업지시서 · 설치 지시서만, 확인서는 null', () => {
  const doc = { id: R1, design_id: D1, snapshot_id: 's', doc_type: 'work_order', doc_no: 'DD-1-WO-r2', rev: 2, status: 'issued', title: '김OO 주방', totals: { sheet_count: 6, label_count: 38 }, created_at: '2026-10-18T05:00:00Z' };
  const r = reportFromDocument(doc, { ownerId: U1, orderIds: [O1, 'x'] });
  assert.equal(r.title, '작업지시서 DD-1-WO-r2 — 김OO 주방');
  assert.deepEqual(r.metrics, { rev: 2, sheets: 6, labels: 38 });
  assert.deepEqual(r.order_ids, [O1]);
  assert.deepEqual(r.design_ids, [D1]);
  assert.equal(reportFromDocument({ ...doc, doc_type: 'installation_order' }).kind, 'installation_order');
  assert.equal(reportFromDocument({ ...doc, doc_type: 'customer_confirmation' }), null);
  const n = reportNote({ ownerId: U1, title: '  ', note: 'x'.repeat(5000), createdBy: U1 });
  assert.equal(n.title, '메모');
  assert.equal(n.note.length, 4000);
  assert.ok(isUuid(U1) && !isUuid('row-1'));
});

// ── 목록 필터 ────────────────────────────────────────────────────

test('목록 쿼리 — 주인 필터(관리자 전체는 없음) · 종류 · 기간(KST) · 상태 · 주문 · 검색어 정리 · 보관 숨김 · 페이지', () => {
  const mine = buildListQuery({ userId: U1, all: false, query: { kind: 'production_plan,daily_brief,bogus', from: '2026-10-01', to: '2026-10-18', status: 'pending', order: O1, q: 'a*b,(c)', page: '2' } }).q;
  assert.equal(mine.owner_id, `eq.${U1}`);
  assert.equal(mine.kind, 'in.(production_plan,daily_brief)');
  assert.equal(mine.and, '(created_at.gte.2026-10-01T00:00:00+09:00,created_at.lte.2026-10-18T23:59:59+09:00)');
  assert.equal(mine.status, 'eq.pending');
  assert.equal(mine.order_ids, `cs.{${O1}}`);
  assert.equal(mine.title, 'ilike.*a b  c*');
  assert.equal(mine.archived_at, 'is.null');
  assert.deepEqual([mine.limit, mine.offset], ['31', '30']);
  assert.equal(mine.order, 'pinned.desc,created_at.desc');
  const all = buildListQuery({ userId: U1, all: true, query: { archived: '1', kind: 'note' } }).q;
  assert.equal(all.owner_id, undefined);
  assert.equal(all.kind, 'eq.note');
  assert.equal(all.archived_at, undefined);
  assert.equal(buildListQuery({ userId: U1, all: true, query: { archived: 'only' } }).q.archived_at, 'not.is.null');
});

// ── 권한 ─────────────────────────────────────────────────────────

const route = ({ role = null, reports = [], extra } = {}) => (u, method) => {
  if (u.includes('/admin_roles?')) return json(role ? [{ role }] : []);
  if (extra) { const r = extra(u, method); if (r) return r; }
  if (u.includes('/work_reports?') && method === 'GET') return json(reports);
  return null;
};

test('목록 — 관리자는 전체(주인 필터 없음), 관리자 아니면 본인 것만', async () => {
  await withFetch(route({ role: 'manager', reports: [] }), async (calls) => {
    const out = await listReports(ENV, { user: { id: U1 } });
    assert.equal(out.scope, 'all');
    assert.ok(!calls.find((c) => c.url.includes('/work_reports?')).url.includes('owner_id='));
  });
  clearAdminCache();
  await withFetch(route({ role: null, reports: [] }), async (calls) => {
    const out = await listReports(ENV, { user: { id: U2 } });
    assert.equal(out.scope, 'mine');
    assert.ok(calls.find((c) => c.url.includes('/work_reports?')).url.includes(`owner_id=eq.${U2}`));
  });
});

test('한 건 — 남의 보고는 관리자만, 인력 승인은 지시의 지금 상태를 같이', async () => {
  const row = { id: R1, owner_id: U1, kind: 'staffing_decision', source_id: P1, title: 't', body: {} };
  await withFetch(route({ role: null, reports: [row] }), async () => {
    await assert.rejects(getReport(ENV, { user: { id: U2 }, id: R1 }), /찾을 수 없습니다/);
  });
  clearAdminCache();
  const live = [{ id: 'a1', work_date: '2026-10-21', status: 'done', done_at: 'x' }];
  await withFetch(route({ role: 'support', reports: [row], extra: (u) => (u.includes('/production_assignments?') ? json(live) : null) }), async () => {
    const r = await getReport(ENV, { user: { id: U2 }, id: R1 });
    assert.deepEqual(r.live, live);
    assert.equal(r.can_edit, false, 'support 는 읽기만');
  });
});

test('메모 · 고정 · 보관만 바뀐다 — support/manager 는 남의 것 못 바꿈, admin 은 가능', async () => {
  const row = { id: R1, owner_id: U1, kind: 'production_plan', title: 't' };
  await withFetch(route({ role: 'manager', reports: [row] }), async () => {
    await assert.rejects(updateReportMeta(ENV, { user: { id: U2 }, id: R1, body: { note: 'x' } }), /admin 이상/);
  });
  clearAdminCache();
  await withFetch(route({ role: 'admin', reports: [row], extra: (u, m) => (m === 'PATCH' && u.includes('/work_reports?id=eq.') ? json([{ ...row, note: 'n' }]) : null) }), async (calls) => {
    await updateReportMeta(ENV, { user: { id: U2 }, id: R1, body: { note: 'n', pinned: true, archived: true, title: '바꾸면 안 됨', metrics: {} } });
    const patch = calls.find((c) => c.method === 'PATCH').body;
    assert.deepEqual(Object.keys(patch).sort(), ['archived_at', 'note', 'pinned', 'updated_at']);
    await assert.rejects(updateReportMeta(ENV, { user: { id: U2 }, id: R1, body: { title: 'x' } }), /note · pinned · archived/);
  });
  assert.equal(canEditRole('super_admin') && canEditRole('admin') && !canEditRole('manager'), true);
});

// ── 멱등 · 실패 무시 ─────────────────────────────────────────────

test('같은 원본을 두 번 기록하면 새 행 없이 상태만 맞춘다', async () => {
  await withFetch((u, m) => {
    if (m === 'POST' && u.endsWith('/work_reports')) return fail(409, '{"code":"23505","message":"duplicate key"}');
    if (m === 'PATCH' && u.includes('/work_reports?')) return json([]);
    return null;
  }, async (calls) => {
    const out = await recordReport(ENV, reportFromProposal({ ...PROPOSAL, status: 'approved' }));
    assert.equal(out, null);
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.ok(patch.url.includes(`kind=eq.production_plan&source_id=eq.${P1}`));
    assert.equal(patch.body.status, 'approved');
  });
});

test('표가 없어도(SQL 미실행) 기록은 조용히 null — 원래 흐름은 계속', async () => {
  await withFetch((u, m) => (m === 'POST' ? fail(404, '{"code":"PGRST205","message":"Could not find the table public.work_reports"}') : null), async () => {
    assert.equal(await safeRecord(ENV, reportFromProposal(PROPOSAL)), null);
  });
});

// ── 기록 지점 ────────────────────────────────────────────────────

test('승인 → 제안 승인 + 지시 저장 + 계획 보고 상태 approved + 인력 승인 보고(고른 추천 · 승인자)', async () => {
  const saved = [{ id: 'a1', work_date: '2026-10-21', kind: 'asm_extra', text: '10/21 조립 일당 +1', cost: 200000 }];
  await withFetch((u, m) => {
    if (u.includes('/production_proposals?') && m === 'GET') return json([PROPOSAL]);
    if (u.endsWith('/production_assignments') && m === 'POST') return json(saved);
    if (u.includes('/production_proposals?id=eq.') && m === 'PATCH') return json([{ ...PROPOSAL, status: 'approved' }]);
    if (u.includes('/work_reports') && (m === 'PATCH' || m === 'POST')) return json([{ id: R1 }]);
    return null;
  }, async (calls) => {
    const out = await decideProposal(ENV, { user: { id: U1 }, proposalId: P1, body: { decision: 'approve', selected: [0] } });
    assert.equal(out.status, 'approved');
    const sync = calls.find((c) => c.method === 'PATCH' && c.url.includes('/work_reports?'));
    assert.ok(sync.url.includes(`source_id=eq.${P1}`));
    assert.equal(sync.body.status, 'approved');
    const rec = calls.find((c) => c.method === 'POST' && c.url.endsWith('/work_reports')).body;
    assert.equal(rec.kind, 'staffing_decision');
    assert.deepEqual(rec.body.selected, [0]);
    assert.equal(rec.created_by, U1);
    assert.equal(rec.metrics.cost, 200000);
  });
});

test('승인 중 보관함 표가 없어도 승인은 끝난다', async () => {
  await withFetch((u, m) => {
    if (u.includes('/production_proposals?') && m === 'GET') return json([PROPOSAL]);
    if (u.includes('/production_proposals?id=eq.') && m === 'PATCH') return json([PROPOSAL]);
    if (u.includes('/work_reports')) return fail(404, '{"code":"PGRST205"}');
    return null;
  }, async () => {
    const out = await decideProposal(ENV, { user: { id: U1 }, proposalId: P1, body: { decision: 'dismiss' } });
    assert.equal(out.status, 'dismissed');
  });
});

test('작업지시서 발행 → 같은 설계·종류의 옛 보고는 superseded, 새 색인 행 (확인서는 기록 안 함)', async () => {
  const doc = { id: R1, design_id: D1, snapshot_id: 's', doc_type: 'work_order', doc_no: 'DD-1-WO-r2', rev: 2, status: 'issued', title: 't', totals: {}, created_at: '2026-10-18T05:00:00Z' };
  await withFetch((u, m) => {
    if (u.includes('/orders?') && m === 'GET') return json([{ id: O1 }]);
    if (u.includes('/work_reports')) return json([{ id: 'x' }]);
    return null;
  }, async (calls) => {
    await recordDocumentIssued(ENV, { user: { id: U1 }, doc });
    const sync = calls.find((c) => c.method === 'PATCH');
    assert.ok(sync.url.includes(`kind=eq.work_order&design_ids=cs.{${D1}}&source_id=neq.${R1}&status=neq.superseded`));
    const rec = calls.find((c) => c.method === 'POST').body;
    assert.deepEqual([rec.kind, rec.owner_id, rec.order_ids[0]], ['work_order', U1, O1]);
  });
  await withFetch(() => null, async () => {
    assert.equal(await recordDocumentIssued(ENV, { user: { id: U1 }, doc: { ...doc, doc_type: 'customer_confirmation' } }), null);
  });
});

test('백필 — admin 이상만, 제안 · 결정 · 문서를 옮겨 담는다 (두 번째는 중복이라 건너뜀)', async () => {
  await withFetch(route({ role: 'manager' }), async () => {
    await assert.rejects(backfillReports(ENV, { user: { id: U2 } }), /admin 이상/);
  });
  clearAdminCache();
  let first = true;
  await withFetch((u, m) => {
    if (u.includes('/admin_roles?')) return json([{ role: 'super_admin' }]);
    if (u.includes('/production_proposals?')) return json([{ ...PROPOSAL, status: 'approved', decided_at: '2026-10-19T00:00:00Z' }]);
    if (u.includes('/production_assignments?')) return json([{ id: 'a1', work_date: '2026-10-21', kind: 'asm_extra', text: 't', cost: 1 }]);
    if (u.includes('/design_documents?')) return json([{ id: R1, design_id: D1, doc_type: 'work_order', doc_no: 'n', rev: 1, status: 'issued', title: 't', totals: {}, created_at: '2026-10-18T05:00:00Z' }]);
    if (u.includes('/designs?')) return json([{ id: D1, user_id: U1 }]);
    if (u.includes('/orders?')) return json([{ id: O1, design_id: D1 }]);
    if (m === 'POST' && u.endsWith('/work_reports')) return first ? json([{ id: 'r' }]) : fail(409, '23505');
    if (m === 'PATCH') return json([]);
    return null;
  }, async () => {
    assert.deepEqual(await backfillReports(ENV, { user: { id: U2 } }), { proposals: 1, decisions: 1, documents: 1, skipped: 0 });
    first = false;
    assert.deepEqual(await backfillReports(ENV, { user: { id: U2 } }), { proposals: 0, decisions: 0, documents: 0, skipped: 3 });
  });
});

// ── 인쇄 · 라우트 ────────────────────────────────────────────────

test('인쇄 — 생산 계획 · 인력 승인(지금 상태) · 아침 요약, 값은 이스케이프', () => {
  const plan = renderReportPrint({ ...reportFromProposal(PROPOSAL), title: '<script>x</script>', note: '<b>메모</b>', created_at: '2026-10-18T23:00:00Z' });
  assert.ok(plan.includes('생산 계획 · 인력 추천'));
  assert.ok(plan.includes('10/21 조립 일당 +1'));
  assert.ok(plan.includes('10/19(월)'));
  assert.ok(!plan.includes('<script>x') && plan.includes('&lt;script&gt;'));
  assert.ok(!plan.includes('<b>메모</b>'));
  const dec = renderReportPrint(reportFromDecision(PROPOSAL, { decision: 'approve', chosen: [], assignments: [{ id: 'a1', work_date: '2026-10-21', text: '조립 +1', cost: 200000 }], decidedAt: '2026-10-19T00:00:00Z' }), { live: [{ id: 'a1', status: 'done' }] });
  assert.ok(dec.includes('조립 +1') && dec.includes('20만원'));
  assert.ok(dec.includes('<td>완료</td>'), '지시의 지금 상태');
  const daily = renderReportPrint(reportFromDailyBrief({ ownerId: U1, day: '2026-10-19', plan: PLAN, todays: [], sent: true }));
  assert.ok(daily.includes('아침 생산 요약') && daily.includes('104%'));
});

test('라우트 — GET /reports 는 JWT 확인 뒤 보관함 목록, /reports/summary 가 :reportId 보다 먼저', async () => {
  await withFetch((u) => {
    if (u.includes('/auth/v1/user')) return json({ id: U1, email: 'a@b.c' });
    if (u.includes('/admin_roles?')) return json([]);
    if (u.includes('/work_reports?')) return json([]);
    return null;
  }, async (calls) => {
    const res = await worker.fetch(new Request('https://api.test/reports?kind=daily_brief', { headers: { Authorization: 'Bearer t', Origin: 'https://dadamfurniture.com' } }), ENV, { waitUntil() {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.scope, 'mine');
    assert.ok(calls.some((c) => c.url.includes('/work_reports?') && c.url.includes('kind=eq.daily_brief')));
    const sum = await worker.fetch(new Request('https://api.test/reports/summary', { headers: { Authorization: 'Bearer t' } }), ENV, { waitUntil() {} });
    assert.equal(sum.status, 200);
    assert.ok('pendingProposals' in (await sum.json()).data);
  });
});
