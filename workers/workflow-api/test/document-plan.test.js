/**
 * 문서 · 외주 발주 등급 (2026-11-08, DB 0047 — manager < expert < agent).
 *   고객 확인서 Manager 이상 · 작업지시서 · 설치 지시서 · 외주 발주 Expert 이상 (src/documents.js DOC_PLANS · OUTSOURCE_PLANS).
 *   다담 공장(hq) · 본사(platform) 설계는 등급을 보지 않는다. 모자라면 403 plan_required, 아무것도 쓰지 않는다.
 *   업체 plan 만 본다 — company_members.role 의 manager(실장)는 등급이 아니다.
 * 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  DOC_PLANS,
  DOC_TYPES,
  OUTSOURCE_PLANS,
  PLAN_REQUIRED_CODE,
  companyPlanAllows,
  issueDocument,
} from '../src/documents.js';
import { createOutsourceOrder } from '../src/reports/outsource.js';
import worker from '../src/worker.js';
import * as fx from './fixtures/work-order-v2.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };

const P_OWNER = 'u-p-owner';
const P_MANAGER = 'u-p-manager'; // 협력업체 실장 — 직책이지 등급이 아니다
const HQ_STAFF = 'u-hq-staff';

const MEMBERS = [
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: P_MANAGER, company_id: PARTNER, role: 'manager', status: 'active' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
];

const DESIGNS = {
  'd-p': { id: 'd-p', user_id: P_OWNER, company_id: PARTNER, title: '협력업체 설계' },
  'd-hq': { id: 'd-hq', user_id: 'u-creator', company_id: HQ, title: '본사 설계' },
};

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

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

const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const companyReads = (calls) => calls.filter((c) => c.method === 'GET' && c.url.includes('/companies?id=eq.'));

/**
 * 발행 · 외주 발주 가짜 DB. plan: 협력업체(PARTNER) plan. design: 'd-p' | 'd-hq'.
 * 확인서는 승인된 것이 있다고 답한다 (작업지시서 사유를 묻지 않게).
 */
function route({ plan = 'agent', design = 'd-p' } = {}) {
  return (u, method, body) => {
    const company = companyRoute(u, { hq: HQ, members: MEMBERS, partnerPlan: plan });
    if (company) return company;
    const path = u.split('?')[0];
    if (u.includes('/admin_roles?')) return json([]);
    if (/\/designs\?/.test(u)) return json([DESIGNS[design]]);
    if (/\/design_snapshots\?id=eq\./.test(u)) return json([fx.snapshot({ id: 's1', design_id: design })]);
    if (/\/design_snapshots\?/.test(u)) return json([]);
    if (method === 'POST' && /\/design_documents$/.test(path)) return json([{ id: 'DOC-NEW', ...body }], 201);
    if (method === 'PATCH' && /\/design_documents$/.test(path)) return json([]);
    if (/\/design_documents\?/.test(u)) {
      const q = new URL(u).searchParams;
      if (q.get('decision') === 'eq.approved') return json([{ id: 'CC1' }]);
      if (q.get('id')) return json([fx.doc({ id: 'doc-1', design_id: design, snapshot_id: 's1' })]);
      return json([]);
    }
    if (u.includes('/company_settings?')) return json([]);
    if (u.includes('/design_schedules?')) return json([]);
    if (method === 'POST' && /\/work_reports$/.test(path)) return json([{ id: 'WR-NEW', ...body }], 201);
    if (/\/(design_renders|materials|orders|work_reports)\?/.test(u)) return json([]);
    return null;
  };
}

const issue = (docType, user = P_OWNER) =>
  issueDocument(ENV, { user: { id: user }, body: { doc_type: docType, snapshot_id: 's1' } });

const planDenied = (minPlan) => (e) =>
  e.statusCode === 403 && e.code === PLAN_REQUIRED_CODE && e.details && e.details.min_plan === minPlan;

// ── 순수 판정 ──────────────────────────────────────────────────

test('문서 등급표 — 확인서 Manager 이상, 작업지시서 · 설치 지시서 · 외주 발주 Expert 이상', () => {
  assert.deepEqual(Object.keys(DOC_PLANS).sort(), [...DOC_TYPES].sort(), '문서 종류마다 한 줄');
  assert.deepEqual([...DOC_PLANS.customer_confirmation], ['manager', 'expert', 'agent']);
  assert.deepEqual([...DOC_PLANS.work_order], ['expert', 'agent']);
  assert.deepEqual([...DOC_PLANS.installation_order], ['expert', 'agent']);
  assert.deepEqual([...OUTSOURCE_PLANS], ['expert', 'agent']);
});

