/**
 * 받은 일 — 프로젝트 관리 대시보드 맨 위 「새로 생긴 일」 (2026-11-21 대표님 「새롭게 발생 된 일을 표로 만들어서
 * 제일 위에 표시 해주고 그다음에 달력을 표시」 · 질문 창에서 고르심 「할 일 + 소식」 — 승인 계획 「프로젝트 한 길」).
 *
 *   GET /company/inbox   프로젝트를 가지는 업체(다담 공장 · active 협력업체 Manager · Expert · Agent)의 active 구성원
 *     { role,
 *       todo [{ kind, label, count, go, due?, late?, total? }],
 *       news [{ kind, at, label, go, project { id, title } | null, who? }],   who { kind, name } = 누가 했나 (일지가 있는 일만)
 *       seen_at? }   이 계정이 소식을 어디까지 봤나 (없으면 null). DB 0078 전이면 칸이 없다 — 화면이 기기 기억으로 돌아간다
 *   POST /company/inbox/seen { at }   소식을 본 때를 적는다 — 내 계정 · 내 업체의 한 줄. 본 때는 앞으로만 간다 → { seen_at }
 *     (2026-11-21 뒤 공정 1차 「계정마다 읽음」 — 폰에서 본 것이 PC 에서 다시 「새」로 뜨지 않게)
 *
 * todo — 프로젝트에 매이지 않은 할 일의 묶음이다 (수만 센다).
 *        프로젝트마다의 다음 할 일은 화면이 GET /company/projects 의 next 로 만든다 — 줄과 표가 같은 값을 써서 어긋나지 않는다.
 *   consult   답을 기다리는 배정 상담 (팩토리 · 대표 · 실장) — due = 가장 이른 답 기한
 *   offer     답을 기다리는 제작 의뢰 (받는 팩토리 · 대표 · 실장) — due = 가장 이른 답 기한
 *   choose    본사 추천이 온 제작 의뢰 (Manager 업체 · 대표 · 실장)
 *   approval  승인을 기다리는 수주 요청 (대표)
 *   as        아직 받지 않은 A/S 접수 (팩토리 · 대표 · 실장)
 *   due       받을 날이 오늘이거나 지난 수금 (대표 · 실장) — late = 지난 건수, total = 합계
 * news — 지난 NEWS_DAYS 일 동안 일어난 일, 새 것부터 NEWS_LIMIT 줄. 각 표의 시각 칸에서 뽑고 프로젝트 일지
 *        (project_events, DB 0078 — project-history.js)를 얹는다: 일지가 있는 일에는 「누가」가 붙고,
 *        보류 · 생산 시작 · 수주 취소 · 돈 들어옴 같은 일도 나온다. 구성원 누구나 본다.
 *   상담 배정 · 견적 보냄 / 고객이 열어 봄(처음) / 고객 승인 · 수정 요청 · 수주 생김 / 배송 / 완료 ·
 *   제작 의뢰 상태(본사 추천 · 팩토리 받음 · 못 받음 · 답 없음) · A/S 접수 · 수주 요청 승인 / 반려
 *
 * 싣지 않는 것: 고객 이름 · 전화 · 주소, 금액(받을 돈 합계 total 만 대표 · 실장에게).
 * go 는 화면 이름이다 (p-consult · p-quote · p-contract · p-collect · p-make · p-as) — 주소는 화면이 만든다.
 * GET 은 읽기만 한다. 표가 아직 없으면(DB 적용 전) 그 칸만 빈다.
 */

