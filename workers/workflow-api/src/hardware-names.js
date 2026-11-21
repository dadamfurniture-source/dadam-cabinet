/**
 * 철물 이름 — 바뀐 품명 짝 · 주문 거래처 이름 (2026-11-21).
 *
 * 1) 바뀐 품명 (2026-11-21 사장님 「문주 댐핑 언더레일 처럼, 회사이름) 제품기능이름」 — 엔진 dadam-cabinet #1685):
 *    예전 설계 · 작업지시서의 철물 줄은 예전 품명 그대로이고, 재고 짝표(stock_links match_key `H|분류|이름`)도 예전 품명으로 이어 둔 것이 있다.
 *    같은 철물이니 짝을 찾을 때는 지금 품명으로 맞춘다 (canonicalHardwareItem) — 예전 짝도 새 품명 줄에, 새 짝도 예전 설계 줄에 이어진다.
 *    DB 는 고치지 않는다 (짝표 줄은 그대로 — 읽을 때만 맞춘다).
 *
 * 2) 주문 거래처 (2026-11-21 사장님 「조절 다리발 · 선반 브라켓 · 걸레받이카바 · 손잡이는 주문 거래처 회사로 해줘」):
 *    엔진이 회사를 모르는 철물 줄(manufacturer 가 비었거나 '-')은 그 팩토리가 그 철물을 주문하는 거래처 이름을 앞에 붙여 보인다 —
 *    재고 짝표로 이어진 재고 품목(stock_items)의 공급처(supplier_id → counterparties.name). 이어지지 않았거나 공급처가 없으면 품명만.
 *    엔진 품명(item)과 짝표 키는 바꾸지 않는다 — 보일 때만 「거래처 품명」.
 */
import { selectMany, DbError } from './supabase.js';

const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
/** 짝표 키 글 — stock-needs.js 와 같은 다듬기 (| 는 / 로, 빈칸 하나로) */
const clean = (v) => String(v == null ? '' : v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const KEY_MAX = 200;

/** 바뀐 품명 — 분류 → { 예전 품명: 지금 품명 } */
export const HARDWARE_RENAMED = Object.freeze({
  레일: Object.freeze({
    '댐핑 언더레일': '문주 댐핑 언더레일',
    '문주 언더레일': '문주 댐핑 언더레일',
    '소프트클로즈 서랍레일': '문주 댐핑 언더레일',
    '댐핑 볼레일': '문주 댐핑 볼레일',
  }),
  경첩: Object.freeze({
    'H052W-5 105도 저압 경첩': '문주 H052W-5 105도 저압 경첩',
    'H052W-3 105도 저압 경첩': '문주 H052W-3 105도 저압 경첩',
  }),
});

/** 지금 품명 — 예전 품명이면 바뀐 이름, 아니면 그대로 */
export function canonicalHardwareItem(category, item) {
  const map = HARDWARE_RENAMED[clean(category)];
  const i = clean(item);
  return (map && map[i]) || i;
}

/** 철물 짝표 키 `H|분류|지금 품명` — stock-needs.js hardwareKey 가 이것을 쓴다. 이름이 없으면 null */
export function hardwareMatchKey(category, item) {
  const c = clean(category);
  const i = canonicalHardwareItem(c, item);
  if (!i) return null;
  return { key: `H|${c}|${i}`.slice(0, KEY_MAX), label: (c ? `${c} · ${i}` : i).slice(0, KEY_MAX) };
}

/** 짝표 키 `H|분류|이름` → 지금 품명 키 (판재 · 밴드 키는 그대로) */
export function canonicalMatchKey(key) {
  const s = String(key || '');
  if (!s.startsWith('H|')) return s;
  const [, category, ...rest] = s.split('|');
  const item = rest.join('|');
  return `H|${category}|${canonicalHardwareItem(category, item)}`;
}

/**
 * 짝표 줄들 → Map(지금 품명 키 → 줄). 예전 키 줄과 지금 키 줄이 둘 다 있으면 지금 키 줄이 이긴다 (사람이 새로 이은 짝).
 * @param {object[]} links stock_links 줄 { match_key, … }
 */
export function linksByCanonicalKey(links) {
  const out = new Map();
  for (const l of links || []) {
    if (!l || typeof l.match_key !== 'string') continue;
    const k = canonicalMatchKey(l.match_key);
    const cur = out.get(k);
    if (cur && cur.match_key === k) continue;
    out.set(k, l);
  }
  return out;
}

/** 엔진이 회사를 모르는 철물 줄인가 (제조사 칸이 비었거나 '-') */
export const noMaker = (h) => !h || !String(h.manufacturer || '').trim() || String(h.manufacturer).trim() === '-';

/**
 * 철물 키 → 주문 거래처 이름 — 재고 짝표로 이어진 품목의 공급처. 재고를 쓰지 않는 팩토리 · 표가 없으면 빈 Map.
 * @param {object} env
 * @param {string|null} companyId
 * @returns {Promise<Map<string, string>>} 키 = `H|분류|지금 품명`
 */
export async function hardwareSuppliersOf(env, companyId) {
  const out = new Map();
  if (!companyId) return out;
  let links;
  let items;
  try {
    [links, items] = await Promise.all([
      selectMany(env, 'stock_links', { company_id: `eq.${companyId}`, kind: 'eq.hardware', item_id: 'not.is.null', select: 'match_key,item_id', limit: '2000' }),
      selectMany(env, 'stock_items', { company_id: `eq.${companyId}`, supplier_id: 'not.is.null', select: 'id,supplier_id', limit: '2000' }),
    ]);
  } catch (e) {
    if (isMissing(e)) return out;
    throw e;
  }
  const supplierOfItem = new Map((items || []).map((it) => [it.id, it.supplier_id]));
  const ids = [...new Set((links || []).map((l) => supplierOfItem.get(l.item_id)).filter(Boolean))];
  if (!ids.length) return out;
  let parties;
  try {
    parties = await selectMany(env, 'counterparties', { company_id: `eq.${companyId}`, select: 'id,name', limit: '2000' });
  } catch (e) {
    if (isMissing(e)) return out;
    throw e;
  }
  const nameOf = new Map((parties || []).map((p) => [p.id, String(p.name || '').trim()]));
  linksByCanonicalKey(links).forEach((l, key) => {
    const name = nameOf.get(supplierOfItem.get(l.item_id));
    if (name) out.set(key, name.slice(0, 60));
  });
  return out;
}

/**
 * 철물 줄의 보이는 품명 · 회사 — 엔진 회사가 있으면 그대로, 없으면 주문 거래처(suppliers 의 그 키)를 앞에 붙인다.
 * @param {object} h 철물 줄 { category, item, manufacturer }
 * @param {Map<string,string>|object|null} suppliers 키 → 거래처 이름 (Map 또는 동결본의 객체)
 * @returns {{item:string, maker:string}}
 */
export function hardwareShownOf(h, suppliers) {
  const item = String((h && h.item) || '');
  if (!noMaker(h)) return { item, maker: String(h.manufacturer).trim() };
  const k = hardwareMatchKey(h && h.category, item);
  const key = k ? k.key : '';
  const name = !key ? null : suppliers instanceof Map ? suppliers.get(key) : suppliers && typeof suppliers === 'object' ? suppliers[key] : null;
  if (!name) return { item, maker: '' };
  return { item: item.startsWith(name) ? item : `${name} ${item}`, maker: name };
}
