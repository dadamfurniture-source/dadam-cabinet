/**
 * 재고 — 판재 · 철물 품목과 입출고 기록 (마이페이지 6단계 · 구매 · 재고 › 기본 자재 · 철물 · 입출고).
 * 표: database/migrations/0059_stock.sql (stock_items · stock_moves · stock_move()).
 *
 *   GET   /stock/items[?kind=board|hardware]   내 업체 품목 (구성원)
 *     { company { id, name }, can_manage, suppliers [{ id, name }] (대표 · 실장에게만),
 *       items [{ id, kind, name, spec, unit, qty, safety_qty, short, supplier { id, name } | null,
 *                expected_qty, expected_on, memo, active, updated_at }] }
 *     short = 쓰는 품목이고 남은 수량이 안전 재고보다 적다. 안 쓰는(숨긴) 품목은 대표 · 실장에게만 싣는다.
 *   POST  /stock/items                         품목 더하기 (대표 · 실장)
 *     { kind, name, spec?, unit, safety_qty?, supplier_id?, memo?, qty? } — qty 가 있으면 처음 수량을 실사 조정 기록으로 넣는다
 *   PATCH /stock/items/:id                     품목 고치기 (대표 · 실장)
 *     { name?, spec?, unit?, safety_qty?, supplier_id?, memo?, active?, expected_qty?, expected_on? }
 *     입고 예정은 수량 · 받을 날을 같이 보낸다 (둘 다 null 이면 지운다). 남은 수량(qty)은 여기서 못 바꾼다 — 입출고로만.
 *   POST  /stock/items/:id/moves               입출고 한 번 { kind: in|out|adjust, qty, ref?, note? }
 *     입고 · 출고는 구성원 누구나, 실사 조정(adjust — 더하거나 빼는 양)은 대표 · 실장만.
 *     → { move { id, kind, qty, qty_after, ref, note, created_at }, item { id, qty, expected_qty, expected_on } }
 *     남은 수량보다 많이 빼면 422 (details.field = qty).
 *   GET   /stock/moves[?item=<id>]             입출고 기록 새 것부터 STOCK_MOVES_LIMIT 건 (구성원)
 *     { items [{ id, item_id, item_name, item_spec, unit, kind, qty, qty_after, ref, note, by, created_at }] }
 *     by = 적은 사람 이름(지금 구성원일 때만, 아니면 null). 계정 id 는 싣지 않는다.
 *
 * 누가       다담 공장 · active 협력업체 Expert · Agent 의 구성원 (마이페이지 구매 · 재고 메뉴와 같다 — segan/me.js FACTORY_PLANS).
 *            다담 본사(platform) · Manager · 멈춘 업체는 403 not_stock_company.
 * 다른 업체   모든 읽기 · 쓰기를 company_id 로 거른다. 남의 품목 id 는 404, 남의 공급처 id 는 422.
 * 지우기 없음  품목은 active 로 숨기고, 기록은 추가만 한다 (DB 가 서버의 고치기 · 지우기도 막는다).
 * 고객 정보   이 표들에는 고객 이름 · 전화 · 주소 칸이 없다. ref · note 는 사람이 적는 짧은 글(작업 번호 등)이다.
 * DB 0059 적용 전이면 409 db_pending.
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PG_UNIQUE_VIOLATION,
  callRpc,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { companyOf } from './distribution/company.js';
import { membersOf } from './company-assignee.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const STOCK_KINDS = Object.freeze(['board', 'hardware']);
export const MOVE_KINDS = Object.freeze(['in', 'out', 'adjust']);
/** 재고를 쓰는 협력업체 plan (+ 다담 공장) */
export const STOCK_PLANS = Object.freeze(['expert', 'agent']);
export const STOCK_ITEMS_LIMIT = 500;
export const STOCK_MOVES_LIMIT = 200;
export const NAME_MAX = 80;
export const SPEC_MAX = 80;
export const UNIT_MAX = 8;
export const MEMO_MAX = 300;
export const REF_MAX = 60;
export const NOTE_MAX = 200;
/** 수량 한도 — numeric(12,2) 안쪽 */
export const QTY_MAX = 9999999;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ITEM_COLUMNS =
  'id,kind,name,spec,unit,qty,safety_qty,supplier_id,expected_qty,expected_on,memo,active,updated_at';

