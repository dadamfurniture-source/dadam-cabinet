/**
 * 설치 · A/S 지도 + 표 (src/company-sites.js) — GET /company/sites · PUT /company/sites/geo · PUT /company/as-requests/:id/visit.
 *
 *   - 설치 목록 = 일정 표의 납품 · 설치 줄 (취소 뺌 · 다른 업체 뺌), 지난 7일 ~ 앞으로 60일
 *   - 좌표는 바꾼 그때의 주소(geo_address)가 지금 주소와 같을 때만 — 다르면 needs_geo
 *   - 좌표 적기: 구성원 누구나, 내 업체 설계만, 저장된 주소 글자와 같을 때만, 대한민국 범위, 한 번에 20줄
 *   - A/S 방문 일정: 대표 · 실장만, 일정 표(as_visit) 한 줄을 만들거나 고친다 → 업무 달력에 그대로 뜬다
 *   - 고객 이름 · 전화 · 출입 메모 · 금액은 싣지 않는다
 *   - DB 0058 적용 전: 목록은 좌표 없이(ready false), 적기는 409 db_pending
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { GEO_BATCH, SITE_AHEAD_DAYS, SITE_PAST_DAYS, geoItemOf, siteOf, siteRangeOf } from '../src/company-sites.js';
import { ValidationError } from '../src/supabase.js';
import { createFake, withFake, SB } from './helpers/push-fake.js';

const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const CO = 'c0000000-0000-4000-8000-000000000001';
const CO2 = 'c0000000-0000-4000-8000-000000000002';
const FREE = 'c0000000-0000-4000-8000-000000000003';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const OTHER = 'a0000000-0000-4000-8000-000000000004';
const FREE_OWNER = 'a0000000-0000-4000-8000-000000000005';
const id = (p, i) => `${p}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const O = (i) => id('0a', i);
const D = (i) => id('0d', i);
const P = (i) => id('0e', i);
const S = (i) => id('05', i);
const AS = (i) => id('07', i);
const kst = (s) => Date.parse(`${s}+09:00`);
const iso = (s) => new Date(kst(s)).toISOString();
const AT = kst('2026-11-10T10:00:00');

const ADDR1 = '시험시 시험구 시험로 1';
const ADDR2 = '시험시 다른구 다른로 2';

function tables() {
  return {
    companies: [
      { id: CO, kind: 'partner', name: '예시 협력 주방', plan: 'agent', status: 'active' },
      { id: CO2, kind: 'partner', name: '다른 업체', plan: 'agent', status: 'active' },
      { id: FREE, kind: 'partner', name: '무료 업체', plan: 'free', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
      { user_id: MANAGER, company_id: CO, role: 'manager', status: 'active' },
      { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
      { user_id: OTHER, company_id: CO2, role: 'owner', status: 'active' },
      { user_id: FREE_OWNER, company_id: FREE, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    // 일정에 배정된 작업자 (src/work/schedule-link.js — 이 파일의 시험에서는 비어 있다. 배정은 company-schedule-workers.test.js)
    work_jobs: [],
    work_assignments: [],
    consultations: [],
    order_payments: [],
    projects: [
      { id: P(1), company_id: CO, title: '예시 프로젝트 1' },
      { id: P(9), company_id: CO2, title: '남의 프로젝트' },
    ],
    designs: [
      { id: D(1), company_id: CO, user_id: STAFF, name: '예시 설계 1', project_id: P(1) },
      { id: D(2), company_id: CO, user_id: OWNER, name: '예시 설계 2', project_id: null },
      { id: D(3), company_id: CO, user_id: OWNER, name: '예시 설계 3', project_id: null },
      { id: D(9), company_id: CO2, user_id: OTHER, name: '남의 설계', project_id: P(9) },
    ],
    design_site_info: [
      // 좌표가 지금 주소 것
      { design_id: D(1), address: ADDR1, address_detail: '1동 1호', contact_name: '김고객', contact_phone: '010-0000-0000', access_notes: '공동현관 0000', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127.0, geo_address: ADDR1 },
      // 주소를 고쳐 좌표가 옛 주소 것
      { design_id: D(2), address: ADDR2, address_detail: null, sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127.0, geo_address: ADDR1 },
      { design_id: D(9), address: '남의 주소 9', address_detail: null, sido: null, gugun: null, lat: null, lng: null, geo_address: null },
    ],
    design_schedules: [
      { id: S(1), design_id: D(1), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-12T09:00:00'), assignee_name: '설치 1팀' },
      { id: S(2), design_id: D(2), type: 'delivery', title: '납품', status: 'confirmed', scheduled_at: iso('2026-11-11T14:30:00'), assignee_name: null },
      // 현장 정보가 없는 설계
      { id: S(3), design_id: D(3), type: 'installation', title: '설치', status: 'completed', scheduled_at: iso('2026-11-05T10:00:00'), assignee_name: '설치 2팀' },
      // 취소 · 다른 종류 · 기간 밖(지난 8일 · 61일 뒤) · 다른 업체
      { id: S(4), design_id: D(1), type: 'installation', title: '설치', status: 'cancelled', scheduled_at: iso('2026-11-13T09:00:00'), assignee_name: null },
      { id: S(5), design_id: D(1), type: 'measurement', title: '실측', status: 'scheduled', scheduled_at: iso('2026-11-13T09:00:00'), assignee_name: null },
      { id: S(6), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2026-11-02T23:00:00'), assignee_name: null },
      { id: S(7), design_id: D(1), type: 'delivery', title: '납품', status: 'scheduled', scheduled_at: iso('2027-01-10T09:00:00'), assignee_name: null },
      { id: S(9), design_id: D(9), type: 'installation', title: '설치', status: 'scheduled', scheduled_at: iso('2026-11-12T09:00:00'), assignee_name: null },
      // A/S 방문 (AS(2) 에 이어 둔 줄)
      { id: S(20), design_id: D(1), type: 'as_visit', title: 'A/S 방문', status: 'confirmed', scheduled_at: iso('2026-11-14T15:00:00'), assignee_name: '박기사' },
    ],
    orders: [
      { id: O(1), company_id: CO, order_no: 'SO-20261101-AAAA', status: 'in_production', design_id: D(1), project_id: P(1), customer_name: '김고객', contract_amount: 7654321, created_at: iso('2026-11-01T09:00:00') },
      { id: O(2), company_id: CO, order_no: 'SO-20261020-CCCC', status: 'cancelled', design_id: D(2), project_id: null, created_at: iso('2026-10-20T09:00:00') },
      { id: O(9), company_id: CO2, order_no: 'SO-20261101-ZZZZ', status: 'in_production', design_id: D(9), project_id: P(9), created_at: iso('2026-11-01T09:00:00') },
    ],
    as_requests: [
      { id: AS(1), company_id: CO, order_id: O(1), state: 'requested', created_at: iso('2026-11-08T16:20:00'), body: '문짝이 처졌어요', visit_schedule_id: null },
      { id: AS(2), company_id: CO, order_id: O(1), state: 'received', created_at: iso('2026-11-07T09:00:00'), body: '가'.repeat(250), visit_schedule_id: S(20) },
      { id: AS(3), company_id: CO, order_id: O(1), state: 'done', created_at: iso('2026-11-01T09:00:00'), body: '서랍이 걸려요', visit_schedule_id: null },
      { id: AS(4), company_id: CO, order_id: O(1), state: 'cancelled', created_at: iso('2026-11-09T09:00:00'), body: 'x', visit_schedule_id: null },
      { id: AS(9), company_id: CO2, order_id: O(9), state: 'requested', created_at: iso('2026-11-08T10:00:00'), body: 'x', visit_schedule_id: null },
    ],
  };
}

const USERS = {
  t_owner: { id: OWNER },
  t_manager: { id: MANAGER },
  t_staff: { id: STAFF },
  t_other: { id: OTHER },
  t_free: { id: FREE_OWNER },
  t_nobody: { id: id('a9', 1) },
};
const world = (t = tables()) => createFake({ tables: t, users: USERS, nowMs: AT });

/** DB 0058 적용 전 — 새 칸을 읽거나 적으면 「없는 칸」 오류 */
function before0058(fake) {
  const inner = fake.fetch;
  const NEW_COLS = /visit_schedule_id|geo_address|geocoded_at/;
  fake.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
    if (url.includes('/rest/v1/') && (NEW_COLS.test(url) || NEW_COLS.test(String(init.body || '')))) {
      return new Response(JSON.stringify({ code: '42703', message: 'column does not exist' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return inner(input, init);
  };
  return fake;
}

async function call(fake, token, path, init = {}) {
  const realNow = Date.now;
  Date.now = () => AT;
  try {
    return await withFake(fake, async () => {
      const res = await worker.fetch(
        new Request(`https://api.test${path}`, {
          method: init.method || 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: init.body ? JSON.stringify(init.body) : undefined,
        }),
        ENV,
        { waitUntil() {} },
      );
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, cache: res.headers.get('Cache-Control') };
    });
  } finally {
    Date.now = realNow;
  }
}
const put = (fake, token, path, body) => call(fake, token, path, { method: 'PUT', body });
const keysOf = (r) => r.json.data.items.map((i) => i.key);
const GEO = { design_id: D(2), address: ADDR2, sido: '시험시', gugun: '다른구', lat: 36.1, lng: 128.2 };

// ── 순수 ──────────────────────────────────────────────────────────

test('좌표 — 바꾼 그때의 주소가 지금 주소와 같을 때만 쓴다', () => {
  const ok = siteOf({ address: ADDR1, address_detail: '1호', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, geo_address: ADDR1 });
  assert.deepEqual(ok, { address: ADDR1, address_detail: '1호', sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, needs_geo: false });
  // 주소를 고쳤다 — 옛 좌표 · 옛 지역을 쓰지 않고 다시 바꿔 달라고 알린다
  const stale = siteOf({ address: ADDR2, sido: '시험시', gugun: '시험구', lat: 37.5, lng: 127, geo_address: ADDR1 });
  assert.deepEqual(stale, { address: ADDR2, address_detail: null, sido: null, gugun: null, lat: null, lng: null, needs_geo: true });
  // 아직 안 바꿨다 · 주소가 없다 · 현장 정보가 없다
  assert.equal(siteOf({ address: ADDR1 }).needs_geo, true);
  assert.equal(siteOf({ address: null, lat: 37.5, lng: 127, geo_address: null }).needs_geo, false);
  assert.deepEqual(siteOf(null), { address: null, address_detail: null, sido: null, gugun: null, lat: null, lng: null, needs_geo: false });
});

test('기간 — 안 주면 지난 7일 ~ 앞으로 60일 (한국 날짜), 주면 달력과 같은 규칙', () => {
  assert.equal(SITE_PAST_DAYS, 7);
  assert.equal(SITE_AHEAD_DAYS, 60);
  assert.deepEqual(siteRangeOf({}, AT), { from: '2026-11-03', to: '2027-01-09' });
  assert.deepEqual(siteRangeOf({ from: '2026-11-01', to: '2026-11-30' }, AT), { from: '2026-11-01', to: '2026-11-30' });
  assert.throws(() => siteRangeOf({ from: '2026-11-30', to: '2026-11-01' }, AT), ValidationError);
});

test('좌표 한 줄 검사 — 주소 글자는 다듬지 않는다, 범위 밖 · 글자 좌표는 422', () => {
  assert.deepEqual(geoItemOf({ ...GEO, address: ' 앞뒤 빈칸 ' }).address, ' 앞뒤 빈칸 ');
  assert.deepEqual(geoItemOf({ ...GEO, sido: '  ', gugun: undefined }), { ...GEO, sido: null, gugun: null });
  for (const bad of [
    { ...GEO, design_id: 'x' },
    { ...GEO, address: '' },
    { ...GEO, address: '가'.repeat(201) },
    { ...GEO, lat: 10 },
    { ...GEO, lng: 140 },
    { ...GEO, lat: '36.1' },
    { ...GEO, lng: null },
    { ...GEO, sido: '가'.repeat(21) },
    null,
  ])
    assert.throws(() => geoItemOf(bad), ValidationError, JSON.stringify(bad));
});

// ── 설치 목록 ─────────────────────────────────────────────────────

test('설치 목록 — 납품 · 설치만, 날짜 차례, 취소 · 기간 밖 · 다른 업체는 없다', async () => {
  const r = await call(world(), 't_staff', '/company/sites?kind=install');
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store, private');
  const d = r.json.data;
  assert.deepEqual(d.company, { id: CO, name: '예시 협력 주방' });
  assert.equal(d.kind, 'install');
  assert.equal(d.today, '2026-11-10');
  assert.deepEqual(d.range, { from: '2026-11-03', to: '2027-01-09' });
  assert.equal(d.ready, true);
  assert.equal(d.truncated, false);
  assert.deepEqual(keysOf(r), [`schedule:${S(3)}`, `schedule:${S(2)}`, `schedule:${S(1)}`]);

  const [done, deliver, install] = d.items;
  assert.deepEqual(install, {
    key: `schedule:${S(1)}`,
    schedule_id: S(1),
    type: 'installation',
    label: '설치',
    day: '2026-11-12',
    time: '09:00',
    at: iso('2026-11-12T09:00:00'),
    status: 'scheduled',
    assignee_name: '설치 1팀',
    workers: [],
    design: { id: D(1), name: '예시 설계 1' },
    project_id: P(1),
    project_title: '예시 프로젝트 1',
    order_no: 'SO-20261101-AAAA',
    address: ADDR1,
    address_detail: '1동 1호',
    sido: '시험시',
    gugun: '시험구',
    lat: 37.5,
    lng: 127,
    needs_geo: false,
  });
  // 주소를 고친 현장 — 좌표 없이, 다시 바꿔야 한다. 취소한 수주의 번호는 싣지 않는다
  assert.equal(deliver.label, '납품');
  assert.equal(deliver.time, '14:30');
  assert.equal(deliver.address, ADDR2);
  assert.equal(deliver.lat, null);
  assert.equal(deliver.sido, null);
  assert.equal(deliver.needs_geo, true);
  assert.equal(deliver.order_no, null);
  assert.equal(deliver.project_title, null);
  // 현장 정보가 없는 설계 — 주소 없음 (좌표를 바꿀 것도 없다)
  assert.equal(done.status, 'completed');
  assert.equal(done.address, null);
  assert.equal(done.needs_geo, false);
});

test('설치 목록 — 기간을 주면 그 기간, 고객 이름 · 전화 · 출입 메모 · 금액은 어디에도 없다', async () => {
  const r = await call(world(), 't_owner', '/company/sites?kind=install&from=2026-11-01&to=2026-11-11');
  assert.deepEqual(keysOf(r), [`schedule:${S(6)}`, `schedule:${S(3)}`, `schedule:${S(2)}`]);
  assert.equal(r.json.data.can_manage, true);
  const all = await call(world(), 't_owner', '/company/sites');
  const text = JSON.stringify(all.json);
  for (const secret of ['김고객', '010-0000-0000', '공동현관', '7654321', 'contact_', 'access_notes']) assert.ok(!text.includes(secret), secret);
});

test('설치 목록 — 누가: 직원도 보지만 고치기 표시는 대표 · 실장만, 무료 업체 · 구성원 아님 403, kind 가 틀리면 422', async () => {
  assert.equal((await call(world(), 't_staff', '/company/sites')).json.data.can_manage, false);
  assert.equal((await call(world(), 't_manager', '/company/sites')).json.data.can_manage, true);
  assert.deepEqual(keysOf(await call(world(), 't_other', '/company/sites')), [`schedule:${S(9)}`]);
  assert.equal((await call(world(), 't_free', '/company/sites')).status, 403);
  assert.equal((await call(world(), 't_nobody', '/company/sites')).status, 403);
  assert.equal((await call(world(), 'bad', '/company/sites')).status, 401);
  assert.equal((await call(world(), 't_owner', '/company/sites?kind=sales')).status, 422);
});

test('설치 목록 — DB 0058 적용 전에는 좌표 없이 (ready false)', async () => {
  const r = await call(before0058(world()), 't_staff', '/company/sites?kind=install');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.ready, false);
  assert.deepEqual(keysOf(r), [`schedule:${S(3)}`, `schedule:${S(2)}`, `schedule:${S(1)}`]);
  const install = r.json.data.items[2];
  assert.equal(install.address, ADDR1);
  assert.equal(install.lat, null);
  assert.equal(install.needs_geo, true);
});

// ── A/S 목록 ─────────────────────────────────────────────────────

test('A/S 목록 — 새 것부터, 거둔 것 · 다른 업체는 없다, 방문 일정이 이어져 있으면 날짜 · 담당이 붙는다', async () => {
  const r = await call(world(), 't_staff', '/company/sites?kind=as');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.kind, 'as');
  assert.equal(d.ready, true);
  assert.deepEqual(keysOf(r), [`as:${AS(1)}`, `as:${AS(2)}`, `as:${AS(3)}`]);
  const [fresh, visiting, done] = d.items;
  assert.deepEqual(fresh, {
    key: `as:${AS(1)}`,
    as_id: AS(1),
    state: 'requested',
    label: '접수',
    day: '2026-11-08',
    at: iso('2026-11-08T16:20:00'),
    body: '문짝이 처졌어요',
    visit: null,
    design: { id: D(1), name: '예시 설계 1' },
    project_id: P(1),
    project_title: '예시 프로젝트 1',
    order_no: 'SO-20261101-AAAA',
    address: ADDR1,
    address_detail: '1동 1호',
    sido: '시험시',
    gugun: '시험구',
    lat: 37.5,
    lng: 127,
    needs_geo: false,
  });
  assert.deepEqual(visiting.visit, {
    schedule_id: S(20),
    day: '2026-11-14',
    time: '15:00',
    at: iso('2026-11-14T15:00:00'),
    assignee_name: '박기사',
    status: 'confirmed',
    workers: [],
  });
  // 긴 증상 글은 줄인다
  assert.equal(visiting.body.length, 201);
  assert.ok(visiting.body.endsWith('…'));
  assert.equal(done.label, '끝');
  const text = JSON.stringify(r.json);
  for (const secret of ['김고객', '010-0000-0000', '공동현관', '7654321']) assert.ok(!text.includes(secret), secret);
});

