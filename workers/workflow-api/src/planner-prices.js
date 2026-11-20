/**
 * 간편 플래너 BOM 요약 — 품목 단가 · 몸통 / 우라 색 목록
 *   (2026-11-17 사장님 「각 품목마다 얼마인지 최종 계산」 · 「재고 단가 먼저, 없으면 생산 설정 단가」 · 「팩토리마다 자기 목록」).
 *
 *   POST /planner/prices   내 팩토리의 단가를 보낸 줄마다 붙여 돌려준다 (값을 저장하지 않는다 — 읽기)
 *     본문 { boards [{ material, thickness, kind?, color? }], hardware [{ category, item }], edge [{ t }], tops [{ material, thickness }] } — 묶음마다 PRICE_LINES_MAX 줄까지
 *       boards 의 kind (body 몸통 · back 우라 · door 도어) · color (몸통 · 우라는 색 이름, 도어는 색 코드) 는 자재 가격표와 맞춰 볼 때만 쓴다 — 없어도 된다
 *     → 대표 · 실장(· 관리자): { money: true, company { id, name }, settings_missing,
 *          boards   [{ material, thickness, unit_price, unit, source }],     보낸 차례 그대로
 *          hardware [{ category, item, unit_price, unit, source }],
 *          edge     [{ t, unit_price, unit: 'm', source }],
 *          tops     [{ material, thickness, unit_price, unit: 'm', source }] }
 *        source = 'list' (자재 가격표 — 색까지 맞은 값) | 'stock' (구매 · 재고에 적은 단가) | 'settings' (생산 설정 단가) | null (단가 없음 — unit_price 도 null)
 *     → 직원: { money: false, company } — 금액은 대표 · 실장에게만 (재고 단가 · 생산 설정과 같은 규칙)
 *
 *   단가를 고르는 차례 — 색까지 맞는 가격표 값이 있으면 그것, 없으면 재고 단가가 먼저다:
 *     0) 자재 가격표 (price-lists.js — 2026-11-18 사장님 「도어용 보드까지 색마다」)  판재만. 보낸 kind · color 가 팩토리가 올린 가격표의
 *              용도 · 색(몸통 · 우라는 「색상명 코드」 이름, 도어는 코드)과 맞고 값이 하나로 정해질 때. 색을 안 정한 줄 · 가격표에 없는 색은 다음으로.
 *     1) 재고  자재 잇기(stock_links — 판재 `B|재질|두께` · 철물 `H|분류|이름`, stock-needs.js 의 키 그대로)로 이어진 품목의 unit_price.
 *              이어진 품목이 없거나 단가를 안 적었으면 다음으로. 색은 키에 없다 — 같은 재질 · 두께면 색이 달라도 같은 단가다.
 *     2) 생산 설정 (company_settings.settings.quote — 견적이 쓰는 원가 기준, 값이 없으면 기본값)
 *              판재: 견적이 원판을 가르는 조건 그대로 (quote-sheet.js boardPriceKeyOf — PB · MDF 뒷판 · MDF 도어)
 *              철물: 견적이 값을 매기는 다섯 분류 (HARDWARE_PRICE_KEYS — 경첩 · 레일 · 다리발 · 브라켓 · 옷봉)
 *              엣지: 0.6T 만 (edgeRoll ÷ edgeRollMeters, m당) · 상판: 인조대리석만 (countertopPerMeter, m당)
 *     3) 둘 다 없으면 단가 없음 — 값을 지어내지 않는다 (플래너는 그 줄을 합계에서 뺀다)
 *
 *   GET /planner/colors   내 팩토리의 몸통 색 · 우라 색 이름 목록 — 플래너 구성원 누구나 (설계할 때 고른다)
 *     → { company { id, name }, body [이름…], back [이름…], updated_at }
 *     목록은 팩토리 대표 · 실장이 「생산 설정」에 적는다 (production/service.js settings.colors). 없으면 빈 목록.
 *
 * 누가: 플래너를 쓰는 팩토리의 구성원 (planner-drafts.js plannerCompanyOf — 다담 공장 · Manager 이상 협력업체).
 * 고객 정보: 없다. 다른 팩토리: 모든 읽기를 내 팩토리 id 로 거른다.
 */

