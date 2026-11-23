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
 *   project_visits     프로젝트의 실측 일정 — 예정 · 끝 (DB 0079 전이면 없다 → 실측 단계 없이 지금처럼)
 *
 * 덧붙여 주는 값: deposit_paid — 취소 아닌 수주에 입금된 계약금 줄이 있다 (있을 때만 true).
 *   「계약금을 받으면 보류 · 그만둠은 작동하지 않는다」(대표님 2026-11-21) — 화면이 그 줄에는 단추를 내지 않는다.
 *   서버의 판정은 company-project-status.js 가 따로 한다 (같은 규칙).
 *
 * 품목 줄 (2026-11-23 대표님 「워크플로우를 현재 변경된 프로젝트 지정에 맞게」 — pipeline-items.js):
 *   한 프로젝트에 품목 설계가 둘 이상이면 품목 줄마다(초안 ↔ 설계 ↔ 그 설계의 견적 ↔ 그 설계의 수주) 단계 · 다음 할 일을 내고,
 *   프로젝트의 step · next 는 **가장 늦은 줄** 것이다. 줄마다의 값은 items 로 같이 준다 (품목이 하나여도 items 에 한 줄).
 *   품목이 하나(또는 없음)인 프로젝트의 step · next 는 예전 그대로다.
 *   품목 = **간편 플래너의 설계**(프로젝트에 이어진 초안 · 플래너가 보낸 앱 설계)다. 예전 상세설계에서 온 설계는 한 품목의 1안 · 2안일 수 있어
 *   품목으로 세지 않는다 — 플래너 품목이 둘 이상인 프로젝트에서만 그 설계 · 수주도 줄로 같이 보인다 (가려지지 않게).
 *
 * 금액 · 고객 연락처는 여기서 읽지도 싣지도 않는다.
 */

import { selectMany } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { STEP_LABEL, nextStep, stepOf } from './pipeline.js';
import { itemsOf, numberLabels, trackLabelOf } from './pipeline-items.js';
import { visitsOf } from './company-project-visits.js';

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

/** 팩토리가 받은 제작 의뢰 → [프로젝트, 베껴 온 초안] 짝 */
function bornDraftPairs(rows) {
  return (rows || []).filter((r) => r.factory_project_id).map((r) => [r.factory_project_id, r.factory_draft_id || null]);
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
 *           designs: Array<{ id, project_id, source?, source_ref?, name?, created_at? }>,   이 프로젝트들에 이어진 설계 (name · created_at = 품목 줄의 이름 · 차례)
 *           stages: Map<string, { stage: string }>,                       company-projects.js stagesOf
 *           meta?: object }} args                                         덧붙여 알리는 값을 여기에 적는다 — visit_ready (실측 일정 표가 있다) ·
 *                                                                         order_at (Map 프로젝트 → 가장 새 취소 아닌 수주를 만든 때 — 머문 날을 잴 때 쓴다)
 */
