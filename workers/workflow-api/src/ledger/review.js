/**
 * 회계장부 — 사진 확인 (대표 · 실장). 읽기 걸기는 extract.js, 읽은 결과는 ledger_extractions (assistant-api 가 쓴다).
 *
 *   GET  /ledger/review                    확인할 사진 (?status= 기본 pending · ?before= · ?limit= 20, 50까지)
 *                                           + 최근 읽기 시도(상태 · 읽은 칸 · 검사) + 10분 서명 주소. ?company= 본사 보기만
 *   POST /ledger/documents/:id/post         확인한 사진 올리기 { target: entry | order_cost | attach, … } → ledger_post_document
 *                                           그 뒤 읽은 값과 올린 값이 다른 칸을 ledger_extraction_feedback 에 한 줄 (실패해도 올리기는 끝)
 *   POST /ledger/documents/:id/return       돌려보내기 { reason } — 확인 기다리는 사진만 (아니면 409)
 *   POST /ledger/documents/:id/reject       버리기 { reason } — 같다
 *   POST /ledger/documents/:id/reread       다시 읽기 (실패 · 거절 · 한도 뒤) → 202 { queued }
 *   POST /ledger/review/post                한꺼번에 올리기 { items: [{ id, …올리기 본문 }] } 20장까지, 장마다 따로 → [{ id, ok, … }]
 *   GET  /ledger/business-status?biz_no=    국세청 사업자 상태 (공공데이터포털 사업자등록정보 상태조회).
 *                                           시크릿 NTS_SERVICE_KEY 가 없으면 { available: false }. 24시간 캐시(nts_business_status),
 *                                           조회하면 이 업체의 같은 사업자번호 거래처 칸(nts_status · tax_type · nts_checked_at)도 고친다.
 *                                           키는 주소에 실어 보내므로 주소 · 키를 로그에 남기지 않는다
 *
 * 모두 대표 · 실장만 (직원은 403 not_money — 썸네일 · 읽은 칸 · 금액 · 서명 주소를 직원에게 주지 않는다).
 * 쓰기(올리기 · 돌려보내기 · 버리기 · 다시 읽기)는 자격 full 의 자기 업체만. 바꾼 사람은 asActor(x-actor-id) 로 남는다.
 */
