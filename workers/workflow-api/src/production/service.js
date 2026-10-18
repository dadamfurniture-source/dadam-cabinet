/**
 * 생산 계획 서비스 — DB 를 읽어 planner 를 돌리고, 제안·지시를 저장·알린다.
 *
 * 흐름 (대표 확정 2026-10-13):
 *   주문 생성 → proposePlan(trigger='order_created') → 대표 Slack 에 추천 + 승인 링크
 *   대표가 production.html 에서 승인 → decideProposal → 지시 저장 + 작업자 Slack
 *
 * 계획 대상 = 진행 중인 수주(confirmed · in_production). 각 수주는 계약 시점 스냅샷의
 * BOM·재단 배치로 작업량을 세고, 같은 설계의 설치 일정(installation)으로 마감을 잡는다.
 */

import { selectOne, selectMany, insertOne, insertMany, updateById, updateBy, upsertOne, ValidationError, NotFoundError, ConflictError } from '../supabase.js';
import { postToWebhook } from '../slack.js';
import { listOrders } from '../orders.js';
import { workloadFromSnapshot } from './workload.js';
import { planProduction } from './planner.js';
import { buildProposalBlocks, buildInstructionBlocks, buildDailyBlocks, assignmentsFromSuggestions, actionKey } from './notify.js';
import { DEFAULT_STANDARDS, DEFAULT_CREW, DEFAULT_COSTS, DEFAULT_LEADS, DEFAULT_QUOTE, DEFAULT_VENDORS } from './standards.js';
import { safeRecord, safeSyncStatus } from '../reports/service.js';
import { reportFromProposal, reportFromDecision, reportFromDailyBrief, reportFromMonth, monthEnd } from '../reports/record.js';

const ACTIVE = new Set(['confirmed', 'in_production']);
const KST_MS = 9 * 3600 * 1000;

/** UTC ISO → KST 날짜 (YYYY-MM-DD) */
export function kstDate(iso) {
  const t = iso ? new Date(iso).getTime() : Date.now();
  return new Date(t + KST_MS).toISOString().slice(0, 10);
}

// ── 설정 ──
const NUMERIC_LIMITS = {
  standards: [0, 36000],
  crew: [0, 24],
  costs: [0, 10000000],
  leads: [0, 60],
  quote: [0, 100000000],
};

/** 저장값 중 지금 아는 키만 — 없어진 키(예: 엣지 PB 장당 edgePerPbSheet)가 남아 설정 저장을 막지 않게. */
function known(def, saved) {
  const out = { ...def };
  for (const [k, v] of Object.entries(saved || {})) if (k in def) out[k] = v;
  return out;
}

export function mergeSettings(saved) {
  const s = saved || {};
  return {
    standards: known(DEFAULT_STANDARDS, s.standards),
    crew: known(DEFAULT_CREW, s.crew),
    costs: known(DEFAULT_COSTS, s.costs),
    leads: known(DEFAULT_LEADS, s.leads),
    quote: known(DEFAULT_QUOTE, s.quote),
    vendors: known(DEFAULT_VENDORS, s.vendors),
    holidays: Array.isArray(s.holidays) ? s.holidays : [],
  };
}

