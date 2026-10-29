/**
 * CD-5: 수주 · 실적 원가.
 *
 * 업무 루프의 마지막 칸. 고객이 확인서를 승인해도 그 다음이 없었다 —
 * design_documents 와 수주를 잇는 경로가 아예 없어 승인 이후는 시스템 밖이었다.
 *
 * 동시에 CD-6 의 "견적·원가 정확도" 를 닫는다. 견적은 스냅샷에 있었지만
 * **실적 원가를 받을 곳이 없어** 대조가 불가능했다.
 */

import {
  selectOne,
  selectMany,
  insertOne,
  updateById,
  restDelete,
  assertDesignAccess,
  designAccess,
  companyAccess,
  hqCompanyId,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  DbError,
} from './supabase.js';
import { assertCounterparty, NEED_SQL as COUNTERPARTY_NEED_SQL } from './counterparties.js';
import { isMissingRelation } from './work-order-data.js';
import { planStatusChange, requestStatusChange, applyStatusChange, statusPatch, statusClears, assertNoPendingEvent } from './order-events.js';

export const ORDER_STATUSES = ['confirmed', 'in_production', 'delivered', 'completed', 'cancelled'];

/**
 * 수주 구분 — 고객(customer) · 거래처(partner, 인테리어 업체). 2026-10-19 대표: 수주에 거래처 칸.
 * 칸은 database/orders-price-tier.sql 로 생긴다. 그 SQL 을 실행하기 전에도 수주 · 목록이 막히지 않게
 * 읽기 · 쓰기마다 칸이 없으면 빼고 다시 한다.
 */
export const PRICE_TIERS = ['customer', 'partner'];

/** 구분 칸이 아직 DB 에 없다 (PostgREST 가 모르는 칸이라고 거절) */
export const isMissingTierColumn = (e) => e instanceof DbError && /price_tier/.test(e.message);

/** 수주 읽기 — 구분 칸까지. 칸이 아직 없으면 빼고 다시 읽는다 */
export async function selectOrders(env, query) {
  try {
    return (await selectMany(env, 'orders', { ...query, select: `${query.select},price_tier` })) || [];
  } catch (e) {
    if (!isMissingTierColumn(e)) throw e;
    return (await selectMany(env, 'orders', query)) || [];
  }
}

/**
 * 고객 · 거래처. 수주에 적힌 구분이 정본이다. 없으면(옛 수주 · SQL 실행 전) 예전처럼
 * 계약금이 거래처 견적과 1,000원 안이면 거래처로 본다.
 */
export function tierOf(order, quote) {
  if (order && PRICE_TIERS.includes(order.price_tier)) return order.price_tier;
  const contract = Number(order && order.contract_amount);
  return quote && quote.partner && Math.abs(contract - Number(quote.partner.total)) < 1000 ? 'partner' : 'customer';
}

/**
 * 원가 분류. 견적(quote)과 **같은 축**으로 나눠야 대조가 의미를 갖는다.
 * 견적은 캐비닛·상판·설비·시공으로 나오므로 자재/부자재/노무/외주/물류/기타로 받는다.
 */
export const COST_CATEGORIES = ['material', 'hardware', 'labor', 'outsourcing', 'logistics', 'other'];

// 경영 대시보드(management/summary.js)도 이 이름을 쓴다 — ERP 화면과 같은 말로 부르게
export const COST_LABELS = {
  material: '자재',
  hardware: '부자재',
  labor: '노무',
  outsourcing: '외주',
  logistics: '물류',
  other: '기타',
};

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** 'SO-20260809-A1B2' */
function buildOrderNo(designId) {
  const short = String(designId).replace(/-/g, '').slice(0, 4).toUpperCase();
  return `SO-${todayCompact()}-${short}`;
}

