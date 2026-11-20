/**
 * 밴드 재고 (2026-11-19 사장님 「빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청.」
 *   · 질문 창 「PB 15T · 몸통 색마다 따로」 · 「알림 + 「밴드 만들기」 줄」 · 「「작업 자재」 출고 누를 때 같이」).
 * 표 · 함수: database/migrations/0074_band_stock.sql (stock_items kind band · band_color, stock_band_requests, stock_band_request/make/cancel()).
 *
 *   GET  /stock/bands                         밴드 재고 (구성원)
 *     { can_manage, mode, band { width, length, material, thickness, base, reorder },
 *       items [{ id, color, name, spec, unit, qty, expected_qty, request { id, code, qty, created_at } | null }],
 *       requests [{ id, code, color, qty, state, created_at, closed_at }] (최근 30) }
 *   POST /stock/bands/items                   밴드 품목 만들기 (대표 · 실장) { colors?: [색 이름 …] }
 *     색을 주지 않으면 생산 설정의 몸통 색 목록 + 색 없음. 이미 있는 색은 건너뛴다. 새 품목마다 「밴드 만들기」 요청(만드는 수 — 「18개 기본 재고로 만들고」)
 *   POST /stock/bands/requests/:id/made       만들었음 (구성원) { sheet_item_id? } — 밴드 입고 + 원장 1장 출고(원장 품목을 주면), 한 번에
 *   POST /stock/bands/requests/:id/cancel     요청 취소 (대표 · 실장)
 *
 *   bandReorderCheck(env, companyId, itemIds) — 출고(작업 자재 · 입출고) 뒤에 부른다: 밴드 품목 가운데 남은 수가 요청 수(reorder) 이하이고 열린 요청이 없으면
 *     요청을 열고(만드는 수) 대표 · 실장에게 알림 stock_band_low. 던지지 않는다 — 출고는 이미 끝났다.
 *
 * 숫자(폭 · 길이 · 만드는 수 · 요청 수)는 생산 설정 band 묶음이 정한다 (production/service.js bandOf — 기본 60 × 2440 PB 15T · 18 · 8).
 * 누가 · 다른 업체 · DB 적용 전은 stock.js 와 같다 (stockCompanyOf · company_id 로 거름 · 409 db_pending).
 */

import { ConflictError, DbError, MONEY_ROLES, NotFoundError, ValidationError, callRpc, insertOne, selectMany, selectOne } from './supabase.js';
import { stockCompanyOf } from './stock.js';
import { companySettings } from './production/service.js';
import { notifyRoles } from './push/outbox.js';
import { buildMessage } from './push/messages.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (v == null || v === '' ? null : Number(v));

/** 색 이름 한도 — DB stock_items_band_check 와 같다 */
export const BAND_COLOR_MAX = 40;
/** 한 번에 만드는 밴드 품목 수 */
export const BAND_ITEMS_MAX = 40;
/** 최근 요청 몇 건 */
export const BAND_REQUESTS_LIMIT = 30;
/** 색 없음 — 몸통 색을 정하지 않은 설계의 밴드 */
export const NO_COLOR = '';
export const NO_COLOR_LABEL = '색 없음';

const ITEM_COLUMNS = 'id,kind,name,spec,unit,qty,expected_qty,active,band_color';
const REQUEST_COLUMNS = 'id,seq,item_id,qty,state,created_at,closed_at';

function dbPending() {
  const err = new ConflictError('DB 0074 적용 전입니다 — 밴드 재고는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883|23514/.test(String(e.message || ''));
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

/** 요청 번호 BM-0001 */
export const requestCode = (seq) => `BM-${String(seq).padStart(4, '0')}`;
/** 색 이름 정리 — 빈칸 하나로, 40자 넘으면 null */
export function colorName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length <= BAND_COLOR_MAX ? s : null;
}
export const colorLabel = (c) => (c ? c : NO_COLOR_LABEL);

/** 밴드 품목 줄 — 이름 · 규격 · 단위 (재고 화면 · 입출고 기록에 보인다) */
export function bandItemRow(companyId, color, band, userId) {
  return {
    company_id: companyId,
    kind: 'band',
    band_color: color,
    name: `밴드 ${band.width}×${band.length}`,
    spec: `${band.material} ${band.thickness}T · ${colorLabel(color)}`,
    unit: '본',
    created_by: userId || null,
  };
}

/** 남은 수가 요청 수 이하인가 — 「8개가 남으면」 */
export const needsRequest = (qty, reorder) => Number(qty) <= Number(reorder);

/** 재단 배치의 재고 밴드 묶음 → 색마다 본 수 [{ color, strips }] */
export function bandStripsOf(groups) {
  const by = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!isPlainObject(g)) continue;
    const n = Number.isInteger(g.strips) ? g.strips : Array.isArray(g.cuts) ? g.cuts.length : 0;
    if (!(n > 0)) continue;
    const c = colorName(g.color == null ? '' : String(g.color));
    if (c === null) continue;
    by.set(c, (by.get(c) || 0) + n);
  }
  return [...by].map(([color, strips]) => ({ color, strips }));
}

