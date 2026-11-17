/**
 * 자재 가격표 (DB 0070 — 2026-11-18 사장님 「자재 가격 정보 … 파악해서 적용」 · 「도어용 보드까지 색마다」)
 *
 * 팩토리가 공급처 가격표(엑셀)를 앱에 올려 두면, 간편 플래너가
 *   - 색상 탭에서 몸통 · 우라 · 도어 색을 그 가격표의 색으로 고르고 (planner-prices.js GET /planner/colors),
 *   - BOM 요약의 판재 단가를 색 · 코드까지 맞춰 읽는다 (planner-prices.js POST /planner/prices).
 *
 *   POST /planner/price-lists          올리기 { supplier, source_name?, items[] } — 대표 · 실장. 201
 *     items[] = { kind, category?, product?, spec?, color_name?, code?, size_text?, thickness?, unit_price }
 *       kind (용도): body 몸통 · back 우라 · door 도어 · edge 엣지 · other 그 밖 — 올리는 사람이 제품군마다 정한다 (여기서 짐작하지 않는다)
 *       두께는 보낸 숫자, 없으면 규격 글의 첫 숫자 (「18*1220*2440」 → 18)
 *     같은 공급처의 앞 가격표는 지우지 않는다 — 새로 올린 것이 그 공급처의 지금 가격표가 된다 (공급처마다 가장 최근 ready 줄).
 *   GET  /planner/price-lists          지금 가격표들 { lists[{ id, supplier, source_name, row_count, created_at, counts }] } — 대표 · 실장
 *   GET  /planner/price-lists/items    지금 가격표의 줄 ?kind=&q=&limit= → { total, items[] } (단가 포함) — 대표 · 실장
 *
 * 누가: 플래너를 쓰는 팩토리 (planner-drafts.js plannerCompanyOf). 단가가 든 응답은 대표 · 실장(· 관리자)에게만.
 *   색 이름 · 코드만 든 목록(priceColorsOf)은 플래너 구성원 누구나 — planner-prices.js 가 내준다.
 * 다른 팩토리: 모든 읽기 · 쓰기를 내 팩토리 id 로 거른다. 고객 정보: 없다.
 * DB 0070 적용 전: 올리기 · 목록은 409 db_pending, 플래너 쪽 읽기(currentPriceItems)는 빈 목록 (가격표 없이 예전처럼 돈다).
 */

import { ConflictError, DbError, ForbiddenError, ValidationError, insertMany, insertOne, selectMany, updateBy } from './supabase.js';
import { plannerCompanyOf } from './planner-drafts.js';
import { COLOR_NAME_MAX } from './production/service.js';

/** 용도 — DB 0070 price_list_items_kind_check 와 같다 */
export const PRICE_KINDS = Object.freeze(['body', 'back', 'door', 'edge', 'other']);
/** 한 가격표의 줄 수 — DB 0070 price_lists_rows_check 와 같다 */
export const PRICE_ITEMS_MAX = 5000;
/** 올리기 본문 크기 */
export const PRICE_LIST_BODY_MAX_BYTES = 2 * 1024 * 1024;
/** 글 길이 — DB 0070 의 CHECK 와 같다 */
export const PRICE_TEXT_MAX = Object.freeze({ supplier: 40, source_name: 120, category: 40, product: 60, spec: 60, color_name: 40, code: 40, size_text: 40 });
/** 단가 상한 (원) — DB 0070 price_list_items_price_check 와 같다 */
export const PRICE_MAX = 100000000;
/** 플래너 · 엔진이 받는 도어 색 코드의 꼴 (dadam-planner-lite js/model.js DOOR_CODE_RE · 엔진 finishCode) — 이 꼴이 아닌 코드는 도어 색으로 고를 수 없다 */
export const DOOR_CODE_RE = /^[A-Z][A-Z0-9-]{1,39}$/;
/** 플래너 요약의 판재 종류 가운데 가격표로 값을 매기는 것 (dadam-planner-lite js/bom-summary.js BOARD_KINDS) */
export const BOARD_PRICE_KINDS = Object.freeze(['body', 'back', 'door']);
const ITEM_TEXTS = ['category', 'product', 'spec', 'color_name', 'code', 'size_text'];
const ITEM_COLS = 'list_id,seq,kind,category,product,spec,color_name,code,size_text,thickness,unit_price';
const CHUNK = 500;
const PAGE = 1000;
const LIST_SCAN = '200';
const ITEMS_LIMIT_DEFAULT = 200;
const ITEMS_LIMIT_MAX = 1000;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));

