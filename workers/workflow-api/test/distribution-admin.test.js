/**
 * 다담 본사 상담 분배 — 관리자 길 (src/distribution/admin.js 를 워커로 부른다).
 *   GET /admin/consult-inbox · GET /admin/consultations/:id/candidates · POST /admin/consultations/:id/assign
 *   GET /admin/companies · GET|PUT /admin/companies/:id/evaluation
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { COPY_FIELDS } from '../src/distribution/admin.js';
import { RULES_VERSION } from '../src/distribution/rules.js';
import { createFake, callWorker, writesOf } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ADMIN = uid(1);
const OUTSIDER = uid(2);
const OWNER_A = uid(11);
const MANAGER_A = uid(12);
const STAFF_A = uid(13);
const REMOVED_A = uid(14);
const OWNER_B = uid(21);
const CUSTOMER = uid(31);

const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const C = cid(3);
const D = cid(4);
const E = cid(5);
const F = cid(6);
const G = cid(7);

const P1 = sid(1); // 대기 — 배정할 상담
const P2 = sid(2); // 배정됨 — B 가 답을 기다림
const P3 = sid(3); // 취소
const P4 = sid(4); // 대기 — C 가 못 받음
const COPY_OLD = sid(5); // A 의 사본 (목록에 나오지 않는다)
const FACTORY_OLD = sid(6); // 공장 옛 상담 (목록에 나오지 않는다)
const P7 = sid(7); // 대기 — 업체 제공 동의 없음 (본사 직접 상담)

const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
/** 오늘(KST)에서 days 날 뒤 'YYYY-MM-DD' — 서버가 오늘 + 고객 확정 ~ 시공 완료 기간으로 세므로 날짜를 박아 두지 않는다 */
const kstDay = (days) =>
  new Date(Date.now() + 9 * 3600 * 1000 + days * 86400000).toISOString().slice(0, 10);
const DOCS = {
  insurance: { checked_at: '2026-10-01T00:00:00Z', by: ADMIN },
  contract: { checked_at: '2026-10-01T00:00:00Z', by: ADMIN },
};
const SEOUL_GANGNAM = { sido: '서울특별시', gugun: '강남구' };

const partner = (id, name, extra = {}) => ({
  id,
  kind: 'partner',
  name,
  plan: 'agent',
  status: 'active',
  sido: '서울특별시',
  gugun: '강남구',
  ...extra,
});
const svc = (company_id, extra = {}) => ({
  company_id,
  regions: [SEOUL_GANGNAM],
  items: { sink: 'do' },
  monthly_limit: 10,
  lead_days: 20,
  ...extra,
});
const evaln = (company_id, extra = {}) => ({
  company_id,
  grade: 'B',
  equipment: {},
  staff: {},
  finishes: {},
  design: {},
  install: {},
  price_tier: null,
  docs: DOCS,
  evaluated_at: '2026-10-01T00:00:00Z',
  ...extra,
});

const P1_ROW = {
  id: P1,
  company_id: PLATFORM,
  created_at: '2026-10-29T01:00:00Z',
  status: 'pending',
  user_id: CUSTOMER,
  name: '김고객',
  phone: '010-1111-2222',
  email: 'kim@example.test',
  consultation_type: 'estimate',
  title: '김고객네 주방',
  description: '상부장 높게',
  preferred_date: kstDay(2),
  preferred_time: '09:00-12:00',
  wanted_done_date: kstDay(30),
  furniture_categories: ['sink', 'not-a-key'],
  space_type: 'kitchen',
  space_width_mm: 3000,
  space_height_mm: 2300,
  space_depth_mm: 600,
  budget_range: '500-1000',
  style_preference: 'modern',
  request_detail_design: true,
  quote: { total: 5200000, items: [] },
  sido: '서울특별시',
  gugun: '강남구',
  door_finish: 'pet',
  demolition_needed: true,
  wanted_price_tier: 'mid',
  admin_memo: '본사 내부 메모',
  assigned_to: ADMIN,
  privacy_agreed_at: '2026-10-29T01:00:00Z',
  third_party_agreed_at: '2026-10-29T01:00:00Z',
  consent_version: 'v1',
  notified_at: '2026-10-29T01:05:00Z',
  generation_id: null,
  customer_id: null,
  project_id: null,
  origin_consultation_id: null,
};