// ── 읽기 ──────────────────────────────────────────────────────

async function bandItemsOf(env, companyId) {
  return (await db(() => selectMany(env, 'stock_items', { company_id: `eq.${companyId}`, kind: 'eq.band', select: ITEM_COLUMNS, order: 'band_color.asc', limit: '200' }))) || [];
}

/** GET /stock/bands */
export async function listStockBands(env, { user }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const [settings, items, requests] = await Promise.all([
    companySettings(env, company.id),
    bandItemsOf(env, company.id),
    db(() => selectMany(env, 'stock_band_requests', { company_id: `eq.${company.id}`, select: REQUEST_COLUMNS, order: 'created_at.desc', limit: String(BAND_REQUESTS_LIMIT) })),
  ]);
  const band = settings.settings.band;
  const colorBy = new Map(items.map((i) => [i.id, i.band_color]));
  const open = new Map((requests || []).filter((r) => r.state === 'requested').map((r) => [r.item_id, r]));
  return {
    can_manage: canAct,
    mode: band.mode,
    band: { width: band.width, length: band.length, material: band.material, thickness: band.thickness, base: band.base, reorder: band.reorder },
    items: items
      .filter((i) => canAct || i.active !== false)
      .map((i) => {
        const r = open.get(i.id);
        return {
          id: i.id,
          color: i.band_color || '',
          name: i.name,
          spec: i.spec || '',
          unit: i.unit,
          qty: num(i.qty) || 0,
          expected_qty: num(i.expected_qty),
          active: i.active !== false,
          short: needsRequest(num(i.qty) || 0, band.reorder),
          request: r ? { id: r.id, code: requestCode(r.seq), qty: num(r.qty), created_at: r.created_at } : null,
        };
      }),
    requests: (requests || []).map((r) => ({ id: r.id, code: requestCode(r.seq), color: colorBy.has(r.item_id) ? colorBy.get(r.item_id) || '' : null, qty: num(r.qty), state: r.state, created_at: r.created_at, closed_at: r.closed_at || null })),
  };
}

// ── 요청 · 알림 ───────────────────────────────────────────────

async function openRequest(env, companyId, itemId, qty, actorId) {
  const row = await callRpc(env, 'stock_band_request', { p_company: companyId, p_item: itemId, p_qty: qty, p_actor: actorId || null });
  return Array.isArray(row) ? row[0] : row;
}

async function notifyLow(env, companyId, req, color, qty) {
  const msg = buildMessage('stock_band_low', { color, qty, make: num(req.qty) });
  if (!msg) return 0;
  return notifyRoles(env, { companyId, roles: MONEY_ROLES, kind: 'stock_band_low', ...msg, refId: req.id });
}

/**
 * 출고 뒤 — 남은 수가 요청 수 이하인 밴드 품목에 「밴드 만들기」 요청 + 알림. 던지지 않는다.
 * @param {string[]} itemIds 방금 빠진 품목 (밴드가 아니면 건너뛴다). 비우면 그 업체 밴드 품목 모두
 * @returns {Promise<number>} 새로 연 요청 수
 */
export async function bandReorderCheck(env, companyId, itemIds = [], actorId = null) {
  try {
    const want = new Set((itemIds || []).filter(isUuid));
    const [settings, items] = await Promise.all([companySettings(env, companyId), bandItemsOf(env, companyId)]);
    const band = settings.settings.band;
    if (band.mode !== 'stock') return 0;
    let opened = 0;
    for (const it of items) {
      if (it.active === false || (want.size && !want.has(it.id))) continue;
      const qty = num(it.qty) || 0;
      if (!needsRequest(qty, band.reorder)) continue;
      const before = await selectOne(env, 'stock_band_requests', { item_id: `eq.${it.id}`, state: 'eq.requested', select: 'id' });
      if (before) continue;
      const req = await openRequest(env, companyId, it.id, band.base, actorId);
      if (!req || !req.id) continue;
      opened += 1;
      await notifyLow(env, companyId, req, it.band_color || '', qty);
    }
    return opened;
  } catch (e) {
    console.warn('[stock-bands] reorder check failed:', e && (e.code || e.status) ? e.code || e.status : 'error');
    return 0;
  }
}

