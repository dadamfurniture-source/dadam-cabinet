/**
 * 월 마감 메모 (src/ledger/close-memo.js — 2026-11-06 결정 6-L3: 서버가 센 목록 · 담을 것 여덟).
 *
 *   - 장부 줄: 증빙 없는 지출 · 3만 원 넘는 간이영수증 (취소 줄 · 매출 줄 뺌, 3만 원은 넘을 때만)
 *   - 바뀐 계정: 지출 계정마다 그 달 − 전달, 크기 순 셋 (0 은 뺌) · 부가세: 일반과세만 셈
 *   - 주소: 여덟 항목 차례 · 기다리는 명세표 · 확인 안 한 사진 · 늦은 받을 돈(고객 이름 없음) · 그 달(한국 시간) 중복 알림
 *   - 대표 · 실장만 (직원 403 not_money), DB 0034 전이면 available false
 *   - 본사 대표 · 실장은 ?company= 로 협력업체 것을 보기만 (월 보고서, access.js report) — 본사 직원 403 not_member
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { bookItems, accountChanges, vatItem, kstMonthBounds, MEMO_KEYS, EVIDENCE_MIN, ACCT_TOP } from '../src/ledger/close-memo.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const O = (i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const D = (i) => `0e000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const PLATFORM = 'c0000000-0000-4000-8000-0000000000b1';
const HQ = 'c0000000-0000-4000-8000-0000000000b2';
const PF_OWNER = 'a0000000-0000-4000-8000-0000000000b1';
const PF_STAFF = 'a0000000-0000-4000-8000-0000000000b3';
const mem = (user_id, role, company_id = CO) => ({ user_id, company_id, role, status: 'active' });

const line = (o) => ({ direction: 'expense', evidence_type: 'card', amount: 10000, vat_amount: 1000, voided_at: null, entry_date: '2026-10-05', counterparty_name: '가나상사', account: 'A1', source: 'entry', ...o });

// ── 순수 ─────────────────────────────────────────────────

test('장부 줄 — 증빙 없는 지출 · 3만 원 넘는 간이영수증 (취소 · 매출 줄 뺌, 넘을 때만)', () => {
  const rows = [
    line({ evidence_type: 'none', amount: 50000, vat_amount: null }),
    line({ evidence_type: 'none', voided_at: '2026-10-06T00:00:00Z' }),
    line({ evidence_type: 'none', direction: 'income' }),
    line({ evidence_type: 'simple_receipt', amount: 30000, vat_amount: null }),
    line({ evidence_type: 'simple_receipt', amount: 30001, vat_amount: null }),
    line({ evidence_type: 'simple_receipt', amount: 28000, vat_amount: 2800 }),
    line({ evidence_type: 'statement', amount: 900000 }),
  ];
  const r = bookItems(rows);
  assert.equal(EVIDENCE_MIN, 30000);
  assert.deepEqual([r.noevid.n, r.noevid.amount], [1, 50000]);
  assert.deepEqual([r.simple30k.n, r.simple30k.amount], [2, 30001 + 30800]);
  assert.deepEqual(r.noevid.rows[0], { date: '2026-10-05', name: '가나상사', account: 'A1', amount: 50000, source: 'entry' });
});

test('바뀐 계정 — 지출만, 그 달 − 전달 크기 순 셋, 0 은 뺌 · 비율은 전달이 있을 때만', () => {
  const cur = [
    { direction: 'expense', account: 'A1', amount: 500000 },
    { direction: 'expense', account: 'A2', amount: 100000 },
    { direction: 'expense', account: 'A3', amount: 70000 },
    { direction: 'expense', account: 'A5', amount: 10000 },
    { direction: 'income', account: 'I1', amount: 9000000 },
  ];
  const prev = [
    { direction: 'expense', account: 'A1', amount: 100000 },
    { direction: 'expense', account: 'A2', amount: 100000 },
    { direction: 'expense', account: 'A4', amount: 300000 },
    { direction: 'expense', account: 'A5', amount: 5000 },
  ];
  const r = accountChanges(cur, prev);
  assert.equal(ACCT_TOP, 3);
  assert.deepEqual(r.rows.map((x) => [x.account, x.amount, x.prev, x.diff, x.rate]), [
    ['A1', 500000, 100000, 400000, 400],
    ['A4', 0, 300000, -300000, -100],
    ['A3', 70000, 0, 70000, null],
  ]);
  assert.equal(r.n, 3);
  assert.equal(accountChanges([], []).n, 0);
});

test('부가세 — 일반과세만 받은 − 낸 부가세, 모르는 줄 수는 늘', () => {
  const row = { income_vat: 100000, expense_vat: 30000, vat_unknown: 2 };
  assert.deepEqual(vatItem(row, 'general'), { key: 'vat', label: '부가세', n: 2, amount: 70000, income_vat: 100000, expense_vat: 30000, counted: true });
  assert.equal(vatItem(row, 'simplified').amount, null);
  assert.equal(vatItem(undefined, null).n, 0);
});

test('그 달 한국 시간 경계', () => {
  assert.deepEqual(kstMonthBounds('2026-10'), { start: '2026-09-30T15:00:00.000Z', end: '2026-10-31T15:00:00.000Z' });
  assert.deepEqual(kstMonthBounds('2026-12'), { start: '2026-11-30T15:00:00.000Z', end: '2026-12-31T15:00:00.000Z' });
});

// ── 주소 ─────────────────────────────────────────────────

function world({ missing = false } = {}) {
  const calls = [];
  const fake = createFake({
    tables: {
      companies: [{ id: CO, kind: 'partner', plan: 'expert', status: 'active' }, { id: PLATFORM, kind: 'platform', status: 'active' }, { id: HQ, kind: 'hq', status: 'active' }],
      company_members: [mem(OWNER, 'owner'), mem(STAFF, 'staff'), mem(PF_OWNER, 'owner', PLATFORM), mem(PF_STAFF, 'staff', PLATFORM)],
      company_settings: [{ company_id: CO, settings: { tax: { vat_type: 'general' } } }],
      ledger_documents: [
        { id: D(1), company_id: CO, review_status: 'pending' },
        { id: D(2), company_id: CO, review_status: 'pending' },
        { id: D(3), company_id: CO, review_status: 'held' },
        { id: D(4), company_id: CO, review_status: 'posted' },
      ],
      orders: [{ id: O(1), company_id: CO, order_no: '2610-03', status: 'in_production', customer_name: '김고객' }],
      order_payments: [
        { id: 'p1', order_id: O(1), stage: '중도금', amount: 4500000, due_on: '2026-10-25', paid_on: null },
        { id: 'p2', order_id: O(1), stage: '잔금', amount: 3200000, due_on: '2099-01-01', paid_on: null },
      ],
      ledger_notices: [
        { id: 'n1', company_id: CO, kind: 'duplicate', created_at: '2026-09-30T15:30:00Z', data: { supplier: '가나상사' } },
        { id: 'n2', company_id: CO, kind: 'duplicate', created_at: '2026-10-31T15:10:00Z', data: { supplier: '다음 달' } },
        { id: 'n3', company_id: CO, kind: 'large_amount', created_at: '2026-10-10T00:00:00Z', data: {} },
      ],
    },
    users: { t_owner: { id: OWNER }, t_staff: { id: STAFF }, t_pf_owner: { id: PF_OWNER }, t_pf_staff: { id: PF_STAFF } },
    rpc: (name, body) => {
      calls.push({ name, body });
      if (name === 'company_entitled') return 'full';
      if (missing && name === 'ledger_summary') return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.ledger_summary' } };
      if (name === 'ledger_summary') {
        return {
          months: [{ month: '2026-10', income_vat: 100000, expense_vat: 30000, vat_unknown: 1 }],
          accounts: [
            { month: '2026-10', direction: 'expense', account: 'A1', amount: 500000 },
            { month: '2026-09', direction: 'expense', account: 'A1', amount: 100000 },
          ],
        };
      }
      if (name === 'ledger_book') return [line({ evidence_type: 'none' }), line({ evidence_type: 'simple_receipt', amount: 40000 })];
      return undefined;
    },
  });
  return { fake, calls };
}

async function call(fake, path, token = 't_owner') {
  return withFake(fake, async () => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  });
}

test('GET /ledger/close-memo — 여덟 항목 차례 · 그 달 장부 · 지금 할 일 · 그 달 중복 알림', async () => {
  const w = world();
  const r = await call(w.fake, '/ledger/close-memo?month=2026-10');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.available, true);
  assert.deepEqual([d.month, d.prev_month, d.vat_type], ['2026-10', '2026-09', 'general']);
  assert.deepEqual(d.items.map((x) => x.key), MEMO_KEYS);
  assert.deepEqual(MEMO_KEYS, ['noevid', 'simple30k', 'invoice', 'photos', 'late', 'vat', 'acct', 'dup']);
  const by = Object.fromEntries(d.items.map((x) => [x.key, x]));
  assert.deepEqual([by.noevid.n, by.simple30k.n, by.invoice.n, by.photos.n], [1, 1, 1, 2]);
  assert.deepEqual([by.late.n, by.late.amount, by.late.rows[0].order_no], [1, 4500000, '2610-03']);
  assert.deepEqual([by.vat.amount, by.vat.n], [70000, 1]);
  assert.deepEqual(by.acct.rows.map((x) => [x.account, x.diff]), [['A1', 400000]]);
  assert.deepEqual(by.dup.rows, [{ date: '2026-10-01', name: '가나상사' }]);
  assert.ok(!JSON.stringify(d).includes('고객'), '고객 이름 없음');
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_summary').body, { p_company: CO, p_from: '2026-09-01', p_to: '2026-10-31' });
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_book').body, { p_company: CO, p_from: '2026-10-01', p_to: '2026-10-31', p_include_void: false });
});

test('GET /ledger/close-memo — 직원 403 not_money · 달 모양 422 · DB 0034 전이면 available false', async () => {
  const s = await call(world().fake, '/ledger/close-memo?month=2026-10', 't_staff');
  assert.equal(s.status, 403);
  assert.equal(s.json.code, 'not_money');
  const bad = await call(world().fake, '/ledger/close-memo?month=2026-13');
  assert.equal(bad.status, 422);
  const miss = await call(world({ missing: true }).fake, '/ledger/close-memo?month=2026-10');
  assert.equal(miss.status, 200);
  assert.equal(miss.json.data.available, false);
});

test('GET /ledger/close-memo?company= — 본사 대표는 협력업체 월 마감 메모를 보기만, 본사 직원 403 not_member', async () => {
  const w = world();
  const r = await call(w.fake, `/ledger/close-memo?month=2026-10&company=${CO}`, 't_pf_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual([d.level, d.viewing, d.available, d.vat_type], ['read', true, true, 'general']);
  assert.deepEqual(d.items.map((x) => x.key), MEMO_KEYS);
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_book').body, { p_company: CO, p_from: '2026-10-01', p_to: '2026-10-31', p_include_void: false });
  const ent = w.calls.filter((c) => c.name === 'company_entitled' && c.body.p_company === CO);
  assert.ok(ent.length && ent.every((c) => !('p_user' in c.body)), '협력업체 자격은 사람 없이 본다');
  const staff = await call(world().fake, `/ledger/close-memo?month=2026-10&company=${CO}`, 't_pf_staff');
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_member');
});
