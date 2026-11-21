/**
 * 업체 프로젝트의 「지금 단계 · 다음 할 일」 — pipeline.js(순수 판정)에 넘길 값을 한 번에 모은다.
 * (2026-11-21 대표님 승인 계획 「프로젝트 한 길」 — 프로젝트 줄 · 받은 일 · 프로젝트 창이 같은 값을 쓴다)
 *
 * 읽는 것 (모두 한 번에 나란히 — 프로젝트 번호 목록을 주소에 길게 싣지 않도록 업체로 거른다)
 *   design_documents   이 업체 설계들의 고객 확인서(= 견적서) — 답 · 본 횟수 · 기한 (거둔 것 뺌, 새 것부터)
 *   orders             업체 수주 — 상태 · 날짜 · 근거 문서 (취소 포함: 승인된 확인서의 수주가 취소됐는지 본다)
 *   order_events       대표 승인을 기다리는 수주 요청 (pending)
 *   production_requests Manager 업체 = 내가 낸 제작 의뢰(거둔 것 뺌) · 팩토리 = 내가 받은 의뢰(프로젝트 · 초안 짝). DB 0050 전이면 없다
 *   planner_drafts     플래너 초안 — 프로젝트에 이어진 것(요약의 projectId) · 앱으로 보낸 설계의 원본(designs.source_ref)
 *   as_requests        팩토리의 처리 중 A/S (접수 · 받음). DB 0045 전이면 없다
 *   order_payments     접수 상태 수주의 계약금 줄 · 완료된 수주의 잔금 줄 — 입금됐나 (금액은 읽지 않는다 — 직원도 보는 값)
 *
 * 덧붙여 주는 값: deposit_paid — 취소 아닌 수주에 입금된 계약금 줄이 있다 (있을 때만 true).
 *   「계약금을 받으면 보류 · 그만둠은 작동하지 않는다」(대표님 2026-11-21) — 화면이 그 줄에는 단추를 내지 않는다.
 *   서버의 판정은 company-project-status.js 가 따로 한다 (같은 규칙).
 *
 * 금액 · 고객 연락처는 여기서 읽지도 싣지도 않는다.
 */

import { selectMany } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { nextStep, stepOf } from './pipeline.js';

/** 한 번에 읽는 행 수 상한 (company-projects.js STAGE_ROW_LIMIT 와 같다) */
const ROW_LIMIT = '500';
/** 플래너 초안 수 (planner-drafts.js 목록과 같다) */
const DRAFT_LIMIT = '200';
/** 생산을 하는 협력업체 등급 — 그 밖(Manager)은 제작 의뢰로 넘긴다 (segan/me.js FACTORY_PLANS 와 같다) */
export const FACTORY_PLANS = Object.freeze(['expert', 'agent']);
/** 간편 플래너가 보낸 설계 (planner-handoff.js PLANNER_SOURCE 와 같다) */
const PLANNER_SOURCE = 'planner-lite';
/** 처리 중인 A/S (segan/me.js AS_OPEN 과 같다) */
const AS_OPEN = 'in.(requested,received)';