function tables() {
  return {
    companies: [
      {
        id: PLATFORM,
        kind: 'platform',
        name: '다담 본사',
        plan: null,
        status: 'active',
        sido: null,
        gugun: null,
      },
      {
        id: FACTORY,
        kind: 'hq',
        name: '다담 공장',
        plan: null,
        status: 'active',
        sido: '서울특별시',
        gugun: '강남구',
      },
      partner(A, '가나 인테리어'),
      partner(B, '다라 가구', { gugun: '송파구' }),
      partner(C, '마바 공방', { sido: '경기도', gugun: '성남시' }),
      partner(D, '사아 가구'),
      partner(E, '자차 가구', { plan: 'expert' }),
      partner(F, '카타 가구', { status: 'suspended' }),
      partner(G, '파하 가구'),
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: A, user_id: REMOVED_A, role: 'owner', status: 'removed' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
    ],
    company_service_settings: [
      svc(FACTORY, { lead_days: 30 }), // 시공 완료 희망 날 그날 6
      svc(A),
      svc(B, { lead_days: 40 }), // 10일 늦음 3
      svc(C, { lead_days: 60 }), // 30일 늦음 0
      svc(D),
      svc(G, { regions: [{ sido: '부산광역시', gugun: '해운대구' }] }),
    ],
    company_evaluations: [
      evaln(FACTORY, { grade: 'A' }),
      evaln(A, {
        grade: 'S',
        finishes: { door_pet: 'yes' },
        price_tier: 'mid',
        staff: { design: 1 },
        design: { planner: true },
      }),
      evaln(B, { grade: 'B' }),
      evaln(C, { grade: 'C' }),
      evaln(D, { grade: 'S', docs: { insurance: DOCS.insurance } }),
      evaln(G, { grade: 'A' }),
    ],
    consultations: [
      P1_ROW,
      { ...P1_ROW, id: P2, status: 'assigned', created_at: '2026-10-28T01:00:00Z', name: '이고객' },
      { ...P1_ROW, id: P3, status: 'cancelled', created_at: '2026-10-27T01:00:00Z' },
      {
        ...P1_ROW,
        id: P4,
        status: 'pending',
        created_at: '2026-10-26T01:00:00Z',
        quote: null,
        generation_id: 'gen-1',
      },
      { ...P1_ROW, id: COPY_OLD, company_id: A, origin_consultation_id: P4, status: 'returned' },
      { ...P1_ROW, id: FACTORY_OLD, company_id: FACTORY },
      {
        ...P1_ROW,
        id: P7,
        created_at: '2026-10-25T01:00:00Z',
        third_party_agreed_at: null,
        consent_version: null,
      },
    ],
    consult_assignments: [
      {
        id: 'as-open',
        consultation_id: P2,
        company_id: B,
        copy_consultation_id: null,
        rank: 1,
        total: 50,
        score: {},
        state: 'assigned',
        assigned_at: ago(1),
        responded_at: null,
      },
      {
        id: 'as-declined',
        consultation_id: P4,
        company_id: C,
        copy_consultation_id: COPY_OLD,
        rank: 1,
        total: 40,
        score: {},
        state: 'declined',
        assigned_at: ago(48),
        responded_at: ago(47),
        reason: '일정',
      },
    ],
    // A 의 완료 수주 하나 (싱크대) — 품목 실적 · 고객 만족
    orders: [
      {
        id: 'o-a1',
        company_id: A,
        status: 'completed',
        ordered_at: '2026-06-01T00:00:00Z',
        completed_at: '2026-07-01T00:00:00Z',
        snapshot_id: 's-a1',
      },
    ],
    design_snapshots: [
      { id: 's-a1', design_payload: { items: [{ categoryId: 'sink', modules: [] }] } },
    ],
    install_feedback: [{ id: 'f-a1', order_id: 'o-a1', score: 8 }],
    generations: [{ id: 'gen-1', category: 'sink' }],
  };
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), admins: [ADMIN], ...opts });
const call = (fake, path, token = ADMIN, init) => callWorker(worker, fake, path, token, init);
const assign = (fake, consultId, companyId, token = ADMIN) =>
  call(fake, `/admin/consultations/${consultId}/assign`, token, {
    method: 'POST',
    body: companyId === undefined ? {} : { company_id: companyId },
  });

// ── 권한 ──────────────────────────────────────────────────────

