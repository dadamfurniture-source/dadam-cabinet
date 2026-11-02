/**
 * 회계장부 바탕 (src/ledger/) — 가짜 PostgREST 로 서버 판단을 본다. DB 쪽 규칙(지우기 막기 · 기록 트리거)은
 * database/probes/0027-ledger-core.json 이 실DB 에서 본다.
 *
 *   역할표   구성원만 (관리자여도 구성원이 아니면 not_member) · 자격 none 403 not_entitled · read 는 보기만(read_only)
 *            대표 · 실장만 장부 · 금액 · 설정 (직원 not_money), 사진 올리기는 직원도
 *   직원     자기가 올린 사진의 일자 · 상태 · 돌려보낸 이유만 — 금액 · 메모 · 파일 칸이 응답 어디에도 없다
 *   장부 줄  계정 · 방향 · 사업자번호 · 거래처를 먼저 본다. 같은 X-Idempotency-Key 는 한 줄. 취소는 이유 · 한 번만. 고치기는 DB 함수
 *   사진     첫 바이트로 JPEG · PNG, HEIC 422, 5MB 413, 크기 422, 같은 파일 · 같은 키는 한 장, 분 한도 · 하루 장수 429
 *   기록     쓰는 요청마다 x-actor-id 머리 (ledger_events 의 바꾼 사람)
 *   설정     과세 묶음(tax)만 바꾸고 원가 설정은 그대로. 원가 설정 저장도 tax 를 지우지 않는다
 *   본사     다담 본사 대표 · 실장은 다담 공장 장부도 본다 (?company=, 보기만). 본사 직원 · 공장 · 협력업체는 남의 장부 403
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { bizNoValid, normalizeBizNo, sniffImage, parseEntryInput, groupTakes, PHOTO_MAX_BYTES } from '../src/ledger/checks.js';
import { bookTotals, sortBook, bookRange } from '../src/ledger/entries.js';
import { DAILY_USER_MAX } from '../src/ledger/documents.js';
import { kstDate } from '../src/production/service.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const CO = 'c0000000-0000-4000-8000-0000000000a1';
const CO_READ = 'c0000000-0000-4000-8000-0000000000a2';
const CO_NONE = 'c0000000-0000-4000-8000-0000000000a3';
const OWNER = 'u-owner';
const MANAGER = 'u-manager';
const STAFF = 'u-staff';
const STAFF2 = 'u-staff2';
const REMOVED = 'u-removed';
const STRANGER = 'u-stranger';
const ADMIN = 'u-admin';
const R_OWNER = 'u-read-owner';
const R_STAFF = 'u-read-staff';
const N_OWNER = 'u-none-owner';
const PLATFORM = 'c0000000-0000-4000-8000-0000000000b1';
const HQ = 'c0000000-0000-4000-8000-0000000000b2';
const PF_OWNER = 'u-platform-owner';
const PF_STAFF = 'u-platform-staff';
const HQ_OWNER = 'u-hq-owner';
const COMPANIES = [
  { id: CO, name: '한빛인테리어', kind: 'partner' },
  { id: PLATFORM, name: '다담 본사', kind: 'platform' },
  { id: HQ, name: '다담 공장', kind: 'hq' },
];
const MEMBERS = [
  { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
  { user_id: MANAGER, company_id: CO, role: 'manager', status: 'active' },
  { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
  { user_id: STAFF2, company_id: CO, role: 'staff', status: 'active' },
  { user_id: REMOVED, company_id: CO, role: 'owner', status: 'removed' },
  { user_id: R_OWNER, company_id: CO_READ, role: 'owner', status: 'active' },
  { user_id: R_STAFF, company_id: CO_READ, role: 'staff', status: 'active' },
  { user_id: N_OWNER, company_id: CO_NONE, role: 'owner', status: 'active' },
  { user_id: PF_OWNER, company_id: PLATFORM, role: 'owner', status: 'active' },
  { user_id: PF_STAFF, company_id: PLATFORM, role: 'staff', status: 'active' },
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
];
/** 업체 자격 — 시험이 바꾼다 (본사 · 공장은 시험 예외로 full) */
const LEVEL = { [CO]: 'full', [CO_READ]: 'read', [CO_NONE]: 'none', [PLATFORM]: 'full', [HQ]: 'full' };
const ACCOUNTS = [
  { code: 'income.sales', name: '매출액', grp: 'income', sort: 10, note: null, active: true },
  { code: 'purchase.materials', name: '재료비 매입', grp: 'purchase', sort: 40, note: '제조', active: true },
  { code: 'admin.rent', name: '임차료', grp: 'admin', sort: 120, note: null, active: true },
  { code: 'admin.supplies', name: '소모품비', grp: 'admin', sort: 190, note: null, active: true },
  { code: 'asset.tangible', name: '유형자산', grp: 'asset', sort: 300, note: null, active: true },
  { code: 'admin.old', name: '옛 계정', grp: 'admin', sort: 999, note: null, active: false },
];
const CP_MINE = '0c000000-0000-4000-8000-000000000001';
const CP_OTHER = '0c000000-0000-4000-8000-000000000002';
const BIZ_OK = '1248100998';

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const fail = (status, body) => ({ ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const dup = () => fail(409, { code: '23505', message: 'duplicate key value violates unique constraint' });

let seq = 0;
const uuid = () => `e0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** 가짜 DB — 부르는 쪽이 상태를 본다 */
function makeDb({ entries = [], documents = [], settings = {}, book = [] } = {}) {
  const state = { entries, documents, settings, book, uploads: [], rpc: [] };
  const params = (u) => new URL(u).searchParams;
  const eq = (q, key) => {
    const v = q.get(key);
    return v && v.startsWith('eq.') ? v.slice(3) : null;
  };
  const match = (q, row, keys) => keys.every((k) => eq(q, k) === null || String(row[k]) === eq(q, k));
  state.route = (u, method, body) => {
    if (u.startsWith(`${ENV.SUPABASE_URL}/storage/v1/object/ledger-evidence/`)) {
      state.uploads.push(u.slice(`${ENV.SUPABASE_URL}/storage/v1/object/ledger-evidence/`.length));
      return json({ Key: 'ok' });
    }
    if (!u.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) return null;
    const path = u.slice(`${ENV.SUPABASE_URL}/rest/v1`.length);
    const q = path.includes('?') ? params(u) : new URLSearchParams();
    if (path.startsWith('/company_members?')) {
      return json(MEMBERS.filter((m) => match(q, m, ['user_id', 'status'])).map((m) => ({ company_id: m.company_id, role: m.role })));
    }
    if (path.startsWith('/companies?')) {
      const kind = eq(q, 'kind');
      if (kind) return json(COMPANIES.filter((c) => c.kind === kind).map((c) => ({ id: c.id })));
      const ids = (q.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
      return json(COMPANIES.filter((c) => ids.includes(c.id)));
    }
    if (path.startsWith('/admin_roles?')) return json(eq(q, 'user_id') === ADMIN ? [{ role: 'admin' }] : []);
    if (path === '/rpc/company_entitled') {
      state.rpc.push({ fn: 'company_entitled', body });
      assert.equal(body.p_feature, 'ledger');
      return json(LEVEL[body.p_company] || 'none');
    }
    if (path.startsWith('/ledger_accounts?')) return json(ACCOUNTS);
    if (path.startsWith('/counterparties?')) {
      const rows = [
        { id: CP_MINE, company_id: CO, name: '한빛목재', biz_no: BIZ_OK },
        { id: CP_OTHER, company_id: CO_READ, name: '남의 거래처', biz_no: null },
      ];
      return json(rows.filter((r) => match(q, r, ['id', 'company_id'])));
    }
    if (path.startsWith('/ledger_entries')) {
      if (method === 'GET') return json(state.entries.filter((r) => match(q, r, ['id', 'company_id', 'idempotency_key'])));
      if (method === 'POST') {
        if (body.idempotency_key && state.entries.some((r) => r.company_id === body.company_id && r.idempotency_key === body.idempotency_key)) return dup();
        const row = { id: uuid(), seq: state.entries.length + 1, created_at: '2026-11-02T01:00:00Z', voided_at: null, voided_by: null, void_reason: null, replaces_id: null, counterparty_id: null, counterparty_name: null, counterparty_biz_no: null, description: null, payment_method: null, ...body };
        state.entries.push(row);
        return json([row], 201);
      }
      if (method === 'PATCH') {
        const hit = state.entries.filter((r) => match(q, r, ['id', 'company_id']) && (q.get('voided_at') !== 'is.null' || !r.voided_at));
        for (const r of hit) Object.assign(r, body);
        return json(hit);
      }
    }
    if (path === '/rpc/ledger_correct_entry') {
      state.rpc.push({ fn: 'ledger_correct_entry', body });
      const old = state.entries.find((r) => r.id === body.p_entry);
      if (!old) return json({ ok: false, reason: 'not_found' });
      if (old.voided_at) return json({ ok: false, reason: 'voided' });
      Object.assign(old, { voided_at: '2026-11-02T02:00:00Z', voided_by: body.p_actor, void_reason: body.p_reason });
      const row = { ...old, ...body.p_payload, id: uuid(), seq: state.entries.length + 1, voided_at: null, voided_by: null, void_reason: null, replaces_id: old.id, created_by: body.p_actor };
      state.entries.push(row);
      return json({ ok: true, entry_id: row.id });
    }
    if (path === '/rpc/ledger_book') {
      state.rpc.push({ fn: 'ledger_book', body });
      return json(state.book);
    }
    if (path.startsWith('/ledger_documents')) {
      if (method === 'GET') {
        let rows = state.documents.filter((r) => match(q, r, ['company_id', 'idempotency_key', 'sha256', 'uploaded_by', 'review_status']));
        const c = q.get('created_at');
        if (c && c.startsWith('gte.')) rows = rows.filter((r) => r.created_at >= new Date(c.slice(4).replace(' ', '+')).toISOString());
        if (c && c.startsWith('lt.')) rows = rows.filter((r) => r.created_at < c.slice(3));
        rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
        return json(rows.slice(0, Number(q.get('limit')) || rows.length));
      }
      if (method === 'POST') {
        if (state.documents.some((r) => r.company_id === body.company_id && (r.sha256 === body.sha256 || (body.idempotency_key && r.idempotency_key === body.idempotency_key)))) return dup();
        const row = { review_status: 'pending', decided_by: null, decided_at: null, decision_reason: null, created_at: new Date().toISOString(), ...body };
        state.documents.push(row);
        return json([row], 201);
      }
    }
    if (path.startsWith('/company_settings')) {
      if (method === 'GET') {
        const id = eq(q, 'company_id');
        return json(state.settings[id] ? [{ settings: state.settings[id], updated_at: '2026-10-20T00:00:00Z' }] : []);
      }
      if (method === 'POST') {
        state.settings[body.company_id] = body.settings;
        return json([body], 201);
      }
    }
    return null;
  };
  return state;
}

/** worker.fetch — JWT 확인(/auth/v1/user)은 토큰 이름을 사용자 id 로 돌려준다. calls 에 x-actor-id 를 남긴다 */
async function call(db, path, token, { method = 'GET', body, raw, headers = {}, env = ENV } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const m = init.method || 'GET';
    const h = init.headers || {};
    const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: m, body: parsed, actor: h['x-actor-id'] || null });
    if (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`)) return json({ id: token });
    const res = db.route(u, m, parsed);
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
    const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: reqBody }), env, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text, calls, cache: res.headers.get('Cache-Control') };
  } finally {
    globalThis.fetch = original;
  }
}

