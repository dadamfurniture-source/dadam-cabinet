/**
 * 생산 계획 + 인력 추가 추천 (순수 함수).
 *
 * 주문이 들어오면 진행 중인 주문 전체를 다시 계획한다. 하루 단위로
 *   재단 기사 → 알바(엣지, 밴더 대수만큼) → 조립 기사
 * 의 하루 가능 시간(실작업 비율 반영)에 마감이 급한 주문부터 채워 넣는다.
 * 같은 날 안에서는 앞 공정과 겹쳐 흐를 수 있다고 보지만, 뒤 공정이 앞 공정보다 먼저 끝나지는 않는다.
 * 조립 중 도어가 필요한 몫(도어 검수·달기·완성 포장)은 도어 외주가 도착한 날 이후에만 한다.
 *
 * 마감 = 설치일 하루 전 근무일 (설치일이 없으면 주문일 + defaultLeadDays 근무일).
 * 늦는 주문이 생기면 대표가 정한 순서로 해결책을 하나씩 더해 다시 계획한다:
 *   ① 조립 인원 추가 (일당) → ② 알바 연장 근무 → ③ 재단+엣지 외주 → ④ 설치일 조정 제안
 * 추천은 '제안'일 뿐이고, 대표가 승인해야 작업자에게 나간다 (호출부 몫).
 */

import { DEFAULT_CREW, DEFAULT_COSTS, DEFAULT_LEADS } from './standards.js';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_ROUNDS = 60;

