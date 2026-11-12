/**
 * 회계장부 — 사진 확인 (대표 · 실장). 읽기 걸기는 extract.js, 읽은 결과는 ledger_extractions (assistant-api 가 쓴다).
 *
 *   GET  /ledger/review                    확인할 사진 (?status= 기본 pending · ?before= · ?limit= 20, 50까지)
 *                                           + 최근 읽기 시도(상태 · 읽은 칸 · 검사) + 10분 서명 주소. ?company= 본사 보기만
 *                                           확인 기다리는 사진은 hints — 거래처 기억 · 경고 · 올릴 값 · 바로 올려도 되는가 (hints.js, DB 0033)
 *   POST /ledger/documents/:id/post         확인한 사진 올리기 { target: entry | order_cost | attach, … } → ledger_post_document
 *                                           그 뒤 읽은 값과 올린 값이 다른 칸을 ledger_extraction_feedback 에 한 줄 (실패해도 올리기는 끝)
 *   POST /ledger/documents/:id/return       돌려보내기 { reason } — 확인 기다리는 사진만 (아니면 409).
 *                                           응답 뒤 올린 사람에게 앱 알림 ledger_returned (src/push/ledger-hooks.js — 이유는 싣지 않는다)
 *   POST /ledger/documents/:id/reject       버리기 { reason } — 같다
 *   POST /ledger/documents/:id/reread       다시 읽기 (실패 · 거절 · 한도 뒤) → 202 { queued }
 *                                           사진 AI 읽기 자격이 없으면(Expert) { queued: false, reason: 'not_entitled' }
 *   POST /ledger/review/post                한꺼번에 올리기 { items: [{ id, …올리기 본문 }] } 20장까지, 장마다 따로 → [{ id, ok, … }]
 *                                           바로 올리기는 { id, ready: true, entry: 앱이 본 올릴 값 } — 서버가 힌트를 다시 세어
 *                                           아직 바로 올릴 수 있고 값이 같을 때만 그 값으로 올린다 (아니면 409 not_ready · changed)
 *   올리기는 사진 · 계정 · 읽기 시도 · 힌트를 한 번씩 읽고(postContext), 고친 칸 기록도 한 번에 넣는다 — 20장도 하위 요청 50개 안
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
  insertMany,
  updateBy,
  upsertOne,
  callRpc,
  asActor,
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../supabase.js';
import { createSignedUrls } from '../storage.js';
import { later } from '../push/work-hooks.js';
import { notifyLedgerReturned } from '../push/ledger-hooks.js';
import { requestExtractIfAi } from './extract.js';
import { COST_CATEGORIES } from '../orders.js';
import { assertCounterparty } from '../counterparties.js';
import { ledgerAccess, assertMoney, assertWritable } from './access.js';
import { checkAccount, withCounterparty, loadAccounts } from './entries.js';
import { hintView, loadHints, proposalFor, sameProposal } from './hints.js';
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
  // 확인 기다리는 사진 — 거래처 기억 · 경고 · 올릴 값 (0033 이 없으면 기억 없이 읽은 값만)
  let accounts = [];
  let hints = { map: new Map(), available: false };
  if (st === 'pending') {
    accounts = await loadAccounts(env);
    hints = await loadHints(env, access.companyId, ids);
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
      ...(st === 'pending' ? { hints: hintView(latest.get(r.id), hints.map.get(r.id) || null, accounts, { available: hints.available }) } : {}),
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

/** 올리기 본문 → ledger_post_document 의 p_payload (accounts 는 postContext 가 읽은 계정 목록) */
async function postPayload(env, access, body, accounts) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const target = body.target;
  if (target === 'entry') {
    let entry = parseEntryInput(body.entry);
    await checkAccount(env, entry.account, entry.direction, accounts);
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

/** postContext 가 읽은 사진 — 없으면 404, 확인 기다림이 아니면 409 not_pending */
function pendingFrom(ctx, documentId) {
  const doc = ctx.docs.get(documentId);
  if (!doc) throw new NotFoundError('사진을 찾을 수 없습니다');
  if (doc.review_status !== 'pending') throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending', status: doc.review_status });
  return doc;
}

/** 그 업체의 사진 — 없으면 404, 확인 기다림이 아니면 409 not_pending */
async function pendingDocument(env, companyId, documentId) {
  const doc = isUuid(documentId)
    ? await selectOne(env, 'ledger_documents', { id: `eq.${documentId}`, company_id: `eq.${companyId}`, select: 'id,company_id,review_status' })
    : null;
  if (!doc) throw new NotFoundError('사진을 찾을 수 없습니다');
  if (doc.review_status !== 'pending') throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending', status: doc.review_status });
  return doc;
}


const same = (a, b) => {
  const norm = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v.trim() : v);
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return x === y;
  if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y);
  return String(x) === String(y);
};

