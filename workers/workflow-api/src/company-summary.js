/**
 * 업체 숫자 — 내 업체의 견적 흐름(퍼널)과 리드타임 · 납기를 읽는다.
 * (마이페이지 B안 5단계 — 지금까지는 관리자용 경영 요약(GET /management/summary)에 다담 공장 것만 있었다)
 *
 *   GET /company/summary[?month=YYYY-MM]   내 업체 숫자 (대표 · 실장) — month 가 없으면 이번 달(한국 시간)
 *     { company { id, name, kind, plan }, month,
 *       funnel { leads, issued, viewed, approved, ordered, rejected, pending, conversion, viewRate, orderRate,
 *                avgRevisions, medianHoursToView, medianDaysToDecide, reasons { requests, noReason, codes[] } },
 *       lead   { window { start, end }, orders, totalMedianDays, stages[{ key, label, n, medianDays }], slowest,
 *                install { done, onTime, onTimeRate, avgLateDays, rescheduled, overdue } } | null }
 *
 * 셈은 관리자 경영 요약과 **같은 함수**(management/summary.js funnelOf · leadTimeOf)를 쓴다 — 읽는 자료만 내 업체 것으로 바꾼다.
 *   funnel  그 달에 처음 확인서가 나간 설계를 한 건으로 묶는다(코호트). 발행 → 열람 → 승인 → 수주.
 *           leads 는 그 달 내 업체로 들어온 상담 수 (못 읽으면 null)
 *   lead    반년 창. 수주 → 실측 → 제작 착수 → 제작 → 설치 사이 날수의 중간값, 설치 납기 준수. 일정 칸이 없으면 null
 * 누가      프로젝트를 가지는 업체(다담 공장 · active 협력업체 Manager · Expert · Agent)의 **대표 · 실장** —
 *           회계 요약(GET /books/summary)과 같은 사람. 직원은 403 not_manager.
 * 싣지 않는 것 금액 · 원가 · 마진 · 고객 이름 · 전화 — 건수 · 비율 · 날수뿐이다. 다른 업체 자료는 읽지 않는다.
 * 읽기만 한다. DB 변경 없음.
 */

import { selectMany } from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { kstDate } from './production/service.js';
import { funnelOf, leadTimeOf, QUALITY_WINDOW_DAYS } from './management/summary.js';
import { windowStart } from './management/service.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 설계에 붙은 표(design_id)를 그 업체 설계 것만 — designs!inner 로 걸러 읽는다 (management/service.js hqByDesign 과 같다) */
function byCompanyDesign(query, companyId) {
  return {
    ...query,
    select: `${query.select},designs!inner(company_id)`,
    'designs.company_id': `eq.${companyId}`,
  };
}

/** 물은 달 — 'YYYY-MM' 꼴이 아니면 이번 달(한국 시간) */
export function summaryMonth(month, nowMs = Date.now()) {
  return MONTH_RE.test(String(month || '')) ? month : kstDate(new Date(nowMs).toISOString()).slice(0, 7);
}

/** GET /company/summary */
export async function getCompanySummary(env, { user, query = {}, nowMs = Date.now() }) {
  const { company } = await projectCompanyOf(env, user, { manage: true });
  const m = summaryMonth(query && query.month, nowMs);
  const CO = `eq.${company.id}`;
  const leadFrom = `${windowStart(m, QUALITY_WINDOW_DAYS + 120)}T00:00:00+09:00`;

  const [documents, consultations, orders, schedules] = await Promise.all([
    // 코호트는 설계에 확인서가 '처음' 나간 달로 묶는다 — 그래서 기간을 자르지 않고 읽는다.
    // 수정 요청 사유 코드만 꺼낸다 (메모 · 서명 · 금액은 읽지 않는다)
    selectMany(
      env,
      'design_documents',
      byCompanyDesign(
        {
          select:
            'design_id,doc_type,status,decision,created_at,first_viewed_at,decided_at,reasons:render_payload->decision_reasons',
          doc_type: 'eq.customer_confirmation',
          order: 'created_at.asc',
          limit: '5000',
        },
        company.id
      )
    ),
    // 상담은 건수만 — 이름 · 연락처는 읽지 않는다
    selectMany(env, 'consultations', {
      select: 'created_at',
      company_id: CO,
      created_at: `gte.${m}-01T00:00:00+09:00`,
      limit: '5000',
    }).catch(() => null),
    // 수주는 설계 · 상태 · 수주한 때만 — 금액 · 고객은 읽지 않는다
    selectMany(env, 'orders', {
      select: 'design_id,ordered_at,status',
      company_id: CO,
      order: 'ordered_at.desc',
      limit: '5000',
    }).catch(() => []),
    selectMany(
      env,
      'design_schedules',
      byCompanyDesign(
        {
          select: 'design_id,type,status,scheduled_at,planned_at,completed_at',
          type: 'in.(measurement,manufacturing_start,manufacturing_end,installation)',
          scheduled_at: `gte.${leadFrom}`,
          limit: '10000',
        },
        company.id
      )
    ).catch(() => null),
  ]);

  const today = kstDate(new Date(nowMs).toISOString());
  return {
    company: { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null },
    month: m,
    funnel: funnelOf({ documents: documents || [], consultations, orders: orders || [] }, m),
    lead: leadTimeOf({ schedules, leadOrders: orders || [] }, m, today),
  };
}
