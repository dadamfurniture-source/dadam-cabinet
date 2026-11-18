/**
 * 작업 줄의 지시서 — 작업 종류마다 어떤 문서를 여는지, 지금 그 문서가 있는지, 필수 확인이 얼마나 됐는지, 사무실 메모.
 * (2026-11-17 사장님 「각 작업자에게 보낼 작업지시서 각 작업에 작성되어서 확인 할 수 있도록」 —
 *  앱 프로젝트 「작업 배정」 줄마다 · 간편 플래너 BOM 창 「작업지시서」 탭 둘 다에서 본다)
 *
 *   작업 종류 → 문서 (check-state.js ROLE_OF_JOB_KIND · DOC_TYPE_OF_ROLE · PACKS_OF_ROLE):
 *     철거 → 철거 지시서 · 재단 · 엣지 → 작업지시서 재단 꾸러미 · 조립 → 작업지시서 조립 꾸러미 ·
 *     납품 → 납품 지시서 · 설치 → 설치 지시서 · A/S → 없음
 *   상태 state: no_design (이을 설계가 없다) · none (그 문서를 아직 내지 않았다) · issued (지금 문서가 있다)
 *     state 값은 늘리지 않는다 (화면이 모르는 값이면 줄을 버린다) — 낸 문서가 낡았는지는 덧붙인 칸으로 알린다 (2026-11-19 「설계 바뀜」):
 *       stale       그 문서를 낸 동결본이 기준 동결본과 다르다. 기준 = ?snapshot_id= (플래너가 마지막으로 보낸 것) —
 *                   없으면 가장 새 동결본이고, 그 판이 문서를 낸 뒤에 만들어졌을 때만 (옛 판으로 되돌려 보낸 설계를 낡았다고 하지 않는다)
 *       site_stale  현장 문서(설치 · 철거 · 납품)가 고정한 현장 정보 · 일정이 지금과 다르다
 *     job  그 줄의 작업 · 작업자 상태 { state: no_project | no_schedule | none | unassigned | offered | linked | done, jobs, offered, linked, done, names[] }
 *     order_sheets  발주 줄 둘 — 도어재 발주 · 상판 발주 (작업자 없이 사무실이 여는 작업지시서 꾸러미 door · top)
 *
 *   GET  /designs/:designId/work-sheets[?snapshot_id=]  그 설계의 작업 종류마다 지시서 상태 (설계를 볼 수 있는 사람)
 *   PUT  /company/work/jobs/:id/sheet-memo     { memo } — 그 작업 줄의 사무실 메모 (대표 · 실장, 내 팩토리 작업만)
 *     메모는 문서에 고정하지 않는다 — 철거 · 납품 지시서를 열 때 읽어 넣는다 (templates/site-order.js).
 *     작업 설명(detail)과 다른 칸이다: detail 은 수락 전 작업자에게도 보이고, 메모는 지시서를 여는 사람(확정된 배정 · 사무실)만 본다.
 *
 * 고객 정보: 이 응답에는 없다 (문서 번호 · 판 · 수뿐). 다른 팩토리의 설계 · 작업은 404.
 * DB 0068 적용 전(work_jobs.sheet_memo 없음)이면 메모 쓰기는 409 db_pending, 읽기는 빈 값.
 *
 * 철거 지시서의 현장 사진 (sitePhotosOf — 2026-11-17 사장님 「철거 = … + 현장 사진」 · 처리방침 「5. 제3자 제공」 시공 작업자 줄):
 *   팩토리가 그 설계에 올려 둔 현장사진(간편 플래너 「현장사진」 칸)을 지시서를 열 때 읽어 넣는다 — 문서에 고정하지 않는다.
 *   사무실(그 설계를 보는 팩토리 구성원)에게는 늘, 작업자에게는 주소와 같은 때(수락 ~ 끝나고 7일 — reveal.js siteOpenFor)에만.
 */

