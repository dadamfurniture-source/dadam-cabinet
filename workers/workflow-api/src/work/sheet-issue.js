/**
 * 지시서를 지금 판으로 맞춘다 — 간편 플래너 BOM 창 「작업지시서」 탭의 「지시서 내기」 단추
 * (2026-11-19 사장님 「단추 한 번에 모두」 · 「수주 없이도 작업」)
 *
 *   POST /designs/:designId/work-sheets/issue   { doc_type, snapshot_id? }
 *     doc_type     work_order(작업지시서) · installation_order(시공 지시서) · demolition_order(철거 지시서) · delivery_order(납품 지시서) 가운데 하나
 *     snapshot_id  맞출 동결본 (플래너가 마지막으로 보낸 것). 없으면 그 설계의 가장 새 동결본
 *   → { doc_type, action: 'issued' | 'kept', reason: 'none' | 'stale' | 'site_stale' | null,
 *       document { id, doc_no, rev, created_at }, early, carried_notes, superseded_count }
 *
 *   한 번에 문서 한 종류다 — 네 종류를 한 요청에 내면 바깥 호출 수가 요청 한도를 넘는다. 부르는 쪽(플래너 서버)이 종류마다 부른다.
 *   kept    지금 문서가 그 동결본으로 낸 것이고 현장 정보 · 일정도 그대로면 새로 내지 않는다 (판이 쓸데없이 오르지 않는다).
 *   issued  지금 문서가 없거나(none) · 다른 동결본으로 낸 것이거나(stale) · 현장 문서의 현장 정보 · 일정이 바뀌었으면(site_stale) 새 판을 낸다.
 *     작업지시서 — 고객이 확인서를 승인하기 전이면 사유를 「수주 전 작업」으로 적는다 (documents.js earlyWorkOrderReason — 승인 뒤에는 사유가 없다).
 *     앞 판에 사무실이 적은 특별 지시 · 특기사항은 새 판에 그대로 잇는다 (자동으로 뽑는 지시는 새 동결본에서 다시 뽑힌다).
 *     앞 판이 있었으면 그 작업을 맡은 작업자(확정 · 작업 중)에게 지시서가 바뀌었다고 알린다.
 *
 * 누가     그 설계를 볼 수 있는 사람 (문서 발행과 같다 — 등급은 documents.js DOC_PLANS).
 * 프로젝트 설계가 프로젝트에 이어져 있어야 한다 (아니면 409 no_project) — 작업자는 프로젝트 「작업 배정」에서 배정한다.
 * 고객 정보 응답에 없다 (문서 번호 · 판뿐).
 */
import { ConflictError, NotFoundError, ValidationError, assertDesignAccess, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { EARLY_WORK_ORDER_PREFIX, SITE_DOC_TYPES, issueDocument } from '../documents.js';
import { getSiteInfo, listSchedulesForDoc } from '../site-info.js';
import { later, notifyWorkSheet } from '../push/work-hooks.js';
import { currentDoc, ROLE_OF_JOB_KIND, DOC_TYPE_OF_ROLE } from './check-state.js';
import { officeNotesOfDoc } from './special-notes.js';
import { siteChanged } from './job-sheet.js';
import { assertUuid } from './validate.js';

/** 이 길로 내는 문서 — 작업마다의 지시서 넷 (고객 확인서는 발행 창에서) */
export const SHEET_DOC_TYPES = Object.freeze(['work_order', 'installation_order', 'demolition_order', 'delivery_order']);
/** 고객 승인 전에 낸 작업지시서의 사유 (2026-11-19 사장님 「수주 전 작업」) */
export const AUTO_EARLY_REASON = '수주 전 작업';

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}

/** 앞 판의 특기사항에서 승인 전 발행 사유 줄을 뗀 것 (새 판에서 그 줄은 다시 붙는다) */
export function carriedInstructions(doc) {
  const text = doc && doc.render_payload && typeof doc.render_payload.instructions === 'string' ? doc.render_payload.instructions : '';
  if (!text.startsWith(EARLY_WORK_ORDER_PREFIX)) return text;
  const cut = text.indexOf('\n');
  return cut < 0 ? '' : text.slice(cut + 1);
}

/** 문서 종류 → 그 지시서를 여는 작업 종류들 */
const kindsOfDocType = (docType) => Object.keys(ROLE_OF_JOB_KIND).filter((k) => DOC_TYPE_OF_ROLE[ROLE_OF_JOB_KIND[k]] === docType);

