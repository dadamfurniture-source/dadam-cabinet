/**
 * Manager 업체 제작 의뢰 — src/production-requests/* 를 워커로 부른다 (DB 0050 · 거둠 알림 종류 0053 ·
 *   추천 줄 예상 가격대 · 제작 기간 0055).
 *   Manager: POST|GET /production-requests · GET /production-requests/:id · POST …/:id/choose|cancel
 *   본사:    GET /admin/production-requests · POST …/:id/review|recommend(estimates 가격대 · 제작 기간) · GET …/:id/suggestions
 *   팩토리:  GET /factory/production-requests · POST …/:id/accept|decline · 1분 cron 답 없음
 * 가짜 Supabase 는 test/helpers/distribution-fake.js (0050 지킴이 · 제약을 흉내 낸다). 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  runProductionOfferExpiry,
  factoryDraftIdOf,
  factoryProjectTitle,
} from '../src/production-requests/factory.js';
import { parseRequest, createRequest } from '../src/production-requests/manager.js';
import {
  parseRecommend,
  parseEstimate,
  consultLike,
  ESTIMATE_KEYS,
} from '../src/production-requests/admin.js';
import {
  buildHqSlack,
  offerState,
  slackName,
  OFFER_TTL_HOURS,
  RECOMMEND_MAX,
  ACT_ROLES,
} from '../src/production-requests/common.js';
import {
  buildMessage,
  isValidMessage,
  NOTIFICATION_KINDS,
  PRODUCTION_RECOMMEND_MAX,
} from '../src/push/messages.js';
import { ASSIGNMENT_TTL_HOURS } from '../src/distribution/rules.js';
import { createFake, callWorker, withFetch, ENV } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const xid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ADMIN = uid(1);
const M_OWNER = uid(11);
const M_CHIEF = uid(12); // Manager 업체의 실장 (직책 manager)
const M_STAFF = uid(13);
const M2_OWNER = uid(21);
const E_OWNER = uid(31);
const E_CHIEF = uid(32); // Expert 업체의 실장 — 직책 이름이 manager 라도 등급은 expert
const E_STAFF = uid(33);
const A_OWNER = uid(41);
const F_OWNER = uid(51);
const NOBODY = uid(90);

const PLATFORM = cid(100);
const M = cid(1); // Manager 업체 (인테리어)
const M2 = cid(2); // 다른 Manager 업체
const E = cid(3); // Expert 팩토리
const A = cid(4); // Agent 팩토리
const X = cid(5); // 정지된 Expert 팩토리

const D1 = xid(1); // M 의 앱 설계 (플래너 d-kitchen-01 에서 옴, 프로젝트 P1)
const P1 = xid(2);
const C1 = xid(3);
const D_OTHER = xid(4); // M2 의 앱 설계

const DOCS = {
  insurance: { checked_at: '2026-10-01T00:00:00Z', by: ADMIN },
  contract: { checked_at: '2026-10-01T00:00:00Z', by: ADMIN },
};
const partner = (id, name, extra = {}) => ({
  id,
  kind: 'partner',
  name,
  plan: 'expert',
  status: 'active',
  sido: '서울특별시',
  gugun: '강남구',
  ...extra,
});
const svc = (company_id, extra = {}) => ({
  company_id,
  regions: [{ sido: '서울특별시', gugun: '강남구' }],
  items: { sink: 'do', wardrobe: 'outsource', vanity: 'no' },
  monthly_limit: 10,
  lead_days: 5,
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
const MODEL = {
  format: 'dadam.planner-lite/1',
  id: 'd-kitchen-01',
  name: '김고객 댁 주방',
  item: 'sink',
  walls: [{ lines: { floor: [{ libId: 'LB-1' }] } }],
};

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      {
        id: FACTORY,
        kind: 'hq',
        name: '다담 공장',
        status: 'active',
        sido: '경기도',
        gugun: '김포시',
      },
      partner(M, '가나 인테리어', { plan: 'manager' }),
      partner(M2, '다라 인테리어', { plan: 'manager', sido: '부산광역시', gugun: '해운대구' }),
      partner(E, '마바 가구'),
      partner(A, '사아 공방', { plan: 'agent', sido: '서울특별시', gugun: '서초구' }),
      partner(X, '자차 가구', { status: 'suspended' }),
    ],
    company_members: [
      { company_id: M, user_id: M_OWNER, role: 'owner', status: 'active' },
      { company_id: M, user_id: M_CHIEF, role: 'manager', status: 'active' },
      { company_id: M, user_id: M_STAFF, role: 'staff', status: 'active' },
      { company_id: M2, user_id: M2_OWNER, role: 'owner', status: 'active' },
      { company_id: E, user_id: E_OWNER, role: 'owner', status: 'active' },
      { company_id: E, user_id: E_CHIEF, role: 'manager', status: 'active' },
      { company_id: E, user_id: E_STAFF, role: 'staff', status: 'active' },
      { company_id: A, user_id: A_OWNER, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: F_OWNER, role: 'owner', status: 'active' },
    ],
    company_service_settings: [
      svc(E),
      svc(A, { regions: [{ sido: '서울특별시', gugun: '서초구' }] }),
      svc(FACTORY, { regions: [{ sido: '경기도', gugun: '김포시' }] }),
    ],
    company_evaluations: [
      evaln(E, { grade: 'A' }),
      evaln(A, { grade: 'S' }),
      evaln(FACTORY, { grade: 'A' }),
    ],
    planner_drafts: [
      {
        company_id: M,
        id: 'd-kitchen-01',
        name: '김고객 댁 주방',
        item: 'sink',
        model: MODEL,
        rev: 3,
        summary: { walls: 1, modules: 9 },
        discarded_at: null,
        created_by: M_OWNER,
      },
      {
        company_id: M,
        id: 'd-closet-02',
        name: '안방 붙박이장',
        item: 'wardrobe',
        model: { id: 'd-closet-02' },
        rev: 1,
        summary: { walls: 1, modules: 4 },
        discarded_at: null,
      },
      {
        company_id: M,
        id: 'd-old-0001',
        name: '버린 설계',
        item: 'sink',
        model: { id: 'd-old-0001' },
        rev: 2,
        summary: {},
        discarded_at: '2026-11-01T00:00:00Z',
      },
      {
        company_id: M2,
        id: 'd-m2-0001',
        name: '다른 업체 설계',
        item: 'sink',
        model: { id: 'd-m2-0001' },
        rev: 1,
        summary: {},
        discarded_at: null,
      },
    ],
    designs: [
      {
        id: D1,
        company_id: M,
        project_id: P1,
        name: '김고객 댁 주방',
        source: 'planner-lite',
        source_ref: 'd-kitchen-01',
      },
      {
        id: D_OTHER,
        company_id: M2,
        project_id: null,
        name: '다른 설계',
        source: null,
        source_ref: null,
      },
    ],
    customers: [{ id: C1, company_id: M, user_id: null, name: '김고객', phone: '010-1111-2222' }],
    projects: [{ id: P1, company_id: M, customer_id: C1, title: '김고객 주방', status: 'active' }],
  };
}

const HOUR = 3600 * 1000;
const fresh = (extra = {}) => createFake({ tables: tables(), admins: [ADMIN], ...extra });
const call = (fake, path, token, opts) => callWorker(worker, fake, path, token, opts);
const kindsOf = (fake, kind) => fake.db.notification_outbox.filter((n) => n.kind === kind);

/** 의뢰 내기 → 검토 → 추천(ids) — 의뢰 id */
async function recommended(
  fake,
  ids = [E, A],
  body = { draft_id: 'd-kitchen-01', sido: '서울특별시', gugun: '강남구' }
) {
  const r = await call(fake, '/production-requests', M_OWNER, { method: 'POST', body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.data.id;
  const rec = await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: { company_ids: ids },
  });
  assert.equal(rec.status, 201, JSON.stringify(rec.json));
  return id;
}

