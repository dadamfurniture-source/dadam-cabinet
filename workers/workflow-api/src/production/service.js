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
import { buildProposalBlocks, buildInstructionBlocks, assignmentsFromSuggestions } from './notify.js';
import { DEFAULT_STANDARDS, DEFAULT_CREW, DEFAULT_COSTS, DEFAULT_LEADS } from './standards.js';

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
};

export function mergeSettings(saved) {
  const s = saved || {};
  return {
    standards: { ...DEFAULT_STANDARDS, ...(s.standards || {}) },
    crew: { ...DEFAULT_CREW, ...(s.crew || {}) },
    costs: { ...DEFAULT_COSTS, ...(s.costs || {}) },
    leads: { ...DEFAULT_LEADS, ...(s.leads || {}) },
    holidays: Array.isArray(s.holidays) ? s.holidays : [],
  };
}

/** 저장 전 검증 — 아는 키만, 숫자만, 범위 안만. */
export function sanitizeSettings(body) {
  const out = {};
  const defaults = { standards: DEFAULT_STANDARDS, crew: DEFAULT_CREW, costs: DEFAULT_COSTS, leads: DEFAULT_LEADS };
  for (const [group, def] of Object.entries(defaults)) {
    if (!body || body[group] === undefined) continue;
    if (typeof body[group] !== 'object' || body[group] === null) throw new ValidationError(`${group} 는 객체여야 합니다`);
    out[group] = {};
    for (const [k, v] of Object.entries(body[group])) {
      if (!(k in def)) throw new ValidationError(`알 수 없는 설정: ${group}.${k}`);
      const n = Number(v);
      const [lo, hi] = NUMERIC_LIMITS[group];
      // util 은 비율(0~1)
      const max = group === 'crew' && k === 'util' ? 1 : hi;
      if (!Number.isFinite(n) || n < lo || n > max) throw new ValidationError(`${group}.${k} 값이 범위를 벗어났습니다`);
      out[group][k] = n;
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
export function buildJobs(orders, snapshotsById, schedules, standards) {
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
  return { orders, snapshotsById: new Map(snaps.map((s) => [s.id, s])), schedules };
}

export async function computePlan(env, { user, today }) {
  const { settings } = await getSettings(env, { user });
  const { orders, snapshotsById, schedules } = await loadInputs(env, user);
  const { jobs, skipped } = buildJobs(orders, snapshotsById, schedules, settings.standards);
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
  const row = await insertOne(env, 'production_proposals', {
    user_id: user.id,
    trigger,
    trigger_order_id: orderId,
    plan: { days: plan.days, jobs: plan.jobs, suggestions: plan.suggestions, summary: plan.summary, skipped: plan.skipped },
    status: 'pending',
  });
  const payload = buildProposalBlocks({ plan, link: proposalLink(env, row.id), triggerLabel });
  const sent = await postToWebhook(env, payload);
  await updateById(env, 'production_proposals', row.id, { slack_status: sent.ok ? 'sent' : `failed: ${sent.error || ''}`.slice(0, 300) });
  return { proposal: { ...row, slack_status: sent.ok ? 'sent' : 'failed' }, plan };
}

async function loadOwnedProposal(env, user, id) {
  const row = await selectOne(env, 'production_proposals', { id: `eq.${id}`, select: '*' });
  if (!row || row.user_id !== user.id) throw new NotFoundError('생산 계획 제안을 찾을 수 없습니다');
  return row;
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
    await updateById(env, 'production_proposals', row.id, { status: 'dismissed', decided_at: new Date().toISOString() });
    return { status: 'dismissed', assignments: [] };
  }
  const all = (row.plan && row.plan.suggestions) || [];
  let chosen = all;
  if (Array.isArray(body.selected)) {
    const idx = new Set(body.selected.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < all.length));
    chosen = all.filter((_, i) => idx.has(i));
  }
  const jobLabels = Object.fromEntries(((row.plan && row.plan.jobs) || []).map((j) => [j.id, j.label]));
  const rows = assignmentsFromSuggestions(chosen, { userId: user.id, proposalId: row.id, jobLabels });
  const saved = rows.length ? (await insertMany(env, 'production_assignments', rows)) || [] : [];
  await updateById(env, 'production_proposals', row.id, { status: 'approved', decided_at: new Date().toISOString() });
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
