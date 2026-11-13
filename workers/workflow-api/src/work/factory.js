/**
 * 공장 작업자 — 작업자 계정으로 하는 공장 일 (DB 0024 factory_workers).
 *
 * 생산 링크(production/worker-access.js)와 같은 일을 계정으로 한다. 링크 하나 = 「누구의 생산 계획」 하나였듯,
 * 공장 배정 하나 = 작업자 하나 + 그가 볼 생산 계획(plan_user_id — 배정한 본사 사람, 잇기면 링크를 만든 사람).
 *
 *   작업자 (승인된 작업자 + 열린 공장 배정):
 *     GET  /work/factory                         오늘 할 일 · 오늘 지시 · 오늘 내 기록 (링크 화면과 같은 모양)
 *     POST /work/factory/worklogs                실측 기록 — 공정은 내 작업자 종류 안에서(재단 · 엣지 · 조립)
 *     POST /work/factory/assignments/:id/done    지시 완료 체크
 *     POST /work/factory/link                    「내 계정에 잇기」 — X-Worker-Token 의 링크를 이 계정의 공장 배정으로
 *   본사 (대표 · 실장 · 관리자 — 링크를 만들던 사람과 같다):
 *     GET  /production/factory-workers           내 계획에 배정된 작업자 · 배정할 수 있는 작업자
 *     POST /production/factory-workers           { worker_id } 배정
 *     POST /production/factory-workers/:id/end   배정 끝
 *
 * 작업자 화면에는 일당 · 금액을 내보내지 않고, 고객은 가린 이름으로만 (링크와 같다, redact.js).
 * 휴대폰은 본사 목록에도 싣지 않는다 (이름 · 종류만).
 */

import {
  AuthError,
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
  hqCompanyId,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
  updateById,
} from '../supabase.js';
import { computePlan, assertSettingsEditor, kstDate } from '../production/service.js';
import {
  todaysWork,
  validateWorklog,
  worklogCompanyOf,
  assertOwnHqOrder,
  resolveWorker,
} from '../production/worker-access.js';
import { maskOrderLabel, workerAssignmentText } from '../production/redact.js';
import { loadSelfWorker } from './access.js';
import { isMissingRelation } from '../work-order-data.js';
import { assertUuid } from './validate.js';

/** 작업자 종류 → 공장 공정 (생산 기록의 role). 공장 조립은 조립 종류로 함께 쓴다 */
export const FACTORY_ROLE_OF_KIND = Object.freeze({
  cutting: 'cutter',
  edge: 'edge',
  assembly: 'asm',
});
const ROLE_ORDER = ['cutter', 'edge', 'asm'];

/** 작업자 종류 → 기록할 수 있는 공정 (재단 · 엣지 · 조립 차례) */
export function factoryRolesOf(kinds) {
  const list = Array.isArray(kinds) ? kinds : [];
  const roles = list.map((k) => FACTORY_ROLE_OF_KIND[k]).filter(Boolean);
  return ROLE_ORDER.filter((r) => roles.includes(r));
}

const nowIso = () => new Date().toISOString();

// ── 작업자 ───────────────────────────────────────────────────────

/** 작업자의 열린 공장 배정 (없으면 null) */
export async function openFactoryOf(env, workerId) {
  return selectOne(env, 'factory_workers', {
    worker_id: `eq.${workerId}`,
    ended_at: 'is.null',
    select: 'id,worker_id,plan_user_id,link_id,assigned_at',
  });
}

/** 승인된 작업자 + 열린 공장 배정. 아니면 403 (not_worker · not_factory) — 꾸러미 · 필수 확인(checks.js)도 같다 */
export async function requireFactoryWorker(env, user) {
  const worker = await loadSelfWorker(env, user);
  if (!worker || worker.status !== 'approved')
    throw new ForbiddenError('승인된 작업자만 공장 일을 할 수 있습니다', 'not_worker');
  const factory = await openFactoryOf(env, worker.id);
  if (!factory) throw new ForbiddenError('공장에 배정된 작업자만 할 수 있습니다', 'not_factory');
  return { worker, factory, roles: factoryRolesOf(worker.kinds) };
}

