/**
 * 재고 구매 발주 — 철물 · 판재를 공급처에 발주한 기록과 입고 (마이페이지 구매 · 재고 › 발주).
 * 표 · 함수: database/migrations/0062_stock_orders.sql (stock_orders · stock_order_lines · stock_order_place · receive · cancel).
 * (생산 › 외주 발주는 수주에 딸린 도어 · 상판 외주 — src/reports/service.js. 이것과 다르다)
 *
 *   GET  /stock/orders                    내 업체 발주 — 새 것부터 STOCK_ORDERS_LIMIT 건 (구성원)
 *     { can_manage, company { name }, items [{ id, code, state, supplier { id, name } | null, expected_on, note,
 *                                              by, created_at, closed_at,
 *                                              lines [{ id, item_id, name, spec, unit, qty, received_qty }] }] }
 *     code = 'PO-0001' (업체마다 차례). state = ordered 발주함 · received 입고 끝 · cancelled 취소
 *   POST /stock/orders                    발주 넣기 (대표 · 실장) { supplier_id?, expected_on, note?, lines [{ item_id, qty }] (1 ~ ORDER_LINES_MAX) }
 *     품목의 「입고 예정」이 그만큼 늘어난다. 같은 품목을 두 번 넣으면 422.
 *   POST /stock/orders/:id/receive        입고 (구성원 — 입고는 누구나, 2026-11-12 결정 ①) { qtys?: { <줄 id>: 들어온 수량 } }
 *     qtys 에 없는 줄은 발주 수량 그대로. 재고가 늘고 발주가 닫힌다. 덜 온 만큼은 더 기다리지 않는다(입고 예정에서 뺀다).
 *   POST /stock/orders/:id/cancel         취소 (대표 · 실장) — 입고 예정에서 빼고 닫는다
 *     끝난 발주에 입고 · 취소를 하면 409 closed.
 *
 * 누가       stock.js 와 같다 (stockCompanyOf — 다담 공장 · active Expert · Agent 구성원).
 * 다른 업체   모든 읽기 · 쓰기를 company_id 로 거른다. 남의 발주 id 는 404, 남의 품목 · 공급처 id 는 422.
 * 금액       싣지 않는다 — 발주에는 수량만 있다 (단가는 품목에, 대표 · 실장만).
 * 고객 정보   없다. note 는 사람이 적는 짧은 글이다.
 * DB 0062 적용 전이면 409 db_pending.
 */

import { ConflictError, DbError, ForbiddenError, NotFoundError, ValidationError, callRpc, selectMany, selectOne } from './supabase.js';
import { stockCompanyOf, qtyOf, STOCK_ITEMS_LIMIT } from './stock.js';
import { membersOf } from './company-assignee.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ORDER_STATES = Object.freeze(['ordered', 'received', 'cancelled']);
export const STOCK_ORDERS_LIMIT = 200;
export const ORDER_LINES_MAX = 30;
export const ORDER_NOTE_MAX = 200;

const COLUMNS = 'id,seq,supplier_id,expected_on,state,note,created_by,created_at,closed_at';

