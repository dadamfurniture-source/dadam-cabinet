/**
 * 팩토리의 작업자 한 명 — 이력 · 메모 (마이페이지 인사 › 작업자의 한 줄을 열었을 때).
 * (2026-11-14 사장님 「3번 진행」 — 「작업자 한 길」 2차로 미뤄 둔 「작업자 메모 · 이력」. 메모 표: DB 0066 worker_company_notes)
 *
 *   GET  /company/workers/:linkId           그 연결의 작업자 — 내 팩토리에서 한 일 · 연결 이력 · 메모 (구성원)
 *     { link_id, name, kinds, region, status, account_status, via, since, decided_at, reason, ended_by?, phone?,
 *       can_manage,
 *       counts { done, working, offered, declined, released, removed, no_show },
 *       jobs   [{ kind, label, at, status, status_label, where, project, no_show }]   내 팩토리가 낸 작업의 이 작업자 배정, 새 것부터 WORKER_HISTORY_MAX 줄
 *       events [{ type, from, to, by, at }]                                            이 연결의 신청 · 상태 변경 · 끊김
 *       notes  [{ id, body, by, mine, at }] | null,  notes_pending }                   메모 — 대표 · 실장 답에만. DB 0066 전이면 null + notes_pending
 *     where = install(설치 일정) · as(A/S 방문) · delivery(납품 일정) · project(프로젝트의 작업 배정) · pc(PC 관리자 화면에서 만든 작업)
 *     by    = member(팩토리 대표 · 실장) · worker(작업자 본인) · admin(사이트 관리자) · system
 *   POST /company/workers/:linkId/notes { body }   메모 남기기 (대표 · 실장) → { notes }
 *     쌓기만 한다 — 고치기 · 지우기는 없다 (DB 도 막는다).
 *
 * 누가       그 팩토리의 구성원이면 이력을 읽는다. 메모 · 전화는 대표 · 실장만. 다담 본사 구성원은 403.
 *            등급이 내려가거나 멈춘 팩토리도 읽기 · 메모는 된다 (지난 일을 볼 수 있게).
 * 다른 업체   연결 · 작업 · 메모를 모두 company_id 로 거른다. 남의 연결 id 는 404.
 *            이 작업자가 다른 팩토리에서 한 일 · 다른 팩토리의 메모는 읽지 않는다 — 작업은 내 팩토리가 낸 것만,
 *            이력은 이 연결의 id 가 적힌 줄만.
 * 작업자에게  메모는 작업자 본인에게 나가지 않는다 (작업자 응답은 reveal.js 를 거치고, 이 표를 읽는 작업자 경로가 없다).
 * 고객 정보   없다 — 작업은 종류 · 날짜 · 상태 · 프로젝트 이름만 싣는다 (제목 · 지역 · 주소 · 고객 이름은 싣지 않는다).
 * DB 0064 적용 전이면 409 db_pending. 메모만 0066 전이면 읽기는 notes_pending, 쓰기는 409 db_pending.
 */

import { ConflictError, NotFoundError, insertOne, selectMany, selectOne } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { endedBy, workersCompanyOf } from './company.js';
import { linksPending } from './links.js';
import { ASSIGNMENT_LABEL } from './schedule-link.js';
import { KIND_LABEL, assertUuid, reqText } from './validate.js';

/** 이력에 싣는 작업 줄 수 (건수는 모두 센다) */
export const WORKER_HISTORY_MAX = 50;
/** 메모 글자 수 — DB worker_company_notes_len_chk 와 같다 */
export const WORKER_NOTE_MAX = 1000;
/** 한 번에 돌려주는 메모 수 (새 것부터) */
export const WORKER_NOTES_LIMIT = 100;
/** 이 연결의 이력으로 보는 작업자 이력 종류 */
const LINK_EVENT_TYPES = Object.freeze(['link_requested', 'link_status_changed', 'link_left']);
const WORKING = Object.freeze(['confirmed', 'started', 'submitted', 'revision']);
const ID_CHUNK = 100;

