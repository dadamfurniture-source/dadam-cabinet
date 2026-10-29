/**
 * 업체 장부 요약 — GET /books/summary?month=YYYY-MM (앱이 이 모양으로 만든다).
 *
 * 그 업체의 active 대표 · 실장(MONEY_ROLES)만 본다 → 그 업체 것 (본사도 같다). 아니면 403.
 * 숫자는 본사 월 손익(/production/monthly, production/service.js summarizeMonth)과 같은 식을 쓴다.
 *   달 묶음     수주의 ordered_at (KST) 달, 취소 뺌
 *   계약 합     그 달 수주 계약금(부가세 포함) 합
 *   받은 돈     paid_on 이 그 달인 수금 일정(order_payments) 합
 *   견적 마진   월 손익의 남는 돈과 같다 — 매출(계약금 ÷ 1.1) − 계약 스냅샷 견적 원가 (견적 원가를 모르는 수주는 뺀다)
 *   실적 마진   실적 원가(order_costs)가 한 줄이라도 있는 수주만 — 매출 − 실적 원가 합. 견적 원가로 채우지 않는다
 *   실적 없음   그 달 수주 중 실적 원가가 한 줄도 없는 수 (actual_cost_missing)
 *   밀린 돈     받기로 한 날이 오늘(KST) 전이고 아직 안 받은 수금 일정 — 취소 수주 뺌
 *   받을 돈     아직 안 받았고 받기로 한 날이 오늘부터 30일 안 — 받기로 한 날 순 20개
 *   상태별 수   그 업체 수주 전부의 지금 상태별 수
 */
import { selectOne, selectMany, activeMemberships, MONEY_ROLES, ForbiddenError, NotFoundError } from './supabase.js';
import { kstDate, summarizeMonth, prevMonthOf } from './production/service.js';
import { ORDER_STATUSES } from './orders.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
/** 받을 돈 — 오늘부터 며칠 안 · 몇 개까지 */
export const UPCOMING_DAYS = 30;
export const UPCOMING_MAX = 20;

/** 'YYYY-MM-DD' + n 일 */
function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** 장부를 보는 업체 — active 대표 · 실장인 업체. 아니면 403 (구성원이 아니면 not_member, staff 면 not_money) */
export async function booksCompanyOf(env, user) {
  const memberships = await activeMemberships(env, user);
  const m = memberships.find((x) => MONEY_ROLES.includes(x.role));
  if (m) return m.company_id;
  if (memberships.length) throw new ForbiddenError('장부는 업체 대표 · 실장만 봅니다', 'not_money');
  throw new ForbiddenError('장부는 업체 대표 · 실장만 봅니다', 'not_member');
}

/** 한 달 칸 (순수) — 월 손익과 같은 매출 · 견적 원가 (summarizeMonth) 위에 받은 돈 · 실적 마진 */
export function monthBooks({ orders, snapshotsById, costsByOrder, payments, month }) {
  // summarizeMonth 가 달 묶음(KST) · 취소 빼기 · 매출 · 견적 원가를 정한다 — 간접비는 장부에 싣지 않는다
  const { rows, totals } = summarizeMonth(orders, snapshotsById, { month, overheadMonthly: 0 });
  const inMonth = new Set(rows.map((r) => r.id));
  const contract = orders.filter((o) => inMonth.has(o.id)).reduce((t, o) => t + (Number(o.contract_amount) || 0), 0);
  let actual = 0;
  let missing = 0;
  for (const r of rows) {
    const list = costsByOrder.get(r.id);
    if (!list || !list.length) {
      missing += 1;
      continue;
    }
    actual += r.revenue - list.reduce((t, c) => t + (Number(c.amount) || 0), 0);
  }
  const received = payments
    .filter((p) => p.paid_on && String(p.paid_on).slice(0, 7) === month)
    .reduce((t, p) => t + (Number(p.amount) || 0), 0);
  return {
    month,
    contract_total: contract,
    received_total: received,
    quote_margin: totals.gross,
    actual_margin: actual,
    actual_cost_missing: missing,
  };
}