import { ConflictError, NotFoundError, ValidationError, assertDesignAccess, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation, partClassOf } from '../work-order-data.js';
import { createSignedUrls } from '../storage.js';
import { getSiteInfo, listSchedulesForDoc } from '../site-info.js';
import { hasCountertop } from '../countertop.js';
import { DOC_PLANS, PLAN_REQUIRED_CODE, SITE_DOC_TYPES, assertCompanyPlan } from '../documents.js';
import { DRAFT_ID_RE, PHOTO_FILE_RE, PHOTOS_BUCKET } from '../planner-drafts.js';
import { PLANNER_SOURCE } from '../planner-handoff.js';
import { checkListOfDoc, itemsFor, CHECK_ROLE_LABEL, CHECK_ROLES } from './check-items.js';
import { DOC_TYPE_OF_ROLE, PACKS_OF_ROLE, ROLE_OF_JOB_KIND, checkRows, roleChecks } from './check-state.js';
import { workersCompanyOf } from './company.js';
import { recordEvent } from './events.js';
import { lockJob } from './jobs.js';
import { KIND_LABEL, PROJECT_KINDS, assertUuid } from './validate.js';

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

/** 꾸러미 이름 — 화면 단추 글 (작업지시서 ?pack=). 꾸러미가 늘면 여기만 고친다 (화면은 이 값을 그대로 쓴다) */
export const PACK_LABELS = Object.freeze({ cut: '재단 지시서', labels: '부재 라벨', assembly: '조립 지시서', door: '도어재 발주서', top: '상판 발주 요청서' });
const packLabelsOf = (packs) => Object.fromEntries((packs || []).filter((p) => PACK_LABELS[p]).map((p) => [p, PACK_LABELS[p]]));
/** 발주 줄 — 작업자 없이 사무실이 여는 작업지시서 꾸러미 (2026-11-19 사장님 「도어재 · 상판 발주: 탭에 줄 추가」) */
export const ORDER_SHEETS = Object.freeze([
  Object.freeze({ kind: 'door_order', label: '도어재 발주', pack: 'door' }),
  Object.freeze({ kind: 'top_order', label: '상판 발주', pack: 'top' }),
]);
/** 일정에서 생기는 작업 종류 → 그 일정 종류 (work/schedule-link.js SCHEDULE_JOB_KIND 의 거꾸로) */
const SCHEDULE_TYPE_OF_KIND = Object.freeze({ delivery: 'delivery', install: 'installation' });

/** 문서 한 줄 → 응답 칸 (id · 번호 · 판 · 낸 때만) */
const docOut = (d) => ({ id: d.id, doc_no: d.doc_no, rev: d.rev, created_at: d.created_at || null });

/** 현장 문서가 인쇄하는 현장 정보 칸 (templates/installation-order.js · site-order.js 의 현장 칸) */
const SITE_PRINT_KEYS = ['address', 'address_detail', 'floor', 'has_elevator', 'elevator_note', 'access_note', 'install_order', 'contact_name', 'contact_phone', 'notes'];
const sitePrint = (s) => JSON.stringify(SITE_PRINT_KEYS.map((k) => { const v = s ? s[k] : null; return v === undefined || v === '' ? null : v; }));
/** 일정은 종류 · 시각만 견준다 (담당 글 · 상태는 배정 · 진행에 따라 바뀐다). 취소한 일정은 뺀다 */
const schedulePrint = (list) => JSON.stringify((Array.isArray(list) ? list : []).filter((s) => s && s.status !== 'cancelled').map((s) => `${s.type}|${s.scheduled_at || ''}`).sort());

/**
 * 현장 문서가 고정한 현장 정보 · 일정이 지금과 다른가 (순수).
 * @param {object} doc  문서 (render_payload.site_info · schedules)
 * @param {{info:object|null, schedules:object[]}} now  지금 값 (site-info.js getSiteInfo · listSchedulesForDoc)
 */
export function siteChanged(doc, now) {
  const rp = (doc && doc.render_payload) || {};
  return sitePrint(rp.site_info) !== sitePrint(now && now.info) || schedulePrint(rp.schedules) !== schedulePrint(now && now.schedules);
}

/**
 * 한 요청 안에서 같은 설계 · 문서를 두 번 읽지 않는 읽개.
 *   docOf(designId, docType) → 지금 문서 (새 판에 밀리지 않고 회수되지 않은 마지막 rev) | null
 *   checksOf(doc, role)      → { done, total, must_left } | null (목록에 그 역할 항목이 없거나 · 0035 전)
 *   baseOf(designId, pinned) → 기준 동결본 { id, rev, created_at, pinned } | null (pinned = 플래너가 보낸 동결본 id)
 *   staleOf(doc, designId, pinned) · siteOf(designId) → { info, schedules } · siteStaleOf(doc, designId) · snapOf(id)
 */
