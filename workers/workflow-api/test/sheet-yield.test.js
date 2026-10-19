/**
 * 원판 사용량 — 경영 대시보드 3단계 PR-11 (도구 15 원판 수율).
 *
 * 견적은 원판 장수를 면적 ÷ 수율(기본 0.8)로 잡는다. 재단 기사가 작업 링크로 그 주문에 남긴 장수가
 * 실제다. 둘을 견주면 수율 설정이 맞는지 보이고, 수주가 쌓이면 고칠 값을 제안한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetYieldOf, buildManagementSummary, YIELD_MIN_ORDERS } from '../src/management/summary.js';

const TODAY = '2026-10-21';
const SETTINGS = { quote: { pbYield: 0.8, pbSheet: 32000, backSheet: 19500 } };
const snap = (pb, back) => ({ quote_payload: { cost: { total: 1, quantities: { sheetsPB: pb, sheetsBack: back } } } });
const SNAPS = new Map([['s1', snap(6, 2)], ['s2', snap(9.5, 0.5)], ['s3', snap(4, 1)], ['s5', { quote_payload: { cost: { total: 1 } } }]]);
const ORDERS = [
  { id: 'Y1', order_no: 'SO-21', customer_name: '이고객', snapshot_id: 's1', status: 'completed', completed_at: '2026-10-01T03:00:00Z' },
  { id: 'Y2', order_no: 'SO-22', snapshot_id: 's2', status: 'delivered', delivered_at: '2026-09-15T03:00:00Z' },
  { id: 'Y3', order_no: 'SO-23', snapshot_id: 's3', status: 'completed', completed_at: '2026-03-01T03:00:00Z' }, // 반년 창 밖
  { id: 'Y4', order_no: 'SO-24', snapshot_id: 's3', status: 'completed', completed_at: '2026-10-05T03:00:00Z' }, // 재단 실측 없음
  { id: 'Y5', order_no: 'SO-25', snapshot_id: 's5', status: 'completed', completed_at: '2026-10-06T03:00:00Z' }, // 견적 수량 없음
];
const LOGS = [
  { order_id: 'Y1', role: 'cutter', units: 4 },
  { order_id: 'Y1', role: 'cutter', units: 5 },
  { order_id: 'Y1', role: 'asm', units: 3 }, // 조립은 보지 않는다
  { order_id: 'Y2', role: 'cutter', units: 10 },
  { order_id: 'Y3', role: 'cutter', units: 99 },
  { order_id: 'Y5', role: 'cutter', units: 7 },
];

test('계획 18장 → 실제 19장 (+5.6%), 원판 값 30,264원 더 씀, 실제 수율 ≈ 0.76 — 아직 2건이라 제안은 안 한다', () => {
  const y = sheetYieldOf({ doneOrders: ORDERS, snapshotsById: SNAPS, cutLogs: LOGS, settings: SETTINGS }, '2026-10', TODAY);
  assert.deepEqual(y, {
    window: { days: 180, start: '2026-04-25', end: '2026-10-21' },
    orders: 2,
    planned: 18,
    actual: 19,
    diffRate: 5.6,
    costDiff: 30264, // 1장 × (15.5 × 32,000 + 2.5 × 19,500) ÷ 18
    yieldNow: 0.8,
    impliedYield: 0.76, // 0.8 × 18 ÷ 19
    suggestYield: null,
    minOrders: 5,
    top: [
      { id: 'Y1', label: '이고객 (SO-21)', planned: 8, actual: 9, diffRate: 12.5 },
      { id: 'Y2', label: 'SO-22', planned: 10, actual: 10, diffRate: 0 },
    ],
  });
});

test(`수주가 ${YIELD_MIN_ORDERS}건 쌓이고 차이가 0.02 넘으면 고칠 수율을 제안한다`, () => {
  const orders = Array.from({ length: 5 }, (_, i) => ({ id: `Z${i}`, order_no: `SO-${i}`, snapshot_id: 'z', status: 'completed', completed_at: '2026-10-01T03:00:00Z' }));
  const logs = orders.map((o) => ({ order_id: o.id, role: 'cutter', units: 12.5 }));
  const y = sheetYieldOf({ doneOrders: orders, snapshotsById: new Map([['z', snap(10, 0)]]), cutLogs: logs, settings: SETTINGS }, '2026-10', TODAY);
  assert.equal(y.impliedYield, 0.64);
  assert.equal(y.suggestYield, 0.64);
  // 차이가 작으면 흔들지 않는다
  const close = sheetYieldOf({ doneOrders: orders, snapshotsById: new Map([['z', snap(10, 0)]]), cutLogs: orders.map((o) => ({ order_id: o.id, role: 'cutter', units: 10.1 })), settings: SETTINGS }, '2026-10', TODAY);
  assert.equal(close.suggestYield, null);
});

test('재단이 끝난 수주가 없으면 0건 — 대시보드가 안내를 띄운다', () => {
  const y = sheetYieldOf({ doneOrders: [], snapshotsById: new Map(), cutLogs: [], settings: SETTINGS }, '2026-10', TODAY);
  assert.equal(y.orders, 0);
  assert.equal(y.impliedYield, null);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: SETTINGS, month: '2026-10', today: TODAY });
  assert.equal(s.sheetYield.orders, 0);
});