/** 저장 전 검증 — 아는 키만, 숫자만, 범위 안만. */
export function sanitizeSettings(body) {
  const out = {};
  const defaults = { standards: DEFAULT_STANDARDS, crew: DEFAULT_CREW, costs: DEFAULT_COSTS, leads: DEFAULT_LEADS, quote: DEFAULT_QUOTE };
  for (const [group, def] of Object.entries(defaults)) {
    if (!body || body[group] === undefined) continue;
    if (typeof body[group] !== 'object' || body[group] === null) throw new ValidationError(`${group} 는 객체여야 합니다`);
    out[group] = {};
    for (const [k, v] of Object.entries(body[group])) {
      if (!(k in def)) throw new ValidationError(`알 수 없는 설정: ${group}.${k}`);
      if (group === 'quote' && k === 'sheetBasis') {
        if (v !== 'area' && v !== 'nested') throw new ValidationError("quote.sheetBasis 는 'area' 또는 'nested' 여야 합니다");
        out[group][k] = v;
        continue;
      }
      const n = Number(v);
      const [lo, hi] = NUMERIC_LIMITS[group];
      // util 은 비율(0~1)
      const max = (group === 'crew' && k === 'util') || (group === 'quote' && ['marginRate', 'partnerMarginRate', 'pbYield', 'doorYield'].includes(k)) ? 1 : hi;
      if (!Number.isFinite(n) || n < lo || n > max) throw new ValidationError(`${group}.${k} 값이 범위를 벗어났습니다`);
      out[group][k] = n;
    }
  }
  if (body && body.vendors !== undefined) {
    if (typeof body.vendors !== 'object' || body.vendors === null) throw new ValidationError('vendors 는 객체여야 합니다');
    out.vendors = {};
    for (const [k, v] of Object.entries(body.vendors)) {
      if (!(k in DEFAULT_VENDORS)) throw new ValidationError(`알 수 없는 설정: vendors.${k}`);
      const name = String(v == null ? '' : v).trim();
      if (!name || name.length > 40) throw new ValidationError(`vendors.${k} 는 1~40자 업체 이름이어야 합니다`);
      out.vendors[k] = name;
    }
  }
  if (body && body.holidays !== undefined) {
    if (!Array.isArray(body.holidays) || body.holidays.length > 100) throw new ValidationError('holidays 는 100개 이하 날짜 배열이어야 합니다');
    out.holidays = body.holidays.map((h) => {
      const s = String(h).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`공휴일 날짜 형식이 아닙니다: ${h}`);
      return s;
    });
  }
  return out;
}

export async function getSettings(env, { user }) {
  const row = await selectOne(env, 'production_settings', { user_id: `eq.${user.id}`, select: 'settings,updated_at' });
  return { settings: mergeSettings(row && row.settings), saved: row ? row.settings : null, updated_at: row ? row.updated_at : null };
}

export async function saveSettings(env, { user, body }) {
  const clean = sanitizeSettings(body);
  const row = await upsertOne(env, 'production_settings', { user_id: user.id, settings: clean, updated_at: new Date().toISOString() }, 'user_id');
  return { settings: mergeSettings(row && row.settings), saved: clean };
}

// ── 계획 입력 ──
/**
 * 수주 · 스냅샷 · 설치 일정 → planner jobs (순수).
 * 설치 일정은 설계당 가장 이른, 취소되지 않은 것.
 */
export function buildJobs(orders, snapshotsById, schedules, standards, doorOrdered = new Set()) {
  const installByDesign = new Map();
  for (const s of schedules || []) {
    if (s.type !== 'installation' || s.status === 'cancelled') continue;
    const d = kstDate(s.scheduled_at);
    const cur = installByDesign.get(s.design_id);
    if (!cur || d < cur) installByDesign.set(s.design_id, d);
  }
  const jobs = [];
  const skipped = [];
  for (const o of orders) {
    if (!ACTIVE.has(o.status)) continue;
    const snap = snapshotsById.get(o.snapshot_id);
    if (!snap || !snap.bom_payload) { skipped.push({ id: o.id, label: o.customer_name || o.order_no, reason: 'BOM 없음' }); continue; }
    const work = workloadFromSnapshot(snap, standards);
    if (work.cutter + work.edge + work.asm <= 0) { skipped.push({ id: o.id, label: o.customer_name || o.order_no, reason: '작업량 0' }); continue; }
    jobs.push({
      id: o.id,
      label: o.customer_name ? `${o.customer_name} (${o.order_no})` : o.order_no,
      orderedAt: kstDate(o.ordered_at),
      installDate: installByDesign.get(o.design_id) || null,
      work,
      doorOrdered: doorOrdered.has(o.id),
    });
  }
  return { jobs, skipped };
}

async function loadInputs(env, user) {
  const orders = (await listOrders(env, { user })).filter((o) => ACTIVE.has(o.status));
  if (!orders.length) return { orders, snapshotsById: new Map(), schedules: [] };
  const snapIds = [...new Set(orders.map((o) => o.snapshot_id))].join(',');
  const designIds = [...new Set(orders.map((o) => o.design_id))].join(',');
  const snaps = (await selectMany(env, 'design_snapshots', { id: `in.(${snapIds})`, select: 'id,bom_payload,cut_plan_payload', limit: '200' })) || [];
  const schedules = (await selectMany(env, 'design_schedules', {
    design_id: `in.(${designIds})`,
    type: 'eq.installation',
    select: 'design_id,type,status,scheduled_at',
    limit: '500',
  })) || [];
  return { orders, snapshotsById: new Map(snaps.map((s) => [s.id, s])), schedules, doorOrdered: await doorOrderedIds(env, user.id) };
}

