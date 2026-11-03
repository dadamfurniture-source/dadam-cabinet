/**
 * 장부 사진 읽기 걸기 · 확인 (src/ledger/extract.js · review.js) — 가짜 PostgREST · rpc · 버킷 서명 · 공공데이터포털 · assistant-api 바인딩.
 * DB 쪽 규칙(시도 잡기 · 다시 걸 사진 · 끝난 시도 고정)은 database/probes/0029-ledger-extract.json 이 실DB 에서 본다.
 *
 *   걸기     새 사진이면 올린 직후 ASSISTANT.extract (같은 사진 reused 는 아니다), 매분 cron 은 ledger_extract_due 가 준 사진마다
 *            바인딩이 없거나 함수가 없으면(0029 전) 건너뛴다 — 던지지 않는다
 *   역할     모두 대표 · 실장만 (직원 not_money — 응답 어디에도 금액 · 읽은 칸 · 사진 주소가 없다), 쓰기는 자격 full 의 자기 업체
 *   확인     확인 기다리는 사진 + 최근 시도 + 10분 서명 주소, 올리기(장부 줄 · 수주 원가 · 붙이기) → 고친 칸, 돌려보내기 · 버리기 · 다시 읽기
 *   한꺼번에 장마다 따로 (앞 장이 오르면 뒤 장이 실패해도 그대로)
 *   국세청   키가 없으면 available false, 24시간 캐시, 조회하면 캐시 · 거래처 칸을 고친다, 키는 로그에 없다
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { runExtractDue, DUE_LIMIT, DUE_WAIT_SEC, DUE_STUCK_SEC, MAX_ATTEMPTS, REREAD_BELOW } from '../src/ledger/extract.js';
import { feedbackFields, ntsRow, parseCostInput, BATCH_MAX, PHOTO_URL_TTL_SEC } from '../src/ledger/review.js';
import { proposalFor } from '../src/ledger/hints.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const CO = 'c0000000-0000-4000-8000-0000000000a1';
const CO_READ = 'c0000000-0000-4000-8000-0000000000a2';
const PLATFORM = 'c0000000-0000-4000-8000-0000000000b1';
const HQ = 'c0000000-0000-4000-8000-0000000000b2';
const OWNER = 'u-owner';
const MANAGER = 'u-manager';
const STAFF = 'u-staff';
const STRANGER = 'u-stranger';
const R_OWNER = 'u-read-owner';
const PF_OWNER = 'u-platform-owner';
const COMPANIES = [
  { id: CO, name: '한빛인테리어', kind: 'partner' },
  { id: PLATFORM, name: '다담 본사', kind: 'platform' },
  { id: HQ, name: '다담 공장', kind: 'hq' },
];
const MEMBERS = [
  { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
  { user_id: MANAGER, company_id: CO, role: 'manager', status: 'active' },
  { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
  { user_id: R_OWNER, company_id: CO_READ, role: 'owner', status: 'active' },
  { user_id: PF_OWNER, company_id: PLATFORM, role: 'owner', status: 'active' },
];
const LEVEL = { [CO]: 'full', [CO_READ]: 'read', [PLATFORM]: 'full', [HQ]: 'full' };
const ACCOUNTS = [
  { code: 'income.sales', name: '매출액', grp: 'income', sort: 10, note: null, active: true },
  { code: 'admin.supplies', name: '소모품비', grp: 'admin', sort: 190, note: null, active: true },
];
const BIZ_OK = '1248100998';
const BIZ_OTHER = '2208162517';
const CP_MINE = '0c000000-0000-4000-8000-000000000001';
const SUPPLIER = '0c000000-0000-4000-8000-000000000003';
const ORDER = '0d000000-0000-4000-8000-000000000001';
const ENTRY = '0e000000-0000-4000-8000-000000000001';
const D1 = 'd0000000-0000-4000-8000-000000000001';
const D2 = 'd0000000-0000-4000-8000-000000000002';
const D3 = 'd0000000-0000-4000-8000-000000000003';
const D_HQ = 'd0000000-0000-4000-8000-000000000004';
const X1 = 'f0000000-0000-4000-8000-000000000001';
const X2 = 'f0000000-0000-4000-8000-000000000002';
const NTS_KEY = 'secret-nts-key/with+chars';

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const fail = (status, body) => ({ ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const READ = {
  document_count: 1,
  evidence_type: 'card',
  issue_date: '2026-11-01',
  supplier_name: '한빛목재',
  supplier_biz_no: BIZ_OK,
  supply_amount: 100000,
  vat_amount: 10000,
  tax_free_amount: null,
  service_charge: null,
  total_amount: 110000,
  approval_no: '12345678',
  payment_method: 'card',
  items: [{ name: '합판', quantity: 2, unit_price: 50000, amount: 100000 }],
  unsure: [],
};
const CHECKS = { biz_no: 'ok', amounts: 'ok', items: 'ok', date: 'ok', multiple: false, redacted: 0 };

const doc = (id, company, over = {}) => ({
  id,
  company_id: company,
  uploaded_by: STAFF,
  storage_path: `${company}/2026/11/${id}.jpg`,
  mime: 'image/jpeg',
  size_bytes: 1000,
  sha256: id.slice(-1).repeat(64),
  width: 800,
  height: 1200,
  note: '현장 메모',
  review_status: 'pending',
  decided_by: null,
  decided_at: null,
  decision_reason: null,
  created_at: `2026-11-0${id.slice(-1)}T01:00:00.000Z`,
  ...over,
});

/** 가짜 DB */
function makeDb(over = {}) {
  const state = {
    documents: [doc(D1, CO), doc(D2, CO), doc(D3, CO, { review_status: 'posted' }), doc(D_HQ, HQ)],
    extractions: [
      { id: X1, document_id: D1, attempt: 1, status: 'failed', model: 'claude-haiku-5-5', schema_version: 1, result: null, checks: null, error: 'stuck', started_at: '2026-11-01T01:01:00Z', finished_at: '2026-11-01T01:11:00Z' },
      { id: X2, document_id: D1, attempt: 2, status: 'done', model: 'claude-haiku-5-5', schema_version: 1, result: READ, checks: CHECKS, error: null, started_at: '2026-11-01T01:12:00Z', finished_at: '2026-11-01T01:12:30Z' },
    ],
    feedback: [],
    nts: [],
    counterparties: [
      { id: CP_MINE, company_id: CO, kind: 'customer', name: '한빛목재', biz_no: BIZ_OK },
      { id: SUPPLIER, company_id: CO, kind: 'supplier', name: '예림', biz_no: null },
    ],
    cpPatches: [],
    rpc: [],
    signs: [],
    signFails: false,
    feedbackFails: false,
    due: [],
    dueError: null,
    nts_api: [],
    ntsReply: null,
    uploads: [],
    // ledger_review_hints (DB 0033) — 사진 id → 힌트. null 이면 함수가 없다(적용 전)
    hints: {},
    ...over,
  };
  const eq = (q, key) => {
    const v = q.get(key);
    return v && v.startsWith('eq.') ? v.slice(3) : null;
  };
  const match = (q, row, keys) => keys.every((k) => eq(q, k) === null || String(row[k]) === eq(q, k));
  const inList = (q, key) => {
    const v = q.get(key);
    return v && v.startsWith('in.(') ? v.slice(4, -1).split(',') : null;
  };
  state.route = (u, method, body) => {
    if (u.startsWith('https://api.odcloud.kr/')) {
      state.nts_api.push({ url: u, method, body });
      return state.ntsReply ? state.ntsReply(body) : fail(500, {});
    }
    if (u.startsWith(`${ENV.SUPABASE_URL}/storage/v1/object/sign/ledger-evidence`)) {
      state.signs.push(body);
      if (state.signFails) return fail(500, { message: 'sign failed' });
      return json(body.paths.map((p) => ({ path: p, signedURL: `/object/sign/ledger-evidence/${p}?token=t` })));
    }
    if (u.startsWith(`${ENV.SUPABASE_URL}/storage/v1/object/ledger-evidence/`)) {
      state.uploads.push(u);
      return json({ Key: 'ok' });
    }
    if (!u.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) return null;
    const path = u.slice(`${ENV.SUPABASE_URL}/rest/v1`.length);
    const q = path.includes('?') ? new URL(u).searchParams : new URLSearchParams();
    if (path.startsWith('/company_members?')) {
      return json(MEMBERS.filter((m) => match(q, m, ['user_id', 'status'])).map((m) => ({ company_id: m.company_id, role: m.role })));
    }
    if (path.startsWith('/companies?')) {
      const kind = eq(q, 'kind');
      if (kind) return json(COMPANIES.filter((c) => c.kind === kind).map((c) => ({ id: c.id })));
      const ids = inList(q, 'id') || [];
      return json(COMPANIES.filter((c) => ids.includes(c.id)));
    }
    if (path.startsWith('/admin_roles?')) return json([]);
    if (path === '/rpc/company_entitled') return json(LEVEL[body.p_company] || 'none');
    if (path.startsWith('/ledger_accounts?')) return json(ACCOUNTS);
    if (path.startsWith('/counterparties')) {
      if (method === 'GET') return json(state.counterparties.filter((r) => match(q, r, ['id', 'company_id'])));
      if (method === 'PATCH') {
        state.cpPatches.push({ query: q.toString(), body });
        const hit = state.counterparties.filter((r) => match(q, r, ['company_id', 'biz_no']));
        for (const r of hit) Object.assign(r, body);
        return json(hit);
      }
    }
    if (path.startsWith('/ledger_documents')) {
      if (method === 'GET') {
        const ids = inList(q, 'id');
        let rows = state.documents.filter((r) => (ids ? ids.includes(r.id) : true) && match(q, r, ['id', 'company_id', 'review_status', 'sha256', 'idempotency_key', 'uploaded_by']));
        const c = q.get('created_at');
        if (c && c.startsWith('lt.')) rows = rows.filter((r) => r.created_at < c.slice(3));
        if (c && c.startsWith('gte.')) rows = rows.filter((r) => r.created_at >= new Date(c.slice(4).replace(' ', '+')).toISOString());
        rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
        return json(rows.slice(0, Number(q.get('limit')) || rows.length));
      }
      if (method === 'POST') {
        const row = { review_status: 'pending', decided_by: null, decided_at: null, decision_reason: null, created_at: new Date().toISOString(), ...body };
        state.documents.push(row);
        return json([row], 201);
      }
      if (method === 'PATCH') {
        const hit = state.documents.filter((r) => match(q, r, ['id', 'company_id', 'review_status']));
        for (const r of hit) Object.assign(r, body);
        return json(hit);
      }
    }
    if (path.startsWith('/ledger_extractions?')) {
      const ids = inList(q, 'document_id');
      let rows = state.extractions.filter((x) => (ids ? ids.includes(x.document_id) : true) && match(q, x, ['document_id', 'status']));
      rows = [...rows].sort((a, b) => b.attempt - a.attempt);
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (path.startsWith('/ledger_extraction_feedback')) {
      if (state.feedbackFails) return fail(500, { message: 'boom' });
      const list = Array.isArray(body) ? body : [body];
      state.feedback.push(...list);
      return json(list, 201);
    }
    if (path.startsWith('/nts_business_status')) {
      if (method === 'GET') return json(state.nts.filter((r) => match(q, r, ['biz_no'])));
      if (method === 'POST') {
        assert.equal(q.get('on_conflict'), 'biz_no');
        state.nts = state.nts.filter((r) => r.biz_no !== body.biz_no).concat([body]);
        return json([body], 201);
      }
    }
    if (path === '/rpc/ledger_post_document') {
      state.rpc.push({ fn: 'ledger_post_document', body });
      const d = state.documents.find((x) => x.id === body.p_document);
      if (!d) return json({ ok: false, reason: 'not_found' });
      if (d.review_status !== 'pending') return json({ ok: false, reason: 'not_pending', status: d.review_status });
      const p = body.p_payload;
      if (p.target === 'order_cost' && p.order_id !== ORDER) return json({ ok: false, reason: 'order_not_found' });
      if (p.target === 'attach' && p.entry_id && p.entry_id !== ENTRY) return json({ ok: false, reason: 'entry_not_found' });
      d.review_status = 'posted';
      return json({ ok: true, entry_id: p.target === 'entry' ? ENTRY : p.entry_id || null, cost_id: p.target === 'order_cost' ? 'cost-new' : p.cost_id || null, role: p.target === 'attach' ? 'supporting' : 'primary' });
    }
    if (path === '/rpc/ledger_review_hints') {
      state.rpc.push({ fn: 'ledger_review_hints', body });
      if (state.hints === null) return fail(404, { code: 'PGRST202', message: 'Could not find the function public.ledger_review_hints' });
      return json(body.p_documents.filter((id) => state.hints[id]).map((id) => ({ document_id: id, hints: state.hints[id] })));
    }
    if (path === '/rpc/ledger_extract_due') {
      state.rpc.push({ fn: 'ledger_extract_due', body });
      if (state.dueError) return state.dueError;
      return json(state.due);
    }
    return null;
  };
  return state;
}

function makeAssistant(reply = { ok: true, queued: true }) {
  const a = {
    calls: [],
    async extract(x) {
      a.calls.push(x);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return a;
}

/** 로그를 모은다 (키가 로그에 없는지 본다) */
async function withLogs(fn) {
  const lines = [];
  const keep = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(keep)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    return { out: await fn(), lines };
  } finally {
    Object.assign(console, keep);
  }
}

/** worker.fetch — waitUntil 약속을 기다린다. calls 에 x-actor-id 를 남긴다 */
async function call(db, path, token, { method = 'GET', body, raw, headers = {}, env = ENV } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const waits = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const m = init.method || 'GET';
    const h = init.headers || {};
    const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: m, body: parsed, actor: h['x-actor-id'] || null });
    if (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`)) return json({ id: token });
    const res = db.route(String(url).startsWith('https://api.odcloud.kr/') ? String(url) : u, m, parsed);
    if (!res) throw new Error(`unexpected fetch ${m} ${u}`);
    return res;
  };
  try {
    const h = { Authorization: `Bearer ${token}`, ...headers };
    let reqBody;
    if (raw !== undefined) reqBody = raw;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    }
    const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: reqBody }), env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text, calls, waits: waits.length, cache: res.headers.get('Cache-Control') };
  } finally {
    globalThis.fetch = original;
  }
}

const rpcCalls = (calls, fn) => calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${fn}`));

