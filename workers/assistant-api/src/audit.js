/**
 * 기록 — assistant_audit 에 덧붙이기만 (database/migrations/0026).
 *   kind  turn · tool · blocked · error · setting
 *   detail 에는 숫자 · 이름 · 상태만 — 대화 글 · 이름 · 연락처 · 주소를 넣지 않는다.
 * 기록이 실패해도 차례는 그대로 간다 (던지지 않는다).
 */
import { insertOne } from './db.js';

export async function audit(env, { companyId, userId, conversationId, kind, name, detail }) {
  try {
    await insertOne(env, 'assistant_audit', {
      company_id: companyId,
      user_id: userId || null,
      conversation_id: conversationId || null,
      kind,
      name: name ? String(name).slice(0, 80) : null,
      detail: detail && typeof detail === 'object' ? detail : {},
    });
  } catch (e) {
    console.error('[assistant] audit failed:', e && e.message);
  }
}