/** 메모 표가 아직 없다 (0066 적용 전) → 409 db_pending */
function notesPending() {
  const err = new ConflictError('DB 0066 적용 전입니다 — 작업자 메모는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}

/** 연결 표가 없으면(0064 전) 409 db_pending 으로 */
async function ready(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw linksPending();
    throw e;
  }
}

/** 내 팩토리의 연결 한 줄 + 그 작업자 — 없거나 남의 것이면 404 */
async function loadLink(env, company, rawId) {
  const id = assertUuid(rawId, '연결 id');
  const link = await selectOne(env, 'worker_companies', {
    id: `eq.${id}`,
    company_id: `eq.${company.id}`,
    select: '*',
  });
  if (!link) throw new NotFoundError('연결을 찾을 수 없습니다');
  const worker = await selectOne(env, 'workers', {
    id: `eq.${link.worker_id}`,
    select: 'id,user_id,display_name,phone,kinds,region_label,status',
  });
  if (!worker) throw new NotFoundError('작업자를 찾을 수 없습니다');
  return { link, worker };
}

/** 작업이 어디서 생겼나 — 일정 줄(설치 · A/S · 납품) · 프로젝트의 작업 배정 · PC 관리자 화면 */
export function whereOf(job) {
  if (job.schedule_id)
    return job.kind === 'as' ? 'as' : job.kind === 'delivery' ? 'delivery' : 'install';
  return job.project_id ? 'project' : 'pc';
}

/** 내 팩토리가 낸 작업 가운데 주어진 id 들 — 일정 · 프로젝트 칸이 아직 없으면(0064 · 0065 전) 그 칸 없이 */
async function jobsOfCompany(env, companyId, jobIds) {
  const out = [];
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const q = {
      id: `in.(${jobIds.slice(i, i + ID_CHUNK).join(',')})`,
      company_id: `eq.${companyId}`,
    };
    try {
      out.push(
        ...((await selectMany(env, 'work_jobs', {
          ...q,
          select: 'id,kind,status,starts_at,schedule_id,project_id',
        })) || [])
      );
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      out.push(
        ...((await selectMany(env, 'work_jobs', { ...q, select: 'id,kind,status,starts_at' })) ||
          [])
      );
    }
  }
  return out;
}

/**
 * 배정들 → 건수 · 작업 줄 (순수). jobs 는 내 팩토리가 낸 작업만 넘긴다 — 여기 없는 작업의 배정은 버린다.
 * 줄은 작업 날짜가 새 것부터 (날짜가 없으면 배정한 때), WORKER_HISTORY_MAX 줄까지.
 */
export function historyOf(assignments, jobs, projectTitles = new Map()) {
  const byId = new Map((jobs || []).map((j) => [j.id, j]));
  const counts = {
    done: 0,
    working: 0,
    offered: 0,
    declined: 0,
    released: 0,
    removed: 0,
    no_show: 0,
  };
  const rows = [];
  for (const a of assignments || []) {
    const j = a && byId.get(a.job_id);
    if (!j) continue;
    if (a.status === 'accepted') counts.done += 1;
    else if (WORKING.includes(a.status)) counts.working += 1;
    else if (Object.prototype.hasOwnProperty.call(counts, a.status)) counts[a.status] += 1;
    if (a.no_show === true) counts.no_show += 1;
    rows.push({
      t: Date.parse(j.starts_at || a.created_at || '') || 0,
      row: {
        kind: j.kind,
        label: KIND_LABEL[j.kind] || j.kind,
        at: j.starts_at || null,
        status: a.status,
        status_label: ASSIGNMENT_LABEL[a.status] || a.status,
        where: whereOf(j),
        project: (j.project_id && projectTitles.get(j.project_id)) || null,
        no_show: a.no_show === true,
      },
    });
  }
  rows.sort((x, y) => y.t - x.t);
  return { counts, jobs: rows.slice(0, WORKER_HISTORY_MAX).map((r) => r.row) };
}

/** 이 작업자가 내 팩토리에서 한 일 */
async function loadHistory(env, companyId, workerId) {
  const assignments =
    (await selectMany(env, 'work_assignments', {
      worker_id: `eq.${workerId}`,
      select: 'id,job_id,status,no_show,created_at',
      order: 'created_at.desc',
      limit: '500',
    })) || [];
  const jobIds = [...new Set(assignments.map((a) => a.job_id).filter(Boolean))];
  if (!jobIds.length) return historyOf([], []);
  const jobs = await jobsOfCompany(env, companyId, jobIds);
  const projectIds = [...new Set(jobs.map((j) => j.project_id).filter(Boolean))];
  const projects = projectIds.length
    ? (await selectMany(env, 'projects', {
        id: `in.(${projectIds.join(',')})`,
        company_id: `eq.${companyId}`,
        select: 'id,title',
      })) || []
    : [];
  return historyOf(assignments, jobs, new Map(projects.map((p) => [p.id, p.title || null])));
}

