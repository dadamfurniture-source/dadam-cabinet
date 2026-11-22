/**
 * 업체 고객 · 프로젝트 — 상담 없이 온 고객(전화 · 방문)도 업체가 고객 · 프로젝트를 만들고, 설계를 프로젝트에 잇는다.
 * 프로젝트를 가질 수 있는 업체: 다담 공장(hq) · active 협력업체(plan manager · expert · agent). 다담 본사(platform)는 아니다
 * — 프로젝트 저장은 Manager 이상이고 (2026-11-08, DB 0047), 협력업체는 plan 이 곧 등급이다.
 *   plan 의 manager 는 등급이다 — company_members.role 의 manager(실장)와 다르다.
 *
 *   GET  /company/projects       내 업체 프로젝트 목록 (active 구성원) — 고객 이름 · 전화, 이어진 설계 수, 담당자, 최신 200개
 *                                + 지금 구성원 members [{ user_id, name, role }] (담당자 고르기 — src/company-assignee.js, DB 0042)
 *                                + 프로젝트마다 단계 stage (projects.js projectStage — 고객 「내 프로젝트」와 같은 계산) ·
 *                                최신 수주 order { id, order_no, status } (취소 수주 뺌) — 마이페이지 프로젝트 관리가 단계로 거른다
 *                                + 지금 단계 step · 다음 할 일 next { key, label, go, act?, wait, since, allowed }
 *                                (pipeline.js — 2026-11-21 「프로젝트 한 길」. 값은 company-pipeline.js 가 모은다.
 *                                못 모았으면 두 칸 없이 준다 — 화면은 stage 로 그린다) · 내 직책 role
 *   GET  /company/projects/:id   프로젝트 하나 — 같은 줄 + 설계 · 견적 · 수주 · 의뢰 · A/S · 일어난 일 (src/company-project.js)
 *   PATCH /company/projects/:id/status  보류 · 그만둠 · 다시 진행 (src/company-project-status.js, DB 0078)
 *   POST /company/projects       새 프로젝트 (대표 · 실장) { title, customer_id } | { title, customer: { name, phone } }
 *                                → { project_id, customer_id }. 새 고객은 이름 · 전화로 늘 새 행 (이름 · 전화가 같다고
 *                                기존 고객에 잇지 않는다 — projects.js 상담 확정과 같다)
 *   GET  /company/designs        내 업체 설계 목록 (active 구성원) — 이름 · 이은 프로젝트 · 수주가 생겼나, 최근 고친 순 200개
 *                                (AI 비서 「설계 잇기」 카드가 고를 설계)
 *   PUT  /designs/:id/project    설계를 프로젝트에 잇기 · 풀기 { project_id | null } → { design_id, project_id }
 *       잇는 사람: 설계 업체의 대표 · 실장 (다담 공장 설계는 관리자도), 협력업체 설계는 만든 사람(그 업체 구성원)도.
 *       다담 공장 설계를 만든 일반 고객은 잇지 못한다 — 고객 설계 잇기는 아직 없다.
 *       같은 업체의 프로젝트에만 (designs → projects 복합 FK 와 같은 규칙). 수주가 생긴 설계는 바꾸지 못한다 (409 has_order).
 *
 * 고객 · 프로젝트를 만들고 설계의 project_id 를 바꾸는 일은 keep_owner_links 트리거(database/migrations/0007) 때문에
 * 사용자 JWT 로는 못 한다 — 이 워커(service_role)가 쓴다.
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  companyAccess,
  hqCompanyId,
  insertOne,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { companyOf } from './distribution/company.js';
import { idempotencyKeyOf } from './ledger/checks.js';
import { membersOf } from './company-assignee.js';
import { isMissingRelation } from './work-order-data.js';
import { projectStage } from './projects.js';
import { pipelineOf } from './company-pipeline.js';
import { visitOf } from './company-project-visits.js';
import { lateOf, stayRow } from './project-stay.js';
import { kstDate } from './production/service.js';
import { logProject } from './project-log.js';
import { invitesReady } from './customer-invites.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 프로젝트 줄이 읽는 칸 — 보류 칸(DB 0078)이 있을 때 · 없을 때 */
export const PROJECT_COLUMNS = 'id,customer_id,title,status,created_at,closed_at,assignee_id';
export const PROJECT_COLUMNS_HOLD = `${PROJECT_COLUMNS},hold_until,status_note,status_at`;

