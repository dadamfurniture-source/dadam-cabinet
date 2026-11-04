/**
 * 회계장부 — 거래명세표 모아 붙이기 (DB 0036). 같은 거래처 · 맞춰 보기 · 알림 규칙은 DB 함수에 있고, 여기는 주소와 묶기다.
 *
 *   GET  /ledger/suppliers                    거래처마다 고른 것 — separate(세금계산서 따로 줌) · statement_only(명세표만 줌). ?company= 본사 보기
 *   PUT  /ledger/suppliers                    고르기 { document_id | supplier_key, mode } → { key, mode, name, released, candidates }
 *                                             명세표만 줌 이면 그 거래처의 모아 둔 명세표가 확인 기다림으로 돌아가고(released),
 *                                             따로 줌 이면 모아 둘 후보(그 거래처의 확인 기다리는 명세표 id)를 준다 — 모아 두기는 사람이 한 번 더
 *   POST /ledger/documents/hold               모아 두기 { document_ids } (확인 기다림만, HOLD_MAX 장까지) → { held }
 *   POST /ledger/documents/unhold             되돌리기 { document_ids } → { released }
 *   GET  /ledger/held                         모아 둔 명세표 — 거래처 · 달로 묶음(장 수 · 공급가 합 · 합계 합 · 늦음 · 장마다)
 *                                             늦음 = 그 달 다음 달 INVOICE_DAY 일이 지남 (월합계 세금계산서 발급 기한은 다음 달 10일)
 *   GET  /ledger/held/entries?biz_no=&name_key=   붙일 장부 줄 고르기 — 그 거래처의 취소 안 한 지출 줄, 최근부터 ENTRY_PICK 줄
 *   POST /ledger/entries/:id/attach           붙이기 { document_ids, dry_run } (ATTACH_MAX 장까지) → { attached, compare }
 *                                             dry_run 이면 맞춰 보기만 (붙은 명세표 + 붙일 명세표). 모두 붙일 수 있어야 붙인다 (아니면 409)
 *
 * 대표 · 실장만. 쓰기는 자격 full 의 자기 업체만 — 바꾼 사람은 asActor(x-actor-id) 로 남는다.
 * 0036 을 적용하기 전이면 읽기는 { available: false }, 쓰기는 409 no_function.
 */
import { selectOne, selectMany, callRpc, asActor, ValidationError, NotFoundError, ConflictError } from '../supabase.js';
import { kstDate } from '../production/service.js';
import { ledgerAccess, assertMoney, assertWritable } from './access.js';
import { isUuid } from './checks.js';
import { isMissingFunction } from './hints.js';
import { shiftMonth } from './dashboard.js';

export const INVOICE_MODES = Object.freeze(['separate', 'statement_only']);
/** 한 번에 모아 두기 · 되돌리기 · 붙이기 · 붙일 줄 고르기 */
export const HOLD_MAX = 200;
export const ATTACH_MAX = 100;
export const ENTRY_PICK = 20;
/** 이 날이 지나도 그 달 명세표가 모아 둔 채면 늦음 (다음 달 10일 발급 기한 다음 날) */
export const INVOICE_DAY = 11;

const MODE_COLS = 'supplier_key,name,biz_no,name_key,mode,set_at';
const KEY_RE = /^[bn].{1,200}$/;

/** 0036 이 없다 (함수 · 표) */
function missing(e) {
  return isMissingFunction(e) || (!!e && /PGRST205|Could not find the table/.test(String(e.message)));
}

function noFunction() {
  return new ConflictError('장부 업데이트(DB 0036)를 적용하기 전입니다', { code: 'no_function' });
}

async function reader(env, user, company) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  return access;
}

async function writer(env, user) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  return access;
}

/** 사진 id 목록 — 겹친 것은 하나로 */
export function documentIds(v, max) {
  if (!Array.isArray(v) || !v.length) throw new ValidationError('document_ids 는 사진 id 목록입니다');
  const ids = [...new Set(v)];
  if (ids.length > max) throw new ValidationError(`사진은 한 번에 ${max}장까지입니다`);
  if (!ids.every(isUuid)) throw new ValidationError('document_ids 에 사진 id 가 아닌 값이 있습니다');
  return ids;
}

