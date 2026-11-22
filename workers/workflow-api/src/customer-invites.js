/**
 * 고객 초대 링크 (DB 0082 customer_invites — 2026-11-23 대표님 「프로젝트 한 길」 뒤 공정 3차 · 「진행」).
 *
 * 업체가 고객에게 링크를 보내면, 고객이 그 링크로 로그인해 그 고객 줄(customers)이 고객 계정과 이어진다.
 * 그 뒤 고객은 앱 「내 프로젝트」(GET /me/projects)에서 그 프로젝트의 단계 · 설치 날 · 수금 · A/S 를 본다.
 *
 *   POST /company/projects/:id/customer-invite   링크 만들기 — 대표 · 실장 · 그 프로젝트의 담당자, 진행 중 프로젝트만
 *        → { id, url, expires_at }  url 은 이 응답에서 한 번만 보인다 (DB 에는 해시만). 같은 프로젝트의 쓰지 않은
 *          옛 링크는 거둔다 (하나만 살아 있다). 이미 앱 계정과 이어진 고객이면 409 already_linked.
 *   POST /customer-invites/peek   { token } → { company_name, expires_at }  누르기 전에 어느 업체의 초대인지 (쓰지 않는다)
 *   POST /customer-invites/accept { token } → { project_id, company_name }  로그인한 사람의 계정과 고객 줄을 잇는다
 *        한 번만 쓴다 (동시에 눌러도 한 명만). 거둠 · 사용됨 · 만료 410. 고객 줄이 이미 다른 계정과 이어져 있으면 409 linked_other,
 *        그 업체에 이 계정의 고객 줄이 이미 따로 있으면 409 already_customer (업체가 정리한다).
 *
 * 토큰은 작업자 초대(work/invites.js)와 같은 방식 — pepperedHash(SHARE_TOKEN_PEPPER, 'customer-invite', token).
 * 링크는 fragment(#) 에 토큰을 싣는다 (미리보기 · Referer · 접속 로그로 새지 않게).
 * 만료는 만든 때부터 INVITE_DAYS 일.
 * 일지(project-log.js): customer_invited(구성원) · customer_joined(고객) — 이름 · 전화 · 토큰은 싣지 않는다.
 * DB 0082 적용 전이면 409 db_pending.
 */

import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { pepperedHash } from './util/hash.js';
import { projectCompanyOf } from './company-projects.js';
import { canVisit } from './company-project-visits.js';
import { isMissingRelation } from './work-order-data.js';
import { logProject } from './project-log.js';

/** 링크가 살아 있는 날 수 */
export const INVITE_DAYS = 14;
const TOKEN_BYTES = 24;
const DAY_MS = 86400000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () => conflict('DB 0082 적용 전입니다 — 고객 초대는 적용 뒤에 쓸 수 있습니다', 'db_pending');

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const hashCustomerToken = (env, token) => pepperedHash(env.SHARE_TOKEN_PEPPER, 'customer-invite', token);

/** 받는 곳은 앱 마이페이지 — 화면이 #customer-invite= 를 읽어 로그인 뒤 잇는다 */
export function customerInviteUrl(env, token) {
  return `${String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/segan/me.html#customer-invite=${token}`;
}

/** 표가 있나 (DB 0082) — 목록이 「고객 초대」 단추를 낼지 정한다 */
export async function invitesReady(env, companyId) {
  try {
    await selectMany(env, 'customer_invites', { company_id: `eq.${companyId}`, select: 'id', limit: '1' });
    return true;
  } catch (e) {
    if (isMissingRelation(e)) return false;
    throw e;
  }
}