/** 도어재 [발주 처리] 가 된 주문 — 계획의 '도어 발주 마감' 추천 · 아침 경고에서 뺀다 (보관함 §2.1). 표가 없으면 빈 집합. */
export async function doorOrderedIds(env, userId) {
  try {
    const rows = (await selectMany(env, 'work_reports', {
      owner_id: `eq.${userId}`,
      kind: 'eq.outsource_order',
      status: 'in.(ordered,received)',
      'metrics->>pack': 'eq.door',
      select: 'order_ids',
      limit: '1000',
    })) || [];
    return new Set(rows.flatMap((r) => r.order_ids || []));
  } catch (e) {
    console.warn('door ordered lookup failed:', e && e.message);
    return new Set();
  }
}

export async function computePlan(env, { user, today }) {
  const { settings } = await getSettings(env, { user });
  const { orders, snapshotsById, schedules, doorOrdered } = await loadInputs(env, user);
  const { jobs, skipped } = buildJobs(orders, snapshotsById, schedules, settings.standards, doorOrdered);
  const plan = planProduction({
    today: today || kstDate(),
    jobs,
    crew: settings.crew,
    costs: settings.costs,
    leads: settings.leads,
    holidays: settings.holidays,
  });
  return { ...plan, skipped, settings };
}

// ── 제안 · 승인 ──
function proposalLink(env, id) {
  const base = String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/production.html?p=${encodeURIComponent(id)}` : null;
}

/**
 * 계획을 다시 돌려 제안으로 저장하고 대표 Slack 에 알린다.
 * Slack 실패는 제안 저장을 되돌리지 않는다 (slack_status 에 사유만 남긴다).
 */
export async function proposePlan(env, { user, trigger = 'manual', orderId = null, triggerLabel = null }) {
  const plan = await computePlan(env, { user });
  await updateBy(env, 'production_proposals', { user_id: `eq.${user.id}`, status: 'eq.pending' }, { status: 'superseded' });
  // 보관함: 이전 결정 전 제안 보고도 '대체됨' 으로 (실패해도 계속)
  await safeSyncStatus(env, { kind: 'eq.production_plan', owner_id: `eq.${user.id}`, status: 'eq.pending' }, 'superseded');
  const row = await insertOne(env, 'production_proposals', {
    user_id: user.id,
    trigger,
    trigger_order_id: orderId,
    plan: { days: plan.days, jobs: plan.jobs, suggestions: plan.suggestions, summary: plan.summary, skipped: plan.skipped, triggerLabel },
    status: 'pending',
  });
  const payload = buildProposalBlocks({ plan, link: proposalLink(env, row.id), triggerLabel });
  const sent = await postToWebhook(env, payload);
  const slackStatus = sent.ok ? 'sent' : `failed: ${sent.error || ''}`.slice(0, 300);
  await updateById(env, 'production_proposals', row.id, { slack_status: slackStatus });
  // 보관함: 생산 계획 보고 (그때의 계획을 동결)
  await safeRecord(env, reportFromProposal({ ...row, slack_status: slackStatus }));
  return { proposal: { ...row, slack_status: sent.ok ? 'sent' : 'failed' }, plan };
}

async function loadOwnedProposal(env, user, id) {
  const row = await selectOne(env, 'production_proposals', { id: `eq.${id}`, select: '*' });
  if (!row || row.user_id !== user.id) throw new NotFoundError('생산 계획 제안을 찾을 수 없습니다');
  return row;
}

/** 지난 제안 목록 (본문 없이 요약만) — production.html 의 '지난 제안'. */
export async function listProposals(env, { user, status, from }) {
  const q = { user_id: `eq.${user.id}`, select: 'id,trigger,status,decided_at,slack_status,created_at,plan->summary,plan->triggerLabel', order: 'created_at.desc', limit: '100' };
  if (status && /^(pending|approved|dismissed|superseded)$/.test(status)) q.status = `eq.${status}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) q.created_at = `gte.${from}T00:00:00+09:00`;
  return (await selectMany(env, 'production_proposals', q)) || [];
}

