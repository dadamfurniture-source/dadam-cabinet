/**
 * 설치 후 한 문항 — 경영 대시보드 2단계 (12 만족도 · 소개율).
 *
 * 동네 가구는 소개가 영업이다. 설치가 끝나면 고객에게 링크 하나를 보낸다:
 *   "지인에게 다담가구를 소개하시겠어요?" 0~10 + 한 줄.
 * 링크는 확인서 공유 링크와 같은 방식이다 — 토큰은 URL fragment(#t=)로, DB 에는 해시만.
 * 수주 하나에 하나. 답을 받기 전에는 다시 만들 수 있고(옛 링크는 죽는다), 받은 뒤에는 막는다.
 * 표는 database/management-phase2.sql 이 만든다.
 */
import { selectOne, insertOne, updateById, updateBy, ValidationError, NotFoundError, ConflictError, GoneError } from './supabase.js';
import { loadOwnedOrder } from './orders.js';
import { generateShareToken } from './share.js';
import { pepperedHash } from './util/hash.js';
import { isMissingRelation } from './work-order-data.js';

export const FEEDBACK_TTL_DAYS = 30;
export const FEEDBACK_QUESTION = '지인에게 다담가구를 소개하시겠어요?';
const NEED_SQL = '설치 후 문항 칸이 아직 DB 에 없습니다 — database/management-phase2.sql 을 실행해 주세요';

export function hashFeedbackToken(env, token) {
  return pepperedHash(env.SHARE_TOKEN_PEPPER, 'feedback', token);
}

export function buildFeedbackUrl(env, token) {
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/feedback.html#t=${token}`;
}

/** 수주 화면에 보일 상태 (순수). 행이 없으면 아직 링크를 안 만든 것 */
export function feedbackStatus(row, now = Date.now()) {
  if (!row) return { exists: false };
  return {
    exists: true,
    answered: Boolean(row.answered_at),
    score: row.score ?? null,
    comment: row.comment ?? null,
    answered_at: row.answered_at || null,
    expires_at: row.expires_at,
    expired: !row.answered_at && Date.parse(row.expires_at) < now,
  };
}

/** 답 검증 (순수) — 0~10 정수 하나, 한 줄은 1,000자까지 */
export function validateAnswer(body) {
  const score = Number(body && body.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new ValidationError('0부터 10까지 하나를 골라 주세요');
  const comment = body && body.comment ? String(body.comment).trim().slice(0, 1000) : null;
  return { score, comment: comment || null };
}

/** 수주 상세용 — 표가 아직 없으면 null */
export async function getFeedback(env, orderId) {
  try {
    const row = await selectOne(env, 'install_feedback', { order_id: `eq.${orderId}`, select: 'score,comment,answered_at,expires_at,created_at' });
    return feedbackStatus(row);
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 링크 만들기 — 평문 토큰은 이 응답에서 한 번만 나간다 */
export async function createFeedbackLink(env, { orderId, user }) {
  await loadOwnedOrder(env, orderId, user);
  let existing;
  try {
    existing = await selectOne(env, 'install_feedback', { order_id: `eq.${orderId}`, select: 'id,answered_at' });
  } catch (e) {
    if (isMissingRelation(e)) throw new ValidationError(NEED_SQL);
    throw e;
  }
  if (existing && existing.answered_at) throw new ConflictError('이미 답을 받았습니다');
  const token = generateShareToken();
  const expires = new Date(Date.now() + FEEDBACK_TTL_DAYS * 86400000).toISOString();
  const patch = { token_hash: await hashFeedbackToken(env, token), expires_at: expires };
  if (existing) await updateById(env, 'install_feedback', existing.id, patch);
  else await insertOne(env, 'install_feedback', { ...patch, order_id: orderId, created_by: user.id });
  return { url: buildFeedbackUrl(env, token), expires_at: expires };
}

async function openRow(env, token) {
  if (!token) throw new ValidationError('링크가 올바르지 않습니다');
  const row = await selectOne(env, 'install_feedback', { token_hash: `eq.${await hashFeedbackToken(env, token)}`, select: 'id,score,answered_at,expires_at' });
  if (!row) throw new NotFoundError('더 이상 쓸 수 없는 링크입니다');
  return row;
}

/** 고객이 링크를 열 때 — 이름 · 주문 내용은 싣지 않는다 */
export async function openFeedback(env, { token }) {
  const row = await openRow(env, token);
  if (row.answered_at) return { question: FEEDBACK_QUESTION, answered: true, score: row.score };
  if (Date.parse(row.expires_at) < Date.now()) throw new GoneError('링크 기간이 지났습니다');
  return { question: FEEDBACK_QUESTION, answered: false };
}

export async function answerFeedback(env, { token, body }) {
  const answer = validateAnswer(body);
  const row = await openRow(env, token);
  if (row.answered_at) throw new ConflictError('이미 답해 주셨습니다. 고맙습니다');
  if (Date.parse(row.expires_at) < Date.now()) throw new GoneError('링크 기간이 지났습니다');
  // 두 번 눌러도 한 번만 — 아직 답이 없는 행에만 쓴다
  const updated = await updateBy(env, 'install_feedback', { id: `eq.${row.id}`, answered_at: 'is.null' }, { ...answer, answered_at: new Date().toISOString() });
  if (!updated || !updated.length) throw new ConflictError('이미 답해 주셨습니다. 고맙습니다');
  return { answered: true, score: answer.score };
}
