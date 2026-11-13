/**
 * 작업자 ↔ 팩토리 연결 (worker_companies — database/migrations/0064_worker_companies.sql).
 * (2026-11-13 사장님 결정 「작업자 한 길」 — 작업자 계정은 하나, 팩토리마다 연결. 초대로 와도 그 팩토리가 승인해야 연결된다)
 *
 *   상태  pending 대기 → approved 승인 / rejected 반려, approved ↔ suspended 정지, approved · suspended → ended 끝
 *         반려 · 끝난 연결은 다시 신청(초대)하면 같은 줄이 대기로 돌아간다 (한 작업자 × 한 팩토리 한 줄)
 *   계정  workers.status 는 계정 상태로 남는다 — 어느 팩토리든 처음 승인하면 pending · rejected → approved,
 *         전역 정지(suspended)는 사이트 관리자만 걸고 모든 팩토리에 걸린다
 *
 * 0064 적용 전(표 없음)에는 「연결을 모른다」(null)로 내려앉는다 — 작업자 쪽은 옛 동작(전역 풀)으로 돌고,
 * 팩토리 경로는 409 db_pending 을 준다 (linksPending).
 * 다른 팩토리의 줄은 읽지 않는다 — 팩토리 경로는 늘 company_id 로 거른다.
 */

import { ConflictError, insertOne, selectMany, selectOne, updateBy, hqCompanyId } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';

export const LINK_STATUSES = Object.freeze(['pending', 'approved', 'suspended', 'rejected', 'ended']);
export const LINK_VIAS = Object.freeze(['invite', 'public', 'migrated']);
/** 팩토리 대표 · 실장이 바꿀 수 있는 상태 전이 */
export const LINK_TRANSITIONS = Object.freeze({
  pending: ['approved', 'rejected'],
  approved: ['suspended', 'ended'],
  suspended: ['approved', 'ended'],
  rejected: [],
  ended: [],
});
export const LINK_STATUS_LABEL = Object.freeze({ pending: '대기', approved: '승인', suspended: '정지', rejected: '반려', ended: '연결 끝' });
/** 다시 신청하면 대기로 돌아가는 상태 */
const REOPENABLE = Object.freeze(['rejected', 'ended']);

const nowIso = () => new Date().toISOString();