/** 지시서가 새 판으로 바뀌었다 → 그 설계의 그 작업들을 맡은 작업자에게 (응답 뒤에, 실패해도 발행은 그대로) */
async function notifyReissued(env, { design, docType, document }) {
  try {
    const kinds = kindsOfDocType(docType);
    const co = `eq.${design.company_id}`;
    const cols = 'id,kind,starts_at,schedule_id,project_id,status';
    const [byProject, byDesign] = await Promise.all([
      design.project_id
        ? selectMany(env, 'work_jobs', { project_id: `eq.${design.project_id}`, company_id: co, schedule_id: 'is.null', status: 'neq.cancelled', kind: `in.(${kinds.join(',')})`, select: cols, limit: '20' })
        : [],
      selectMany(env, 'work_jobs', { design_id: `eq.${design.id}`, company_id: co, status: 'neq.cancelled', kind: `in.(${kinds.join(',')})`, select: cols, limit: '20' }),
    ]);
    const jobs = new Map();
    [...(byProject || []), ...(byDesign || []).filter((j) => j.schedule_id)].forEach((j) => jobs.set(j.id, j));
    for (const job of jobs.values()) await notifyWorkSheet(env, { job, documentId: document.id });
  } catch (e) {
    if (!isMissingRelation(e)) console.warn('[sheet-issue] 작업자 알림 실패:', e && e.message);
  }
}

/** POST /designs/:designId/work-sheets/issue */
export async function issueDesignSheet(env, { user, params, body, ctx }) {
  const designId = assertUuid(params.designId, '설계 id');
  const b = body || {};
  if (!SHEET_DOC_TYPES.includes(b.doc_type)) throw new ValidationError(`doc_type 은 ${SHEET_DOC_TYPES.join(' · ')} 가운데 하나여야 합니다`, { field: 'doc_type' });
  const docType = b.doc_type;
  const pinnedId = b.snapshot_id === undefined || b.snapshot_id === null || b.snapshot_id === '' ? null : assertUuid(b.snapshot_id, '동결본 id');

  await assertDesignAccess(env, designId, user, { money: false });
  const design = await selectOne(env, 'designs', { id: `eq.${designId}`, select: 'id,project_id,company_id' });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
  if (!design.project_id) throw conflict('설계를 프로젝트에 먼저 이어 주세요', 'no_project');

  const base = pinnedId
    ? await selectOne(env, 'design_snapshots', { id: `eq.${pinnedId}`, design_id: `eq.${designId}`, select: 'id,rev' })
    : await selectOne(env, 'design_snapshots', { design_id: `eq.${designId}`, select: 'id,rev', order: 'rev.desc' });
  if (!base) throw new NotFoundError(pinnedId ? '이 설계의 동결본이 아닙니다' : '이 설계에는 동결본이 없습니다 — 먼저 앱으로 보내 주세요');

  const prev = await currentDoc(env, designId, docType);
  let reason = prev ? null : 'none';
  if (prev && prev.snapshot_id !== base.id) reason = 'stale';
  if (prev && !reason && SITE_DOC_TYPES.includes(docType)) {
    const [info, schedules] = await Promise.all([getSiteInfo(env, designId), listSchedulesForDoc(env, designId)]);
    if (siteChanged(prev, { info, schedules })) reason = 'site_stale';
  }
  const docOut = (d) => ({ id: d.id, doc_no: d.doc_no, rev: d.rev, created_at: d.created_at || null });
  if (!reason) return { doc_type: docType, action: 'kept', reason: null, document: docOut(prev), early: false, carried_notes: 0, superseded_count: 0 };

  const notes = prev ? officeNotesOfDoc(prev) : {};
  const carried = Object.values(notes).reduce((n, list) => n + list.length, 0);
  const issueBody = { doc_type: docType, snapshot_id: base.id };
  if (docType === 'work_order') issueBody.early_reason = AUTO_EARLY_REASON;
  if (docType === 'work_order' || docType === 'installation_order') issueBody.notes = notes;
  const instructions = prev ? carriedInstructions(prev) : '';
  if (instructions) issueBody.instructions = instructions;

  const out = await issueDocument(env, { user, body: issueBody });
  const doc = out.document;
  const text = doc.render_payload && typeof doc.render_payload.instructions === 'string' ? doc.render_payload.instructions : '';
  if (prev) await later(ctx, notifyReissued(env, { design, docType, document: doc }));
  return {
    doc_type: docType,
    action: 'issued',
    reason,
    document: docOut(doc),
    early: text.startsWith(EARLY_WORK_ORDER_PREFIX + AUTO_EARLY_REASON),
    carried_notes: carried,
    superseded_count: out.superseded_count || 0,
  };
}
