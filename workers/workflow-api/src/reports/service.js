/**
 * 작업 지시 보고 보관함 — 기록 · 조회 · 메모 · 백필 (docs/01-plan/work-reports-archive.plan.md §3 · §4).
 *
 * 기록(safeRecord · safeSyncStatus)은 **원래 흐름을 절대 막지 않는다** — 표가 없거나(SQL 미실행) DB 오류여도
 * 경고만 남기고 null 을 돌려준다. 제안 · 승인 · 발행 · Slack 은 보관함과 무관하게 끝까지 간다.
 */

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
  updateById,
} from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { adminRoleOf, assertAdminEditor, canEditRole } from './admin.js';
import {
  REPORT_KINDS,
  isUuid,
  kstDay,
  reportFromDecision,
  reportFromDocument,
  reportFromProposal,
  reportNote,
} from './record.js';

const TABLE = 'work_reports';
const LIST_COLUMNS = 'id,owner_id,kind,title,period_start,period_end,status,source_table,source_id,order_ids,design_ids,metrics,note,pinned,archived_at,created_by,created_at,updated_at';
const PAGE_SIZE = 30;

// ── 기록 ─────────────────────────────────────────────────────────

/**
 * 한 행 기록. 같은 원본(UNIQUE kind+source_id · 아침 요약 주인×날짜 · 월 마감 주인×달)이 이미 있으면
 * 본문은 그대로 두고 상태만 맞춘다 (추가 전용 — 백필·재시도 멱등).
 */
export async function recordReport(env, row) {
  if (!row || !REPORT_KINDS.includes(row.kind)) return null;
  try {
    return await insertOne(env, TABLE, row);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    if (row.status !== undefined && row.status !== null) {
      const filter = row.source_id
        ? { kind: `eq.${row.kind}`, source_id: `eq.${row.source_id}` }
        : { kind: `eq.${row.kind}`, owner_id: `eq.${row.owner_id}`, period_start: `eq.${row.period_start}` };
      await updateBy(env, TABLE, filter, { status: row.status, updated_at: new Date().toISOString() });
    }
    return null;
  }
}

/** 실패해도 던지지 않는 기록 — 원래 흐름에서 부른다. */
export async function safeRecord(env, row) {
  try {
    return await recordReport(env, row);
  } catch (err) {
    console.warn(`[reports] 보고 기록 실패 (${row && row.kind}) — 원래 흐름은 계속:`, isMissingRelation(err) ? 'work_reports 표 없음 (database/work-reports.sql 미실행)' : err && err.message);
    return null;
  }
}

/** 원천 상태가 바뀌면 보고의 상태 사본도 맞춘다 (제안 superseded · 승인 · 문서 대체 …). 실패해도 던지지 않는다. */
export async function safeSyncStatus(env, filter, status) {
  try {
    await updateBy(env, TABLE, filter, { status, updated_at: new Date().toISOString() });
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[reports] 상태 동기화 실패:', err && err.message);
  }
}

// ── 조회 ─────────────────────────────────────────────────────────