/**
 * 작업자 화면 한 장 (순수) — 링크 화면(workerToday)과 같은 모양 + roles(기록할 수 있는 공정).
 * 할 일은 내 공정만 남긴다. 지시 문구는 이름을 가리고 일당을 뺀 것, 기록의 주문 이름은 가린다.
 */
export function factoryView({ worker, roles, plan, today, assignments = [], logs = [] }) {
  const all = todaysWork(plan, today);
  const work = {};
  for (const r of roles) work[r] = all[r] || [];
  return {
    worker: worker.display_name,
    today,
    roles,
    work,
    activeJobs: (plan.jobs || []).length,
    skipped: (plan.skipped || []).map((x) => ({ label: x.workerLabel, reason: x.reason })),
    assignments: assignments.map((a) => ({
      id: a.id,
      kind: a.kind,
      role: a.role,
      text: workerAssignmentText(a),
      status: a.status,
      done_at: a.done_at,
    })),
    logs: logs.map((l) => ({
      id: l.id,
      role: l.role,
      order_label: l.order_id ? maskOrderLabel(l.order_label) : l.order_label,
      units: l.units,
      minutes: l.minutes,
      created_at: l.created_at,
    })),
  };
}

/** GET /work/factory */
export async function getFactoryToday(env, { user }) {
  const { worker, factory, roles } = await requireFactoryWorker(env, user);
  const today = kstDate();
  const plan = await computePlan(env, { user: { id: factory.plan_user_id }, today });
  const assignments =
    (await selectMany(env, 'production_assignments', {
      user_id: `eq.${factory.plan_user_id}`,
      work_date: `eq.${today}`,
      status: 'in.(instructed,done)',
      select: 'id,kind,role,text,order_label,status,done_at',
      order: 'created_at.asc',
      limit: '100',
    })) || [];
  const logs =
    (await selectMany(env, 'production_worklogs', {
      worker_id: `eq.${worker.id}`,
      work_date: `eq.${today}`,
      select: 'id,role,order_id,order_label,units,minutes,created_at',
      order: 'created_at.desc',
      limit: '100',
    })) || [];
  return factoryView({ worker, roles, plan, today, assignments, logs });
}

/** POST /work/factory/worklogs — 링크 기록(addWorklog)과 같은 검사 + 공정은 내 종류 안에서 */
export async function addFactoryWorklog(env, { user, body }) {
  const { worker, factory, roles } = await requireFactoryWorker(env, user);
  const v = validateWorklog(body);
  if (!roles.includes(v.role))
    throw new ValidationError('작업자 종류에 없는 공정은 기록할 수 없습니다', { field: 'role' });
  const owner = { user_id: factory.plan_user_id };
  if (v.order_id) await assertOwnHqOrder(env, owner, v.order_id);
  // 하루 기록은 필수 확인으로 막지 않는다 (2026-11-06 사장님 「여러 날 걸리는 주문 — 주문 끝 완료를 따로 둠」).
  //   필수는 주문 끝 항목(필수 확인 「이 주문 재단 · 엣지 끝」 · 「이 주문 조립 끝」)에서 막는다 — work/checks.js
  const row = await insertOne(env, 'production_worklogs', {
    ...v,
    user_id: factory.plan_user_id,
    link_id: null,
    worker_id: worker.id,
    worker_label: String(worker.display_name || '').slice(0, 50),
    work_date: kstDate(),
    company_id: await worklogCompanyOf(env, { link: owner, orderId: v.order_id }),
  });
  return { id: row.id, role: row.role, units: row.units, minutes: row.minutes };
}

/** POST /work/factory/assignments/:id/done — 내 계획의 지시만 (아니면 404) */
export async function markFactoryAssignmentDone(env, { user, params, body }) {
  const { factory } = await requireFactoryWorker(env, user);
  const id = assertUuid(params.id, 'id');
  const row = await selectOne(env, 'production_assignments', {
    id: `eq.${id}`,
    select: 'id,user_id',
  });
  if (!row || row.user_id !== factory.plan_user_id)
    throw new NotFoundError('지시를 찾을 수 없습니다');
  const done = !(body && body.done === false);
  const patch = done
    ? { status: 'done', done_at: nowIso() }
    : { status: 'instructed', done_at: null };
  await updateById(env, 'production_assignments', id, patch);
  return { id, ...patch };
}

