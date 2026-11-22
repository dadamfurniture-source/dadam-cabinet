/**
 * 프로젝트 한 건 — 처음부터 끝까지 한 창에서 (2026-11-21 대표님 승인 계획 「프로젝트 한 길」 묶음 4).
 * 대표님 「모든 공정이 자연 스럽게 이어지도록」 — 프로젝트 줄의 단계 띠 · 다음 할 일에 더해, 지나온 일을 한 번에 본다.
 *
 *   GET /company/projects/:id   내 업체 프로젝트 하나 (active 구성원)
 *     { role, can_manage,
 *       actions  { hold, cancel, resume, blocked }             보류 · 그만둠 · 다시 진행을 할 수 있나 (company-project-status.js statusActions —
 *                                                              계약금을 받은 프로젝트는 hold · cancel 이 false, blocked 'deposit'). DB 0078 전이면 모두 false
 *       project  목록 줄과 같은 칸 (company-projects.js projectRow — 단계 step · 다음 할 일 next 포함),
 *       designs  [{ id, name, updated_at }]                      이어진 설계, 최근 고친 것부터
 *       quotes   [{ id, design_id, created_at, expires_at, first_viewed_at, view_count, decision, decided_at }]
 *                                                              견적서(고객 확인서), 새 것부터 (거둔 것 · 새 판에 밀린 것 뺌)
 *       orders   [{ id, order_no, status, ordered_at, delivered_at, completed_at, deposit, balance }]
 *                                                              수주(취소 포함), 새 것부터. deposit · balance = 'paid' | 'unpaid' | null
 *                                                              (계약금 줄 · 잔금 줄이 입금됐나 — 줄이 없으면 null, 금액은 싣지 않는다)
 *       requests [{ id, status, status_at }]                     영업 사원 업체가 낸 제작 의뢰 (거둔 것 뺌)
 *       as       [{ id, state, created_at, received_at, done_at }]  팩토리의 A/S 접수
 *       history  [{ kind, at, label, go, who? }]                 일어난 일 — 오래된 것부터 (처음 → 지금).
 *                                                              who { kind, name } = 누가 했나 (일지 project_events 가 있는 일만 — DB 0078 뒤의 일)
 *       stages   [{ key, label, state, from, to, days }] }       단계 띠 — 단계마다 들어간 때 · 나간 때 · 걸린 날 (company-project-stage.js timelineOf.
 *                                                              state done | now | todo, 지금 단계의 days 는 오늘까지 머문 날). 단계의 사진 · 문서는
 *                                                              GET /company/projects/:id/stages/:key 가 따로 준다
 *
 * 싣지 않는 것: 금액 · 주소 · A/S 글과 사진 · 견적 내용. 고객 이름 · 전화는 프로젝트 목록과 같다 (구성원이 이미 보는 값).
 * history 는 각 표의 시각 칸에서 뽑고, 프로젝트 일지(project_events — project-history.js)를 얹는다:
 * 일지가 있는 일에는 「누가」가 붙고, 시각 칸에서 못 뽑는 일(보류 · 생산 시작 · 수주 취소 · 담당자 …)과 여러 번 바뀐 것도 남는다.
 * 일지가 생기기 전의 일은 지금처럼 「누가」 없이 마지막 모습만 나온다.
 * go 는 화면 이름이다 (p-quote · p-contract · p-make · p-install · p-as) — 주소는 화면이 만든다.
 * 읽기만 한다. 다른 업체의 프로젝트 · 없는 프로젝트는 404. 표가 아직 없으면(DB 적용 전) 그 칸만 빈다.
 */

import { NotFoundError, ValidationError, selectMany, selectOne } from './supabase.js';
import {
  PROJECT_COLUMNS,
  PROJECT_COLUMNS_HOLD,
  projectCompanyOf,
  projectRow,
  stagesOf,
} from './company-projects.js';
import { statusActions } from './company-project-status.js';
import { isFactory, pipelineOf } from './company-pipeline.js';
import { membersOf } from './company-assignee.js';
import { isMissingRelation } from './work-order-data.js';
import { NEWS_LABEL } from './company-inbox.js';
import { EVENT_LABEL, mergeEvents } from './project-history.js';
import { timelineOf } from './company-project-stage.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 한 프로젝트에서 읽는 행 수 */
const ROW_LIMIT = '100';
/** 한 프로젝트에서 읽는 일지 줄 수 */
const EVENT_LIMIT = '300';

