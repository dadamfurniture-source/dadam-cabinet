/**
 * 작업자 포털 — 작업자 자격 · 내 정보 · 관리자 작업자 탭 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   workers.status: pending → approved / rejected, approved ↔ suspended. 공개 신청도 초대도 pending 으로 시작 (★3)
 *   수집: 표시 이름 · 휴대폰(선택) · 작업 종류 · 활동 지역 · 동의 버전 · 사진 동의(따로). 주민번호 · 계좌는 받지 않는다.
 *   관리자 메모(worker_notes)는 편집자(super_admin · admin)만 — support · moderator 는 403.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne, updateBy } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { loadSelfWorker, requireAdminEditor, requireAdminReader } from './access.js';
import { MINE_STATUSES, openJobsFor } from './jobs.js';
import { notifyWork } from './notify.js';
import { workerSelf } from './reveal.js';
import { assertUuid, kindsOf, oneOf, optBool, optPhone, optText, reqText } from './validate.js';

export const WORKER_STATUSES = Object.freeze(['pending', 'approved', 'suspended', 'rejected']);
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

/** 앱 배지 건수 — 모집중 · 내 작업 · 보완요청 · 마지막으로 본 뒤 회사 쪽 새 소식 */
async function countsFor(env, worker) {
  const [open, mine, events] = await Promise.all([
    openJobsFor(env, worker),
    selectMany(env, 'work_assignments', { worker_id: `eq.${worker.id}`, status: `in.(${MINE_STATUSES.join(',')})`, select: 'id,status' }),
    selectMany(env, 'work_job_events', {
      'payload->>worker_id': `eq.${worker.id}`,
      actor_kind: 'neq.worker',
      created_at: `gt.${worker.last_seen_at || worker.approved_at || worker.created_at}`,
      select: 'id',
      limit: '100',
    }),
  ]);
  return {
    open: open.length,
    mine: (mine || []).length,
    revision: (mine || []).filter((a) => a.status === 'revision').length,
    newEvents: (events || []).length,
  };
}

/** GET /work/me — 표가 없으면 { ready:false } (화면은 메뉴 · 섹션을 숨긴다) */
export async function getMe(env, { user }) {
  let worker;
  try {
    worker = await loadSelfWorker(env, user);
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, worker: null, counts: { ...ZERO } };
    throw err;
  }
  if (!worker) return { ready: true, worker: null, counts: { ...ZERO } };
  let counts = { ...ZERO };
  if (worker.status === 'approved') {
    try {
      counts = await countsFor(env, worker);
    } catch (err) {
      if (!isMissingRelation(err)) throw err;
    }
  }
  return { ready: true, worker: workerSelf(worker), counts };
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
  notifyWork(env, ctx, 'worker_registered', { workerName: row.display_name });
  return workerSelf(row);
}

// ── 관리자 ───────────────────────────────────────────────────────

/** GET /work/admin/workers?status= — 실적 건수(승인된 배정 수) 포함 */
export async function listWorkersAdmin(env, { user, query = {} }) {
  await requireAdminReader(env, user);
  const status = query.status ? oneOf(query.status, WORKER_STATUSES, 'status') : null;
  try {
    const q = { select: '*', order: 'created_at.desc', limit: '500' };
    if (status) q.status = `eq.${status}`;
    const rows = (await selectMany(env, 'workers', q)) || [];
    if (!rows.length) return { items: [] };
    const accepted = (await selectMany(env, 'work_assignments', { worker_id: `in.(${rows.map((w) => w.id).join(',')})`, status: 'eq.accepted', select: 'worker_id' })) || [];
    const done = new Map();
    for (const a of accepted) done.set(a.worker_id, (done.get(a.worker_id) || 0) + 1);
    return { items: rows.map((w) => ({ ...w, done_count: done.get(w.id) || 0 })) };
  } catch (err) {
    if (isMissingRelation(err)) return { items: [] };
    throw err;
  }
}

/** PATCH /work/admin/workers/:id — 승인 · 반려 · 정지 · 종류 지정 */
export async function patchWorkerAdmin(env, { user, params, body }) {
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
      throw new ConflictError(`${worker.status} 에서 ${next} 로 바꿀 수 없습니다`);
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
  return rows[0];
}

async function assertWorkerExists(env, id) {
  const w = await selectOne(env, 'workers', { id: `eq.${id}`, select: 'id' });
  if (!w) throw new NotFoundError('작업자를 찾을 수 없습니다');
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
