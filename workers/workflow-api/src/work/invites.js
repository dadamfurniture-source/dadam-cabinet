/**
 * 작업자 포털 — 초대 링크 (★3 "초대 링크 + 공개 신청, 둘 다 사장님 승인", docs/01-plan/worker-portal-contract.md §3).
 *
 * 토큰은 발급 응답에서 1회만 평문으로 주고 DB 에는 pepperedHash(SHARE_TOKEN_PEPPER, 'worker-invite', token) 만 둔다
 * (공장 작업자 링크 production/worker-access.js 와 같은 방식, 네임스페이스만 다르다 — 새 시크릿 없음).
 * 링크는 1회용이고, 초대로 와도 작업자는 pending — 단톡방에 퍼진 링크를 처음 누른 사람이 바로 작업자가 되지 않게 (개정 #3).
 * 만료일은 편집자가 고른다 (기간 기본값을 정하지 않았다).
 */

import { pepperedHash } from '../util/hash.js';
import { ConflictError, GoneError, NotFoundError, ValidationError, insertOne, selectOne, updateBy } from '../supabase.js';
import { loadSelfWorker, requireAdminEditor } from './access.js';
import { recordWorkerEvent } from './events.js';
import { notifyWork } from './notify.js';
import { workerSelf } from './reveal.js';
import { kindsOf, optIso, optText } from './validate.js';
import { registrationFields } from './workers.js';

const TOKEN_BYTES = 24;

const nowIso = () => new Date().toISOString();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const hashInviteToken = (env, token) => pepperedHash(env.SHARE_TOKEN_PEPPER, 'worker-invite', token);

/** 토큰은 fragment 에 — 링크 미리보기 · Referer · 접속 로그로 새지 않게 */
export function inviteUrl(env, token) {
  return `${String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/worker.html#invite=${token}`;
}

/** POST /work/admin/invites — { kinds_preset[], display_name_preset?, expires_at } → { id, url, expires_at } */
export async function createInvite(env, { user, body }) {
  await requireAdminEditor(env, user);
  const b = body || {};
  const kinds = kindsOf(b.kinds_preset, 'kinds_preset');
  const name = optText(b.display_name_preset, 30, '이름 프리셋');
  const expires = optIso(b.expires_at, '만료');
  if (!expires) throw new ValidationError('만료일이 필요합니다');
  if (new Date(expires).getTime() <= Date.now()) throw new ValidationError('만료일은 지금보다 뒤여야 합니다');

  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = toBase64Url(bytes);
  const row = await insertOne(env, 'worker_invites', {
    token_hash: await hashInviteToken(env, token),
    kinds_preset: kinds,
    display_name_preset: name,
    expires_at: expires,
    created_by: user.id,
  });
  // ★ 평문 토큰은 이 응답에서만 볼 수 있다
  return { id: row.id, url: inviteUrl(env, token), expires_at: row.expires_at };
}

/**
 * POST /work/claim-invite — { token, consent_version, photo_consent?, display_name?, phone?, region_label?, kinds? }
 * → WorkerSelf (pending, 프리셋 적용). 없는 토큰 404, 만료 · 사용됨 410, 이미 작업자면 409.
 * 동의 버전은 workers.consent_version(NOT NULL)이라 초대로 와도 받는다.
 */
export async function claimInvite(env, { user, body, ctx }) {
  const b = body || {};
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (token.length < 20 || token.length > 100) throw new ValidationError('초대 링크가 올바르지 않습니다');
  if (await loadSelfWorker(env, user)) throw new ConflictError('이미 작업자로 등록돼 있습니다');

  const invite = await selectOne(env, 'worker_invites', { token_hash: `eq.${await hashInviteToken(env, token)}`, select: '*' });
  if (!invite) throw new NotFoundError('초대 링크를 찾을 수 없습니다');
  if (invite.used_at) throw new GoneError('이미 사용된 초대 링크입니다');
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new GoneError('만료된 초대 링크입니다');
  const fields = registrationFields(b, { display_name: invite.display_name_preset, kinds: invite.kinds_preset });

  // 1회용 — 아직 안 쓴 경우에만 찍는다 (동시에 두 사람이 눌러도 한 명만)
  const claimed = await updateBy(env, 'worker_invites', { id: `eq.${invite.id}`, used_at: 'is.null' }, { used_at: nowIso(), used_by: user.id });
  if (!claimed || !claimed.length) throw new GoneError('이미 사용된 초대 링크입니다');

  let row;
  try {
    row = await insertOne(env, 'workers', { user_id: user.id, ...fields, status: 'pending', consent_at: nowIso(), invited_via: invite.id });
  } catch (err) {
    await updateBy(env, 'worker_invites', { id: `eq.${invite.id}`, used_by: `eq.${user.id}` }, { used_at: null, used_by: null })
      .catch((e) => console.warn('[work] 초대 되돌리기 실패:', e && e.message));
    if (err instanceof ConflictError) throw new ConflictError('이미 작업자로 등록돼 있습니다');
    throw err;
  }
  await recordWorkerEvent(env, { workerId: row.id, actorUserId: user.id, actorKind: 'worker', type: 'registered', to: 'pending', payload: { via: 'invite', invite_id: invite.id } });
  notifyWork(env, ctx, 'worker_registered', { workerName: row.display_name });
  return workerSelf(row);
}
