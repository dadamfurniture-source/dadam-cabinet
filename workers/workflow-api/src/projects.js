/**
 * 상담 → 고객 · 프로젝트 잇기, 고객이 보는 「내 프로젝트」.
 *
 * POST /consultations/:id/accept — 관리자가 본사 상담의 일정을 확정한다.
 *   상담의 customer_id · project_id 는 keep_owner_links 트리거(database/migrations/0007) 때문에
 *   사용자 JWT 로는 바꾸지 못한다 — 이 워커(service_role)가 잇는다.
 *   고객: 상담에 이미 있으면 그대로 → 회원 상담이면 그 계정의 본사 고객 행(없으면 만든다)
 *         → 비회원 상담이면 이름 · 연락처로 새 본사 고객 (이름 · 연락처가 같다고 기존 고객에 잇지 않는다 — 0003).
 *   프로젝트: 상담에 이미 있으면 그대로, 없으면 본사 · 그 고객으로 새로 (제목은 상담 제목).
 *   상담: 고객 · 프로젝트 · status confirmed · confirmed_at.
 *   연출컷: 상담에 붙은 연출컷이 본사 것이고 아직 프로젝트가 없을 때만 이 프로젝트에 잇는다.
 *   두 번 불러도 고객 · 프로젝트가 또 생기지 않는다 (두 번째는 상담에 이어진 것을 그대로 쓴다).
 *
 * GET /me/projects — 로그인한 사람의 고객 행(회사 무관)에 걸린 프로젝트, 최신 50개.
 *   고객에게 보여 줄 칸만 싣는다 — 원가 · 마진 · 수금 합계 · 내부 메모 · 담당자 이름은 읽지도 않는다.
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  hqCompanyId,
  insertOne,
  insertOneIgnoreConflict,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { isAdmin } from './reports/admin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 확정할 수 있는 상담 상태 — 대기는 처음 확정, 확정은 일정 변경 */
export const ACCEPTABLE_STATUSES = Object.freeze(['pending', 'confirmed']);

const CONSULTATION_COLUMNS = 'id,company_id,customer_id,project_id,generation_id,user_id,name,phone,title,status';

function parseConfirmedAt(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('confirmed_at(확정 일시)이 필요합니다');
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) throw new ValidationError('confirmed_at 이 올바른 날짜가 아닙니다');
  return when.toISOString();
}

async function findHqCustomerOfUser(env, hq, userId) {
  return selectOne(env, 'customers', { company_id: `eq.${hq}`, user_id: `eq.${userId}`, select: 'id' });
}

/** 상담의 고객 → { id, created, owned } — owned: 이번에 만들었고 다른 요청이 찾아 쓸 수 없는 행(비회원 고객) */
async function resolveCustomer(env, consultation, hq) {
  if (consultation.customer_id) return { id: consultation.customer_id, created: false, owned: false };
  if (consultation.user_id) {
    const found = await findHqCustomerOfUser(env, hq, consultation.user_id);
    if (found) return { id: found.id, created: false, owned: false };
    const inserted = await insertOneIgnoreConflict(env, 'customers', { company_id: hq, user_id: consultation.user_id });
    if (inserted) return { id: inserted.id, created: true, owned: false };
    // 고유 색인 (company_id, user_id) — 그사이 다른 요청이 넣었다. 그 행을 쓴다
    const again = await findHqCustomerOfUser(env, hq, consultation.user_id);
    if (!again) throw new DbError('본사 고객 행을 만들지 못했습니다');
    return { id: again.id, created: false, owned: false };
  }
  const row = await insertOne(env, 'customers', { company_id: hq, name: consultation.name, phone: consultation.phone || null });
  if (!row || !row.id) throw new DbError('고객 행을 만들지 못했습니다');
  return { id: row.id, created: true, owned: true };
}

async function resolveProject(env, consultation, hq, customerId) {
  if (consultation.project_id) return { id: consultation.project_id, created: false };
  const row = await insertOne(env, 'projects', { company_id: hq, customer_id: customerId, title: consultation.title, status: 'active' });
  if (!row || !row.id) throw new DbError('프로젝트를 만들지 못했습니다');
  return { id: row.id, created: true };
}