import { DbError, ValidationError, selectMany } from './supabase.js';
import { plannerCompanyOf } from './planner-drafts.js';
import { companySettings } from './production/service.js';
import { boardPriceKeyOf, HARDWARE_PRICE_KEYS } from './quote-sheet.js';
import { boardKey, hardwareKey } from './stock-needs.js';
import { canHoldStock } from './stock.js';
import { currentPriceItems, listBoardPrice, priceColorsOf } from './price-lists.js';

/** 한 묶음에 받는 줄 수 */
export const PRICE_LINES_MAX = 200;
/** 생산 설정의 엣지 단가가 가리키는 엣지 두께 (standards.js DEFAULT_QUOTE.edgeRoll — 0.6T PVC) */
export const SETTINGS_EDGE_T = 0.6;
/** 생산 설정의 상판 단가가 가리키는 재질 (standards.js DEFAULT_QUOTE.countertopPerMeter — 인조대리석 매입 + 시공) */
export const SETTINGS_TOP_MATERIAL = '인조대리석';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
const text = (v, max = 80) => String(v == null ? '' : v).trim().slice(0, max);
const priceOf = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** 본문 묶음 하나 — 배열 · 줄마다 객체 · PRICE_LINES_MAX 까지 */
function linesOf(body, key) {
  const list = body && body[key];
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > PRICE_LINES_MAX || !list.every(isPlainObject)) {
    throw new ValidationError(`${key} 는 ${PRICE_LINES_MAX}줄까지의 목록이어야 합니다`, { field: key });
  }
  return list;
}

/**
 * 재고 단가 — 자재 잇기로 이어진 품목 가운데 단가를 적은 것. Map(match_key → { unit_price, unit }).
 *   재고를 쓰지 않는 팩토리(Manager · 다담 본사)는 빈 Map. 표 · 칸이 아직 없어도(0059 · 0061 · 0063 전) 빈 Map — 생산 설정 단가로 간다.
 */
export async function stockPricesOf(env, company) {
  const out = new Map();
  if (!canHoldStock(company)) return out;
  let links;
  let items;
  try {
    [links, items] = await Promise.all([
      // 품목이 이어진 줄만 — 「재고에서 다루지 않음」(ignored) 줄은 품목이 없다 (0063 stock_links_target_check)
      selectMany(env, 'stock_links', { company_id: `eq.${company.id}`, item_id: 'not.is.null', select: 'match_key,item_id', limit: '2000' }),
      selectMany(env, 'stock_items', { company_id: `eq.${company.id}`, unit_price: 'not.is.null', select: 'id,unit,unit_price', limit: '2000' }),
    ]);
  } catch (e) {
    if (isMissing(e)) return out;
    throw e;
  }
  const byId = new Map((items || []).map((it) => [it.id, it]));
  for (const l of links || []) {
    const it = byId.get(l.item_id);
    const price = it ? priceOf(it.unit_price) : null;
    if (price !== null) out.set(l.match_key, { unit_price: price, unit: text(it.unit, 8) || null });
  }
  return out;
}

/** 줄 하나의 단가 — 재고가 먼저, 없으면 생산 설정, 둘 다 없으면 단가 없음 */
function pick(stock, settings) {
  if (stock) return { unit_price: stock.unit_price, unit: stock.unit, source: 'stock' };
  if (settings && settings.unit_price !== null) return { unit_price: settings.unit_price, unit: settings.unit, source: 'settings' };
  return { unit_price: null, unit: null, source: null };
}

/**
 * 보낸 줄마다 단가를 붙인다 (순수) — stock: stockPricesOf 의 Map, quote: 합친 생산 설정 quote, listItems: 지금 자재 가격표의 줄 (없으면 빈 목록).
 * @returns {{boards:object[], hardware:object[], edge:object[], tops:object[]}}
 */