/**
 * 고친 칸 (순수) — 화면이 채운 값과 올린 값이 다른 칸만 { 칸: { read, posted } }.
 *   일자 · 상호 · 사업자번호 · 증빙 · 결제 수단은 읽은 값, 금액 · 부가세 · 계정은 화면이 채운 값(made — 공제 증빙 규칙 · 기억 · AI 제안),
 *   합계는 읽은 합계 ↔ 올린 금액 + 부가세. 계정이 다르면 그 제안이 어디서 왔는지(source)도 남긴다
 */
export function feedbackFields(target, result, payload, made = null) {
  if (target !== 'entry' && target !== 'order_cost') return {};
  const r = result || {};
  const shown = (made || proposalFor(r, null, [])).proposal;
  const posted = target === 'entry' ? payload.entry || {} : payload.cost || {};
  const total = Number.isSafeInteger(posted.amount) ? posted.amount + (Number(posted.vat_amount) || 0) : null;
  const pairs =
    target === 'entry'
      ? [
          ['issue_date', r.issue_date, posted.entry_date],
          ['supplier_name', r.supplier_name, posted.counterparty_name],
          ['supplier_biz_no', r.supplier_biz_no, posted.counterparty_biz_no],
          ['amount', shown.amount, posted.amount],
          ['vat_amount', shown.vat_amount, posted.vat_amount],
          ['total_amount', r.total_amount, total],
          ['evidence_type', r.evidence_type, posted.evidence_type],
          ['payment_method', r.payment_method, posted.payment_method],
          ['account', shown.account, posted.account],
        ]
      : [
          ['issue_date', r.issue_date, posted.spent_on],
          ['supplier_name', r.supplier_name, posted.vendor_name],
          ['amount', shown.amount, posted.amount],
          ['vat_amount', shown.vat_amount, posted.vat_amount],
          ['total_amount', r.total_amount, total],
          ['evidence_type', r.evidence_type, posted.evidence_type],
        ];
  const fields = {};
  for (const [k, read, put] of pairs) if (!same(read, put)) fields[k] = { read: read ?? null, posted: put ?? null };
  if (fields.account) fields.account.source = (made && made.sources.account) || null;
  return fields;
}

/**
 * 고친 칸 한 줄 (순수) — 읽은(done) 시도가 있을 때만, 아니면 null.
 * fields._meta 에 계정 제안 출처 · 읽은 판을 남긴다 (맞힌 장도 평가에 쓰게). changed_count 는 _meta 를 뺀 수
 */
export function feedbackRow(access, user, documentId, payload, done, made) {
  if (!done) return null;
  const fields = feedbackFields(payload.target, done.result, payload, made);
  return {
    company_id: access.companyId,
    document_id: documentId,
    extraction_id: done.id,
    target: payload.target,
    fields: { ...fields, _meta: { account_source: made ? made.sources.account : null, schema_version: done.schema_version ?? null } },
    changed_count: Object.keys(fields).length,
    created_by: user.id,
  };
}

/** 고친 칸 기록 넣기 — 실패해도 던지지 않는다 (올리기는 끝났다) */
async function saveFeedback(env, rows) {
  const list = rows.filter(Boolean);
  if (!list.length) return;
  try {
    await insertMany(env, 'ledger_extraction_feedback', list);
  } catch (e) {
    console.error('[Ledger] feedback failed:', e && e.statusCode ? e.statusCode : 'error');
  }
}

/** 올리기 바탕 — 사진 · 계정 · 읽기 시도 · 힌트를 한 번씩 읽는다 */
async function postContext(env, companyId, ids) {
  const valid = [...new Set(ids.filter(isUuid))];
  const ctx = { docs: new Map(), latest: new Map(), done: new Map(), accounts: [], hints: { map: new Map(), available: false } };
  if (!valid.length) return ctx;
  const inIds = `in.(${valid.join(',')})`;
  const docs = (await selectMany(env, 'ledger_documents', { id: inIds, company_id: `eq.${companyId}`, select: 'id,company_id,review_status' })) || [];
  for (const d of docs) ctx.docs.set(d.id, d);
  ctx.accounts = await loadAccounts(env);
  const attempts = (await selectMany(env, 'ledger_extractions', { document_id: inIds, select: 'id,document_id,attempt,status,schema_version,result,checks', order: 'attempt.desc' })) || [];
  for (const x of attempts) {
    const cur = ctx.latest.get(x.document_id);
    if (!cur || x.attempt > cur.attempt) ctx.latest.set(x.document_id, x);
    const d = ctx.done.get(x.document_id);
    if (x.status === 'done' && (!d || x.attempt > d.attempt)) ctx.done.set(x.document_id, x);
  }
  const pending = docs.filter((d) => d.review_status === 'pending').map((d) => d.id);
  ctx.hints = await loadHints(env, companyId, pending);
  return ctx;
}

