/**
 * 재작업 · A/S — 경영 대시보드 2단계 PR-6 (14 품질비용 · A/S 율).
 *
 * rework = 공장에서 다시 만든 것, as = 설치 뒤 고치러 간 것. 원인 · 분 · 비용을 남기면
 * 품질비용(비용 + 다시 한 분 × 공장 노무)과 반년 A/S 율이 나온다.
 * 표는 database/management-phase2.sql 이 만든다 — 실행 전에도 수주 화면이 깨지면 안 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRework, addRework, listReworks, deleteRework, REWORK_CAUSES, REWORK_CAUSE_LABEL } from '../src/rework.js';
import { qualityOf, buildManagementSummary } from '../src/management/summary.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const NO_TABLE = () => fail(404, { code: 'PGRST205', message: "Could not find the table 'public.rework_logs' in the schema cache" });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init.method || 'GET', calls.at(-1).body);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const owned = (u, method) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1' }]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  return null;
};

test('입력: 종류 · 원인은 정해진 것만, 분 · 비용은 0 이상의 정수, 날짜는 YYYY-MM-DD', () => {
  assert.deepEqual(validateRework({ kind: 'as', cause: 'install', minutes: '90', cost: 15000, parts: ' 하부장 도어 1장 ', occurred_on: '2026-10-12' }), {
    kind: 'as', cause: 'install', minutes: 90, cost: 15000, parts: '하부장 도어 1장', memo: null, occurred_on: '2026-10-12',
  });
  assert.deepEqual(validateRework({ kind: 'rework', cause: 'cutting', minutes: '', cost: null }), {
    kind: 'rework', cause: 'cutting', minutes: null, cost: null, parts: null, memo: null,
  });
  assert.throws(() => validateRework({ kind: 'fix', cause: 'cutting' }), /kind/);
  assert.throws(() => validateRework({ kind: 'as', cause: 'weather' }), /cause/);
  assert.throws(() => validateRework({ kind: 'as', cause: 'install', minutes: -5 }), /minutes/);
  assert.throws(() => validateRework({ kind: 'as', cause: 'install', cost: 1.5 }), /cost/);
  assert.throws(() => validateRework({ kind: 'as', cause: 'install', occurred_on: '10/12' }), /occurred_on/);
});

test('원인마다 우리말 라벨이 있다 (화면이 코드를 드러내지 않게)', () => {
  for (const c of REWORK_CAUSES) assert.ok(REWORK_CAUSE_LABEL[c], c);
});

test('기록: 주인 확인 뒤 넣는다 · 표가 아직 없으면 SQL 을 실행하라고 알린다', async () => {
  await withFetch((u, method, body) => owned(u, method) || (method === 'POST' && u.endsWith('/rework_logs') ? json([{ id: 'R1', ...body }], 201) : null), async () => {
    const r = await addRework(ENV, { orderId: 'O1', user: { id: 'U1' }, body: { kind: 'rework', cause: 'edge', minutes: 30 } });
    assert.equal(r.order_id, 'O1');
    assert.equal(r.created_by, 'U1');
    assert.equal(r.minutes, 30);
  });
  await withFetch((u, method) => owned(u, method) || (method === 'POST' ? NO_TABLE() : null), async () => {
    await assert.rejects(addRework(ENV, { orderId: 'O1', user: { id: 'U1' }, body: { kind: 'rework', cause: 'edge' } }), /management-phase2\.sql/);
  });
});

test('읽기: 표가 아직 없으면 null — 수주 화면은 안내만 띄운다', async () => {
  await withFetch((u) => (u.includes('/rework_logs?') ? NO_TABLE() : null), async () => {
    assert.equal(await listReworks(ENV, 'O1'), null);
  });
  await withFetch((u) => (u.includes('/rework_logs?') ? json([{ id: 'R1' }]) : null), async () => {
    assert.deepEqual(await listReworks(ENV, 'O1'), [{ id: 'R1' }]);
  });
});

test('지우기: 다른 수주의 기록은 지우지 못한다', async () => {
  await withFetch((u, method) => owned(u, method) || (u.includes('/rework_logs?') && method === 'GET' ? json([{ id: 'R9', order_id: 'O2' }]) : null), async () => {
    await assert.rejects(deleteRework(ENV, { orderId: 'O1', reworkId: 'R9', user: { id: 'U1' } }), /찾을 수 없습니다/);
  });
});

// ── 품질비용 · A/S 율 ──
const SETTINGS = { costs: { assemblerDay: 200000 }, crew: { hoursPerDay: 8 } }; // 시간당 25,000
const REWORKS = [
  { order_id: 'A', kind: 'rework', cause: 'cutting', occurred_on: '2026-10-03', minutes: 60, cost: 30000 }, // 30,000 + 25,000
  { order_id: 'B', kind: 'as', cause: 'install', occurred_on: '2026-10-10', minutes: 120, cost: 0 }, // 50,000
  { order_id: 'A', kind: 'rework', cause: 'cutting', occurred_on: '2026-10-12', minutes: 30, cost: null }, // 12,500
  { order_id: 'C', kind: 'as', cause: 'material', occurred_on: '2026-09-15', minutes: 0, cost: 80000 }, // 지난 달 — A/S 율에만
];
const INSTALLED = [
  { id: 'A', status: 'completed', completed_at: '2026-09-20T03:00:00Z' },
  { id: 'B', status: 'delivered', delivered_at: '2026-10-01T03:00:00Z' },
  { id: 'C', status: 'completed', delivered_at: '2026-07-30T03:00:00Z', completed_at: '2026-08-01T03:00:00Z' },
  { id: 'D', status: 'completed', completed_at: '2026-03-01T03:00:00Z' }, // 반년 창 밖
  { id: 'E', status: 'delivered', delivered_at: '2026-11-02T03:00:00Z' }, // 그 달 뒤
];

test('품질비용: 이달 재작업 2 · A/S 1, 비용 3만 + 다시 한 210분 × 시간당 2.5만 = 11.75만, 원인은 돈 순', () => {
  const q = qualityOf({ reworks: REWORKS, installed: INSTALLED, settings: SETTINGS }, '2026-10');
  assert.equal(q.hourly, 25000);
  assert.deepEqual(q.month, {
    rework: 2,
    as: 1,
    minutes: 210,
    cost: 30000,
    laborWon: 87500,
    total: 117500,
    causes: [
      { cause: 'cutting', label: '재단', count: 2, won: 67500 },
      { cause: 'install', label: '설치', count: 1, won: 50000 },
    ],
  });
});

test('A/S 율: 반년 안에 설치한 집 A · B · C 중 A/S 를 간 집 B · C — 66.7%', () => {
  const q = qualityOf({ reworks: REWORKS, installed: INSTALLED, settings: SETTINGS }, '2026-10');
  assert.deepEqual(q.window, { days: 180, start: '2026-05-05', end: '2026-10-31', installed: 3, withAs: 2, asRate: 66.7 });
  // 이번 달이면 창 끝은 오늘
  assert.equal(qualityOf({ reworks: REWORKS, installed: INSTALLED, settings: SETTINGS }, '2026-10', '2026-10-15').window.end, '2026-10-15');
});

test('기록 표가 없으면(2단계 SQL 전) 품질은 null — 대시보드가 안내를 띄운다', () => {
  assert.equal(qualityOf({ reworks: null, installed: INSTALLED, settings: SETTINGS }, '2026-10'), null);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: SETTINGS, month: '2026-10' });
  assert.equal(s.quality, null);
  const t = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], reworks: [], installed: [], settings: SETTINGS, month: '2026-10' });
  assert.equal(t.quality.month.total, 0);
  assert.equal(t.quality.window.asRate, null);
});
