/**
 * 앱 알림 넣기 — 업체 신청 진행 (account-api).
 *
 * 관리자가 신청을 미팅 · 승인 · 보류로 바꾸면 신청한 사람에게 알림 한 줄을 notification_outbox 에 넣는다
 * (database/migrations/0016_app_notifications.sql). 보내기는 workflow-api 의 1분 cron 이 한다.
 *   업체 id: Expert → Agent 신청(upgrade)이면 그 업체, 새 업체 신청이면 비움 (업체 없는 기기로 간다)
 *   dedupe_key: partner_application:신청 id:사람 id:상태 — 미팅은 미팅 시각까지 붙여 일정이 바뀌면 다시 알린다
 * 글은 workers/workflow-api/src/push/messages.js 와 같다 (시험이 본다) — 이름 · 연락처 · 업체 이름을 넣지 않는다.
 * 넣기가 실패해도 처리는 그대로다 — 던지지 않고 상태 코드만 로그에 남긴다.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PUSH_URL = '/segan/me.html#partner';

/** 업체 신청 알림 글 — status: meeting | approved | held */
export function partnerApplicationMessage({ status, upgrade = false, rescheduled = false }) {
  let body;
  if (status === 'meeting') {
    body = rescheduled
      ? '업체 신청 미팅 일정이 바뀌었습니다. 내 정보에서 확인해 주세요.'
      : '업체 신청 미팅이 잡혔습니다. 내 정보에서 일정을 확인해 주세요.';
  } else if (status === 'approved') {
    body = upgrade
      ? 'Agent 등급 신청이 승인되었습니다. 다음 결제일부터 바뀝니다.'
      : '업체 신청이 승인되었습니다. 내 정보에서 다음 단계를 확인해 주세요.';
  } else if (status === 'held') {
    body = '업체 신청이 보류되었습니다. 내 정보에서 확인해 주세요.';
  } else {
    return null;
  }
  return { title: '업체 신청', body, url: PUSH_URL };
}

/**
 * 신청 상태가 바뀐 뒤 신청한 사람에게 알림 한 줄. 던지지 않는다.
 * @param {object} app  바뀐 신청 행 (id · user_id · company_id · kind · status · meeting_at)
 * @param {{ rescheduled?: boolean }} [o]  이미 미팅이던 신청의 미팅 시각을 바꿨으면 true
 */
export async function enqueuePartnerApplicationNotice(env, app, { rescheduled = false } = {}) {
  try {
    if (!app || !UUID_RE.test(String(app.id)) || !UUID_RE.test(String(app.user_id))) return false;
    const upgrade = app.kind === 'upgrade';
    const companyId = upgrade && UUID_RE.test(String(app.company_id)) ? app.company_id : null;
    if (upgrade && !companyId) return false;
    const msg = partnerApplicationMessage({ status: app.status, upgrade, rescheduled });
    if (!msg) return false;
    const stamp =
      app.status === 'meeting' && app.meeting_at
        ? `:${new Date(app.meeting_at).toISOString().replace(/[-:.]/g, '')}`
        : '';
    const row = {
      user_id: app.user_id,
      company_id: companyId,
      kind: 'partner_application',
      title: msg.title,
      body: msg.body,
      url: msg.url,
      ref_id: app.id,
      dedupe_key: `partner_application:${app.id}:${app.user_id}:${app.status}${stamp}`,
    };
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
        body: JSON.stringify(row),
      }
    );
    if (!res.ok) {
      console.warn('[partner] notification_outbox:', app.status, res.status);
      return false;
    }
    return true;
  } catch {
    console.warn('[partner] notification_outbox:', app && app.status ? app.status : '?', 'error');
    return false;
  }
}