/** 목록 한 번에 */
export const COMPANY_PROJECTS_LIMIT = 200;
/** 프로젝트 이름 글자 수 (업체 이름과 같은 100) */
export const PROJECT_TITLE_MAX = 100;
/** 고객 이름 글자 수 (현장 연락처 이름과 같은 50) */
export const CUSTOMER_NAME_MAX = 50;
/** 전화 — account-api partner.js PHONE_RE 와 같은 꼴 (숫자 · 하이픈 8~20자) */
export const PHONE_RE = /^[0-9][0-9-]{7,19}$/;
/** 프로젝트를 가질 수 있는 협력업체 plan (Manager 이상) */
export const PROJECT_PLANS = Object.freeze(['manager', 'expert', 'agent']);
/** 단계 계산에 읽는 수주 · 확인서 · 연출컷 행 수 상한 (projects.js LINKED_ROW_LIMIT 와 같다) */
const STAGE_ROW_LIMIT = '500';

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}

/** 다담 공장 · active 협력업체(Manager 이상)만 프로젝트를 가진다 */
export function canHoldProjects(company) {
  if (!company || company.status !== 'active') return false;
  return (
    company.kind === 'hq' || (company.kind === 'partner' && PROJECT_PLANS.includes(company.plan))
  );
}

export async function projectCompanyOf(env, user, { manage = false } = {}) {
  const { companyId, canAct, role } = await companyOf(env, user, { manage });
  const company = await selectOne(env, 'companies', {
    id: `eq.${companyId}`,
    select: 'id,kind,name,plan,status',
  });
  if (!canHoldProjects(company))
    throw new ForbiddenError('프로젝트를 쓸 수 있는 팩토리가 아닙니다', 'not_project_company');
  return { company, canAct, role: role || null };
}

/**
 * 프로젝트마다 단계 · 최신 수주 — Map(project_id → { stage, order }).
 * 단계는 고객 「내 프로젝트」(projects.js listMyProjects)와 같은 projectStage: 수주(취소 뺌) · 고객 확인서(거둔 것 뺌) · 설계 · 연출컷.
 * designs = 이 업체의 이 프로젝트들에 이어진 설계 [{ id, project_id }] (목록이 이미 읽은 것).
 */
export async function stagesOf(env, companyId, ids, designs) {
  const out = new Map();
  if (!ids.length) return out;
  const inIds = `in.(${ids.join(',')})`;
  const designIds = designs.map((d) => d.id);
  const [orders, quotes, renders] = await Promise.all([
    selectMany(env, 'orders', {
      project_id: inIds,
      company_id: `eq.${companyId}`,
      status: 'neq.cancelled',
      select: 'id,project_id,order_no,status',
      order: 'ordered_at.desc,created_at.desc',
      limit: STAGE_ROW_LIMIT,
    }),
    designIds.length
      ? selectMany(env, 'design_documents', {
          design_id: `in.(${designIds.join(',')})`,
          doc_type: 'eq.customer_confirmation',
          status: 'neq.revoked',
          select: 'design_id',
          limit: STAGE_ROW_LIMIT,
        })
      : [],
    selectMany(env, 'generations', { project_id: inIds, select: 'project_id', limit: STAGE_ROW_LIMIT }),
  ]);
  const projectOfDesign = new Map(designs.map((d) => [d.id, d.project_id]));
  const ordersBy = new Map();
  for (const o of orders || []) {
    if (!ordersBy.has(o.project_id)) ordersBy.set(o.project_id, []);
    ordersBy.get(o.project_id).push(o); // 최신 수주가 앞
  }
  const quoteSet = new Set((quotes || []).map((q) => projectOfDesign.get(q.design_id)));
  const designSet = new Set(designs.map((d) => d.project_id));
  const renderSet = new Set((renders || []).map((g) => g.project_id));
  for (const id of ids) {
    const projectOrders = ordersBy.get(id) || [];
    const latest = projectOrders[0] || null;
    out.set(id, {
      stage: projectStage({
        orders: projectOrders,
        hasQuote: quoteSet.has(id),
        hasDesign: designSet.has(id),
        hasRender: renderSet.has(id),
      }),
      order: latest ? { id: latest.id, order_no: latest.order_no || null, status: latest.status } : null,
    });
  }
  return out;
}

