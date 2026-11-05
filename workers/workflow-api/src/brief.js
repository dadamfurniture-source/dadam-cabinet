/**
 * 아침 브리핑 (AI 비서) — 비서를 쓰는 업체 구성원에게 매일 08:00 「오늘 볼 것 N건」 앱 알림, 본문은 비서 탭이 GET /brief/today 로 받는다.
 * 숫자는 서버가 센 값 그대로다 (AI 글이 아니다).
 * 2026-11-05 대표님 결정 — 담을 것: 상담 · 수금 · 수주 일정 · 회계 · 작업 단계(프로젝트 · 수주 단계, 공장 · 설치 진행).
 *   본문은 서버가 센 목록. 매일 08:00, 볼 것이 0건이면 보내지 않는다.
 *   비서를 쓰는 업체는 장부 아침 묶음 알림을 이 알림 하나로 받는다 (ledger/notices.js 가 그 업체 묶음 알림을 건너뛴다).
 *
 *   누가    company_entitled(업체, 'assistant', 사람) 가 full 인 업체의 active 구성원 (Agent · 시험 업체 중 비서를 켠 곳)
 *   볼 것 (알림 숫자에 드는 것) — 역할마다
 *     consults     대표 · 실장  응답 기다리는 배정 상담 (consult_assignments assigned — 배정 뒤 ASSIGNMENT_TTL_HOURS 안에 받기 · 거절)
 *                              · 가장 이른 마감
 *     receivables  대표 · 실장  받을 날이 오늘이거나 지난 안 받은 수금 (취소 수주 뺌) — 늦음 · 오늘 따로, 건수 · 합계
 *     schedules    모두        오늘부터 SCHEDULE_DAYS 일 안의 납품 · 설치 일정 (design_schedules delivery · installation, 끝남 · 취소 뺌)
 *     requests     대표        결정 기다리는 수주 요청 (order_events pending)
 *     photos       대표 · 실장  확인 기다리는 영수증 · 명세표 사진 (ledger_documents pending)
 *     notices      대표 · 실장  아직 안 본 장부 알림 (ledger_notices seen_at 없음)
 *   현황 (알림 숫자에 들지 않는다 — 비서 탭에서만)
 *     stages  진행 중(active) 프로젝트 중 수주가 없는 것의 단계 수 (상담 · 연출 · 설계 · 견적 — projects.js projectStage)
 *             + 수주 상태별 수 (확정 · 제작 중 · 납품)
 *     work    제작 중 · 납품 수주(최근 WORK_ORDERS 건)의 재단 · 엣지 · 조립 · 설치 필수 확인 진행 (done / total — work/check-state.js).
 *             지시서가 없거나 그 역할 항목이 없으면 null
 *   글에 고객 이름 · 전화 · 주소는 없다. 금액은 대표 · 실장의 수금 칸에만 — 앱 알림 글은 숫자 하나 (push/messages.js assistant_brief).
 *
 *   매분 cron (runMorningBrief) — 08:00 부터 BRIEF_MINUTES 분 (한국 시간). 업체마다 정해진 분(slotOf — 업체 id)에 한 번만 센다
 *     (하위 요청을 분마다 나눈다). 같은 사람 · 같은 날 알림은 하나 (꼬리 dYYYYMMDD).
 */
import { selectMany, selectOne, callRpc, activeMemberships, ForbiddenError, MONEY_ROLES } from './supabase.js';
import { buildMessage } from './push/messages.js';
import { enqueueNotifications, dedupeKeyOf, isUuid } from './push/outbox.js';
import { ASSIGNMENT_TTL_HOURS } from './distribution/rules.js';
import { openRows } from './ledger/money.js';
import { projectStage } from './projects.js';
import { currentDoc, checkRows, roleChecks } from './work/check-state.js';
import { checkListOfDoc } from './work/check-items.js';
import { isMissingRelation } from './work-order-data.js';

