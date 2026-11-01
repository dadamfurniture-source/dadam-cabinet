/**
 * 앱 알림 — 글 (src/push/messages.js) · 넣기 (src/push/outbox.js) · 기기 등록 길 (src/push/routes.js).
 *
 *   글     종류마다 짧은 한국어, DB 글자 수 안, 열 곳은 /segan/ 안. 수주 번호는 서버 모양(SO-날짜-4자)일 때만
 *   넣기   dedupe_key 충돌은 조용히 넘긴다 · 모양이 틀리면 넣지 않는다 · 실패해도 던지지 않는다(로그에 글 · 사람 없음)
 *          notifyRoles — 넣는 때의 active 구성원을 역할로 (한 사람 한 줄), 더 받을 사람은 그 업체 구성원일 때만
 *   길     GET /push/key · POST /push/subscriptions (구성원 → 업체, 신청 중 → 업체 없음, 그 밖 403 no_company,
 *          알려진 푸시 서비스만 · 키 모양 422, 같은 기기는 다시 묶기) · DELETE (내 것만, 204)
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  buildMessage,
  safeOrderNo,
  isValidMessage,
  NOTIFICATION_KINDS,
  PARTNER_URL,
  TITLE_MAX,
  BODY_MAX,
  charLen,
} from '../src/push/messages.js';
import { enqueueNotification, enqueueNotifications, notifyRoles, dedupeKeyOf } from '../src/push/outbox.js';
import { b64urlEncode } from '../src/push/webpush.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  CORS_ORIGINS: 'https://dadamfurniture.com',
  VAPID_PUBLIC_KEY: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
};

const U = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  manager: 'a0000000-0000-4000-8000-000000000002',
  staff: 'a0000000-0000-4000-8000-000000000003',
  hq: 'a0000000-0000-4000-8000-000000000004',
  suspOwner: 'a0000000-0000-4000-8000-000000000005',
  suspStaff: 'a0000000-0000-4000-8000-000000000006',
  applicant: 'a0000000-0000-4000-8000-000000000007',
  usedApp: 'a0000000-0000-4000-8000-000000000008',
  nobody: 'a0000000-0000-4000-8000-000000000009',
  left: 'a0000000-0000-4000-8000-00000000000a',
  closedOwner: 'a0000000-0000-4000-8000-00000000000b',
};
const CO = {
  hq: 'c0000000-0000-4000-8000-000000000001',
  partner: 'c0000000-0000-4000-8000-000000000002',
  susp: 'c0000000-0000-4000-8000-000000000003',
  closed: 'c0000000-0000-4000-8000-000000000004',
};
const REF = 'e0000000-0000-4000-8000-000000000001';

function tables() {
  const mem = (user_id, company_id, role, status = 'active') => ({ id: `m-${user_id}`, user_id, company_id, role, status });
  return {
    companies: [
      { id: CO.hq, kind: 'hq', status: 'active' },
      { id: CO.partner, kind: 'partner', status: 'active' },
      { id: CO.susp, kind: 'partner', status: 'suspended' },
      { id: CO.closed, kind: 'partner', status: 'closed' },
    ],
    company_members: [
      mem(U.owner, CO.partner, 'owner'),
      mem(U.manager, CO.partner, 'manager'),
      mem(U.staff, CO.partner, 'staff'),
      mem(U.hq, CO.hq, 'staff'),
      mem(U.suspOwner, CO.susp, 'owner'),
      mem(U.suspStaff, CO.susp, 'staff'),
      mem(U.left, CO.partner, 'staff', 'removed'),
      mem(U.closedOwner, CO.closed, 'owner'),
    ],
    partner_applications: [
      { id: 'p1', user_id: U.applicant, status: 'meeting', used_at: null },
      { id: 'p2', user_id: U.usedApp, status: 'approved', used_at: '2026-10-01T00:00:00Z' },
      { id: 'p3', user_id: U.nobody, status: 'held', used_at: null },
      { id: 'p4', user_id: U.closedOwner, status: 'withdrawn', used_at: null },
    ],
  };
}

const USERS = Object.fromEntries(Object.entries(U).map(([k, id]) => [`t-${k}`, { id, email: `${k}@example.test` }]));

// ── 글 ────────────────────────────────────────────────

// 가짜 고객 정보 — 알림 글 어디에도 나오면 안 된다
const PII = ['홍길동', '010-1234-5678', '서울시 강남구', '12,345,000', '홍길동네 거실 붙박이장'];

test('글 — 종류마다 제목 · 본문 · 열 곳, DB 글자 수 안, /segan/ 안', () => {
  const cases = [
    ['order_request', { eventKind: 'revive', orderNo: 'SO-20261029-A1B2' }, '승인 요청', '수주 SO-20261029-A1B2 되살리기 요청이 왔습니다. 확인해 주세요.'],
    ['order_request', { eventKind: 'revert', orderNo: null }, '승인 요청', '수주 완료 되돌리기 요청이 왔습니다. 확인해 주세요.'],
    ['order_request_decided', { eventKind: 'revive', orderNo: 'SO-20261029-A1B2', approved: true }, '요청 결과', '수주 SO-20261029-A1B2 되살리기 요청이 승인되었습니다.'],
    ['order_request_decided', { eventKind: 'revert', approved: false }, '요청 결과', '수주 완료 되돌리기 요청이 반려되었습니다.'],
    ['confirmation_decided', { approved: true }, '고객 확인서', '고객이 확인서를 승인했습니다.'],
    ['confirmation_decided', { approved: false }, '고객 확인서', '고객이 확인서를 반려했습니다. 수정 요청을 확인해 주세요.'],
    ['partner_application', { status: 'meeting' }, '업체 신청', '업체 신청 미팅이 잡혔습니다. 내 정보에서 일정을 확인해 주세요.'],
    ['partner_application', { status: 'meeting', rescheduled: true }, '업체 신청', '업체 신청 미팅 일정이 바뀌었습니다. 내 정보에서 확인해 주세요.'],
    ['partner_application', { status: 'approved' }, '업체 신청', '업체 신청이 승인되었습니다. 내 정보에서 다음 단계를 확인해 주세요.'],
    ['partner_application', { status: 'approved', upgrade: true }, '업체 신청', 'Agent 등급 신청이 승인되었습니다. 다음 결제일부터 바뀝니다.'],
    ['partner_application', { status: 'held' }, '업체 신청', '업체 신청이 보류되었습니다. 내 정보에서 확인해 주세요.'],
    ['billing_failed', {}, '결제 실패', '업체 구독 결제가 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.'],
    ['company_suspended', {}, '업체 정지', '결제가 되지 않아 업체가 정지되었습니다. 결제 관리에서 확인해 주세요.'],
  ];
  for (const [kind, params, title, body] of cases) {
    const m = buildMessage(kind, params);
    assert.deepEqual(m, { title, body, url: PARTNER_URL }, `${kind} ${JSON.stringify(params)}`);
    assert.ok(isValidMessage(m));
    assert.ok(charLen(m.title) <= TITLE_MAX && charLen(m.body) <= BODY_MAX);
    for (const v of PII) assert.ok(!m.body.includes(v) && !m.title.includes(v));
  }
  assert.equal(PARTNER_URL, '/segan/me.html#partner');
  assert.deepEqual(NOTIFICATION_KINDS, [
    'order_request',
    'order_request_decided',
    'confirmation_decided',
    'partner_application',
    'billing_failed',
    'company_suspended',
    'consult_assigned',
    'work_invited',
    'work_registration',
    'work_assigned',
    'work_schedule',
  ]);
});

test('글 — 고객 이름 · 설계 제목 같은 값은 받지 않는다. 모르는 종류 · 값은 null', () => {
  const m = buildMessage('confirmation_decided', { approved: true, title: PII[4], customerName: PII[0], amount: 12345000 });
  assert.equal(m.body, '고객이 확인서를 승인했습니다.');
  assert.equal(buildMessage('order_request', { eventKind: 'status' }), null);
  assert.equal(buildMessage('order_request_decided', { eventKind: 'revive' }), null);
  assert.equal(buildMessage('partner_application', { status: 'withdrawn' }), null);
  assert.equal(buildMessage('confirmation_decided', {}), null);
  assert.equal(buildMessage('nope', {}), null);
  assert.equal(buildMessage('toString', {}), null);
  // 새 상담 배정은 품목 · 시/군/구가 없어도 글이 있다 (test/distribution-rules.test.js)
  assert.equal(buildMessage('consult_assigned', { name: PII[0] }).body.includes(PII[0]), false);
});

test('수주 번호 — 서버 모양(SO-YYYYMMDD-XXXX)만 싣는다', () => {
  assert.equal(safeOrderNo('SO-20261029-A1B2'), 'SO-20261029-A1B2');
  for (const bad of ['SO-20261029-a1b2', '홍길동 SO-20261029-A1B2', 'SO-2026-A1B2', 'SO-20261029-A1B2 ', '', null, 7]) {
    assert.equal(safeOrderNo(bad), null, String(bad));
  }
  assert.equal(
    buildMessage('order_request', { eventKind: 'revive', orderNo: '홍길동-010-1234-5678' }).body,
    '수주 되살리기 요청이 왔습니다. 확인해 주세요.',
  );
});

test('글 확인 — 길이 · 열 곳', () => {
  const ok = { title: 'a', body: 'b', url: '/segan/me.html' };
  assert.equal(isValidMessage(ok), true);
  assert.equal(isValidMessage({ ...ok, title: '가'.repeat(60) }), true);
  assert.equal(isValidMessage({ ...ok, title: '가'.repeat(61) }), false);
  assert.equal(isValidMessage({ ...ok, body: '😀'.repeat(160) }), true, '코드 포인트로 센다');
  assert.equal(isValidMessage({ ...ok, body: '😀'.repeat(161) }), false);
  assert.equal(isValidMessage({ ...ok, title: '' }), false);
  assert.equal(isValidMessage({ ...ok, url: 'https://evil.test/segan/' }), false);
  assert.equal(isValidMessage({ ...ok, url: '/erp.html' }), false);
  assert.equal(isValidMessage({ ...ok, url: `/segan/${'a'.repeat(300)}` }), false);
});

// ── 넣기 ──────────────────────────────────────────────

const msg = (kind, params) => buildMessage(kind, params);

test('넣기 — on_conflict=dedupe_key · ignore-duplicates · return=minimal, 같은 키는 한 번만', async () => {
  const fake = createFake({ tables: tables() });
  await withFake(fake, async (lines) => {
    const n = {
      userId: U.owner,
      companyId: CO.partner,
      kind: 'billing_failed',
      ...msg('billing_failed', {}),
      refId: REF,
      dedupeKey: dedupeKeyOf('billing_failed', REF, U.owner, 'past_due'),
    };
    assert.equal(await enqueueNotification(ENV, n), true);
    assert.equal(await enqueueNotification(ENV, n), true);
    assert.equal(fake.db.notification_outbox.length, 1);
    const call = fake.calls.rest.find((c) => c.method === 'POST');
    assert.equal(call.path, 'notification_outbox');
    assert.equal(call.query, '?on_conflict=dedupe_key');
    assert.match(call.prefer, /resolution=ignore-duplicates/);
    assert.match(call.prefer, /return=minimal/);
    assert.deepEqual(fake.db.notification_outbox[0], {
      ...fake.db.notification_outbox[0],
      user_id: U.owner,
      company_id: CO.partner,
      kind: 'billing_failed',
      ref_id: REF,
      dedupe_key: `billing_failed:${REF}:${U.owner}:past_due`,
      state: 'queued',
    });
    assert.deepEqual(lines, []);
  });
});

test('넣기 — 모양이 틀리면 넣지 않고 종류만 경고 (업체 없는 줄은 업체 신청만, uuid, 글 길이)', async () => {
  const fake = createFake({ tables: tables() });
  await withFake(fake, async (lines) => {
    const base = { userId: U.owner, companyId: CO.partner, kind: 'billing_failed', ...msg('billing_failed', {}) };
    const bad = [
      { ...base, kind: 'party' },
      { ...base, userId: 'me' },
      { ...base, companyId: null },
      { ...base, companyId: 'x' },
      { ...base, refId: 'order-1' },
      { ...base, title: '가'.repeat(61) },
      { ...base, body: '' },
      { ...base, url: 'https://evil.test/' },
      { ...base, dedupeKey: 'k'.repeat(201) },
      null,
    ];
    for (const n of bad) assert.equal(await enqueueNotification(ENV, n), false);
    assert.equal(fake.calls.rest.length, 0);
    assert.equal(lines.length, bad.length);
    for (const l of lines) assert.match(l, /^warn: \[push\] enqueue skipped: invalid (billing_failed|party|\?)$/);
    // 업체 신청은 업체 없이 된다
    assert.equal(
      await enqueueNotification(ENV, { userId: U.applicant, companyId: null, kind: 'partner_application', ...msg('partner_application', { status: 'held' }) }),
      true,
    );
    assert.equal(fake.db.notification_outbox[0].company_id, null);
  });
});

test('넣기 — DB 가 실패해도 던지지 않는다. 로그는 종류 · 상태 코드만', async () => {
  const fake = createFake({ tables: tables(), failDb: (m, t) => (t === 'notification_outbox' ? 503 : 0) });
  await withFake(fake, async (lines) => {
    const m = msg('confirmation_decided', { approved: false });
    const ok = await enqueueNotifications(ENV, [{ userId: U.owner, companyId: CO.partner, kind: 'confirmation_decided', ...m }]);
    assert.equal(ok, 0);
    assert.deepEqual(lines, ['warn: [push] enqueue failed: confirmation_decided 503']);
    assert.ok(!lines.join('').includes(m.body) && !lines.join('').includes(U.owner));
  });
});

test('notifyRoles — 넣는 때의 active 구성원을 역할로, 한 사람 한 줄. 더 받을 사람은 그 업체 구성원만 · 뺄 사람은 뺀다', async () => {
  const fake = createFake({ tables: tables() });
  await withFake(fake, async () => {
    const m = msg('confirmation_decided', { approved: true });
    const sent = await notifyRoles(ENV, {
      companyId: CO.partner,
      roles: ['owner', 'manager'],
      userIds: [U.staff, U.owner, U.hq, U.left, 'nope'],
      kind: 'confirmation_decided',
      ...m,
      refId: REF,
      dedupeSuffix: 'approved',
    });
    assert.equal(sent, 3);
    const rows = fake.db.notification_outbox;
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [U.owner, U.manager, U.staff].sort());
    for (const r of rows) {
      assert.equal(r.company_id, CO.partner);
      assert.equal(r.dedupe_key, `confirmation_decided:${REF}:${r.user_id}:approved`);
      assert.equal(r.title, '고객 확인서');
    }
    // 같은 일 다시 → 넘긴다
    await notifyRoles(ENV, { companyId: CO.partner, roles: ['owner', 'manager'], kind: 'confirmation_decided', ...m, refId: REF, dedupeSuffix: 'approved' });
    assert.equal(fake.db.notification_outbox.length, 3);
    // 뺄 사람
    const n = await notifyRoles(ENV, {
      companyId: CO.partner,
      roles: ['owner'],
      excludeUserIds: [U.owner],
      kind: 'order_request',
      ...msg('order_request', { eventKind: 'revive' }),
      refId: REF,
    });
    assert.equal(n, 0);
  });
});

test('notifyRoles — 업체 id 가 없거나 구성원을 못 읽으면 0, 던지지 않는다', async () => {
  const fake = createFake({ tables: tables(), failDb: (m, t) => (t === 'company_members' ? 500 : 0) });
  await withFake(fake, async (lines) => {
    const m = msg('billing_failed', {});
    assert.equal(await notifyRoles(ENV, { companyId: null, roles: ['owner'], kind: 'billing_failed', ...m }), 0);
    assert.equal(await notifyRoles(ENV, { companyId: CO.partner, roles: ['owner'], kind: 'billing_failed', ...m }), 0);
    assert.deepEqual(lines, ['warn: [push] notifyRoles skipped: no company billing_failed', 'warn: [push] notifyRoles failed: billing_failed 500']);
  });
});

test('dedupe 키 — kind:ref:user[:덧붙임], ref 가 없으면 null', () => {
  assert.equal(dedupeKeyOf('order_request', REF, U.owner), `order_request:${REF}:${U.owner}`);
  assert.equal(dedupeKeyOf('order_request', REF, U.owner, 'x'), `order_request:${REF}:${U.owner}:x`);
  assert.equal(dedupeKeyOf('order_request', null, U.owner), null);
  assert.equal(dedupeKeyOf('order_request', REF, U.owner, 'x'.repeat(200)), null);
});

// ── 길 ────────────────────────────────────────────────

async function makeKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const FCM = 'https://fcm.googleapis.com/fcm/send/dXk1:APA91bE-fake';

function req(method, path, who, body) {
  const headers = { Origin: 'https://dadamfurniture.com' };
  if (who) headers.Authorization = `Bearer t-${who}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://workflow.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(fake, method, path, who, body, env = ENV) {
  return withFake(fake, async (lines) => {
    const res = await worker.fetch(req(method, path, who, body), env, { waitUntil() {} });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, text, headers: res.headers, lines };
  });
}

test('GET /push/key — 로그인 없이 공개 키. 설정이 없으면 503 not_configured', async () => {
  const fake = createFake();
  const r = await call(fake, 'GET', '/push/key');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true, data: { key: ENV.VAPID_PUBLIC_KEY } });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://dadamfurniture.com');
  assert.equal(fake.calls.auth, 0);
  const none = await call(fake, 'GET', '/push/key', null, undefined, { ...ENV, VAPID_PUBLIC_KEY: '' });
  assert.equal(none.status, 503);
  assert.equal(none.json.code, 'not_configured');
});

test('POST /push/subscriptions — 업체 구성원은 그 업체로 (본사 포함, 역할 무관). 201 { id }', async () => {
  const keys = await makeKeys();
  for (const [who, company] of [
    ['owner', CO.partner],
    ['staff', CO.partner],
    ['hq', CO.hq],
    ['suspOwner', CO.susp],
  ]) {
    const fake = createFake({ tables: tables(), users: USERS });
    const r = await call(fake, 'POST', '/push/subscriptions', who, { endpoint: FCM, keys, user_agent: '  Mozilla/5.0  ' });
    assert.equal(r.status, 201, who);
    assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
    const row = fake.db.push_subscriptions[0];
    assert.deepEqual(r.json, { success: true, data: { id: row.id } });
    assert.equal(row.user_id, U[who]);
    assert.equal(row.company_id, company);
    assert.equal(row.endpoint, FCM);
    assert.equal(row.p256dh, keys.p256dh);
    assert.equal(row.auth, keys.auth);
    assert.equal(row.user_agent, 'Mozilla/5.0');
    assert.deepEqual(r.lines, []);
  }
});

test('POST /push/subscriptions — 업체 없이 신청 중이면 업체 없음. 정지 업체 직원 · 닫힌 업체 · 나간 사람 · 끝난 신청은 403 no_company', async () => {
  const keys = await makeKeys();
  let fake = createFake({ tables: tables(), users: USERS });
  let r = await call(fake, 'POST', '/push/subscriptions', 'applicant', { endpoint: FCM, keys });
  assert.equal(r.status, 201);
  assert.equal(fake.db.push_subscriptions[0].company_id, null);
  assert.equal(fake.db.push_subscriptions[0].user_agent, null);
  for (const who of ['suspStaff', 'closedOwner', 'left', 'usedApp', 'nobody']) {
    fake = createFake({ tables: tables(), users: USERS });
    r = await call(fake, 'POST', '/push/subscriptions', who, { endpoint: FCM, keys });
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, 'no_company');
    assert.equal(r.json.success, false);
    assert.equal(fake.db.push_subscriptions.length, 0);
  }
  // 승인됐지만 아직 안 쓴 신청은 열린 신청
  const t = tables();
  t.partner_applications.push({ id: 'p5', user_id: U.nobody, status: 'approved', used_at: null });
  fake = createFake({ tables: t, users: USERS });
  r = await call(fake, 'POST', '/push/subscriptions', 'nobody', { endpoint: FCM, keys });
  assert.equal(r.status, 201);
});

test('POST /push/subscriptions — 작업자(대기 · 승인 · 정지)는 업체 없는 기기로, 반려된 작업자는 403 no_company', async () => {
  const keys = await makeKeys();
  for (const [status, want] of [['pending', 201], ['approved', 201], ['suspended', 201], ['rejected', 403]]) {
    const t = tables();
    t.workers = [{ id: 'w-' + status, user_id: U.nobody, status }];
    const fake = createFake({ tables: t, users: USERS });
    const r = await call(fake, 'POST', '/push/subscriptions', 'nobody', { endpoint: FCM, keys });
    assert.equal(r.status, want, status);
    if (want === 201) assert.equal(fake.db.push_subscriptions[0].company_id, null, status);
    else assert.equal(r.json.code, 'no_company');
  }
});

test('POST /push/subscriptions — 로그인 없으면 401, 모르는 주소 422 invalid_endpoint · 키 모양 422 invalid_keys (DB 를 보지 않는다)', async () => {
  const keys = await makeKeys();
  const fake = createFake({ tables: tables(), users: USERS });
  assert.equal((await call(fake, 'POST', '/push/subscriptions', null, { endpoint: FCM, keys })).status, 401);
  for (const endpoint of ['https://evil.test/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 42, undefined]) {
    const r = await call(fake, 'POST', '/push/subscriptions', 'owner', { endpoint, keys });
    assert.equal(r.status, 422, String(endpoint));
    assert.equal(r.json.code, 'invalid_endpoint');
    assert.ok(!r.text.includes('evil.test'), '응답에 주소를 싣지 않는다');
  }
  for (const k of [{}, { p256dh: keys.p256dh }, { ...keys, auth: 'AAAA' }, { ...keys, p256dh: keys.p256dh.slice(4) }, { ...keys, p256dh: 'x'.repeat(201) }]) {
    const r = await call(fake, 'POST', '/push/subscriptions', 'owner', { endpoint: FCM, keys: k });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'invalid_keys');
  }
  assert.equal((await call(fake, 'POST', '/push/subscriptions', 'owner', 'not json')).status, 422);
  assert.equal((await call(fake, 'POST', '/push/subscriptions', 'owner', [1])).status, 422);
  assert.equal(fake.calls.rest.length, 0);
});

test('POST /push/subscriptions — 같은 기기는 한 줄: 다시 등록하면 사람 · 업체 · 키를 새로 묶고 실패 횟수를 지운다', async () => {
  const k1 = await makeKeys();
  const k2 = await makeKeys();
  const t = tables();
  t.push_subscriptions = [
    { id: 'old', user_id: U.owner, company_id: CO.partner, endpoint: FCM, p256dh: k1.p256dh, auth: k1.auth, fail_count: 4, user_agent: 'old', created_at: '2026-10-01T00:00:00Z' },
  ];
  const fake = createFake({ tables: t, users: USERS });
  const r = await call(fake, 'POST', '/push/subscriptions', 'applicant', { endpoint: FCM, keys: k2, user_agent: 'x'.repeat(400) });
  assert.equal(r.status, 201);
  assert.equal(fake.db.push_subscriptions.length, 1);
  const row = fake.db.push_subscriptions[0];
  assert.equal(r.json.data.id, 'old');
  assert.equal(row.user_id, U.applicant);
  assert.equal(row.company_id, null);
  assert.equal(row.p256dh, k2.p256dh);
  assert.equal(row.fail_count, 0);
  assert.equal(row.user_agent.length, 300);
  assert.equal(row.created_at, '2026-10-01T00:00:00Z');
  const post = fake.calls.rest.find((c) => c.method === 'POST');
  assert.equal(post.query, '?on_conflict=endpoint');
  assert.match(post.prefer, /resolution=merge-duplicates/);
});

test('DELETE /push/subscriptions — 내 등록 중 그 주소만 지운다, 204 본문 없음. 없어도 204', async () => {
  const k = await makeKeys();
  const OTHER = 'https://web.push.apple.com/QGfake';
  const t = tables();
  t.push_subscriptions = [
    { id: 's1', user_id: U.owner, company_id: CO.partner, endpoint: FCM, ...k },
    { id: 's2', user_id: U.owner, company_id: CO.partner, endpoint: OTHER, ...k },
    { id: 's3', user_id: U.staff, company_id: CO.partner, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', ...k },
  ];
  const fake = createFake({ tables: t, users: USERS });
  // 남의 주소는 지우지 않는다
  let r = await call(fake, 'DELETE', '/push/subscriptions', 'staff', { endpoint: FCM });
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  assert.equal(fake.db.push_subscriptions.length, 3);
  r = await call(fake, 'DELETE', '/push/subscriptions', 'owner', { endpoint: FCM });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://dadamfurniture.com');
  assert.deepEqual(fake.db.push_subscriptions.map((s) => s.id), ['s2', 's3']);
  assert.equal((await call(fake, 'DELETE', '/push/subscriptions', 'owner', { endpoint: FCM })).status, 204);
  assert.equal((await call(fake, 'DELETE', '/push/subscriptions', 'owner', {})).status, 422);
  assert.equal((await call(fake, 'DELETE', '/push/subscriptions', null, { endpoint: FCM })).status, 401);
});
