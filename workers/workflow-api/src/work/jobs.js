/**
 * 작업자 포털 — 작업 (docs/01-plan/worker-portal-contract.md §1 · §3).
 *
 *   상태: draft → open → filled → in_progress → review(install · as) → done → closed, done 전 어디서나 → cancelled
 *   expired 는 저장하지 않는다 — open 이고 apply_deadline(화면 이름 "지원 종료일")이 지났으면 effective_status 로만 돌려준다
 *   자동 전이(computeJobStatus)는 배정이 바뀔 때마다 다시 계산한다. closed 는 편집자만.
 *   닫기(closed) · 취소(cancelled)가 성공하면 응답 없는 초대(offered)를 declined 로 끝낸다 (autoDeclineOffers).
 *   겹친 쓰기로 정리에서 빠진 초대는 declineOffersIfEnded 가, 정리 쓰기가 실패한 것은 같은 닫기 · 취소의 재호출이 끝낸다.
 *
 * 낙관적 잠금: 상태를 바꾸는 쓰기는 work_jobs.version 을 조건으로 건다 (id=eq.X&version=eq.N).
 * 결과가 비면 다른 관리자 · 작업자의 변경과 겹친 것이므로 409. 배정 행을 먼저 바꾼 뒤 잠그고,
 * 잠금이 실패하면 배정을 되돌린다 — 그래서 두 관리자가 동시에 승인해도 정원을 넘지 않는다.
 */

import { ConflictError, NotFoundError, ValidationError, insertOne, selectMany, selectOne, updateBy } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { requireAdminEditor, requireAdminReader, requireApprovedWorker, requireWorker } from './access.js';
import { recordEvent, recordJobStatusChange } from './events.js';
import { ACTIVE_STATUSES, COUNTED_STATUSES, effectiveStatus, jobCard, jobDetail, pickAssignment } from './reveal.js';
import { WORK_KINDS, assertUuid, oneOf, optBool, optInt, optIso, optText, optUuid, reqText } from './validate.js';

export const JOB_STATUSES = Object.freeze(['draft', 'open', 'filled', 'in_progress', 'review', 'done', 'closed', 'cancelled']);
export const JOB_MODES = Object.freeze(['open', 'invite', 'direct']);
export const PAY_UNITS = Object.freeze(['day', 'hour', 'meter', 'job']);

/** 검수(review)를 거치는 종류. 공장 조립은 "각자 스스로 검수" (work-order-stage.plan.md) — 완료 보고로 끝난다 */
const REVIEWED_KINDS = Object.freeze(['install', 'as']);
/** 자동 전이가 건드리지 않는 상태 */
const FROZEN_STATUSES = Object.freeze(['draft', 'done', 'closed', 'cancelled']);
/** 일이 시작된 배정 */
const STARTED_STATUSES = Object.freeze(['started', 'submitted', 'revision', 'accepted']);
/** 작업자 탭 — 내 작업(진행 중) · 완료(끝난 배정) */
export const MINE_STATUSES = Object.freeze(['offered', 'confirmed', 'started', 'submitted', 'revision']);
export const DONE_STATUSES = Object.freeze(['accepted', 'declined', 'released', 'removed']);

const nowIso = () => new Date().toISOString();
const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
const countBy = (rows, key) => {
  const m = new Map();
  for (const r of rows || []) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
};

export const needsReview = (kind) => REVIEWED_KINDS.includes(kind);

/** 정원에 세는 배정 수 */
export function countFilled(assignments) {
  return (assignments || []).filter((a) => COUNTED_STATUSES.includes(a.status)).length;
}

/**
 * 배정 목록으로 다시 계산한 작업 상태 (순수, 계약 §1 자동 전이).
 *   - draft · done · closed · cancelled 는 그대로
 *   - 일이 시작된 배정이 있으면: 정원 계산 배정이 모두 accepted → done, 모두 submitted/accepted 이고 검수 종류 → review, 아니면 in_progress
 *     응답 없는 초대(offered)는 보지 않는다 — 정원이 찬 뒤 남은 초대는 수락할 수 없어(409) 작업이 in_progress 에 갇힌다
 *   - 아니면 정원 계산 수 = slots → filled, 모자라면 open
 */