/** 매분 cron — 한국 시간 BRIEF_HOUR 시 0분부터 BRIEF_MINUTES 분 동안, 업체마다 한 분 */
export const BRIEF_HOUR = 8;
export const BRIEF_MINUTES = 10;
/** 일정 — 오늘부터 며칠 안 · 탭에 보이는 줄 수 */
export const SCHEDULE_DAYS = 7;
export const SCHEDULE_SHOW = 10;
/** 작업 진행 — 보는 수주 수 (최근 수주순) */
export const WORK_ORDERS = 8;
/** 읽는 줄 수 상한 */
const FETCH = '500';
const PROJECT_FETCH = '200';

export const SCHEDULE_TYPES = Object.freeze(['delivery', 'installation']);
const OPEN_SCHEDULE = '(scheduled,confirmed,in_progress)';
/** 단계 현황 — 수주 없는 프로젝트 단계 · 셀 수주 상태 */
export const OPEN_STAGES = Object.freeze(['consult', 'render', 'design', 'quote']);
export const OPEN_ORDER_STATUSES = Object.freeze(['confirmed', 'in_production', 'delivered']);
const WORK_STATUSES = new Set(['in_production', 'delivered']);
/** 작업 진행 — 문서 종류마다 역할 */
const WORK_DOCS = Object.freeze([
  ['work_order', ['cut', 'edge', 'assembly']],
  ['installation_order', ['install']],
]);
export const WORK_ROLES = Object.freeze(['cut', 'edge', 'assembly', 'install']);

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const kst = (ms) => new Date(ms + KST_MS);
/** 한국 날짜 'YYYY-MM-DD' */
export const kstDateOf = (nowMs) => kst(nowMs).toISOString().slice(0, 10);
/** 그 한국 날짜 0시의 UTC ISO */
const dayStartIso = (date, plusDays = 0) => new Date(Date.parse(`${date}T00:00:00Z`) - KST_MS + plusDays * DAY_MS).toISOString();

/** 역할마다 보는 볼 것 */
export function briefKeysFor(role) {
  const keys = ['schedules'];
  if (MONEY_ROLES.includes(role)) keys.push('consults', 'receivables', 'photos', 'notices');
  if (role === 'owner') keys.push('requests');
  return keys;
}
const ALL_KEYS = ['consults', 'receivables', 'schedules', 'requests', 'photos', 'notices'];

/** 비서를 쓰는 업체인가 — company_entitled(업체, 'assistant') full */
export async function assistantOn(env, companyId) {
  return (await callRpc(env, 'company_entitled', { p_company: companyId, p_feature: 'assistant' })) === 'full';
}

