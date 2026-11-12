/**
 * 회계 한눈에 (src/ledger/dashboard.js — DB 0034 ledger_summary).
 *
 *   - 기간: 고른 달까지 12달(1~12), 빈 달은 0, 계정 · 지출 상대는 고른 달만
 *   - 대표 · 실장만 (직원 403), 0034 전이면 available false, 확인 기다리는 사진 수 · 과세 유형
 *   - 본사 대표 · 실장은 ?company= 로 협력업체 것을 보기만 (월 보고서, access.js report) — 본사 직원 403 not_member
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { dashRange, fillMonths, shiftMonth, kstMonth, DASH_MONTHS } from '../src/ledger/dashboard.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const PLATFORM = 'c0000000-0000-4000-8000-0000000000b1';
const HQ = 'c0000000-0000-4000-8000-0000000000b2';
const PF_OWNER = 'a0000000-0000-4000-8000-0000000000b1';
const PF_STAFF = 'a0000000-0000-4000-8000-0000000000b3';
const mem = (user_id, role, company_id = CO) => ({ user_id, company_id, role, status: 'active' });
const doc = (i, review_status = 'pending') => ({ id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, company_id: CO, review_status });

const SUMMARY = {
  from: '2025-12-01',
  to: '2026-11-30',
  months: [
    { month: '2026-09', income: 1000000, income_vat: 100000, expense: 300000, expense_vat: 30000, asset_buy: 0, asset_sell: 0, account_unknown: 0, vat_unknown: 0, evidence_risk: 0 },
    { month: '2026-11', income: 2000000, income_vat: 200000, expense: 590000, expense_vat: 50000, asset_buy: 1000000, asset_sell: 0, account_unknown: 1, vat_unknown: 1, evidence_risk: 2 },
  ],
  accounts: [
    { month: '2026-09', direction: 'expense', account: 'purchase.materials', amount: 300000, vat_amount: 30000, n: 1 },
    { month: '2026-11', direction: 'asset_buy', account: 'asset.tangible', amount: 1000000, vat_amount: 100000, n: 1 },
    { month: '2026-11', direction: 'expense', account: null, amount: 50000, vat_amount: 0, n: 1 },
  ],
  suppliers: [
    { month: '2026-09', name: '가나목재', amount: 300000, n: 1 },
    { month: '2026-11', name: '라마기계', amount: 1000000, n: 1 },
  ],
};

function world({ summary = SUMMARY, missing = false } = {}) {
  const calls = [];
  const fake = createFake({
    tables: {
      companies: [{ id: CO, kind: 'partner', plan: 'agent', status: 'active' }, { id: PLATFORM, kind: 'platform', status: 'active' }, { id: HQ, kind: 'hq', status: 'active' }],
      company_members: [mem(OWNER, 'owner'), mem(STAFF, 'staff'), mem(PF_OWNER, 'owner', PLATFORM), mem(PF_STAFF, 'staff', PLATFORM)],
      company_settings: [{ company_id: CO, settings: { tax: { vat_type: 'general', business_kind: 'manufacturing' } } }],
      ledger_documents: [doc(1), doc(2), doc(3, 'posted')],
    },
    users: { t_owner: { id: OWNER }, t_staff: { id: STAFF }, t_pf_owner: { id: PF_OWNER }, t_pf_staff: { id: PF_STAFF } },
    rpc: (name, body) => {
      calls.push({ name, body });
      if (name === 'company_entitled') return 'full';
      if (name === 'ledger_summary') {
        if (missing) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.ledger_summary' } };
        return summary;
      }
      return undefined;
    },
  });
  return { fake, calls };
}

async function get(w, path, token = 't_owner') {
  return withFake(w.fake, async (lines) => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control'), lines };
  });
}

test('기간 · 달 옮기기 · 빈 달 채우기 (순수)', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', -11), '2025-12');
  assert.deepEqual(dashRange('2026-02', 3), { from: '2025-12-01', to: '2026-02-28', list: ['2025-12', '2026-01', '2026-02'] });
  assert.equal(dashRange('2026-11', DASH_MONTHS).list.length, 12);
  const filled = fillMonths(['2026-08', '2026-09'], SUMMARY.months);
  assert.deepEqual(filled[0], { month: '2026-08', income: 0, income_vat: 0, expense: 0, expense_vat: 0, asset_buy: 0, asset_sell: 0, account_unknown: 0, vat_unknown: 0, evidence_risk: 0 });
  assert.equal(filled[1].income, 1000000);
  assert.equal(kstMonth(Date.parse('2026-11-30T16:00:00Z')), '2026-12');
});

test('GET /ledger/dashboard — 12달(빈 달 0) · 고른 달의 계정 · 지출 상대 · 확인 기다리는 사진 · 과세 유형, 캐시 없음', async () => {
  const w = world();
  const r = await get(w, '/ledger/dashboard?month=2026-11');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.cache, /no-store/);
  const d = r.json.data;
  assert.equal(d.available, true);
  assert.deepEqual([d.month, d.from, d.to, d.vat_type], ['2026-11', '2025-12-01', '2026-11-30', 'general']);
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_summary').body, { p_company: CO, p_from: '2025-12-01', p_to: '2026-11-30' });
  assert.equal(d.months.length, 12);
  assert.equal(d.months[0].month, '2025-12');
  assert.equal(d.months[0].income, 0);
  assert.equal(d.months[11].expense, 590000);
  assert.equal(d.months[9].income, 1000000);
  assert.deepEqual(d.accounts.map((a) => [a.direction, a.account, a.amount]), [
    ['asset_buy', 'asset.tangible', 1000000],
    ['expense', null, 50000],
  ]);
  assert.deepEqual(d.suppliers, [{ name: '라마기계', amount: 1000000, n: 1 }]);
  assert.equal(d.pending_photos, 2);
});

test('틀린 달 · 개월 수 422, 직원 403, 0034 전이면 available false', async () => {
  const w = world();
  assert.equal((await get(w, '/ledger/dashboard?month=2026-13')).status, 422);
  assert.equal((await get(w, '/ledger/dashboard?month=2026-11&months=13')).status, 422);
  assert.equal((await get(w, '/ledger/dashboard', 't_staff')).status, 403);
  const old = await get(world({ missing: true }), '/ledger/dashboard?month=2026-11&months=3');
  assert.equal(old.status, 200);
  assert.deepEqual([old.json.data.available, old.json.data.from], [false, '2026-09-01']);
  assert.ok(old.lines.some((l) => l.includes('apply database/migrations/0034')));
});

test('GET /ledger/dashboard?company= — 본사 대표는 협력업체 월 보고서를 보기만 (그 업체 묶음 · 사람 없는 자격), 본사 직원 403 not_member', async () => {
  const w = world();
  const r = await get(w, `/ledger/dashboard?month=2026-11&company=${CO}`, 't_pf_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual([d.level, d.viewing, d.available, d.vat_type, d.pending_photos], ['read', true, true, 'general', 2]);
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_summary').body, { p_company: CO, p_from: '2025-12-01', p_to: '2026-11-30' });
  const ent = w.calls.filter((c) => c.name === 'company_entitled' && c.body.p_company === CO);
  assert.ok(ent.length && ent.every((c) => !('p_user' in c.body)), '협력업체 자격은 사람 없이 본다');
  const staff = await get(world(), `/ledger/dashboard?month=2026-11&company=${CO}`, 't_pf_staff');
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_member');
});
