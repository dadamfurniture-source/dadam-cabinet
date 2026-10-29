/**
 * 앱 알림 넣기 — 업체 구독 결제 실패 · 업체 정지 (payments-api).
 *
 * 업체 대표(active owner)에게 한 사람 한 줄씩 notification_outbox 에 넣는다
 * (database/migrations/0016_app_notifications.sql). 보내기는 workflow-api 의 1분 cron 이 한다.
 *   billing_failed     정기 결제가 처음 실패해 재시도가 시작될 때 · 마지막 재시도도 실패했을 때
 *   company_suspended  결제가 끝내 안 돼 업체가 정지됐을 때
 * dedupe_key: kind:구독 id:대표 id[:덧붙임] — 같은 일은 한 번만 들어간다.
 * 글은 workers/workflow-api/src/push/messages.js 와 같다 (시험이 본다) — 금액 · 카드 · 업체 이름을 넣지 않는다.
 * 넣기가 실패해도 결제 처리는 그대로다 — 던지지 않고 종류 · 상태 코드만 로그에 남긴다.
 */

import { selectMany } from './supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUSH_URL = '/segan/me.html#partner';

/** 결제 실패 알림 글 — final: 마지막 재시도도 실패 */
export function billingFailedMessage({ final = false } = {}) {
  return {
    title: '결제 실패',
    body: final
      ? '업체 구독 결제가 끝내 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.'
      : '업체 구독 결제가 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.',
    url: PUSH_URL,
  };
}

/** 업체 정지 알림 글 */
export function companySuspendedMessage() {
  return {
    title: '업체 정지',
    body: '결제가 되지 않아 업체가 정지되었습니다. 결제 관리에서 확인해 주세요.',
    url: PUSH_URL,
  };
}

/**
 * 업체 대표들에게 알림 한 줄씩. 던지지 않는다.
 * @param {{ companyId: string, kind: 'billing_failed'|'company_suspended', refId: string,
 *           suffix?: string|null, message: {title:string, body:string, url:string} }} n
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function notifyCompanyOwners(env, { companyId, kind, refId, suffix = null, message }) {
  try {
    if (!UUID_RE.test(String(companyId)) || !UUID_RE.test(String(refId)) || !message) return 0;
    const owners =
      (await selectMany(env, 'company_members', {
        company_id: `eq.${companyId}`,
        role: 'eq.owner',
        status: 'eq.active',
        select: 'user_id',
      })) || [];
    const ids = [...new Set(owners.map((m) => m.user_id))].filter((id) => UUID_RE.test(String(id)));
    if (!ids.length) return 0;
    const rows = ids.map((userId) => ({
      user_id: userId,
      company_id: companyId,
      kind,
      title: message.title,
      body: message.body,
      url: message.url,
      ref_id: refId,
      dedupe_key: `${kind}:${refId}:${userId}${suffix ? `:${suffix}` : ''}`,
    }));
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_outbox?on_conflict=dedupe_key`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      }
    );
    if (!res.ok) {
      console.warn('[payments] notification_outbox:', kind, res.status);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.warn(
      '[payments] notification_outbox:',
      kind,
      e && e.statusCode ? e.statusCode : 'error'
    );
    return 0;
  }
}
