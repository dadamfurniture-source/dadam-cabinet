/**
 * 앱 알림 보내기 (src/push/sender.js · 1분 cron).
 *
 *   - 잡기: claim_notifications(50) 한 번. VAPID 설정이 없으면 잡지 않는다
 *   - 보낼 때 다시 본다: 그 업체의 active 구성원 + 업체 active. 결제 실패 · 업체 정지는 정지된 업체의 active 대표에게도.
 *     업체 없는 업체 신청은 그 사람의 업체 없는 기기로만
 *   - 그 사람 · 그 업체의 기기 모두에 보낸다. 404 · 410 은 기기 등록을 지운다
 *   - 하나라도 받으면 sent(sent_at) · 받을 기기 없음 · 받을 사람 아님은 skipped · 모두 실패면 queued(5분 뒤 다시),
 *     5번째 실패는 failed (짧은 last_error — 주소 없음). 기기 last_sent_at · fail_count
 *   - 보낸 글은 기기에서 풀면 { title, body, url, tag }
 *   - 로그 · last_error 에 받는 주소 · 글 · 받는 사람이 없다
 *   - 하루 한 번 정리: 30일 지난 끝난 줄 지우기 · 멈춘 줄 failed
 *   - scheduled(): 1분 cron 은 보내기만 (정리 시각이면 정리도), 다른 cron 은 그대로
 * 시험 데이터 · 키는 모두 가짜다.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  runPushSender,
  runPushCleanup,
  isPushCleanupTime,
  isEligible,
  targetsFor,
  payloadOf,
  classify,
  PUSH_SEND_CRON,
  CLAIM_LIMIT,
} from '../src/push/sender.js';
import { b64urlEncode, b64urlDecode, clearVapidCache } from '../src/push/webpush.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const NOW = Date.parse('2026-10-29T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const U = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  staff: 'a0000000-0000-4000-8000-000000000002',
  suspOwner: 'a0000000-0000-4000-8000-000000000003',
  suspStaff: 'a0000000-0000-4000-8000-000000000004',
  applicant: 'a0000000-0000-4000-8000-000000000005',
  left: 'a0000000-0000-4000-8000-000000000006',
};
const CO = {
  partner: 'c0000000-0000-4000-8000-000000000002',
  susp: 'c0000000-0000-4000-8000-000000000003',
  other: 'c0000000-0000-4000-8000-000000000004',
};
const REF = 'e0000000-0000-4000-8000-000000000001';

const EP = {
  ownerA: 'https://fcm.googleapis.com/fcm/send/owner-a',
  ownerB: 'https://web.push.apple.com/owner-b',
  ownerOld: 'https://fcm.googleapis.com/fcm/send/owner-old',
  ownerNull: 'https://updates.push.services.mozilla.com/wpush/v2/owner-null',
  staff: 'https://fcm.googleapis.com/fcm/send/staff',
  suspOwner: 'https://fcm.googleapis.com/fcm/send/susp-owner',
  suspStaff: 'https://fcm.googleapis.com/fcm/send/susp-staff',
  applicant: 'https://wns2-par02p.notify.windows.com/w/?token=applicant',
  applicantCo: 'https://fcm.googleapis.com/fcm/send/applicant-co',
  left: 'https://fcm.googleapis.com/fcm/send/left',
};

// 가짜 고객 정보 — 로그에 나오면 안 된다 (글 자체에도 넣지 않지만, 넣었더라도 로그에는 없어야 한다)
const SECRET_BODY = '홍길동 010-1234-5678';

let VAPID_ENV;
const DEVICES = {};

async function setup() {
  if (VAPID_ENV) return;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  VAPID_ENV = {
    SUPABASE_URL: SB,
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    VAPID_PUBLIC_KEY: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    VAPID_SUBJECT: 'https://dadamfurniture.com',
  };
  for (const [name, endpoint] of Object.entries(EP)) {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    DEVICES[name] = { endpoint, ua, raw, auth, p256dh: b64urlEncode(raw), authB64: b64urlEncode(auth) };
  }
}

before(setup);

const sub = (id, name, user_id, company_id, extra = {}) => ({
  id,
  user_id,
  company_id,
  endpoint: DEVICES[name].endpoint,
  p256dh: DEVICES[name].p256dh,
  auth: DEVICES[name].authB64,
  fail_count: 0,
  last_sent_at: null,
  ...extra,
});

function baseTables() {
  const mem = (user_id, company_id, role, status = 'active') => ({ id: `m-${user_id}`, user_id, company_id, role, status });
  return {
    companies: [
      { id: CO.partner, status: 'active' },
      { id: CO.susp, status: 'suspended' },
      { id: CO.other, status: 'active' },
    ],
    company_members: [
      mem(U.owner, CO.partner, 'owner'),
      mem(U.staff, CO.partner, 'staff'),
      mem(U.suspOwner, CO.susp, 'owner'),
      mem(U.suspStaff, CO.susp, 'staff'),
      mem(U.left, CO.partner, 'staff', 'removed'),
    ],
    push_subscriptions: [
      sub('s-owner-a', 'ownerA', U.owner, CO.partner),
      sub('s-owner-b', 'ownerB', U.owner, CO.partner),
      sub('s-owner-old', 'ownerOld', U.owner, CO.other),
      sub('s-owner-null', 'ownerNull', U.owner, null),
      sub('s-staff', 'staff', U.staff, CO.partner, { fail_count: 2 }),
      sub('s-susp-owner', 'suspOwner', U.suspOwner, CO.susp),
      sub('s-susp-staff', 'suspStaff', U.suspStaff, CO.susp),
      sub('s-applicant', 'applicant', U.applicant, null),
      sub('s-applicant-co', 'applicantCo', U.applicant, CO.other),
      sub('s-left', 'left', U.left, CO.partner),
    ],
    notification_outbox: [],
  };
}

let rowSeq = 0;
function outbox(user_id, company_id, kind, extra = {}) {
  rowSeq += 1;
  return {
    id: `o0000000-0000-4000-8000-${String(rowSeq).padStart(12, '0')}`,
    user_id,
    company_id,
    kind,
    title: '업체 신청',
    body: '업체 신청이 보류되었습니다. 내 정보에서 확인해 주세요.',
    url: '/segan/me.html#partner',
    ref_id: REF,
    dedupe_key: null,
    state: 'queued',
    attempts: 0,
    send_after: iso(NOW - 60_000),
    claimed_at: null,
    sent_at: null,
    last_error: null,
    created_at: iso(NOW - 60_000 + rowSeq),
    ...extra,
  };
}

async function run(t, opts = {}) {
  await setup();
  clearVapidCache();
  const fake = createFake({ tables: t, nowMs: NOW, ...opts });
  const { out, lines } = await withFake(fake, async (lines) => ({ out: await runPushSender(opts.env || VAPID_ENV, { nowMs: NOW }), lines }));
  return { fake, out, lines };
}

const pushedTo = (fake) => fake.calls.push.map((c) => c.endpoint).sort();
const row = (fake, id) => fake.db.notification_outbox.find((r) => r.id === id);

function assertQuietLogs(lines) {
  const all = lines.join('\n');
  for (const ep of Object.values(EP)) assert.ok(!all.includes(ep), '받는 주소가 로그에 없다');
  for (const u of Object.values(U)) assert.ok(!all.includes(u), '받는 사람이 로그에 없다');
  assert.ok(!all.includes(SECRET_BODY));
  assert.ok(!all.includes('보류되었습니다'));
}

// ── 판정 (순수) ─────────────────────────────────────────

test('판정 — 업체 active 구성원 · 정지 업체는 결제 실패 · 정지 알림만 대표에게 · 업체 없는 신청은 그대로', () => {
  const ms = [
    { user_id: U.owner, company_id: CO.partner, role: 'owner', company: { status: 'active' } },
    { user_id: U.staff, company_id: CO.partner, role: 'staff', company: { status: 'active' } },
    { user_id: U.suspOwner, company_id: CO.susp, role: 'owner', company: { status: 'suspended' } },
    { user_id: U.suspStaff, company_id: CO.susp, role: 'staff', company: { status: 'suspended' } },
  ];
  const r = (user_id, company_id, kind) => ({ user_id, company_id, kind });
  assert.equal(isEligible(r(U.owner, CO.partner, 'order_request'), ms), true);
  assert.equal(isEligible(r(U.staff, CO.partner, 'confirmation_decided'), ms), true);
  assert.equal(isEligible(r(U.owner, CO.other, 'order_request'), ms), false, '다른 업체');
  assert.equal(isEligible(r(U.left, CO.partner, 'order_request'), ms), false, '나간 사람');
  assert.equal(isEligible(r(U.suspOwner, CO.susp, 'order_request'), ms), false, '정지 업체의 보통 알림');
  assert.equal(isEligible(r(U.suspOwner, CO.susp, 'billing_failed'), ms), true);
  assert.equal(isEligible(r(U.suspOwner, CO.susp, 'company_suspended'), ms), true);
  assert.equal(isEligible(r(U.suspStaff, CO.susp, 'company_suspended'), ms), false, '정지 업체 직원');
  assert.equal(isEligible(r(U.staff, CO.partner, 'billing_failed'), ms), false, '결제 알림은 대표만');
  assert.equal(isEligible(r(U.applicant, null, 'partner_application'), ms), true);
  assert.equal(isEligible(r(U.owner, CO.partner, 'partner_application'), ms), true, 'upgrade 신청은 그 업체 구성원');
  assert.equal(isEligible(r(U.applicant, CO.partner, 'partner_application'), ms), false);
  const closed = [{ user_id: U.owner, company_id: CO.partner, role: 'owner', company: { status: 'closed' } }];
  assert.equal(isEligible(r(U.owner, CO.partner, 'billing_failed'), closed), false);
});

test('받을 기기 · 보낼 글 · 결과 나누기', () => {
  const subs = [
    { id: 1, user_id: U.owner, company_id: CO.partner },
    { id: 2, user_id: U.owner, company_id: null },
    { id: 3, user_id: U.staff, company_id: CO.partner },
  ];
  assert.deepEqual(targetsFor({ user_id: U.owner, company_id: CO.partner }, subs).map((s) => s.id), [1]);
  assert.deepEqual(targetsFor({ user_id: U.owner, company_id: null }, subs).map((s) => s.id), [2]);
  assert.deepEqual(payloadOf({ id: 'x', kind: 'billing_failed', ref_id: REF, title: 't', body: 'b', url: '/segan/me.html', user_id: U.owner }), {
    title: 't',
    body: 'b',
    url: '/segan/me.html',
    tag: `billing_failed:${REF}`,
  });
  assert.equal(payloadOf({ id: 'x', kind: 'company_suspended', ref_id: null }).tag, 'company_suspended:x');
  assert.equal(classify({ status: 201 }), 'ok');
  assert.equal(classify({ status: 404 }), 'gone');
  assert.equal(classify({ status: 410 }), 'gone');
  assert.equal(classify({ status: 0, error: 'bad_key' }), 'gone');
  assert.equal(classify({ status: 0, error: 'network' }), 'fail');
  assert.equal(classify({ status: 429 }), 'fail');
  assert.equal(classify({ status: 500 }), 'fail');
  assert.equal(classify({ status: 302 }), 'fail');
});

// ── 보내기 ────────────────────────────────────────────

async function decrypt(device, body) {
  const b = new Uint8Array(body);
  const salt = b.slice(0, 16);
  const asPublic = b.slice(21, 86);
  const ct = b.slice(86);
  const enc = new TextEncoder();
  const hmac = async (key, data) =>
    new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
  const cat = (...a) => {
    const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
    let i = 0;
    for (const x of a) {
      o.set(x, i);
      i += x.length;
    }
    return o;
  };
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.ua.privateKey, 256));
  const ikm = await hmac(await hmac(device.auth, ecdh), cat(enc.encode('WebPush: info\0'), device.raw, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

test('보내기 — 그 사람 · 그 업체 기기 모두에, 하나라도 받으면 sent. 기기 last_sent_at · fail_count 0, 글은 기기에서 풀린다', async () => {
  const t = baseTables();
  const o = outbox(U.owner, CO.partner, 'order_request', {
    title: '승인 요청',
    body: '수주 SO-20261029-A1B2 되살리기 요청이 왔습니다. 확인해 주세요.',
  });
  t.notification_outbox.push(o);
  const { fake, out, lines } = await run(t);
  assert.deepEqual(out, { claimed: 1, sent: 1, skipped: 0, retry: 0, failed: 0, gone: 0, errors: 0 });
  assert.deepEqual(pushedTo(fake), [EP.ownerA, EP.ownerB].sort(), '다른 업체 · 업체 없는 기기에는 보내지 않는다');
  const r = row(fake, o.id);
  assert.equal(r.state, 'sent');
  assert.equal(r.sent_at, iso(NOW));
  assert.equal(r.attempts, 1);
  assert.equal(r.last_error, null);
  for (const id of ['s-owner-a', 's-owner-b']) {
    const s = fake.db.push_subscriptions.find((x) => x.id === id);
    assert.equal(s.last_sent_at, iso(NOW));
    assert.equal(s.fail_count, 0);
  }
  assert.equal(fake.db.push_subscriptions.find((x) => x.id === 's-owner-old').last_sent_at, null);
  const call = fake.calls.push.find((c) => c.endpoint === EP.ownerA);
  assert.deepEqual(await decrypt(DEVICES.ownerA, call.init.body), {
    title: '승인 요청',
    body: '수주 SO-20261029-A1B2 되살리기 요청이 왔습니다. 확인해 주세요.',
    url: '/segan/me.html#partner',
    tag: `order_request:${REF}`,
  });
  assert.equal(call.init.headers.TTL, '86400');
  assert.match(call.init.headers.Authorization, /^vapid t=.+, k=/);
  // 잡기는 한 번, 50 줄
  const claims = fake.calls.rest.filter((c) => c.path === 'rpc/claim_notifications');
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].body, { p_limit: CLAIM_LIMIT });
  assert.equal(CLAIM_LIMIT, 50);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^log: \[push\] sender \{"claimed":1,"sent":1/);
  assertQuietLogs(lines);
});

test('보내기 — 404 · 410 은 기기 등록을 지운다. 남은 기기가 받으면 sent, 모두 없어졌으면 skipped', async () => {
  let t = baseTables();
  let o = outbox(U.owner, CO.partner, 'confirmation_decided');
  t.notification_outbox.push(o);
  let res = await run(t, { pushStatus: { [EP.ownerA]: 410 } });
  assert.equal(row(res.fake, o.id).state, 'sent');
  assert.ok(!res.fake.db.push_subscriptions.some((s) => s.id === 's-owner-a'));
  assert.ok(res.fake.db.push_subscriptions.some((s) => s.id === 's-owner-b'));
  assert.equal(res.out.gone, 1);

  t = baseTables();
  o = outbox(U.owner, CO.partner, 'confirmation_decided');
  const o2 = outbox(U.owner, CO.partner, 'order_request');
  t.notification_outbox.push(o, o2);
  res = await run(t, { pushStatus: { [EP.ownerA]: 404, [EP.ownerB]: 410 } });
  assert.equal(row(res.fake, o.id).state, 'skipped');
  assert.equal(row(res.fake, o.id).sent_at, null);
  assert.equal(row(res.fake, o2.id).state, 'skipped');
  assert.equal(res.out.gone, 2, '같은 기기를 두 번 지우지 않는다');
  assert.ok(!res.fake.db.push_subscriptions.some((s) => s.user_id === U.owner && s.company_id === CO.partner));
  assertQuietLogs(res.lines);
});

test('보내기 — 받을 기기가 없거나 받을 사람이 아니면 skipped (나간 사람 · 정지 업체의 보통 알림 · 정지 업체 직원)', async () => {
  const t = baseTables();
  const rows = [
    outbox(U.left, CO.partner, 'order_request'),
    outbox(U.suspOwner, CO.susp, 'order_request'),
    outbox(U.suspStaff, CO.susp, 'company_suspended'),
    outbox(U.staff, CO.partner, 'billing_failed'),
    outbox(U.owner, CO.susp, 'order_request'),
  ];
  t.notification_outbox.push(...rows);
  t.push_subscriptions = t.push_subscriptions.filter((s) => s.id !== 's-staff');
  const nobodyHome = outbox(U.staff, CO.partner, 'confirmation_decided');
  t.notification_outbox.push(nobodyHome);
  const { fake, out } = await run(t);
  assert.equal(out.skipped, 6);
  assert.equal(fake.calls.push.length, 0);
  for (const r of rows) assert.equal(row(fake, r.id).last_error, 'ineligible');
  assert.equal(row(fake, nobodyHome.id).last_error, 'no_subscription');
});

test('보내기 — 결제 실패 · 업체 정지는 정지된 업체의 대표에게 간다', async () => {
  const t = baseTables();
  const a = outbox(U.suspOwner, CO.susp, 'billing_failed');
  const b = outbox(U.suspOwner, CO.susp, 'company_suspended');
  t.notification_outbox.push(a, b);
  const { fake, out } = await run(t);
  assert.equal(out.sent, 2);
  assert.deepEqual(pushedTo(fake), [EP.suspOwner, EP.suspOwner]);
});

test('보내기 — 업체 없는 업체 신청은 그 사람의 업체 없는 기기로만, upgrade 신청은 그 업체 기기로', async () => {
  const t = baseTables();
  const a = outbox(U.applicant, null, 'partner_application');
  const b = outbox(U.owner, CO.partner, 'partner_application');
  t.notification_outbox.push(a, b);
  const { fake, out } = await run(t);
  assert.equal(out.sent, 2);
  assert.deepEqual(pushedTo(fake), [EP.applicant, EP.ownerA, EP.ownerB].sort());
});

test('보내기 — 모두 실패면 queued 그대로 (짧은 last_error, 기기 fail_count + 1), 5분 뒤 다시 잡힌다. 5번째 실패는 failed', async () => {
  await setup();
  clearVapidCache();
  const t = baseTables();
  const o = outbox(U.staff, CO.partner, 'confirmation_decided', { body: SECRET_BODY });
  t.notification_outbox.push(o);
  const fake = createFake({ tables: t, nowMs: NOW, pushStatus: { [EP.staff]: 503 } });
  const once = () => withFake(fake, async (lines) => ({ out: await runPushSender(VAPID_ENV, { nowMs: fake.state.nowMs }), lines }));

  let r = await once();
  assert.equal(r.out.retry, 1);
  let saved = row(fake, o.id);
  assert.equal(saved.state, 'queued');
  assert.equal(saved.attempts, 1);
  assert.equal(saved.last_error, 'push 503');
  assert.equal(saved.sent_at, null);
  assert.equal(fake.db.push_subscriptions.find((s) => s.id === 's-staff').fail_count, 3);
  assertQuietLogs(r.lines);

  // 1분 뒤 — 아직 잡히지 않는다
  fake.state.nowMs = NOW + 60_000;
  r = await once();
  assert.equal(r.out.claimed, 0);
  assert.equal(fake.calls.push.length, 1);

  // 5분 넘게 지나면 다시 — 5번째까지
  for (let i = 2; i <= 5; i++) {
    fake.state.nowMs += 5 * 60_000 + 1000;
    r = await once();
    assert.equal(r.out.claimed, 1);
    saved = row(fake, o.id);
    assert.equal(saved.attempts, i);
    assert.equal(saved.state, i < 5 ? 'queued' : 'failed');
  }
  assert.equal(saved.last_error, 'push 503');
  fake.state.nowMs += 10 * 60_000;
  r = await once();
  assert.equal(r.out.claimed, 0, '실패한 줄은 다시 잡지 않는다');
  assert.equal(fake.calls.push.length, 5);
});

test('보내기 — 연결 실패 · 섞인 실패는 짧은 이름만 (주소 없음), 하나라도 받으면 sent', async () => {
  let t = baseTables();
  let o = outbox(U.owner, CO.partner, 'order_request', { attempts: 4 });
  t.notification_outbox.push(o);
  let res = await run(t, { pushStatus: { [EP.ownerA]: 'throw', [EP.ownerB]: 429 } });
  const saved = row(res.fake, o.id);
  assert.equal(saved.state, 'failed');
  assert.equal(saved.last_error, 'network,push 429');
  assert.ok(!saved.last_error.includes('https'));
  assertQuietLogs(res.lines);

  t = baseTables();
  o = outbox(U.owner, CO.partner, 'order_request');
  t.notification_outbox.push(o);
  res = await run(t, { pushStatus: { [EP.ownerA]: 500 } });
  assert.equal(row(res.fake, o.id).state, 'sent');
  assert.equal(res.fake.db.push_subscriptions.find((s) => s.id === 's-owner-a').fail_count, 1);
});

test('VAPID 설정이 없으면 잡지 않는다 (줄은 queued 그대로) — 로그는 짧게', async () => {
  const t = baseTables();
  const o = outbox(U.owner, CO.partner, 'order_request');
  t.notification_outbox.push(o);
  await setup();
  const { fake, out, lines } = await run(t, { env: { ...VAPID_ENV, VAPID_PRIVATE_KEY: '' } });
  assert.equal(out.error, 'not_configured');
  assert.equal(fake.calls.rest.length, 0);
  assert.equal(row(fake, o.id).attempts, 0);
  assert.deepEqual(lines, ['warn: [push] vapid not configured: config']);
});

test('잡기 · 받는 사람 읽기가 실패하면 그대로 둔다 (상태 코드만 로그)', async () => {
  const t = baseTables();
  t.notification_outbox.push(outbox(U.owner, CO.partner, 'order_request'));
  let res = await run(t, { failDb: (m, p) => (p === 'rpc/claim_notifications' ? 404 : 0) });
  assert.equal(res.out.error, 'claim_failed');
  assert.deepEqual(res.lines, ['error: [push] claim failed: 404']);
  res = await run(t, { failDb: (m, p) => (p === 'push_subscriptions' && m === 'GET' ? 500 : 0) });
  assert.equal(res.out.error, 'recipients_failed');
  assert.equal(res.fake.calls.push.length, 0);
  assert.equal(res.fake.db.notification_outbox[0].state, 'queued');
});

test('잡을 줄이 없으면 아무것도 보내지 않고 로그도 없다', async () => {
  const { fake, out, lines } = await run(baseTables());
  assert.deepEqual(out, { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, gone: 0, errors: 0 });
  assert.equal(fake.calls.rest.length, 1);
  assert.deepEqual(lines, []);
});

// ── 정리 ──────────────────────────────────────────────

test('정리 — 30일 지난 끝난 줄(sent · skipped · failed)만 지우고, 5번 잡혀 1시간 넘게 멈춘 줄은 failed', async () => {
  const t = baseTables();
  const old = NOW - 31 * 86_400_000;
  const recent = NOW - 29 * 86_400_000;
  t.notification_outbox = [
    outbox(U.owner, CO.partner, 'order_request', { id: 'old-sent', state: 'sent', sent_at: iso(old), created_at: iso(old) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'old-skipped', state: 'skipped', created_at: iso(old) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'old-failed', state: 'failed', created_at: iso(old) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'old-queued', state: 'queued', created_at: iso(old) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'recent-sent', state: 'sent', sent_at: iso(recent), created_at: iso(recent) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'stuck', attempts: 5, claimed_at: iso(NOW - 2 * 3_600_000) }),
    outbox(U.owner, CO.partner, 'order_request', { id: 'busy', attempts: 5, claimed_at: iso(NOW - 60_000) }),
  ];
  const fake = createFake({ tables: t, nowMs: NOW });
  const { out, lines } = await withFake(fake, async (lines) => ({ out: await runPushCleanup(VAPID_ENV || { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' }, { nowMs: NOW }), lines }));
  assert.deepEqual(fake.db.notification_outbox.map((r) => r.id).sort(), ['busy', 'old-queued', 'recent-sent', 'stuck']);
  assert.equal(row(fake, 'stuck').state, 'failed');
  assert.equal(row(fake, 'stuck').last_error, 'stuck');
  assert.equal(row(fake, 'busy').state, 'queued');
  assert.deepEqual(out, { stuck: 1 });
  assert.match(fake.calls.rest[0].prefer, /return=minimal/);
  assert.deepEqual(lines, ['log: [push] cleanup {"stuck":1}']);
});

test('정리 시각 — 하루 한 번 UTC 18:17 (KST 03:17) 의 그 1분', () => {
  assert.equal(isPushCleanupTime(Date.parse('2026-10-29T18:17:00Z')), true);
  assert.equal(isPushCleanupTime(Date.parse('2026-10-29T18:17:59Z')), true);
  assert.equal(isPushCleanupTime(Date.parse('2026-10-29T18:18:00Z')), false);
  assert.equal(isPushCleanupTime(Date.parse('2026-10-29T03:17:00Z')), false);
});

// ── cron ──────────────────────────────────────────────

async function scheduled(cron, scheduledTime, t = baseTables()) {
  await setup();
  clearVapidCache();
  const fake = createFake({ tables: t, nowMs: scheduledTime });
  const waits = [];
  await withFake(fake, async () => {
    await worker.scheduled({ cron, scheduledTime }, { ...VAPID_ENV, SLACK_WEBHOOK_URL: '' }, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  });
  return { fake, waits: waits.length };
}

test('scheduled(): 1분 cron 은 앱 알림 보내기, 정리 시각이면 정리도, 5의 배수 분이면 새 상담 알림도. 다른 cron 은 앱 알림을 건드리지 않는다', async () => {
  const t = baseTables();
  t.notification_outbox.push(outbox(U.owner, CO.partner, 'order_request', { send_after: iso(Date.parse('2026-10-29T02:00:00Z')) }));
  // 매분 상담 배정 되돌리기도 같이 돈다 (+1)
  let r = await scheduled(PUSH_SEND_CRON, Date.parse('2026-10-29T03:01:00Z'), t);
  assert.equal(r.waits, 2);
  assert.equal(r.fake.db.notification_outbox[0].state, 'sent');
  assert.ok(!r.fake.calls.rest.some((c) => c.method === 'DELETE' && c.path === 'notification_outbox'));

  r = await scheduled(PUSH_SEND_CRON, Date.parse('2026-10-29T18:17:00Z'));
  assert.equal(r.waits, 3);
  assert.ok(r.fake.calls.rest.some((c) => c.method === 'DELETE' && c.path === 'notification_outbox'));

  // 5의 배수 분 — 앱 알림 + 새 상담 + 새 업체 신청 (상담 쪽 실패는 그 안에서 잡힌다)
  r = await scheduled(PUSH_SEND_CRON, Date.parse('2026-10-29T03:05:00Z'));
  assert.equal(r.waits, 4);
  assert.ok(r.fake.calls.rest.some((c) => c.path === 'rpc/claim_notifications'));

  r = await scheduled('*/5 * * * *', Date.parse('2026-10-29T03:00:00Z'));
  assert.equal(r.waits, 0);
  assert.ok(!r.fake.calls.rest.some((c) => c.path === 'rpc/claim_notifications'));
  assert.equal(PUSH_SEND_CRON, '* * * * *');
  assert.ok(b64urlDecode(VAPID_ENV.VAPID_PUBLIC_KEY).length === 65);
});
