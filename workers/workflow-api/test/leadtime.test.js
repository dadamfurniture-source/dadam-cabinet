/**
 * 리드타임 · 납기 준수 — 경영 대시보드 3단계 PR-10 (도구 7).
 *
 * 단계 일정(실측 · 제작 착수 · 제작 완료 · 설치)을 '완료' 로 바꾼 시각 사이가 대기다.
 * 납기 준수는 설치를 처음 잡은 날(planned_at) 안에 끝냈는지 — 미뤄도 처음 날짜는 바뀌지 않는다(DB 트리거).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leadTimeOf, buildManagementSummary, LEAD_STAGES } from '../src/management/summary.js';

const TODAY = '2026-10-21';
const S = (design_id, type, scheduled_at, extra = {}) => ({ design_id, type, status: extra.completed_at ? 'completed' : 'scheduled', scheduled_at, planned_at: scheduled_at, completed_at: null, ...extra });
const SCHEDULES = [
  // d1 — 2 · 7 · 4 · 6.2일, 약속한 날 설치
  S('d1', 'measurement', '2026-09-03T00:00:00Z', { completed_at: '2026-09-03T00:00:00Z' }),
  S('d1', 'manufacturing_start', '2026-09-10T00:00:00Z', { completed_at: '2026-09-10T00:00:00Z' }),
  S('d1', 'manufacturing_end', '2026-09-14T00:00:00Z', { completed_at: '2026-09-14T00:00:00Z' }),
  S('d1', 'installation', '2026-09-18T01:00:00Z', { status: 'cancelled' }), // 취소된 일정은 보지 않는다
  S('d1', 'installation', '2026-09-20T01:00:00Z', { completed_at: '2026-09-20T05:00:00Z' }),
  // d2 — 4 · 3 · 8 · 8.1일, 9/25 로 잡았다가 9/28 로 미뤄 설치 (3일 늦음)
  S('d2', 'measurement', '2026-09-09T00:00:00Z', { completed_at: '2026-09-09T00:00:00Z' }),
  S('d2', 'manufacturing_start', '2026-09-12T00:00:00Z', { completed_at: '2026-09-12T00:00:00Z' }),
  S('d2', 'manufacturing_end', '2026-09-20T00:00:00Z', { completed_at: '2026-09-20T00:00:00Z' }),
  S('d2', 'installation', '2026-09-28T01:00:00Z', { planned_at: '2026-09-25T01:00:00Z', completed_at: '2026-09-28T03:00:00Z' }),
  // d3 — 설치가 10/15 로 잡혔는데 아직 (오늘 10/21) → 밀림
  S('d3', 'measurement', '2026-10-03T00:00:00Z', { completed_at: '2026-10-03T00:00:00Z' }),
  S('d3', 'installation', '2026-10-15T01:00:00Z'),
  // d4 — 반년 창 밖에서 끝난 설치
  S('d4', 'installation', '2026-03-01T01:00:00Z', { completed_at: '2026-03-01T05:00:00Z' }),
];
const ORDERS = [
  { design_id: 'd1', ordered_at: '2026-09-01T00:00:00Z', status: 'completed' },
  { design_id: 'd2', ordered_at: '2026-09-05T00:00:00Z', status: 'delivered' },
  { design_id: 'd3', ordered_at: '2026-10-01T00:00:00Z', status: 'in_production' },
  { design_id: 'd4', ordered_at: '2026-02-01T00:00:00Z', status: 'completed' },
];

test('리드타임: 단계별 중간값 3 · 5 · 6 · 7.2일, 수주 → 설치 21.2일, 가장 오래 기다리는 곳은 제작 완료 → 설치', () => {
  const l = leadTimeOf({ schedules: SCHEDULES, leadOrders: ORDERS }, '2026-10', TODAY);
  assert.deepEqual(l.window, { days: 180, start: '2026-04-25', end: '2026-10-21' });
  assert.equal(l.orders, 2);
  assert.equal(l.totalMedianDays, 21.2); // 19.2 · 23.1
  assert.deepEqual(l.stages, [
    { key: 'measure', label: '수주 → 실측', n: 2, medianDays: 3 },
    { key: 'start', label: '실측 → 제작 착수', n: 2, medianDays: 5 },
    { key: 'make', label: '제작', n: 2, medianDays: 6 },
    { key: 'install', label: '제작 완료 → 설치', n: 2, medianDays: 7.2 },
  ]);
  assert.deepEqual(l.slowest, { key: 'install', label: '제작 완료 → 설치', medianDays: 7.2 });
});

test('납기 준수: 설치 2 중 1 (50%) · 늦으면 3일 · 미룬 설치 1 · 밀린 설치 1', () => {
  const l = leadTimeOf({ schedules: SCHEDULES, leadOrders: ORDERS }, '2026-10', TODAY);
  assert.deepEqual(l.install, { done: 2, onTime: 1, onTimeRate: 50, avgLateDays: 3, rescheduled: 1, overdue: 1 });
});

test('취소된 수주 · 한 단계가 빠진 수주는 그 구간만 뺀다', () => {
  const orders = [{ ...ORDERS[0], status: 'cancelled' }, ORDERS[1]];
  const sched = SCHEDULES.filter((s) => !(s.design_id === 'd2' && s.type === 'manufacturing_start'));
  const l = leadTimeOf({ schedules: sched, leadOrders: orders }, '2026-10', TODAY);
  assert.equal(l.orders, 1);
  assert.deepEqual(l.stages.map((s) => s.n), [1, 0, 0, 1]);
  assert.equal(l.stages[1].medianDays, null);
});

test('칸이 없으면(3단계 SQL 전) null', () => {
  assert.equal(leadTimeOf({ schedules: null, leadOrders: ORDERS }, '2026-10', TODAY), null);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: {}, month: '2026-10', today: TODAY });
  assert.equal(s.leadTime, null);
  assert.equal(LEAD_STAGES.length, 4);
});

test('SQL: 처음 잡은 날은 바뀌지 않고, 완료로 바꿀 때 시각을 남기고, 완료가 아니면 비운다 · 완료 시각을 먼저 백필', () => {
  const sql = readFileSync(new URL('../../../database/management-phase3.sql', import.meta.url), 'utf8');
  assert.match(sql, /NEW\.planned_at := COALESCE\(OLD\.planned_at, OLD\.scheduled_at\)/);
  assert.match(sql, /NEW\.completed_at := COALESCE\(OLD\.completed_at, now\(\)\)/);
  assert.match(sql, /ELSE\s+NEW\.completed_at := NULL;/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON design_schedules/);
  assert.ok(sql.indexOf('SET completed_at = updated_at') < sql.indexOf('SET planned_at = scheduled_at'));
  assert.match(sql, /quarter ~ '\^\[0-9\]\{4\}-Q\[1-4\]\$'/);
});