export function sheetReader(env) {
  const docs = new Map();
  const snaps = new Map();
  const checks = new Map();
  const bases = new Map();
  const sites = new Map();
  // 문서의 체크 줄은 역할을 가리지 않고 한 번에 읽는다 — 줄(작업 종류)마다 다시 읽지 않게
  const rowsOf = (doc) => {
    if (!checks.has(doc.id)) checks.set(doc.id, checkRows(env, doc.id, CHECK_ROLES));
    return checks.get(doc.id);
  };
  const baseOf = (designId, pinned) => {
    const key = `${designId}|${pinned || ''}`;
    if (!bases.has(key)) {
      bases.set(key, (async () => {
        if (pinned) {
          const pin = await selectOne(env, 'design_snapshots', { id: `eq.${pinned}`, design_id: `eq.${designId}`, select: 'id,rev,created_at' });
          if (pin) return { id: pin.id, rev: pin.rev, created_at: pin.created_at || null, pinned: true };
        }
        const last = await selectOne(env, 'design_snapshots', { design_id: `eq.${designId}`, select: 'id,rev,created_at', order: 'rev.desc' });
        return last ? { id: last.id, rev: last.rev, created_at: last.created_at || null, pinned: false } : null;
      })());
    }
    return bases.get(key);
  };
  const siteOf = (designId) => {
    if (!sites.has(designId)) {
      sites.set(designId, Promise.all([getSiteInfo(env, designId), listSchedulesForDoc(env, designId)])
        .then(([info, schedules]) => ({ info: info || null, schedules: schedules || [] }))
        .catch((e) => {
          if (isMissingRelation(e)) return { info: null, schedules: [] };
          throw e;
        }));
    }
    return sites.get(designId);
  };
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
      const rows = await rowsOf(doc);
      if (rows === null) return null;
      const r = roleChecks({ doc, snapshot, list }, role, rows);
      return { done: r.done, total: r.total, must_left: r.must_left };
    },
    baseOf,
    siteOf,
    snapOf,
    /** 그 문서를 낸 동결본이 기준과 다른가 — 기준을 못 찾으면 낡았다고 하지 않는다 */
    async staleOf(doc, designId, pinned) {
      const base = await baseOf(designId, pinned);
      if (!base || doc.snapshot_id === base.id) return false;
      if (base.pinned) return true;
      const made = Date.parse(base.created_at || '');
      const issued = Date.parse(doc.created_at || '');
      return Number.isFinite(made) && Number.isFinite(issued) && made > issued;
    },
    /** 현장 문서의 현장 정보 · 일정이 바뀌었나 (현장 문서가 아니면 false) */
    async siteStaleOf(doc, designId) {
      if (!SITE_DOC_TYPES.includes(doc.doc_type)) return false;
      return siteChanged(doc, await siteOf(designId));
    },
  };
}

/**
 * 작업 종류 · 설계 → 그 줄의 지시서.
 * @returns {Promise<null | {doc_type:string, doc_label:string, role:string, packs:string[], state:'no_design'|'none'|'issued',
 *   document:{id:string, doc_no:string, rev:number, created_at:string|null}|null, checks:{done:number, total:number, must_left:number}|null}>}
 *   null = 지시서가 없는 종류 (A/S). 덧붙는 칸: pack_labels · stale · site_stale (머리말).
 *   pinned = 기준 동결본 id (플래너가 마지막으로 보낸 것), checks: false 면 필수 확인 수를 세지 않는다 (설계가 여럿인 줄의 둘째부터)
 */
export async function sheetOf(reader, { kind, designId, pinned = null, checks = true }) {
  const k = sheetKindOf(kind);
  if (!k) return null;
  const base = { doc_type: k.doc_type, doc_label: k.doc_label, role: k.role, packs: k.packs, pack_labels: packLabelsOf(k.packs), stale: false, site_stale: false };
  if (!designId) return { ...base, state: 'no_design', document: null, checks: null };
  const doc = await reader.docOf(designId, k.doc_type);
  if (!doc) return { ...base, state: 'none', document: null, checks: null };
  const [count, stale, siteStale] = await Promise.all([
    checks ? reader.checksOf(doc, k.role) : null,
    reader.staleOf(doc, designId, pinned),
    reader.siteStaleOf(doc, designId),
  ]);
  return { ...base, state: 'issued', document: docOut(doc), checks: count, stale, site_stale: siteStale };
}

/**
 * 발주 줄 둘 (도어재 발주 · 상판 발주) — 그 설계의 지금 작업지시서의 꾸러미 door · top.
 *   applies: 그 설계에 도어재 · 석재 상판이 있는가 (작업지시서가 있을 때만 안다 — 없으면 null)
 */
