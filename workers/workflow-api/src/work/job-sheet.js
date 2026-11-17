/**
 * 작업 줄의 지시서 — 작업 종류마다 어떤 문서를 여는지, 지금 그 문서가 있는지, 필수 확인이 얼마나 됐는지, 사무실 메모.
 * (2026-11-17 사장님 「각 작업자에게 보낼 작업지시서 각 작업에 작성되어서 확인 할 수 있도록」 —
 *  앱 프로젝트 「작업 배정」 줄마다 · 간편 플래너 BOM 창 「작업지시서」 탭 둘 다에서 본다)
 *
 *   작업 종류 → 문서 (check-state.js ROLE_OF_JOB_KIND · DOC_TYPE_OF_ROLE · PACKS_OF_ROLE):
 *     철거 → 철거 지시서 · 재단 · 엣지 → 작업지시서 재단 꾸러미 · 조립 → 작업지시서 조립 꾸러미 ·
 *     납품 → 납품 지시서 · 설치 → 설치 지시서 · A/S → 없음
 *   상태 state: no_design (이을 설계가 없다) · none (그 문서를 아직 내지 않았다) · issued (지금 문서가 있다)
 *
 *   GET  /designs/:designId/work-sheets        그 설계의 작업 종류마다 지시서 상태 (설계를 볼 수 있는 사람)
 *   PUT  /company/work/jobs/:id/sheet-memo     { memo } — 그 작업 줄의 사무실 메모 (대표 · 실장, 내 팩토리 작업만)
 *     메모는 문서에 고정하지 않는다 — 철거 · 납품 지시서를 열 때 읽어 넣는다 (templates/site-order.js).
 *     작업 설명(detail)과 다른 칸이다: detail 은 수락 전 작업자에게도 보이고, 메모는 지시서를 여는 사람(확정된 배정 · 사무실)만 본다.
 *
 * 고객 정보: 이 응답에는 없다 (문서 번호 · 판 · 수뿐). 다른 팩토리의 설계 · 작업은 404.
 * DB 0068 적용 전(work_jobs.sheet_memo 없음)이면 메모 쓰기는 409 db_pending, 읽기는 빈 값.
 */

