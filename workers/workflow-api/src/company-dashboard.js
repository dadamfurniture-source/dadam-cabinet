/**
 * 프로젝트 관리 대시보드 — 내 업체의 진행 중 프로젝트를 경영 숫자로 줄여 준다.
 * (2026-11-23 대표님 승인 계획 「프로젝트 관리 새 틀」 — 「우리 팩토리 숫자」(GET /company/summary) 자리를 그래프로 바꾼다)
 *
 *   GET /company/dashboard   내 업체 (대표 · 실장)
 *     { company { id, name, kind, plan }, today, thresholds,
 *       active     { count, stuck, held }                                  진행 중 · 그 가운데 멈춘 것 · 보류
 *       steps      [{ key, label, count, fresh, slow, stuck }]             단계마다 쌓인 프로젝트 (상담 ~ 설치)
 *       days       { window { days, start, end }, steps[{ key, label, n, medianDays, prevDays, delta }], worst }
 *       money      { backlog { amount, count },
 *                    overdue { amount, count, orders, oldestDays, buckets[{ key, label, amount, count }] },
 *                    upcoming { amount, weeks[{ start, amount, count }] },
 *                    month { month, count, amount, prevCount, prevAmount } }
 *       load       { weeks[{ start, make, install }] } | null               앞 8주 제작 착수 · 설치 일정 수
 *       conversion { months[{ month, issued, ordered, rate }] }            견적 → 계약, 여섯 달
 *       install    { done, onTime, onTimeRate, overdue } | null            설치 납기 (반년)
 *       as         { installed, requests, rate } | null }                  A/S 율 (반년, 생산하는 업체만)
 *
 * 정한 것 (2026-11-23 대표님 답)
 *   금액      대표 · 실장에게 금액까지 보인다 (수주 잔고 · 미수금 · 받을 돈 · 이번 달 계약). 직원은 403 — 이 길을 못 읽는다.
 *   느림 · 멈춤 단계에 머문 날수 — 상담 2/7 · 실측 2/7 · 설계 3/7 · 견적 3/7 · 계약 3/7 (STUCK_DAYS).
 *             생산 · 설치는 날수로 치지 않고, 잡아 둔 제작 완료일 · 설치일이 지나면 멈춤.
 *   머문 날   상담 = 프로젝트를 만든 날부터 · 실측 = 실측 예정일부터(끝냈으면 끝낸 날부터) ·
 *             설계 = 실측을 끝낸 날부터(실측이 없으면 만든 날부터) · 견적 = 견적을 보낸 날부터(답을 받았으면 그날부터) ·
 *             계약 = 계약을 만든 날부터
 *
 * 단계는 프로젝트 목록(GET /company/projects)이 정한 것 그대로 — 왼쪽 메뉴의 수 · 줄의 단계 띠와 어긋나지 않는다.
 * 셈은 경영 요약과 같은 함수(funnelOf · leadTimeOf)를 쓰고, 나머지는 이 파일의 순수 함수 dashboardOf 가 한다.
 * 싣지 않는 것: 고객 이름 · 전화 · 주소 · 원가 · 마진. 읽기만 한다. DB 변경 없음.
 */

import { selectMany } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { projectCompanyOf, listCompanyProjects } from './company-projects.js';
import { isFactory } from './company-pipeline.js';
import { STEP_LABEL } from './pipeline.js';
import { kstDate } from './production/service.js';
import { funnelOf, leadTimeOf, prevMonthOf, QUALITY_WINDOW_DAYS } from './management/summary.js';

const DAY_MS = 86400000;