/**
 * POST /work/factory/link — 「내 계정에 잇기」. 생산 링크(X-Worker-Token)를 이 계정의 공장 배정으로 바꾼다.
 *   승인된 작업자만 (아니면 403 not_worker — 작업자 신청 → 승인 뒤 다시).
 *   이미 공장 배정이 있으면 409. 링크는 한 번만 잇는다 (DB 고유 색인 — 겹치면 409).
 *   잇고 나면 그 링크로 남긴 지난 기록에 작업자를 채우고, 링크를 끊는다 (링크 주소는 더 안 열린다).
 *   링크가 틀리거나 끊기거나 만료됐으면 410 (문구는 링크 화면과 같다) — 401 은 로그인이 끝났다는 뜻이라 쓰지 않는다.
 */
export async function linkFactoryAccount(env, { user, token }) {
  let link;
  try {
    link = await resolveWorker(env, token);
  } catch (e) {
    if (e instanceof AuthError) throw new GoneError(e.message);
    throw e;
  }
  const worker = await loadSelfWorker(env, user);
  if (!worker || worker.status !== 'approved') {
    throw new ForbiddenError(
      '승인된 작업자만 링크를 이을 수 있습니다. 작업자 신청 → 승인 뒤 다시 열어 주세요',
      'not_worker'
    );
  }
  if (await openFactoryOf(env, worker.id)) throw new ConflictError('이미 공장에 배정된 계정입니다');
  let row;
  try {
    row = await insertOne(env, 'factory_workers', {
      worker_id: worker.id,
      plan_user_id: link.user_id,
      link_id: link.id,
      assigned_by: user.id,
    });
  } catch (err) {
    if (err instanceof ConflictError)
      throw new ConflictError('이미 이어진 링크이거나 공장에 배정된 계정입니다');
    throw err;
  }
  await updateById(env, 'production_worker_links', link.id, { revoked_at: nowIso() });
  await updateBy(
    env,
    'production_worklogs',
    { link_id: `eq.${link.id}`, worker_id: 'is.null' },
    { worker_id: worker.id }
  );
  return { id: row.id, linked: true };
}

// ── 본사 ─────────────────────────────────────────────────────────

/** 공장 배정을 다루는 사람 — 본사 대표 · 실장 · 관리자 (링크를 만들던 사람과 같다). 아니면 403 not_factory_admin */
async function assertFactoryAdmin(env, user) {
  try {
    await assertSettingsEditor(env, user, await hqCompanyId(env));
  } catch (e) {
    if (e instanceof ForbiddenError)
      throw new ForbiddenError(
        '공장 배정은 본사 대표 · 실장 · 관리자만 합니다',
        'not_factory_admin'
      );
    throw e;
  }
}

const workerBrief = (w) => ({
  id: w.id,
  display_name: w.display_name,
  kinds: w.kinds || [],
  status: w.status,
});
const FACTORY_KINDS = Object.keys(FACTORY_ROLE_OF_KIND);