async function rpc(env, name, args) {
  try {
    return await callRpc(env, name, args);
  } catch (e) {
    if (missing(e)) throw noFunction();
    throw e;
  }
}

// ── 고르기 ────────────────────────────────────────────────

/** GET /ledger/suppliers */
export async function listSupplierModes(env, { user, company }) {
  const access = await reader(env, user, company);
  try {
    const rows = (await selectMany(env, 'ledger_supplier_modes', {
      company_id: `eq.${access.companyId}`,
      select: MODE_COLS,
      order: 'set_at.desc',
      limit: '500',
    })) || [];
    return { available: true, items: rows, level: access.level, viewing: access.viewing };
  } catch (e) {
    if (missing(e)) return { available: false, items: [], level: access.level, viewing: access.viewing };
    throw e;
  }
}

/** PUT /ledger/suppliers */
export async function setSupplierMode(env, { user, body }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON 본문이 필요합니다');
  if (!INVOICE_MODES.includes(body.mode)) throw new ValidationError(`mode 는 ${INVOICE_MODES.join(' · ')} 중 하나입니다`);
  const doc = body.document_id ?? null;
  const key = body.supplier_key ?? null;
  if ((doc === null) === (key === null)) throw new ValidationError('document_id 와 supplier_key 중 하나만 넣어 주세요');
  if (doc !== null && !isUuid(doc)) throw new ValidationError('document_id 는 사진 id 입니다');
  if (key !== null && !(typeof key === 'string' && KEY_RE.test(key))) throw new ValidationError('supplier_key 가 올바르지 않습니다');
  const access = await writer(env, user);
  const r = await rpc(asActor(env, user), 'ledger_set_supplier_mode', {
    p_company: access.companyId,
    p_actor: user.id,
    p_document: doc,
    p_key: key,
    p_mode: body.mode,
  });
  if (!r || r.ok !== true) {
    const reason = (r && r.reason) || 'failed';
    if (reason === 'not_found') throw new NotFoundError('사진을 찾을 수 없습니다');
    if (reason === 'no_supplier') throw new ValidationError('이 사진에서 거래처를 읽지 못했습니다 — 거래처를 알 수 있는 사진에서 골라 주세요');
    throw new ConflictError('고르지 못했습니다', { code: reason });
  }
  return {
    key: r.key,
    mode: r.mode,
    name: r.name || null,
    released: r.released || 0,
    candidates: Array.isArray(r.candidates) ? r.candidates : [],
  };
}

// ── 모아 두기 ──────────────────────────────────────────────

/** POST /ledger/documents/hold · /unhold */
export async function holdDocuments(env, { user, body, release = false }) {
  const ids = documentIds(body && body.document_ids, HOLD_MAX);
  const access = await writer(env, user);
  const n = await rpc(asActor(env, user), release ? 'ledger_unhold_documents' : 'ledger_hold_documents', {
    p_company: access.companyId,
    p_actor: user.id,
    p_documents: ids,
  });
  const count = Number.isInteger(n) ? n : 0;
  return release ? { released: count } : { held: count };
}

/** 그 달 명세표가 늦었나 — 다음 달 INVOICE_DAY 일부터 (순수, today 'YYYY-MM-DD' 한국 날짜) */
export function heldLate(month, today) {
  return `${shiftMonth(month, 1)}-${String(INVOICE_DAY).padStart(2, '0')}` <= today;
}