function dbPending() {
  const err = new ConflictError('DB 0062 적용 전입니다 — 발주는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
const codeIn = (e, code) => e instanceof DbError && String(e.message || '').includes(`"${code}"`);
async function db(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
}

// ── 순수 ──────────────────────────────────────────────────────

/** 번호 → 'PO-0001' */
export const orderCode = (seq) => `PO-${String(seq).padStart(4, '0')}`;

function realDay(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}

/** 본문 → 발주 넣기 */
export function orderInput(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  if (!realDay(body.expected_on)) throw new ValidationError('받을 날을 넣어 주세요 (YYYY-MM-DD)', { field: 'expected_on' });
  const supplier = body.supplier_id === undefined ? null : body.supplier_id;
  if (supplier !== null && !isUuid(supplier)) throw new ValidationError('공급처를 다시 골라 주세요', { field: 'supplier_id' });
  let note = null;
  if (body.note !== null && body.note !== undefined) {
    if (typeof body.note !== 'string') throw new ValidationError('note 는 글자여야 합니다', { field: 'note' });
    note = body.note.trim() || null;
    if (note && note.length > ORDER_NOTE_MAX) throw new ValidationError(`note 는 ${ORDER_NOTE_MAX}자까지입니다`, { field: 'note' });
  }
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > ORDER_LINES_MAX)
    throw new ValidationError(`품목은 1 ~ ${ORDER_LINES_MAX}줄입니다`, { field: 'lines' });
  const seen = new Set();
  const lines = body.lines.map((l) => {
    if (!isPlainObject(l) || !isUuid(l.item_id)) throw new ValidationError('품목을 다시 골라 주세요', { field: 'lines' });
    if (seen.has(l.item_id)) throw new ValidationError('같은 품목이 두 번 들어 있습니다', { field: 'lines' });
    seen.add(l.item_id);
    return { item_id: l.item_id, qty: qtyOf(l.qty, 'lines', { positive: true }) };
  });
  return { supplier_id: supplier, expected_on: body.expected_on, note, lines };
}

/** 본문 → 들어온 수량 { 줄 id: 수량 } (없으면 null — 발주 수량 그대로) */
export function receiveInput(body) {
  if (body === null || body === undefined) return null;
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  if (body.qtys === null || body.qtys === undefined) return null;
  if (!isPlainObject(body.qtys)) throw new ValidationError('qtys 는 { 줄 id: 수량 } 입니다', { field: 'qtys' });
  const out = {};
  for (const [id, v] of Object.entries(body.qtys)) {
    if (!isUuid(id)) throw new ValidationError('줄을 다시 골라 주세요', { field: 'qtys' });
    out[id] = qtyOf(v, 'qtys');
  }
  return Object.keys(out).length ? out : null;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

// ── 읽기 ──────────────────────────────────────────────────────

/** 발주 줄들을 품목 이름과 함께 — Map(order_id → [line]) */
async function linesOf(env, companyId, orderIds) {
  const out = new Map();
  if (!orderIds.length) return out;
  const rows =
    (await db(() =>
      selectMany(env, 'stock_order_lines', {
        order_id: `in.(${orderIds.join(',')})`,
        company_id: `eq.${companyId}`,
        select: 'id,order_id,item_id,qty,received_qty',
        order: 'id.asc',
        limit: String(STOCK_ORDERS_LIMIT * ORDER_LINES_MAX),
      })
    )) || [];
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const items = itemIds.length
    ? (await db(() =>
        selectMany(env, 'stock_items', {
          id: `in.(${itemIds.join(',')})`,
          company_id: `eq.${companyId}`,
          select: 'id,name,spec,unit',
          limit: String(STOCK_ITEMS_LIMIT),
        })
      )) || []
    : [];
  const itemBy = new Map(items.map((i) => [i.id, i]));
  for (const r of rows) {
    const it = itemBy.get(r.item_id) || {};
    if (!out.has(r.order_id)) out.set(r.order_id, []);
    out.get(r.order_id).push({
      id: r.id,
      item_id: r.item_id,
      name: it.name || null,
      spec: it.spec || '',
      unit: it.unit || null,
      qty: num(r.qty),
      received_qty: num(r.received_qty),
    });
  }
  return out;
}

async function ordersOut(env, company, rows) {
  const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))];
  const [lines, suppliers, members] = await Promise.all([
    linesOf(
      env,
      company.id,
      rows.map((r) => r.id)
    ),
    supplierIds.length
      ? selectMany(env, 'counterparties', { id: `in.(${supplierIds.join(',')})`, company_id: `eq.${company.id}`, select: 'id,name' })
      : [],
    rows.length ? membersOf(env, company.id) : [],
  ]);
  const supplierBy = new Map((suppliers || []).map((s) => [s.id, s.name]));
  const nameBy = new Map(members.map((m) => [m.user_id, m.name]));
  return rows.map((r) => ({
    id: r.id,
    code: orderCode(r.seq),
    state: r.state,
    supplier: r.supplier_id && supplierBy.has(r.supplier_id) ? { id: r.supplier_id, name: supplierBy.get(r.supplier_id) } : null,
    expected_on: r.expected_on,
    note: r.note || null,
    by: (r.created_by && nameBy.get(r.created_by)) || null,
    created_at: r.created_at,
    closed_at: r.closed_at || null,
    lines: lines.get(r.id) || [],
  }));
}

