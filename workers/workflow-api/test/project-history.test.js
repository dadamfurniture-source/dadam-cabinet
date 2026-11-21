/**
 * 일지를 「일어난 일」 · 「소식」에 얹기 (src/project-history.js) — 2026-11-21 뒤 공정 1차 「누가 했는지」.
 *
 * 고정하는 것
 *   1) eventKind — 일지의 사건 이름을 화면의 kind 로 (수주 상태 · 돈 단계 · 프로젝트 상태 · 담당자)
 *   2) 뽑은 줄과 같은 일이면 그 줄에 「누가」만 붙인다 (가장 새 일지 줄과 짝) — 줄이 늘지 않는다
 *   3) 일지에만 있는 일 · 같은 일의 앞 차례는 줄을 더한다. 1분 안에 두 번 누른 것은 하나로
 *   4) 고객 이름은 없다 — 구성원이면 이름, 나간 사람이면 null, 고객 · 본사는 종류만
 *   5) 프로젝트 창 · 받은 일이 실제로 얹어 준다 (서버 길)
 * 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { EVENT_LABEL, eventKind, mergeEvents, whoOf } from '../src/project-history.js';
import { HISTORY_LABEL } from '../src/company-project.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = cid(1);
const OWNER = uid(11);
const STAFF = uid(13);
const GONE = uid(19); // 나간 구성원
const P1 = rid(11);
const D1 = rid(21);
const Q1 = rid(31);
const O1 = rid(41);
const at = (d, h = 9, m = 0) =>
  `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const ev = (type, created_at, extra = {}) => ({
  id: rid(900 + Math.floor(Math.random() * 90)),
  company_id: A,
  project_id: P1,
  actor_user_id: OWNER,
  actor_kind: 'member',
  type,
  subject_type: null,
  subject_id: null,
  from_status: null,
  to_status: null,
  payload: {},
  created_at,
  ...extra,
});
const memberOf = new Map([
  [OWNER, { user_id: OWNER, name: '가대표', role: 'owner' }],
  [STAFF, { user_id: STAFF, name: '나직원', role: 'staff' }],
]);
const labelOf = (k) => HISTORY_LABEL[k];

test('이름 — 일지에만 있는 일의 글이 모두 있고, 프로젝트 창의 글 표에 들어 있다', () => {
  for (const [k, v] of Object.entries(EVENT_LABEL)) {
    assert.ok(typeof v === 'string' && v, k);
    assert.equal(HISTORY_LABEL[k], v);
  }
  assert.equal(EVENT_LABEL.project_held, '프로젝트를 보류했습니다');
});

test('eventKind — 사건 이름을 화면의 kind · 대상 · 갈 곳으로', () => {
  const k = (type, extra) => eventKind(ev(type, at(1), extra));
  assert.deepEqual(k('consult_accepted', { subject_id: P1 }), {
    kind: 'project_created',
    ref: P1,
    go: null,
  });
  assert.deepEqual(k('quote_approved', { subject_id: Q1 }), {
    kind: 'quote_approved',
    ref: Q1,
    go: 'p-quote',
  });
  assert.deepEqual(
    ['in_production', 'delivered', 'completed', 'cancelled', 'confirmed'].map(
      (to) => k('order_status', { subject_id: O1, to_status: to }).kind
    ),
    ['order_started', 'order_delivered', 'order_completed', 'order_cancelled', 'order_reverted']
  );
  assert.equal(k('order_status', { to_status: 'weird' }), null);
  // 돈 — 단계로 가르고, 짝짓기는 수주로
  assert.deepEqual(
    k('payment_paid', { subject_id: rid(77), payload: { stage: 'deposit', order_id: O1 } }),
    { kind: 'deposit_paid', ref: O1, go: 'p-contract' }
  );
  assert.equal(
    k('payment_paid', { payload: { stage: 'balance', order_id: O1 } }).kind,
    'balance_paid'
  );
  assert.equal(k('payment_paid', { payload: { stage: 'interim' } }).kind, 'payment_paid');
  // 프로젝트 상태 · 담당자
  assert.deepEqual(
    ['on_hold', 'active', 'cancelled'].map((to) => k('status_changed', { to_status: to }).kind),
    ['project_held', 'project_resumed', 'project_cancelled']
  );
  assert.equal(k('assignee_changed', { payload: { assigned: true } }).kind, 'assignee_set');
  assert.equal(k('assignee_changed', { payload: { assigned: false } }).kind, 'assignee_cleared');
  assert.equal(k('something_new'), null);
  assert.equal(eventKind(null), null);
});

test('whoOf — 구성원은 이름(나간 사람은 null), 고객 · 본사는 종류만, 서버(자동)는 없음', () => {
  assert.deepEqual(whoOf(ev('x', at(1)), memberOf), { kind: 'member', name: '가대표' });
  assert.deepEqual(whoOf(ev('x', at(1), { actor_user_id: GONE }), memberOf), {
    kind: 'member',
    name: null,
  });
  assert.deepEqual(
    whoOf(ev('x', at(1), { actor_kind: 'customer', actor_user_id: null }), memberOf),
    { kind: 'customer', name: null }
  );
  assert.deepEqual(whoOf(ev('x', at(1), { actor_kind: 'admin' }), memberOf), {
    kind: 'admin',
    name: null,
  });
  assert.equal(
    whoOf(ev('x', at(1), { actor_kind: 'system', actor_user_id: null }), memberOf),
    null
  );
});

test('mergeEvents — 같은 일에는 「누가」만 붙고, 일지에만 있는 일 · 앞 차례는 줄이 더해진다', () => {
  const derived = [
    { kind: 'quote_sent', at: at(2), label: labelOf('quote_sent'), go: 'p-quote', ref: Q1 },
    { kind: 'quote_approved', at: at(3), label: labelOf('quote_approved'), go: 'p-quote', ref: Q1 },
    {
      kind: 'order_delivered',
      at: at(10),
      label: labelOf('order_delivered'),
      go: 'p-install',
      ref: O1,
    }, // 마지막 배송
    {
      kind: 'deposit_paid',
      at: '2026-11-05',
      label: labelOf('deposit_paid'),
      go: 'p-contract',
      ref: O1,
    },
    { kind: 'as_requested', at: at(20), label: labelOf('as_requested'), go: 'p-as', ref: rid(60) }, // 일지 없음 (옛 일)
  ];
  const events = [
    ev('quote_sent', at(2, 9, 1), { subject_id: Q1, actor_user_id: STAFF }),
    ev('quote_approved', at(3, 9, 0), {
      subject_id: Q1,
      actor_kind: 'customer',
      actor_user_id: null,
    }),
    // 배송을 두 번 했다 (한 번 되돌렸다) — 앞 차례는 줄로 남고, 마지막은 뽑은 줄에 붙는다
    ev('order_status', at(8), { subject_id: O1, to_status: 'delivered', actor_user_id: STAFF }),
    ev('order_status', at(9), { subject_id: O1, to_status: 'in_production' }),
    ev('order_status', at(10), { subject_id: O1, to_status: 'delivered' }),
    ev('payment_paid', at(5, 15), {
      subject_id: rid(70),
      payload: { stage: 'deposit', paid_on: '2026-11-05', order_id: O1 },
    }),
    // 두 번 누름 — 1분 안이면 하나
    ev('status_changed', at(12, 9, 0), { subject_id: P1, to_status: 'on_hold' }),
    ev('status_changed', at(12, 9, 0).replace(':00.000Z', ':30.000Z'), {
      subject_id: P1,
      to_status: 'on_hold',
    }),
    ev('design_sent', at(1), { subject_id: D1 }),
    ev('unknown_thing', at(1)),
  ];
  const out = mergeEvents(derived, events, { memberOf, labelOf, skip: ['design_sent'] });
  const brief = out
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((x) => [x.kind, x.at, x.who ? `${x.who.kind}:${x.who.name}` : null]);
  assert.deepEqual(brief, [
    ['quote_sent', at(2), 'member:나직원'],
    ['quote_approved', at(3), 'customer:null'],
    ['deposit_paid', '2026-11-05', 'member:가대표'],
    ['order_delivered', at(8), 'member:나직원'], // 앞 차례 — 일지 줄
    ['order_started', at(9), 'member:가대표'], // 일지에만 있는 일
    ['order_delivered', at(10), 'member:가대표'], // 뽑은 줄 + 누가
    ['project_held', at(12), 'member:가대표'], // 두 번 눌러도 한 줄
    ['as_requested', at(20), null], // 일지가 없던 때의 일 — 그대로
  ]);
  // 짝짓기용 칸(ref)은 내보내지 않는다. 글은 kind 의 글
  for (const x of out) {
    assert.equal('ref' in x, false);
    assert.equal(x.label, labelOf(x.kind));
  }
  // 일지가 없으면 뽑은 줄 그대로 (ref 만 빠진다)
  assert.deepEqual(
    mergeEvents(derived, [], { labelOf }),
    derived.map(({ ref, ...rest }) => (void ref, rest))
  );
  assert.deepEqual(mergeEvents(null, null, { labelOf }), []);
});

// ── 서버 길 — 프로젝트 창이 실제로 얹어 준다 ──

test('프로젝트 한 건 — 일지가 있으면 일어난 일에 「누가」가 붙고 보류 · 생산 시작이 줄로 나온다 (이름 · 종류뿐, 고객 이름 없음)', async () => {
  const fake = createFake({
    tables: {
      companies: [{ id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' }],
      company_members: [
        { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
        { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
      ],
      profiles: [
        { id: OWNER, name: '가대표' },
        { id: STAFF, name: '나직원' },
      ],
      customers: [{ id: rid(1), company_id: A, name: '김고객', phone: '010-1111-2222' }],
      projects: [
        {
          id: P1,
          company_id: A,
          customer_id: rid(1),
          title: '예시 주방',
          status: 'active',
          created_at: at(1),
        },
      ],
      designs: [
        {
          id: D1,
          company_id: A,
          user_id: OWNER,
          project_id: P1,
          name: '1안',
          created_at: at(2),
          updated_at: at(2),
        },
      ],
      design_documents: [
        {
          id: Q1,
          design_id: D1,
          doc_type: 'customer_confirmation',
          status: 'approved',
          decision: 'approved',
          created_at: at(3),
          first_viewed_at: at(4),
          view_count: 1,
          decided_at: at(5),
          superseded_by: null,
          expires_at: '2099-01-01T00:00:00Z',
          signer_name: '김고객',
        },
      ],
      orders: [
        {
          id: O1,
          company_id: A,
          project_id: P1,
          document_id: Q1,
          order_no: 'A-1',
          status: 'in_production',
          ordered_at: at(6),
        },
      ],
      generations: [],
      project_events: [
        ev('consult_accepted', at(1, 9, 0), { subject_id: P1 }),
        ev('quote_sent', at(3, 9, 0), { subject_id: Q1, actor_user_id: STAFF }),
        ev('quote_approved', at(5, 9, 0), {
          subject_id: Q1,
          actor_kind: 'customer',
          actor_user_id: null,
        }),
        ev('order_created', at(6, 9, 0), { subject_id: O1 }),
        ev('status_changed', at(7), {
          subject_id: P1,
          from_status: 'active',
          to_status: 'on_hold',
        }),
        ev('status_changed', at(8), {
          subject_id: P1,
          from_status: 'on_hold',
          to_status: 'active',
          actor_user_id: STAFF,
        }),
        ev('order_status', at(9), {
          subject_id: O1,
          from_status: 'confirmed',
          to_status: 'in_production',
          actor_user_id: STAFF,
        }),
        // 다른 프로젝트의 일지는 섞이지 않는다
        ev('status_changed', at(9), {
          project_id: rid(99),
          subject_id: rid(99),
          to_status: 'cancelled',
        }),
      ],
    },
  });
  const r = await callWorker(worker, fake, `/company/projects/${P1}`, OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const who = (h) => (h.who ? `${h.who.kind}:${h.who.name}` : null);
  assert.deepEqual(
    r.json.data.history.map((h) => [h.kind, h.at, who(h)]),
    [
      ['project_created', at(1), 'member:가대표'],
      ['design_linked', at(2), null], // 일지가 없던 일
      ['quote_sent', at(3), 'member:나직원'],
      ['quote_viewed', at(4), null],
      ['quote_approved', at(5), 'customer:null'],
      ['order_created', at(6), 'member:가대표'],
      ['project_held', at(7), 'member:가대표'],
      ['project_resumed', at(8), 'member:나직원'],
      ['order_started', at(9), 'member:나직원'],
    ]
  );
  assert.equal(
    r.json.data.history.find((h) => h.kind === 'project_held').label,
    '프로젝트를 보류했습니다'
  );
  assert.equal(JSON.stringify(r.json.data.history).includes('김고객'), false);
});
