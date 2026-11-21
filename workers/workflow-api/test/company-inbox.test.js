/**
 * 받은 일 (src/company-inbox.js) — 프로젝트 관리 대시보드 맨 위 「새로 생긴 일」의 할 일 묶음 · 소식.
 *
 * 고정하는 것
 *   1) 할 일 묶음 — 직책 · 업체 종류마다: 대표 = 상담 · 제작 의뢰 답 · 수주 요청 · A/S · 받을 돈,
 *      실장 = 수주 요청 빼고, 직원 = 없음. 영업 사원 업체(Manager 등급) = 팩토리 고르기 · 받을 돈
 *   2) 소식 — 지난 14일, 새 것부터 20줄. 고객 이름 · 전화 · 금액 없음, 다른 업체 것 없음
 *   3) 구성원이 아니면 403, 캐시하지 않는다
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { NEWS_DAYS, NEWS_LIMIT, NEWS_LABEL, TODO_LABEL } from '../src/company-inbox.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const F = id('c0', 1); // 팩토리 (Agent)
const M = id('c0', 2); // 영업 사원 업체 (Manager 등급)
const X = id('c0', 3); // 다른 팩토리
const OWNER = id('a0', 1);
const MANAGER = id('a0', 2);
const STAFF = id('a0', 3);
const M_OWNER = id('a0', 4);
const P = (i) => id('0e', i);
const D = (i) => id('0d', i);
const O = (i) => id('0a', i);
const kst = (s) => Date.parse(`${s}+09:00`);
const AT = kst('2026-11-21T10:00:00');
const ago = (days, hours = 0) => new Date(AT - days * 86400000 - hours * 3600000).toISOString();

function tables() {
  return {
    companies: [
      { id: F, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
      { id: M, kind: 'partner', name: '다라 영업', plan: 'manager', status: 'active' },
      { id: X, kind: 'partner', name: '남의 팩토리', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: F, user_id: OWNER, role: 'owner', status: 'active' },
      { company_id: F, user_id: MANAGER, role: 'manager', status: 'active' },
      { company_id: F, user_id: STAFF, role: 'staff', status: 'active' },
      { company_id: M, user_id: M_OWNER, role: 'owner', status: 'active' },
    ],
    projects: [
      { id: P(1), company_id: F, title: '예시 주방', created_at: ago(20) },
      { id: P(2), company_id: F, title: '예시 붙박이장', created_at: ago(10) },
      { id: P(5), company_id: M, title: '영업 신발장', created_at: ago(5) },
      { id: P(9), company_id: X, title: '남의 프로젝트', created_at: ago(1) },
    ],
    designs: [
      { id: D(1), company_id: F, project_id: P(1), updated_at: ago(3) },
      { id: D(2), company_id: F, project_id: null, updated_at: ago(2) },
      { id: D(9), company_id: X, project_id: P(9), updated_at: ago(1) },
    ],
    design_documents: [
      // 3일 전 보냄 · 2일 전 처음 열어 봄 · 어제 승인
      { id: id('08', 1), design_id: D(1), doc_type: 'customer_confirmation', status: 'approved', decision: 'approved', created_at: ago(3), first_viewed_at: ago(2), decided_at: ago(1), customer_name: '김고객' },
      // 프로젝트에 잇지 않은 설계 — 6시간 전 수정 요청
      { id: id('08', 2), design_id: D(2), doc_type: 'customer_confirmation', status: 'rejected', decision: 'rejected', created_at: ago(30), first_viewed_at: ago(29), decided_at: ago(0, 6) },
      { id: id('08', 3), design_id: D(1), doc_type: 'customer_confirmation', status: 'revoked', created_at: ago(1) }, // 거둔 것
      { id: id('08', 4), design_id: D(1), doc_type: 'work_order', status: 'issued', created_at: ago(1) }, // 견적이 아니다
      { id: id('08', 9), design_id: D(9), doc_type: 'customer_confirmation', status: 'issued', created_at: ago(1) }, // 남의 것
    ],
    orders: [
      { id: O(1), company_id: F, project_id: P(1), status: 'delivered', ordered_at: ago(0, 20), delivered_at: ago(0, 2), completed_at: null, contract_amount: 5000000 },
      { id: O(2), company_id: F, project_id: P(2), status: 'completed', ordered_at: ago(40), delivered_at: ago(20), completed_at: ago(4) },
      { id: O(9), company_id: X, project_id: P(9), status: 'confirmed', ordered_at: ago(1) },
    ],
    order_payments: [
      { id: id('01', 1), order_id: O(1), stage: 'deposit', amount: 300000, due_on: '2026-11-20', paid_on: null },
      { id: id('01', 2), order_id: O(1), stage: 'balance', amount: 200000, due_on: '2026-11-21', paid_on: null },
      { id: id('01', 3), order_id: O(1), stage: 'interim', amount: 900000, due_on: '2026-11-30', paid_on: null }, // 아직 아님
      { id: id('01', 9), order_id: O(9), stage: 'deposit', amount: 777000, due_on: '2026-11-01', paid_on: null }, // 남의 것
    ],
    consult_assignments: [
      { id: id('02', 1), company_id: F, state: 'assigned', assigned_at: ago(0, 5) },
      { id: id('02', 2), company_id: F, state: 'assigned', assigned_at: ago(0, 1) },
      { id: id('02', 3), company_id: F, state: 'accepted', assigned_at: ago(2) },
      { id: id('02', 4), company_id: F, state: 'expired', assigned_at: ago(30) }, // 14일 밖
      { id: id('02', 9), company_id: X, state: 'assigned', assigned_at: ago(0, 1) },
    ],
    order_events: [
      { id: id('04', 1), company_id: F, order_id: O(1), kind: 'revert', state: 'pending', created_at: ago(0, 3) },
      { id: id('04', 2), company_id: F, order_id: O(2), kind: 'revert', state: 'approved', created_at: ago(6), decided_at: ago(5) },
      { id: id('04', 3), company_id: F, order_id: O(2), kind: 'revive', state: 'rejected', created_at: ago(40), decided_at: ago(39) },
      { id: id('04', 9), company_id: X, order_id: O(9), kind: 'revert', state: 'pending', created_at: ago(1) },
    ],
    as_requests: [
      { id: id('05', 1), company_id: F, order_id: O(2), state: 'requested', created_at: ago(0, 4) },
      { id: id('05', 2), company_id: F, order_id: O(2), state: 'received', created_at: ago(8) },
      { id: id('05', 9), company_id: X, order_id: O(9), state: 'requested', created_at: ago(1) },
    ],
    production_requests: [
      // 영업 사원이 낸 의뢰 — 추천 도착 · 팩토리(F)가 받음 · 거둠
      { id: id('06', 1), company_id: M, project_id: P(5), status: 'recommended', round: 1, status_at: ago(0, 7), factory_company_id: null },
      { id: id('06', 2), company_id: M, project_id: null, status: 'accepted', round: 1, status_at: ago(2), factory_company_id: F, factory_project_id: P(2) },
      { id: id('06', 3), company_id: M, project_id: P(5), status: 'cancelled', round: 1, status_at: ago(1), factory_company_id: null },
      // F 를 고른 의뢰 — 아직 답 기다림
      { id: id('06', 4), company_id: M, project_id: null, status: 'chosen', round: 2, status_at: ago(0, 8), factory_company_id: F },
      // F 를 골랐다가 거둔 의뢰
      { id: id('06', 5), company_id: M, project_id: null, status: 'cancelled', round: 1, status_at: ago(0, 9), factory_company_id: F },
    ],
    // 소식을 본 때 (DB 0078) — 실장은 어제 봤다, 남의 업체 줄은 섞이지 않는다
    inbox_seen: [
      { user_id: MANAGER, company_id: F, seen_at: ago(1) },
      { user_id: MANAGER, company_id: X, seen_at: ago(0, 1) },
    ],
    production_recommendations: [
      { id: id('07', 4), request_id: id('06', 4), company_id: F, round: 2, chosen: true, chosen_at: ago(0, 8), expires_at: new Date(AT + 16 * 3600000).toISOString(), response: null },
      { id: id('07', 5), request_id: id('06', 5), company_id: F, round: 1, chosen: true, chosen_at: ago(0, 9), expires_at: new Date(AT + 15 * 3600000).toISOString(), response: null },
      { id: id('07', 2), request_id: id('06', 2), company_id: F, round: 1, chosen: true, chosen_at: ago(3), expires_at: ago(2), response: 'accepted' },
    ],
  };
}

const USERS = { t_owner: { id: OWNER }, t_manager: { id: MANAGER }, t_staff: { id: STAFF }, t_m: { id: M_OWNER }, t_nobody: { id: id('a9', 1) } };
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

async function call(fake, token) {
  const realNow = Date.now;
  Date.now = () => AT;
  try {
    return await withFake(fake, async () => {
      const res = await worker.fetch(new Request('https://api.test/company/inbox', { headers: { Authorization: `Bearer ${token}` } }), ENV, { waitUntil() {} });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control') };
    });
  } finally {
    Date.now = realNow;
  }
}

test('이름 — 할 일 여섯 · 소식 글이 모두 있다, 14일 · 20줄', () => {
  assert.deepEqual(Object.keys(TODO_LABEL), ['consult', 'offer', 'choose', 'approval', 'as', 'due']);
  for (const v of Object.values(NEWS_LABEL)) assert.ok(typeof v === 'string' && v);
  assert.deepEqual([NEWS_DAYS, NEWS_LIMIT], [14, 20]);
});

test('팩토리 대표 — 할 일 묶음: 기한이 있는 것(제작 의뢰 답 · 상담)이 이른 것부터, 그다음 수주 요청 · A/S · 받을 돈', async () => {
  const r = await call(world(), 't_owner');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.cache, 'no-store, private');
  const d = r.json.data;
  assert.equal(d.role, 'owner');
  assert.deepEqual(d.todo, [
    // 기한이 이른 것부터 — 제작 의뢰 답(16시간 뒤)이 상담(19시간 뒤)보다 먼저다. 거둔 의뢰 · 이미 답한 의뢰는 세지 않는다
    { kind: 'offer', label: '제작 의뢰 답하기', count: 1, go: 'p-make', due: new Date(AT + 16 * 3600000).toISOString() },
    // 가장 이른 배정(5시간 전) + 24시간
    { kind: 'consult', label: '새 상담 받기', count: 2, go: 'p-consult', due: new Date(Date.parse(ago(0, 5)) + 24 * 3600000).toISOString() },
    { kind: 'approval', label: '수주 요청 승인 · 반려', count: 1, go: 'p-contract' },
    { kind: 'as', label: 'A/S 접수 받기', count: 1, go: 'p-as' },
    { kind: 'due', label: '받을 돈 확인', count: 2, go: 'p-collect', late: 1, total: 500000 },
  ]);
});

test('팩토리 실장은 수주 요청 없이, 직원은 할 일 묶음이 없다 (받을 돈 · 상담을 읽지도 않는다) — 소식은 누구나', async () => {
  const m = (await call(world(), 't_manager')).json.data;
  assert.deepEqual(m.todo.map((t) => t.kind), ['offer', 'consult', 'as', 'due']);
  const fake = world();
  const s = (await call(fake, 't_staff')).json.data;
  assert.equal(s.role, 'staff');
  assert.deepEqual(s.todo, []);
  assert.equal(fake.calls.rest.some((c) => c.table === 'order_payments' || c.table === 'production_recommendations'), false);
  assert.ok(s.news.length > 0);
  assert.equal(JSON.stringify(s).includes('total'), false);
});

test('소식 — 지난 14일, 새 것부터. 프로젝트 이름만 싣는다 (고객 이름 · 금액 없음, 남의 업체 것 없음)', async () => {
  const d = (await call(world(), 't_owner')).json.data;
  assert.deepEqual(
    d.news.map((n) => [n.kind, n.go, n.project && n.project.title]),
    [
      ['consult_assigned', 'p-consult', null], // 1시간 전
      ['order_delivered', 'p-install', '예시 주방'], // 2시간 전
      ['as_requested', 'p-as', '예시 붙박이장'], // 4시간 전
      ['consult_assigned', 'p-consult', null], // 5시간 전
      ['quote_rejected', 'p-quote', null], // 6시간 전 — 프로젝트에 잇지 않은 설계
      ['order_created', 'p-contract', '예시 주방'], // 20시간 전
      ['quote_approved', 'p-quote', '예시 주방'], // 1일 전
      ['consult_assigned', 'p-consult', null], // 2일 전 (받은 상담)
      ['quote_viewed', 'p-quote', '예시 주방'],
      ['request_received', 'p-make', '예시 붙박이장'], // 2일 전 — 받은 제작 의뢰
      ['quote_sent', 'p-quote', '예시 주방'], // 3일 전
      ['order_completed', 'p-install', '예시 붙박이장'], // 4일 전
      ['approval_approved', 'p-contract', '예시 붙박이장'], // 5일 전
      ['as_requested', 'p-as', '예시 붙박이장'], // 8일 전
    ]
  );
  for (let i = 1; i < d.news.length; i++) assert.ok(d.news[i - 1].at >= d.news[i].at, '새 것부터');
  assert.equal(d.news[0].label, '새 상담이 배정됐습니다');
  assert.deepEqual(Object.keys(d.news[0]).sort(), ['at', 'go', 'kind', 'label', 'project']);
  const text = JSON.stringify(d);
  for (const no of ['김고객', '남의 프로젝트', '5000000', '777000', 'contract_amount']) assert.ok(!text.includes(no), no);
});

test('소식은 20줄까지', async () => {
  const t = tables();
  for (let i = 0; i < 30; i++) t.consult_assignments.push({ id: id('12', i), company_id: F, state: 'accepted', assigned_at: ago(1, i) });
  const d = (await call(world(t), 't_owner')).json.data;
  assert.equal(d.news.length, NEWS_LIMIT);
});

test('영업 사원 업체(Manager 등급) 대표 — 팩토리 고르기 · 제작 의뢰 소식, 배정 상담 · A/S 는 묻지 않는다', async () => {
  const fake = world();
  const d = (await call(fake, 't_m')).json.data;
  assert.deepEqual(d.todo, [{ kind: 'choose', label: '팩토리 고르기', count: 1, go: 'p-make' }]);
  assert.deepEqual(
    d.news.map((n) => [n.kind, n.project && n.project.title]),
    [
      ['request_recommended', '영업 신발장'],
      ['request_accepted', null],
    ]
  );
  const asked = fake.calls.rest.map((c) => c.table);
  for (const no of ['consult_assignments', 'as_requests', 'production_recommendations']) assert.equal(asked.includes(no), false, no);
});

test('구성원이 아니면 403 not_member · 토큰이 없으면 401, 쓰는 요청이 없다', async () => {
  const fake = world();
  const none = await call(fake, 't_nobody');
  assert.equal(none.status, 403);
  assert.equal(none.json.code, 'not_member');
  await call(fake, 't_owner');
  assert.equal(fake.calls.rest.some((c) => c.method !== 'GET'), false);
  const anon = await withFake(world(), async () => (await worker.fetch(new Request('https://api.test/company/inbox'), ENV, { waitUntil() {} })).status);
  assert.equal(anon, 401);
});

// ── 계정마다 읽음 (2026-11-21 뒤 공정 1차 — DB 0078 inbox_seen) ──

async function seen(fake, token, body) {
  const realNow = Date.now;
  Date.now = () => AT;
  try {
    return await withFake(fake, async () => {
      const res = await worker.fetch(
        new Request('https://api.test/company/inbox/seen', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ENV,
        { waitUntil() {} }
      );
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null };
    });
  } finally {
    Date.now = realNow;
  }
}

test('읽음 — 받은 일에 이 계정이 본 때(seen_at)가 실린다: 없으면 null, 내 업체 · 내 줄만', async () => {
  const fake = world();
  assert.equal((await call(fake, 't_owner')).json.data.seen_at, null);
  assert.equal((await call(fake, 't_manager')).json.data.seen_at, ago(1));
  assert.equal((await call(fake, 't_staff')).json.data.seen_at, null);
  // 읽기는 쓰지 않는다
  assert.equal(fake.calls.rest.filter((c) => c.method !== 'GET').length, 0);
});

test('읽음 적기 — 처음이면 한 줄 넣고, 있으면 앞으로만 고친다. 앞날은 지금으로 당긴다', async () => {
  const fake = world();
  const at = ago(0, 2);
  // 대표 — 처음
  let r = await seen(fake, 't_owner', { at });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { seen_at: at });
  assert.deepEqual(
    fake.db.inbox_seen.filter((x) => x.user_id === OWNER).map((x) => [x.company_id, x.seen_at]),
    [[F, at]]
  );
  assert.equal((await call(fake, 't_owner')).json.data.seen_at, at);
  // 옛 값을 보내면 그대로 둔다 (다른 기기가 늦게 보냈다)
  r = await seen(fake, 't_owner', { at: ago(3) });
  assert.deepEqual(r.json.data, { seen_at: at });
  assert.equal(fake.db.inbox_seen.find((x) => x.user_id === OWNER).seen_at, at);
  // 더 새 값은 고친다 — 한 줄 그대로
  r = await seen(fake, 't_owner', { at: ago(0, 1) });
  assert.deepEqual(r.json.data, { seen_at: ago(0, 1) });
  assert.equal(fake.db.inbox_seen.filter((x) => x.user_id === OWNER).length, 1);
  // 실장 — 이미 줄이 있다. 앞날은 지금으로
  r = await seen(fake, 't_manager', { at: new Date(AT + 3600000).toISOString() });
  assert.deepEqual(r.json.data, { seen_at: new Date(AT).toISOString() });
  assert.deepEqual(
    fake.db.inbox_seen
      .filter((x) => x.user_id === MANAGER)
      .map((x) => x.company_id + ' ' + x.seen_at)
      .sort(),
    [F + ' ' + new Date(AT).toISOString(), X + ' ' + ago(0, 1)].sort() // 남의 업체 줄은 건드리지 않는다
  );
});

test('읽음 적기 — 시각이 아니면 422, 구성원이 아니면 403', async () => {
  const fake = world();
  for (const body of [{}, { at: 12 }, { at: 'yesterday' }, { at: '' }]) {
    assert.equal((await seen(fake, 't_owner', body)).status, 422, JSON.stringify(body));
  }
  assert.equal((await seen(fake, 't_nobody', { at: ago(0, 1) })).status, 403);
  assert.equal(fake.db.inbox_seen.length, 2);
});
