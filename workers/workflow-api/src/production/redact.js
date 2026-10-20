/**
 * 공장 작업자에게 가는 문구 깎기 (결정 ★15, worker-portal.plan.md §9-7).
 *
 * 작업자에게 가는 것 = 작업자 화면(production-worker.html ← /public/production/today) · 작업자 Slack 채널(buildInstructionBlocks).
 *   - 고객 실명 대신 가린 이름 "홍*동 (주문번호)" (maskName, share.js)
 *   - 금액(일당·비용) 없음 (worker-access.js 머리 규칙)
 * 대표 쪽(production.html · 제안 Slack · 월 요약)은 실명·금액 그대로 둔다.
 */

import { maskName } from '../share.js';

/** 대표용 주문 이름 — "고객명 (주문번호)", 고객명이 없으면 주문번호. */
export function orderLabel(o) {
  return o.customer_name ? `${o.customer_name} (${o.order_no})` : o.order_no;
}

/** 작업자용 주문 이름 — "홍*동 (주문번호)". */
export function workerOrderLabel(o) {
  return o.customer_name ? `${maskName(o.customer_name)} (${o.order_no})` : o.order_no;
}

/**
 * 이미 문자열로 저장된 대표용 주문 이름(orderLabel 모양)을 작업자용으로.
 * 지시(production_assignments)·실측 기록(production_worklogs)은 주문 이름을 글자로만 갖고 있다.
 * orderLabel 이 만드는 모양은 "고객명 (주문번호)" 와 주문번호뿐이라, 끝 괄호가 없으면 주문번호다.
 * 이미 가린 이름은 다시 가려도 같다 (홍*동 → 홍*동).
 */
export function maskOrderLabel(label) {
  const s = String(label || '');
  const m = /^(.+) \(([^()]*)\)$/.exec(s);
  return m ? `${maskName(m[1])} (${m[2]})` : s;
}

// planner.js 조립 인원 추가 문구의 " (일당 N만)"
const DAY_RATE = /\s*\(일당[^)]*\)/g;

/** 지시 문구 → 작업자용: 주문 이름은 가리고 일당은 뺀다. */
export function workerAssignmentText(a) {
  let text = String((a && a.text) || '');
  if (a && a.order_label) text = text.split(a.order_label).join(maskOrderLabel(a.order_label));
  return text.replace(DAY_RATE, '');
}
