/**
 * 외주 발주 내역 (work-reports-archive.plan.md §2.1).
 *
 * Step 4 의 외주 꾸러미(도어재 발주서 · 재단·엣지 의뢰서)는 지금껏 뽑을 수만 있었다 — 보냈다는 기록이 없었다.
 * [발주 처리] 가 업체 · 입고 예정일 · 수량을 outsource_order 한 행으로 남기고, 보관함에서 입고/취소로 바꾼다.
 * 도어재 발주가 된 주문은 생산 계획의 '도어 발주 마감' 추천 · 아침 경고에서 빠진다 (production/service.js doorOrderedIds).
 */

import { ConflictError, ValidationError, insertOne, selectMany, selectOne } from '../supabase.js';
import { countertopRequests, countertopModelIds, countertopQty, workdaysBefore, TOP_VENDOR_KEY } from '../countertop.js';
import { getDocumentForOwner } from '../documents.js';
import { outsourceCounts } from '../templates/work-order.js';
import { workdays } from '../production/planner.js';
import { getSettings } from '../production/service.js';
import { OUTSOURCE_PACKS, kstDay, reportFromOutsource } from './record.js';

const TABLE = 'work_reports';
const KINDS = 'in.(outsource_order,countertop_order)';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/** 오늘 발주 → 납기 n 근무일 뒤 (공휴일 제외). */
export function expectedArrival(today, leadDays, holidays = []) {
  const n = Math.max(1, Math.round(Number(leadDays) || 1));
  return workdays(nextDay(today), n, holidays)[n - 1];
}

async function ordersOfDesign(env, designId) {
  return ((await selectMany(env, 'orders', { design_id: `eq.${designId}`, select: 'id', limit: '50' })) || []).map((o) => o.id);
}

/** 이 설계에 이미 살아 있는(발주·입고) 같은 꾸러미 발주. */
async function liveOrders(env, { userId, designId, pack }) {
  return (await selectMany(env, TABLE, {
    owner_id: `eq.${userId}`,
    kind: KINDS,
    design_ids: `cs.{${designId}}`,
    status: 'in.(ordered,received)',
    'metrics->>pack': `eq.${pack}`,
    select: 'id,status,period_start,period_end,metrics,created_at',
    order: 'created_at.desc',
    limit: '20',
  })) || [];
}

/**
 * [발주 처리]. body = { pack: 'door'|'cut-vendor', vendor?, expected_on?, note?, force? }
 * 같은 설계에 같은 꾸러미 발주가 살아 있으면 409 — 다시 보내는 거라면 force: true.
 */
export async function createOutsourceOrder(env, { user, documentId, body = {} }) {
  const pack = String(body.pack || '');
  const def = OUTSOURCE_PACKS[pack];
  if (!def) throw new ValidationError('pack 은 door · cut-vendor · top 중 하나여야 합니다');
  const { doc, snapshot } = await getDocumentForOwner(env, { documentId, user });
  if (doc.doc_type !== 'work_order') throw new ValidationError('작업지시서에서만 외주 발주를 처리합니다');

  const today = kstDay();
  const expected = body.expected_on ? String(body.expected_on).slice(0, 10) : null;
  if (expected && (!DAY_RE.test(expected) || expected < today)) throw new ValidationError('입고 예정일은 오늘 이후 날짜여야 합니다');

  const existing = await liveOrders(env, { userId: user.id, designId: doc.design_id, pack });
  if (existing.length && !body.force) {
    const e = existing[0];
    throw new ConflictError(`이미 발주 처리했습니다 — ${e.period_start} ${(e.metrics && e.metrics.vendor) || ''} (${e.status === 'received' ? '입고' : '발주'}). 다시 보내려면 한 번 더 확인해 주세요.`);
  }

  const { settings } = await getSettings(env, { user });
  let quantities;
  let vendorKey = def.vendorKey;
  if (pack === 'top') {
    const reqs = countertopRequests(snapshot, { countertop: settings.countertop });
    if (!reqs.length) throw new ValidationError('이 작업지시서에는 상판이 없습니다');
    quantities = countertopQty(reqs);
    vendorKey = TOP_VENDOR_KEY[reqs[0].material] || 'topMarble';
  } else {
    quantities = outsourceCounts(doc, snapshot, pack);
  }
  const vendor = String(body.vendor || '').trim().slice(0, 40) || settings.vendors[vendorKey];
  if (!vendor) throw new ValidationError(`${quantities.material || '상판'} 업체를 적어 주세요 (생산 설정에 재질별 업체를 넣으면 비워도 됩니다)`);
  const lead = pack === 'door' ? settings.leads.doorLeadDays : pack === 'top' ? settings.leads.topLeadDays : settings.leads.outsourceLeadDays;
  const row = reportFromOutsource({
    ownerId: user.id,
    doc,
    pack,
    vendor,
    orderedOn: today,
    expectedOn: expected || expectedArrival(today, lead, settings.holidays),
    quantities,
    orderIds: await ordersOfDesign(env, doc.design_id),
    note: typeof body.note === 'string' ? body.note : null,
    createdBy: user.id,
  });
  return insertOne(env, TABLE, row);
}

