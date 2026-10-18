/**
 * 경영 대시보드 — DB 를 읽어 summary.js 에 넘긴다.
 *
 * **관리자만** 본다. 수주는 설계 주인 기준이 아니라 회사 전체다 (작업 지시 보고 보관함과
 * 같은 방식). 상담은 고객이 남긴 것이라 건수만 읽는다 — 이름 · 연락처는 싣지 않는다.
 */
import { selectMany, selectOne, ForbiddenError } from '../supabase.js';
import { isAdmin } from '../reports/admin.js';
import { mergeSettings, kstDate } from '../production/service.js';
import { buildManagementSummary, prevMonthOf, QUALITY_WINDOW_DAYS } from './summary.js';
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
    today: kstDate(),
    settings,
    month: m,
  });
}
