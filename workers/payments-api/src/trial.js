/**
 * 사업자등록증 등록 시 첫 달 무료 (2026-11-21 대표님 계획 승인, DB 0077).
 *
 * 대표님이 고른 것: 새로 시작하는 업체 · 모든 등급 / 카드를 먼저 받고 30일 뒤 자동 결제 /
 *                   자동 확인, 의심 건만 본사 검토 / 사업자번호당 1회 · 계속사업자만.
 *
 * 이 워커가 맡는 것은 「무료로 시작하기」뿐이다 — 사업자등록증을 받고 확인하는 일은 account-api 가 한다.
 *   - 화면이 POST /issue-billing-key 에 trial: true 를 실어 보낸 때만 본다. 싣지 않으면 지금처럼 바로 결제한다.
 *   - 받을 수 있는가는 카드를 등록하기 전에(빌링키를 받기 전에) 가린다 — 못 받는데 0원으로 시작됐다고 알거나,
 *     무료인 줄 알았는데 결제되는 일이 없게. 확인하지 못하면(DB 오류) 결제하지 않고 그 자리에서 멈춘다.
 *   - 받을 수 있으면 첫 결제를 건너뛰고 구독을 trialing 으로 만든다. 빌링키는 그대로 받아 둔다.
 *     next_charge_at = 지금 + 30일 — 그날 cron 이 첫 결제를 한다 (lifecycle.js, 결제 · 실패 재시도는 지금 규칙 그대로).
 *   - 사업자번호당 1회는 DB 가 지킨다: trial_grants.biz_no 유니크. 여기서 미리 보는 것은 안내용이다.
 *
 * 받을 수 있는 조건 (모두):
 *   1. 그 사람에게 확인된(verified) 사업자등록증이 있다 (business_certificates — account-api 가 verified 로 바꾼다)
 *   2. 그 번호로 무료를 준 적이 없다 (trial_grants)
 *   3. 새로 시작하는 업체다 — 새로 만드는 업체이거나, 구독을 한 번도 가진 적 없는 업체(관리자가 만들어 둔 업체).
 *      해지 · 정지된 업체를 다시 시작하는 것은 새 업체가 아니다.
 */

import { selectOne } from './supabase.js';

/** 무료 기간 (일) — 구독 기간(lifecycle.js PERIOD_DAYS)과 같다 */
export const TRIAL_DAYS = 30;

const BIZ_NO_RE = /^[0-9]{10}$/;

function refuse(status, code, message) {
  return { refuse: { status, body: { success: false, code, message } } };
}

/**
 * 무료로 시작할 수 있는가 — 빌링키를 받기 전에 부른다.
 * @param target resolveCompanyForPayment 의 결과 ({ create } 또는 { company, planChange? })
 * @returns { refuse } | { cert: { id, biz_no, representative_name } }
 */
export async function resolveTrial(env, user, target) {
  try {
    if (target.company) {
      // 기존 업체 — 구독을 한 번이라도 가졌으면 새 업체가 아니다 (다시 시작 · 등급 바꿔 다시 시작)
      const had = await selectOne(env, 'subscriptions', {
        company_id: `eq.${target.company.id}`,
        select: 'id',
      });
      if (had || target.planChange) {
        return refuse(
          409,
          'trial_not_new',
          '첫 달 무료는 새로 시작하는 팩토리만 받을 수 있습니다.'
        );
      }
    }
    const cert = await selectOne(env, 'business_certificates', {
      user_id: `eq.${user.id}`,
      status: 'eq.verified',
      select: 'id,biz_no,representative_name',
      order: 'created_at.desc',
    });
    if (!cert || !BIZ_NO_RE.test(String(cert.biz_no || ''))) {
      return refuse(409, 'trial_no_cert', '확인된 사업자등록증이 없습니다.');
    }
    const used = await selectOne(env, 'trial_grants', {
      biz_no: `eq.${cert.biz_no}`,
      select: 'id',
    });
    if (used) {
      return refuse(409, 'trial_used', '이 사업자등록번호는 이미 첫 달 무료를 받았습니다.');
    }
    return { cert };
  } catch (e) {
    // 표가 아직 없거나(0077 적용 전) DB 가 답하지 않는다 — 결제하지 않고 멈춘다
    console.error('[payments] trial check failed:', e && e.statusCode ? e.statusCode : '-');
    return refuse(
      503,
      'trial_unavailable',
      '첫 달 무료를 지금 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'
    );
  }
}

/** 같은 번호가 그 사이 무료를 받았다 (trial_grants.biz_no 유니크 — PostgREST 409) */
export function isTrialTaken(err) {
  return !!err && err.statusCode === 409;
}
