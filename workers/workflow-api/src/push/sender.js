/**
 * 앱 알림 보내기 — 1분마다 (wrangler.toml [triggers] crons 의 PUSH_SEND_CRON).
 *
 * 한 번 돌 때:
 *   1. claim_notifications(50) 으로 보낼 줄을 잡는다 (attempts + 1, 5분 지나면 다시, 5번까지 — DB 함수)
 *   2. 줄마다 보낼 때 다시 본다 — 받는 사람이 아직 그 업체의 active 구성원이고 업체가 active 인가.
 *      결제 실패 · 업체 정지(billing_failed · company_suspended)는 업체가 정지됐어도 active 대표에게 간다.
 *      업체 없는 업체 신청(partner_application, company_id 없음)은 그 사람의 업체 없는 기기로 간다.
 *   3. 그 사람의 그 업체 기기 (업체 없는 신청이면 업체 없는 기기) 모두에 보낸다.
 *        404 · 410 · 쓸 수 없는 키 → 그 기기 등록을 지운다
 *        하나라도 받으면 → sent (sent_at)
 *        받을 기기가 없거나 받을 사람이 아니면 → skipped
 *        모두 실패 → queued 그대로 (5분 뒤 다시 잡힌다). 5번째에도 실패면 failed (짧은 last_error — 주소 없음)
 *      기기 등록의 last_sent_at · fail_count 를 고친다.
 * 하루 한 번(PUSH_CLEANUP_UTC — 이 cron 의 그 1분): 끝난 줄(sent · skipped · failed) 중 30일 지난 것을 지우고,
 *   5번 다 잡히고 1시간 넘게 멈춘 줄을 failed 로 닫는다.
 *
 * VAPID 설정이 없거나 틀리면 잡지 않는다 (줄은 queued 그대로).
 * 로그 · last_error 에 받는 주소 · 키 · 알림 글 · 받는 사람을 싣지 않는다 — 건수와 짧은 이름만.
 */

import { callRpc, selectMany, updateBy } from '../supabase.js';
import { loadVapid, sendWebPush, PushError } from './webpush.js';

export const PUSH_SEND_CRON = '* * * * *';
/** 한 번에 잡는 줄 수 */
export const CLAIM_LIMIT = 50;
/** DB claim_notifications 의 최대 시도 횟수와 같다 */
export const MAX_ATTEMPTS = 5;
/** 동시에 보내는 줄 수 */
const CONCURRENCY = 6;
/** 이 종류는 업체가 정지돼도 대표에게 간다 */
export const OWNER_KINDS = Object.freeze(['billing_failed', 'company_suspended']);
/** 끝난 줄을 남겨 두는 기간 */
export const RETAIN_DAYS = 30;
/** 하루 한 번 정리하는 시각 (UTC 18:17 = KST 03:17) */
export const PUSH_CLEANUP_UTC = Object.freeze({ hour: 18, minute: 17 });
/** in.(…) 한 번에 싣는 id 수 */
const ID_CHUNK = 100;
const LAST_ERROR_MAX = 300;

