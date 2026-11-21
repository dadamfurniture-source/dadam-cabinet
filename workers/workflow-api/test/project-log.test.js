/**
 * 프로젝트 일지 (src/project-log.js) — 서버 길 끝에서 누가 · 무엇을 했는지 한 줄 (project_events, DB 0078).
 * 2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차 — 「누가 했는지 기록」.
 *
 * 고정하는 것
 *   1) locate — 프로젝트 · 수주 · 설계 · 문서 id 로 업체와 프로젝트를 찾는다. 프로젝트에 이어지지 않았으면 적지 않는다
 *   2) 서버 길 — 프로젝트 만들기 · 담당자 · 설계 잇기/풀기가 일지에 남는다. 같은 값(바뀐 것 없음)은 적지 않는다
 *   3) 일지에는 id · 상태 값만 — 고객 이름 · 전화 · 프로젝트 이름이 들어가지 않는다
 *   4) 일지 표가 없거나 쓰기가 실패해도 원래 일은 그대로다
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { locate, logAt } from '../src/project-log.js';
import { createFake, callWorker, writesOf, ENV } from './helpers/distribution-fake.js';
import { HQ } from './fixtures/company.js';

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
const CUS = rid(1);
const P1 = rid(11);
const P2 = rid(12);
const D1 = rid(21); // P1 에 이어진 설계
const D2 = rid(22); // 프로젝트 없는 설계 (수주 O2 가 있다)
const D3 = rid(23); // 프로젝트도 수주도 없는 설계 — 잇고 푸는 데 쓴다
const DOC1 = rid(31); // D1 의 문서
const O1 = rid(41); // P1 의 수주
const O2 = rid(42); // 프로젝트 없는 수주

function tables() {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF, role: 'staff', status: 'active' },
    ],
    profiles: [{ id: STAFF, name: '나직원' }],
    customers: [{ id: CUS, company_id: A, name: '김고객', phone: '010-1111-2222' }],
    projects: [
      {
        id: P1,
        company_id: A,
        customer_id: CUS,
        title: '예시 주방',
        status: 'active',
        created_at: '2026-11-01T00:00:00Z',
      },
      {
        id: P2,
        company_id: A,
        customer_id: CUS,
        title: '예시 붙박이장',
        status: 'active',
        created_at: '2026-11-02T00:00:00Z',
      },
    ],
    designs: [
      { id: D1, company_id: A, user_id: OWNER, project_id: P1 },
      { id: D2, company_id: A, user_id: OWNER, project_id: null },
      { id: D3, company_id: A, user_id: OWNER, project_id: null },
    ],
    design_documents: [
      { id: DOC1, design_id: D1, doc_type: 'customer_confirmation', status: 'issued' },
    ],
    orders: [
      { id: O1, company_id: A, design_id: D1, project_id: P1, status: 'confirmed' },
      { id: O2, company_id: A, design_id: D2, project_id: null, status: 'confirmed' },
    ],
    project_events: [],
  };
}
const fakeOf = () => createFake({ tables: tables() });
const withFetch = async (fake, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
};
const events = (fake) =>
  fake.db.project_events.map((e) => [
    e.type,
    e.project_id,
    e.actor_kind,
    e.actor_user_id,
    e.subject_type,
    e.subject_id,
  ]);

test('locate — 프로젝트 · 수주 · 설계 · 문서로 업체와 프로젝트를 찾는다, 프로젝트에 이어지지 않았으면 null', async () => {
  const fake = fakeOf();
  await withFetch(fake, async () => {
    const at = { companyId: A, projectId: P1 };
    assert.deepEqual(await locate(ENV, { project: P1 }), at);
    assert.deepEqual(await locate(ENV, { order: O1 }), at);
    assert.deepEqual(await locate(ENV, { design: D1 }), at);
    assert.deepEqual(await locate(ENV, { document: DOC1 }), at);
    assert.equal(await locate(ENV, { order: O2 }), null);
    assert.equal(await locate(ENV, { design: D2 }), null);
    assert.equal(await locate(ENV, { project: rid(999) }), null);
    assert.equal(await locate(ENV, { document: rid(998) }), null);
    assert.equal(await locate(ENV, { order: 'x' }), null);
    assert.equal(await locate(ENV, {}), null);
    assert.equal(await locate(ENV, null), null);
  });
});

test('logAt — 찾은 프로젝트에 한 줄, 못 찾으면 적지 않는다. ctx 가 있으면 응답 뒤로 미룬다', async () => {
  const fake = fakeOf();
  await withFetch(fake, async () => {
    await logAt(
      ENV,
      null,
      { order: O1 },
      {
        actor: { id: OWNER },
        type: 'order_status',
        subject: { type: 'order', id: O1 },
        from: 'confirmed',
        to: 'in_production',
      }
    );
    await logAt(ENV, null, { order: O2 }, { actor: { id: OWNER }, type: 'order_status' }); // 프로젝트 없음
    await logAt(
      ENV,
      null,
      { design: D1 },
      {
        actor: { kind: 'customer' },
        type: 'quote_approved',
        subject: { type: 'document', id: DOC1 },
      }
    );
    const waits = [];
    const r = logAt(
      ENV,
      { waitUntil: (p) => waits.push(p) },
      { project: P2 },
      { type: 'project_created' }
    );
    assert.equal(await r, undefined);
    assert.equal(waits.length, 1);
    await Promise.all(waits);
  });
  assert.deepEqual(events(fake), [
    ['order_status', P1, 'member', OWNER, 'order', O1],
    ['quote_approved', P1, 'customer', null, 'document', DOC1],
    ['project_created', P2, 'system', null, null, null],
  ]);
  assert.deepEqual(
    [fake.db.project_events[0].from_status, fake.db.project_events[0].to_status],
    ['confirmed', 'in_production']
  );
});

test('서버 길 — 프로젝트 만들기 · 담당자 정하기 · 설계 잇기 / 풀기가 일지에 남는다 (같은 값은 적지 않는다)', async () => {
  const fake = fakeOf();
  const call = (path, init) => callWorker(worker, fake, path, OWNER, init);
  // 만들기
  const made = await call('/company/projects', {
    method: 'POST',
    body: { title: '새 프로젝트', customer: { name: '박고객', phone: '010-3333-4444' } },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const NEW = made.json.data.project_id;
  // 담당자
  assert.equal(
    (
      await call(`/company/projects/${P1}/assignee`, {
        method: 'PUT',
        body: { assignee_id: STAFF },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await call(`/company/projects/${P1}/assignee`, {
        method: 'PUT',
        body: { assignee_id: STAFF },
      })
    ).status,
    200
  ); // 같은 값
  // 설계 잇기 → 같은 값 다시 → 풀기
  assert.equal(
    (await call(`/designs/${D3}/project`, { method: 'PUT', body: { project_id: P2 } })).status,
    200
  );
  assert.equal(
    (await call(`/designs/${D3}/project`, { method: 'PUT', body: { project_id: P2 } })).status,
    200
  );
  assert.equal(
    (await call(`/designs/${D3}/project`, { method: 'PUT', body: { project_id: null } })).status,
    200
  );
  assert.deepEqual(events(fake), [
    ['project_created', NEW, 'member', OWNER, 'project', NEW],
    ['assignee_changed', P1, 'member', OWNER, 'project', P1],
    ['design_linked', P2, 'member', OWNER, 'design', D3],
    ['design_unlinked', P2, 'member', OWNER, 'design', D3],
  ]);
  assert.deepEqual(fake.db.project_events[1].payload, { assigned: true });
  // 일지에는 id · 상태 값만 — 이름 · 전화 · 프로젝트 이름이 없다
  const text = JSON.stringify(fake.db.project_events);
  for (const secret of ['박고객', '010-3333', '새 프로젝트', '나직원', '김고객'])
    assert.equal(text.includes(secret), false, secret);
  // 일지는 「쓰기」 수에 세지 않는다 (시험 도우미)
  assert.equal(
    writesOf(fake).some((c) => c.table === 'project_events'),
    false
  );
});

test('일지를 못 써도 원래 일은 그대로다 — 표가 없을 때', async () => {
  const fake = fakeOf();
  delete fake.db.project_events;
  const warns = [];
  const original = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const r = await callWorker(worker, fake, `/company/projects/${P1}/assignee`, OWNER, {
      method: 'PUT',
      body: { assignee_id: STAFF },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(fake.db.projects.find((p) => p.id === P1).assignee_id, STAFF);
  } finally {
    console.warn = original;
  }
  // 가짜는 모르는 표에 일반 오류를 던진다 — 경고 한 줄로 끝난다 (실DB 의 「표 없음」은 경고도 없다)
  assert.ok(warns.length <= 1);
});
