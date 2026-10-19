/**
 * 경영 대시보드 — DB 를 읽어 summary.js 에 넘긴다.
 *
 * **관리자만** 본다. 수주는 설계 주인 기준이 아니라 회사 전체다 (작업 지시 보고 보관함과
 * 같은 방식). 상담은 고객이 남긴 것이라 건수만 읽는다 — 이름 · 연락처는 싣지 않는다.
 */
import { selectMany, selectOne, ForbiddenError } from '../supabase.js';
import { isAdmin } from '../reports/admin.js';
import { mergeSettings, kstDate } from '../production/service.js';
import { buildManagementSummary, prevMonthOf, QUALITY_WINDOW_DAYS, PARTNER_WINDOW_DAYS } from './summary.js';
import { selectOrders } from '../orders.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
/** 처리능력 실측 창 — 그 달 끝에서 거꾸로 90일 (근무일 20일이 넉넉히 들어가게) */
export const PACE_WINDOW_DAYS = 90;

function monthLastDay(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
}

/** 그 달 마지막 날에서 days 일 전 (그날 포함해 days 일) */
export function windowStart(m, days) {
  const end = Date.parse(`${monthLastDay(m)}T00:00:00Z`);
  return new Date(end - (days - 1) * 86400000).toISOString().slice(0, 10);
}

/** 주문 기준으로 읽은 기록과 달 기준으로 읽은 기록이 겹치면 한 번만 (기록 id 로) */
export function mergeLogs(a, b) {
  const seen = new Set();
  const out = [];
  for (const w of [...a, ...b]) {
    if (w.id && seen.has(w.id)) continue;
    if (w.id) seen.add(w.id);
    out.push(w);
  }
  return out;
}

/**
 * 경영 숫자에 쓰는 설정. 보는 사람이 저장한 생산 설정이 있으면 그것,
 * 없으면 가장 최근에 저장된 생산 설정(사장님 것)을 쓴다 — 직원 관리자가 열어도
 * 월 고정비가 기본값으로 떨어지지 않게.
 */
export async function businessSettings(env, user) {
  const mine = await selectOne(env, 'production_settings', { user_id: `eq.${user.id}`, select: 'settings' });
  if (mine) return { ...mergeSettings(mine.settings), source: 'mine' };
  const latest = await selectOne(env, 'production_settings', { select: 'settings', order: 'updated_at.desc' });
  if (latest) return { ...mergeSettings(latest.settings), source: 'latest' };
  return { ...mergeSettings(null), source: 'default' };
}

