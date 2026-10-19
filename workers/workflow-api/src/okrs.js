/**
 * 분기 목표 — 경영 대시보드 3단계 (18 분기 OKR).
 *
 * 다섯 명 조직에 BSC 는 무겁다. 석 달에 셋 — 대시보드 숫자에 묶으면 저절로 진도가 난다.
 * 묶을 숫자가 없는 목표는 manual 로 두고 사장님이 지금 값을 적는다. 관리자만.
 * 표는 database/management-phase3.sql.
 */
import { selectOne, selectMany, insertOne, updateById, restDelete, ValidationError, NotFoundError, ForbiddenError, ConflictError } from './supabase.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';

/**
 * 묶을 수 있는 숫자. cumulative = 분기 동안 쌓이는 값(매출 · 순이익 · 수주) — 진도를 지난 날 비율과 견준다.
 * 나머지는 지금 값(비율).
 */
export const OKR_METRICS = Object.freeze({
  revenue_q: { label: '분기 매출 (VAT 제외)', unit: 'won', direction: 'up', cumulative: true },
  net_q: { label: '분기 순이익', unit: 'won', direction: 'up', cumulative: true },
  orders_q: { label: '분기 수주 건수', unit: 'count', direction: 'up', cumulative: true },
  cm_rate_q: { label: '분기 공헌이익률', unit: 'pct', direction: 'up' },
  conversion_q: { label: '분기 확인서 전환율', unit: 'pct', direction: 'up' },
  nps: { label: '소개 의향 NPS (반년)', unit: 'score', direction: 'up' },
  as_rate: { label: 'A/S 율 (반년)', unit: 'pct', direction: 'down' },
  on_time: { label: '설치 납기 준수 (반년)', unit: 'pct', direction: 'up' },
  manual: { label: '직접 적기', unit: 'number', direction: 'up' },
});
export const OKR_MAX_PER_QUARTER = 5;
export const NEED_SQL = '분기 목표 칸이 아직 DB 에 없습니다 — database/management-phase3.sql 을 실행해 주세요';
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'YYYY-MM' → 'YYYY-Qn' */
export function quarterOf(month) {
  const [y, m] = String(month).split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

/** 입력 검증 (순수). partial 이면 온 칸만 */
export function validateOkr(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.quarter !== undefined) {
    if (!QUARTER_RE.test(String(b.quarter || ''))) throw new ValidationError('분기는 YYYY-Q1 ~ Q4 로 적어 주세요');
    out.quarter = b.quarter;
  }
  if (!partial || b.objective !== undefined) {
    const o = String(b.objective || '').trim();
    if (!o || o.length > 200) throw new ValidationError('목표를 1~200자로 적어 주세요');
    out.objective = o;
  }
  if (!partial || b.metric !== undefined) {
    if (!(b.metric in OKR_METRICS)) throw new ValidationError(`metric 은 ${Object.keys(OKR_METRICS).join(', ')} 중 하나여야 합니다`);
    out.metric = b.metric;
    out.direction = OKR_METRICS[b.metric].direction;
  }
  if (b.direction !== undefined && out.metric === 'manual') {
    if (!['up', 'down'].includes(b.direction)) throw new ValidationError('direction 은 up 또는 down');
    out.direction = b.direction;
  }
  if (!partial || b.target !== undefined) {
    const t = Number(b.target);
    if (!Number.isFinite(t)) throw new ValidationError('목표 값을 숫자로 적어 주세요');
    out.target = t;
  }
  if (b.manual_value !== undefined) {
    if (b.manual_value === null || b.manual_value === '') out.manual_value = null;
    else {
      const v = Number(b.manual_value);
      if (!Number.isFinite(v)) throw new ValidationError('지금 값을 숫자로 적어 주세요');
      out.manual_value = v;
    }
  }
  if (b.sort !== undefined) out.sort = Math.max(0, Math.min(99, Math.round(Number(b.sort) || 0)));
  return out;
}

async function assertAdmin(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('분기 목표는 관리자만 다룹니다');
}

async function write(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissingRelation(e)) throw new ValidationError(NEED_SQL);
    throw e;
  }
}

export async function createOkr(env, { user, body }) {
  await assertAdmin(env, user);
  const row = validateOkr(body);
  const existing = await write(() => selectMany(env, 'okrs', { quarter: `eq.${row.quarter}`, select: 'id', limit: '20' }));
  if ((existing || []).length >= OKR_MAX_PER_QUARTER) throw new ConflictError(`한 분기에 목표는 ${OKR_MAX_PER_QUARTER}개까지 — 셋이 가장 좋습니다`);
  return write(() => insertOne(env, 'okrs', { ...row, sort: row.sort ?? (existing || []).length, created_by: user.id }));
}

export async function updateOkr(env, { user, id, body }) {
  await assertAdmin(env, user);
  if (!UUID_RE.test(String(id))) throw new NotFoundError('목표를 찾을 수 없습니다');
  const patch = validateOkr(body, { partial: true });
  delete patch.quarter; // 다른 분기로 옮기지 않는다 — 새로 만든다
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  const row = await write(() => updateById(env, 'okrs', id, patch));
  if (!row) throw new NotFoundError('목표를 찾을 수 없습니다');
  return row;
}

export async function deleteOkr(env, { user, id }) {
  await assertAdmin(env, user);
  if (!UUID_RE.test(String(id))) throw new NotFoundError('목표를 찾을 수 없습니다');
  const row = await write(() => selectOne(env, 'okrs', { id: `eq.${id}`, select: 'id' }));
  if (!row) throw new NotFoundError('목표를 찾을 수 없습니다');
  await restDelete(env, 'okrs', { id: `eq.${id}` });
  return { deleted: id };
}
