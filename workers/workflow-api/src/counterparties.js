/**
 * 거래처 · 공급처 — 경영 대시보드 2단계 (11 거래처 파레토 · 16 외주 성적표).
 *
 * 거래처(partner) = 우리에게 주문하는 인테리어 업체. 공급처(supplier) = 우리가 사는 곳.
 * 지금까지는 거래처를 금액으로 짐작하고 공급처는 원가 줄의 자유 입력(vendor_name)뿐이라
 * "어느 업체가 매출을 얼마 주나" · "어느 공급처가 약속을 지키나" 를 물을 수 없었다.
 * 장부용이라 업체마다 따로 둔다 (company_id — database/migrations/0015_partner_books.sql).
 *   그 업체의 대표 · 실장이 자기 업체 목록을 보고 만들고 고친다. 본사 목록은 관리자도 (예전 그대로).
 *   이름 겹침은 업체 안에서만 본다 (uq_counterparties_name — 업체 · 종류 · 이름).
 * 공개 파트너 디렉터리(partners)와는 따로 둔다. 표는 database/management-phase2.sql 이 만든다.
 */
import {
  selectOne,
  selectMany,
  insertOne,
  updateBy,
  activeMemberships,
  hqCompanyId,
  MONEY_ROLES,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from './supabase.js';
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

/**
 * 호출자가 다루는 거래처 · 공급처 목록의 업체.
 *   active 대표 · 실장인 업체 → 그 업체 (본사 대표 · 실장은 본사)
 *   그 밖에 관리자 → 본사
 * 아니면 403.
 */
export async function counterpartyCompanyOf(env, user) {
  const m = (await activeMemberships(env, user)).find((x) => MONEY_ROLES.includes(x.role));
  if (m) return m.company_id;
  if (await isAdmin(env, user)) return hqCompanyId(env);
  throw new ForbiddenError('거래처 · 공급처는 업체 대표 · 실장 · 관리자만 다룹니다');
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

/** 목록 — 내 업체 것만. 표가 아직 없으면 { items: null } (화면이 SQL 안내) */
export async function listCounterparties(env, { user, kind }) {
  const companyId = await counterpartyCompanyOf(env, user);
  const q = { select: 'id,kind,name,category,phone,memo,active,created_at', company_id: `eq.${companyId}`, order: 'name.asc', limit: '1000' };
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

/**
 * 쓰기 오류 → 화면 문구. 이름 겹침(23505)은 업체 안 색인(업체 · 종류 · 이름)에서만 나므로
 * 「같은 이름이 이미 있습니다」는 내 업체 목록 이야기다 — DB 원문(다른 줄의 값)은 싣지 않는다.
 */
function mapWriteError(e) {
  if (isMissingRelation(e)) return new ValidationError(NEED_SQL);
  if (e instanceof ConflictError) return new ConflictError('같은 이름이 이미 있습니다');
  return e;
}

/** 만들기 — 내 업체 목록에 (업체는 서버가 넣는다, 본문의 company_id 는 받지 않는다) */
export async function createCounterparty(env, { user, body }) {
  const companyId = await counterpartyCompanyOf(env, user);
  const row = { ...validateCounterparty(body), company_id: companyId, created_by: user.id };
  try {
    return await insertOne(env, 'counterparties', row);
  } catch (e) {
    throw mapWriteError(e);
  }
}

/** 고치기 — 내 업체 줄만 (다른 업체 줄이면 없는 것과 같다 — 404) */
export async function updateCounterparty(env, { user, id, body }) {
  const companyId = await counterpartyCompanyOf(env, user);
  if (!UUID_RE.test(String(id))) throw new NotFoundError('찾을 수 없습니다');
  const patch = validateCounterparty(body, { partial: true });
  delete patch.kind; // 거래처를 공급처로 바꾸지 않는다 — 새로 만든다
  if (!Object.keys(patch).length) throw new ValidationError('바꿀 칸이 없습니다');
  let rows;
  try {
    rows = await updateBy(env, 'counterparties', { id: `eq.${id}`, company_id: `eq.${companyId}` }, patch);
  } catch (e) {
    throw mapWriteError(e);
  }
  if (!rows || !rows.length) throw new NotFoundError('찾을 수 없습니다');
  return rows[0];
}

/**
 * 수주 · 원가에 붙일 때 — 그 id 가 있고 종류가 맞고 **수주와 같은 업체**의 것인지 (null 은 떼기).
 * 다른 업체 것이면 없는 것과 같은 422. 표가 없으면 SQL 안내로 거절한다.
 */
export async function assertCounterparty(env, id, kind, companyId) {
  if (id === null) return null;
  const again = () => new ValidationError(`${KIND_LABEL[kind]}를 다시 골라 주세요`);
  if (!UUID_RE.test(String(id))) throw again();
  let row;
  try {
    row = await selectOne(env, 'counterparties', { id: `eq.${id}`, select: 'id,kind,name,company_id' });
  } catch (e) {
    throw mapWriteError(e);
  }
  if (!row || row.kind !== kind || !companyId || row.company_id !== companyId) throw again();
  return { id: row.id, kind: row.kind, name: row.name };
}