test('A/S 목록 — DB 0058 적용 전에는 방문 일정 · 좌표 없이 (ready false)', async () => {
  const r = await call(before0058(world()), 't_owner', '/company/sites?kind=as');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.ready, false);
  assert.deepEqual(keysOf(r), [`as:${AS(1)}`, `as:${AS(2)}`, `as:${AS(3)}`]);
  assert.equal(r.json.data.items[1].visit, null);
  assert.equal(r.json.data.items[0].lat, null);
});

// ── 좌표 적기 ─────────────────────────────────────────────────────

test('좌표 적기 — 직원도 된다, 저장된 주소 글자와 같을 때만 적는다', async () => {
  const fake = world();
  const r = await put(fake, 't_staff', '/company/sites/geo', { items: [GEO] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, { saved: 1, skipped: 0 });
  const row = fake.db.design_site_info.find((x) => x.design_id === D(2));
  assert.equal(row.lat, 36.1);
  assert.equal(row.lng, 128.2);
  assert.equal(row.sido, '시험시');
  assert.equal(row.gugun, '다른구');
  assert.equal(row.geo_address, ADDR2);
  assert.equal(row.geocoded_at, new Date(AT).toISOString());
  // 주소 · 연락처는 건드리지 않는다
  assert.equal(row.address, ADDR2);
  // 이제 목록에 좌표가 나온다
  const list = await call(fake, 't_staff', '/company/sites');
  const item = list.json.data.items.find((i) => i.schedule_id === S(2));
  assert.equal(item.lat, 36.1);
  assert.equal(item.gugun, '다른구');
  assert.equal(item.needs_geo, false);
});

test('좌표 적기 — 그 사이 주소가 바뀐 줄 · 현장 정보가 없는 설계 · 남의 설계는 건너뛴다', async () => {
  const fake = world();
  const r = await put(fake, 't_owner', '/company/sites/geo', {
    items: [
      { ...GEO, address: '옛 주소 글자' },
      { ...GEO, design_id: D(3) },
      { ...GEO, design_id: D(9), address: '남의 주소 9' },
      GEO,
    ],
  });
  assert.deepEqual(r.json.data, { saved: 1, skipped: 3 });
  assert.equal(fake.db.design_site_info.find((x) => x.design_id === D(9)).lat, null);
  assert.equal(fake.db.design_site_info.length, 3);
});

test('좌표 적기 — 빈 목록 · 21줄 · 범위 밖 좌표는 422 (하나라도 틀리면 아무것도 안 적는다), 무료 업체 403', async () => {
  const fake = world();
  assert.equal((await put(fake, 't_owner', '/company/sites/geo', {})).status, 422);
  assert.equal((await put(fake, 't_owner', '/company/sites/geo', { items: [] })).status, 422);
  assert.equal(GEO_BATCH, 20);
  assert.equal((await put(fake, 't_owner', '/company/sites/geo', { items: Array.from({ length: 21 }, () => GEO) })).status, 422);
  assert.equal((await put(fake, 't_owner', '/company/sites/geo', { items: [GEO, { ...GEO, lat: 50 }] })).status, 422);
  assert.equal(fake.db.design_site_info.find((x) => x.design_id === D(2)).geo_address, ADDR1);
  assert.equal(fake.calls.rest.filter((c) => c.method === 'PATCH').length, 0);
  assert.equal((await put(fake, 't_free', '/company/sites/geo', { items: [GEO] })).status, 403);
});

test('좌표 적기 — DB 0058 적용 전에는 409 db_pending', async () => {
  const r = await put(before0058(world()), 't_owner', '/company/sites/geo', { items: [GEO] });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'db_pending');
});

