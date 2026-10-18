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
  const leads = Array.isArray(consultations) ? consultations.filter((c) => inMonth(c.created_at, month)).length : null;
  const byDesign = new Map();
  for (const d of documents || []) {
    if (d.doc_type && d.doc_type !== 'customer_confirmation') continue;
    if (!byDesign.has(d.design_id)) byDesign.set(d.design_id, []);
    byDesign.get(d.design_id).push(d);
  }
  let issued = 0, approved = 0, rejected = 0, pending = 0;
  for (const docs of byDesign.values()) {
    const sorted = docs.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!inMonth(sorted[0].created_at, month)) continue;
    issued += 1;
    if (sorted.some((d) => d.decision === 'approved')) { approved += 1; continue; }
    const last = sorted[sorted.length - 1];
    if (last.decision === 'rejected' || last.status === 'rejected') rejected += 1;
    else if (last.status !== 'revoked') pending += 1;
  }
  return { leads, issued, approved, rejected, pending, conversion: pct(approved, issued) };
}

const pair = (value, prev) => ({ value, prev });

/**
 * 1단계 경영 요약 한 벌.
 * @param {Object} p
 * @param {Array}  p.orders         회사 전체 수주 (취소 포함 — 걸러 내는 것은 summarizeMonth)
 * @param {Map}    p.snapshotsById  snapshot_id → { quote_payload }
 * @param {Array}  p.documents      고객 확인서 (design_id · doc_type · status · decision · created_at)
 * @param {Array|null} p.consultations 상담 (created_at). 못 읽었으면 null
 * @param {Object} p.settings       mergeSettings 결과 (+ source)
 * @param {string} p.month          'YYYY-MM'
 */
export function buildManagementSummary({ orders, snapshotsById, documents, consultations, settings, month }) {
  const prev = prevMonthOf(month);
  const overheadMonthly = num(settings && settings.quote && settings.quote.overheadMonthly);
  const cur = financeOf(orders, snapshotsById, { month, overheadMonthly });
  const old = financeOf(orders, snapshotsById, { month: prev, overheadMonthly });
  const lead = leadsAndConversion({ documents, consultations }, month);
  const leadPrev = leadsAndConversion({ documents, consultations }, prev);
  return {
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
    basis: {
      revenue: 'VAT 제외 계약금',
      cost: '확인서 견적 원가 (고정비 회수분 제외)',
      overhead: overheadMonthly,
      settingsSource: (settings && settings.source) || 'default',
    },
  };
}
