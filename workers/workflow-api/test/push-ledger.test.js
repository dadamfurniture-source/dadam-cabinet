/**
 * 장부 앱 알림 (src/push/ledger-hooks.js · messages.js · sender.js — DB 0030).
 *
 *   - 글: 확인할 사진(수만, 999장 넘으면 「넘게」) · 돌려받은 사진 — 금액 · 상호 · 메모 · 이유 없음, 열 곳은 장부
 *   - 확인할 사진: 매분 — 최근 3분 안에 읽기가 끝난 업체마다, 확인 기다리는 사진이 있으면 active 대표 · 실장에게,
 *     한 사람에게 한국 시간 한 시간에 한 번, 한 번에 20 업체까지. 넣기 · 읽기가 실패해도 던지지 않는다
 *   - 돌려받은 사진: 올린 사람에게 (active 구성원이고 돌려보낸 사람이 아니면), 사진마다 한 번
 *   - 보낼 때 다시 본다: 확인할 사진은 대표 · 실장만, 돌려받은 사진은 구성원이면
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage,
  isValidMessage,
  LEDGER_URL,
  LEDGER_PENDING_MAX,
  charLen,
  TITLE_MAX,
  BODY_MAX,
} from '../src/push/messages.js';
import { isEligible, MONEY_KINDS } from '../src/push/sender.js';
import {
  runLedgerPendingNotices,
  notifyLedgerReturned,
  kstHour,
  PENDING_WINDOW_SEC,
  PENDING_COMPANY_MAX,
} from '../src/push/ledger-hooks.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const LEFT = 'a0000000-0000-4000-8000-000000000004';
const OTHER = 'a0000000-0000-4000-8000-000000000005';
const D1 = 'd0000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-03T03:30:20Z'); // 한국 시간 12:30
const at = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const mem = (user_id, company_id, role, status = 'active') => ({
  user_id,
  company_id,
  role,
  status,
});
const docRow = (i, company_id = CO, review_status = 'pending') => ({
  id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  company_id,
  review_status,
});
// 가짜 고객 · 거래처 정보 — 알림 글 어디에도 나오면 안 된다
const PII = ['예림', '홍길동', '010-', '33,000', '현장 메모', '흐려서'];

const tables = (over = {}) => ({
  companies: [
    { id: CO, kind: 'partner', status: 'active' },
    { id: CO2, kind: 'partner', status: 'active' },
  ],
  company_members: [
    mem(OWNER, CO, 'owner'),
    mem(MANAGER, CO, 'manager'),
    mem(STAFF, CO, 'staff'),
    mem(LEFT, CO, 'manager', 'removed'),
    mem(OTHER, CO2, 'owner'),
  ],
  ledger_extractions: [
    { id: 'x1', company_id: CO, status: 'done', finished_at: at(30) },
    { id: 'x2', company_id: CO, status: 'failed', finished_at: at(90) },
    // 3분보다 오래 전 — 이 업체는 알리지 않는다
    { id: 'x3', company_id: CO2, status: 'done', finished_at: at(PENDING_WINDOW_SEC + 60) },
    { id: 'x4', company_id: CO, status: 'running', finished_at: null },
  ],
  ledger_documents: [docRow(1), docRow(2), docRow(3, CO, 'posted'), docRow(4, CO2)],
  ...over,
});
const outbox = (fake) => fake.db.notification_outbox;

test('글 — 확인할 사진 수 · 돌려받은 사진, 금액 · 상호 · 이유 없음, 열 곳은 장부', () => {
  assert.equal(LEDGER_URL, '/segan/ledger.html');
  const cases = [
    [{ count: 1 }, '확인할 영수증 · 명세표 사진이 1장 있습니다.'],
    [{ count: 37 }, '확인할 영수증 · 명세표 사진이 37장 있습니다.'],
    [{ count: LEDGER_PENDING_MAX }, '확인할 영수증 · 명세표 사진이 999장 있습니다.'],
    [{ count: 1000 }, '확인할 영수증 · 명세표 사진이 999장 넘게 있습니다.'],
  ];
  for (const [p, body] of cases) {
    const m = buildMessage('ledger_pending', p);
    assert.deepEqual(m, { title: '확인할 사진', body, url: LEDGER_URL });
    assert.ok(isValidMessage(m));
  }
  for (const bad of [{}, { count: 0 }, { count: -1 }, { count: 1.5 }, { count: '3' }]) {
    assert.equal(buildMessage('ledger_pending', bad), null, JSON.stringify(bad));
  }
  const r = buildMessage('ledger_returned', { reason: '흐려서', note: '현장 메모' });
  assert.deepEqual(r, {
    title: '돌려받은 사진',
    body: '올린 영수증 · 명세표 사진이 돌려보내졌습니다. 이유를 확인해 주세요.',
    url: LEDGER_URL,
  });
  for (const m of [r, buildMessage('ledger_pending', { count: 5 })]) {
    assert.ok(charLen(m.title) <= TITLE_MAX && charLen(m.body) <= BODY_MAX);
    for (const v of PII) assert.ok(!m.body.includes(v) && !m.title.includes(v), v);
  }
});

test('확인할 사진 — 최근 3분 안에 읽기가 끝난 업체의 대표 · 실장에게 확인 기다리는 사진 수, 한 시간에 한 번', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW });
  const out = await withFake(fake, () => runLedgerPendingNotices(ENV, { nowMs: NOW }));
  assert.deepEqual(out, { companies: 1, notified: 2 });
  const rows = outbox(fake);
  assert.deepEqual(rows.map((n) => n.user_id).sort(), [OWNER, MANAGER].sort());
  for (const n of rows) {
    assert.equal(n.kind, 'ledger_pending');
    assert.equal(n.company_id, CO);
    assert.equal(n.ref_id, CO);
    assert.equal(n.body, '확인할 영수증 · 명세표 사진이 2장 있습니다.');
    assert.equal(n.dedupe_key, `ledger_pending:${CO}:${n.user_id}:2026110312`);
  }
  // 읽기 줄을 고를 때 — 끝난 때가 3분 안인 것만
  const read = fake.calls.rest.find((c) => c.path === 'ledger_extractions');
  assert.match(
    read.query,
    new RegExp(`finished_at=gte\\.${at(PENDING_WINDOW_SEC).replace(/\./g, '\\.')}`)
  );

  // 같은 시간 안에 다시 돌아도 (사진이 늘어도) 한 사람에게 하나
  fake.db.ledger_documents.push(docRow(5));
  fake.db.ledger_extractions.push({ id: 'x5', company_id: CO, status: 'done', finished_at: at(5) });
  await withFake(fake, () => runLedgerPendingNotices(ENV, { nowMs: NOW + 60_000 }));
  assert.equal(outbox(fake).length, 2);
  // 다음 시간이면 다시 — 그때의 수로
  const next = NOW + 40 * 60_000; // 13:10 KST
  fake.db.ledger_extractions.push({
    id: 'x6',
    company_id: CO,
    status: 'done',
    finished_at: new Date(next - 10_000).toISOString(),
  });
  fake.state.nowMs = next;
  await withFake(fake, () => runLedgerPendingNotices(ENV, { nowMs: next }));
  const later = outbox(fake).filter((n) => n.dedupe_key.endsWith(':2026110313'));
  assert.equal(later.length, 2);
  assert.ok(later.every((n) => n.body === '확인할 영수증 · 명세표 사진이 3장 있습니다.'));
});

test('확인할 사진 — 기다리는 사진이 없으면 · 직원 · 빠진 구성원에게는 없다', async () => {
  const t = tables({ ledger_documents: [docRow(3, CO, 'posted')] });
  const fake = createFake({ tables: t, nowMs: NOW });
  const out = await withFake(fake, () => runLedgerPendingNotices(ENV, { nowMs: NOW }));
  assert.deepEqual(out, { companies: 1, notified: 0 });
  assert.equal(outbox(fake).length, 0);
});

test(`확인할 사진 — 한 번에 ${PENDING_COMPANY_MAX} 업체까지`, async () => {
  const companies = [];
  const members = [];
  const extractions = [];
  const documents = [];
  for (let i = 1; i <= PENDING_COMPANY_MAX + 5; i++) {
    const id = `c1000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const owner = `a1000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    companies.push({ id, kind: 'partner', status: 'active' });
    members.push(mem(owner, id, 'owner'));
    extractions.push({ id: `x${i}`, company_id: id, status: 'done', finished_at: at(i) });
    documents.push({
      id: `d1000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      company_id: id,
      review_status: 'pending',
    });
  }
  const fake = createFake({
    tables: {
      companies,
      company_members: members,
      ledger_extractions: extractions,
      ledger_documents: documents,
    },
    nowMs: NOW,
  });
  const out = await withFake(fake, () => runLedgerPendingNotices(ENV, { nowMs: NOW }));
  assert.deepEqual(out, { companies: PENDING_COMPANY_MAX, notified: PENDING_COMPANY_MAX });
});

test('확인할 사진 — 읽기 · 넣기가 실패해도 던지지 않는다 (0030 적용 전 거절 포함), 로그에 글 · 사람이 없다', async () => {
  const failRead = createFake({
    tables: tables(),
    nowMs: NOW,
    failDb: (m, p) => (p === 'ledger_extractions' ? 404 : null),
  });
  const a = await withFake(failRead, async (lines) => ({
    out: await runLedgerPendingNotices(ENV, { nowMs: NOW }),
    lines: [...lines],
  }));
  assert.deepEqual(a.out, { companies: 0, notified: 0, skipped: 'read_failed' });

  // 0030 전 — notification_outbox 가 새 종류를 거절한다 (check 위반 400)
  const failInsert = createFake({
    tables: tables(),
    nowMs: NOW,
    failDb: (m, p) => (m === 'POST' && p === 'notification_outbox' ? 400 : null),
  });
  const b = await withFake(failInsert, async (lines) => ({
    out: await runLedgerPendingNotices(ENV, { nowMs: NOW }),
    lines: [...lines],
  }));
  assert.deepEqual(b.out, { companies: 1, notified: 0 });
  assert.ok(
    b.lines.some(
      (l) => l.includes('enqueue failed') && l.includes('ledger_pending') && l.includes('400')
    )
  );
  for (const l of [...a.lines, ...b.lines]) {
    for (const v of [OWNER, MANAGER, '확인할 영수증']) assert.ok(!l.includes(v), l);
  }
});

test('돌려받은 사진 — 올린 사람에게 사진마다 한 번, 돌려보낸 사람 자신 · 빠진 구성원 · 다른 업체 사람은 없다', async () => {
  const fake = createFake({ tables: tables(), nowMs: NOW });
  const doc = { id: D1, company_id: CO, uploaded_by: STAFF, note: '현장 메모' };
  assert.equal(
    await withFake(fake, () => notifyLedgerReturned(ENV, { document: doc, actorId: OWNER })),
    1
  );
  assert.equal(
    await withFake(fake, () => notifyLedgerReturned(ENV, { document: doc, actorId: OWNER })),
    1
  );
  assert.equal(outbox(fake).length, 1);
  const n = outbox(fake)[0];
  assert.deepEqual(
    [n.user_id, n.company_id, n.kind, n.ref_id, n.dedupe_key, n.url],
    [STAFF, CO, 'ledger_returned', D1, `ledger_returned:${D1}:${STAFF}`, LEDGER_URL]
  );
  assert.ok(!JSON.stringify(n).includes('현장 메모'));

  for (const [uploader, actor] of [
    [OWNER, OWNER], // 자기 사진
    [LEFT, OWNER], // 빠진 구성원
    [OTHER, OWNER], // 다른 업체 사람
    [null, OWNER],
  ]) {
    const f = createFake({ tables: tables(), nowMs: NOW });
    const sent = await withFake(f, () =>
      notifyLedgerReturned(ENV, {
        document: { id: D1, company_id: CO, uploaded_by: uploader },
        actorId: actor,
      })
    );
    assert.equal(sent, 0, String(uploader));
    assert.equal(outbox(f).length, 0);
  }
  // 넣기가 실패해도 던지지 않는다
  const failing = createFake({
    tables: tables(),
    nowMs: NOW,
    failDb: (m, p) => (p === 'company_members' ? 500 : null),
  });
  assert.equal(
    await withFake(failing, () => notifyLedgerReturned(ENV, { document: doc, actorId: OWNER })),
    0
  );
});

test('보낼 때 다시 — 확인할 사진은 active 업체의 대표 · 실장만, 돌려받은 사진은 구성원이면', () => {
  assert.deepEqual(MONEY_KINDS, ['ledger_pending']);
  const m = (user_id, role, status = 'active') => ({
    user_id,
    company_id: CO,
    role,
    company: { status },
  });
  const row = (kind, user_id) => ({ kind, user_id, company_id: CO });
  const members = [m(OWNER, 'owner'), m(MANAGER, 'manager'), m(STAFF, 'staff')];
  assert.equal(isEligible(row('ledger_pending', OWNER), members), true);
  assert.equal(isEligible(row('ledger_pending', MANAGER), members), true);
  assert.equal(isEligible(row('ledger_pending', STAFF), members), false);
  assert.equal(isEligible(row('ledger_pending', LEFT), members), false);
  assert.equal(isEligible(row('ledger_pending', OWNER), [m(OWNER, 'owner', 'suspended')]), false);
  assert.equal(isEligible(row('ledger_returned', STAFF), members), true);
  assert.equal(isEligible(row('ledger_returned', LEFT), members), false);
  assert.equal(isEligible(row('ledger_returned', STAFF), [m(STAFF, 'staff', 'suspended')]), false);
});

test('kstHour — 한국 시간 YYYYMMDDHH', () => {
  assert.equal(kstHour(NOW), '2026110312');
  assert.equal(kstHour(Date.parse('2026-11-03T15:00:00Z')), '2026110400');
});
