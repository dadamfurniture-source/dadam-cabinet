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
import { countWork, workloadFromCounts, workloadFromSnapshot } from '../src/production/workload.js';
import { planProduction, workdays, dayLabel } from '../src/production/planner.js';

const SINK_3M = { sheetsPB: 5, sheetsBack: 2, boxes: 8, drawers: 2, doors: 11, shelves: 10, legs: 22, rods: 0 };
const WARD_12 = { sheetsPB: 14, sheetsBack: 5, boxes: 4, drawers: 3, doors: 10, shelves: 7, legs: 0, rods: 15 };

test('작업량: 싱크대 3m (8통) 은 재단 4,140 · 엣지 4,500 · 조립 11,885초', () => {
  const w = workloadFromCounts(SINK_3M);
  assert.equal(w.cutter, 1200 + 7 * 420);
  assert.equal(w.edge, 5 * 900);
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
});

test('작업 수: cutPlan 이 있으면 원판 장수는 재단 배치 요약을 따른다 (도어 MDF 18T 는 외주라 제외)', () => {
  const c = countWork({ materials: [], hardware: [] }, { summary: { sheetsByMaterial: { PB_15: 6, 'MDF_2.7': 3, MDF_18: 2 } } });
  assert.deepEqual([c.sheetsPB, c.sheetsBack, c.sheetSource], [6, 3, 'cutPlan']);
  const w = workloadFromSnapshot({ bom_payload: { materials: [], hardware: [] }, cut_plan_payload: { summary: { sheetsByMaterial: { PB_18: 2 } } } });
  assert.equal(w.edge, 2 * 900);
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

test('붙박이장이 몰리면: 엣지가 막혀 알바 연장·외주를 추천한다', () => {
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push({ id: `w${i}`, label: `붙박이장 ${i + 1}`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(WARD_12) });
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
