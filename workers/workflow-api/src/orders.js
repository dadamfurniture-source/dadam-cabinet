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
  assertDesignOwner,
  ValidationError,
  NotFoundError,
  ConflictError,
} from './supabase.js';

export const ORDER_STATUSES = ['confirmed', 'in_production', 'delivered', 'completed', 'cancelled'];

/**
 * 원가 분류. 견적(quote)과 **같은 축**으로 나눠야 대조가 의미를 갖는다.
 * 견적은 캐비닛·상판·설비·시공으로 나오므로 자재/부자재/노무/외주/물류/기타로 받는다.
 */
export const COST_CATEGORIES = ['material', 'hardware', 'labor', 'outsourcing', 'logistics', 'other'];

const COST_LABELS = {
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
  await assertDesignOwner(env, doc.design_id, user.id);

  const existing = await selectOne(env, 'orders', { document_id: `eq.${documentId}`, select: '*' });
  if (existing) return { order: existing, reused: true };

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

  const order = await insertOne(env, 'orders', {
    order_no: buildOrderNo(doc.design_id),
    design_id: doc.design_id,
    document_id: doc.id,
    snapshot_id: doc.snapshot_id,
    customer_name: doc.customer_name || null,
    contract_amount: contract,
    status: 'confirmed',
    created_by: user.id,
  });
  return { order, reused: false };
}

export async function listOrders(env, { user, designId }) {
  const query = {
    select: 'id,order_no,design_id,document_id,snapshot_id,customer_name,contract_amount,received_amount,status,ordered_at,delivered_at,completed_at,note,created_at',
    order: 'ordered_at.desc',
    limit: '200',
  };
  if (designId) {
    await assertDesignOwner(env, designId, user.id);
    query.design_id = `eq.${designId}`;
    return (await selectMany(env, 'orders', query)) || [];
  }
  // 설계 지정이 없으면 내 설계의 수주 전부.
  // RLS 는 service_role 에 적용되지 않으므로 소유 설계를 직접 필터해야 한다.
  const designs = (await selectMany(env, 'designs', {
    select: 'id',
    user_id: `eq.${user.id}`,
    limit: '500',
  })) || [];
  if (designs.length === 0) return [];
  const ids = designs.map((d) => d.id).join(',');
  query.design_id = `in.(${ids})`;
  return (await selectMany(env, 'orders', query)) || [];
}

async function loadOwnedOrder(env, orderId, user) {
  const order = await selectOne(env, 'orders', { id: `eq.${orderId}`, select: '*' });
  if (!order) throw new NotFoundError('수주를 찾을 수 없습니다');
  await assertDesignOwner(env, order.design_id, user.id);
  return order;
}

export async function getOrder(env, { orderId, user }) {
  const order = await loadOwnedOrder(env, orderId, user);
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
  return { order, costs, margin: summarizeMargin(order, costs, snapshot && snapshot.quote_payload) };
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

export async function updateOrder(env, { orderId, user, patch }) {
  const order = await loadOwnedOrder(env, orderId, user);
  const allowed = {};

  if (patch.status !== undefined) {
    if (!ORDER_STATUSES.includes(patch.status)) {
      throw new ValidationError(`status 는 ${ORDER_STATUSES.join(', ')} 중 하나여야 합니다`);
    }
    allowed.status = patch.status;
    // 완료로 옮기면 완료일을 자동으로 찍는다 (DB CHECK 가 요구한다)
    if (patch.status === 'completed' && !order.completed_at && patch.completed_at === undefined) {
      allowed.completed_at = new Date().toISOString();
    }
    if (patch.status === 'delivered' && !order.delivered_at && patch.delivered_at === undefined) {
      allowed.delivered_at = new Date().toISOString();
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
  if (patch.note !== undefined) {
    allowed.note = patch.note ? String(patch.note).slice(0, 2000) : null;
  }

  if (Object.keys(allowed).length === 0) throw new ValidationError('변경할 필드가 없습니다');
  return updateById(env, 'orders', orderId, allowed);
}

export async function addCost(env, { orderId, user, body }) {
  await loadOwnedOrder(env, orderId, user);
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
  if (body.spent_on) {
    const d = new Date(body.spent_on);
    if (Number.isNaN(d.getTime())) throw new ValidationError('spent_on 이 올바르지 않습니다');
    row.spent_on = d.toISOString().slice(0, 10);
  }
  return insertOne(env, 'order_costs', row);
}

export async function deleteCost(env, { orderId, costId, user }) {
  await loadOwnedOrder(env, orderId, user);
  const cost = await selectOne(env, 'order_costs', { id: `eq.${costId}`, select: 'id,order_id' });
  if (!cost || cost.order_id !== orderId) throw new NotFoundError('원가 항목을 찾을 수 없습니다');
  await restDelete(env, 'order_costs', { id: `eq.${costId}` });
  return { deleted: costId };
}
