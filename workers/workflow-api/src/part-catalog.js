/**
 * 철물 · 부속 카탈로그 (DB 0071 — 2026-11-18 사장님 「키친가이드 사이트 제품들도 정리해서 DB에 넣으려고」
 *   · 「키친가이드, 무림상사, 모아가구 철물 처럼 회사별로 구분」 · 「구매 · 재고 아래 메뉴로, 다담 공장만 따로 보게」)
 *
 * 공급 회사마다 파는 상품(씽크볼 · 후드 · 수전 · 쿡탑 · 서랍재 · 레일 · 경첩 · 손잡이 · 하드웨어 · 악세사리 …)을 모아 두고
 * 마이페이지 구매 · 재고 › 「철물 · 부속 카탈로그」에서 본다.
 *
 *   GET   /parts/catalog              공급 회사 · 상품 전부 { company, can_manage, vendors[], items[] } — 구성원 누구나 (매입가는 대표 · 실장에게만)
 *   POST  /parts/import               카탈로그 파일의 한 묶음 { vendor{ name, site_url? }, seen_on, items[] } — 대표 · 실장. 201
 *     items[] = { vendor_item_no?, category?, sub_category?, brand?, name, ref_price?, options?, addons?, specs?, width_mm?, depth_mm?, height_mm?, source_url?, note? }
 *     같은 공급 회사의 같은 상품 번호(번호가 없으면 같은 이름)는 고친다 — 매입가 · 사진 · 쓰는지는 건드리지 않고,
 *     사람이 확인한 사양 · 치수(specs_checked)도 건드리지 않는다. 없으면 새로 넣는다. 한 번에 PART_IMPORT_MAX 개까지 (나눠 보낸다).
 *   POST  /parts/items/:id/photo      사진 올리기 (본문 = 이미지 바이트) — 대표 · 실장. 201
 *   PATCH /parts/items/:id            매입가 · 쓰는지 고치기 { buy_price?(원 | null), active? } — 대표 · 실장
 *
 * 누가: 다담 공장의 구성원과 다담 본사 구성원(· 관리자)만 — 다른 팩토리는 403 not_catalog_company (화면에는 메뉴가 없다).
 * 고객 정보: 없다. 사진: 비공개 버킷 part-photos, 읽을 때 서명 주소를 만들어 준다.
 * DB 0071 적용 전: 모두 409 db_pending.
 */

import { ConflictError, DbError, ForbiddenError, NotFoundError, TooLargeError, ValidationError, insertMany, insertOne, selectMany, selectOne, updateBy } from './supabase.js';
import { plannerCompanyOf, sniffPhoto } from './planner-drafts.js';
import { createSignedUrls, uploadObject } from './storage.js';

/** 사진 버킷 — DB 0071 */
export const PART_PHOTOS_BUCKET = 'part-photos';
/** 사진 크기 — DB 0071 버킷 한도와 같다 */
export const PART_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** 한 번에 받는 상품 수 — 고칠 상품마다 DB 를 한 번 부르기 때문에 작게 잡는다 */
export const PART_IMPORT_MAX = 30;
/** 올리기 본문 크기 */
export const PART_IMPORT_BODY_MAX_BYTES = 1024 * 1024;
/** 글 길이 — DB 0071 의 CHECK 와 같다 */
export const PART_TEXT_MAX = Object.freeze({ vendor: 40, site_url: 200, vendor_item_no: 60, category: 40, sub_category: 80, brand: 40, name: 120, source_url: 300, note: 300 });
/** 값 상한 (원) · 치수 상한 (mm) · JSON 글 길이 — DB 0071 의 CHECK 와 같다 */
export const PART_PRICE_MAX = 100000000;
export const PART_SIZE_MAX = 10000;
export const PART_JSON_MAX = Object.freeze({ options: 20000, addons: 8000, specs: 20000 });
/** 한 팩토리 카탈로그에서 읽는 상품 수 한도 */
export const PART_ITEMS_MAX = 5000;

