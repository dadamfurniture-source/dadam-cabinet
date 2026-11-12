/**
 * 장부 앱 알림 넣기 (notification_outbox 종류 ledger_pending · ledger_returned — database/migrations/0030).
 *
 *   ledger_pending   매분 cron (runLedgerPendingNotices) — 최근 PENDING_WINDOW_SEC 안에 사진 읽기 시도가 끝난
 *                    (ledger_extractions.finished_at, 어떤 결과든) 업체마다, 확인 기다리는 사진이 있으면 그 수를
 *                    active 대표 · 실장에게. 한 사람에게 한국 시간 한 시간에 한 번 — 한꺼번에 여러 장을 올려도 알림은 하나
 *                    (dedupe_key = ledger_pending:업체:사람:YYYYMMDDHH). 한 번에 PENDING_COMPANY_MAX 업체까지
 *   ledger_returned  사진을 돌려보내면 (review.js decideDocument) — 올린 사람에게. 아직 그 업체 active 구성원이고
 *                    돌려보낸 사람 자신이 아니면. 사진마다 한 번 (dedupe_key = ledger_returned:사진:사람)
 * 글은 src/push/messages.js — 사진 수만 (금액 · 상호 · 메모 · 이유 없음). 받을 사람인지는 보낼 때 다시 본다 (sender.js).
 * 넣기는 원래 일을 막지 않는다 — 던지지 않고, 로그에는 상태 코드만 남긴다.
 * 0030 을 적용하기 전에는 넣기가 DB 검사로 거절된다 — outbox.js 가 경고만 남기고 넘긴다.
 */

import { selectMany, MONEY_ROLES } from '../supabase.js';
import { buildMessage } from './messages.js';
import { notifyRoles, isUuid } from './outbox.js';

/** 이 초 안에 읽기가 끝난 사진이 있는 업체에 알린다 (매분 cron — 한두 번 놓쳐도 다음 차례에 잡히게) */
export const PENDING_WINDOW_SEC = 180;
/** 한 번에 보는 업체 수 */
export const PENDING_COMPANY_MAX = 20;
/** 확인 기다리는 사진을 셀 때 읽는 최대 줄 수 (넘으면 「N장 넘게」 — messages.js LEDGER_PENDING_MAX) */
const PENDING_COUNT_LIMIT = 1000;

const statusOf = (e) => (e && (e.statusCode || e.status)) || 'error';
let warnedRead = false;

/** 한국 시간 'YYYYMMDDHH' — 한 시간에 한 번 */
export function kstHour(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 13)
    .replace(/[^0-9]/g, '');
}

/**
 * 매분 cron — 읽기가 막 끝난 업체의 대표 · 실장에게 확인할 사진 수. 던지지 않는다.
 * @returns {Promise<{ companies: number, notified: number, skipped?: string }>}
 */
export async function runLedgerPendingNotices(env, { nowMs = Date.now() } = {}) {
  let finished;
  try {
    finished =
      (await selectMany(env, 'ledger_extractions', {
        finished_at: `gte.${new Date(nowMs - PENDING_WINDOW_SEC * 1000).toISOString()}`,
        select: 'company_id',
        order: 'finished_at.desc',
        limit: '500',
      })) || [];
  } catch (e) {
    if (!warnedRead) {
      console.warn('[push] ledger_pending read failed:', statusOf(e));
      warnedRead = true;
    }
    return { companies: 0, notified: 0, skipped: 'read_failed' };
  }
  const companies = [...new Set(finished.map((r) => r && r.company_id).filter(isUuid))].slice(
    0,
    PENDING_COMPANY_MAX
  );
  let notified = 0;
  for (const companyId of companies) {
    try {
      const pending =
        (await selectMany(env, 'ledger_documents', {
          company_id: `eq.${companyId}`,
          review_status: 'eq.pending',
          select: 'id',
          limit: String(PENDING_COUNT_LIMIT),
        })) || [];
      if (!pending.length) continue;
      const message = buildMessage('ledger_pending', { count: pending.length });
      if (!message) continue;
      notified += await notifyRoles(env, {
        companyId,
        roles: MONEY_ROLES,
        kind: 'ledger_pending',
        ...message,
        refId: companyId,
        dedupeSuffix: kstHour(nowMs),
      });
    } catch (e) {
      console.warn('[push] ledger_pending failed:', statusOf(e));
    }
  }
  return { companies: companies.length, notified };
}

/**
 * 돌려보낸 사진 — 올린 사람에게. 던지지 않는다.
 * @param {object} document  돌려보낸 ledger_documents 한 줄 (id · company_id · uploaded_by)
 * @param {string} actorId   돌려보낸 사람
 * @returns {Promise<number>} 넣으려고 보낸 줄 수
 */
export async function notifyLedgerReturned(env, { document, actorId }) {
  try {
    if (!document || !isUuid(document.id) || !isUuid(document.company_id)) return 0;
    if (!isUuid(document.uploaded_by) || document.uploaded_by === actorId) return 0;
    const message = buildMessage('ledger_returned');
    if (!message) return 0;
    return await notifyRoles(env, {
      companyId: document.company_id,
      roles: [],
      userIds: [document.uploaded_by],
      excludeUserIds: isUuid(actorId) ? [actorId] : [],
      kind: 'ledger_returned',
      ...message,
      refId: document.id,
    });
  } catch (e) {
    console.warn('[push] ledger_returned failed:', statusOf(e));
    return 0;
  }
}