test('관리자가 아니면 모든 길이 403 not_admin, 아무것도 쓰지 않는다', async () => {
  const fake = fakeOf();
  const cases = [
    ['/admin/consult-inbox', {}],
    [`/admin/consultations/${P1}/candidates`, {}],
    [`/admin/consultations/${P1}/assign`, { method: 'POST', body: { company_id: A } }],
    ['/admin/companies?pool=1', {}],
    [`/admin/companies/${A}/evaluation`, {}],
    [`/admin/companies/${A}/evaluation`, { method: 'PUT', body: { grade: 'C' } }],
  ];
  for (const token of [OUTSIDER, OWNER_A]) {
    for (const [path, init] of cases) {
      const r = await call(fake, path, token, init);
      assert.equal(r.status, 403, `${token} ${path}`);
      assert.equal(r.json.code, 'not_admin');
    }
  }
  assert.equal(writesOf(fake).length, 0);
  assert.ok(!fake.calls.some((c) => c.table === 'consultations'), '상담을 읽지도 않는다');
});

test('로그인하지 않으면 401', async () => {
  const fake = fakeOf();
  assert.equal((await call(fake, '/admin/consult-inbox', null)).status, 401);
});

// ── 목록 ──────────────────────────────────────────────────────

test('목록 — 기본은 본사 대기 상담 (업체 사본 · 공장 상담 빼고), 거쳐 간 업체', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/admin/consult-inbox');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  const items = r.json.data.items;
  assert.deepEqual(
    items.map((i) => i.id),
    [P1, P4, P7]
  );
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'assignment',
    'consent',
    'created_at',
    'demolition_needed',
    'door_finish',
    'furniture_categories',
    'gugun',
    'has_generation',
    'id',
    'name',
    'phone',
    'preferred_date',
    'preferred_time',
    'quote_total',
    'request_detail_design',
    'sido',
    'status',
    'tried',
    'wanted_done_date',
    'wanted_price_tier',
  ]);
  assert.equal(items[0].quote_total, 5200000);
  assert.equal(items[0].has_generation, false);
  assert.equal(items[0].assignment, null);
  assert.deepEqual(items[0].tried, []);
  assert.equal(items[1].quote_total, null);
  assert.equal(items[1].has_generation, true);
  assert.deepEqual(items[1].tried, [
    { company_id: C, company_name: '마바 공방', state: 'declined' },
  ]);
  assert.ok(!('admin_memo' in items[0]));
  assert.deepEqual(
    items.map((i) => i.consent),
    [true, true, false],
    '업체 제공 동의가 없으면 본사 직접 상담'
  );
});

test('목록 — 배정됨은 기다리는 배정과 답할 기한(24시간), 전체 · 틀린 상태', async () => {
  const fake = fakeOf();
  const assigned = await call(fake, '/admin/consult-inbox?state=assigned');
  assert.deepEqual(
    assigned.json.data.items.map((i) => i.id),
    [P2]
  );
  const a = assigned.json.data.items[0].assignment;
  assert.deepEqual(Object.keys(a).sort(), [
    'assigned_at',
    'company_id',
    'company_name',
    'expires_at',
    'id',
    'state',
  ]);
  assert.equal(a.company_id, B);
  assert.equal(a.company_name, '다라 가구');
  assert.equal(a.state, 'assigned');
  assert.equal(Date.parse(a.expires_at) - Date.parse(a.assigned_at), 24 * 3600 * 1000);

  const all = await call(fake, '/admin/consult-inbox?state=all');
  assert.deepEqual(
    all.json.data.items.map((i) => i.id),
    [P1, P2, P3, P4, P7]
  );
  const bad = await call(fake, '/admin/consult-inbox?state=done');
  assert.equal(bad.status, 422);
});

// ── 후보 ──────────────────────────────────────────────────────