export function priceLines(body, stock, quote, listItems = []) {
  const Q = quote || {};
  const setting = (key, unit) => {
    const p = key ? priceOf(Q[key]) : null;
    return p === null ? null : { unit_price: p, unit };
  };
  const boards = linesOf(body, 'boards').map((r) => {
    const material = text(r.material);
    const thickness = Number(r.thickness);
    const key = boardKey(material, thickness);
    // 자재 가격표 — 용도 · 색까지 맞는 값이 하나일 때만 (색이 없는 줄은 예전 그대로 재고 → 생산 설정)
    const listed = listBoardPrice(listItems, { kind: text(r.kind, 8), thickness, color: text(r.color) });
    if (listed) return { material, thickness, unit_price: listed.unit_price, unit: listed.unit, source: 'list' };
    return { material, thickness, ...pick(key ? stock.get(key.key) : null, setting(boardPriceKeyOf(material, thickness), '장')) };
  });
  const hardware = linesOf(body, 'hardware').map((r) => {
    const category = text(r.category);
    const item = text(r.item, 200);
    const key = hardwareKey(category, item);
    return { category, item, ...pick(key ? stock.get(key.key) : null, setting(HARDWARE_PRICE_KEYS[category], '개')) };
  });
  const rollMeters = priceOf(Q.edgeRollMeters);
  const rollPrice = priceOf(Q.edgeRoll);
  const edgePerMeter = rollMeters && rollPrice !== null ? { unit_price: Math.round((rollPrice / rollMeters) * 100) / 100, unit: 'm' } : null;
  const edge = linesOf(body, 'edge').map((r) => {
    const t = Number(r.t);
    return { t, ...pick(null, t === SETTINGS_EDGE_T ? edgePerMeter : null) };
  });
  const tops = linesOf(body, 'tops').map((r) => {
    const material = text(r.material);
    const thickness = Number(r.thickness);
    return { material, thickness, ...pick(null, material === SETTINGS_TOP_MATERIAL ? setting('countertopPerMeter', 'm') : null) };
  });
  return { boards, hardware, edge, tops };
}

/** POST /planner/prices */
export async function plannerPrices(env, { user, body }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  const who = { id: company.id, name: company.name };
  // 줄 모양은 권한과 상관없이 본다 — 직원이 보내도 틀린 본문은 422
  if (!isPlainObject(body || {})) throw new ValidationError('본문은 객체여야 합니다');
  ['boards', 'hardware', 'edge', 'tops'].forEach((k) => linesOf(body, k));
  if (!canManage) return { money: false, company: who };
  const [stock, settings, listItems] = await Promise.all([stockPricesOf(env, company), companySettings(env, company.id), currentPriceItems(env, company.id)]);
  return { money: true, company: who, settings_missing: settings.missing, ...priceLines(body, stock, settings.settings.quote, listItems) };
}

/**
 * GET /planner/colors — 몸통 색 · 우라 색 이름 목록 + 도어 색 목록.
 *   body · back: 「생산 설정」에 적은 이름이 먼저, 그 뒤에 자재 가격표의 색(「색상명 코드」) — 같은 이름은 한 번.
 *   door: 자재 가격표의 도어 색 [{ code, name, group }] (가격표가 없으면 빈 목록 — 플래너는 엔진의 기본 도어 색만 보인다).
 *   단가는 싣지 않는다 (이름 · 코드뿐 — 플래너 구성원 누구나 읽는다).
 */
export async function plannerColors(env, { user }) {
  const { company } = await plannerCompanyOf(env, user);
  const [s, listItems] = await Promise.all([companySettings(env, company.id), currentPriceItems(env, company.id)]);
  const colors = s.settings.colors;
  const listed = priceColorsOf(listItems);
  const merge = (a, b) => a.concat(b.filter((name) => !a.includes(name)));
  return { company: { id: company.id, name: company.name }, body: merge(colors.body, listed.body), back: merge(colors.back, listed.back), door: listed.door, updated_at: s.updated_at };
}

/**
 * GET /planner/cut — 내 팩토리의 재단기 설정 (톱날 두께 · 원장 가장자리 여백 mm). 플래너 구성원 누구나 — 재단 배치를 셈할 때 쓴다.
 *   팩토리 대표 · 실장이 「생산 설정」에 적는다 (production/service.js settings.cut). 적지 않았으면 재단 엔진 기본값.
 */
export async function plannerCut(env, { user }) {
  const { company } = await plannerCompanyOf(env, user);
  const s = await companySettings(env, company.id);
  const cut = s.settings.cut;
  // 소부품 더하기 · 빼기 (2026-11-20 — settings.band). 플래너는 재단 엔진 옵션 small · bandStock 으로 그대로 넘긴다
  const band = s.settings.band;
  const small = band && (band.mode === 'place' || band.mode === 'stock') ? band.mode : null;
  return {
    company: { id: company.id, name: company.name },
    kerf: cut.kerf,
    trim: cut.trim,
    ...(small ? { small } : {}),
    ...(small === 'stock' ? { bandStock: { width: band.width, length: band.length, material: band.material, thickness: band.thickness } } : {}),
    updated_at: s.updated_at,
  };
}
