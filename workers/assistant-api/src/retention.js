/**
 * 대화 보관 — 처리방침의 「AI 비서 대화 90일」.
 *
 *   하루 한 번(wrangler [triggers] crons, src/worker.js scheduled) 대화를 시작한 지 RETAIN_DAYS 일이 지난 대화를 지운다.
 *   메시지(assistant_messages)는 대화에 ON DELETE CASCADE 로 함께 지워진다 (database/migrations/0026).
 *   시작한 날로 세므로 남은 대화의 어떤 메시지도 90일을 넘지 않는다 (메시지는 대화보다 늦게 생긴다).
 *   대화 객체(Durable Object)에 남는 사건 줄은 차례가 끝나고 하루 뒤 객체가 스스로 지운다 (src/session.js EVENT_TTL_MS) —
 *   객체에는 틀(시스템 글 · 도구 목록)과 번호만 남는다.
 *   예산 사용(assistant_usage) · 기록(assistant_audit)은 숫자만이라 그대로 둔다.
 *   계정을 지우면 대화는 auth.users FK CASCADE 로 그때 함께 지워진다.
 */
import { selectMany, deleteWhere } from './db.js';

export const RETAIN_DAYS = 90;
const BATCH = 200;
const MAX_BATCHES = 20;

/** → { deleted, cutoff } (던지지 않는다 — 다음 날 다시 돈다) */
export async function runRetention(env, { nowMs = Date.now() } = {}) {
  const cutoff = new Date(nowMs - RETAIN_DAYS * 86400 * 1000).toISOString();
  let deleted = 0;
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await selectMany(env, 'assistant_conversations', {
        created_at: `lt.${cutoff}`,
        select: 'id',
        order: 'created_at.asc',
        limit: String(BATCH),
      });
      if (!rows.length) break;
      await deleteWhere(env, 'assistant_conversations', {
        id: `in.(${rows.map((r) => r.id).join(',')})`,
      });
      deleted += rows.length;
      if (rows.length < BATCH) break;
    }
  } catch (e) {
    console.error('[assistant] retention failed:', e && e.status ? e.status : 'error');
  }
  if (deleted) console.log(`[assistant] retention deleted ${deleted} conversations`);
  return { deleted, cutoff };
}