const iso = (ms) => new Date(ms).toISOString();
const chunks = (list, size = ID_CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** 알림을 받을 사람인가 — 보낼 때 다시 본다 */
export function isEligible(row, memberships) {
  if (row.kind === 'partner_application' && !row.company_id) return true;
  const m = memberships.find((x) => x.user_id === row.user_id && x.company_id === row.company_id);
  if (!m) return false;
  const status = m.company && m.company.status;
  if (OWNER_KINDS.includes(row.kind)) return m.role === 'owner' && (status === 'active' || status === 'suspended');
  return status === 'active';
}

/** 그 줄을 받을 기기 — 같은 사람 · 같은 업체 (업체 없는 신청이면 업체 없는 기기) */
export function targetsFor(row, subs) {
  const company = row.company_id || null;
  return subs.filter((s) => s.user_id === row.user_id && (s.company_id || null) === company);
}

/** 기기로 보내는 글 — 저장된 글 그대로 + 묶음 표시(tag) */
export function payloadOf(row) {
  return { title: row.title, body: row.body, url: row.url, tag: `${row.kind}:${row.ref_id || row.id}` };
}

/** 보낸 결과 → ok | gone | fail */
export function classify(result) {
  const s = result && result.status;
  if (s >= 200 && s < 300) return 'ok';
  if (s === 404 || s === 410) return 'gone';
  if (!s && (result.error === 'bad_key' || result.error === 'endpoint')) return 'gone';
  return 'fail';
}

/** 짧은 실패 이름 — 'push 503' · 'network' · 'timeout' */
function errorName(result) {
  if (result && result.status) return `push ${result.status}`;
  return (result && result.error) || 'error';
}

/** 잡은 줄의 받는 사람들 — 구성원(업체 상태 포함) · 기기 */
async function loadRecipients(env, rows) {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const memberships = [];
  const subs = [];
  for (const part of chunks(userIds)) {
    const inList = `in.(${part.join(',')})`;
    const [m, s] = await Promise.all([
      selectMany(env, 'company_members', {
        user_id: inList,
        status: 'eq.active',
        select: 'user_id,company_id,role,company:companies(status)',
      }),
      selectMany(env, 'push_subscriptions', {
        user_id: inList,
        select: 'id,user_id,company_id,endpoint,p256dh,auth,fail_count',
      }),
    ]);
    memberships.push(...(m || []));
    subs.push(...(s || []));
  }
  return { memberships, subs };
}

/** 줄 닫기 — 아직 queued 일 때만 (그사이 정리 트리거가 지웠으면 0행) */
function finishRow(env, row, patch) {
  return updateBy(env, 'notification_outbox', { id: `eq.${row.id}`, state: 'eq.queued' }, patch);
}

/** 기기 하나에 보내고 등록을 고친다 → ok | gone | fail (+ error) */
async function sendToSub(env, ctx, sub, message) {
  let result;
  try {
    result = await sendWebPush(ctx.vapid, sub, message, { nowMs: ctx.nowMs, jwtCache: ctx.jwtCache });
  } catch (e) {
    result = { status: 0, error: e instanceof PushError ? e.code : 'error' };
  }
  const outcome = classify(result);
  try {
    if (outcome === 'ok') {
      sub.fail_count = 0;
      await updateBy(env, 'push_subscriptions', { id: `eq.${sub.id}` }, { last_sent_at: iso(ctx.nowMs), fail_count: 0 });
    } else if (outcome === 'gone') {
      sub.gone = true;
      await ctx.deleteSub(sub.id);
    } else {
      sub.fail_count = (sub.fail_count || 0) + 1;
      await updateBy(env, 'push_subscriptions', { id: `eq.${sub.id}` }, { fail_count: sub.fail_count });
    }
  } catch (e) {
    console.warn('[push] subscription update failed:', e && e.statusCode ? e.statusCode : 'error');
  }
  return { outcome, error: outcome === 'fail' ? errorName(result) : null };
}

/** 한 줄 보내기 → sent | skipped | retry | failed */
async function processRow(env, ctx, row) {
  if (!isEligible(row, ctx.memberships)) {
    await finishRow(env, row, { state: 'skipped', last_error: 'ineligible' });
    return 'skipped';
  }
  const targets = targetsFor(row, ctx.subs).filter((s) => !s.gone);
  if (!targets.length) {
    await finishRow(env, row, { state: 'skipped', last_error: 'no_subscription' });
    return 'skipped';
  }
  const message = payloadOf(row);
  const results = await Promise.all(targets.map((sub) => sendToSub(env, ctx, sub, message)));
  if (results.some((r) => r.outcome === 'ok')) {
    await finishRow(env, row, { state: 'sent', sent_at: iso(ctx.nowMs), last_error: null });
    return 'sent';
  }
  const errors = [...new Set(results.filter((r) => r.outcome === 'fail').map((r) => r.error))];
  if (!errors.length) {
    // 모든 기기가 없어졌다 (404 · 410)
    await finishRow(env, row, { state: 'skipped', last_error: 'gone' });
    return 'skipped';
  }
  const lastError = errors.join(',').slice(0, LAST_ERROR_MAX);
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    await finishRow(env, row, { state: 'failed', last_error: lastError });
    return 'failed';
  }
  // queued 그대로 — claimed_at 에서 5분 뒤 다시 잡힌다
  await finishRow(env, row, { last_error: lastError });
  return 'retry';
}