/** POST /company/projects/:id/customer-invite */
export async function createCustomerInvite(env, { user, params, ctx, nowMs = Date.now() }) {
  const projectId = String((params && params.id) || '');
  if (!UUID_RE.test(projectId)) throw new ValidationError('프로젝트 id 가 올바르지 않습니다');
  const { company, role } = await projectCompanyOf(env, user);
  const project = await selectOne(env, 'projects', {
    id: `eq.${projectId}`,
    company_id: `eq.${company.id}`,
    select: 'id,customer_id,status,assignee_id',
  });
  if (!project) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  if (!canVisit(project, { role, user_id: user.id }))
    throw new ForbiddenError('고객 초대는 대표 · 실장 · 담당자가 합니다', 'not_allowed');
  if (project.status !== 'active') throw conflict('진행 중인 프로젝트만 고객을 초대할 수 있습니다', 'not_active');
  const customer = project.customer_id
    ? await selectOne(env, 'customers', {
        id: `eq.${project.customer_id}`,
        company_id: `eq.${company.id}`,
        select: 'id,user_id',
      })
    : null;
  if (!customer) throw conflict('이 프로젝트에 고객이 없습니다', 'no_customer');
  if (customer.user_id) throw conflict('이 고객은 이미 앱 계정과 이어져 있습니다', 'already_linked');

  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = toBase64Url(bytes);
  const now = new Date(nowMs).toISOString();
  let made;
  try {
    // 같은 프로젝트의 쓰지 않은 옛 링크는 거둔다 — 살아 있는 링크는 하나뿐
    await updateBy(
      env,
      'customer_invites',
      { project_id: `eq.${project.id}`, company_id: `eq.${company.id}`, used_at: 'is.null', revoked_at: 'is.null' },
      { revoked_at: now }
    );
    made = await insertOne(env, 'customer_invites', {
      company_id: company.id,
      customer_id: customer.id,
      project_id: project.id,
      token_hash: await hashCustomerToken(env, token),
      expires_at: new Date(nowMs + INVITE_DAYS * DAY_MS).toISOString(),
      created_by: user.id,
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  await logProject(env, ctx, {
    companyId: company.id,
    projectId: project.id,
    actor: { id: user.id },
    type: 'customer_invited',
    subject: { type: 'project', id: project.id },
  });
  // ★ 평문 토큰은 이 응답에서만 볼 수 있다
  return { id: made.id, url: customerInviteUrl(env, token), expires_at: made.expires_at };
}

/** 토큰 → 쓸 수 있는 초대 줄. 없는 토큰 404, 거둠 · 사용됨 · 만료 410 */
async function usableInvite(env, rawToken, nowMs) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (token.length < 20 || token.length > 100) throw new ValidationError('초대 링크가 올바르지 않습니다');
  let invite;
  try {
    invite = await selectOne(env, 'customer_invites', {
      token_hash: `eq.${await hashCustomerToken(env, token)}`,
      select: 'id,company_id,customer_id,project_id,expires_at,used_at,used_by,revoked_at',
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!invite) throw new NotFoundError('초대 링크를 찾을 수 없습니다');
  if (invite.revoked_at) throw new GoneError('거둔 초대 링크입니다 — 업체에 새 링크를 받아 주세요');
  if (invite.used_at) throw new GoneError('이미 사용된 초대 링크입니다');
  if (Date.parse(invite.expires_at) < nowMs) throw new GoneError('만료된 초대 링크입니다 — 업체에 새 링크를 받아 주세요');
  return invite;
}

async function companyNameOf(env, companyId) {
  const c = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'name' });
  return (c && c.name) || null;
}

/** POST /customer-invites/peek — 쓰지 않고 어느 업체의 초대인지만 */
export async function peekCustomerInvite(env, { body, nowMs = Date.now() }) {
  const invite = await usableInvite(env, body && body.token, nowMs);
  return { company_name: await companyNameOf(env, invite.company_id), expires_at: invite.expires_at };
}

/** POST /customer-invites/accept */
export async function acceptCustomerInvite(env, { user, body, ctx, nowMs = Date.now() }) {
  if (!user || !UUID_RE.test(String(user.id || ''))) throw new ForbiddenError('로그인이 필요합니다');
  const invite = await usableInvite(env, body && body.token, nowMs);
  const customer = await selectOne(env, 'customers', {
    id: `eq.${invite.customer_id}`,
    company_id: `eq.${invite.company_id}`,
    select: 'id,user_id',
  });
  if (!customer) throw new NotFoundError('초대 링크를 찾을 수 없습니다');
  if (customer.user_id && customer.user_id !== user.id)
    throw conflict('이 고객은 이미 다른 계정과 이어져 있습니다 — 업체에 알려 주세요', 'linked_other');
  if (!customer.user_id) {
    // 그 업체에 이 계정의 고객 줄이 따로 있으면 잇지 않는다 (customers_company_user 유니크 — 업체가 정리한다)
    const mine = await selectOne(env, 'customers', {
      company_id: `eq.${invite.company_id}`,
      user_id: `eq.${user.id}`,
      select: 'id',
    });
    if (mine) throw conflict('이 업체에 이미 이 계정의 고객 정보가 있습니다 — 업체에 알려 주세요', 'already_customer');
  }
  // 1회용 — 아직 안 쓴 경우에만 찍는다 (동시에 두 사람이 눌러도 한 명만)
  const used = await updateBy(
    env,
    'customer_invites',
    { id: `eq.${invite.id}`, used_at: 'is.null', revoked_at: 'is.null' },
    { used_at: new Date(nowMs).toISOString(), used_by: user.id }
  );
  if (!used || !used.length) throw new GoneError('이미 사용된 초대 링크입니다');
  if (!customer.user_id) {
    // 잇지 못하면 링크를 다시 쓸 수 있게 되돌린다 (되돌리기가 실패해도 원래 오류를 던진다)
    const unuse = () =>
      updateBy(env, 'customer_invites', { id: `eq.${invite.id}`, used_by: `eq.${user.id}` }, { used_at: null, used_by: null }).catch(
        (e) => console.error('customer invite unuse failed:', e && e.message)
      );
    let linked;
    try {
      linked = await updateBy(env, 'customers', { id: `eq.${customer.id}`, user_id: 'is.null' }, { user_id: user.id });
    } catch (e) {
      await unuse();
      if (e instanceof ConflictError)
        throw conflict('이 업체에 이미 이 계정의 고객 정보가 있습니다 — 업체에 알려 주세요', 'already_customer');
      throw e;
    }
    if (!linked || !linked.length) {
      await unuse();
      throw conflict('이 고객은 이미 다른 계정과 이어져 있습니다 — 업체에 알려 주세요', 'linked_other');
    }
    await logProject(env, ctx, {
      companyId: invite.company_id,
      projectId: invite.project_id,
      actor: { kind: 'customer', id: user.id },
      type: 'customer_joined',
      subject: { type: 'project', id: invite.project_id },
    });
  }
  return { project_id: invite.project_id, company_name: await companyNameOf(env, invite.company_id) };
}