// ── 날짜 (YYYY-MM-DD, UTC 기준 순수 계산) ──
function parseDay(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fmtDay(t) {
  return new Date(t).toISOString().slice(0, 10);
}
export function dayLabel(s) {
  const t = parseDay(s);
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_KO[d.getUTCDay()]})`;
}

/** start 부터 근무일(월~금, 공휴일 제외) n 개. */
export function workdays(start, n, holidays = []) {
  const off = new Set(holidays.map((h) => String(h).slice(0, 10)));
  const out = [];
  let t = parseDay(start);
  while (out.length < n) {
    const wd = new Date(t).getUTCDay();
    const s = fmtDay(t);
    if (wd !== 0 && wd !== 6 && !off.has(s)) out.push(s);
    t += 86400000;
  }
  return out;
}

/** 날짜 → 근무일 인덱스. 근무일이 아니면 그 다음 근무일, 범위 앞이면 0. */
function indexOn(days, s) {
  if (!s) return null;
  const k = String(s).slice(0, 10);
  if (k <= days[0]) return 0;
  for (let i = 0; i < days.length; i++) if (days[i] >= k) return i;
  return days.length; // 범위 밖
}

/** 날짜 → 그 날짜 이전(같은 날 포함) 마지막 근무일 인덱스. */
function indexOnOrBefore(days, s) {
  const k = String(s).slice(0, 10);
  let idx = -1;
  for (let i = 0; i < days.length; i++) if (days[i] <= k) idx = i;
  return idx;
}

// ── 한 번 계획 ──
function capacityOf(crew, fixes, nDays) {
  const sec = crew.hoursPerDay * 3600 * crew.util;
  const cut = Array(nDays).fill(crew.cutters * sec);
  const edge = Array(nDays).fill(crew.edgeMachines * sec);
  const asm = Array(nDays).fill(crew.assemblers * sec);
  for (const [i, h] of Object.entries(fixes.edgeOvertime)) edge[i] += h * 3600 * crew.util * crew.edgeMachines;
  for (const [i, n] of Object.entries(fixes.asmExtra)) asm[i] += n * sec;
  return { cut, edge, asm, sec };
}

/** load 에 amount 를 startIdx 부터 채운다. 반환: 처음 쓴 날·마지막 날 (못 채우면 finish = Infinity). */
function alloc(load, cap, amount, startIdx) {
  if (amount <= 0) return { start: startIdx, finish: startIdx };
  let left = amount;
  let first = null;
  for (let i = Math.max(0, startIdx); i < cap.length; i++) {
    const free = cap[i] - load[i];
    if (free <= 1e-6) continue;
    const take = Math.min(free, left);
    load[i] += take;
    left -= take;
    if (first === null) first = i;
    if (left <= 1e-6) return { start: first, finish: i };
  }
  return { start: first === null ? cap.length : first, finish: Infinity };
}

function planOnce(jobs, days, crew, leads, fixes) {
  const n = days.length;
  const cap = capacityOf(crew, fixes, n);
  const load = { cut: Array(n).fill(0), edge: Array(n).fill(0), asm: Array(n).fill(0) };
  const order = jobs.slice().sort((a, b) => a.dueIdx - b.dueIdx || a.releaseIdx - b.releaseIdx || String(a.id).localeCompare(String(b.id)));
  const result = {};
  for (const j of order) {
    const w = j.work;
    const outsourced = fixes.outsource.has(j.id);
    let partsStart;
    let partsFinish;
    let cut = null;
    let edge = null;
    if (outsourced) {
      partsStart = partsFinish = j.releaseIdx + leads.outsourceLeadDays;
    } else {
      cut = alloc(load.cut, cap.cut, w.cutter, j.releaseIdx);
      edge = alloc(load.edge, cap.edge, w.edge, cut.start);
      // 조립은 이 주문의 엣지가 끝나는 날부터 잡는다 (같은 날 겹침은 허용).
      // 엣지 시작일부터 잡으면 첫날에 아직 없는 부품으로 조립 시간을 채워 넣어, 첫날 인원 추가를 잘못 추천한다.
      partsFinish = Math.max(cut.finish, edge.finish);
      partsStart = partsFinish;
    }
    const main = alloc(load.asm, cap.asm, w.asmMain, partsStart);
    const mainFinish = Math.max(main.finish, partsFinish);
    const doorIdx = j.doorArrivalIdx;
    const door = alloc(load.asm, cap.asm, w.doorPart, Math.max(main.start, doorIdx));
    const finish = Math.max(door.finish, mainFinish, doorIdx);
    result[j.id] = { cut, edge, main, door, finish, late: finish > j.dueIdx, lateness: Math.max(0, finish - j.dueIdx) };
  }
  const totalLate = Object.values(result).reduce((s, r) => s + (r.finish === Infinity ? 1000 : r.lateness), 0);
  return { cap, load, result, totalLate };
}

// ── 공개 함수 ──
/**
 * @param {Object} input
 * @param {Array<{id, label, orderedAt, installDate?, doorOrderedAt?, work}>} input.jobs
 *        work = workloadFromCounts() 결과 (cutter, edge, asmMain, doorPart)
 * @param {string} input.today  계획 시작일 (YYYY-MM-DD)
 * @param {number} [input.horizonDays=30]  계획할 근무일 수
 * @param {string[]} [input.holidays]
 * @param {Object} [input.crew] [input.costs] [input.leads]  기본값 덮어쓰기
 */
export function planProduction(input) {
  const crew = { ...DEFAULT_CREW, ...(input.crew || {}) };
  const costs = { ...DEFAULT_COSTS, ...(input.costs || {}) };
  const leads = { ...DEFAULT_LEADS, ...(input.leads || {}) };
  const days = workdays(input.today, input.horizonDays || 30, input.holidays || []);
  const sec = crew.hoursPerDay * 3600 * crew.util;

  const jobs = (input.jobs || []).map((j) => {
    const releaseIdx = indexOn(days, j.orderedAt || input.today);
    let dueIdx;
    let dueSource;
    if (j.installDate) {
      // 설치일 하루 전 근무일 = 설치일보다 앞선 마지막 근무일. 계획 범위 뒤면 범위 끝 다음으로 둔다.
      const install = String(j.installDate).slice(0, 10);
      dueIdx = install > days[days.length - 1] ? days.length : indexOnOrBefore(days, install) - (days.includes(install) ? 1 : 0);
      dueSource = 'install';
    } else {
      dueIdx = releaseIdx + leads.defaultLeadDays - 1;
      dueSource = 'default';
    }
    const doorBase = j.doorOrderedAt ? indexOn(days, j.doorOrderedAt) : releaseIdx;
    const doorArrivalIdx = doorBase + leads.doorLeadDays;
    return { ...j, releaseIdx, dueIdx, dueSource, doorArrivalIdx };
  });

  const fixes = { asmExtra: {}, edgeOvertime: {}, outsource: new Set(), reschedule: {} };
  const base = planOnce(jobs, days, crew, leads, fixes);
  let cur = base;
  const steps = [];

  for (let round = 0; round < MAX_ROUNDS && cur.totalLate > 0; round++) {
    // 가장 급한 늦은 주문
    const lateJob = jobs
      .filter((j) => cur.result[j.id].late && !fixes.reschedule[j.id])
      .sort((a, b) => a.dueIdx - b.dueIdx)[0];
    if (!lateJob) break;
    const lo = Math.max(0, lateJob.releaseIdx);
    const hi = Math.min(days.length - 1, Math.max(lo, lateJob.dueIdx));
    const tryFix = (mutate, undo) => {
      mutate();
      const next = planOnce(jobs, days, crew, leads, fixes);
      if (next.totalLate < cur.totalLate) { cur = next; return true; }
      undo();
      return false;
    };
    let done = false;

    // ① 조립 인원 추가: 창 안에서 조립이 꽉 찬 날 중 가장 이른 날
    for (let i = lo; i <= hi && !done; i++) {
      const full = cur.load.asm[i] >= cur.cap.asm[i] - 1;
      const extra = fixes.asmExtra[i] || 0;
      if (full && extra < crew.assemblersMaxExtra) {
        done = tryFix(() => { fixes.asmExtra[i] = extra + 1; }, () => { if (extra) fixes.asmExtra[i] = extra; else delete fixes.asmExtra[i]; });
        if (done) steps.push({ kind: 'asm_extra', dayIdx: i, jobId: lateJob.id });
      }
    }
    // ② 알바 연장 근무
    for (let i = lo; i <= hi && !done; i++) {
      const full = cur.load.edge[i] >= cur.cap.edge[i] - 1;
      const ot = fixes.edgeOvertime[i] || 0;
      if (full && ot < crew.edgeMaxOvertimeHours) {
        done = tryFix(() => { fixes.edgeOvertime[i] = crew.edgeMaxOvertimeHours; }, () => { if (ot) fixes.edgeOvertime[i] = ot; else delete fixes.edgeOvertime[i]; });
        if (done) steps.push({ kind: 'edge_overtime', dayIdx: i, jobId: lateJob.id });
      }
    }
    // ③ 재단+엣지 외주: 창 안에서 엣지가 가장 많은, 아직 외주 안 한 주문
    if (!done) {
      const cands = jobs
        .filter((j) => !fixes.outsource.has(j.id) && j.work.edge > 0 && j.releaseIdx + leads.outsourceLeadDays <= j.dueIdx && j.dueIdx <= hi)
        .sort((a, b) => b.work.edge - a.work.edge);
      for (const j of cands) {
        done = tryFix(() => fixes.outsource.add(j.id), () => fixes.outsource.delete(j.id));
        if (done) { steps.push({ kind: 'outsource', jobId: j.id }); break; }
      }
    }
    // ④ 더 손쓸 게 없으면 설치일 조정 제안
    if (!done) {
      fixes.reschedule[lateJob.id] = cur.result[lateJob.id].finish;
      steps.push({ kind: 'reschedule', jobId: lateJob.id });
    }
  }

  return summarize({ jobs, days, crew, costs, leads, base, cur, fixes, sec });
}

function hoursText(s) {
  const h = s / 3600;
  return h >= 1 ? `${h.toFixed(1)}시간` : `${Math.round(s / 60)}분`;
}

function summarize({ jobs, days, crew, costs, leads, base, cur, fixes, sec }) {
  const dayRows = days.map((d, i) => ({
    date: d,
    label: dayLabel(d),
    cut: { load: cur.load.cut[i], cap: cur.cap.cut[i] },
    edge: { load: cur.load.edge[i], cap: cur.cap.edge[i], overtimeHours: fixes.edgeOvertime[i] || 0 },
    asm: { load: cur.load.asm[i], cap: cur.cap.asm[i], people: cur.load.asm[i] > 0 ? Math.max(1, Math.ceil(cur.load.asm[i] / sec - 1e-9)) : 0, extra: fixes.asmExtra[i] || 0 },
  }));
  const at = (idx) => (idx === Infinity || idx >= days.length ? null : days[idx]);
  const jobRows = jobs.map((j) => {
    const r = cur.result[j.id];
    const doorOrderByIdx = j.dueIdx - leads.doorLeadDays;
    return {
      id: j.id,
      label: j.label,
      due: at(j.dueIdx),
      dueSource: j.dueSource,
      finish: at(r.finish),
      late: r.late,
      outsourced: fixes.outsource.has(j.id),
      doorArrival: at(j.doorArrivalIdx),
      doorOrderBy: doorOrderByIdx >= 0 ? days[doorOrderByIdx] : null,
      doorOrderLate: j.doorArrivalIdx > j.dueIdx,
      doorOrdered: Boolean(j.doorOrdered),
      rescheduleTo: fixes.reschedule[j.id] !== undefined ? at(Math.min(days.length - 1, fixes.reschedule[j.id] + 1)) : null,
      work: { cutter: j.work.cutter, edge: j.work.edge, asm: j.work.asmMain + j.work.doorPart },
      // 공정별 계획 기간 [시작일, 끝일] — 작업자 화면이 "오늘 내 공정에 걸린 주문" 을 고를 때 쓴다
      stages: {
        cutter: r.cut ? [at(r.cut.start), at(r.cut.finish)] : null,
        edge: r.edge && j.work.edge > 0 ? [at(r.edge.start), at(r.edge.finish)] : null,
        asm: [at(Math.min(r.main.start, r.door.start)), at(r.finish)],
      },
      counts: j.work.counts || null,
    };
  });

  const suggestions = [];
  // 조립 기사 출근 (일당) — 일이 있는 날
  const asmDays = dayRows.filter((d) => d.asm.load > 0);
  if (asmDays.length) {
    suggestions.push({
      type: 'asm_call', role: 'asm', dates: asmDays.map((d) => d.date),
      cost: asmDays.length * crew.assemblers * costs.assemblerDay,
      text: `조립 기사 출근 ${asmDays.length}일: ${asmDays.map((d) => d.label).join(', ')}`,
    });
  }
  for (const d of dayRows) {
    if (d.asm.extra > 0) {
      const over = Math.max(0, d.asm.load - crew.assemblers * sec);
      suggestions.push({
        type: 'asm_extra', role: 'asm', date: d.date, people: d.asm.extra,
        cost: d.asm.extra * costs.assemblerDay,
        text: `${d.label} 조립 인원 ${d.asm.extra}명 추가 — 조립 ${hoursText(over)} 초과 (일당 ${(costs.assemblerDay / 10000).toFixed(0)}만)`,
      });
    }
    if (d.edge.overtimeHours > 0) {
      suggestions.push({
        type: 'edge_overtime', role: 'edge', date: d.date, hours: d.edge.overtimeHours,
        cost: d.edge.overtimeHours * costs.partTimeHourly * crew.edgeMachines,
        text: `${d.label} 알바(엣지) ${d.edge.overtimeHours}시간 연장`,
      });
    }
  }
  for (const j of jobRows) {
    const src = jobs.find((x) => x.id === j.id);
    if (j.outsourced) {
      suggestions.push({
        type: 'edge_outsource', role: 'edge', jobId: j.id, sheets: src.work.counts ? src.work.counts.sheetsPB : null,
        cost: (src.work.counts ? src.work.counts.sheetsPB : 0) * costs.outsourceCutEdgePerSheet,
        text: `${j.label}: 재단+엣지 외주 (일성합판, PB ${src.work.counts ? src.work.counts.sheetsPB : '?'}장, 납기 ${leads.outsourceLeadDays}일)`,
      });
    }
    if (j.rescheduleTo) {
      suggestions.push({ type: 'reschedule', jobId: j.id, to: j.rescheduleTo, cost: 0, text: `${j.label}: 공장 완료가 ${j.finish ? dayLabel(j.finish) : '계획 범위 밖'} — 설치일을 ${dayLabel(j.rescheduleTo)} 이후로 조정 필요` });
    }
    if (j.doorOrderBy && !j.doorOrdered) {
      suggestions.push({ type: 'door_order', jobId: j.id, date: j.doorOrderBy, cost: 0, text: `${j.label}: 도어 외주 발주 ${dayLabel(j.doorOrderBy)}까지${j.doorOrderLate ? ' (이미 늦음 — 도어 도착 ' + (j.doorArrival ? dayLabel(j.doorArrival) : '?') + ')' : ''}` });
    }
  }
  const extraCost = suggestions.filter((s) => s.type !== 'asm_call').reduce((a, s) => a + s.cost, 0);
  return {
    days: dayRows,
    jobs: jobRows,
    suggestions,
    summary: {
      jobs: jobs.length,
      lateBefore: Object.values(base.result).filter((r) => r.late).length,
      lateAfter: jobRows.filter((j) => j.late && !j.rescheduleTo).length,
      needsReschedule: jobRows.filter((j) => j.rescheduleTo).length,
      asmCallDays: asmDays.length,
      extraCost,
    },
  };
}
