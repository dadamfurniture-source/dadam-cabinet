/**
 * 재작업 · A/S 기록 — 경영 대시보드 2단계 (14 품질비용 · A/S 율).
 *
 * rework = 공장 안에서 다시 자르고 만든 것, as = 설치 뒤 고치러 간 것.
 * 원인 · 분 · 비용 · 부재를 남기면 "어디서 다시 일하나" 와 "설치한 집 중 몇 집에 다시 가나" 가 보인다.
 * 표는 database/management-phase2.sql 이 만든다 — 실행 전이면 읽기는 null, 쓰기는 그 SQL 을 알려 준다.
 */
import { selectOne, selectMany, insertOne, restDelete, ValidationError, NotFoundError } from './supabase.js';
import { loadOwnedOrder } from './orders.js';
import { isMissingRelation } from './work-order-data.js';

export const REWORK_KINDS = ['rework', 'as'];
export const REWORK_KIND_LABEL = Object.freeze({ rework: '재작업', as: 'A/S' });
export const REWORK_CAUSES = ['measure', 'design', 'cutting', 'edge', 'assembly', 'install', 'material', 'outsource', 'customer', 'other'];
export const REWORK_CAUSE_LABEL = Object.freeze({
  measure: '실측', design: '설계', cutting: '재단', edge: '엣지', assembly: '조립',
  install: '설치', material: '자재 불량', outsource: '외주 불량', customer: '고객 변경', other: '기타',
});

const NEED_SQL = '재작업 · A/S 기록 칸이 아직 DB 에 없습니다 — database/management-phase2.sql 을 실행해 주세요';

/** 입력 검증 (순수) */
export function validateRework(body) {
  const b = body || {};
  if (!REWORK_KINDS.includes(b.kind)) throw new ValidationError(`kind 는 ${REWORK_KINDS.join(', ')} 중 하나여야 합니다`);
  if (!REWORK_CAUSES.includes(b.cause)) throw new ValidationError(`cause 는 ${REWORK_CAUSES.join(', ')} 중 하나여야 합니다`);
  const whole = (v, name) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${name} 는 0 이상의 정수여야 합니다`);
    return n;
  };
  const row = {
    kind: b.kind,
    cause: b.cause,
    minutes: whole(b.minutes, 'minutes'),
    cost: whole(b.cost, 'cost'),
    parts: b.parts ? String(b.parts).trim().slice(0, 300) : null,
    memo: b.memo ? String(b.memo).trim().slice(0, 1000) : null,
  };
  if (b.occurred_on) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.occurred_on)) || Number.isNaN(Date.parse(b.occurred_on))) {
      throw new ValidationError('occurred_on 이 올바르지 않습니다 (YYYY-MM-DD)');
    }
    row.occurred_on = String(b.occurred_on);
  }
  return row;
}

/** 수주 하나의 기록 — 표가 아직 없으면 null (화면이 SQL 안내를 띄운다) */
export async function listReworks(env, orderId) {
  try {
    return (await selectMany(env, 'rework_logs', { order_id: `eq.${orderId}`, select: '*', order: 'occurred_on.desc,created_at.desc', limit: '200' })) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

export async function addRework(env, { orderId, user, body }) {
  await loadOwnedOrder(env, orderId, user);
  const row = { ...validateRework(body), order_id: orderId, created_by: user.id };
  try {
    return await insertOne(env, 'rework_logs', row);
  } catch (e) {
    if (isMissingRelation(e)) throw new ValidationError(NEED_SQL);
    throw e;
  }
}

export async function deleteRework(env, { orderId, reworkId, user }) {
  await loadOwnedOrder(env, orderId, user);
  const row = await selectOne(env, 'rework_logs', { id: `eq.${reworkId}`, select: 'id,order_id' });
  if (!row || row.order_id !== orderId) throw new NotFoundError('기록을 찾을 수 없습니다');
  await restDelete(env, 'rework_logs', { id: `eq.${reworkId}` });
  return { id: reworkId, deleted: true };
}