const writes = (calls, table) => calls.filter((c) => c.method !== 'GET' && c.url.includes(`/rest/v1/${table}`));

/** JPEG — APP0 + SOF0 (너비 · 높이) + 덧붙인 바이트 (sha 를 바꾼다) */
function jpeg(width, height, tail = [1, 2, 3]) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xda, 0x00, 0x02, ...tail, 0xff, 0xd9]);
}
function png(width, height) {
  const u8 = new Uint8Array(33);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(u8.buffer).setUint32(16, width);
  new DataView(u8.buffer).setUint32(20, height);
  return u8;
}
const heic = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

const entryBody = (over = {}) => ({ entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', description: '11월 임대료', amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice', payment_method: 'transfer', ...over });

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── 순수 검사 ─────────────────────────────────────────────────

test('사업자등록번호 — 검증 숫자 (가중치 1,3,7,1,3,7,1,3,5), - · 빈칸은 뺀다', () => {
  assert.equal(bizNoValid(BIZ_OK), true);
  assert.equal(bizNoValid('1248100997'), false);
  assert.equal(bizNoValid('124810099'), false);
  assert.equal(normalizeBizNo('124-81-00998'), BIZ_OK);
  assert.equal(normalizeBizNo(' '), null);
});

test('계정 묶음이 받는 방향 — DB 트리거와 같다', () => {
  assert.equal(groupTakes('income', 'income'), true);
  assert.equal(groupTakes('income', 'expense'), false);
  for (const g of ['purchase', 'manufacturing', 'admin']) assert.equal(groupTakes(g, 'expense'), true);
  assert.equal(groupTakes('asset', 'asset_buy'), true);
  assert.equal(groupTakes('asset', 'asset_sell'), true);
  assert.equal(groupTakes('asset', 'expense'), false);
});