// ── 처음부터 끝까지 ─────────────────────────────────────────────

test('흐름 — 실장이 의뢰 → 본사 검토 · 추천 → Manager 고름 → 팩토리 받기 → 프로젝트 · 설계 사본으로 이어짐', async () => {
  const fake = fresh();
  // 1) Manager 업체 실장(직책 manager)이 플래너 설계로 의뢰 — 앱 설계 · 프로젝트는 서버가 찾아 잇는다
  const made = await call(fake, '/production-requests', M_CHIEF, {
    method: 'POST',
    body: {
      draft_id: 'd-kitchen-01',
      note: '상판은 따로 발주합니다',
      sido: '서울특별시',
      gugun: '강남구',
      wanted_done_date: '2027-01-20',
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const req = made.json.data;
  assert.equal(req.status, 'submitted');
  assert.equal(req.label, '접수');
  assert.equal(req.item, 'sink');
  assert.equal(req.item_label, '싱크대');
  assert.deepEqual(req.draft, {
    id: 'd-kitchen-01',
    name: '김고객 댁 주방',
    rev: 3,
    current_rev: 3,
    walls: 1,
    modules: 9,
  });
  assert.equal(req.design_id, D1);
  assert.deepEqual(req.project, { id: P1, title: '김고객 주방' });
  assert.equal(req.region, '서울특별시 강남구');
  const row = fake.db.production_requests.find((r) => r.id === req.id);
  assert.equal(row.company_id, M);
  assert.equal(row.created_by, M_CHIEF);

  // 2) 본사 — 목록(본사 차례) · 검토 시작 (두 번 눌러도 같다)
  const queue = await call(fake, '/admin/production-requests', ADMIN);
  assert.equal(queue.status, 200);
  assert.equal(queue.json.data.ready, true);
  assert.deepEqual(
    queue.json.data.items.map((i) => [i.id, i.status, i.manager.name, i.can_review]),
    [[req.id, 'submitted', '가나 인테리어', true]]
  );
  for (let i = 0; i < 2; i++) {
    const rv = await call(fake, `/admin/production-requests/${req.id}/review`, ADMIN, {
      method: 'POST',
    });
    assert.equal(rv.status, 200);
    assert.deepEqual(rv.json.data, { id: req.id, status: 'recommending' });
  }

  // 3) 후보 — 상담 분배 점수 그대로 (본사만). Manager 업체 자신 · 정지 업체는 걸러진 이유와 함께
  const sug = await call(fake, `/admin/production-requests/${req.id}/suggestions`, ADMIN);
  assert.equal(sug.status, 200, JSON.stringify(sug.json));
  const s = sug.json.data;
  assert.equal(s.default_count, 3);
  assert.equal(s.max, 5);
  assert.deepEqual(
    s.items.map((c) => c.company_id),
    [E]
  ); // 강남구 · 싱크대 · 서류 · 한도 모두 통과는 E 하나
  assert.equal(typeof s.items[0].total, 'number');
  assert.ok(s.items[0].score && s.items[0].score.eval);
  const filtered = Object.fromEntries(s.filtered.map((f) => [f.company_id, f]));
  assert.ok(!filtered[M], '의뢰한 업체 자신은 후보에 없다');
  assert.deepEqual(filtered[M2].reasons, ['tier']);
  assert.equal(filtered[M2].can_recommend, false);
  assert.deepEqual(filtered[X].reasons, ['inactive']);
  assert.deepEqual(filtered[A].reasons, ['region']); // 서초구만 받는다 — 지역은 막지 않는다
  assert.equal(filtered[A].can_recommend, true);
  assert.equal(filtered[FACTORY].can_recommend, true);

  // 4) 추천 — E · A 두 곳, 본사 말 · E 소개
  const rec = await call(fake, `/admin/production-requests/${req.id}/recommend`, ADMIN, {
    method: 'POST',
    body: {
      company_ids: [E, A],
      note: '두 곳 모두 싱크대를 많이 합니다',
      notes: { [E]: '강남구 · 싱크대 전문' },
    },
  });
  assert.equal(rec.status, 201, JSON.stringify(rec.json));
  assert.equal(rec.json.data.status, 'recommended');
  assert.equal(rec.json.data.round, 1);
  assert.deepEqual(
    rec.json.data.recommendations.map((r) => [r.company_id, r.rank, r.note]),
    [
      [E, 1, '강남구 · 싱크대 전문'],
      [A, 2, null],
    ]
  );
  // Manager 대표 · 실장에게 추천 도착 (직원은 아니다)
  assert.deepEqual(
    kindsOf(fake, 'production_recommended')
      .map((n) => n.user_id)
      .sort(),
    [M_OWNER, M_CHIEF].sort()
  );
  assert.equal(
    kindsOf(fake, 'production_recommended')[0].body,
    '본사가 제작 의뢰에 팩토리 2곳을 추천했습니다. 맡길 곳을 골라 주세요.'
  );

  // 5) Manager 보기 — 이름 · 지역 · 하는 품목 · 본사 소개만 (점수 없음)
  const detail = await call(fake, `/production-requests/${req.id}`, M_STAFF);
  assert.equal(detail.status, 200);
  const d = detail.json.data;
  assert.equal(d.status, 'recommended');
  assert.equal(d.hq_note, '두 곳 모두 싱크대를 많이 합니다');
  assert.equal(d.can_choose, false, '직원은 고르지 못한다');
  assert.deepEqual(
    d.recommendations.map((r) => [
      r.company_id,
      r.name,
      r.region,
      r.items,
      r.note,
      r.factory_label,
    ]),
    [
      [
        E,
        '마바 가구',
        '서울특별시 강남구',
        ['싱크대', '붙박이장'],
        '강남구 · 싱크대 전문',
        '팩토리',
      ],
      [A, '사아 공방', '서울특별시 서초구', ['싱크대', '붙박이장'], null, '팩토리'],
    ]
  );
  const text = JSON.stringify(detail.json);
  for (const key of ['"total"', '"score"', '"grade"', '"reasons"', '"rank_total"'])
    assert.ok(!text.includes(key), `Manager 화면에 ${key} 가 없다`);

  // 6) Manager 대표가 E 를 고름 → E 대표 · 실장에게 새 의뢰
  const chose = await call(fake, `/production-requests/${req.id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E.toUpperCase() },
  });
  assert.equal(chose.status, 200, JSON.stringify(chose.json));
  assert.equal(chose.json.data.status, 'chosen');
  assert.equal(chose.json.data.offer.company_id, E);
  assert.equal(
    Date.parse(chose.json.data.offer.expires_at) - Date.parse(chose.json.data.offer.chosen_at),
    24 * HOUR
  );
  assert.deepEqual(
    kindsOf(fake, 'production_offered')
      .map((n) => n.user_id)
      .sort(),
    [E_OWNER, E_CHIEF].sort()
  );
  assert.equal(
    kindsOf(fake, 'production_offered')[0].body,
    '싱크대 제작 의뢰가 왔습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.'
  );
  assert.ok(
    kindsOf(fake, 'production_offered').every(
      (n) => n.company_id === E && n.url === '/segan/me.html#factory-requests'
    )
  );
  // Manager 목록 — 답 기다림 의뢰는 답할 기한을 같이 싣는다 (의뢰마다 따로 읽지 않게)
  const waitingList = await call(fake, '/production-requests', M_STAFF);
  assert.deepEqual(
    waitingList.json.data.items.map((i) => [i.id, i.status, i.expires_at]),
    [[req.id, 'chosen', chose.json.data.offer.expires_at]]
  );

  // 7) 팩토리 목록 — E 대표는 받기 가능, E 직원은 보기만, A(안 골림)는 아무것도 안 보인다
  const list = await call(fake, '/factory/production-requests', E_OWNER);
  assert.equal(list.status, 200);
  assert.equal(list.json.data.can_act, true);
  assert.equal(list.json.data.items.length, 1);
  const offer = list.json.data.items[0];
  assert.deepEqual(
    [offer.id, offer.state, offer.can_act, offer.manager.name, offer.item_label, offer.note],
    [req.id, 'open', true, '가나 인테리어', '싱크대', '상판은 따로 발주합니다']
  );
  assert.deepEqual(offer.design, { name: '김고객 댁 주방', walls: 1, modules: 9 });
  const staffList = await call(fake, '/factory/production-requests', E_STAFF);
  assert.equal(staffList.json.data.items[0].can_act, false);
  assert.deepEqual((await call(fake, '/factory/production-requests', A_OWNER)).json.data.items, []);

  // 8) 받기 → 팩토리 고객(= Manager 업체) · 프로젝트 · 플래너 설계 사본
  const acc = await call(fake, `/factory/production-requests/${req.id}/accept`, E_CHIEF, {
    method: 'POST',
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const out = acc.json.data;
  assert.equal(out.request_id, req.id);
  assert.equal(out.draft_id, factoryDraftIdOf(req.id));
  const project = fake.db.projects.find((p) => p.id === out.project_id);
  assert.deepEqual(
    [project.company_id, project.title, project.status],
    [E, '가나 인테리어 제작 의뢰 · 싱크대', 'active']
  );
  const customer = fake.db.customers.find((c) => c.id === out.customer_id);
  assert.deepEqual(
    [customer.company_id, customer.name, customer.phone, customer.user_id ?? null],
    [E, '가나 인테리어', null, null]
  );
  const copy = fake.db.planner_drafts.find((x) => x.company_id === E && x.id === out.draft_id);
  assert.equal(copy.model.id, out.draft_id, '사본 설계 안의 id 도 새 id');
  assert.equal(copy.model.format, 'dadam.planner-lite/1');
  assert.equal(copy.rev, 1);
  const after = fake.db.production_requests.find((r) => r.id === req.id);
  assert.deepEqual(
    [after.status, after.factory_company_id, after.factory_project_id, after.factory_draft_id],
    ['accepted', E, out.project_id, out.draft_id]
  );
  const chosenRec = fake.db.production_recommendations.find(
    (r) => r.request_id === req.id && r.chosen
  );
  assert.deepEqual([chosenRec.response, chosenRec.responded_by], ['accepted', E_CHIEF]);
  assert.deepEqual(
    kindsOf(fake, 'production_answered')
      .map((n) => [n.user_id, n.title])
      .sort(),
    [
      [M_CHIEF, '제작 의뢰 받음'],
      [M_OWNER, '제작 의뢰 받음'],
    ].sort()
  );
  // Manager 의 고객 프로젝트는 그대로 (넘기기 handed_over 를 쓰지 않는다)
  assert.equal(fake.db.projects.find((p) => p.id === P1).status, 'active');

  // 9) 다시 눌러도 같은 답
  const again = await call(fake, `/factory/production-requests/${req.id}/accept`, E_OWNER, {
    method: 'POST',
  });
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.data, out);
  assert.equal(fake.db.projects.filter((p) => p.company_id === E).length, 1);

  // 10) Manager 보기 — 받은 팩토리
  const done = await call(fake, `/production-requests/${req.id}`, M_OWNER);
  assert.equal(done.json.data.status, 'accepted');
  assert.deepEqual(done.json.data.factory, { company_id: E, name: '마바 가구' });
  assert.equal(done.json.data.can_cancel, false);
  assert.deepEqual(
    done.json.data.offers.map((o) => [o.round, o.company_id, o.state]),
    [[1, E, 'accepted']]
  );
  const myList = await call(fake, '/production-requests', M_OWNER);
  assert.deepEqual(
    [
      myList.json.data.can_create,
      myList.json.data.items[0].status,
      myList.json.data.items[0].factory.name,
      myList.json.data.items[0].expires_at,
    ],
    [true, 'accepted', '마바 가구', null]
  );
  assert.equal(kindsOf(fake, 'production_cancelled').length, 0);
});

test('같은 Manager 의 다음 의뢰를 받으면 팩토리 고객 줄을 다시 쓴다', async () => {
  const fake = fresh();
  const first = await recommended(fake, [E]);
  await call(fake, `/production-requests/${first}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  const a1 = await call(fake, `/factory/production-requests/${first}/accept`, E_OWNER, {
    method: 'POST',
  });
  const second = await recommended(fake, [E], { draft_id: 'd-closet-02' });
  await call(fake, `/production-requests/${second}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  const a2 = await call(fake, `/factory/production-requests/${second}/accept`, E_OWNER, {
    method: 'POST',
  });
  assert.equal(a2.status, 200, JSON.stringify(a2.json));
  assert.equal(a2.json.data.customer_id, a1.json.data.customer_id);
  assert.notEqual(a2.json.data.project_id, a1.json.data.project_id);
  assert.equal(fake.db.customers.filter((c) => c.company_id === E).length, 1);
  assert.equal(
    fake.db.projects.find((p) => p.id === a2.json.data.project_id).title,
    '가나 인테리어 제작 의뢰 · 붙박이장'
  );
});

// ── 누가 할 수 있나 ─────────────────────────────────────────────

test('의뢰 내기 — Manager 등급 업체의 대표 · 실장만 (직책 manager 와 등급 manager 는 다르다)', async () => {
  const fake = fresh();
  const body = { draft_id: 'd-kitchen-01' };
  const cases = [
    [E_OWNER, 403, 'not_manager_plan'], // Expert 팩토리 대표
    [E_CHIEF, 403, 'not_manager_plan'], // Expert 팩토리의 실장(직책 manager) — 등급이 manager 가 아니다
    [M_STAFF, 403, 'not_manager'], // Manager 업체지만 직원
    [NOBODY, 403, 'not_member'],
    [ADMIN, 403, 'not_member'], // 본사 관리자도 업체 구성원이 아니면 의뢰를 내지 않는다
  ];
  for (const [who, status, code] of cases) {
    const r = await call(fake, '/production-requests', who, { method: 'POST', body });
    assert.equal(r.status, status, `${who} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, code);
  }
  assert.equal(fake.db.production_requests.length, 0);
  // 목록은 보지만 낼 수 없다는 표시
  const l = await call(fake, '/production-requests', E_CHIEF);
  assert.equal(l.status, 200);
  assert.deepEqual([l.json.data.can_create, l.json.data.items], [false, []]);
  const ok = await call(fake, '/production-requests', M_OWNER, { method: 'POST', body });
  assert.equal(ok.status, 201);
});

test('의뢰 내기 — 설계 확인: 남의 설계 · 버린 설계 · 설계 없음 · 같은 설계로 열린 의뢰', async () => {
  const fake = fresh();
  const post = (body) => call(fake, '/production-requests', M_OWNER, { method: 'POST', body });
  assert.equal((await post({ draft_id: 'd-m2-0001' })).status, 404);
  assert.equal((await post({ design_id: D_OTHER })).status, 404);
  assert.equal((await post({ draft_id: 'd-old-0001' })).status, 404);
  const none = await post({ note: '설계 없이' });
  assert.deepEqual([none.status, none.json.code], [422, 'design_required']);
  assert.equal((await post({ draft_id: 'bad id!' })).status, 422);
  assert.equal((await post({ draft_id: 'd-kitchen-01', sido: '서울' })).status, 422);
  assert.equal(
    (await post({ draft_id: 'd-kitchen-01', wanted_done_date: '2027-02-30' })).status,
    422
  );
  assert.equal((await post({ draft_id: 'd-kitchen-01', note: '가'.repeat(1001) })).status, 422);
  // 앱 설계만 줘도 그 설계의 플래너 설계 · 프로젝트를 잇는다
  const byDesign = await post({ design_id: D1 });
  assert.equal(byDesign.status, 201, JSON.stringify(byDesign.json));
  assert.equal(byDesign.json.data.draft.id, 'd-kitchen-01');
  assert.equal(byDesign.json.data.project.id, P1);
  // 같은 설계로 열린 의뢰가 있으면 409 — 플래너 설계로 · 앱 설계로 모두
  for (const body of [{ draft_id: 'd-kitchen-01' }, { design_id: D1 }]) {
    const dup = await post(body);
    assert.deepEqual([dup.status, dup.json.code], [409, 'open_request']);
  }
  // 거두면 다시 낼 수 있다
  assert.equal(
    (
      await call(fake, `/production-requests/${byDesign.json.data.id}/cancel`, M_CHIEF, {
        method: 'POST',
      })
    ).status,
    200
  );
  assert.equal((await post({ draft_id: 'd-kitchen-01' })).status, 201);
});

test('남의 의뢰 — 다른 Manager 는 보기 · 고르기 · 거두기 모두 404, 본사 화면은 관리자만', async () => {
  const fake = fresh();
  const id = await recommended(fake);
  assert.equal((await call(fake, `/production-requests/${id}`, M2_OWNER)).status, 404);
  assert.equal(
    (
      await call(fake, `/production-requests/${id}/choose`, M2_OWNER, {
        method: 'POST',
        body: { company_id: E },
      })
    ).status,
    404
  );
  assert.equal(
    (await call(fake, `/production-requests/${id}/cancel`, M2_OWNER, { method: 'POST' })).status,
    404
  );
  assert.deepEqual((await call(fake, '/production-requests', M2_OWNER)).json.data.items, []);
  // 직원은 보지만 고르기 · 거두기는 못 한다
  assert.equal((await call(fake, `/production-requests/${id}`, M_STAFF)).status, 200);
  const staff = await call(fake, `/production-requests/${id}/choose`, M_STAFF, {
    method: 'POST',
    body: { company_id: E },
  });
  assert.deepEqual([staff.status, staff.json.code], [403, 'not_manager']);
  for (const [method, path] of [
    ['GET', '/admin/production-requests'],
    ['POST', `/admin/production-requests/${id}/review`],
    ['GET', `/admin/production-requests/${id}/suggestions`],
    ['POST', `/admin/production-requests/${id}/recommend`],
  ]) {
    const r = await call(fake, path, M_OWNER, {
      method,
      body: method === 'POST' ? { company_ids: [E] } : undefined,
    });
    assert.deepEqual([r.status, r.json.code], [403, 'not_admin'], path);
  }
});

test('팩토리 — 남에게 온 의뢰는 안 보이고 받지 못한다, 직원은 받기 · 못 받음 못 함, 고르지 않은 추천 팩토리도 못 받음', async () => {
  const fake = fresh();
  const id = await recommended(fake, [E, A]);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  // A 는 추천만 되고 안 골림
  assert.equal(
    (await call(fake, `/factory/production-requests/${id}/accept`, A_OWNER, { method: 'POST' }))
      .status,
    404
  );
  assert.equal(
    (
      await call(fake, `/factory/production-requests/${id}/decline`, A_OWNER, {
        method: 'POST',
        body: {},
      })
    ).status,
    404
  );
  assert.equal(
    (await call(fake, `/factory/production-requests/${id}/accept`, F_OWNER, { method: 'POST' }))
      .status,
    404
  );
  const staff = await call(fake, `/factory/production-requests/${id}/accept`, E_STAFF, {
    method: 'POST',
  });
  assert.deepEqual([staff.status, staff.json.code], [403, 'not_manager']);
  assert.deepEqual((await call(fake, '/factory/production-requests', F_OWNER)).json.data.items, []);
  // Manager 업체 구성원은 팩토리 목록이 비어 있다
  assert.deepEqual((await call(fake, '/factory/production-requests', M_OWNER)).json.data.items, []);
  assert.equal((await call(fake, '/factory/production-requests', NOBODY)).status, 403);
  assert.equal(fake.db.production_requests.find((r) => r.id === id).status, 'chosen');
});

// ── 추천 확인 ──────────────────────────────────────────────────

test('추천 — 풀 안 팩토리만 (Manager · 정지 · 모르는 업체 · 의뢰한 업체 자신은 422), 1~5곳 · 같은 곳 두 번 막기', async () => {
  const fake = fresh();
  const made = await call(fake, '/production-requests', M_OWNER, {
    method: 'POST',
    body: { draft_id: 'd-kitchen-01' },
  });
  const id = made.json.data.id;
  const rec = (body) =>
    call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, { method: 'POST', body });
  for (const [ids, reasons] of [
    [[E, M2], ['tier']],
    [[X], ['inactive']],
    [[M], ['tier']],
    [[cid(77)], ['unknown']],
  ]) {
    const r = await rec({ company_ids: ids });
    assert.deepEqual(
      [r.status, r.json.code, r.json.details.reasons],
      [422, 'not_eligible', reasons],
      JSON.stringify(ids)
    );
  }
  assert.equal((await rec({ company_ids: [] })).status, 422);
  assert.equal((await rec({ company_ids: [E, E.toUpperCase()] })).status, 422);
  assert.equal((await rec({ company_ids: [E, A, FACTORY, cid(6), cid(7), cid(8)] })).status, 422);
  assert.equal((await rec({ company_ids: [E], notes: { [A]: '추천 안 한 곳' } })).status, 422);
  assert.equal((await rec({ company_ids: [E], note: '가'.repeat(501) })).status, 422);
  assert.equal(fake.db.production_recommendations.length, 0);
  // 다담 공장 · 지역 밖 Agent 는 된다 (지역은 후보 화면의 이유일 뿐)
  const ok = await rec({ company_ids: [FACTORY, A] });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  // Manager 가 고르기 전 다시 추천 — 다음 차례, 화면은 새 차례만
  const again = await rec({ company_ids: [E] });
  assert.equal(again.json.data.round, 2);
  const d = await call(fake, `/production-requests/${id}`, M_OWNER);
  assert.deepEqual(
    d.json.data.recommendations.map((r) => r.company_id),
    [E]
  );
  // 앞 차례 팩토리는 고를 수 없다
  const old = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: A },
  });
  assert.deepEqual([old.status, old.json.code], [422, 'not_recommended_company']);
  // 끝난 의뢰는 추천하지 못한다 (고른 팩토리가 없어 거둠 알림도 없다)
  assert.equal(
    (await call(fake, `/production-requests/${id}`, M_OWNER)).json.data.status,
    'recommended'
  );
  await call(fake, `/production-requests/${id}/cancel`, M_OWNER, { method: 'POST' });
  assert.equal(kindsOf(fake, 'production_cancelled').length, 0);
  const closed = await rec({ company_ids: [E] });
  assert.deepEqual([closed.status, closed.json.code], [409, 'not_recommendable']);
});

