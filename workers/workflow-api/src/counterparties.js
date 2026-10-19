/**
 * 거래처 · 공급처 — 경영 대시보드 2단계 (11 거래처 파레토 · 16 외주 성적표).
 *
 * 거래처(partner) = 우리에게 주문하는 인테리어 업체. 공급처(supplier) = 우리가 사는 곳.
 * 지금까지는 거래처를 금액으로 짐작하고 공급처는 원가 줄의 자유 입력(vendor_name)뿐이라
 * "어느 업체가 매출을 얼마 주나" · "어느 공급처가 약속을 지키나" 를 물을 수 없었다.
 * 장부용이라 **관리자만** 만들고 본다. 공개 파트너 디렉터리(partners)와는 따로 둔다.
 * 표는 database/management-phase2.sql 이 만든다.
 */
import { selectOne, selectMany, insertOne, updateById, ValidationError, NotFoundError, ConflictError, ForbiddenError } from './supabase.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';

export const COUNTERPARTY_KINDS = ['partner', 'supplier'];
export const KIND_LABEL = Object.freeze({ partner: '거래처', supplier: '공급처' });
export const SUPPLIER_CATEGORIES = ['door', 'cut_edge', 'countertop', 'board', 'hardware', 'install', 'other'];
export const SUPPLIER_CATEGORY_LABEL = Object.freeze({
  door: '도어', cut_edge: '재단 · 엣지', countertop: '상판', board: '원판', hardware: '철물', install: '시공', other: '기타',
});
export const NEED_SQL = '거래처 · 공급처 칸이 아직 DB 에 없습니다 — database/management-phase2.sql 을 실행해 주세요';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertAdmin(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('거래처 · 공급처는 관리자만 다룹니다');
}

/** 입력 검증 (순수). partial 이면 온 칸만 */
export function validateCounterparty(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.kind !== undefined) {
    if (!COUNTERPARTY_KINDS.includes(b.kind)) throw new ValidationError('kind 는 partner(거래처) 또는 supplier(공급처) 여야 합니다');
    out.kind = b.kind;
  }
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name || name.length > 100) throw new ValidationError('이름을 1~100자로 적어 주세요');
    out.name = name;
  }
  if (b.category !== undefined) {
    if (b.category !== null && b.category !== '' && !SUPPLIER_CATEGORIES.includes(b.category)) {
      throw new ValidationError(`갈래는 ${SUPPLIER_CATEGORIES.join(', ')} 중 하나여야 합니다`);
    }
    out.category = b.category || null;
  }
  if (b.phone !== undefined) out.phone = b.phone ? String(b.phone).trim().slice(0, 40) : null;
  if (b.memo !== undefined) out.memo = b.memo ? String(b.memo).trim().slice(0, 1000) : null;
  if (b.active !== undefined) out.active = Boolean(b.active);
  // 거래처에는 갈래가 없다
  if (out.kind === 'partner') out.category = null;
  return out;
}

/** 목록 — 표가 아직 없으면 { items: null } (화면이 SQL 안내) */
export async function listCounterparties(env, { user, kind }) {
  await assertAdmin(env, user);
  const q = { select: 'id,kind,name,category,phone,memo,active,created_at', order: 'name.asc', limit: '1000' };
  if (kind) {
    if (!COUNTERPARTY_KINDS.includes(kind)) throw new ValidationError('kind 는 partner 또는 supplier 입니다');
    q.kind = `eq.${kind}`;
  }
  try {
    return { items: (await selectMany(env, 'counterparties', q)) || [] };
  } catch (e) {
    if (isMissingRelation(e)) return { items: null };
    throw e;
  }
}

function mapWriteError(e) {
  if (isMissingRelation(e)) return new ValidationError(NEED_SQL);
  if (e instanceof ConflictError) return new ConflictError('같은 이름이 이미 있습니다');
  return e;
}

export async function createCounterparty(env, { user, body }) {
  await assertAdmin(env, user);
  const row = { ...validateCounterparty(body), created_by: user.id };
  try {
    return await insertOne(env, 'counterparties', row);
  } catch (e) {
    throw mapWriteError(e);
  }
}

export async function updateCounterparty(env, { user, id, body }) {
  await assertAdmin(env, user);
  if (!UUID_RE.test(String(id))) throw new NotFoundError('찾을 수 없습니다');
  const patch = validateCounterparty(body, { partial: true });
  delete patch.kind; // 거래처를 공급처로 바꾸지 않는다 — 새로 만든다
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  try {
    const row = await updateById(env, 'counterparties', id, patch);
    if (!row) throw new NotFoundError('찾을 수 없습니다');
    return row;
  } catch (e) {
    throw mapWriteError(e);
  }
}

/**
 * 수주 · 원가에 붙일 때 — 그 id 가 있고 종류가 맞는지 (null 은 떼기).
 * 표가 없으면 SQL 안내로 거절한다.
 */
export async function assertCounterparty(env, id, kind) {
  if (id === null) return null;
  if (!UUID_RE.test(String(id))) throw new ValidationError(`${KIND_LABEL[kind]}를 다시 골라 주세요`);
  let row;
  try {
    row = await selectOne(env, 'counterparties', { id: `eq.${id}`, select: 'id,kind,name' });
  } catch (e) {
    throw mapWriteError(e);
  }
  if (!row || row.kind !== kind) throw new ValidationError(`${KIND_LABEL[kind]}를 다시 골라 주세요`);
  return row;
}
