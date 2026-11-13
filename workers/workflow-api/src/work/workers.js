/**
 * 작업자 포털 — 작업자 자격 · 내 정보 · 관리자 작업자 탭 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   workers.status: pending → approved / rejected, approved ↔ suspended. 공개 신청도 초대도 pending 으로 시작 (★3)
 *   정지(suspended)는 새 작업 보기 · 신청 · 초대 수락만 막는다 — 지난 기록 · 진행 중인 일 정리는 된다 (access.js)
 *   수집: 표시 이름 · 휴대폰(선택) · 작업 종류 · 활동 지역 · 동의 버전 · 사진 동의(따로). 주민번호 · 계좌는 받지 않는다.
 *   관리자 메모(worker_notes)는 편집자(super_admin · admin)만 — support · moderator 는 403.
 *   가입 신청 · 상태 변경 · 종류 변경은 worker_events 에 한 줄씩 (실패해도 요청은 계속 — events.js)
 *
 *   2026-11-13 「작업자 한 길」 — 작업자는 팩토리마다 연결된다 (work/links.js · DB 0064):
 *     초대 없는 공개 신청은 다담 공장이 받는다 (다담 공장 연결 대기) · /work/me 에 연결된 팩토리 목록(links) ·
 *     사이트 관리자가 여기서 승인 · 정지하면 다담 공장 연결도 같은 상태로 맞춘다. workers.status 는 계정 상태로 남는다.
 *
 *   2026-11-14 작업자가 스스로 연결을 끊는다 — POST /work/links/:id/leave (대기 중이면 신청을 거둔다).
 *     연결 → ended. 그 팩토리의 답 없는 제안은 거절로 끝나고, 수락한 작업은 끝까지 간다 (새 배정만 막힌다).
 *     다시 연결하려면 그 팩토리의 초대 링크가 있어야 한다.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne, updateBy } from '../supabase.js';
import { declineOffersOnLeave } from './assignments.js';
import { isMissingRelation } from '../work-order-data.js';
import { WORKER_ACCESS_STATUSES, loadSelfWorker, requireAdminEditor, requireAdminReader } from './access.js';
import { recordWorkerEvent } from './events.js';
import { MINE_STATUSES, loadMyAssignments, myJobCards, openJobsFor, pickNextJob } from './jobs.js';
import { notifyWork } from './notify.js';
import { later, notifyCompanyWork, notifyWorkerStatus } from '../push/work-hooks.js';
import { workerSelf } from './reveal.js';
import { factoryRolesOf, openFactoryOf } from './factory.js';
import { assertUuid, kindsOf, oneOf, optBool, optPhone, optText, reqText } from './validate.js';
import { hqCompanyId } from '../supabase.js';
import { companyNames, linksOfWorker, requestLink, syncHqLink } from './links.js';

export const WORKER_STATUSES = Object.freeze(['pending', 'approved', 'suspended', 'rejected']);
/** 화면 · 409 문구의 상태 이름 */
export const WORKER_STATUS_LABEL = Object.freeze({ pending: '대기', approved: '승인', suspended: '정지', rejected: '반려' });
/** 관리자가 바꿀 수 있는 상태 전이 */
const WORKER_TRANSITIONS = Object.freeze({ pending: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved'], rejected: [] });

const nowIso = () => new Date().toISOString();
const ZERO = Object.freeze({ open: 0, mine: 0, revision: 0, newEvents: 0 });

/**
 * 신청서 칸 (공개 신청 · 초대 공통). preset 은 초대 링크의 이름 · 종류 — 종류는 편집자가 고른 프리셋이 우선.
 */
export function registrationFields(body, preset = null) {
  const b = body || {};
  const presetKinds = preset && Array.isArray(preset.kinds) ? preset.kinds : [];
  return {
    display_name: reqText(b.display_name === undefined || b.display_name === null || b.display_name === '' ? (preset && preset.display_name) || undefined : b.display_name, 30, '이름'),
    phone: optPhone(b.phone),
    kinds: presetKinds.length ? kindsOf(presetKinds) : kindsOf(b.kinds),
    region_label: optText(b.region_label, 40, '활동 지역'),
    consent_version: reqText(b.consent_version, 40, '동의 버전'),
    photo_consent: optBool(b.photo_consent, false, '사진 동의'),
  };
}

/**
 * 앱 배지 건수 + 다음 작업 — 모집중 · 내 작업 · 보완요청 · 마지막으로 본 뒤 회사 쪽 새 소식.
 * 정지된 작업자는 모집중 0 (새 작업을 볼 수 없다). 읽기만 — last_seen_at 은 건드리지 않는다 (내 작업 탭을 열 때만 갱신).
 */
async function summaryFor(env, worker) {
  const [open, mine, events] = await Promise.all([
    worker.status === 'approved' ? openJobsFor(env, worker) : [],
    loadMyAssignments(env, worker, 'mine'),
    selectMany(env, 'work_job_events', {
      'payload->>worker_id': `eq.${worker.id}`,
      actor_kind: 'neq.worker',
      created_at: `gt.${worker.last_seen_at || worker.approved_at || worker.created_at}`,
      select: 'id',
      limit: '100',
    }),
  ]);
  const counts = {
    open: open.length,
    mine: mine.length,
    revision: mine.filter((a) => a.status === 'revision').length,
    newEvents: (events || []).length,
  };
  return { counts, nextJob: pickNextJob(await myJobCards(env, worker, 'mine', mine)), mine };
}

/**
 * 내 진행 중 배정을 팩토리별로 — Map(팩토리 id → { offered 답 안 한 제안 수, working 수락한 뒤 ~ 확인 전 수 }).
 * mine 은 이미 읽어 둔 내 작업 탭 배정 (없으면 읽는다).
 */
async function heldByCompany(env, worker, mine = null) {
  const rows = mine || (await loadMyAssignments(env, worker, 'mine'));
  const out = new Map();
  const jobIds = [...new Set(rows.map((a) => a.job_id))];
  if (!jobIds.length) return out;
  const jobs = (await selectMany(env, 'work_jobs', { id: `in.(${jobIds.join(',')})`, select: 'id,company_id' })) || [];
  const companyOf = new Map(jobs.map((j) => [j.id, j.company_id]));
  for (const a of rows) {
    const co = companyOf.get(a.job_id);
    if (!co) continue;
    const h = out.get(co) || { offered: 0, working: 0 };
    if (a.status === 'offered') h.offered += 1;
    else h.working += 1;
    out.set(co, h);
  }
  return out;
}

/**
 * 연결된 팩토리 — [{ id, company_name, status, offered, working }] (끝난 연결은 뺀다). 연결 표가 없으면(0064 전) null.
 * id 는 연결 줄의 id (스스로 끊을 때 쓴다) — 팩토리 id 는 싣지 않는다.
 * offered · working 은 그 팩토리가 낸 작업 가운데 내가 답 안 한 제안 수 · 수락해서 맡고 있는 작업 수 (끊기 전 안내에 쓴다).
 */
async function linksFor(env, worker, mine = null) {
  const rows = await linksOfWorker(env, worker.id);
  if (rows === null) return null;
  const live = rows.filter((l) => l.status !== 'ended');
  if (!live.length) return [];
  const [names, held] = await Promise.all([companyNames(env, live.map((l) => l.company_id)), heldByCompany(env, worker, mine)]);
  return live.map((l) => {
    const h = held.get(l.company_id) || { offered: 0, working: 0 };
    return { id: l.id, company_name: names.get(l.company_id) || null, status: l.status, offered: h.offered, working: h.working };
  });
}

/**
 * GET /work/me — { ready, worker, counts, next_job, factory, links }. 표가 없으면 { ready:false } (화면은 메뉴 · 섹션을 숨긴다).
 * next_job 은 승인 · 정지 작업자의 내 작업 탭 중 하나 (JobCard, pickNextJob 규칙) — 없으면 null.
 * factory 는 승인된 작업자의 열린 공장 배정 { roles, from_link } — 없으면 null (화면의 「공장」 탭, work/factory.js).
 */
export async function getMe(env, { user }) {
  let worker;
  try {
    worker = await loadSelfWorker(env, user);
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, worker: null, counts: { ...ZERO }, next_job: null, factory: null, links: null };
    throw err;
  }
  if (!worker) return { ready: true, worker: null, counts: { ...ZERO }, next_job: null, factory: null, links: null };
  let counts = { ...ZERO };
  let nextJob = null;
  let mine = null;
  if (WORKER_ACCESS_STATUSES.includes(worker.status)) {
    try {
      ({ counts, nextJob, mine } = await summaryFor(env, worker));
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }
  }
  let factory = null;
  if (worker.status === 'approved') {
    try {
      const f = await openFactoryOf(env, worker.id);
      if (f) factory = { roles: factoryRolesOf(worker.kinds), from_link: !!f.link_id };
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }
  }
  const links = await linksFor(env, worker, mine).catch((e) => {
    console.warn('[work] 연결 읽기 실패:', e && e.message);
    return null;
  });
  return { ready: true, worker: workerSelf(worker), counts, next_job: nextJob, factory, links };
}

/** POST /work/register — 공개 신청 (pending). 이미 행이 있으면 409 */
export async function registerWorker(env, { user, body, ctx }) {
  const fields = registrationFields(body);
  if (await loadSelfWorker(env, user)) throw new ConflictError('이미 작업자로 등록돼 있습니다');
  let row;
  try {
    row = await insertOne(env, 'workers', { user_id: user.id, ...fields, status: 'pending', consent_at: nowIso() });
  } catch (err) {
    if (err instanceof ConflictError) throw new ConflictError('이미 작업자로 등록돼 있습니다');
    throw err;
  }
  await recordWorkerEvent(env, { workerId: row.id, actorUserId: user.id, actorKind: 'worker', type: 'registered', to: 'pending', payload: { via: 'public' } });
  // 초대 없는 공개 신청은 다담 공장이 받는다 — 다담 공장 연결을 대기로 (연결 표가 없으면 넘어간다)
  await hqCompanyId(env)
    .then((hq) => (hq ? requestLink(env, { companyId: hq, workerId: row.id, via: 'public', kinds: row.kinds || [] }) : null))
    .catch((e) => console.warn('[work] 다담 공장 연결 넣기 실패:', e && e.message));
  notifyWork(env, ctx, 'worker_registered', { workerName: row.display_name });
  return workerSelf(row);
}

/** 작업자가 스스로 끊을 수 있는 연결 상태 — 대기(신청 거두기) · 승인 · 정지. 반려된 연결은 끊을 것이 없다 */
export const LEAVABLE_LINK_STATUSES = Object.freeze(['pending', 'approved', 'suspended']);
/** 연결을 끊어 끝난 제안에 남기는 사유 — 팩토리 화면의 거절 사유 · 작업자의 지난 작업 탭에 보인다 */
export const LEFT_OFFER_REASON = '팩토리와의 연결을 끊어 제안이 끝났습니다';

/**
 * POST /work/links/:id/leave — 작업자가 스스로 팩토리와의 연결을 끊는다 (대기 중이면 신청을 거둔다).
 *   연결 → ended (decided_by = 작업자 본인 → 팩토리 화면에 「작업자가 끊음」).
 *   그 팩토리가 낸 작업의 답 없는 제안은 거절로 끝난다. 수락한 작업(확정 · 작업 중 · 완료 보고 · 보완요청)은 끝까지 간다.
 *   승인 · 정지된 연결을 끊으면 그 팩토리 대표 · 실장에게 알린다 (대기 신청을 거둘 때는 알리지 않는다).
 * → { id, status, company_name, declined, working }.
 * 없는 연결 · 남의 연결 404, 반려된 연결 409. 이미 끝난 연결은 그대로 돌려준다 (여러 번 눌러도 같은 결과).
 * 계정 상태(대기 · 정지)와 상관없이 본인이면 할 수 있다 — 정리하는 일이다.
 */
export async function leaveLink(env, { user, params, ctx }) {
  const id = assertUuid(params.id, '연결 id');
  const gone = () => new NotFoundError('연결을 찾을 수 없습니다');
  let worker;
  let link;
  try {
    worker = await loadSelfWorker(env, user);
    if (!worker) throw gone();
    link = await selectOne(env, 'worker_companies', { id: `eq.${id}`, worker_id: `eq.${worker.id}`, select: '*' });
  } catch (err) {
    if (isMissingRelation(err)) throw gone();
    throw err;
  }
  if (!link) throw gone();
  const names = await companyNames(env, [link.company_id]);
  const out = (l, extra = {}) => ({ id: l.id, status: l.status, company_name: names.get(l.company_id) || null, declined: 0, working: 0, ...extra });
  if (link.status === 'ended') return out(link);
  if (!LEAVABLE_LINK_STATUSES.includes(link.status)) throw new ConflictError('반려된 연결은 끊을 것이 없습니다');

  const at = nowIso();
  const rows = await updateBy(
    env,
    'worker_companies',
    { id: `eq.${id}`, worker_id: `eq.${worker.id}`, status: `eq.${link.status}` },
    { status: 'ended', decided_by: user.id, decided_at: at, reason: null, updated_at: at },
  );
  if (!rows || !rows.length) throw new ConflictError('그 사이 연결 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  await recordWorkerEvent(env, { workerId: worker.id, actorUserId: user.id, actorKind: 'worker', type: 'link_left', from: link.status, to: 'ended', payload: { link_id: id } });

  // 답 안 한 제안은 거절로 끝낸다 — 수락한 작업은 그대로 (끝까지 간다)
  const declined = await declineOffersOnLeave(env, { user, worker, companyId: link.company_id, reason: LEFT_OFFER_REASON })
    .catch((e) => {
      console.warn('[work] 연결 끊김 — 제안 정리 실패:', e && e.message);
      return 0;
    });
  const held = (await heldByCompany(env, worker).catch(() => new Map())).get(link.company_id);
  if (link.status !== 'pending') {
    await later(ctx, notifyCompanyWork(env, {
      companyId: link.company_id, kind: 'work_link_request', refId: id, params: { left: true }, suffix: `left-${at.replace(/[^0-9]/g, '')}`,
    }));
  }
  return out(rows[0], { declined, working: held ? held.working : 0 });
}

// ── 관리자 ───────────────────────────────────────────────────────

/**
 * GET /work/admin/workers?status= — 실적 건수(done_count: 승인된 배정 수) · 진행 중 배정 수(active_count) 포함.
 * active_count 는 offered · confirmed · started · submitted · revision 배정 수 (정지 확인 문구에 쓴다).
 */
export async function listWorkersAdmin(env, { user, query = {} }) {
  await requireAdminReader(env, user);
  const status = query.status ? oneOf(query.status, WORKER_STATUSES, 'status') : null;
  try {
    const q = { select: '*', order: 'created_at.desc', limit: '500' };
    if (status) q.status = `eq.${status}`;
    const rows = (await selectMany(env, 'workers', q)) || [];
    if (!rows.length) return { items: [] };
    const asg = (await selectMany(env, 'work_assignments', {
      worker_id: `in.(${rows.map((w) => w.id).join(',')})`,
      status: `in.(${['accepted', ...MINE_STATUSES].join(',')})`,
      select: 'worker_id,status',
    })) || [];
    const done = new Map();
    const active = new Map();
    for (const a of asg) {
      const m = a.status === 'accepted' ? done : active;
      m.set(a.worker_id, (m.get(a.worker_id) || 0) + 1);
    }
    return { items: rows.map((w) => ({ ...w, done_count: done.get(w.id) || 0, active_count: active.get(w.id) || 0 })) };
  } catch (err) {
    if (isMissingRelation(err)) return { items: [] };
    throw err;
  }
}

const sameKinds = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

/** PATCH /work/admin/workers/:id — 승인 · 반려 · 정지 · 종류 지정. 상태 · 종류가 바뀌면 worker_events 에 한 줄씩 */
export async function patchWorkerAdmin(env, { user, params, body, ctx }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업자 id');
  const b = body || {};
  const worker = await selectOne(env, 'workers', { id: `eq.${id}`, select: '*' });
  if (!worker) throw new NotFoundError('작업자를 찾을 수 없습니다');

  const patch = {};
  if (b.kinds !== undefined) patch.kinds = kindsOf(b.kinds);
  if (b.status !== undefined && b.status !== worker.status) {
    const next = oneOf(b.status, WORKER_STATUSES, 'status');
    if (!(WORKER_TRANSITIONS[worker.status] || []).includes(next)) {
      const label = (st) => WORKER_STATUS_LABEL[st] || st;
      throw new ConflictError(`'${label(worker.status)}' 상태에서 '${label(next)}'(으)로 바꿀 수 없습니다`);
    }
    patch.status = next;
    if (next === 'approved') {
      patch.approved_by = user.id;
      patch.approved_at = nowIso();
    }
    if (next === 'rejected') patch.reject_reason = optText(b.reject_reason, 200, '반려 사유');
  } else if (b.reject_reason !== undefined && worker.status === 'rejected') {
    patch.reject_reason = optText(b.reject_reason, 200, '반려 사유');
  }
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');

  const rows = await updateBy(env, 'workers', { id: `eq.${id}`, status: `eq.${worker.status}` }, { ...patch, updated_at: nowIso() });
  if (!rows || !rows.length) throw new ConflictError('작업자 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  if (patch.status) {
    await recordWorkerEvent(env, {
      workerId: id, actorUserId: user.id, actorKind: 'admin', type: 'status_changed',
      from: worker.status, to: patch.status, note: patch.status === 'rejected' ? patch.reject_reason : null,
    });
  }
  // 다담 공장 연결도 같은 상태로 (2026-11-13 — 사이트 관리자의 승인 · 정지는 다담 공장의 것이기도 하다)
  if (patch.status) await syncHqLink(env, { worker: rows[0], status: patch.status, userId: user.id });
  // 작업자 신청 결과 앱 알림 (승인 · 반려) — 응답 뒤에
  if (patch.status === 'approved' || patch.status === 'rejected') {
    await later(ctx, notifyWorkerStatus(env, { worker: rows[0], status: patch.status }));
  }
  if (patch.kinds && !sameKinds(patch.kinds, worker.kinds)) {
    await recordWorkerEvent(env, { workerId: id, actorUserId: user.id, actorKind: 'admin', type: 'kinds_changed', payload: { kinds: patch.kinds } });
  }
  return rows[0];
}

async function assertWorkerExists(env, id) {
  const w = await selectOne(env, 'workers', { id: `eq.${id}`, select: 'id' });
  if (!w) throw new NotFoundError('작업자를 찾을 수 없습니다');
}

/** GET /work/admin/workers/:id/events — 가입 · 상태 · 종류 이력, 최근순 200개 (관리자 읽기: support · moderator 포함). 표가 없으면 빈 목록 */
export async function listWorkerEvents(env, { user, params }) {
  await requireAdminReader(env, user);
  const id = assertUuid(params.id, '작업자 id');
  try {
    await assertWorkerExists(env, id);
    return { items: (await selectMany(env, 'worker_events', { worker_id: `eq.${id}`, select: '*', order: 'created_at.desc', limit: '200' })) || [] };
  } catch (err) {
    if (isMissingRelation(err)) return { items: [] };
    throw err;
  }
}

/** GET /work/admin/workers/:id/notes — 편집자만 */
export async function listWorkerNotes(env, { user, params }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업자 id');
  await assertWorkerExists(env, id);
  return { items: (await selectMany(env, 'worker_notes', { worker_id: `eq.${id}`, select: '*', order: 'created_at.desc', limit: '200' })) || [] };
}

/** POST /work/admin/workers/:id/notes — 편집자만 */
export async function addWorkerNote(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업자 id');
  const note = reqText(body && body.note, 1000, '메모');
  await assertWorkerExists(env, id);
  return insertOne(env, 'worker_notes', { worker_id: id, author: user.id, note });
}