/** 대시보드에 그리는 단계 — 끝난 것(done)은 세지 않는다 */
export const DASH_STEPS = Object.freeze(['consult', 'measure', 'design', 'quote', 'contract', 'make', 'install']);
/** 며칠을 머물면 느림 · 멈춤인가 (2026-11-23 대표님). 생산 · 설치는 잡은 날이 지났는지로 본다 */
export const STUCK_DAYS = Object.freeze({
  consult: Object.freeze({ slow: 2, stuck: 7 }),
  measure: Object.freeze({ slow: 2, stuck: 7 }),
  design: Object.freeze({ slow: 3, stuck: 7 }),
  quote: Object.freeze({ slow: 3, stuck: 7 }),
  contract: Object.freeze({ slow: 3, stuck: 7 }),
});
/** 걸린 날을 재는 창 — 지난 석 달과 그 앞 석 달 */
export const DAYS_WINDOW = 90;
/** 앞으로 몇 주 */
export const AHEAD_WEEKS = 8;
/** 전환율을 몇 달 */
export const CONVERSION_MONTHS = 6;
/** 계약했고 설치 전인 수주 */
const OPEN_ORDER = new Set(['confirmed', 'in_production', 'delivered']);
/** 끝난 일정 */
const SCHEDULE_OVER = new Set(['cancelled', 'completed', 'done']);
/** 받을 날이 지난 돈을 묶는 칸 */
const OVERDUE_BUCKETS = Object.freeze([
  { key: '1-30', label: '1 ~ 30일', max: 30 },
  { key: '31-60', label: '31 ~ 60일', max: 60 },
  { key: '61+', label: '61일 넘음', max: Infinity },
]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const one = (v) => (v === null ? null : Math.round(v * 10) / 10);
/** 'YYYY-MM-DD' 둘 사이 날수 (b − a) */
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** 그 날이 든 주의 월요일 */
export function mondayOf(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const projectOf = (row) => (row && row.designs && row.designs.project_id) || null;
const isActive = (p) => !p.status || p.status === 'active';

/** 프로젝트마다 가장 이른 것 하나 */
function earliest(rows, keyOf, timeOf) {
  const out = new Map();
  for (const r of rows || []) {
    const k = keyOf(r);
    const t = timeOf(r);
    if (!k || !t) continue;
    const cur = out.get(k);
    if (!cur || String(t) < String(timeOf(cur))) out.set(k, r);
  }
  return out;
}

/**
 * 한 프로젝트가 지금 단계에 머문 날과 상태 — { since, days, state: fresh | slow | stuck }.
 * item = 프로젝트 목록의 한 줄 (step · next · visit · created_at)
 */
export function stayOf(item, { today, orderOf = new Map(), lateMake = new Set(), lateInstall = new Set() }) {
  const step = item.step;
  if (step === 'make' || step === 'install') {
    const late = (step === 'make' ? lateMake : lateInstall).has(item.id);
    return { since: null, days: null, state: late ? 'stuck' : 'fresh' };
  }
  const limit = STUCK_DAYS[step];
  if (!limit) return { since: null, days: null, state: 'fresh' };
  const visit = item.visit || null;
  const next = item.next || null;
  let since = null;
  if (step === 'measure') since = visit ? (visit.status === 'done' ? visit.done_at : visit.scheduled_at) : null;
  else if (step === 'design') since = visit && visit.status === 'done' ? visit.done_at : null;
  else if (step === 'quote') since = next ? next.since : null;
  else if (step === 'contract') since = (orderOf.get(item.id) || {}).ordered_at || (next ? next.since : null);
  since = since || item.created_at || null;
  const days = since ? Math.max(0, dayDiff(kstDate(since), today)) : 0;
  return { since, days, state: days >= limit.stuck ? 'stuck' : days >= limit.slow ? 'slow' : 'fresh' };
}

/** 단계마다 쌓인 프로젝트 — 진행 중(active)인 것만 */
function stepsOf(items, ctx) {
  const rows = new Map(DASH_STEPS.map((k) => [k, { key: k, label: STEP_LABEL[k], count: 0, fresh: 0, slow: 0, stuck: 0 }]));
  let held = 0;
  for (const p of items) {
    if (p.status === 'on_hold') held += 1;
    if (!isActive(p)) continue;
    const row = rows.get(p.step);
    if (!row) continue;
    row.count += 1;
    row[stayOf(p, ctx).state] += 1;
  }
  const steps = [...rows.values()];
  return {
    steps,
    active: {
      count: steps.reduce((t, s) => t + s.count, 0),
      stuck: steps.reduce((t, s) => t + s.stuck, 0),
      held,
    },
  };
}

/**
 * 단계마다 걸린 날 — 그 단계를 끝낸 때가 창 안인 것의 가운데 값, 그 앞 창과 견준다.
 *   상담 만든 때 → 실측 일정을 잡은 때 · 실측 잡은 때 → 끝낸 때 · 설계 실측 끝(없으면 만든 때) → 첫 견적 ·
 *   견적 첫 견적 → 계약 · 계약 계약 → 생산 시작 · 생산 생산 시작 → 배송 · 설치 배송 → 완료
 */
function durationsOf({ items, visits, docs, orders, starts }, today) {
  const curStart = addDays(today, -(DAYS_WINDOW - 1));
  const prevStart = addDays(curStart, -DAYS_WINDOW);
  const firstVisit = earliest((visits || []).filter((v) => v.status !== 'cancelled'), (v) => v.project_id, (v) => v.created_at);
  const firstDoc = earliest(docs, projectOf, (d) => d.created_at);
  const firstOrder = earliest((orders || []).filter((o) => o.status !== 'cancelled'), (o) => o.project_id, (o) => o.ordered_at);
  const startOf = earliest(starts, (e) => e.order_id, (e) => e.at);
  const cur = Object.fromEntries(DASH_STEPS.map((k) => [k, []]));
  const prev = Object.fromEntries(DASH_STEPS.map((k) => [k, []]));
  const put = (key, from, to) => {
    const a = Date.parse(from || '');
    const b = Date.parse(to || '');
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return;
    const day = kstDate(to);
    if (day >= curStart && day <= today) cur[key].push((b - a) / DAY_MS);
    else if (day >= prevStart && day < curStart) prev[key].push((b - a) / DAY_MS);
  };
  for (const p of items) {
    const visit = firstVisit.get(p.id) || null;
    const doc = firstDoc.get(p.id) || null;
    const order = firstOrder.get(p.id) || null;
    const visitDone = visit && visit.status === 'done' ? visit.done_at : null;
    if (visit) put('consult', p.created_at, visit.created_at);
    if (visit) put('measure', visit.created_at, visitDone);
    if (doc) put('design', visitDone || p.created_at, doc.created_at);
    if (doc && order) put('quote', doc.created_at, order.ordered_at);
    if (order) {
      const began = (startOf.get(order.id) || {}).at || null;
      put('contract', order.ordered_at, began);
      put('make', began, order.delivered_at);
      put('install', order.delivered_at, order.completed_at);
    }
  }
  const steps = DASH_STEPS.map((k) => {
    const now = one(median(cur[k]));
    const before = one(median(prev[k]));
    return {
      key: k,
      label: STEP_LABEL[k],
      n: cur[k].length,
      medianDays: now,
      prevDays: before,
      delta: now !== null && before !== null ? one(now - before) : null,
    };
  });
  const grew = steps.filter((s) => s.delta !== null && s.delta > 0);
  const worst = grew.length ? grew.reduce((a, b) => (b.delta > a.delta ? b : a)) : null;
  return {
    window: { days: DAYS_WINDOW, start: curStart, end: today },
    steps,
    worst: worst ? { key: worst.key, label: worst.label, delta: worst.delta } : null,
  };
}

/** 앞 8주의 주 칸 — 이번 주 월요일부터 */
function weeksFrom(today, make) {
  const first = mondayOf(today);
  return Array.from({ length: AHEAD_WEEKS }, (_, i) => ({ start: addDays(first, i * 7), ...make() }));
}
const weekIndex = (day, today) => Math.floor(dayDiff(mondayOf(today), day) / 7);

/** 돈 — 수주 잔고 · 받을 날이 지난 미수금 · 앞 8주 받을 돈 · 이번 달 계약 */
function moneyOf({ orders, payments }, today) {
  const live = new Map((orders || []).filter((o) => o.status !== 'cancelled').map((o) => [o.id, o]));
  const open = [...live.values()].filter((o) => OPEN_ORDER.has(o.status));
  const buckets = OVERDUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: 0, count: 0 }));
  const lateOrders = new Set();
  let oldest = 0;
  const weeks = weeksFrom(today, () => ({ amount: 0, count: 0 }));
  for (const p of payments || []) {
    if (p.paid_on || !p.due_on || !live.has(p.order_id)) continue;
    const due = String(p.due_on).slice(0, 10);
    const amount = num(p.amount);
    if (due < today) {
      const days = dayDiff(due, today);
      const at = OVERDUE_BUCKETS.findIndex((b) => days <= b.max);
      buckets[at].amount += amount;
      buckets[at].count += 1;
      lateOrders.add(p.order_id);
      if (days > oldest) oldest = days;
      continue;
    }
    const w = weeks[weekIndex(due, today)];
    if (w) {
      w.amount += amount;
      w.count += 1;
    }
  }
  const month = today.slice(0, 7);
  const before = prevMonthOf(month);
  const inMonth = (m) => [...live.values()].filter((o) => o.ordered_at && kstDate(o.ordered_at).slice(0, 7) === m);
  const sum = (list) => list.reduce((t, o) => t + num(o.contract_amount), 0);
  const thisMonth = inMonth(month);
  const lastMonth = inMonth(before);
  const overdueCount = buckets.reduce((t, b) => t + b.count, 0);
  return {
    backlog: { amount: sum(open), count: open.length },
    overdue: {
      amount: buckets.reduce((t, b) => t + b.amount, 0),
      count: overdueCount,
      orders: lateOrders.size,
      oldestDays: overdueCount ? oldest : null,
      buckets,
    },
    upcoming: { amount: weeks.reduce((t, w) => t + w.amount, 0), weeks },
    month: { month, count: thisMonth.length, amount: sum(thisMonth), prevCount: lastMonth.length, prevAmount: sum(lastMonth) },
  };
}