/** 팩토리 경로의 「0064 적용 전」 응답 */
export function linksPending() {
  const err = new ConflictError('DB 0064 적용 전입니다 — 작업자 연결은 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}

/** 표가 아직 없으면 null, 있으면 fn 의 값 */
async function orNull(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 그 작업자의 연결 줄 전부 — 표가 없으면 null */
export function linksOfWorker(env, workerId) {
  return orNull(async () => (await selectMany(env, 'worker_companies', { worker_id: `eq.${workerId}`, select: '*', order: 'created_at.asc', limit: '200' })) || []);
}

/** 작업자가 일을 받을 수 있는 팩토리 id 들(승인된 연결) — 표가 없으면 null (= 옛 동작, 거르지 않는다) */
export async function approvedCompanyIds(env, workerId) {
  const rows = await linksOfWorker(env, workerId);
  if (rows === null) return null;
  return new Set(rows.filter((l) => l.status === 'approved').map((l) => l.company_id));
}

/** 한 팩토리와의 연결 줄 — 없으면 null. 표가 없으면(0064 전) undefined */
export async function linkOf(env, companyId, workerId) {
  try {
    return (await selectOne(env, 'worker_companies', { company_id: `eq.${companyId}`, worker_id: `eq.${workerId}`, select: '*' })) || null;
  } catch (e) {
    if (isMissingRelation(e)) return undefined;
    throw e;
  }
}

/** 표가 있는가 (0064 적용됨) */
export async function linksReady(env) {
  const rows = await orNull(() => selectMany(env, 'worker_companies', { select: 'id', limit: '1' }));
  return rows !== null;
}

/**
 * 그 팩토리의 작업을 받을 수 있는 작업자인가 — 연결이 승인돼 있어야 한다. 표가 없으면(0064 전) 통과.
 * @returns {Promise<boolean>}
 */
export async function isLinkedTo(env, workerId, companyId) {
  const ids = await approvedCompanyIds(env, workerId);
  return ids === null || (!!companyId && ids.has(companyId));
}

/**
 * 연결 신청 — 없으면 대기로 넣고, 반려 · 끝난 줄은 대기로 되돌린다. 대기는 그대로.
 * 이미 승인 · 정지된 연결이면 409 already_linked. 표가 없으면 null (부르는 쪽이 옛 동작으로).
 * @returns {Promise<object|null>} 연결 줄
 */
export async function requestLink(env, { companyId, workerId, via, inviteId = null, kinds = [] }) {
  return orNull(async () => {
    const cur = await selectOne(env, 'worker_companies', { company_id: `eq.${companyId}`, worker_id: `eq.${workerId}`, select: '*' });
    if (cur && (cur.status === 'approved' || cur.status === 'suspended')) {
      const err = new ConflictError('이미 연결된 팩토리입니다');
      err.code = 'already_linked';
      throw err;
    }
    if (cur && cur.status === 'pending') return cur;
    if (cur && REOPENABLE.includes(cur.status)) {
      const rows = await updateBy(
        env,
        'worker_companies',
        { id: `eq.${cur.id}`, status: `eq.${cur.status}` },
        { status: 'pending', via, invite_id: inviteId, kinds: kinds.length ? kinds : cur.kinds, decided_by: null, decided_at: null, reason: null, updated_at: nowIso() },
      );
      return (rows && rows[0]) || cur;
    }
    try {
      return await insertOne(env, 'worker_companies', { company_id: companyId, worker_id: workerId, status: 'pending', via, invite_id: inviteId, kinds });
    } catch (e) {
      // 같은 순간 두 번 — 이미 들어간 줄을 돌려준다
      if (e instanceof ConflictError) return selectOne(env, 'worker_companies', { company_id: `eq.${companyId}`, worker_id: `eq.${workerId}`, select: '*' });
      throw e;
    }
  });
}

/**
 * 사이트 관리자가 계정 상태를 바꿨다 (PC 관리자 화면) → 다담 공장 연결도 같은 상태로 맞춘다.
 * 연결이 없으면 넣는다 (공개 신청을 다담 공장이 받는다). 실패해도 던지지 않는다.
 */
export async function syncHqLink(env, { worker, status, userId }) {
  try {
    if (!LINK_STATUSES.includes(status)) return null;
    const hq = await hqCompanyId(env);
    if (!hq) return null;
    const cur = await linkOf(env, hq, worker.id);
    if (cur === undefined) return null;
    const decided = status === 'pending' ? {} : { decided_by: userId || null, decided_at: nowIso() };
    if (!cur) return await insertOne(env, 'worker_companies', { company_id: hq, worker_id: worker.id, status, via: 'public', kinds: worker.kinds || [], ...decided });
    if (cur.status === status) return cur;
    const rows = await updateBy(env, 'worker_companies', { id: `eq.${cur.id}` }, { status, ...decided, updated_at: nowIso() });
    return (rows && rows[0]) || cur;
  } catch (e) {
    console.warn('[work] 다담 공장 연결 맞추기 실패:', e && e.message);
    return null;
  }
}

/** 팩토리 id → 이름 (작업자 화면에 「어느 팩토리」) — 못 읽으면 빈 Map */
export async function companyNames(env, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  try {
    const rows = (await selectMany(env, 'companies', { id: `in.(${list.join(',')})`, select: 'id,name' })) || [];
    return new Map(rows.map((c) => [c.id, c.name || null]));
  } catch (e) {
    console.warn('[work] 팩토리 이름 읽기 실패:', e && e.message);
    return new Map();
  }
}