const entryBody = (over = {}) => ({
  target: 'entry',
  entry: {
    entry_date: '2026-11-01',
    direction: 'expense',
    account: 'admin.supplies',
    counterparty_name: '한빛목재',
    counterparty_biz_no: BIZ_OK,
    amount: 110000,
    vat_amount: 10000,
    evidence_type: 'card',
    payment_method: 'card',
    ...over,
  },
});

/** JPEG — APP0 + SOF0 (너비 · 높이) + 덧붙인 바이트 */
function jpeg(width, height, tail = [1, 2, 3]) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xda, 0x00, 0x02, ...tail, 0xff, 0xd9]);
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── 걸기 ─────────────────────────────────────────────────

test('올린 직후 — 새 사진이면 그 사진의 읽기를 건다, 같은 사진(reused)은 걸지 않는다, 바인딩이 없어도 올리기는 된다', async () => {
  const db = makeDb({ documents: [] });
  const assistant = makeAssistant();
  const env = { ...ENV, ASSISTANT: assistant };
  const first = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(800, 600, [7]), env });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.waits, 1);
  assert.deepEqual(assistant.calls, [{ documentId: first.body.data.document.id, again: false }]);

  const again = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(800, 600, [7]), env });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.reused, true);
  assert.equal(assistant.calls.length, 1);

  const { out, lines } = await withLogs(() => call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(800, 600, [8]) }));
  assert.equal(out.status, 201);
  assert.ok(lines.every((l) => !l.includes('extract request failed')));
});