export async function orderSheetsOf(reader, { designId, pinned = null }) {
  const doc = designId ? await reader.docOf(designId, 'work_order') : null;
  const stale = doc ? await reader.staleOf(doc, designId, pinned) : false;
  const applies = { door: null, top: null };
  if (doc) {
    const snap = await reader.snapOf(doc.snapshot_id);
    const bom = snap ? snap.bom_payload : null;
    const mats = bom && Array.isArray(bom.materials) ? bom.materials : [];
    applies.door = mats.some((m) => partClassOf(m.part, Number(m.thickness)) === '도어');
    applies.top = !!hasCountertop(bom);
  }
  return ORDER_SHEETS.map((o) => ({
    kind: o.kind, label: o.label, doc_type: 'work_order', doc_label: DOC_LABEL.work_order, packs: [o.pack], pack_labels: packLabelsOf([o.pack]),
    state: doc ? 'issued' : 'none', stale, applies: applies[o.pack], document: doc ? docOut(doc) : null,
  }));
}

/** 수락한 뒤 ~ 확인 전의 배정 */
const LINKED_STATUSES = ['confirmed', 'started', 'submitted', 'revision'];
const DONE_JOB = ['done', 'closed'];

/**
 * 작업 줄의 작업자 상태 (순수) — 그 줄의 작업들 · 그 배정들 · 작업자 이름.
 * @returns {{state:'none'|'unassigned'|'offered'|'linked'|'done', jobs:number, offered:number, linked:number, done:number, names:string[]}}
 */
export function jobSummaryOf(jobs, assignments, names) {
  const list = jobs || [];
  if (!list.length) return { state: 'none', jobs: 0, offered: 0, linked: 0, done: 0, names: [] };
  const ids = new Set(list.map((j) => j.id));
  const mine = (assignments || []).filter((a) => ids.has(a.job_id));
  const offered = mine.filter((a) => a.status === 'offered');
  const linked = mine.filter((a) => LINKED_STATUSES.includes(a.status));
  const done = mine.filter((a) => a.status === 'accepted');
  const finished = list.every((j) => DONE_JOB.includes(j.status)) || (done.length > 0 && !offered.length && !linked.length);
  const state = finished ? 'done' : linked.length ? 'linked' : offered.length ? 'offered' : 'unassigned';
  const who = [...linked, ...offered, ...done].map((a) => (names ? names.get(a.worker_id) : null)).filter(Boolean);
  return { state, jobs: list.length, offered: offered.length, linked: linked.length, done: done.length, names: [...new Set(who)] };
}

/**
 * 그 설계의 작업 종류마다 작업자 상태 — 프로젝트 「작업 배정」의 작업(그 프로젝트 · 종류마다 하나) + 그 설계의 일정에서 생긴 작업.
 *   작업 표가 아직 없으면(0064 · 0065 전) null.
 * @returns {Promise<null | Map<string, object>>} 작업 종류 → jobSummaryOf 결과 (프로젝트가 없으면 no_project, 일정이 없으면 no_schedule)
 */