/** POST /consultations/:id/accept */
export async function acceptConsultation(env, { user, consultationId, body }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 상담을 확정할 수 있습니다');
  const confirmedAt = parseConfirmedAt(body && body.confirmed_at);
  if (!UUID_RE.test(String(consultationId || ''))) throw new NotFoundError('상담을 찾을 수 없습니다');

  const consultation = await selectOne(env, 'consultations', { id: `eq.${consultationId}`, select: CONSULTATION_COLUMNS });
  if (!consultation) throw new NotFoundError('상담을 찾을 수 없습니다');
  const hq = await hqCompanyId(env);
  if (consultation.company_id !== hq) throw new ForbiddenError('본사 상담만 확정할 수 있습니다');
  if (!ACCEPTABLE_STATUSES.includes(consultation.status)) {
    throw new ConflictError('대기 · 확정 상담만 일정을 확정할 수 있습니다', { status: consultation.status });
  }

  const customer = await resolveCustomer(env, consultation, hq);
  const project = await resolveProject(env, consultation, hq, customer.id);

  // 읽은 그대로일 때만 고친다 — 그사이 다른 요청이 잇거나 상태를 바꿨으면 0행
  const updated = await updateBy(
    env,
    'consultations',
    {
      id: `eq.${consultation.id}`,
      status: `in.(${ACCEPTABLE_STATUSES.join(',')})`,
      customer_id: consultation.customer_id ? `eq.${consultation.customer_id}` : 'is.null',
      project_id: consultation.project_id ? `eq.${consultation.project_id}` : 'is.null',
      select: 'id',
    },
    {
      customer_id: customer.id,
      project_id: project.id,
      status: 'confirmed',
      confirmed_at: confirmedAt,
      updated_at: new Date().toISOString(),
    },
  );
  if (!updated || !updated.length) {
    // 이번에 만든 행은 아무 데도 이어지지 않았다 — 지우고 알린다 (회원 고객 행은 그 계정의 본사 고객이라 둔다)
    if (project.created) await restDelete(env, 'projects', { id: `eq.${project.id}` });
    if (customer.owned) await restDelete(env, 'customers', { id: `eq.${customer.id}` });
    throw new ConflictError('상담이 그사이 바뀌었습니다. 목록을 다시 불러온 뒤 확인하세요');
  }

  // 연출컷 — 본사 것이고 아직 프로젝트가 없을 때만 (다른 회사 연출컷 · 이미 이어진 연출컷은 그대로)
  if (consultation.generation_id) {
    await updateBy(
      env,
      'generations',
      { id: `eq.${consultation.generation_id}`, company_id: `eq.${hq}`, project_id: 'is.null', select: 'id' },
      { project_id: project.id },
    );
  }

  return {
    consultation_id: consultation.id,
    customer_id: customer.id,
    project_id: project.id,
    created: { customer: customer.created, project: project.created },
  };
}

// ===== 내 프로젝트 =====

/** 한 번에 돌려주는 프로젝트 수 (최신순) */
export const MY_PROJECTS_LIMIT = 50;
/** 프로젝트에 붙은 표를 읽을 때 한 번에 읽는 행 수 상한 */
const LINKED_ROW_LIMIT = '500';

/** 진행 단계 — 뒤로 갈수록 높다. 걸린 행 중 가장 높은 것 */
export const PROJECT_STAGES = Object.freeze(['consult', 'render', 'design', 'quote', 'order', 'installed']);

export function projectStage({ orders = [], hasQuote = false, hasDesign = false, hasRender = false }) {
  if (orders.some((o) => o.status === 'completed')) return 'installed';
  if (orders.length) return 'order';
  if (hasQuote) return 'quote';
  if (hasDesign) return 'design';
  if (hasRender) return 'render';
  return 'consult';
}

