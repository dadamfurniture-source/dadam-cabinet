/**
 * 프로젝트 일지 — 누가 · 언제 · 무엇을 했는지 한 줄 남긴다 (project_events, DB 0078).
 * 2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차 — 「새로 생긴 일」 소식과 프로젝트 창 「일어난 일」에 「누가」가 붙고,
 * 한 건의 상태가 여러 번 바뀐 것도 남는다.
 *
 * 규칙
 *   · 원래 일을 막지 않는다 — 던지지 않는다. 표가 아직 없으면(DB 적용 전) 조용히 넘어간다.
 *   · 저장이 다 끝난 뒤에 부른다 (막 만든 프로젝트를 되돌리는 길이 일지 때문에 헷갈리지 않게).
 *   · 응답을 기다리게 하지 않는다 — ctx.waitUntil 이 있으면 응답 뒤에 쓴다 (ctx 가 없으면 기다린다 — 시험).
 *   · payload 에는 id · 상태 · 종류 값만. 이름 · 연락처 · 주소 · 금액 · 글은 넣지 않는다.
 *
 * actor  { id?: 계정 id, kind?: 'member' | 'customer' | 'worker' | 'admin' | 'system' }
 *        kind 를 안 주면 id 가 있을 때 member, 없으면 system.
 *
 * logProject  업체 · 프로젝트를 아는 곳에서.
 * logAt       수주 · 설계 · 문서 id 만 아는 곳(worker.js 의 서버 길 끝)에서 — 프로젝트를 찾아 적는다.
 *             프로젝트에 이어지지 않은 설계 · 수주의 일은 적지 않는다.
 *
 * 사건 이름(type) — 화면 글은 company-project.js HISTORY_LABEL 이 가진다:
 *   project_created · consult_accepted · assignee_changed · status_changed · design_linked · design_unlinked · design_sent ·
 *   quote_sent · quote_revoked · quote_viewed · quote_approved · quote_rejected · document_issued · document_revoked ·
 *   order_created · order_status · order_requested · approval_approved · approval_rejected · payment_paid
 *   둘째 묶음(2026-11-21): design_started · request_created · request_chosen · request_cancelled · request_recommended ·
 *   request_accepted · request_declined · request_expired · request_received · schedule_added · schedule_changed ·
 *   as_requested · as_cancelled · as_received · as_done · report_added
 *   실측(2026-11-21 뒤 공정 2차): schedule_added · schedule_changed (payload.type measurement, 대상 visit) · measure_done
 *   설치 날 고객 확인: schedule_confirmed (payload.type installation)
 */

import { insertOne, selectOne } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';

export const ACTOR_KINDS = Object.freeze(['member', 'customer', 'worker', 'admin', 'system']);
/** DB 의 길이 제약과 같다 (0078 project_events_len_check · payload_check) */
export const TYPE_MAX = 40;
const SUBJECT_TYPE_MAX = 30;
const SUBJECT_ID_MAX = 80;
const STATUS_MAX = 20;
const PAYLOAD_MAX_BYTES = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const text = (v, max) => (typeof v === 'string' && v && v.length <= max ? v : null);

/**
 * 넣을 줄 — 모자라거나 넘치면 null (그 사건은 적지 않는다. 던지지 않는다).
 * @param {{ companyId: string, projectId: string, actor?: { id?: string, kind?: string }, type: string,
 *           subject?: { type?: string, id?: string }, from?: string, to?: string, payload?: object }} ev
 */