import { ConflictError, NotFoundError, ValidationError, assertDesignAccess, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { checkListOfDoc, itemsFor, CHECK_ROLE_LABEL } from './check-items.js';
import { DOC_TYPE_OF_ROLE, PACKS_OF_ROLE, ROLE_OF_JOB_KIND, checkRows, roleChecks } from './check-state.js';
import { workersCompanyOf } from './company.js';
import { recordEvent } from './events.js';
import { lockJob } from './jobs.js';
import { KIND_LABEL, assertUuid } from './validate.js';

/** 사무실 메모 글자 수 — DB 0068 work_jobs_sheet_memo_chk 와 같다 */
export const SHEET_MEMO_MAX = 2000;
/** 지시서가 있는 작업 종류 — 일하는 차례 (플래너 「작업지시서」 탭의 줄 차례) */
export const SHEET_KINDS = Object.freeze(['demolition', 'cutting', 'edge', 'assembly', 'delivery', 'install']);
const DOC_LABEL = Object.freeze({ work_order: '작업지시서', installation_order: '설치 지시서', demolition_order: '철거 지시서', delivery_order: '납품 지시서' });

/** 작업 종류 → { role, doc_type, doc_label, packs } — 지시서가 없는 종류(A/S)는 null */
export function sheetKindOf(kind) {
  const role = ROLE_OF_JOB_KIND[kind];
  if (!role) return null;
  const docType = DOC_TYPE_OF_ROLE[role];
  return { role, doc_type: docType, doc_label: DOC_LABEL[docType], packs: PACKS_OF_ROLE[role] };
}

/** 문서 한 줄 → 응답 칸 (id · 번호 · 판 · 낸 때만) */
const docOut = (d) => ({ id: d.id, doc_no: d.doc_no, rev: d.rev, created_at: d.created_at || null });

/**
 * 한 요청 안에서 같은 설계 · 문서를 두 번 읽지 않는 읽개.
 *   docOf(designId, docType) → 지금 문서 (새 판에 밀리지 않고 회수되지 않은 마지막 rev) | null
 *   checksOf(doc, role)      → { done, total, must_left } | null (목록에 그 역할 항목이 없거나 · 0035 전)
 */
export function sheetReader(env) {
  const docs = new Map();
  const snaps = new Map();
  const docsOfDesign = async (designId) => {
    if (!docs.has(designId)) {
      docs.set(designId, selectMany(env, 'design_documents', {
        design_id: `eq.${designId}`, superseded_by: 'is.null', status: 'neq.revoked', select: 'id,doc_type,rev,doc_no,snapshot_id,render_payload,created_at', order: 'rev.desc', limit: '50',
      }).then((rows) => rows || []));
    }
    return docs.get(designId);
  };
  const snapOf = async (id) => {
    if (!snaps.has(id)) snaps.set(id, selectOne(env, 'design_snapshots', { id: `eq.${id}`, select: '*' }));
    return snaps.get(id);
  };
  return {
    async docOf(designId, docType) {
      if (!designId) return null;
      return (await docsOfDesign(designId)).find((d) => d.doc_type === docType) || null;
    },
    async checksOf(doc, role) {
      const list = checkListOfDoc(doc);
      if (!itemsFor(list, role).length) return null;
      const snapshot = await snapOf(doc.snapshot_id);
      if (!snapshot) return null;
      const rows = await checkRows(env, doc.id, [role]);
      if (rows === null) return null;
      const r = roleChecks({ doc, snapshot, list }, role, rows);
      return { done: r.done, total: r.total, must_left: r.must_left };
    },
  };
}

/**
 * 작업 종류 · 설계 → 그 줄의 지시서.
 * @returns {Promise<null | {doc_type:string, doc_label:string, role:string, packs:string[], state:'no_design'|'none'|'issued',
 *   document:{id:string, doc_no:string, rev:number, created_at:string|null}|null, checks:{done:number, total:number, must_left:number}|null}>}
 *   null = 지시서가 없는 종류 (A/S)
 */
export async function sheetOf(reader, { kind, designId }) {
  const k = sheetKindOf(kind);
  if (!k) return null;
  const base = { doc_type: k.doc_type, doc_label: k.doc_label, role: k.role, packs: k.packs };
  if (!designId) return { ...base, state: 'no_design', document: null, checks: null };
  const doc = await reader.docOf(designId, k.doc_type);
  if (!doc) return { ...base, state: 'none', document: null, checks: null };
  return { ...base, state: 'issued', document: docOut(doc), checks: await reader.checksOf(doc, k.role) };
}

/** 작업 줄의 사무실 메모 — 없거나 칸이 아직 없으면 null */
export const sheetMemoOf = (job) => (job && typeof job.sheet_memo === 'string' && job.sheet_memo.trim() ? job.sheet_memo : null);

/** 본문의 메모 — 글자, 앞뒤 빈칸 없이. 빈 글 · null 은 지우기 (null). 2000자를 넘으면 422 */
export function memoOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ValidationError('메모는 글자여야 합니다', { field: 'memo' });
  const s = value.trim();
  if (!s) return null;
  if (s.length > SHEET_MEMO_MAX) throw new ValidationError(`메모는 ${SHEET_MEMO_MAX}자까지입니다`, { field: 'memo' });
  return s;
}

/** DB 가 메모 칸을 아직 모른다 (0068 전 — 42703 · PGRST204) → 409 db_pending. 그 밖의 오류는 그대로 */
export function memoPending(e) {
  if (!isMissingRelation(e) && !/42703|PGRST204/.test(String((e && e.message) || ''))) return e;
  const err = new ConflictError('DB 0068 적용 전입니다 — 지시서 메모는 적용 뒤에 적을 수 있습니다');
  err.code = 'db_pending';
  return err;
}