export async function getProposal(env, { user, proposalId }) {
  if (proposalId === 'latest') {
    const rows = (await selectMany(env, 'production_proposals', { user_id: `eq.${user.id}`, select: '*', order: 'created_at.desc', limit: '1' })) || [];
    if (!rows.length) throw new NotFoundError('아직 생산 계획 제안이 없습니다');
    return rows[0];
  }
  return loadOwnedProposal(env, user, proposalId);
}

/**
 * @param {Object} body  { decision: 'approve'|'dismiss', selected?: number[] }  selected = suggestions 인덱스 (없으면 전부)
 */
export async function decideProposal(env, { user, proposalId, body }) {
  const row = await loadOwnedProposal(env, user, proposalId);
  if (row.status !== 'pending') throw new ConflictError(`이미 처리된 제안입니다 (${row.status})`);
  const decision = body && body.decision;
  if (decision !== 'approve' && decision !== 'dismiss') throw new ValidationError("decision 은 'approve' 또는 'dismiss' 여야 합니다");
  if (decision === 'dismiss') {
    const decidedAt = new Date().toISOString();
    await updateById(env, 'production_proposals', row.id, { status: 'dismissed', decided_at: decidedAt });
    await safeSyncStatus(env, { kind: 'eq.production_plan', source_id: `eq.${row.id}` }, 'dismissed');
    await safeRecord(env, reportFromDecision(row, { decision, selected: null, chosen: [], assignments: [], deciderId: user.id, decidedAt }));
    return { status: 'dismissed', assignments: [] };
  }
  const all = (row.plan && row.plan.suggestions) || [];
  let chosen = all;
  let selected = null;
  if (Array.isArray(body.selected)) {
    const idx = new Set(body.selected.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < all.length));
    chosen = all.filter((_, i) => idx.has(i));
    selected = [...idx].sort((a, b) => a - b);
  }
  const jobLabels = Object.fromEntries(((row.plan && row.plan.jobs) || []).map((j) => [j.id, j.label]));
  const rows = assignmentsFromSuggestions(chosen, { userId: user.id, proposalId: row.id, jobLabels });
  const saved = rows.length ? (await insertMany(env, 'production_assignments', rows)) || [] : [];
  const decidedAt = new Date().toISOString();
  await updateById(env, 'production_proposals', row.id, { status: 'approved', decided_at: decidedAt });
  // 보관함: 계획 보고 상태 + 인력 승인 보고 (고른 추천 · 승인자 — 예전엔 남지 않았다)
  await safeSyncStatus(env, { kind: 'eq.production_plan', source_id: `eq.${row.id}` }, 'approved');
  await safeRecord(env, reportFromDecision(row, { decision, selected, chosen, assignments: saved, deciderId: user.id, decidedAt }));
  let slack = { ok: false, error: 'no assignments' };
  if (saved.length) {
    const url = env.SLACK_WEBHOOK_PRODUCTION || env.SLACK_WEBHOOK_URL;
    slack = await postToWebhook(env, buildInstructionBlocks({ assignments: saved }), url);
  }
  return { status: 'approved', assignments: saved, slack: { ok: slack.ok, error: slack.ok ? undefined : slack.error } };
}

export async function listAssignments(env, { user, from }) {
  const q = { user_id: `eq.${user.id}`, select: '*', order: 'work_date.asc', limit: '500' };
  if (from) q.work_date = `gte.${String(from).slice(0, 10)}`;
  return (await selectMany(env, 'production_assignments', q)) || [];
}

// ── 매일 아침 요약 ──
/** 진행 중 수주가 있는 계정 (설계 소유자). */
async function activeOwners(env) {
  const orders = (await selectMany(env, 'orders', { status: 'in.(confirmed,in_production)', select: 'design_id', limit: '1000' })) || [];
  const ids = [...new Set(orders.map((o) => o.design_id))];
  if (!ids.length) return [];
  const designs = (await selectMany(env, 'designs', { id: `in.(${ids.join(',')})`, select: 'user_id', limit: '1000' })) || [];
  return [...new Set(designs.map((d) => d.user_id).filter(Boolean))];
}