import {
  ConflictError,
  MONEY_ROLES,
  PG_UNIQUE_VIOLATION,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { isFactory } from './company-pipeline.js';
import { briefKeysFor, loadBrief } from './brief.js';
import { expiresAtOf, offerState } from './production-requests/common.js';
import { isMissingRelation } from './work-order-data.js';
import { membersOf } from './company-assignee.js';
import { EVENT_LABEL, mergeEvents } from './project-history.js';

/** 소식에 따로 내지 않는 일지 (자주 일어나거나 프로젝트 창에서 보면 되는 것) */
const NEWS_SKIP = Object.freeze([
  'design_sent',
  'design_unlinked',
  'document_issued',
  'document_revoked',
  'assignee_set',
  'assignee_cleared',
  'design_started',
  // 일정 날짜를 바꾼 것 — 달력에서 보면 된다 (잡음 · 취소는 소식에 낸다)
  ...Object.keys(EVENT_LABEL).filter((k) => k.startsWith('schedule_moved_')),
]);

/** 소식을 돌아보는 날수 · 줄 수 */
export const NEWS_DAYS = 14;
export const NEWS_LIMIT = 20;
/** 한 표에서 읽는 행 수 */
const ROW_LIMIT = '200';
const DAY_MS = 24 * 3600 * 1000;

export const TODO_LABEL = Object.freeze({
  consult: '새 상담 받기',
  offer: '제작 의뢰 답하기',
  choose: '팩토리 고르기',
  approval: '수주 요청 승인 · 반려',
  as: 'A/S 접수 받기',
  due: '받을 돈 확인',
});
export const NEWS_LABEL = Object.freeze({
  consult_assigned: '새 상담이 배정됐습니다',
  quote_sent: '견적서를 보냈습니다',
  quote_viewed: '고객이 견적을 열어 봤습니다',
  quote_approved: '고객이 견적을 승인했습니다',
  quote_rejected: '고객이 견적 수정을 요청했습니다',
  order_created: '계약(수주)이 생겼습니다',
  order_delivered: '배송으로 넘어갔습니다',
  order_completed: '설치가 끝났습니다',
  request_recommended: '본사 추천이 도착했습니다',
  request_accepted: '팩토리가 제작 의뢰를 받았습니다',
  request_declined: '팩토리가 제작 의뢰를 못 받았습니다',
  request_expired: '팩토리가 제작 의뢰에 답하지 않았습니다',
  request_received: '제작 의뢰를 받았습니다',
  as_requested: 'A/S 가 접수됐습니다',
  approval_approved: '수주 요청이 승인됐습니다',
  approval_rejected: '수주 요청이 반려됐습니다',
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

/** 이 계정이 본 때 — 없으면 null, 표가 아직 없으면(DB 0078 전) undefined */
async function seenOf(env, userId, companyId) {
  try {
    const row = await selectOne(env, 'inbox_seen', {
      user_id: `eq.${userId}`,
      company_id: `eq.${companyId}`,
      select: 'seen_at',
    });
    return row && row.seen_at ? row.seen_at : null;
  } catch (e) {
    if (isMissingRelation(e)) return undefined;
    throw e;
  }
}

/** POST /company/inbox/seen { at } → { seen_at } */
export async function markInboxSeen(env, { user, body, nowMs = Date.now() }) {
  const raw = body && typeof body.at === 'string' ? Date.parse(body.at) : NaN;
  if (!Number.isFinite(raw)) throw new ValidationError('at 이 올바르지 않습니다 (시각)', { field: 'at' });
  const { company } = await projectCompanyOf(env, user);
  // 앞날은 지금으로 당긴다 — 시계가 빠른 기기가 다음 소식을 가리지 않게
  const at = new Date(Math.min(raw, nowMs)).toISOString();
  const current = await seenOf(env, user.id, company.id);
  if (current === undefined) {
    const err = new ConflictError('DB 0078 적용 전입니다 — 읽음은 이 기기가 기억합니다');
    err.code = 'db_pending';
    throw err;
  }
  // 본 때는 앞으로만 간다 (DB 지킴이도 같은 것을 지킨다)
  if (current && Date.parse(current) >= Date.parse(at)) return { seen_at: current };
  const where = { user_id: `eq.${user.id}`, company_id: `eq.${company.id}` };
  if (current === null) {
    try {
      await insertOne(env, 'inbox_seen', { user_id: user.id, company_id: company.id, seen_at: at });
      return { seen_at: at };
    } catch (e) {
      // 다른 기기가 방금 먼저 넣었다 — 고치기로 넘어간다
      if (!String((e && e.message) || '').includes(PG_UNIQUE_VIOLATION)) throw e;
    }
  }
  await updateBy(env, 'inbox_seen', where, { seen_at: at });
  return { seen_at: at };
}

/** GET /company/inbox */
export async function getCompanyInbox(env, { user, nowMs = Date.now() }) {
  const { company, role } = await projectCompanyOf(env, user);
  const manage = MONEY_ROLES.includes(role);
  const factory = isFactory(company);
  const co = `eq.${company.id}`;
  const since = new Date(nowMs - NEWS_DAYS * DAY_MS).toISOString();
  const recent = (iso) => typeof iso === 'string' && iso >= since && Date.parse(iso) <= nowMs + DAY_MS;
  // 대표 · 실장의 볼 것 수 — 아침 브리핑과 같은 셈 (brief.js). 영업 사원 업체는 배정 상담이 없다
  const keys = briefKeysFor(role).filter(
    (k) => k === 'receivables' || k === 'requests' || (k === 'consults' && factory)
  );

  const [seen, events, brief, projects, designs, orders, assigned, requests, offers, received, asRows, decided] = await Promise.all([
    seenOf(env, user.id, company.id),
    // 프로젝트 일지 — 지난 14일 (DB 0078 전이면 없다)
    orEmpty(
      selectMany(env, 'project_events', {
        company_id: co,
        created_at: `gte.${since}`,
        select: 'id,project_id,actor_user_id,actor_kind,type,subject_type,subject_id,from_status,to_status,payload,created_at',
        order: 'created_at.desc',
        limit: ROW_LIMIT,
      })
    ),
    keys.length ? loadBrief(env, company.id, { nowMs, keys }) : {},
    selectMany(env, 'projects', { company_id: co, select: 'id,title', order: 'created_at.desc', limit: ROW_LIMIT }),
    selectMany(env, 'designs', { company_id: co, select: 'id,project_id', order: 'updated_at.desc', limit: ROW_LIMIT }),
    selectMany(env, 'orders', {
      company_id: co,
      select: 'id,project_id,status,ordered_at,delivered_at,completed_at',
      order: 'ordered_at.desc',
      limit: ROW_LIMIT,
    }),
    factory
      ? selectMany(env, 'consult_assignments', {
          company_id: co,
          assigned_at: `gte.${since}`,
          select: 'id,assigned_at',
          order: 'assigned_at.desc',
          limit: ROW_LIMIT,
        })
      : [],
    // 영업 사원 업체 — 내가 낸 제작 의뢰 (거둔 것 뺌)
    factory
      ? []
      : orEmpty(
          selectMany(env, 'production_requests', {
            company_id: co,
            status: 'neq.cancelled',
            select: 'id,project_id,status,status_at',
            order: 'status_at.desc',
            limit: ROW_LIMIT,
          })
        ),
    // 받는 팩토리 — 나를 고른 제작 의뢰 가운데 아직 답하지 않은 것
    factory && manage
      ? orEmpty(
          selectMany(env, 'production_recommendations', {
            company_id: co,
            chosen: 'eq.true',
            response: 'is.null',
            select: 'request_id,company_id,round,chosen,chosen_at,expires_at,response',
            limit: ROW_LIMIT,
          })
        )
      : [],
    // 받는 팩토리 — 내가 받은 제작 의뢰 (소식)
    factory
      ? orEmpty(
          selectMany(env, 'production_requests', {
            factory_company_id: co,
            status: 'eq.accepted',
            select: 'id,factory_project_id,status,status_at',
            order: 'status_at.desc',
            limit: ROW_LIMIT,
          })
        )
      : [],
    factory
      ? orEmpty(
          selectMany(env, 'as_requests', {
            company_id: co,
            select: 'id,order_id,state,created_at',
            order: 'created_at.desc',
            limit: ROW_LIMIT,
          })
        )
      : [],
    selectMany(env, 'order_events', {
      company_id: co,
      state: 'in.(approved,rejected)',
      decided_at: `gte.${since}`,
      select: 'id,order_id,state,decided_at',
      order: 'decided_at.desc',
      limit: ROW_LIMIT,
    }),
  ]);

  const projectOf = new Map((projects || []).map((p) => [p.id, { id: p.id, title: p.title || null }]));
  const projectRef = (id) => (id && projectOf.has(id) ? projectOf.get(id) : null);
  const orderOf = new Map((orders || []).map((o) => [o.id, o]));

  // 견적(고객 확인서) — 최근에 고친 설계의 문서만 (company-quotes.js 와 같은 범위)
  const designIds = (designs || []).map((d) => d.id);
  const projectOfDesign = new Map((designs || []).map((d) => [d.id, d.project_id || null]));
  const docs = designIds.length
    ? (await selectMany(env, 'design_documents', {
        design_id: `in.(${designIds.join(',')})`,
        doc_type: 'eq.customer_confirmation',
        status: 'neq.revoked',
        select: 'id,design_id,decision,decided_at,first_viewed_at,created_at',
        order: 'created_at.desc',
        limit: ROW_LIMIT,
      })) || []
    : [];
  // 답을 기다리는 제작 의뢰 — 의뢰가 아직 「팩토리 답 기다림」이고 기한이 남은 것만
  const offerIds = [...new Set((offers || []).map((r) => r.request_id).filter(Boolean))];
  const offerReqs = offerIds.length
    ? await orEmpty(
        selectMany(env, 'production_requests', {
          id: `in.(${offerIds.join(',')})`,
          select: 'id,status,round,factory_company_id',
        })
      )
    : [];
  const offerReqOf = new Map(offerReqs.map((r) => [r.id, r]));
  const openOffers = (offers || [])
    .filter((rec) => offerState(rec, offerReqOf.get(rec.request_id)) === 'open')
    .map((rec) => expiresAtOf(rec))
    .filter((exp) => !(Date.parse(exp || '') <= nowMs));

  // ── 할 일 (묶음) ──
  const todo = [];
  const add = (kind, count, go, extra = {}) => {
    if (count > 0) todo.push({ kind, label: TODO_LABEL[kind], count, go, ...extra });
  };
  if (brief.consults) add('consult', brief.consults.count, 'p-consult', { due: brief.consults.next_deadline || null });
  if (openOffers.length) add('offer', openOffers.length, 'p-make', { due: openOffers.filter(Boolean).sort()[0] || null });
  if (manage) add('choose', (requests || []).filter((r) => r.status === 'recommended').length, 'p-make');
  if (brief.requests) add('approval', brief.requests.count, 'p-contract');
  if (manage) add('as', (asRows || []).filter((a) => a.state === 'requested').length, 'p-as');
  if (brief.receivables)
    add('due', brief.receivables.count, 'p-collect', { late: brief.receivables.late_count, total: brief.receivables.total });
  // 기한이 있는 것이 먼저(이른 것부터), 그다음 넣은 차례
  todo.sort((a, b) => (a.due && b.due ? String(a.due).localeCompare(String(b.due)) : a.due ? -1 : b.due ? 1 : 0));

  // ── 소식 ──
  // 뽑은 줄 — 각 표의 시각 칸에서 (ref = 그 일의 대상 id, 일지와 짝짓는 데만 쓴다)
  const derived = [];
  const tell = (kind, at, go, projectId, ref = null) => {
    if (recent(at)) derived.push({ kind, at, label: NEWS_LABEL[kind], go, project: projectRef(projectId), ref });
  };
  for (const a of assigned || []) tell('consult_assigned', a.assigned_at, 'p-consult', null);
  for (const d of docs) {
    const pid = projectOfDesign.get(d.design_id);
    tell('quote_sent', d.created_at, 'p-quote', pid, d.id);
    tell('quote_viewed', d.first_viewed_at, 'p-quote', pid, d.id);
    if (d.decision === 'approved') tell('quote_approved', d.decided_at, 'p-quote', pid, d.id);
    if (d.decision === 'rejected') tell('quote_rejected', d.decided_at, 'p-quote', pid, d.id);
  }
  for (const o of orders || []) {
    tell('order_created', o.ordered_at, 'p-contract', o.project_id, o.id);
    if (o.status !== 'cancelled') {
      tell('order_delivered', o.delivered_at, 'p-install', o.project_id, o.id);
      tell('order_completed', o.completed_at, 'p-install', o.project_id, o.id);
    }
  }
  for (const r of requests || []) {
    if (['recommended', 'accepted', 'declined', 'expired'].includes(r.status))
      tell(`request_${r.status}`, r.status_at, 'p-make', r.project_id, r.id);
  }
  for (const r of received || []) tell('request_received', r.status_at, 'p-make', r.factory_project_id, r.id);
  for (const a of asRows || []) tell('as_requested', a.created_at, 'p-as', (orderOf.get(a.order_id) || {}).project_id, a.id);
  for (const e of decided || [])
    tell(`approval_${e.state}`, e.decided_at, 'p-contract', (orderOf.get(e.order_id) || {}).project_id, e.order_id);
  // 일지를 얹는다 — 같은 일에는 「누가」를 붙이고, 일지에만 있는 일(보류 · 생산 시작 · 돈 들어옴 …)은 줄을 더한다
  const memberOf =
    events.length > 0 ? new Map((await membersOf(env, company.id)).map((m) => [m.user_id, m])) : new Map();
  const news = mergeEvents(derived, events, {
    memberOf,
    labelOf: (kind) => NEWS_LABEL[kind] || EVENT_LABEL[kind],
    extra: (ev) => ({ project: projectRef(ev.project_id) }),
    skip: NEWS_SKIP,
  });
  news.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return { role, todo, news: news.slice(0, NEWS_LIMIT), ...(seen === undefined ? {} : { seen_at: seen }) };
}