import {
  selectOne,
  selectMany,
  insertOne,
  updateBy,
  upsertOne,
  callRpc,
  asActor,
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../supabase.js';
import { createSignedUrls } from '../storage.js';
import { requestExtract } from './extract.js';
import { COST_CATEGORIES } from '../orders.js';
import { assertCounterparty } from '../counterparties.js';
import { ledgerAccess, assertMoney, assertWritable } from './access.js';
import { checkAccount, withCounterparty } from './entries.js';
import { LEDGER_BUCKET, REVIEW_STATUSES, documentView } from './documents.js';
import { parseEntryInput, reasonOf, isUuid, isDate, normalizeBizNo, bizNoValid, EVIDENCE_TYPES } from './checks.js';

/** 확인 목록 · 서명 주소 · 한꺼번에 */
export const REVIEW_PAGE = 20;
export const REVIEW_MAX = 50;
export const PHOTO_URL_TTL_SEC = 600;
export const BATCH_MAX = 20;
/** 국세청 상태 캐시 */
export const NTS_CACHE_MS = 24 * 3600 * 1000;
export const NTS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';

const DOC_COLS = 'id,company_id,uploaded_by,storage_path,mime,size_bytes,sha256,width,height,note,review_status,decided_by,decided_at,decision_reason,created_at';
const EXTRACTION_COLS = 'id,document_id,attempt,status,model,schema_version,result,checks,error,started_at,finished_at';

// ── 확인 목록 ──────────────────────────────────────────────

function extractionView(x) {
  if (!x) return null;
  return {
    id: x.id,
    attempt: x.attempt,
    status: x.status,
    model: x.model || null,
    schema_version: x.schema_version ?? null,
    result: x.result || null,
    checks: x.checks || null,
    error: x.error || null,
    started_at: x.started_at,
    finished_at: x.finished_at || null,
  };
}

/** GET /ledger/review */
export async function listReview(env, { user, company, status, before, limit }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  const st = status || 'pending';
  if (!REVIEW_STATUSES.includes(st)) throw new ValidationError(`status 는 ${REVIEW_STATUSES.join(' · ')} 중 하나입니다`);
  const n = Math.min(Math.max(Number(limit) || REVIEW_PAGE, 1), REVIEW_MAX);
  const q = { company_id: `eq.${access.companyId}`, review_status: `eq.${st}`, select: DOC_COLS, order: 'created_at.desc', limit: String(n) };
  if (before) {
    if (!Number.isFinite(Date.parse(before))) throw new ValidationError('before 는 시각입니다');
    q.created_at = `lt.${new Date(before).toISOString()}`;
  }
  const rows = (await selectMany(env, 'ledger_documents', q)) || [];
  if (!rows.length) return { items: [], level: access.level, viewing: access.viewing };

  const ids = rows.map((r) => r.id);
  const attempts = (await selectMany(env, 'ledger_extractions', {
    document_id: `in.(${ids.join(',')})`,
    select: EXTRACTION_COLS,
    order: 'attempt.desc',
  })) || [];
  const latest = new Map();
  for (const x of attempts) {
    const cur = latest.get(x.document_id);
    if (!cur || x.attempt > cur.attempt) latest.set(x.document_id, x);
  }
  // 서명 주소 — 못 만들면 사진 칸만 비고 목록은 준다 (주소는 로그에 남기지 않는다)
  let urls = new Map();
  try {
    urls = await createSignedUrls(env, LEDGER_BUCKET, rows.map((r) => r.storage_path), PHOTO_URL_TTL_SEC);
  } catch (e) {
    console.error('[Ledger] photo sign failed:', e && e.statusCode ? e.statusCode : 'error');
  }
  return {
    items: rows.map((r) => ({
      ...documentView(r, true),
      photo_url: urls.get(r.storage_path) || null,
      photo_expires_in: PHOTO_URL_TTL_SEC,
      extraction: extractionView(latest.get(r.id)),
    })),
    level: access.level,
    viewing: access.viewing,
  };
}

// ── 올리기 ────────────────────────────────────────────────

function text(v, key, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ValidationError(`${key} 는 글이어야 합니다`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${key} 는 ${max}자 이하입니다`);
  return s === '' ? null : s;
}

function won(v, key, min) {
  const n = Number(v);
  if (v === null || v === '' || v === undefined || !Number.isSafeInteger(n) || n < min) {
    throw new ValidationError(`${key} 는 ${min} 이상 정수(원)입니다`);
  }
  return n;
}

/** 원가 줄 입력 (수주 원가로 올릴 때) — 수주 원가 넣기(orders.js addCost)와 같은 칸 · 같은 판정 */
export function parseCostInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('cost 가 필요합니다');
  const category = String(body.category || '').trim();
  if (!COST_CATEGORIES.includes(category)) throw new ValidationError(`category 는 ${COST_CATEGORIES.join(', ')} 중 하나여야 합니다`);
  const out = {
    category,
    amount: won(body.amount, 'amount', 1),
    description: text(body.description, 'description', 300),
    vendor_name: text(body.vendor_name, 'vendor_name', 100),
    vat_amount: body.vat_amount === undefined || body.vat_amount === null || body.vat_amount === '' ? null : won(body.vat_amount, 'vat_amount', 0),
    evidence_type: null,
    spent_on: null,
    counterparty_id: null,
  };
  if (body.evidence_type !== undefined && body.evidence_type !== null && body.evidence_type !== '') {
    if (!EVIDENCE_TYPES.includes(body.evidence_type)) throw new ValidationError(`evidence_type 은 ${EVIDENCE_TYPES.join(', ')} 중 하나여야 합니다`);
    out.evidence_type = body.evidence_type;
  }
  if (body.spent_on !== undefined && body.spent_on !== null && body.spent_on !== '') {
    if (!isDate(body.spent_on)) throw new ValidationError('spent_on 은 YYYY-MM-DD 날짜입니다');
    out.spent_on = body.spent_on;
  }
  if (body.counterparty_id !== undefined && body.counterparty_id !== null && body.counterparty_id !== '') {
    if (!isUuid(body.counterparty_id)) throw new ValidationError('counterparty_id 가 올바르지 않습니다');
    out.counterparty_id = body.counterparty_id;
  }
  return out;
}

/** 올리기 본문 → ledger_post_document 의 p_payload */
async function postPayload(env, access, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const target = body.target;
  if (target === 'entry') {
    let entry = parseEntryInput(body.entry);
    await checkAccount(env, entry.account, entry.direction);
    entry = await withCounterparty(env, access.companyId, entry);
    return { target, entry };
  }
  if (target === 'order_cost') {
    if (!isUuid(body.order_id)) throw new ValidationError('order_id 는 수주 id 입니다');
    const cost = parseCostInput(body.cost);
    // 공급처를 고르면 이름도 그 공급처로 (수주 원가 넣기와 같다)
    if (cost.counterparty_id) {
      const s = await assertCounterparty(env, cost.counterparty_id, 'supplier', access.companyId);
      cost.vendor_name = s.name;
    }
    return { target, order_id: body.order_id, cost };
  }
  if (target === 'attach') {
    const entryId = body.entry_id || null;
    const costId = body.cost_id || null;
    if ((entryId === null) === (costId === null)) throw new ValidationError('entry_id 와 cost_id 중 하나만 넣어 주세요');
    if (!isUuid(entryId || costId)) throw new ValidationError('붙일 줄 id 가 올바르지 않습니다');
    return entryId ? { target, entry_id: entryId } : { target, cost_id: costId };
  }
  throw new ValidationError('target 은 entry · order_cost · attach 중 하나입니다');
}

const NOT_FOUND_REASONS = {
  not_found: '사진을 찾을 수 없습니다',
  order_not_found: '수주를 찾을 수 없습니다',
  entry_not_found: '장부 줄을 찾을 수 없습니다',
  cost_not_found: '원가 줄을 찾을 수 없습니다',
};

/** 그 업체의 사진 — 없으면 404, 확인 기다림이 아니면 409 not_pending */
async function pendingDocument(env, companyId, documentId) {
  const doc = isUuid(documentId)
    ? await selectOne(env, 'ledger_documents', { id: `eq.${documentId}`, company_id: `eq.${companyId}`, select: 'id,company_id,review_status' })
    : null;
  if (!doc) throw new NotFoundError('사진을 찾을 수 없습니다');
  if (doc.review_status !== 'pending') throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending', status: doc.review_status });
  return doc;
}

/** 읽은 칸 ↔ 올린 칸 (올린 곳마다) */
const FEEDBACK_MAP = {
  entry: [
    ['issue_date', 'entry_date'],
    ['supplier_name', 'counterparty_name'],
    ['supplier_biz_no', 'counterparty_biz_no'],
    ['supply_amount', 'amount'],
    ['vat_amount', 'vat_amount'],
    ['evidence_type', 'evidence_type'],
    ['payment_method', 'payment_method'],
  ],
  order_cost: [
    ['issue_date', 'spent_on'],
    ['supplier_name', 'vendor_name'],
    ['supply_amount', 'amount'],
    ['vat_amount', 'vat_amount'],
    ['evidence_type', 'evidence_type'],
  ],
  attach: [],
};

const same = (a, b) => {
  const norm = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v.trim() : v);
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return x === y;
  if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y);
  return String(x) === String(y);
};

/**
 * 고친 칸 (순수) — 읽은 값과 올린 값이 다른 칸만 { 읽은 칸: { read, posted } }.
 * 장부 금액은 공제 안 되는 부가세를 합친 부담 금액일 수 있어 공급가와 다를 수 있다 — 그대로 남겨 평가가 가린다.
 */
export function feedbackFields(target, result, payload) {
  const posted = target === 'entry' ? payload.entry || {} : target === 'order_cost' ? payload.cost || {} : {};
  const fields = {};
  for (const [readKey, postedKey] of FEEDBACK_MAP[target] || []) {
    const read = result ? result[readKey] ?? null : null;
    const put = posted[postedKey] ?? null;
    if (!same(read, put)) fields[readKey] = { read, posted: put };
  }
  return fields;
}

/** 고친 칸 한 줄 — 읽은(done) 시도가 있을 때만. 실패해도 던지지 않는다 */
async function recordFeedback(env, { access, user, documentId, payload }) {
  try {
    const x = await selectOne(env, 'ledger_extractions', {
      document_id: `eq.${documentId}`,
      status: 'eq.done',
      select: 'id,result',
      order: 'attempt.desc',
    });
    if (!x) return;
    const fields = feedbackFields(payload.target, x.result, payload);
    await insertOne(env, 'ledger_extraction_feedback', {
      company_id: access.companyId,
      document_id: documentId,
      extraction_id: x.id,
      target: payload.target,
      fields,
      changed_count: Object.keys(fields).length,
      created_by: user.id,
    });
  } catch (e) {
    console.error('[Ledger] feedback failed:', e && e.statusCode ? e.statusCode : 'error');
  }
}

/** 한 장 올리기 (자격 · 역할은 부른 쪽이 봤다) */
async function postOne(env, access, user, documentId, body) {
  await pendingDocument(env, access.companyId, documentId);
  const payload = await postPayload(env, access, body);
  const r = await callRpc(asActor(env, user), 'ledger_post_document', { p_document: documentId, p_actor: user.id, p_payload: payload });
  if (!r || r.ok !== true) {
    const reason = (r && r.reason) || 'failed';
    if (reason === 'not_pending') throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending', status: r.status || null });
    if (NOT_FOUND_REASONS[reason]) throw new NotFoundError(NOT_FOUND_REASONS[reason]);
    throw new ConflictError('사진을 올리지 못했습니다', { code: reason });
  }
  await recordFeedback(env, { access, user, documentId, payload });
  return { document_id: documentId, target: payload.target, entry_id: r.entry_id || null, cost_id: r.cost_id || null, role: r.role || null };
}

async function writer(env, user) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  return access;
}

/** POST /ledger/documents/:id/post */
export async function postDocument(env, { user, documentId, body }) {
  return postOne(env, await writer(env, user), user, documentId, body);
}

/** POST /ledger/review/post — 장마다 따로, 실패한 장은 그 이유 */
export async function postBatch(env, { user, body }) {
  const access = await writer(env, user);
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) throw new ValidationError('items 가 필요합니다');
  if (items.length > BATCH_MAX) throw new ValidationError(`한 번에 ${BATCH_MAX}장까지 올립니다`);
  const ids = new Set();
  const out = [];
  for (const item of items) {
    const id = item && item.id;
    if (ids.has(id)) {
      out.push({ id, ok: false, status: 409, message: '같은 사진이 두 번 있습니다' });
      continue;
    }
    ids.add(id);
    try {
      const rest = { ...(item || {}) };
      delete rest.id;
      out.push({ id, ok: true, ...(await postOne(env, access, user, id, rest)) });
    } catch (e) {
      // 앞 장은 이미 올랐다 — 서버 오류여도 던지지 않고 그 장만 실패로 적는다
      const known = e && e.statusCode && e.statusCode < 500;
      if (!known) console.error('[Ledger] batch post failed:', e && e.statusCode ? e.statusCode : 'error');
      out.push({ id, ok: false, status: known ? e.statusCode : 500, message: known ? e.message : '올리지 못했습니다', code: known ? (e.details && e.details.code) || e.code || null : null });
    }
  }
  return { items: out, posted: out.filter((x) => x.ok).length };
}

/** POST /ledger/documents/:id/return · /reject */
export async function decideDocument(env, { user, documentId, body, status }) {
  if (status !== 'returned' && status !== 'rejected') throw new ValidationError('status 가 올바르지 않습니다');
  const access = await writer(env, user);
  const reason = reasonOf(body && body.reason);
  await pendingDocument(env, access.companyId, documentId);
  const rows = await updateBy(
    asActor(env, user),
    'ledger_documents',
    { id: `eq.${documentId}`, company_id: `eq.${access.companyId}`, review_status: 'eq.pending' },
    { review_status: status, decided_by: user.id, decided_at: new Date().toISOString(), decision_reason: reason },
  );
  if (!rows || !rows.length) throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending' });
  return { document: documentView(rows[0], true) };
}

/** POST /ledger/documents/:id/reread — 실패 · 거절 · 한도 뒤 다시 읽기 */
export async function rereadDocument(env, { user, documentId }) {
  const access = await writer(env, user);
  await pendingDocument(env, access.companyId, documentId);
  const out = await requestExtract(env, documentId, { again: true });
  return { queued: out.ok === true, reason: out.ok === true ? null : out.reason || null };
}

// ── 국세청 사업자 상태 ─────────────────────────────────────

const NTS_STATUS = { '01': 'active', '02': 'suspended', '03': 'closed' };

/** 상태조회 한 건 (순수) — 응답 data[0] → 캐시 줄 */
export function ntsRow(bizNo, d) {
  const status = NTS_STATUS[d && d.b_stt_cd] || 'unregistered';
  const end = d && typeof d.end_dt === 'string' && /^\d{8}$/.test(d.end_dt) ? `${d.end_dt.slice(0, 4)}-${d.end_dt.slice(4, 6)}-${d.end_dt.slice(6, 8)}` : null;
  const tax = status !== 'unregistered' && d && typeof d.tax_type === 'string' && d.tax_type.trim() ? d.tax_type.trim().slice(0, 60) : null;
  return { biz_no: bizNo, status, tax_type: tax, closed_on: end };
}

/** 공공데이터포털 조회 → 줄 | null (실패) — 키 · 주소는 로그에 남기지 않는다 */
async function lookupNts(env, bizNo) {
  let res;
  try {
    res = await fetch(`${NTS_URL}?serviceKey=${encodeURIComponent(env.NTS_SERVICE_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: [bizNo] }),
    });
  } catch {
    console.error('[Ledger] NTS lookup failed: network');
    return null;
  }
  if (!res.ok) {
    console.error('[Ledger] NTS lookup failed:', res.status);
    return null;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    console.error('[Ledger] NTS lookup failed: body');
    return null;
  }
  const d = body && Array.isArray(body.data) ? body.data.find((x) => x && String(x.b_no) === bizNo) : null;
  if (!body || body.status_code !== 'OK' || !d) {
    console.error('[Ledger] NTS lookup failed: status');
    return null;
  }
  return ntsRow(bizNo, d);
}

