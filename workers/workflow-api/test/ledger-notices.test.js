/**
 * 장부 알림 (src/ledger/notices.js · push/messages.js ledger_notice — DB 0033).
 *
 *   - 매분 cron: 분 % 5 == 2 훑기 + 바로 알림(중복 · 큰 금액, 한 시간에 한 번), 분 % 5 == 3 국세청(키 있을 때만),
 *     08:00~08:29 아침 묶음(안 본 수만, 하루 한 번, 2 · 3 분은 건너뜀). 함수가 없으면(0033 전) 경고 한 번, 던지지 않는다
 *   - 앱 알림 글: 수만 — 금액 · 상호 없음, 열 곳은 비서 탭
 *   - GET /ledger/notices 대표 · 실장만 (직원 403), POST /ledger/notices/seen 자기 업체 · 안 본 것만
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { buildMessage, isValidMessage, LEDGER_NOTICE_URL, LEDGER_URL } from '../src/push/messages.js';
import { runLedgerNotices, noticeJobs, kstDay, NOW_COMPANIES, DIGEST_COMPANIES, NTS_BATCH, NTS_STALE_DAYS } from '../src/ledger/notices.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const N1 = 'b0000000-0000-4000-8000-000000000001';
const N2 = 'b0000000-0000-4000-8000-000000000002';
const N3 = 'b0000000-0000-4000-8000-000000000003';
const BIZ_A = '1234567891';
const BIZ_B = '2208112341';
/** 한국 시간 → UTC ms */
const kst = (s) => Date.parse(`${s}+09:00`);
// 가짜 거래처 · 금액 — 앱 알림 글 어디에도 나오면 안 된다
const PII = ['가나목재', '2,480,000', '2480000'];

const mem = (user_id, company_id, role) => ({ user_id, company_id, role, status: 'active' });
const tables = (over = {}) => ({
  companies: [
    { id: CO, kind: 'partner', plan: 'agent', status: 'active' },
    { id: CO2, kind: 'partner', plan: 'agent', status: 'active' },
  ],
  company_members: [mem(OWNER, CO, 'owner'), mem(MANAGER, CO, 'manager'), mem(STAFF, CO, 'staff')],
  ledger_notices: [
    { id: N1, company_id: CO, kind: 'duplicate', urgency: 'now', document_id: null, entry_id: null, cost_id: null, data: { supplier: '가나목재', total: 2480000 }, created_at: '2026-11-03T05:00:00Z', seen_at: null, seen_by: null },
    { id: N2, company_id: CO, kind: 'price_change', urgency: 'digest', document_id: null, entry_id: null, cost_id: null, data: { item: 'PB 18T', old: 32000, new: 35000 }, created_at: '2026-11-03T04:00:00Z', seen_at: '2026-11-03T04:30:00Z', seen_by: OWNER },
    { id: N3, company_id: CO2, kind: 'new_supplier', urgency: 'digest', document_id: null, entry_id: null, cost_id: null, data: {}, created_at: '2026-11-03T03:00:00Z', seen_at: null, seen_by: null },
  ],
  ...over,
});

/** rpc 흉내 — 부른 차례를 남긴다 */
function rpcs({ claim = {}, missing = false, due = [], record = { saved: 0, added: 0 } } = {}) {
  const calls = [];
  const fn = (name, body) => {
    calls.push({ name, body });
    if (missing) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    if (name === 'ledger_notices_scan') return { reads: 2, posts: 0, added: 1 };
    if (name === 'ledger_notices_claim') return claim[body.p_urgency] || [];
    if (name === 'ledger_nts_due') return due.map((b) => ({ biz_no: b }));
    if (name === 'ledger_nts_record') return record;
    if (name === 'company_entitled') return 'full';
    return undefined;
  };
  fn.calls = calls;
  return fn;
}

