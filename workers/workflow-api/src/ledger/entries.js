/**
 * 회계장부 — 장부 줄 (수주 밖 돈) · 장부 보기 · 계정 목록.
 *
 *   POST /ledger/entries               직접 입력 (대표 · 실장, 자격 full). X-Idempotency-Key 가 같으면 처음 줄을 돌려준다
 *   POST /ledger/entries/:id/void      취소 — 이유 필수. 줄은 지우지 않는다 (DB 트리거가 지우기를 막는다)
 *   POST /ledger/entries/:id/correct   고치기 — 원래 줄 취소 + 바꾼 칸만 다른 새 줄 (DB 함수 ledger_correct_entry)
 *   GET  /ledger/book                  장부 줄 + 수주 수금 + 수주 원가를 합친 것 (DB 함수 ledger_book) — 대표 · 실장, 자격 read 도
 *   GET  /ledger/accounts              계정 목록 (국세청 서식 항목 그대로 — ledger_accounts)
 *   GET  /ledger/orders                사진을 수주 원가로 올릴 때 고르는 수주 — 자기 업체의 취소 안 한 수주만
 *                                      (ledger_post_document 가 사진과 같은 업체 수주만 받는다. GET /orders 는 업체를 가리지 않는다)
 *   보기 주소(book · accounts)는 ?company= 를 받는다 — 본사 대표 · 실장이 공장 장부를 볼 때 (access.js)
 *
 * 쓰기는 asActor 로 부른다 — 바꾼 사람이 ledger_events 에 남는다.
 */
import { selectOne, selectMany, insertOne, updateBy, callRpc, asActor, ValidationError, NotFoundError, ConflictError } from '../supabase.js';
import { kstDate } from '../production/service.js';
import { ledgerAccess, assertMoney, assertWritable } from './access.js';
import { parseEntryInput, reasonOf, idempotencyKeyOf, groupTakes, isDate, isUuid } from './checks.js';

export const ENTRY_COLS =
  'id,seq,entry_date,direction,account,description,counterparty_id,counterparty_name,counterparty_biz_no,amount,vat_amount,evidence_type,payment_method,source,created_by,created_at,voided_at,voided_by,void_reason,replaces_id';
/** 수주 고르기 목록 — 최근 수주부터 */
export const ORDER_PICK_LIMIT = 200;
/** 장부 보기 한 번에 — 1년 */
export const BOOK_MAX_DAYS = 366;
const MONTH_RE = /^\d{4}-\d{2}$/;
const SOURCE_ORDER = { entry: 0, payment: 1, cost: 2 };

function entryView(row) {
  const out = {};
  for (const k of ENTRY_COLS.split(',')) out[k] = row[k] === undefined ? null : row[k];
  return out;
}

/** 계정 목록 — 차례대로 */
export async function loadAccounts(env) {
  return (await selectMany(env, 'ledger_accounts', { select: 'code,name,grp,sort,note,active', order: 'sort.asc' })) || [];
}

/** 그 계정이 있고 쓰이며 그 방향을 받는가 — 아니면 422 (DB 트리거와 같은 판정을 먼저 한다). accounts 를 주면 다시 읽지 않는다 */
export async function checkAccount(env, account, direction, accounts = null) {
  const a = (accounts || (await loadAccounts(env))).find((x) => x.code === account);
  if (!a || !a.active) throw new ValidationError('없는 계정입니다');
  if (!groupTakes(a.grp, direction)) throw new ValidationError(`「${a.name}」 계정은 이 방향(${direction})에 쓰지 않습니다`);
}

/** 거래처를 골랐으면 그 업체 거래처여야 한다. 이름 · 사업자번호를 안 적었으면 거래처 것을 남긴다 */
export async function withCounterparty(env, companyId, input) {
  if (!input.counterparty_id) return input;
  const cp = await selectOne(env, 'counterparties', { id: `eq.${input.counterparty_id}`, company_id: `eq.${companyId}`, select: 'id,name,biz_no' });
  if (!cp) throw new ValidationError('이 팩토리 거래처가 아닙니다');
  const out = { ...input };
  if (!out.counterparty_name) out.counterparty_name = cp.name || null;
  if (!out.counterparty_biz_no && cp.biz_no) out.counterparty_biz_no = cp.biz_no;
  return out;
}

