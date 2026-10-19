/**
 * 경영 대시보드 집계 — 1단계 (Claude 프로젝트 문서 "다담 경영 대시보드").
 *
 * 맨 위 이익 식과 재무 줄(손익분기 · 채널 공헌이익)을 낸다. 순수 함수만 둔다 —
 * DB 는 service.js 가 읽어 넘기고, 같은 입력이면 같은 숫자가 나온다.
 *
 * 숫자의 바탕은 월 생산 마감과 같다 (production/service.js summarizeMonth). 두 화면이
 * 같은 달을 다르게 말하면 안 되므로 그 함수를 그대로 부르고 그 위에 얹는다.
 *   매출      = 계약금 ÷ 1.1 (VAT 제외)
 *   변동원가  = 확인서 견적 원가 − 고정비 회수분 (회수분은 지출이 아니라 고정비를 덮는 매출 몫)
 *   공헌이익  = 매출 − 변동원가   (견적 원가가 있는 수주만)
 *   순이익    = 공헌이익 − 월 고정비
 */
import { summarizeMonth, kstDate } from '../production/service.js';
import { COST_LABELS, tierOf } from '../orders.js';
import { calibrate, EDGE_FACE_SINCE } from '../production/calibration.js';
import { REWORK_CAUSE_LABEL } from '../rework.js';
import { OKR_METRICS, quarterOf } from '../okrs.js';

const TIER_LABEL = Object.freeze({ customer: '직판', partner: '거래처' });

