/**
 * 작업자 앱 알림 (src/push/work-hooks.js · messages.js · sender.js — DB 0023).
 *
 *   - 글: 작업 초대 · 작업자 신청 결과 · 작업 확정 · 작업 일정 바뀜 — 작업 종류 · 날짜만 (작업 제목 · 지역 · 고객 정보 없음),
 *     열 곳은 작업 탭(/segan/work.html, 작업이면 #job=)
 *   - 넣기: 업체 없이(company_id 비움), 받는 사람 = 그 작업자 계정, 같은 일은 한 번만
 *   - 일정: 시작 · 끝 시각이 바뀌었을 때만, 그 작업의 제안 · 확정 · 진행 중 작업자에게 (빠진 · 거절한 사람 빼고)
 *   - 보낼 때 다시 본다: 신청 결과는 작업자 행이 있으면, 그 밖은 승인된 작업자만, 업체가 붙은 작업자 알림은 안 보낸다
 *   - 넣기가 실패해도 던지지 않는다
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessage,
  isValidMessage,
  WORK_URL,
  WORK_KIND_LABELS,
  WORK_NOTIFICATION_KINDS,
  WORK_MANAGER_KINDS,
  COMPANY_WORKERS_URL,
  COMPANY_INSTALL_URL,
  COMPANY_AS_URL,
  workDay,
} from '../src/push/messages.js';
import { isEligible } from '../src/push/sender.js';
import {
  later,
  notifyWorkerStatus,
  notifyWorkInvited,
  notifyWorkAssigned,
  notifyWorkSchedule,
  notifyCompanyWork,
  notifyWorkerLink,
  SCHEDULE_ASSIGNMENT_STATUSES,
} from '../src/push/work-hooks.js';
import { WORK_KINDS } from '../src/work/validate.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const JOB = 'b0000000-0000-4000-8000-000000000001';
const W1 = 'e0000000-0000-4000-8000-000000000001';
const W2 = 'e0000000-0000-4000-8000-000000000002';
const W3 = 'e0000000-0000-4000-8000-000000000003';
const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const U3 = 'a0000000-0000-4000-8000-000000000003';
const A1 = 'f0000000-0000-4000-8000-000000000001';
const A2 = 'f0000000-0000-4000-8000-000000000002';
const A3 = 'f0000000-0000-4000-8000-000000000003';
const A4 = 'f0000000-0000-4000-8000-000000000004';
// 가짜 작업 — 제목 · 지역에 고객 정보가 섞여 있어도 알림에는 나오면 안 된다
const job = (over = {}) => ({
  id: JOB,
  kind: 'install',
  title: '홍길동님 댁 싱크대 설치',
  region_label: '서울 송파구 잠실동',
  starts_at: '2026-11-04T23:30:00Z', // 한국 시간 11/5(목) 08:30
  ends_at: '2026-11-05T08:00:00Z',
  ...over,
});
const PII = ['홍길동', '잠실', '송파'];

const tables = () => ({
  workers: [
    { id: W1, user_id: U1, status: 'approved' },
    { id: W2, user_id: U2, status: 'approved' },
    { id: W3, user_id: U3, status: 'approved' },
  ],
  work_assignments: [
    { id: A1, job_id: JOB, worker_id: W1, status: 'confirmed' },
    { id: A2, job_id: JOB, worker_id: W2, status: 'offered' },
    { id: A3, job_id: JOB, worker_id: W3, status: 'released' },
    { id: A4, job_id: JOB, worker_id: W3, status: 'declined' },
  ],
});
const outbox = (fake) => fake.db.notification_outbox;

test('글 — 작업 종류 · 날짜만, 열 곳은 작업 탭 (#job=), DB 글자 수 안', () => {
  assert.deepEqual(
    Object.keys(WORK_KIND_LABELS),
    [...WORK_KINDS],
    '작업 종류 키 = work/validate.js'
  );
  assert.equal(WORK_URL, '/segan/work.html');
  assert.equal(workDay('2026-11-04T23:30:00Z'), '11/5(목)');
  assert.equal(workDay(null), '');
  const p = { jobKind: 'install', startsAt: '2026-11-04T23:30:00Z', jobId: JOB };
  const cases = [
    [
      'work_invited',
      p,
      '작업 초대',
      '11/5(목) 설치 작업에 초대받았습니다. 수락하거나 거절해 주세요.',
      `${WORK_URL}#job=${JOB}`,
    ],
    [
      'work_assigned',
      { ...p, jobKind: 'as' },
      '작업 확정',
      '11/5(목) A/S 작업에 확정되었습니다. 작업 탭에서 확인해 주세요.',
      `${WORK_URL}#job=${JOB}`,
    ],
    [
      'work_schedule',
      { ...p, jobKind: 'assembly' },
      '작업 일정 바뀜',
      '조립 작업 일정이 11/5(목)(으)로 바뀌었습니다. 작업 탭에서 확인해 주세요.',
      `${WORK_URL}#job=${JOB}`,
    ],
    [
      'work_schedule',
      { jobKind: 'install', startsAt: null, jobId: 'nope' },
      '작업 일정 바뀜',
      '설치 작업 일정이 바뀌었습니다. 작업 탭에서 확인해 주세요.',
      WORK_URL,
    ],
    // 일정이 취소돼 작업이 취소됨 — 같은 종류(work_schedule), 글만 다르다
    [
      'work_schedule',
      { ...p, cancelled: true },
      '작업 취소',
      '11/5(목) 설치 작업이 취소되었습니다. 작업 탭에서 확인해 주세요.',
      `${WORK_URL}#job=${JOB}`,
    ],
    [
      'work_schedule',
      { jobKind: 'as', startsAt: null, jobId: JOB, cancelled: true },
      '작업 취소',
      'A/S 작업이 취소되었습니다. 작업 탭에서 확인해 주세요.',
      `${WORK_URL}#job=${JOB}`,
    ],
    [
      'work_registration',
      { status: 'approved' },
      '작업자 신청',
      '작업자 신청이 승인되었습니다. 작업 탭에서 작업을 보고 신청할 수 있습니다.',
      WORK_URL,
    ],
    [
      'work_registration',
      { status: 'rejected' },
      '작업자 신청',
      '작업자 신청이 승인되지 않았습니다. 작업 탭에서 확인해 주세요.',
      WORK_URL,
    ],
  ];
  for (const [kind, params, title, body, url] of cases) {
    const m = buildMessage(kind, params);
    assert.deepEqual(m, { title, body, url }, `${kind} ${JSON.stringify(params)}`);
    assert.ok(isValidMessage(m), kind);
  }
  assert.equal(
    buildMessage('work_invited', { jobKind: 'cleaning', startsAt: null }),
    null,
    '모르는 작업 종류'
  );
  assert.equal(buildMessage('work_registration', { status: 'suspended' }), null);
  assert.deepEqual(WORK_NOTIFICATION_KINDS, [
    'work_invited',
    'work_registration',
    'work_assigned',
    'work_schedule',
  ]);
});

test('신청 결과 · 초대 · 확정 — 그 작업자 계정으로, 업체 없이, 같은 일은 한 번만, 고객 정보 없음', async () => {
  const fake = createFake({ tables: tables() });
  await withFake(fake, async () => {
    assert.equal(
      await notifyWorkerStatus(ENV, { worker: { id: W1, user_id: U1 }, status: 'approved' }),
      1
    );
    assert.equal(
      await notifyWorkerStatus(ENV, { worker: { id: W1, user_id: U1 }, status: 'approved' }),
      1,
      '같은 키는 넘긴다'
    );
    assert.equal(
      await notifyWorkerStatus(ENV, { worker: { id: W1, user_id: U1 }, status: 'suspended' }),
      0,
      '정지는 알리지 않는다'
    );
    assert.equal(
      await notifyWorkInvited(ENV, { job: job(), assignment: { id: A2, worker_id: W2 } }),
      1
    );
    assert.equal(
      await notifyWorkAssigned(ENV, { job: job(), assignment: { id: A1, worker_id: W1 } }),
      1
    );
  });
  const rows = outbox(fake);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.user_id, r.company_id, r.ref_id]),
    [
      ['work_registration', U1, null, W1],
      ['work_invited', U2, null, A2],
      ['work_assigned', U1, null, A1],
    ]
  );
  assert.equal(rows[0].dedupe_key, `work_registration:${W1}:${U1}:approved`);
  for (const r of rows)
    for (const v of PII) assert.ok(!r.title.includes(v) && !r.body.includes(v), r.kind);
});

test('일정 — 시작 · 끝이 바뀌면 제안 · 확정 · 진행 중 작업자에게 한 줄씩, 안 바뀌면 넣지 않는다', async () => {
  assert.deepEqual(SCHEDULE_ASSIGNMENT_STATUSES, ['offered', 'confirmed', 'started']);
  const fake = createFake({ tables: tables() });
  await withFake(fake, async () => {
    assert.equal(
      await notifyWorkSchedule(ENV, { before: job(), after: job({ title: '바뀐 제목' }) }),
      0,
      '시각이 그대로'
    );
    const moved = job({ starts_at: '2026-11-06T00:00:00Z', ends_at: '2026-11-06T08:00:00Z' });
    assert.equal(await notifyWorkSchedule(ENV, { before: job(), after: moved }), 2);
    assert.equal(
      await notifyWorkSchedule(ENV, { before: job(), after: moved }),
      2,
      '같은 새 시각은 같은 키'
    );
  });
  const rows = outbox(fake);
  assert.deepEqual(rows.map((r) => r.user_id).sort(), [U1, U2].sort(), '빠진 · 거절한 작업자 빼고');
  assert.ok(
    rows.every((r) => r.kind === 'work_schedule' && r.company_id === null && r.ref_id === JOB)
  );
  assert.equal(
    rows[0].body,
    '설치 작업 일정이 11/6(금)(으)로 바뀌었습니다. 작업 탭에서 확인해 주세요.'
  );
});

test('넣기가 실패해도 던지지 않는다 · later 는 응답 뒤에(waitUntil) 돌린다', async () => {
  const fake = createFake({
    tables: tables(),
    failDb: (m, p) => (p === 'notification_outbox' ? 503 : 0),
  });
  await withFake(fake, async (lines) => {
    assert.equal(
      await notifyWorkInvited(ENV, { job: job(), assignment: { id: A2, worker_id: W2 } }),
      0
    );
    assert.ok(lines.some((l) => l.includes('enqueue failed') && l.includes('503')));
    assert.ok(!lines.some((l) => PII.some((v) => l.includes(v))));
  });
  const waits = [];
  const out = await later({ waitUntil: (p) => waits.push(p) }, Promise.resolve(7));
  assert.equal(out, null);
  assert.equal(await waits[0], 7);
  assert.equal(await later(null, Promise.resolve(3)), 3);
});

test('보낼 때 판정 — 신청 결과는 작업자 행이 있으면, 그 밖은 승인된 작업자만, 업체가 붙으면 안 보낸다', () => {
  const ws = [
    { user_id: U1, status: 'approved' },
    { user_id: U2, status: 'suspended' },
    { user_id: U3, status: 'rejected' },
  ];
  const r = (user_id, kind, company_id = null) => ({ user_id, kind, company_id });
  assert.equal(isEligible(r(U1, 'work_invited'), [], ws), true);
  assert.equal(isEligible(r(U2, 'work_schedule'), [], ws), false, '정지된 작업자');
  assert.equal(
    isEligible(r(U3, 'work_registration'), [], ws),
    true,
    '반려 알림은 반려된 작업자에게'
  );
  assert.equal(isEligible(r(U3, 'work_assigned'), [], ws), false);
  assert.equal(
    isEligible(r('a0000000-0000-4000-8000-000000000099', 'work_invited'), [], ws),
    false,
    '작업자가 아님'
  );
  assert.equal(
    isEligible(r(U1, 'work_invited', 'c0000000-0000-4000-8000-000000000001'), [], ws),
    false,
    '업체가 붙은 줄'
  );
  assert.equal(isEligible(r(U1, 'partner_application'), [], []), true, '업체 신청은 그대로');
});

// ── 팩토리 대표 · 실장에게 가는 작업자 알림 (DB 0064 — 2026-11-13 「작업자 한 길」) ──────────────

test('팩토리용 글 — 연결 신청 · 배정 답 · 작업 보고. 이름 · 사유 · 보고 글 없이 종류 · 날짜만, 열 곳은 팩토리 화면', () => {
  const at = '2026-11-04T23:30:00Z';
  const cases = [
    ['work_link_request', {}, '작업자 연결 신청', '작업자가 팩토리 연결을 신청했습니다. 인사 › 작업자에서 확인해 주세요.', COMPANY_WORKERS_URL],
    ['work_link_request', { left: true }, '작업자 연결 끊김', '작업자가 팩토리 연결을 끊었습니다. 인사 › 작업자에서 확인해 주세요.', COMPANY_WORKERS_URL],
    ['work_reply', { reply: 'confirmed', jobKind: 'install', startsAt: at }, '작업 배정 답', '작업자가 11/5(목) 설치 작업 배정을 수락했습니다. 일정에서 확인해 주세요.', COMPANY_INSTALL_URL],
    ['work_reply', { reply: 'declined', jobKind: 'as', startsAt: at }, '작업 배정 답', '작업자가 11/5(목) A/S 작업 배정을 거절했습니다. 일정에서 확인해 주세요.', COMPANY_AS_URL],
    ['work_reply', { reply: 'released', jobKind: 'install', startsAt: null }, '작업 배정 답', '작업자가 설치 작업 배정을 포기했습니다. 일정에서 확인해 주세요.', COMPANY_INSTALL_URL],
    ['work_report', { report: 'result', jobKind: 'install', startsAt: at }, '작업 완료 보고', '11/5(목) 설치 작업 완료 보고가 왔습니다. 일정에서 확인해 주세요.', COMPANY_INSTALL_URL],
    ['work_report', { report: 'issue', jobKind: 'as', startsAt: at }, '작업 문제 보고', '11/5(목) A/S 작업에 문제 보고가 왔습니다. 일정에서 확인해 주세요.', COMPANY_AS_URL],
    ['work_registration', { status: 'approved', companyName: '가나 인테리어' }, '팩토리 연결', '가나 인테리어 연결이 승인되었습니다. 작업 탭에서 확인해 주세요.', WORK_URL],
    ['work_registration', { status: 'rejected', companyName: '가나 인테리어' }, '팩토리 연결', '가나 인테리어 연결이 승인되지 않았습니다. 작업 탭에서 확인해 주세요.', WORK_URL],
  ];
  for (const [kind, params, title, body, url] of cases) {
    const m = buildMessage(kind, params);
    assert.deepEqual(m, { title, body, url }, `${kind} ${JSON.stringify(params)}`);
    assert.ok(isValidMessage(m), kind);
  }
  assert.equal(buildMessage('work_reply', { reply: 'started', jobKind: 'install' }), null, '모르는 답');
  assert.equal(buildMessage('work_reply', { reply: 'confirmed', jobKind: 'cleaning' }), null, '모르는 작업 종류');
  assert.equal(buildMessage('work_report', { report: 'progress', jobKind: 'install' }), null, '진행 보고는 알리지 않는다');
  assert.ok(isValidMessage(buildMessage('work_registration', { status: 'approved', companyName: '가'.repeat(80) })), '긴 이름은 자른다');
  assert.deepEqual(WORK_MANAGER_KINDS, ['work_link_request', 'work_reply', 'work_report']);
  assert.deepEqual([COMPANY_WORKERS_URL, COMPANY_INSTALL_URL, COMPANY_AS_URL], ['/segan/me.html#workers', '/segan/me.html#p-install', '/segan/me.html#p-as']);
});

test('팩토리용 넣기 — 그 팩토리의 대표 · 실장에게만, 업체 칸과 함께. 연결 결과는 연결마다 한 번', async () => {
  const CO = 'c0000000-0000-4000-8000-000000000001';
  const OWNER = 'a0000000-0000-4000-8000-000000000011';
  const MANAGER = 'a0000000-0000-4000-8000-000000000012';
  const STAFF = 'a0000000-0000-4000-8000-000000000013';
  const LINK = 'd0000000-0000-4000-8000-000000000001';
  const LINK2 = 'd0000000-0000-4000-8000-000000000002';
  const fake = createFake({
    tables: {
      ...tables(),
      company_members: [
        { company_id: CO, user_id: OWNER, role: 'owner', status: 'active' },
        { company_id: CO, user_id: MANAGER, role: 'manager', status: 'active' },
        { company_id: CO, user_id: STAFF, role: 'staff', status: 'active' },
      ],
    },
  });
  await withFake(fake, async () => {
    assert.equal(await notifyCompanyWork(ENV, { companyId: CO, kind: 'work_link_request', refId: LINK }), 2);
    await notifyCompanyWork(ENV, { companyId: CO, kind: 'work_link_request', refId: LINK });
    assert.equal(await notifyCompanyWork(ENV, { companyId: CO, kind: 'work_reply', refId: A1, params: { reply: 'confirmed', jobKind: 'install', startsAt: job().starts_at }, suffix: 'confirmed' }), 2);
    assert.equal(await notifyCompanyWork(ENV, { companyId: null, kind: 'work_link_request', refId: LINK }), 0, '업체를 모르면 안 넣는다');
    assert.equal(await notifyCompanyWork(ENV, { companyId: CO, kind: 'work_reply', refId: A1, params: { reply: 'nope' } }), 0);
    // 연결 결과 — 작업자에게, 업체 없이. 같은 연결 · 같은 결과는 한 번, 다른 연결은 따로
    const w = { id: W1, user_id: U1 };
    assert.equal(await notifyWorkerLink(ENV, { worker: w, link: { id: LINK }, status: 'approved', companyName: '가나 인테리어' }), 1);
    await notifyWorkerLink(ENV, { worker: w, link: { id: LINK }, status: 'approved', companyName: '가나 인테리어' });
    assert.equal(await notifyWorkerLink(ENV, { worker: w, link: { id: LINK2 }, status: 'approved', companyName: '다라 가구' }), 1);
    assert.equal(await notifyWorkerLink(ENV, { worker: w, link: { id: LINK }, status: 'suspended', companyName: '가나 인테리어' }), 0, '정지는 알리지 않는다');
  });
  const rows = fake.db.notification_outbox;
  assert.deepEqual(rows.filter((n) => n.kind === 'work_link_request').map((n) => [n.user_id, n.company_id]).sort(), [[OWNER, CO], [MANAGER, CO]].sort(), '같은 일은 한 번만 · 직원은 안 받는다');
  assert.equal(rows.filter((n) => n.kind === 'work_reply').length, 2);
  assert.deepEqual(rows.filter((n) => n.kind === 'work_registration').map((n) => [n.user_id, n.company_id || null, n.ref_id]), [[U1, null, LINK], [U1, null, LINK2]]);
  for (const n of rows) for (const v of PII) assert.ok(!n.title.includes(v) && !n.body.includes(v));
});

test('보낼 때 판정 — 팩토리용 알림은 그 팩토리의 대표 · 실장만 (직원 · 멈춘 팩토리 · 업체 칸 없는 줄은 안 보낸다)', () => {
  const CO = 'c0000000-0000-4000-8000-000000000001';
  const m = (user_id, role, status = 'active') => ({ user_id, company_id: CO, role, company: { status } });
  const mem = [m(U1, 'owner'), m(U2, 'manager'), m(U3, 'staff')];
  for (const kind of WORK_MANAGER_KINDS) {
    assert.equal(isEligible({ user_id: U1, kind, company_id: CO }, mem, []), true, kind);
    assert.equal(isEligible({ user_id: U2, kind, company_id: CO }, mem, []), true, kind);
    assert.equal(isEligible({ user_id: U3, kind, company_id: CO }, mem, []), false, `${kind} 직원`);
    assert.equal(isEligible({ user_id: U1, kind, company_id: CO }, [m(U1, 'owner', 'suspended')], []), false, `${kind} 멈춘 팩토리`);
    assert.equal(isEligible({ user_id: U1, kind, company_id: null }, mem, []), false, `${kind} 업체 칸 없음`);
  }
});