function dbPending() {
  const err = new ConflictError('DB 0070 적용 전입니다 — 자재 가격표는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
async function db(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
}

/** 두께 — 보낸 숫자, 없으면 규격 글의 첫 숫자. 0 초과 100 이하가 아니면 null (엣지 「0.6*18*100」 → 0.6, 「0*0*0」 → null) */
export function thicknessOf(value, sizeText) {
  let n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[*xX×]/.exec(String(sizeText || ''));
    n = m ? Number(m[1]) : NaN;
  }
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/** 올린 줄 하나를 다듬는다 — 틀리면 몇 번째 줄의 무엇이 틀렸는지 422 */
export function cleanPriceItem(raw, i) {
  const row = i + 1;
  const bad = (msg, field) => new ValidationError(`${row}번째 줄: ${msg}`, { row, field });
  if (!isPlainObject(raw)) throw bad('줄 모양이 아닙니다');
  if (!PRICE_KINDS.includes(raw.kind)) throw bad(`용도는 ${PRICE_KINDS.join(' · ')} 가운데 하나여야 합니다`, 'kind');
  const out = { kind: raw.kind };
  for (const k of ITEM_TEXTS) {
    const s = text(raw[k]);
    if (s.length > PRICE_TEXT_MAX[k]) throw bad(`${k} 는 ${PRICE_TEXT_MAX[k]}자까지입니다`, k);
    out[k] = s;
  }
  if (!out.color_name && !out.code) throw bad('색상명이나 코드가 있어야 합니다', 'color_name');
  const p = raw.unit_price;
  const price = typeof p === 'number' ? p : typeof p === 'string' && p.trim() ? Number(p.replace(/,/g, '')) : NaN;
  if (!Number.isInteger(price) || price < 0 || price > PRICE_MAX) throw bad(`단가는 0 ~ ${PRICE_MAX} 사이 정수(원)여야 합니다`, 'unit_price');
  out.unit_price = price;
  out.thickness = thicknessOf(raw.thickness, out.size_text);
  return out;
}

const countsOf = (items) => {
  const out = Object.fromEntries(PRICE_KINDS.map((k) => [k, 0]));
  items.forEach((it) => { if (it.kind in out) out[it.kind] += 1; });
  return out;
};
const listOut = (h, items) => ({ id: h.id, supplier: h.supplier, source_name: h.source_name || '', row_count: h.row_count, created_at: h.created_at || null, counts: countsOf(items) });
const itemOut = (it) => ({
  supplier: it.supplier || '', seq: it.seq, kind: it.kind, category: it.category || '', product: it.product || '', spec: it.spec || '',
  color_name: it.color_name || '', code: it.code || '', size_text: it.size_text || '', thickness: it.thickness === null || it.thickness === undefined ? null : Number(it.thickness), unit_price: Number(it.unit_price),
});

async function managerCompanyOf(env, user) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  if (!canManage) throw new ForbiddenError('자재 가격표는 팩토리 대표 · 실장만 다룹니다', 'not_manager');
  return company;
}

/** POST /planner/price-lists */
export async function uploadPriceList(env, { user, body }) {
  const company = await managerCompanyOf(env, user);
  if (!isPlainObject(body)) throw new ValidationError('본문은 객체여야 합니다');
  const supplier = text(body.supplier);
  if (!supplier || supplier.length > PRICE_TEXT_MAX.supplier) throw new ValidationError(`공급처 이름은 1 ~ ${PRICE_TEXT_MAX.supplier}자여야 합니다`, { field: 'supplier' });
  const sourceName = text(body.source_name).slice(0, PRICE_TEXT_MAX.source_name);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > PRICE_ITEMS_MAX) {
    throw new ValidationError(`줄은 1 ~ ${PRICE_ITEMS_MAX}개여야 합니다`, { field: 'items' });
  }
  const items = body.items.map(cleanPriceItem);
  return db(async () => {
    // 줄을 다 넣은 뒤에 ready — 넣다 만 가격표(loading)는 아무도 읽지 않는다
    const head = await insertOne(env, 'price_lists', { company_id: company.id, supplier, source_name: sourceName, row_count: items.length, created_by: user.id });
    for (let i = 0; i < items.length; i += CHUNK) {
      await insertMany(env, 'price_list_items', items.slice(i, i + CHUNK).map((it, j) => ({ list_id: head.id, seq: i + j + 1, company_id: company.id, ...it })));
    }
    await updateBy(env, 'price_lists', { id: `eq.${head.id}`, company_id: `eq.${company.id}` }, { state: 'ready' });
    return { company: { id: company.id, name: company.name }, list: listOut({ ...head, supplier, source_name: sourceName, row_count: items.length }, items) };
  });
}