/** 앞 8주 제작 착수 · 설치 일정 수 (취소 뺌, 오늘부터) */
function loadOf(schedules, today) {
  if (!Array.isArray(schedules)) return null;
  const weeks = weeksFrom(today, () => ({ make: 0, install: 0 }));
  for (const s of schedules) {
    if (s.status === 'cancelled' || !s.scheduled_at) continue;
    const key = s.type === 'manufacturing_start' ? 'make' : s.type === 'installation' ? 'install' : null;
    if (!key) continue;
    const day = kstDate(s.scheduled_at);
    if (day < today) continue;
    const w = weeks[weekIndex(day, today)];
    if (w) w[key] += 1;
  }
  return { weeks };
}

/** 잡아 둔 날이 지났는데 끝내지 않은 일정이 있는 프로젝트 */
function lateProjects(schedules, type, today) {
  const out = new Set();
  for (const s of schedules || []) {
    if (s.type !== type || s.completed_at || SCHEDULE_OVER.has(s.status) || !s.scheduled_at) continue;
    const pid = projectOf(s);
    if (pid && kstDate(s.scheduled_at) < today) out.add(pid);
  }
  return out;
}

/** 견적 → 계약 — 그 달에 처음 견적이 나간 설계 가운데 계약(취소 아닌 수주)이 된 비율, 여섯 달 */
function conversionOf({ docs, orders }, today) {
  const months = [today.slice(0, 7)];
  while (months.length < CONVERSION_MONTHS) months.unshift(prevMonthOf(months[0]));
  return {
    months: months.map((m) => {
      const f = funnelOf({ documents: docs || [], consultations: null, orders: orders || [] }, m);
      return { month: m, issued: f.issued, ordered: f.ordered, rate: pct(f.ordered, f.issued) };
    }),
  };
}