// ── A/S 방문 일정 ─────────────────────────────────────────────────

const VISIT_AT = iso('2026-11-16T10:30:00');

test('A/S 방문 일정 — 처음이면 일정 표에 as_visit 한 줄을 만들고 접수에 잇는다 → 업무 달력에 뜬다', async () => {
  const fake = world();
  const r = await put(fake, 't_manager', `/company/as-requests/${AS(1)}/visit`, { visit_at: '2026-11-16T10:30:00+09:00', assignee_name: ' 박기사 ' });
  assert.equal(r.status, 200);
  const made = fake.db.design_schedules.find((s) => s.type === 'as_visit' && s.id !== S(20));
  assert.ok(made);
  assert.deepEqual(r.json.data, {
    id: AS(1),
    visit: { schedule_id: made.id, day: '2026-11-16', time: '10:30', at: VISIT_AT, assignee_name: '박기사', status: 'scheduled', workers: [] },
  });
  assert.equal(made.design_id, D(1));
  assert.equal(made.title, 'A/S 방문');
  assert.equal(made.created_by, MANAGER);
  assert.match(made.batch_id, /^[0-9a-f-]{36}$/);
  assert.equal(fake.db.as_requests.find((x) => x.id === AS(1)).visit_schedule_id, made.id);
  // 접수 상태는 그대로 — 받음 · 끝은 따로 누른다
  assert.equal(fake.db.as_requests.find((x) => x.id === AS(1)).state, 'requested');

  const cal = await call(fake, 't_staff', '/company/schedules?from=2026-11-01&to=2026-11-30');
  const onCal = cal.json.data.items.find((i) => i.key === `schedule:${made.id}`);
  assert.ok(onCal);
  assert.equal(onCal.kind, 'as');
  assert.equal(onCal.day, '2026-11-16');
});