function toAmount(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${field} 는 0 이상의 숫자여야 합니다`);
  return Math.round(n);
}

/**
 * 승인된 고객 확인서 → 수주.
 *
 * 멱등하다: 같은 문서로 두 번 부르면 기존 수주를 돌려준다.
 * (DB 의 document_id UNIQUE 가 최후 방어선이고, 여기서는 먼저 조회해 409 를 피한다)
 */
export async function createOrderFromDocument(env, { documentId, user }) {
  const doc = await selectOne(env, 'design_documents', { id: `eq.${documentId}`, select: '*' });
  if (!doc) throw new NotFoundError('문서를 찾을 수 없습니다');
  // 수주(상태 · 계약금)는 업체 구성원 누구나 만든다 — 수금액만 원가 · 수금 권한으로 가린다
  const { design, money } = await designAccess(env, doc.design_id, user);

  const existing = await selectOne(env, 'orders', { document_id: `eq.${documentId}`, select: '*' });
  if (existing) return { order: orderForViewer(existing, money), reused: true };

  // 아무 문서나 수주가 되면 안 된다. 고객이 승인한 확인서만이 계약의 근거다.
  if (doc.doc_type !== 'customer_confirmation') {
    throw new ValidationError('고객 확인서만 수주로 전환할 수 있습니다');
  }
  if (doc.decision !== 'approved') {
    throw new ConflictError('고객이 승인한 확인서만 수주로 전환할 수 있습니다');
  }

  const totals = doc.totals || {};
  const contract = toAmount(totals.total || 0, 'contract_amount');
  if (contract <= 0) {
    throw new ValidationError('확인서에 금액이 없어 수주로 전환할 수 없습니다');
  }

  const row = {
    order_no: buildOrderNo(doc.design_id),
    design_id: doc.design_id,
    document_id: doc.id,
    snapshot_id: doc.snapshot_id,
    customer_name: doc.customer_name || null,
    contract_amount: contract,
    status: 'confirmed',
    created_by: user.id,
    // 업체 · 프로젝트는 설계 것을 그대로 — DB 복합 FK (design_id, company_id) 가 같은 업체만 받는다
    company_id: design.company_id,
    project_id: design.project_id,
  };
  // 구분은 확인서를 낸 금액 종류(고객용 · 거래처용)를 그대로 옮긴다. 칸이 아직 없으면 빼고 넣는다
  const tier = totals.price_tier === 'partner' ? 'partner' : 'customer';
  let order;
  try {
    order = await insertOne(env, 'orders', { ...row, price_tier: tier });
  } catch (e) {
    if (!isMissingTierColumn(e)) throw e;
    order = await insertOne(env, 'orders', row);
  }
  return { order: orderForViewer(order, money), reused: false };
}

/**
 * 수금액(received_amount)은 원가 · 수금 권한이 있을 때만 싣는다.
 * 나머지 수주 칸(상태 · 계약금 · 날짜 · 메모)은 업체 구성원 누구나 본다.
 */
export function orderForViewer(order, money) {
  if (money || !order) return order;
  const out = { ...order };
  delete out.received_amount;
  return out;
}

const ORDER_LIST_SELECT =
  'id,order_no,design_id,document_id,snapshot_id,customer_name,contract_amount,received_amount,status,ordered_at,delivered_at,completed_at,note,created_at';

function orderListQuery() {
  return { select: ORDER_LIST_SELECT, order: 'ordered_at.desc', limit: '200' };
}

/**
 * 수주 목록 — designAccess 와 같은 규칙.
 *   업체 구성원 → 그 업체 수주 전부, 관리자 → 본사 수주 전부, 그 밖에는 내가 만든 본사 설계의 수주.
 *   수금액은 줄마다 원가 · 수금 권한(owner · manager · 본사 주인 · 관리자)이 있을 때만.
 * RLS 는 service_role 에 적용되지 않으므로 여기서 직접 거른다.
 */
export async function listOrders(env, { user, designId }) {
  const query = orderListQuery();
  if (designId) {
    const { money } = await designAccess(env, designId, user);
    query.design_id = `eq.${designId}`;
    return (await selectOrders(env, query)).map((o) => orderForViewer(o, money));
  }
  const hq = await hqCompanyId(env);
  const access = await companyAccess(env, user, { hq });
  // 내가 만든 본사 설계 (주인 규칙) — 본사 원가 · 수금 권한이 이미 있으면 따로 볼 것이 없다
  const own = access.money.has(hq) ? [] : await ownHqDesignIds(env, user, hq);
  const or = [];
  if (access.all.size) or.push(`company_id.in.(${[...access.all].join(',')})`);
  if (own.length && !access.all.has(hq)) or.push(`design_id.in.(${own.join(',')})`);
  if (or.length === 0) return [];
  query.or = `(${or.join(',')})`;
  // 업체는 줄마다 권한을 보는 데만 쓰고, 응답 칸은 예전 그대로 둔다
  query.select = `${query.select},company_id`;
  const ownSet = new Set(own);
  return (await selectOrders(env, query)).map((o) => {
    const out = { ...orderForViewer(o, access.money.has(o.company_id) || ownSet.has(o.design_id)) };
    delete out.company_id;
    return out;
  });
}

/** 내가 만든 본사 설계 id (예전 수주 목록의 기준) */
async function ownHqDesignIds(env, user, hq) {
  const designs = (await selectMany(env, 'designs', {
    select: 'id',
    user_id: `eq.${user.id}`,
    company_id: `eq.${hq}`,
    limit: '500',
  })) || [];
  return designs.map((d) => d.id);
}

/**
 * 생산 계획 · 월 손익의 입력 — 내가 만든 본사 설계의 수주 (예전 listOrders 와 같은 범위).
 * 계획 · 아침 요약은 본사 Slack 으로 나가므로 본사 수주만 싣는다.
 */
export async function listOwnHqOrders(env, { user }) {
  const hq = await hqCompanyId(env);
  const ids = await ownHqDesignIds(env, user, hq);
  if (ids.length === 0) return [];
  return selectOrders(env, { ...orderListQuery(), company_id: `eq.${hq}`, design_id: `in.(${ids.join(',')})` });
}

/** 수주 하나 + 설계 접근 — { order, money }. money: 원가 · 수금 권한 */
export async function orderAccess(env, orderId, user) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: '*' });
  if (!order) throw new NotFoundError('수주를 찾을 수 없습니다');
  const { money } = await designAccess(env, order.design_id, user);
  return { order, money };
}

/**
 * 수주 하나 + 설계 접근 확인. money: 원가 · 수금 · 재작업 비용을 다루는 경로면 true (기본) — 권한이 없으면 403.
 */
export async function loadOwnedOrder(env, orderId, user, { money = true } = {}) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: '*' });
  if (!order) throw new NotFoundError('수주를 찾을 수 없습니다');
  await assertDesignAccess(env, order.design_id, user, { money });
  return order;
}

/**
 * 수주 상세. 원가 · 마진은 원가 · 수금 권한이 있을 때만 — 없으면 수주 기본 정보(수금액 뺀 수주 행)만.
 * money 는 부르는 쪽(worker.js)이 수금 일정 · 재작업 비용을 붙일지 정하는 데 쓴다 (응답에 싣지 않는다).
 */
export async function getOrder(env, { orderId, user }) {
  const { order, money } = await orderAccess(env, orderId, user);
  if (!money) return { order: orderForViewer(order, false), money: false };
  const costs = (await selectMany(env, 'order_costs', {
    select: '*',
    order_id: `eq.${orderId}`,
    order: 'created_at.desc',
    limit: '500',
  })) || [];
  const snapshot = await selectOne(env, 'design_snapshots', {
    id: `eq.${order.snapshot_id}`,
    select: 'rev,quote_payload',
  });
  return { order, costs, margin: summarizeMargin(order, costs, snapshot && snapshot.quote_payload), money: true };
}

/**
 * CD-6: 견적 대비 실적.
 * 계약금액(고객이 승인한 금액)에서 실제 나간 원가를 빼 마진을 낸다.
 * 견적 상세(quote.items)가 있으면 함께 실어 항목 단위 비교의 재료로 남긴다.
 */
export function summarizeMargin(order, costs, quote) {
  const list = Array.isArray(costs) ? costs : [];
  const byCategory = {};
  let total = 0;
  for (const c of list) {
    const amt = Number(c.amount) || 0;
    total += amt;
    byCategory[c.category] = (byCategory[c.category] || 0) + amt;
  }
  const contract = Number(order.contract_amount) || 0;
  const received = Number(order.received_amount) || 0;
  const margin = contract - total;

  return {
    contract_amount: contract,
    received_amount: received,
    outstanding: contract - received,
    cost_total: total,
    cost_by_category: byCategory,
    cost_labels: COST_LABELS,
    margin,
    // 계약금액이 0 이면 비율은 의미가 없다 — null 로 두고 화면이 '-' 를 그린다
    margin_rate: contract > 0 ? Math.round((margin / contract) * 1000) / 10 : null,
    // 견적은 VAT 포함 합계다. 원가와 직접 빼면 안 되므로 참고값으로만 싣는다.
    quoted_total: quote && Number.isFinite(Number(quote.total)) ? Number(quote.total) : null,
    quoted_items: quote && Array.isArray(quote.items) ? quote.items.length : 0,
  };
}

/**
 * 수주 고치기. 상태 · 날짜 · 메모 · 구분 · 거래처는 업체 구성원 누구나,
 * 수금액(received_amount)은 원가 · 수금 권한이 있을 때만 (없으면 403). 응답의 수금액도 같은 권한으로 가린다.
 *
 * 상태는 order-events.js 의 규칙으로만 바뀐다 ({ status, reason }).
 *   바로 바뀌면 다른 칸과 함께 한 번에 쓰고 기록(order_events)을 한 줄 남긴다 → { order, event }
 *   대표 승인이 필요한데 대표가 아니면 요청만 남기고 수주는 손대지 않는다 (같이 보낸 다른 칸도) → { pending: true, event }
 *   승인을 기다리는 요청이 있으면 누구도(대표도) 상태를 못 바꾼다 — 409 pending_exists (먼저 승인 · 반려).
 *   지금 상태와 같은 status 는 바꾸기가 아니다 — 다른 칸만 고친다.
 */
export async function updateOrder(env, { orderId, user, patch }) {
  const { order, money } = await orderAccess(env, orderId, user);
  if (patch.received_amount !== undefined && !money) {
    throw new ForbiddenError('원가 · 수금은 업체 대표 · 실장만 볼 수 있습니다');
  }
  const allowed = {};
  let plan = null;

  if (patch.status !== undefined) {
    if (!ORDER_STATUSES.includes(patch.status)) {
      throw new ValidationError(`status 는 ${ORDER_STATUSES.join(', ')} 중 하나여야 합니다`);
    }
    if (patch.status !== order.status) {
      await assertNoPendingEvent(env, order.id);
      plan = await planStatusChange(env, { order, user, to: patch.status, reason: patch.reason });
      if (plan.pending) {
        return { pending: true, order: null, event: await requestStatusChange(env, { order, user, plan }) };
      }
      // 배송 · 완료로 옮기면 그날을 자동으로 찍는다 (완료일은 DB CHECK 가 요구한다)
      Object.assign(allowed, statusPatch(order, patch.status, patch));
    }
  }
  if (patch.received_amount !== undefined) {
    allowed.received_amount = toAmount(patch.received_amount, 'received_amount');
  }
  for (const k of ['delivered_at', 'completed_at']) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null || patch[k] === '') {
      allowed[k] = null;
      continue;
    }
    const when = new Date(patch[k]);
    if (Number.isNaN(when.getTime())) throw new ValidationError(`${k} 가 올바르지 않습니다`);
    allowed[k] = when.toISOString();
  }
  // 완료를 되돌리면 완료일, 배송에서 생산 중으로 돌아가면 배송일을 지운다 (보낸 날짜보다 앞선다)
  if (plan) Object.assign(allowed, statusClears(plan.from, plan.to));
  if (patch.note !== undefined) {
    allowed.note = patch.note ? String(patch.note).slice(0, 2000) : null;
  }
  if (patch.price_tier !== undefined) {
    if (patch.price_tier !== null && !PRICE_TIERS.includes(patch.price_tier)) {
      throw new ValidationError(`price_tier 는 ${PRICE_TIERS.join(', ')} 중 하나여야 합니다`);
    }
    allowed.price_tier = patch.price_tier;
  }
  // 주문한 거래처 (2단계 — 거래처 파레토). null 이면 뗀다
  if (patch.partner_id !== undefined) {
    const p = await assertCounterparty(env, patch.partner_id || null, 'partner');
    allowed.partner_id = p ? p.id : null;
  }

  if (Object.keys(allowed).length === 0) {
    // 지금 상태 그대로 보낸 것뿐이면 바꿀 것이 없다 — 예전처럼 성공으로 돌려준다
    if (patch.status !== undefined) return { pending: false, order: orderForViewer(order, money), event: null };
    throw new ValidationError('변경할 필드가 없습니다');
  }
  try {
    if (plan) {
      const { order: changed, event } = await applyStatusChange(env, { order, user, plan, patch: allowed });
      return { pending: false, order: orderForViewer(changed, money), event };
    }
    return { pending: false, order: orderForViewer(await updateById(env, 'orders', orderId, allowed), money), event: null };
  } catch (e) {
    if (isMissingTierColumn(e)) throw new ValidationError('수주 구분 칸이 아직 DB 에 없습니다 — database/orders-price-tier.sql 을 실행해 주세요');
    if (isMissingRelation(e) && /partner_id/.test(e.message)) throw new ValidationError(COUNTERPARTY_NEED_SQL);
    throw e;
  }
}

export async function addCost(env, { orderId, user, body }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  const category = String(body.category || '').trim();
  if (!COST_CATEGORIES.includes(category)) {
    throw new ValidationError(`category 는 ${COST_CATEGORIES.join(', ')} 중 하나여야 합니다`);
  }
  const row = {
    order_id: orderId,
    category,
    amount: toAmount(body.amount, 'amount'),
    description: body.description ? String(body.description).slice(0, 300) : null,
    vendor_name: body.vendor_name ? String(body.vendor_name).slice(0, 100) : null,
    created_by: user.id,
  };
  // 돈을 낸 공급처 (2단계 — 외주 성적표). 고르면 이름도 그 공급처로 맞춘다
  if (body.counterparty_id) {
    const s = await assertCounterparty(env, body.counterparty_id, 'supplier');
    row.counterparty_id = s.id;
    row.vendor_name = s.name;
  }
  if (body.spent_on) {
    const d = new Date(body.spent_on);
    if (Number.isNaN(d.getTime())) throw new ValidationError('spent_on 이 올바르지 않습니다');
    row.spent_on = d.toISOString().slice(0, 10);
  }
  // 지급 예정일 (2단계 — 현금흐름). 낸 날(spent_on)이 비고 이 날이 있으면 아직 안 낸 돈
  if (body.due_on) {
    const d = new Date(body.due_on);
    if (Number.isNaN(d.getTime())) throw new ValidationError('due_on 이 올바르지 않습니다');
    row.due_on = d.toISOString().slice(0, 10);
  }
  try {
    return await insertOne(env, 'order_costs', row);
  } catch (e) {
    if (isMissingRelation(e) && /due_on/.test(e.message)) throw new ValidationError('지급 예정일 칸이 아직 DB 에 없습니다 — database/management-phase2.sql 을 실행해 주세요');
    throw e;
  }
}

export async function deleteCost(env, { orderId, costId, user }) {
  await loadOwnedOrder(env, orderId, user, { money: true });
  const cost = await selectOne(env, 'order_costs', { id: `eq.${costId}`, select: 'id,order_id' });
  if (!cost || cost.order_id !== orderId) throw new NotFoundError('원가 항목을 찾을 수 없습니다');
  await restDelete(env, 'order_costs', { id: `eq.${costId}` });
  return { deleted: costId };
}
