/**
 * 작업자 포털 — 작업자 자격 · 내 정보 · 관리자 작업자 탭 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   workers.status: pending → approved / rejected, approved ↔ suspended. 공개 신청도 초대도 pending 으로 시작 (★3)
 *   정지(suspended)는 새 작업 보기 · 신청 · 초대 수락만 막는다 — 지난 기록 · 진행 중인 일 정리는 된다 (access.js)
 *   수집: 표시 이름 · 휴대폰(선택) · 작업 종류 · 활동 지역 · 동의 버전 · 사진 동의(따로). 주민번호 · 계좌는 받지 않는다.
 *   관리자 메모(worker_notes)는 편집자(super_admin · admin)만 — support · moderator 는 403.
 *   가입 신청 · 상태 변경 · 종류 변경은 worker_events 에 한 줄씩 (실패해도 요청은 계속 — events.js)
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne, updateBy } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { WORKER_ACCESS_STATUSES, loadSelfWorker, requireAdminEditor, requireAdminReader } from './access.js';
import { recordWorkerEvent } from './events.js';
import { MINE_STATUSES, loadMyAssignments, myJobCards, openJobsFor, pickNextJob } from './jobs.js';
import { notifyWork } from './notify.js';
import { later, notifyWorkerStatus } from '../push/work-hooks.js';
import { workerSelf } from './reveal.js';
import { assertUuid, kindsOf, oneOf, optBool, optPhone, optText, reqText } from './validate.js';

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
  return { counts, nextJob: pickNextJob(await myJobCards(env, worker, 'mine', mine)) };
}

/**
 * GET /work/me — { ready, worker, counts, next_job }. 표가 없으면 { ready:false } (화면은 메뉴 · 섹션을 숨긴다).
 * next_job 은 승인 · 정지 작업자의 내 작업 탭 중 하나 (JobCard, pickNextJob 규칙) — 없으면 null.
 */
export async function getMe(env, { user }) {
  let worker;
  try {
    worker = await loadSelfWorker(env, user);
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, worker: null, counts: { ...ZERO }, next_job: null };
    throw err;
  }
  if (!worker) return { ready: true, worker: null, counts: { ...ZERO }, next_job: null };
  let counts = { ...ZERO };
  let nextJob = null;
  if (WORKER_ACCESS_STATUSES.includes(worker.status)) {
    try {
      ({ counts, nextJob } = await summaryFor(env, worker));
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }
  }
  return { ready: true, worker: workerSelf(worker), counts, next_job: nextJob };
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
  notifyWork(env, ctx, 'worker_registered', { workerName: row.display_name });
  return workerSelf(row);
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