/** 표가 아직 없으면(DB 적용 전) 빈 목록 — 그 밖의 오류는 그대로 던진다 */
async function orEmpty(promise) {
  try {
    return (await promise) || [];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/** 주소가 길어지지 않게 id 목록을 나눠 묻는 크기 */
const ID_CHUNK = 100;

/** 다담 공장 · Expert · Agent — 생산을 하는 업체 */
export function isFactory(company) {
  return !!company && (company.kind === 'hq' || FACTORY_PLANS.includes(company.plan));
}

function pushTo(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/**
 * 프로젝트마다 { step, next } — Map(project id → …).
 * @param {object} env
 * @param {{ company: { id, kind, plan }, viewer: { role, user_id }, nowMs?: number,
 *           projects: Array<{ id, status, created_at, hold_until? }>,
 *           designs: Array<{ id, project_id, source?, source_ref? }>,   이 프로젝트들에 이어진 설계
 *           stages: Map<string, { stage: string }> }} args               company-projects.js stagesOf
 */
export async function pipelineOf(env, { company, viewer, projects, designs, stages, nowMs = Date.now() }) {
  const out = new Map();
  if (!projects.length) return out;
  const co = `eq.${company.id}`;
  const factory = isFactory(company);
  const designIds = designs.map((d) => d.id);

  const [docs, orders, events, requests, bornRows, drafts, asRows] = await Promise.all([
    designIds.length
      ? selectMany(env, 'design_documents', {
          design_id: `in.(${designIds.join(',')})`,
          doc_type: 'eq.customer_confirmation',
          status: 'neq.revoked',
          select: 'id,design_id,status,decision,decided_at,first_viewed_at,view_count,expires_at,superseded_by,created_at',
          order: 'created_at.desc',
          limit: ROW_LIMIT,
        })
      : [],
    selectMany(env, 'orders', {
      company_id: co,
      select: 'id,project_id,document_id,status,ordered_at,delivered_at,completed_at',
      order: 'ordered_at.desc,created_at.desc',
      limit: ROW_LIMIT,
    }),
    selectMany(env, 'order_events', {
      company_id: co,
      state: 'eq.pending',
      select: 'id,order_id,kind,created_at',
      order: 'created_at.asc',
      limit: ROW_LIMIT,
    }),
    factory
      ? []
      : orEmpty(
          selectMany(env, 'production_requests', {
            company_id: co,
            status: 'neq.cancelled',
            select: 'id,project_id,status,status_at',
            order: 'created_at.desc',
            limit: ROW_LIMIT,
          })
        ),
    factory
      ? orEmpty(
          selectMany(env, 'production_requests', {
            factory_company_id: co,
            status: 'eq.accepted',
            select: 'factory_project_id,factory_draft_id',
            limit: ROW_LIMIT,
          })
        )
      : [],
    orEmpty(
      selectMany(env, 'planner_drafts', {
        company_id: co,
        discarded_at: 'is.null',
        select: 'id,created_by,updated_at,project_id:summary->>projectId',
        order: 'updated_at.desc',
        limit: DRAFT_LIMIT,
      })
    ),
    factory
      ? orEmpty(selectMany(env, 'as_requests', { company_id: co, state: AS_OPEN, select: 'order_id', limit: ROW_LIMIT }))
      : [],
  ]);

  // 수주 — 프로젝트마다 (최신이 앞), 문서마다 (취소 포함)
  const orderById = new Map();
  const liveByProject = new Map();
  const ordersByDoc = new Map();
  for (const o of orders || []) {
    orderById.set(o.id, o);
    pushTo(ordersByDoc, o.document_id, o);
    if (o.status !== 'cancelled') pushTo(liveByProject, o.project_id, o);
  }

  // 계약금 — 접수 상태인 최신 수주만 묻는다 (그때만 「계약금 입금 적기」가 다음 할 일이다)
  // 잔금 — 완료된 최신 수주만 묻는다 (그때만 「잔금 입금 적기」가 다음 할 일이다)
  const confirmedIds = [];
  const completedIds = [];
  for (const list of liveByProject.values()) {
    if (list[0].status === 'confirmed') confirmedIds.push(list[0].id);
    else if (list[0].status === 'completed') completedIds.push(list[0].id);
  }
  const paymentsOf = (ids, stage) =>
    ids.length
      ? orEmpty(
          selectMany(env, 'order_payments', {
            order_id: `in.(${ids.join(',')})`,
            stage: `eq.${stage}`,
            select: 'order_id,paid_on',
            limit: ROW_LIMIT,
          })
        )
      : [];
  const [balances, payments] = await Promise.all([
    paymentsOf(completedIds, 'balance'),
    paymentsOf(confirmedIds, 'deposit'),
  ]);
  const depositOf = new Map();
  for (const p of payments) {
    if (p.paid_on) depositOf.set(p.order_id, 'paid');
    else if (!depositOf.has(p.order_id)) depositOf.set(p.order_id, 'unpaid');
  }
  // 계약금을 받은 프로젝트 — 살아 있는 프로젝트(진행 · 보류)의 취소 아닌 수주 가운데 입금된 계약금 줄이 있는 것.
  // 접수 상태의 최신 수주는 위에서 읽었다 — 그 밖의 수주만 더 묻는다 (100개씩 나눠서, 받은 줄만)
  const liveProject = new Set(projects.filter((p) => !p.status || p.status === 'active' || p.status === 'on_hold').map((p) => p.id));
  const asked = new Set(confirmedIds);
  const restIds = [];
  for (const [pid, list] of liveByProject) {
    if (!liveProject.has(pid)) continue;
    for (const o of list) if (!asked.has(o.id)) restIds.push(o.id);
  }
  const chunks = [];
  for (let i = 0; i < restIds.length; i += ID_CHUNK) chunks.push(restIds.slice(i, i + ID_CHUNK));
  const paidRows = (
    await Promise.all(
      chunks.map((ids) =>
        orEmpty(
          selectMany(env, 'order_payments', {
            order_id: `in.(${ids.join(',')})`,
            stage: 'eq.deposit',
            paid_on: 'not.is.null',
            select: 'order_id',
            limit: ROW_LIMIT,
          })
        )
      )
    )
  ).flat();
  const paidOrder = new Set(paidRows.map((r) => r.order_id));
  for (const [orderId, state] of depositOf) if (state === 'paid') paidOrder.add(orderId);
  const depositPaid = new Set();
  for (const [pid, list] of liveByProject) if (list.some((o) => paidOrder.has(o.id))) depositPaid.add(pid);

  // 잔금 줄이 여럿이면 하나라도 안 받은 것이 있으면 unpaid
  const balanceOf = new Map();
  for (const p of balances) {
    if (!p.paid_on) balanceOf.set(p.order_id, 'unpaid');
    else if (!balanceOf.has(p.order_id)) balanceOf.set(p.order_id, 'paid');
  }

  // 견적(고객 확인서) — 프로젝트마다 가장 새 살아 있는 것 (새 판에 밀린 것은 뺀다)
  const projectOfDesign = new Map(designs.map((d) => [d.id, d.project_id]));
  const quoteOf = new Map();
  for (const d of docs || []) {
    if (d.status === 'superseded' || d.superseded_by) continue;
    const pid = projectOfDesign.get(d.design_id);
    if (pid && !quoteOf.has(pid)) quoteOf.set(pid, d);
  }

  // 플래너 초안 — 프로젝트에 이어진 것(요약) · 보낸 설계의 원본(source_ref). 가장 최근에 고친 것이 앞
  const draftById = new Map((drafts || []).map((d) => [d.id, d]));
  const draftOf = new Map();
  const keep = (pid, d) => {
    if (!pid || !d) return;
    const cur = draftOf.get(pid);
    if (!cur || String(d.updated_at || '') > String(cur.updated_at || '')) draftOf.set(pid, d);
  };
  for (const d of drafts || []) keep(d.project_id, d);
  const designCount = new Map();
  for (const d of designs) {
    designCount.set(d.project_id, (designCount.get(d.project_id) || 0) + 1);
    if (d.source === PLANNER_SOURCE && d.source_ref) keep(d.project_id, draftById.get(d.source_ref));
  }

  // 팩토리가 받은 제작 의뢰 — 그 프로젝트 · 베껴 온 초안
  const bornDraft = new Map();
  for (const r of bornRows || []) if (r.factory_project_id) bornDraft.set(r.factory_project_id, r.factory_draft_id || null);
  // 영업 사원이 낸 제작 의뢰 — 프로젝트마다 가장 새 것
  const requestOf = new Map();
  for (const r of requests || []) if (r.project_id && !requestOf.has(r.project_id)) requestOf.set(r.project_id, r);

  // 대표 승인 기다림 · 처리 중 A/S — 수주로 프로젝트를 찾는다
  const pendingOf = new Map();
  for (const e of events || []) {
    const o = orderById.get(e.order_id);
    if (o && o.project_id && !pendingOf.has(o.project_id))
      pendingOf.set(o.project_id, { order_id: o.id, kind: e.kind, created_at: e.created_at });
  }
  const asOpen = new Map();
  for (const a of asRows || []) {
    const o = orderById.get(a.order_id);
    if (o && o.project_id) asOpen.set(o.project_id, (asOpen.get(o.project_id) || 0) + 1);
  }

  for (const p of projects) {
    const order = (liveByProject.get(p.id) || [])[0] || null;
    const quote = quoteOf.get(p.id) || null;
    const born = bornDraft.has(p.id);
    const draft = draftOf.get(p.id) || (born ? draftById.get(bornDraft.get(p.id)) : null) || null;
    const facts = {
      id: p.id,
      status: p.status,
      hold_until: p.hold_until || null,
      created_at: p.created_at,
      stage: (stages.get(p.id) || {}).stage || 'consult',
      factory,
      born,
      draft: draft ? { id: draft.id, created_by: draft.created_by || null, updated_at: draft.updated_at || null } : null,
      designs: designCount.get(p.id) || 0,
      quote: quote
        ? {
            id: quote.id,
            created_at: quote.created_at,
            expires_at: quote.expires_at || null,
            first_viewed_at: quote.first_viewed_at || null,
            view_count: quote.view_count || 0,
            decision: quote.decision || null,
            decided_at: quote.decided_at || null,
          }
        : null,
      order: order
        ? {
            id: order.id,
            status: order.status,
            ordered_at: order.ordered_at || null,
            delivered_at: order.delivered_at || null,
            completed_at: order.completed_at || null,
          }
        : null,
      // 승인된 그 확인서의 수주가 모두 취소됐다 — 문서 하나에 수주 하나라 다시 만들 수 없다
      dead_order:
        !order && !!quote && quote.decision === 'approved' && (ordersByDoc.get(quote.id) || []).some((o) => o.status === 'cancelled'),
      deposit: order ? depositOf.get(order.id) || null : null,
      balance: order ? balanceOf.get(order.id) || null : null,
      request: requestOf.get(p.id) || null,
      pending: pendingOf.get(p.id) || null,
      as_open: asOpen.get(p.id) || 0,
    };
    out.set(p.id, {
      step: stepOf(facts),
      next: nextStep(facts, viewer, nowMs),
      ...(depositPaid.has(p.id) ? { deposit_paid: true } : {}),
    });
  }
  return out;
}