function dbPending() {
  const err = new ConflictError('DB 0059 적용 전입니다 — 재고는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
/** 표 · 칸 · 함수가 아직 없다 (0059 전) */
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

/** 재고를 쓰는 업체인가 — 다담 공장 · active Expert · Agent */
export function canHoldStock(company) {
  if (!company || company.status !== 'active') return false;
  return company.kind === 'hq' || (company.kind === 'partner' && STOCK_PLANS.includes(company.plan));
}

export async function stockCompanyOf(env, user, { manage = false } = {}) {
  const { companyId, canAct } = await companyOf(env, user, { manage });
  const company = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'id,kind,name,plan,status' });
  if (!canHoldStock(company)) throw new ForbiddenError('재고를 쓸 수 있는 팩토리가 아닙니다', 'not_stock_company');
  return { company, canAct };
}

// ── 순수 ──────────────────────────────────────────────────────

/** 수량 — 0 이상(또는 양수) 유한수, 소수 둘째 자리까지 */
export function qtyOf(v, field, { positive = false, signed = false } = {}) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  const bad = (msg) => new ValidationError(msg, { field });
  if (!Number.isFinite(n)) throw bad('수량은 숫자여야 합니다');
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r) > QTY_MAX) throw bad('수량이 너무 큽니다');
  if (signed) {
    if (r === 0) throw bad('수량은 0 이 될 수 없습니다');
  } else if (positive ? r <= 0 : r < 0) throw bad(positive ? '수량은 0 보다 커야 합니다' : '수량은 0 이상이어야 합니다');
  return r;
}