test('후보 — 1~3순위와 점수 내역, 걸러진 업체는 이유', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/admin/consultations/${P1}/candidates`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { items, filtered } = r.json.data;
  assert.equal(r.json.data.consent, true);
  assert.deepEqual(
    items.map((i) => [i.company_id, i.rank, i.kind]),
    [
      [A, 1, 'partner'],
      [FACTORY, 2, 'hq'],
      [B, 3, 'partner'],
    ]
  );
  // A: 등급 S 16 + 만족 8/10 → 9.6 + 재작업 · 응답 자료 없음 3 · 3
  //    품목 실적 1건 6 + 도어 PET 6 + 가격대 같음 6 + 날짜 안 6 + 설계 인원 · 플래너 5
  //    같은 시/군/구 15 · 일감 5(최근 30일 배정 없음) + 여유 5
  assert.deepEqual(items[0].score, {
    eval: { grade: 16, grade_letter: 'S', satisfaction: 9.6, rework: 3, response: 3, sum: 31.6 },
    fit: { item: 6, finish: 6, price: 6, timing: 6, design: 5, sum: 29 },
    location: { sum: 15, why: 'same_gugun' },
    other: { spread: 5, capacity: 5, sum: 10 },
  });
  assert.equal(items[0].total, 86);
  assert.equal(items[0].company_name, '가나 인테리어');
  // B 는 기다리는 배정이 있어 최근 30일 최다 → 일감 0
  assert.equal(items[2].score.other.spread, 0);
  assert.deepEqual(items[2].score.location, { sum: 10, why: 'same_sido' });
  assert.deepEqual(filtered, [
    { company_id: D, company_name: '사아 가구', reasons: ['docs'] },
    { company_id: E, company_name: '자차 가구', reasons: ['tier'] },
    { company_id: F, company_name: '카타 가구', reasons: ['inactive'] },
    { company_id: G, company_name: '파하 가구', reasons: ['region'] },
  ]);
  assert.ok(!filtered.some((f) => f.company_id === PLATFORM), '다담 본사는 업체 풀에 없다');
  assert.ok(!items.some((i) => i.company_id === C), '4순위는 싣지 않는다');
  assert.equal(writesOf(fake).length, 0);
});

test('후보 — 본사 상담이 아니면 404 (업체 사본 · 공장 상담 · 없는 상담)', async () => {
  const fake = fakeOf();
  for (const id of [COPY_OLD, FACTORY_OLD, sid(99), 'nope']) {
    assert.equal((await call(fake, `/admin/consultations/${id}/candidates`)).status, 404, id);
  }
});

test('후보 — 품목 키가 없는 상담은 품목으로 거르지 않는다 (연출컷 품목을 바꿔 쓰지 않는다)', async () => {
  const fake = fakeOf();
  const p4 = fake.db.consultations.find((c) => c.id === P4);
  p4.furniture_categories = [];
  fake.db.generations[0].category = 'wardrobe';
  const r = await call(fake, `/admin/consultations/${P4}/candidates`);
  assert.equal(r.json.data.items.length, 3);
  assert.ok(!r.json.data.filtered.some((f) => f.reasons.includes('item')));
  assert.ok(!fake.calls.some((c) => c.table === 'generations'), '연출컷 표를 읽지 않는다');
});

test('후보 — 업체 제공 동의가 없는 상담은 consent: false', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/admin/consultations/${P7}/candidates`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.consent, false);
});

// ── 배정 ──────────────────────────────────────────────────────

