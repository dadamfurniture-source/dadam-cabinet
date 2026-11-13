/**
 * 팩토리의 작업자 — 연결된 작업자 보기 · 초대 · 승인 · 정지 (마이페이지 인사 › 작업자).
 * (2026-11-13 사장님 결정 「작업자 한 길」 — 팩토리마다 자기 작업자. 표: database/migrations/0064_worker_companies.sql)
 *
 *   GET   /company/workers                    내 팩토리와 연결된 작업자 + 남은 초대 (구성원)
 *     { company { name }, can_manage, can_invite,
 *       workers [{ link_id, name, kinds, region, status, account_status, via, since, decided_at, reason, active, phone? }],
 *       invites [{ id, kinds_preset, display_name_preset, expires_at, created_at }] }
 *     status = 연결 상태(pending 대기 · approved 승인 · suspended 정지 · rejected 반려 · ended 끝),
 *     account_status = 계정 상태(사이트 관리자의 전역 정지 suspended 를 알리려고), active = 내 팩토리 작업의 진행 중 배정 수.
 *     전화 · 초대 목록은 대표 · 실장 답에만 싣는다.
 *   POST  /company/workers/invites            초대 링크 만들기 (대표 · 실장) { kinds_preset[], display_name_preset?, expires_at }
 *     → { id, url, expires_at } — 링크는 이 응답에서만 보인다 (DB 에는 해시만). 1회용.
 *   POST  /company/workers/invites/:id/revoke  초대 거두기 (대표 · 실장) — 여러 번 눌러도 같은 결과
 *   PATCH /company/workers/:linkId            연결 바꾸기 (대표 · 실장) { status?, kinds?, reason? }
 *     대기 → 승인 · 반려, 승인 ↔ 정지, 승인 · 정지 → 끝. 처음 승인하면 계정(workers.status)도 approved 로.
 *     계정이 전역 정지면 승인할 수 없다 (409 account_suspended).
 *
 * 누가       그 업체의 구성원이면 읽는다 (다담 본사 구성원은 403). 쓰기는 대표 · 실장.
 *            새 초대 · 승인은 「인사를 쓰는 팩토리」(다담 공장 · active Agent — work-shifts.js canHoldPeople)만.
 *            등급이 내려가거나 멈춘 팩토리도 읽기 · 반려 · 정지 · 연결 끝은 된다 (진행 중인 일을 마무리할 수 있게).
 * 다른 업체   모든 읽기 · 쓰기를 company_id 로 거른다. 남의 연결 · 초대 id 는 404.
 * 고객 정보   없다. 작업자 이름 · 전화는 그 작업자가 연결을 신청한 팩토리에만 보인다.
 * DB 0064 적용 전이면 409 db_pending.
 */

import { ConflictError, ForbiddenError, NotFoundError, ValidationError, selectMany, selectOne, updateBy } from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { companyOf } from '../distribution/company.js';
import { canHoldPeople } from '../work-shifts.js';
import { recordWorkerEvent } from './events.js';
import { createInviteCore } from './invites.js';
import { MINE_STATUSES } from './jobs.js';
import { LINK_STATUSES, LINK_STATUS_LABEL, LINK_TRANSITIONS, linksPending } from './links.js';
import { later, notifyWorkerLink } from '../push/work-hooks.js';
import { offerInviteJob } from './invite-job.js';
import { assertUuid, kindsOf, oneOf, optText } from './validate.js';

/** 아직 끝나지 않은 작업 상태 — 진행 중 배정 수를 셀 때 */
const LIVE_JOB_STATUSES = Object.freeze(['draft', 'open', 'filled', 'in_progress', 'review']);
export const COMPANY_WORKERS_LIMIT = 500;

const nowIso = () => new Date().toISOString();

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}

/**
 * 부르는 사람의 팩토리. manage 면 대표 · 실장이어야 한다 (아니면 403 not_manager).
 * fresh 면 새 초대 · 승인을 할 수 있는 팩토리(다담 공장 · active Agent)여야 한다 (아니면 403 not_people_company).
 * @returns {Promise<{ company: object, canAct: boolean, holds: boolean }>}
 */