test('A/S 방문 일정 — 이미 있으면 그 줄을 고친다 (취소했던 줄은 다시 예정으로), 새 줄을 만들지 않는다', async () => {
  const fake = world();
  const before = fake.db.design_schedules.length;
  const r = await put(fake, 't_owner', `/company/as-requests/${AS(2)}/visit`, { visit_at: VISIT_AT });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.visit, { schedule_id: S(20), day: '2026-11-16', time: '10:30', at: VISIT_AT, assignee_name: null, status: 'confirmed', workers: [] });
  assert.equal(fake.db.design_schedules.length, before);

  fake.db.design_schedules.find((s) => s.id === S(20)).status = 'cancelled';
  const again = await put(fake, 't_owner', `/company/as-requests/${AS(2)}/visit`, { visit_at: VISIT_AT, assignee_name: '최기사' });
  assert.equal(again.json.data.visit.status, 'scheduled');
  assert.equal(again.json.data.visit.assignee_name, '최기사');
  assert.equal(fake.db.design_schedules.length, before);
});

test('A/S 방문 일정 — 이어 둔 일정이 지워졌으면 새로 만든다', async () => {
  const fake = world();
  fake.db.design_schedules = fake.db.design_schedules.filter((s) => s.id !== S(20));
  // 실DB 는 일정이 지워지면 접수의 칸을 비운다 (ON DELETE SET NULL)
  fake.db.as_requests.find((x) => x.id === AS(2)).visit_schedule_id = null;
  const r = await put(fake, 't_owner', `/company/as-requests/${AS(2)}/visit`, { visit_at: VISIT_AT });
  assert.equal(r.status, 200);
  assert.notEqual(r.json.data.visit.schedule_id, S(20));
  assert.equal(fake.db.as_requests.find((x) => x.id === AS(2)).visit_schedule_id, r.json.data.visit.schedule_id);
});

