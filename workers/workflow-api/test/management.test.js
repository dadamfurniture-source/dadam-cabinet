/**
 * 경영 대시보드 1단계 — 맨 위 이익 식 · 손익분기 · 채널 공헌이익 · 상담과 확인서 전환.
 *
 * 기댓값은 전부 손으로 계산했다. 바탕은 월 생산 마감(summarizeMonth)과 같다:
 * 매출 = 계약금 ÷ 1.1, 변동원가 = 견적 원가 − 고정비 회수분.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prevMonthOf, financeOf, breakEven, channelsOf, leadsAndConversion, buildManagementSummary, factorySeconds, funnelOf, platformOf,
} from '../src/management/summary.js';

// 10월: a(직판, 원가 있음) · b(거래처, 원가 있음) · c(직판, 옛 스냅샷이라 원가 없음) · d(취소) / 9월: e
const ORDERS = [
  { id: 'a', order_no: 'SO-1', snapshot_id: 's1', status: 'confirmed', contract_amount: 2200000, ordered_at: '2026-10-05T01:00:00Z' },
  { id: 'b', order_no: 'SO-2', snapshot_id: 's2', status: 'completed', contract_amount: 1210000, ordered_at: '2026-10-15T01:00:00Z' },
  { id: 'c', order_no: 'SO-3', snapshot_id: 's3', status: 'confirmed', contract_amount: 1100000, ordered_at: '2026-10-20T01:00:00Z' },
  { id: 'd', order_no: 'SO-4', snapshot_id: 's1', status: 'cancelled', contract_amount: 9999999, ordered_at: '2026-10-21T01:00:00Z' },
  { id: 'e', order_no: 'SO-5', snapshot_id: 's1', status: 'confirmed', contract_amount: 3300000, ordered_at: '2026-09-10T01:00:00Z' },
];
const SNAPS = new Map([
  // s1: 원가 150만 중 고정비 회수 10만 → 변동원가 140만, 공장 2시간
  ['s1', { quote_payload: { total: 2200000, partner: { total: 2000000 }, cost: { total: 1500000, fixed_recovery: 100000, seconds: { cutter: 3600, edge: 1800, asm: 1800 } } } }],
  // s2: 거래처 금액 그대로 계약 → 거래처, 공장 3시간
  ['s2', { quote_payload: { total: 1320000, partner: { total: 1210000 }, cost: { total: 1000000, fixed_recovery: 0, seconds: { cutter: 5400, edge: 1800, asm: 3600 } } } }],
  ['s3', { quote_payload: { total: 1100000 } }],
]);
const SETTINGS = { quote: { overheadMonthly: 2000000 }, source: 'mine' };

test('전달: 1월의 전달은 지난해 12월', () => {
  assert.equal(prevMonthOf('2026-01'), '2025-12');
  assert.equal(prevMonthOf('2026-10'), '2026-09');
});

test('공장 작업 초: 재단 + 엣지 + 조립, 견적 원가가 없으면 null', () => {
  assert.equal(factorySeconds(SNAPS.get('s1').quote_payload), 7200);
  assert.equal(factorySeconds(SNAPS.get('s3').quote_payload), null);
  assert.equal(factorySeconds(null), null);
});

test('재무: 월 생산 마감과 같은 바탕 — 매출 410만, 공헌이익 70만, 공헌이익률 22.6%', () => {
  const f = financeOf(ORDERS, SNAPS, { month: '2026-10', overheadMonthly: 2000000 });
  assert.equal(f.orders, 3);                       // 취소 d 는 빠진다
  assert.equal(f.revenue, 2000000 + 1100000 + 1000000);
  assert.equal(f.avgContract, 1366667);            // 410만 ÷ 3
  assert.equal(f.contribution, 3100000 - 2400000); // 원가를 아는 a · b 만
  assert.equal(f.cmRate, 22.6);                    // 70만 ÷ 310만
  assert.equal(f.net, 700000 - 2000000);
  assert.equal(f.unknownCost, 1);
});

test('손익분기: 반올림 전 비율로 나눈다 — 200만 ÷ (70/310) = 885만 7,143', () => {
  const b = breakEven({ overhead: 2000000, revenue: 4100000, rate: 700000 / 3100000 });
  assert.equal(b.revenueNeeded, 8857143);
  assert.equal(b.cmRate, 22.6);
  assert.equal(b.progress, 46.3);
  assert.equal(b.gap, 8857143 - 4100000);
  assert.equal(b.safety, 0);
});

test('손익분기: 넘어선 달은 안전한계율을 낸다', () => {
  const b = breakEven({ overhead: 1000000, revenue: 5000000, rate: 0.5 });
  assert.equal(b.revenueNeeded, 2000000);
  assert.equal(b.progress, 250);
  assert.equal(b.gap, 0);
  assert.equal(b.safety, 60);                      // (500만 − 200만) ÷ 500만
});

test('손익분기: 공헌이익률이 없으면 계산하지 않는다 — 지어내지 않는다', () => {
  for (const rate of [null, 0, -0.1]) {
    const b = breakEven({ overhead: 1000000, revenue: 0, rate });
    assert.equal(b.revenueNeeded, null);
    assert.equal(b.progress, null);
  }
});

test('채널: 직판은 시간당 30만, 거래처는 시간당 3만 3,333 — 마진이 얇은 쪽이 공장도 오래 쓴다', () => {
  const f = financeOf(ORDERS, SNAPS, { month: '2026-10', overheadMonthly: 0 });
  const [cust, part] = channelsOf(f.rows, ORDERS, SNAPS);
  assert.deepEqual(cust, { tier: 'customer', label: '직판', orders: 2, revenue: 3000000, contribution: 600000, cmRate: 30, factoryHours: 2, perHour: 300000 });
  assert.deepEqual(part, { tier: 'partner', label: '거래처', orders: 1, revenue: 1100000, contribution: 100000, cmRate: 9.1, factoryHours: 3, perHour: 33333 });
});

const DOCS = [
  // D1: 고쳐서 다시 낸 뒤 승인 — 한 건으로 센다
  { design_id: 'D1', doc_type: 'customer_confirmation', status: 'superseded', decision: null, created_at: '2026-10-01T01:00:00Z', first_viewed_at: '2026-10-01T07:00:00Z' },
  { design_id: 'D1', doc_type: 'customer_confirmation', status: 'approved', decision: 'approved', created_at: '2026-10-05T01:00:00Z', first_viewed_at: '2026-10-05T02:00:00Z', decided_at: '2026-10-06T01:00:00Z' },
  { design_id: 'D1', doc_type: 'work_order', status: 'issued', decision: null, created_at: '2026-10-06T01:00:00Z' },
  // D2: 아직 결정 전
  { design_id: 'D2', doc_type: 'customer_confirmation', status: 'viewed', decision: null, created_at: '2026-10-10T01:00:00Z', first_viewed_at: '2026-10-10T03:00:00Z' },
  // D3: 거절
  { design_id: 'D3', doc_type: 'customer_confirmation', status: 'rejected', decision: 'rejected', created_at: '2026-10-12T01:00:00Z', first_viewed_at: '2026-10-12T13:00:00Z', decided_at: '2026-10-14T01:00:00Z' },
  // D4: 9월에 처음 나갔고 10월에 승인 — 9월 코호트다
  { design_id: 'D4', doc_type: 'customer_confirmation', status: 'superseded', decision: null, created_at: '2026-09-20T01:00:00Z' },
  { design_id: 'D4', doc_type: 'customer_confirmation', status: 'approved', decision: 'approved', created_at: '2026-10-03T01:00:00Z', decided_at: '2026-10-03T05:00:00Z' },
  // D5: 회수 — 발행으로는 세지만 대기도 거절도 아니다
  { design_id: 'D5', doc_type: 'customer_confirmation', status: 'revoked', decision: null, created_at: '2026-10-15T01:00:00Z' },
];
const CONSULTS = [
  { created_at: '2026-10-02T01:00:00Z' },
  { created_at: '2026-10-03T01:00:00Z' },
  { created_at: '2026-10-30T16:00:00Z' }, // KST 10/31 01시 — 10월
  { created_at: '2026-10-31T16:00:00Z' }, // KST 11/1 — 11월
  { created_at: '2026-09-15T01:00:00Z' },
];

test('확인서 전환: 설계 하나를 한 건으로, 처음 나간 달로 묶는다', () => {
  const oct = leadsAndConversion({ documents: DOCS, consultations: CONSULTS }, '2026-10');
  assert.deepEqual(oct, { leads: 3, issued: 4, approved: 1, rejected: 1, pending: 1, conversion: 25 });
  const sep = leadsAndConversion({ documents: DOCS, consultations: CONSULTS }, '2026-09');
  assert.deepEqual(sep, { leads: 1, issued: 1, approved: 1, rejected: 0, pending: 0, conversion: 100 });
});

test('상담을 못 읽었으면 상담 수는 null — 0 으로 지어내지 않는다', () => {
  const r = leadsAndConversion({ documents: [], consultations: null }, '2026-10');
  assert.equal(r.leads, null);
  assert.equal(r.conversion, null);
});

test('경영 요약 한 벌: 이달과 지난 달을 나란히, 근거를 함께 싣는다', () => {
  const s = buildManagementSummary({ orders: ORDERS, snapshotsById: SNAPS, documents: DOCS, consultations: CONSULTS, settings: SETTINGS, month: '2026-10' });
  assert.equal(s.prevMonth, '2026-09');
  assert.deepEqual(s.tree.orders, { value: 3, prev: 1 });
  assert.deepEqual(s.tree.revenue, { value: 4100000, prev: 3000000 });
  assert.deepEqual(s.tree.avgContract, { value: 1366667, prev: 3000000 });
  assert.deepEqual(s.tree.contribution, { value: 700000, prev: 1600000 });
  assert.deepEqual(s.tree.cmRate, { value: 22.6, prev: 53.3 });
  assert.deepEqual(s.tree.net, { value: -1300000, prev: -400000 });
  assert.deepEqual(s.tree.leads, { value: 3, prev: 1 });
  assert.deepEqual(s.tree.conversion, { value: 25, prev: 100 });
  assert.equal(s.tree.pending, 1);
  assert.equal(s.tree.overhead, 2000000);
  assert.equal(s.tree.unknownCost, 1);
  assert.equal(s.breakEven.revenueNeeded, 8857143);
  assert.equal(s.channels.length, 2);
  assert.equal(s.basis.overhead, 2000000);
  assert.equal(s.basis.settingsSource, 'mine');
});

test('수주가 없는 달: 0 으로 채우고 비율은 비운다', () => {
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: SETTINGS, month: '2026-11' });
  assert.equal(s.tree.orders.value, 0);
  assert.equal(s.tree.revenue.value, 0);
  assert.equal(s.tree.avgContract.value, null);
  assert.equal(s.tree.cmRate.value, null);
  assert.equal(s.tree.net.value, -2000000);
  assert.equal(s.breakEven.revenueNeeded, null);
  assert.deepEqual(s.channels, []);
});

// ── PR-2: 영업 퍼널 · AI 플랫폼 → 수주 ──
const DESIGN_ORDERS = [
  { design_id: 'D1', status: 'confirmed' },
  { design_id: 'D4', status: 'completed' },
  { design_id: 'D3', status: 'cancelled' }, // 취소된 수주는 세지 않는다
];

test('영업 퍼널: 발행 4 → 열람 3 → 승인 1 → 수주 1, 수정 평균 1.3회 · 첫 열람 중간 6시간 · 결정 중간 3.5일', () => {
  const f = funnelOf({ documents: DOCS, consultations: CONSULTS, orders: DESIGN_ORDERS }, '2026-10');
  assert.deepEqual(f, {
    leads: 3,
    issued: 4,
    viewed: 3,            // D1 · D2 · D3 (D5 는 회수돼 열람 없음)
    approved: 1,
    ordered: 1,           // D1
    rejected: 1,
    pending: 1,
    conversion: 25,
    viewRate: 75,
    orderRate: 100,
    avgRevisions: 1.3,    // (2 + 1 + 1 + 1) ÷ 4 = 1.25
    medianHoursToView: 6, // [6, 2, 12] — 첫 확인서 발행부터 그 설계의 첫 열람까지
    medianDaysToDecide: 3.5, // D1 승인 5일 · D3 거절 2일
  });
});

test('영업 퍼널: 9월 코호트는 D4 하나 — 10월에 승인 · 수주돼도 9월로 센다', () => {
  const f = funnelOf({ documents: DOCS, consultations: CONSULTS, orders: DESIGN_ORDERS }, '2026-09');
  assert.equal(f.issued, 1);
  assert.equal(f.approved, 1);
  assert.equal(f.ordered, 1);
  assert.equal(f.viewed, 0);
  assert.equal(f.medianHoursToView, null);
});

test('전환율 한 줄은 퍼널과 같은 규칙이다 — 두 벌로 두지 않는다', () => {
  const a = leadsAndConversion({ documents: DOCS, consultations: CONSULTS }, '2026-10');
  const f = funnelOf({ documents: DOCS, consultations: CONSULTS, orders: [] }, '2026-10');
  assert.deepEqual(a, { leads: f.leads, issued: f.issued, approved: f.approved, rejected: f.rejected, pending: f.pending, conversion: f.conversion });
});

const GENS = [
  { id: 'g1', user_id: 'u1', status: 'done', created_at: '2026-10-02T01:00:00Z' },
  { id: 'g2', user_id: 'u1', status: 'done', created_at: '2026-10-03T01:00:00Z' },
  { id: 'g3', user_id: 'u2', status: 'done', created_at: '2026-10-04T01:00:00Z' },
  { id: 'g4', user_id: 'u3', status: 'failed', created_at: '2026-10-05T01:00:00Z' },
  { id: 'g5', user_id: 'u4', status: 'done', created_at: '2026-09-25T01:00:00Z' },
];
const GEN_DESIGNS = [
  { id: 'D1', generation_id: 'g1' }, // → 확인서 → 수주
  { id: 'D9', generation_id: 'g3' }, // 설계까지만
  { id: 'D4', generation_id: 'g5' }, // 9월 연출컷
];
const CONSULTS_U = [
  { created_at: '2026-10-02T05:00:00Z', user_id: 'u1' },
  { created_at: '2026-10-08T05:00:00Z', user_id: 'u5' }, // 연출컷을 안 만든 사람
  { created_at: '2026-10-09T05:00:00Z', user_id: null },
];

test('AI 플랫폼 → 수주: 연출컷 3 → 설계 2 → 확인서 1 → 수주 1, 사람 2명 중 상담 1명', () => {
  const p = platformOf({ generations: GENS, designs: GEN_DESIGNS, documents: DOCS, orders: DESIGN_ORDERS, consultations: CONSULTS_U }, '2026-10');
  assert.deepEqual(p, {
    generations: 3,
    failed: 1,
    failRate: 25,        // 실패 1 ÷ 시도 4
    people: 2,           // u1 · u2 (실패만 한 u3 는 빼고)
    consultedPeople: 1,  // u1
    designs: 2,
    confirmed: 1,
    ordered: 1,
  });
});

test('AI 플랫폼: 연출컷을 못 읽었으면 null — 0 으로 지어내지 않는다', () => {
  assert.equal(platformOf({ generations: null, designs: [], documents: [], orders: [], consultations: [] }, '2026-10'), null);
  const p = platformOf({ generations: GENS, designs: GEN_DESIGNS, documents: DOCS, orders: DESIGN_ORDERS, consultations: null }, '2026-10');
  assert.equal(p.consultedPeople, null);
});

test('경영 요약에 퍼널과 플랫폼(이달 · 지난 달)이 실린다', () => {
  const s = buildManagementSummary({
    orders: [...ORDERS, ...DESIGN_ORDERS.map((o, i) => ({ id: `x${i}`, snapshot_id: null, contract_amount: 0, ordered_at: '2026-10-07T01:00:00Z', ...o }))],
    snapshotsById: SNAPS, documents: DOCS, consultations: CONSULTS_U, generations: GENS, designs: GEN_DESIGNS, settings: SETTINGS, month: '2026-10',
  });
  assert.equal(s.funnel.issued, 4);
  assert.equal(s.funnel.ordered, 1);
  assert.equal(s.platform.value.ordered, 1);
  assert.equal(s.platform.prev.generations, 1);
  assert.equal(s.platform.prev.ordered, 1); // g5 → D4 → 수주
});

// ── PR-3: 공정 줄 — 견적 대비 실적 · 부하 · 처리량 ──
import { estimateByCategory, costVariance, timeVariance, workdaysInMonth, loadOf, throughputOf, processOf } from '../src/management/summary.js';
import { mergeLogs } from '../src/management/service.js';

const P_ORDERS = [
  { id: 'P1', order_no: 'SO-11', customer_name: 'P고객', snapshot_id: 'sp1', status: 'confirmed', contract_amount: 3300000, ordered_at: '2026-10-06T01:00:00Z' },
  { id: 'P2', order_no: 'SO-12', snapshot_id: 'sp2', status: 'in_production', contract_amount: 1100000, ordered_at: '2026-10-13T01:00:00Z' },
  { id: 'P3', order_no: 'SO-13', snapshot_id: 'sp1', status: 'cancelled', contract_amount: 9900000, ordered_at: '2026-10-14T01:00:00Z' },
  { id: 'P4', order_no: 'SO-14', snapshot_id: 'sp2', status: 'confirmed', contract_amount: 1100000, ordered_at: '2026-09-14T01:00:00Z' },
];
const P_SNAPS = new Map([
  ['sp1', { quote_payload: { cost: {
    body: { material: 400000, edge: 20000, hardware: 80000, labor: 150000, overhead: 0, fixed: 100000 },
    back: { material: 40000, labor: 10000, overhead: 0 },
    door: { outsourcing: 500000, labor: 5000, overhead: 0 },
    install: { outsourcing: 120000 },
    extras: { countertop: 300000, sinkBowl: 55000 },
    seconds: { cutter: 4200, edge: 1800, asm: 6000 },
  } } }],
  ['sp2', { quote_payload: { cost: {
    body: { material: 200000, edge: 10000, hardware: 40000 },
    back: { material: 20000 },
    door: { outsourcing: 300000 },
    install: { outsourcing: 0 },
    extras: {},
    seconds: { cutter: 2400, edge: 900, asm: 3000 },
  } } }],
]);
const P_COSTS = [
  { order_id: 'P1', category: 'material', amount: 300000 },
  { order_id: 'P1', category: 'material', amount: 260000 },
  { order_id: 'P1', category: 'outsourcing', amount: 950000 },
  { order_id: 'P1', category: 'labor', amount: 200000 }, // 노무는 돈으로 비교하지 않는다
  { order_id: 'P2', category: 'hardware', amount: 30000 },
  { order_id: 'P4', category: 'material', amount: 100 },  // 9월 수주
];
const P_LOGS = [
  { id: 'w1', order_id: 'P1', role: 'cutter', minutes: 50, work_date: '2026-10-07' },
  { id: 'w2', order_id: 'P1', role: 'cutter', minutes: 30, work_date: '2026-10-08' },
  { id: 'w3', order_id: 'P1', role: 'asm', minutes: 90, work_date: '2026-10-12' },
  { id: 'w4', order_id: 'P2', role: 'edge', minutes: 20, work_date: '2026-10-15' },
  { id: 'w5', order_id: null, role: 'edge', minutes: 60, work_date: '2026-10-20' }, // 주문 없는 기록 — 부하엔 들고 시간 차이엔 안 든다
];
const P_SETTINGS = { quote: { overheadMonthly: 0 }, crew: { hoursPerDay: 8, util: 0.85, cutters: 1, edgeMachines: 1, assemblers: 1 }, holidays: ['2026-10-09', '2026-10-03'] };

test('견적 원가를 실적 범주로: 상판 · 철거 = 외주, 싱크볼 · 수전 · 후드 = 자재, 노무는 뺀다', () => {
  assert.deepEqual(estimateByCategory(P_SNAPS.get('sp1').quote_payload), {
    material: 400000 + 20000 + 40000 + 55000, hardware: 80000, outsourcing: 500000 + 120000 + 300000, logistics: 0, other: 0,
  });
  assert.equal(estimateByCategory({ total: 1 }), null);
});

test('견적 대비 실적(돈): 넣은 범주만 비교 — 자재 +8.7% · 철물 −25% · 외주 +3.3%, 크게 빗나간 순', () => {
  const v = costVariance(P_ORDERS, P_SNAPS, P_COSTS, '2026-10');
  assert.equal(v.orders, 2);
  assert.equal(v.recorded, 2);
  assert.deepEqual(v.categories, [
    { category: 'material', label: '자재', orders: 1, estimate: 515000, actual: 560000, diff: 45000, diffRate: 8.7 },
    { category: 'hardware', label: '부자재', orders: 1, estimate: 40000, actual: 30000, diff: -10000, diffRate: -25 },
    { category: 'outsourcing', label: '외주', orders: 1, estimate: 920000, actual: 950000, diff: 30000, diffRate: 3.3 },
  ]);
  assert.deepEqual(v.totals, { estimate: 1475000, actual: 1540000, diff: 65000, diffRate: 4.4 });
  assert.deepEqual(v.top.map((r) => [r.label, r.diff, r.diffRate, r.worst.label]), [
    ['P고객 (SO-11)', 75000, 5.2, '자재'],
    ['SO-12', -10000, -25, '부자재'],
  ]);
});

test('견적 대비 실적(시간): 실측이 붙은 역할만 — 재단 +14.3% · 엣지 +33.3% · 조립 −10%', () => {
  assert.deepEqual(timeVariance(P_ORDERS, P_SNAPS, P_LOGS, '2026-10'), [
    { role: 'cutter', label: '재단', orders: 1, estimateMin: 70, actualMin: 80, diffRate: 14.3 },
    { role: 'edge', label: '엣지', orders: 1, estimateMin: 15, actualMin: 20, diffRate: 33.3 },
    { role: 'asm', label: '조립', orders: 1, estimateMin: 100, actualMin: 90, diffRate: -10 },
  ]);
});

test('근무일: 2026-10 은 평일 22일에서 한글날(금) 하루를 뺀 21일, 토요일 휴일은 영향 없음', () => {
  assert.equal(workdaysInMonth('2026-10', ['2026-10-09', '2026-10-03']), 21);
  assert.equal(workdaysInMonth('2026-02', []), 20);
});

test('공정 부하: 능력 = 21일 × 8시간 × 0.85 = 142.8시간/인, 받은 일 비율이 가장 높은 조립이 병목', () => {
  const l = loadOf(P_ORDERS, P_SNAPS, P_LOGS, P_SETTINGS, '2026-10');
  assert.equal(l.workdays, 21);
  assert.equal(l.bottleneck, 'asm');
  assert.deepEqual(l.roles, [
    { role: 'cutter', label: '재단', people: 1, capacityHours: 142.8, receivedHours: 1.8, doneHours: 1.3, load: 1.3, doneLoad: 0.9 },
    { role: 'edge', label: '엣지', people: 1, capacityHours: 142.8, receivedHours: 0.8, doneHours: 1.3, load: 0.5, doneLoad: 0.9 },
    { role: 'asm', label: '조립', people: 1, capacityHours: 142.8, receivedHours: 2.5, doneHours: 1.5, load: 1.8, doneLoad: 1.1 },
  ]);
});

test('처리량: 매출 − 자재 · 철물 · 외주, 병목(조립) 1분당 — P1 14,850원 > P2 8,600원', () => {
  const t = throughputOf(P_ORDERS, P_SNAPS, '2026-10', 'asm');
  assert.equal(t.label, '조립');
  assert.deepEqual(t.rows.map((r) => [r.label, r.throughput, r.minutes, r.perMin]), [
    ['P고객 (SO-11)', 1485000, 100, 14850],
    ['SO-12', 430000, 50, 8600],
  ]);
  assert.equal(t.avgPerMin, 12767); // 191.5만 ÷ 150분
  assert.equal(throughputOf(P_ORDERS, P_SNAPS, '2026-10', 'cutter').avgPerMin, 17409);
  assert.equal(throughputOf(P_ORDERS, P_SNAPS, '2026-10', 'nope').role, null);
});

test('공정 줄 한 벌: 처리량은 병목 공정의 분으로 나눈다', () => {
  const p = processOf({ orders: P_ORDERS, snapshotsById: P_SNAPS, costs: P_COSTS, worklogs: P_LOGS, settings: P_SETTINGS }, '2026-10');
  assert.equal(p.load.bottleneck, 'asm');
  assert.equal(p.throughput.role, 'asm');
  assert.equal(p.variance.recorded, 2);
  assert.equal(p.time.length, 3);
});

test('실측을 두 번 읽어도(주문 기준 · 달 기준) 한 번만 센다', () => {
  const merged = mergeLogs(P_LOGS.slice(0, 3), P_LOGS);
  assert.equal(merged.length, P_LOGS.length);
});

// ── PR-4: 만약에 판의 바탕 ──
import { scenarioBase } from '../src/management/summary.js';

const W_ORDERS = [
  { id: 'W1', order_no: 'SO-21', snapshot_id: 'sw1', status: 'confirmed', contract_amount: 3300000, ordered_at: '2026-10-06T01:00:00Z' },
  { id: 'W2', order_no: 'SO-22', snapshot_id: 'sw2', status: 'confirmed', contract_amount: 1100000, ordered_at: '2026-10-07T01:00:00Z' },
  { id: 'W3', order_no: 'SO-23', snapshot_id: 'sw3', status: 'confirmed', contract_amount: 1100000, ordered_at: '2026-10-08T01:00:00Z' },
  { id: 'W4', order_no: 'SO-24', snapshot_id: 'sw1', status: 'cancelled', contract_amount: 3300000, ordered_at: '2026-10-09T01:00:00Z' },
];
const W_SNAPS = new Map([
  ['sw1', { quote_payload: { partner: { total: 3000000 }, cost: {
    total: 1780000, fixed_recovery: 100000,
    body: { material: 400000, edge: 20000, hardware: 80000, labor: 150000, overhead: 0, fixed: 100000 },
    back: { material: 40000, labor: 10000, overhead: 0 },
    door: { outsourcing: 500000, labor: 5000, overhead: 0 },
    install: { outsourcing: 120000 },
    extras: { countertop: 300000, sinkBowl: 55000 },
    quantities: { doorSheets: 5 },
  } } }],
  ['sw2', { quote_payload: { partner: { total: 1100000 }, cost: {
    total: 650000, fixed_recovery: 30000,
    body: { material: 200000, edge: 10000, hardware: 40000, labor: 50000, fixed: 30000 },
    back: { material: 20000 },
    door: { outsourcing: 300000 },
    install: { outsourcing: 0 },
    extras: {},
    quantities: { doorSheets: 3 },
  } } }],
  ['sw3', { quote_payload: { total: 1100000 } }],
]);
const W_SETTINGS = { quote: { overheadMonthly: 6190000, marginRate: 0.2, partnerMarginRate: 0.1 } };

test('만약에 판의 바탕: 갈래별 합 — 직판 300만 · 거래처 100만 · 원가 모르는 100만', () => {
  assert.deepEqual(scenarioBase(W_ORDERS, W_SNAPS, W_SETTINGS, '2026-10'), {
    orders: 3,
    revenueCustomer: 3000000,
    revenuePartner: 1000000,
    revenueUnknown: 1000000,
    material: 515000 + 230000,   // 몸통 · 엣지 · 뒷판 + 싱크볼
    hardware: 80000 + 40000,
    door: 500000 + 300000,
    doorSheets: 8,
    outsourcing: 120000 + 300000, // 시공 + 상판
    labor: 165000 + 50000,
    overheadAlloc: 0,
    overheadMonthly: 6190000,
    marginRate: 0.2,
    partnerMarginRate: 0.1,
    partTimeMonthly: 0,           // 생산 설정에 시급 · 근무 시간이 없으면 0
  });
  const withCrew = { quote: { ...W_SETTINGS.quote, workDays: 22 }, crew: { hoursPerDay: 8 }, costs: { partTimeHourly: 12000 } };
  assert.equal(scenarioBase(W_ORDERS, W_SNAPS, withCrew, '2026-10').partTimeMonthly, 12000 * 8 * 22);
});

test('만약에 판을 그대로 두면 맨 위 이익 식과 한 원도 다르지 않다 — 갈래의 합 = 변동원가', () => {
  const b = scenarioBase(W_ORDERS, W_SNAPS, W_SETTINGS, '2026-10');
  const f = financeOf(W_ORDERS, W_SNAPS, { month: '2026-10', overheadMonthly: 6190000 });
  const variable = b.material + b.hardware + b.door + b.outsourcing + b.labor + b.overheadAlloc;
  assert.equal(b.revenueCustomer + b.revenuePartner - variable, f.contribution);
  assert.equal(b.revenueCustomer + b.revenuePartner + b.revenueUnknown, f.revenue);
});
