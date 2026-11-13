/**
 * 작업자 포털 — 초대 링크 (★3 "초대 링크 + 공개 신청, 둘 다 사장님 승인", docs/01-plan/worker-portal-contract.md §3).
 *
 * 토큰은 발급 응답에서 1회만 평문으로 주고 DB 에는 pepperedHash(SHARE_TOKEN_PEPPER, 'worker-invite', token) 만 둔다
 * (공장 작업자 링크 production/worker-access.js 와 같은 방식, 네임스페이스만 다르다 — 새 시크릿 없음).
 * 링크는 1회용이고, 초대로 와도 작업자는 pending — 단톡방에 퍼진 링크를 처음 누른 사람이 바로 작업자가 되지 않게 (개정 #3).
 * 만료일은 편집자가 고른다 (기간 기본값을 정하지 않았다).
 *
 * 2026-11-13 「작업자 한 길」 (DB 0064) — 초대에 팩토리 칸(company_id)이 생겼다:
 *   팩토리 대표 · 실장이 자기 팩토리의 초대를 만든다 (work/company.js → createInviteCore). 초대로 오면 그 팩토리와의
 *   연결이 대기로 생기고, 그 팩토리가 승인해야 연결된다. 팩토리 칸이 빈 옛 초대는 다담 공장 것으로 받는다.
 *   이미 작업자인 사람도 초대로 새 팩토리와 연결을 신청할 수 있다 (신청서를 다시 쓰지 않는다).
 *   거둔 초대(revoked_at)는 410. peekInvite 는 누르기 전에 어느 팩토리의 초대인지 보여 준다.
 */

import { pepperedHash } from '../util/hash.js';
import { ConflictError, GoneError, NotFoundError, ValidationError, hqCompanyId, insertOne, selectOne, updateBy } from '../supabase.js';
import { loadSelfWorker, requireAdminEditor } from './access.js';
import { recordWorkerEvent } from './events.js';
import { notifyWork } from './notify.js';
import { workerSelf } from './reveal.js';
import { kindsOf, optIso, optText } from './validate.js';
import { registrationFields } from './workers.js';
import { companyNames, linkOf, requestLink } from './links.js';
import { later, notifyCompanyWork } from '../push/work-hooks.js';

const TOKEN_BYTES = 24;

const nowIso = () => new Date().toISOString();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const hashInviteToken = (env, token) => pepperedHash(env.SHARE_TOKEN_PEPPER, 'worker-invite', token);

/** 토큰은 fragment 에 — 링크 미리보기 · Referer · 접속 로그로 새지 않게. 받는 곳은 앱 「작업」 (옛 worker.html 은 앱으로 넘긴다) */
export function inviteUrl(env, token) {
  return `${String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/segan/work.html#invite=${token}`;
}

/**
 * 초대 한 줄 넣기 (권한 검사는 부르는 쪽) — { kinds_preset[], display_name_preset?, expires_at } → { id, url, expires_at }.
 * companyId 가 있으면 그 팩토리의 초대 (0064), 없으면 옛 본사 초대.
 */
export async function createInviteCore(env, { user, body, companyId = null }) {
  const b = body || {};
  const kinds = kindsOf(b.kinds_preset, 'kinds_preset');
  const name = optText(b.display_name_preset, 30, '이름 프리셋');
  const expires = optIso(b.expires_at, '만료');
  if (!expires) throw new ValidationError('만료일이 필요합니다');
  if (new Date(expires).getTime() <= Date.now()) throw new ValidationError('만료일은 지금보다 뒤여야 합니다');

  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = toBase64Url(bytes);
  const row = {
    token_hash: await hashInviteToken(env, token),
    kinds_preset: kinds,
    display_name_preset: name,
    expires_at: expires,
    created_by: user.id,
  };
  if (companyId) row.company_id = companyId;
  const made = await insertOne(env, 'worker_invites', row);
  // ★ 평문 토큰은 이 응답에서만 볼 수 있다
  return { id: made.id, url: inviteUrl(env, token), expires_at: made.expires_at };
}

/** POST /work/admin/invites — 사이트 관리자 편집자 (팩토리 칸 없는 초대 = 다담 공장) */
export async function createInvite(env, { user, body }) {
  await requireAdminEditor(env, user);
  return createInviteCore(env, { user, body });
}

/** 토큰 → 쓸 수 있는 초대 줄. 없는 토큰 404, 거둠 · 사용됨 · 만료 410 */
async function usableInvite(env, rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (token.length < 20 || token.length > 100) throw new ValidationError('초대 링크가 올바르지 않습니다');
  const invite = await selectOne(env, 'worker_invites', { token_hash: `eq.${await hashInviteToken(env, token)}`, select: '*' });
  if (!invite) throw new NotFoundError('초대 링크를 찾을 수 없습니다');
  if (invite.revoked_at) throw new GoneError('거둔 초대 링크입니다');
  if (invite.used_at) throw new GoneError('이미 사용된 초대 링크입니다');
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new GoneError('만료된 초대 링크입니다');
  return invite;
}

/** 초대한 팩토리 — 팩토리 칸이 비면(옛 초대 · 0064 전) 다담 공장 */
async function inviteCompanyId(env, invite) {
  return invite.company_id || (await hqCompanyId(env)) || null;
}

/**
 * POST /work/invites/peek — { token } → { company_name, kinds_preset, expires_at, already_worker, link_status }.
 * 누르기 전에 어느 팩토리의 초대인지 보여 준다. 초대를 쓰지 않는다. 팩토리 id · 초대한 사람은 싣지 않는다.
 */