/** 한 장 올리기 (자격 · 역할은 부른 쪽이 봤다) → { out, feedback } */
async function postOne(env, access, user, documentId, body, ctx) {
  pendingFrom(ctx, documentId);
  const view = hintView(ctx.latest.get(documentId), ctx.hints.map.get(documentId) || null, ctx.accounts, { available: ctx.hints.available });
  if (body && body.ready === true) {
    // 바로 올리기 — 앱이 본 값이 지금 값과 같고 아직 바로 올릴 수 있을 때만, 서버 값으로
    if (!view || !view.ready) throw new ConflictError('바로 올릴 수 없는 사진입니다 — 열어서 확인해 주세요', { code: 'not_ready', blockers: view ? view.blockers : ['not_read'] });
    if (!sameProposal(view.proposal, body.entry)) throw new ConflictError('목록을 본 뒤 값이 바뀌었습니다 — 다시 확인해 주세요', { code: 'changed' });
    body = { target: 'entry', entry: view.proposal };
  }
  const payload = await postPayload(env, access, body, ctx.accounts);
  const r = await callRpc(asActor(env, user), 'ledger_post_document', { p_document: documentId, p_actor: user.id, p_payload: payload });
  if (!r || r.ok !== true) {
    const reason = (r && r.reason) || 'failed';
    if (reason === 'not_pending') throw new ConflictError('이미 확인한 사진입니다', { code: 'not_pending', status: r.status || null });
    if (NOT_FOUND_REASONS[reason]) throw new NotFoundError(NOT_FOUND_REASONS[reason]);
    throw new ConflictError('사진을 올리지 못했습니다', { code: reason });
  }
  const done = ctx.done.get(documentId) || null;
  const made = done ? proposalFor(done.result, ctx.hints.map.get(documentId) || null, ctx.accounts) : null;
  return {
    out: { document_id: documentId, target: payload.target, entry_id: r.entry_id || null, cost_id: r.cost_id || null, role: r.role || null },
    feedback: feedbackRow(access, user, documentId, payload, done, made),
  };
}

async function writer(env, user) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  return access;
}

/** POST /ledger/documents/:id/post */
export async function postDocument(env, { user, documentId, body }) {
  const access = await writer(env, user);
  const ctx = await postContext(env, access.companyId, [documentId]);
  const { out, feedback } = await postOne(env, access, user, documentId, body, ctx);
  await saveFeedback(env, [feedback]);
  return out;
}

/** POST /ledger/review/post — 장마다 따로, 실패한 장은 그 이유 */
export async function postBatch(env, { user, body }) {
  const access = await writer(env, user);
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) throw new ValidationError('items 가 필요합니다');
  if (items.length > BATCH_MAX) throw new ValidationError(`한 번에 ${BATCH_MAX}장까지 올립니다`);
  const ctx = await postContext(env, access.companyId, items.map((i) => i && i.id).filter((id) => typeof id === 'string'));
  const ids = new Set();
  const out = [];
  const feedback = [];
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
      const done = await postOne(env, access, user, id, rest, ctx);
      out.push({ id, ok: true, ...done.out });
      feedback.push(done.feedback);
      // 같은 묶음 안에서 두 번 올리지 않게 — 올린 사진은 이제 확인 기다림이 아니다
      ctx.docs.set(id, { ...ctx.docs.get(id), review_status: 'posted' });
    } catch (e) {
      // 앞 장은 이미 올랐다 — 서버 오류여도 던지지 않고 그 장만 실패로 적는다
      const known = e && e.statusCode && e.statusCode < 500;
      if (!known) console.error('[Ledger] batch post failed:', e && e.statusCode ? e.statusCode : 'error');
      out.push({ id, ok: false, status: known ? e.statusCode : 500, message: known ? e.message : '올리지 못했습니다', code: known ? (e.details && e.details.code) || e.code || null : null });
    }
  }
  await saveFeedback(env, feedback);
  return { items: out, posted: out.filter((x) => x.ok).length };
}

/** POST /ledger/documents/:id/return · /reject */
export async function decideDocument(env, { user, documentId, body, status, ctx = null }) {
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
  // 돌려보내면 올린 사람에게 알림 — 응답 뒤에, 실패해도 결정은 그대로 (던지지 않는다)
  if (status === 'returned') await later(ctx, notifyLedgerReturned(env, { document: rows[0], actorId: user.id }));
  return { document: documentView(rows[0], true) };
}

/** POST /ledger/documents/:id/reread — 실패 · 거절 · 한도 뒤 다시 읽기 */
export async function rereadDocument(env, { user, documentId }) {
  const access = await writer(env, user);
  await pendingDocument(env, access.companyId, documentId);
  const out = await requestExtractIfAi(env, access.companyId, documentId, { again: true });
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