/** 정해진 수만큼 동시에 */
async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 1분 cron 한 번. 돌려주는 값은 건수 요약.
 * @returns {Promise<{claimed:number, sent:number, skipped:number, retry:number, failed:number, gone:number, errors:number, error?:string}>}
 */
export async function runPushSender(env, { nowMs = Date.now(), limit = CLAIM_LIMIT } = {}) {
  const summary = { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, gone: 0, errors: 0 };
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ...summary, error: 'not_configured' };
  let vapid;
  try {
    vapid = await loadVapid(env);
  } catch (e) {
    // 설정이 없으면 잡지 않는다 — 줄은 queued 그대로 남는다
    console.warn('[push] vapid not configured:', e instanceof PushError ? e.code : 'error');
    return { ...summary, error: 'not_configured' };
  }

  let rows;
  try {
    rows = (await callRpc(env, 'claim_notifications', { p_limit: limit })) || [];
  } catch (e) {
    console.error('[push] claim failed:', e && e.statusCode ? e.statusCode : 'error');
    return { ...summary, error: 'claim_failed' };
  }
  if (!Array.isArray(rows) || !rows.length) return summary;
  summary.claimed = rows.length;

  let recipients;
  try {
    recipients = await loadRecipients(env, rows);
  } catch (e) {
    // 받는 사람을 못 읽었다 — 줄은 queued 그대로 (5분 뒤 다시)
    console.error('[push] recipients failed:', e && e.statusCode ? e.statusCode : 'error');
    return { ...summary, error: 'recipients_failed' };
  }

  const deleted = new Set();
  const ctx = {
    vapid,
    nowMs,
    jwtCache: new Map(),
    ...recipients,
    async deleteSub(id) {
      if (deleted.has(id)) return;
      deleted.add(id);
      summary.gone += 1;
      await deleteSubscription(env, id);
    },
  };

  await pool(rows, CONCURRENCY, async (row) => {
    try {
      summary[await processRow(env, ctx, row)] += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('[push] row failed:', e && e.statusCode ? e.statusCode : 'error');
    }
  });
  console.log('[push] sender', JSON.stringify(summary));
  return summary;
}

/** 기기 등록 한 줄 지우기 */
async function deleteSubscription(env, id) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
  });
  if (!res.ok) throw Object.assign(new Error('delete subscription'), { statusCode: res.status });
}

/** 이 cron 시각이 하루 한 번 정리하는 1분인가 */
export function isPushCleanupTime(scheduledTime) {
  const t = new Date(typeof scheduledTime === 'number' ? scheduledTime : Date.now());
  return t.getUTCHours() === PUSH_CLEANUP_UTC.hour && t.getUTCMinutes() === PUSH_CLEANUP_UTC.minute;
}

/**
 * 하루 한 번 — 끝난 줄(sent · skipped · failed) 중 30일 지난 것 지우기,
 * 5번 다 잡히고 1시간 넘게 멈춘 queued 줄은 failed 로 닫기 (DB 함수가 더는 잡지 않는다).
 */
export async function runPushCleanup(env, { nowMs = Date.now() } = {}) {
  const cutoff = iso(nowMs - RETAIN_DAYS * 86_400_000);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notification_outbox?state=in.(sent,skipped,failed)&created_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
    },
  );
  if (!res.ok) throw Object.assign(new Error('push cleanup'), { statusCode: res.status });
  const stuck =
    (await updateBy(
      env,
      'notification_outbox',
      { state: 'eq.queued', attempts: `gte.${MAX_ATTEMPTS}`, claimed_at: `lt.${iso(nowMs - 3_600_000)}` },
      { state: 'failed', last_error: 'stuck' },
    )) || [];
  console.log('[push] cleanup', JSON.stringify({ stuck: stuck.length }));
  return { stuck: stuck.length };
}