export async function workersCompanyOf(env, user, { manage = false, fresh = false } = {}) {
  const { companyId, canAct } = await companyOf(env, user, { manage });
  const company = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'id,kind,name,plan,status' });
  if (!company || (company.kind !== 'hq' && company.kind !== 'partner'))
    throw new ForbiddenError('작업자를 쓰는 팩토리가 아닙니다', 'not_people_company');
  const holds = canHoldPeople(company);
  if (fresh && !holds) throw new ForbiddenError('작업자를 초대 · 승인할 수 있는 팩토리가 아닙니다', 'not_people_company');
  return { company, canAct, holds };
}

/** 바꾼 뒤 돌려주는 연결 한 줄 (업체 · 작업자 id 는 싣지 않는다) */
const linkOut = (l) => ({ link_id: l.id, status: l.status, kinds: l.kinds || [], decided_at: l.decided_at || null, reason: l.reason || null });

/** 연결 표가 없으면 409 db_pending 으로 */
async function ready(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw linksPending();
    throw e;
  }
}

/** GET /company/workers */
export async function listCompanyWorkers(env, { user }) {
  const { company, canAct, holds } = await workersCompanyOf(env, user);
  const co = `eq.${company.id}`;
  const links = await ready(async () => (await selectMany(env, 'worker_companies', { company_id: co, select: '*', order: 'created_at.desc', limit: String(COMPANY_WORKERS_LIMIT) })) || []);
  const ids = [...new Set(links.map((l) => l.worker_id))];
  const [people, jobs] = await Promise.all([
    ids.length ? selectMany(env, 'workers', { id: `in.(${ids.join(',')})`, select: 'id,display_name,phone,kinds,region_label,status' }) : [],
    ids.length ? selectMany(env, 'work_jobs', { company_id: co, status: `in.(${LIVE_JOB_STATUSES.join(',')})`, select: 'id', limit: '500' }) : [],
  ]);
  const jobIds = (jobs || []).map((j) => j.id);
  const busy = jobIds.length
    ? (await selectMany(env, 'work_assignments', { job_id: `in.(${jobIds.join(',')})`, status: `in.(${MINE_STATUSES.join(',')})`, select: 'worker_id' })) || []
    : [];
  const active = new Map();
  for (const a of busy) active.set(a.worker_id, (active.get(a.worker_id) || 0) + 1);
  const byId = new Map((people || []).map((w) => [w.id, w]));

  const invites = canAct
    ? await ready(async () => (await selectMany(env, 'worker_invites', {
        company_id: co, used_at: 'is.null', revoked_at: 'is.null', expires_at: `gt.${nowIso()}`,
        select: 'id,kinds_preset,display_name_preset,expires_at,created_at', order: 'created_at.desc', limit: '100',
      })) || [])
    : [];

  return {
    company: { name: company.name },
    can_manage: canAct,
    can_invite: canAct && holds,
    workers: links
      .filter((l) => byId.has(l.worker_id))
      .map((l) => {
        const w = byId.get(l.worker_id);
        const out = {
          link_id: l.id,
          name: w.display_name,
          kinds: (l.kinds && l.kinds.length ? l.kinds : w.kinds) || [],
          region: w.region_label || null,
          status: l.status,
          account_status: w.status,
          via: l.via,
          since: l.created_at,
          decided_at: l.decided_at || null,
          reason: l.reason || null,
          active: active.get(w.id) || 0,
        };
        if (canAct) out.phone = w.phone || null;
        return out;
      }),
    invites,
  };
}

/** POST /company/workers/invites */
export async function createCompanyInvite(env, { user, body }) {
  const { company } = await workersCompanyOf(env, user, { manage: true, fresh: true });
  return ready(() => createInviteCore(env, { user, body, companyId: company.id }));
}

