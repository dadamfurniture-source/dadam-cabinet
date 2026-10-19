/**
 * 과거 월 매출 — 경영 대시보드 3단계 (21 계절 지수 · 수주 예측).
 *
 * 시스템 수주가 쌓이기 전의 장사를 사장님이 달마다 적는다 (거래명세서 · 장부, VAT 제외).
 * 한 해치가 있으면 그날부터 계절 지수를 낼 수 있다. 관리자만. 표는 database/management-phase3.sql.
 */
import { selectMany, upsertOne, restDelete, ValidationError, ForbiddenError } from './supabase.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';

export const NEED_SQL = '과거 월 매출 칸이 아직 DB 에 없습니다 — database/management-phase3.sql 을 실행해 주세요';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 한 줄 검증 (순수). revenue 가 비면 그 달을 지운다는 뜻 → null */
export function validateHistoryRow(r) {
  const month = String((r && r.month) || '');
  if (!MONTH_RE.test(month)) throw new ValidationError(`달은 YYYY-MM 이어야 합니다 (${month || '빈 값'})`);
  if (r.revenue === null || r.revenue === undefined || r.revenue === '') return { month, remove: true };
  const revenue = Number(r.revenue);
  if (!Number.isInteger(revenue) || revenue < 0) throw new ValidationError(`${month} 매출은 0 이상의 원 단위 정수여야 합니다`);
  let orders = null;
  if (r.orders !== undefined && r.orders !== null && r.orders !== '') {
    orders = Number(r.orders);
    if (!Number.isInteger(orders) || orders < 0) throw new ValidationError(`${month} 수주 건수는 0 이상의 정수여야 합니다`);
  }
  return { month, revenue, orders };
}

export async function listSalesHistory(env, { user }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 봅니다');
  try {
    const rows = (await selectMany(env, 'sales_history', { select: 'month,revenue,orders,memo', order: 'month.asc', limit: '240' })) || [];
    return { items: rows.map((r) => ({ ...r, month: String(r.month).slice(0, 7) })) };
  } catch (e) {
    if (isMissingRelation(e)) return { items: null };
    throw e;
  }
}

/** 여러 달을 한 번에 — 매출이 빈 달은 지운다 */
export async function saveSalesHistory(env, { user, body }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 적습니다');
  const rows = Array.isArray(body && body.rows) ? body.rows : null;
  if (!rows || !rows.length || rows.length > 120) throw new ValidationError('rows 에 1~120 달을 보내 주세요');
  const clean = rows.map(validateHistoryRow);
  let saved = 0, removed = 0;
  try {
    for (const r of clean) {
      const month = `${r.month}-01`;
      if (r.remove) { await restDelete(env, 'sales_history', { month: `eq.${month}` }); removed += 1; continue; }
      await upsertOne(env, 'sales_history', { month, revenue: r.revenue, orders: r.orders, created_by: user.id, updated_at: new Date().toISOString() }, 'month');
      saved += 1;
    }
  } catch (e) {
    if (isMissingRelation(e)) throw new ValidationError(NEED_SQL);
    throw e;
  }
  return { saved, removed };
}
