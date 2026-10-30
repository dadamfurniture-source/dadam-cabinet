/**
 * 업체 쪽 상담 — src/distribution/company.js 를 워커로 부른다.
 *   GET /company/consults · POST /company/consults/:id/accept|decline · 1분 cron 무응답 되돌리기
 *   GET|PUT /company/service-settings · GET /company/my-score
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { runAssignmentExpiry, renderRef } from '../src/distribution/company.js';
import { PUSH_SEND_CRON } from '../src/push/sender.js';
import { createFake, callWorker, withFetch, writesOf, ENV } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER_A = uid(11);
const MANAGER_A = uid(12);
const STAFF_A = uid(13);
const OWNER_B = uid(21);
const NOBODY = uid(90);
const FACTORY_OWNER = uid(41);
const FACTORY_STAFF = uid(42);
const CUSTOMER = uid(31);

const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);

// 본사 상담 P · 업체 사본 C · 배정 기록 AS
const P1 = sid(1); // 회원 상담 (연출컷 있음) → A 사본 C1, 기다림 2시간째
const P2 = sid(2); // 비회원 상담 → A 사본 C2, 기다림 1시간째
const P3 = sid(3); // → A 사본 C3, 기다림 25시간째 (지남)
const P4 = sid(4); // → A 사본 C4, 못 받음 (돌려보냄)
const P5 = sid(5); // → B 사본 C5, 기다림 30시간째 (지남)
const C1 = sid(11);
const C2 = sid(12);
const C3 = sid(13);
const C4 = sid(14);
const C5 = sid(15);
const OLD = sid(20); // A 의 상담이지만 배정 기록이 없다
const P6 = sid(6); // → 다담 공장 사본 CF, 기다림 3시간째
const CF = sid(16);
const GEN1 = 'gen-1';

const HOUR = 3600 * 1000;
const NOW = Date.now();
const ago = (h) => new Date(NOW - h * HOUR).toISOString();

const platformRow = (id, extra = {}) => ({
  id,
  company_id: PLATFORM,
  status: 'assigned',
  user_id: null,
  name: '본사 행 이름',
  phone: '010-0000-0000',
  email: 'p@example.test',
  generation_id: null,
  created_at: ago(48),
  ...extra,
});
const copyRow = (id, company, origin, extra = {}) => ({
  id,
  company_id: company,
  origin_consultation_id: origin,
  status: 'pending',
  name: '김고객',
  phone: '010-1111-2222',
  email: 'kim@example.test',
  title: '싱크대 상담',
  sido: '서울특별시',
  gugun: '강남구',
  furniture_categories: ['sink'],
  door_finish: 'pet',
  demolition_needed: true,
  wanted_price_tier: 'mid',
  preferred_date: '2026-11-20',
  preferred_time: '09:00-12:00',
  description: '상부장 높게',
  request_detail_design: true,
  quote: { total: 5200000 },
  space_type: 'kitchen',
  space_width_mm: 3000,
  space_height_mm: 2300,
  space_depth_mm: 600,
  budget_range: '500-1000',
  style_preference: 'modern',
  customer_id: null,
  project_id: null,
  user_id: null,
  generation_id: null,
  ...extra,
});
const asg = (id, consult, company, copy, hoursAgo, extra = {}) => ({
  id,
  consultation_id: consult,
  company_id: company,
  copy_consultation_id: copy,
  rank: 1,
  total: 70,
  score: { eval: {} },
  state: 'assigned',
  assigned_at: ago(hoursAgo),
  responded_at: null,
  responded_by: null,
  reason: null,
  ...extra,
});

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: MANAGER_A, role: 'manager', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_STAFF, role: 'staff', status: 'active' },
    ],
    consultations: [
      platformRow(P1, { user_id: CUSTOMER, generation_id: GEN1 }),
      platformRow(P2),
      platformRow(P3),
      platformRow(P4, { status: 'pending' }),
      platformRow(P5),
      platformRow(P6),
      copyRow(C1, A, P1, { created_at: ago(2) }),
      copyRow(C2, A, P2, { created_at: ago(1) }),
      copyRow(C3, A, P3, { created_at: ago(25) }),
      copyRow(C4, A, P4, {
        created_at: ago(40),
        status: 'returned',
        name: '',
        phone: null,
        email: '',
      }),
      copyRow(C5, B, P5, { created_at: ago(30) }),
      copyRow(OLD, A, null, { created_at: ago(100) }),
      copyRow(CF, FACTORY, P6, { created_at: ago(3), title: '싱크대 상담' }),
    ],
    consult_assignments: [
      asg('as1', P1, A, C1, 2),
      asg('as2', P2, A, C2, 1),
      asg('as3', P3, A, C3, 25),
      asg('as4', P4, A, C4, 40, {
        state: 'declined',
        responded_at: ago(39),
        responded_by: OWNER_A,
        reason: '일정',
      }),
      asg('as5', P5, B, C5, 30),
      asg('as6f', P6, FACTORY, CF, 3),
    ],
    generations: [
      {
        id: GEN1,
        category: 'sink',
        images: [
          {
            slot: 'base',
            label: '기본안',
            path: `${CUSTOMER}/gen-1/base.png`,
            url: 'https://x.supabase.co/storage/v1/object/public/generations/x.png',
          },
        ],
      },
    ],
  };
}

const fakeOf = (opts = {}) => createFake({ tables: tables(), nowMs: NOW, ...opts });
const call = (fake, path, token, init) => callWorker(worker, fake, path, token, init);
const accept = (fake, id, token = OWNER_A) =>
  call(fake, `/company/consults/${id}/accept`, token, { method: 'POST', body: {} });
const decline = (fake, id, body = {}, token = OWNER_A) =>
  call(fake, `/company/consults/${id}/decline`, token, { method: 'POST', body });

// ── 목록 ──────────────────────────────────────────────────────

test('목록 — 구성원이 아니면 403 not_member, 직원도 본다', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/company/consults', NOBODY);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'not_member');
  const staff = await call(fake, '/company/consults', STAFF_A);
  assert.equal(staff.status, 200);
  assert.equal(staff.json.data.can_act, false, '직원은 받기 · 못 받음을 못 한다');
});

test('목록 — 내 업체 상담만, 배정 · 답할 기한 · 연출컷 서명 주소 · 돌려보낸 상담은 연락처 없이', async () => {
  const fake = fakeOf();
  const r = await call(fake, '/company/consults', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('Cache-Control'), 'no-store, private');
  assert.equal(r.json.data.can_act, true);
  const items = r.json.data.items;
  assert.deepEqual(
    items.map((i) => i.id),
    [C2, C1, C3, C4, OLD]
  );
  const c1 = items.find((i) => i.id === C1);
  assert.equal(c1.name, '김고객');
  assert.equal(c1.phone, '010-1111-2222');
  assert.equal(c1.email, 'kim@example.test');
  assert.equal(c1.quote_total, 5200000);
  assert.equal(c1.description, '상부장 높게');
  assert.equal(c1.status, 'pending');
  assert.deepEqual(Object.keys(c1.assignment).sort(), ['assigned_at', 'expires_at', 'id', 'state']);
  assert.equal(c1.assignment.id, 'as1');
  assert.equal(
    Date.parse(c1.assignment.expires_at) - Date.parse(c1.assignment.assigned_at),
    24 * HOUR
  );
  assert.equal(
    c1.generation_image_url,
    `https://x.supabase.co/storage/v1/object/sign/generations/${CUSTOMER}/gen-1/base.png?token=t3600`
  );
  for (const key of [
    'user_id',
    'origin_consultation_id',
    'customer_id',
    'title',
    'quote',
    'space_type',
    'space_width_mm',
    'budget_range',
    'style_preference',
  ])
    assert.ok(!(key in c1), key);

  const c4 = items.find((i) => i.id === C4);
  assert.equal(c4.status, 'returned');
  assert.equal(c4.name, null);
  assert.equal(c4.phone, null);
  assert.equal(c4.email, null);
  assert.equal(c4.generation_image_url, null);
  assert.equal(c4.assignment.state, 'declined');
  assert.equal(items.find((i) => i.id === OLD).assignment, null);

  const signs = fake.calls.filter((c) => c.method === 'SIGN');
  assert.equal(signs.length, 1);
  assert.deepEqual(
    signs[0].body.paths,
    [`${CUSTOMER}/gen-1/base.png`],
    '살아 있는 사본의 연출컷만'
  );
  assert.equal(signs[0].body.expiresIn, 3600);
  assert.equal(writesOf(fake).length, 0);
});

test('연출컷 첫 장 — path, 없으면 저장된 Storage 주소에서', () => {
  assert.deepEqual(renderRef([{ path: 'u/g/base.png' }], 'generations'), {
    bucket: 'generations',
    path: 'u/g/base.png',
  });
  assert.deepEqual(
    renderRef(
      [{ url: 'https://x.supabase.co/storage/v1/object/public/generations/u/g/v1.png' }],
      'generations'
    ),
    {
      bucket: 'generations',
      path: 'u/g/v1.png',
    }
  );
  assert.equal(renderRef([{ path: '../etc' }], 'generations'), null);
  assert.equal(renderRef([{ url: 'https://evil.test/a.png' }], 'generations'), null);
  assert.equal(renderRef([], 'generations'), null);
  assert.equal(renderRef(null, 'generations'), null);
});

// ── 받기 ──────────────────────────────────────────────────────

test('받기 — 직원 403 not_manager, 구성원 아님 403, 다른 업체 사본 404', async () => {
  const fake = fakeOf();
  assert.equal((await accept(fake, C1, STAFF_A)).json.code, 'not_manager');
  assert.equal((await accept(fake, C1, NOBODY)).status, 403);
  assert.equal((await accept(fake, C1, OWNER_B)).status, 404);
  assert.equal((await accept(fake, 'nope')).status, 404);
  assert.equal(writesOf(fake).length, 0);
});

test('받기 — 회원 상담: { 업체, user_id, 이름, 연락처 } 고객 · 프로젝트, 사본 confirmed, 배정 accepted (본사 상담은 그대로)', async () => {
  const fake = fakeOf();
  const r = await accept(fake, C1);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { customer_id, project_id } = r.json.data;
  assert.deepEqual(Object.keys(r.json.data).sort(), ['customer_id', 'project_id']);
  const customer = fake.db.customers.find((c) => c.id === customer_id);
  assert.equal(customer.company_id, A);
  assert.equal(customer.user_id, CUSTOMER);
  const insert = writesOf(fake).find((c) => c.method === 'POST' && c.table === 'customers');
  assert.deepEqual(
    insert.body,
    { company_id: A, user_id: CUSTOMER, name: '김고객', phone: '010-1111-2222' },
    '업체 장부 — 탈퇴해도 남는 줄이라 이름 · 연락처를 베낀다'
  );
  const project = fake.db.projects.find((p) => p.id === project_id);
  assert.deepEqual(
    {
      company_id: project.company_id,
      customer_id: project.customer_id,
      title: project.title,
      status: project.status,
    },
    { company_id: A, customer_id, title: '싱크대 상담', status: 'active' }
  );
  const copy = fake.db.consultations.find((c) => c.id === C1);
  assert.equal(copy.customer_id, customer_id);
  assert.equal(copy.project_id, project_id);
  assert.equal(copy.status, 'confirmed');
  const a = fake.db.consult_assignments.find((x) => x.id === 'as1');
  assert.equal(a.state, 'accepted');
  assert.equal(a.responded_by, OWNER_A);
  assert.ok(a.responded_at);
  assert.equal(fake.db.consultations.find((c) => c.id === P1).status, 'assigned');
  assert.ok(!writesOf(fake).some((w) => w.table === 'generations'), '연출컷 표는 건드리지 않는다');

  // 두 번 눌러도 같은 답, 행이 더 생기지 않는다
  const again = await accept(fake, C1, MANAGER_A);
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.data, { customer_id, project_id });
  assert.equal(fake.db.customers.length, 1);
  assert.equal(fake.db.projects.length, 1);
});

test('받기 — 회원의 업체 고객 행이 이미 있으면 그 행', async () => {
  const fake = fakeOf();
  fake.db.customers.push({ id: 'cust-old', company_id: A, user_id: CUSTOMER, name: '예전 고객' });
  const r = await accept(fake, C1);
  assert.equal(r.json.data.customer_id, 'cust-old');
  assert.equal(fake.db.customers.length, 1);
});

test('받기 — 비회원 상담은 이름 · 연락처로 새 업체 고객', async () => {
  const fake = fakeOf();
  const r = await accept(fake, C2, MANAGER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const insert = writesOf(fake).find((c) => c.method === 'POST' && c.table === 'customers');
  assert.deepEqual(insert.body, { company_id: A, name: '김고객', phone: '010-1111-2222' });
});

test('받기 — 24시간 지난 배정 409 expired · 이미 답한 상담 409 not_open · 배정 없는 상담 409 no_assignment', async () => {
  const fake = fakeOf();
  const expired = await accept(fake, C3);
  assert.equal(expired.status, 409);
  assert.equal(expired.json.code, 'expired');
  const declined = await accept(fake, C4);
  assert.equal(declined.json.code, 'not_open');
  const old = await accept(fake, OLD);
  assert.equal(old.json.code, 'no_assignment');
  assert.equal(writesOf(fake).length, 0);
});

test('받기 — 그사이 무응답 · 못 받음이 됐으면 409, 이번에 만든 프로젝트 · 비회원 고객은 지운다', async () => {
  const fake = fakeOf({
    before: (method, table) =>
      method === 'PATCH' && table === 'consult_assignments'
        ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        : null,
  });
  const r = await accept(fake, C2);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'not_open');
  assert.equal(fake.db.projects.length, 0);
  assert.equal(fake.db.customers.length, 0);
  assert.equal(fake.db.consultations.find((c) => c.id === C2).status, 'pending');
});

// ── 못 받음 ───────────────────────────────────────────────────

test('못 받음 — 204, 배정 declined(사유), 사본 returned + 연락처 지움, 본사 상담 다시 pending', async () => {
  const fake = fakeOf();
  const r = await decline(fake, C2, { reason: '  이번 달 일정이 찼습니다 ' }, MANAGER_A);
  assert.equal(r.status, 204);
  assert.equal(r.json, null);
  const a = fake.db.consult_assignments.find((x) => x.id === 'as2');
  assert.equal(a.state, 'declined');
  assert.equal(a.reason, '이번 달 일정이 찼습니다');
  assert.equal(a.responded_by, MANAGER_A);
  const copy = fake.db.consultations.find((c) => c.id === C2);
  assert.deepEqual(
    { status: copy.status, name: copy.name, phone: copy.phone, email: copy.email },
    { status: 'returned', name: '', phone: null, email: '' }
  );
  assert.equal(fake.db.consultations.find((c) => c.id === P2).status, 'pending');

  const list = await call(fake, '/company/consults', OWNER_A);
  const c2 = list.json.data.items.find((i) => i.id === C2);
  assert.equal(c2.name, null);
  assert.equal(c2.assignment.state, 'declined');

  const again = await decline(fake, C2);
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'not_open');
});

test('못 받음 — 사유 없이도 된다, 사유가 길거나 글이 아니면 422, 직원은 403', async () => {
  const fake = fakeOf();
  assert.equal((await decline(fake, C1, { reason: 'x'.repeat(501) })).status, 422);
  assert.equal((await decline(fake, C1, { reason: 7 })).status, 422);
  assert.equal((await decline(fake, C1, {}, STAFF_A)).json.code, 'not_manager');
  assert.equal(writesOf(fake).length, 0);
  const ok = await decline(fake, C1);
  assert.equal(ok.status, 204);
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as1').reason, null);
});

// ── 무응답 cron ────────────────────────────────────────────────

test('cron — 24시간 지난 기다리는 배정만 무응답(expired)으로, 못 받음과 같게 되돌린다', async () => {
  const fake = fakeOf();
  const out = await withFetch(fake, () => runAssignmentExpiry(ENV, { nowMs: NOW }));
  assert.deepEqual(out, { expired: 2, failed: 0 });
  for (const [id, copy, consult] of [
    ['as3', C3, P3],
    ['as5', C5, P5],
  ]) {
    const a = fake.db.consult_assignments.find((x) => x.id === id);
    assert.equal(a.state, 'expired');
    assert.equal(a.responded_by, null);
    assert.ok(a.responded_at);
    const c = fake.db.consultations.find((x) => x.id === copy);
    assert.deepEqual(
      { status: c.status, name: c.name, phone: c.phone, email: c.email },
      { status: 'returned', name: '', phone: null, email: '' }
    );
    assert.equal(fake.db.consultations.find((x) => x.id === consult).status, 'pending');
  }
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as1').state, 'assigned');
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as2').state, 'assigned');
  const read = fake.calls.find((c) => c.method === 'GET' && c.table === 'consult_assignments');
  assert.equal(read.params.get('state'), 'eq.assigned');
  assert.equal(read.params.get('limit'), '50');
  // 다시 돌려도 더 할 일이 없다
  assert.deepEqual(await withFetch(fake, () => runAssignmentExpiry(ENV, { nowMs: NOW })), {
    expired: 0,
    failed: 0,
  });
});

test('cron — 1분 cron(scheduled) 안에서 돈다 (cron 개수는 그대로)', async () => {
  const fake = fakeOf();
  // 분이 5의 배수가 아니고 정리 시각도 아닌 때 — 서명 키가 없어 앱 알림은 DB 에 가지 않는다
  const at = new Date(NOW);
  at.setUTCSeconds(0, 0);
  if (at.getUTCMinutes() % 5 === 0) at.setUTCMinutes(at.getUTCMinutes() + 1);
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const waits = [];
  try {
    await worker.scheduled({ cron: PUSH_SEND_CRON, scheduledTime: at.getTime() + 2 * HOUR }, ENV, {
      waitUntil: (p) => waits.push(p),
    });
    await Promise.all(waits);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as3').state, 'expired');
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as1').state, 'assigned');
});

// ── 상담 설정 ─────────────────────────────────────────────────

test('상담 설정 — 없으면 빈 값 (구성원), 대표 · 실장이 고친다 (직원 403)', async () => {
  const fake = fakeOf();
  const empty = await call(fake, '/company/service-settings', STAFF_A);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.data, {
    can_act: false,
    regions: [],
    items: {},
    monthly_limit: null,
    next_available_date: null,
    updated_at: null,
  });
  const staffPut = await call(fake, '/company/service-settings', STAFF_A, {
    method: 'PUT',
    body: { monthly_limit: 3 },
  });
  assert.equal(staffPut.json.code, 'not_manager');

  const body = {
    regions: [
      { sido: '서울특별시', gugun: '강남구' },
      { sido: '서울특별시', gugun: '강남구' },
      { sido: '경기도', gugun: '성남시' },
    ],
    items: { sink: 'do', wardrobe: 'outsource', vanity: 'no' },
    monthly_limit: 12,
    next_available_date: '2026-11-15',
  };
  const put = await call(fake, '/company/service-settings', MANAGER_A, { method: 'PUT', body });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.data.can_act, true);
  const row = fake.db.company_service_settings.find((s) => s.company_id === A);
  assert.deepEqual(row.regions, [
    { sido: '서울특별시', gugun: '강남구' },
    { sido: '경기도', gugun: '성남시' },
  ]);
  assert.deepEqual(row.items, body.items);
  assert.equal(row.monthly_limit, 12);
  assert.equal(row.updated_by, MANAGER_A);
  const read = await call(fake, '/company/service-settings', STAFF_A);
  assert.equal(read.json.data.next_available_date, '2026-11-15');
  assert.equal(
    writesOf(fake)
      .find((c) => c.table === 'company_service_settings')
      .params.get('on_conflict'),
    'company_id'
  );
});

test('상담 설정 — 목록 밖 품목 · 틀린 값 · 지역 · 한도 · 날짜는 422', async () => {
  const fake = fakeOf();
  const put = (body) => call(fake, '/company/service-settings', OWNER_A, { method: 'PUT', body });
  const unknown = await put({ items: { sauna: 'do' } });
  assert.equal(unknown.status, 422);
  assert.deepEqual(unknown.json.details.unknown_keys, ['items.sauna']);
  assert.equal((await put({ items: { sink: 'yes' } })).status, 422);
  const region = await put({
    regions: [
      { sido: '서울특별시', gugun: '강남구' },
      { sido: '서울', gugun: '강남구' },
      { sido: '서울특별시', gugun: '역삼동' },
    ],
  });
  assert.deepEqual(region.json.details.invalid_regions, [1, 2]);
  assert.equal((await put({ regions: 'x' })).status, 422);
  assert.equal((await put({ monthly_limit: 1001 })).status, 422);
  assert.equal((await put({ monthly_limit: 2.5 })).status, 422);
  assert.equal((await put({ next_available_date: '2026-02-30' })).status, 422);
  assert.equal((await put({ next_available_date: '11/15' })).status, 422);
  assert.equal(writesOf(fake).length, 0);
});

// ── 내 점수 ───────────────────────────────────────────────────

test('내 점수 — 등급 · 고객 만족(0~5) · 응답률(0~1)만, 대표 · 실장', async () => {
  const fake = fakeOf();
  fake.db.company_evaluations.push({
    company_id: A,
    grade: 'A',
    docs: {},
    note: '본사 메모',
    price_tier: 'mid',
  });
  fake.db.orders.push(
    { id: 'o1', company_id: A, status: 'completed', ordered_at: ago(24 * 200), snapshot_id: 's1' },
    { id: 'o2', company_id: A, status: 'completed', ordered_at: ago(24 * 10), snapshot_id: 's2' }
  );
  fake.db.install_feedback.push(
    { id: 'f1', order_id: 'o1', score: 9 },
    { id: 'f2', order_id: 'o2', score: 7 }
  );
  // 끝난 배정: as4(못 받음) + 빨리 받은 하나 → 1/2
  fake.db.consult_assignments.push(
    asg('as6', P1, A, null, 50, { state: 'accepted', responded_at: ago(49), responded_by: OWNER_A })
  );

  assert.equal((await call(fake, '/company/my-score', STAFF_A)).json.code, 'not_manager');
  const r = await call(fake, '/company/my-score', OWNER_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { grade: 'A', satisfaction: 4, response_rate: 0.5 });
  assert.ok(!fake.calls.some((c) => c.table === 'design_snapshots'), '품목 실적은 읽지 않는다');

  const none = await call(fake, '/company/my-score', OWNER_B);
  assert.deepEqual(none.json.data, { grade: null, satisfaction: null, response_rate: null });
});

// ── 다담 공장도 업체 풀 ─────────────────────────────────────────

test('다담 공장 구성원 — 목록 · 받기 · 설정 · 내 점수가 같은 길로 (직원은 보기만)', async () => {
  const fake = fakeOf();
  const list = await call(fake, '/company/consults', FACTORY_STAFF);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.equal(list.json.data.can_act, false);
  assert.deepEqual(
    list.json.data.items.map((i) => i.id),
    [CF]
  );
  assert.equal((await accept(fake, CF, FACTORY_STAFF)).json.code, 'not_manager');
  const ok = await accept(fake, CF, FACTORY_OWNER);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(fake.db.projects.find((p) => p.id === ok.json.data.project_id).company_id, FACTORY);
  assert.equal(fake.db.consult_assignments.find((x) => x.id === 'as6f').state, 'accepted');
  const settings = await call(fake, '/company/service-settings', FACTORY_OWNER, {
    method: 'PUT',
    body: {
      regions: [{ sido: '서울특별시', gugun: '강남구' }],
      items: { sink: 'do' },
      monthly_limit: 30,
    },
  });
  assert.equal(settings.status, 200);
  assert.equal(
    fake.db.company_service_settings.find((x) => x.company_id === FACTORY).monthly_limit,
    30
  );
  const score = await call(fake, '/company/my-score', FACTORY_OWNER);
  assert.equal(score.status, 200);
  assert.deepEqual(Object.keys(score.json.data).sort(), ['grade', 'response_rate', 'satisfaction']);
});