test('올린 직후 — 걸기가 실패해도 올리기는 201', async () => {
  const db = makeDb({ documents: [] });
  const env = { ...ENV, ASSISTANT: makeAssistant(new Error('down')) };
  const { out, lines } = await withLogs(() => call(db, '/ledger/documents', OWNER, { method: 'POST', raw: jpeg(800, 600, [9]), env }));
  assert.equal(out.status, 201);
  assert.ok(lines.some((l) => l.includes('[Ledger] extract request failed')));
});

test('매분 cron — ledger_extract_due 가 준 사진마다 건다(낮은 판으로 읽은 사진은 다시로), 함수 · 바인딩이 없거나 오류면 건너뛴다 (던지지 않는다)', async () => {
  const original = globalThis.fetch;
  try {
    const db = makeDb({ due: [{ document_id: D1, company_id: CO, reread: false }, { document_id: D2, company_id: CO, reread: true }, { document_id: 'x', company_id: CO, reread: true }] });
    globalThis.fetch = async (url, init = {}) => db.route(decodeURIComponent(String(url)), init.method || 'GET', init.body ? JSON.parse(init.body) : null);
    const assistant = makeAssistant();
    assert.deepEqual(await runExtractDue({ ...ENV, ASSISTANT: assistant }), { due: 3, queued: 2 });
    assert.deepEqual(db.rpc[0].body, { p_limit: DUE_LIMIT, p_wait_sec: DUE_WAIT_SEC, p_stuck_sec: DUE_STUCK_SEC, p_max_attempts: MAX_ATTEMPTS, p_reread_below: REREAD_BELOW });
    assert.deepEqual([DUE_LIMIT, DUE_WAIT_SEC, DUE_STUCK_SEC, MAX_ATTEMPTS, REREAD_BELOW], [5, 120, 600, 2, 3]);
    assert.deepEqual(assistant.calls, [{ documentId: D1, again: false }, { documentId: D2, again: true }]);

    assert.deepEqual(await runExtractDue(ENV), { due: 0, queued: 0, skipped: 'no_binding' });

    const missing = makeDb({ dueError: fail(404, { code: 'PGRST202', message: 'Could not find the function public.ledger_extract_due' }) });
    globalThis.fetch = async (url, init = {}) => missing.route(decodeURIComponent(String(url)), init.method || 'GET', init.body ? JSON.parse(init.body) : null);
    const m = await withLogs(() => runExtractDue({ ...ENV, ASSISTANT: makeAssistant() }));
    assert.equal(m.out.skipped, 'no_function');

    const broken = makeDb({ dueError: fail(500, { message: 'boom' }) });
    globalThis.fetch = async (url, init = {}) => broken.route(decodeURIComponent(String(url)), init.method || 'GET', init.body ? JSON.parse(init.body) : null);
    const b = await withLogs(() => runExtractDue({ ...ENV, ASSISTANT: makeAssistant() }));
    assert.equal(b.out.skipped, 'error');
  } finally {
    globalThis.fetch = original;
  }
});