export async function getManagementSummary(env, { user, month }) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('경영 대시보드는 관리자만 볼 수 있습니다');
  const m = MONTH_RE.test(String(month || '')) ? month : kstDate().slice(0, 7);
  const since = `${prevMonthOf(m)}-01T00:00:00+09:00`;

  const [orders, documents, consultations, generations, designs, settings] = await Promise.all([
    // 구분(price_tier) 칸까지 — 칸이 아직 없으면 빼고 읽는다
    selectOrders(env, {
      select: 'id,order_no,design_id,snapshot_id,customer_name,contract_amount,status,ordered_at',
      ordered_at: `gte.${since}`,
      order: 'ordered_at.desc',
      limit: '1000',
    }),
    // 코호트는 설계에 확인서가 '처음' 나간 달로 묶는다 — 그래서 기간을 자르지 않고 읽는다
    selectMany(env, 'design_documents', {
      // 수정 요청 사유 코드만 꺼낸다 (메모 · 서명은 읽지 않는다)
      select: 'design_id,doc_type,status,decision,created_at,first_viewed_at,decided_at,reasons:render_payload->decision_reasons',
      doc_type: 'eq.customer_confirmation',
      order: 'created_at.asc',
      limit: '5000',
    }),
    // 상담은 건수와 '누가' 만 — 이름 · 연락처는 읽지 않는다
    selectMany(env, 'consultations', { select: 'created_at,user_id', created_at: `gte.${since}`, limit: '5000' }).catch(() => null),
    // 연출컷도 상태 · 사람 · 시각만 — 이미지 · 입력은 읽지 않는다
    selectMany(env, 'generations', { select: 'id,user_id,status,created_at', created_at: `gte.${since}`, limit: '5000' }).catch(() => null),
    // 연출컷에서 시작한 설계 — 연출컷보다 늦게 생기므로 같은 기간으로 충분하다
    selectMany(env, 'designs', { select: 'id,generation_id', generation_id: 'not.is.null', created_at: `gte.${since}`, limit: '5000' }).catch(() => []),
    businessSettings(env, user),
  ]);

  const list = orders || [];
  let snaps = [], costs = [], worklogs = [];
  if (list.length) {
    const ids = [...new Set(list.map((o) => o.snapshot_id).filter(Boolean))];
    const orderIds = list.map((o) => o.id).join(',');
    [snaps, costs, worklogs] = await Promise.all([
      ids.length ? selectMany(env, 'design_snapshots', { id: `in.(${ids.join(',')})`, select: 'id,quote_payload', limit: '1000' }) : [],
      // 실적 원가 · 작업 실측은 그 수주에 붙은 것 — 언제 적었든 수주 기준으로 본다
      selectMany(env, 'order_costs', { order_id: `in.(${orderIds})`, select: 'order_id,category,amount', limit: '5000' }).catch(() => []),
      selectMany(env, 'production_worklogs', { order_id: `in.(${orderIds})`, select: 'id,order_id,role,minutes,work_date', limit: '5000' }).catch(() => []),
    ]);
  }
  // 부하의 '이달 실제로 한 일' 은 주문과 상관없이 그 달 기록 전부다
  const monthLogs = (await selectMany(env, 'production_worklogs', {
    select: 'id,order_id,role,minutes,work_date',
    and: `(work_date.gte.${m}-01,work_date.lte.${monthLastDay(m)})`,
    limit: '5000',
  }).catch(() => [])) || [];
  // 처리능력 실측 — 수량 · 분이 있는 기록만 쓴다 (표준시간 보정과 같은 재료)
  const paceLogs = (await selectMany(env, 'production_worklogs', {
    select: 'role,units,minutes,work_date',
    and: `(work_date.gte.${windowStart(m, PACE_WINDOW_DAYS)},work_date.lte.${monthLastDay(m)})`,
    limit: '10000',
  }).catch(() => [])) || [];
  // 재작업 · A/S (반년 창) — 표가 아직 없으면(2단계 SQL 전) null
  const reworks = await selectMany(env, 'rework_logs', {
    select: 'order_id,kind,cause,occurred_on,minutes,cost',
    and: `(occurred_on.gte.${windowStart(m, QUALITY_WINDOW_DAYS + 31)},occurred_on.lte.${monthLastDay(m)})`,
    limit: '5000',
  }).catch(() => null);
  const installed = (await selectMany(env, 'orders', {
    select: 'id,status,delivered_at,completed_at',
    status: 'in.(delivered,completed)',
    order: 'ordered_at.desc',
    limit: '2000',
  }).catch(() => [])) || [];
  // 설치 후 한 문항 (반년 창, 링크를 만든 날 또는 답한 날 기준) — 점수 · 날짜만 읽는다, 한 줄 메모는 읽지 않는다
  const fbFrom = windowStart(m, QUALITY_WINDOW_DAYS + 31);
  const feedback = await selectMany(env, 'install_feedback', {
    select: 'score,created_at,answered_at',
    or: `(created_at.gte.${fbFrom},answered_at.gte.${fbFrom})`,
    limit: '5000',
  }).catch(() => null);
  // 거래처 · 공급처 (한 해 창) — 표 · 칸이 아직 없으면 null
  const yearFrom = windowStart(m, PARTNER_WINDOW_DAYS + 31);
  const counterparties = await selectMany(env, 'counterparties', { select: 'id,kind,name,category,active', limit: '2000' }).catch(() => null);
  let partnerOrders = null, supplierCosts = [], outsource = [];
  if (counterparties) {
    [partnerOrders, supplierCosts, outsource] = await Promise.all([
      selectMany(env, 'orders', {
        select: 'id,partner_id,price_tier,contract_amount,snapshot_id,status,ordered_at',
        or: '(partner_id.not.is.null,price_tier.eq.partner)',
        ordered_at: `gte.${yearFrom}T00:00:00+09:00`,
        limit: '5000',
      }).catch(() => null),
      selectMany(env, 'order_costs', {
        select: 'counterparty_id,amount,spent_on,created_at',
        counterparty_id: 'not.is.null',
        created_at: `gte.${windowStart(m, PARTNER_WINDOW_DAYS + 400)}T00:00:00+09:00`,
        limit: '10000',
      }).catch(() => []),
      selectMany(env, 'work_reports', {
        select: 'status,period_start,period_end,metrics',
        kind: 'in.(outsource_order,countertop_order)',
        period_start: `gte.${yearFrom}`,
        limit: '5000',
      }).catch(() => []),
    ]);
    // 거래처 수주 중 이달 묶음에 없던 스냅샷도 읽는다 (공헌이익)
    const need = [...new Set((partnerOrders || []).map((o) => o.snapshot_id).filter((id) => id && !snaps.some((s) => s.id === id)))];
    if (need.length) {
      const more = (await selectMany(env, 'design_snapshots', { id: `in.(${need.join(',')})`, select: 'id,quote_payload', limit: '5000' }).catch(() => [])) || [];
      snaps = snaps.concat(more);
    }
  }
  // 현금 (오늘부터 13주) — 수금 · 잔액 표가 아직 없으면 null
  const [balances, payments] = await Promise.all([
    selectMany(env, 'cash_balances', { select: 'as_of,amount,created_at', order: 'as_of.desc,created_at.desc', limit: '20' }).catch(() => null),
    selectMany(env, 'order_payments', { select: 'order_id,stage,amount,due_on,paid_on', limit: '10000' }).catch(() => null),
  ]);
  let dueCosts = [], cashOrders = [], installs = new Map();
  if (payments) {
    [dueCosts, cashOrders] = await Promise.all([
      selectMany(env, 'order_costs', { select: 'amount,due_on,spent_on', spent_on: 'is.null', due_on: 'not.is.null', limit: '5000' }).catch(() => []),
      selectMany(env, 'orders', {
        select: 'id,order_no,customer_name,design_id,contract_amount,received_amount,status,delivered_at,completed_at',
        status: 'in.(confirmed,in_production,delivered,completed)',
        limit: '3000',
      }).catch(() => []),
    ]);
    // 일정 없는 수주는 설치일에 남은 돈이 들어온다고 본다
    const scheduled = new Set(payments.map((p) => p.order_id));
    const designs = [...new Set((cashOrders || []).filter((o) => !scheduled.has(o.id) && !o.delivered_at && !o.completed_at).map((o) => o.design_id).filter(Boolean))];
    if (designs.length) {
      const rows = (await selectMany(env, 'design_schedules', {
        select: 'design_id,scheduled_at,status',
        type: 'eq.installation',
        design_id: `in.(${designs.join(',')})`,
        status: 'neq.cancelled',
        order: 'scheduled_at.asc',
        limit: '5000',
      }).catch(() => [])) || [];
      for (const r of rows) if (!installs.has(r.design_id)) installs.set(r.design_id, kstDate(r.scheduled_at));
    }
  }
  // 리드타임 · 납기 (반년 창) — planned_at · completed_at 칸이 아직 없으면(3단계 SQL 전) null
  const leadFrom = windowStart(m, QUALITY_WINDOW_DAYS + 120);
  const [schedules, leadOrders] = await Promise.all([
    selectMany(env, 'design_schedules', {
      select: 'design_id,type,status,scheduled_at,planned_at,completed_at',
      type: 'in.(measurement,manufacturing_start,manufacturing_end,installation)',
      scheduled_at: `gte.${leadFrom}T00:00:00+09:00`,
      limit: '10000',
    }).catch(() => null),
    selectMany(env, 'orders', { select: 'design_id,ordered_at,status', ordered_at: `gte.${leadFrom}T00:00:00+09:00`, limit: '5000' }).catch(() => []),
  ]);
  // 원판 사용량 — 재단이 끝난(납품 · 완료) 수주의 견적 장수 대 재단 실측 장수
  const doneOrders = ((await selectMany(env, 'orders', {
    select: 'id,order_no,customer_name,snapshot_id,status,delivered_at,completed_at',
    status: 'in.(delivered,completed)',
    order: 'ordered_at.desc',
    limit: '1000',
  }).catch(() => [])) || []).filter((o) => {
    const d = o.completed_at || o.delivered_at;
    return d && kstDate(d) >= windowStart(m, QUALITY_WINDOW_DAYS + 31);
  });
  let cutLogs = [];
  if (doneOrders.length) {
    const ids = doneOrders.map((o) => o.id);
    const need = [...new Set(doneOrders.map((o) => o.snapshot_id).filter((id) => id && !snaps.some((s) => s.id === id)))];
    const [logs, more] = await Promise.all([
      selectMany(env, 'production_worklogs', { select: 'order_id,role,units', role: 'eq.cutter', order_id: `in.(${ids.join(',')})`, limit: '10000' }).catch(() => []),
      need.length ? selectMany(env, 'design_snapshots', { id: `in.(${need.join(',')})`, select: 'id,quote_payload', limit: '1000' }).catch(() => []) : [],
    ]);
    cutLogs = logs || [];
    snaps = snaps.concat(more || []);
  }
  // 계절 지수 · 예측 — 과거 월 매출(표가 없으면 null) + 시스템 수주 3년치
  const threeYears = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  const [history, sysOrders] = await Promise.all([
    selectMany(env, 'sales_history', { select: 'month,revenue,orders', order: 'month.asc', limit: '240' }).catch(() => null),
    selectMany(env, 'orders', { select: 'contract_amount,status,ordered_at', ordered_at: `gte.${threeYears}`, limit: '10000' }).catch(() => []),
  ]);
  return buildManagementSummary({
    orders: list,
    snapshotsById: new Map(snaps.map((s) => [s.id, s])),
    documents: documents || [],
    consultations,
    generations,
    designs: designs || [],
    costs: costs || [],
    worklogs: mergeLogs(worklogs || [], monthLogs),
    paceLogs,
    reworks,
    installed,
    feedback,
    counterparties,
    partnerOrders,
    supplierCosts: supplierCosts || [],
    outsource: outsource || [],
    balances,
    payments,
    dueCosts: dueCosts || [],
    cashOrders: cashOrders || [],
    installs,
    schedules,
    leadOrders: leadOrders || [],
    doneOrders,
    cutLogs,
    history,
    sysOrders: sysOrders || [],
    today: kstDate(),
    settings,
    month: m,
  });
}