/** A/S 율 — 반년 동안 끝낸 수주 가운데 A/S 접수 (거둔 접수 뺌). 생산하는 업체만, 표가 없으면 null */
function asOf({ asRows, orders }, today) {
  if (!Array.isArray(asRows)) return null;
  const start = addDays(today, -(QUALITY_WINDOW_DAYS - 1));
  const within = (iso) => !!iso && kstDate(iso) >= start;
  const installed = (orders || []).filter((o) => o.status === 'completed' && within(o.completed_at)).length;
  const requests = asRows.filter((r) => r.state !== 'cancelled' && within(r.created_at)).length;
  return { installed, requests, rate: pct(requests, installed) };
}

/**
 * 대시보드 (순수) — 읽어 온 줄들로 숫자를 만든다.
 * @param {{ items: object[], orders: object[], payments: object[], docs: object[], schedules: object[]|null,
 *           visits: object[]|null, starts: object[], asRows: object[]|null }} rows
 * @param {string} today 한국 날짜 'YYYY-MM-DD'
 */
export function dashboardOf({ items = [], orders = [], payments = [], docs = [], schedules = null, visits = null, starts = [], asRows = null }, today) {
  // 계약 단계의 머문 날은 가장 새 수주부터 센다 — 목록이 보는 수주와 같게
  const orderOf = new Map();
  for (const o of orders) {
    if (o.status === 'cancelled' || !o.project_id || !o.ordered_at) continue;
    const cur = orderOf.get(o.project_id);
    if (!cur || String(o.ordered_at) > String(cur.ordered_at)) orderOf.set(o.project_id, o);
  }
  const ctx = {
    today,
    orderOf,
    lateMake: lateProjects(schedules, 'manufacturing_end', today),
    lateInstall: lateProjects(schedules, 'installation', today),
  };
  const lead = leadTimeOf({ schedules, leadOrders: orders }, today.slice(0, 7), today);
  return {
    today,
    thresholds: STUCK_DAYS,
    ...stepsOf(items, ctx),
    days: durationsOf({ items, visits, docs, orders, starts }, today),
    money: moneyOf({ orders, payments }, today),
    load: loadOf(schedules, today),
    conversion: conversionOf({ docs, orders }, today),
    install: lead
      ? { done: lead.install.done, onTime: lead.install.onTime, onTimeRate: lead.install.onTimeRate, overdue: lead.install.overdue }
      : null,
    as: asOf({ asRows, orders }, today),
  };
}