test('companyPlanAllows — 다담 공장 · 본사는 언제나, 협력업체는 plan, 모르는 값 · 빈 값은 막는다', () => {
  const partner = (plan) => ({ kind: 'partner', plan });
  const cc = DOC_PLANS.customer_confirmation;
  const wo = DOC_PLANS.work_order;
  for (const plans of [cc, wo]) {
    assert.equal(companyPlanAllows({ kind: 'hq', plan: null }, plans), true);
    assert.equal(companyPlanAllows({ kind: 'platform', plan: null }, plans), true);
    assert.equal(companyPlanAllows(partner('agent'), plans), true);
    assert.equal(companyPlanAllows(partner('expert'), plans), true);
    assert.equal(companyPlanAllows(partner(null), plans), false);
    assert.equal(companyPlanAllows(partner('standard'), plans), false);
    assert.equal(companyPlanAllows(partner('owner'), plans), false, '직책 이름은 등급이 아니다');
    assert.equal(companyPlanAllows(null, plans), false);
    assert.equal(companyPlanAllows({ kind: 'other', plan: 'agent' }, plans), false);
  }
  assert.equal(companyPlanAllows(partner('manager'), cc), true);
  assert.equal(companyPlanAllows(partner('manager'), wo), false);
});

// ── 문서 발행 ──────────────────────────────────────────────────

test('Manager 업체 — 고객 확인서는 낸다', async () => {
  await withFetch(route({ plan: 'manager' }), async (calls) => {
    const out = await issue('customer_confirmation');
    assert.equal(out.document.doc_type, 'customer_confirmation');
    assert.ok(out.share_token, '확인서 링크 토큰');
    assert.equal(companyReads(calls).length, 1, '설계 업체 행을 한 번 읽는다');
    assert.ok(companyReads(calls)[0].url.includes(`id=eq.${PARTNER}`));
  });
});

test('Manager 업체 — 작업지시서 · 설치 지시서는 403 plan_required, 아무것도 쓰지 않는다 (실장도 같다)', async () => {
  for (const docType of ['work_order', 'installation_order']) {
    for (const who of [P_OWNER, P_MANAGER]) {
      await withFetch(route({ plan: 'manager' }), async (calls) => {
        await assert.rejects(issue(docType, who), planDenied('expert'));
        assert.deepEqual(writes(calls), [], `${docType} ${who}`);
      });
    }
  }
  await withFetch(route({ plan: 'manager' }), async () => {
    await assert.rejects(issue('work_order'), (e) => e.message === '작업지시서는 Expert 등급 팩토리부터 쓸 수 있습니다');
  });
});

test('Expert · Agent 업체 — 작업지시서도 낸다', async () => {
  for (const plan of ['expert', 'agent']) {
    await withFetch(route({ plan }), async (calls) => {
      const out = await issue('work_order');
      assert.equal(out.document.doc_type, 'work_order', plan);
      assert.equal(writes(calls).filter((c) => c.url.endsWith('/design_documents') && c.method === 'POST').length, 1);
    });
  }
});

test('plan 이 없는 협력업체 — 고객 확인서도 403 plan_required (Manager 부터)', async () => {
  await withFetch(route({ plan: null }), async (calls) => {
    await assert.rejects(issue('customer_confirmation'), planDenied('manager'));
    assert.deepEqual(writes(calls), []);
  });
  await withFetch(route({ plan: null }), async () => {
    await assert.rejects(issue('customer_confirmation'), (e) => e.message === '고객 확인서는 Manager 등급 팩토리부터 쓸 수 있습니다');
  });
});

test('다담 공장 설계 — 등급을 보지 않고 업체 행도 읽지 않는다', async () => {
  await withFetch(route({ plan: null, design: 'd-hq' }), async (calls) => {
    const out = await issue('work_order', HQ_STAFF);
    assert.equal(out.document.doc_type, 'work_order');
    assert.equal(companyReads(calls).length, 0);
  });
});

test('POST /snapshots/:id/documents — 등급이 모자라면 403 과 code plan_required · details.min_plan', async () => {
  const fake = route({ plan: 'manager' });
  const r = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: P_OWNER }) : fake(u, m, b));
  await withFetch(r, async (calls) => {
    const res = await worker.fetch(
      new Request('https://api.test/snapshots/s1/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${P_OWNER}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: 'installation_order' }),
      }),
      ENV,
      { waitUntil: () => {} },
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'plan_required');
    assert.equal(body.message, '설치 지시서는 Expert 등급 팩토리부터 쓸 수 있습니다');
    assert.deepEqual(body.details, { min_plan: 'expert' });
    assert.deepEqual(writes(calls), []);
  });
});

// ── 외주 발주 ──────────────────────────────────────────────────

test('[발주 처리] — Manager 업체는 403 plan_required, Expert 업체는 기록한다', async () => {
  await withFetch(route({ plan: 'manager' }), async (calls) => {
    await assert.rejects(
      createOutsourceOrder(ENV, { user: { id: P_OWNER }, documentId: 'doc-1', body: { pack: 'door' } }),
      (e) => planDenied('expert')(e) && e.message === '외주 발주는 Expert 등급 팩토리부터 쓸 수 있습니다',
    );
    assert.deepEqual(writes(calls), []);
  });
  await withFetch(route({ plan: 'expert' }), async (calls) => {
    const row = await createOutsourceOrder(ENV, { user: { id: P_OWNER }, documentId: 'doc-1', body: { pack: 'door' } });
    assert.equal(row.company_id, PARTNER);
    assert.equal(writes(calls).length, 1);
  });
});
