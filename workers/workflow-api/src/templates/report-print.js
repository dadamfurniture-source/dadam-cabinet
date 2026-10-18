/**
 * 작업 지시 보고 A4 인쇄 — 생산 계획 · 인력 승인 · 아침 요약 · 월 마감 · 메모 (동결 본문 그대로).
 * 작업지시서 · 설치 지시서는 여기서 그리지 않는다 — 보관함이 기존 `/documents/:id/print?pack=` 를 연다.
 * 모든 값은 esc() 를 거친다 (보고 제목·메모·주문 라벨은 사용자 입력).
 */

import { esc, num, ymd, ymdhm, tr, thead, documentShell } from './html.js';
import { PRINT_CSS, PRINT_TOOLBAR } from './print-css.js';
import { KIND_LABEL, OUTSOURCE_PACKS, outsourceQtyText } from '../reports/record.js';
import { dayLabel } from '../production/planner.js';

const STATUS_LABEL = {
  pending: '결정 전', approved: '승인', dismissed: '무시', superseded: '대체됨',
  issued: '발행', sent: '보냄', failed: '보내기 실패', ordered: '발주', received: '입고', cancelled: '취소',
  instructed: '지시', done: '완료',
};
const SUGG_LABEL = {
  asm_extra: '조립 인원 추가', edge_overtime: '알바(엣지) 연장', edge_outsource: '재단+엣지 외주',
  reschedule: '설치일 조정', door_order: '도어 발주', asm_call: '조립 기사 출근', top_order: '상판 발주',
};
const won = (n) => (n === null || n === undefined ? '-' : `${Math.round(Number(n) / 10000).toLocaleString('ko-KR')}만원`);
const hours = (sec) => `${(Number(sec || 0) / 3600).toFixed(1)}h`;
const pctOf = (part) => (part && part.cap > 0 ? Math.round((part.load / part.cap) * 100) : 0);

const EXTRA_CSS = `
.bar { position: relative; height: 9pt; background: #eee; border: 0.4pt solid #999; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #555; }
.bar i.over { background: #000; }
.kpis { display: flex; gap: 8pt; flex-wrap: wrap; margin: 4pt 0 8pt; }
.kpis div { border: 0.4pt solid #000; padding: 3pt 6pt; min-width: 70pt; }
.kpis b { display: block; font-size: 13pt; }
.memo { border: 0.4pt solid #999; padding: 6pt; white-space: pre-wrap; min-height: 14mm; }
`;

function loadCell(part) {
  const p = pctOf(part);
  return `<div class="bar"><i class="${p > 100 ? 'over' : ''}" style="width:${Math.min(100, p)}%"></i></div><span class="muted">${esc(hours(part && part.load))} / ${esc(hours(part && part.cap))} · ${num(p)}%</span>`;
}

function kpis(list) {
  return `<div class="kpis">${list.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`;
}

function planBody(r) {
  const plan = (r.body && r.body.plan) || {};
  const s = plan.summary || {};
  const days = Array.isArray(plan.days) ? plan.days : [];
  const jobs = Array.isArray(plan.jobs) ? plan.jobs : [];
  const sugg = Array.isArray(plan.suggestions) ? plan.suggestions : [];
  return `
  ${kpis([['진행 주문', num(s.jobs)], ['지연 (전→후)', `${num(s.lateBefore)} → ${num(s.lateAfter)}`], ['추가 비용', esc(won(s.extraCost))], ['추천', num(sugg.length)]])}
  <div class="section-title">추천</div>
  <table class="compact">${thead(['종류', '내용', '날짜', '비용'])}<tbody>${
    sugg.map((x) => tr([esc(SUGG_LABEL[x.type] || x.type), esc(x.text), esc(x.date ? dayLabel(x.date) : x.to ? `→ ${dayLabel(x.to)}` : ''), esc(x.cost ? won(x.cost) : '')])).join('') || tr(['추천 없음', '', '', ''])
  }</tbody></table>
  <div class="section-title">날짜별 부하</div>
  <table class="compact">${thead(['날짜', '재단', '엣지', '조립', '조립 인원'])}<tbody>${
    days.slice(0, 15).map((d) => tr([esc(dayLabel(d.date)), loadCell(d.cut), loadCell(d.edge), loadCell(d.asm), num(d.asm && d.asm.people)])).join('')
  }</tbody></table>
  <div class="section-title">주문별 일정</div>
  <table class="compact">${thead(['주문', '마감', '완료 예정', '상태'])}<tbody>${
    jobs.map((j) => tr([esc(j.label), esc(j.due ? dayLabel(j.due) : '-'), esc(j.finish ? dayLabel(j.finish) : '범위 밖'), esc(j.late ? (j.rescheduleTo ? `설치일 조정 → ${dayLabel(j.rescheduleTo)}` : '늦음') : '제때')])).join('')
  }</tbody></table>`;
}

function decisionBody(r, live) {
  const b = r.body || {};
  const liveById = new Map((live || []).map((a) => [a.id, a]));
  const rows = (b.assignments || []).map((a) => {
    const now = a.id ? liveById.get(a.id) : null;
    return tr([esc(a.work_date ? dayLabel(a.work_date) : '-'), esc(a.text), esc(a.cost ? won(a.cost) : ''), esc(now ? (STATUS_LABEL[now.status] || now.status) : '')]);
  }).join('');
  return `
  ${kpis([['결정', esc(b.decision === 'approve' ? '승인' : '무시')], ['지시', num((b.assignments || []).length)], ['추가 비용', esc(won(r.metrics && r.metrics.cost))]])}
  ${b.reconstructed ? '<div class="muted">옛 제안에서 옮겨 담음 — 고른 추천은 지시 행으로 재구성</div>' : ''}
  <div class="section-title">지시</div>
  <table class="compact">${thead(['날짜', '지시', '비용', '지금 상태'])}<tbody>${rows || tr(['지시 없음', '', '', ''])}</tbody></table>`;
}