export function computeJobStatus(job, assignments) {
  if (FROZEN_STATUSES.includes(job.status)) return job.status;
  const working = (assignments || []).filter((a) => COUNTED_STATUSES.includes(a.status));
  if (working.some((a) => STARTED_STATUSES.includes(a.status))) {
    if (working.every((a) => a.status === 'accepted')) return 'done';
    if (needsReview(job.kind) && working.every((a) => a.status === 'submitted' || a.status === 'accepted')) return 'review';
    return 'in_progress';
  }
  return working.length >= job.slots ? 'filled' : 'open';
}

// ── 읽기 · 잠금 ──────────────────────────────────────────────────

export async function loadJob(env, id) {
  const job = await selectOne(env, 'work_jobs', { id: `eq.${id}`, select: '*' });
  if (!job) throw new NotFoundError('작업을 찾을 수 없습니다');
  return job;
}

export async function loadJobAssignments(env, jobId) {
  return (await selectMany(env, 'work_assignments', { job_id: `eq.${jobId}`, select: '*', order: 'created_at.asc', limit: '200' })) || [];
}

/** version 조건부 갱신 — 비면 409 */
export async function lockJob(env, job, patch = {}) {
  const rows = await updateBy(
    env,
    'work_jobs',
    { id: `eq.${job.id}`, version: `eq.${job.version}` },
    { ...patch, version: (Number(job.version) || 0) + 1, updated_at: nowIso() },
  );
  if (!rows || !rows.length) throw new ConflictError('다른 변경과 겹쳤습니다. 새로 고친 뒤 다시 시도하세요');
  return rows[0];
}

/**
 * 배정 상태 전이 + 작업 잠금.
 *   1) 배정을 from 상태일 때만 바꾼다 (두 번 누름 · 동시 요청은 여기서 409)
 *   2) 바뀐 배정으로 작업 상태를 다시 계산해 version 잠금으로 저장한다
 *   3) 잠금이 실패하면 배정을 원래 값으로 되돌리고 409
 *   4) 되돌린 값이 초대(offered)면 작업이 그 사이 닫히거나 취소됐는지 다시 본다 — 닫기 · 취소의 자동 정리는
 *      잠깐 바뀌어 있던 이 배정을 보지 못했으므로, 끝난 작업이면 여기서 같은 문구로 declined 로 끝낸다
 */
export async function transitionAssignment(env, { job, assignment, jobAssignments, from, patch }) {
  const rows = await updateBy(
    env,
    'work_assignments',
    { id: `eq.${assignment.id}`, status: `in.(${from.join(',')})` },
    { ...patch, updated_at: nowIso() },
  );
  if (!rows || !rows.length) throw new ConflictError('배정 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도하세요');
  const updated = rows[0];
  const after = (jobAssignments || []).map((a) => (a.id === updated.id ? updated : a));
  try {
    const locked = await lockJob(env, job, { status: computeJobStatus(job, after) });
    return { assignment: updated, job: locked };
  } catch (err) {
    const back = { updated_at: assignment.updated_at || nowIso() };
    for (const k of Object.keys(patch)) back[k] = assignment[k] === undefined ? null : assignment[k];
    await updateBy(env, 'work_assignments', { id: `eq.${assignment.id}`, status: `eq.${updated.status}` }, back)
      .catch((e) => console.warn('[work] 배정 되돌리기 실패:', e && e.message));
    if (assignment.status === 'offered') {
      await declineOffersIfEnded(env, job.id)
        .catch((e) => console.warn('[work] 남은 초대 정리 실패:', e && e.message));
    }
    throw err;
  }
}

/** 배정 전이 뒤 기록 — 배정 이벤트 한 줄 + 작업 상태가 바뀌었으면 system 한 줄 */
export async function recordAssignmentChange(env, { user, actorKind, type, before, after, job, lockedJob, note = null, payload = {} }) {
  await recordEvent(env, {
    jobId: job.id,
    assignmentId: after.id,
    actorUserId: user && user.id,
    actorKind,
    type,
    from: before ? before.status : null,
    to: after.status,
    note,
    payload: { worker_id: after.worker_id, ...payload },
  });
  if (lockedJob) await recordJobStatusChange(env, job, lockedJob);
}

