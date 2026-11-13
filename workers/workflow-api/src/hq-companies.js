/**
 * 다담 본사 › 업체관리 › 등록 업체 — 본사 대표 · 실장이 등록 업체(다담 공장 · 협력업체)마다 프로젝트 · 회계 · 인력을 본다
 * (2026-11-09 대표님 결정 — 마이페이지 메뉴 나무, segan/hq-companies.js).
 *
 *   GET /hq/companies                 업체 목록 — 다담 공장 먼저, 협력업체는 이름 차례
 *                                     [{ id, kind, name, plan, status, sido, gugun, members, projects, ledger }]
 *                                     members = active 구성원 수, projects = 프로젝트 수, ledger = 장부 자격 full | read | none
 *   GET /hq/companies/:id/projects    그 업체 프로젝트 (최신 200개) — 이름 · 상태 · 단계(company-projects.js stagesOf — 업체 화면과
 *                                     같은 계산) · 최신 수주 상태 · 설계 수 · 만든 날 · 담당(이름 · 직책).
 *                                     고객 이름 · 전화 · 금액은 싣지 않는다
 *   GET /hq/companies/:id/members     그 업체 구성원 — 이름 · 직책 · 상태 · 들어온 날 (이메일 · 전화는 싣지 않는다)
 *
 * 보는 사람: 다담 본사(platform) active 대표 · 실장 — 협력업체 월 장부 보고서(ledger/access.js reportablePartner)와 같은 기준.
 *   아니면 403 not_platform. 다담 본사 자신 · 없는 업체는 404. 보기만 — 쓰는 주소는 없다. 읽기는 service_role.
 * 회계는 이 파일이 아니다 — 앱이 협력업체는 월 보고서(ledger-report.html?company=), 다담 공장은 장부 보기(ledger.html?company=)를 연다.
 */
import {
  ForbiddenError,
  NotFoundError,
  MONEY_ROLES,
  activeMemberships,
  callRpc,
  platformCompanyId,
  selectMany,
  selectOne,
} from './supabase.js';
import { COMPANY_PROJECTS_LIMIT, stagesOf } from './company-projects.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 목록에 드는 업체 종류 — 다담 공장 · 협력업체 (다담 본사 자신은 빼고) */
export const HQ_COMPANY_KINDS = Object.freeze(['hq', 'partner']);
const ROLE_ORDER = { owner: 0, manager: 1, staff: 2 };
const LEDGER_LEVELS = ['full', 'read'];
const COMPANY_COLS = 'id,kind,name,plan,status,sido,gugun';
const ROW_LIMIT = '2000';

/** 다담 본사 active 대표 · 실장인가 — 아니면 403 not_platform (본사 설계 · 학습 점검 hq-design-check.js 도 쓴다) */
export async function assertPlatformMoney(env, user) {
  const platform = await platformCompanyId(env);
  const ok = (await activeMemberships(env, user)).some(
    (m) => m.company_id === platform && MONEY_ROLES.includes(m.role)
  );
  if (!ok) throw new ForbiddenError('다담 본사 대표 · 실장만 봅니다', 'not_platform');
}

/** 목록에 든 업체 하나 — 다담 공장 · 협력업체만, 아니면 404 */
async function companyOf(env, id) {
  if (!UUID_RE.test(String(id || ''))) throw new NotFoundError('업체를 찾을 수 없습니다');
  const c = await selectOne(env, 'companies', { id: `eq.${id}`, select: COMPANY_COLS });
  if (!c || !HQ_COMPANY_KINDS.includes(c.kind)) throw new NotFoundError('업체를 찾을 수 없습니다');
  return c;
}

/** 장부 자격 — company_entitled(업체, 'ledger') (사람 없이). full · read 가 아니면 none */
async function ledgerLevel(env, companyId) {
  const level = await callRpc(env, 'company_entitled', {
    p_company: companyId,
    p_feature: 'ledger',
  });
  return LEDGER_LEVELS.includes(level) ? level : 'none';
}

const countBy = (rows, key) => {
  const out = new Map();
  for (const r of rows || []) out.set(r[key], (out.get(r[key]) || 0) + 1);
  return out;
};

