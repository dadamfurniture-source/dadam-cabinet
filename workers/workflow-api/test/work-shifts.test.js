/**
 * 근무 일정 — src/work-shifts.js 를 워커로 부른다.
 *   GET /company/shifts?from=&to= · PUT /company/shifts
 * 가짜 Supabase 는 test/helpers/distribution-fake.js. 시험 데이터는 모두 가짜다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { dayMs, rangeOf, shiftInput, canHoldPeople, kstDateOf, SHIFT_RANGE_DAYS, SHIFT_NOTE_MAX } from '../src/work-shifts.js';
import { createFake, callWorker } from './helpers/distribution-fake.js';
import { HQ as FACTORY } from './fixtures/company.js';

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const uid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER_A = uid(11);
const STAFF_A = uid(13);
const GONE_A = uid(14);
const OWNER_B = uid(21);
const OWNER_E = uid(31);
const PLATFORM_STAFF = uid(61);
const FACTORY_OWNER = uid(41);
const FACTORY_STAFF = uid(42);
const NOBODY = uid(90);
const PLATFORM = cid(100);
const A = cid(1);
const B = cid(2);
const E = cid(3);
const W1 = rid(1);
const W2 = rid(2);
const W_ENDED = rid(3);

const NOW = Date.parse('2026-11-12T03:00:00.000Z'); // 한국 시간 11-12 12:00
// 서버는 지금 시각을 Date.now() 로 읽는다 — 시험이 실제 날짜에 흔들리지 않게 고정한다 (파일마다 따로 도는 프로세스)
Date.now = () => NOW;

function tables() {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', status: 'active' },
      { id: FACTORY, kind: 'hq', name: '다담 공장', status: 'active' },
      { id: A, kind: 'partner', name: '가나 인테리어', plan: 'agent', status: 'active' },
      { id: B, kind: 'partner', name: '다라 가구', plan: 'agent', status: 'active' },
      { id: E, kind: 'partner', name: '엑스퍼트 업체', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { company_id: A, user_id: OWNER_A, role: 'owner', status: 'active' },
      { company_id: A, user_id: STAFF_A, role: 'staff', status: 'active' },
      { company_id: A, user_id: GONE_A, role: 'staff', status: 'removed' },
      { company_id: B, user_id: OWNER_B, role: 'owner', status: 'active' },
      { company_id: E, user_id: OWNER_E, role: 'owner', status: 'active' },
      { company_id: PLATFORM, user_id: PLATFORM_STAFF, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_OWNER, role: 'owner', status: 'active' },
      { company_id: FACTORY, user_id: FACTORY_STAFF, role: 'staff', status: 'active' },
    ],
    profiles: [
      { id: OWNER_A, name: '김대표' },
      { id: STAFF_A, name: '이직원' },
      { id: FACTORY_OWNER, name: '공장장' },
    ],
    factory_workers: [
      { id: rid(11), worker_id: W1, plan_user_id: FACTORY_OWNER, ended_at: null },
      { id: rid(12), worker_id: W2, plan_user_id: FACTORY_OWNER, ended_at: null },
      { id: rid(13), worker_id: W_ENDED, plan_user_id: FACTORY_OWNER, ended_at: '2026-10-01T00:00:00Z' },
    ],
    workers: [
      { id: W1, display_name: '재단 1' },
      { id: W2, display_name: '조립 1' },
      { id: W_ENDED, display_name: '나간 작업자' },
    ],
    work_shifts: [
      { id: rid(21), company_id: A, member_user_id: STAFF_A, worker_id: null, work_date: '2026-11-13', kind: 'leave', note: '가족 행사' },
      { id: rid(22), company_id: A, member_user_id: OWNER_A, worker_id: null, work_date: '2026-11-20', kind: 'out', note: null },
      { id: rid(23), company_id: A, member_user_id: STAFF_A, worker_id: null, work_date: '2026-12-25', kind: 'off', note: null },
      { id: rid(24), company_id: A, member_user_id: GONE_A, worker_id: null, work_date: '2026-11-14', kind: 'off', note: null },
      { id: rid(25), company_id: B, member_user_id: OWNER_B, worker_id: null, work_date: '2026-11-13', kind: 'off', note: null },
      { id: rid(26), company_id: FACTORY, member_user_id: null, worker_id: W1, work_date: '2026-11-13', kind: 'half', note: null },
    ],
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeOf = (opts = {}) => createFake({ tables: tables(), nowMs: NOW, ...opts });
const call = (fake, path, token, opt) => callWorker(worker, fake, path, token, opt);
const list = (fake, token, q = 'from=2026-11-01&to=2026-11-30') => call(fake, '/company/shifts?' + q, token);
const put = (fake, body, token = OWNER_A) => call(fake, '/company/shifts', token, { method: 'PUT', body });
const DAY = { person_kind: 'member', person_id: STAFF_A, date: '2026-11-17', kind: 'off' };

// ── 순수 ──────────────────────────────────────────────────────

test('dayMs · rangeOf — 진짜 날짜만, from ≤ to, 기간 한도', () => {
  assert.equal(dayMs('2026-11-12'), Date.parse('2026-11-12T00:00:00Z'));
  for (const bad of ['2026-02-30', '2026-13-01', '11/12', '', null, 20261112]) assert.equal(dayMs(bad), null, String(bad));
  assert.deepEqual(rangeOf({ from: '2026-11-01', to: '2026-11-30' }), { from: '2026-11-01', to: '2026-11-30' });
  assert.throws(() => rangeOf({ to: '2026-11-30' }), /from/);
  assert.throws(() => rangeOf({ from: '2026-11-30', to: '2026-11-01' }), /앞입니다/);
  assert.doesNotThrow(() => rangeOf({ from: '2026-11-01', to: kstDateOf(Date.parse('2026-11-01T00:00:00Z') + (SHIFT_RANGE_DAYS - 1) * 86400000 - 9 * 3600000 + 9 * 3600000) }));
  assert.throws(() => rangeOf({ from: '2026-01-01', to: '2026-12-31' }), /일까지/);
});

test('shiftInput — 사람 · 날 · 종류. kind 가 비면 지우기, 오늘에서 1년 넘으면 거절', () => {
  assert.deepEqual(shiftInput({ ...DAY, note: ' 병원 ' }, NOW), { ...DAY, note: '병원' });
  assert.deepEqual(shiftInput({ ...DAY, kind: null, note: 'x' }, NOW), { ...DAY, kind: null, note: 'x' });
  assert.equal(shiftInput({ ...DAY, kind: '' }, NOW).kind, null);
  for (const bad of [null, {}, { ...DAY, person_kind: 'guest' }, { ...DAY, person_id: 'x' }, { ...DAY, date: '2026-02-30' }, { ...DAY, kind: 'work' }, { ...DAY, note: 3 }, { ...DAY, note: 'x'.repeat(SHIFT_NOTE_MAX + 1) }, { ...DAY, date: '2028-01-01' }, { ...DAY, date: '2025-01-01' }])
    assert.throws(() => shiftInput(bad, NOW), Error, JSON.stringify(bad));
});

test('canHoldPeople — 다담 공장 · active Agent 만', () => {
  assert.equal(canHoldPeople({ kind: 'hq', status: 'active' }), true);
  assert.equal(canHoldPeople({ kind: 'partner', plan: 'agent', status: 'active' }), true);
  for (const c of [null, { kind: 'platform', status: 'active' }, { kind: 'partner', plan: 'expert', status: 'active' }, { kind: 'partner', plan: 'agent', status: 'suspended' }])
    assert.equal(canHoldPeople(c), false);
});

// ── 읽기 ──────────────────────────────────────────────────────

test('구성원이 아니면 not_member, 다담 본사 · Expert 는 not_people_company, 로그인 없으면 401, 기간이 틀리면 422', async () => {
  const fake = fakeOf();
  assert.equal((await list(fake, NOBODY)).json.code, 'not_member');
  for (const who of [PLATFORM_STAFF, OWNER_E]) assert.equal((await list(fake, who)).json.code, 'not_people_company');
  assert.equal((await list(fake, null)).status, 401);
  assert.equal((await list(fake, OWNER_A, 'from=2026-11-01')).status, 422);
  assert.equal((await list(fake, OWNER_A, 'from=2026-01-01&to=2026-12-31')).status, 422);
});

test('읽기 — 직원도 본다. 내 업체 사람과 그 기간의 쉬는 날만. 나간 구성원 줄은 없다', async () => {
  const fake = fakeOf();
  const r = await list(fake, STAFF_A);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.can_manage, false);
  assert.equal(d.today, '2026-11-12');
  assert.deepEqual(d.people, [
    { kind: 'member', id: OWNER_A, name: '김대표', role: 'owner' },
    { kind: 'member', id: STAFF_A, name: '이직원', role: 'staff' },
  ]);
  assert.deepEqual(d.items, [
    { person_kind: 'member', person_id: STAFF_A, date: '2026-11-13', kind: 'leave', note: '가족 행사' },
    { person_kind: 'member', person_id: OWNER_A, date: '2026-11-20', kind: 'out', note: null },
  ]);
  assert.equal((await list(fake, OWNER_A)).json.data.can_manage, true);
});

test('다담 공장 — 구성원 다음에 배정이 열린 공장 작업자도 나온다 (끝난 배정은 없다)', async () => {
  const fake = fakeOf();
  const d = (await list(fake, FACTORY_STAFF)).json.data;
  assert.deepEqual(d.people.map((p) => [p.kind, p.name, p.role]), [
    ['member', '공장장', 'owner'],
    ['member', null, 'staff'],
    ['worker', '재단 1', 'worker'],
    ['worker', '조립 1', 'worker'],
  ]);
  assert.deepEqual(d.items, [{ person_kind: 'worker', person_id: W1, date: '2026-11-13', kind: 'half', note: null }]);
});

// ── 적기 ──────────────────────────────────────────────────────

test('적기 — 대표 · 실장만. 없으면 넣고, 있으면 바꾸고, kind 가 null 이면 지운다', async () => {
  const fake = fakeOf();
  const no = await put(fake, DAY, STAFF_A);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_manager');

  const add = await put(fake, { ...DAY, note: '병원' });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.deepEqual(add.json.data, { ...DAY, note: '병원' });
  const row = fake.db.work_shifts.at(-1);
  assert.deepEqual([row.company_id, row.member_user_id, row.work_date, row.kind, row.note, row.created_by], [A, STAFF_A, '2026-11-17', 'off', '병원', OWNER_A]);

  const n = fake.db.work_shifts.length;
  const change = await put(fake, { ...DAY, kind: 'half' });
  assert.equal(change.json.data.kind, 'half');
  assert.equal(fake.db.work_shifts.length, n, '같은 날은 한 줄');
  assert.deepEqual([fake.db.work_shifts.at(-1).kind, fake.db.work_shifts.at(-1).note], ['half', null]);

  const clear = await put(fake, { ...DAY, kind: null });
  assert.deepEqual(clear.json.data, { ...DAY, kind: null, note: null });
  assert.equal(fake.db.work_shifts.length, n - 1);
  assert.equal(fake.db.work_shifts.some((s) => s.company_id === B), true, '남의 업체 줄은 그대로');
  assert.equal((await put(fake, { ...DAY, kind: null })).status, 200, '없는 날을 지워도 된다');
});

test('적기 — 남의 업체 사람 · 나간 구성원 · 배정 끝난 작업자는 422, 협력업체는 작업자를 못 적는다', async () => {
  const fake = fakeOf();
  for (const person_id of [OWNER_B, GONE_A, NOBODY]) {
    const r = await put(fake, { ...DAY, person_id });
    assert.equal(r.status, 422, person_id);
    assert.equal(r.json.details.field, 'person_id');
  }
  assert.equal((await put(fake, { ...DAY, person_kind: 'worker', person_id: W1 })).status, 422);
  assert.equal((await put(fake, { ...DAY, person_kind: 'worker', person_id: W_ENDED }, FACTORY_OWNER)).status, 422);
  const w = await put(fake, { ...DAY, person_kind: 'worker', person_id: W2 }, FACTORY_OWNER);
  assert.equal(w.status, 200, JSON.stringify(w.json));
  const row = fake.db.work_shifts.at(-1);
  assert.deepEqual([row.company_id, row.worker_id, row.member_user_id], [FACTORY, W2, undefined]);
  assert.equal(fake.db.work_shifts.length, 7);
});

test('적기 — 그 사이 같은 날이 들어갔으면(겹침) 그 줄을 바꾼다', async () => {
  let hit = 0;
  const fake = fakeOf({
    before(m, t) {
      if (m === 'POST' && t === 'work_shifts' && hit++ === 0) {
        fake.db.work_shifts.push({ id: rid(99), company_id: A, member_user_id: STAFF_A, worker_id: null, work_date: '2026-11-17', kind: 'leave', note: null });
        return json({ code: '23505', message: 'duplicate key' }, 409);
      }
      return null;
    },
  });
  const r = await put(fake, DAY);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(fake.db.work_shifts.find((s) => s.id === rid(99)).kind, 'off');
});

test('DB 0060 적용 전이면 409 db_pending', async () => {
  const fake = fakeOf({ before: (m, t) => (t === 'work_shifts' ? json({ code: 'PGRST205', message: 'Could not find the table' }, 404) : null) });
  assert.equal((await list(fake, OWNER_A)).json.code, 'db_pending');
  assert.equal((await put(fake, DAY)).json.code, 'db_pending');
});
