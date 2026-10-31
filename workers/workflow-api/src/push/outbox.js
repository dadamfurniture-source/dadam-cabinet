/**
 * 보낼 알림 넣기 (notification_outbox — database/migrations/0016_app_notifications.sql).
 *
 * 받는 사람 한 명 = 한 줄. 서버가 일이 생길 때 넣고, 1분 cron(src/push/sender.js)이 잡아 보낸다.
 * 같은 dedupe_key 는 한 번만 들어간다 (DB 유니크 — 충돌은 조용히 넘긴다).
 * dedupe_key 모양: kind:ref_id:user_id[:덧붙임]  (dedupeKeyOf)
 *
 * 넣기는 원래 일(승인 · 결정 · 결제)을 막지 않는다 — 실패해도 던지지 않고 짧은 경고(종류 · 상태 코드)만 남긴다.
 * 로그에 글 · 받는 사람을 싣지 않는다.
 */

import { selectMany } from '../supabase.js';
import { NOTIFICATION_KINDS, WORK_NOTIFICATION_KINDS, isValidMessage } from './messages.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** DB 상한 */
const DEDUPE_MAX = 200;
/** in.(…) 한 번에 싣는 id 수 */
const ID_CHUNK = 100;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** kind:ref_id:user_id[:suffix] — ref_id 가 없으면 null (같은 일을 가를 수 없다) */
export function dedupeKeyOf(kind, refId, userId, suffix = null) {
  if (!refId || !userId) return null;
  const key = `${kind}:${refId}:${userId}${suffix ? `:${suffix}` : ''}`;
  return key.length <= DEDUPE_MAX ? key : null;
}

class OutboxError extends Error {
  constructor(status) {
    super(`outbox ${status}`);
    this.status = status;
  }
}

/** 여러 줄 넣기 — 같은 dedupe_key 는 넘긴다. 실패하면 OutboxError(상태) */
async function insertRows(env, rows) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/notification_outbox?on_conflict=dedupe_key`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new OutboxError(res.status);
}

/**
 * 알림 한 줄 모양 — 틀리면 null.
 * company_id 는 업체 신청(partner_application) · 작업자 알림(work_*)만 비울 수 있다 (DB notification_outbox_company_check).
 */
function outboxRow({ userId, companyId = null, kind, title, body, url, refId = null, dedupeKey = null }) {
  if (!NOTIFICATION_KINDS.includes(kind)) return null;
  if (!isUuid(userId)) return null;
  if (companyId !== null && !isUuid(companyId)) return null;
  if (companyId === null && kind !== 'partner_application' && !WORK_NOTIFICATION_KINDS.includes(kind)) return null;
  if (refId !== null && !isUuid(refId)) return null;
  if (dedupeKey !== null && (typeof dedupeKey !== 'string' || !dedupeKey || dedupeKey.length > DEDUPE_MAX)) return null;
  if (!isValidMessage({ title, body, url })) return null;
  return {
    user_id: userId,
    company_id: companyId,
    kind,
    title,
    body,
    url,
    ref_id: refId,
    dedupe_key: dedupeKey,
  };
}

/**
 * 보낼 알림 한 줄 넣기. 던지지 않는다.
 * @param {object} n  { userId, companyId, kind, title, body, url, refId, dedupeKey }
 * @returns {Promise<boolean>} 넣으려고 보냈으면 true (같은 dedupe_key 로 넘겨진 것도 true)
 */
export async function enqueueNotification(env, n) {
  return (await enqueueNotifications(env, [n])) === 1;
}

/**
 * 여러 줄을 한 번에. 모양이 틀린 줄은 빼고 경고만 남긴다. 던지지 않는다.
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function enqueueNotifications(env, list) {
  const items = Array.isArray(list) ? list : [];
  const rows = [];
  for (const n of items) {
    const row = n && typeof n === 'object' ? outboxRow(n) : null;
    if (row) rows.push(row);
    else console.warn('[push] enqueue skipped: invalid', n && typeof n.kind === 'string' ? n.kind : '?');
  }
  if (!rows.length) return 0;
  try {
    await insertRows(env, rows);
    return rows.length;
  } catch (e) {
    console.warn('[push] enqueue failed:', rows[0].kind, e && e.status ? e.status : 'error');
    return 0;
  }
}

/**
 * 업체의 역할별 받는 사람에게 — 넣는 때의 active 구성원으로 정한다 (한 사람 한 줄).
 * userIds 는 역할과 상관없이 더 받을 사람 — 그 업체 active 구성원일 때만 넣는다 (예: 설계를 만든 사람).
 * excludeUserIds 는 받지 않을 사람 (예: 그 일을 한 사람 자신).
 * dedupe_key 는 refId 가 있을 때 kind:refId:userId[:dedupeSuffix].
 * 던지지 않는다.
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function notifyRoles(
  env,
  { companyId, roles = [], userIds = [], excludeUserIds = [], kind, title, body, url, refId = null, dedupeSuffix = null },
) {
  if (!isUuid(companyId)) {
    console.warn('[push] notifyRoles skipped: no company', kind);
    return 0;
  }
  let members;
  try {
    members =
      (await selectMany(env, 'company_members', {
        company_id: `eq.${companyId}`,
        status: 'eq.active',
        select: 'user_id,role',
      })) || [];
  } catch (e) {
    console.warn('[push] notifyRoles failed:', kind, e && e.statusCode ? e.statusCode : 'error');
    return 0;
  }
  const extra = new Set((userIds || []).filter(isUuid));
  const skip = new Set((excludeUserIds || []).filter(isUuid));
  const recipients = [];
  for (const m of members) {
    if (!isUuid(m.user_id) || skip.has(m.user_id) || recipients.includes(m.user_id)) continue;
    if (roles.includes(m.role) || extra.has(m.user_id)) recipients.push(m.user_id);
  }
  if (!recipients.length) return 0;
  let sent = 0;
  for (let i = 0; i < recipients.length; i += ID_CHUNK) {
    sent += await enqueueNotifications(
      env,
      recipients.slice(i, i + ID_CHUNK).map((userId) => ({
        userId,
        companyId,
        kind,
        title,
        body,
        url,
        refId,
        dedupeKey: dedupeKeyOf(kind, refId, userId, dedupeSuffix),
      })),
    );
  }
  return sent;
}