/** 글 칸 — 앞뒤 빈칸 지움, 1 ~ max 자 */
function textOf(value, field, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ValidationError(`${field} 가 필요합니다`, { field });
  if (text.length > max) throw new ValidationError(`${field} 는 ${max}자까지입니다`, { field });
  return text;
}

/**
 * 프로젝트 한 줄 — 목록(GET /company/projects)과 프로젝트 창(GET /company/projects/:id)이 같은 칸을 쓴다.
 * @param {object} p        projects 행
 * @param {{ customer?: object|null, designCount?: number, stage?: { stage, order }, flow?: { step, next }, memberOf: Map,
 *           stay?: { today, orderOf, lateMake, lateInstall } }} parts   stay = 머문 날을 잴 값 (project-stay.js) — 주면 줄에 stay 를 싣는다
 */
export function projectRow(p, { customer, designCount, stage, flow, memberOf, stay = null }) {
  const c = customer || null;
  const visitRow = flow && flow.visit !== undefined ? visitOf(flow.visit, memberOf) : undefined;
  // 머문 날 — 느림 · 멈춤 (진행 중이고 단계를 아는 줄에만. 대시보드와 같은 판정)
  const stayed =
    stay && flow && flow.step
      ? stayRow({ id: p.id, status: p.status, created_at: p.created_at, step: flow.step, next: flow.next, visit: visitRow || null }, stay)
      : null;
  return {
    id: p.id,
    title: p.title || null,
    status: p.status,
    created_at: p.created_at,
    closed_at: p.closed_at || null,
    // app — 고객이 앱 계정과 이어졌나 (고객 초대 링크로 · 앱 상담으로)
    customer: c ? { id: c.id, name: c.name || null, phone: c.phone || null, app: !!c.user_id } : null,
    design_count: designCount || 0,
    stage: stage.stage,
    order: stage.order,
    ...(flow || {}),
    // 실측 일정 — 지금의 것 하나 (DB 0079. 갈 사람이 구성원이면 그 이름). 표가 없으면 칸 자체가 없다
    ...(visitRow !== undefined ? { visit: visitRow } : {}),
    // 머문 날 { days, state: fresh | slow | stuck } — 진행 중인 줄에만
    ...(stayed ? { stay: stayed } : {}),
    // 보류 · 그만둠 — 다시 볼 날 · 메모 · 바꾼 때 (DB 0078. 진행 중인 줄에는 싣지 않는다)
    ...(p.status === 'on_hold' || p.status === 'cancelled'
      ? { hold_until: p.hold_until || null, status_note: p.status_note || null, status_at: p.status_at || null }
      : {}),
    // 나간 구성원이면 이름 없이 id 만 (removed — 바꾸는 것은 사람이 한다)
    assignee: p.assignee_id ? memberOf.get(p.assignee_id) || { user_id: p.assignee_id, name: null, role: null } : null,
  };
}