test('추천 — 팩토리마다 예상 가격대 · 제작 기간 (적은 것만, 원 · 일), Manager 카드 · 본사 화면에 싣고 팩토리 화면에는 없다', async () => {
  const fake = fresh();
  const made = await call(fake, '/production-requests', M_OWNER, {
    method: 'POST',
    body: { draft_id: 'd-kitchen-01' },
  });
  const id = made.json.data.id;
  const rec = await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: {
      company_ids: [E, A, FACTORY],
      notes: { [E]: '강남구 · 싱크대 전문' },
      estimates: {
        [E.toUpperCase()]: { price_min: 12000000, price_max: 15000000, lead_days: 20 },
        [A]: { price_max: 15000000 },
        [FACTORY]: { price_min: null, price_max: null, lead_days: null },
      },
    },
  });
  assert.equal(rec.status, 201, JSON.stringify(rec.json));
  const pick = (r) => [r.company_id, r.price_min, r.price_max, r.lead_days];
  const want = [
    [E, 12000000, 15000000, 20],
    [A, null, 15000000, null],
    [FACTORY, null, null, null],
  ];
  assert.deepEqual(rec.json.data.recommendations.map(pick), want);
  assert.deepEqual(
    fake.db.production_recommendations
      .filter((r) => r.request_id === id)
      .sort((a, b) => a.rank - b.rank)
      .map(pick),
    want
  );
  // Manager 추천 카드 — 직원도 본다 (점수는 여전히 없다)
  const d = await call(fake, `/production-requests/${id}`, M_STAFF);
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.data.recommendations.map(pick), want);
  assert.equal(d.json.data.recommendations[0].note, '강남구 · 싱크대 전문');
  // 본사 목록 (답 기다림 탭 — 추천 도착)
  const q = await call(fake, '/admin/production-requests?state=waiting', ADMIN);
  assert.deepEqual(q.json.data.items.find((i) => i.id === id).recommendations.map(pick), want);
  // 팩토리 화면에는 싣지 않는다
  const chose = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  assert.equal(chose.status, 200, JSON.stringify(chose.json));
  const f = await call(fake, '/factory/production-requests', E_OWNER);
  assert.equal(f.json.data.items.length, 1);
  const text = JSON.stringify(f.json);
  for (const key of ['price_min', 'price_max', 'lead_days', '12000000', '15000000'])
    assert.ok(!text.includes(key), `팩토리 화면에 ${key} 가 없다`);
  // 고른 뒤에도 Manager 카드의 값은 그대로
  const after = await call(fake, `/production-requests/${id}`, M_OWNER);
  assert.deepEqual(after.json.data.recommendations.map(pick), want);
});