/** GET /stock/orders */
export async function listStockOrders(env, { user }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const rows =
    (await db(() =>
      selectMany(env, 'stock_orders', {
        company_id: `eq.${company.id}`,
        select: COLUMNS,
        order: 'created_at.desc,seq.desc',
        limit: String(STOCK_ORDERS_LIMIT),
      })
    )) || [];
  return { can_manage: canAct, company: { name: company.name }, items: await ordersOut(env, company, rows) };
}

async function orderOf(env, company, id) {
  const row = await db(() => selectOne(env, 'stock_orders', { id: `eq.${id}`, company_id: `eq.${company.id}`, select: COLUMNS }));
  if (!row) throw new NotFoundError('이 팩토리의 발주를 찾을 수 없습니다');
  return (await ordersOut(env, company, [row]))[0];
}

// ── 쓰기 ──────────────────────────────────────────────────────

const gone = () => new NotFoundError('이 팩토리의 발주를 찾을 수 없습니다');
function closed() {
  const err = new ConflictError('이미 입고했거나 취소한 발주입니다');
  err.code = 'closed';
  return err;
}

async function rpc(env, fn, args) {
  let row;
  try {
    row = await callRpc(env, fn, args);
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
  const r = Array.isArray(row) ? row[0] : row;
  if (!r || !r.id) throw new DbError('발주를 처리하지 못했습니다');
  return r;
}

/** POST /stock/orders */
export async function createStockOrder(env, { user, body }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const input = orderInput(body);
  if (input.supplier_id) {
    const s = await selectOne(env, 'counterparties', {
      id: `eq.${input.supplier_id}`,
      company_id: `eq.${company.id}`,
      kind: 'eq.supplier',
      select: 'id',
    });
    if (!s) throw new ValidationError('공급처를 다시 골라 주세요', { field: 'supplier_id' });
  }
  // 내 업체의 쓰는 품목만 — 함수도 다시 막지만 여기서 먼저 알기 쉬운 말로 거른다
  const ids = input.lines.map((l) => l.item_id);
  const mine =
    (await db(() =>
      selectMany(env, 'stock_items', {
        id: `in.(${ids.join(',')})`,
        company_id: `eq.${company.id}`,
        active: 'eq.true',
        select: 'id',
        limit: String(ORDER_LINES_MAX),
      })
    )) || [];
  if (mine.length !== ids.length) throw new ValidationError('품목을 다시 골라 주세요 (숨긴 품목은 발주할 수 없습니다)', { field: 'lines' });
  let row;
  try {
    row = await rpc(env, 'stock_order_place', {
      p_company: company.id,
      p_supplier: input.supplier_id,
      p_expected_on: input.expected_on,
      p_note: input.note,
      p_lines: input.lines,
      p_actor: user.id,
    });
  } catch (e) {
    if (codeIn(e, 'P0002') || codeIn(e, '23503') || codeIn(e, '22023'))
      throw new ValidationError('품목을 다시 골라 주세요', { field: 'lines' });
    throw e;
  }
  return orderOf(env, company, row.id);
}

async function closeOrder(env, company, id, fn, args) {
  if (!isUuid(id)) throw gone();
  let row;
  try {
    row = await rpc(env, fn, { p_company: company.id, p_order: id, ...args });
  } catch (e) {
    if (codeIn(e, 'P0002')) throw gone();
    if (codeIn(e, '22023')) throw closed();
    throw e;
  }
  return orderOf(env, company, row.id);
}

/** POST /stock/orders/:id/receive */
export async function receiveStockOrder(env, { user, params, body }) {
  const { company } = await stockCompanyOf(env, user);
  const qtys = receiveInput(body);
  const id = params && params.id;
  if (qtys && isUuid(id)) {
    // 그 발주의 줄만 받는다
    const lines = await linesOf(env, company.id, [id]);
    const known = new Set((lines.get(id) || []).map((l) => l.id));
    if (!Object.keys(qtys).every((k) => known.has(k))) throw new ValidationError('줄을 다시 골라 주세요', { field: 'qtys' });
  }
  return closeOrder(env, company, id, 'stock_order_receive', { p_actor: user.id, p_qtys: qtys });
}

/** POST /stock/orders/:id/cancel */
export async function cancelStockOrder(env, { user, params }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  if (!canAct) throw new ForbiddenError('발주 취소는 팩토리 대표 · 실장만 할 수 있습니다', 'not_manager');
  return closeOrder(env, company, params && params.id, 'stock_order_cancel', { p_actor: user.id });
}