// ── 쓰기 ──────────────────────────────────────────────────────

/** POST /stock/bands/items */
export async function createBandItems(env, { user, body }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const settings = await companySettings(env, company.id);
  const band = settings.settings.band;
  let colors;
  if (isPlainObject(body) && body.colors !== undefined) {
    if (!Array.isArray(body.colors) || !body.colors.length || body.colors.length > BAND_ITEMS_MAX) throw new ValidationError(`색은 1 ~ ${BAND_ITEMS_MAX}개입니다`, { field: 'colors' });
    colors = body.colors.map((c) => {
      const n = colorName(c);
      if (n === null) throw new ValidationError(`색 이름은 ${BAND_COLOR_MAX}자까지입니다`, { field: 'colors' });
      return n;
    });
  } else {
    colors = settings.settings.colors.body.map(colorName).filter((c) => c !== null).concat([NO_COLOR]);
  }
  colors = [...new Set(colors)].slice(0, BAND_ITEMS_MAX);
  const have = new Set((await bandItemsOf(env, company.id)).map((i) => i.band_color || ''));
  const made = [];
  for (const color of colors) {
    if (have.has(color)) continue;
    let row;
    try {
      row = await db(() => insertOne(env, 'stock_items', bandItemRow(company.id, color, band, user.id)));
    } catch (e) {
      if (codeIn(e, '23505')) continue;   // 그 사이 다른 사람이 만들었다
      throw e;
    }
    const item = Array.isArray(row) ? row[0] : row;
    if (!item || !item.id) continue;
    // 「18개 기본 재고로 만들고」 — 새 품목은 0개라 바로 만들기 요청
    const req = await openRequest(env, company.id, item.id, band.base, user.id);
    if (req && req.id) await notifyLow(env, company.id, req, color, 0);
    made.push({ id: item.id, color });
  }
  return { made, skipped: colors.length - made.length };
}

async function requestOf(env, companyId, id) {
  const gone = () => new NotFoundError('이 팩토리의 밴드 만들기 요청을 찾을 수 없습니다');
  if (!isUuid(id)) throw gone();
  const row = await db(() => selectOne(env, 'stock_band_requests', { id: `eq.${id}`, company_id: `eq.${companyId}`, select: REQUEST_COLUMNS }));
  if (!row) throw gone();
  return row;
}

function closedConflict() {
  const err = new ConflictError('이미 끝난 요청입니다');
  err.code = 'closed';
  return err;
}

/** POST /stock/bands/requests/:id/made */
export async function makeBandRequest(env, { user, params, body }) {
  const { company } = await stockCompanyOf(env, user);
  const req = await requestOf(env, company.id, params && params.id);
  if (req.state !== 'requested') throw closedConflict();
  const sheet = isPlainObject(body) && body.sheet_item_id != null ? body.sheet_item_id : null;
  if (sheet !== null && !isUuid(sheet)) throw new ValidationError('원장 품목을 다시 골라 주세요', { field: 'sheet_item_id' });
  let row;
  try {
    row = await callRpc(env, 'stock_band_make', { p_company: company.id, p_request: req.id, p_actor: user.id, p_sheet_item: sheet });
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    if (codeIn(e, 'P0002')) throw new ValidationError('원장 품목을 다시 골라 주세요', { field: 'sheet_item_id' });
    if (codeIn(e, '22023')) {
      // 끝난 요청이거나 원장이 모자란다 — 아무것도 바뀌지 않았다
      const now = await requestOf(env, company.id, req.id);
      if (now.state !== 'requested') throw closedConflict();
      throw new ValidationError('원장 재고가 모자랍니다. 아무것도 바꾸지 않았습니다 — 원장을 먼저 입고하거나 원장 없이 적어 주세요', { field: 'sheet_item_id' });
    }
    throw e;
  }
  const r = Array.isArray(row) ? row[0] : row;
  return { id: r.id, code: requestCode(r.seq), state: r.state, qty: num(r.qty) };
}

/** POST /stock/bands/requests/:id/cancel */
export async function cancelBandRequest(env, { user, params }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const req = await requestOf(env, company.id, params && params.id);
  if (req.state !== 'requested') throw closedConflict();
  let row;
  try {
    row = await callRpc(env, 'stock_band_cancel', { p_company: company.id, p_request: req.id, p_actor: user.id });
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    if (codeIn(e, '22023')) throw closedConflict();
    throw e;
  }
  const r = Array.isArray(row) ? row[0] : row;
  return { id: r.id, code: requestCode(r.seq), state: r.state };
}