/** 이 연결의 이력 — 작업자 이력 가운데 이 연결 id 가 적힌 줄만 (다른 팩토리와의 일은 읽지 않는다). 새 것부터 */
async function loadLinkEvents(env, link) {
  try {
    const rows =
      (await selectMany(env, 'worker_events', {
        worker_id: `eq.${link.worker_id}`,
        type: `in.(${LINK_EVENT_TYPES.join(',')})`,
        select: 'type,from_status,to_status,actor_kind,payload,created_at',
        order: 'created_at.desc',
        limit: '200',
      })) || [];
    return rows
      .filter((e) => e && e.payload && e.payload.link_id === link.id)
      .map((e) => ({
        type: e.type,
        from: e.from_status || null,
        to: e.to_status || null,
        by: e.actor_kind,
        at: e.created_at || null,
      }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/** 이 연결의 메모 — 새 것부터. 표가 없으면(0066 전) null. by = 남긴 구성원 이름 (없으면 null), mine = 내가 남긴 것 */
async function loadNotes(env, companyId, linkId, userId) {
  let rows;
  try {
    rows =
      (await selectMany(env, 'worker_company_notes', {
        link_id: `eq.${linkId}`,
        company_id: `eq.${companyId}`,
        select: 'id,author,note,created_at',
        order: 'created_at.desc',
        limit: String(WORKER_NOTES_LIMIT),
      })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
  const authors = [...new Set(rows.map((n) => n.author).filter(Boolean))];
  const profiles = authors.length
    ? (await selectMany(env, 'profiles', { id: `in.(${authors.join(',')})`, select: 'id,name' })) ||
      []
    : [];
  const nameOf = new Map(profiles.map((p) => [p.id, (p.name && String(p.name).trim()) || null]));
  return rows.map((n) => ({
    id: n.id,
    body: n.note,
    by: (n.author && nameOf.get(n.author)) || null,
    mine: !!n.author && n.author === userId,
    at: n.created_at || null,
  }));
}

/** GET /company/workers/:linkId */
export async function getCompanyWorker(env, { user, params }) {
  const { company, canAct } = await workersCompanyOf(env, user);
  return ready(async () => {
    const { link, worker } = await loadLink(env, company, params.linkId);
    const [history, events, notes] = await Promise.all([
      loadHistory(env, company.id, worker.id),
      loadLinkEvents(env, link),
      canAct ? loadNotes(env, company.id, link.id, user.id) : undefined,
    ]);
    const out = {
      link_id: link.id,
      name: worker.display_name,
      kinds: (link.kinds && link.kinds.length ? link.kinds : worker.kinds) || [],
      region: worker.region_label || null,
      status: link.status,
      account_status: worker.status,
      via: link.via,
      since: link.created_at,
      decided_at: link.decided_at || null,
      reason: link.reason || null,
      can_manage: canAct,
      counts: history.counts,
      jobs: history.jobs,
      events,
    };
    if (link.status === 'ended') out.ended_by = endedBy(link, worker);
    if (canAct) {
      out.phone = worker.phone || null;
      out.notes = notes;
      out.notes_pending = notes === null;
    }
    return out;
  });
}

/** POST /company/workers/:linkId/notes */
export async function addCompanyWorkerNote(env, { user, params, body }) {
  const text = reqText(body && body.body, WORKER_NOTE_MAX, '메모');
  const { company } = await workersCompanyOf(env, user, { manage: true });
  const { link } = await ready(() => loadLink(env, company, params.linkId));
  try {
    await insertOne(env, 'worker_company_notes', {
      link_id: link.id,
      company_id: company.id,
      author: user.id,
      note: text,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw notesPending();
    throw e;
  }
  return { notes: (await loadNotes(env, company.id, link.id, user.id)) || [] };
}