/** 지금 가격표 — 공급처마다 가장 최근 ready 줄 (최근 것부터) */
export async function currentPriceLists(env, companyId) {
  const rows = (await selectMany(env, 'price_lists', {
    company_id: `eq.${companyId}`, state: 'eq.ready', select: 'id,supplier,source_name,row_count,created_at', order: 'created_at.desc', limit: LIST_SCAN,
  })) || [];
  const seen = new Set();
  return rows.filter((r) => {
    const key = String(r.supplier || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 가격표 하나의 줄 전부 — PAGE 줄씩 끊어 읽는다 (한 번에 주는 줄 수 한도가 있어도 다 읽게) */
async function itemsOfList(env, companyId, head) {
  const out = [];
  for (let offset = 0; offset < PRICE_ITEMS_MAX; offset += PAGE) {
    const rows = (await selectMany(env, 'price_list_items', {
      list_id: `eq.${head.id}`, company_id: `eq.${companyId}`, select: ITEM_COLS, order: 'seq.asc', limit: String(PAGE), offset: String(offset),
    })) || [];
    rows.forEach((r) => out.push({ ...r, supplier: head.supplier }));
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * 지금 가격표의 줄 전부 (공급처마다 최근 것) — 플래너 색 목록 · 단가가 쓴다.
 *   표가 아직 없으면(0070 전) 빈 목록 — 가격표 없이 예전처럼 돈다.
 */
export async function currentPriceItems(env, companyId) {
  try {
    const heads = await currentPriceLists(env, companyId);
    const out = [];
    for (const h of heads) out.push(...(await itemsOfList(env, companyId, h)));
    return out;
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

/** GET /planner/price-lists */
export async function listPriceLists(env, { user }) {
  const company = await managerCompanyOf(env, user);
  return db(async () => {
    const heads = await currentPriceLists(env, company.id);
    const lists = [];
    for (const h of heads) lists.push(listOut(h, await itemsOfList(env, company.id, h)));
    return { company: { id: company.id, name: company.name }, lists };
  });
}

/** GET /planner/price-lists/items ?kind=&q=&limit= */
export async function listPriceItems(env, { user, query }) {
  const company = await managerCompanyOf(env, user);
  const q = query || {};
  const kind = text(q.kind);
  if (kind && !PRICE_KINDS.includes(kind)) throw new ValidationError(`kind 는 ${PRICE_KINDS.join(' · ')} 가운데 하나여야 합니다`, { field: 'kind' });
  const needle = text(q.q).toLowerCase().slice(0, 40);
  const n = q.limit === undefined || q.limit === null || q.limit === '' ? ITEMS_LIMIT_DEFAULT : Number(q.limit);
  if (!Number.isInteger(n) || n < 1 || n > ITEMS_LIMIT_MAX) throw new ValidationError(`limit 은 1 ~ ${ITEMS_LIMIT_MAX} 사이여야 합니다`, { field: 'limit' });
  return db(async () => {
    const heads = await currentPriceLists(env, company.id);
    let items = [];
    for (const h of heads) items.push(...(await itemsOfList(env, company.id, h)));
    if (kind) items = items.filter((it) => it.kind === kind);
    if (needle) items = items.filter((it) => [it.color_name, it.code, it.product, it.spec, it.category].some((s) => String(s || '').toLowerCase().includes(needle)));
    return { company: { id: company.id, name: company.name }, total: items.length, items: items.slice(0, n).map(itemOut) };
  });
}

// ── 플래너가 쓰는 것 (순수 함수) ─────────────────────────────────

/** 몸통 · 우라 색의 이름 — 「색상명 코드」 (둘 가운데 있는 것만) */
export const priceLabelOf = (it) => [it.color_name, it.code].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

/**
 * 가격표에서 나오는 플래너 색 목록 (가격표 차례 그대로, 같은 것은 한 번).
 *   body · back: 이름 「색상명 코드」 — 플래너 색 이름 길이(COLOR_NAME_MAX)를 넘는 이름은 뺀다 (고를 수 없다)
 *   door: { code, name, group } — 코드가 도어 색 코드 꼴(DOOR_CODE_RE)일 때만. group = 제품군 + 사양 (칩 묶음용)
 */
export function priceColorsOf(items) {
  const out = { body: [], back: [], door: [] };
  const seenDoor = new Set();
  for (const it of items || []) {
    if (it.kind === 'body' || it.kind === 'back') {
      const label = priceLabelOf(it);
      if (label && label.length <= COLOR_NAME_MAX && !out[it.kind].includes(label)) out[it.kind].push(label);
    } else if (it.kind === 'door') {
      const code = String(it.code || '');
      if (!DOOR_CODE_RE.test(code) || seenDoor.has(code)) continue;
      seenDoor.add(code);
      out.door.push({ code, name: String(it.color_name || '').trim() || code, group: [it.product, it.spec].map((s) => String(s || '').trim()).filter((s) => s && s !== '-').join(' ') });
    }
  }
  return out;
}

/**
 * 판재 한 줄의 가격표 단가 — 용도와 색이 맞고 값이 하나로 정해질 때만 { unit_price, unit: '장' }, 아니면 null (값을 고르거나 지어내지 않는다).
 *   몸통 · 우라: 색 = 「색상명 코드」 이름 (priceLabelOf) · 도어: 색 = 코드
 *   두께: 몸통 · 도어는 같은 두께의 줄만. 우라(뒷판)는 두께를 가리지 않는다 — 견적도 MDF 5T 미만을 한 뒷판 원장으로 본다
 *     (quote-sheet.js boardPriceKeyOf): BOM 은 3T, 공급처 가격표는 2.7T 로 적는다.
 *   같은 색 · 두께에 값이 여럿이면(같은 색을 두 제품군에 몸통으로 정한 가격표) null.
 */
export function listBoardPrice(items, { kind, thickness, color }) {
  if (!color || !BOARD_PRICE_KINDS.includes(kind)) return null;
  const cands = (items || []).filter((it) => it.kind === kind && (kind === 'door' ? it.code === color : priceLabelOf(it) === color));
  if (!cands.length) return null;
  const t = Number(thickness);
  const exact = cands.filter((it) => it.thickness !== null && it.thickness !== undefined && Math.abs(Number(it.thickness) - t) < 0.05);
  const pick = exact.length ? exact : kind === 'back' ? cands : [];
  const prices = [...new Set(pick.map((it) => Number(it.unit_price)))];
  return prices.length === 1 ? { unit_price: prices[0], unit: '장' } : null;
}