test('이 분에 할 일 — 훑기 2 · 국세청 3 (5분마다), 아침 묶음 08:00~08:29 (2 · 3 분 빼고)', () => {
  assert.deepEqual(noticeJobs(kst('2026-11-03T14:02:00')), { scan: true, nts: false, digest: false, invoice: false, month: false });
  assert.deepEqual(noticeJobs(kst('2026-11-03T14:13:00')), { scan: false, nts: true, digest: false, invoice: false, month: false });
  assert.deepEqual(noticeJobs(kst('2026-11-03T08:00:00')), { scan: false, nts: false, digest: true, invoice: false, month: false });
  assert.deepEqual(noticeJobs(kst('2026-11-03T08:07:00')), { scan: true, nts: false, digest: false, invoice: false, month: false });
  assert.deepEqual(noticeJobs(kst('2026-11-03T08:29:00')), { scan: false, nts: false, digest: true, invoice: false, month: false });
  assert.deepEqual(noticeJobs(kst('2026-11-03T08:30:00')), { scan: false, nts: false, digest: false, invoice: false, month: false });
  // 세금계산서 없음 — 11일부터 07:55 (10일까지 · 다른 분은 아님)
  assert.equal(noticeJobs(kst('2026-11-10T07:55:00')).invoice, false);
  assert.equal(noticeJobs(kst('2026-11-11T07:55:00')).invoice, true);
  assert.equal(noticeJobs(kst('2026-11-30T07:55:00')).invoice, true);
  assert.equal(noticeJobs(kst('2026-11-11T07:56:00')).invoice, false);
  // 월 보고 — 매달 1일 07:50 만
  assert.equal(noticeJobs(kst('2026-12-01T07:50:00')).month, true);
  assert.equal(noticeJobs(kst('2026-12-01T07:51:00')).month, false);
  assert.equal(noticeJobs(kst('2026-12-02T07:50:00')).month, false);
  assert.equal(noticeJobs(kst('2026-12-01T07:50:00')).scan, false);
  assert.equal(kstDay(kst('2026-11-04T00:10:00')), '20261104');
});

test('앱 알림 글 — 수만, 금액 · 상호 없이, 비서 탭으로', () => {
  const now = buildMessage('ledger_notice', { count: 2 });
  assert.deepEqual(now, { title: '장부 확인 필요', body: '중복 의심 · 평소와 다른 큰 금액이 2건 있습니다. 비서 탭에서 확인해 주세요.', url: LEDGER_NOTICE_URL });
  const am = buildMessage('ledger_notice', { count: 6, digest: true });
  assert.equal(am.title, '장부에 바뀐 점');
  assert.equal(am.body, '장부에 바뀐 점이 6건 있습니다. 비서 탭에서 확인해 주세요.');
  assert.ok(isValidMessage(now) && isValidMessage(am));
  assert.equal(LEDGER_NOTICE_URL, '/segan/assistant.html');
  assert.equal(buildMessage('ledger_notice', { count: 0 }), null);
  // 사진 AI 읽기 · 비서가 없는 업체(Expert) — 회계 화면으로
  const ex = buildMessage('ledger_notice', { count: 1, digest: true, ai: false });
  assert.deepEqual(ex, { title: '장부 알림', body: '장부에 새 알림이 1건 있습니다. 회계 화면에서 확인해 주세요.', url: LEDGER_URL });
  assert.ok(isValidMessage(ex));
  assert.deepEqual(buildMessage('ledger_notice', { count: 2, ai: true }), now);
});

test('훑는 분 — 훑고 바로 알림을 잡아 대표 · 실장에게 (한 시간에 한 번, 직원 · 안 본 것 없는 업체는 아니다)', async () => {
  const rpc = rpcs({ claim: { now: [{ company_id: CO, notices: 3, unseen: 2 }, { company_id: CO2, notices: 1, unseen: 0 }] } });
  const fake = createFake({ tables: tables(), rpc });
  const at = kst('2026-11-03T14:02:00');
  const out = await withFake(fake, () => runLedgerNotices(ENV, { nowMs: at }));
  assert.deepEqual(rpc.calls.map((c) => c.name), ['ledger_notices_scan', 'ledger_notices_claim', 'company_entitled']);
  assert.deepEqual(rpc.calls[2].body, { p_company: CO, p_feature: 'ledger_ai' });
  assert.deepEqual(rpc.calls[1].body, { p_urgency: 'now', p_companies: NOW_COMPANIES });
  assert.equal(out.pushed, 2);
  const box = fake.db.notification_outbox;
  assert.deepEqual(box.map((r) => [r.user_id, r.kind, r.title]).sort(), [
    [OWNER, 'ledger_notice', '장부 확인 필요'],
    [MANAGER, 'ledger_notice', '장부 확인 필요'],
  ].sort());
  assert.equal(box[0].dedupe_key, `ledger_notice:${CO}:${box[0].user_id}:h2026110314`);
  for (const r of box) for (const v of PII) assert.ok(!r.body.includes(v) && !r.title.includes(v), v);
  // 같은 시간에 또 — 앱 알림은 한 번
  await withFake(fake, () => runLedgerNotices(ENV, { nowMs: at + 5 * 60 * 1000 }));
  await withFake(fake, () => runLedgerNotices(ENV, { nowMs: at + 10 * 60 * 1000 }));
  assert.equal(fake.db.notification_outbox.length, 2);
});