async function jobStatesOf(env, reader, design) {
  const co = `eq.${design.company_id}`;
  const cols = 'id,kind,status,schedule_id,project_id';
  let jobs;
  let assignments = [];
  const names = new Map();
  try {
    const [byProject, byDesign] = await Promise.all([
      design.project_id ? selectMany(env, 'work_jobs', { project_id: `eq.${design.project_id}`, company_id: co, schedule_id: 'is.null', status: 'neq.cancelled', select: cols, limit: '50' }) : [],
      selectMany(env, 'work_jobs', { design_id: `eq.${design.id}`, company_id: co, status: 'neq.cancelled', select: cols, limit: '50' }),
    ]);
    jobs = [...(byProject || []), ...(byDesign || []).filter((j) => j.schedule_id)];
    if (jobs.length) {
      assignments = (await selectMany(env, 'work_assignments', { job_id: `in.(${jobs.map((j) => j.id).join(',')})`, select: 'id,job_id,worker_id,status', limit: '500' })) || [];
      const workerIds = [...new Set(assignments.filter((a) => a.status === 'offered' || a.status === 'accepted' || LINKED_STATUSES.includes(a.status)).map((a) => a.worker_id))];
      if (workerIds.length) {
        const people = (await selectMany(env, 'workers', { id: `in.(${workerIds.join(',')})`, select: 'id,display_name', limit: '200' })) || [];
        people.forEach((w) => names.set(w.id, w.display_name));
      }
    }
  } catch (e) {
    if (isMissingRelation(e) || /42703|PGRST204/.test(String((e && e.message) || ''))) return null;
    throw e;
  }
  const empty = (state) => ({ state, jobs: 0, offered: 0, linked: 0, done: 0, names: [] });
  const out = new Map();
  for (const kind of SHEET_KINDS) {
    if (PROJECT_KINDS.includes(kind)) {
      out.set(kind, design.project_id ? jobSummaryOf(jobs.filter((j) => j.kind === kind && !j.schedule_id), assignments, names) : empty('no_project'));
      continue;
    }
    const mine = jobs.filter((j) => j.kind === kind && j.schedule_id);
    if (mine.length) {
      out.set(kind, jobSummaryOf(mine, assignments, names));
      continue;
    }
    const { schedules } = await reader.siteOf(design.id);
    const has = (schedules || []).some((s) => s.type === SCHEDULE_TYPE_OF_KIND[kind] && s.status !== 'cancelled');
    out.set(kind, empty(has ? 'none' : 'no_schedule'));
  }
  return out;
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
    job = await selectOne(env, 'work_jobs', { id: `eq.${assertUuid(jobId, '작업 id')}`, select: 'id,kind,design_id,project_id,schedule_id,company_id,sheet_memo' });
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    if (isMissingRelation(e) || /42703|PGRST204/.test(String((e && e.message) || ''))) return '';
    throw e;
  }
  const k = job ? sheetKindOf(job.kind) : null;
  if (!k || k.doc_type !== doc.doc_type) return '';
  if (job.design_id !== doc.design_id) {
    // 프로젝트 「작업 배정」의 작업은 그 프로젝트의 설계 모두의 것이다 (work/job-links.js) — 이 문서의 설계가 그 프로젝트 · 그 팩토리의 것이면 같은 메모
    if (!job.project_id || job.schedule_id || !job.company_id) return '';
    const design = await selectOne(env, 'designs', { id: `eq.${doc.design_id}`, company_id: `eq.${job.company_id}`, project_id: `eq.${job.project_id}`, select: 'id' });
    if (!design) return '';
  }
  return sheetMemoOf(job) || '';
}

/** 현장 사진을 싣는 문서 — 철거 지시서뿐 (처리방침에 적은 범위) */
export const SITE_PHOTO_DOC_TYPE = 'demolition_order';
/** 플래너 사진의 종류 — 현장사진 (dadam-planner-lite js/model.js PHOTO_KINDS) */
const SITE_PHOTO_KIND = 'site';
const PHOTO_ROW_LIMIT = '500';

/**
 * 그 설계의 현장 사진 — 1시간 서명 주소 목록 (플래너에 올린 차례).
 *   앱 설계(designs.source 'planner-lite' · source_ref = 플래너 설계 id) → 같은 팩토리의 플래너 설계(planner_drafts — 버린 것 제외)
 *   → model.photos 가운데 kind 'site' 이고 지우지 않은 것(planner_draft_photos.deleted_at 없음) → 비공개 버킷 planner-photos 서명 주소.
 *   PC 플래너로 보낸 설계는 사진이 그 PC 에 있다 → 빈 목록. 사진 글(note)은 싣지 않는다 — 사진만.
 *   못 읽으면 빈 목록 (지시서는 사진 없이 그대로 열린다 — resolvePrintAssets 와 같다).
 * 누구에게 줄지는 부르는 쪽이 정한다 (사무실 인쇄 · 현장이 열린 철거 작업자).
 * @param {object} env
 * @param {{design?:object|null, designId?:string|null, companyId?:string|null}} args  design = designs 행 (company_id · source · source_ref).
 *   companyId 를 주면 그 팩토리의 설계일 때만 (작업자 보기 — 작업을 낸 팩토리).
 * @returns {Promise<{url:string, w:number|null, h:number|null}[]>}
 */