async function entryByKey(env, companyId, key) {
  return selectOne(env, 'ledger_entries', { company_id: `eq.${companyId}`, idempotency_key: `eq.${key}`, select: ENTRY_COLS });
}

async function entryOf(env, companyId, entryId) {
  const row = isUuid(entryId)
    ? await selectOne(env, 'ledger_entries', { id: `eq.${entryId}`, company_id: `eq.${companyId}`, select: ENTRY_COLS })
    : null;
  if (!row) throw new NotFoundError('장부 줄을 찾을 수 없습니다');
  if (row.voided_at) throw new ConflictError('이미 취소한 줄입니다');
  return row;
}

/** 직접 입력 → { entry, reused } */
export async function createEntry(env, { user, body, idempotencyKey }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  const key = idempotencyKeyOf(idempotencyKey);
  let input = parseEntryInput(body);
  if (key) {
    const prev = await entryByKey(env, access.companyId, key);
    if (prev) return { entry: entryView(prev), reused: true };
  }
  await checkAccount(env, input.account, input.direction);
  input = await withCounterparty(env, access.companyId, input);
  const row = {
    company_id: access.companyId,
    ...input,
    source: 'manual',
    created_by: user.id,
    idempotency_key: key,
  };
  try {
    return { entry: entryView(await insertOne(asActor(env, user), 'ledger_entries', row)), reused: false };
  } catch (e) {
    // 같은 키로 동시에 두 번 — 먼저 들어간 줄
    if (e instanceof ConflictError && key) {
      const prev = await entryByKey(env, access.companyId, key);
      if (prev) return { entry: entryView(prev), reused: true };
    }
    throw e;
  }
}

/** 취소 → 취소한 줄 */
export async function voidEntry(env, { user, entryId, body }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  const reason = reasonOf(body && body.reason);
  await entryOf(env, access.companyId, entryId);
  const rows = await updateBy(
    asActor(env, user),
    'ledger_entries',
    { id: `eq.${entryId}`, company_id: `eq.${access.companyId}`, voided_at: 'is.null' },
    { voided_at: new Date().toISOString(), voided_by: user.id, void_reason: reason },
  );
  if (!rows || !rows.length) throw new ConflictError('이미 취소한 줄입니다');
  return { entry: entryView(rows[0]) };
}

/** 고치기 → { entry: 새 줄, replaced: 원래 줄 id } */
export async function correctEntry(env, { user, entryId, body }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  const reason = reasonOf(body && body.reason);
  const fields = { ...(body || {}) };
  delete fields.reason;
  let patch = parseEntryInput(fields, { partial: true });
  const old = await entryOf(env, access.companyId, entryId);
  const same = Object.keys(patch).every((k) => String(patch[k] ?? '') === String(old[k] ?? ''));
  if (same) throw new ValidationError('바뀐 칸이 없습니다');
  if ('account' in patch || 'direction' in patch) {
    await checkAccount(env, patch.account || old.account, patch.direction || old.direction);
  }
  if (patch.counterparty_id && patch.counterparty_id !== old.counterparty_id) {
    patch = await withCounterparty(env, access.companyId, patch);
  }
  const r = await callRpc(asActor(env, user), 'ledger_correct_entry', { p_entry: entryId, p_actor: user.id, p_payload: patch, p_reason: reason });
  if (!r || r.ok !== true) {
    if (r && r.reason === 'voided') throw new ConflictError('이미 취소한 줄입니다');
    throw new NotFoundError('장부 줄을 찾을 수 없습니다');
  }
  const fresh = await selectOne(env, 'ledger_entries', { id: `eq.${r.entry_id}`, company_id: `eq.${access.companyId}`, select: ENTRY_COLS });
  return { entry: entryView(fresh || { id: r.entry_id }), replaced: entryId };
}

