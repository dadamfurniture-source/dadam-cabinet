/**
 * 프로젝트 상태 바꾸기 (src/company-project-status.js) — PATCH /company/projects/:id/status
 * 2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차: 보류 · 그만둠 · 다시 진행.
 *
 * 고정하는 것
 *   1) 계약금을 받으면 보류 · 그만둠은 작동하지 않는다 (대표님 2026-11-21) — 다시 진행은 언제든
 *   2) 누가 — 대표 · 실장 · 그 프로젝트의 담당자. 되살리기(그만둠 → 진행)는 대표 · 실장만
 *   3) 그만둠은 살아 있는 수주가 있으면 수주 취소부터. 다시 볼 날은 보류일 때만 · 오늘부터, 보류가 풀리면 비운다
 *   4) 그 사이 바뀌었으면 409 stale. 끝난 · 넘긴 프로젝트는 못 바꾼다. 남의 업체 것은 404
 *   5) 바꾼 뒤 일지(project_events)에 누가 · 무엇에서 무엇으로 한 줄
 *   6) 판정(pipeline.js) — 보류는 단계를 그대로 두고 다음 할 일을 없앤다. 다시 볼 날이 되면 hold_due
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  MOVES,
  SETTABLE,
  STATUS_NOTE_MAX,
  statusActions,
  todayKst,
} from '../src/company-project-status.js';
import { NEXT_LABEL, nextStep, stepOf } from '../src/pipeline.js';
import { eventRow, logProject } from '../src/project-log.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A = cid(1);
const B = cid(2);
const OWNER = uid(11);
const MANAGER = uid(12);
const STAFF = uid(13); // P1 의 담당자
const STAFF2 = uid(14);
const OWNER_B = uid(21);
const NOBODY = uid(90);
const CUS = rid(1);
const P1 = rid(11); // 진행 중 · 담당 STAFF · 수주 없음
const P2 = rid(12); // 진행 중 · 접수 수주 (계약금 전)
const P3 = rid(13); // 진행 중 · 계약금 받음
const P4 = rid(14); // 끝난 프로젝트
const PB = rid(15); // 남의 업체
const O2 = rid(22);
const O3 = rid(23);

const kst = (s) => Date.parse(`${s}+09:00`);
const NOW = kst('2026-11-21T10:00:00');

function tables() {
  const project = (id, extra = {}) => ({
    id,
    company_id: A,
    customer_id: CUS,
    title: '예시',
    status: 'active',
    created_at: '2026-11-01T00:00:00Z',
    assignee_id: null,
    hold_until: null,
    status_note: null,
    status_at: null,
    status_by: null,
    ...extra,
  });
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
      { company_id: A, user_id: STAFF2, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    customers: [{ id: CUS, company_id: A, name: '김고객', phone: '010-1111-2222' }],
    projects: [
      project(P1, { assignee_id: STAFF }),
      project(P2),
      project(P3),
      project(P4, { status: 'closed' }),
      project(PB, { company_id: B }),
    ],
    orders: [
      { id: O2, company_id: A, project_id: P2, status: 'confirmed' },
      { id: O3, company_id: A, project_id: P3, status: 'in_production' },
      { id: rid(24), company_id: A, project_id: P1, status: 'cancelled' }, // 취소된 수주는 세지 않는다
    ],
    order_payments: [
      { id: rid(31), order_id: O2, stage: 'deposit', paid_on: null },
      { id: rid(32), order_id: O3, stage: 'deposit', paid_on: '2026-11-10' },
      { id: rid(33), order_id: rid(24), stage: 'deposit', paid_on: '2026-11-02' }, // 취소된 수주의 계약금
    ],
    project_events: [],
  };
}

const fakeOf = () => createFake({ tables: tables() });
async function patch(fake, id, body, token = OWNER) {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    return await callWorker(worker, fake, `/company/projects/${id}/status`, token, {
      method: 'PATCH',
      body,
    });
  } finally {
    Date.now = realNow;
  }
}
const rowOf = (fake, id) => fake.db.projects.find((p) => p.id === id);

test('이름 — 갈 수 있는 상태 셋 · 길 · 메모 200자 · 오늘은 한국 날짜', () => {
  assert.deepEqual([...SETTABLE], ['on_hold', 'cancelled', 'active']);
  assert.deepEqual(MOVES, {
    active: ['on_hold', 'cancelled'],
    on_hold: ['active', 'cancelled'],
    cancelled: ['active'],
  });
  assert.equal(STATUS_NOTE_MAX, 200);
  assert.equal(todayKst(Date.parse('2026-11-20T15:30:00Z')), '2026-11-21');
  assert.equal(typeof NEXT_LABEL.hold_due, 'string');
});

test('statusActions (순수) — 계약금을 받으면 보류 · 그만둠 없음, 수주가 살아 있으면 그만둠 없음, 직책 · 담당자', () => {
  const owner = { role: 'owner', user_id: OWNER };
  const staff = { role: 'staff', user_id: STAFF };
  const free = { live: 0, deposit: false };
  const p = (status, assignee_id = null) => ({ status, assignee_id });
  assert.deepEqual(statusActions(p('active'), owner, free), {
    hold: true,
    cancel: true,
    resume: false,
    blocked: null,
  });
  assert.deepEqual(statusActions(p('active'), owner, { live: 1, deposit: false }), {
    hold: true,
    cancel: false,
    resume: false,
    blocked: 'order',
  });
  assert.deepEqual(statusActions(p('active'), owner, { live: 1, deposit: true }), {
    hold: false,
    cancel: false,
    resume: false,
    blocked: 'deposit',
  });
  // 직원 — 담당자일 때만
  assert.deepEqual(statusActions(p('active'), staff, free), {
    hold: false,
    cancel: false,
    resume: false,
    blocked: 'role',
  });
  assert.deepEqual(statusActions(p('active', STAFF), staff, free), {
    hold: true,
    cancel: true,
    resume: false,
    blocked: null,
  });
  // 보류 — 다시 진행은 언제든. 보류 중에 계약금이 들어왔으면 그만둠은 없다
  assert.deepEqual(statusActions(p('on_hold'), owner, free), {
    hold: false,
    cancel: true,
    resume: true,
    blocked: null,
  });
  assert.deepEqual(statusActions(p('on_hold'), owner, { live: 1, deposit: true }), {
    hold: false,
    cancel: false,
    resume: true,
    blocked: null,
  });
  // 그만둠 — 되살리기는 대표 · 실장만
  assert.equal(statusActions(p('cancelled'), owner, free).resume, true);
  assert.equal(statusActions(p('cancelled', STAFF), staff, free).resume, false);
  // 끝남 · 넘김 — 아무것도
  assert.deepEqual(statusActions(p('closed'), owner, free), {
    hold: false,
    cancel: false,
    resume: false,
    blocked: null,
  });
  assert.deepEqual(statusActions(p('handed_over'), owner, free), {
    hold: false,
    cancel: false,
    resume: false,
    blocked: null,
  });
});

test('보류 — 다시 볼 날 · 메모와 함께, 바꾼 때 · 사람을 적고 일지에 한 줄. 다시 진행하면 다시 볼 날이 빈다', async () => {
  const fake = fakeOf();
  const r = await patch(fake, P1, {
    status: 'on_hold',
    hold_until: '2026-12-05',
    note: '  이사 날짜 미정  ',
    expect_status: 'active',
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, {
    project_id: P1,
    status: 'on_hold',
    hold_until: '2026-12-05',
    status_note: '이사 날짜 미정',
    status_at: new Date(NOW).toISOString(),
  });
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const row = rowOf(fake, P1);
  assert.deepEqual(
    [row.status, row.hold_until, row.status_note, row.status_by],
    ['on_hold', '2026-12-05', '이사 날짜 미정', OWNER]
  );
  // 일지 — 누가 · 무엇에서 무엇으로. 메모(글)는 싣지 않는다
  assert.equal(fake.db.project_events.length, 1);
  const ev = fake.db.project_events[0];
  assert.deepEqual(
    [
      ev.company_id,
      ev.project_id,
      ev.actor_user_id,
      ev.actor_kind,
      ev.type,
      ev.subject_type,
      ev.subject_id,
      ev.from_status,
      ev.to_status,
    ],
    [A, P1, OWNER, 'member', 'status_changed', 'project', P1, 'active', 'on_hold']
  );
  assert.deepEqual(ev.payload, { hold_until: '2026-12-05' });
  assert.equal(JSON.stringify(ev).includes('이사'), false);
  // 다시 진행 — 담당자(직원)도 된다. 다시 볼 날 · 메모가 빈다
  const back = await patch(fake, P1, { status: 'active' }, STAFF);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(
    [
      rowOf(fake, P1).status,
      rowOf(fake, P1).hold_until,
      rowOf(fake, P1).status_note,
      rowOf(fake, P1).status_by,
    ],
    ['active', null, null, STAFF]
  );
  assert.deepEqual(
    fake.db.project_events.map((e) => [e.from_status, e.to_status, e.actor_user_id]),
    [
      ['active', 'on_hold', OWNER],
      ['on_hold', 'active', STAFF],
    ]
  );
});

test('계약금을 받으면 보류 · 그만둠은 작동하지 않는다 — 409 deposit_paid, 아무것도 바뀌지 않는다', async () => {
  const fake = fakeOf();
  for (const status of ['on_hold', 'cancelled']) {
    const r = await patch(fake, P3, { status });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, 'deposit_paid');
    assert.match(r.json.message, /계약금을 받은 프로젝트/);
  }
  assert.equal(rowOf(fake, P3).status, 'active');
  assert.equal(fake.db.project_events.length, 0);
  // 계약금 줄이 있어도 아직 안 받았으면 보류는 된다 — 그만둠은 살아 있는 수주 때문에 수주 취소부터
  const cancel = await patch(fake, P2, { status: 'cancelled' });
  assert.equal(cancel.status, 409);
  assert.equal(cancel.json.code, 'has_order');
  assert.equal((await patch(fake, P2, { status: 'on_hold' })).status, 200);
  // 보류 중에 계약금이 들어왔다 — 다시 진행은 되고, 그만둠은 안 된다
  fake.db.order_payments.find((p) => p.order_id === O2).paid_on = '2026-11-21';
  const cancel2 = await patch(fake, P2, { status: 'cancelled' });
  assert.equal([cancel2.status, cancel2.json.code].join(' '), '409 deposit_paid');
  assert.equal((await patch(fake, P2, { status: 'active' })).status, 200);
  // 취소된 수주의 계약금은 세지 않는다 (P1)
  assert.equal((await patch(fake, P1, { status: 'cancelled', note: '고객 포기' })).status, 200);
});

test('누가 — 대표 · 실장 · 담당자. 다른 직원은 403, 그만둔 프로젝트는 대표 · 실장만 되살린다', async () => {
  const fake = fakeOf();
  const no = await patch(fake, P1, { status: 'on_hold' }, STAFF2);
  assert.equal([no.status, no.json.code].join(' '), '403 not_allowed');
  assert.equal((await patch(fake, P1, { status: 'on_hold' }, STAFF)).status, 200); // 담당자
  assert.equal((await patch(fake, P1, { status: 'cancelled' }, MANAGER)).status, 200); // 실장
  const revive = await patch(fake, P1, { status: 'active' }, STAFF);
  assert.equal([revive.status, revive.json.code].join(' '), '403 not_allowed');
  assert.match(revive.json.message, /대표 · 실장이 되살립니다/);
  assert.equal((await patch(fake, P1, { status: 'active' }, OWNER)).status, 200);
  assert.equal(rowOf(fake, P1).status, 'active');
});

test('그 사이 바뀜 · 같은 상태 · 못 바꾸는 상태', async () => {
  const fake = fakeOf();
  const stale = await patch(fake, P1, { status: 'on_hold', expect_status: 'on_hold' });
  assert.equal([stale.status, stale.json.code].join(' '), '409 stale');
  // 같은 상태 — 그대로 돌려주고 쓰지 않는다
  const same = await patch(fake, P1, { status: 'active' });
  assert.equal(same.status, 200);
  assert.equal(same.json.data.status, 'active');
  assert.equal(fake.calls.filter((c) => c.method === 'PATCH').length, 0);
  // 끝난 프로젝트
  const closed = await patch(fake, P4, { status: 'on_hold' });
  assert.equal([closed.status, closed.json.code].join(' '), '409 not_movable');
  // 다른 사람이 먼저 바꿨다 (읽은 뒤 · 쓰기 전) — 조건부 쓰기가 한 줄도 못 바꾼다
  const racing = fakeOf();
  const realFetch = racing.fetch;
  racing.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PATCH') rowOf(racing, P1).status = 'cancelled';
    return realFetch(url, init);
  };
  const lost = await patch(racing, P1, { status: 'on_hold' });
  assert.equal([lost.status, lost.json.code].join(' '), '409 stale');
});

test('보내기 전 검사 — 상태 · 다시 볼 날(보류일 때만 · 오늘부터 · 날짜 꼴) · 메모 200자', async () => {
  const fake = fakeOf();
  for (const body of [
    null,
    {},
    { status: 'closed' },
    { status: 'paused' },
    { status: 'cancelled', hold_until: '2026-12-01' },
    { status: 'on_hold', hold_until: '2026-11-20' }, // 어제 (한국 날짜)
    { status: 'on_hold', hold_until: '12/05' },
    { status: 'on_hold', hold_until: '2026-13-40' },
    { status: 'on_hold', note: 12 },
    { status: 'on_hold', note: '가'.repeat(201) },
  ]) {
    const r = await patch(fake, P1, body);
    assert.equal(r.status, 422, JSON.stringify([body, r.json]));
  }
  // 오늘은 된다 · 200자는 된다 · 빈 메모는 없는 것으로
  assert.equal(
    (await patch(fake, P1, { status: 'on_hold', hold_until: '2026-11-21', note: '가'.repeat(200) }))
      .status,
    200
  );
  assert.equal(
    (await patch(fake, P2, { status: 'on_hold', hold_until: null, note: '   ' })).json.data
      .status_note,
    null
  );
  assert.equal(fake.calls.filter((c) => c.method === 'PATCH').length, 2);
});

test('막는 것 — 남의 업체 · 없는 프로젝트 404, 구성원이 아니면 403, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  assert.equal((await patch(fake, PB, { status: 'on_hold' })).status, 404);
  assert.equal((await patch(fake, P1, { status: 'on_hold' }, OWNER_B)).status, 404);
  assert.equal((await patch(fake, rid(999), { status: 'on_hold' })).status, 404);
  assert.equal((await patch(fake, 'x', { status: 'on_hold' })).status, 404);
  assert.equal((await patch(fake, P1, { status: 'on_hold' }, NOBODY)).status, 403);
  assert.equal((await patch(fake, P1, { status: 'on_hold' }, null)).status, 401);
  assert.equal(rowOf(fake, P1).status, 'active');
});

test('판정 — 보류는 단계를 멈춘 자리 그대로 두고 다음 할 일이 없다. 다시 볼 날(한국 날짜)이 되면 hold_due', () => {
  const held = (extra = {}) => ({
    id: P1,
    status: 'on_hold',
    stage: 'quote',
    quote: { id: rid(50), created_at: '2026-11-01T00:00:00Z' },
    ...extra,
  });
  const owner = { role: 'owner', user_id: OWNER };
  assert.equal(stepOf(held()), 'quote'); // 끝(done)이 아니다
  assert.equal(nextStep(held(), owner, NOW), null);
  assert.equal(nextStep(held({ hold_until: '2026-11-22' }), owner, NOW), null);
  const due = nextStep(held({ hold_until: '2026-11-21' }), owner, NOW);
  assert.deepEqual(
    [due.key, due.go, due.wait, due.allowed, due.since],
    ['hold_due', 'sheet', false, true, '2026-11-21']
  );
  assert.equal(
    nextStep(held({ hold_until: '2026-11-01' }), { role: 'staff', user_id: STAFF2 }, NOW).key,
    'hold_due'
  );
  // 그만둠 · 끝남은 지금처럼 끝
  assert.equal(stepOf({ status: 'cancelled', stage: 'quote' }), 'done');
  assert.equal(nextStep({ status: 'cancelled', stage: 'quote' }, owner, NOW), null);
});

test('일지 도우미 — 모자란 값은 적지 않고, 던지지 않는다 (표가 없어도 · 저장이 실패해도)', async () => {
  assert.equal(eventRow(null), null);
  assert.equal(eventRow({ companyId: A, projectId: 'x', type: 'a' }), null);
  assert.equal(eventRow({ companyId: A, projectId: P1, type: '' }), null);
  assert.equal(eventRow({ companyId: A, projectId: P1, type: 'a'.repeat(41) }), null);
  // 사람 id 가 없으면 서버(자동), 모르는 종류는 사람 id 로 정한다
  assert.equal(eventRow({ companyId: A, projectId: P1, type: 'x' }).actor_kind, 'system');
  assert.equal(
    eventRow({ companyId: A, projectId: P1, type: 'x', actor: { id: OWNER, kind: 'robot' } })
      .actor_kind,
    'member'
  );
  assert.deepEqual(
    eventRow({
      companyId: A,
      projectId: P1,
      type: 'quote_approved',
      actor: { kind: 'customer' },
      subject: { type: 'document', id: rid(5) },
    }),
    {
      company_id: A,
      project_id: P1,
      actor_user_id: null,
      actor_kind: 'customer',
      type: 'quote_approved',
      subject_type: 'document',
      subject_id: rid(5),
      from_status: null,
      to_status: null,
      payload: {},
    }
  );
  // 너무 큰 payload 는 버리고 사건은 적는다
  assert.deepEqual(
    eventRow({ companyId: A, projectId: P1, type: 'x', payload: { big: 'a'.repeat(3000) } })
      .payload,
    {}
  );
  // 저장이 실패해도 던지지 않는다
  const warns = [];
  const original = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: '23503', message: 'fk' }), { status: 409 });
  try {
    await logProject({ SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, null, {
      companyId: A,
      projectId: P1,
      type: 'x',
    });
    // 표가 아직 없으면 경고도 없이 넘어간다
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'PGRST205', message: 'PGRST205 no table' }), {
        status: 404,
      });
    await logProject({ SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, null, {
      companyId: A,
      projectId: P1,
      type: 'x',
    });
  } finally {
    globalThis.fetch = realFetch;
    console.warn = original;
  }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /project log: skipped/);
  // ctx 가 있으면 응답 뒤로 미룬다
  const waits = [];
  const fake = fakeOf();
  const prev = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    await logProject(
      { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service' },
      { waitUntil: (p) => waits.push(p) },
      { companyId: A, projectId: P1, type: 'x' }
    );
    assert.equal(waits.length, 1);
    await Promise.all(waits);
  } finally {
    globalThis.fetch = prev;
  }
});