/**
 * 한 계정의 아침 요약.
 *   1) 오늘 근무일이 아니면 건너뛴다 (주말·공휴일)
 *   2) 대표 채널: 오늘 부하·오늘 지시·도어 발주 마감(오늘·내일)
 *   3) 작업자 채널: 오늘 지시만
 *   4) 늦는 주문이 있고, 추천이 마지막 제안과 다르면 새 제안을 낸다 (같은 추천을 매일 다시 보내지 않는다)
 */
export async function dailyBrief(env, { userId, today }) {
  const user = { id: userId };
  const day = today || kstDate();
  const plan = await computePlan(env, { user, today: day });
  if (!plan.days.length || plan.days[0].date !== day) return { skipped: 'not a workday' };
  if (!plan.jobs.length) return { skipped: 'no active jobs' };

  const assignments = await listAssignments(env, { user, from: day });
  const todays = assignments.filter((a) => a.work_date === day && a.status === 'instructed');
  const blocks = buildDailyBlocks({ plan, assignments: todays, today: day });
  const owner = await postToWebhook(env, blocks);
  let workers = null;
  if (todays.length && env.SLACK_WEBHOOK_PRODUCTION) {
    workers = await postToWebhook(env, buildInstructionBlocks({ assignments: todays }), env.SLACK_WEBHOOK_PRODUCTION);
  }
  // 보관함: 아침 요약 매일 저장 (사장님 결정 Q3) — Slack 으로 나간 그대로
  await safeRecord(env, reportFromDailyBrief({
    ownerId: userId, day, plan, todays, blocks: blocks.blocks, sent: owner.ok, workersSent: workers ? workers.ok : undefined,
  }));

  let proposal = null;
  if (plan.summary.lateBefore > 0) {
    const last = (await selectMany(env, 'production_proposals', { user_id: `eq.${userId}`, select: 'plan,status', order: 'created_at.desc', limit: '1' })) || [];
    const prev = last[0] && last[0].plan ? actionKey(last[0].plan.suggestions || []) : null;
    if (prev !== actionKey(plan.suggestions)) {
      proposal = (await proposePlan(env, { user, trigger: 'manual', triggerLabel: '아침 점검 — 늦어질 주문 발견' })).proposal.id;
    }
  }
  return { owner: owner.ok, workers: workers ? workers.ok : null, proposal };
}

export async function runDailyBriefs(env, { today } = {}) {
  const owners = await activeOwners(env);
  const results = [];
  for (const userId of owners) {
    try {
      results.push({ userId, ...(await dailyBrief(env, { userId, today })) });
    } catch (e) {
      console.error('daily brief failed for', userId, e && e.message);
      results.push({ userId, error: e && e.message });
    }
  }
  return results;
}

// ── 월 손익 요약 ──
/**
 * 그 달(KST) 수주의 매출 · 지출비용 · 남는 돈, 그리고 간접비를 뺀 최종 손익 (순수).
 * 간접비는 품목 원가에 넣지 않으므로(2026-10-13 대표) 여기서 매출 전체로 덮는지 본다.
 *   매출  = 계약금액(부가세 포함) ÷ 1.1
 *   지출  = 계약 스냅샷 견적의 cost.total (장당 견적 이전 스냅샷이면 모름)
 */
export function summarizeMonth(orders, snapshotsById, { month, overheadMonthly }) {
  const rows = [];
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    if (kstDate(o.ordered_at).slice(0, 7) !== month) continue;
    const q = (snapshotsById.get(o.snapshot_id) || {}).quote_payload || null;
    const revenue = Math.round(Number(o.contract_amount || 0) / 1.1);
    // 고정비 회수분(몸통 장당)은 지출이 아니다 — 월 고정비(overheadMonthly)와 두 번 빼지 않게 덜어낸다
    const cost = q && q.cost && Number.isFinite(Number(q.cost.total)) ? Number(q.cost.total) - (Number(q.cost.fixed_recovery) || 0) : null;
    const tier = q && q.partner && Math.abs(Number(o.contract_amount) - Number(q.partner.total)) < 1000 ? 'partner' : 'customer';
    rows.push({
      id: o.id,
      order_no: o.order_no,
      label: o.customer_name ? `${o.customer_name} (${o.order_no})` : o.order_no,
      status: o.status,
      tier,
      revenue,
      cost,
      gross: cost === null ? null : revenue - cost,
    });
  }
  const known = rows.filter((r) => r.cost !== null);
  const revenue = rows.reduce((t, r) => t + r.revenue, 0);
  const revenueKnown = known.reduce((t, r) => t + r.revenue, 0);
  const cost = known.reduce((t, r) => t + r.cost, 0);
  const gross = revenueKnown - cost;
  const overhead = Math.round(Number(overheadMonthly) || 0);
  return {
    month,
    rows,
    totals: {
      orders: rows.length,
      unknownCost: rows.length - known.length,
      revenue,
      cost,
      gross,
      grossRate: revenueKnown > 0 ? Math.round((gross / revenueKnown) * 1000) / 10 : null,
      overhead,
      net: gross - overhead,
      // 간접비까지 덮으려면 남는 돈이 얼마나 더 필요한가
      shortfall: Math.max(0, overhead - gross),
    },
  };
}

