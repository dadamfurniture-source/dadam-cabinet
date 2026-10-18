/**
 * 생산 계획 · 인력 추천 엔진.
 *
 * 작업량 기대값은 2026-10-13 대표 확정 표준시간으로 손계산한 것이다
 * (재단 7분/장 + 피킹 20분, 엣지 15분/PB장, 조립 12분/통·서랍, 도어 1분+검수 45초, 포장 5분/통).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countWork, workloadFromCounts, workloadFromSnapshot, edgeFaces, edgeFacesOfRow } from '../src/production/workload.js';
import { planProduction, workdays, dayLabel } from '../src/production/planner.js';

const SINK_3M = { sheetsPB: 5, sheetsBack: 2, edgeFaces: 112, boxes: 8, drawers: 2, doors: 11, shelves: 10, legs: 22, rods: 0 };
const WARD_12 = { sheetsPB: 14, sheetsBack: 5, edgeFaces: 170, boxes: 4, drawers: 3, doors: 10, shelves: 7, legs: 0, rods: 15 };

test('작업량: 싱크대 3m (8통) 은 재단 4,140 · 엣지 2,240 (112면 × 20초) · 조립 11,885초', () => {
  const w = workloadFromCounts(SINK_3M);
  assert.equal(w.cutter, 1200 + 7 * 420);
  assert.equal(w.edge, 112 * 20);
  assert.equal(w.asmMain, 8 * 720 + 2 * 720 + 10 * 25 + 22 * 40);
  assert.equal(w.doorPart, 11 * 105 + 8 * 300);
  assert.equal(w.asm, 11885);
});

test('작업 수: 골든 싱크대 BOM 에서 통·서랍·도어·다리발을 센다 (cutPlan 없으면 면적으로 원판 추정)', () => {
  const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../../test-utils/bom-golden/sink15.golden.json', import.meta.url)), 'utf8'));
  const c = countWork({ materials: golden.materials, hardware: golden.hardware }, null);
  // 상부 3통(후드 제외) + 하부 5통(가스대 제외)
  assert.equal(c.boxes, 8);
  assert.equal(c.drawers, golden.hardwareSummary['레일']);
  assert.equal(c.legs, golden.hardwareSummary['다리발']);
  assert.ok(c.doors > 0);
  assert.equal(c.sheetSource, 'area');
  assert.ok(c.sheetsPB >= 4 && c.sheetsPB <= 7, `PB ${c.sheetsPB}`);
  // 엣지 면은 BOM 의 붙일 변(edges) 에서 센다
  assert.equal(c.edgeFacesSource, 'bom');
  const expected = golden.materials.filter((m) => String(m.material).toUpperCase().startsWith('PB'))
    .reduce((s, m) => s + ['L', 'R', 'T', 'B'].filter((k) => m.edges && m.edges[k]).length * m.qty, 0);
  assert.ok(expected > 0);
  assert.equal(c.edgeFaces, expected);
});

test('엣지 면: edges 객체 우선, 옛 문자열은 숫자, 면 정보가 전혀 없으면 PB 장당 17면 추정', () => {
  assert.equal(edgeFacesOfRow({ edges: { L: true, R: false, T: true, B: true } }), 3);
  assert.equal(edgeFacesOfRow({ edge: '4면' }), 4);
  assert.equal(edgeFacesOfRow({ edge: '2면(장)' }), 2);
  assert.equal(edgeFacesOfRow({ edge: '' }), 0);
  assert.equal(edgeFaces([{ material: 'PB', edge: '4면', qty: 2 }, { material: 'MDF', thickness: 2.7, edge: '4면', qty: 5 }]), 8, '뒷판은 세지 않는다');
  assert.equal(edgeFaces([{ material: 'PB', qty: 2 }]), null);
  const c = countWork({ materials: [{ material: 'PB', thickness: 15, w: 1000, h: 2000, qty: 4 }], hardware: [] }, { summary: { sheetsByMaterial: { PB_15: 3 } } });
  assert.deepEqual([c.edgeFaces, c.edgeFacesSource], [51, 'estimate']);
});

test('작업 수: cutPlan 이 있으면 원판 장수는 재단 배치 요약을 따른다 (도어 MDF 18T 는 외주라 제외)', () => {
  const c = countWork({ materials: [], hardware: [] }, { summary: { sheetsByMaterial: { PB_15: 6, 'MDF_2.7': 3, MDF_18: 2 } } });
  assert.deepEqual([c.sheetsPB, c.sheetsBack, c.sheetSource], [6, 3, 'cutPlan']);
  const w = workloadFromSnapshot({ bom_payload: { materials: [], hardware: [] }, cut_plan_payload: { summary: { sheetsByMaterial: { PB_18: 2 } } } });
  assert.equal(w.edge, 34 * 20, 'BOM 행이 없으면 PB 2장 × 17면');
});

test('근무일: 주말·공휴일을 건너뛴다', () => {
  // 2026-10-09(금) 한글날 공휴일 → 10/8(목), 10/12(월), 10/13(화)
  assert.deepEqual(workdays('2026-10-08', 3, ['2026-10-09']), ['2026-10-08', '2026-10-12', '2026-10-13']);
  assert.equal(dayLabel('2026-10-13'), '10/13(화)');
});

test('여유 있는 주문 1건: 늦지 않고, 조립 기사 출근일과 도어 발주 마감을 낸다', () => {
  const plan = planProduction({
    today: '2026-10-13',
    jobs: [{ id: 'a', label: '싱크대 A', orderedAt: '2026-10-13', installDate: '2026-10-22', work: workloadFromCounts(SINK_3M) }],
  });
  assert.equal(plan.summary.lateBefore, 0);
  assert.equal(plan.summary.extraCost, 0);
  const job = plan.jobs[0];
  assert.equal(job.due, '2026-10-21'); // 설치일 하루 전
  assert.equal(job.doorArrival, '2026-10-16'); // 주문일 + 3근무일
  assert.ok(job.finish <= job.due);
  assert.ok(plan.suggestions.some((s) => s.type === 'asm_call'));
  const door = plan.suggestions.find((s) => s.type === 'door_order');
  assert.equal(door.date, '2026-10-16'); // 마감 10/21 − 3근무일
});

test('싱크대가 몰리면: 조립 인원 추가를 먼저 추천하고 늦는 건을 줄인다', () => {
  const jobs = [];
  for (let i = 0; i < 12; i++) jobs.push({ id: `s${i}`, label: `싱크대 ${i + 1}`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(SINK_3M) });
  const plan = planProduction({ today: '2026-10-13', jobs });
  assert.ok(plan.summary.lateBefore > 0, '기본 인력으로는 늦어야 한다');
  const kinds = plan.suggestions.map((s) => s.type);
  assert.ok(kinds.includes('asm_extra'), kinds.join(','));
  assert.ok(plan.summary.lateAfter < plan.summary.lateBefore);
  // 조립 추가가 엣지 연장·외주보다 먼저 나온다
  const firstFix = kinds.find((k) => ['asm_extra', 'edge_overtime', 'edge_outsource'].includes(k));
  assert.equal(firstFix, 'asm_extra');
  assert.ok(plan.summary.extraCost > 0);
});

test('엣지 면이 많은 주문이 몰리면: 엣지가 막혀 알바 연장·외주를 추천한다', () => {
  const jobs = [];
  // 면당 20초면 붙박이장 한 건은 1시간 안팎이라 잘 안 막힌다 — 면이 아주 많은 주문 10건으로 막는다
  for (let i = 0; i < 10; i++) jobs.push({ id: `w${i}`, label: `대형 ${i + 1}`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts({ ...WARD_12, edgeFaces: 1400 }) });
  const plan = planProduction({ today: '2026-10-13', jobs });
  const kinds = new Set(plan.suggestions.map((s) => s.type));
  assert.ok(kinds.has('edge_overtime') || kinds.has('edge_outsource'), [...kinds].join(','));
});

test('설치일이 도어 납기보다 가까우면: 도어 발주가 이미 늦었다고 알리고 설치일 조정을 제안한다', () => {
  const plan = planProduction({
    today: '2026-10-13',
    jobs: [{ id: 'x', label: '급한 싱크대', orderedAt: '2026-10-13', installDate: '2026-10-15', work: workloadFromCounts(SINK_3M) }],
  });
  const job = plan.jobs[0];
  assert.equal(job.doorOrderLate, true);
  assert.ok(job.rescheduleTo, '설치일 조정 제안이 있어야 한다');
  assert.ok(plan.suggestions.some((s) => s.type === 'reschedule'));
});

test('설치일이 없으면 주문일 + 7근무일을 마감으로 본다', () => {
  const plan = planProduction({ today: '2026-10-13', jobs: [{ id: 'n', label: '수납장', orderedAt: '2026-10-13', work: workloadFromCounts({ sheetsPB: 3, sheetsBack: 1, boxes: 2, drawers: 0, doors: 4, shelves: 2, legs: 16, rods: 0 }) }] });
  assert.equal(plan.jobs[0].dueSource, 'default');
  assert.equal(plan.jobs[0].due, '2026-10-21');
});

// ── 서비스(순수 부분) · 알림 ──
import { buildJobs, sanitizeSettings, mergeSettings, kstDate } from '../src/production/service.js';
import { buildProposalBlocks, buildInstructionBlocks, assignmentsFromSuggestions } from '../src/production/notify.js';

const SNAP = {
  id: 'snap1',
  bom_payload: { materials: [{ part: '측판', partId: '0-l1-body:side-0', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 }, { part: '도어', material: 'MDF', thickness: 18, w: 450, h: 700, qty: 2 }], hardware: [{ category: '다리발', qty: 4 }] },
  cut_plan_payload: { summary: { sheetsByMaterial: { PB_15: 1, 'MDF_2.7': 1 } } },
};

test('buildJobs: 진행 중 수주만, 설치일은 설계의 가장 이른 설치 일정(취소 제외, KST 날짜)', () => {
  const orders = [
    { id: 'o1', order_no: 'SO-1', customer_name: '김고객', design_id: 'd1', snapshot_id: 'snap1', status: 'confirmed', ordered_at: '2026-10-12T16:30:00Z' },
    { id: 'o2', order_no: 'SO-2', design_id: 'd2', snapshot_id: 'snap1', status: 'completed', ordered_at: '2026-10-01T00:00:00Z' },
    { id: 'o3', order_no: 'SO-3', design_id: 'd3', snapshot_id: 'missing', status: 'in_production', ordered_at: '2026-10-10T00:00:00Z' },
  ];
  const schedules = [
    { design_id: 'd1', type: 'installation', status: 'scheduled', scheduled_at: '2026-10-23T01:00:00Z' },
    { design_id: 'd1', type: 'installation', status: 'cancelled', scheduled_at: '2026-10-20T01:00:00Z' },
    { design_id: 'd1', type: 'installation', status: 'confirmed', scheduled_at: '2026-10-21T23:30:00Z' }, // KST 10/22
  ];
  const { jobs, skipped } = buildJobs(orders, new Map([['snap1', SNAP]]), schedules);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].orderedAt, '2026-10-13'); // UTC 10/12 16:30 = KST 10/13 01:30
  assert.equal(jobs[0].installDate, '2026-10-22');
  assert.equal(jobs[0].label, '김고객 (SO-1)');
  assert.equal(jobs[0].work.counts.boxes, 1);
  assert.deepEqual(skipped.map((s) => s.reason), ['BOM 없음']);
});

test('설정: 아는 키·숫자·범위만 받는다, 빠진 키는 기본값', () => {
  const clean = sanitizeSettings({ standards: { asmPerBox: 600 }, crew: { util: 0.8 }, holidays: ['2026-10-09'] });
  assert.deepEqual(clean, { standards: { asmPerBox: 600 }, crew: { util: 0.8 }, holidays: ['2026-10-09'] });
  assert.throws(() => sanitizeSettings({ standards: { nope: 1 } }), /알 수 없는 설정/);
  assert.throws(() => sanitizeSettings({ crew: { util: 1.5 } }), /범위/);
  assert.throws(() => sanitizeSettings({ holidays: ['10/9'] }), /형식/);
  const m = mergeSettings(clean);
  assert.equal(m.standards.asmPerBox, 600);
  assert.equal(m.standards.cutPerSheet, 420);
  assert.equal(m.crew.util, 0.8);
  assert.equal(kstDate('2026-10-12T15:00:00Z'), '2026-10-13');
});

test('알림: 제안 메시지에 승인 링크·추가 비용, 지시는 날짜별로 묶는다', () => {
  const jobs = [];
  for (let i = 0; i < 12; i++) jobs.push({ id: `s${i}`, label: `싱크대 ${i + 1}`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(SINK_3M) });
  const plan = planProduction({ today: '2026-10-13', jobs });
  const msg = buildProposalBlocks({ plan, link: 'https://x/production.html?p=1', triggerLabel: '새 수주' });
  const json = JSON.stringify(msg);
  assert.ok(json.includes('production.html?p=1'));
  assert.ok(json.includes('조립 인원 추가'));
  const rows = assignmentsFromSuggestions(plan.suggestions, { userId: 'u', proposalId: 'p', jobLabels: { s0: '싱크대 1' } });
  const call = plan.suggestions.find((s) => s.type === 'asm_call');
  assert.equal(rows.filter((r) => r.kind === 'asm_call').length, call.dates.length); // 출근일마다 한 행
  assert.ok(rows.every((r) => r.text.length <= 500));
  const inst = buildInstructionBlocks({ assignments: rows.filter((r) => r.work_date) });
  assert.equal(inst.blocks[0].type, 'header');
  assert.ok(inst.blocks.length <= 50);
});

// ── 재계산 · 아침 요약 ──
import { buildDailyBlocks, actionKey } from '../src/production/notify.js';

test('아침 요약: 오늘 부하·오늘 지시·오늘/내일 도어 발주 마감·늦어질 주문을 담는다', () => {
  const jobs = [
    { id: 'a', label: '여유 고객', orderedAt: '2026-10-13', installDate: '2026-10-27', work: workloadFromCounts(SINK_3M) },
    { id: 'b', label: '급한 고객', orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(SINK_3M) },
  ];
  const plan = planProduction({ today: '2026-10-14', jobs });
  const msg = buildDailyBlocks({ plan, assignments: [{ text: '조립 기사 출근 (10/14(수))' }], today: '2026-10-14' });
  const json = JSON.stringify(msg);
  assert.ok(json.includes('10/14(수)'));
  assert.ok(json.includes('오늘 지시'));
  assert.ok(json.includes('급한 고객: 도어 발주'), json); // 마감 10/19 − 3근무일 = 10/14 → 오늘
  assert.ok(!json.includes('여유 고객: 도어 발주'));
  for (const b of msg.blocks) if (b.text && b.text.text) assert.ok(b.text.text.length <= 2900);
});

test('비교 키: 출근일·도어 발주가 바뀌어도 손쓸 추천이 같으면 같은 키 (매일 같은 제안을 다시 보내지 않는다)', () => {
  const a = [{ type: 'asm_call', dates: ['2026-10-14'] }, { type: 'asm_extra', date: '2026-10-15', jobId: 'x' }, { type: 'door_order', date: '2026-10-14', jobId: 'x' }];
  const b = [{ type: 'door_order', date: '2026-10-15', jobId: 'x' }, { type: 'asm_extra', date: '2026-10-15', jobId: 'x', cost: 1 }, { type: 'asm_call', dates: ['2026-10-15'] }];
  assert.equal(actionKey(a), actionKey(b));
  assert.notEqual(actionKey(a), actionKey([{ type: 'asm_extra', date: '2026-10-16', jobId: 'x' }]));
  assert.equal(actionKey([]), actionKey(null));
});

// ── 작업자 화면 · 실측 · 보정 ──
import { calibrate, calibrationPatch } from '../src/production/calibration.js';
import { todaysWork, validateWorklog } from '../src/production/worker-access.js';
import { DEFAULT_STANDARDS } from '../src/production/standards.js';

test('보정: 공정별 1단위 실측 초를 내고, 표본이 10단위 미만이면 제안하지 않는다', () => {
  const logs = [
    { role: 'cutter', units: 7, minutes: 56 }, // 8분/장
    { role: 'cutter', units: 8, minutes: 64 },
    { role: 'edge', units: 4, minutes: 70 }, // 표본 부족
    { role: 'asm', units: 10, minutes: 100 }, // 10분/통
    { role: 'asm', units: 0, minutes: 5 }, // 무시
  ];
  const r = calibrate(logs, DEFAULT_STANDARDS);
  const by = Object.fromEntries(r.map((x) => [x.role, x]));
  assert.equal(by.cutter.measured, 480);
  assert.equal(by.cutter.suggested, 480);
  assert.equal(by.cutter.diffPct, 14); // 420 → 480
  assert.equal(by.edge.enough, false);
  assert.equal(by.edge.suggested, null);
  assert.equal(by.asm.suggested, 600);
  assert.equal(by.asm.records, 1);
  // 조립 보정은 통·서랍 둘 다에 들어간다, 엣지는 표본 부족이라 빠진다
  assert.deepEqual(calibrationPatch(r), { standards: { cutPerSheet: 480, asmPerBox: 600, asmPerDrawer: 600 } });
  assert.deepEqual(calibrationPatch(r, ['asm']), { standards: { asmPerBox: 600, asmPerDrawer: 600 } });
});

test('작업자 할 일: 진행 중 주문을 모두 담고 오늘 예정을 앞에 — 오늘 예정이 없어도 화면이 비지 않는다', () => {
  const plan = planProduction({
    today: '2026-10-13',
    jobs: [
      { id: 'a', label: '싱크대 A', orderedAt: '2026-10-13', installDate: '2026-10-22', work: workloadFromCounts(SINK_3M) },
      { id: 'b', label: '나중 주문', orderedAt: '2026-10-20', installDate: '2026-10-28', work: workloadFromCounts(SINK_3M) },
    ],
  });
  const a = plan.jobs.find((j) => j.id === 'a');
  assert.equal(a.stages.cutter[0], '2026-10-13');
  assert.equal(a.counts.boxes, 8);
  const w = todaysWork(plan, '2026-10-13');
  assert.deepEqual(w.cutter.map((x) => [x.label, x.units, x.today]), [['싱크대 A', 7, true], ['나중 주문', 7, false]]);
  assert.equal(w.cutter[1].plannedStart, '2026-10-20');
  assert.deepEqual(w.edge.map((x) => [x.label, x.units, x.today]), [['싱크대 A', 112, true], ['나중 주문', 112, false]]);
  // 도어 도착(10/16) 뒤까지 조립 기간이 이어진다
  const w16 = todaysWork(plan, '2026-10-16');
  assert.deepEqual(w16.asm.filter((x) => x.today).map((x) => [x.label, x.units]), [['싱크대 A', 10]]); // 통 8 + 서랍 2
  assert.equal(w16.asm.length, 2);
  // 외주로 돌린 엣지는 엣지 목록에서 뺀다
  const out = todaysWork({ jobs: [{ ...a, outsourced: true }] }, '2026-10-13');
  assert.equal(out.edge.length, 0);
  assert.equal(out.asm.length, 1);
});

test('실측 기록 검증: 공정·수량·분 범위', () => {
  assert.deepEqual(validateWorklog({ role: 'edge', units: '5', minutes: 76.456, order_label: 'x' }), { role: 'edge', units: 5, minutes: 76.46, order_id: null, order_label: 'x', note: null });
  assert.throws(() => validateWorklog({ role: 'paint', units: 1, minutes: 1 }), /role/);
  assert.throws(() => validateWorklog({ role: 'asm', units: 0, minutes: 1 }), /수량/);
  assert.throws(() => validateWorklog({ role: 'asm', units: 1, minutes: 2000 }), /시간/);
});

// ── 월 손익 요약 ──
import { summarizeMonth } from '../src/production/service.js';

test('월 손익: 그 달(KST) 수주만, 매출 = 계약 ÷ 1.1, 지출 = 스냅샷 원가, 간접비를 빼 최종 손익', () => {
  const orders = [
    { id: 'a', order_no: 'SO-1', customer_name: '김', snapshot_id: 's1', status: 'confirmed', contract_amount: 2200000, ordered_at: '2026-09-30T16:00:00Z' }, // KST 10/1
    { id: 'b', order_no: 'SO-2', snapshot_id: 's2', status: 'completed', contract_amount: 1210000, ordered_at: '2026-10-15T01:00:00Z' },
    { id: 'c', order_no: 'SO-3', snapshot_id: 's3', status: 'confirmed', contract_amount: 1100000, ordered_at: '2026-10-20T01:00:00Z' }, // 옛 스냅샷(원가 없음)
    { id: 'd', order_no: 'SO-4', snapshot_id: 's1', status: 'cancelled', contract_amount: 9999999, ordered_at: '2026-10-21T01:00:00Z' },
    { id: 'e', order_no: 'SO-5', snapshot_id: 's1', status: 'confirmed', contract_amount: 5000000, ordered_at: '2026-09-30T14:00:00Z' }, // KST 9/30
  ];
  const snaps = new Map([
    ['s1', { quote_payload: { total: 2200000, cost: { total: 1500000 }, partner: { total: 2000000 } } }],
    ['s2', { quote_payload: { total: 1320000, cost: { total: 1000000 }, partner: { total: 1210000 } } }],
    ['s3', { quote_payload: { total: 1100000 } }],
  ]);
  const m = summarizeMonth(orders, snaps, { month: '2026-10', overheadMonthly: 3800000 });
  assert.deepEqual(m.rows.map((r) => r.order_no), ['SO-1', 'SO-2', 'SO-3']);
  assert.deepEqual(m.rows.map((r) => r.tier), ['customer', 'partner', 'customer']);
  assert.equal(m.totals.revenue, 2000000 + 1100000 + 1000000);
  assert.equal(m.totals.unknownCost, 1);
  assert.equal(m.totals.cost, 2500000);
  assert.equal(m.totals.gross, 3100000 - 2500000); // 원가를 아는 건만
  assert.equal(m.totals.net, 600000 - 3800000);
  assert.equal(m.totals.shortfall, 3200000);
});

test('보정: 엣지 기록은 면 단위가 된 날(2026-10-18)부터만 쓴다 — 그 전 기록은 PB 장 단위', () => {
  const logs = [
    { role: 'edge', units: 20, minutes: 300, work_date: '2026-10-15' }, // 옛 PB 장 단위
    { role: 'edge', units: 120, minutes: 30, work_date: '2026-10-19' },
  ];
  const e = calibrate(logs, { cutPerSheet: 420, edgePerFace: 20, asmPerBox: 720 }).find((r) => r.role === 'edge');
  assert.deepEqual([e.records, e.units, e.measured, e.suggested, e.label], [1, 120, 15, 20, '엣지 (부재 1면)']);
});
