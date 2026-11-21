/**
 * 앱 알림 넣기 — 업체 신청 진행 · 사업자등록증 검토 (account-api).
 *
 * 관리자가 신청을 미팅 · 승인 · 보류로 바꾸면 신청한 사람에게 알림 한 줄을 notification_outbox 에 넣는다
 * (database/migrations/0016_app_notifications.sql). 보내기는 workflow-api 의 1분 cron 이 한다.
 *   업체 id: Manager · Expert → Agent 신청(upgrade)이면 그 업체, 새 업체 신청이면 비움 (업체 없는 기기로 간다)
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
      ? '팩토리 신청 미팅 일정이 바뀌었습니다. 내 정보에서 확인해 주세요.'
      : '팩토리 신청 미팅이 잡혔습니다. 내 정보에서 일정을 확인해 주세요.';
  } else if (status === 'approved') {
    body = upgrade
      ? 'Agent 등급 신청이 승인되었습니다. 다음 결제일부터 바뀝니다.'
      : '팩토리 신청이 승인되었습니다. 내 정보에서 다음 단계를 확인해 주세요.';
  } else if (status === 'held') {
    body = '팩토리 신청이 보류되었습니다. 내 정보에서 확인해 주세요.';
  } else {
    return null;
  }
  return { title: '팩토리 신청', body, url: PUSH_URL };
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

// ── 사업자등록증 (database/migrations/0077) ─────────────────────────────
//   biz_cert_review   검토할 사업자등록증이 생겼다 → 다담 본사(kind platform) 대표 · 실장. 업체 칸 = 본사 업체 id
//   biz_cert_decided  본사 검토 결과(승인 · 반려) → 올린 사람. 업체 없이 넣는다 (올린 사람에게 업체가 아직 없다)
//   dedupe_key: 종류:사업자등록증 id:사람 id (결과는 뒤에 상태) — 같은 일은 한 번만
// 글은 workers/workflow-api/src/push/messages.js 와 같다 (시험이 본다) — 사업자번호 · 이름 · 상호를 넣지 않는다.

/** 본사 화면이 생길 자리 */
export const BIZ_CERT_REVIEW_URL = '/segan/me.html#hq-biz-cert';

/** 검토할 사업자등록증 — 본사 대표 · 실장에게 */
export function bizCertReviewMessage() {
  return {
    title: '사업자등록증 확인',
    body: '검토할 사업자등록증이 있습니다.',
    url: BIZ_CERT_REVIEW_URL,
  };
}

/** 검토 결과 — 올린 사람에게. { approved } */
export function bizCertDecidedMessage({ approved } = {}) {
  if (typeof approved !== 'boolean') return null;
  return approved
    ? {
        title: '사업자등록증 확인 완료',
        body: '사업자등록증 확인이 끝났습니다. 팩토리를 첫 달 무료로 시작할 수 있습니다.',
        url: PUSH_URL,
      }
    : {
        title: '사업자등록증 확인',
        body: '사업자등록증을 확인하지 못했습니다. 다시 올리거나 바로 시작할 수 있습니다.',
        url: PUSH_URL,
      };
}

/** 알림 줄 넣기 — 같은 dedupe_key 는 넘긴다. 던지지 않는다 (종류 · 상태 코드만 로그) */
async function insertOutbox(env, rows, kind) {
  try {
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
      console.warn('[cert] notification_outbox:', kind, res.status);
      return false;
    }
    return true;
  } catch {
    console.warn('[cert] notification_outbox:', kind, 'error');
    return false;
  }
}

/**
 * 검토로 넘어간 사업자등록증 — 본사 대표 · 실장마다 한 줄. 던지지 않는다.
 * @param {string} certId  사업자등록증 id
 * @param {{ user_id: string, company_id: string }[]} reviewers  본사 업체의 active 대표 · 실장
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function enqueueBizCertReviewNotices(env, certId, reviewers) {
  if (!UUID_RE.test(String(certId))) return 0;
  const msg = bizCertReviewMessage();
  const seen = new Set();
  const rows = [];
  for (const r of Array.isArray(reviewers) ? reviewers : []) {
    if (!r || !UUID_RE.test(String(r.user_id)) || !UUID_RE.test(String(r.company_id))) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    rows.push({
      user_id: r.user_id,
      company_id: r.company_id,
      kind: 'biz_cert_review',
      title: msg.title,
      body: msg.body,
      url: msg.url,
      ref_id: certId,
      dedupe_key: `biz_cert_review:${certId}:${r.user_id}`,
    });
  }
  if (!rows.length) return 0;
  return (await insertOutbox(env, rows, 'biz_cert_review')) ? rows.length : 0;
}

/**
 * 본사가 승인 · 반려한 뒤 올린 사람에게 알림 한 줄 (업체 없이). 던지지 않는다.
 * @param {object} cert  바뀐 사업자등록증 행 (id · user_id · status: verified | rejected)
 */
export async function enqueueBizCertDecidedNotice(env, cert) {
  if (!cert || !UUID_RE.test(String(cert.id)) || !UUID_RE.test(String(cert.user_id))) return false;
  if (cert.status !== 'verified' && cert.status !== 'rejected') return false;
  const msg = bizCertDecidedMessage({ approved: cert.status === 'verified' });
  return insertOutbox(
    env,
    [
      {
        user_id: cert.user_id,
        company_id: null,
        kind: 'biz_cert_decided',
        title: msg.title,
        body: msg.body,
        url: msg.url,
        ref_id: cert.id,
        dedupe_key: `biz_cert_decided:${cert.id}:${cert.user_id}:${cert.status}`,
      },
    ],
    'biz_cert_decided'
  );
}