test('A/S 방문 일정 — 대표 · 실장만 (직원 403 not_manager), 다른 업체 접수 404, 끝난 접수 409 closed', async () => {
  const fake = world();
  const before = fake.db.design_schedules.length;
  const staff = await put(fake, 't_staff', `/company/as-requests/${AS(1)}/visit`, { visit_at: VISIT_AT });
  assert.equal(staff.status, 403);
  assert.equal(staff.json.code, 'not_manager');
  assert.equal((await put(fake, 't_other', `/company/as-requests/${AS(1)}/visit`, { visit_at: VISIT_AT })).status, 404);
  const closed = await put(fake, 't_owner', `/company/as-requests/${AS(3)}/visit`, { visit_at: VISIT_AT });
  assert.equal(closed.status, 409);
  assert.equal(closed.json.code, 'closed');
  assert.equal((await put(fake, 't_owner', `/company/as-requests/${AS(4)}/visit`, { visit_at: VISIT_AT })).status, 409);
  assert.equal(fake.db.design_schedules.length, before);
});

test('A/S 방문 일정 — 방문일이 없거나 날짜가 아니면 422, id 가 틀리면 422', async () => {
  const fake = world();
  assert.equal((await put(fake, 't_owner', `/company/as-requests/${AS(1)}/visit`, {})).status, 422);
  assert.equal((await put(fake, 't_owner', `/company/as-requests/${AS(1)}/visit`, { visit_at: '내일' })).status, 422);
  assert.equal((await put(fake, 't_owner', `/company/as-requests/${AS(1)}/visit`, { visit_at: VISIT_AT, assignee_name: '가'.repeat(51) })).status, 422);
  assert.equal((await put(fake, 't_owner', '/company/as-requests/x/visit', { visit_at: VISIT_AT })).status, 422);
});

test('A/S 방문 일정 — 그 사이 다른 사람이 이었으면 내 줄을 지우고 409 stale', async () => {
  const fake = world();
  const before = fake.db.design_schedules.length;
  const inner = fake.fetch;
  // 일정을 넣은 바로 뒤, 다른 사람이 먼저 이은 것처럼
  fake.fetch = async (input, init = {}) => {
    const res = await inner(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if ((init.method || 'GET') === 'POST' && url.includes('/rest/v1/design_schedules')) {
      fake.db.as_requests.find((x) => x.id === AS(1)).visit_schedule_id = S(20);
    }
    return res;
  };
  const r = await put(fake, 't_owner', `/company/as-requests/${AS(1)}/visit`, { visit_at: VISIT_AT });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'stale');
  assert.equal(fake.db.design_schedules.length, before);
});

test('A/S 방문 일정 — DB 0058 적용 전에는 409 db_pending', async () => {
  const r = await put(before0058(world()), 't_owner', `/company/as-requests/${AS(1)}/visit`, { visit_at: VISIT_AT });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'db_pending');
});
