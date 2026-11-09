/**
 * 회계장부 — 월 마감 메모 (2026-11-06 사장님 결정 「6-L3 월 마감 메모」: 서버가 센 목록 · 담을 것 여덟 · 월 보고서 맨 아래 + 1일 알림).
 *
 *   GET /ledger/close-memo?month=YYYY-MM   대표 · 실장 (?company= 본사 보기, 보기만) — 그 달 장부에서 손볼 곳.
 *     → { month, prev_month, vat_type, items: [{ key, label, n, amount?, rows? }], level, viewing }
 *   AI 를 쓰지 않는다 (요금이 없어 Expert 업체도 받는다). 숫자는 장부 함수(ledger_book · ledger_summary) · 확인 기다리는 사진 ·
 *   받을 돈 · 장부 알림에서 센다 — 새 규칙을 만들지 않고 이미 있는 셈을 모은다. 0034 적용 전이면 { available: false }.
 *
 *   항목 (결정 페이지 차례 — n 이 0 인 항목도 싣는다, 화면이 뺀다):
 *     noevid     증빙 없는 지출 — 그 달 지출 줄 중 증빙 「없음」
 *     simple30k  3만 원 넘는데 간이영수증 — 합계가 EVIDENCE_MIN 넘는 간이영수증 지출 (적격증빙이 아니면 가산세 2% 위험,
 *                DB 0034 c_evidence_min 과 같은 값)
 *     invoice    세금계산서 기다리는 명세표 — 지금 모아 둔 명세표 (DB 0036 held)
 *     photos     확인 안 한 사진 — 지금 확인 기다리는 사진
 *     late       늦은 받을 돈 — 지금 받을 날이 지난 수금 일정 (money.js 와 같은 셈, 고객 이름 없이 주문번호)
 *     vat        부가세 — 그 달 받은 부가세 − 낸 부가세 (일반과세만 셈) · 부가세 모르는 줄 수
 *     acct       전달보다 크게 바뀐 계정 — 지출 계정마다 그 달 − 전달, 바뀐 크기 순 ACCT_TOP 개 (0 은 뺀다)
 *     dup        중복 의심 — 그 달(한국 시간)에 생긴 중복 알림 (DB 0033 ledger_notices kind duplicate)
 *   rows 는 항목마다 MEMO_ROWS 줄까지 (n · amount 는 전부로 센다).
 */
import { selectOne, selectMany, callRpc, ValidationError } from '../supabase.js';
import { kstDate } from '../production/service.js';
import { ledgerAccess, assertMoney } from './access.js';
import { VAT_TYPES } from './checks.js';
import { isMissingFunction } from './hints.js';
import { kstMonth, shiftMonth } from './dashboard.js';
import { bookRange } from './entries.js';
import { receivablesOf, openRows } from './money.js';

/** 적격증빙을 받아야 하는 지출 — 합계가 이 값을 넘으면 (DB 0034 c_evidence_min) */
export const EVIDENCE_MIN = 30000;
/** 항목마다 싣는 줄 */
export const MEMO_ROWS = 10;
/** 바뀐 계정 — 크기 순 몇 개 */
export const ACCT_TOP = 3;
/** 셀 때 한 번에 읽는 최대 줄 수 (확인 기다리는 사진 · 알림) */
const COUNT_LIMIT = 1000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MEMO_LABEL = Object.freeze({
  noevid: '증빙 없는 지출',
  simple30k: '3만 원 넘는데 간이영수증',
  invoice: '세금계산서 기다리는 명세표',
  photos: '확인 안 한 사진',
  late: '늦은 받을 돈',
  vat: '부가세',
  acct: '전달보다 크게 바뀐 계정',
  dup: '중복 의심',
});
export const MEMO_KEYS = Object.freeze(Object.keys(MEMO_LABEL));

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const totalOf = (r) => num(r.amount) + num(r.vat_amount);

/** 장부 줄 → 메모 한 줄 (지출) */
const bookLine = (r) => ({
  date: r.entry_date || null,
  name: r.counterparty_name || r.description || null,
  account: r.account || null,
  amount: totalOf(r),
  source: r.source || null,
});

/** 줄 묶음 → { n, amount, rows } */
function lineItem(key, list) {
  return { key, label: MEMO_LABEL[key], n: list.length, amount: list.reduce((s, r) => s + totalOf(r), 0), rows: list.slice(0, MEMO_ROWS).map(bookLine) };
}

/**
 * 장부 줄로 세는 항목 (순수) — 취소 줄은 뺀다.
 *   noevid · simple30k: 그 달 지출 줄
 */
export function bookItems(rows) {
  const live = (rows || []).filter((r) => r && !r.voided_at && r.direction === 'expense');
  return {
    noevid: lineItem('noevid', live.filter((r) => r.evidence_type === 'none')),
    simple30k: lineItem('simple30k', live.filter((r) => r.evidence_type === 'simple_receipt' && totalOf(r) > EVIDENCE_MIN)),
  };
}