export async function sitePhotosOf(env, { design = null, designId = null, companyId = null } = {}) {
  try {
    const d = design || (designId ? await selectOne(env, 'designs', { id: `eq.${designId}`, select: 'id,company_id,source,source_ref' }) : null);
    if (!d || !d.company_id || d.source !== PLANNER_SOURCE || !DRAFT_ID_RE.test(String(d.source_ref || ''))) return [];
    if (companyId && d.company_id !== companyId) return [];
    const draft = await selectOne(env, 'planner_drafts', {
      company_id: `eq.${d.company_id}`, id: `eq.${d.source_ref}`, discarded_at: 'is.null', select: 'id,photos:model->photos',
    });
    const files = [];
    for (const p of draft && Array.isArray(draft.photos) ? draft.photos : []) {
      if (p && p.kind === SITE_PHOTO_KIND && PHOTO_FILE_RE.test(String(p.file || '')) && !files.includes(p.file)) files.push(p.file);
    }
    if (!files.length) return [];
    const rows = (await selectMany(env, 'planner_draft_photos', {
      company_id: `eq.${d.company_id}`, draft_id: `eq.${draft.id}`, deleted_at: 'is.null', select: 'file,width,height', limit: PHOTO_ROW_LIMIT,
    })) || [];
    const live = new Map(rows.map((r) => [r.file, r]));
    const pathOf = (file) => `${d.company_id}/${draft.id}/${file}`;
    const kept = files.filter((f) => live.has(f));
    if (!kept.length) return [];
    const urls = await createSignedUrls(env, PHOTOS_BUCKET, kept.map(pathOf));
    return kept
      .map((f) => ({ url: urls.get(pathOf(f)) || '', w: live.get(f).width || null, h: live.get(f).height || null }))
      .filter((x) => x.url);
  } catch (e) {
    console.warn('[job-sheet] 현장 사진을 읽지 못했습니다 — 사진 없이 엽니다:', e && e.message);
    return [];
  }
}

/** 이 설계에 지시서를 낼 수 있는 등급인가 — { allowed, block: null | 'plan_required', min_plan? } (지시서 넷은 등급이 같다 — DOC_PLANS) */
async function issueGateOf(env, design) {
  try {
    await assertCompanyPlan(env, design.company_id, DOC_PLANS.work_order, '작업지시서는');
    return { allowed: true, block: null };
  } catch (e) {
    if (!e || e.code !== PLAN_REQUIRED_CODE) throw e;
    return { allowed: false, block: PLAN_REQUIRED_CODE, min_plan: (e.details && e.details.min_plan) || null };
  }
}

/**
 * GET /designs/:designId/work-sheets[?snapshot_id=] — 작업 종류마다 그 설계의 지시서 상태.
 *   snapshotId = 기준 동결본 (플래너가 마지막으로 보낸 것) — 그 설계의 것이 아니면 가장 새 동결본으로 본다.
 */
export async function listDesignWorkSheets(env, { user, designId, snapshotId = null }) {
  const id = assertUuid(designId, '설계 id');
  const pinned = snapshotId === undefined || snapshotId === null || snapshotId === '' ? null : assertUuid(snapshotId, '동결본 id');
  await assertDesignAccess(env, id, user, { money: false });
  const design = await selectOne(env, 'designs', { id: `eq.${id}`, select: 'id,project_id,company_id' });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
  const reader = sheetReader(env);
  const [project, order, approved, base, site, gate, jobStates] = await Promise.all([
    design.project_id ? selectOne(env, 'projects', { id: `eq.${design.project_id}`, company_id: `eq.${design.company_id}`, select: 'id,title,status' }) : null,
    selectOne(env, 'orders', { design_id: `eq.${id}`, status: 'neq.cancelled', select: 'id', order: 'created_at.desc' }),
    selectOne(env, 'design_documents', { design_id: `eq.${id}`, doc_type: 'eq.customer_confirmation', decision: 'eq.approved', select: 'id' }),
    reader.baseOf(id, pinned),
    reader.siteOf(id),
    issueGateOf(env, design),
    jobStatesOf(env, reader, design),
  ]);
  const sheets = [];
  for (const kind of SHEET_KINDS) {
    sheets.push({
      kind, label: KIND_LABEL[kind], role_label: CHECK_ROLE_LABEL[ROLE_OF_JOB_KIND[kind]],
      ...(await sheetOf(reader, { kind, designId: id, pinned })),
      job: jobStates ? jobStates.get(kind) : null,
    });
  }
  return {
    design_id: id,
    project: project ? { id: project.id, title: project.title || null, status: project.status } : null,
    has_order: !!order,
    approved: !!approved,
    snapshot: base ? { id: base.id, rev: base.rev, created_at: base.created_at } : null,
    issue: gate,
    site: { missing: !(site.info && typeof site.info.address === 'string' && site.info.address.trim()) },
    sheets,
    order_sheets: await orderSheetsOf(reader, { designId: id, pinned }),
  };
}
