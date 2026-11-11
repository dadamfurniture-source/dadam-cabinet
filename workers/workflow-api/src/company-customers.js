/**
 * 업체 고객 — 내 업체 고객을 한 번에 모아 읽고, 이름 · 전화를 고친다.
 * (마이페이지 B안 5단계 — 지금까지는 프로젝트 목록에 붙은 고객만 볼 수 있었고, 고치는 길이 없었다)
 *
 *   GET   /company/customers       내 업체 고객 목록 (active 구성원) — 새 고객부터 COMPANY_CUSTOMERS_LIMIT 명
 *     { company { id, name, kind, plan }, can_manage,
 *       items [{ id, name, phone, app_user, created_at, updated_at,
 *                projects [{ id, title, status, created_at }] }] }
 *   PATCH /company/customers/:id   고객 이름 · 전화 고치기 (대표 · 실장) { name?, phone? } → { id, name, phone, updated_at }
 *     phone 은 null · 빈 글이면 지운다. 둘 다 없거나 틀리면 422 (details.field).
 *
 * 누가       프로젝트를 가지는 업체(다담 공장 · active 협력업체 Manager · Expert · Agent)의 구성원 —
 *            GET /company/projects 와 같은 판정(projectCompanyOf). 이름 · 전화는 그 목록이 구성원에게 싣는 것과 같다.
 *            고치기는 대표 · 실장만 (새 고객 · 프로젝트 만들기 POST /company/projects 와 같다).
 * 다른 업체   고객은 company_id 로 묶인다 — 읽기 · 고치기 모두 내 업체 것만. 남의 고객 id 는 404.
 * 안 바뀌는 것 이미 나간 문서 · 수주에 베껴 둔 고객 이름(design_documents.customer_name · orders.customer_name)과
 *            현장 연락처(design_site_info.contact_*)는 그대로다 — 이 표(customers)의 이름 · 전화만 고친다.
 *            고객의 앱 계정 연결(user_id)과 업체(company_id)는 바꾸지 않는다.
 * customers 는 사용자 JWT 로 고칠 수 없다 (RLS — database/migrations/0015) — 이 워커(service_role)가 쓴다.
 */

import { NotFoundError, ValidationError, DbError, selectMany, selectOne, updateBy } from './supabase.js';
import { projectCompanyOf, CUSTOMER_NAME_MAX, PHONE_RE } from './company-projects.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 목록 한 번에 */
export const COMPANY_CUSTOMERS_LIMIT = 200;
/** 고객마다 붙이는 프로젝트를 찾아볼 행 수 */
const PROJECT_ROW_LIMIT = '1000';

/** GET /company/customers */
export async function listCompanyCustomers(env, { user }) {
  const { company, canAct } = await projectCompanyOf(env, user);
  const customers =
    (await selectMany(env, 'customers', {
      company_id: `eq.${company.id}`,
      select: 'id,user_id,name,phone,created_at,updated_at',
      order: 'created_at.desc',
      limit: String(COMPANY_CUSTOMERS_LIMIT),
    })) || [];
  const ids = customers.map((c) => c.id);
  const projects = ids.length
    ? (await selectMany(env, 'projects', {
        customer_id: `in.(${ids.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,customer_id,title,status,created_at',
        order: 'created_at.desc',
        limit: PROJECT_ROW_LIMIT,
      })) || []
    : [];
  const by = new Map();
  for (const p of projects) {
    if (!by.has(p.customer_id)) by.set(p.customer_id, []);
    by.get(p.customer_id).push({
      id: p.id,
      title: p.title || null,
      status: p.status,
      created_at: p.created_at,
    });
  }
  return {
    company: { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null },
    can_manage: canAct,
    items: customers.map((c) => ({
      id: c.id,
      name: c.name || null,
      phone: c.phone || null,
      // 앱 계정과 이어진 고객인가 (앱 상담으로 온 고객) — 계정 id 는 싣지 않는다
      app_user: Boolean(c.user_id),
      created_at: c.created_at,
      updated_at: c.updated_at || null,
      projects: by.get(c.id) || [],
    })),
  };
}

/** 본문 → 고칠 칸. 이름은 1 ~ CUSTOMER_NAME_MAX 자, 전화는 PHONE_RE 또는 지우기(null) */
export function customerPatch(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const patch = {};
  if (has(body, 'name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('name 이 필요합니다', { field: 'name' });
    if (name.length > CUSTOMER_NAME_MAX)
      throw new ValidationError(`name 은 ${CUSTOMER_NAME_MAX}자까지입니다`, { field: 'name' });
    patch.name = name;
  }
  if (has(body, 'phone')) {
    const v = body.phone;
    if (v === null || (typeof v === 'string' && !v.trim())) patch.phone = null;
    else {
      const phone = typeof v === 'string' ? v.trim() : '';
      if (!PHONE_RE.test(phone))
        throw new ValidationError('전화는 숫자와 - 로 8~20자입니다', { field: 'phone' });
      patch.phone = phone;
    }
  }
  if (!Object.keys(patch).length)
    throw new ValidationError('name 이나 phone 을 넣어 주세요', { field: 'name' });
  return patch;
}

/** PATCH /company/customers/:id */
export async function updateCompanyCustomer(env, { user, params, body, nowMs = Date.now() }) {
  const { company } = await projectCompanyOf(env, user, { manage: true });
  const id = params && params.id;
  if (!isUuid(id)) throw new NotFoundError('이 팩토리의 고객을 찾을 수 없습니다');
  const patch = customerPatch(body);
  const mine = { id: `eq.${id}`, company_id: `eq.${company.id}` };
  const row = await selectOne(env, 'customers', { ...mine, select: 'id' });
  if (!row) throw new NotFoundError('이 팩토리의 고객을 찾을 수 없습니다');
  const rows = await updateBy(env, 'customers', mine, {
    ...patch,
    updated_at: new Date(nowMs).toISOString(),
  });
  const saved = Array.isArray(rows) ? rows[0] : null;
  if (!saved) throw new DbError('고객을 고치지 못했습니다');
  return {
    id: saved.id,
    name: saved.name || null,
    phone: saved.phone || null,
    updated_at: saved.updated_at || null,
  };
}