test('아침 묶음 — 안 본 수만, 하루 한 번 · 다른 분에는 아무것도 하지 않는다', async () => {
  const rpc = rpcs({ claim: { digest: [{ company_id: CO, notices: 4, unseen: 3 }] } });
  const fake = createFake({ tables: tables(), rpc });
  await withFake(fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-11-03T08:01:00') }));
  assert.deepEqual(rpc.calls.map((c) => [c.name, c.body.p_urgency, c.body.p_companies]), [['ledger_notices_claim', 'digest', DIGEST_COMPANIES], ['company_entitled', undefined, undefined]]);
  const box = fake.db.notification_outbox;
  assert.equal(box.length, 2);
  assert.equal(box[0].title, '장부에 바뀐 점');
  assert.match(box[0].dedupe_key, /:d20261103$/);
  assert.match(box[0].body, /3건/);
  rpc.calls.length = 0;
  await withFake(fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-11-03T14:01:00') }));
  assert.deepEqual(rpc.calls, []);
});

test('월 보고 — 매달 1일 07:50 지난달로 ledger_month_report_scan 하나, 0038 전이면 건너뛴다', async () => {
  const calls = [];
  const rpc = (name, body) => {
    calls.push({ name, body });
    if (name === 'ledger_month_report_scan') return 3;
    return undefined;
  };
  const fake = createFake({ tables: tables(), rpc });
  const out = await withFake(fake, () => runLedgerNotices(ENV, { nowMs: kst('2026-12-01T07:50:00') }));
  assert.deepEqual(calls, [{ name: 'ledger_month_report_scan', body: { p_month: '2026-11-01' } }]);
  assert.equal(out.month, 3);
  // 1월 1일이면 지난해 12월
  calls.length = 0;
  await withFake(fake, () => runLedgerNotices(ENV, { nowMs: kst('2027-01-01T07:50:00') }));
  assert.deepEqual(calls[0].body, { p_month: '2026-12-01' });
  // 0038 전 — 함수가 없으면 던지지 않는다
  const gone = createFake({ tables: tables(), rpc: rpcs({ missing: true }) });
  const r = await withFake(gone, () => runLedgerNotices(ENV, { nowMs: kst('2026-12-01T07:50:00') }));
  assert.equal(r.skipped, 'no_function');
});

test('국세청 분 — 키가 있으면 묵은 번호를 한 번에 묻고 기록, 없으면 묻지 않는다 (키 · 주소는 로그에 없다)', async () => {
  const KEY = 'secret-nts/key+1';
  const asked = [];
  const external = async (url, init) => {
    if (url.hostname !== 'api.odcloud.kr') return null;
    asked.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ status_code: 'OK', data: [{ b_no: BIZ_A, b_stt_cd: '03', tax_type: '부가가치세 일반과세자', end_dt: '20261015' }, { b_no: BIZ_B, b_stt_cd: '01', tax_type: '부가가치세 간이과세자', end_dt: '' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const rpc = rpcs({ due: [BIZ_A, BIZ_B, 'bad'], record: { saved: 2, added: 1 } });
  const fake = createFake({ tables: tables(), rpc, external });
  const at = kst('2026-11-03T14:03:00');
  const out = await withFake(fake, async (lines) => {
    const r = await runLedgerNotices({ ...ENV, NTS_SERVICE_KEY: KEY }, { nowMs: at });
    for (const l of lines) assert.ok(!l.includes(KEY) && !l.includes('odcloud'), l);
    return r;
  });
  assert.deepEqual(out.nts, { asked: 2, saved: 2, added: 1 });
  assert.deepEqual(rpc.calls[0].body, { p_limit: NTS_BATCH, p_stale_days: NTS_STALE_DAYS });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].body, { b_no: [BIZ_A, BIZ_B] });
  assert.deepEqual(rpc.calls[1], {
    name: 'ledger_nts_record',
    body: {
      p_rows: [
        { biz_no: BIZ_A, status: 'closed', tax_type: '부가가치세 일반과세자', closed_on: '2026-10-15' },
        { biz_no: BIZ_B, status: 'active', tax_type: '부가가치세 간이과세자', closed_on: null },
      ],
    },
  });
  // 키가 없으면 묻지 않는다
  const none = rpcs();
  await withFake(createFake({ tables: tables(), rpc: none, external }), () => runLedgerNotices(ENV, { nowMs: at }));
  assert.deepEqual(none.calls, []);
});

test('0033 전 — 함수가 없으면 경고 한 번, 던지지 않는다', async () => {
  const fake = createFake({ tables: tables(), rpc: rpcs({ missing: true }) });
  const r = await withFake(fake, async (lines) => {
    const a = await runLedgerNotices(ENV, { nowMs: kst('2026-11-03T14:02:00') });
    const b = await runLedgerNotices(ENV, { nowMs: kst('2026-11-03T14:07:00') });
    return { a, b, lines };
  });
  assert.equal(r.a.skipped, 'no_function');
  assert.equal(r.b.skipped, 'no_function');
  assert.ok(r.lines.filter((l) => l.includes('apply database/migrations/0033')).length <= 1);
  assert.equal(fake.db.notification_outbox.length, 0);
});

// ── 주소 ───────────────────────────────────────────────

async function call(fake, path, token, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  return withFake(fake, async () => {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), ENV, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control') };
  });
}
const users = { t_owner: { id: OWNER }, t_manager: { id: MANAGER }, t_staff: { id: STAFF } };

test('GET /ledger/notices — 대표 · 실장만, 새것부터 · 안 본 수 · 캐시 없음, 직원 403', async () => {
  const fake = createFake({ tables: tables(), users, rpc: rpcs() });
  const r = await call(fake, '/ledger/notices', 't_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.cache, /no-store/);
  assert.deepEqual(r.json.data.items.map((x) => [x.id, x.kind, x.urgency]), [
    [N1, 'duplicate', 'now'],
    [N2, 'price_change', 'digest'],
  ]);
  assert.equal(r.json.data.unseen, 1);
  assert.deepEqual(r.json.data.items[0].data, { supplier: '가나목재', total: 2480000 });
  assert.equal((await call(fake, '/ledger/notices', 't_staff')).status, 403);
});

test('POST /ledger/notices/seen — 자기 업체의 안 본 알림만, ids 없으면 422', async () => {
  const fake = createFake({ tables: tables(), users, rpc: rpcs() });
  const r = await call(fake, '/ledger/notices/seen', 't_manager', { method: 'POST', body: { ids: [N1, N2, N3, 'x'] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.seen, 1);
  const byId = Object.fromEntries(fake.db.ledger_notices.map((n) => [n.id, n]));
  assert.equal(byId[N1].seen_by, MANAGER);
  assert.equal(byId[N2].seen_by, OWNER); // 이미 본 것은 그대로
  assert.equal(byId[N3].seen_at, null); // 다른 업체
  const patch = fake.calls.rest.find((c) => c.method === 'PATCH');
  assert.match(patch.query, /seen_at=is\.null/);
  assert.match(patch.query, new RegExp(`company_id=eq\\.${CO}`));
  assert.equal((await call(fake, '/ledger/notices/seen', 't_owner', { method: 'POST', body: { ids: [] } })).status, 422);
  assert.equal((await call(fake, '/ledger/notices/seen', 't_staff', { method: 'POST', body: { ids: [N1] } })).status, 403);
});
