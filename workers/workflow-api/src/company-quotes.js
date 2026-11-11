/**
 * 업체 견적 목록 — 내 업체 설계들에서 낸 「고객 확인서」(= 고객에게 나가는 견적서)를 한 번에 모아 읽는다.
 * (마이페이지 B안 5단계 — 지금까지는 설계 하나씩만 볼 수 있었다: GET /designs/:designId/documents)
 *
 *   GET /company/quotes   내 업체 견적 목록 (active 구성원) — 새 것부터 COMPANY_QUOTES_LIMIT 건
 *     { company { id, name, kind, plan },
 *       items [{ id, doc_no, rev, status, title, created_at, expires_at, first_viewed_at, view_count,
 *                decision, decided_at, superseded, totals { subtotal, vat, total } | null,
 *                design { id, name }, project { id, title } | null, customer_name }] }
 *
 * 누가       프로젝트를 가지는 업체(다담 공장 · active 협력업체 Manager · Expert · Agent)의 active 구성원 —
 *            GET /company/projects 와 같은 판정(projectCompanyOf). 다른 업체의 견적은 싣지 않는다.
 * 금액       totals 는 고객에게 나간 금액(공급가 · 부가세 · 합계)뿐이다 — 설계별 문서 목록(documents.js listDocuments)과
 *            같이 구성원 누구나 본다. 원가 · 마진 · 견적 계산 근거(render_payload · quote_payload)는 싣지 않는다.
 * 고객 이름   프로젝트에 이은 설계면 그 프로젝트의 고객 이름(GET /company/projects 가 구성원에게 싣는 것과 같다),
 *            잇지 않은 설계면 문서에 남은 가린 이름(customer_name_masked). 전화 · 주소는 싣지 않는다.
 * 읽는 범위   최근 고친 설계 COMPANY_QUOTE_DESIGNS 개의 문서만 본다 (주소 길이 — in.(…) 거르기).
 * 읽기만 한다 — 견적을 내고 거두는 일은 지금처럼 상세설계 화면(POST /snapshots/:id/documents · revoke).
 */

import { selectMany } from './supabase.js';
import { projectCompanyOf } from './company-projects.js';

/** 목록 한 번에 */
export const COMPANY_QUOTES_LIMIT = 200;
/** 문서를 찾아볼 설계 수 (최근 고친 순) */
export const COMPANY_QUOTE_DESIGNS = 200;
/** 고객에게 나가는 견적서 = 고객 확인서 */
export const QUOTE_DOC_TYPE = 'customer_confirmation';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 문서 totals → 고객 금액 셋만 (거래처 등급 같은 다른 칸은 싣지 않는다). 금액이 하나도 없으면 null */
export function quoteTotals(totals) {
  const t = totals && typeof totals === 'object' && !Array.isArray(totals) ? totals : {};
  const out = { subtotal: num(t.subtotal), vat: num(t.vat), total: num(t.total) };
  return out.subtotal === null && out.vat === null && out.total === null ? null : out;
}

/** GET /company/quotes */
export async function listCompanyQuotes(env, { user }) {
  const { company } = await projectCompanyOf(env, user);
  const designs =
    (await selectMany(env, 'designs', {
      company_id: `eq.${company.id}`,
      select: 'id,name,project_id',
      order: 'updated_at.desc',
      limit: String(COMPANY_QUOTE_DESIGNS),
    })) || [];
  const head = { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null };
  if (!designs.length) return { company: head, items: [] };

  const docs =
    (await selectMany(env, 'design_documents', {
      design_id: `in.(${designs.map((d) => d.id).join(',')})`,
      doc_type: `eq.${QUOTE_DOC_TYPE}`,
      select:
        'id,design_id,rev,doc_no,status,title,customer_name_masked,totals,expires_at,' +
        'first_viewed_at,view_count,decision,decided_at,superseded_by,created_at',
      order: 'created_at.desc',
      limit: String(COMPANY_QUOTES_LIMIT),
    })) || [];
  const designOf = new Map(designs.map((d) => [d.id, d]));
  // 다른 업체 설계의 문서가 섞여 오지 않게 한 번 더 거른다 (설계 목록은 이미 이 업체 것만이다)
  const mine = docs.filter((d) => designOf.has(d.design_id));

  const projectIds = [...new Set(mine.map((d) => designOf.get(d.design_id).project_id).filter(Boolean))];
  const projects = projectIds.length
    ? (await selectMany(env, 'projects', {
        id: `in.(${projectIds.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,title,customer_id',
      })) || []
    : [];
  const customerIds = [...new Set(projects.map((p) => p.customer_id).filter(Boolean))];
  const customers = customerIds.length
    ? (await selectMany(env, 'customers', {
        id: `in.(${customerIds.join(',')})`,
        company_id: `eq.${company.id}`,
        select: 'id,name',
      })) || []
    : [];
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const customerOf = new Map(customers.map((c) => [c.id, c]));

  return {
    company: head,
    items: mine.map((d) => {
      const design = designOf.get(d.design_id);
      const project = design.project_id ? projectOf.get(design.project_id) || null : null;
      const customer = project ? customerOf.get(project.customer_id) || null : null;
      return {
        id: d.id,
        doc_no: d.doc_no || null,
        rev: d.rev ?? null,
        status: d.status,
        title: d.title || null,
        created_at: d.created_at,
        expires_at: d.expires_at || null,
        first_viewed_at: d.first_viewed_at || null,
        view_count: num(d.view_count) ?? 0,
        decision: d.decision || null,
        decided_at: d.decided_at || null,
        superseded: Boolean(d.superseded_by),
        totals: quoteTotals(d.totals),
        design: { id: design.id, name: design.name || null },
        project: project ? { id: project.id, title: project.title || null } : null,
        customer_name: (customer && customer.name) || d.customer_name_masked || null,
      };
    }),
  };
}
