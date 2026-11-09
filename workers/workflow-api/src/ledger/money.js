/**
 * 회계 — 받을 돈 · 낼 돈. 수주 쪽 일정(ERP 가 적는다)을 회계 화면에서 본다 (보기만 — 고치기는 ERP).
 *
 *   GET /ledger/receivables   대표 · 실장 — 아직 안 받은 수금 일정 (order_payments paid_on 없음, 취소 수주 뺌)
 *   GET /ledger/payables      대표 · 실장 — 아직 안 낸 수주 원가 (order_costs spent_on 없음 · due_on 있음, 취소 수주 뺌)
 *     받을 날 · 낼 날 순 (오늘 전이면 late — 늦은 것이 먼저 온다), 날짜 없는 받을 돈은 끝. MONEY_MAX 줄까지,
 *     합계 · 늦은 합계 · 수는 받은 줄 전부로 센다. ?company= 본사 보기(보기만, access.js)
 *   고객 이름은 싣지 않는다 — 주문번호 · 단계로 ERP 에서 찾는다. 낼 돈의 상대는 거래처 이름(없으면 적은 이름)
 */
import { selectMany } from '../supabase.js';
import { kstDate } from '../production/service.js';
import { ledgerAccess, assertMoney } from './access.js';
import { isUuid } from './checks.js';

/** 화면에 주는 줄 · 한 번에 읽는 줄 */
export const MONEY_MAX = 200;
export const MONEY_FETCH = 2000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 날짜 순 (없는 날짜는 끝) */
function byDue(a, b) {
  if (!a.due_on) return b.due_on ? 1 : 0;
  if (!b.due_on) return -1;
  return String(a.due_on).localeCompare(String(b.due_on));
}

function totalsOf(items, today) {
  const late = items.filter((x) => x.due_on && x.due_on < today);
  return {
    count: items.length,
    total: items.reduce((t, x) => t + x.amount, 0),
    late_count: late.length,
    late_total: late.reduce((t, x) => t + x.amount, 0),
  };
}

/** 받을 돈 (순수) — rows: order_payments + orders(order_no) */
export function receivablesOf(rows, today) {
  const items = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && !r.paid_on)
    .map((r) => ({
      id: r.id,
      order_id: r.order_id,
      order_no: (r.orders && r.orders.order_no) || null,
      stage: r.stage || null,
      amount: num(r.amount),
      due_on: r.due_on || null,
      late: Boolean(r.due_on && r.due_on < today),
    }))
    .sort(byDue);
  return { today, ...totalsOf(items, today), items: items.slice(0, MONEY_MAX) };
}

/** 낼 돈 (순수) — rows: order_costs + orders(order_no), names: 거래처 id → 이름 */
export function payablesOf(rows, today, names = new Map()) {
  const items = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && !r.spent_on && r.due_on)
    .map((r) => {
      const vat = r.vat_amount === null || r.vat_amount === undefined ? null : num(r.vat_amount);
      return {
        id: r.id,
        order_id: r.order_id,
        order_no: (r.orders && r.orders.order_no) || null,
        category: r.category || null,
        vendor: names.get(r.counterparty_id) || r.vendor_name || null,
        description: r.description || null,
        amount: num(r.amount) + (vat || 0),
        supply: num(r.amount),
        vat_amount: vat,
        due_on: r.due_on,
        late: r.due_on < today,
      };
    })
    .sort(byDue);
  return { today, ...totalsOf(items, today), items: items.slice(0, MONEY_MAX) };
}

/** 그 업체 · 취소 안 한 수주의 표 줄 (수주 끼워 넣기) — 아침 브리핑(src/brief.js)도 쓴다 */
export function openRows(env, table, companyId, cols, filters) {
  return selectMany(env, table, {
    select: `${cols},orders!inner(company_id,order_no,status)`,
    'orders.company_id': `eq.${companyId}`,
    'orders.status': 'neq.cancelled',
    ...filters,
    order: 'due_on.asc',
    limit: String(MONEY_FETCH),
  });
}

/** GET /ledger/receivables */
export async function listReceivables(env, { user, company }) {
  const access = await ledgerAccess(env, user, { company, report: true });
  assertMoney(access);
  const rows = await openRows(env, 'order_payments', access.companyId, 'id,order_id,stage,amount,due_on,paid_on', {
    paid_on: 'is.null',
  });
  return { ...receivablesOf(rows || [], kstDate()), level: access.level, viewing: access.viewing };
}

/** GET /ledger/payables */
export async function listPayables(env, { user, company }) {
  const access = await ledgerAccess(env, user, { company, report: true });
  assertMoney(access);
  const rows =
    (await openRows(
      env,
      'order_costs',
      access.companyId,
      'id,order_id,category,description,vendor_name,counterparty_id,amount,vat_amount,spent_on,due_on',
      { spent_on: 'is.null', due_on: 'not.is.null' }
    )) || [];
  const ids = [...new Set(rows.map((r) => r && r.counterparty_id).filter(isUuid))];
  const names = new Map();
  if (ids.length) {
    const cps = (await selectMany(env, 'counterparties', { id: `in.(${ids.join(',')})`, select: 'id,name' })) || [];
    for (const c of cps) if (c && c.name) names.set(c.id, c.name);
  }
  return { ...payablesOf(rows, kstDate(), names), level: access.level, viewing: access.viewing };
}