test('장부 줄 입력 — 꼭 있는 칸 · 날짜 · 금액 · 증빙, 고치기는 보낸 칸만', () => {
  assert.deepEqual(parseEntryInput(entryBody({ counterparty_biz_no: '124-81-00998', payment_method: null, description: '  ' })), {
    entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', description: null, counterparty_biz_no: BIZ_OK,
    amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice', payment_method: null,
  });
  assert.equal(parseEntryInput(entryBody({ vat_amount: undefined })).vat_amount, 0);
  for (const bad of [{ entry_date: '2026-02-30' }, { amount: 0 }, { amount: 1.5 }, { vat_amount: -1 }, { evidence_type: 'receipt' }, { direction: 'out' }, { counterparty_biz_no: '1248100997' }]) {
    assert.throws(() => parseEntryInput(entryBody(bad)), { statusCode: 422 }, JSON.stringify(bad));
  }
  assert.throws(() => parseEntryInput({ amount: 1 }), { statusCode: 422 });
  assert.deepEqual(parseEntryInput({ amount: 5000 }, { partial: true }), { amount: 5000 });
  assert.throws(() => parseEntryInput({ reason: 'x' }, { partial: true }), /바꿀 칸/);
});

test('사진 첫 바이트 — JPEG(SOF) · PNG(IHDR) 크기, HEIC, 그 밖은 null', () => {
  assert.deepEqual(sniffImage(jpeg(1200, 1600)), { mime: 'image/jpeg', width: 1200, height: 1600 });
  assert.deepEqual(sniffImage(png(800, 600)), { mime: 'image/png', width: 800, height: 600 });
  assert.deepEqual(sniffImage(heic()), { heic: true });
  assert.equal(sniffImage(new TextEncoder().encode('%PDF-1.7 hello world')), null);
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0])), null, 'SOF 없는 JPEG');
});