const ITEM_TEXTS = ['vendor_item_no', 'category', 'sub_category', 'brand', 'source_url', 'note'];
const SIZES = ['width_mm', 'depth_mm', 'height_mm'];
const ITEM_COLS = 'id,vendor_id,vendor_item_no,category,sub_category,brand,name,ref_price,ref_price_on,buy_price,buy_price_on,options,addons,specs,specs_checked,width_mm,depth_mm,height_mm,source_url,note,photo_path,active,updated_at';
const PAGE = 1000;
const SIGN_CHUNK = 200;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
const nameKey = (s) => text(s).toLowerCase();
/** 오늘 (한국 날짜) */
export const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

function dbPending() {
  const err = new ConflictError('DB 0071 적용 전입니다 — 철물 · 부속 카탈로그는 적용 뒤에 쓸 수 있습니다');
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

/** 부르는 사람의 카탈로그 팩토리 — 다담 공장만 (본사 구성원 · 관리자는 다담 공장으로 본다) */
export async function catalogCompanyOf(env, user, { manage = false } = {}) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  if (!company || company.kind !== 'hq') throw new ForbiddenError('철물 · 부속 카탈로그는 다담 공장만 봅니다', 'not_catalog_company');
  if (manage && !canManage) throw new ForbiddenError('카탈로그는 대표 · 실장만 고칩니다', 'not_manager');
  return { company, canManage: !!canManage };
}

const moneyOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/,/g, '')) : NaN);

function cleanList(raw, shape, max, bad, field) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad(`${field} 는 목록이어야 합니다`, field);
  const out = raw.map((o) => shape(o));
  if (out.some((o) => o === null)) throw bad(`${field} 의 줄 모양이 틀립니다`, field);
  if (JSON.stringify(out).length > max) throw bad(`${field} 가 너무 깁니다`, field);
  return out;
}
const optionShape = (o) => {
  if (!isPlainObject(o)) return null;
  const l = text(o.l).slice(0, 80);
  const d = o.d === undefined || o.d === null ? 0 : moneyOf(o.d);
  if (!l || !Number.isInteger(d) || Math.abs(d) > PART_PRICE_MAX) return null;
  return { g: text(o.g).slice(0, 40), l, d, x: o.x === true };
};
const addonShape = (o) => {
  if (!isPlainObject(o)) return null;
  const l = text(o.l).slice(0, 80);
  const p = moneyOf(o.p);
  if (!l || !Number.isInteger(p) || p < 0 || p > PART_PRICE_MAX) return null;
  return { l, p };
};

/** 올린 상품 하나를 다듬는다 — 틀리면 몇 번째 상품의 무엇이 틀렸는지 422 */
export function cleanPartItem(raw, i) {
  const row = i + 1;
  const bad = (msg, field) => new ValidationError(`${row}번째 상품: ${msg}`, { row, field });
  if (!isPlainObject(raw)) throw bad('상품 모양이 아닙니다');
  const out = {};
  const name = text(raw.name);
  if (!name || name.length > PART_TEXT_MAX.name) throw bad(`이름은 1 ~ ${PART_TEXT_MAX.name}자여야 합니다`, 'name');
  out.name = name;
  for (const k of ITEM_TEXTS) {
    const s = text(raw[k]);
    if (s.length > PART_TEXT_MAX[k]) throw bad(`${k} 는 ${PART_TEXT_MAX[k]}자까지입니다`, k);
    out[k] = s;
  }
  if (out.source_url && !/^https:\/\//.test(out.source_url)) throw bad('원래 주소는 https:// 로 시작해야 합니다', 'source_url');
  if (raw.ref_price === undefined || raw.ref_price === null || raw.ref_price === '') out.ref_price = null;
  else {
    const p = moneyOf(raw.ref_price);
    if (!Number.isInteger(p) || p < 0 || p > PART_PRICE_MAX) throw bad(`참고가는 0 ~ ${PART_PRICE_MAX} 사이 정수(원)여야 합니다`, 'ref_price');
    out.ref_price = p;
  }
  out.options = cleanList(raw.options, optionShape, PART_JSON_MAX.options, bad, 'options');
  out.addons = cleanList(raw.addons, addonShape, PART_JSON_MAX.addons, bad, 'addons');
  // 사양 · 치수는 보냈을 때만 싣는다 — 안 보내면 지금 값을 그대로 둔다
  if (raw.specs !== undefined && raw.specs !== null) {
    if (!isPlainObject(raw.specs)) throw bad('사양은 이름: 글 묶음이어야 합니다', 'specs');
    const specs = {};
    for (const [k, v] of Object.entries(raw.specs)) {
      const key = text(k).slice(0, 40);
      const val = text(v).slice(0, 300);
      if (key && val) specs[key] = val;
    }
    if (JSON.stringify(specs).length > PART_JSON_MAX.specs) throw bad('사양이 너무 깁니다', 'specs');
    out.specs = specs;
  }
  for (const k of SIZES) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue;
    const n = Number(raw[k]);
    if (!Number.isInteger(n) || n <= 0 || n > PART_SIZE_MAX) throw bad(`${k} 는 1 ~ ${PART_SIZE_MAX} 사이 정수(mm)여야 합니다`, k);
    out[k] = n;
  }
  return out;
}