test('배정 — 201, 업체 사본(넘기는 칸만) · 배정 기록(순위 · 점수) · 본사 상담 assigned · 대표 · 실장 앱 알림', async () => {
  const fake = fakeOf();
  const r = await assign(fake, P1, A);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const { assignment_id, copy_consultation_id } = r.json.data;
  assert.deepEqual(Object.keys(r.json.data).sort(), ['assignment_id', 'copy_consultation_id']);

  // 사본 — 넣을 때 보낸 칸이 정해진 것뿐
  const insert = writesOf(fake).find((c) => c.method === 'POST' && c.table === 'consultations');
  assert.deepEqual(
    Object.keys(insert.body).sort(),
    [
      ...COPY_FIELDS,
      'company_id',
      'origin_consultation_id',
      'status',
      'title',
      'furniture_categories',
    ].sort()
  );
  for (const hidden of [
    'space_type',
    'space_width_mm',
    'space_height_mm',
    'space_depth_mm',
    'budget_range',
    'style_preference',
    'admin_memo',
    'assigned_to',
    'user_id',
    'privacy_agreed_at',
    'third_party_agreed_at',
    'consent_version',
    'generation_id',
    'consultation_type',
    'notified_at',
  ]) {
    assert.ok(!(hidden in insert.body), hidden);
  }
  const copy = fake.db.consultations.find((c) => c.id === copy_consultation_id);
  assert.equal(copy.company_id, A);
  assert.equal(copy.origin_consultation_id, P1);
  assert.equal(copy.status, 'pending');
  assert.equal(copy.title, '싱크대 상담', '고객이 적은 제목 대신 품목');
  assert.deepEqual(copy.furniture_categories, ['sink'], '목록 밖 품목은 빼고');
  for (const f of COPY_FIELDS) assert.deepEqual(copy[f], P1_ROW[f], f);
  assert.equal(copy.user_id, null);
  assert.equal(copy.customer_id, null);
  assert.equal(copy.project_id, null);

  // 배정 기록
  const a = fake.db.consult_assignments.find((x) => x.id === assignment_id);
  assert.equal(a.consultation_id, P1);
  assert.equal(a.company_id, A);
  assert.equal(a.copy_consultation_id, copy_consultation_id);
  assert.equal(a.rank, 1);
  assert.equal(a.total, 86);
  assert.equal(a.state, 'assigned');
  assert.equal(a.assigned_by, ADMIN);
  assert.equal(a.score.rules, RULES_VERSION);
  assert.deepEqual(Object.keys(a.score).sort(), ['eval', 'fit', 'location', 'other', 'rules']);

  // 본사 상담 — 대기에서만 바꾼다
  assert.equal(fake.db.consultations.find((c) => c.id === P1).status, 'assigned');
  const lock = writesOf(fake).find((c) => c.method === 'PATCH' && c.table === 'consultations');
  assert.equal(lock.params.get('status'), 'eq.pending');
  assert.equal(lock.params.get('company_id'), `eq.${PLATFORM}`);

  // 앱 알림 — A 의 active 대표 · 실장만 (직원 · 내보낸 대표 · 다른 업체 빼고)
  const notes = fake.db.notification_outbox;
  assert.deepEqual(notes.map((n) => n.user_id).sort(), [OWNER_A, MANAGER_A].sort());
  for (const n of notes) {
    assert.equal(n.kind, 'consult_assigned');
    assert.equal(n.company_id, A);
    assert.equal(n.ref_id, assignment_id);
    assert.equal(n.title, '새 상담 배정');
    assert.equal(
      n.body,
      '싱크대 · 강남구 상담이 배정되었습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.'
    );
    assert.equal(n.url, '/segan/me.html#partner-consults');
    assert.equal(n.dedupe_key, `consult_assigned:${assignment_id}:${n.user_id}`);
    for (const pii of ['김고객', '010-1111-2222', 'kim@example.test', '상부장'])
      assert.ok(!n.body.includes(pii));
  }
});

test('배정 — 이미 기다리는 배정이 있으면 409 open_assignment (같은 상담 다시 · 배정됨 상담)', async () => {
  const fake = fakeOf();
  assert.equal((await assign(fake, P1, A)).status, 201);
  const again = await assign(fake, P1, FACTORY);
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'open_assignment');
  const p2 = await assign(fake, P2, A);
  assert.equal(p2.status, 409);
  assert.equal(p2.json.code, 'open_assignment');
  assert.equal(fake.db.consult_assignments.filter((x) => x.consultation_id === P1).length, 1);
});

test('배정 — 업체 제공 동의가 없는 상담은 422 no_consent, 아무것도 쓰지 않는다', async () => {
  const fake = fakeOf();
  const r = await assign(fake, P7, A);
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'no_consent');
  assert.equal(writesOf(fake).length, 0);
  assert.equal(fake.db.consultations.find((c) => c.id === P7).status, 'pending');
});

test('배정 — 대기가 아닌 상담은 409 not_pending', async () => {
  const fake = fakeOf();
  const r = await assign(fake, P3, A);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'not_pending');
  assert.equal(writesOf(fake).length, 0);
});

test('배정 — 거르기를 통과하지 못하면 422 not_eligible (이유), 아무것도 쓰지 않는다', async () => {
  const fake = fakeOf();
  const cases = [
    [D, ['docs']],
    [E, ['tier']],
    [F, ['inactive']],
    [G, ['region']],
    [PLATFORM, []],
    [cid(77), []],
  ];
  for (const [company, reasons] of cases) {
    const r = await assign(fake, P1, company);
    assert.equal(r.status, 422, company);
    assert.equal(r.json.code, 'not_eligible');
    assert.deepEqual(r.json.details.reasons, reasons, company);
  }
  // 한도 — 이번 달 배정 수가 한도에 닿으면
  fake.db.company_service_settings.find((s) => s.company_id === A).monthly_limit = 0;
  const limit = await assign(fake, P1, A);
  assert.deepEqual(limit.json.details.reasons, ['limit']);
  // 기간 — 고객 확정 ~ 시공 완료 기간을 비우면
  fake.db.company_service_settings.find((s) => s.company_id === A).lead_days = null;
  const period = await assign(fake, P1, A);
  assert.deepEqual(period.json.details.reasons, ['limit', 'period']);
  assert.equal(writesOf(fake).length, 0);
  assert.equal(fake.db.consultations.find((c) => c.id === P1).status, 'pending');
});

