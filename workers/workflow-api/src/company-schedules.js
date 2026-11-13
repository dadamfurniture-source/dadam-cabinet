/**
 * 업체 업무 달력 — 내 업체의 날짜 있는 일을 한 목록으로 (마이페이지 「프로젝트 관리」 달력).
 *
 *   GET /company/schedules?from=YYYY-MM-DD&to=YYYY-MM-DD   (한국 날짜, 둘 다 없으면 이번 달 · 길어야 SCHEDULE_RANGE_DAYS 일)
 *     → { company, can_manage, range, today, truncated, items }
 *
 * 누가: 프로젝트를 가질 수 있는 업체(다담 공장 · Manager 이상 협력업체)의 active 구성원 — /company/projects 와 같다.
 * 무엇을 (종류 kind):
 *   - 일정 표 design_schedules (source schedule) — 실측 = 영업(sales) · 자재 발주 · 제작 착수 · 제작 완료 · 검수 = 생산(make)
 *     · 납품 · 설치 = 설치(install) · A/S 방문 = A/S(as). 취소한 일정도 준다 (status cancelled — 화면이 흐리게, 되살릴 수 있게)
 *   - 상담 희망일 consultations.preferred_date (source consult) — 내 업체 사본, 돌려보낸 · 취소한 상담 뺌 = 영업
 *   - 받을 날 order_payments.due_on (source payment) — 아직 안 받은 줄, 취소 수주 뺌 = 영업. 금액이 있어 대표 · 실장에게만
 *   - A/S 접수 as_requests.created_at (source as) — 거둔 접수 뺌 = A/S. 표가 아직 없으면(DB 0045 전) 건너뛴다
 *   - 설계 마감 (source design_due) = 설계(design) — 계약금 입금날 당일 (2026-11-10 대표님 결정). 수주마다 한 줄:
 *     계약금을 받은 날(가장 이른 paid_on, status deposit_paid). 아직 안 받은 수주는 싣지 않는다 — 입금된 뒤에만 보인다
 *     (2026-11-10 대표님 결정. 받을 날은 영업의 「계약금 받을 날」 줄로 대표 · 실장에게만 간다).
 *     취소 수주 뺌. 날짜만 싣고 금액은 읽지도 않는다 — 구성원 모두에게
 *   - 프로젝트의 작업 work_jobs.starts_at (source work) — 프로젝트 「작업 배정」에서 날짜를 정한 철거 · 재단 · 엣지 · 조립
 *     (work/project-work.js). 재단 · 엣지 · 조립 = 생산(make), 철거 = 설치(install — 현장 일). 날짜를 정하지 않은 작업 · 취소한 작업은
 *     싣지 않는다. 설치 · A/S 일정에서 생긴 작업은 그 일정 줄이 이미 있어 싣지 않는다. 표 · 칸이 아직 없으면(DB 0065 전) 건너뛴다.
 *     status = unassigned(작업자 미정) · offered(수락 대기) · confirmed(연결됨) · in_progress(작업 중) · review(완료 보고) · done(끝남),
 *     assignee_name = 배정된 작업자 이름. 여기서 고치지 않는다 — 날짜 · 작업자는 프로젝트의 「작업 배정」에서
 *
 * can_manage: 일정을 넣고 고칠 수 있나 (대표 · 실장 — src/schedules.js 가 서버에서 다시 막는다).
 * 고객 이름 · 전화 · 주소는 싣지 않는다 — 프로젝트 이름 · 설계 이름 · 수주 번호 · 상담 지역(시도 · 구군)까지.
 * 작업자 이름은 일정의 담당 글과 같은 자리(assignee_name)에만 — 작업자 id · 전화는 싣지 않는다.
 */

import { ValidationError, selectMany } from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { SCHEDULE_LABELS } from './slack.js';
import { PAYMENT_STAGE_LABEL } from './payments.js';
import { isMissingRelation } from './work-order-data.js';
import { ACTIVE_STATUSES } from './work/reveal.js';
import { assigneeNameOf } from './work/schedule-names.js';
import { KIND_LABEL as WORK_KIND_LABEL } from './work/validate.js';

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 한 번에 볼 수 있는 날 수 (월 달력 여섯 주 + 목록 석 달) */
export const SCHEDULE_RANGE_DAYS = 100;
/** 자료 하나에서 읽는 줄 수 — 넘치면 truncated */
export const SCHEDULE_FETCH = 500;

/** 종류 — 영업 · 설계 · 생산 · 설치 · A/S (업무 흐름 차례) */
export const SCHEDULE_KINDS = Object.freeze(['sales', 'design', 'make', 'install', 'as']);
/** 일정 표 type → 종류 */
export const KIND_OF_TYPE = Object.freeze({
  measurement: 'sales',
  material_order: 'make',
  manufacturing_start: 'make',
  manufacturing_end: 'make',
  quality_check: 'make',
  delivery: 'install',
  installation: 'install',
  as_visit: 'as',
});