/** 일어난 일의 글 — 받은 일의 소식(company-inbox.js NEWS_LABEL)과 같은 말 + 프로젝트 창에만 있는 것 */
export const HISTORY_LABEL = Object.freeze({
  ...NEWS_LABEL,
  ...EVENT_LABEL,
  project_created: '프로젝트가 생겼습니다',
  design_linked: '설계가 이어졌습니다',
  as_received: 'A/S 접수를 받았습니다',
  as_done: 'A/S 를 끝냈습니다',
});

/** 표가 아직 없으면(DB 적용 전) 빈 목록 — 그 밖의 오류는 그대로 던진다 */
async function orEmpty(promise) {
  try {
    return (await promise) || [];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/** GET /company/projects/:id */
export async function getCompanyProject(env, { user, projectId, nowMs = Date.now() }) {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId))
    throw new ValidationError('프로젝트 번호가 올바르지 않습니다');
  const { company, canAct, role } = await projectCompanyOf(env, user);
  const co = `eq.${company.id}`;
  const one = (cols) =>
    selectOne(env, 'projects', { id: `eq.${projectId}`, company_id: co, select: cols });
  // 보류 칸(DB 0078) · 담당자 칸(DB 0042) — 적용 전이면 그 칸 없이
  let project;
  let holdReady = true;
  try {
    project = await one(PROJECT_COLUMNS_HOLD);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    holdReady = false;
    try {
      project = await one(PROJECT_COLUMNS);
    } catch (e2) {
      if (!isMissingRelation(e2)) throw e2;
      project = await one('id,customer_id,title,status,created_at,closed_at');
    }
  }
  if (!project) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  const factory = isFactory(company);
  const pid = `eq.${project.id}`;

  const [members, customer, designs, orders, requests, received] = await Promise.all([
    membersOf(env, company.id),
    project.customer_id
      ? selectOne(env, 'customers', {
          id: `eq.${project.customer_id}`,
          company_id: co,
          select: 'id,name,phone',
        })
      : null,
    selectMany(env, 'designs', {
      project_id: pid,
      company_id: co,
      select: 'id,project_id,name,source,source_ref,created_at,updated_at',
      order: 'updated_at.desc',
      limit: ROW_LIMIT,
    }),
    selectMany(env, 'orders', {
      project_id: pid,
      company_id: co,
      select: 'id,order_no,status,ordered_at,delivered_at,completed_at',
      order: 'ordered_at.desc,created_at.desc',
      limit: ROW_LIMIT,
    }),
    factory
      ? []
      : orEmpty(
          selectMany(env, 'production_requests', {
            project_id: pid,
            company_id: co,
            status: 'neq.cancelled',
            select: 'id,status,status_at',
            order: 'status_at.desc',
            limit: ROW_LIMIT,
          })
        ),
    factory
      ? orEmpty(
          selectMany(env, 'production_requests', {
            factory_project_id: pid,
            factory_company_id: co,
            status: 'eq.accepted',
            select: 'id,status_at',
            limit: ROW_LIMIT,
          })
        )
      : [],
  ]);
  const designList = designs || [];
  const orderList = orders || [];
  const designIds = designList.map((d) => d.id);
  const orderIds = orderList.map((o) => o.id);
  const inOrders = `in.(${orderIds.join(',')})`;

  const [stages, docs, payments, asRows, decided, events, visits, starts] = await Promise.all([
    stagesOf(env, company.id, [project.id], designList),
    designIds.length
      ? selectMany(env, 'design_documents', {
          design_id: `in.(${designIds.join(',')})`,
          doc_type: 'eq.customer_confirmation',
          status: 'neq.revoked',
          select:
            'id,design_id,status,decision,decided_at,first_viewed_at,view_count,expires_at,superseded_by,created_at',
          order: 'created_at.desc',
          limit: ROW_LIMIT,
        })
      : [],
    orderIds.length
      ? orEmpty(
          selectMany(env, 'order_payments', {
            order_id: inOrders,
            stage: 'in.(deposit,balance)',
            select: 'order_id,stage,paid_on',
            limit: ROW_LIMIT,
          })
        )
      : [],
    factory && orderIds.length
      ? orEmpty(
          selectMany(env, 'as_requests', {
            order_id: inOrders,
            company_id: co,
            select: 'id,order_id,state,created_at,received_at,done_at',
            order: 'created_at.desc',
            limit: ROW_LIMIT,
          })
        )
      : [],
    orderIds.length
      ? selectMany(env, 'order_events', {
          order_id: inOrders,
          company_id: co,
          state: 'in.(approved,rejected)',
          select: 'id,order_id,state,decided_at',
          limit: ROW_LIMIT,
        })
      : [],
    // 프로젝트 일지 — 누가 · 언제 · 무엇 (DB 0078 전이면 없다)
    orEmpty(
      selectMany(env, 'project_events', {
        project_id: pid,
        company_id: co,
        select:
          'id,actor_user_id,actor_kind,type,subject_type,subject_id,from_status,to_status,payload,created_at',
        order: 'created_at.asc',
        limit: EVENT_LIMIT,
      })
    ),
    // 단계 띠에 적을 때 — 실측을 잡은 때 · 끝낸 때 (DB 0079 전이면 없다), 생산을 시작한 때 (수주 상태 기록)
    orEmpty(
      selectMany(env, 'project_visits', {
        project_id: pid,
        company_id: co,
        status: 'neq.cancelled',
        select: 'status,done_at,created_at',
        order: 'created_at.asc',
        limit: '1',
      })
    ),
    orderIds.length
      ? selectMany(env, 'order_events', {
          order_id: inOrders,
          company_id: co,
          kind: 'eq.status',
          to_status: 'eq.in_production',
          state: 'in.(done,approved)',
          select: 'order_id,state,created_at,decided_at',
          order: 'created_at.asc',
          limit: ROW_LIMIT,
        }).catch(() => [])
      : [],
  ]);

  // 지금 단계 · 다음 할 일 — 덧붙이는 값이라, 못 모아도 나머지는 그대로 준다 (목록과 같다)
  let flow = new Map();
  try {
    flow = await pipelineOf(env, {
      company,
      viewer: { role, user_id: user.id },
      projects: [project],
      designs: designList,
      stages,
      nowMs,
    });
  } catch (e) {
    console.error('company project: pipeline failed —', e && e.message);
  }

  // 계약금 줄 — 입금일('' = 줄은 있는데 아직). 잔금 줄 — 받은 날들과, 안 받은 줄이 남았나
  const depositOf = new Map();
  const balanceOf = new Map();
  for (const p of payments || []) {
    if (p.stage === 'balance') {
      const b = balanceOf.get(p.order_id) || { paid: [], unpaid: false };
      if (p.paid_on) b.paid.push(p.paid_on);
      else b.unpaid = true;
      balanceOf.set(p.order_id, b);
    } else if (p.paid_on) depositOf.set(p.order_id, p.paid_on);
    else if (!depositOf.has(p.order_id)) depositOf.set(p.order_id, '');
  }
  const quotes = (docs || []).filter((d) => d.status !== 'superseded' && !d.superseded_by);

  // ── 일어난 일 (오래된 것부터) ──
  // 뽑은 줄 — 각 표의 시각 칸에서 (ref = 그 일의 대상 id, 일지와 짝짓는 데만 쓴다)
  const derived = [];
  const tell = (kind, at, go = null, ref = null) => {
    if (typeof at === 'string' && at)
      derived.push({ kind, at, label: HISTORY_LABEL[kind], go, ref });
  };
  tell('project_created', project.created_at, null, project.id);
  for (const d of designList) tell('design_linked', d.created_at, null, d.id);
  for (const d of quotes) {
    tell('quote_sent', d.created_at, 'p-quote', d.id);
    tell('quote_viewed', d.first_viewed_at, 'p-quote', d.id);
    if (d.decision === 'approved') tell('quote_approved', d.decided_at, 'p-quote', d.id);
    if (d.decision === 'rejected') tell('quote_rejected', d.decided_at, 'p-quote', d.id);
  }
  for (const o of orderList) {
    tell('order_created', o.ordered_at, 'p-contract', o.id);
    if (depositOf.get(o.id)) tell('deposit_paid', depositOf.get(o.id), 'p-contract', o.id);
    for (const day of (balanceOf.get(o.id) || { paid: [] }).paid)
      tell('balance_paid', day, 'p-contract', o.id);
    if (o.status !== 'cancelled') {
      tell('order_delivered', o.delivered_at, 'p-install', o.id);
      tell('order_completed', o.completed_at, 'p-install', o.id);
    }
  }
  for (const r of requests || []) {
    if (['recommended', 'accepted', 'declined', 'expired'].includes(r.status))
      tell(`request_${r.status}`, r.status_at, 'p-make', r.id);
  }
  for (const r of received || []) tell('request_received', r.status_at, 'p-make', r.id);
  for (const a of asRows || []) {
    tell('as_requested', a.created_at, 'p-as', a.id);
    tell('as_received', a.received_at, 'p-as', a.id);
    tell('as_done', a.done_at, 'p-as', a.id);
  }
  for (const e of decided || [])
    tell(`approval_${e.state}`, e.decided_at, 'p-contract', e.order_id);
  // 일지를 얹는다 — 같은 일에는 「누가」를 붙이고, 일지에만 있는 일은 줄을 더한다
  const memberOf = new Map(members.map((m) => [m.user_id, m]));
  const history = mergeEvents(derived, events, {
    memberOf,
    labelOf: (kind) => HISTORY_LABEL[kind],
  });
  // 날짜만 있는 칸(입금일)은 그날의 끝으로 친다 — 같은 날 생긴 수주보다 뒤에 온다
  const key = (at) => (at.length === 10 ? `${at}T23:59:59` : at);
  history.sort((a, b) => key(a.at).localeCompare(key(b.at)));

  // 보류 · 그만둠을 할 수 있나 — 취소 아닌 수주와 그 계약금으로 (서버가 거절하는 조건과 같은 함수)
  const liveOrders = orderList.filter((o) => o.status !== 'cancelled');
  const actions = holdReady
    ? statusActions(
        project,
        { role, user_id: user.id },
        { live: liveOrders.length, deposit: liveOrders.some((o) => !!depositOf.get(o.id)) }
      )
    : { hold: false, cancel: false, resume: false, blocked: null };
  // 단계 띠 — 단계마다 들어간 때 · 나간 때 · 걸린 날. 때는 각 표의 시각 칸에서 뽑는다 (가장 이른 것)
  const first = (list, at) => list.map(at).filter(Boolean).sort()[0] || null;
  const firstOrder = liveOrders.slice().sort((a, b) => String(a.ordered_at || '').localeCompare(String(b.ordered_at || '')))[0] || null;
  const nowFlow = flow.get(project.id) || {};
  const timeline = timelineOf(
    {
      step: nowFlow.step,
      visit_ready: nowFlow.visit !== undefined,
      created_at: project.created_at,
      closed_at: project.closed_at || null,
      since: (nowFlow.next && nowFlow.next.since) || null,
      visit: (visits || [])[0] || null,
      design_at: first(designList, (d) => d.created_at),
      quote_at: first(docs || [], (d) => d.created_at),
      order: firstOrder,
      make_at: firstOrder
        ? first((starts || []).filter((e) => e.order_id === firstOrder.id), (e) => (e.state === 'approved' ? e.decided_at || e.created_at : e.created_at))
        : null,
    },
    nowMs
  );
  return {
    role,
    can_manage: canAct,
    actions,
    project: projectRow(project, {
      customer,
      designCount: designList.length,
      stage: stages.get(project.id),
      flow: flow.get(project.id),
      memberOf,
    }),
    designs: designList.map((d) => ({
      id: d.id,
      name: d.name || null,
      updated_at: d.updated_at || null,
    })),
    quotes: quotes.map((d) => ({
      id: d.id,
      design_id: d.design_id,
      created_at: d.created_at,
      expires_at: d.expires_at || null,
      first_viewed_at: d.first_viewed_at || null,
      view_count: d.view_count || 0,
      decision: d.decision || null,
      decided_at: d.decided_at || null,
    })),
    orders: orderList.map((o) => ({
      id: o.id,
      order_no: o.order_no || null,
      status: o.status,
      ordered_at: o.ordered_at || null,
      delivered_at: o.delivered_at || null,
      completed_at: o.completed_at || null,
      deposit: depositOf.has(o.id) ? (depositOf.get(o.id) ? 'paid' : 'unpaid') : null,
      balance: balanceOf.has(o.id) ? (balanceOf.get(o.id).unpaid ? 'unpaid' : 'paid') : null,
    })),
    requests: (requests || []).map((r) => ({
      id: r.id,
      status: r.status,
      status_at: r.status_at || null,
    })),
    as: (asRows || []).map((a) => ({
      id: a.id,
      state: a.state,
      created_at: a.created_at,
      received_at: a.received_at || null,
      done_at: a.done_at || null,
    })),
    history,
    stages: timeline,
  };
}