export async function pipelineOf(env, { company, viewer, projects, designs, stages, meta = null, nowMs = Date.now() }) {
  const out = new Map();
  // 실측 일정 (DB 0079) — 프로젝트가 하나면 그 프로젝트 것만, 없으면 표가 있는지만 본다
  const visits = await visitsOf(env, company.id, {
    projectId: projects.length === 1 ? projects[0].id : null,
    limit: projects.length ? null : '1',
  });
  if (meta) {
    meta.visit_ready = visits.ready;
    meta.order_at = new Map();
  }
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
      select: 'id,project_id,design_id,document_id,status,ordered_at,delivered_at,completed_at',
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
            select: 'id,project_id,design_id,draft_id,status,status_at',
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
        select: 'id,name,item,created_by,created_at,updated_at,project_id:summary->>projectId',
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

  // 계약금 — 접수 상태인 수주만 묻는다 (그때만 「계약금 입금 적기」가 다음 할 일이다)
  // 잔금 — 완료된 수주만 묻는다 (그때만 「잔금 입금 적기」가 다음 할 일이다)
  // 설계(품목)마다 가장 새 취소 아닌 수주 — 품목이 여럿이면 품목마다 묻는다 (프로젝트의 가장 새 수주는 늘 그 안에 있다)
  const confirmedIds = [];
  const completedIds = [];
  for (const list of liveByProject.values()) {
    const seen = new Set();
    for (const o of list) {
      const key = o.design_id || o.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (o.status === 'confirmed') confirmedIds.push(o.id);
      else if (o.status === 'completed') completedIds.push(o.id);
    }
  }
  const paymentsOf = async (ids, stage) => {
    const parts = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) parts.push(ids.slice(i, i + ID_CHUNK));
    return (
      await Promise.all(
        parts.map((part) =>
          orEmpty(
            selectMany(env, 'order_payments', {
              order_id: `in.(${part.join(',')})`,
              stage: `eq.${stage}`,
              select: 'order_id,paid_on',
              limit: ROW_LIMIT,
            })
          )
        )
      )
    ).flat();
  };
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

  // ── 품목 줄 — 프로젝트마다 초안 · 설계 · 수주를 품목으로 묶는다 (pipeline-items.js) ──
  const projectIds = new Set(projects.map((p) => p.id));
  const tracksOf = new Map();
  const trackOfDraft = new Map();
  const trackOfDesign = new Map();
  const trackOfOrder = new Map();
  const draftFact = (d) => ({ id: d.id, created_by: d.created_by || null, updated_at: d.updated_at || null });
  const addTrack = (pid, t) => {
    pushTo(tracksOf, pid, t);
    return Object.assign(t, { pid });
  };
  // 프로젝트에 이어진 초안 하나가 품목 줄 하나
  for (const d of drafts || []) {
    if (!d.project_id || !projectIds.has(d.project_id)) continue;
    trackOfDraft.set(
      d.id,
      addTrack(d.project_id, { key: `draft:${d.id}`, planner: true, at: d.created_at || d.updated_at || '', touched: d.updated_at || '', draft_id: d.id, item: d.item, name: d.name, draft: draftFact(d) })
    );
  }
  // 앱으로 보낸 설계 — 그 초안의 줄에 붙는다. 초안이 프로젝트에 안 이어져 있거나 플래너 설계가 아니면 설계가 줄 하나
  for (const d of designs) {
    if (!projectIds.has(d.project_id)) continue;
    const src = d.source === PLANNER_SOURCE && d.source_ref ? draftById.get(d.source_ref) || null : null;
    let t = src ? trackOfDraft.get(src.id) || null : null;
    if (t && (t.pid !== d.project_id || t.design_id)) t = null;
    if (!t) {
      t = addTrack(d.project_id, {
        key: `design:${d.id}`,
        planner: d.source === PLANNER_SOURCE,
        at: d.created_at || (src && src.created_at) || '',
        touched: (src && src.updated_at) || d.created_at || '',
        draft_id: src ? src.id : null,
        item: src ? src.item : null,
        name: src ? src.name : null,
        draft: src ? draftFact(src) : null,
      });
    }
    t.design_id = d.id;
    t.designName = d.name || null;
    trackOfDesign.set(d.id, t);
  }
  // 팩토리가 받은 제작 의뢰의 초안 — 그 줄이 「받은 설계」다. 줄이 아직 없으면 만든다
  for (const [pid, draftId] of bornDraftPairs(bornRows)) {
    if (!projectIds.has(pid)) continue;
    const src = draftId ? draftById.get(draftId) || null : null;
    let t = src ? trackOfDraft.get(src.id) || null : null;
    if (t && t.pid !== pid) t = null;
    if (!t && src) {
      t = addTrack(pid, { key: `draft:${src.id}`, planner: true, at: src.created_at || '', touched: src.updated_at || '', draft_id: src.id, item: src.item, name: src.name, draft: draftFact(src) });
      trackOfDraft.set(src.id, t);
    }
    if (t) t.born = true;
  }
  // 수주 — 설계마다 가장 새 취소 아닌 것. 줄이 없는 설계의 수주는 수주가 줄 하나
  for (const [pid, list] of liveByProject) {
    if (!projectIds.has(pid)) continue;
    for (const o of list) {
      let t = o.design_id ? trackOfDesign.get(o.design_id) || null : null;
      if (t && t.pid !== pid) t = null;
      if (!t) {
        t = addTrack(pid, { key: `order:${o.id}`, planner: false, at: o.ordered_at || '', touched: o.ordered_at || '', draft_id: null, item: null, name: null, draft: null });
        if (o.design_id) trackOfDesign.set(o.design_id, t);
      }
      trackOfOrder.set(o.id, t);
      if (!t.orderRow) t.orderRow = o;
    }
  }
  // 견적 — 설계마다 가장 새 살아 있는 것
  for (const d of docs || []) {
    if (d.status === 'superseded' || d.superseded_by) continue;
    const t = trackOfDesign.get(d.design_id);
    if (t && !t.quoteRow) t.quoteRow = d;
  }
  // 영업 사원의 제작 의뢰 — 그 설계 · 그 초안의 가장 새 것
  for (const r of requests || []) {
    const t = (r.design_id && trackOfDesign.get(r.design_id)) || (r.draft_id && trackOfDraft.get(r.draft_id)) || null;
    if (t && !t.request) t.request = r;
  }
  // 대표 승인 기다림 · 처리 중 A/S — 그 수주의 설계 줄에
  for (const e of events || []) {
    const o = orderById.get(e.order_id);
    const t = o ? trackOfOrder.get(o.id) || null : null;
    if (t && !t.pending) t.pending = { order_id: o.id, kind: e.kind, created_at: e.created_at };
  }
  for (const a of asRows || []) {
    const o = orderById.get(a.order_id);
    const t = o ? trackOfOrder.get(o.id) || null : null;
    if (t) t.as_open = (t.as_open || 0) + 1;
  }
  const quoteFact = (quote) => ({
    id: quote.id,
    created_at: quote.created_at,
    expires_at: quote.expires_at || null,
    first_viewed_at: quote.first_viewed_at || null,
    view_count: quote.view_count || 0,
    decision: quote.decision || null,
    decided_at: quote.decided_at || null,
  });
  const orderFact = (order) => ({
    id: order.id,
    status: order.status,
    ordered_at: order.ordered_at || null,
    delivered_at: order.delivered_at || null,
    completed_at: order.completed_at || null,
  });
  /** 그 프로젝트의 품목 줄 — 만든 차례대로, 이름이 겹치면 번호 */
  const tracksFor = (pid) => {
    const list = [...(tracksOf.get(pid) || [])].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const labels = numberLabels(list.map(trackLabelOf));
    return list.map((t, i) => ({
      key: t.key,
      label: labels[i],
      planner: t.planner === true,
      touched: t.touched || '',
      draft_id: t.draft_id || null,
      design_id: t.design_id || null,
      born: t.born === true,
      draft: t.draft || null,
      design: !!t.design_id,
      quote: t.quoteRow ? quoteFact(t.quoteRow) : null,
      order: t.orderRow ? orderFact(t.orderRow) : null,
      dead_order:
        !t.orderRow && !!t.quoteRow && t.quoteRow.decision === 'approved' && (ordersByDoc.get(t.quoteRow.id) || []).some((o) => o.status === 'cancelled'),
      deposit: t.orderRow ? depositOf.get(t.orderRow.id) || null : null,
      balance: t.orderRow ? balanceOf.get(t.orderRow.id) || null : null,
      request: t.request || null,
      pending: t.pending || null,
      as_open: t.as_open || 0,
    }));
  };

  for (const p of projects) {
    const order = (liveByProject.get(p.id) || [])[0] || null;
    const quote = quoteOf.get(p.id) || null;
    const born = bornDraft.has(p.id);
    const draft = draftOf.get(p.id) || (born ? draftById.get(bornDraft.get(p.id)) : null) || null;
    const visit = visits.byProject.get(p.id) || null;
    if (meta && order && order.ordered_at) meta.order_at.set(p.id, { ordered_at: order.ordered_at });
    const facts = {
      id: p.id,
      status: p.status,
      assignee_id: p.assignee_id || null,
      visit_ready: visits.ready,
      visit: visit
        ? { id: visit.id, status: visit.status, scheduled_at: visit.scheduled_at || null, done_at: visit.done_at || null }
        : null,
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
    // 품목이 둘 이상이면 가장 늦은 품목 줄이 프로젝트의 단계 · 다음 할 일이다. 하나(또는 없음)면 예전 그대로
    const tracks = tracksFor(p.id);
    const plannerTracks = tracks.filter((t) => t.planner);
    let step = stepOf(facts);
    let next = nextStep(facts, viewer, nowMs);
    let items = [];
    if (plannerTracks.length > 1) {
      const multi = itemsOf(facts, tracks, viewer, nowMs);
      step = multi.step;
      next = multi.next;
      items = multi.items;
      // 머문 날(계약) — 프로젝트 값을 낸 줄의 수주로 잰다
      if (meta) {
        if (multi.lead && multi.lead.order && multi.lead.order.ordered_at) meta.order_at.set(p.id, { ordered_at: multi.lead.order.ordered_at });
        else meta.order_at.delete(p.id);
      }
    } else if (plannerTracks.length === 1) {
      const t = plannerTracks[0];
      items = [{ key: t.key, label: t.label, step, step_label: STEP_LABEL[step], next, draft_id: t.draft_id, design_id: t.design_id, order_id: order ? order.id : null }];
    }
    out.set(p.id, {
      step,
      next,
      // 품목 줄 — 품목마다 { key, label, step, step_label, next, draft_id, design_id, order_id } (품목이 없으면 칸 자체가 없다)
      ...(items.length ? { items } : {}),
      ...(depositPaid.has(p.id) ? { deposit_paid: true } : {}),
      // 실측 일정 줄 그대로 — company-projects.js projectRow 가 화면 꼴로 다듬는다 (표가 없으면 칸 자체가 없다)
      ...(visits.ready ? { visit } : {}),
    });
  }
  return out;
}