function groupBy(rows, keyOf) {
  const out = new Map();
  for (const row of rows || []) {
    const key = keyOf(row);
    if (key == null) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

/** GET /me/projects */
export async function listMyProjects(env, { user }) {
  const customers = (await selectMany(env, 'customers', { user_id: `eq.${user.id}`, select: 'id', limit: '100' })) || [];
  if (!customers.length) return [];

  const projects =
    (await selectMany(env, 'projects', {
      customer_id: `in.(${customers.map((c) => c.id).join(',')})`,
      select: 'id,company_id,title,status,created_at',
      order: 'created_at.desc',
      limit: String(MY_PROJECTS_LIMIT),
    })) || [];
  if (!projects.length) return [];

  const inProjects = `in.(${projects.map((p) => p.id).join(',')})`;
  const companyIds = [...new Set(projects.map((p) => p.company_id))];

  const [companies, orders, designs, quotes, installs, renders] = await Promise.all([
    selectMany(env, 'companies', { id: `in.(${companyIds.join(',')})`, select: 'id,name' }),
    selectMany(env, 'orders', {
      project_id: inProjects,
      select: 'id,project_id,order_no,status,contract_amount,ordered_at,completed_at',
      order: 'ordered_at.desc,created_at.desc',
      limit: LINKED_ROW_LIMIT,
    }),
    selectMany(env, 'designs', { project_id: inProjects, select: 'project_id', limit: LINKED_ROW_LIMIT }),
    selectMany(env, 'design_documents', {
      doc_type: 'eq.customer_confirmation',
      select: 'designs!inner(project_id)',
      'designs.project_id': inProjects,
      limit: LINKED_ROW_LIMIT,
    }),
    selectMany(env, 'design_schedules', {
      type: 'eq.installation',
      status: 'neq.cancelled',
      select: 'scheduled_at,designs!inner(project_id)',
      'designs.project_id': inProjects,
      order: 'scheduled_at.asc',
      limit: LINKED_ROW_LIMIT,
    }),
    selectMany(env, 'generations', { project_id: inProjects, select: 'project_id', limit: LINKED_ROW_LIMIT }),
  ]);

  const companyName = new Map((companies || []).map((c) => [c.id, c.name]));
  const ordersBy = groupBy(orders, (o) => o.project_id); // 최신 수주가 앞
  const designSet = new Set((designs || []).map((d) => d.project_id));
  const quoteSet = new Set((quotes || []).map((d) => d.designs && d.designs.project_id));
  const renderSet = new Set((renders || []).map((g) => g.project_id));
  const installAt = new Map();
  for (const s of installs || []) {
    const pid = s.designs && s.designs.project_id;
    if (pid && !installAt.has(pid)) installAt.set(pid, s.scheduled_at); // 이른 일정이 앞
  }

  const latestOrders = projects.map((p) => (ordersBy.get(p.id) || [])[0]).filter(Boolean);
  const payments = latestOrders.length
    ? (await selectMany(env, 'order_payments', {
        order_id: `in.(${latestOrders.map((o) => o.id).join(',')})`,
        select: 'order_id,stage,amount,due_on,paid_on',
        order: 'due_on.asc.nullslast,created_at.asc',
        limit: LINKED_ROW_LIMIT,
      })) || []
    : [];
  const paymentsBy = groupBy(payments, (p) => p.order_id);

  return projects.map((p) => {
    const projectOrders = ordersBy.get(p.id) || [];
    const latest = projectOrders[0] || null;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      company_name: companyName.get(p.company_id) || null,
      created_at: p.created_at,
      stage: projectStage({
        orders: projectOrders,
        hasQuote: quoteSet.has(p.id),
        hasDesign: designSet.has(p.id),
        hasRender: renderSet.has(p.id),
      }),
      order: latest
        ? {
            order_no: latest.order_no,
            status: latest.status,
            contract_amount: latest.contract_amount,
            ordered_at: latest.ordered_at,
            completed_at: latest.completed_at,
          }
        : null,
      payments: latest
        ? (paymentsBy.get(latest.id) || []).map((x) => ({ stage: x.stage, amount: x.amount, due_on: x.due_on, paid_on: x.paid_on }))
        : [],
      install_at: installAt.get(p.id) || null,
    };
  });
}