/** 'YYYY-MM' 의 첫날 · 끝날 */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** 보기 범위 — month 또는 from · to (1년까지). 없으면 이번 달(KST) */
export function bookRange({ month, from, to, today = kstDate() }) {
  if (from || to) {
    if (!isDate(from) || !isDate(to)) throw new ValidationError('from · to 는 YYYY-MM-DD 날짜입니다');
    if (from > to) throw new ValidationError('from 이 to 보다 늦습니다');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days > BOOK_MAX_DAYS) throw new ValidationError(`한 번에 ${BOOK_MAX_DAYS}일까지 봅니다`);
    return { from, to };
  }
  if (month) {
    if (!MONTH_RE.test(month) || !isDate(`${month}-01`)) throw new ValidationError('month 는 YYYY-MM 입니다');
    return monthRange(month);
  }
  return monthRange(today.slice(0, 7));
}

/**
 * 장부 줄 합계 (순수) — 취소 줄은 빼고 센다.
 *   income · expense · asset_buy · asset_sell  금액(공급가) 합
 *   income_vat · expense_vat                   부가세 칸 합 (수금의 부가세는 계산값)
 *   vat_unknown                                부가세를 모르는 줄 수 — 옛 원가 줄(미기재), 일반과세가 아닌 업체의 수금
 *   account_unknown                            계정이 없는 줄 수 — 아직 잇지 않은 원가 종류(노무 · 외주)
 */
export function bookTotals(rows) {
  const t = { income: 0, expense: 0, asset_buy: 0, asset_sell: 0, income_vat: 0, expense_vat: 0, vat_unknown: 0, account_unknown: 0 };
  for (const r of rows || []) {
    if (r.voided_at) continue;
    const amount = Number(r.amount) || 0;
    if (r.direction in t) t[r.direction] += amount;
    if (r.vat_amount === null || r.vat_amount === undefined) t.vat_unknown += 1;
    else if (r.direction === 'income') t.income_vat += Number(r.vat_amount) || 0;
    else if (r.direction === 'expense') t.expense_vat += Number(r.vat_amount) || 0;
    if (!r.account) t.account_unknown += 1;
  }
  return t;
}

/** 일자 → 장부 줄 · 수금 · 원가 → 입력 차례 */
export function sortBook(rows) {
  return [...(rows || [])].sort((a, b) =>
    String(a.entry_date).localeCompare(String(b.entry_date))
    || (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9)
    || (Number(a.seq) || 0) - (Number(b.seq) || 0)
    || String(a.id).localeCompare(String(b.id)));
}

/** GET /ledger/book */
export async function getBook(env, { user, company, month, from, to, includeVoid }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  const range = bookRange({ month, from, to });
  const rows = await callRpc(env, 'ledger_book', {
    p_company: access.companyId,
    p_from: range.from,
    p_to: range.to,
    p_include_void: Boolean(includeVoid),
  });
  const sorted = sortBook(rows);
  return { ...range, company_id: access.companyId, rows: sorted, totals: bookTotals(sorted), level: access.level, viewing: access.viewing };
}

/** GET /ledger/accounts — 쓰는 계정만 */
/** 수주 원가로 올릴 수주 — 대표 · 실장, 자기 업체(쓰기는 언제나 자기 업체). 금액 칸은 싣지 않는다 */
export async function listLedgerOrders(env, { user }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  const rows = (await selectMany(env, 'orders', {
    select: 'id,order_no,customer_name,status,ordered_at',
    company_id: `eq.${access.companyId}`,
    status: 'neq.cancelled',
    order: 'ordered_at.desc',
    limit: String(ORDER_PICK_LIMIT),
  })) || [];
  return { items: rows.map(({ id, order_no, customer_name, status, ordered_at }) => ({ id, order_no, customer_name, status, ordered_at })) };
}

export async function listAccounts(env, { user, company }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  return { items: (await loadAccounts(env)).filter((a) => a.active).map(({ code, name, grp, note }) => ({ code, name, grp, note })) };
}