/** 표가 없으면(마이그레이션 전) null — 그 칸을 숨긴다 */
async function orNull(p) {
  try {
    return await p;
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

const num = (v) => Number(v) || 0;

// ── 순수 ─────────────────────────────────────────────────

/** 응답 기다리는 상담 → { count, next_deadline } */
export function consultsOf(rows) {
  const list = (rows || []).filter((r) => r && r.assigned_at);
  if (!list.length) return { count: 0, next_deadline: null };
  const first = Math.min(...list.map((r) => Date.parse(r.assigned_at)));
  return { count: list.length, next_deadline: new Date(first + ASSIGNMENT_TTL_HOURS * 3600 * 1000).toISOString() };
}

/** 받을 날이 오늘 · 지난 안 받은 수금 → { count, total, late_count, late_total, today_count, today_total } */
export function dueOf(rows, today) {
  const out = { count: 0, total: 0, late_count: 0, late_total: 0, today_count: 0, today_total: 0 };
  for (const r of rows || []) {
    if (!r || r.paid_on || !r.due_on || r.due_on > today) continue;
    const a = num(r.amount);
    out.count += 1;
    out.total += a;
    if (r.due_on < today) {
      out.late_count += 1;
      out.late_total += a;
    } else {
      out.today_count += 1;
      out.today_total += a;
    }
  }
  return out;
}

/** 일정 → { count, items: [{ type, at, status, order_no }] } — 이른 것부터, 창 밖 · 다른 종류는 뺀다 */
export function schedulesOf(rows, { from, to }, orderNoOf = () => null) {
  const list = (rows || [])
    .filter((s) => s && SCHEDULE_TYPES.includes(s.type) && s.scheduled_at >= from && s.scheduled_at < to)
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  return {
    count: list.length,
    items: list.slice(0, SCHEDULE_SHOW).map((s) => ({ type: s.type, at: s.scheduled_at, status: s.status, order_no: orderNoOf(s.design_id) })),
  };
}

/** 단계 현황 — { projects: { consult, render, design, quote }, orders: { confirmed, in_production, delivered } } */
export function stagesOf({ projects = [], orders = [], projectOrders = [], designs = [], quotes = [], renders = [] }) {
  const ordersBy = new Map();
  for (const o of projectOrders) {
    if (!o || !o.project_id) continue;
    if (!ordersBy.has(o.project_id)) ordersBy.set(o.project_id, []);
    ordersBy.get(o.project_id).push(o);
  }
  const designSet = new Set(designs.map((d) => d && d.project_id));
  const quoteSet = new Set(quotes.map((d) => d && d.designs && d.designs.project_id));
  const renderSet = new Set(renders.map((g) => g && g.project_id));
  const p = Object.fromEntries(OPEN_STAGES.map((s) => [s, 0]));
  for (const pr of projects) {
    const stage = projectStage({
      orders: ordersBy.get(pr.id) || [],
      hasQuote: quoteSet.has(pr.id),
      hasDesign: designSet.has(pr.id),
      hasRender: renderSet.has(pr.id),
    });
    if (stage in p) p[stage] += 1;
  }
  const o = Object.fromEntries(OPEN_ORDER_STATUSES.map((s) => [s, 0]));
  for (const x of orders) if (x && x.status in o) o[x.status] += 1;
  return { projects: p, orders: o };
}

/**
 * 한 사람의 브리핑 — data 는 loadBrief 결과, 역할에 맞지 않는 볼 것은 null.
 * count = 볼 것 수의 합 (현황은 넣지 않는다)
 */
export function briefFor(data, role) {
  const keys = new Set(briefKeysFor(role));
  const items = Object.fromEntries(ALL_KEYS.map((k) => [k, keys.has(k) && data[k] ? data[k] : null]));
  return {
    role,
    money: MONEY_ROLES.includes(role),
    count: briefCount(items),
    items,
    stages: data.stages || null,
    work: data.work || null,
  };
}

export function briefCount(items) {
  return Object.values(items || {}).reduce((n, x) => n + (x && Number.isInteger(x.count) ? x.count : 0), 0);
}

// ── 읽기 (service_role) ─────────────────────────────────

/** 수주 하나의 재단 · 엣지 · 조립 · 설치 필수 확인 진행 */
async function workOf(env, order) {
  const roles = Object.fromEntries(WORK_ROLES.map((r) => [r, null]));
  if (!order.design_id) return roles;
  for (const [docType, list] of WORK_DOCS) {
    const doc = await currentDoc(env, order.design_id, docType);
    if (!doc) continue;
    const [snapshot, rows] = await Promise.all([
      selectOne(env, 'design_snapshots', { id: `eq.${doc.snapshot_id}`, select: '*' }),
      checkRows(env, doc.id, list),
    ]);
    if (!snapshot || rows === null) continue;
    const ctx = { doc, snapshot, list: checkListOfDoc(doc) };
    for (const role of list) {
      const r = roleChecks(ctx, role, rows);
      if (r.total) roles[role] = { done: r.done, total: r.total, must_left: r.must_left };
    }
  }
  return roles;
}

/** 수주 없는 진행 중 프로젝트의 단계에 드는 줄들 */
async function projectRows(env, companyId) {
  const projects = (await selectMany(env, 'projects', {
    company_id: `eq.${companyId}`,
    status: 'eq.active',
    select: 'id',
    order: 'created_at.desc',
    limit: PROJECT_FETCH,
  })) || [];
  if (!projects.length) return { projects };
  const inP = `in.(${projects.map((p) => p.id).join(',')})`;
  const [projectOrders, designs, quotes, renders] = await Promise.all([
    selectMany(env, 'orders', { project_id: inP, status: 'neq.cancelled', select: 'project_id,status', limit: FETCH }),
    selectMany(env, 'designs', { project_id: inP, select: 'project_id', limit: FETCH }),
    selectMany(env, 'design_documents', {
      doc_type: 'eq.customer_confirmation',
      status: 'neq.revoked',
      select: 'designs!inner(project_id)',
      'designs.project_id': inP,
      limit: FETCH,
    }),
    selectMany(env, 'generations', { project_id: inP, select: 'project_id', limit: FETCH }),
  ]);
  return { projects, projectOrders: projectOrders || [], designs: designs || [], quotes: quotes || [], renders: renders || [] };
}

/**
 * 업체 하나의 브리핑 재료 — keys 에 든 볼 것만 읽는다 (비우면 모두).
 * detail 이면 일정의 수주 번호 · 단계 현황 · 작업 진행까지 (탭에서만 — 알림은 볼 것 수만 센다)
 * @returns {{ today, consults?, receivables?, schedules?, requests?, photos?, notices?, stages?, work? }}
 */
export async function loadBrief(env, companyId, { nowMs = Date.now(), keys = ALL_KEYS, detail = false } = {}) {
  const want = new Set(keys);
  const today = kstDateOf(nowMs);
  const range = { from: dayStartIso(today), to: dayStartIso(today, SCHEDULE_DAYS) };
  const co = `eq.${companyId}`;
  const [orders, consults, due, schedules, requests, photos, notices, pr] = await Promise.all([
    detail
      ? selectMany(env, 'orders', {
        company_id: co,
        status: `in.(${OPEN_ORDER_STATUSES.join(',')})`,
        select: 'id,order_no,status,design_id,ordered_at',
        order: 'ordered_at.desc',
        limit: FETCH,
      })
      : null,
    want.has('consults') ? selectMany(env, 'consult_assignments', { company_id: co, state: 'eq.assigned', select: 'id,assigned_at', limit: FETCH }) : null,
    want.has('receivables')
      ? openRows(env, 'order_payments', companyId, 'id,order_id,amount,due_on,paid_on', { paid_on: 'is.null', due_on: `lte.${today}` })
      : null,
    want.has('schedules')
      ? selectMany(env, 'design_schedules', {
        type: `in.(${SCHEDULE_TYPES.join(',')})`,
        status: `in.${OPEN_SCHEDULE}`,
        scheduled_at: `gte.${range.from}`,
        select: 'id,type,status,scheduled_at,design_id,designs!inner(company_id)',
        'designs.company_id': co,
        order: 'scheduled_at.asc',
        limit: FETCH,
      })
      : null,
    want.has('requests') ? selectMany(env, 'order_events', { company_id: co, state: 'eq.pending', select: 'id', limit: FETCH }) : null,
    want.has('photos') ? orNull(selectMany(env, 'ledger_documents', { company_id: co, review_status: 'eq.pending', select: 'id', limit: '1000' })) : null,
    want.has('notices') ? orNull(selectMany(env, 'ledger_notices', { company_id: co, seen_at: 'is.null', select: 'id', limit: '1000' })) : null,
    detail ? projectRows(env, companyId) : null,
  ]);
  const open = orders || [];
  const orderNoByDesign = new Map();
  for (const o of open) if (o.design_id && !orderNoByDesign.has(o.design_id)) orderNoByDesign.set(o.design_id, o.order_no || null);

  const out = { today };
  if (detail) out.stages = stagesOf({ ...pr, orders: open });
  if (want.has('consults')) out.consults = consultsOf(consults);
  if (want.has('receivables')) out.receivables = dueOf(due, today);
  if (want.has('schedules')) out.schedules = schedulesOf(schedules, range, (id) => orderNoByDesign.get(id) || null);
  if (want.has('requests')) out.requests = { count: (requests || []).length };
  if (want.has('photos')) out.photos = photos === null ? null : { count: photos.length };
  if (want.has('notices')) out.notices = notices === null ? null : { count: notices.length };
  if (detail) {
    const picked = open.filter((o) => WORK_STATUSES.has(o.status)).slice(0, WORK_ORDERS);
    const roles = await Promise.all(picked.map((o) => workOf(env, o)));
    out.work = picked.map((o, i) => ({ order_no: o.order_no || null, status: o.status, roles: roles[i] }));
  }
  return out;
}

// ── 주소 ─────────────────────────────────────────────────

/** GET /brief/today — 비서를 쓰는 업체의 active 구성원 (역할에 맞는 칸만) */
export async function getBrief(env, { user, nowMs = Date.now() }) {
  const [m] = await activeMemberships(env, user);
  if (!m) throw new ForbiddenError('브리핑은 업체 구성원만 봅니다', 'not_member');
  const level = await callRpc(env, 'company_entitled', { p_company: m.company_id, p_feature: 'assistant', p_user: user.id });
  if (level !== 'full') throw new ForbiddenError('비서를 쓰는 업체만 브리핑을 봅니다', 'not_entitled');
  const data = await loadBrief(env, m.company_id, { nowMs, keys: briefKeysFor(m.role), detail: true });
  return { date: data.today, ...briefFor(data, m.role) };
}

// ── 매분 cron ───────────────────────────────────────────

/** 이 분이 브리핑 몇째 분인가 (순수) — 아니면 null */
export function briefSlot(nowMs) {
  const k = kst(nowMs);
  const m = k.getUTCMinutes();
  return k.getUTCHours() === BRIEF_HOUR && m < BRIEF_MINUTES ? m : null;
}

/** 업체가 세는 분 — 업체 id 앞 8자리로 정한다 (목록이 바뀌어도 그대로) */
export function slotOf(companyId) {
  return parseInt(companyId.slice(0, 8), 16) % BRIEF_MINUTES;
}

/** 업체 하나 — 구성원마다 역할에 맞는 수, 0 이면 넣지 않는다 */
async function pushCompany(env, companyId, nowMs) {
  const [members, data] = await Promise.all([
    selectMany(env, 'company_members', { company_id: `eq.${companyId}`, status: 'eq.active', select: 'user_id,role' }),
    loadBrief(env, companyId, { nowMs }),
  ]);
  const day = `d${kstDateOf(nowMs).replace(/-/g, '')}`;
  const rows = [];
  for (const m of members || []) {
    if (!m || !isUuid(m.user_id)) continue;
    const message = buildMessage('assistant_brief', { count: briefFor(data, m.role).count });
    if (!message) continue;
    rows.push({
      userId: m.user_id,
      companyId,
      kind: 'assistant_brief',
      ...message,
      refId: companyId,
      dedupeKey: dedupeKeyOf('assistant_brief', companyId, m.user_id, day),
    });
  }
  return rows.length ? enqueueNotifications(env, rows) : 0;
}

/** 매분 cron — 던지지 않는다 → { companies, sent } | { skipped } */
export async function runMorningBrief(env, { nowMs = Date.now() } = {}) {
  const slot = briefSlot(nowMs);
  if (slot === null) return { skipped: 'not_now' };
  let settings;
  try {
    settings = (await selectMany(env, 'assistant_settings', { enabled: 'eq.true', select: 'company_id', limit: '1000' })) || [];
  } catch (e) {
    console.error('[Brief] settings failed:', e && e.statusCode ? e.statusCode : 'error');
    return { skipped: 'error' };
  }
  const out = { companies: 0, sent: 0 };
  for (const { company_id: co } of settings) {
    if (!isUuid(co) || slotOf(co) !== slot) continue;
    try {
      if (!(await assistantOn(env, co))) continue;
      out.companies += 1;
      out.sent += await pushCompany(env, co, nowMs);
    } catch (e) {
      console.error('[Brief] company failed:', e && e.statusCode ? e.statusCode : 'error');
    }
  }
  return out;
}