const vendorOut = (v, n) => ({ id: v.id, name: v.name, site_url: v.site_url || '', memo: v.memo || '', count: n || 0 });
const itemOut = (it, canManage, photo) => ({
  id: it.id, vendor_id: it.vendor_id, vendor_item_no: it.vendor_item_no || '', category: it.category || '', sub_category: it.sub_category || '', brand: it.brand || '',
  name: it.name, ref_price: it.ref_price === null || it.ref_price === undefined ? null : Number(it.ref_price), ref_price_on: it.ref_price_on || null,
  // 매입가는 대표 · 실장에게만
  buy_price: canManage && it.buy_price !== null && it.buy_price !== undefined ? Number(it.buy_price) : null, buy_price_on: canManage ? it.buy_price_on || null : null,
  options: Array.isArray(it.options) ? it.options : [], addons: Array.isArray(it.addons) ? it.addons : [], specs: isPlainObject(it.specs) ? it.specs : {},
  specs_checked: it.specs_checked === true, width_mm: it.width_mm ?? null, depth_mm: it.depth_mm ?? null, height_mm: it.height_mm ?? null,
  source_url: it.source_url || '', note: it.note || '', photo_url: photo || null, has_photo: !!it.photo_path, active: it.active !== false,
});

async function itemsOf(env, companyId, extra = {}) {
  const out = [];
  for (let offset = 0; offset < PART_ITEMS_MAX; offset += PAGE) {
    const rows = (await selectMany(env, 'part_items', { company_id: `eq.${companyId}`, ...extra, select: ITEM_COLS, order: 'category.asc,name.asc,id.asc', limit: String(PAGE), offset: String(offset) })) || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function signedPhotos(env, items) {
  const paths = items.map((it) => it.photo_path).filter(Boolean);
  const out = new Map();
  for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
    try {
      (await createSignedUrls(env, PART_PHOTOS_BUCKET, paths.slice(i, i + SIGN_CHUNK))).forEach((url, p) => out.set(p, url));
    } catch {
      /* 사진 주소를 못 만들어도 목록은 준다 */
    }
  }
  return out;
}

/** GET /parts/catalog */
export async function partCatalog(env, { user }) {
  const { company, canManage } = await catalogCompanyOf(env, user);
  return db(async () => {
    const vendors = (await selectMany(env, 'part_vendors', { company_id: `eq.${company.id}`, select: 'id,name,site_url,memo', order: 'created_at.asc', limit: '200' })) || [];
    // 숨긴 상품은 대표 · 실장에게만 보인다 (다시 살릴 수 있게)
    const items = await itemsOf(env, company.id, canManage ? {} : { active: 'eq.true' });
    const photos = await signedPhotos(env, items);
    const counts = new Map();
    items.forEach((it) => counts.set(it.vendor_id, (counts.get(it.vendor_id) || 0) + 1));
    return {
      company: { id: company.id, name: company.name }, can_manage: canManage,
      vendors: vendors.map((v) => vendorOut(v, counts.get(v.id))),
      items: items.map((it) => itemOut(it, canManage, photos.get(it.photo_path))),
    };
  });
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** POST /parts/import */
export async function importParts(env, { user, body }) {
  const { company } = await catalogCompanyOf(env, user, { manage: true });
  if (!isPlainObject(body) || !isPlainObject(body.vendor)) throw new ValidationError('본문에 공급 회사(vendor)가 있어야 합니다', { field: 'vendor' });
  const vendorName = text(body.vendor.name);
  if (!vendorName || vendorName.length > PART_TEXT_MAX.vendor) throw new ValidationError(`공급 회사 이름은 1 ~ ${PART_TEXT_MAX.vendor}자여야 합니다`, { field: 'vendor.name' });
  const siteUrl = text(body.vendor.site_url);
  if (siteUrl.length > PART_TEXT_MAX.site_url || (siteUrl && !/^https:\/\//.test(siteUrl))) throw new ValidationError('사이트 주소는 https:// 로 시작하고 200자까지입니다', { field: 'vendor.site_url' });
  const seenOn = text(body.seen_on) || kstDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seenOn) || Number.isNaN(Date.parse(seenOn))) throw new ValidationError('본 날(seen_on)은 YYYY-MM-DD 여야 합니다', { field: 'seen_on' });
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > PART_IMPORT_MAX) {
    throw new ValidationError(`상품은 한 번에 1 ~ ${PART_IMPORT_MAX}개씩 보냅니다`, { field: 'items' });
  }
  const items = body.items.map(cleanPartItem);
  const keyOf = (it) => (it.vendor_item_no ? `#${it.vendor_item_no}` : `=${nameKey(it.name)}`);
  const keys = items.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new ValidationError('같은 상품 번호(번호가 없으면 같은 이름)가 두 번 들어 있습니다', { field: 'items' });

  return db(async () => {
    const all = (await selectMany(env, 'part_vendors', { company_id: `eq.${company.id}`, select: 'id,name,site_url', limit: '200' })) || [];
    let vendor = all.find((v) => nameKey(v.name) === nameKey(vendorName)) || null;
    if (!vendor) vendor = await insertOne(env, 'part_vendors', { company_id: company.id, name: vendorName, site_url: siteUrl, created_by: user.id });
    const have = new Map((await itemsOf(env, company.id, { vendor_id: `eq.${vendor.id}` })).map((r) => [keyOf(r), r]));
    const fresh = [];
    const ids = {};
    let updated = 0;
    let same = 0;
    for (const it of items) {
      const cur = have.get(keyOf(it));
      const price = it.ref_price === null ? { ref_price: null, ref_price_on: null } : { ref_price: it.ref_price, ref_price_on: seenOn };
      if (!cur) {
        fresh.push({ company_id: company.id, vendor_id: vendor.id, ...it, ...price, specs: it.specs || {}, created_by: user.id });
        continue;
      }
      ids[keyOf(it).slice(1)] = { id: cur.id, has_photo: !!cur.photo_path };
      const patch = {};
      for (const k of ['name', 'category', 'sub_category', 'brand', 'source_url', 'note']) if ((cur[k] || '') !== it[k]) patch[k] = it[k];
      for (const k of ['options', 'addons']) if (!sameJson(cur[k], it[k])) patch[k] = it[k];
      // 값이 달라졌을 때만 본 날을 옮긴다
      const curPrice = cur.ref_price === null || cur.ref_price === undefined ? null : Number(cur.ref_price);
      if (curPrice !== it.ref_price) Object.assign(patch, price);
      // 사람이 확인한 사양 · 치수는 건드리지 않는다
      if (cur.specs_checked !== true) {
        if (it.specs && !sameJson(cur.specs, it.specs)) patch.specs = it.specs;
        for (const k of SIZES) if (it[k] !== undefined && cur[k] !== it[k]) patch[k] = it[k];
      }
      if (!Object.keys(patch).length) {
        same += 1;
        continue;
      }
      await updateBy(env, 'part_items', { id: `eq.${cur.id}`, company_id: `eq.${company.id}` }, patch);
      updated += 1;
    }
    const added = fresh.length ? (await insertMany(env, 'part_items', fresh)) || [] : [];
    added.forEach((r) => {
      ids[keyOf(r).slice(1)] = { id: r.id, has_photo: false };
    });
    return { company: { id: company.id, name: company.name }, vendor: { id: vendor.id, name: vendor.name }, added: added.length, updated, same, ids };
  });
}

async function itemOfCompany(env, companyId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new NotFoundError('상품을 찾을 수 없습니다');
  const it = await selectOne(env, 'part_items', { id: `eq.${id}`, company_id: `eq.${companyId}`, select: ITEM_COLS });
  if (!it) throw new NotFoundError('상품을 찾을 수 없습니다');
  return it;
}

/** POST /parts/items/:id/photo (본문 = 이미지 바이트) */
export async function addPartPhoto(env, { user, params, request }) {
  const { company } = await catalogCompanyOf(env, user, { manage: true });
  const tooBig = () => new TooLargeError(`사진은 ${PART_PHOTO_MAX_BYTES / 1024 / 1024}MB 까지 올립니다`);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > PART_PHOTO_MAX_BYTES) throw tooBig();
  return db(async () => {
    const it = await itemOfCompany(env, company.id, params.id);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > PART_PHOTO_MAX_BYTES) throw tooBig();
    if (!bytes.byteLength) throw new ValidationError('사진이 비어 있습니다', { code: 'empty' });
    const img = sniffPhoto(bytes);
    if (!img) throw new ValidationError('JPEG · PNG · WEBP 사진만 받습니다', { code: 'bad_type' });
    const path = `${company.id}/${it.id}.${img.ext}`;
    try {
      await uploadObject(env, PART_PHOTOS_BUCKET, path, bytes, img.mime, { upsert: true });
    } catch (e) {
      if (/bucket|not found|404/i.test(String((e && e.message) || ''))) throw dbPending();
      throw e;
    }
    if (it.photo_path !== path) await updateBy(env, 'part_items', { id: `eq.${it.id}`, company_id: `eq.${company.id}` }, { photo_path: path });
    return { id: it.id, has_photo: true };
  });
}