/** POST /company/workers/invites/:id/revoke */
export async function revokeCompanyInvite(env, { user, params }) {
  const id = assertUuid(params.id, '초대 id');
  const { company } = await workersCompanyOf(env, user, { manage: true });
  const co = `eq.${company.id}`;
  return ready(async () => {
    const rows = await updateBy(env, 'worker_invites', { id: `eq.${id}`, company_id: co, used_at: 'is.null', revoked_at: 'is.null' }, { revoked_at: nowIso() });
    if (rows && rows.length) return { id, revoked: true };
    const cur = await selectOne(env, 'worker_invites', { id: `eq.${id}`, company_id: co, select: 'id,used_at,revoked_at' });
    if (!cur) throw new NotFoundError('초대를 찾을 수 없습니다');
    // 이미 거뒀거나 쓰인 초대 — 그대로 알린다
    return { id, revoked: !!cur.revoked_at, used: !!cur.used_at };
  });
}

/** PATCH /company/workers/:linkId */
export async function patchCompanyWorker(env, { user, params, body, ctx }) {
  const id = assertUuid(params.linkId, '연결 id');
  const b = body || {};
  const next = b.status === undefined ? null : oneOf(b.status, LINK_STATUSES, 'status');
  const kinds = b.kinds === undefined ? null : kindsOf(b.kinds);
  if (!next && !kinds) throw new ValidationError('바꿀 칸이 없습니다');
  // 승인은 인사를 쓰는 팩토리만 — 반려 · 정지 · 끝 · 종류는 등급이 내려간 팩토리도 한다
  const { company } = await workersCompanyOf(env, user, { manage: true, fresh: next === 'approved' });

  return ready(async () => {
    const link = await selectOne(env, 'worker_companies', { id: `eq.${id}`, company_id: `eq.${company.id}`, select: '*' });
    if (!link) throw new NotFoundError('연결을 찾을 수 없습니다');
    const worker = await selectOne(env, 'workers', { id: `eq.${link.worker_id}`, select: '*' });
    if (!worker) throw new NotFoundError('작업자를 찾을 수 없습니다');

    const patch = {};
    if (kinds) patch.kinds = kinds;
    if (next && next !== link.status) {
      if (!(LINK_TRANSITIONS[link.status] || []).includes(next)) {
        const label = (st) => LINK_STATUS_LABEL[st] || st;
        throw conflict(`'${label(link.status)}' 상태에서 '${label(next)}'(으)로 바꿀 수 없습니다`, 'bad_transition');
      }
      if (next === 'approved' && worker.status === 'suspended')
        throw conflict('본사에서 정지한 작업자라 승인할 수 없습니다', 'account_suspended');
      patch.status = next;
      patch.decided_by = user.id;
      patch.decided_at = nowIso();
      patch.reason = next === 'rejected' || next === 'suspended' ? optText(b.reason, 200, '사유') : null;
    }
    if (!Object.keys(patch).length) return linkOut(link);

    const rows = await updateBy(env, 'worker_companies', { id: `eq.${id}`, company_id: `eq.${company.id}`, status: `eq.${link.status}` }, { ...patch, updated_at: nowIso() });
    if (!rows || !rows.length) throw conflict('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');

    if (patch.status === 'approved' && worker.status !== 'approved') {
      // 계정 상태 — 어느 팩토리든 처음 승인하면 승인 (대기 · 반려였던 계정). 전역 정지는 위에서 막았다
      await updateBy(env, 'workers', { id: `eq.${worker.id}`, status: `eq.${worker.status}` }, { status: 'approved', approved_by: user.id, approved_at: nowIso(), updated_at: nowIso() })
        .catch((e) => console.warn('[work] 계정 승인 실패:', e && e.message));
    }
    if (patch.status) {
      await recordWorkerEvent(env, {
        workerId: worker.id, actorUserId: user.id, actorKind: 'member', type: 'link_status_changed',
        from: link.status, to: patch.status, payload: { link_id: id },
      });
      if (patch.status === 'approved' || patch.status === 'rejected')
        await later(ctx, notifyWorkerLink(env, { worker, link: rows[0], status: patch.status, companyName: company.name }));
      // 「이 일로 바로」 초대로 온 작업자 — 승인하면 그 작업에 배정 제안을 넣는다 (작업자가 수락해야 확정). 못 넣어도 승인은 그대로
      if (patch.status === 'approved' && link.invite_id)
        await offerInviteJob(env, { companyId: company.id, workerId: worker.id, inviteId: link.invite_id, actor: user, ctx });
    }
    return linkOut(rows[0]);
  });
}