test('scheduled() — 1분 cron 은 바인딩이 있을 때 사진 읽기 다시 걸기를 더한다', async () => {
  const original = globalThis.fetch;
  const db = makeDb({ due: [{ document_id: D2, company_id: CO }] });
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    return db.route(u, init.method || 'GET', init.body ? JSON.parse(init.body) : null) || json([]);
  };
  try {
    const assistant = makeAssistant();
    const waits = [];
    await withLogs(async () => {
      await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse('2026-11-03T03:01:00Z') }, { ...ENV, ASSISTANT: assistant }, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    });
    assert.deepEqual(assistant.calls, [{ documentId: D2, again: false }]);
    const without = [];
    await withLogs(async () => {
      await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse('2026-11-03T03:01:00Z') }, ENV, { waitUntil: (p) => without.push(p) });
      await Promise.all(without);
    });
    assert.equal(waits.length, without.length + 1);
  } finally {
    globalThis.fetch = original;
  }
});

// ── 역할 ─────────────────────────────────────────────────

const ROUTES = [
  ['GET', '/ledger/review', undefined],
  ['POST', `/ledger/documents/${D1}/post`, entryBody()],
  ['POST', `/ledger/documents/${D1}/return`, { reason: '흐림' }],
  ['POST', `/ledger/documents/${D1}/reject`, { reason: '중복' }],
  ['POST', `/ledger/documents/${D1}/reread`, undefined],
  ['POST', '/ledger/review/post', { items: [{ id: D1, ...entryBody() }] }],
  ['GET', `/ledger/business-status?biz_no=${BIZ_OK}`, undefined],
];

test('직원은 모두 403 not_money — 응답 어디에도 금액 · 읽은 칸 · 사진 주소 · 메모가 없다, 구성원 아니면 not_member', async () => {
  const banned = ['amount', 'vat_amount', 'supply_amount', 'total_amount', 'result', 'extraction', 'photo_url', 'note', 'checks', 'storage_path'];
  for (const [method, path, body] of ROUTES) {
    const db = makeDb();
    const env = { ...ENV, ASSISTANT: makeAssistant(), NTS_SERVICE_KEY: NTS_KEY };
    const r = await call(db, path, STAFF, { method, body, env });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'not_money');
    const keys = [];
    const walk = (v) => {
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        keys.push(k);
        walk(x);
      }
    };
    walk(r.body);
    for (const k of banned) assert.ok(!keys.includes(k), `${path} ${k}`);
    assert.equal(rpcCalls(r.calls, 'ledger_post_document').length, 0);
    assert.equal(db.nts_api.length, 0);
    const s = await call(makeDb(), path, STRANGER, { method, body, env });
    assert.equal(s.status, 403);
    assert.equal(s.body.code, 'not_member');
  }
});

test('보기만(read) 업체 · 본사의 공장 보기 — 목록은 되고 쓰기는 read_only', async () => {
  const db = makeDb({ documents: [doc(D1, CO_READ)] });
  const list = await call(db, '/ledger/review', R_OWNER);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.level, 'read');
  const post = await call(db, `/ledger/documents/${D1}/post`, R_OWNER, { method: 'POST', body: entryBody() });
  assert.equal(post.status, 403);
  assert.equal(post.body.code, 'read_only');

  const hq = await call(makeDb(), `/ledger/review?company=${HQ}`, PF_OWNER);
  assert.equal(hq.status, 200, hq.text);
  assert.equal(hq.body.data.viewing, true);
  assert.deepEqual(hq.body.data.items.map((d) => d.id), [D_HQ]);
});

// ── 확인 목록 ─────────────────────────────────────────────

test('확인 목록 — 확인 기다리는 사진 · 최근 시도 · 10분 서명 주소, 캐시 없음', async () => {
  const db = makeDb();
  const r = await call(db, '/ledger/review', MANAGER);
  assert.equal(r.status, 200, r.text);
  assert.match(r.cache, /no-store/);
  const items = r.body.data.items;
  assert.deepEqual(items.map((d) => d.id), [D2, D1]);
  const one = items.find((d) => d.id === D1);
  assert.equal(one.extraction.id, X2);
  assert.equal(one.extraction.attempt, 2);
  assert.equal(one.extraction.status, 'done');
  assert.deepEqual(one.extraction.result, READ);
  assert.deepEqual(one.extraction.checks, CHECKS);
  assert.equal(one.note, '현장 메모');
  assert.equal(one.photo_url, `${ENV.SUPABASE_URL}/storage/v1/object/sign/ledger-evidence/${CO}/2026/11/${D1}.jpg?token=t`);
  assert.equal(one.photo_expires_in, PHOTO_URL_TTL_SEC);
  assert.ok(!('storage_path' in one));
  assert.equal(items.find((d) => d.id === D2).extraction, null);
  assert.deepEqual(db.signs, [{ expiresIn: 600, paths: [`${CO}/2026/11/${D2}.jpg`, `${CO}/2026/11/${D1}.jpg`] }]);

  // 다른 상태 · 틀린 상태 · before · limit
  const posted = await call(makeDb(), '/ledger/review?status=posted', OWNER);
  assert.deepEqual(posted.body.data.items.map((d) => d.id), [D3]);
  assert.equal((await call(makeDb(), '/ledger/review?status=nope', OWNER)).status, 422);
  const older = await call(makeDb(), `/ledger/review?before=${encodeURIComponent('2026-11-02T00:00:00Z')}&limit=1`, OWNER);
  assert.deepEqual(older.body.data.items.map((d) => d.id), [D1]);
});

test('확인 목록 — 서명이 실패해도 목록은 준다 (사진 칸만 비고, 주소는 로그에 없다)', async () => {
  const db = makeDb({ signFails: true });
  const { out, lines } = await withLogs(() => call(db, '/ledger/review', OWNER));
  assert.equal(out.status, 200);
  assert.ok(out.body.data.items.every((d) => d.photo_url === null));
  assert.ok(lines.some((l) => l.includes('photo sign failed')));
  assert.ok(lines.every((l) => !l.includes('/storage/v1/')));
});