/** 연결된 주문의 번호 · 고객 이름 (배정 작업자 상세에서 가려서 쓴다). 표 · 행이 없으면 null */
async function loadOrderLabel(env, orderId) {
  if (!orderId) return null;
  try {
    return await selectOne(env, 'orders', { id: `eq.${orderId}`, select: 'order_no,customer_name' });
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

// ── 작업자 ───────────────────────────────────────────────────────

const WORKER_TABS = ['open', 'mine', 'done'];

/** 작업자가 모집중으로 볼 수 있는 작업인가 — 승인된 작업자 · 공개 모집 · 지원 종료일 전 · 내 종류 (정지된 작업자는 모집중 열람 경로가 없다) */
export function isBrowsable(job, worker, now = Date.now()) {
  return worker.status === 'approved'
    && job.status === 'open' && job.mode === 'open'
    && Array.isArray(worker.kinds) && worker.kinds.includes(job.kind)
    && effectiveStatus(job, now) === 'open';
}

/** 모집중 탭의 작업 (마감은 읽을 때 거른다) */
export async function openJobsFor(env, worker) {
  const kinds = (worker.kinds || []).filter((k) => WORK_KINDS.includes(k));
  if (!kinds.length) return [];
  const rows = (await selectMany(env, 'work_jobs', {
    status: 'eq.open',
    mode: 'eq.open',
    kind: `in.(${kinds.join(',')})`,
    select: '*',
    order: 'starts_at.asc.nullslast,created_at.desc',
    limit: '200',
  })) || [];
  const now = Date.now();
  return rows.filter((j) => isBrowsable(j, worker, now));
}

/** 카드 묶음 — 확정 수 · 내 신청 · 내 배정(pool 안에서 고른다) */
async function cardsFor(env, worker, jobs, pool) {
  if (!jobs.length) return [];
  const ids = jobs.map((j) => j.id).join(',');
  const [counted, apps] = await Promise.all([
    selectMany(env, 'work_assignments', { job_id: `in.(${ids})`, status: `in.(${COUNTED_STATUSES.join(',')})`, select: 'job_id' }),
    selectMany(env, 'work_applications', { worker_id: `eq.${worker.id}`, job_id: `in.(${ids})`, select: 'id,job_id,status' }),
  ]);
  const mine = pool || (await selectMany(env, 'work_assignments', { worker_id: `eq.${worker.id}`, job_id: `in.(${ids})`, select: '*' })) || [];
  const filled = countBy(counted, 'job_id');
  const now = Date.now();
  return jobs.map((job) => jobCard(job, {
    filled: filled.get(job.id) || 0,
    application: (apps || []).find((a) => a.job_id === job.id) || null,
    assignment: pickAssignment(mine.filter((a) => a.job_id === job.id)),
    now,
  }));
}

/** 내 배정 행 (tab: mine = MINE_STATUSES, done = DONE_STATUSES), 최근 배정 먼저 */
export async function loadMyAssignments(env, worker, tab) {
  const statuses = tab === 'mine' ? MINE_STATUSES : DONE_STATUSES;
  return (await selectMany(env, 'work_assignments', {
    worker_id: `eq.${worker.id}`,
    status: `in.(${statuses.join(',')})`,
    select: '*',
    order: 'created_at.desc',
    limit: '200',
  })) || [];
}

/**
 * 내 작업 · 완료 탭 카드 (읽기만 — last_seen_at 은 건드리지 않는다).
 *   mine: 시작일 오름차순, 시작일 없는 것은 뒤 (같으면 최근 배정 먼저)
 *   done: 최근 배정 먼저
 */
export async function myJobCards(env, worker, tab, mine) {
  const rows = mine || (await loadMyAssignments(env, worker, tab));
  const jobIds = uniq(rows.map((a) => a.job_id));
  if (!jobIds.length) return [];
  const order = new Map(jobIds.map((id, i) => [id, i]));
  let jobs = ((await selectMany(env, 'work_jobs', { id: `in.(${jobIds.join(',')})`, select: '*' })) || [])
    .sort((a, b) => order.get(a.id) - order.get(b.id));
  if (tab === 'mine') jobs = jobs.sort((a, b) => String(a.starts_at || '9999').localeCompare(String(b.starts_at || '9999')));
  return cardsFor(env, worker, jobs, rows);
}

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;
const kstDay = (ms) => Math.floor((ms + KST_MS) / DAY_MS);

/**
 * 다음 작업 한 줄 (순수) — js/mypage-work.js pickNextJob 과 같은 규칙.
 * 내 작업 탭 카드(그 순서 그대로) 중 보완요청(revision)이 먼저, 아니면 KST 오늘 이후 시작일이 가장 이른 것,
 * 아니면 내 작업 탭 첫 줄. 카드가 없으면 null.
 */
export function pickNextJob(cards, nowMs = Date.now()) {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (!list.length) return null;
  const rev = list.find((j) => j.my && j.my.assignment_status === 'revision');
  if (rev) return rev;
  const today = kstDay(Number.isFinite(nowMs) ? nowMs : Date.now());
  const dated = list
    .filter((j) => Number.isFinite(Date.parse(j.starts_at)) && kstDay(Date.parse(j.starts_at)) >= today)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return dated[0] || list[0];
}

/** GET /work/jobs?tab=open|mine|done — 정지된 작업자는 open 만 403 */
export async function listJobsForWorker(env, { user, query = {} }) {
  const tab = query.tab ? oneOf(query.tab, WORKER_TABS, 'tab') : 'open';
  try {
    if (tab === 'open') {
      const worker = await requireApprovedWorker(env, user, 'browse');
      return { items: await cardsFor(env, worker, await openJobsFor(env, worker), null) };
    }
    const worker = await requireWorker(env, user);
    const items = await myJobCards(env, worker, tab, null);
    if (tab === 'mine') {
      // 새 소식 배지는 내 작업을 열어 본 시각 이후로 센다
      await updateBy(env, 'workers', { id: `eq.${worker.id}` }, { last_seen_at: nowIso() })
        .catch((e) => console.warn('[work] last_seen_at 갱신 실패:', e && e.message));
    }
    return { items };
  } catch (err) {
    if (isMissingRelation(err)) return { items: [] };
    throw err;
  }
}

/** GET /work/jobs/:id — 모집중이거나 내 신청 · 배정이 있는 작업만, 아니면 404 (정지된 작업자는 내 신청 · 배정이 있는 것만) */
export async function getJobForWorker(env, { user, params }) {
  const id = assertUuid(params.id, '작업 id');
  const worker = await requireWorker(env, user);
  const job = await loadJob(env, id);
  const [apps, mine] = await Promise.all([
    selectMany(env, 'work_applications', { worker_id: `eq.${worker.id}`, job_id: `eq.${id}`, select: '*' }),
    selectMany(env, 'work_assignments', { worker_id: `eq.${worker.id}`, job_id: `eq.${id}`, select: '*' }),
  ]);
  const myApps = apps || [];
  const myAsg = mine || [];
  if (!isBrowsable(job, worker) && !myApps.length && !myAsg.length) throw new NotFoundError('작업을 찾을 수 없습니다');

  const assignment = pickAssignment(myAsg);
  const all = await loadJobAssignments(env, id);
  const order = assignment && ACTIVE_STATUSES.includes(assignment.status) ? await loadOrderLabel(env, job.order_id) : null;
  let timeline = [];
  if (myAsg.length) {
    const ids = new Set(myAsg.map((a) => a.id));
    const rows = (await selectMany(env, 'work_updates', { job_id: `eq.${id}`, visible_to_worker: 'is.true', select: '*', order: 'created_at.asc', limit: '500' })) || [];
    timeline = rows.filter((u) => (u.assignment_id && ids.has(u.assignment_id)) || (!u.assignment_id && u.author_role === 'company'));
  }
  return jobDetail(job, { filled: countFilled(all), application: myApps[0] || null, assignment, order, timeline });
}

// ── 관리자 ───────────────────────────────────────────────────────

/** 작업 입력 칸 (만들기 · 고치기). partial 이면 온 칸만 */
export function jobFields(body, { partial = false } = {}) {
  const b = body || {};
  const has = (k) => b[k] !== undefined;
  const out = {};
  if (!partial || has('kind')) out.kind = oneOf(b.kind, WORK_KINDS, 'kind');
  if (!partial || has('title')) out.title = reqText(b.title, 80, '제목');
  if (has('detail')) out.detail = optText(b.detail, 2000, '내용');
  if (has('region_label')) out.region_label = optText(b.region_label, 40, '지역');
  for (const k of ['starts_at', 'ends_at', 'apply_deadline']) if (has(k)) out[k] = optIso(b[k], k);
  if (!partial || has('slots')) {
    const n = optInt(has('slots') ? b.slots : 1, 1, '정원');
    if (n === null) throw new ValidationError('정원은 1 이상의 정수여야 합니다');
    out.slots = n;
  }
  if (!partial || has('mode')) out.mode = has('mode') ? oneOf(b.mode, JOB_MODES, 'mode') : 'open';
  if (has('pay_amount')) out.pay_amount = optInt(b.pay_amount, 0, '금액');
  if (has('pay_unit')) out.pay_unit = b.pay_unit === null || b.pay_unit === '' ? null : oneOf(b.pay_unit, PAY_UNITS, 'pay_unit');
  if (!partial || has('pay_visible')) out.pay_visible = optBool(b.pay_visible, false, 'pay_visible');
  if (has('order_id')) out.order_id = optUuid(b.order_id, '주문 id');
  if (has('design_id')) out.design_id = optUuid(b.design_id, '설계 id');
  return out;
}

/** GET /work/admin/jobs?status= — 신청 수 · 확정 수/정원 · 다음 날짜 */
export async function listJobsAdmin(env, { user, query = {} }) {
  await requireAdminReader(env, user);
  const status = query.status ? oneOf(query.status, [...JOB_STATUSES, 'expired'], 'status') : null;
  try {
    const q = { select: '*', order: 'created_at.desc', limit: '200' };
    if (status) q.status = `eq.${status === 'expired' ? 'open' : status}`;
    const now = Date.now();
    let jobs = (await selectMany(env, 'work_jobs', q)) || [];
    if (status === 'expired') jobs = jobs.filter((j) => effectiveStatus(j, now) === 'expired');
    if (!jobs.length) return { items: [] };
    const ids = jobs.map((j) => j.id).join(',');
    const [apps, counted] = await Promise.all([
      selectMany(env, 'work_applications', { job_id: `in.(${ids})`, status: 'eq.applied', select: 'job_id' }),
      selectMany(env, 'work_assignments', { job_id: `in.(${ids})`, status: `in.(${COUNTED_STATUSES.join(',')})`, select: 'job_id' }),
    ]);
    const appCount = countBy(apps, 'job_id');
    const filled = countBy(counted, 'job_id');
    return {
      items: jobs.map((j) => ({
        ...j,
        effective_status: effectiveStatus(j, now),
        applications: appCount.get(j.id) || 0,
        confirmed: filled.get(j.id) || 0,
        next_date: j.starts_at || null,
      })),
    };
  } catch (err) {
    if (isMissingRelation(err)) return { items: [] };
    throw err;
  }
}

/** POST /work/admin/jobs — 초안으로 만든다 (주소 · 연락처 칸은 받지 않는다) */
export async function createJobAdmin(env, { user, body }) {
  await requireAdminEditor(env, user);
  const fields = jobFields(body, { partial: false });
  const job = await insertOne(env, 'work_jobs', { ...fields, status: 'draft', version: 0, created_by: user.id });
  await recordEvent(env, { jobId: job.id, actorUserId: user.id, actorKind: 'admin', type: 'job_created', to: 'draft' });
  return job;
}

/** PATCH /work/admin/jobs/:id — draft · open 만, version 필수 */
export async function patchJobAdmin(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업 id');
  const b = body || {};
  if (!Number.isInteger(b.version)) throw new ValidationError('version 이 필요합니다');
  const patch = jobFields(b, { partial: true });
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  const job = await loadJob(env, id);
  if (!['draft', 'open'].includes(job.status)) throw new ConflictError('초안 · 모집중 작업만 고칠 수 있습니다');
  const next = { ...job, ...patch };
  let status = job.status;
  if (job.status === 'open') {
    const all = await loadJobAssignments(env, id);
    if (countFilled(all) > next.slots) throw new ConflictError('확정된 인원이 정원보다 많습니다');
    status = computeJobStatus(next, all);
  }
  const locked = await lockJob(env, { ...job, version: b.version }, { ...patch, status });
  await recordEvent(env, { jobId: id, actorUserId: user.id, actorKind: 'admin', type: 'job_updated', from: job.status, to: locked.status, payload: { fields: Object.keys(patch) } });
  return locked;
}

/** POST /work/admin/jobs/:id/publish — draft → open (배정이 이미 정원을 채웠으면 filled) */
export async function publishJob(env, { user, params }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업 id');
  const job = await loadJob(env, id);
  if (job.status !== 'draft') throw new ConflictError('초안만 게시할 수 있습니다');
  if (!WORK_KINDS.includes(job.kind) || !String(job.title || '').trim() || !(job.slots >= 1)) {
    throw new ValidationError('종류 · 제목 · 정원이 필요합니다');
  }
  const status = computeJobStatus({ ...job, status: 'open' }, await loadJobAssignments(env, id));
  const locked = await lockJob(env, job, { status });
  await recordEvent(env, { jobId: id, actorUserId: user.id, actorKind: 'admin', type: 'job_published', from: 'draft', to: locked.status });
  return locked;
}

/** 작업을 닫거나 취소할 때 남은 초대(offered)를 끝내는 사유 — 작업자 지난 작업 탭에 release_reason 으로 보인다 */
export const AUTO_DECLINE = Object.freeze({
  closed: Object.freeze({ reason: 'job_closed', text: '작업이 마감돼 초대가 끝났습니다' }),
  cancelled: Object.freeze({ reason: 'job_cancelled', text: '작업이 취소돼 초대가 끝났습니다' }),
});

/**
 * 닫기 · 취소가 성공한 작업의 응답 없는 초대(offered)를 모두 declined 로 (1주차 후속 C).
 * 확정 · 진행 중 배정과 대기 신청(applied)은 건드리지 않는다. offered 일 때만 바꾸므로 같은 배정을 두 번 끝내지 않는다.
 * 작업 잠금과 따로 하는 쓰기라서 정리에서 빠지는 초대가 생길 수 있고, 그 길은 둘 다 막아 둔다:
 *   - 같은 순간의 수락 · 거절 · 제외가 배정을 잠깐 바꿔 둔 사이면 여기서는 못 본다 → 그쪽 잠금이 실패해
 *     offered 로 되돌린 뒤 transitionAssignment 가 declineOffersIfEnded 로 정리한다 (초대 넣기도 같은 방식)
 *   - 이 쓰기가 DB 오류로 실패하면 작업은 이미 닫혔거나 취소됐는데 500 이다 → 같은 닫기 · 취소를 다시 부르면 정리만 한다
 * 배정마다 system 이벤트 한 줄 (payload.worker_id → 초대받은 사람의 새 소식 배지). 바꾼 건수를 돌려준다.
 */
async function autoDeclineOffers(env, jobId, endedAs) {
  const { reason, text } = AUTO_DECLINE[endedAs];
  const rows = (await updateBy(env, 'work_assignments', { job_id: `eq.${jobId}`, status: 'eq.offered' },
    { status: 'declined', release_reason: text, updated_at: nowIso() })) || [];
  for (const a of rows) {
    await recordEvent(env, {
      jobId, assignmentId: a.id, actorKind: 'system', type: 'assignment_auto_declined', from: 'offered', to: 'declined',
      note: text, payload: { worker_id: a.worker_id, reason },
    });
  }
  return rows.length;
}

/**
 * 작업을 다시 읽어 닫혔거나 취소됐으면 남은 초대를 정리한다 (닫기 · 취소의 정리와 겹친 쓰기 뒤에 부른다).
 * 끝난 작업이 아니면 null, 끝난 작업이면 정리한 건수 (0 일 수 있다).
 */
export async function declineOffersIfEnded(env, jobId) {
  const now = await selectOne(env, 'work_jobs', { id: `eq.${jobId}`, select: 'id,status' });
  if (!now || !['closed', 'cancelled'].includes(now.status)) return null;
  return autoDeclineOffers(env, jobId, now.status);
}

/**
 * 이미 endedAs 로 끝난 작업에 같은 닫기 · 취소가 다시 오면 — 남은 초대가 있을 때만 정리하고 그 결과를 돌려준다
 * (앞선 정리 쓰기가 실패해 500 이 났을 때 다시 누르는 길). 남은 초대가 없으면 null — 부르는 쪽이 원래대로 409.
 */
async function retryAutoDecline(env, job, endedAs) {
  if (job.status !== endedAs) return null;
  const n = await autoDeclineOffers(env, job.id, endedAs);
  return n ? { ...job, auto_declined: n } : null;
}

/**
 * POST /work/admin/jobs/:id/cancel — done 전만, 사유 필수. 응답 없는 초대는 자동으로 끝난다 (auto_declined: 건수).
 * 이미 취소된 작업이면 남은 초대 정리만 다시 하고(취소 사유는 그대로), 남은 초대가 없으면 409.
 */
export async function cancelJob(env, { user, params, body }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업 id');
  const reason = reqText(body && body.reason, 200, '취소 사유');
  const job = await loadJob(env, id);
  const retried = await retryAutoDecline(env, job, 'cancelled');
  if (retried) return retried;
  if (['done', 'closed', 'cancelled'].includes(job.status)) throw new ConflictError('완료 · 마감 · 취소된 작업은 취소할 수 없습니다');
  const locked = await lockJob(env, job, { status: 'cancelled', cancel_reason: reason });
  await recordEvent(env, { jobId: id, actorUserId: user.id, actorKind: 'admin', type: 'job_cancelled', from: job.status, to: 'cancelled', note: reason });
  const autoDeclined = await autoDeclineOffers(env, id, 'cancelled');
  return { ...locked, auto_declined: autoDeclined };
}

/**
 * POST /work/admin/jobs/:id/close — done → closed. 응답 없는 초대는 자동으로 끝난다 (auto_declined: 건수).
 * 이미 마감된 작업이면 남은 초대 정리만 다시 하고, 남은 초대가 없으면 409.
 */
export async function closeJob(env, { user, params }) {
  await requireAdminEditor(env, user);
  const id = assertUuid(params.id, '작업 id');
  const job = await loadJob(env, id);
  const retried = await retryAutoDecline(env, job, 'closed');
  if (retried) return retried;
  if (job.status !== 'done') throw new ConflictError('완료된 작업만 마감할 수 있습니다');
  const locked = await lockJob(env, job, { status: 'closed' });
  await recordEvent(env, { jobId: id, actorUserId: user.id, actorKind: 'admin', type: 'job_closed', from: 'done', to: 'closed' });
  const autoDeclined = await autoDeclineOffers(env, id, 'closed');
  return { ...locked, auto_declined: autoDeclined };
}

/** 관리자 화면의 작업자 요약 — 표시 이름 · 종류 · 지역 · 실적 건수 */
function workerBrief(w, doneCount) {
  if (!w) return null;
  return { id: w.id, display_name: w.display_name, kinds: w.kinds || [], region_label: w.region_label || null, status: w.status, done_count: doneCount.get(w.id) || 0 };
}

/** GET /work/admin/jobs/:id — 작업 + 신청 + 배정 + 기록 전부 + 이벤트 (현장 주소는 이 API 에서 내보내지 않는다) */
export async function getJobAdmin(env, { user, params }) {
  await requireAdminReader(env, user);
  const id = assertUuid(params.id, '작업 id');
  const job = await loadJob(env, id);
  const [applications, assignments, updates, events] = await Promise.all([
    selectMany(env, 'work_applications', { job_id: `eq.${id}`, select: '*', order: 'created_at.asc', limit: '200' }),
    loadJobAssignments(env, id),
    selectMany(env, 'work_updates', { job_id: `eq.${id}`, select: '*', order: 'created_at.asc', limit: '500' }),
    selectMany(env, 'work_job_events', { job_id: `eq.${id}`, select: '*', order: 'created_at.asc', limit: '500' }),
  ]);
  const workerIds = uniq([...(applications || []), ...(assignments || [])].map((r) => r.worker_id));
  const [workers, accepted] = workerIds.length
    ? await Promise.all([
      selectMany(env, 'workers', { id: `in.(${workerIds.join(',')})`, select: 'id,display_name,kinds,region_label,status' }),
      selectMany(env, 'work_assignments', { worker_id: `in.(${workerIds.join(',')})`, status: 'eq.accepted', select: 'worker_id' }),
    ])
    : [[], []];
  const byId = new Map((workers || []).map((w) => [w.id, w]));
  const doneCount = countBy(accepted, 'worker_id');
  return {
    ...job,
    effective_status: effectiveStatus(job),
    filled: countFilled(assignments),
    applications: (applications || []).map((a) => ({ ...a, worker: workerBrief(byId.get(a.worker_id), doneCount) })),
    assignments: (assignments || []).map((a) => ({ ...a, worker: workerBrief(byId.get(a.worker_id), doneCount) })),
    updates: updates || [],
    events: events || [],
  };
}