/** GET /ledger/business-status?biz_no= */
export async function businessStatus(env, { user, bizNo, nowMs = Date.now() }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  const b = normalizeBizNo(bizNo);
  if (!b || !bizNoValid(b)) throw new ValidationError('사업자등록번호가 올바르지 않습니다 (숫자 10자리, 검증 숫자)');
  if (!env.NTS_SERVICE_KEY) return { available: false, biz_no: b };

  const cached = await selectOne(env, 'nts_business_status', { biz_no: `eq.${b}`, select: 'biz_no,status,tax_type,closed_on,checked_at' });
  if (cached && nowMs - Date.parse(cached.checked_at) < NTS_CACHE_MS) {
    return { available: true, cached: true, ...cached };
  }
  const row = await lookupNts(env, b);
  if (!row) return { available: true, biz_no: b, status: null, error: 'lookup_failed' };
  const checkedAt = new Date(nowMs).toISOString();
  const saved = await upsertOne(env, 'nts_business_status', { ...row, checked_at: checkedAt }, 'biz_no');
  if (access.level === 'full') {
    await updateBy(env, 'counterparties', { company_id: `eq.${access.companyId}`, biz_no: `eq.${b}` }, {
      nts_status: row.status,
      tax_type: row.tax_type,
      nts_checked_at: checkedAt,
    });
  }
  return { available: true, cached: false, ...(saved || { ...row, checked_at: checkedAt }) };
}