/** 프로젝트의 작업 종류 → 종류 — 재단 · 엣지 · 조립 = 생산, 철거 = 설치(현장 일). 여기 없는 종류는 달력에 싣지 않는다 */
export const KIND_OF_WORK = Object.freeze({ demolition: 'install', cutting: 'make', edge: 'make', assembly: 'make' });
/** 작업 줄의 상태 (달력 글) */
export const WORK_STATES = Object.freeze(['unassigned', 'offered', 'confirmed', 'in_progress', 'review', 'done']);

/**
 * 작업 줄의 상태 (순수) — 작업 상태가 먼저(작업 중 · 완료 보고 · 끝남), 그 앞은 배정으로 가른다:
 * 답을 기다리는 사람이 있으면 offered, 확정된 사람만 있으면 confirmed, 아무도 없으면 unassigned.
 */
export function workStateOf(job, assignments) {
  const st = job && job.status;
  if (st === 'done' || st === 'closed') return 'done';
  if (st === 'review' || st === 'in_progress') return st;
  const live = (assignments || []).filter((a) => a && ACTIVE_STATUSES.includes(a.status));
  if (live.some((a) => a.status === 'offered')) return 'offered';
  return live.length ? 'confirmed' : 'unassigned';
}

const kstDateOf = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const kstTimeOf = (ms) => new Date(ms + KST_MS).toISOString().slice(11, 16);
/** 그 한국 날짜 0시의 UTC ISO */
const dayStartIso = (date, plusDays = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - KST_MS + plusDays * DAY_MS).toISOString();
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * 볼 기간 — from · to 는 한국 날짜 (둘 다 그날 포함). 둘 다 없으면 이번 달, 하나만 있으면 그날부터(까지) 한 달.
 * @returns {{ from: string, to: string }}
 */
export function scheduleRangeOf(query, nowMs = Date.now()) {
  const q = query || {};
  for (const k of ['from', 'to']) {
    if (q[k] !== undefined && q[k] !== '' && !isDate(q[k]))
      throw new ValidationError(`${k} 는 YYYY-MM-DD 날짜여야 합니다`);
  }
  let from = q.from || null;
  let to = q.to || null;
  if (!from && !to) {
    const today = kstDateOf(nowMs);
    const [y, m] = today.split('-').map(Number);
    from = `${today.slice(0, 8)}01`;
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  } else if (!to) {
    to = new Date(Date.parse(`${from}T00:00:00Z`) + 30 * DAY_MS).toISOString().slice(0, 10);
  } else if (!from) {
    from = new Date(Date.parse(`${to}T00:00:00Z`) - 30 * DAY_MS).toISOString().slice(0, 10);
  }
  if (to < from) throw new ValidationError('to 가 from 보다 빠릅니다');
  if (daysBetween(from, to) >= SCHEDULE_RANGE_DAYS)
    throw new ValidationError(`한 번에 ${SCHEDULE_RANGE_DAYS}일까지 볼 수 있습니다`);
  return { from, to };
}

const byWhen = (a, b) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0;