test('장부 보기 범위 — 달 끝날 · 1년까지 · 없으면 이번 달', () => {
  assert.deepEqual(bookRange({ month: '2028-02' }), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(bookRange({ today: '2026-11-02' }), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(bookRange({ from: '2026-01-01', to: '2026-12-31' }), { from: '2026-01-01', to: '2026-12-31' });
  assert.throws(() => bookRange({ from: '2026-01-01', to: '2027-01-02' }), { statusCode: 422 });
  assert.throws(() => bookRange({ from: '2026-02-01', to: '2026-01-01' }), { statusCode: 422 });
  assert.throws(() => bookRange({ month: '2026-13' }), { statusCode: 422 });
});

test('장부 합계 — 취소 줄 빼고, 부가세를 모르는 줄 · 계정 없는 줄을 센다', () => {
  const rows = [
    { source: 'payment', entry_date: '2026-11-03', direction: 'income', account: 'income.sales', amount: 1000000, vat_amount: 100000 },
    { source: 'payment', entry_date: '2026-11-04', direction: 'income', account: 'income.sales', amount: 550000, vat_amount: null },
    { source: 'entry', entry_date: '2026-11-01', seq: 2, direction: 'expense', account: 'admin.rent', amount: 1000000, vat_amount: 100000 },
    { source: 'entry', entry_date: '2026-11-01', seq: 1, direction: 'expense', account: 'admin.rent', amount: 999, vat_amount: 0, voided_at: '2026-11-02T00:00:00Z' },
    { source: 'cost', entry_date: '2026-11-01', direction: 'expense', account: null, amount: 300000, vat_amount: null },
    { source: 'entry', entry_date: '2026-11-05', seq: 3, direction: 'asset_buy', account: 'asset.tangible', amount: 2000000, vat_amount: 200000 },
  ];
  assert.deepEqual(bookTotals(rows), { income: 1550000, expense: 1300000, asset_buy: 2000000, asset_sell: 0, income_vat: 100000, expense_vat: 100000, vat_unknown: 2, account_unknown: 1 });
  assert.deepEqual(sortBook(rows).map((r) => `${r.entry_date}:${r.source}:${r.seq || ''}`), [
    '2026-11-01:entry:1', '2026-11-01:entry:2', '2026-11-01:cost:', '2026-11-03:payment:', '2026-11-04:payment:', '2026-11-05:entry:3',
  ]);
});

// ── 역할표 ───────────────────────────────────────────────────

test('GET /ledger/me — 구성원만 · 자격 none 403 · 할 수 있는 것', async () => {
  const db = makeDb({ settings: { [CO]: { quote: { marginRate: 0.3 }, tax: { vat_type: 'general', business_kind: 'manufacturing' } } } });
  const owner = await call(db, '/ledger/me', OWNER);
  assert.equal(owner.status, 200, owner.text);
  assert.equal(owner.cache, 'no-store, private');
  assert.deepEqual(owner.body.data, {
    company_id: CO, role: 'owner', money: true, level: 'full', viewing: false, can_upload: true, can_write: true,
    tax: { vat_type: 'general', business_kind: 'manufacturing' },
    ledgers: [{ company_id: CO, name: '한빛인테리어', kind: 'partner', own: true }],
  });
  const staff = await call(db, '/ledger/me', STAFF);
  assert.deepEqual(staff.body.data, { company_id: CO, role: 'staff', money: false, level: 'full', viewing: false, can_upload: true, can_write: false });
  const read = await call(db, '/ledger/me', R_OWNER);
  assert.equal(read.body.data.level, 'read');
  assert.equal(read.body.data.can_upload, false);
  assert.equal(read.body.data.can_write, false);
  for (const [who, code] of [[REMOVED, 'not_member'], [STRANGER, 'not_member'], [ADMIN, 'not_member'], [N_OWNER, 'not_entitled']]) {
    const r = await call(db, '/ledger/me', who);
    assert.equal(r.status, 403, `${who} ${r.text}`);
    assert.equal(r.body.code, code, who);
  }
  const ent = db.rpc.find((x) => x.fn === 'company_entitled' && x.body.p_user === OWNER);
  assert.deepEqual(ent.body, { p_company: CO, p_feature: 'ledger', p_user: OWNER });
});

test('직원 — 장부 · 계정 · 설정 · 줄 쓰기는 403 not_money, 쓰지 않는다', async () => {
  const db = makeDb();
  for (const [path, method, body] of [
    ['/ledger/book', 'GET'], ['/ledger/accounts', 'GET'], ['/ledger/settings', 'GET'],
    ['/ledger/settings', 'PUT', { vat_type: 'general', business_kind: 'retail' }],
    ['/ledger/entries', 'POST', entryBody()],
    ['/ledger/entries/e0000000-0000-4000-8000-000000000001/void', 'POST', { reason: 'x' }],
  ]) {
    const r = await call(db, path, STAFF, { method, body });
    assert.equal(r.status, 403, `${method} ${path} ${r.text}`);
    assert.equal(r.body.code, 'not_money');
    assert.equal(r.calls.filter((c) => c.method !== 'GET' && !c.url.includes('/rpc/company_entitled')).length, 0);
  }
});

test('자격 read — 장부 보기는 되고, 쓰기 · 사진 올리기는 403 read_only', async () => {
  const db = makeDb({ book: [{ source: 'entry', id: 'x', entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', amount: 1, vat_amount: 0 }] });
  const book = await call(db, '/ledger/book?month=2026-11', R_OWNER);
  assert.equal(book.status, 200, book.text);
  assert.equal(book.body.data.level, 'read');
  for (const [who, path, opts] of [
    [R_OWNER, '/ledger/entries', { method: 'POST', body: entryBody() }],
    [R_OWNER, '/ledger/settings', { method: 'PUT', body: { vat_type: 'general', business_kind: 'retail' } }],
    [R_STAFF, '/ledger/documents', { method: 'POST', raw: jpeg(100, 100) }],
    [R_OWNER, '/ledger/documents', { method: 'POST', raw: jpeg(100, 100) }],
  ]) {
    const r = await call(db, path, who, opts);
    assert.equal(r.status, 403, `${who} ${path} ${r.text}`);
    assert.equal(r.body.code, 'read_only');
  }
  assert.equal(db.uploads.length, 0);
  assert.equal(db.entries.length, 0);
});

// ── 장부 줄 ──────────────────────────────────────────────────

test('POST /ledger/entries — 직접 입력 201, 업체 · 사람 · source manual, 바꾼 사람 머리', async () => {
  const db = makeDb();
  const r = await call(db, '/ledger/entries', MANAGER, { method: 'POST', body: entryBody({ counterparty_id: CP_MINE }), headers: { 'X-Idempotency-Key': 'k-1' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.data.reused, false);
  const [w] = writes(r.calls, 'ledger_entries');
  assert.equal(w.actor, MANAGER);
  assert.deepEqual(w.body, {
    company_id: CO, entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', description: '11월 임대료',
    counterparty_id: CP_MINE, counterparty_name: '한빛목재', counterparty_biz_no: BIZ_OK,
    amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice', payment_method: 'transfer',
    source: 'manual', created_by: MANAGER, idempotency_key: 'k-1',
  });
  assert.equal(r.body.data.entry.company_id, undefined, '응답에 업체 칸은 없다');
  assert.equal(r.body.data.entry.amount, 1000000);

  // 같은 키 — 처음 줄 (쓰지 않는다)
  const again = await call(db, '/ledger/entries', MANAGER, { method: 'POST', body: entryBody({ amount: 5 }), headers: { 'X-Idempotency-Key': 'k-1' } });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.data.reused, true);
  assert.equal(again.body.data.entry.id, r.body.data.entry.id);
  assert.equal(writes(again.calls, 'ledger_entries').length, 0);
  assert.equal(db.entries.length, 1);
});

test('POST /ledger/entries — 계정 · 방향 · 거래처 · 키 꼴을 먼저 본다 (422, 쓰지 않는다)', async () => {
  const db = makeDb();
  for (const [body, headers, re] of [
    [entryBody({ account: 'income.sales' }), {}, /방향/],
    [entryBody({ account: 'admin.nope' }), {}, /없는 계정/],
    [entryBody({ account: 'admin.old' }), {}, /없는 계정/],
    [entryBody({ direction: 'asset_buy' }), {}, /방향/],
    [entryBody({ counterparty_id: CP_OTHER }), {}, /거래처/],
    [entryBody({ counterparty_biz_no: '1248100997' }), {}, /사업자등록번호/],
    [entryBody(), { 'X-Idempotency-Key': 'bad key!' }, /Idempotency/],
  ]) {
    const r = await call(db, '/ledger/entries', OWNER, { method: 'POST', body, headers });
    assert.equal(r.status, 422, r.text);
    assert.match(r.body.message, re);
    assert.equal(writes(r.calls, 'ledger_entries').length, 0);
  }
});

test('POST /ledger/entries — 같은 키가 동시에 (고유 충돌) → 먼저 들어간 줄', async () => {
  const db = makeDb();
  const route = db.route;
  let first = true;
  db.route = (u, m, b) => {
    // 첫 키 조회는 비어 있고, 그사이 다른 요청이 같은 키로 넣었다
    if (m === 'GET' && u.includes('/ledger_entries?') && u.includes('idempotency_key=eq.k-race') && first) {
      first = false;
      db.entries.push({ id: 'e-other', company_id: CO, idempotency_key: 'k-race', amount: 7 });
      return json([]);
    }
    return route(u, m, b);
  };
  const r = await call(db, '/ledger/entries', OWNER, { method: 'POST', body: entryBody(), headers: { 'X-Idempotency-Key': 'k-race' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.reused, true);
  assert.equal(r.body.data.entry.id, 'e-other');
  assert.equal(db.entries.length, 1);
});

test('POST /ledger/entries/:id/void — 이유 필수 · 한 번만 · 다른 업체 줄은 404, 지우지 않는다', async () => {
  const id = 'e0000000-0000-4000-8000-00000000aa01';
  const other = 'e0000000-0000-4000-8000-00000000aa02';
  const db = makeDb({ entries: [
    { id, company_id: CO, entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', amount: 10, vat_amount: 0, voided_at: null },
    { id: other, company_id: CO_READ, entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', amount: 10, vat_amount: 0, voided_at: null },
  ] });
  const noReason = await call(db, `/ledger/entries/${id}/void`, OWNER, { method: 'POST', body: { reason: '  ' } });
  assert.equal(noReason.status, 422, noReason.text);
  const r = await call(db, `/ledger/entries/${id}/void`, OWNER, { method: 'POST', body: { reason: '두 번 적음' } });
  assert.equal(r.status, 200, r.text);
  const [w] = writes(r.calls, 'ledger_entries');
  assert.equal(w.method, 'PATCH');
  assert.equal(w.actor, OWNER);
  assert.ok(w.url.includes('voided_at=is.null') && w.url.includes(`company_id=eq.${CO}`));
  assert.deepEqual(Object.keys(w.body).sort(), ['void_reason', 'voided_at', 'voided_by']);
  assert.equal(r.body.data.entry.void_reason, '두 번 적음');
  assert.equal(r.calls.filter((c) => c.method === 'DELETE').length, 0);

  const twice = await call(db, `/ledger/entries/${id}/void`, OWNER, { method: 'POST', body: { reason: '또' } });
  assert.equal(twice.status, 409, twice.text);
  const notMine = await call(db, `/ledger/entries/${other}/void`, OWNER, { method: 'POST', body: { reason: 'x' } });
  assert.equal(notMine.status, 404, notMine.text);
  const badId = await call(db, '/ledger/entries/nope/void', OWNER, { method: 'POST', body: { reason: 'x' } });
  assert.equal(badId.status, 404, badId.text);
});

test('POST /ledger/entries/:id/correct — DB 함수에 바뀐 칸 · 사람 · 이유, 새 줄을 돌려준다', async () => {
  const id = 'e0000000-0000-4000-8000-00000000bb01';
  const db = makeDb({ entries: [
    { id, company_id: CO, seq: 1, entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', description: '임대료', amount: 1000000, vat_amount: 100000, evidence_type: 'tax_invoice', payment_method: 'transfer', source: 'manual', created_by: OWNER, voided_at: null },
  ] });
  const same = await call(db, `/ledger/entries/${id}/correct`, MANAGER, { method: 'POST', body: { reason: '고침', amount: 1000000 } });
  assert.equal(same.status, 422, same.text);
  const wrong = await call(db, `/ledger/entries/${id}/correct`, MANAGER, { method: 'POST', body: { reason: '고침', account: 'income.sales' } });
  assert.equal(wrong.status, 422, wrong.text);
  const noReason = await call(db, `/ledger/entries/${id}/correct`, MANAGER, { method: 'POST', body: { amount: 900000 } });
  assert.equal(noReason.status, 422, noReason.text);
  assert.equal(db.rpc.filter((x) => x.fn === 'ledger_correct_entry').length, 0);

  const r = await call(db, `/ledger/entries/${id}/correct`, MANAGER, { method: 'POST', body: { reason: '금액 잘못 적음', amount: 900000, account: 'admin.supplies' } });
  assert.equal(r.status, 201, r.text);
  const rpc = r.calls.find((c) => c.url.endsWith('/rpc/ledger_correct_entry'));
  assert.equal(rpc.actor, MANAGER);
  assert.deepEqual(rpc.body, { p_entry: id, p_actor: MANAGER, p_payload: { account: 'admin.supplies', amount: 900000 }, p_reason: '금액 잘못 적음' });
  assert.equal(r.body.data.replaced, id);
  assert.equal(r.body.data.entry.replaces_id, id);
  assert.equal(r.body.data.entry.amount, 900000);

  const again = await call(db, `/ledger/entries/${id}/correct`, MANAGER, { method: 'POST', body: { reason: '또', amount: 1 } });
  assert.equal(again.status, 409, again.text);
});

test('GET /ledger/book — DB 함수 ledger_book(업체 · 범위 · 취소 줄), 차례 · 합계', async () => {
  const db = makeDb({ book: [
    { source: 'cost', id: 'c1', entry_date: '2026-11-02', direction: 'expense', account: 'purchase.materials', amount: 300000, vat_amount: 30000 },
    { source: 'payment', id: 'p1', entry_date: '2026-11-01', direction: 'income', account: 'income.sales', amount: 1000000, vat_amount: 100000, vat_computed: true },
  ] });
  const r = await call(db, '/ledger/book?month=2026-11&include_void=1', OWNER);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.cache, 'no-store, private');
  const rpc = db.rpc.find((x) => x.fn === 'ledger_book');
  assert.deepEqual(rpc.body, { p_company: CO, p_from: '2026-11-01', p_to: '2026-11-30', p_include_void: true });
  assert.deepEqual(r.body.data.rows.map((x) => x.id), ['p1', 'c1']);
  assert.equal(r.body.data.totals.income, 1000000);
  assert.equal(r.body.data.totals.expense_vat, 30000);
  const far = await call(db, '/ledger/book?from=2025-01-01&to=2026-11-30', OWNER);
  assert.equal(far.status, 422, far.text);
});

test('GET /ledger/accounts — 쓰는 계정만 차례대로', async () => {
  const r = await call(makeDb(), '/ledger/accounts', OWNER);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data.items.map((a) => a.code), ['income.sales', 'purchase.materials', 'admin.rent', 'admin.supplies', 'asset.tangible']);
  assert.deepEqual(Object.keys(r.body.data.items[0]), ['code', 'name', 'grp', 'note']);
});

// ── 사진 ─────────────────────────────────────────────────────

test('POST /ledger/documents — 직원도 올린다: 버킷 경로 · 줄 · 바꾼 사람, 응답은 직원 모양', async () => {
  const db = makeDb();
  const r = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(1200, 1600), headers: { 'X-Idempotency-Key': 'photo-1', 'X-Ledger-Note': encodeURIComponent('  현장 A 자재  ') } });
  assert.equal(r.status, 201, r.text);
  assert.equal(db.uploads.length, 1);
  const today = kstDate();
  const [doc] = db.documents;
  assert.match(db.uploads[0], new RegExp(`^${CO}/${today.slice(0, 4)}/${today.slice(5, 7)}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(doc.storage_path, db.uploads[0]);
  assert.equal(db.uploads[0].includes(doc.id), true);
  assert.equal(doc.uploaded_by, STAFF);
  assert.equal(doc.mime, 'image/jpeg');
  assert.equal(doc.width, 1200);
  assert.equal(doc.height, 1600);
  assert.equal(doc.size_bytes, jpeg(1200, 1600).byteLength);
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);
  assert.equal(doc.note, '현장 A 자재');
  assert.equal(doc.idempotency_key, 'photo-1');
  assert.equal(writes(r.calls, 'ledger_documents')[0].actor, STAFF);
  assert.deepEqual(Object.keys(r.body.data.document).sort(), ['created_at', 'id', 'reason', 'status']);
  assert.equal(r.body.data.document.status, 'uploaded');

  // 같은 파일 — 처음 사진 (다시 올리지 않는다)
  const same = await call(db, '/ledger/documents', MANAGER, { method: 'POST', raw: jpeg(1200, 1600) });
  assert.equal(same.status, 200, same.text);
  assert.equal(same.body.data.reused, true);
  assert.equal(same.body.data.document.id, doc.id);
  assert.equal(same.body.data.document.review_status, 'pending', '대표 · 실장 모양');
  // 같은 키 — 본문을 읽기 전에
  const key = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(10, 10, [9, 9]), headers: { 'X-Idempotency-Key': 'photo-1' } });
  assert.equal(key.status, 200, key.text);
  assert.equal(key.body.data.document.id, doc.id);
  assert.equal(db.uploads.length, 1);
  assert.equal(db.documents.length, 1);

  const p = await call(db, '/ledger/documents', OWNER, { method: 'POST', raw: png(800, 600) });
  assert.equal(p.status, 201, p.text);
  assert.match(db.uploads[1], /\.png$/);
});

test('POST /ledger/documents — 형식 · 크기 검사 (HEIC · PDF · 빈 본문 422, 5MB 넘음 413, 너무 큰 사진 422)', async () => {
  const db = makeDb();
  const cases = [
    [heic(), 422, 'heic'],
    [new TextEncoder().encode('%PDF-1.7 not a photo at all'), 422, 'bad_type'],
    [new Uint8Array(0), 422, 'empty'],
    [jpeg(2577, 100), 422, 'dimensions'],
    [jpeg(2576, 1500), 422, 'dimensions'],
  ];
  for (const [raw, status, code] of cases) {
    const r = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw });
    assert.equal(r.status, status, r.text);
    assert.equal(r.body.details.code, code);
  }
  const ok = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(2576, 1450) });
  assert.equal(ok.status, 201, ok.text);
  const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
  big.set(jpeg(100, 100));
  const tooBig = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: big });
  assert.equal(tooBig.status, 413, tooBig.text);
  const declared = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(100, 100), headers: { 'Content-Length': String(PHOTO_MAX_BYTES + 1) } });
  assert.equal(declared.status, 413, declared.text);
  assert.equal(db.uploads.length, 1);
  assert.equal(db.documents.length, 1);
});

test('POST /ledger/documents — 분 한도(바인딩) · 하루 장수 429, 한도기가 고장 나면 통과', async () => {
  const db = makeDb();
  const limited = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(100, 100), env: { ...ENV, LEDGER_UPLOAD_LIMIT: { limit: async ({ key }) => ({ success: key !== STAFF }) } } });
  assert.equal(limited.status, 429, limited.text);
  assert.equal(limited.body.code, 'rate_limited');
  const broken = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(100, 100), env: { ...ENV, LEDGER_UPLOAD_LIMIT: { limit: async () => { throw new Error('down'); } } } });
  assert.equal(broken.status, 201, broken.text);

  const now = new Date().toISOString();
  const full = makeDb({ documents: Array.from({ length: DAILY_USER_MAX }, (_, k) => ({ id: `d${k}`, company_id: CO, uploaded_by: STAFF, sha256: `s${k}`, review_status: 'pending', created_at: now })) });
  const daily = await call(full, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(100, 100) });
  assert.equal(daily.status, 429, daily.text);
  assert.equal(daily.body.code, 'daily_limit');
  const other = await call(full, '/ledger/documents', STAFF2, { method: 'POST', raw: jpeg(100, 100) });
  assert.equal(other.status, 201, other.text);
});

test('GET /ledger/documents — 직원은 자기 것의 일자 · 상태 · 돌려보낸 이유만 (돈 · 파일 칸이 어디에도 없다)', async () => {
  const at = (h) => `2026-11-0${h}T00:00:00.000Z`;
  const doc = (id, by, status, extra = {}) => ({ id, company_id: CO, uploaded_by: by, storage_path: `${CO}/2026/11/${id}.jpg`, mime: 'image/jpeg', size_bytes: 1234, sha256: 'a'.repeat(64), width: 10, height: 10, note: '메모', review_status: status, decided_by: OWNER, decided_at: at(3), decision_reason: '흐림', created_at: at(1), ...extra });
  const db = makeDb({ documents: [
    doc('d1', STAFF, 'returned', { created_at: at(2) }),
    doc('d2', STAFF, 'skipped_budget'),
    doc('d3', STAFF2, 'posted'),
    doc('d4', STAFF, 'posted', { decision_reason: null, created_at: at(3) }),
  ] });
  const r = await call(db, '/ledger/documents', STAFF);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.money, false);
  assert.deepEqual(r.body.data.items, [
    { id: 'd4', created_at: at(3), status: 'posted', reason: null },
    { id: 'd1', created_at: at(2), status: 'returned', reason: '흐림' },
    { id: 'd2', created_at: at(1), status: 'uploaded', reason: null },
  ]);
  const banned = ['amount', 'vat', 'note', 'sha256', 'storage_path', 'size_bytes', 'width', 'height', 'url', 'uploaded_by', 'decided_by', 'mime'];
  const scan = (v) => {
    if (Array.isArray(v)) return v.forEach(scan);
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!banned.some((b) => k.includes(b)), `직원 응답에 ${k}`);
        scan(x);
      }
    }
  };
  scan(r.body);
  assert.ok(new URL(r.calls.find((c) => c.url.includes('/ledger_documents?')).url).searchParams.get('uploaded_by') === `eq.${STAFF}`);
  const byStatus = await call(db, '/ledger/documents?status=posted', STAFF);
  assert.equal(byStatus.status, 422, byStatus.text);

  const owner = await call(db, '/ledger/documents?status=posted', OWNER);
  assert.equal(owner.status, 200, owner.text);
  assert.deepEqual(owner.body.data.items.map((d) => d.id), ['d4', 'd3']);
  assert.equal(owner.body.data.items[0].note, '메모');
  assert.equal(owner.body.data.items[0].storage_path, undefined, '파일 경로 · 주소는 주지 않는다');
  const mine = await call(db, '/ledger/documents?mine=1', OWNER);
  assert.deepEqual(mine.body.data.items, []);
});

// ── 설정 ─────────────────────────────────────────────────────

test('PUT /ledger/settings — tax 묶음만 바꾸고 원가 설정은 그대로, 값은 정해진 것만', async () => {
  const db = makeDb({ settings: { [CO]: { quote: { marginRate: 0.3 }, vendors: { door: '우드원' } } } });
  const bad = await call(db, '/ledger/settings', OWNER, { method: 'PUT', body: { vat_type: 'normal', business_kind: 'retail' } });
  assert.equal(bad.status, 422, bad.text);
  const r = await call(db, '/ledger/settings', MANAGER, { method: 'PUT', body: { vat_type: 'simplified', business_kind: 'retail' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.data, { vat_type: 'simplified', business_kind: 'retail' });
  assert.deepEqual(db.settings[CO], { quote: { marginRate: 0.3 }, vendors: { door: '우드원' }, tax: { vat_type: 'simplified', business_kind: 'retail' } });
  const get = await call(db, '/ledger/settings', OWNER);
  assert.deepEqual(get.body.data, { vat_type: 'simplified', business_kind: 'retail' });
});

test('원가 설정 저장(POST /production/settings)은 장부 과세 묶음을 지우지 않는다', async () => {
  const db = makeDb({ settings: { [CO]: { quote: { marginRate: 0.3 }, tax: { vat_type: 'general', business_kind: 'manufacturing' } } } });
  const r = await call(db, '/production/settings', OWNER, { method: 'POST', body: { quote: { marginRate: 0.25 } } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(db.settings[CO], { quote: { marginRate: 0.25 }, tax: { vat_type: 'general', business_kind: 'manufacturing' } });
});

// ── 본사 → 공장 장부 보기 ─────────────────────────────────────

test('본사 대표 · 실장 — 자기 장부와 공장 장부 목록, ?company= 로 공장 장부를 보기만', async () => {
  const db = makeDb({ book: [{ source: 'entry', id: 'x', entry_date: '2026-11-01', direction: 'expense', account: 'admin.rent', amount: 1, vat_amount: 0 }] });
  const me = await call(db, '/ledger/me', PF_OWNER);
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.data.company_id, PLATFORM);
  assert.equal(me.body.data.viewing, false);
  assert.deepEqual(me.body.data.ledgers, [
    { company_id: PLATFORM, name: '다담 본사', kind: 'platform', own: true },
    { company_id: HQ, name: '다담 공장', kind: 'hq', own: false },
  ]);
  const view = await call(db, `/ledger/me?company=${HQ}`, PF_OWNER);
  assert.equal(view.status, 200, view.text);
  assert.equal(view.body.data.company_id, HQ);
  assert.equal(view.body.data.viewing, true);
  assert.equal(view.body.data.level, 'read');
  assert.equal(view.body.data.can_write, false);
  assert.equal(view.body.data.can_upload, false);
  const ent = db.rpc.filter((x) => x.fn === 'company_entitled' && x.body.p_company === HQ);
  assert.ok(ent.length && ent.every((x) => !('p_user' in x.body)), '공장 자격은 사람 없이 본다');

  const book = await call(db, `/ledger/book?month=2026-11&company=${HQ}`, PF_OWNER);
  assert.equal(book.status, 200, book.text);
  assert.equal(db.rpc.filter((x) => x.fn === 'ledger_book').at(-1).body.p_company, HQ);
  assert.equal(book.body.data.viewing, true);
  assert.equal(book.body.data.company_id, HQ);
  for (const path of ['/ledger/accounts', '/ledger/settings']) {
    const r = await call(db, `${path}?company=${HQ}`, PF_OWNER);
    assert.equal(r.status, 200, `${path} ${r.text}`);
  }
  const docs = await call(db, `/ledger/documents?company=${HQ}`, PF_OWNER);
  assert.equal(docs.status, 200, docs.text);
  assert.equal(new URL(docs.calls.find((c) => c.url.includes('/ledger_documents?')).url).searchParams.get('company_id'), `eq.${HQ}`);
});

test('본사 → 공장 — 쓰기는 자기 업체에만 (company 를 붙여도 공장에 쓰지 않는다)', async () => {
  const db = makeDb();
  const r = await call(db, `/ledger/entries?company=${HQ}`, PF_OWNER, { method: 'POST', body: entryBody() });
  assert.equal(r.status, 201, r.text);
  assert.equal(db.entries[0].company_id, PLATFORM);
  const put = await call(db, `/ledger/settings?company=${HQ}`, PF_OWNER, { method: 'PUT', body: { vat_type: 'general', business_kind: 'manufacturing' } });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(Object.keys(db.settings), [PLATFORM]);
});

test('남의 장부 — 본사 직원 · 공장 · 협력업체는 403, 공장 자격이 없으면 본사도 못 보고, 본사 자격이 없으면 /ledger/me 가 공장 장부로', async () => {
  const db = makeDb();
  for (const [who, company] of [[PF_STAFF, HQ], [HQ_OWNER, PLATFORM], [OWNER, HQ], [OWNER, PLATFORM], [PF_OWNER, CO], [PF_OWNER, 'nope']]) {
    const r = await call(db, `/ledger/book?company=${company}`, who);
    assert.equal(r.status, 403, `${who} → ${company} ${r.text}`);
  }
  assert.equal(db.rpc.filter((x) => x.fn === 'ledger_book').length, 0);
  LEVEL[HQ] = 'none';
  try {
    const r = await call(db, `/ledger/book?company=${HQ}`, PF_OWNER);
    assert.equal(r.status, 403, r.text);
    const me = await call(db, '/ledger/me', PF_OWNER);
    assert.deepEqual(me.body.data.ledgers.map((x) => x.company_id), [PLATFORM]);
  } finally {
    LEVEL[HQ] = 'full';
  }
  LEVEL[PLATFORM] = 'none';
  try {
    const me = await call(db, '/ledger/me', PF_OWNER);
    assert.equal(me.status, 200, me.text);
    assert.equal(me.body.data.company_id, HQ);
    assert.equal(me.body.data.viewing, true);
    assert.deepEqual(me.body.data.ledgers.map((x) => x.company_id), [HQ]);
    const staff = await call(db, '/ledger/me', PF_STAFF);
    assert.equal(staff.status, 403, staff.text);
    assert.equal(staff.body.code, 'not_entitled');
  } finally {
    LEVEL[PLATFORM] = 'full';
  }
});

test('POST /ledger/documents — 메모는 X-Ledger-Note 머리만 읽는다 (주소의 ?note= 는 보지 않는다) · 깨진 값 · 300자 넘음은 422', async () => {
  const db = makeDb();
  const q = await call(db, `/ledger/documents?note=${encodeURIComponent('주소 메모')}`, STAFF, { method: 'POST', raw: jpeg(100, 100) });
  assert.equal(q.status, 201, q.text);
  assert.equal(db.documents[0].note, null);

  const bad = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(101, 100), headers: { 'X-Ledger-Note': '%E0%A4%A' } });
  assert.equal(bad.status, 422, bad.text);
  assert.equal(bad.body.message, '메모를 읽지 못했습니다');

  const long = await call(db, '/ledger/documents', STAFF, { method: 'POST', raw: jpeg(102, 100), headers: { 'X-Ledger-Note': encodeURIComponent('가'.repeat(301)) } });
  assert.equal(long.status, 422, long.text);
  assert.equal(db.documents.length, 1);
  assert.equal(db.uploads.length, 1);

  const pre = await worker.fetch(new Request('https://api.test/ledger/documents', { method: 'OPTIONS', headers: { Origin: 'https://dadamfurniture.com' } }), ENV, { waitUntil() {} });
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Ledger-Note/);
});