test('추천 — 예상 가격대 · 제작 기간 검사 (422 code · 그 팩토리), 막히면 추천 줄을 넣지 않는다, 0 원 · 같은 값 · 1일은 된다', async () => {
  const fake = fresh();
  const made = await call(fake, '/production-requests', M_OWNER, {
    method: 'POST',
    body: { draft_id: 'd-kitchen-01' },
  });
  const id = made.json.data.id;
  const rec = (estimates) =>
    call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
      method: 'POST',
      body: { company_ids: [E, A], estimates },
    });
  for (const [estimates, code, company] of [
    [[], 'bad_estimates', undefined],
    ['12000000', 'bad_estimates', undefined],
    [{ [M2]: { price_min: 1 } }, 'bad_estimates', undefined],
    [{ [E]: 12000000 }, 'bad_estimates', E],
    [{ [E]: [12000000, 15000000] }, 'bad_estimates', E],
    [{ [E]: { price: 12000000 } }, 'bad_estimates', E],
    [{ [E]: { price_min: -1 } }, 'bad_price', E],
    [{ [E]: { price_max: 1.5 } }, 'bad_price', E],
    [{ [E]: { price_min: '12000000' } }, 'bad_price', E],
    [{ [E]: { price_max: Number.MAX_SAFE_INTEGER + 1 } }, 'bad_price', E],
    [{ [E]: { price_min: 15000000, price_max: 12000000 } }, 'price_range', E],
    [{ [A]: { lead_days: 0 } }, 'bad_lead_days', A],
    [{ [A]: { lead_days: -3 } }, 'bad_lead_days', A],
    [{ [A]: { lead_days: 2.5 } }, 'bad_lead_days', A],
    [{ [A]: { lead_days: '20' } }, 'bad_lead_days', A],
    [{ [A]: { lead_days: 2147483648 } }, 'bad_lead_days', A],
  ]) {
    const r = await rec(estimates);
    assert.deepEqual(
      [r.status, r.json.code, r.json.details.field, r.json.details.company_id],
      [422, code, 'estimates', company],
      JSON.stringify(estimates)
    );
  }
  assert.equal(fake.db.production_recommendations.length, 0);
  assert.equal(fake.db.production_requests.find((r) => r.id === id).status, 'submitted');
  // 원 단위 그대로 (만 원으로 떨어지지 않아도 된다) · 0 원 · 최소 = 최대 · 1일 · 긴 기간
  const ok = await rec({
    [E]: { price_min: 0, price_max: 0, lead_days: 1 },
    [A]: { price_min: 12345678, price_max: 12345678, lead_days: 400 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.deepEqual(
    ok.json.data.recommendations.map((r) => [r.price_min, r.price_max, r.lead_days]),
    [
      [0, 0, 1],
      [12345678, 12345678, 400],
    ]
  );
  // 넣은 줄의 값은 바꾸지 못한다 (DB 0055 지킴이 — 가짜도 같게 막는다)
  const row = fake.db.production_recommendations.find((r) => r.company_id === E);
  const patched = await withFetch(fake, () =>
    fetch(`${ENV.SUPABASE_URL}/rest/v1/production_recommendations?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_days: 30 }),
    })
  );
  assert.equal(patched.status, 400);
  assert.equal(row.lead_days, 1);
});

// ── 못 받음 · 답 없음 · 다시 추천 ─────────────────────────────────

test('못 받음 → 본사 차례 · Manager 알림, 그 팩토리는 다시 추천 못 함 → 다른 팩토리로 다시 추천 → 받기', async () => {
  const fake = fresh();
  const id = await recommended(fake, [E, A]);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  const tooLong = await call(fake, `/factory/production-requests/${id}/decline`, E_OWNER, {
    method: 'POST',
    body: { reason: '가'.repeat(501) },
  });
  assert.equal(tooLong.status, 422);
  const dec = await call(fake, `/factory/production-requests/${id}/decline`, E_OWNER, {
    method: 'POST',
    body: { reason: ' 12월 일정이 찼습니다 ' },
  });
  assert.equal(dec.status, 200, JSON.stringify(dec.json));
  assert.deepEqual(dec.json.data, { request_id: id, status: 'declined' });
  const rec = fake.db.production_recommendations.find(
    (r) => r.request_id === id && r.company_id === E
  );
  assert.deepEqual(
    [rec.response, rec.reason, rec.responded_by],
    ['declined', '12월 일정이 찼습니다', E_OWNER]
  );
  assert.deepEqual(
    kindsOf(fake, 'production_answered').map((n) => n.title),
    ['제작 의뢰 못 받음', '제작 의뢰 못 받음']
  );
  // 다시 못 받음 · 받기는 409
  assert.equal(
    (await call(fake, `/factory/production-requests/${id}/accept`, E_OWNER, { method: 'POST' }))
      .json.code,
    'not_open'
  );
  // 본사 목록(본사 차례)에 다시 — 못 받음 사유는 본사만
  const q = await call(fake, '/admin/production-requests', ADMIN);
  const item = q.json.data.items.find((i) => i.id === id);
  assert.equal(item.status, 'declined');
  assert.deepEqual(
    item.offers.map((o) => [o.company_id, o.state, o.reason]),
    [[E, 'declined', '12월 일정이 찼습니다']]
  );
  assert.deepEqual(
    item.tried.map((t) => t.company_id),
    [E]
  );
  const mine = await call(fake, `/production-requests/${id}`, M_OWNER);
  assert.ok(
    !JSON.stringify(mine.json).includes('12월 일정'),
    'Manager 화면에 못 받음 사유를 싣지 않는다'
  );
  assert.deepEqual(
    mine.json.data.offers.map((o) => [o.company_id, o.state]),
    [[E, 'declined']]
  );
  // 후보 · 추천 — E 는 tried
  const sug = await call(fake, `/admin/production-requests/${id}/suggestions`, ADMIN);
  assert.deepEqual(sug.json.data.filtered.find((f) => f.company_id === E).reasons, ['tried']);
  const back = await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: { company_ids: [E] },
  });
  assert.deepEqual([back.status, back.json.details.reasons], [422, ['tried']]);
  const r2 = await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: { company_ids: [A, FACTORY] },
  });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.data.round, 2);
  assert.equal(fake.db.production_requests.find((r) => r.id === id).factory_company_id, null);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: A },
  });
  const acc = await call(fake, `/factory/production-requests/${id}/accept`, A_OWNER, {
    method: 'POST',
  });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const done = await call(fake, `/production-requests/${id}`, M_OWNER);
  assert.deepEqual(
    done.json.data.offers.map((o) => [o.round, o.company_id, o.state]),
    [
      [1, E, 'declined'],
      [2, A, 'accepted'],
    ]
  );
  // E 의 목록에는 못 받은 의뢰가 내용 없이 남는다
  const eList = await call(fake, '/factory/production-requests', E_OWNER);
  assert.deepEqual(
    eList.json.data.items.map((i) => [i.state, i.note, i.design, i.can_act]),
    [['declined', null, null, false]]
  );
});

test('답 없음 — 24시간 지나면 1분 cron 이 expired 로, 본사 차례 · Manager 알림, 그 뒤 받기는 409', async () => {
  const NOW = Date.now();
  const fake = fresh({ nowMs: NOW });
  const id = await recommended(fake, [E, A]);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  // 아직 23시간 — 그대로
  let r = await withFetch(fake, () => runProductionOfferExpiry(ENV, { nowMs: NOW + 23 * HOUR }));
  assert.deepEqual(r, { expired: 0, closed: 0, failed: 0 });
  r = await withFetch(fake, () => runProductionOfferExpiry(ENV, { nowMs: NOW + 25 * HOUR }));
  assert.deepEqual(r, { expired: 1, closed: 0, failed: 0 });
  const req = fake.db.production_requests.find((x) => x.id === id);
  assert.deepEqual([req.status, req.factory_company_id], ['expired', E]);
  assert.equal(
    fake.db.production_recommendations.find((x) => x.request_id === id && x.chosen).response,
    'expired'
  );
  assert.deepEqual(kindsOf(fake, 'production_answered').map((n) => [n.title, n.body])[0], [
    '제작 의뢰 답 없음',
    '고른 팩토리가 24시간 안에 답하지 않았습니다. 본사가 다시 추천해 드립니다.',
  ]);
  // 다시 돌려도 아무것도 안 한다
  assert.deepEqual(
    await withFetch(fake, () => runProductionOfferExpiry(ENV, { nowMs: NOW + 26 * HOUR })),
    { expired: 0, closed: 0, failed: 0 }
  );
  const late = await call(fake, `/factory/production-requests/${id}/accept`, E_OWNER, {
    method: 'POST',
  });
  assert.deepEqual([late.status, late.json.code], [409, 'not_open']);
  assert.equal(fake.db.projects.filter((p) => p.company_id === E).length, 0);
  // 다시 추천 — E 는 빠진다
  const back = await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: { company_ids: [E] },
  });
  assert.deepEqual(back.json.details.reasons, ['tried']);
  assert.equal(
    (
      await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
        method: 'POST',
        body: { company_ids: [A] },
      })
    ).status,
    201
  );
});

test('답 없음 — cron 이 돌기 전이라도 기한이 지난 의뢰는 받기 · 못 받음 409 expired', async () => {
  const NOW = Date.now();
  const fake = fresh({ nowMs: NOW });
  const id = await recommended(fake, [E]);
  fake.setNow(NOW - 25 * HOUR); // 25시간 전에 고른 것처럼
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  fake.setNow(NOW);
  const list = await call(fake, '/factory/production-requests', E_OWNER);
  assert.deepEqual(
    [list.json.data.items[0].state, list.json.data.items[0].can_act],
    ['open', false]
  );
  for (const action of ['accept', 'decline']) {
    const r = await call(fake, `/factory/production-requests/${id}/${action}`, E_OWNER, {
      method: 'POST',
      body: {},
    });
    assert.deepEqual([r.status, r.json.code], [409, 'expired'], action);
  }
  assert.equal(fake.db.projects.filter((p) => p.company_id === E).length, 0);
});

// ── 거두기 ────────────────────────────────────────────────────

test('거두기 — 답 기다리는 중에도, 팩토리 줄은 거둠으로 닫히고 그 팩토리 대표 · 실장에게 알림, 받기는 409, 받은 의뢰는 못 거둔다', async () => {
  const fake = fresh();
  const id = await recommended(fake, [E]);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  const c = await call(fake, `/production-requests/${id}/cancel`, M_CHIEF, { method: 'POST' });
  assert.deepEqual([c.status, c.json.data.status], [200, 'cancelled']);
  const req = fake.db.production_requests.find((r) => r.id === id);
  assert.deepEqual([req.status, req.factory_company_id], ['cancelled', null]);
  const chosen = fake.db.production_recommendations.find((r) => r.request_id === id && r.chosen);
  assert.equal(chosen.response, 'cancelled');
  // 답을 기다리던 팩토리 E 의 대표 · 실장에게 (직원 · Manager 쪽은 아니다)
  const gone = kindsOf(fake, 'production_cancelled');
  assert.deepEqual(gone.map((n) => n.user_id).sort(), [E_OWNER, E_CHIEF].sort());
  assert.ok(
    gone.every(
      (n) =>
        n.company_id === E &&
        n.ref_id === chosen.id &&
        n.title === '제작 의뢰 거둠' &&
        n.url === '/segan/me.html#factory-requests'
    )
  );
  assert.equal(
    gone[0].body,
    '의뢰한 업체가 싱크대 제작 의뢰를 거뒀습니다. 받기 · 못 받음을 고르지 않아도 됩니다.'
  );
  const acc = await call(fake, `/factory/production-requests/${id}/accept`, E_OWNER, {
    method: 'POST',
  });
  assert.deepEqual([acc.status, acc.json.code], [409, 'not_open']);
  assert.deepEqual(
    (await call(fake, '/factory/production-requests', E_OWNER)).json.data.items.map((i) => [
      i.state,
      i.note,
    ]),
    [['cancelled', null]]
  );
  // 두 번 눌러도 같다 (알림도 한 번)
  assert.equal(
    (await call(fake, `/production-requests/${id}/cancel`, M_CHIEF, { method: 'POST' })).status,
    200
  );
  assert.equal(kindsOf(fake, 'production_cancelled').length, 2);
  // 받은 의뢰
  const id2 = await recommended(fake, [A], { draft_id: 'd-closet-02' });
  await call(fake, `/production-requests/${id2}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: A },
  });
  await call(fake, `/factory/production-requests/${id2}/accept`, A_OWNER, { method: 'POST' });
  const no = await call(fake, `/production-requests/${id2}/cancel`, M_OWNER, { method: 'POST' });
  assert.deepEqual([no.status, no.json.code], [409, 'not_cancellable']);
  // 팩토리가 이미 못 받은 의뢰를 거두면 알리지 않는다 (답을 기다리는 팩토리가 없다)
  const id3 = await recommended(fake, [E]);
  await call(fake, `/production-requests/${id3}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  await call(fake, `/factory/production-requests/${id3}/decline`, E_OWNER, {
    method: 'POST',
    body: {},
  });
  const after = await call(fake, `/production-requests/${id3}/cancel`, M_OWNER, {
    method: 'POST',
  });
  assert.deepEqual([after.status, after.json.data.status], [200, 'cancelled']);
  assert.equal(kindsOf(fake, 'production_cancelled').length, 2);
});

test('고르기 — 추천 도착 전 · 이미 고른 의뢰는 409, 그사이 팩토리가 정지되면 422', async () => {
  const fake = fresh();
  const made = await call(fake, '/production-requests', M_OWNER, {
    method: 'POST',
    body: { draft_id: 'd-kitchen-01' },
  });
  const id = made.json.data.id;
  const early = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  assert.deepEqual([early.status, early.json.code], [409, 'not_recommended']);
  await call(fake, `/admin/production-requests/${id}/recommend`, ADMIN, {
    method: 'POST',
    body: { company_ids: [E, A] },
  });
  fake.db.companies.find((c) => c.id === E).status = 'suspended';
  const susp = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  assert.deepEqual([susp.status, susp.json.code], [422, 'not_eligible']);
  assert.equal(fake.db.production_recommendations.filter((r) => r.chosen).length, 0);
  assert.equal(
    (
      await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
        method: 'POST',
        body: { company_id: A },
      })
    ).status,
    200
  );
  const twice = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: A },
  });
  assert.deepEqual([twice.status, twice.json.code], [409, 'not_recommended']);
  assert.equal(
    (
      await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
        method: 'POST',
        body: { company_id: 'x' },
      })
    ).status,
    422
  );
});

test('고르기 — 의뢰 잠금에 지면(그사이 다시 추천) 고른 줄을 거둠으로 닫고 409', async () => {
  let fake;
  fake = createFake({
    tables: tables(),
    admins: [ADMIN],
    // 의뢰 잠금(PATCH production_requests status=eq.recommended) 직전에 본사가 다시 추천한 것처럼 차례를 올린다
    before: (method, table, params, body) => {
      if (
        method === 'PATCH' &&
        table === 'production_requests' &&
        body &&
        body.status === 'chosen'
      ) {
        const row = fake.db.production_requests.find((r) => `eq.${r.id}` === params.get('id'));
        row.round += 1;
      }
      return null;
    },
  });
  const id = await recommended(fake, [E]);
  const r = await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  assert.deepEqual([r.status, r.json.code], [409, 'stale']);
  const rec = fake.db.production_recommendations.find((x) => x.request_id === id);
  assert.deepEqual([rec.chosen, rec.response], [true, 'cancelled']);
  assert.equal(kindsOf(fake, 'production_offered').length, 0);
});

test('받기 — 의뢰 잠금에 지면(그사이 거둠) 만든 고객 · 프로젝트를 지우고 409', async () => {
  let fake;
  fake = createFake({
    tables: tables(),
    admins: [ADMIN],
    before: (method, table, params, body) => {
      if (
        method === 'PATCH' &&
        table === 'production_requests' &&
        body &&
        body.status === 'accepted'
      ) {
        const row = fake.db.production_requests.find((x) => `eq.${x.id}` === params.get('id'));
        Object.assign(row, { status: 'cancelled', factory_company_id: null });
      }
      return null;
    },
  });
  const id = await recommended(fake, [E]);
  await call(fake, `/production-requests/${id}/choose`, M_OWNER, {
    method: 'POST',
    body: { company_id: E },
  });
  const r = await call(fake, `/factory/production-requests/${id}/accept`, E_OWNER, {
    method: 'POST',
  });
  assert.deepEqual([r.status, r.json.code], [409, 'not_open']);
  assert.equal(fake.db.projects.filter((p) => p.company_id === E).length, 0);
  assert.equal(fake.db.customers.filter((c) => c.company_id === E).length, 0);
  assert.equal(fake.db.planner_drafts.filter((d) => d.company_id === E).length, 0);
});

test('0050 적용 전 — 쓰기 409 db_pending, 목록 ready false', async () => {
  const fake = createFake({
    tables: tables(),
    admins: [ADMIN],
    before: (method, table) =>
      table.startsWith('production_')
        ? new Response(
            JSON.stringify({
              code: '42P01',
              message: 'relation "public.production_requests" does not exist',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        : null,
  });
  const w = await call(fake, '/production-requests', M_OWNER, {
    method: 'POST',
    body: { draft_id: 'd-kitchen-01' },
  });
  assert.deepEqual([w.status, w.json.code], [409, 'db_pending']);
  for (const [who, path] of [
    [M_OWNER, '/production-requests'],
    [ADMIN, '/admin/production-requests'],
    [E_OWNER, '/factory/production-requests'],
  ]) {
    const r = await call(fake, path, who);
    assert.deepEqual([r.status, r.json.data.ready, r.json.data.items], [200, false, []], path);
  }
  assert.deepEqual(await withFetch(fake, () => runProductionOfferExpiry(ENV)), {
    expired: 0,
    closed: 0,
    failed: 0,
    skipped: 'db',
  });
});

// ── 본사 Slack · 알림 글 ─────────────────────────────────────────

test('본사 Slack — 새 의뢰 · 못 받음 · 답 없음 (업체 이름 · 품목 · 지역만, 멘션 막기)', async () => {
  const fake = fresh();
  const posts = [];
  const env = {
    ...ENV,
    SLACK_WEBHOOK_URL: 'https://hooks.slack.test/T/B/x',
    PUBLIC_BASE_URL: 'https://dadamfurniture.com/',
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://hooks.slack.test/')) {
      posts.push(JSON.parse(init.body));
      return new Response('ok', { status: 200 });
    }
    return fake.fetch(input, init);
  };
  try {
    await createRequest(env, {
      user: { id: M_OWNER },
      body: {
        draft_id: 'd-kitchen-01',
        sido: '서울특별시',
        gugun: '강남구',
        note: '김고객 010-1111-2222',
      },
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(posts.length, 1);
  assert.equal(
    posts[0].text,
    '새 제작 의뢰 — 가나 인테리어 · 싱크대 · 서울특별시 강남구. 검토해 팩토리를 추천해 주세요.\nhttps://dadamfurniture.com/segan/admin.html#production'
  );
  assert.equal(
    posts[0].blocks[0].text.text,
    '새 제작 의뢰 — 가나 인테리어 · 싱크대 · 서울특별시 강남구. 검토해 팩토리를 추천해 주세요.\n<https://dadamfurniture.com/segan/admin.html#production|제작 의뢰 열기>'
  );
  assert.ok(!JSON.stringify(posts[0]).includes('김고객'), '메모 · 설계 이름을 싣지 않는다');
  assert.equal(
    buildHqSlack('declined', { managerName: '<!channel> 업체', item: 'wardrobe', region: '' }).text,
    '제작 의뢰 다시 추천 필요 — &lt;!channel&gt; 업체 · 붙박이장: 고른 팩토리가 못 받았습니다.'
  );
  assert.equal(
    buildHqSlack('expired', { managerName: '가나', item: 'shoe_x', region: '부산광역시' }).text,
    '제작 의뢰 다시 추천 필요 — 가나 · 품목 미지정 · 부산광역시: 고른 팩토리가 24시간 안에 답하지 않았습니다.'
  );
  assert.equal(buildHqSlack('other', {}), null);
  assert.equal(slackName(''), '이름 없는 업체');
  assert.equal([...slackName('가'.repeat(80))].length, 40);
});

test('알림 글 — 제작 의뢰 넷 (이름 · 메모 없음, DB 글자 수 안, 앱 안 주소)', () => {
  const cases = [
    [
      'production_recommended',
      { count: 3 },
      '제작 의뢰 추천',
      '본사가 제작 의뢰에 팩토리 3곳을 추천했습니다. 맡길 곳을 골라 주세요.',
      '/segan/me.html#production-requests',
    ],
    [
      'production_recommended',
      { count: 99 },
      '제작 의뢰 추천',
      '본사가 제작 의뢰에 팩토리를 추천했습니다. 맡길 곳을 골라 주세요.',
      '/segan/me.html#production-requests',
    ],
    [
      'production_offered',
      { item: 'vanity' },
      '새 제작 의뢰',
      '화장대 제작 의뢰가 왔습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.',
      '/segan/me.html#factory-requests',
    ],
    [
      'production_offered',
      { item: '김고객' },
      '새 제작 의뢰',
      '제작 의뢰가 왔습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.',
      '/segan/me.html#factory-requests',
    ],
    [
      'production_answered',
      { answer: 'accepted' },
      '제작 의뢰 받음',
      '고른 팩토리가 제작 의뢰를 받았습니다. 제작 의뢰에서 확인해 주세요.',
      '/segan/me.html#production-requests',
    ],
    [
      'production_answered',
      { answer: 'declined' },
      '제작 의뢰 못 받음',
      '고른 팩토리가 제작 의뢰를 받지 못했습니다. 본사가 다시 추천해 드립니다.',
      '/segan/me.html#production-requests',
    ],
    [
      'production_answered',
      { answer: 'expired' },
      '제작 의뢰 답 없음',
      '고른 팩토리가 24시간 안에 답하지 않았습니다. 본사가 다시 추천해 드립니다.',
      '/segan/me.html#production-requests',
    ],
    [
      'production_cancelled',
      { item: 'fridge' },
      '제작 의뢰 거둠',
      '의뢰한 업체가 냉장고장 제작 의뢰를 거뒀습니다. 받기 · 못 받음을 고르지 않아도 됩니다.',
      '/segan/me.html#factory-requests',
    ],
    [
      'production_cancelled',
      { item: '김고객' },
      '제작 의뢰 거둠',
      '의뢰한 업체가 제작 의뢰를 거뒀습니다. 받기 · 못 받음을 고르지 않아도 됩니다.',
      '/segan/me.html#factory-requests',
    ],
  ];
  for (const [kind, params, title, body, url] of cases) {
    const m = buildMessage(kind, params);
    assert.deepEqual(m, { title, body, url }, `${kind} ${JSON.stringify(params)}`);
    assert.ok(isValidMessage(m));
  }
  assert.equal(buildMessage('production_answered', { answer: 'cancelled' }), null);
  for (const k of [
    'production_recommended',
    'production_offered',
    'production_answered',
    'production_cancelled',
  ])
    assert.ok(NOTIFICATION_KINDS.includes(k));
  assert.equal(PRODUCTION_RECOMMEND_MAX, RECOMMEND_MAX);
});

// ── 순수 함수 ───────────────────────────────────────────────────

test('값 — 24시간은 상담 배정과 같다, 대표 · 실장만, 점수용 상담 모양, 사본 id · 프로젝트 제목', () => {
  assert.equal(OFFER_TTL_HOURS, ASSIGNMENT_TTL_HOURS);
  assert.equal(OFFER_TTL_HOURS, 24);
  assert.deepEqual([...ACT_ROLES], ['owner', 'manager']);
  assert.deepEqual(
    consultLike({
      id: 'r',
      sido: '서울특별시',
      gugun: '강남구',
      item: 'sink',
      wanted_done_date: '2027-01-01',
    }),
    {
      id: 'r',
      sido: '서울특별시',
      gugun: '강남구',
      furniture_categories: ['sink'],
      wanted_price_tier: null,
      wanted_done_date: '2027-01-01',
      request_detail_design: false,
    }
  );
  const id = 'D0000000-0000-4000-8000-000000000001';
  assert.equal(factoryDraftIdOf(id), 'pr-d0000000-0000-4000-8000-000000000001');
  assert.match(factoryDraftIdOf(id), /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/);
  assert.equal(factoryProjectTitle('가나 인테리어', 'sink'), '가나 인테리어 제작 의뢰 · 싱크대');
  assert.equal(factoryProjectTitle('가나', 'unknown_item'), '가나 제작 의뢰');
  assert.ok([...factoryProjectTitle('가'.repeat(200), 'sink')].length <= 100);
  assert.deepEqual(parseRequest({ draft_id: 'd-kitchen-01', sido: ' 서울특별시 ', note: '  ' }), {
    draft_id: 'd-kitchen-01',
    design_id: null,
    project_id: null,
    note: null,
    sido: '서울특별시',
    gugun: null,
    wanted_done_date: null,
  });
  assert.throws(() => parseRequest({ draft_id: 'd-kitchen-01', gugun: '강남구' }), /시\/도와 같이/);
  const pr = parseRecommend({
    company_ids: [E.toUpperCase()],
    note: ' 말 ',
    notes: { [E.toUpperCase()]: ' 소개 ' },
  });
  assert.deepEqual([pr.ids, pr.hqNote, [...pr.notes]], [[E], '말', [[E, '소개']]]);
  assert.deepEqual([...pr.estimates], []);
  // 예상 가격대 · 제작 기간 — 대문자 id 도 같은 팩토리, 적지 않은 칸은 null, 셋 다 없으면 줄 없음
  const pe = parseRecommend({
    company_ids: [E, A],
    estimates: {
      [E.toUpperCase()]: { price_min: 12000000, lead_days: 20 },
      [A]: { price_min: null },
    },
  });
  assert.deepEqual(
    [...pe.estimates],
    [[E, { price_min: 12000000, price_max: null, lead_days: 20 }]]
  );
  assert.deepEqual([...ESTIMATE_KEYS], ['price_min', 'price_max', 'lead_days']);
  assert.equal(parseEstimate(undefined), null);
  assert.equal(parseEstimate({}), null);
  assert.deepEqual(parseEstimate({ price_max: 15000000 }), {
    price_min: null,
    price_max: 15000000,
    lead_days: null,
  });
  assert.throws(
    () => parseEstimate({ price_min: 2, price_max: 1 }, E),
    (e) => e.code === 'price_range' && e.statusCode === 422 && e.details.company_id === E
  );
  // 고른 줄의 상태 — 의뢰 줄이 정본
  const rec = { chosen: true, response: null, round: 2, company_id: E };
  assert.equal(offerState(rec, { status: 'chosen', round: 2, factory_company_id: E }), 'open');
  assert.equal(
    offerState(rec, { status: 'accepted', round: 2, factory_company_id: E }),
    'accepted'
  );
  assert.equal(
    offerState(rec, { status: 'recommended', round: 3, factory_company_id: null }),
    'cancelled'
  );
  assert.equal(
    offerState({ ...rec, response: 'declined' }, { status: 'recommended', round: 3 }),
    'declined'
  );
  assert.equal(offerState({ chosen: false }, {}), null);
});
