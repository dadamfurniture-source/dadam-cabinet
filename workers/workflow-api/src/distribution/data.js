/**
 * 상담 분배 — 점수에 쓰는 자료 읽기 (service_role).
 *
 *   업체           companies (본사 platform 은 빼고 hq · partner)
 *   상담 설정      company_service_settings (0018)
 *   본사 평가표    company_evaluations (0018)
 *   배정 기록      consult_assignments (0019) — 이번 달 배정 수 · 최근 30일 배정 수 · 마지막 배정 · 응답
 *   수주           orders (취소 뺌) — 진행 중 수 · 최근 90일 수주 · 완료 수주의 품목(계약 스냅샷 설계의 categoryId)
 *   재작업         rework_logs — 최근 90일 수주 중 재작업이 있는 수주
 *   고객 만족      install_feedback — 답한 점수
 *
 * 통계는 풀 안 업체(isPoolCompany)만 읽는다 — 풀 밖 업체는 거르기에서 빠지므로 점수가 없다.
 */

import { selectMany } from '../supabase.js';
import * as R from './rules.js';
import { isPoolCompany, kstMonthStartMs, DAY_MS } from './score.js';

/** in.(…) 한 번에 싣는 id 수 (URL 길이) */
const ID_CHUNK = 100;
/** 스냅샷 설계는 커서 조금씩 읽는다 */
const SNAPSHOT_CHUNK = 25;
/** 한 번에 읽는 행 수 상한 */
const ROW_LIMIT = '5000';
/** 품목 실적에 읽는 완료 수주 수 상한 (최근 완료 순) — 5건 넘으면 만점이라 그 뒤는 점수를 바꾸지 않는 일이 많다 */
export const COMPLETED_ORDERS_MAX = 500;

/** 진행 중 수주 상태 (orders.js ORDER_STATUSES 중 완료 · 취소가 아닌 것) */
export const IN_PROGRESS_STATUSES = Object.freeze(['confirmed', 'in_production', 'delivered']);

const COMPANY_COLUMNS = 'id,kind,name,plan,status,sido,gugun';
const SETTINGS_COLUMNS = 'company_id,regions,items,monthly_limit,next_available_date,updated_at';
const EVALUATION_COLUMNS =
  'company_id,grade,equipment,staff,finishes,design,install,price_tier,docs,as_months,warranty_months,note,evaluated_at,evaluated_by';

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function selectIn(env, table, column, ids, query, size = ID_CHUNK) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = [];
  for (const part of chunks(unique, size)) {
    rows.push(
      ...((await selectMany(env, table, { ...query, [column]: `in.(${part.join(',')})` })) || [])
    );
  }
  return rows;
}

const byCompany = (rows) => new Map((rows || []).map((r) => [r.company_id, r]));

/** 본사(platform)를 뺀 업체 전부 — 이름 순 */
export async function loadCompanies(env) {
  return (
    (await selectMany(env, 'companies', {
      kind: 'in.(hq,partner)',
      select: COMPANY_COLUMNS,
      order: 'name.asc',
      limit: '2000',
    })) || []
  );
}

export async function loadSettings(env, companyIds) {
  return byCompany(
    await selectIn(env, 'company_service_settings', 'company_id', companyIds, {
      select: SETTINGS_COLUMNS,
    })
  );
}

export async function loadEvaluations(env, companyIds) {
  return byCompany(
    await selectIn(env, 'company_evaluations', 'company_id', companyIds, {
      select: EVALUATION_COLUMNS,
    })
  );
}

export { EVALUATION_COLUMNS, SETTINGS_COLUMNS, COMPANY_COLUMNS };

function emptyStats() {
  return {
    monthCount: 0,
    recentCount: 0,
    lastAssignedAt: null,
    respondedCount: 0,
    fastAcceptCount: 0,
    feedbackCount: 0,
    feedbackSum: 0,
    recentOrderCount: 0,
    cleanOrderCount: 0,
    inProgressCount: 0,
    completedItems: [],
  };
}

/** 배정 기록 → 통계 (순수) */
export function assignmentStats(rows, nowMs, statsBy) {
  const monthStart = kstMonthStartMs(nowMs);
  const recentFrom = nowMs - R.SPREAD_WINDOW_DAYS * DAY_MS;
  const responseFrom = nowMs - R.RESPONSE_WINDOW_DAYS * DAY_MS;
  const fastMs = R.RESPONSE_WITHIN_HOURS * 3600 * 1000;
  for (const a of rows || []) {
    const s = statsBy.get(a.company_id);
    if (!s) continue;
    const at = Date.parse(a.assigned_at);
    if (!Number.isFinite(at)) continue;
    if (!s.lastAssignedAt || at > Date.parse(s.lastAssignedAt)) s.lastAssignedAt = a.assigned_at;
    // 한도 · 일감 고르게는 배정 수 그대로 (받기 · 못 받음 · 무응답 모두)
    if (at >= monthStart) s.monthCount += 1;
    if (at >= recentFrom) s.recentCount += 1;
    // 응답 — 끝난 배정(받기 · 못 받음 · 무응답)만. 기다리는 배정은 아직 셈하지 않는다
    if (at >= responseFrom && a.state !== 'assigned') {
      s.respondedCount += 1;
      const answered = a.responded_at ? Date.parse(a.responded_at) : NaN;
      if (a.state === 'accepted' && Number.isFinite(answered) && answered - at <= fastMs)
        s.fastAcceptCount += 1;
    }
  }
}