/** PATCH /parts/items/:id */
export async function patchPartItem(env, { user, params, body }) {
  const { company, canManage } = await catalogCompanyOf(env, user, { manage: true });
  if (!isPlainObject(body)) throw new ValidationError('본문은 객체여야 합니다');
  const patch = {};
  if ('buy_price' in body) {
    if (body.buy_price === null || body.buy_price === '') Object.assign(patch, { buy_price: null, buy_price_on: null });
    else {
      const p = moneyOf(body.buy_price);
      if (!Number.isInteger(p) || p < 0 || p > PART_PRICE_MAX) throw new ValidationError(`매입가는 0 ~ ${PART_PRICE_MAX} 사이 정수(원)여야 합니다`, { field: 'buy_price' });
      Object.assign(patch, { buy_price: p, buy_price_on: kstDay() });
    }
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw new ValidationError('쓰는지(active)는 참 · 거짓이어야 합니다', { field: 'active' });
    patch.active = body.active;
  }
  if (!Object.keys(patch).length) throw new ValidationError('고칠 값이 없습니다 (buy_price · active)');
  return db(async () => {
    const it = await itemOfCompany(env, company.id, params.id);
    const rows = await updateBy(env, 'part_items', { id: `eq.${it.id}`, company_id: `eq.${company.id}` }, patch);
    const next = { ...it, ...((rows && rows[0]) || patch) };
    const photo = next.photo_path ? (await signedPhotos(env, [next])).get(next.photo_path) : null;
    return { item: itemOut(next, canManage, photo) };
  });
}