/** GET /company/schedules */
export async function listCompanySchedules(env, { user, query }, nowMs = Date.now()) {
  const { company, canAct } = await projectCompanyOf(env, user);
  const range = scheduleRangeOf(query, nowMs);
  const fromIso = dayStartIso(range.from);
  const toIso = dayStartIso(range.to, 1); // 마지막 날 다음 0시 (그 앞까지)
  const co = `eq.${company.id}`;
  const limit = String(SCHEDULE_FETCH);

  const [schedules, consults, payments, asRows, depositPaid, workJobs] = await Promise.all([
    selectMany(env, 'design_schedules', {
      scheduled_at: `gte.${fromIso}`,
      select:
        'id,type,title,status,scheduled_at,duration_min,assignee_name,location,design_id,designs!inner(company_id,name,project_id)',
      'designs.company_id': co,
      order: 'scheduled_at.asc',
      limit,
    }),
    selectMany(env, 'consultations', {
      company_id: co,
      preferred_date: `gte.${range.from}`,
      select: 'id,status,title,sido,gugun,preferred_date,preferred_time,project_id',
      order: 'preferred_date.asc',
      limit,
    }),
    canAct
      ? selectMany(env, 'order_payments', {
        select: 'id,order_id,stage,amount,due_on,paid_on,orders!inner(company_id,order_no,status,project_id)',
        'orders.company_id': co,
        'orders.status': 'neq.cancelled',
        paid_on: 'is.null',
        due_on: `gte.${range.from}`,
        order: 'due_on.asc',
        limit,
      })
      : null,
    selectMany(env, 'as_requests', {
      company_id: co,
      created_at: `gte.${fromIso}`,
      select: 'id,order_id,state,created_at',
      order: 'created_at.asc',
      limit,
    }).catch((e) => {
      if (isMissingRelation(e)) return null;
      throw e;
    }),
    // 받은 계약금 줄 — 설계 마감에 쓴다. 금액은 읽지 않는다 (직원도 본다)
    selectMany(env, 'order_payments', {
      select: 'order_id,paid_on,orders!inner(company_id,order_no,status,project_id,design_id)',
      stage: 'eq.deposit',
      'orders.company_id': co,
      'orders.status': 'neq.cancelled',
      paid_on: `gte.${range.from}`,
      order: 'paid_on.asc',
      limit,
    }),
    // 프로젝트의 작업 — 「작업 배정」에서 날짜를 정한 것 (일정에서 생긴 작업은 일정 줄이 이미 있다). DB 0065 전이면 없다
    selectMany(env, 'work_jobs', {
      company_id: co,
      project_id: 'not.is.null',
      schedule_id: 'is.null',
      status: 'neq.cancelled',
      starts_at: `gte.${fromIso}`,
      select: 'id,kind,status,starts_at,ends_at,project_id',
      order: 'starts_at.asc',
      limit,
    }).catch((e) => {
      if (isMissingRelation(e)) return null;
      throw e;
    }),
  ]);
  const truncated = [schedules, consults, payments, asRows, depositPaid, workJobs].some(
    (rows) => (rows || []).length >= SCHEDULE_FETCH,
  );

  // 설계 마감 = 계약금 입금날 — 수주마다 하나, 받은 뒤에만. 기간에 받은 줄이 걸린 수주의 받은 계약금 줄을
  // 모두 읽어 가장 이른 받은 날로 정한다 (기간 앞에 먼저 받았으면 그날이 마감이라 이 기간에는 없다)
  const dueOrderOf = new Map();
  for (const p of depositPaid || []) if (p.paid_on <= range.to) dueOrderOf.set(p.order_id, p.orders || {});
  const depositAll = dueOrderOf.size
    ? (await selectMany(env, 'order_payments', {
      order_id: `in.(${[...dueOrderOf.keys()].join(',')})`,
      stage: 'eq.deposit',
      paid_on: 'not.is.null',
      select: 'order_id,paid_on',
    })) || []
    : [];
  const deadlineOf = new Map();
  for (const p of depositAll) {
    if (!p.paid_on) continue;
    const cur = deadlineOf.get(p.order_id);
    if (!cur || p.paid_on < cur) deadlineOf.set(p.order_id, p.paid_on);
  }
  const dueDesignIds = [...new Set([...dueOrderOf.values()].map((o) => o.design_id).filter(Boolean))];
  const dueDesigns = dueDesignIds.length
    ? (await selectMany(env, 'designs', {
      id: `in.(${dueDesignIds.join(',')})`,
      company_id: co,
      select: 'id,name',
    })) || []
    : [];
  const designNameOf = new Map(dueDesigns.map((d) => [d.id, d.name || null]));

  // A/S 접수 → 수주 번호 · 프로젝트
  const asLive = (asRows || []).filter((r) => r.state !== 'cancelled' && r.created_at < toIso);
  const asOrderIds = [...new Set(asLive.map((r) => r.order_id).filter(Boolean))];
  const asOrders = asOrderIds.length
    ? (await selectMany(env, 'orders', {
      id: `in.(${asOrderIds.join(',')})`,
      company_id: co,
      select: 'id,order_no,project_id',
    })) || []
    : [];
  const orderOf = new Map(asOrders.map((o) => [o.id, o]));

  // 프로젝트의 작업 → 배정된 작업자 (이름 · 상태)
  const workLive = (workJobs || []).filter((j) => KIND_OF_WORK[j.kind] && j.starts_at && j.starts_at < toIso);
  const workAssignments = [];
  for (let i = 0; i < workLive.length; i += 100) {
    workAssignments.push(...((await selectMany(env, 'work_assignments', {
      job_id: `in.(${workLive.slice(i, i + 100).map((j) => j.id).join(',')})`,
      status: `in.(${ACTIVE_STATUSES.join(',')})`,
      select: 'job_id,status,worker_name_snapshot,created_at',
      order: 'created_at.asc',
      limit: '1000',
    })) || []));
  }
  const workersOfJob = new Map();
  for (const a of workAssignments) {
    if (!workersOfJob.has(a.job_id)) workersOfJob.set(a.job_id, []);
    workersOfJob.get(a.job_id).push(a);
  }

  const items = [];
  for (const s of schedules || []) {
    if (!(s.scheduled_at < toIso)) continue;
    const ms = Date.parse(s.scheduled_at);
    const d = s.designs || {};
    items.push({
      key: `schedule:${s.id}`,
      source: 'schedule',
      id: s.id,
      kind: KIND_OF_TYPE[s.type] || 'make',
      type: s.type,
      label: SCHEDULE_LABELS[s.type] || s.type,
      day: kstDateOf(ms),
      at: s.scheduled_at,
      time: kstTimeOf(ms),
      title: s.title || null,
      status: s.status,
      duration_min: s.duration_min || null,
      assignee_name: s.assignee_name || null,
      location: s.location || null,
      design: { id: s.design_id, name: d.name || null },
      project_id: d.project_id || null,
      order_no: null,
      amount: null,
    });
  }
  for (const c of consults || []) {
    if (!c.preferred_date || c.preferred_date > range.to) continue;
    if (c.status === 'returned' || c.status === 'cancelled') continue;
    items.push({
      key: `consult:${c.id}`,
      source: 'consult',
      id: c.id,
      kind: 'sales',
      type: 'consult',
      label: '상담 희망일',
      day: c.preferred_date,
      at: null,
      time: c.preferred_time || null,
      title: c.title || null,
      status: c.status || null,
      location: [c.sido, c.gugun].filter(Boolean).join(' ') || null,
      design: null,
      project_id: c.project_id || null,
      order_no: null,
      amount: null,
    });
  }
  for (const p of payments || []) {
    if (!p.due_on || p.due_on > range.to) continue;
    const o = p.orders || {};
    items.push({
      key: `payment:${p.id}`,
      source: 'payment',
      id: p.id,
      kind: 'sales',
      type: `payment_${p.stage}`,
      label: `${PAYMENT_STAGE_LABEL[p.stage] || '결제'} 받을 날`,
      day: p.due_on,
      at: null,
      time: null,
      title: null,
      status: 'due',
      location: null,
      design: null,
      project_id: o.project_id || null,
      order_no: o.order_no || null,
      amount: Number(p.amount) || 0,
    });
  }
  for (const [orderId, o] of dueOrderOf) {
    const day = deadlineOf.get(orderId);
    if (!day || day < range.from || day > range.to) continue;
    items.push({
      key: `design_due:${orderId}`,
      source: 'design_due',
      id: orderId,
      kind: 'design',
      type: 'design_due',
      label: '설계 마감',
      day,
      at: null,
      time: null,
      title: null,
      status: 'deposit_paid',
      location: null,
      design: o.design_id ? { id: o.design_id, name: designNameOf.get(o.design_id) || null } : null,
      project_id: o.project_id || null,
      order_no: o.order_no || null,
      amount: null,
    });
  }
  for (const r of asLive) {
    const ms = Date.parse(r.created_at);
    const o = orderOf.get(r.order_id) || {};
    items.push({
      key: `as:${r.id}`,
      source: 'as',
      id: r.id,
      kind: 'as',
      type: 'as_request',
      label: 'A/S 접수',
      day: kstDateOf(ms),
      at: r.created_at,
      time: kstTimeOf(ms),
      title: null,
      status: r.state,
      location: null,
      design: null,
      project_id: o.project_id || null,
      order_no: o.order_no || null,
      amount: null,
    });
  }

  for (const j of workLive) {
    const ms = Date.parse(j.starts_at);
    const end = Date.parse(j.ends_at || '');
    const mine = workersOfJob.get(j.id) || [];
    items.push({
      key: `work:${j.id}`,
      source: 'work',
      id: j.id,
      kind: KIND_OF_WORK[j.kind],
      type: `work_${j.kind}`,
      label: WORK_KIND_LABEL[j.kind] || j.kind,
      day: kstDateOf(ms),
      at: j.starts_at,
      time: kstTimeOf(ms),
      title: null,
      status: workStateOf(j, mine),
      duration_min: Number.isFinite(end) && end > ms ? Math.round((end - ms) / 60000) : null,
      assignee_name: assigneeNameOf(mine),
      location: null,
      design: null,
      project_id: j.project_id,
      order_no: null,
      amount: null,
    });
  }

  // 프로젝트 이름 (내 업체 것만)
  const projectIds = [...new Set(items.map((i) => i.project_id).filter(Boolean))];
  const projects = projectIds.length
    ? (await selectMany(env, 'projects', {
      id: `in.(${projectIds.join(',')})`,
      company_id: co,
      select: 'id,title',
    })) || []
    : [];
  const titleOf = new Map(projects.map((p) => [p.id, p.title || null]));

  return {
    company: { id: company.id, name: company.name || null },
    can_manage: canAct,
    range,
    today: kstDateOf(nowMs),
    truncated,
    items: items
      .map(({ project_id: pid, ...rest }) => ({
        ...rest,
        project: pid && titleOf.has(pid) ? { id: pid, title: titleOf.get(pid) } : null,
      }))
      .sort(byWhen),
  };
}