/** 보관함 쿼리 → PostgREST 필터 (순수, 시험용으로 노출). */
export function buildListQuery({ userId, all, query = {} }) {
  const q = { select: LIST_COLUMNS, order: 'pinned.desc,created_at.desc' };
  const and = [];
  if (!all) q.owner_id = `eq.${userId}`;
  const kinds = String(query.kind || '').split(',').map((k) => k.trim()).filter((k) => REPORT_KINDS.includes(k));
  if (kinds.length === 1) q.kind = `eq.${kinds[0]}`;
  else if (kinds.length > 1) q.kind = `in.(${kinds.join(',')})`;
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  if (day(query.from)) and.push(`created_at.gte.${day(query.from)}T00:00:00+09:00`);
  if (day(query.to)) and.push(`created_at.lte.${day(query.to)}T23:59:59+09:00`);
  if (query.status && /^[a-z_]{1,30}$/.test(query.status)) q.status = `eq.${query.status}`;
  if (isUuid(query.order)) q.order_ids = `cs.{${query.order}}`;
  if (query.q) {
    const term = String(query.q).replace(/[%*,()"\\]/g, ' ').trim().slice(0, 60);
    if (term) q.title = `ilike.*${term}*`;
  }
  if (query.pinned === '1') q.pinned = 'is.true';
  if (query.archived === 'only') q.archived_at = 'not.is.null';
  else if (query.archived !== '1') q.archived_at = 'is.null';
  if (and.length) q.and = `(${and.join(',')})`;
  const page = Math.max(1, Math.min(1000, parseInt(query.page, 10) || 1));
  q.limit = String(PAGE_SIZE + 1);
  q.offset = String((page - 1) * PAGE_SIZE);
  return { q, page };
}

/** 목록. 관리자는 `owner=all` 이 기본(전체), 그 밖은 본인 것만. */
export async function listReports(env, { user, query = {} }) {
  const role = await adminRoleOf(env, user);
  const all = Boolean(role) && query.owner !== 'mine';
  const { q, page } = buildListQuery({ userId: user.id, all, query });
  const rows = (await selectMany(env, TABLE, q)) || [];
  return {
    items: rows.slice(0, PAGE_SIZE),
    page,
    pageSize: PAGE_SIZE,
    hasMore: rows.length > PAGE_SIZE,
    scope: all ? 'all' : 'mine',
    role: role || null,
  };
}

async function loadVisible(env, user, id) {
  if (!isUuid(id)) throw new NotFoundError('보고를 찾을 수 없습니다');
  const row = await selectOne(env, TABLE, { id: `eq.${id}`, select: '*' });
  if (!row) throw new NotFoundError('보고를 찾을 수 없습니다');
  if (row.owner_id === user.id) return { row, role: await adminRoleOf(env, user) };
  const role = await adminRoleOf(env, user);
  if (!role) throw new NotFoundError('보고를 찾을 수 없습니다');
  return { row, role };
}

/** 한 건 (본문 포함). 인력 승인은 지시의 **지금 상태**(지시/완료/취소)를 함께 준다. */
export async function getReport(env, { user, id }) {
  const { row, role } = await loadVisible(env, user, id);
  let live = null;
  if (row.kind === 'staffing_decision' && row.source_id) {
    try {
      live = (await selectMany(env, 'production_assignments', {
        proposal_id: `eq.${row.source_id}`, select: 'id,work_date,status,done_at', order: 'work_date.asc', limit: '200',
      })) || [];
    } catch {
      live = null;
    }
  }
  return { ...row, live, can_edit: row.owner_id === user.id || canEditRole(role) };
}

/** 메모 · 고정 · 보관 처리만 바꾼다 (본문·숫자는 바꾸지 않는다). 주인 또는 admin 이상. */
export async function updateReportMeta(env, { user, id, body = {} }) {
  const { row, role } = await loadVisible(env, user, id);
  if (row.owner_id !== user.id && !canEditRole(role)) throw new ForbiddenError('관리자(admin 이상)만 바꿀 수 있습니다');
  const patch = {};
  if (typeof body.note === 'string') patch.note = body.note.slice(0, 4000);
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (typeof body.archived === 'boolean') patch.archived_at = body.archived ? new Date().toISOString() : null;
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 수 있는 것은 note · pinned · archived 뿐입니다');
  patch.updated_at = new Date().toISOString();
  return updateById(env, TABLE, row.id, patch);
}

/** 관리자 메모 보고 — 본인 이름으로 남는다. */
export async function createNote(env, { user, body = {} }) {
  const title = String(body.title || '').trim();
  if (!title) throw new ValidationError('제목이 필요합니다');
  return insertOne(env, TABLE, reportNote({ ownerId: user.id, title, note: body.note, createdBy: user.id }));
}

/** 목록 위 숫자 4개 — 이번 주 지시 · 결정 안 한 제안 · 지연 예상 주문 · 이번 달 추가 인건비. */
export async function reportSummary(env, { user, query = {} }) {
  const role = await adminRoleOf(env, user);
  const all = Boolean(role) && query.owner !== 'mine';
  const own = all ? {} : { owner_id: `eq.${user.id}` };
  const today = kstDay();
  const d = new Date(`${today}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [decisions, pending, brief] = await Promise.all([
    selectMany(env, TABLE, { ...own, kind: 'eq.staffing_decision', status: 'eq.approved', created_at: `gte.${monthStart}T00:00:00+09:00`, select: 'metrics,created_at', limit: '500' }),
    selectMany(env, TABLE, { ...own, kind: 'eq.production_plan', status: 'eq.pending', select: 'id', limit: '50' }),
    selectMany(env, TABLE, { ...own, kind: 'eq.daily_brief', select: 'metrics,period_start', order: 'period_start.desc', limit: '1' }),
  ]);
  const dec = decisions || [];
  const week = dec.filter((r) => kstDay(r.created_at) >= monday);
  return {
    weekAssignments: week.reduce((t, r) => t + (Number(r.metrics && r.metrics.assignments) || 0), 0),
    pendingProposals: (pending || []).length,
    lateOrders: brief && brief[0] ? Number(brief[0].metrics && brief[0].metrics.late) || 0 : null,
    lateAsOf: brief && brief[0] ? brief[0].period_start : null,
    monthExtraCost: dec.reduce((t, r) => t + (Number(r.metrics && r.metrics.cost) || 0), 0),
    scope: all ? 'all' : 'mine',
  };
}

// ── 백필 ─────────────────────────────────────────────────────────

async function pageAll(env, table, query, max = 5000) {
  const out = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const rows = (await selectMany(env, table, { ...query, limit: '1000', offset: String(offset) })) || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * 이미 쌓인 원천을 보관함에 옮겨 담는다 (멱등 — 다시 돌려도 같은 행은 한 번).
 *   production_proposals → production_plan, 결정된 것은 production_assignments 로 staffing_decision 재구성
 *   design_documents(work_order · installation_order) → 색인 행
 * 아침 요약 · 월 마감은 과거분이 없다 (월 마감은 PR 4 의 cron 이 채운다).
 */
export async function backfillReports(env, { user }) {
  await assertAdminEditor(env, user);
  const counts = { proposals: 0, decisions: 0, documents: 0, skipped: 0 };

  const proposals = await pageAll(env, 'production_proposals', { select: '*', order: 'created_at.asc' });
  for (const p of proposals) {
    if (await recordReport(env, reportFromProposal(p))) counts.proposals++;
    else counts.skipped++;
    if (p.status === 'approved' || p.status === 'dismissed') {
      const assignments = p.status === 'approved'
        ? (await selectMany(env, 'production_assignments', { proposal_id: `eq.${p.id}`, select: '*', order: 'work_date.asc', limit: '500' })) || []
        : [];
      const row = reportFromDecision(p, {
        decision: p.status === 'approved' ? 'approve' : 'dismiss',
        selected: null,
        chosen: [],
        assignments,
        deciderId: null,
        decidedAt: p.decided_at || p.created_at,
        reconstructed: true,
      });
      if (await recordReport(env, row)) counts.decisions++;
      else counts.skipped++;
    }
  }

  const docs = await pageAll(env, 'design_documents', {
    doc_type: 'in.(work_order,installation_order)',
    select: 'id,design_id,snapshot_id,doc_type,rev,doc_no,status,title,totals,created_at',
    order: 'created_at.asc',
  });
  if (docs.length) {
    const designIds = [...new Set(docs.map((d) => d.design_id))];
    const owners = new Map();
    const ordersByDesign = new Map();
    for (let i = 0; i < designIds.length; i += 200) {
      const chunk = designIds.slice(i, i + 200).join(',');
      for (const d of (await selectMany(env, 'designs', { id: `in.(${chunk})`, select: 'id,user_id', limit: '1000' })) || []) owners.set(d.id, d.user_id);
      for (const o of (await selectMany(env, 'orders', { design_id: `in.(${chunk})`, select: 'id,design_id', limit: '1000' })) || []) {
        if (!ordersByDesign.has(o.design_id)) ordersByDesign.set(o.design_id, []);
        ordersByDesign.get(o.design_id).push(o.id);
      }
    }
    for (const doc of docs) {
      const ownerId = owners.get(doc.design_id);
      if (!ownerId) { counts.skipped++; continue; }
      const row = reportFromDocument(doc, { ownerId, orderIds: ordersByDesign.get(doc.design_id) || [] });
      if (await recordReport(env, row)) counts.documents++;
      else counts.skipped++;
    }
  }
  return counts;
}

// ── 문서 발행 연결 (documents.js 에서 부른다) ────────────────────

/** 작업지시서 · 설치 지시서 발행 → 색인 행 + 같은 설계·종류의 옛 보고는 superseded. */
export async function recordDocumentIssued(env, { user, doc }) {
  if (!doc || (doc.doc_type !== 'work_order' && doc.doc_type !== 'installation_order')) return null;
  let orderIds = [];
  try {
    orderIds = ((await selectMany(env, 'orders', { design_id: `eq.${doc.design_id}`, select: 'id', limit: '50' })) || []).map((o) => o.id);
  } catch {
    orderIds = [];
  }
  await safeSyncStatus(env, {
    kind: `eq.${doc.doc_type}`, design_ids: `cs.{${doc.design_id}}`, source_id: `neq.${doc.id}`, status: 'neq.superseded',
  }, 'superseded');
  return safeRecord(env, reportFromDocument(doc, { ownerId: user.id, orderIds }));
}