// ── 올리기 ───────────────────────────────────────────────

test('장부 줄로 올리기 — 계정 · 거래처를 먼저 보고 DB 함수 한 번 (바꾼 사람 머리), 다른 칸만 고친 칸으로', async () => {
  const db = makeDb();
  const r = await call(db, `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body: entryBody() });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body.data, { document_id: D1, target: 'entry', entry_id: ENTRY, cost_id: null, role: 'primary' });
  const [rpc] = rpcCalls(r.calls, 'ledger_post_document');
  assert.equal(rpc.actor, OWNER);
  assert.equal(rpc.body.p_actor, OWNER);
  assert.equal(rpc.body.p_payload.target, 'entry');
  assert.equal(rpc.body.p_payload.entry.amount, 110000);
  assert.equal(rpc.body.p_payload.entry.counterparty_biz_no, BIZ_OK);
  // 고친 칸 — 화면이 채운 금액 100,000 을 110,000 으로 · 합계 · 계정(기억 · AI 제안 없음)
  assert.deepEqual(db.feedback, [
    {
      company_id: CO,
      document_id: D1,
      extraction_id: X2,
      target: 'entry',
      fields: {
        amount: { read: 100000, posted: 110000 },
        total_amount: { read: 110000, posted: 120000 },
        account: { read: null, posted: 'admin.supplies', source: null },
        _meta: { account_source: null, schema_version: 1 },
      },
      changed_count: 3,
      created_by: OWNER,
    },
  ]);
  // 다시 올리면 409
  const again = await call(db, `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body: entryBody() });
  assert.equal(again.status, 409);
  assert.equal(rpcCalls(again.calls, 'ledger_post_document').length, 0);
});

