/**
 * 작업자 포털 — 사장님 Slack 알림 (docs/01-plan/worker-portal-contract.md §3 공통).
 *
 * 보내는 일: 작업자 가입 신청, 작업 신청 · 철회, 배정 거절 · 포기, 완료 보고, 문제 보고.
 * 문구에는 작업 종류 · 제목 · 작업자 표시 이름 · 관리자 화면 링크만 — 고객 이름 · 주소 · 연락처 · 금액 · 보고 본문은 넣지 않는다.
 * 본사 Slack 이므로 작업에 걸린 알림은 본사 작업(work_jobs.company_id = 본사)일 때만 보낸다 — 작업 업체를 모르면 보내지 않는다.
 * 작업이 없는 알림(작업자 가입 신청)은 그대로 보낸다.
 * 전송 실패(시크릿 없음 포함)는 요청을 막지 않는다 — 경고만 남긴다.
 */

import { postToWebhook } from '../slack.js';
import { hqCompanyId } from '../supabase.js';
import { KIND_LABEL } from './validate.js';

export const NOTIFY_LABEL = Object.freeze({
  worker_registered: '작업자 가입 신청',
  application_created: '작업 신청',
  application_withdrawn: '신청 철회',
  assignment_declined: '배정 거절',
  assignment_released: '배정 포기',
  result_submitted: '완료 보고',
  issue_reported: '문제 보고',
});

/** Slack 이 링크로 해석하지 않도록 최소한만 (slack.js 와 같은 규칙) */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 관리자 화면 링크 — 작업이면 그 작업, 아니면 작업자 탭 */
export function adminLink(env, job) {
  const base = String((env && env.PUBLIC_BASE_URL) || '').replace(/\/+$/, '');
  return job ? `${base}/admin/work-jobs.html?job=${encodeURIComponent(job.id)}` : `${base}/admin/work-jobs.html?tab=workers`;
}

/**
 * 메시지 (순수). job 은 { id, kind, title } 만 읽는다 — 다른 칸(금액 · 주문)은 넘겨도 쓰지 않는다.
 * @returns {{ text, blocks }}
 */
export function buildWorkSlack(type, { job = null, workerName = null, link = '' } = {}) {
  const parts = [NOTIFY_LABEL[type] || type];
  if (job) parts.push(`${KIND_LABEL[job.kind] || job.kind} · ${String(job.title || '').slice(0, 80)}`);
  if (workerName) parts.push(String(workerName).slice(0, 30));
  const text = `[작업자 포털] ${parts.map(esc).join(' — ')}`;
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text } }];
  if (link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '관리자 화면 열기' }, url: link }] });
  return { text, blocks };
}

/** 본사 Slack 으로 보낼 작업인가 — 작업이 없으면(가입 신청) 보낸다, 있으면 그 작업이 본사 것일 때만 */
export async function isHqSlackJob(env, job) {
  if (!job) return true;
  return Boolean(job.company_id) && job.company_id === (await hqCompanyId(env));
}

/** 보내기 — 절대 던지지 않는다. ctx.waitUntil 이 있으면 응답을 기다리게 하지 않는다. 협력업체 작업이면 보내지 않는다 */
export function notifyWork(env, ctx, type, { job = null, workerName = null } = {}) {
  const payload = buildWorkSlack(type, { job, workerName, link: adminLink(env, job) });
  const p = Promise.resolve()
    .then(async () => ((await isHqSlackJob(env, job)) ? postToWebhook(env, payload) : null))
    .then((r) => {
      if (r && !r.ok && r.attempts > 0) console.warn(`[work] Slack 실패 (${type}):`, r.error);
    })
    .catch((e) => console.warn(`[work] Slack 실패 (${type}):`, e && e.message));
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(p);
    return null;
  }
  return p;
}