/** 'YYYY-MM' 의 전달 */
export function prevMonthOf(month) {
  const [y, m] = String(month).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const inMonth = (iso, month) => Boolean(iso) && kstDate(iso).slice(0, 7) === month;
/** 백분율 소수 한 자리. 분모가 0 이면 null — 화면이 '-' 를 그린다 */
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 견적이 잡은 공장 작업 초 (재단 + 엣지 + 조립). 견적 원가가 없으면 null */
export function factorySeconds(quote) {
  const s = quote && quote.cost && quote.cost.seconds;
  if (!s) return null;
  return num(s.cutter) + num(s.edge) + num(s.asm);
}

/** 한 달의 재무 숫자 — 월 생산 마감과 같은 바탕 */
export function financeOf(orders, snapshotsById, { month, overheadMonthly }) {
  const m = summarizeMonth(orders, snapshotsById, { month, overheadMonthly });
  const t = m.totals;
  const revenueKnown = m.rows.filter((r) => r.cost !== null).reduce((s, r) => s + r.revenue, 0);
  return {
    rows: m.rows,
    orders: t.orders,
    revenue: t.revenue,
    avgContract: t.orders > 0 ? Math.round(t.revenue / t.orders) : null,
    contribution: t.gross,
    cmRate: pct(t.gross, revenueKnown),
    // 손익분기는 반올림 전 비율로 — 표시용 한 자리 비율로 나누면 몇만 원이 틀어진다
    cmExact: revenueKnown > 0 ? t.gross / revenueKnown : null,
    overhead: t.overhead,
    net: t.net,
    unknownCost: t.unknownCost,
  };
}

/**
 * 손익분기. 월 고정비를 공헌이익률로 나눈 매출이 손익분기 매출이다.
 * `rate` 는 반올림 전 비율(0~1). 없거나 0 이하면(견적 원가가 있는 수주가 없는 달) 계산하지 않는다.
 */
export function breakEven({ overhead, revenue, rate }) {
  const cmRate = rate === null || rate === undefined ? null : Math.round(rate * 1000) / 10;
  if (!(rate > 0)) return { overhead, cmRate, revenueNeeded: null, progress: null, gap: null, safety: null };
  const need = Math.round(overhead / rate);
  return {
    overhead,
    cmRate,
    revenueNeeded: need,
    progress: pct(revenue, need),
    // 손익분기까지 더 받아야 할 매출 (VAT 제외)
    gap: Math.max(0, need - revenue),
    // 안전한계율 — 매출이 몇 % 줄어도 손해가 아닌가
    safety: revenue > need ? pct(revenue - need, revenue) : 0,
  };
}

/**
 * 직판 대 거래처. 공장 1시간당 공헌이익은 견적이 잡은 작업 초로 나눈다 —
 * 거래처 일은 마진이 얇은 대신 크다. 시간당으로 봐야 어느 쪽이 공장을 잘 쓰는지 보인다.
 */
export function channelsOf(rows, orders, snapshotsById) {
  const byId = new Map((orders || []).map((o) => [o.id, o]));
  const acc = new Map();
  for (const r of rows || []) {
    if (!acc.has(r.tier)) acc.set(r.tier, { orders: 0, revenue: 0, revenueKnown: 0, cost: 0, seconds: 0 });
    const a = acc.get(r.tier);
    a.orders += 1;
    a.revenue += r.revenue;
    if (r.cost === null) continue;
    a.revenueKnown += r.revenue;
    a.cost += r.cost;
    const o = byId.get(r.id);
    const q = o ? (snapshotsById.get(o.snapshot_id) || {}).quote_payload : null;
    a.seconds += factorySeconds(q) || 0;
  }
  return ['customer', 'partner'].filter((k) => acc.has(k)).map((k) => {
    const a = acc.get(k);
    const contribution = a.revenueKnown - a.cost;
    const hours = a.seconds / 3600;
    return {
      tier: k,
      label: TIER_LABEL[k],
      orders: a.orders,
      revenue: a.revenue,
      contribution,
      cmRate: pct(contribution, a.revenueKnown),
      factoryHours: Math.round(hours * 10) / 10,
      perHour: hours > 0 ? Math.round(contribution / hours) : null,
    };
  });
}

/**
 * 수주 앞단 — 상담 수와 확인서 전환율.
 *
 * 확인서는 **설계 하나를 한 건**으로 센다. 고쳐서 다시 낸 확인서(rev)를 따로 세면
 * 수정이 많은 집일수록 전환율이 낮아 보인다. 그 설계에 확인서가 **처음 나간 달**로
 * 묶고(코호트), 그 뒤 언제든 승인되면 승인으로 센다. 그래서 최근 달은 아직 '대기'가 남는다.
 */
export function leadsAndConversion({ documents, consultations }, month) {
  const f = funnelOf({ documents, consultations, orders: [] }, month);
  return { leads: f.leads, issued: f.issued, approved: f.approved, rejected: f.rejected, pending: f.pending, conversion: f.conversion };
}

/** 고객 확인서만, 설계별로 묶어 발행 순으로 */
function confirmationsByDesign(documents) {
  const byDesign = new Map();
  for (const d of documents || []) {
    if (d.doc_type && d.doc_type !== 'customer_confirmation') continue;
    if (!byDesign.has(d.design_id)) byDesign.set(d.design_id, []);
    byDesign.get(d.design_id).push(d);
  }
  for (const docs of byDesign.values()) docs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return byDesign;
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s.at(m) : (s.at(m - 1) + s.at(m)) / 2;
}
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3600000;

/** 확인서 수정 요청 사유 — documents.js DECISION_REASON_CODES 와 같은 축 (고객이 confirm.html 에서 고른다) */
export const REASON_LABEL = Object.freeze({ dimension: '치수', layout: '배치 · 구성', color: '색상 · 마감', price: '금액', schedule: '일정 · 납기', other: '기타' });

/**
 * 수정 요청(거절) 사유 분포. 코호트 설계의 **모든** 거절 확인서를 센다 — 고쳐 낸 뒤 또 거절되면
 * 그것도 한 번의 요청이다. 사유는 여러 개 고를 수 있어 합이 요청 수보다 클 수 있다.
 */
function reasonsOf(rejectedDocs) {
  const counts = new Map();
  let none = 0;
  for (const d of rejectedDocs) {
    const codes = Array.isArray(d.reasons) ? [...new Set(d.reasons.filter((c) => c in REASON_LABEL))] : [];
    if (!codes.length) none += 1;
    for (const c of codes) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const codes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || Object.keys(REASON_LABEL).indexOf(a[0]) - Object.keys(REASON_LABEL).indexOf(b[0]))
    .map(([code, count]) => ({ code, label: REASON_LABEL[code], count, share: pct(count, rejectedDocs.length) }));
  return { requests: rejectedDocs.length, noReason: none, codes };
}
const oneDecimal = (v) => (v === null ? null : Math.round(v * 10) / 10);

/**
 * 영업 퍼널 — 확인서 코호트: 발행 → 열람 → 승인 → 수주.
 *
 * 코호트는 leadsAndConversion 과 같다(설계 하나 = 한 건, 처음 나간 달). 상담은 확인서와
 * 같은 사람으로 이어지지 않으므로(상담은 고객이, 설계는 공장이 만든다) 같은 막대에
 * 잇지 않고 그 달 신청 건수로 따로 둔다.
 *
 * 수주는 취소되지 않은 수주가 그 설계에 있으면 센다. 확인서 승인에서만 수주가
 * 만들어지므로(orders.document_id) 수주 ⊆ 승인이다.
 */
export function funnelOf({ documents, consultations, orders }, month) {
  const leads = Array.isArray(consultations) ? consultations.filter((c) => inMonth(c.created_at, month)).length : null;
  const ordered = new Set((orders || []).filter((o) => o.status !== 'cancelled').map((o) => o.design_id));
  let issued = 0, viewed = 0, approved = 0, orderedN = 0, rejected = 0, pending = 0;
  const revs = [], toView = [], toDecide = [], rejectedDocs = [];
  for (const [designId, docs] of confirmationsByDesign(documents)) {
    const first = docs.at(0);
    if (!inMonth(first.created_at, month)) continue;
    issued += 1;
    revs.push(docs.length);
    for (const d of docs) if (d.decision === 'rejected') rejectedDocs.push(d);
    const views = docs.map((d) => d.first_viewed_at).filter(Boolean).sort();
    if (views.length) { viewed += 1; toView.push(hoursBetween(first.created_at, views.at(0))); }
    const ok = docs.find((d) => d.decision === 'approved');
    if (ok) {
      approved += 1;
      if (ok.decided_at) toDecide.push(hoursBetween(first.created_at, ok.decided_at) / 24);
      if (ordered.has(designId)) orderedN += 1;
      continue;
    }
    const last = docs.at(-1);
    if (last.decision === 'rejected' || last.status === 'rejected') {
      rejected += 1;
      if (last.decided_at) toDecide.push(hoursBetween(first.created_at, last.decided_at) / 24);
    } else if (last.status !== 'revoked') pending += 1;
  }
  return {
    leads,
    issued,
    viewed,
    approved,
    ordered: orderedN,
    rejected,
    pending,
    conversion: pct(approved, issued),
    viewRate: pct(viewed, issued),
    orderRate: pct(orderedN, approved),
    // 설계 한 건에 확인서를 평균 몇 번 냈나 (1 = 고치지 않고 한 번에)
    avgRevisions: revs.length ? oneDecimal(revs.reduce((s, v) => s + v, 0) / revs.length) : null,
    medianHoursToView: oneDecimal(median(toView)),
    medianDaysToDecide: oneDecimal(median(toDecide)),
    reasons: reasonsOf(rejectedDocs),
  };
}

/**
 * AI 플랫폼 → 수주. 두 갈래로 잇는다 — 이을 수 있는 만큼만.
 *
 *   연출컷 기준  연출컷 → 설계 → 확인서 → 수주   (designs.generation_id 로 정확히 이어진다)
 *   사람 기준    연출컷 만든 사람 → 그중 상담 신청한 사람   (user_id)
 *
 * 설계는 공장이 만들고 연출컷은 고객이 만드니 사람(user_id)으로는 수주까지 못 잇는다.
 * 그 대신 연출컷에서 시작한 설계에는 generation_id 가 붙는다 (persistence-init.js).
 * 그 달 만들어진 연출컷이 코호트다 — 그래서 최근 달은 숫자가 아직 자란다.
 * 연출컷을 못 읽었으면 null.
 */
export function platformOf({ generations, designs, documents, orders, consultations }, month) {
  if (!Array.isArray(generations)) return null;
  const gens = generations.filter((g) => inMonth(g.created_at, month));
  const done = gens.filter((g) => g.status === 'done');
  const failed = gens.filter((g) => g.status === 'failed').length;
  const people = new Set(done.map((g) => g.user_id).filter(Boolean));
  const consulted = Array.isArray(consultations)
    ? new Set(consultations.filter((c) => c.user_id && people.has(c.user_id)).map((c) => c.user_id))
    : null;
  const genIds = new Set(done.map((g) => g.id));
  const designIds = new Set((designs || []).filter((d) => d.generation_id && genIds.has(d.generation_id)).map((d) => d.id));
  const confirmed = new Set((documents || [])
    .filter((d) => (!d.doc_type || d.doc_type === 'customer_confirmation') && designIds.has(d.design_id))
    .map((d) => d.design_id));
  const ordered = new Set((orders || []).filter((o) => o.status !== 'cancelled' && designIds.has(o.design_id)).map((o) => o.design_id));
  return {
    generations: done.length,
    failed,
    failRate: pct(failed, gens.length),
    people: people.size,
    consultedPeople: consulted ? consulted.size : null,
    designs: designIds.size,
    confirmed: confirmed.size,
    ordered: ordered.size,
  };
}

// ── 공정 줄 (PR-3) ─────────────────────────────────────────────

/**
 * 견적의 상판 · 설비 · 철거를 실적 범주에 맞춘다 (2026-10-19 대표 확정):
 * 상판 · 철거 = 외주, 싱크볼 · 수전 · 후드 = 자재.
 */
const EXTRA_CATEGORY = Object.freeze({ countertop: 'outsourcing', demolition: 'outsourcing', sinkBowl: 'material', faucet: 'material', hood: 'material' });
/** 돈으로 비교하는 범주. 노무는 뺀다 — 재단 기사는 월급이라 수주마다 돈으로 적히지 않는다. 시간으로 본다 */
const MONEY_CATEGORIES = Object.freeze(['material', 'hardware', 'outsourcing', 'logistics', 'other']);
const ROLES = Object.freeze(['cutter', 'edge', 'asm']);
const ROLE_LABEL = Object.freeze({ cutter: '재단', edge: '엣지', asm: '조립' });

const orderLabel = (o) => (o.customer_name ? `${o.customer_name} (${o.order_no})` : o.order_no);
const liveIn = (orders, month) => (orders || []).filter((o) => o.status !== 'cancelled' && inMonth(o.ordered_at, month));
const quoteOf = (o, snapshotsById) => (snapshotsById.get(o.snapshot_id) || {}).quote_payload || null;

/** 견적 원가를 실적 범주로 (노무 · 간접비 배분 · 고정비 회수분은 빼고). 견적 원가가 없으면 null */
export function estimateByCategory(quote) {
  const c = quote && quote.cost;
  if (!c) return null;
  const v = (o, k) => num(o && o[k]);
  const out = {
    material: v(c.body, 'material') + v(c.body, 'edge') + v(c.back, 'material'),
    hardware: v(c.body, 'hardware'),
    outsourcing: v(c.door, 'outsourcing') + v(c.install, 'outsourcing'),
    logistics: 0,
    other: 0,
  };
  for (const [k, amt] of Object.entries(c.extras || {})) out[EXTRA_CATEGORY[k] || 'other'] += num(amt);
  return out;
}

/**
 * 견적 대비 실적 — 돈. 이달 수주 중 실적 원가를 넣은 것만, **넣은 범주만** 비교한다.
 * 자재만 적은 수주를 견적 전체와 견주면 늘 크게 남는 것처럼 보이기 때문이다.
 */
export function costVariance(orders, snapshotsById, costs, month) {
  const live = liveIn(orders, month);
  const actualByOrder = new Map();
  for (const c of costs || []) {
    if (!MONEY_CATEGORIES.includes(c.category)) continue;
    if (!actualByOrder.has(c.order_id)) actualByOrder.set(c.order_id, {});
    const a = actualByOrder.get(c.order_id);
    a[c.category] = (a[c.category] || 0) + num(c.amount);
  }
  const cats = new Map();
  const rows = [];
  for (const o of live) {
    const est = estimateByCategory(quoteOf(o, snapshotsById));
    const act = actualByOrder.get(o.id);
    if (!est || !act) continue;
    let e = 0, a = 0, worst = null;
    for (const [cat, amount] of Object.entries(act)) {
      const ee = est[cat] || 0;
      if (!cats.has(cat)) cats.set(cat, { orders: 0, estimate: 0, actual: 0 });
      const k = cats.get(cat);
      k.orders += 1; k.estimate += ee; k.actual += amount;
      e += ee; a += amount;
      const d = amount - ee;
      if (!worst || Math.abs(d) > Math.abs(worst.diff)) worst = { category: cat, label: COST_LABELS[cat] || cat, diff: Math.round(d) };
    }
    rows.push({ id: o.id, label: orderLabel(o), estimate: Math.round(e), actual: Math.round(a), diff: Math.round(a - e), diffRate: pct(a - e, e), worst });
  }
  rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  const categories = MONEY_CATEGORIES.filter((c) => cats.has(c)).map((c) => {
    const k = cats.get(c);
    return { category: c, label: COST_LABELS[c], orders: k.orders, estimate: Math.round(k.estimate), actual: Math.round(k.actual), diff: Math.round(k.actual - k.estimate), diffRate: pct(k.actual - k.estimate, k.estimate) };
  });
  const te = categories.reduce((s, c) => s + c.estimate, 0);
  const ta = categories.reduce((s, c) => s + c.actual, 0);
  return {
    orders: live.length,
    recorded: rows.length,
    categories,
    totals: { estimate: te, actual: ta, diff: ta - te, diffRate: pct(ta - te, te) },
    top: rows.slice(0, 5),
  };
}

/**
 * 견적 대비 실적 — 시간. 이달 수주 중 실측(작업자 기록)이 붙은 것의 역할별 예상 분과 실측 분.
 * 실측이 있는 역할만 비교한다 (재단만 적은 수주의 조립 시간을 0 으로 치지 않는다).
 */
export function timeVariance(orders, snapshotsById, worklogs, month) {
  const live = new Map(liveIn(orders, month).map((o) => [o.id, o]));
  const actual = new Map(); // `${order}|${role}` → 분
  for (const w of worklogs || []) {
    if (!live.has(w.order_id) || !ROLES.includes(w.role)) continue;
    const k = `${w.order_id}|${w.role}`;
    actual.set(k, (actual.get(k) || 0) + num(w.minutes));
  }
  return ROLES.map((role) => {
    let orders = 0, est = 0, act = 0;
    for (const o of live.values()) {
      const m = actual.get(`${o.id}|${role}`);
      const q = quoteOf(o, snapshotsById);
      const sec = q && q.cost && q.cost.seconds ? num(q.cost.seconds[role]) : null;
      if (m === undefined || sec === null) continue;
      orders += 1; est += sec / 60; act += m;
    }
    return { role, label: ROLE_LABEL[role], orders, estimateMin: Math.round(est), actualMin: Math.round(act), diffRate: pct(act - est, est) };
  });
}

/** 그 달의 근무일 — 주말과 생산 설정의 휴일을 뺀다 */
export function workdaysInMonth(month, holidays = []) {
  const [y, m] = String(month).split('-').map(Number);
  const off = new Set((holidays || []).map((h) => String(h).slice(0, 10)));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const t = Date.UTC(y, m - 1, d);
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6 && !off.has(new Date(t).toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

/** 실측으로 처리능력을 바꾸는 문턱 — 그 공정을 기록한 날이 한 달 근무일만큼 쌓여야 한다 */
export const PACE_MIN_DAYS = 20;

/**
 * 공정별 실측 속도 = 실측 1단위 초 ÷ 생산 설정 표준 초 (표준시간 보정과 같은 계산 — calibrate).
 * 1.2 면 표준보다 20% 느리다. 기록한 날이 PACE_MIN_DAYS 이상이고 보정 표본이 넉넉할 때만 값을 낸다
 * (2026-10-19 대표: "실측이 쌓이면 실측으로"). 엣지는 단위가 면으로 바뀐 날 이후 기록만 센다.
 */
export function paceOf(logs, standards) {
  const out = {};
  for (const c of calibrate(logs, standards || {})) {
    const days = new Set();
    for (const l of logs || []) {
      if (!l || l.role !== c.role || !(Number(l.units) > 0) || !(Number(l.minutes) > 0) || !l.work_date) continue;
      const d = String(l.work_date).slice(0, 10);
      if (c.role === 'edge' && d < EDGE_FACE_SINCE) continue;
      days.add(d);
    }
    const ratio = c.enough && c.measured > 0 && c.current > 0 && days.size >= PACE_MIN_DAYS ? c.measured / c.current : null;
    out[c.role] = { days: days.size, ratio };
  }
  return out;
}

/**
 * 공정별 부하 — 이달 **받은 일**(이달 수주의 견적 작업 시간)과 **실제로 한 일**(이달 실측)을
 * 한 달 능력에 대 본다. 능력 = 근무일 × 하루 시간 × 가동률 × 인원(재단 기사 · 엣지 기계 · 조립 기본 인원).
 * 실측 속도(paceOf)가 있는 공정은 능력을 그 속도로 나눈다 — 표준보다 20% 느린 공장은 견적 시간으로
 * 잰 일을 그만큼 덜 받는다. 받은 일 비율이 가장 높은 공정이 병목이다 — 공장 전체 속도는 거기서 정해진다.
 */
export function loadOf(orders, snapshotsById, worklogs, settings, month, pace = {}) {
  const crew = (settings && settings.crew) || {};
  const days = workdaysInMonth(month, settings && settings.holidays);
  const perPerson = days * num(crew.hoursPerDay) * num(crew.util) * 3600;
  const people = { cutter: num(crew.cutters), edge: num(crew.edgeMachines), asm: num(crew.assemblers) };
  const est = { cutter: 0, edge: 0, asm: 0 };
  for (const o of liveIn(orders, month)) {
    const q = quoteOf(o, snapshotsById);
    const s = q && q.cost && q.cost.seconds;
    if (!s) continue;
    for (const r of ROLES) est[r] += num(s[r]);
  }
  const done = { cutter: 0, edge: 0, asm: 0 };
  for (const w of worklogs || []) {
    if (!ROLES.includes(w.role) || !w.work_date || String(w.work_date).slice(0, 7) !== month) continue;
    done[w.role] += num(w.minutes) * 60;
  }
  const roles = ROLES.map((r) => {
    const cap = perPerson * people[r];
    const p = (pace && pace[r]) || { days: 0, ratio: null };
    // 받은 일은 견적 시간이라 능력도 견적 시간으로 잰다. 한 일은 실제 분이라 날 능력에 댄다
    const capEst = p.ratio > 0 ? cap / p.ratio : cap;
    return {
      role: r,
      label: ROLE_LABEL[r],
      people: people[r],
      capacityHours: Math.round((capEst / 3600) * 10) / 10,
      receivedHours: Math.round((est[r] / 3600) * 10) / 10,
      doneHours: Math.round((done[r] / 3600) * 10) / 10,
      load: pct(est[r], capEst),
      doneLoad: pct(done[r], cap),
      basis: p.ratio > 0 ? 'measured' : 'settings',
      pace: p.ratio > 0 ? Math.round(p.ratio * 100) / 100 : null,
      paceDays: p.days,
    };
  });
  const ranked = roles.filter((r) => r.load !== null).sort((a, b) => b.load - a.load);
  return { workdays: days, roles, bottleneck: ranked.length && ranked.at(0).load > 0 ? ranked.at(0).role : null, paceMinDays: PACE_MIN_DAYS };
}

/**
 * 처리량 회계 — 병목 공정 1분당 남는 돈. 처리량 = 매출 − 완전 변동비(자재 · 철물 · 외주).
 * 노무는 처리량에서 빼지 않는다(사람은 일이 없어도 나온다 — 제약이론의 정의).
 * 병목이 꽉 찬 달에는 이 순서대로 받는 것이 이익을 가장 크게 한다.
 */
export function throughputOf(orders, snapshotsById, month, role) {
  if (!ROLES.includes(role)) return { role: null, label: null, rows: [], avgPerMin: null };
  let sumT = 0, sumM = 0;
  const rows = [];
  for (const o of liveIn(orders, month)) {
    const q = quoteOf(o, snapshotsById);
    const est = estimateByCategory(q);
    const sec = q && q.cost && q.cost.seconds ? num(q.cost.seconds[role]) : 0;
    if (!est || !(sec > 0)) continue;
    const revenue = Math.round(num(o.contract_amount) / 1.1);
    const tvc = MONEY_CATEGORIES.reduce((s, c) => s + num(est[c]), 0);
    const t = revenue - tvc;
    const min = sec / 60;
    sumT += t; sumM += min;
    rows.push({ id: o.id, label: orderLabel(o), throughput: Math.round(t), minutes: Math.round(min), perMin: Math.round(t / min) });
  }
  rows.sort((a, b) => b.perMin - a.perMin);
  return { role, label: ROLE_LABEL[role], rows: rows.slice(0, 5), avgPerMin: sumM > 0 ? Math.round(sumT / sumM) : null };
}

// ── 만약에 판 (PR-4) ───────────────────────────────────────────

/**
 * 만약에 판의 바탕 — 이달 수주(견적 원가가 있는 것)의 변동원가를 갈래별로 더한 값.
 *
 * 갈래의 합은 **정확히** 월 손익의 변동원가(견적 원가 − 고정비 회수분)와 같다 —
 * 그래야 판을 그대로 둔 값이 맨 위 이익 식과 한 원도 다르지 않다.
 *   자재 = 몸통 자재 + 엣지 + 뒷판 자재 + 설비(싱크볼 · 수전 · 후드)
 *   철물 = 몸통 철물 · 도어 = 도어 외주 · 그 밖 외주 = 시공 + 상판 · 철거 + 그 밖 추가
 *   노무 = 재단 · 엣지 · 조립 노무 · 간접비 배분 = 공장 시간에 배분한 간접비(기본 0)
 * 레버가 모두 선형이라 주문마다 들고 다닐 필요 없이 합만 내린다. 계산은 화면이 한다.
 */
export function scenarioBase(orders, snapshotsById, settings, month) {
  const b = { orders: 0, revenueCustomer: 0, revenuePartner: 0, revenueUnknown: 0, material: 0, hardware: 0, door: 0, doorSheets: 0, outsourcing: 0, labor: 0, overheadAlloc: 0 };
  for (const o of liveIn(orders, month)) {
    b.orders += 1;
    const revenue = Math.round(num(o.contract_amount) / 1.1);
    const q = quoteOf(o, snapshotsById);
    const c = q && q.cost;
    if (!c || !Number.isFinite(Number(c.total))) { b.revenueUnknown += revenue; continue; }
    if (tierOf(o, q) === 'partner') b.revenuePartner += revenue; else b.revenueCustomer += revenue;
    const v = (x, k) => num(x && x[k]);
    b.material += v(c.body, 'material') + v(c.body, 'edge') + v(c.back, 'material');
    b.hardware += v(c.body, 'hardware');
    b.door += v(c.door, 'outsourcing');
    b.doorSheets += v(c.quantities, 'doorSheets');
    b.outsourcing += v(c.install, 'outsourcing');
    b.labor += v(c.body, 'labor') + v(c.back, 'labor') + v(c.door, 'labor');
    b.overheadAlloc += v(c.body, 'overhead') + v(c.back, 'overhead') + v(c.door, 'overhead');
    for (const [k, amt] of Object.entries(c.extras || {})) {
      if ((EXTRA_CATEGORY[k] || 'other') === 'material') b.material += num(amt);
      else b.outsourcing += num(amt);
    }
  }
  for (const k of Object.keys(b)) if (k !== 'doorSheets') b[k] = Math.round(b[k]);
  const q = (settings && settings.quote) || {};
  const crew = (settings && settings.crew) || {};
  const costs = (settings && settings.costs) || {};
  return {
    ...b,
    doorSheets: Math.round(b.doorSheets * 10) / 10,
    overheadMonthly: num(q.overheadMonthly),
    marginRate: num(q.marginRate),
    partnerMarginRate: num(q.partnerMarginRate),
    // '알바 한 명 더' 단추의 값 — 시급 × 하루 시간 × 월 근무일 (생산 설정)
    partTimeMonthly: Math.round(num(costs.partTimeHourly) * num(crew.hoursPerDay) * num(q.workDays)),
  };
}

/** 공정 줄 한 벌 — 처리량은 병목 공정의 분으로 나눈다 (병목이 없으면 재단) */
export function processOf({ orders, snapshotsById, costs, worklogs, paceLogs = [], settings }, month) {
  const load = loadOf(orders, snapshotsById, worklogs, settings, month, paceOf(paceLogs, settings && settings.standards));
  return {
    variance: costVariance(orders, snapshotsById, costs, month),
    time: timeVariance(orders, snapshotsById, worklogs, month),
    load,
    throughput: throughputOf(orders, snapshotsById, month, load.bottleneck || 'cutter'),
  };
}

// ── 품질 (2단계 PR-6) ─────────────────────────────────────────

/** A/S 율을 보는 창 — 설치한 지 반년 안의 집 */
export const QUALITY_WINDOW_DAYS = 180;

/**
 * 재작업 · A/S — 14 품질비용 · A/S 율.
 *   이달   재작업 · A/S 건수, 품질비용 = 적은 비용(부재 · 외주) + 다시 한 분 × 공장 분당 노무
 *          공장 노무는 조립 일당 ÷ 하루 시간 (기본 200,000 ÷ 8 = 시간당 25,000)
 *   반년   그 기간에 설치(납품 · 완료)한 수주 중 A/S 를 한 번이라도 간 비율
 * 기록 표가 아직 없으면(2단계 SQL 전) null.
 */
export function qualityOf({ reworks, installed, settings }, month, today = null) {
  if (!Array.isArray(reworks)) return null;
  const costs = (settings && settings.costs) || {};
  const crew = (settings && settings.crew) || {};
  const hourly = num(crew.hoursPerDay) > 0 ? num(costs.assemblerDay) / num(crew.hoursPerDay) : 0;
  const inM = reworks.filter((r) => String(r.occurred_on || '').slice(0, 7) === month);
  const causes = new Map();
  let minutes = 0, cost = 0;
  for (const r of inM) {
    const won = num(r.cost) + (num(r.minutes) * hourly) / 60;
    minutes += num(r.minutes); cost += num(r.cost);
    if (!causes.has(r.cause)) causes.set(r.cause, { count: 0, won: 0 });
    const c = causes.get(r.cause); c.count += 1; c.won += won;
  }
  const laborWon = Math.round((minutes * hourly) / 60);
  // 반년 창 — 그 달 끝(이번 달이면 오늘)에서 거꾸로
  const end = today && today.slice(0, 7) === month ? today : monthEndOf(month);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (QUALITY_WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const doneOn = (o) => { const t = o.completed_at || o.delivered_at; return t ? kstDate(t) : null; };
  const inWindow = (installed || []).filter((o) => { const d = doneOn(o); return d && d >= start && d <= end; });
  const asOrders = new Set(reworks.filter((r) => r.kind === 'as').map((r) => r.order_id));
  const withAs = inWindow.filter((o) => asOrders.has(o.id)).length;
  return {
    month: {
      rework: inM.filter((r) => r.kind === 'rework').length,
      as: inM.filter((r) => r.kind === 'as').length,
      minutes,
      cost,
      laborWon,
      total: cost + laborWon,
      causes: [...causes.entries()]
        .map(([cause, c]) => ({ cause, label: REWORK_CAUSE_LABEL[cause] || cause, count: c.count, won: Math.round(c.won) }))
        .sort((a, b) => b.won - a.won || b.count - a.count),
    },
    window: { days: QUALITY_WINDOW_DAYS, start, end, installed: inWindow.length, withAs, asRate: pct(withAs, inWindow.length) },
    hourly: Math.round(hourly),
  };
}

// ── 소개 의향 (2단계 PR-7) ───────────────────────────────────

/**
 * 설치 후 한 문항 — 12 만족도 · 소개율. 반년 창(QUALITY_WINDOW_DAYS)으로 본다 — 한 달 응답은 몇 건뿐이다.
 *   응답률   창 안에서 만든 링크 중 답이 온 것
 *   NPS      답한 사람 중 9~10(소개함) % − 0~6(안 함) %. 7~8 은 중립
 * 표가 아직 없으면 null.
 */
export function referralOf(feedback, month, today = null) {
  if (!Array.isArray(feedback)) return null;
  const end = today && today.slice(0, 7) === month ? today : monthEndOf(month);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (QUALITY_WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const within = (t) => { if (!t) return false; const d = kstDate(t); return d >= start && d <= end; };
  const sent = feedback.filter((f) => within(f.created_at));
  const answeredOfSent = sent.filter((f) => f.answered_at).length;
  const answers = feedback.filter((f) => within(f.answered_at) && Number.isInteger(Number(f.score)));
  const scores = answers.map((f) => Number(f.score));
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const dist = Array.from({ length: 11 }, (_, s) => scores.filter((x) => x === s).length);
  return {
    window: { days: QUALITY_WINDOW_DAYS, start, end },
    sent: sent.length,
    answered: answers.length,
    responseRate: pct(answeredOfSent, sent.length),
    promoters,
    passives: answers.length - promoters - detractors,
    detractors,
    nps: answers.length ? Math.round(((promoters - detractors) / answers.length) * 100) : null,
    avg: answers.length ? Math.round((scores.reduce((a, b) => a + b, 0) / answers.length) * 10) / 10 : null,
    thisMonth: feedback.filter((f) => f.answered_at && kstDate(f.answered_at).slice(0, 7) === month).length,
    dist,
  };
}

// ── 거래처 · 공급처 (2단계 PR-8) ─────────────────────────────

/** 거래처 · 공급처는 한 해로 본다 — 업체별 수주는 달마다 몇 건뿐이다 */
export const PARTNER_WINDOW_DAYS = 365;

function windowOf(month, today, days) {
  const end = today && today.slice(0, 7) === month ? today : monthEndOf(month);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { days, start, end };
}

/**
 * 11 거래처 파레토 — 한 해 동안 업체별 수주 · 매출 · 공헌이익, 큰 순으로 누적 비중.
 * "상위 20% 거래처가 매출의 몇 % 를 주나". 거래처로 판정됐는데 업체를 안 붙인 수주는 따로 센다.
 * 칸이 아직 없으면(2단계 SQL 전) null.
 */
export function partnersOf({ partnerOrders, snapshotsById, counterparties }, month, today = null) {
  if (!Array.isArray(partnerOrders) || !Array.isArray(counterparties)) return null;
  const win = windowOf(month, today, PARTNER_WINDOW_DAYS);
  const names = new Map(counterparties.map((c) => [c.id, c.name]));
  const acc = new Map();
  let unassigned = 0;
  for (const o of partnerOrders) {
    if (o.status === 'cancelled' || !o.ordered_at) continue;
    const d = kstDate(o.ordered_at);
    if (d < win.start || d > win.end) continue;
    if (!o.partner_id) { if (o.price_tier === 'partner') unassigned += 1; continue; }
    if (!acc.has(o.partner_id)) acc.set(o.partner_id, { orders: 0, revenue: 0, known: 0, cost: 0 });
    const a = acc.get(o.partner_id);
    const revenue = Math.round(num(o.contract_amount) / 1.1);
    a.orders += 1; a.revenue += revenue;
    const q = quoteOf(o, snapshotsById);
    if (q && q.cost && Number.isFinite(Number(q.cost.total))) {
      a.known += revenue;
      a.cost += num(q.cost.total) - num(q.cost.fixed_recovery);
    }
  }
  const total = [...acc.values()].reduce((s, a) => s + a.revenue, 0);
  let cum = 0;
  const rows = [...acc.entries()].sort((x, y) => y[1].revenue - x[1].revenue).map(([id, a]) => {
    cum += a.revenue;
    const contribution = Math.round(a.known - a.cost);
    return {
      id,
      name: names.get(id) || '(지운 거래처)',
      orders: a.orders,
      revenue: a.revenue,
      contribution: a.known > 0 ? contribution : null,
      cmRate: a.known > 0 ? pct(contribution, a.known) : null,
      share: pct(a.revenue, total),
      cumShare: pct(cum, total),
    };
  });
  const topN = Math.ceil(rows.length * 0.2);
  const topRevenue = rows.slice(0, topN).reduce((s, r) => s + r.revenue, 0);
  return {
    window: win,
    partners: rows.length,
    revenue: total,
    rows: rows.slice(0, 10),
    top20: rows.length ? { count: topN, share: pct(topRevenue, total) } : null,
    unassigned,
  };
}

/**
 * 16 외주 성적표 — 한 해 동안 공급처별 지출(원가 줄) · 발주 · 약속일 지킴.
 *   지출     원가에 공급처를 붙인 줄의 합 (낸 날, 없으면 적은 날 기준)
 *   약속일   외주 · 상판 발주(작업 지시 보고)의 입고 예정일(period_end) 대 입고한 날(metrics.received_on)
 *            입고한 날이 없는 예전 입고는 약속 계산에서 뺀다 — 지금부터 쌓인다
 *   밀림     아직 입고 전인데 예정일이 지난 발주
 * 발주는 업체 이름으로 묶고, 장부의 공급처와 이름이 같으면 한 줄로 합친다.
 */
export function suppliersOf({ supplierCosts, outsource, counterparties }, month, today = null) {
  if (!Array.isArray(counterparties)) return null;
  const win = windowOf(month, today, PARTNER_WINDOW_DAYS);
  const todayD = today || win.end;
  const inWin = (d) => d && d >= win.start && d <= win.end;
  const byId = new Map(counterparties.map((c) => [c.id, c]));
  const acc = new Map(); // 이름(소문자) → 줄
  const row = (name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (!acc.has(key)) {
      const cp = counterparties.find((c) => c.kind === 'supplier' && c.name.trim().toLowerCase() === key);
      acc.set(key, { id: cp ? cp.id : null, name: cp ? cp.name : String(name).trim(), category: cp ? cp.category : null, spend: 0, costRows: 0, orders: 0, onTime: 0, late: 0, lateDays: 0, dated: 0, overdue: 0 });
    }
    return acc.get(key);
  };
  for (const c of supplierCosts || []) {
    const cp = byId.get(c.counterparty_id);
    const d = String(c.spent_on || c.created_at || '').slice(0, 10);
    if (!cp || !inWin(d)) continue;
    const r = row(cp.name);
    r.spend += num(c.amount); r.costRows += 1;
  }
  for (const o of outsource || []) {
    if (o.status === 'cancelled' || !inWin(String(o.period_start || '').slice(0, 10))) continue;
    const r = row(o.metrics && o.metrics.vendor);
    if (!r) continue;
    r.orders += 1;
    const due = String(o.period_end || '').slice(0, 10);
    const got = o.metrics && o.metrics.received_on;
    if (o.status === 'received' && got && due) {
      r.dated += 1;
      if (got <= due) r.onTime += 1;
      else { r.late += 1; r.lateDays += (Date.parse(got) - Date.parse(due)) / 86400000; }
    } else if (o.status === 'ordered' && due && due < todayD) r.overdue += 1;
  }
  const rows = [...acc.values()]
    .map((r) => ({
      id: r.id, name: r.name, category: r.category,
      spend: Math.round(r.spend), costRows: r.costRows,
      orders: r.orders, onTimeRate: pct(r.onTime, r.dated), dated: r.dated,
      avgLateDays: r.late ? Math.round((r.lateDays / r.late) * 10) / 10 : null,
      overdue: r.overdue,
    }))
    .sort((a, b) => b.spend - a.spend || b.orders - a.orders);
  return { window: win, rows: rows.slice(0, 12), suppliers: counterparties.filter((c) => c.kind === 'supplier' && c.active !== false).length };
}

// ── 현금 (2단계 PR-9) ────────────────────────────────────────

export const CASH_WEEKS = 13;
const DAY_MS = 86400000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
/** 그 날이 든 주의 월요일 */
function mondayOf(d) {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 일 ~ 6 토
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
const ACTIVE_FOR_CASH = new Set(['confirmed', 'in_production', 'delivered', 'completed']);
const outstandingOf = (o) => Math.max(0, num(o.contract_amount) - num(o.received_amount));

/**
 * 9 13주 현금흐름 — 오늘이 든 주부터 13주, 주마다 들어올 돈 · 나갈 돈 · 주말 잔액.
 *   시작   관리자가 적은 가장 최근 통장 잔액 (7일이 넘으면 다시 적으라고 알린다)
 *   들어옴 아직 안 받은 수금 일정 — 받기로 한 날의 주. 지난 날짜는 이번 주(밀린 돈)
 *          일정이 없는 수주는 남은 돈(계약금 − 수금액)이 설치일에 들어온다고 본다. 설치일도 없으면 '날짜 모름'
 *   나감   아직 안 낸 원가 줄(낸 날 없음 · 낼 날 있음)의 그 주 + 월 고정비를 주마다 고르게 (× 12 ÷ 52)
 * 이달 선택과 상관없이 오늘부터 앞으로 본다. 수금 표가 아직 없으면 null.
 */
export function cashflowOf({ balances, payments, costs, orders, installs, overheadMonthly }, today) {
  if (!Array.isArray(balances) || !Array.isArray(payments)) return null;
  const start = mondayOf(today);
  const end = addDays(start, CASH_WEEKS * 7 - 1);
  const weeks = Array.from({ length: CASH_WEEKS }, (_, i) => ({ start: addDays(start, i * 7), end: addDays(start, i * 7 + 6), inflow: 0, outflow: 0 }));
  const weekOf = (d) => Math.floor(daysBetween(start, d) / 7);
  let overdueIn = 0, overdueOut = 0, laterIn = 0, laterOut = 0, unscheduledIn = 0, unscheduledOrders = 0;
  const put = (d, amount, dir) => {
    if (d < today) {
      weeks[0][dir] += amount;
      if (dir === 'inflow') overdueIn += amount; else overdueOut += amount;
    } else if (d > end) {
      if (dir === 'inflow') laterIn += amount; else laterOut += amount;
    } else weeks[weekOf(d)][dir] += amount;
  };
  const live = new Map((orders || []).filter((o) => ACTIVE_FOR_CASH.has(o.status)).map((o) => [o.id, o]));
  const scheduled = new Set();
  for (const p of payments) {
    scheduled.add(p.order_id);
    if (p.paid_on || !live.has(p.order_id)) continue;
    if (p.due_on) put(String(p.due_on).slice(0, 10), num(p.amount), 'inflow');
    else { unscheduledIn += num(p.amount); unscheduledOrders += 1; }
  }
  for (const o of live.values()) {
    if (scheduled.has(o.id)) continue;
    const left = outstandingOf(o);
    if (!(left > 0)) continue;
    const inst = installs && installs.get(o.design_id);
    const done = o.completed_at || o.delivered_at;
    // 이미 설치(납품 · 완료)했으면 받을 날이 지난 돈, 아니면 설치일에
    const d = done ? kstDate(done) : inst || null;
    if (d) put(d, left, 'inflow');
    else { unscheduledIn += left; unscheduledOrders += 1; }
  }
  for (const c of costs || []) {
    if (c.spent_on || !c.due_on) continue;
    put(String(c.due_on).slice(0, 10), num(c.amount), 'outflow');
  }
  const weeklyOverhead = Math.round((num(overheadMonthly) * 12) / 52);
  const latest = balances.slice().sort((a, b) => String(b.as_of).localeCompare(String(a.as_of)) || String(b.created_at || '').localeCompare(String(a.created_at || ''))).at(0) || null;
  let bal = latest ? num(latest.amount) : 0;
  let lowest = null, firstNegative = null;
  const out = weeks.map((w, i) => {
    const outflow = Math.round(w.outflow + weeklyOverhead);
    const inflow = Math.round(w.inflow);
    bal += inflow - outflow;
    if (!lowest || bal < lowest.balance) lowest = { week: i, start: w.start, balance: bal };
    if (firstNegative === null && bal < 0) firstNegative = i;
    return { start: w.start, end: w.end, inflow, outflow, net: inflow - outflow, balance: bal };
  });
  return {
    start, end, today,
    opening: latest ? { amount: num(latest.amount), as_of: latest.as_of, days: daysBetween(latest.as_of, today), stale: daysBetween(latest.as_of, today) > 7 } : null,
    weeks: out,
    weeklyOverhead,
    overdueIn: Math.round(overdueIn), overdueOut: Math.round(overdueOut),
    laterIn: Math.round(laterIn), laterOut: Math.round(laterOut),
    unscheduledIn: Math.round(unscheduledIn), unscheduledOrders,
    lowest, firstNegative,
  };
}

/**
 * 미수 나이 — 받을 날이 지났는데 아직 못 받은 돈을 밀린 날수로 묶는다 (0~30 · 31~60 · 61~90 · 90일 넘음).
 *   일정이 있으면 받기로 한 날부터, 없으면 설치(납품 · 완료)한 날부터 센다.
 *   아직 받을 날이 안 된 돈은 '기한 전' 으로 따로.
 */
export function agingOf({ payments, orders }, today) {
  if (!Array.isArray(payments)) return null;
  const live = new Map((orders || []).filter((o) => ACTIVE_FOR_CASH.has(o.status)).map((o) => [o.id, o]));
  const buckets = [
    { key: '0-30', label: '30일 이내', max: 30, amount: 0, count: 0 },
    { key: '31-60', label: '31~60일', max: 60, amount: 0, count: 0 },
    { key: '61-90', label: '61~90일', max: 90, amount: 0, count: 0 },
    { key: '90+', label: '90일 넘음', max: Infinity, amount: 0, count: 0 },
  ];
  const items = [];
  let notDue = 0;
  const add = (o, amount, since, stage) => {
    const days = daysBetween(since, today);
    if (days <= 0) { notDue += amount; return; }
    const b = buckets.find((x) => days <= x.max);
    b.amount += amount; b.count += 1;
    items.push({ order_id: o.id, label: orderLabel(o), stage, amount, days });
  };
  const scheduled = new Set();
  for (const p of payments) {
    scheduled.add(p.order_id);
    const o = live.get(p.order_id);
    if (!o || p.paid_on) continue;
    if (p.due_on) add(o, num(p.amount), String(p.due_on).slice(0, 10), p.stage);
    else notDue += num(p.amount);
  }
  for (const o of live.values()) {
    if (scheduled.has(o.id)) continue;
    const left = outstandingOf(o);
    if (!(left > 0)) continue;
    const done = o.completed_at || o.delivered_at;
    if (done) add(o, left, kstDate(done), null);
    else notDue += left;
  }
  items.sort((a, b) => b.days - a.days || b.amount - a.amount);
  const overdue = buckets.reduce((s, b) => s + b.amount, 0);
  return {
    overdue: Math.round(overdue),
    notDue: Math.round(notDue),
    buckets: buckets.map(({ key, label, amount, count }) => ({ key, label, amount: Math.round(amount), count })),
    top: items.slice(0, 5),
  };
}

// ── 리드타임 · 납기 (3단계 PR-10) ────────────────────────────

/** 수주에서 설치까지 — 단계 사이의 빈 날이 대기다 (가치흐름) */
export const LEAD_STAGES = Object.freeze([
  { key: 'measure', from: 'order', to: 'measurement', label: '수주 → 실측' },
  { key: 'start', from: 'measurement', to: 'manufacturing_start', label: '실측 → 제작 착수' },
  { key: 'make', from: 'manufacturing_start', to: 'manufacturing_end', label: '제작' },
  { key: 'install', from: 'manufacturing_end', to: 'installation', label: '제작 완료 → 설치' },
]);

/**
 * 7 리드타임 · 납기 준수 — 반년 창(그 달 끝, 이번 달이면 오늘까지).
 *   리드타임  수주마다 단계 일정의 **실제 완료 시각**(completed_at) 사이 날수, 중간값.
 *             수주 시각은 ordered_at. 두 끝이 다 있어야 센다
 *   납기 준수 그 창에 설치를 끝낸 것 중 처음 잡은 날(planned_at) 안에 끝낸 비율, 늦으면 평균 며칠
 *   밀림      아직 설치 전인데 잡힌 날이 지난 것 · 일정을 미룬 설치
 * planned_at 칸이 아직 없으면(3단계 SQL 전) null.
 */
export function leadTimeOf({ schedules, leadOrders }, month, today = null) {
  if (!Array.isArray(schedules)) return null;
  const win = windowOf(month, today, QUALITY_WINDOW_DAYS);
  const todayD = today || win.end;
  // 설계마다 종류별 가장 이른 (취소 아닌) 일정
  const byDesign = new Map();
  for (const s of schedules) {
    if (s.status === 'cancelled') continue;
    if (!byDesign.has(s.design_id)) byDesign.set(s.design_id, {});
    const m = byDesign.get(s.design_id);
    if (!m[s.type] || String(s.scheduled_at) < String(m[s.type].scheduled_at)) m[s.type] = s;
  }
  const at = (s) => (s && s.completed_at ? s.completed_at : null);
  const stageDays = Object.fromEntries(LEAD_STAGES.map((st) => [st.key, []]));
  const total = [];
  for (const o of leadOrders || []) {
    if (o.status === 'cancelled' || !o.ordered_at) continue;
    const m = byDesign.get(o.design_id) || {};
    const inst = at(m.installation);
    if (!inst || !inWindowDay(kstDate(inst), win)) continue; // 창 안에서 설치를 끝낸 수주만
    const point = (k) => (k === 'order' ? o.ordered_at : at(m[k]));
    for (const st of LEAD_STAGES) {
      const a = point(st.from), b = point(st.to);
      if (a && b && Date.parse(b) >= Date.parse(a)) stageDays[st.key].push((Date.parse(b) - Date.parse(a)) / DAY_MS);
    }
    total.push((Date.parse(inst) - Date.parse(o.ordered_at)) / DAY_MS);
  }
  const stages = LEAD_STAGES.map((st) => ({ key: st.key, label: st.label, n: stageDays[st.key].length, medianDays: oneDecimal(median(stageDays[st.key])) }));
  const known = stages.filter((s) => s.medianDays !== null);
  const slowest = known.length ? known.reduce((a, b) => (b.medianDays > a.medianDays ? b : a)) : null;
  // 납기 준수 — 설치
  let done = 0, onTime = 0, lateDays = 0, late = 0, rescheduled = 0, overdue = 0;
  for (const m of byDesign.values()) {
    const s = m.installation;
    if (!s) continue;
    const planned = kstDate(s.planned_at || s.scheduled_at);
    if (s.completed_at) {
      const d = kstDate(s.completed_at);
      if (!inWindowDay(d, win)) continue;
      done += 1;
      if (d <= planned) onTime += 1;
      else { late += 1; lateDays += daysBetween(planned, d); }
      if (s.planned_at && kstDate(s.scheduled_at) !== planned) rescheduled += 1;
    } else if (kstDate(s.scheduled_at) < todayD) overdue += 1;
  }
  return {
    window: win,
    orders: total.length,
    totalMedianDays: oneDecimal(median(total)),
    stages,
    slowest: slowest ? { key: slowest.key, label: slowest.label, medianDays: slowest.medianDays } : null,
    install: { done, onTime, onTimeRate: pct(onTime, done), avgLateDays: late ? Math.round((lateDays / late) * 10) / 10 : null, rescheduled, overdue },
  };
}
const inWindowDay = (d, win) => d >= win.start && d <= win.end;

// ── 계절 지수 · 수주 예측 (3단계 PR-12) ──────────────────────

/** 계절 지수를 내려면 열두 달이 있어야 한다 (달마다 한 번은 봐야 그 달의 무게를 안다) */
export const SEASON_MIN_MONTHS = 12;
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return ym(Math.floor(t / 12), (t % 12) + 1);
}

/**
 * 21 계절 지수 · 수주 예측 — 오늘이 든 달 기준.
 *   달별 매출  사장님이 적은 과거 월 매출(sales_history)이 먼저, 없는 달은 시스템 수주(VAT 제외 계약금)
 *              — 사장님 숫자는 시스템 밖 주문까지 담은 장부라 일부러 적은 값이다
 *   계절 지수  끝난 달(이번 달 제외) 열두 개 이상일 때, 같은 달 평균 ÷ 전체 달 평균 (1.0 = 보통 달)
 *   예측       최근 열두 달 평균 × 그 달의 지수 — 이번 달과 다음 두 달
 *   파이프라인 결정을 기다리는 확인서(60일 안) × 최근 반년 전환율 × 최근 반년 평균 수주 금액
 * 과거 매출 표가 아직 없으면 needSql 을 세우고 시스템 수주만으로 본다.
 */
export function forecastOf({ history, sysOrders, documents }, today) {
  const cur = today.slice(0, 7);
  const sys = new Map();
  for (const o of sysOrders || []) {
    if (o.status === 'cancelled' || !o.ordered_at) continue;
    const k = kstDate(o.ordered_at).slice(0, 7);
    if (!sys.has(k)) sys.set(k, { revenue: 0, orders: 0 });
    const a = sys.get(k); a.revenue += Math.round(num(o.contract_amount) / 1.1); a.orders += 1;
  }
  const manual = new Map((history || []).map((h) => [String(h.month).slice(0, 7), h]));
  const valueOf = (k) => {
    if (manual.has(k)) return { revenue: num(manual.get(k).revenue), source: 'manual' };
    if (sys.has(k) && sys.get(k).revenue > 0) return { revenue: sys.get(k).revenue, source: 'system' };
    return { revenue: null, source: null };
  };
  // 끝난 달 — 가장 이른 기록부터 지난달까지
  const keys = [...new Set([...manual.keys(), ...sys.keys()])].filter((k) => k < cur).sort();
  const done = [];
  if (keys.length) for (let k = keys[0]; k < cur; k = addMonths(k, 1)) { const v = valueOf(k); if (v.revenue !== null) done.push({ month: k, ...v }); }
  const coverage = done.length;
  const ready = coverage >= SEASON_MIN_MONTHS;
  const avgAll = coverage ? done.reduce((s, d) => s + d.revenue, 0) / coverage : 0;
  let index = null, peak = null, low = null;
  if (ready && avgAll > 0) {
    index = Array.from({ length: 12 }, (_, i) => {
      const vals = done.filter((d) => Number(d.month.slice(5, 7)) === i + 1).map((d) => d.revenue);
      return { m: i + 1, value: vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length / avgAll) * 100) / 100 : null };
    });
    const known = index.filter((x) => x.value !== null);
    peak = known.reduce((a, b) => (b.value > a.value ? b : a));
    low = known.reduce((a, b) => (b.value < a.value ? b : a));
  }
  const last12 = done.slice(-12);
  const base = last12.length ? Math.round(last12.reduce((s, d) => s + d.revenue, 0) / last12.length) : null;
  const next = ready && base !== null ? [0, 1, 2].map((n) => {
    const k = addMonths(cur, n);
    const idx = index[Number(k.slice(5, 7)) - 1].value;
    return { month: k, index: idx, forecast: Math.round(base * (idx ?? 1)) };
  }) : null;
  // 파이프라인
  const byDesign = confirmationsByDesign(documents);
  const since60 = addDays(today, -60);
  const half = addMonths(cur, -6);
  let pending = 0, issued = 0, approved = 0;
  for (const docs of byDesign.values()) {
    const first = docs.at(0), last = docs.at(-1);
    const firstM = kstDate(first.created_at).slice(0, 7);
    if (firstM >= half && firstM < cur) { issued += 1; if (docs.some((d) => d.decision === 'approved')) approved += 1; }
    if (!last.decision && !['revoked', 'superseded'].includes(last.status) && kstDate(last.created_at) >= since60) pending += 1;
  }
  const recent = (sysOrders || []).filter((o) => o.status !== 'cancelled' && o.ordered_at && kstDate(o.ordered_at).slice(0, 7) >= half);
  const avgContract = recent.length ? Math.round(recent.reduce((s, o) => s + num(o.contract_amount) / 1.1, 0) / recent.length) : null;
  const conversion = issued ? approved / issued : null;
  return {
    needSql: history === null,
    today,
    months: [...done.slice(-24), { month: cur, ...valueOf(cur), partial: true }],
    coverage,
    minMonths: SEASON_MIN_MONTHS,
    ready,
    index,
    peak,
    low,
    base,
    next,
    pipeline: {
      pending,
      conversion: conversion === null ? null : Math.round(conversion * 1000) / 10,
      avgContract,
      expected: conversion !== null && avgContract !== null ? Math.round(pending * conversion * avgContract) : null,
    },
  };
}

// ── 분기 목표 (3단계 PR-13) ──────────────────────────────────

/** 분기의 세 달 'YYYY-MM' */
export function monthsOfQuarter(quarter) {
  const [y, q] = String(quarter).split('-Q').map(Number);
  return [1, 2, 3].map((i) => ym(y, (q - 1) * 3 + i));
}

/**
 * 분기 누계 — 이익 식과 같은 계산(financeOf)을 그 분기의 지난 달 · 이번 달까지 더한다.
 * 아직 오지 않은 달은 더하지 않는다(월 고정비를 미리 빼지 않게). 전환율은 분기 코호트.
 */
export function quarterStatsOf({ orders, snapshotsById, documents, consultations, overheadMonthly }, quarter, today) {
  const cur = today.slice(0, 7);
  const months = monthsOfQuarter(quarter);
  const s = { revenue: 0, net: 0, orders: 0, contribution: 0, revenueKnown: 0, issued: 0, approved: 0, months: 0 };
  for (const m of months) {
    if (m > cur) continue;
    const f = financeOf(orders, snapshotsById, { month: m, overheadMonthly });
    s.revenue += f.revenue; s.net += f.net; s.orders += f.orders; s.contribution += f.contribution;
    s.revenueKnown += f.rows.filter((r) => r.cost !== null).reduce((a, r) => a + r.revenue, 0);
    const l = leadsAndConversion({ documents, consultations }, m);
    s.issued += l.issued; s.approved += l.approved; s.months += 1;
  }
  const start = `${months[0]}-01`;
  const end = monthEndOf(months[2]);
  const total = daysBetween(start, end) + 1;
  const elapsed = today < start ? 0 : today > end ? 1 : (daysBetween(start, today) + 1) / total;
  return {
    quarter,
    revenue: s.revenue, net: s.net, orders: s.orders,
    cmRate: pct(s.contribution, s.revenueKnown),
    conversion: pct(s.approved, s.issued),
    elapsed: Math.round(elapsed * 1000) / 10,
  };
}

/**
 * 18 분기 목표 — 묶은 숫자의 지금 값 · 진도. 쌓이는 목표(매출 · 순이익 · 수주)는 지난 날 비율과 견줘
 * '제 속도' / '뒤처짐', 비율 목표는 닿았는지만. 낮을수록 좋은 목표(A/S 율)는 목표 이하면 100%.
 * 표가 아직 없으면 null.
 */
export function okrsOf({ okrs, stats, referral, quality, leadTime }) {
  if (!Array.isArray(okrs)) return null;
  const now = {
    revenue_q: stats.revenue, net_q: stats.net, orders_q: stats.orders, cm_rate_q: stats.cmRate, conversion_q: stats.conversion,
    nps: referral ? referral.nps : null,
    as_rate: quality ? quality.window.asRate : null,
    on_time: leadTime ? leadTime.install.onTimeRate : null,
  };
  const items = okrs.slice().sort((a, b) => num(a.sort) - num(b.sort)).map((o) => {
    const def = OKR_METRICS[o.metric] || OKR_METRICS.manual;
    const current = o.metric === 'manual' ? (o.manual_value ?? null) : (now[o.metric] ?? null);
    const target = num(o.target);
    const down = (o.direction || def.direction) === 'down';
    let progress = null;
    if (current !== null && current !== undefined) {
      const c = num(current);
      if (down) progress = c <= target ? 100 : c > 0 ? (target / c) * 100 : 0;
      else progress = target > 0 ? (c / target) * 100 : c >= target ? 100 : 0;
      progress = Math.max(0, Math.round(progress * 10) / 10);
    }
    let status = null;
    if (progress !== null) {
      if (progress >= 100) status = 'done';
      else if (def.cumulative) status = progress >= stats.elapsed - 5 ? 'on_track' : 'behind';
      else status = 'below';
    }
    return {
      id: o.id, objective: o.objective, metric: o.metric, label: def.label, unit: def.unit,
      target, current: current === null || current === undefined ? null : num(current),
      direction: down ? 'down' : 'up', cumulative: Boolean(def.cumulative), progress, status,
      manual_value: o.manual_value ?? null,
    };
  });
  return {
    quarter: stats.quarter,
    elapsed: stats.elapsed,
    items,
    metrics: Object.entries(OKR_METRICS).map(([key, d]) => ({ key, label: d.label, unit: d.unit, direction: d.direction })),
  };
}

// ── 원판 사용량 (3단계 PR-11) ────────────────────────────────

/** 수율을 고치자고 말하려면 이만큼의 수주가 있어야 한다 — 몇 건으로 설정을 흔들지 않는다 */
export const YIELD_MIN_ORDERS = 5;

/**
 * 15 원판 수율 — 견적이 잡은 원판 장수(PB + 뒷판, 면적 ÷ 수율) 대 재단 기사가 실제로 자른 장수(작업 실측).
 * 재단이 끝난 수주(납품 · 완료)만, 반년 창. 둘 다 있는 수주만 센다.
 *   실제 수율 ≈ 설정 수율 × 계획 ÷ 실제 — 실제가 계획보다 많으면 원판을 더 쓴 것(수율이 낮다)
 *   원가 차이 = (실제 − 계획) × 장당 값 (계획의 PB · 뒷판 비율로 섞은 값)
 * YIELD_MIN_ORDERS 건 이상이면 생산 설정의 수율을 고치자고 제안한다.
 */
export function sheetYieldOf({ doneOrders, snapshotsById, cutLogs, settings }, month, today = null) {
  const win = windowOf(month, today, QUALITY_WINDOW_DAYS);
  const q = (settings && settings.quote) || {};
  const yieldNow = num(q.pbYield) || 0.8;
  const actualBy = new Map();
  for (const l of cutLogs || []) {
    if (l.role !== 'cutter' || !l.order_id) continue;
    actualBy.set(l.order_id, (actualBy.get(l.order_id) || 0) + num(l.units));
  }
  const rows = [];
  let planPB = 0, planBack = 0, planned = 0, actual = 0;
  for (const o of doneOrders || []) {
    const done = o.completed_at || o.delivered_at;
    if (!done || !inWindowDay(kstDate(done), win)) continue;
    const qq = quoteOf(o, snapshotsById);
    const qty = qq && qq.cost && qq.cost.quantities;
    const plan = qty ? num(qty.sheetsPB) + num(qty.sheetsBack) : 0;
    const got = actualBy.get(o.id) || 0;
    if (!(plan > 0) || !(got > 0)) continue;
    planPB += num(qty.sheetsPB); planBack += num(qty.sheetsBack);
    planned += plan; actual += got;
    rows.push({ id: o.id, label: orderLabel(o), planned: Math.round(plan * 10) / 10, actual: Math.round(got * 10) / 10, diffRate: pct(got - plan, plan) });
  }
  const price = planned > 0 ? (planPB * num(q.pbSheet) + planBack * num(q.backSheet)) / planned : 0;
  const implied = actual > 0 ? Math.round(yieldNow * (planned / actual) * 100) / 100 : null;
  rows.sort((a, b) => (b.diffRate ?? 0) - (a.diffRate ?? 0));
  return {
    window: win,
    orders: rows.length,
    planned: Math.round(planned * 10) / 10,
    actual: Math.round(actual * 10) / 10,
    diffRate: pct(actual - planned, planned),
    costDiff: Math.round((actual - planned) * price),
    yieldNow,
    impliedYield: implied,
    suggestYield: rows.length >= YIELD_MIN_ORDERS && implied !== null && Math.abs(implied - yieldNow) >= 0.02 ? implied : null,
    minOrders: YIELD_MIN_ORDERS,
    top: rows.slice(0, 5),
  };
}

function monthEndOf(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const pair = (value, prev) => ({ value, prev });

/**
 * 1단계 경영 요약 한 벌.
 * @param {Object} p
 * @param {Array}  p.orders         회사 전체 수주 (취소 포함 — 걸러 내는 것은 summarizeMonth)
 * @param {Map}    p.snapshotsById  snapshot_id → { quote_payload }
 * @param {Array}  p.documents      고객 확인서 (design_id · doc_type · status · decision · created_at)
 * @param {Array|null} p.consultations 상담 (created_at · user_id). 못 읽었으면 null
 * @param {Array|null} p.generations   AI 연출컷 (id · user_id · status · created_at). 못 읽었으면 null
 * @param {Array}  p.designs        연출컷에서 시작한 설계 (id · generation_id)
 * @param {Array}  p.costs          실적 원가 (order_id · category · amount)
 * @param {Array}  p.worklogs       작업 실측 (order_id · role · minutes · work_date)
 * @param {Array}  p.paceLogs       처리능력 실측용 — 그 달 끝에서 거꾸로 PACE_WINDOW_DAYS 동안의 기록 (role · units · minutes · work_date)
 * @param {Array|null} p.reworks    재작업 · A/S (반년 창). 표가 없으면 null
 * @param {Array}  p.installed      납품 · 완료된 수주 (id · status · delivered_at · completed_at)
 * @param {Array|null} p.feedback   설치 후 한 문항 (score · created_at · answered_at). 표가 없으면 null
 * @param {Array|null} p.counterparties  거래처 · 공급처 (id · kind · name · category · active). 표가 없으면 null
 * @param {Array|null} p.partnerOrders   한 해 동안 거래처가 붙었거나 거래처로 판정된 수주. 칸이 없으면 null
 * @param {Array}  p.supplierCosts  한 해 동안 공급처를 붙인 원가 줄 (counterparty_id · amount · spent_on · created_at)
 * @param {Array}  p.outsource      한 해 동안의 외주 · 상판 발주 보고 (status · period_start · period_end · metrics)
 * @param {Array|null} p.balances   통장 잔액 기록 (as_of · amount). 표가 없으면 null
 * @param {Array|null} p.payments   수금 일정 (order_id · stage · amount · due_on · paid_on). 표가 없으면 null
 * @param {Array}  p.dueCosts       아직 안 낸 원가 줄 (amount · due_on · spent_on)
 * @param {Array}  p.cashOrders     현금용 수주 (취소 아닌 것 — contract_amount · received_amount · 납품/완료일)
 * @param {Map}    p.installs       design_id → 가장 이른 설치일 (KST)
 * @param {Array|null} p.schedules  일정 (design_id · type · status · scheduled_at · planned_at · completed_at). 칸이 없으면 null
 * @param {Array}  p.leadOrders     리드타임용 수주 (design_id · ordered_at · status)
 * @param {Array}  p.doneOrders     납품 · 완료된 수주 (id · snapshot_id · 납품/완료일 · 이름)
 * @param {Array}  p.cutLogs        그 수주들의 재단 실측 (order_id · role · units)
 * @param {Array|null} p.history    과거 월 매출 (month · revenue · orders). 표가 없으면 null
 * @param {Array}  p.sysOrders      예측용 수주 3년치 (contract_amount · status · ordered_at)
 * @param {Array|null} p.okrs       그 분기의 목표 (표가 없으면 null) — 분기는 고른 달이 든 분기
 * @param {string} [p.today]        오늘 (KST, YYYY-MM-DD) — 이번 달의 반년 창 끝
 * @param {Object} p.settings       mergeSettings 결과 (+ source)
 * @param {string} p.month          'YYYY-MM'
 */
export function buildManagementSummary({ orders, snapshotsById, documents, consultations, generations = null, designs = [], costs = [], worklogs = [], paceLogs = [], reworks = null, installed = [], feedback = null, counterparties = null, partnerOrders = null, supplierCosts = [], outsource = [], balances = null, payments = null, dueCosts = [], cashOrders = [], installs = new Map(), schedules = null, leadOrders = [], doneOrders = [], cutLogs = [], history = null, sysOrders = [], okrs = null, settings, month, today = null }) {
  const prev = prevMonthOf(month);
  const overheadMonthly = num(settings && settings.quote && settings.quote.overheadMonthly);
  const cur = financeOf(orders, snapshotsById, { month, overheadMonthly });
  const old = financeOf(orders, snapshotsById, { month: prev, overheadMonthly });
  const lead = leadsAndConversion({ documents, consultations }, month);
  const leadPrev = leadsAndConversion({ documents, consultations }, prev);
  const out = {
    month,
    prevMonth: prev,
    tree: {
      leads: pair(lead.leads, leadPrev.leads),
      conversion: pair(lead.conversion, leadPrev.conversion),
      issued: pair(lead.issued, leadPrev.issued),
      approved: pair(lead.approved, leadPrev.approved),
      pending: lead.pending,
      orders: pair(cur.orders, old.orders),
      avgContract: pair(cur.avgContract, old.avgContract),
      revenue: pair(cur.revenue, old.revenue),
      cmRate: pair(cur.cmRate, old.cmRate),
      contribution: pair(cur.contribution, old.contribution),
      overhead: cur.overhead,
      net: pair(cur.net, old.net),
      unknownCost: cur.unknownCost,
    },
    breakEven: breakEven({ overhead: cur.overhead, revenue: cur.revenue, rate: cur.cmExact }),
    channels: channelsOf(cur.rows, orders, snapshotsById),
    funnel: funnelOf({ documents, consultations, orders }, month),
    platform: {
      value: platformOf({ generations, designs, documents, orders, consultations }, month),
      prev: platformOf({ generations, designs, documents, orders, consultations }, prev),
    },
    process: processOf({ orders, snapshotsById, costs, worklogs, paceLogs, settings }, month),
    scenario: scenarioBase(orders, snapshotsById, settings, month),
    quality: qualityOf({ reworks, installed, settings }, month, today),
    referral: referralOf(feedback, month, today),
    partners: partnersOf({ partnerOrders, snapshotsById, counterparties }, month, today),
    suppliers: suppliersOf({ supplierCosts, outsource, counterparties }, month, today),
    // 현금은 이달 선택과 상관없이 오늘부터 앞으로
    cashflow: cashflowOf({ balances, payments, costs: dueCosts, orders: cashOrders, installs, overheadMonthly }, today || kstDate()),
    aging: agingOf({ payments, orders: cashOrders }, today || kstDate()),
    leadTime: leadTimeOf({ schedules, leadOrders }, month, today),
    sheetYield: sheetYieldOf({ doneOrders, snapshotsById, cutLogs, settings }, month, today),
    // 예측은 이달 선택과 상관없이 오늘부터
    forecast: forecastOf({ history, sysOrders, documents }, today || kstDate()),
    basis: {
      revenue: 'VAT 제외 계약금',
      cost: '확인서 견적 원가 (고정비 회수분 제외)',
      overhead: overheadMonthly,
      settingsSource: (settings && settings.source) || 'default',
    },
  };
  // 분기 목표 — 고른 달이 든 분기. 아래 줄들의 숫자(소개 의향 · A/S 율 · 납기)를 그대로 묶는다
  const quarter = quarterOf(month);
  const stats = quarterStatsOf({ orders, snapshotsById, documents, consultations, overheadMonthly }, quarter, today || kstDate());
  out.okrs = okrsOf({ okrs, stats, referral: out.referral, quality: out.quality, leadTime: out.leadTime });
  return out;
}
