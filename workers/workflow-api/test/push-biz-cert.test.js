/**
 * 사업자등록증 · 첫 달 무료 앱 알림 (src/push/messages.js · sender.js · outbox.js — DB 0077).
 *
 *   - 글: 무료 이용 종료 예정(7일 전 · 1일 전) · 검토할 사업자등록증 · 검토 결과(승인 · 반려)
 *     — 금액 · 업체 이름 · 사업자번호 · 대표자 이름 · 반려 사유 없음, 열 곳은 /segan/ 안
 *   - 보낼 때 판정: 무료 종료는 활동 중인 업체의 대표만 · 검토 알림은 그 업체(본사)의 대표 · 실장만 ·
 *     검토 결과는 올린 사람 본인(업체 없이 넣은 줄)
 *   - 받을 기기: 검토 결과(업체 없음)는 그 사람의 기기 모두 — 다른 업체 구성원이라 기기가 업체에 묶여 있어도 받는다
 *   - 넣기: 검토 결과만 업체 없이 넣을 수 있다 (DB notification_outbox_company_check)
 * 넣는 쪽은 다른 워커다 — trial_ending 은 payments-api, biz_cert_* 는 account-api (같은 글을 따로 들고 있다).
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage,
  isValidMessage,
  charLen,
  NOTIFICATION_KINDS,
  PERSON_NOTIFICATION_KINDS,
  WORK_NOTIFICATION_KINDS,
  TRIAL_ENDING_DAYS,
  PARTNER_URL,
  HQ_BIZ_CERT_URL,
  TITLE_MAX,
  BODY_MAX,
} from '../src/push/messages.js';
import {
  isEligible,
  targetsFor,
  OWNER_KINDS,
  OWNER_ACTIVE_KINDS,
  REVIEWER_KINDS,
  MONEY_KINDS,
} from '../src/push/sender.js';
import { enqueueNotification } from '../src/push/outbox.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const U = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  manager: 'a0000000-0000-4000-8000-000000000002',
  staff: 'a0000000-0000-4000-8000-000000000003',
  suspOwner: 'a0000000-0000-4000-8000-000000000004',
  uploader: 'a0000000-0000-4000-8000-000000000005',
};
const CO = {
  partner: 'c0000000-0000-4000-8000-000000000001',
  susp: 'c0000000-0000-4000-8000-000000000002',
  platform: 'c0000000-0000-4000-8000-000000000003',
};
const CERT = 'b0000000-0000-4000-8000-000000000001';
// 가짜 개인정보 — 글에 나오면 안 된다
const PII = ['1234567891', '123-45-67891', '김가짜', '새봄가구', '99,000', '99000'];

test('종류 — 목록 맨 끝에 이 차례로 셋. 검토 결과만 업체 없이 넣는 종류', () => {
  assert.deepEqual(NOTIFICATION_KINDS.slice(-3), [
    'trial_ending',
    'biz_cert_review',
    'biz_cert_decided',
  ]);
  assert.deepEqual(PERSON_NOTIFICATION_KINDS, ['biz_cert_decided']);
  assert.ok(PERSON_NOTIFICATION_KINDS.every((k) => !WORK_NOTIFICATION_KINDS.includes(k)));
  assert.deepEqual(OWNER_ACTIVE_KINDS, ['trial_ending']);
  assert.deepEqual(REVIEWER_KINDS, ['biz_cert_review']);
  // 정지돼도 가는 종류 · 장부 종류는 그대로다
  assert.deepEqual(OWNER_KINDS, ['billing_failed', 'company_suspended']);
  assert.deepEqual(MONEY_KINDS, ['ledger_pending', 'ledger_notice', 'stock_band_low']);
});

test('글 — 무료 종료 예정(7일 · 1일) · 검토할 사업자등록증 · 검토 결과. 금액 · 이름 · 번호 없음', () => {
  assert.equal(HQ_BIZ_CERT_URL, '/segan/me.html#hq-biz-cert');
  assert.equal(PARTNER_URL, '/segan/me.html#partner');
  assert.deepEqual(TRIAL_ENDING_DAYS, [7, 1]);
  const cases = [
    [
      'trial_ending',
      { daysLeft: 7 },
      '무료 이용 종료 예정',
      '무료 이용이 7일 뒤 끝나고 첫 결제가 진행됩니다. 결제 관리에서 결제일과 금액을 확인해 주세요.',
      '/segan/me.html#partner',
    ],
    [
      'trial_ending',
      { daysLeft: 1 },
      '무료 이용 종료 예정',
      '무료 이용이 내일 끝나고 첫 결제가 진행됩니다. 결제 관리에서 결제일과 금액을 확인해 주세요.',
      '/segan/me.html#partner',
    ],
    [
      'biz_cert_review',
      {},
      '사업자등록증 확인',
      '검토할 사업자등록증이 있습니다.',
      '/segan/me.html#hq-biz-cert',
    ],
    [
      'biz_cert_decided',
      { approved: true },
      '사업자등록증 확인 완료',
      '사업자등록증 확인이 끝났습니다. 팩토리를 첫 달 무료로 시작할 수 있습니다.',
      '/segan/me.html#partner',
    ],
    [
      'biz_cert_decided',
      { approved: false },
      '사업자등록증 확인',
      '사업자등록증을 확인하지 못했습니다. 다시 올리거나 바로 시작할 수 있습니다.',
      '/segan/me.html#partner',
    ],
  ];
  for (const [kind, params, title, body, url] of cases) {
    const m = buildMessage(kind, params);
    assert.deepEqual(m, { title, body, url }, `${kind} ${JSON.stringify(params)}`);
    assert.ok(isValidMessage(m));
    assert.ok(charLen(m.title) <= TITLE_MAX && charLen(m.body) <= BODY_MAX);
  }
  // 받은 값에 금액 · 이름 · 번호 · 사유가 섞여 있어도 글에 싣지 않는다
  const extra = {
    amount: '99,000',
    amountKrw: 99000,
    companyName: '새봄가구',
    bizNo: '1234567891',
    representativeName: '김가짜',
    reason: '김가짜 123-45-67891',
  };
  for (const m of [
    buildMessage('trial_ending', { daysLeft: 7, ...extra }),
    buildMessage('biz_cert_review', extra),
    buildMessage('biz_cert_decided', { approved: false, ...extra }),
  ]) {
    for (const v of PII) assert.ok(!m.title.includes(v) && !m.body.includes(v), v);
  }
  // 정해진 날 · 값이 아니면 글이 없다
  for (const bad of [{}, { daysLeft: 0 }, { daysLeft: 3 }, { daysLeft: '7' }, { daysLeft: 30 }])
    assert.equal(buildMessage('trial_ending', bad), null, JSON.stringify(bad));
  for (const bad of [{}, { approved: 'yes' }, { status: 'verified' }])
    assert.equal(buildMessage('biz_cert_decided', bad), null, JSON.stringify(bad));
});

test('보낼 때 판정 — 무료 종료는 활동 중인 업체의 대표만, 검토 알림은 그 업체의 대표 · 실장만, 검토 결과는 올린 사람 본인', () => {
  const ms = [
    { user_id: U.owner, company_id: CO.partner, role: 'owner', company: { status: 'active' } },
    { user_id: U.manager, company_id: CO.partner, role: 'manager', company: { status: 'active' } },
    { user_id: U.staff, company_id: CO.partner, role: 'staff', company: { status: 'active' } },
    { user_id: U.suspOwner, company_id: CO.susp, role: 'owner', company: { status: 'suspended' } },
  ];
  const r = (user_id, company_id, kind) => ({ user_id, company_id, kind });

  // 무료가 곧 끝남 — 대표만, 정지된 업체에는 보내지 않는다
  assert.equal(isEligible(r(U.owner, CO.partner, 'trial_ending'), ms), true);
  assert.equal(isEligible(r(U.manager, CO.partner, 'trial_ending'), ms), false, '실장');
  assert.equal(isEligible(r(U.staff, CO.partner, 'trial_ending'), ms), false, '직원');
  assert.equal(isEligible(r(U.suspOwner, CO.susp, 'trial_ending'), ms), false, '정지된 업체');
  assert.equal(isEligible(r(U.uploader, CO.partner, 'trial_ending'), ms), false, '구성원 아님');
  assert.equal(isEligible(r(U.owner, null, 'trial_ending'), ms), false, '업체 칸 없는 줄');

  // 검토할 사업자등록증 — 줄에 적힌 업체(본사)의 대표 · 실장
  const hq = [
    { user_id: U.owner, company_id: CO.platform, role: 'owner', company: { status: 'active' } },
    { user_id: U.manager, company_id: CO.platform, role: 'manager', company: { status: 'active' } },
    { user_id: U.staff, company_id: CO.platform, role: 'staff', company: { status: 'active' } },
  ];
  assert.equal(isEligible(r(U.owner, CO.platform, 'biz_cert_review'), hq), true);
  assert.equal(isEligible(r(U.manager, CO.platform, 'biz_cert_review'), hq), true);
  assert.equal(isEligible(r(U.staff, CO.platform, 'biz_cert_review'), hq), false, '본사 직원');
  assert.equal(isEligible(r(U.uploader, CO.platform, 'biz_cert_review'), hq), false, '빠진 사람');
  assert.equal(isEligible(r(U.owner, null, 'biz_cert_review'), hq), false, '업체 칸 없는 줄');

  // 검토 결과 — 업체 없이 넣은 줄은 그 사람에게 (업체가 없어도 · 다른 업체 구성원이어도)
  assert.equal(isEligible(r(U.uploader, null, 'biz_cert_decided'), []), true);
  assert.equal(isEligible(r(U.owner, null, 'biz_cert_decided'), ms), true);
  // 업체 칸이 붙은 줄이면 다른 알림처럼 그 업체 구성원이어야 한다
  assert.equal(isEligible(r(U.uploader, CO.partner, 'biz_cert_decided'), ms), false);
  assert.equal(isEligible(r(U.owner, CO.partner, 'biz_cert_decided'), ms), true);
});

test('받을 기기 — 검토 결과(업체 없음)는 그 사람의 기기 모두, 나머지 둘은 그 업체 기기만', () => {
  const subs = [
    { id: 1, user_id: U.uploader, company_id: null },
    { id: 2, user_id: U.uploader, company_id: CO.partner },
    { id: 3, user_id: U.owner, company_id: CO.partner },
    { id: 4, user_id: U.owner, company_id: CO.platform },
    { id: 5, user_id: U.owner, company_id: null },
  ];
  const ids = (row) => targetsFor(row, subs).map((s) => s.id);
  assert.deepEqual(
    ids({ user_id: U.uploader, company_id: null, kind: 'biz_cert_decided' }),
    [1, 2]
  );
  assert.deepEqual(ids({ user_id: U.owner, company_id: CO.partner, kind: 'trial_ending' }), [3]);
  assert.deepEqual(
    ids({ user_id: U.owner, company_id: CO.platform, kind: 'biz_cert_review' }),
    [4]
  );
});

test('넣기 — 검토 결과는 업체 없이 된다. 무료 종료 · 검토 알림은 업체 칸이 있어야 한다', async () => {
  const fake = createFake({});
  await withFake(fake, async (lines) => {
    const decided = {
      userId: U.uploader,
      companyId: null,
      kind: 'biz_cert_decided',
      ...buildMessage('biz_cert_decided', { approved: true }),
      refId: CERT,
      dedupeKey: `biz_cert_decided:${CERT}:${U.uploader}:verified`,
    };
    assert.equal(await enqueueNotification(ENV, decided), true);
    assert.equal(await enqueueNotification(ENV, decided), true);
    assert.equal(fake.db.notification_outbox.length, 1);
    assert.equal(fake.db.notification_outbox[0].company_id, null);
    assert.deepEqual(lines, []);

    for (const [kind, params] of [
      ['trial_ending', { daysLeft: 7 }],
      ['biz_cert_review', {}],
    ]) {
      const m = buildMessage(kind, params);
      assert.equal(
        await enqueueNotification(ENV, { userId: U.owner, companyId: null, kind, ...m }),
        false,
        kind
      );
      assert.equal(
        await enqueueNotification(ENV, { userId: U.owner, companyId: CO.partner, kind, ...m }),
        true,
        kind
      );
    }
    assert.deepEqual(
      fake.db.notification_outbox.map((n) => n.kind),
      ['biz_cert_decided', 'trial_ending', 'biz_cert_review']
    );
  });
});