export async function peekInvite(env, { user, body }) {
  const invite = await usableInvite(env, body && body.token);
  const companyId = await inviteCompanyId(env, invite);
  const names = await companyNames(env, [companyId]);
  const worker = await loadSelfWorker(env, user);
  const link = worker && companyId ? await linkOf(env, companyId, worker.id) : null;
  return {
    company_name: (companyId && names.get(companyId)) || null,
    kinds_preset: invite.kinds_preset || [],
    expires_at: invite.expires_at,
    already_worker: !!worker,
    link_status: link ? link.status : null,
  };
}

/** 1회용 — 아직 안 쓴 경우에만 찍는다 (동시에 두 사람이 눌러도 한 명만) */
async function useInvite(env, invite, user) {
  const claimed = await updateBy(env, 'worker_invites', { id: `eq.${invite.id}`, used_at: 'is.null' }, { used_at: nowIso(), used_by: user.id });
  if (!claimed || !claimed.length) throw new GoneError('이미 사용된 초대 링크입니다');
}

const unuseInvite = (env, invite, user) =>
  updateBy(env, 'worker_invites', { id: `eq.${invite.id}`, used_by: `eq.${user.id}` }, { used_at: null, used_by: null })
    .catch((e) => console.warn('[work] 초대 되돌리기 실패:', e && e.message));

/**
 * POST /work/claim-invite — { token, display_name?, phone?, kinds?, region_label?, consent_version, photo_consent? }
 * → WorkerSelf + linked { company_name, status } (연결 표가 있을 때).
 *   처음인 사람: 작업자 행(pending, 프리셋 적용) + 그 팩토리와의 연결(대기).
 *   이미 작업자인 사람: 신청서 없이 그 팩토리와의 연결만 대기로 (이미 연결돼 있으면 409 already_linked).
 *     연결 표가 없으면(0064 전) 옛 동작 — 409 「이미 작업자로 등록돼 있습니다」.
 * 없는 토큰 404, 거둠 · 만료 · 사용됨 410. 동의 버전은 workers.consent_version(NOT NULL)이라 처음이면 초대로 와도 받는다.
 */
export async function claimInvite(env, { user, body, ctx }) {
  const b = body || {};
  const invite = await usableInvite(env, b.token);
  const companyId = await inviteCompanyId(env, invite);
  const kinds = Array.isArray(invite.kinds_preset) ? invite.kinds_preset : [];
  const existing = await loadSelfWorker(env, user);

  if (existing) {
    const cur = companyId ? await linkOf(env, companyId, existing.id) : undefined;
    if (cur === undefined) throw new ConflictError('이미 작업자로 등록돼 있습니다');
    if (cur && (cur.status === 'approved' || cur.status === 'suspended')) {
      const err = new ConflictError('이미 연결된 팩토리입니다');
      err.code = 'already_linked';
      throw err;
    }
    await useInvite(env, invite, user);
    let link;
    try {
      link = await requestLink(env, { companyId, workerId: existing.id, via: 'invite', inviteId: invite.id, kinds: kinds.length ? kinds : existing.kinds || [] });
    } catch (err) {
      await unuseInvite(env, invite, user);
      throw err;
    }
    await recordWorkerEvent(env, { workerId: existing.id, actorUserId: user.id, actorKind: 'worker', type: 'link_requested', to: 'pending', payload: { via: 'invite', invite_id: invite.id } });
    await later(ctx, notifyCompanyWork(env, { companyId, kind: 'work_link_request', refId: link && link.id }));
    const names = await companyNames(env, [companyId]);
    return { ...workerSelf(existing), linked: { company_name: names.get(companyId) || null, status: link ? link.status : 'pending' } };
  }

  const fields = registrationFields(b, { display_name: invite.display_name_preset, kinds: invite.kinds_preset });
  await useInvite(env, invite, user);
  let row;
  try {
    row = await insertOne(env, 'workers', { user_id: user.id, ...fields, status: 'pending', consent_at: nowIso(), invited_via: invite.id });
  } catch (err) {
    await unuseInvite(env, invite, user);
    if (err instanceof ConflictError) throw new ConflictError('이미 작업자로 등록돼 있습니다');
    throw err;
  }
  await recordWorkerEvent(env, { workerId: row.id, actorUserId: user.id, actorKind: 'worker', type: 'registered', to: 'pending', payload: { via: 'invite', invite_id: invite.id } });
  // 그 팩토리와의 연결을 대기로 — 연결 표가 없으면(0064 전) 넘어간다 (옛 동작: 본사 승인)
  const link = companyId
    ? await requestLink(env, { companyId, workerId: row.id, via: 'invite', inviteId: invite.id, kinds: row.kinds || [] })
        .catch((e) => { console.warn('[work] 연결 넣기 실패:', e && e.message); return null; })
    : null;
  if (link) await later(ctx, notifyCompanyWork(env, { companyId, kind: 'work_link_request', refId: link.id }));
  // Slack(공장 웹훅)은 다담 공장으로 온 신청만 — 협력 팩토리의 작업자 이름을 공장 Slack 에 싣지 않는다
  if (!invite.company_id) notifyWork(env, ctx, 'worker_registered', { workerName: row.display_name });
  const out = workerSelf(row);
  if (link) {
    const names = await companyNames(env, [companyId]);
    out.linked = { company_name: names.get(companyId) || null, status: link.status };
  }
  return out;
}