/** 작업의 메모를 바꾼다 (잠금 · 기록). 값이 같으면 그대로 돌려준다 */
export async function writeSheetMemo(env, { user, job, memo }) {
  if ((sheetMemoOf(job) || null) === memo) return job;
  let locked;
  try {
    locked = await lockJob(env, job, { sheet_memo: memo });
  } catch (e) {
    throw memoPending(e);
  }
  await recordEvent(env, { jobId: job.id, actorUserId: user.id, actorKind: 'member', type: 'job_updated', from: job.status, to: locked.status, payload: { fields: ['sheet_memo'] } });
  return locked;
}

/** PUT /company/work/jobs/:id/sheet-memo — { memo } */
export async function putSheetMemo(env, { user, params, body }) {
  const jobId = assertUuid(params.id, '작업 id');
  const b = body || {};
  if (!Object.prototype.hasOwnProperty.call(b, 'memo')) throw new ValidationError('memo 가 필요합니다 (지우려면 빈 글)', { field: 'memo' });
  const memo = memoOf(b.memo);
  const { company } = await workersCompanyOf(env, user, { manage: true });
  const job = await selectOne(env, 'work_jobs', { id: `eq.${jobId}`, company_id: `eq.${company.id}`, select: '*' });
  if (!job) throw new NotFoundError('작업을 찾을 수 없습니다');
  if (!sheetKindOf(job.kind)) throw new ConflictError('지시서가 없는 작업입니다');
  if (job.status === 'cancelled') throw new ConflictError('취소된 작업의 메모는 바꿀 수 없습니다');
  const after = await writeSheetMemo(env, { user, job, memo });
  return { job_id: after.id, sheet_memo: sheetMemoOf(after) };
}

/**
 * 인쇄 화면에 넣을 메모 (GET /documents/:id/print?job=) — 그 작업이 이 문서의 설계 · 종류의 것일 때만.
 *   설계를 볼 수 있는지는 부르는 쪽이 이미 확인했다. 맞지 않으면 빈 글 (인쇄는 그대로 된다).
 */
export async function memoForPrint(env, { doc, jobId }) {
  if (!jobId || !doc) return '';
  let job;
  try {
    job = await selectOne(env, 'work_jobs', { id: `eq.${assertUuid(jobId, '작업 id')}`, select: 'id,kind,design_id,sheet_memo' });
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    if (isMissingRelation(e) || /42703|PGRST204/.test(String((e && e.message) || ''))) return '';
    throw e;
  }
  const k = job ? sheetKindOf(job.kind) : null;
  if (!k || job.design_id !== doc.design_id || k.doc_type !== doc.doc_type) return '';
  return sheetMemoOf(job) || '';
}

/** GET /designs/:designId/work-sheets — 작업 종류마다 그 설계의 지시서 상태 */
export async function listDesignWorkSheets(env, { user, designId }) {
  const id = assertUuid(designId, '설계 id');
  await assertDesignAccess(env, id, user, { money: false });
  const design = await selectOne(env, 'designs', { id: `eq.${id}`, select: 'id,project_id,company_id' });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
  const [project, order] = await Promise.all([
    design.project_id ? selectOne(env, 'projects', { id: `eq.${design.project_id}`, company_id: `eq.${design.company_id}`, select: 'id,title,status' }) : null,
    selectOne(env, 'orders', { design_id: `eq.${id}`, status: 'neq.cancelled', select: 'id', order: 'created_at.desc' }),
  ]);
  const reader = sheetReader(env);
  const sheets = [];
  for (const kind of SHEET_KINDS) {
    sheets.push({ kind, label: KIND_LABEL[kind], role_label: CHECK_ROLE_LABEL[ROLE_OF_JOB_KIND[kind]], ...(await sheetOf(reader, { kind, designId: id })) });
  }
  return {
    design_id: id,
    project: project ? { id: project.id, title: project.title || null, status: project.status } : null,
    has_order: !!order,
    sheets,
  };
}