test('거친 업체 — 같은 상담을 못 받은 업체는 후보에서 빠지고(tried) 다시 배정하지 못한다', async () => {
  const fake = fakeOf();
  const r = await call(fake, `/admin/consultations/${P4}/candidates`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { items, filtered } = r.json.data;
  assert.ok(!items.some((i) => i.company_id === C), 'C 는 P4 를 못 받았다');
  assert.deepEqual(filtered.find((f) => f.company_id === C)?.reasons, ['tried']);
  const a = await assign(fake, P4, C);
  assert.equal(a.status, 422);
  assert.equal(a.json.code, 'not_eligible');
  assert.deepEqual(a.json.details.reasons, ['tried']);
  assert.equal(writesOf(fake).length, 0);
  assert.equal(fake.db.consultations.find((c) => c.id === P4).status, 'pending');

  // 다른 상담(P1)에서는 C 도 후보 — 거친 업체는 그 상담에서만 빠진다
  const p1 = await call(fake, `/admin/consultations/${P1}/candidates`);
  assert.ok(!p1.json.data.filtered.some((f) => f.company_id === C));
});

test('배정 — company_id 가 없거나 모양이 아니면 422, 본사 상담이 아니면 404', async () => {
  const fake = fakeOf();
  assert.equal((await assign(fake, P1, undefined)).status, 422);
  assert.equal((await assign(fake, P1, 'A')).status, 422);
  assert.equal((await assign(fake, COPY_OLD, A)).status, 404);
  assert.equal((await assign(fake, FACTORY_OLD, A)).status, 404);
  assert.equal(writesOf(fake).length, 0);
});

test('배정 — 그사이 다른 배정이 상담을 잡았으면 409, 사본을 만들지 않는다', async () => {
  const fake = fakeOf({
    before: (method, table, params) =>
      method === 'PATCH' && table === 'consultations' && params.get('status') === 'eq.pending'
        ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        : null,
  });
  const r = await assign(fake, P1, A);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'open_assignment');
  assert.ok(!writesOf(fake).some((c) => c.method === 'POST'));
  assert.equal(fake.db.notification_outbox.length, 0);
});

test('배정 — 배정 기록이 유니크 색인에 걸리면 409, 사본은 지우고 상담 상태는 그 배정의 것으로 둔다', async () => {
  const fake = fakeOf({
    before: (method, table) =>
      method === 'POST' && table === 'consult_assignments'
        ? new Response('{"code":"23505","message":"consult_assignments_one_open"}', { status: 409 })
        : null,
  });
  const r = await assign(fake, P1, A);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'open_assignment');
  assert.ok(!fake.db.consultations.some((c) => c.origin_consultation_id === P1), '사본을 지웠다');
  assert.equal(fake.db.consultations.find((c) => c.id === P1).status, 'assigned');
  assert.equal(fake.db.notification_outbox.length, 0);
});

test('배정 — 배정 기록을 못 남기면 사본을 지우고 본사 상담을 대기로 되돌린다', async () => {
  const fake = fakeOf({
    before: (method, table) =>
      method === 'POST' && table === 'consult_assignments'
        ? new Response('{"code":"XX000"}', { status: 500 })
        : null,
  });
  const saved = console.error;
  console.error = () => {};
  try {
    const r = await assign(fake, P1, A);
    assert.equal(r.status, 500);
  } finally {
    console.error = saved;
  }
  assert.ok(!fake.db.consultations.some((c) => c.origin_consultation_id === P1));
  assert.equal(fake.db.consultations.find((c) => c.id === P1).status, 'pending');
  assert.equal(fake.db.notification_outbox.length, 0);
});

// ── 업체 · 평가표 ───────────────────────────────────────────────

