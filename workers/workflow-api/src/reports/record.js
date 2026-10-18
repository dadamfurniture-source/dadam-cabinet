/**
 * 작업 지시 보고 — 보고 행 빌더 (순수). docs/01-plan/work-reports-archive.plan.md §2 · §3.
 *
 * 보고가 생기는 순간의 원천(생산 제안 · 승인 · 아침 요약 · 문서 발행 …)을 받아 `work_reports` 한 행을 만든다.
 * 행의 metrics 는 목록에 그대로 보이는 숫자, body 는 동결 본문이다 (작업지시서는 원본 문서를 가리키기만 한다).
 */

import { dayLabel } from '../production/planner.js';

export const REPORT_KINDS = Object.freeze([
  'production_plan', 'staffing_decision', 'daily_brief', 'work_order', 'installation_order',
  'outsource_order', 'countertop_order', 'monthly_close', 'note',
]);

export const KIND_LABEL = Object.freeze({
  production_plan: '생산 계획 · 인력 추천',
  staffing_decision: '인력 승인',
  daily_brief: '아침 생산 요약',
  work_order: '작업지시서',
  installation_order: '설치 지시서',
  outsource_order: '외주 발주',
  countertop_order: '상판 발주 요청서',
  monthly_close: '월 생산 마감',
  note: '메모',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

/** ISO 시각 → KST 날짜 'YYYY-MM-DD'. */
export function kstDay(iso) {
  const t = iso ? new Date(iso) : new Date();
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
const pct = (part, cap) => (part && cap > 0 ? Math.round((part.load / cap) * 100) : null);
const clip = (s, n = 300) => String(s || '').slice(0, n);

/** 날짜 문자열 배열 → [가장 이른, 가장 늦은] */
function span(dates, fallback) {
  const d = (dates || []).filter(Boolean).sort();
  return d.length ? [d[0], d[d.length - 1]] : [fallback, fallback];
}

/** 생산 계획 제안 (production_proposals 한 행) → production_plan 보고. */
export function reportFromProposal(row) {
  const plan = (row && row.plan) || {};
  const days = Array.isArray(plan.days) ? plan.days : [];
  const jobs = Array.isArray(plan.jobs) ? plan.jobs : [];
  const sugg = Array.isArray(plan.suggestions) ? plan.suggestions : [];
  const s = plan.summary || {};
  const created = kstDay(row.created_at);
  const [from, to] = span(days.map((d) => d.date), created);
  const why = plan.triggerLabel || (row.trigger === 'order_created' ? '새 수주' : '다시 계산');
  return {
    owner_id: row.user_id,
    kind: 'production_plan',
    title: clip(`생산 계획 — ${why}`),
    period_start: from,
    period_end: to,
    status: row.status || 'pending',
    source_table: 'production_proposals',
    source_id: row.id,
    order_ids: uniq(jobs.map((j) => j.id)).filter(isUuid),
    design_ids: [],
    metrics: {
      jobs: s.jobs ?? jobs.length,
      lateBefore: s.lateBefore ?? null,
      lateAfter: s.lateAfter ?? null,
      needsReschedule: s.needsReschedule ?? 0,
      extraCost: s.extraCost ?? 0,
      suggestions: sugg.length,
    },
    body: { plan, trigger: row.trigger || null, trigger_order_id: row.trigger_order_id || null, slack_status: row.slack_status || null },
  };
}

/**
 * 승인 · 무시 → staffing_decision 보고. 예전엔 고른 추천(selected)과 승인자가 남지 않았다.
 * @param {Object} row   제안 행
 * @param {Object} d     { decision: 'approve'|'dismiss', selected: number[]|null, chosen: [], assignments: [], deciderId, decidedAt }
 */
export function reportFromDecision(row, d) {
  const plan = (row && row.plan) || {};
  const approved = d.decision === 'approve';
  const chosen = Array.isArray(d.chosen) ? d.chosen : [];
  const assignments = Array.isArray(d.assignments) ? d.assignments : [];
  const decidedDay = kstDay(d.decidedAt);
  const [from, to] = span(assignments.map((a) => a.work_date), decidedDay);
  const head = chosen.filter((x) => x.type !== 'asm_call').slice(0, 2).map((x) => x.text).join(' · ');
  const title = approved
    ? `인력 승인 — ${head || `지시 ${assignments.length}건`}${chosen.length > 2 ? ` 외 ${chosen.length - 2}` : ''}`
    : `인력 추천 무시 — ${plan.triggerLabel || '생산 계획'}`;
  return {
    owner_id: row.user_id,
    kind: 'staffing_decision',
    title: clip(title),
    period_start: from,
    period_end: to,
    status: approved ? 'approved' : 'dismissed',
    source_table: 'production_proposals',
    source_id: row.id,
    order_ids: uniq(chosen.map((x) => x.jobId)).filter(isUuid),
    design_ids: [],
    metrics: {
      assignments: assignments.length,
      cost: assignments.reduce((t, a) => t + (Number(a.cost) || 0), 0),
      suggestions: chosen.length,
    },
    body: {
      decision: approved ? 'approve' : 'dismiss',
      selected: Array.isArray(d.selected) ? d.selected : null,
      chosen,
      assignments: assignments.map((a) => ({
        id: a.id || null, work_date: a.work_date || null, kind: a.kind, role: a.role || null,
        people: a.people ?? null, hours: a.hours ?? null, order_label: a.order_label || null, text: a.text, cost: Number(a.cost) || 0,
      })),
      proposal_summary: plan.summary || null,
      reconstructed: Boolean(d.reconstructed),
    },
    created_by: d.deciderId || null,
  };
}

/** 아침 07시 요약 → daily_brief 보고 (Slack 원문 블록까지). */
export function reportFromDailyBrief({ ownerId, day, plan, todays, blocks, sent, workersSent }) {
  const d0 = (plan && plan.days && plan.days[0]) || null;
  const jobs = (plan && plan.jobs) || [];
  const s = (plan && plan.summary) || {};
  const late = jobs.filter((j) => j.late || j.rescheduleTo);
  return {
    owner_id: ownerId,
    kind: 'daily_brief',
    title: clip(`아침 생산 요약 — ${dayLabel(day)}`),
    period_start: day,
    period_end: day,
    status: sent ? 'sent' : 'failed',
    source_table: null,
    source_id: null,
    order_ids: uniq(jobs.map((j) => j.id)).filter(isUuid),
    design_ids: [],
    metrics: {
      cut: d0 ? pct(d0.cut, d0.cut.cap) : null,
      edge: d0 ? pct(d0.edge, d0.edge.cap) : null,
      asm: d0 ? pct(d0.asm, d0.asm.cap) : null,
      asmPeople: d0 && d0.asm ? d0.asm.people || 0 : 0,
      todays: (todays || []).length,
      late: s.lateBefore ?? late.length,
      jobs: s.jobs ?? jobs.length,
    },
    body: {
      day: d0,
      jobs: jobs.map((j) => ({
        id: j.id, label: j.label, due: j.due || null, finish: j.finish || null, late: Boolean(j.late),
        rescheduleTo: j.rescheduleTo || null, doorOrderBy: j.doorOrdered ? null : j.doorOrderBy || null, doorOrderLate: Boolean(j.doorOrderLate),
      })),
      todays: (todays || []).map((a) => ({ id: a.id, work_date: a.work_date, kind: a.kind, text: a.text, status: a.status })),
      slack: { owner: Boolean(sent), workers: workersSent === undefined ? null : workersSent, blocks: blocks || null },
    },
  };
}

/** 작업지시서 · 설치 지시서 발행 → 색인 보고 (본문은 design_documents.render_payload 에 동결돼 있다). */
export function reportFromDocument(doc, { ownerId, orderIds = [] } = {}) {
  const kind = doc && (doc.doc_type === 'work_order' || doc.doc_type === 'installation_order') ? doc.doc_type : null;
  if (!kind) return null;
  const t = doc.totals || {};
  const day = kstDay(doc.created_at);
  return {
    owner_id: ownerId,
    kind,
    title: clip(`${KIND_LABEL[kind]} ${doc.doc_no} — ${doc.title || '무제 설계'}`),
    period_start: day,
    period_end: day,
    status: doc.status || 'issued',
    source_table: 'design_documents',
    source_id: doc.id,
    order_ids: uniq(orderIds).filter(isUuid),
    design_ids: uniq([doc.design_id]).filter(isUuid),
    metrics: kind === 'work_order'
      ? { rev: doc.rev ?? null, sheets: t.sheet_count ?? null, labels: t.label_count ?? null }
      : { rev: doc.rev ?? null },
    body: {
      document_id: doc.id, doc_no: doc.doc_no, doc_type: kind, rev: doc.rev ?? null,
      design_id: doc.design_id, snapshot_id: doc.snapshot_id || null, title: doc.title || null,
    },
  };
}

/** 'YYYY-MM' → 그 달 마지막 날 'YYYY-MM-DD' */
export function monthEnd(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * 월 생산 마감 → monthly_close 보고 (매월 첫 근무일 아침, 사장님 결정 Q4).
 * @param {Object} summary      production/service.js summarizeMonth 결과 { month, rows, totals }
 * @param {Array}  assignments  그 달 work_date 의 지시 (status instructed/done/cancelled)
 */
export function reportFromMonth({ ownerId, summary, assignments = [] }) {
  const month = summary.month;
  const [y, m] = month.split('-').map(Number);
  const t = summary.totals || {};
  const live = assignments.filter((a) => a.status !== 'cancelled');
  const done = live.filter((a) => a.status === 'done').length;
  const completion = live.length ? Math.round((done / live.length) * 1000) / 10 : null;
  return {
    owner_id: ownerId,
    kind: 'monthly_close',
    title: clip(`월 생산 마감 — ${y}년 ${m}월`),
    period_start: `${month}-01`,
    period_end: monthEnd(month),
    status: null,
    source_table: null,
    source_id: null,
    order_ids: uniq((summary.rows || []).map((r) => r.id)).filter(isUuid),
    design_ids: [],
    metrics: {
      orders: t.orders ?? 0,
      revenue: t.revenue ?? 0,
      cost: t.cost ?? 0,
      gross: t.gross ?? 0,
      overhead: t.overhead ?? 0,
      net: t.net ?? 0,
      unknownCost: t.unknownCost ?? 0,
      assignments: live.length,
      completion,
      extraCost: live.reduce((s, a) => s + (Number(a.cost) || 0), 0),
    },
    body: { summary, completion: { total: live.length, done, rate: completion } },
  };
}

export const OUTSOURCE_PACKS = Object.freeze({
  door: { label: '도어재', vendorKey: 'door' },
  'cut-vendor': { label: '재단·엣지', vendorKey: 'cutEdge' },
  // 상판은 재질마다 업체가 다르다 — 업체 키는 재질에서 (countertop.js TOP_VENDOR_KEY). 보고 종류도 따로 (상판 발주 요청서)
  top: { label: '상판', vendorKey: null, kind: 'countertop_order' },
});

/** 외주 수량 한 줄 — 목록 · 인쇄 · Step 4 가 같이 쓴다. */
export function outsourceQtyText(pack, q = {}) {
  if (pack === 'door') {
    return [q.doorSheets != null ? `원장 ${q.doorSheets}장` : null, q.doors ? `도어 ${q.doors}짝` : null, q.doorParts ? `부재 ${q.doorParts}장` : null].filter(Boolean).join(' · ');
  }
  if (pack === 'cut-vendor') {
    return [q.sheets != null ? `원판 ${q.sheets}장` : null, q.edgeM ? `엣지 ${q.edgeM}m` : null, q.parts ? `부재 ${q.parts}장` : null].filter(Boolean).join(' · ');
  }
  if (pack === 'top') {
    return [q.material ? `${q.material} ${q.thickness}T` : null, q.pieces ? `${q.pieces}장` : null, q.lengthMm ? `길이 ${q.lengthMm}` : null, q.cutouts ? `타공 ${q.cutouts}` : null].filter(Boolean).join(' · ');
  }
  return '';
}

/**
 * [발주 처리] → outsource_order 보고 (상태 ordered → received / cancelled).
 * 한 문서에 꾸러미별로 여러 번 생길 수 있어 source_id 는 비우고 body.document_id 로 가리킨다.
 */
export function reportFromOutsource({ ownerId, doc, pack, vendor, orderedOn, expectedOn, quantities = {}, orderIds = [], note, createdBy }) {
  const p = OUTSOURCE_PACKS[pack];
  const qty = outsourceQtyText(pack, quantities);
  return {
    owner_id: ownerId,
    kind: (p && p.kind) || 'outsource_order',
    title: clip(`${pack === 'top' ? '상판 발주' : '외주 발주'} — ${p ? p.label : pack} · ${vendor} · ${doc.doc_no}`),
    period_start: orderedOn,
    period_end: expectedOn || orderedOn,
    status: 'ordered',
    source_table: 'design_documents',
    source_id: null,
    order_ids: uniq(orderIds).filter(isUuid),
    design_ids: uniq([doc.design_id]).filter(isUuid),
    metrics: { ...quantities, pack, vendor, expected: expectedOn || null, qty },
    body: {
      document_id: doc.id, doc_no: doc.doc_no, rev: doc.rev ?? null, title: doc.title || null, pack,
      vendor, ordered_on: orderedOn, expected_on: expectedOn || null, quantities,
    },
    note: note ? clip(note, 4000) : null,
    created_by: createdBy || null,
  };
}

/** 관리자 메모 보고. */
export function reportNote({ ownerId, title, note, createdBy }) {
  const day = kstDay();
  return {
    owner_id: ownerId,
    kind: 'note',
    title: clip(String(title || '').trim() || '메모'),
    period_start: day,
    period_end: day,
    status: null,
    source_table: null,
    source_id: null,
    order_ids: [],
    design_ids: [],
    metrics: {},
    body: {},
    note: clip(note, 4000),
    created_by: createdBy || null,
  };
}