export async function getMonthlySummary(env, { user, month }) {
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : kstDate().slice(0, 7);
  const { settings } = await getSettings(env, { user });
  const orders = await listOrders(env, { user });
  const inMonth = orders.filter((o) => o.status !== 'cancelled' && kstDate(o.ordered_at).slice(0, 7) === m);
  let snaps = [];
  if (inMonth.length) {
    const ids = [...new Set(inMonth.map((o) => o.snapshot_id))].join(',');
    snaps = (await selectMany(env, 'design_snapshots', { id: `in.(${ids})`, select: 'id,quote_payload', limit: '500' })) || [];
  }
  return summarizeMonth(inMonth, new Map(snaps.map((s) => [s.id, s])), { month: m, overheadMonthly: settings.quote.overheadMonthly });
}

// ── 월 생산 마감 (보관함, work-reports-archive.plan.md §2 · 사장님 결정 Q4) ──
/** 'YYYY-MM-DD' 의 전월 'YYYY-MM' */
export function prevMonthOf(day) {
  const [y, m] = String(day).slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 한 계정의 한 달 마감 보고를 만든다 (이미 있으면 그대로 — 주인×달 하나). */
export async function closeMonth(env, { userId, month }) {
  const user = { id: userId };
  const summary = await getMonthlySummary(env, { user, month });
  const assignments = (await selectMany(env, 'production_assignments', {
    user_id: `eq.${userId}`,
    and: `(work_date.gte.${month}-01,work_date.lte.${monthEnd(month)})`,
    select: 'id,status,cost,work_date',
    limit: '2000',
  })) || [];
  return safeRecord(env, reportFromMonth({ ownerId: userId, summary, assignments }));
}

/**
 * 매월 첫 근무일 아침(평일 07시 cron) — 전월 마감이 없는 계정마다 하나 만든다.
 * 1일이 주말이면 cron 이 돌지 않으므로 '1일' 이 아니라 '그 달 7일까지 + 아직 없음' 으로 본다 (주인×달 UNIQUE 라 중복 없음).
 * 대상: 전월에 수주가 있었던 계정 + 지금 진행 중 수주가 있는 계정.
 */
export async function runMonthlyCloses(env, { today } = {}) {
  const day = today || kstDate();
  if (Number(day.slice(8, 10)) > 7) return [];
  const month = prevMonthOf(day);
  const ordered = (await selectMany(env, 'orders', {
    and: `(ordered_at.gte.${month}-01T00:00:00+09:00,ordered_at.lte.${monthEnd(month)}T23:59:59+09:00)`,
    select: 'design_id',
    limit: '1000',
  })) || [];
  const ids = [...new Set(ordered.map((o) => o.design_id))];
  const owners = new Set(await activeOwners(env));
  if (ids.length) {
    for (const d of (await selectMany(env, 'designs', { id: `in.(${ids.join(',')})`, select: 'user_id', limit: '1000' })) || []) {
      if (d.user_id) owners.add(d.user_id);
    }
  }
  const results = [];
  for (const userId of owners) {
    try {
      const existing = await selectOne(env, 'work_reports', { kind: 'eq.monthly_close', owner_id: `eq.${userId}`, period_start: `eq.${month}-01`, select: 'id' });
      if (existing) { results.push({ userId, skipped: 'exists' }); continue; }
      const row = await closeMonth(env, { userId, month });
      results.push({ userId, created: Boolean(row) });
    } catch (e) {
      console.error('monthly close failed for', userId, e && e.message);
      results.push({ userId, error: e && e.message });
    }
  }
  return results;
}