/** ledger_held_documents 줄 → 거래처 · 달 묶음 (순수) */
export function groupHeld(rows, today) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isUuid(r.document_id)) continue;
    const day = r.issue_date || kstDate(r.created_at);
    const month = day.slice(0, 7);
    const key = `${r.supplier_key || '-'}|${month}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        supplier_key: r.supplier_key || null,
        supplier_name: null,
        biz_no: r.biz_no || null,
        name_key: r.name_key || null,
        invoice_mode: r.invoice_mode || null,
        month,
        count: 0,
        supply: 0,
        total: 0,
        late: heldLate(month, today),
        documents: [],
      };
      groups.set(key, g);
    }
    g.supplier_name = g.supplier_name || r.supplier_name || null;
    g.count += 1;
    g.supply = g.supply === null || !Number.isSafeInteger(r.supply_amount) ? null : g.supply + r.supply_amount;
    g.total = g.total === null || !Number.isSafeInteger(r.total_amount) ? null : g.total + r.total_amount;
    g.documents.push({
      id: r.document_id,
      issue_date: r.issue_date || null,
      supply_amount: Number.isSafeInteger(r.supply_amount) ? r.supply_amount : null,
      vat_amount: Number.isSafeInteger(r.vat_amount) ? r.vat_amount : null,
      total_amount: Number.isSafeInteger(r.total_amount) ? r.total_amount : null,
      created_at: r.created_at,
      held_at: r.held_at || null,
    });
  }
  return [...groups.values()].sort((a, b) => (a.month === b.month ? String(a.supplier_name).localeCompare(String(b.supplier_name), 'ko') : a.month < b.month ? -1 : 1));
}

/** GET /ledger/held */
export async function listHeld(env, { user, company, nowMs = Date.now() }) {
  const access = await reader(env, user, company);
  let rows;
  try {
    rows = await callRpc(env, 'ledger_held_documents', { p_company: access.companyId });
  } catch (e) {
    if (missing(e)) return { available: false, groups: [], count: 0, level: access.level, viewing: access.viewing };
    throw e;
  }
  const groups = groupHeld(rows, kstDate(nowMs));
  return { available: true, groups, count: groups.reduce((n, g) => n + g.count, 0), level: access.level, viewing: access.viewing };
}

// ── 붙이기 ────────────────────────────────────────────────

/** GET /ledger/held/entries */
export async function supplierEntries(env, { user, company, bizNo, nameKey }) {
  const biz = bizNo ? String(bizNo) : null;
  const name = nameKey ? String(nameKey) : null;
  if (biz !== null && !/^\d{10}$/.test(biz)) throw new ValidationError('biz_no 는 숫자 10자리입니다');
  if (name !== null && name.length > 200) throw new ValidationError('name_key 가 너무 깁니다');
  if (biz === null && name === null) throw new ValidationError('biz_no 나 name_key 가 필요합니다');
  const access = await reader(env, user, company);
  const rows = await rpc(env, 'ledger_supplier_entries', { p_company: access.companyId, p_biz: biz, p_name_key: name, p_limit: ENTRY_PICK });
  return { items: Array.isArray(rows) ? rows : [] };
}

/** POST /ledger/entries/:id/attach */
export async function attachStatements(env, { user, entryId, body }) {
  if (!isUuid(entryId)) throw new NotFoundError('장부 줄을 찾을 수 없습니다');
  const ids = documentIds(body && body.document_ids, ATTACH_MAX);
  const dry = body.dry_run === true;
  const access = await writer(env, user);
  // 붙일 줄은 자기 업체 줄이어야 한다 — DB 함수는 사진과 줄의 업체가 같은지만 본다
  const entry = await selectOne(env, 'ledger_entries', { id: `eq.${entryId}`, company_id: `eq.${access.companyId}`, select: 'id,voided_at' });
  if (!entry || entry.voided_at) throw new NotFoundError('장부 줄을 찾을 수 없습니다');
  if (dry) {
    const c = await rpc(env, 'ledger_statements_compare', { p_entry: entryId, p_documents: ids });
    if (!c || c.ok !== true) throw new NotFoundError('장부 줄을 찾을 수 없습니다');
    const compare = { ...c };
    delete compare.ok;
    return { attached: 0, compare, dry_run: true };
  }
  const r = await rpc(asActor(env, user), 'ledger_attach_statements', { p_entry: entryId, p_actor: user.id, p_documents: ids });
  if (!r || r.ok !== true) {
    const reason = (r && r.reason) || 'failed';
    if (reason === 'entry_not_found') throw new NotFoundError('장부 줄을 찾을 수 없습니다');
    if (reason === 'not_attachable') {
      throw new ConflictError('붙일 수 없는 사진이 있습니다 — 목록을 새로 받아 주세요', { code: 'not_attachable', documents: Array.isArray(r.documents) ? r.documents : [] });
    }
    throw new ConflictError('붙이지 못했습니다', { code: reason });
  }
  return { attached: r.attached || 0, compare: r.compare || null, dry_run: false };
}