function dailyBody(r) {
  const b = r.body || {};
  const d0 = b.day;
  const jobs = b.jobs || [];
  const late = jobs.filter((j) => j.late || j.rescheduleTo);
  const door = jobs.filter((j) => j.doorOrderBy && j.doorOrderBy <= (r.period_start || ''));
  return `
  ${kpis([['재단', `${num(r.metrics && r.metrics.cut)}%`], ['엣지', `${num(r.metrics && r.metrics.edge)}%`], ['조립', `${num(r.metrics && r.metrics.asm)}% · ${num(r.metrics && r.metrics.asmPeople)}명`], ['오늘 지시', num((b.todays || []).length)], ['지연', num(r.metrics && r.metrics.late)]])}
  ${d0 ? `<table class="compact">${thead(['재단', '엣지', '조립'])}<tbody>${tr([loadCell(d0.cut), loadCell(d0.edge), loadCell(d0.asm)])}</tbody></table>` : '<div class="muted">오늘 공장 작업 없음</div>'}
  <div class="section-title">오늘 지시</div>
  <table class="compact">${thead(['지시', '상태'])}<tbody>${(b.todays || []).map((a) => tr([esc(a.text), esc(STATUS_LABEL[a.status] || a.status || '')])).join('') || tr(['없음', ''])}</tbody></table>
  ${late.length ? `<div class="section-title">늦어질 주문</div><table class="compact">${thead(['주문', '마감', '완료 예정'])}<tbody>${late.map((j) => tr([esc(j.label), esc(j.due ? dayLabel(j.due) : '-'), esc(j.finish ? dayLabel(j.finish) : '범위 밖')])).join('')}</tbody></table>` : ''}
  ${door.length ? `<div class="section-title">도어 발주 마감</div><table class="compact">${thead(['주문', '마감'])}<tbody>${door.map((j) => tr([esc(j.label), esc(dayLabel(j.doorOrderBy)) + (j.doorOrderLate ? ' (늦음)' : '')])).join('')}</tbody></table>` : ''}
  <div class="muted">Slack: 대표 ${b.slack && b.slack.owner ? '보냄' : '실패'}${b.slack && b.slack.workers !== null && b.slack.workers !== undefined ? ` · 작업자 ${b.slack.workers ? '보냄' : '실패'}` : ''}</div>`;
}

function monthBody(r) {
  const s = (r.body && r.body.summary) || {};
  const t = s.totals || {};
  return `
  ${kpis([['주문', num(t.orders)], ['매출', esc(won(t.revenue))], ['지출', esc(won(t.cost))], ['남는 돈', esc(won(t.gross))], ['간접비', esc(won(t.overhead))], ['손익', esc(won(t.net))]])}
  <table class="compact">${thead(['주문', '매출', '지출', '남는 돈'])}<tbody>${(s.rows || []).map((o) => tr([esc(o.label), esc(won(o.revenue)), esc(o.cost === null ? '모름' : won(o.cost)), esc(o.gross === null ? '-' : won(o.gross))])).join('')}</tbody></table>`;
}

function outsourceBody(r) {
  const b = r.body || {};
  const p = OUTSOURCE_PACKS[b.pack];
  return `
  ${kpis([['꾸러미', esc(p ? p.label : b.pack || '-')], ['업체', esc(b.vendor || '-')], ['발주일', esc(b.ordered_on ? dayLabel(b.ordered_on) : '-')], ['입고 예정', esc(b.expected_on ? dayLabel(b.expected_on) : '-')]])}
  <table class="compact">${thead(['문서', '수량'])}<tbody>${tr([esc(`${b.doc_no || ''}${b.title ? ` — ${b.title}` : ''}`), esc(outsourceQtyText(b.pack, b.quantities) || '-')])}</tbody></table>`;
}

/** 보고 한 건 → A4 HTML. */
export function renderReportPrint(report, { live = null, toolbar = true } = {}) {
  const r = report || {};
  let body = '';
  if (r.kind === 'production_plan') body = planBody(r);
  else if (r.kind === 'staffing_decision') body = decisionBody(r, live);
  else if (r.kind === 'daily_brief') body = dailyBody(r);
  else if (r.kind === 'monthly_close') body = monthBody(r);
  else if (r.kind === 'outsource_order') body = outsourceBody(r);
  else body = '<div class="muted">이 보고는 원본 문서에서 인쇄합니다.</div>';
  const period = r.period_start
    ? (r.period_end && r.period_end !== r.period_start ? `${ymd(`${r.period_start}T00:00:00+09:00`)} ~ ${ymd(`${r.period_end}T00:00:00+09:00`)}` : ymd(`${r.period_start}T00:00:00+09:00`))
    : '-';
  const html = `
${toolbar ? PRINT_TOOLBAR : ''}
<div class="sheet">
  <div class="doc-header">
    <div><h1>${esc(KIND_LABEL[r.kind] || '보고')}</h1><div>${esc(r.title)}</div></div>
    <div class="doc-meta"><div>기간 ${esc(period)}</div><div>상태 ${esc(STATUS_LABEL[r.status] || r.status || '-')}</div><div>기록 ${esc(ymdhm(r.created_at))}</div></div>
  </div>
  ${body}
  <div class="section-title">메모</div>
  <div class="memo">${esc(r.note || '')}</div>
</div>`;
  return documentShell({ title: `${KIND_LABEL[r.kind] || '보고'} — ${r.title || ''}`, css: PRINT_CSS + EXTRA_CSS, body: html });
}
