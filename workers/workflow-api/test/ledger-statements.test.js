/**
 * 거래명세표 모아 붙이기 (src/ledger/statements.js — DB 0036) · 명세표 힌트 길 (hints.js) · 세금계산서 없음 cron (notices.js).
 *
 *   - 고르기 · 모아 두기 · 되돌리기 · 모아 둔 목록(거래처 · 달 묶음, 늦음) · 붙일 줄 · 붙이기(맞춰 보기만 / 진짜)
 *   - 대표 · 실장만 (직원 403), 남의 업체 줄 404, 0036 전이면 읽기 available false · 쓰기 409 no_function
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { groupHeld, heldLate, documentIds, HOLD_MAX, ATTACH_MAX, ENTRY_PICK } from '../src/ledger/statements.js';
import { hintView, invoiceRoute } from '../src/ledger/hints.js';
import { runLedgerNotices } from '../src/ledger/notices.js';
import { kstMonth } from '../src/ledger/dashboard.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const ENTRY = 'e0000000-0000-4000-8000-000000000001';
const ENTRY_OTHER = 'e0000000-0000-4000-8000-000000000002';
const ENTRY_VOID = 'e0000000-0000-4000-8000-000000000003';
const D = (i) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const mem = (user_id, role) => ({ user_id, company_id: CO, role, status: 'active' });
const kst = (s) => Date.parse(`${s}+09:00`);

function world({ rpc = {}, missing = false, docs = [] } = {}) {
  const calls = [];
  const fake = createFake({
    tables: {
      companies: [{ id: CO, kind: 'partner', plan: 'agent', status: 'active' }],
      company_members: [mem(OWNER, 'owner'), mem(STAFF, 'staff')],
      ledger_entries: [
        { id: ENTRY, company_id: CO, voided_at: null },
        { id: ENTRY_OTHER, company_id: CO2, voided_at: null },
        { id: ENTRY_VOID, company_id: CO, voided_at: '2026-11-01T00:00:00Z' },
      ],
      ledger_documents: docs,
      company_settings: [],
      ledger_supplier_modes: [{ company_id: CO, supplier_key: 'b1234567891', name: '가나목재', biz_no: '1234567891', name_key: '가나목재', mode: 'separate', set_at: '2026-11-04T00:00:00Z' }],
    },
    users: { t_owner: { id: OWNER }, t_staff: { id: STAFF } },
    rpc: (name, body) => {
      calls.push({ name, body });
      if (name === 'company_entitled') return 'full';
      if (missing && name.startsWith('ledger_')) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      if (name in rpc) return typeof rpc[name] === 'function' ? rpc[name](body) : rpc[name];
      return undefined;
    },
  });
  return { fake, calls };
}

async function call(w, path, { method = 'GET', body, token = 't_owner' } = {}) {
  return withFake(w.fake, async (lines) => {
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await worker.fetch(new Request(`https://api.test${path}`, init), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, lines };
  });
}

// ── 순수 ─────────────────────────────────────────────────

test('명세표 길 — 0036 힌트가 있을 때만: 안 고름 ask · 따로 줌 hold · 명세표만 줌 · 명세표 아님 null', () => {
  assert.equal(invoiceRoute('statement', { invoice_mode: null }), 'ask');
  assert.equal(invoiceRoute('statement', { invoice_mode: 'separate' }), 'hold');
  assert.equal(invoiceRoute('statement', { invoice_mode: 'statement_only' }), null);
  assert.equal(invoiceRoute('tax_invoice', { invoice_mode: null }), null);
  // 0036 전 힌트(칸 없음)는 지금처럼 — 막지 않는다
  assert.equal(invoiceRoute('statement', { trusted: true }), null);
  assert.equal(invoiceRoute('statement', null), null);
});

test('힌트 — 명세표는 고르기 전 invoice_mode, 따로 줌이면 hold 로 바로 올리기에서 빠진다', () => {
  const x = (evidence) => ({
    status: 'done',
    result: { issue_date: '2026-10-07', supplier_name: '가나목재', supply_amount: 300000, vat_amount: 30000, total_amount: 330000, evidence_type: evidence, items: [], unsure: [] },
    checks: { biz_no: 'ok', amounts: 'ok', date: 'ok', multiple: false },
  });
  const hints = (mode) => ({
    read: true,
    supplier: { biz_no: '1234567891', name: '가나목재' },
    supplier_key: 'b1234567891',
    invoice_mode: mode,
    trusted: true,
    memory: { posts: 3, entry_posts: 3, last: { src: 'entry' }, last_entry: { account: 'purchase.materials', evidence_type: 'statement', display_name: '가나목재' } },
  });
  const accounts = [{ code: 'purchase.materials', grp: 'purchase', active: true }];
  const ask = hintView(x('statement'), hints(null), accounts);
  assert.deepEqual(ask.invoice, { mode: null, route: 'ask' });
  assert.equal(ask.supplier.key, 'b1234567891');
  assert.ok(ask.blockers.includes('invoice_mode'));
  assert.equal(ask.ready, false);
  const hold = hintView(x('statement'), hints('separate'), accounts);
  assert.deepEqual(hold.invoice, { mode: 'separate', route: 'hold' });
  assert.ok(hold.blockers.includes('hold'));
  const only = hintView(x('statement'), hints('statement_only'), accounts);
  assert.deepEqual(only.invoice, { mode: 'statement_only', route: null });
  assert.deepEqual(only.blockers, []);
  assert.equal(only.ready, true);
});

test('모아 둔 목록 묶기 — 거래처 · 달(읽은 날짜, 없으면 올린 날 한국 날짜), 합은 모두 있을 때만, 늦음은 다음 달 11일부터', () => {
  assert.equal(heldLate('2026-10', '2026-11-10'), false);
  assert.equal(heldLate('2026-10', '2026-11-11'), true);
  assert.equal(heldLate('2026-12', '2027-01-11'), true);
  const row = (i, o) => ({ document_id: D(i), created_at: '2026-10-31T16:30:00Z', supplier_key: 'b1234567891', supplier_name: '가나목재', biz_no: '1234567891', name_key: '가나목재', issue_date: null, supply_amount: null, vat_amount: null, total_amount: null, invoice_mode: 'separate', ...o });
  const g = groupHeld(
    [
      row(1, { issue_date: '2026-10-07', supply_amount: 300000, vat_amount: 30000, total_amount: 330000 }),
      row(2, { issue_date: '2026-10-15', supply_amount: 500000, vat_amount: 50000, total_amount: 550000 }),
      row(3, { total_amount: 99000 }), // 읽은 날짜 없음 — 올린 날(한국 11.01)
      row(4, { supplier_key: 'n다라철물', supplier_name: '다라 철물', biz_no: null, name_key: '다라철물', issue_date: '2026-10-20', supply_amount: 50000, total_amount: 55000 }),
      { document_id: 'x' },
    ],
    '2026-11-04'
  );
  assert.deepEqual(
    g.map((x) => [x.supplier_key, x.month, x.count, x.supply, x.total, x.late]),
    [
      ['b1234567891', '2026-10', 2, 800000, 880000, false],
      ['n다라철물', '2026-10', 1, 50000, 55000, false],
      ['b1234567891', '2026-11', 1, null, 99000, false],
    ]
  );
  assert.deepEqual(g[0].documents.map((d) => d.id), [D(1), D(2)]);
  assert.throws(() => documentIds([], HOLD_MAX), /document_ids/);
  assert.throws(() => documentIds(['x'], HOLD_MAX), /사진 id/);
  assert.deepEqual(documentIds([D(1), D(1), D(2)], HOLD_MAX), [D(1), D(2)]);
  assert.throws(() => documentIds(Array.from({ length: ATTACH_MAX + 1 }, (_, i) => D(i + 1)), ATTACH_MAX), /100장/);
});

// ── 고르기 ────────────────────────────────────────────────

test('PUT /ledger/suppliers — 사진으로 고르면 서버가 열쇠 · 후보를 준다, 바꾼 사람은 나', async () => {
  const w = world({ rpc: { ledger_set_supplier_mode: { ok: true, key: 'b1234567891', mode: 'separate', name: '가나목재', released: 0, candidates: [D(1), D(2)] } } });
  const r = await call(w, '/ledger/suppliers', { method: 'PUT', body: { document_id: D(1), mode: 'separate' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { key: 'b1234567891', mode: 'separate', name: '가나목재', released: 0, candidates: [D(1), D(2)] });
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_set_supplier_mode').body, { p_company: CO, p_actor: OWNER, p_document: D(1), p_key: null, p_mode: 'separate' });
});

test('PUT /ledger/suppliers — 틀린 값 422 · 직원 403 · 거래처 못 읽음 422 · 0036 전 409', async () => {
  const w = world({ rpc: { ledger_set_supplier_mode: { ok: false, reason: 'no_supplier' } } });
  for (const body of [{ document_id: D(1), mode: 'maybe' }, { document_id: D(1), supplier_key: 'b1', mode: 'separate' }, { mode: 'separate' }, { supplier_key: 'x1', mode: 'separate' }]) {
    assert.equal((await call(w, '/ledger/suppliers', { method: 'PUT', body })).status, 422, JSON.stringify(body));
  }
  assert.equal((await call(w, '/ledger/suppliers', { method: 'PUT', body: { document_id: D(1), mode: 'separate' }, token: 't_staff' })).status, 403);
  const none = await call(w, '/ledger/suppliers', { method: 'PUT', body: { supplier_key: 'b1234567891', mode: 'statement_only' } });
  assert.equal(none.status, 422);
  const old = await call(world({ missing: true }), '/ledger/suppliers', { method: 'PUT', body: { document_id: D(1), mode: 'separate' } });
  assert.equal(old.status, 409);
  assert.equal(old.json.code || (old.json.details && old.json.details.code) || old.json.error_code, 'no_function', JSON.stringify(old.json));
});

test('GET /ledger/suppliers — 그 업체 고른 것 (최근부터), 직원 403', async () => {
  const w = world();
  const r = await call(w, '/ledger/suppliers');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.available, true);
  assert.deepEqual(r.json.data.items.map((x) => [x.supplier_key, x.mode]), [['b1234567891', 'separate']]);
  assert.equal((await call(w, '/ledger/suppliers', { token: 't_staff' })).status, 403);
});

// ── 모아 두기 ──────────────────────────────────────────────

test('POST /ledger/documents/hold · unhold — 겹친 id 는 하나로, 수를 돌려준다', async () => {
  const w = world({ rpc: { ledger_hold_documents: 2, ledger_unhold_documents: 1 } });
  const h = await call(w, '/ledger/documents/hold', { method: 'POST', body: { document_ids: [D(1), D(2), D(1)] } });
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.deepEqual(h.json.data, { held: 2 });
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_hold_documents').body, { p_company: CO, p_actor: OWNER, p_documents: [D(1), D(2)] });
  const u = await call(w, '/ledger/documents/unhold', { method: 'POST', body: { document_ids: [D(1)] } });
  assert.deepEqual(u.json.data, { released: 1 });
  assert.equal((await call(w, '/ledger/documents/hold', { method: 'POST', body: { document_ids: [] } })).status, 422);
  assert.equal((await call(w, '/ledger/documents/hold', { method: 'POST', body: { document_ids: [D(1)] }, token: 't_staff' })).status, 403);
});

test('GET /ledger/held — 묶음 · 장 수, 0036 전이면 available false', async () => {
  const thisMonth = kstMonth(Date.now());
  const w = world({
    rpc: {
      ledger_held_documents: [
        { document_id: D(1), created_at: '2026-01-05T00:00:00Z', supplier_key: 'b1234567891', supplier_name: '가나목재', biz_no: '1234567891', name_key: '가나목재', issue_date: '2026-01-05', supply_amount: 100, vat_amount: 10, total_amount: 110, invoice_mode: 'separate' },
        { document_id: D(2), created_at: new Date().toISOString(), supplier_key: 'b1234567891', supplier_name: '가나목재', biz_no: '1234567891', name_key: '가나목재', issue_date: `${thisMonth}-01`, supply_amount: 200, vat_amount: 20, total_amount: 220, invoice_mode: 'separate' },
      ],
    },
  });
  const r = await call(w, '/ledger/held');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.count, 2);
  assert.deepEqual(r.json.data.groups.map((g) => [g.month, g.count, g.late]), [
    ['2026-01', 1, true],
    [thisMonth, 1, false],
  ]);
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_held_documents').body, { p_company: CO });
  const old = await call(world({ missing: true }), '/ledger/held');
  assert.equal(old.status, 200);
  assert.deepEqual([old.json.data.available, old.json.data.count], [false, 0]);
  assert.equal((await call(w, '/ledger/held', { token: 't_staff' })).status, 403);
});

// ── 붙이기 ────────────────────────────────────────────────

test('GET /ledger/held/entries — 그 거래처 줄 (최근 20), 번호 · 상호 열쇠 확인', async () => {
  const w = world({ rpc: { ledger_supplier_entries: [{ entry_id: ENTRY, entry_date: '2026-10-31', amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice', counterparty_name: '(주)가나목재', supporting: 0 }] } });
  const r = await call(w, `/ledger/held/entries?biz_no=1234567891&name_key=${encodeURIComponent('가나목재')}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.items.length, 1);
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_supplier_entries').body, { p_company: CO, p_biz: '1234567891', p_name_key: '가나목재', p_limit: ENTRY_PICK });
  assert.equal((await call(w, '/ledger/held/entries')).status, 422);
  assert.equal((await call(w, '/ledger/held/entries?biz_no=123')).status, 422);
});

test('POST /ledger/entries/:id/attach — dry_run 은 맞춰 보기만, 진짜는 한 번에 붙인다', async () => {
  const cmp = { ok: true, n: 3, basis: 'supply', statements: 1000000, invoice: 1000000, diff: 0, match: true, missing: 0 };
  const w = world({ rpc: { ledger_statements_compare: cmp, ledger_attach_statements: { ok: true, attached: 3, compare: { n: 3, basis: 'supply', diff: 0, match: true } } } });
  const dry = await call(w, `/ledger/entries/${ENTRY}/attach`, { method: 'POST', body: { document_ids: [D(1), D(2), D(3)], dry_run: true } });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.deepEqual(dry.json.data, { attached: 0, compare: { n: 3, basis: 'supply', statements: 1000000, invoice: 1000000, diff: 0, match: true, missing: 0 }, dry_run: true });
  assert.equal(w.calls.some((c) => c.name === 'ledger_attach_statements'), false);
  const real = await call(w, `/ledger/entries/${ENTRY}/attach`, { method: 'POST', body: { document_ids: [D(1), D(2), D(3)] } });
  assert.equal(real.status, 200, JSON.stringify(real.json));
  assert.deepEqual(real.json.data, { attached: 3, compare: { n: 3, basis: 'supply', diff: 0, match: true }, dry_run: false });
  assert.deepEqual(w.calls.find((c) => c.name === 'ledger_attach_statements').body, { p_entry: ENTRY, p_actor: OWNER, p_documents: [D(1), D(2), D(3)] });
});

test('POST /ledger/entries/:id/attach — 남의 업체 줄 · 취소한 줄 404 (함수를 부르지 않는다), 붙일 수 없는 사진 409, 직원 403', async () => {
  const w = world({ rpc: { ledger_attach_statements: { ok: false, reason: 'not_attachable', documents: [D(2)] } } });
  for (const id of [ENTRY_OTHER, ENTRY_VOID, 'nope']) {
    assert.equal((await call(w, `/ledger/entries/${id}/attach`, { method: 'POST', body: { document_ids: [D(1)] } })).status, 404, id);
  }
  assert.equal(w.calls.some((c) => c.name.startsWith('ledger_attach') || c.name === 'ledger_statements_compare'), false);
  const bad = await call(w, `/ledger/entries/${ENTRY}/attach`, { method: 'POST', body: { document_ids: [D(1), D(2)] } });
  assert.equal(bad.status, 409, JSON.stringify(bad.json));
  assert.match(JSON.stringify(bad.json), /not_attachable/);
  assert.equal((await call(w, `/ledger/entries/${ENTRY}/attach`, { method: 'POST', body: { document_ids: [D(1)] }, token: 't_staff' })).status, 403);
});

// ── 세금계산서 없음 cron ───────────────────────────────────

test('매달 11일부터 07:55 — 지난달 · 그 앞 달을 훑는다 (10일 · 다른 분은 안 부른다)', async () => {
  const w = world({ rpc: { ledger_invoice_missing_scan: 1 } });
  const out = await withFake(w.fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-11-11T07:55:00') }));
  assert.equal(out.invoice, 2);
  assert.deepEqual(w.calls.filter((c) => c.name === 'ledger_invoice_missing_scan').map((c) => c.body.p_month), ['2026-10-01', '2026-09-01']);
  const w2 = world({ rpc: { ledger_invoice_missing_scan: 1 } });
  await withFake(w2.fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-11-10T07:55:00') }));
  await withFake(w2.fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-11-11T07:54:00') }));
  assert.equal(w2.calls.some((c) => c.name === 'ledger_invoice_missing_scan'), false);
  // 1월이면 지난해 12월 · 11월
  const w3 = world({ rpc: { ledger_invoice_missing_scan: 0 } });
  await withFake(w3.fake, () => runLedgerNotices(ENV, { nowMs: kst('2027-01-11T07:55:00') }));
  assert.deepEqual(w3.calls.filter((c) => c.name === 'ledger_invoice_missing_scan').map((c) => c.body.p_month), ['2026-12-01', '2026-11-01']);
});

test('대시보드 · 직원 사진 목록 — 모아 둔 명세표는 따로 세고, 직원에게는 「올림」', async () => {
  const docs = [
    { id: D(1), company_id: CO, uploaded_by: STAFF, review_status: 'pending', created_at: '2026-11-01T00:00:00Z' },
    { id: D(2), company_id: CO, uploaded_by: STAFF, review_status: 'held', created_at: '2026-11-02T00:00:00Z' },
    { id: D(3), company_id: CO, uploaded_by: STAFF, review_status: 'held', created_at: '2026-11-03T00:00:00Z' },
  ];
  const w = world({ docs, rpc: { ledger_summary: { months: [], accounts: [], suppliers: [] } } });
  const d = await call(w, '/ledger/dashboard?month=2026-11');
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.deepEqual([d.json.data.pending_photos, d.json.data.held_statements], [1, 2]);
  const s = await call(w, '/ledger/documents', { token: 't_staff' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.deepEqual(s.json.data.items.map((x) => x.status).sort(), ['uploaded', 'uploaded', 'uploaded']);
});
