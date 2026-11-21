/**
 * 프로젝트 한 건 (src/company-project.js) — GET /company/projects/:id
 * 2026-11-21 대표님 승인 계획 「프로젝트 한 길」 묶음 4: 프로젝트 하나의 처음부터 끝을 한 창에서.
 *
 * 고정하는 것
 *   1) project 는 목록(GET /company/projects)의 그 줄과 같은 칸이다 — 단계 · 다음 할 일이 어긋나지 않는다
 *   2) 설계 · 견적(거둔 것 · 밀린 판 뺌) · 수주(취소 포함) · 계약금 받음 · A/S · 일어난 일(오래된 것부터)
 *   3) 영업 사원 업체 = 내가 낸 제작 의뢰, 팩토리 = 받은 의뢰가 일어난 일에
 *   4) 금액 · 주소 · A/S 글은 싣지 않는다. 다른 업체 것 · 없는 것은 404, 구성원이 아니면 403, 캐시하지 않는다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { HISTORY_LABEL } from '../src/company-project.js';
import { NEWS_LABEL } from '../src/company-inbox.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A = cid(1); // 팩토리 (Agent)
const M = cid(4); // 영업 사원 업체 (Manager 등급)
const B = cid(2); // 다른 팩토리
const OWNER_A = uid(11);
const STAFF_A = uid(13);
const OWNER_M = uid(52);
const OWNER_B = uid(21);
const NOBODY = uid(90);

const CUS = rid(1);
const P1 = rid(11); // A — 설계 · 견적 · 수주 · A/S 가 모두 있는 프로젝트
const P2 = rid(12); // A — 막 생긴 프로젝트
const P3 = rid(13); // A — 제작 의뢰를 받아 생긴 프로젝트
const PM = rid(14); // M — 제작 의뢰를 낸 프로젝트
const PB = rid(15); // B
const D1 = rid(21);
const D2 = rid(22);
const DB = rid(29);
const Q_OLD = rid(31);
const Q_NOW = rid(32);
const Q_GONE = rid(33);
const O_DEAD = rid(41);
const O_LIVE = rid(42);
const OB = rid(49);

const at = (d, h = 9) =>
  `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

function tables() {
  const doc = (id, design_id, extra) => ({
    id,
    design_id,
    doc_type: 'customer_confirmation',
    status: 'issued',
    decision: null,
    decided_at: null,
    first_viewed_at: null,
    view_count: 0,
    expires_at: '2099-01-01T00:00:00Z',
    superseded_by: null,
    total_amount: 9900000,
    customer_name: '김고객',
    ...extra,
  });
  return {
    companies: [
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: M, kind: 'partner', name: '사아 영업', plan: 'manager', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: M, user_id: OWNER_M, role: 'owner', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    profiles: [
      { id: OWNER_A, name: '가대표' },
      { id: STAFF_A, name: '나직원' },
    ],
    customers: [
      {
        id: CUS,
        company_id: A,
        user_id: null,
        name: '김고객',
        phone: '010-1111-2222',
        address: '예시시 예시로 1',
      },
    ],
    projects: [
      {
        id: P1,
        company_id: A,
        customer_id: CUS,
        title: '예시 주방',
        status: 'active',
        created_at: at(1),
        assignee_id: STAFF_A,
      },
      {
        id: P2,
        company_id: A,
        customer_id: null,
        title: '막 생긴 것',
        status: 'active',
        created_at: at(20),
      },
      {
        id: P3,
        company_id: A,
        customer_id: null,
        title: '받은 의뢰',
        status: 'active',
        created_at: at(18),
      },
      {
        id: PM,
        company_id: M,
        customer_id: null,
        title: '영업 신발장',
        status: 'active',
        created_at: at(10),
      },
      {
        id: PB,
        company_id: B,
        customer_id: null,
        title: '남의 프로젝트',
        status: 'active',
        created_at: at(2),
      },
    ],
    designs: [
      {
        id: D1,
        company_id: A,
        user_id: OWNER_A,
        project_id: P1,
        name: '주방 1안',
        created_at: at(2),
        updated_at: at(3),
      },
      {
        id: D2,
        company_id: A,
        user_id: OWNER_A,
        project_id: P1,
        name: null,
        created_at: at(4),
        updated_at: at(8),
      },
      {
        id: rid(23),
        company_id: A,
        user_id: OWNER_A,
        project_id: null,
        name: '잇지 않은 설계',
        created_at: at(4),
        updated_at: at(9),
      },
      {
        id: DB,
        company_id: B,
        user_id: OWNER_B,
        project_id: PB,
        name: '남의 설계',
        created_at: at(2),
        updated_at: at(2),
      },
    ],
    design_documents: [
      doc(Q_OLD, D1, { status: 'superseded', superseded_by: Q_NOW, created_at: at(3) }), // 새 판에 밀림
      doc(Q_NOW, D1, {
        status: 'approved',
        decision: 'approved',
        created_at: at(5),
        first_viewed_at: at(6),
        view_count: 3,
        decided_at: at(7),
      }),
      doc(Q_GONE, D2, { status: 'revoked', created_at: at(8) }), // 거둔 것
      { ...doc(rid(34), D1, { created_at: at(8) }), doc_type: 'work_order' }, // 견적이 아니다
      doc(rid(39), DB, { created_at: at(2) }), // 남의 것
    ],
    orders: [
      // 취소된 수주 — 목록에는 남고, 배송 · 완료는 일어난 일에 적지 않는다
      {
        id: O_DEAD,
        company_id: A,
        project_id: P1,
        document_id: null,
        order_no: 'A-001',
        status: 'cancelled',
        ordered_at: at(7, 10),
        delivered_at: at(7, 11),
        completed_at: null,
        contract_amount: 5000000,
      },
      {
        id: O_LIVE,
        company_id: A,
        project_id: P1,
        document_id: Q_NOW,
        order_no: 'A-002',
        status: 'completed',
        ordered_at: at(8),
        delivered_at: at(15),
        completed_at: at(16),
        contract_amount: 9900000,
      },
      {
        id: OB,
        company_id: B,
        project_id: PB,
        order_no: 'B-001',
        status: 'confirmed',
        ordered_at: at(3),
      },
    ],
    order_payments: [
      { id: rid(51), order_id: O_LIVE, stage: 'deposit', amount: 3000000, paid_on: '2026-10-08' },
      { id: rid(52), order_id: O_LIVE, stage: 'balance', amount: 6900000, paid_on: '2026-10-17' }, // 계약금 줄만 본다
      { id: rid(53), order_id: O_DEAD, stage: 'deposit', amount: 1000000, paid_on: null },
      { id: rid(59), order_id: OB, stage: 'deposit', amount: 777000, paid_on: '2026-10-03' },
    ],
    order_events: [
      {
        id: rid(61),
        company_id: A,
        order_id: O_LIVE,
        kind: 'revert',
        state: 'rejected',
        created_at: at(12),
        decided_at: at(13),
      },
      {
        id: rid(62),
        company_id: A,
        order_id: O_LIVE,
        kind: 'revert',
        state: 'pending',
        created_at: at(14),
      }, // 아직 답 없음 — 일어난 일이 아니다
      {
        id: rid(69),
        company_id: B,
        order_id: OB,
        kind: 'revert',
        state: 'approved',
        created_at: at(3),
        decided_at: at(4),
      },
    ],
    as_requests: [
      {
        id: rid(71),
        company_id: A,
        order_id: O_LIVE,
        state: 'done',
        body: '문짝이 처졌어요',
        photos: ['x.jpg'],
        created_at: at(21),
        received_at: at(22),
        done_at: at(24),
      },
      {
        id: rid(72),
        company_id: A,
        order_id: O_LIVE,
        state: 'requested',
        body: '손잡이',
        created_at: at(25),
        received_at: null,
        done_at: null,
      },
      {
        id: rid(79),
        company_id: B,
        order_id: OB,
        state: 'requested',
        body: '남의 것',
        created_at: at(5),
      },
    ],
    production_requests: [
      // 영업 사원(M)이 낸 의뢰 — 팩토리(A)가 받아 프로젝트(P3)가 생겼다 · 거둔 것
      {
        id: rid(81),
        company_id: M,
        project_id: PM,
        status: 'accepted',
        status_at: at(18),
        factory_company_id: A,
        factory_project_id: P3,
        factory_draft_id: 'd-9',
        created_at: at(12),
      },
      {
        id: rid(82),
        company_id: M,
        project_id: PM,
        status: 'cancelled',
        status_at: at(11),
        factory_company_id: null,
        created_at: at(10),
      },
    ],
    generations: [],
    design_schedules: [], // 담당자 후보(company-assignee.js)가 읽는다
  };
}

const fakeOf = () => createFake({ tables: tables() });
const call = (fake, id, token) => callWorker(worker, fake, `/company/projects/${id}`, token);
const dataOf = async (fake, id, token) => {
  const r = await call(fake, id, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};

test('이름 — 일어난 일의 글은 받은 일의 소식과 같은 말에 프로젝트 창의 것을 더한 것이다', () => {
  for (const [k, v] of Object.entries(NEWS_LABEL)) assert.equal(HISTORY_LABEL[k], v);
  for (const k of ['project_created', 'design_linked', 'deposit_paid', 'as_received', 'as_done'])
    assert.ok(typeof HISTORY_LABEL[k] === 'string' && HISTORY_LABEL[k], k);
});

test('project 는 목록의 그 줄과 같다 — 단계 · 다음 할 일 · 고객 · 담당자 · 설계 수', async () => {
  const fake = fakeOf();
  for (const [id, token] of [
    [P1, OWNER_A],
    [P1, STAFF_A],
    [P2, OWNER_A],
    [P3, OWNER_A],
    [PM, OWNER_M],
  ]) {
    const list = await callWorker(worker, fake, '/company/projects', token);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const row = list.json.data.items.find((x) => x.id === id);
    const d = await dataOf(fake, id, token);
    assert.deepEqual(d.project, row, `${id} · ${token}`);
    assert.equal(d.role, list.json.data.role);
    assert.equal(d.can_manage, list.json.data.can_manage);
  }
  const d = await dataOf(fake, P1, OWNER_A);
  assert.deepEqual(d.project.customer, { id: CUS, name: '김고객', phone: '010-1111-2222' });
  assert.deepEqual(d.project.assignee, { user_id: STAFF_A, name: '나직원', role: 'staff' });
  // 끝난 수주에 답을 기다리는 요청이 걸려 있다 — 대표에게는 승인이 먼저다 (pipeline.js 판정 차례)
  assert.deepEqual(
    [d.project.design_count, d.project.step, d.project.next.key],
    [2, 'done', 'approve']
  );
  // 막 생긴 프로젝트 — 설계 시작
  const fresh = await dataOf(fake, P2, OWNER_A);
  assert.deepEqual(
    [fresh.project.step, fresh.project.next.key, fresh.project.next.go],
    ['consult', 'design_start', `planner?project=${P2}`]
  );
});

test('팩토리 — 설계 · 견적 · 수주 · A/S: 이 프로젝트의 것만, 거둔 견적 · 밀린 판은 빼고, 취소 수주는 남긴다', async () => {
  const fake = fakeOf();
  const res = await call(fake, P1, OWNER_A);
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private');
  const d = res.json.data;
  assert.deepEqual(Object.keys(d), [
    'role',
    'can_manage',
    'project',
    'designs',
    'quotes',
    'orders',
    'requests',
    'as',
    'history',
  ]);
  // 최근 고친 설계부터
  assert.deepEqual(d.designs, [
    { id: D2, name: null, updated_at: at(8) },
    { id: D1, name: '주방 1안', updated_at: at(3) },
  ]);
  assert.deepEqual(d.quotes, [
    {
      id: Q_NOW,
      design_id: D1,
      created_at: at(5),
      expires_at: '2099-01-01T00:00:00Z',
      first_viewed_at: at(6),
      view_count: 3,
      decision: 'approved',
      decided_at: at(7),
    },
  ]);
  // 새 수주부터. 계약금은 받았나만 (금액 없음)
  assert.deepEqual(d.orders, [
    {
      id: O_LIVE,
      order_no: 'A-002',
      status: 'completed',
      ordered_at: at(8),
      delivered_at: at(15),
      completed_at: at(16),
      deposit: 'paid',
    },
    {
      id: O_DEAD,
      order_no: 'A-001',
      status: 'cancelled',
      ordered_at: at(7, 10),
      delivered_at: at(7, 11),
      completed_at: null,
      deposit: 'unpaid',
    },
  ]);
  assert.deepEqual(d.requests, []);
  assert.deepEqual(d.as, [
    { id: rid(72), state: 'requested', created_at: at(25), received_at: null, done_at: null },
    { id: rid(71), state: 'done', created_at: at(21), received_at: at(22), done_at: at(24) },
  ]);
  // 금액 · 주소 · A/S 글 · 사진 · 다른 업체 것은 어디에도 없다
  const text = JSON.stringify(d);
  for (const secret of [
    '9900000',
    '5000000',
    '3000000',
    '예시시',
    '문짝',
    'x.jpg',
    '남의',
    OB,
    DB,
    PB,
  ])
    assert.equal(text.includes(secret), false, secret);
});

test('일어난 일 — 오래된 것부터: 프로젝트 → 설계 → 견적 보냄 · 열어 봄 · 승인 → 수주 → 계약금 → 배송 · 완료 → A/S', async () => {
  const d = await dataOf(fakeOf(), P1, OWNER_A);
  assert.deepEqual(
    d.history.map((h) => [h.kind, h.at, h.go]),
    [
      ['project_created', at(1), null],
      ['design_linked', at(2), null],
      ['design_linked', at(4), null],
      ['quote_sent', at(5), 'p-quote'],
      ['quote_viewed', at(6), 'p-quote'],
      ['quote_approved', at(7), 'p-quote'],
      ['order_created', at(7, 10), 'p-contract'], // 취소된 수주도 생긴 일은 남는다 (배송 · 완료는 적지 않는다)
      ['order_created', at(8), 'p-contract'],
      ['deposit_paid', '2026-10-08', 'p-contract'], // 입금일은 날짜뿐 — 그날 생긴 수주 뒤에 온다
      ['approval_rejected', at(13), 'p-contract'],
      ['order_delivered', at(15), 'p-install'],
      ['order_completed', at(16), 'p-install'],
      ['as_requested', at(21), 'p-as'],
      ['as_received', at(22), 'p-as'],
      ['as_done', at(24), 'p-as'],
      ['as_requested', at(25), 'p-as'],
    ]
  );
  for (const h of d.history) assert.equal(h.label, HISTORY_LABEL[h.kind]);
  // 고객이 수정을 요청한 견적
  const fake = fakeOf();
  Object.assign(
    fake.db.design_documents.find((x) => x.id === Q_NOW),
    { status: 'rejected', decision: 'rejected' }
  );
  const again = await dataOf(fake, P1, OWNER_A);
  assert.ok(again.history.some((h) => h.kind === 'quote_rejected' && h.at === at(7)));
  assert.equal(
    again.history.some((h) => h.kind === 'quote_approved'),
    false
  );
});

test('제작 의뢰 — 영업 사원 업체는 내가 낸 의뢰(거둔 것 뺌), 팩토리는 받은 의뢰가 일어난 일에', async () => {
  const fake = fakeOf();
  const m = await dataOf(fake, PM, OWNER_M);
  assert.deepEqual(m.requests, [{ id: rid(81), status: 'accepted', status_at: at(18) }]);
  assert.deepEqual(
    m.history.map((h) => [h.kind, h.at, h.go]),
    [
      ['project_created', at(10), null],
      ['request_accepted', at(18), 'p-make'],
    ]
  );
  assert.deepEqual(m.as, []); // 영업 사원 업체는 A/S 를 받지 않는다
  const f = await dataOf(fake, P3, OWNER_A);
  assert.deepEqual(f.requests, []); // 팩토리가 낸 의뢰는 없다
  assert.deepEqual(
    f.history.map((h) => [h.kind, h.at]),
    [
      ['project_created', at(18)],
      ['request_received', at(18)],
    ]
  );
  assert.equal(f.project.step, 'make'); // 의뢰를 받아 생긴 프로젝트는 생산부터
});

test('다음 할 일 값을 못 모아도 나머지는 그대로 준다 (step · next 없이)', async () => {
  const fake = fakeOf();
  delete fake.db.order_events; // company-pipeline.js 가 읽는 표가 없다
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const d = await dataOf(fake, P2, OWNER_A);
    assert.equal('step' in d.project, false);
    assert.equal('next' in d.project, false);
    assert.deepEqual([d.project.id, d.project.stage], [P2, 'consult']);
    assert.deepEqual(
      d.history.map((h) => h.kind),
      ['project_created']
    );
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /company project: pipeline failed/);
});

test('막는 것 — 다른 업체의 프로젝트 · 없는 프로젝트는 404, 번호가 이상하면 422, 구성원이 아니면 403, 로그인 없으면 401', async () => {
  const fake = fakeOf();
  assert.equal((await call(fake, PB, OWNER_A)).status, 404);
  assert.equal((await call(fake, P1, OWNER_B)).status, 404);
  assert.equal((await call(fake, rid(999), OWNER_A)).status, 404);
  assert.equal((await call(fake, 'not-a-uuid', OWNER_A)).status, 422);
  assert.equal((await call(fake, P1, NOBODY)).status, 403);
  assert.equal((await call(fake, P1, null)).status, 401);
  // 읽기만 — 아무것도 쓰지 않는다
  const before = JSON.stringify(fake.db);
  await call(fake, P1, OWNER_A);
  assert.equal(JSON.stringify(fake.db), before);
});

test('옆 길을 가리지 않는다 — /company/projects/:id/assignee-candidates · /work 는 그대로 제 길로 간다', async () => {
  const fake = fakeOf();
  const r = await callWorker(worker, fake, `/company/projects/${P1}/assignee-candidates`, OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal('history' in r.json.data, false);
});