/** GET /company/projects */
export async function listCompanyProjects(env, { user, nowMs = Date.now() }) {
  const { company, canAct, role } = await projectCompanyOf(env, user);
  const query = (cols) =>
    selectMany(env, 'projects', {
      company_id: `eq.${company.id}`,
      select: cols,
      order: 'created_at.desc',
      limit: String(COMPANY_PROJECTS_LIMIT),
    });
  // 보류 칸(DB 0078) · 담당자 칸(DB 0042) — 적용 전이면 그 칸 없이 (담당자가 없으면 assignee_ready false)
  let assigneeReady = true;
  let holdReady = true;
  let projects;
  try {
    projects = (await query(PROJECT_COLUMNS_HOLD)) || [];
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    holdReady = false;
    try {
      projects = (await query(PROJECT_COLUMNS)) || [];
    } catch (e2) {
      if (!isMissingRelation(e2)) throw e2;
      assigneeReady = false;
      projects = (await query('id,customer_id,title,status,created_at,closed_at')) || [];
    }
  }
  const members = await membersOf(env, company.id);
  const memberOf = new Map(members.map((m) => [m.user_id, m]));
  const ids = projects.map((p) => p.id);
  const customerIds = [...new Set(projects.map((p) => p.customer_id).filter(Boolean))];
  const customers = customerIds.length
    ? (await selectMany(env, 'customers', {
        id: `in.(${customerIds.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,name,phone,user_id',
      })) || []
    : [];
  const designs = ids.length
    ? (await selectMany(env, 'designs', {
        project_id: `in.(${ids.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,project_id,source,source_ref',
      })) || []
    : [];
  const customerOf = new Map(customers.map((c) => [c.id, c]));
  const designCount = new Map();
  for (const d of designs) designCount.set(d.project_id, (designCount.get(d.project_id) || 0) + 1);
  const stages = await stagesOf(env, company.id, ids, designs);
  // 지금 단계 · 다음 할 일 — 덧붙이는 값이라, 못 모아도 목록은 그대로 준다 (화면은 stage 로 그린다)
  let flow = new Map();
  const meta = {};
  try {
    flow = await pipelineOf(env, {
      company,
      viewer: { role, user_id: user.id },
      projects,
      designs,
      stages,
      meta,
      nowMs,
    });
  } catch (e) {
    console.error('company projects: pipeline failed —', e && e.message);
  }
  // 머문 날 — 생산 · 설치 단계 프로젝트는 잡아 둔 날이 지났는지 본다. 못 읽어도 목록은 그대로 (그 줄은 여유로 본다)
  const today = kstDate(new Date(nowMs).toISOString());
  const lateSteps = new Set(projects.filter((p) => ['make', 'install'].includes((flow.get(p.id) || {}).step)).map((p) => p.id));
  let late = { lateMake: new Set(), lateInstall: new Set() };
  try {
    late = await lateOf(env, designs.filter((d) => lateSteps.has(d.project_id)), today);
  } catch (e) {
    console.error('company projects: late schedules failed —', e && e.message);
  }
  const stay = flow.size ? { today, orderOf: meta.order_at || new Map(), ...late } : null;
  // 고객 초대 링크를 쓸 수 있나 (DB 0082 의 표가 있다) — 화면이 그때만 「고객 초대」를 낸다
  const inviteReady = await invitesReady(env, company.id).catch((e) => {
    console.error('company projects: invites check failed —', e && e.message);
    return false;
  });
  return {
    company: { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null },
    can_manage: canAct,
    role,
    assignee_ready: assigneeReady,
    invite_ready: inviteReady,
    // 보류 · 그만둠을 쓸 수 있나 (DB 0078 의 칸이 있다) — 화면이 그때만 단추를 낸다
    hold_ready: holdReady,
    // 실측 단계를 쓸 수 있나 (DB 0079 의 표가 있다) — 화면이 그때만 「실측」 줄 · 칸을 낸다
    visit_ready: meta.visit_ready === true,
    members,
    items: projects.map((p) =>
      projectRow(p, {
        customer: customerOf.get(p.customer_id),
        designCount: designCount.get(p.id),
        stage: stages.get(p.id),
        flow: flow.get(p.id),
        memberOf,
        stay,
      })
    ),
  };
}

/** 같은 업체 · 같은 키로 이미 만든 프로젝트 (DB 0041 projects.idempotency_key) */
function projectByKey(env, companyId, key) {
  return selectOne(env, 'projects', {
    company_id: `eq.${companyId}`,
    idempotency_key: `eq.${key}`,
    select: 'id,customer_id',
  });
}

/** GET /company/designs */
export async function listCompanyDesigns(env, { user }) {
  const { company } = await projectCompanyOf(env, user);
  const designs =
    (await selectMany(env, 'designs', {
      company_id: `eq.${company.id}`,
      select: 'id,name,project_id,created_at,updated_at',
      order: 'updated_at.desc',
      limit: String(COMPANY_PROJECTS_LIMIT),
    })) || [];
  const ids = designs.map((d) => d.id);
  const orders = ids.length
    ? (await selectMany(env, 'orders', { design_id: `in.(${ids.join(',')})`, select: 'design_id' })) || []
    : [];
  const ordered = new Set(orders.map((o) => o.design_id));
  return {
    items: designs.map((d) => ({
      id: d.id,
      name: d.name || null,
      project_id: d.project_id || null,
      created_at: d.created_at,
      updated_at: d.updated_at,
      has_order: ordered.has(d.id),
    })),
  };
}

/** POST /company/projects — X-Idempotency-Key 가 같으면 먼저 만든 프로젝트를 그대로 (reused) */
export async function createCompanyProject(env, { user, body, idempotencyKey }) {
  const { company } = await projectCompanyOf(env, user, { manage: true });
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const key = idempotencyKeyOf(idempotencyKey);
  if (key) {
    const prev = await projectByKey(env, company.id, key);
    if (prev) return { project_id: prev.id, customer_id: prev.customer_id, reused: true };
  }
  const title = textOf(body.title, 'title', PROJECT_TITLE_MAX);
  const hasId = body.customer_id !== undefined && body.customer_id !== null;
  const hasNew = body.customer !== undefined && body.customer !== null;
  if (hasId === hasNew)
    throw new ValidationError('customer_id 와 customer 중 하나만 넣어 주세요', {
      field: 'customer',
    });

  let customerId;
  let created = false;
  if (hasId) {
    if (!isUuid(body.customer_id))
      throw new ValidationError('customer_id 가 올바르지 않습니다', { field: 'customer_id' });
    const row = await selectOne(env, 'customers', {
      id: `eq.${body.customer_id}`,
      company_id: `eq.${company.id}`,
      select: 'id',
    });
    if (!row) throw new NotFoundError('이 팩토리의 고객을 찾을 수 없습니다');
    customerId = row.id;
  } else {
    if (!isPlainObject(body.customer))
      throw new ValidationError('customer 는 { name, phone } 이어야 합니다', { field: 'customer' });
    const name = textOf(body.customer.name, 'customer.name', CUSTOMER_NAME_MAX);
    const phoneIn = body.customer.phone;
    const phone =
      phoneIn === undefined || phoneIn === null || (typeof phoneIn === 'string' && !phoneIn.trim())
        ? null
        : typeof phoneIn === 'string'
          ? phoneIn.trim()
          : '';
    if (phone !== null && !PHONE_RE.test(phone))
      throw new ValidationError('전화는 숫자와 - 로 8~20자입니다', { field: 'customer.phone' });
    const row = await insertOne(env, 'customers', { company_id: company.id, name, phone });
    if (!row || !row.id) throw new DbError('고객 행을 만들지 못했습니다');
    customerId = row.id;
    created = true;
  }

  // 프로젝트를 못 만들면 이번에 만든 고객 행만 지운다
  const undo = async () => {
    if (created) await restDelete(env, 'customers', { id: `eq.${customerId}` });
  };
  const row = { company_id: company.id, customer_id: customerId, title, status: 'active' };
  if (key) row.idempotency_key = key;
  let project;
  try {
    project = await insertOne(env, 'projects', row);
  } catch (err) {
    await undo();
    // 같은 키로 동시에 두 번 — 먼저 만든 프로젝트 (이번에 만든 고객 행은 지웠다)
    const prev = err instanceof ConflictError && key ? await projectByKey(env, company.id, key) : null;
    if (prev) return { project_id: prev.id, customer_id: prev.customer_id, reused: true };
    throw err;
  }
  if (!project || !project.id) {
    await undo();
    throw new DbError('프로젝트를 만들지 못했습니다');
  }
  return { project_id: project.id, customer_id: customerId, reused: false };
}

/** PUT /designs/:id/project */
export async function linkDesignProject(env, { user, designId, body, ctx = null }) {
  if (!isPlainObject(body) || !Object.prototype.hasOwnProperty.call(body, 'project_id'))
    throw new ValidationError('project_id 가 필요합니다 (풀려면 null)', { field: 'project_id' });
  const target = body.project_id;
  if (target !== null && !isUuid(target))
    throw new ValidationError('project_id 가 올바르지 않습니다', { field: 'project_id' });
  if (!isUuid(designId)) throw new NotFoundError('설계를 찾을 수 없습니다');
  const design = await selectOne(env, 'designs', {
    id: `eq.${designId}`,
    select: 'id,company_id,user_id,project_id',
  });
  if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');

  const hq = await hqCompanyId(env);
  const { all, money } = await companyAccess(env, user, { hq });
  const maker =
    design.company_id !== hq && user && design.user_id === user.id && all.has(design.company_id);
  if (!money.has(design.company_id) && !maker)
    throw new ForbiddenError(
      '설계를 프로젝트에 잇는 것은 팩토리 대표 · 실장과 설계를 만든 사람만 할 수 있습니다',
      'not_linker'
    );
  const company = await selectOne(env, 'companies', {
    id: `eq.${design.company_id}`,
    select: 'id,kind,plan,status',
  });
  if (!canHoldProjects(company))
    throw new ForbiddenError('프로젝트를 쓸 수 있는 팩토리가 아닙니다', 'not_project_company');

  const current = design.project_id || null;
  if (current === target) return { design_id: design.id, project_id: target };
  // expect_project_id (AI 비서 승인 카드) — 보낸 사람이 본 프로젝트. 그 사이 바뀌었으면 409 stale (이미 바라는 프로젝트면 위에서 성공)
  if (Object.prototype.hasOwnProperty.call(body, 'expect_project_id')) {
    const expect = body.expect_project_id;
    if (expect !== null && !isUuid(expect))
      throw new ValidationError('expect_project_id 가 올바르지 않습니다', { field: 'expect_project_id' });
    if (current !== expect) throw conflict('그 사이 설계의 프로젝트가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  }
  // 수주가 생긴 설계는 프로젝트를 바꾸지 않는다 (수주는 설계의 프로젝트를 그대로 갖는다 — orders.js).
  //   처음 붙이는 것은 된다 (2026-11-17) — 프로젝트 없이 수주까지 간 설계(간편 플래너에서 보낸 설계)도 프로젝트 「작업 배정」에 올릴 수 있게.
  //   그때 그 설계의 수주 가운데 프로젝트가 빈 것도 같은 프로젝트로 잇는다 (작업 배정이 프로젝트의 수주로 지시서 · 필수 확인을 찾는다).
  const order = await selectOne(env, 'orders', { design_id: `eq.${design.id}`, select: 'id' });
  const firstLink = current === null && target !== null;
  if (order && !firstLink) throw conflict('수주가 생긴 설계는 프로젝트를 바꿀 수 없습니다', 'has_order');
  if (target !== null) {
    const project = await selectOne(env, 'projects', {
      id: `eq.${target}`,
      company_id: `eq.${design.company_id}`,
      select: 'id',
    });
    if (!project) throw new NotFoundError('이 팩토리의 프로젝트를 찾을 수 없습니다');
  }
  await updateBy(
    env,
    'designs',
    { id: `eq.${design.id}`, company_id: `eq.${design.company_id}`, select: 'id' },
    { project_id: target }
  );
  if (order && firstLink) {
    await updateBy(
      env,
      'orders',
      { design_id: `eq.${design.id}`, company_id: `eq.${design.company_id}`, project_id: 'is.null', select: 'id' },
      { project_id: target }
    );
  }
  // 프로젝트 일지 — 이었으면 그 프로젝트에, 풀었으면 풀린 프로젝트에 한 줄
  await logProject(env, ctx, {
    companyId: design.company_id,
    projectId: target || current,
    actor: { id: user.id },
    type: target ? 'design_linked' : 'design_unlinked',
    subject: { type: 'design', id: design.id },
  });
  return { design_id: design.id, project_id: target };
}