export function eventRow(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  if (!isUuid(e.companyId) || !isUuid(e.projectId)) return null;
  const type = text(e.type, TYPE_MAX);
  if (!type) return null;
  const actor = e.actor && typeof e.actor === 'object' ? e.actor : {};
  const actorId = isUuid(actor.id) ? actor.id : null;
  const kind = ACTOR_KINDS.includes(actor.kind) ? actor.kind : actorId ? 'member' : 'system';
  const subject = e.subject && typeof e.subject === 'object' ? e.subject : {};
  const payload =
    e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? e.payload : {};
  // 너무 큰 payload 는 버린다 (사건 자체는 적는다)
  const fits = new TextEncoder().encode(JSON.stringify(payload)).length <= PAYLOAD_MAX_BYTES;
  return {
    company_id: e.companyId,
    project_id: e.projectId,
    actor_user_id: actorId,
    actor_kind: kind,
    type,
    subject_type: text(subject.type, SUBJECT_TYPE_MAX),
    subject_id:
      subject.id === undefined || subject.id === null
        ? null
        : text(String(subject.id), SUBJECT_ID_MAX),
    from_status: text(e.from, STATUS_MAX),
    to_status: text(e.to, STATUS_MAX),
    payload: fits ? payload : {},
  };
}

async function write(env, row) {
  try {
    await insertOne(env, 'project_events', row);
  } catch (err) {
    // 표가 아직 없으면(DB 0078 적용 전) 조용히 — 그 밖의 실패는 경고만 (원래 일은 이미 끝났다)
    if (!isMissingRelation(err))
      console.warn('project log: skipped —', row.type, err && err.message);
  }
}

/**
 * 일지 한 줄. 던지지 않는다. ctx.waitUntil 이 있으면 응답 뒤에 쓴다.
 * @returns {Promise<void>}
 */
export function logProject(env, ctx, ev) {
  const row = eventRow(ev);
  if (!row) return Promise.resolve();
  const job = write(env, row);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(job);
    return Promise.resolve();
  }
  return job;
}

const one = (env, table, id, select) => selectOne(env, table, { id: `eq.${id}`, select });

/** 어느 업체의 어느 프로젝트 일인가 — { companyId, projectId } | null (프로젝트에 이어지지 않았으면 null) */
export async function locate(env, where) {
  const w = where && typeof where === 'object' ? where : {};
  if (isUuid(w.project)) {
    const p = await one(env, 'projects', w.project, 'id,company_id');
    return p ? { companyId: p.company_id, projectId: p.id } : null;
  }
  if (isUuid(w.order)) {
    const o = await one(env, 'orders', w.order, 'id,company_id,project_id');
    return o && o.project_id ? { companyId: o.company_id, projectId: o.project_id } : null;
  }
  let designId = isUuid(w.design) ? w.design : null;
  if (!designId && isUuid(w.document)) {
    const d = await one(env, 'design_documents', w.document, 'id,design_id');
    designId = d && d.design_id ? d.design_id : null;
  }
  if (!designId) return null;
  const design = await one(env, 'designs', designId, 'id,company_id,project_id');
  return design && design.project_id && design.company_id
    ? { companyId: design.company_id, projectId: design.project_id }
    : null;
}

/**
 * 프로젝트를 찾아 일지 한 줄. 찾기까지 통째로 응답 뒤에 돌린다 (ctx.waitUntil). 무엇이 실패해도 던지지 않는다.
 * @param {{ project?: string, order?: string, design?: string, document?: string }} where
 * @param {object|object[]} ev  logProject 의 ev 에서 companyId · projectId 를 뺀 것 (여러 줄이면 배열 — 프로젝트는 한 번만 찾는다)
 */
export function logAt(env, ctx, where, ev) {
  const list = (Array.isArray(ev) ? ev : [ev]).filter((x) => x && typeof x === 'object');
  const job = (async () => {
    try {
      if (!list.length) return;
      const at = await locate(env, where);
      if (!at) return;
      for (const item of list) {
        const row = eventRow({ ...item, companyId: at.companyId, projectId: at.projectId });
        if (row) await write(env, row);
      }
    } catch (err) {
      if (!isMissingRelation(err))
        console.warn('project log: skipped —', list[0] && list[0].type, err && err.message);
    }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(job);
    return Promise.resolve();
  }
  return job;
}