test('올리기 — 계정 · 방향 · 입력이 틀리면 DB 함수를 부르지 않는다, 없는 사진 404', async () => {
  for (const body of [
    entryBody({ direction: 'income' }),
    entryBody({ amount: 0 }),
    entryBody({ counterparty_biz_no: '1234567890' }),
    { target: 'nope' },
    { target: 'entry' },
    { target: 'order_cost', order_id: 'x', cost: {} },
    { target: 'order_cost', order_id: ORDER, cost: { category: 'food', amount: 1 } },
    { target: 'attach', entry_id: ENTRY, cost_id: ENTRY },
    { target: 'attach' },
  ]) {
    const r = await call(makeDb(), `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body });
    assert.equal(r.status, 422, JSON.stringify(body) + r.text);
    assert.equal(rpcCalls(r.calls, 'ledger_post_document').length, 0);
  }
  assert.equal((await call(makeDb(), `/ledger/documents/${D_HQ}/post`, OWNER, { method: 'POST', body: entryBody() })).status, 404);
  assert.equal((await call(makeDb(), '/ledger/documents/not-a-uuid/post', OWNER, { method: 'POST', body: entryBody() })).status, 404);
});

test('수주 원가로 올리기 — 공급처 이름은 그 공급처, 고친 칸은 낸 날 · 공급처 · 금액, 없는 수주 404', async () => {
  const db = makeDb();
  const body = { target: 'order_cost', order_id: ORDER, cost: { category: 'material', amount: 100000, vat_amount: 10000, evidence_type: 'card', spent_on: '2026-11-02', counterparty_id: SUPPLIER, vendor_name: '아무개' } };
  const r = await call(db, `/ledger/documents/${D1}/post`, MANAGER, { method: 'POST', body });
  assert.equal(r.status, 201, r.text);
  const [rpc] = rpcCalls(r.calls, 'ledger_post_document');
  assert.deepEqual(rpc.body.p_payload, {
    target: 'order_cost',
    order_id: ORDER,
    cost: { category: 'material', amount: 100000, description: null, vendor_name: '예림', vat_amount: 10000, evidence_type: 'card', spent_on: '2026-11-02', counterparty_id: SUPPLIER },
  });
  assert.deepEqual(db.feedback[0].fields, {
    issue_date: { read: '2026-11-01', posted: '2026-11-02' },
    supplier_name: { read: '한빛목재', posted: '예림' },
    _meta: { account_source: null, schema_version: 1 },
  });
  assert.equal(db.feedback[0].changed_count, 2);

  const lost = await call(makeDb(), `/ledger/documents/${D1}/post`, MANAGER, { method: 'POST', body: { ...body, order_id: '0d000000-0000-4000-8000-000000000009' } });
  assert.equal(lost.status, 404);
  assert.match(lost.body.message, /수주/);
});

test('이미 있는 줄에 붙이기 — supporting, 고친 칸은 빈 줄 / 읽은 시도가 없으면 고친 칸을 남기지 않는다', async () => {
  const db = makeDb();
  const r = await call(db, `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body: { target: 'attach', entry_id: ENTRY } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.role, 'supporting');
  assert.deepEqual(db.feedback.map((f) => [f.target, f.changed_count, f.fields]), [['attach', 0, { _meta: { account_source: null, schema_version: 1 } }]]);

  const none = makeDb();
  const r2 = await call(none, `/ledger/documents/${D2}/post`, OWNER, { method: 'POST', body: entryBody() });
  assert.equal(r2.status, 201);
  assert.equal(none.feedback.length, 0);

  const lost = await call(makeDb(), `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body: { target: 'attach', entry_id: '0e000000-0000-4000-8000-000000000009' } });
  assert.equal(lost.status, 404);
});

test('고친 칸 넣기가 실패해도 올리기는 201', async () => {
  const db = makeDb({ feedbackFails: true });
  const { out, lines } = await withLogs(() => call(db, `/ledger/documents/${D1}/post`, OWNER, { method: 'POST', body: entryBody() }));
  assert.equal(out.status, 201);
  assert.ok(lines.some((l) => l.includes('feedback failed')));
});

test('한꺼번에 올리기 — 장마다 따로 (확인한 사진 · 두 번 · 틀린 입력은 그 장만 실패), 20장까지', async () => {
  const db = makeDb();
  const r = await call(db, '/ledger/review/post', OWNER, {
    method: 'POST',
    body: {
      items: [
        { id: D1, ...entryBody() },
        { id: D3, ...entryBody() },
        { id: D1, ...entryBody() },
        { id: D2, ...entryBody({ account: 'income.sales' }) },
      ],
    },
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.items.map((x) => [x.id, x.ok, x.status || null]), [
    [D1, true, null],
    [D3, false, 409],
    [D1, false, 409],
    [D2, false, 422],
  ]);
  assert.equal(r.body.data.posted, 1);
  assert.equal(rpcCalls(r.calls, 'ledger_post_document').length, 1);
  assert.equal(r.body.data.items[1].code, 'not_pending');

  const many = Array.from({ length: BATCH_MAX + 1 }, () => ({ id: D1, ...entryBody() }));
  assert.equal((await call(makeDb(), '/ledger/review/post', OWNER, { method: 'POST', body: { items: many } })).status, 422);
  assert.equal((await call(makeDb(), '/ledger/review/post', OWNER, { method: 'POST', body: { items: [] } })).status, 422);
});

// ── 돌려보내기 · 버리기 · 다시 읽기 ───────────────────────

test('돌려보내기 · 버리기 — 이유 필수, 확인 기다리는 사진만 (조건부 고치기 · 바꾼 사람 머리)', async () => {
  for (const [action, status] of [
    ['return', 'returned'],
    ['reject', 'rejected'],
  ]) {
    const db = makeDb();
    assert.equal((await call(db, `/ledger/documents/${D1}/${action}`, OWNER, { method: 'POST', body: {} })).status, 422);
    assert.equal((await call(db, `/ledger/documents/${D1}/${action}`, OWNER, { method: 'POST', body: { reason: 'x'.repeat(301) } })).status, 422);
    const r = await call(db, `/ledger/documents/${D1}/${action}`, OWNER, { method: 'POST', body: { reason: ' 흐려서 다시 ' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.document.review_status, status);
    assert.equal(r.body.data.document.decision_reason, '흐려서 다시');
    const patch = r.calls.find((c) => c.method === 'PATCH' && c.url.includes('/ledger_documents?'));
    assert.match(patch.url, /review_status=eq\.pending/);
    assert.equal(patch.actor, OWNER);
    const again = await call(db, `/ledger/documents/${D1}/${action}`, OWNER, { method: 'POST', body: { reason: '또' } });
    assert.equal(again.status, 409);
  }
});

test('다시 읽기 — again true 로 건다 → 202, 바인딩이 없으면 queued false, 확인한 사진은 409', async () => {
  const assistant = makeAssistant();
  const r = await call(makeDb(), `/ledger/documents/${D1}/reread`, OWNER, { method: 'POST', env: { ...ENV, ASSISTANT: assistant } });
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(r.body.data, { queued: true, reason: null });
  assert.deepEqual(assistant.calls, [{ documentId: D1, again: true }]);

  const nb = await withLogs(() => call(makeDb(), `/ledger/documents/${D1}/reread`, OWNER, { method: 'POST' }));
  assert.equal(nb.out.status, 202);
  assert.deepEqual(nb.out.body.data, { queued: false, reason: 'no_binding' });

  const refused = await call(makeDb(), `/ledger/documents/${D1}/reread`, OWNER, { method: 'POST', env: { ...ENV, ASSISTANT: makeAssistant({ ok: false, reason: 'running' }) } });
  assert.deepEqual(refused.body.data, { queued: false, reason: 'running' });

  assert.equal((await call(makeDb(), `/ledger/documents/${D3}/reread`, OWNER, { method: 'POST', env: { ...ENV, ASSISTANT: assistant } })).status, 409);
});

// ── 국세청 사업자 상태 ────────────────────────────────────

const ntsOk = (data) => () => json({ status_code: 'OK', request_cnt: 1, match_cnt: 1, data });

test('사업자 상태 — 키가 없으면 available false, 번호가 틀리면 422', async () => {
  const db = makeDb();
  const r = await call(db, `/ledger/business-status?biz_no=124-81-00998`, OWNER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { available: false, biz_no: BIZ_OK });
  assert.equal(db.nts_api.length, 0);
  for (const b of ['1234567890', '12345', '']) {
    assert.equal((await call(makeDb(), `/ledger/business-status?biz_no=${b}`, OWNER, { env: { ...ENV, NTS_SERVICE_KEY: NTS_KEY } })).status, 422, b);
  }
});

test('사업자 상태 — 조회 → 캐시 · 이 업체 거래처 칸, 24시간 안은 캐시, 키는 로그에 없다', async () => {
  const env = { ...ENV, NTS_SERVICE_KEY: NTS_KEY };
  const db = makeDb({ ntsReply: ntsOk([{ b_no: BIZ_OK, b_stt: '계속사업자', b_stt_cd: '01', tax_type: '부가가치세 일반과세자', end_dt: '' }]) });
  const { out, lines } = await withLogs(() => call(db, `/ledger/business-status?biz_no=${BIZ_OK}`, OWNER, { env }));
  assert.equal(out.status, 200, out.text);
  assert.equal(out.body.data.available, true);
  assert.equal(out.body.data.cached, false);
  assert.equal(out.body.data.status, 'active');
  assert.equal(out.body.data.tax_type, '부가가치세 일반과세자');
  assert.equal(db.nts_api.length, 1);
  assert.equal(db.nts_api[0].method, 'POST');
  assert.deepEqual(db.nts_api[0].body, { b_no: [BIZ_OK] });
  assert.ok(db.nts_api[0].url.startsWith('https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey='));
  assert.ok(db.nts_api[0].url.includes(encodeURIComponent(NTS_KEY)));
  assert.deepEqual(db.nts.map((r) => [r.biz_no, r.status]), [[BIZ_OK, 'active']]);
  assert.equal(db.cpPatches.length, 1);
  assert.match(db.cpPatches[0].query, new RegExp(`company_id=eq.${CO}`));
  assert.equal(db.counterparties[0].nts_status, 'active');
  assert.ok(lines.every((l) => !l.includes(NTS_KEY) && !l.includes(encodeURIComponent(NTS_KEY))));

  // 24시간 안 — 캐시
  const cached = await call(db, `/ledger/business-status?biz_no=${BIZ_OK}`, OWNER, { env });
  assert.equal(cached.body.data.cached, true);
  assert.equal(db.nts_api.length, 1);

  // 24시간 지남 — 다시 조회
  db.nts[0].checked_at = '2020-01-01T00:00:00Z';
  await call(db, `/ledger/business-status?biz_no=${BIZ_OK}`, OWNER, { env });
  assert.equal(db.nts_api.length, 2);
});

test('사업자 상태 — 보기만 업체는 거래처 칸을 고치지 않는다, 조회 실패는 error 로 (로그에 키 없음)', async () => {
  const env = { ...ENV, NTS_SERVICE_KEY: NTS_KEY };
  const db = makeDb({ ntsReply: ntsOk([{ b_no: BIZ_OK, b_stt_cd: '03', tax_type: '부가가치세 간이과세자', end_dt: '20251231' }]) });
  const r = await call(db, `/ledger/business-status?biz_no=${BIZ_OK}`, R_OWNER, { env });
  assert.equal(r.body.data.status, 'closed');
  assert.equal(r.body.data.closed_on, '2025-12-31');
  assert.equal(db.cpPatches.length, 0);

  const down = makeDb();
  const { out, lines } = await withLogs(() => call(down, `/ledger/business-status?biz_no=${BIZ_OTHER}`, OWNER, { env }));
  assert.deepEqual(out.body.data, { available: true, biz_no: BIZ_OTHER, status: null, error: 'lookup_failed' });
  assert.ok(lines.some((l) => l.includes('NTS lookup failed')));
  assert.ok(lines.every((l) => !l.includes(NTS_KEY) && !l.includes('odcloud')));
  assert.equal(down.nts.length, 0);
});

// ── 순수 ─────────────────────────────────────────────────

test('ntsRow — 01 계속 · 02 휴업 · 03 폐업 · 그 밖 미등록(과세 유형 없음), 폐업일', () => {
  assert.deepEqual(ntsRow(BIZ_OK, { b_stt_cd: '01', tax_type: ' 부가가치세 일반과세자 ', end_dt: '' }), { biz_no: BIZ_OK, status: 'active', tax_type: '부가가치세 일반과세자', closed_on: null });
  assert.equal(ntsRow(BIZ_OK, { b_stt_cd: '02', tax_type: 'x' }).status, 'suspended');
  assert.deepEqual(ntsRow(BIZ_OK, { b_stt_cd: '03', tax_type: 'x', end_dt: '20240105' }).closed_on, '2024-01-05');
  assert.deepEqual(ntsRow(BIZ_OK, { b_stt_cd: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' }), { biz_no: BIZ_OK, status: 'unregistered', tax_type: null, closed_on: null });
  assert.equal(ntsRow(BIZ_OK, { b_stt_cd: '01', tax_type: 'y'.repeat(80) }).tax_type.length, 60);
});

test('feedbackFields — 화면이 채운 값과 다른 칸만, 빈 값 · 공백 · 숫자 글은 같게 본다, 공제 안 되는 증빙은 합계로', () => {
  const made = proposalFor({ ...READ, account_hint: 'admin.supplies' }, null, ACCOUNTS);
  assert.deepEqual(feedbackFields('entry', READ, entryBody({ amount: 100000, counterparty_name: ' 한빛목재 ' }), made), {});
  assert.deepEqual(feedbackFields('entry', { ...READ, total_amount: '110000' }, entryBody({ amount: 100000 }), made), {});
  assert.deepEqual(feedbackFields('entry', { ...READ, payment_method: null }, entryBody({ amount: 100000, payment_method: null }), made), {});
  assert.deepEqual(feedbackFields('entry', { ...READ, supplier_biz_no: null }, entryBody({ amount: 100000 }), made), { supplier_biz_no: { read: null, posted: BIZ_OK } });
  assert.deepEqual(feedbackFields('attach', READ, { target: 'attach', entry_id: ENTRY }, made), {});
  assert.deepEqual(feedbackFields('entry', null, entryBody()).amount, { read: null, posted: 110000 });
  // 계정이 다르면 제안이 어디서 왔는지
  const memo = { proposal: { ...made.proposal, account: 'income.sales' }, sources: { ...made.sources, account: 'memory' } };
  assert.deepEqual(feedbackFields('entry', READ, entryBody({ amount: 100000 }), memo).account, { read: 'income.sales', posted: 'admin.supplies', source: 'memory' });
  // 간이영수증 — 화면은 합계 · 부가세 0 으로 채운다 (공급가와 비교해 틀렸다고 남기지 않는다)
  const simple = { ...READ, evidence_type: 'simple_receipt', account_hint: 'admin.supplies' };
  assert.deepEqual(feedbackFields('entry', simple, entryBody({ amount: 110000, vat_amount: 0, evidence_type: 'simple_receipt' }), proposalFor(simple, null, ACCOUNTS)), {});
});

// ── 확인 힌트 · 바로 올리기 (DB 0033) ─────────────────────

/** 믿을 만한 거래처 — 장부 줄 3번 같은 계정 · 증빙 */
const TRUSTED = {
  read: true,
  supplier: { biz_no: BIZ_OK, name: '한빛목재' },
  memory: {
    posts: 3,
    entry_posts: 3,
    last: { src: 'entry', account: 'admin.supplies', evidence_type: 'card', payment_method: 'card', display_name: '한빛 목재', on_date: '2026-10-20' },
    last_entry: { src: 'entry', account: 'admin.supplies', evidence_type: 'card', payment_method: 'card', display_name: '한빛 목재', on_date: '2026-10-20' },
  },
  trusted: true,
  first_time: false,
  large: null,
  duplicate: null,
  evidence_risk: false,
  nts: null,
};
const SHOWN = {
  entry_date: '2026-11-01',
  direction: 'expense',
  account: 'admin.supplies',
  description: '합판',
  counterparty_name: '한빛 목재',
  counterparty_biz_no: BIZ_OK,
  amount: 100000,
  vat_amount: 10000,
  evidence_type: 'card',
  payment_method: 'card',
};

test('확인 목록 힌트 — 기억으로 채운 올릴 값 · 바로 올려도 되는가, 0033 이 없으면 읽은 값만', async () => {
  const db = makeDb({ hints: { [D1]: TRUSTED } });
  const r = await call(db, '/ledger/review', OWNER);
  assert.equal(r.status, 200, r.text);
  const one = r.body.data.items.find((d) => d.id === D1);
  assert.deepEqual(one.hints.proposal, SHOWN);
  assert.deepEqual(one.hints.sources, { account: 'memory', counterparty_name: 'memory', evidence_type: 'read', payment_method: 'read' });
  assert.equal(one.hints.ready, true);
  assert.deepEqual(one.hints.blockers, []);
  assert.equal(one.hints.target, 'entry');
  // 읽지 않은 사진은 힌트 없음 · 힌트는 한 번에
  assert.equal(r.body.data.items.find((d) => d.id === D2).hints, null);
  assert.deepEqual(rpcCalls(r.calls, 'ledger_review_hints').map((c) => c.body.p_documents.sort()), [[D1, D2]]);

  // 경고 · 꼭 볼 칸이 「확실하지 않음」 · 지난번이 수주 원가면 바로 올리지 않는다
  const cases = [
    [{ ...TRUSTED, duplicate: { document_id: D2 } }, READ, ['warning']],
    [{ ...TRUSTED, trusted: false }, READ, ['not_trusted']],
    [TRUSTED, { ...READ, unsure: ['vat_amount'] }, ['unsure']],
    [TRUSTED, { ...READ, evidence_type: 'cash_receipt' }, ['evidence_changed']],
    [{ ...TRUSTED, memory: { ...TRUSTED.memory, last: { ...TRUSTED.memory.last, src: 'cost', category: 'material' } } }, READ, ['target']],
  ];
  for (const [h, result, blockers] of cases) {
    const d = makeDb({ hints: { [D1]: h } });
    d.extractions[1].result = result;
    const x = (await call(d, '/ledger/review', OWNER)).body.data.items.find((i) => i.id === D1);
    assert.deepEqual(x.hints.blockers, blockers, JSON.stringify(h));
    assert.equal(x.hints.ready, false);
  }

  // 0033 적용 전 — 목록은 그대로, 기억 없이 읽은 값으로만
  const old = makeDb({ hints: null });
  const { out, lines } = await withLogs(() => call(old, '/ledger/review', OWNER));
  assert.equal(out.status, 200);
  const h = out.body.data.items.find((d) => d.id === D1).hints;
  assert.deepEqual([h.available, h.ready, h.blockers, h.proposal.account, h.proposal.counterparty_name], [false, false, ['no_hints'], null, '한빛목재']);
  assert.ok(lines.some((l) => l.includes('apply database/migrations/0033')));
});

test('바로 올리기 — 서버가 다시 세어 같은 값일 때만 그 값으로, 바뀌었거나 바로 올릴 수 없으면 409', async () => {
  const db = makeDb({ hints: { [D1]: TRUSTED } });
  const r = await call(db, '/ledger/review/post', OWNER, { method: 'POST', body: { items: [{ id: D1, ready: true, entry: SHOWN }] } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.posted, 1);
  const [rpc] = rpcCalls(r.calls, 'ledger_post_document');
  assert.equal(rpc.body.p_payload.target, 'entry');
  for (const [k, v] of Object.entries(SHOWN)) assert.deepEqual(rpc.body.p_payload.entry[k], v, k);
  assert.equal(db.feedback[0].fields._meta.account_source, 'memory');
  assert.equal(db.feedback[0].changed_count, 1); // 읽은 상호 한빛목재 → 확인된 상호 한빛 목재

  const changed = makeDb({ hints: { [D1]: TRUSTED } });
  const c = await call(changed, '/ledger/review/post', OWNER, { method: 'POST', body: { items: [{ id: D1, ready: true, entry: { ...SHOWN, amount: 99000 } }] } });
  assert.deepEqual(c.body.data.items.map((x) => [x.ok, x.status, x.code]), [[false, 409, 'changed']]);
  const notReady = makeDb({ hints: { [D1]: { ...TRUSTED, large: { median: 50000, n: 3, ratio: 2.2 } } } });
  const n = await call(notReady, '/ledger/review/post', OWNER, { method: 'POST', body: { items: [{ id: D1, ready: true, entry: SHOWN }] } });
  assert.deepEqual(n.body.data.items.map((x) => [x.ok, x.status, x.code]), [[false, 409, 'not_ready']]);
  assert.equal(rpcCalls(c.calls.concat(n.calls), 'ledger_post_document').length, 0);
});

test('한꺼번에 올리기 20장 — 사진 · 계정 · 시도 · 힌트 · 고친 칸을 한 번씩 (하위 요청 50개 안)', async () => {
  const ids = Array.from({ length: BATCH_MAX }, (_, i) => `d1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  const db = makeDb({
    documents: ids.map((id) => doc(id, CO)),
    extractions: ids.map((id, i) => ({ id: `f1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, document_id: id, attempt: 1, status: 'done', model: 'claude-haiku-5-5', schema_version: 3, result: READ, checks: CHECKS, error: null, started_at: '2026-11-01T01:12:00Z', finished_at: '2026-11-01T01:12:30Z' })),
    hints: Object.fromEntries(ids.map((id) => [id, TRUSTED])),
  });
  const r = await call(db, '/ledger/review/post', OWNER, { method: 'POST', body: { items: ids.map((id) => ({ id, ready: true, entry: SHOWN })) } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.posted, BATCH_MAX);
  assert.equal(rpcCalls(r.calls, 'ledger_post_document').length, BATCH_MAX);
  assert.equal(db.feedback.length, BATCH_MAX);
  assert.equal(r.calls.filter((c) => c.url.includes('/ledger_extraction_feedback')).length, 1);
  assert.ok(r.calls.length < 50, `subrequests ${r.calls.length}`);
});

test('parseCostInput — 수주 원가 넣기와 같은 칸', () => {
  assert.deepEqual(parseCostInput({ category: 'hardware', amount: 5000 }), { category: 'hardware', amount: 5000, description: null, vendor_name: null, vat_amount: null, evidence_type: null, spent_on: null, counterparty_id: null });
  for (const bad of [null, {}, { category: 'x', amount: 1 }, { category: 'material', amount: 0 }, { category: 'material', amount: 1, vat_amount: -1 }, { category: 'material', amount: 1, spent_on: '2026-13-01' }, { category: 'material', amount: 1, evidence_type: 'photo' }, { category: 'material', amount: 1, counterparty_id: 'x' }, { category: 'material', amount: 1, vendor_name: 'x'.repeat(101) }]) {
    assert.throws(() => parseCostInput(bad), /./, JSON.stringify(bad));
  }
});