/**
 * 장부 요약 (순수).
 *   orders: 그 업체 수주 전부 { id, order_no, snapshot_id, contract_amount, status, ordered_at }
 *   payments: 그 업체 수주의 수금 일정 { order_id, stage, amount, due_on, paid_on }
 *   costs: 두 달 수주의 실적 원가 { order_id, amount }
 */
export function summarizeBooks({ company, month, orders, snapshotsById, costs, payments, today }) {
  const costsByOrder = new Map();
  for (const c of costs || []) {
    if (!costsByOrder.has(c.order_id)) costsByOrder.set(c.order_id, []);
    costsByOrder.get(c.order_id).push(c);
  }
  const months = [month, prevMonthOf(`${month}-01`)].map((m) =>
    monthBooks({ orders, snapshotsById, costsByOrder, payments: payments || [], month: m }));

  const byId = new Map(orders.map((o) => [o.id, o]));
  const live = (p) => {
    const o = byId.get(p.order_id);
    return Boolean(o) && o.status !== 'cancelled';
  };
  const open = (payments || []).filter((p) => !p.paid_on && p.due_on && live(p));
  const late = open.filter((p) => p.due_on < today);
  const until = addDays(today, UPCOMING_DAYS);
  const upcoming = open
    .filter((p) => p.due_on >= today && p.due_on <= until)
    .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)))
    .slice(0, UPCOMING_MAX)
    .map((p) => ({ order_id: p.order_id, order_no: byId.get(p.order_id).order_no, stage: p.stage, amount: Number(p.amount) || 0, due_on: p.due_on }));

  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const o of orders) if (o.status in statusCounts) statusCounts[o.status] += 1;

  return {
    company,
    month,
    months,
    outstanding: { total: late.reduce((t, p) => t + (Number(p.amount) || 0), 0), count: late.length },
    status_counts: statusCounts,
    upcoming,
  };
}

/** GET /books/summary */
export async function getBooksSummary(env, { user, month }) {
  const companyId = await booksCompanyOf(env, user);
  const today = kstDate();
  const m = MONTH_RE.test(String(month || '')) ? month : today.slice(0, 7);
  const company = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'id,name' });
  if (!company) throw new NotFoundError('업체를 찾을 수 없습니다');

  const [orders, payments] = await Promise.all([
    selectMany(env, 'orders', {
      company_id: `eq.${companyId}`,
      select: 'id,order_no,snapshot_id,contract_amount,status,ordered_at',
      order: 'ordered_at.desc',
      limit: '10000',
    }),
    // 수주에 붙은 표 — 그 업체 수주 것만 (내장 조인)
    selectMany(env, 'order_payments', {
      select: 'order_id,stage,amount,due_on,paid_on,orders!inner(company_id)',
      'orders.company_id': `eq.${companyId}`,
      limit: '10000',
    }),
  ]);
  const list = orders || [];
  const months = new Set([m, prevMonthOf(`${m}-01`)]);
  const recent = list.filter((o) => o.status !== 'cancelled' && months.has(kstDate(o.ordered_at).slice(0, 7)));
  let snaps = [];
  let costs = [];
  if (recent.length) {
    const snapIds = [...new Set(recent.map((o) => o.snapshot_id).filter(Boolean))];
    [snaps, costs] = await Promise.all([
      snapIds.length ? selectMany(env, 'design_snapshots', { id: `in.(${snapIds.join(',')})`, select: 'id,quote_payload', limit: '5000' }) : [],
      selectMany(env, 'order_costs', { order_id: `in.(${recent.map((o) => o.id).join(',')})`, select: 'order_id,amount', limit: '10000' }),
    ]);
  }
  return summarizeBooks({
    company: { id: company.id, name: company.name },
    month: m,
    orders: list,
    snapshotsById: new Map((snaps || []).map((s) => [s.id, s])),
    costs: costs || [],
    payments: (payments || []).map((p) => ({ order_id: p.order_id, stage: p.stage, amount: p.amount, due_on: p.due_on, paid_on: p.paid_on })),
    today,
  });
}