/** 전달보다 크게 바뀐 지출 계정 (순수) — cur · prev: ledger_summary accounts (그 달 것만) */
export function accountChanges(cur, prev) {
  const sum = (list) => {
    const m = new Map();
    (list || []).filter((a) => a && a.direction === 'expense').forEach((a) => {
      const k = a.account || '';
      m.set(k, (m.get(k) || 0) + num(a.amount));
    });
    return m;
  };
  const a = sum(cur);
  const b = sum(prev);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const rows = keys
    .map((k) => ({ account: k || null, amount: a.get(k) || 0, prev: b.get(k) || 0 }))
    .map((r) => ({ ...r, diff: r.amount - r.prev, rate: r.prev ? Math.round(((r.amount - r.prev) / r.prev) * 1000) / 10 : null }))
    .filter((r) => r.diff !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || String(x.account).localeCompare(String(y.account)));
  return { key: 'acct', label: MEMO_LABEL.acct, n: Math.min(rows.length, ACCT_TOP), rows: rows.slice(0, ACCT_TOP) };
}

/** 그 달 부가세 (순수) — monthRow: ledger_summary months 의 그 달 줄 */
export function vatItem(monthRow, vatType) {
  const r = monthRow || {};
  const general = vatType === 'general';
  const amount = general ? num(r.income_vat) - num(r.expense_vat) : null;
  return {
    key: 'vat',
    label: MEMO_LABEL.vat,
    n: num(r.vat_unknown),
    amount,
    income_vat: num(r.income_vat),
    expense_vat: num(r.expense_vat),
    counted: general,
  };
}

/** 한국 시간 그 달의 시작 · 끝 (UTC ISO) */
export function kstMonthBounds(month) {
  const start = new Date(`${month}-01T00:00:00+09:00`);
  const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00+09:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** GET /ledger/close-memo */
export async function getCloseMemo(env, { user, company, month, nowMs = Date.now() }) {
  const access = await ledgerAccess(env, user, { company, report: true });
  assertMoney(access);
  const m = month || shiftMonth(kstMonth(nowMs), -1);
  if (!MONTH_RE.test(m)) throw new ValidationError('month 는 YYYY-MM 입니다');
  const prev = shiftMonth(m, -1);
  const base = { month: m, prev_month: prev, level: access.level, viewing: access.viewing };
  const cid = access.companyId;
  const range = bookRange({ month: m });

  let summary, book;
  try {
    summary = await callRpc(env, 'ledger_summary', { p_company: cid, p_from: `${prev}-01`, p_to: range.to });
    book = await callRpc(env, 'ledger_book', { p_company: cid, p_from: range.from, p_to: range.to, p_include_void: false });
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    return { ...base, available: false };
  }
  const s = summary && typeof summary === 'object' ? summary : {};
  const inMonth = (list, mm) => (Array.isArray(list) ? list.filter((r) => r && r.month === mm) : []);
  const settings = await selectOne(env, 'company_settings', { company_id: `eq.${cid}`, select: 'settings' });
  const tax = settings && settings.settings && settings.settings.tax;
  const vatType = tax && VAT_TYPES.includes(tax.vat_type) ? tax.vat_type : null;

  const waiting =
    (await selectMany(env, 'ledger_documents', {
      company_id: `eq.${cid}`,
      review_status: 'in.(pending,held)',
      select: 'id,review_status',
      limit: String(COUNT_LIMIT),
    })) || [];
  const recvRows = await openRows(env, 'order_payments', cid, 'id,order_id,stage,amount,due_on,paid_on', { paid_on: 'is.null' });
  const recv = receivablesOf(recvRows || [], kstDate());
  const { start, end } = kstMonthBounds(m);
  // 그 달 시작부터 읽고 끝은 여기서 자른다 (알림은 COUNT_LIMIT 줄까지)
  const dups = (
    (await selectMany(env, 'ledger_notices', {
      company_id: `eq.${cid}`,
      kind: 'eq.duplicate',
      created_at: `gte.${start}`,
      select: 'id,created_at,data',
      order: 'created_at.asc',
      limit: String(COUNT_LIMIT),
    })) || []
  ).filter((d) => Date.parse(d.created_at) < Date.parse(end));

  const lines = bookItems(book);
  const late = recv.items.filter((x) => x.late);
  const items = {
    noevid: lines.noevid,
    simple30k: lines.simple30k,
    invoice: { key: 'invoice', label: MEMO_LABEL.invoice, n: waiting.filter((r) => r.review_status === 'held').length },
    photos: { key: 'photos', label: MEMO_LABEL.photos, n: waiting.filter((r) => r.review_status === 'pending').length },
    late: {
      key: 'late',
      label: MEMO_LABEL.late,
      n: recv.late_count,
      amount: recv.late_total,
      rows: late.slice(0, MEMO_ROWS).map((x) => ({ order_no: x.order_no, stage: x.stage, due_on: x.due_on, amount: x.amount })),
    },
    vat: vatItem(inMonth(s.months, m)[0], vatType),
    acct: accountChanges(inMonth(s.accounts, m), inMonth(s.accounts, prev)),
    dup: {
      key: 'dup',
      label: MEMO_LABEL.dup,
      n: dups.length,
      rows: dups.slice(0, MEMO_ROWS).map((d) => ({ date: kstDate(d.created_at), name: (d.data && d.data.supplier) || null })),
    },
  };
  return { ...base, available: true, vat_type: vatType, items: MEMO_KEYS.map((k) => items[k]) };
}