/** Step 4 카드용 — 이 문서의 설계에 걸린 외주 발주 (취소 포함, 최신순). */
export async function listOutsourceOrders(env, { user, documentId }) {
  const { doc } = await getDocumentForOwner(env, { documentId, user });
  const rows = (await selectMany(env, TABLE, {
    owner_id: `eq.${user.id}`,
    kind: KINDS,
    design_ids: `cs.{${doc.design_id}}`,
    select: 'id,status,title,period_start,period_end,metrics,body,created_at',
    order: 'created_at.desc',
    limit: '50',
  })) || [];
  return rows.map((r) => ({
    id: r.id,
    pack: (r.metrics && r.metrics.pack) || (r.body && r.body.pack) || null,
    vendor: (r.metrics && r.metrics.vendor) || null,
    status: r.status,
    ordered_on: r.period_start,
    expected_on: r.period_end,
    doc_no: r.body ? r.body.doc_no : null,
    qty: (r.metrics && r.metrics.qty) || '',
    created_at: r.created_at,
  }));
}

/**
 * 상판 요청서 인쇄 시점 자료 — 설계 주인의 생산 설정(업체 · 기본값 · 마감 근무일 · 공휴일), 가장 이른 설치일, 고른 가전 모델.
 * 하나라도 못 읽으면 그 칸만 [확인 필요] 로 남기고 종이는 나온다.
 */
export async function loadCountertopContext(env, { doc, snapshot }) {
  const ctx = { today: kstDay(), installDate: null, deadline: null, leadDays: 4, vendors: {}, countertop: null, models: new Map() };
  try {
    const design = await selectOne(env, 'designs', { id: `eq.${doc.design_id}`, select: 'user_id' });
    const { settings } = await getSettings(env, { user: { id: design ? design.user_id : null } });
    ctx.vendors = settings.vendors;
    ctx.countertop = settings.countertop;
    ctx.leadDays = settings.leads.topLeadDays;
    const sched = (await selectMany(env, 'design_schedules', {
      design_id: `eq.${doc.design_id}`, type: 'eq.installation', status: 'neq.cancelled', select: 'scheduled_at', order: 'scheduled_at.asc', limit: '1',
    })) || [];
    if (sched[0]) {
      ctx.installDate = kstDay(sched[0].scheduled_at);
      ctx.deadline = workdaysBefore(ctx.installDate, ctx.leadDays, settings.holidays);
    }
  } catch (e) {
    console.warn('countertop context (settings/schedule) failed:', e && e.message);
  }
  const ids = countertopModelIds(snapshot);
  if (ids.length) {
    try {
      const rows = (await selectMany(env, 'appliance_models', { id: `in.(${ids.join(',')})`, select: '*', limit: '20' })) || [];
      ctx.models = new Map(rows.map((r) => [r.id, r]));
    } catch (e) {
      console.warn('countertop context (models) failed:', e && e.message);
    }
  }
  return ctx;
}