function textOf(v, field, max, { required = false } = {}) {
  if (v === null || v === undefined) {
    if (required) throw new ValidationError(`${field} 이 필요합니다`, { field });
    return null;
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} 은 글자여야 합니다`, { field });
  const s = v.trim();
  if (!s && required) throw new ValidationError(`${field} 이 필요합니다`, { field });
  if (s.length > max) throw new ValidationError(`${field} 은 ${max}자까지입니다`, { field });
  return s || null;
}

/** 본문 → 품목 칸. partial 이면 온 것만 (고치기) */
export function itemInput(body, { partial = false } = {}) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const out = {};
  if (!partial) {
    if (!STOCK_KINDS.includes(body.kind))
      throw new ValidationError('kind 는 board(판재) 또는 hardware(철물) 입니다', { field: 'kind' });
    out.kind = body.kind;
  }
  if (!partial || has(body, 'name')) out.name = textOf(body.name, 'name', NAME_MAX, { required: true });
  if (!partial || has(body, 'unit')) out.unit = textOf(body.unit, 'unit', UNIT_MAX, { required: true });
  if (has(body, 'spec')) out.spec = textOf(body.spec, 'spec', SPEC_MAX) || '';
  if (has(body, 'memo')) out.memo = textOf(body.memo, 'memo', MEMO_MAX);
  if (has(body, 'safety_qty')) out.safety_qty = qtyOf(body.safety_qty, 'safety_qty');
  if (has(body, 'supplier_id')) {
    if (body.supplier_id !== null && !isUuid(body.supplier_id))
      throw new ValidationError('공급처를 다시 골라 주세요', { field: 'supplier_id' });
    out.supplier_id = body.supplier_id;
  }
  if (partial) {
    if (has(body, 'active')) {
      if (typeof body.active !== 'boolean') throw new ValidationError('active 는 true · false 입니다', { field: 'active' });
      out.active = body.active;
    }
    if (has(body, 'expected_qty') || has(body, 'expected_on')) {
      const q = body.expected_qty;
      const d = body.expected_on;
      if ((q === null || q === undefined) && (d === null || d === undefined)) {
        out.expected_qty = null;
        out.expected_on = null;
      } else {
        out.expected_qty = qtyOf(q, 'expected_qty', { positive: true });
        if (typeof d !== 'string' || !DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))
          throw new ValidationError('받을 날을 넣어 주세요 (YYYY-MM-DD)', { field: 'expected_on' });
        out.expected_on = d;
      }
    }
    if (!Object.keys(out).length) throw new ValidationError('바꿀 칸이 없습니다');
  }
  return out;
}

/** 본문 → 입출고 한 번 */
export function moveInput(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  if (!MOVE_KINDS.includes(body.kind))
    throw new ValidationError('kind 는 in(입고) · out(출고) · adjust(실사 조정) 입니다', { field: 'kind' });
  return {
    kind: body.kind,
    qty: qtyOf(body.qty, 'qty', body.kind === 'adjust' ? { signed: true } : { positive: true }),
    ref: textOf(body.ref, 'ref', REF_MAX),
    note: textOf(body.note, 'note', NOTE_MAX),
  };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

function itemOut(r, supplierName) {
  const qty = num(r.qty) || 0;
  const safety = num(r.safety_qty) || 0;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    spec: r.spec || '',
    unit: r.unit,
    qty,
    safety_qty: safety,
    short: r.active !== false && qty < safety,
    supplier: r.supplier_id && supplierName.has(r.supplier_id) ? { id: r.supplier_id, name: supplierName.get(r.supplier_id) } : null,
    expected_qty: num(r.expected_qty),
    expected_on: r.expected_on || null,
    memo: r.memo || null,
    active: r.active !== false,
    updated_at: r.updated_at || null,
  };
}

/** 내 업체의 쓰는 공급처 — [{ id, name }] */
async function suppliersOf(env, companyId) {
  const rows =
    (await selectMany(env, 'counterparties', {
      company_id: `eq.${companyId}`,
      kind: 'eq.supplier',
      select: 'id,name,active',
      order: 'name.asc',
      limit: '1000',
    })) || [];
  return rows;
}

async function assertSupplier(env, companyId, id) {
  if (id === null || id === undefined) return;
  const row = await selectOne(env, 'counterparties', {
    id: `eq.${id}`,
    company_id: `eq.${companyId}`,
    kind: 'eq.supplier',
    select: 'id',
  });
  if (!row) throw new ValidationError('공급처를 다시 골라 주세요', { field: 'supplier_id' });
}

function mapItemWrite(e) {
  if (isMissing(e)) return dbPending();
  if (e instanceof ConflictError || codeIn(e, PG_UNIQUE_VIOLATION)) {
    const err = new ConflictError('같은 이름 · 규격의 품목이 이미 있습니다');
    err.code = 'duplicate';
    return err;
  }
  return e;
}

// ── 길 ────────────────────────────────────────────────────────

/** GET /stock/items */
export async function listStockItems(env, { user, query = {} }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const kind = query.kind || null;
  if (kind && !STOCK_KINDS.includes(kind)) throw new ValidationError('kind 는 board 또는 hardware 입니다', { field: 'kind' });
  const q = {
    company_id: `eq.${company.id}`,
    select: ITEM_COLUMNS,
    order: 'name.asc,spec.asc',
    limit: String(STOCK_ITEMS_LIMIT),
  };
  if (kind) q.kind = `eq.${kind}`;
  if (!canAct) q.active = 'eq.true';
  const [rows, suppliers] = await Promise.all([
    db(() => selectMany(env, 'stock_items', q)),
    suppliersOf(env, company.id),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  return {
    company: { id: company.id, name: company.name },
    can_manage: canAct,
    suppliers: canAct ? suppliers.filter((s) => s.active !== false).map((s) => ({ id: s.id, name: s.name })) : [],
    items: (rows || []).map((r) => itemOut(r, supplierName)),
  };
}

async function itemOf(env, companyId, id) {
  const gone = () => new NotFoundError('이 팩토리의 품목을 찾을 수 없습니다');
  if (!isUuid(id)) throw gone();
  const row = await db(() =>
    selectOne(env, 'stock_items', { id: `eq.${id}`, company_id: `eq.${companyId}`, select: ITEM_COLUMNS })
  );
  if (!row) throw gone();
  return row;
}

async function oneItemOut(env, companyId, row) {
  const supplierName = new Map();
  if (row.supplier_id) {
    const s = await selectOne(env, 'counterparties', {
      id: `eq.${row.supplier_id}`,
      company_id: `eq.${companyId}`,
      select: 'id,name',
    });
    if (s) supplierName.set(s.id, s.name);
  }
  return itemOut(row, supplierName);
}

async function runMove(env, companyId, itemId, move, userId) {
  let row;
  try {
    row = await callRpc(env, 'stock_move', {
      p_company: companyId,
      p_item: itemId,
      p_kind: move.kind,
      p_qty: move.qty,
      p_ref: move.ref,
      p_note: move.note,
      p_actor: userId,
    });
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    if (codeIn(e, 'P0002')) throw new NotFoundError('이 팩토리의 품목을 찾을 수 없습니다');
    if (codeIn(e, '22023'))
      throw new ValidationError('남은 수량보다 많이 뺄 수 없습니다. 수량이 맞지 않으면 대표 · 실장이 실사 조정으로 고칩니다', {
        field: 'qty',
      });
    throw e;
  }
  const r = Array.isArray(row) ? row[0] : row;
  if (!r || !r.id) throw new DbError('입출고를 적지 못했습니다');
  return r;
}

const moveOut = (r) => ({
  id: r.id,
  kind: r.kind,
  qty: num(r.qty),
  qty_after: num(r.qty_after),
  ref: r.ref_label || null,
  note: r.note || null,
  created_at: r.created_at,
});

/** POST /stock/items */
export async function createStockItem(env, { user, body }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const input = itemInput(body);
  const first = isPlainObject(body) && has(body, 'qty') && body.qty !== null ? qtyOf(body.qty, 'qty') : 0;
  await assertSupplier(env, company.id, input.supplier_id);
  let saved;
  try {
    saved = await insertOne(env, 'stock_items', { ...input, company_id: company.id, created_by: user.id });
  } catch (e) {
    throw mapItemWrite(e);
  }
  const row = Array.isArray(saved) ? saved[0] : saved;
  if (!row || !row.id) throw new DbError('품목을 더하지 못했습니다');
  if (first > 0) {
    const m = await runMove(env, company.id, row.id, { kind: 'adjust', qty: first, ref: null, note: '처음 수량' }, user.id);
    row.qty = m.qty_after;
  }
  return oneItemOut(env, company.id, row);
}

/** PATCH /stock/items/:id */
export async function updateStockItem(env, { user, params, body, nowMs = Date.now() }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const patch = itemInput(body, { partial: true });
  const before = await itemOf(env, company.id, params && params.id);
  if (has(patch, 'supplier_id')) await assertSupplier(env, company.id, patch.supplier_id);
  let rows;
  try {
    rows = await updateBy(
      env,
      'stock_items',
      { id: `eq.${before.id}`, company_id: `eq.${company.id}` },
      { ...patch, updated_at: new Date(nowMs).toISOString() }
    );
  } catch (e) {
    throw mapItemWrite(e);
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new DbError('품목을 고치지 못했습니다');
  return oneItemOut(env, company.id, row);
}

/** POST /stock/items/:id/moves */
export async function addStockMove(env, { user, params, body }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const move = moveInput(body);
  if (move.kind === 'adjust' && !canAct)
    throw new ForbiddenError('실사 조정은 팩토리 대표 · 실장만 할 수 있습니다', 'not_manager');
  const item = await itemOf(env, company.id, params && params.id);
  if (item.active === false) {
    const err = new ConflictError('안 쓰는 품목입니다. 다시 쓰기로 바꾼 뒤 적어 주세요');
    err.code = 'inactive';
    throw err;
  }
  const saved = await runMove(env, company.id, item.id, move, user.id);
  const after = await itemOf(env, company.id, item.id);
  return {
    move: moveOut(saved),
    item: {
      id: after.id,
      qty: num(after.qty) || 0,
      expected_qty: num(after.expected_qty),
      expected_on: after.expected_on || null,
    },
  };
}

/** GET /stock/moves */
export async function listStockMoves(env, { user, query = {} }) {
  const { company } = await stockCompanyOf(env, user);
  const q = {
    company_id: `eq.${company.id}`,
    select: 'id,item_id,kind,qty,qty_after,ref_label,note,actor_user_id,created_at',
    order: 'created_at.desc',
    limit: String(STOCK_MOVES_LIMIT),
  };
  if (query.item) {
    if (!isUuid(query.item)) throw new ValidationError('item 이 맞지 않습니다', { field: 'item' });
    q.item_id = `eq.${query.item}`;
  }
  const rows = (await db(() => selectMany(env, 'stock_moves', q))) || [];
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const [items, members] = await Promise.all([
    itemIds.length
      ? db(() =>
          selectMany(env, 'stock_items', {
            id: `in.(${itemIds.join(',')})`,
            company_id: `eq.${company.id}`,
            select: 'id,name,spec,unit',
            limit: String(STOCK_ITEMS_LIMIT),
          })
        )
      : [],
    rows.length ? membersOf(env, company.id) : [],
  ]);
  const itemBy = new Map((items || []).map((i) => [i.id, i]));
  const nameBy = new Map(members.map((m) => [m.user_id, m.name]));
  return {
    items: rows.map((r) => {
      const it = itemBy.get(r.item_id) || {};
      return {
        ...moveOut(r),
        item_id: r.item_id,
        item_name: it.name || null,
        item_spec: it.spec || '',
        unit: it.unit || null,
        by: (r.actor_user_id && nameBy.get(r.actor_user_id)) || null,
      };
    }),
  };
}
