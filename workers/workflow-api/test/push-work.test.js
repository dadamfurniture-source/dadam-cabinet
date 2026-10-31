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
  workDay,
} from '../src/push/messages.js';
import { isEligible } from '../src/push/sender.js';
import {
  later,
  notifyWorkerStatus,
  notifyWorkInvited,
  notifyWorkAssigned,
  notifyWorkSchedule,
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