/** 수주 · 재작업 · 만족 → 통계 (순수). snapshotItems: Map snapshot_id → Set(categoryId) */
export function orderStats({ orders, reworkOrderIds, feedback, snapshotItems, nowMs }, statsBy) {
  const reworkFrom = nowMs - R.REWORK_WINDOW_DAYS * DAY_MS;
  const companyOf = new Map();
  for (const o of orders || []) {
    const s = statsBy.get(o.company_id);
    if (!s) continue;
    companyOf.set(o.id, o.company_id);
    if (IN_PROGRESS_STATUSES.includes(o.status)) s.inProgressCount += 1;
    const at = Date.parse(o.ordered_at);
    if (Number.isFinite(at) && at >= reworkFrom) {
      s.recentOrderCount += 1;
      if (!reworkOrderIds.has(o.id)) s.cleanOrderCount += 1;
    }
    if (o.status === 'completed' && snapshotItems.has(o.snapshot_id))
      s.completedItems.push(snapshotItems.get(o.snapshot_id));
  }
  for (const f of feedback || []) {
    const score = f.score === null || f.score === undefined ? NaN : Number(f.score);
    const s = statsBy.get(companyOf.get(f.order_id));
    if (!s || !Number.isFinite(score)) continue;
    s.feedbackCount += 1;
    s.feedbackSum += score;
  }
}

/** 계약 스냅샷 설계의 품목 categoryId 들 */
async function loadSnapshotItems(env, snapshotIds) {
  const out = new Map();
  const rows = await selectIn(
    env,
    'design_snapshots',
    'id',
    snapshotIds,
    { select: 'id,items:design_payload->items' },
    SNAPSHOT_CHUNK
  );
  for (const row of rows) {
    const set = new Set();
    for (const item of Array.isArray(row.items) ? row.items : []) {
      const cat = item && (item.categoryId || item.category);
      if (typeof cat === 'string' && cat) set.add(cat);
    }
    out.set(row.id, set);
  }
  return out;
}

/**
 * 풀 안 업체의 통계.
 *   withItems  완료 수주의 품목(스냅샷 설계)까지 읽는다 — 품목 실적이 필요 없으면(업체 내 점수) false
 * @returns {Promise<Map<string, object>>} company_id → 통계
 */
export async function loadStats(env, companyIds, { nowMs, withItems = true }) {
  const statsBy = new Map(companyIds.map((id) => [id, emptyStats()]));
  if (!companyIds.length) return statsBy;

  const [assignments, orders] = await Promise.all([
    selectIn(env, 'consult_assignments', 'company_id', companyIds, {
      select: 'company_id,state,assigned_at,responded_at',
      order: 'assigned_at.desc',
      limit: ROW_LIMIT,
    }),
    selectIn(env, 'orders', 'company_id', companyIds, {
      status: 'neq.cancelled',
      select: 'id,company_id,status,ordered_at,completed_at,snapshot_id',
      order: 'ordered_at.desc',
      limit: ROW_LIMIT,
    }),
  ]);
  assignmentStats(assignments, nowMs, statsBy);

  const reworkFrom = nowMs - R.REWORK_WINDOW_DAYS * DAY_MS;
  const recentIds = orders.filter((o) => Date.parse(o.ordered_at) >= reworkFrom).map((o) => o.id);
  const completed = orders
    .filter((o) => o.status === 'completed' && o.snapshot_id)
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
    .slice(0, COMPLETED_ORDERS_MAX);

  const [reworks, feedback, snapshotItems] = await Promise.all([
    selectIn(env, 'rework_logs', 'order_id', recentIds, { select: 'order_id', limit: ROW_LIMIT }),
    selectIn(
      env,
      'install_feedback',
      'order_id',
      orders.map((o) => o.id),
      { select: 'order_id,score', limit: ROW_LIMIT }
    ),
    withItems
      ? loadSnapshotItems(
          env,
          completed.map((o) => o.snapshot_id)
        )
      : new Map(),
  ]);
  orderStats(
    {
      orders,
      reworkOrderIds: new Set(reworks.map((r) => r.order_id)),
      feedback,
      snapshotItems,
      nowMs,
    },
    statsBy
  );
  return statsBy;
}

/**
 * 한 상담의 순위 자료 — 업체 · 설정 · 평가표 · 통계.
 * @returns {Promise<{ companies, settingsBy, evaluationBy, statsBy }>}
 */
export async function loadRankingContext(env, { nowMs }) {
  const companies = await loadCompanies(env);
  // 풀 밖 업체는 tier · inactive 로만 걸러지므로 설정 · 평가표 · 통계를 읽지 않는다
  const poolIds = companies.filter(isPoolCompany).map((c) => c.id);
  const [settingsBy, evaluationBy, statsBy] = await Promise.all([
    loadSettings(env, poolIds),
    loadEvaluations(env, poolIds),
    loadStats(env, poolIds, { nowMs }),
  ]);
  return { companies, settingsBy, evaluationBy, statsBy };
}