/** 표가 아직 없으면(DB 적용 전) null — 그 밖의 오류는 그대로 던진다 */
async function orNull(promise) {
  try {
    return (await promise) || [];
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** GET /company/dashboard */
export async function getCompanyDashboard(env, { user, nowMs = Date.now() }) {
  const { company } = await projectCompanyOf(env, user, { manage: true });
  const today = kstDate(new Date(nowMs).toISOString());
  const co = `eq.${company.id}`;
  const from = (days) => `${addDays(today, -days)}T00:00:00+09:00`;
  const byDesign = (query) => ({
    ...query,
    select: `${query.select},designs!inner(company_id,project_id)`,
    'designs.company_id': co,
  });

  const [list, orders, payments, docs, schedules, visits, events, asRows] = await Promise.all([
    // 단계 · 다음 할 일은 프로젝트 목록이 정한 것 그대로 쓴다
    listCompanyProjects(env, { user, nowMs }),
    selectMany(env, 'orders', {
      company_id: co,
      select: 'id,project_id,design_id,status,contract_amount,ordered_at,delivered_at,completed_at',
      order: 'ordered_at.desc',
      limit: '10000',
    }),
    selectMany(env, 'order_payments', {
      select: 'order_id,stage,amount,due_on,paid_on,orders!inner(company_id)',
      'orders.company_id': co,
      limit: '10000',
    }),
    // 견적(고객 확인서) — 코호트는 처음 나간 달로 묶으니 기간을 자르지 않는다. 금액 · 서명은 읽지 않는다
    selectMany(
      env,
      'design_documents',
      byDesign({
        select: 'design_id,doc_type,status,decision,created_at,first_viewed_at,decided_at',
        doc_type: 'eq.customer_confirmation',
        order: 'created_at.asc',
        limit: '5000',
      })
    ),
    // 일정 — 납기는 반년 창, 앞 8주는 오늘부터. 못 읽으면 그 칸만 비운다
    selectMany(
      env,
      'design_schedules',
      byDesign({
        select: 'design_id,type,status,scheduled_at,planned_at,completed_at',
        type: 'in.(manufacturing_start,manufacturing_end,installation)',
        scheduled_at: `gte.${from(QUALITY_WINDOW_DAYS + 120)}`,
        limit: '10000',
      })
    ).catch(() => null),
    orNull(
      selectMany(env, 'project_visits', {
        company_id: co,
        select: 'project_id,status,scheduled_at,done_at,created_at',
        order: 'created_at.asc',
        limit: '5000',
      })
    ),
    // 생산을 시작한 때 — 수주 상태 기록 (승인을 거쳤으면 승인한 때)
    selectMany(env, 'order_events', {
      company_id: co,
      kind: 'eq.status',
      to_status: 'eq.in_production',
      state: 'in.(done,approved)',
      select: 'order_id,state,created_at,decided_at',
      limit: '5000',
    }).catch(() => []),
    isFactory(company)
      ? orNull(
          selectMany(env, 'as_requests', {
            company_id: co,
            created_at: `gte.${from(QUALITY_WINDOW_DAYS)}`,
            select: 'state,created_at',
            limit: '5000',
          })
        )
      : null,
  ]);

  return {
    company: { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null },
    ...dashboardOf(
      {
        items: (list && list.items) || [],
        orders: orders || [],
        payments: payments || [],
        docs: docs || [],
        schedules,
        visits,
        starts: (events || []).map((e) => ({ order_id: e.order_id, at: e.state === 'approved' ? e.decided_at || e.created_at : e.created_at })),
        asRows,
      },
      today
    ),
  };
}