/** GET /hq/companies */
export async function listHqCompanies(env, { user }) {
  await assertPlatformMoney(env, user);
  const companies =
    (await selectMany(env, 'companies', {
      kind: `in.(${HQ_COMPANY_KINDS.join(',')})`,
      select: COMPANY_COLS,
      order: 'name.asc',
      limit: '500',
    })) || [];
  if (!companies.length) return { items: [] };
  const ids = `in.(${companies.map((c) => c.id).join(',')})`;
  const [members, projects, ledgers] = await Promise.all([
    selectMany(env, 'company_members', {
      company_id: ids,
      status: 'eq.active',
      select: 'company_id',
      limit: ROW_LIMIT,
    }),
    selectMany(env, 'projects', { company_id: ids, select: 'company_id', limit: ROW_LIMIT }),
    Promise.all(companies.map((c) => ledgerLevel(env, c.id))),
  ]);
  const memberCount = countBy(members, 'company_id');
  const projectCount = countBy(projects, 'company_id');
  const items = companies.map((c, i) => ({
    id: c.id,
    kind: c.kind,
    name: c.name || null,
    plan: c.plan || null,
    status: c.status,
    sido: c.sido || null,
    gugun: c.gugun || null,
    members: memberCount.get(c.id) || 0,
    projects: projectCount.get(c.id) || 0,
    ledger: ledgers[i],
  }));
  // 다담 공장 먼저, 그다음 협력업체 (이름 차례 그대로)
  items.sort((a, b) => (a.kind === 'hq' ? 0 : 1) - (b.kind === 'hq' ? 0 : 1));
  return { items };
}

/** 구성원 이름 · 직책 (나간 사람 포함) — Map(user_id → { name, role, status }) */
async function peopleOf(env, companyId) {
  const rows =
    (await selectMany(env, 'company_members', {
      company_id: `eq.${companyId}`,
      select: 'user_id,role,status,created_at',
      order: 'created_at.asc',
      limit: '200',
    })) || [];
  const ids = rows.map((r) => r.user_id).filter((v) => UUID_RE.test(String(v || '')));
  const profiles = ids.length
    ? (await selectMany(env, 'profiles', { id: `in.(${ids.join(',')})`, select: 'id,name' })) || []
    : [];
  const nameOf = new Map(profiles.map((p) => [p.id, (p.name && String(p.name).trim()) || null]));
  return rows.map((r) => ({
    user_id: r.user_id,
    name: nameOf.get(r.user_id) || null,
    role: r.role,
    status: r.status,
    joined_at: r.created_at || null,
  }));
}

/** GET /hq/companies/:id/projects */
export async function listHqCompanyProjects(env, { user, companyId }) {
  await assertPlatformMoney(env, user);
  const company = await companyOf(env, companyId);
  const projects =
    (await selectMany(env, 'projects', {
      company_id: `eq.${company.id}`,
      select: 'id,title,status,created_at,closed_at,assignee_id',
      order: 'created_at.desc',
      limit: String(COMPANY_PROJECTS_LIMIT),
    })) || [];
  const ids = projects.map((p) => p.id);
  const designs = ids.length
    ? (await selectMany(env, 'designs', {
        project_id: `in.(${ids.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,project_id',
      })) || []
    : [];
  const designCount = countBy(designs, 'project_id');
  const [stages, people] = await Promise.all([
    stagesOf(env, company.id, ids, designs),
    peopleOf(env, company.id),
  ]);
  const personOf = new Map(people.map((m) => [m.user_id, m]));
  return {
    company: {
      id: company.id,
      kind: company.kind,
      name: company.name || null,
      plan: company.plan || null,
    },
    items: projects.map((p) => {
      const st = stages.get(p.id);
      const who = p.assignee_id ? personOf.get(p.assignee_id) : null;
      return {
        id: p.id,
        title: p.title || null,
        status: p.status,
        created_at: p.created_at,
        closed_at: p.closed_at || null,
        stage: st.stage,
        order_status: st.order ? st.order.status : null,
        design_count: designCount.get(p.id) || 0,
        assignee: p.assignee_id
          ? { name: who ? who.name : null, role: who ? who.role : null }
          : null,
      };
    }),
  };
}

/** GET /hq/companies/:id/members */
export async function listHqCompanyMembers(env, { user, companyId }) {
  await assertPlatformMoney(env, user);
  const company = await companyOf(env, companyId);
  const people = await peopleOf(env, company.id);
  people.sort(
    (a, b) =>
      (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) ||
      (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
  );
  return {
    company: {
      id: company.id,
      kind: company.kind,
      name: company.name || null,
      plan: company.plan || null,
    },
    items: people.map((m) => ({
      name: m.name,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
    })),
  };
}
