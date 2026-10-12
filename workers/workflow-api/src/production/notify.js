/**
 * 생산 계획 Slack 메시지 (순수 함수).
 *
 *   buildProposalBlocks    대표에게 — "이렇게 더 부르면 됩니다, 승인해 주세요" + 승인 화면 링크
 *   buildInstructionBlocks 작업자 채널에 — 승인된 지시만, 날짜순
 *
 * 웹훅은 버튼 응답(interactivity)을 받을 수 없어 승인은 링크로 연 화면에서 한다.
 */

import { dayLabel } from './planner.js';

const KIND_ORDER = ['asm_extra', 'edge_overtime', 'edge_outsource', 'reschedule', 'door_order', 'asm_call'];
const KIND_LABEL = {
  asm_extra: '조립 인원 추가',
  edge_overtime: '알바(엣지) 연장',
  edge_outsource: '재단+엣지 외주',
  reschedule: '설치일 조정',
  door_order: '도어 발주',
  asm_call: '조립 기사 출근',
};

const won = (n) => `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;

function sortSuggestions(list) {
  return list.slice().sort((a, b) => KIND_ORDER.indexOf(a.type) - KIND_ORDER.indexOf(b.type) || String(a.date || '').localeCompare(String(b.date || '')));
}

export function buildProposalBlocks({ plan, link, triggerLabel }) {
  const s = plan.summary;
  const actionable = sortSuggestions(plan.suggestions.filter((x) => x.type !== 'door_order' || x.text.includes('늦음')));
  const doorSoon = plan.suggestions.filter((x) => x.type === 'door_order' && !x.text.includes('늦음'))
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5);
  const head = s.lateBefore === 0
    ? `기본 인력으로 ${s.jobs}건 모두 설치일 전에 끝납니다.`
    : `기본 인력으로는 ${s.lateBefore}건이 늦습니다 → 아래대로 하면 ${s.lateAfter}건${s.needsReschedule ? ` (설치일 조정 ${s.needsReschedule}건)` : ''}.`;
  const lines = actionable.map((x) => `• *${KIND_LABEL[x.type] || x.type}* — ${x.text}`);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🏭 생산 계획 — 인력 추천', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `${triggerLabel ? `*${triggerLabel}*\n` : ''}${head}\n추가 비용 약 *${won(s.extraCost)}원* (조립 기사 기본 출근 ${s.asmCallDays}일 별도)` } },
  ];
  if (lines.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } });
  if (doorSoon.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '도어 발주 마감: ' + doorSoon.map((x) => x.text.split(': ')[0] + ' ' + dayLabel(x.date)).join(' · ') }] });
  if (link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '확인하고 승인하기' }, url: link, style: 'primary' }] });
  return { text: `생산 계획 — ${head}`, blocks };
}

/** 승인된 지시 → 작업자 채널 메시지. 날짜별로 묶는다. */
export function buildInstructionBlocks({ assignments }) {
  const byDate = new Map();
  for (const a of assignments) {
    const k = a.work_date || '날짜 없음';
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(a);
  }
  const dates = [...byDate.keys()].sort();
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: '📋 작업 지시', emoji: true } }];
  for (const d of dates) {
    const label = d === '날짜 없음' ? d : dayLabel(d);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${label}*\n` + byDate.get(d).map((a) => `• ${a.text}`).join('\n') } });
  }
  return { text: `작업 지시 ${assignments.length}건`, blocks: blocks.slice(0, 50) };
}

/**
 * 승인된 추천 → 지시 행. asm_call 은 날짜마다 한 행으로 편다.
 * @param {Array} suggestions  planProduction().suggestions 중 대표가 고른 것
 */
export function assignmentsFromSuggestions(suggestions, { userId, proposalId, jobLabels = {} }) {
  const rows = [];
  for (const s of suggestions) {
    const base = { user_id: userId, proposal_id: proposalId, kind: s.type, cost: Math.round(s.cost || 0), status: 'instructed' };
    if (s.type === 'asm_call') {
      for (const d of s.dates || []) rows.push({ ...base, cost: 0, work_date: d, role: 'asm', people: 1, text: `조립 기사 출근 (${dayLabel(d)})` });
      continue;
    }
    rows.push({
      ...base,
      work_date: s.date || s.to || null,
      role: s.role || null,
      people: s.people || null,
      hours: s.hours || null,
      order_label: s.jobId ? (jobLabels[s.jobId] || null) : null,
      text: String(s.text).slice(0, 500),
    });
  }
  return rows;
}

/**
 * 손써야 하는 추천만 뽑은 비교 키 — 아침 점검에서 "어제와 같은 추천" 이면 다시 보내지 않는다.
 * 출근일·도어 발주는 날마다 자연히 바뀌므로 빼고, 비용·문구가 아닌 종류·날짜·대상만 본다.
 */
export function actionKey(suggestions) {
  return JSON.stringify((suggestions || [])
    .filter((s) => ['asm_extra', 'edge_overtime', 'edge_outsource', 'reschedule'].includes(s.type))
    .map((s) => [s.type, s.date || s.to || '', s.jobId || ''])
    .sort());
}

/** 평일 아침 대표 채널 요약: 오늘 부하 · 오늘 지시 · 도어 발주 마감(오늘·내일). */
export function buildDailyBlocks({ plan, assignments, today }) {
  const d0 = plan.days[0];
  const d1 = plan.days[1];
  const h = (s) => `${(s / 3600).toFixed(1)}h`;
  const pct = (load, cap) => (cap > 0 ? Math.round((load / cap) * 100) : 0);
  const loadLine = d0
    ? `재단 ${h(d0.cut.load)} (${pct(d0.cut.load, d0.cut.cap)}%) · 엣지 ${h(d0.edge.load)} (${pct(d0.edge.load, d0.edge.cap)}%) · 조립 ${h(d0.asm.load)} — ${d0.asm.people ? d0.asm.people + '명 필요' : '조립 없음'}`
    : '오늘 공장 작업 없음';
  const due = plan.jobs
    .filter((j) => j.doorOrderBy && d1 && j.doorOrderBy <= d1.date)
    .map((j) => `• ${j.label}: 도어 발주 ${j.doorOrderBy === today ? '*오늘*' : '내일'}까지${j.doorOrderLate ? ' (이미 늦음)' : ''}`);
  const late = plan.jobs.filter((j) => j.late || j.rescheduleTo).map((j) => `• ${j.label}: 마감 ${j.due ? dayLabel(j.due) : '?'} · 완료 예정 ${j.finish ? dayLabel(j.finish) : '범위 밖'}`);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `☀️ 오늘 생산 — ${dayLabel(today)}`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*부하* ${loadLine}\n진행 중 주문 ${plan.summary.jobs}건` } },
  ];
  const section = (title, lines) => ({ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${lines.join('\n')}`.slice(0, 2900) } });
  if (assignments.length) blocks.push(section('오늘 지시', assignments.map((a) => `• ${a.text}`)));
  if (due.length) blocks.push(section('도어 발주 마감', due));
  if (late.length) blocks.push(section('늦어질 주문', late));
  return { text: `오늘 생산 — ${loadLine}`, blocks };
}