test('업체 목록 — pool=1 은 다담 공장 + 활동 중 Agent, 등급 · 서류 · 상담 설정 여부', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/admin/companies?pool=1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const items = r.json.data.items;
  assert.deepEqual(items.map((i) => i.id).sort(), [FACTORY, A, B, C, D, G].sort());
  const a = items.find((i) => i.id === A);
  assert.deepEqual(a, {
    id: A,
    name: '가나 인테리어',
    kind: 'partner',
    plan: 'agent',
    status: 'active',
    sido: '서울특별시',
    gugun: '강남구',
    grade: 'S',
    evaluated_at: '2026-10-01T00:00:00Z',
    docs_ok: true,
    settings_ok: true,
  });
  assert.equal(items.find((i) => i.id === D).docs_ok, false);
  const all = await call(fake, '/admin/companies');
  assert.deepEqual(
    all.json.data.items.map((i) => i.id).sort(),
    [FACTORY, A, B, C, D, E, F, G].sort(),
    '본사(platform)는 빼고'
  );
  const e = all.json.data.items.find((i) => i.id === E);
  assert.equal(e.grade, null);
  assert.equal(e.settings_ok, false);
});

test('평가표 — 없으면 빈 값 + 항목 목록, 저장하면 이력이 쌓이고 평가한 사람 이메일', async () => {
  const fake = fakeOf();
  const first = await call(fake, `/admin/companies/${E}/evaluation`);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.evaluation.company_id, E);
  assert.equal(first.json.data.evaluation.grade, null);
  assert.deepEqual(first.json.data.evaluation.docs, {});
  assert.equal(first.json.data.catalog.equipment.length, 14);
  assert.deepEqual(first.json.data.catalog.equipment[0], { key: 'panel_saw', name: '패널쏘' });
  assert.deepEqual(first.json.data.history, []);
  assert.deepEqual(first.json.data.metrics, {
    satisfaction: null,
    response_rate: null,
    rework_free_rate: null,
  });
  assert.deepEqual(first.json.data.catalog.install, [
    { key: 'demolition', name: '철거' },
    { key: 'utility_connect', name: '설비 연결' },
    { key: 'high_floor', name: '높은 층 운반' },
  ]);
  assert.deepEqual(first.json.data.catalog.docs, [
    { key: 'insurance', name: '배상 책임 보험' },
    { key: 'contract', name: '표준 계약서' },
  ]);
  // A — 설치 후 문항 8/10 → 4.0, 배정 · 최근 90일 수주 없음
  const a = await call(fake, `/admin/companies/${A}/evaluation`);
  assert.deepEqual(a.json.data.metrics, {
    satisfaction: 4,
    response_rate: null,
    rework_free_rate: null,
  });

  const put = await call(fake, `/admin/companies/${E}/evaluation`, ADMIN, {
    method: 'PUT',
    body: {
      grade: 'B',
      equipment: { panel_saw: 'have', nesting: 'outsource' },
      staff: { design: 2 },
      docs: { insurance: { checked_at: '2026-10-29' }, contract: false },
      install: { demolition: true, install_years: 7 },
      price_tier: 'basic',
      as_months: 12,
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const saved = fake.db.company_evaluations.find((x) => x.company_id === E);
  assert.equal(saved.grade, 'B');
  assert.equal(saved.evaluated_by, ADMIN);
  assert.deepEqual(saved.docs, { insurance: { checked_at: '2026-10-29', by: ADMIN } });
  assert.deepEqual(saved.install, { demolition: true, install_years: 7 });
  assert.deepEqual(put.json.data.evaluation.equipment, { panel_saw: 'have', nesting: 'outsource' });
  const upsert = writesOf(fake).find((c) => c.table === 'company_evaluations');
  assert.equal(upsert.params.get('on_conflict'), 'company_id');

  const again = await call(fake, `/admin/companies/${E}/evaluation`);
  assert.deepEqual(
    again.json.data.history.map((h) => [h.grade, h.evaluated_by_email]),
    [['B', `${ADMIN}@test.local`]]
  );
});

test('평가표 — 목록 밖 키는 422 (unknown_keys), 본사(platform) · 없는 업체는 404', async () => {
  const fake = fakeOf();
  const bad = await call(fake, `/admin/companies/${A}/evaluation`, ADMIN, {
    method: 'PUT',
    body: { grade: 'A', finishes: { door_gold: 'yes' } },
  });
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.json.details.unknown_keys, ['finishes.door_gold']);
  assert.equal((await call(fake, `/admin/companies/${PLATFORM}/evaluation`)).status, 404);
  assert.equal(
    (await call(fake, `/admin/companies/${cid(88)}/evaluation`, ADMIN, { method: 'PUT', body: {} }))
      .status,
    404
  );
  assert.equal(writesOf(fake).length, 0);
});
