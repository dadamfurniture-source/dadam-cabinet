/**
 * 회계장부 — 회계 한눈에 (대시보드). 묶음 계산은 DB 0034 ledger_summary — 여기는 기간 · 빈 달 채우기 · 고른 달 고르기.
 *
 *   GET /ledger/dashboard?month=YYYY-MM&months=12   대표 · 실장 — 고른 달(기본 이번 달, 한국 시간)까지 months 달(1~12, 기본 12)
 *     → { month, from, to, vat_type, months: [12달 — 빈 달은 0], accounts · suppliers: [고른 달만],
 *         pending_photos(확인 기다리는 사진 수), held_statements(세금계산서 기다리는 명세표 수, DB 0036), available, level, viewing }
 *   매출은 받은 돈 · 매입은 낸 돈 기준(장부와 같다). 수주 금액 · 미수는 앱이 GET /books/summary 를 따로 부른다
 *   (본사 보기 ?company= 에서는 앱이 그 칸을 숨긴다 — books.js 는 본사 보기를 받지 않는다).
 *   0034 를 적용하기 전이면 { available: false } — 화면이 「준비 중」을 보인다.
 */
import { selectOne, selectMany, callRpc, ValidationError } from '../supabase.js';
import { ledgerAccess, assertMoney } from './access.js';
import { VAT_TYPES } from './checks.js';
import { isMissingFunction } from './hints.js';

export const DASH_MONTHS = 12;
/** 확인 기다리는 사진을 셀 때 읽는 최대 줄 수 */
const PENDING_COUNT_LIMIT = 1000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ZERO = { income: 0, income_vat: 0, expense: 0, expense_vat: 0, asset_buy: 0, asset_sell: 0, account_unknown: 0, vat_unknown: 0, evidence_risk: 0 };

/** 한국 시간 이번 달 'YYYY-MM' */
export function kstMonth(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

/** 'YYYY-MM' 에서 n 달 옮기기 (순수) */
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** 고른 달까지 months 달 — { from, to, list } (순수) */
export function dashRange(month, months) {
  const first = shiftMonth(month, -(months - 1));
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const list = [];
  for (let i = 0; i < months; i += 1) list.push(shiftMonth(first, i));
  return { from: `${first}-01`, to: `${month}-${String(last).padStart(2, '0')}`, list };
}

/** 빈 달은 0 으로 (순수) */
export function fillMonths(list, rows) {
  const by = new Map((rows || []).map((r) => [r.month, r]));
  return list.map((month) => {
    const r = by.get(month) || {};
    const out = { month };
    for (const k of Object.keys(ZERO)) out[k] = Number(r[k]) || 0;
    return out;
  });
}

/** GET /ledger/dashboard */
export async function ledgerDashboard(env, { user, company, month, months, nowMs = Date.now() }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  const m = month || kstMonth(nowMs);
  if (!MONTH_RE.test(m)) throw new ValidationError('month 는 YYYY-MM 입니다');
  const n = months === undefined || months === null || months === '' ? DASH_MONTHS : Number(months);
  if (!Number.isInteger(n) || n < 1 || n > DASH_MONTHS) throw new ValidationError(`months 는 1~${DASH_MONTHS} 입니다`);
  const range = dashRange(m, n);
  const base = { month: m, from: range.from, to: range.to, level: access.level, viewing: access.viewing };

  let summary;
  try {
    summary = await callRpc(env, 'ledger_summary', { p_company: access.companyId, p_from: range.from, p_to: range.to });
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    console.warn('[Ledger] ledger_summary missing — apply database/migrations/0034');
    return { ...base, available: false };
  }
  const s = summary && typeof summary === 'object' ? summary : {};
  const settings = await selectOne(env, 'company_settings', { company_id: `eq.${access.companyId}`, select: 'settings' });
  const vat = settings && settings.settings && settings.settings.tax && settings.settings.tax.vat_type;
  // 확인 기다림 · 모아 둔 명세표를 한 번에 센다
  const waiting =
    (await selectMany(env, 'ledger_documents', {
      company_id: `eq.${access.companyId}`,
      review_status: 'in.(pending,held)',
      select: 'id,review_status',
      limit: String(PENDING_COUNT_LIMIT),
    })) || [];
  const inMonth = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && r.month === m) : []);
  return {
    ...base,
    available: true,
    vat_type: VAT_TYPES.includes(vat) ? vat : null,
    months: fillMonths(range.list, s.months),
    accounts: inMonth(s.accounts).map((a) => ({ direction: a.direction, account: a.account || null, amount: Number(a.amount) || 0, vat_amount: Number(a.vat_amount) || 0, n: Number(a.n) || 0 })),
    suppliers: inMonth(s.suppliers).map((x) => ({ name: x.name, amount: Number(x.amount) || 0, n: Number(x.n) || 0 })),
    pending_photos: waiting.filter((r) => r.review_status === 'pending').length,
    held_statements: waiting.filter((r) => r.review_status === 'held').length,
  };
}