/** 다담 공장과 연결이 승인된 작업자 id 들 — 연결 표가 없으면 null */
async function hqLinkedWorkerIds(env) {
  try {
    const hq = await hqCompanyId(env);
    if (!hq) return null;
    const rows = (await selectMany(env, 'worker_companies', { company_id: `eq.${hq}`, status: 'eq.approved', select: 'worker_id', limit: '2000' })) || [];
    return new Set(rows.map((r) => r.worker_id));
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** GET /production/factory-workers — 내 계획에 배정된 작업자 · 배정할 수 있는 작업자(승인 · 공장 종류 · 열린 배정 없음) */
export async function listFactoryWorkers(env, { user }) {
  await assertFactoryAdmin(env, user);
  const open =
    (await selectMany(env, 'factory_workers', {
      ended_at: 'is.null',
      select: 'id,worker_id,plan_user_id,link_id,assigned_at',
      order: 'assigned_at.asc',
      limit: '500',
    })) || [];
  const workers =
    (await selectMany(env, 'workers', {
      status: 'eq.approved',
      kinds: `ov.{${FACTORY_KINDS.join(',')}}`,
      select: 'id,display_name,kinds,status',
      order: 'display_name.asc',
      limit: '500',
    })) || [];
  // 후보는 다담 공장과 연결이 승인된 작업자만 (2026-11-13 — 협력 팩토리가 데려온 작업자는 공장 배정 후보가 아니다).
  // 연결 표가 없으면(0064 전) 옛 동작 그대로
  const linkedToHq = await hqLinkedWorkerIds(env);
  const mine = open.filter((f) => f.plan_user_id === user.id);
  const mineIds = mine.map((f) => f.worker_id);
  const extra = mineIds.filter((id) => !workers.some((w) => w.id === id));
  const extraRows = extra.length
    ? (await selectMany(env, 'workers', {
        id: `in.(${extra.join(',')})`,
        select: 'id,display_name,kinds,status',
      })) || []
    : [];
  const byId = new Map([...workers, ...extraRows].map((w) => [w.id, w]));
  const busy = new Set(open.map((f) => f.worker_id));
  return {
    assigned: mine
      .filter((f) => byId.has(f.worker_id))
      .map((f) => ({
        id: f.id,
        assigned_at: f.assigned_at,
        from_link: !!f.link_id,
        worker: workerBrief(byId.get(f.worker_id)),
        roles: factoryRolesOf(byId.get(f.worker_id).kinds),
      })),
    candidates: workers.filter((w) => !busy.has(w.id) && (!linkedToHq || linkedToHq.has(w.id))).map(workerBrief),
  };
}

/** POST /production/factory-workers { worker_id } — 승인된 작업자 · 공장 종류가 있어야, 열린 배정이 있으면 409 */
export async function assignFactoryWorker(env, { user, body }) {
  await assertFactoryAdmin(env, user);
  const workerId = assertUuid(body && body.worker_id, 'worker_id');
  const worker = await selectOne(env, 'workers', {
    id: `eq.${workerId}`,
    select: 'id,display_name,kinds,status',
  });
  if (!worker) throw new NotFoundError('작업자를 찾을 수 없습니다');
  if (worker.status !== 'approved')
    throw new ConflictError('승인된 작업자만 공장에 배정할 수 있습니다');
  if (!factoryRolesOf(worker.kinds).length)
    throw new ValidationError('작업자 종류에 재단 · 엣지 · 조립 중 하나가 있어야 합니다', {
      field: 'worker_id',
    });
  let row;
  try {
    row = await insertOne(env, 'factory_workers', {
      worker_id: worker.id,
      plan_user_id: user.id,
      assigned_by: user.id,
    });
  } catch (err) {
    if (err instanceof ConflictError) throw new ConflictError('이미 공장에 배정된 작업자입니다');
    throw err;
  }
  return {
    id: row.id,
    assigned_at: row.assigned_at,
    from_link: false,
    worker: workerBrief(worker),
    roles: factoryRolesOf(worker.kinds),
  };
}

/** POST /production/factory-workers/:id/end — 내 계획의 배정만 (아니면 404). 이미 끝났으면 그대로 */
export async function endFactoryWorker(env, { user, params }) {
  await assertFactoryAdmin(env, user);
  const id = assertUuid(params.id, 'id');
  const row = await selectOne(env, 'factory_workers', {
    id: `eq.${id}`,
    select: 'id,plan_user_id,ended_at',
  });
  if (!row || row.plan_user_id !== user.id) throw new NotFoundError('공장 배정을 찾을 수 없습니다');
  if (row.ended_at) return { id, ended_at: row.ended_at };
  const out = await updateById(env, 'factory_workers', id, {
    ended_at: nowIso(),
    ended_by: user.id,
  });
  return { id, ended_at: out ? out.ended_at : null };
}
