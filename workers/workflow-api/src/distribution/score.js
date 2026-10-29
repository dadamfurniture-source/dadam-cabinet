/**
 * 상담 분배 — 거르기 · 점수 · 순위 (순수 함수, DB 를 읽지 않는다).
 *
 * 숫자 · 대표 확인 대기 규칙은 rules.js, 자료 읽기는 data.js.
 *
 * 거르기 (모두 통과해야 순위에 오른다)
 *   tier · inactive  업체 풀 — 다담 공장, 또는 활동 중(status active)인 Agent 협력업체. Expert 는 tier.
 *                    풀 밖 업체는 이 이유만 싣는다 (다른 거르기는 풀 안 업체의 것).
 *   region           고객 시/도 + 시/군/구가 업체 「상담 받는 지역」에 있음 (지역을 비워 두면 업체 주소의 시/군/구 하나)
 *   item             고객 품목이 모두 업체 「하는 품목」에서 함 · 외주
 *   limit            이번 달(KST) 배정 수 < 업체 한 달 한도 (한도가 없으면 rules.js REQUIRE_MONTHLY_LIMIT)
 *   docs             배상 책임 보험 · 표준 계약서 둘 다 본사 확인
 *
 * 점수 (100) — 항목마다 소수 한 자리, 총점은 반올림 정수
 *   eval 40     등급 + 고객 만족 + 재작업 + 응답
 *   fit 35      품목 실적 + 도어 마감 + 가격대 + 희망 시기 + 상세 설계
 *   location 15 업체 주소와 고객 지역
 *   other 10    일감 고르게(최근 30일 배정 수) + 처리 여유(진행 중 수주 ÷ 한 달 한도)
 * 순위: 총점 높은 순, 같으면 마지막 배정이 오래된 업체(배정이 없던 업체가 맨 앞), 그래도 같으면 이름 순.
 */

import * as R from './rules.js';
import {
  APP_KIND_TO_ITEM,
  ITEM_KEYS,
  DOOR_FINISH_UNKNOWN,
  docsOk,
  doorFinishKey,
} from './catalog.js';

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;
const r1 = (v) => Math.round(v * 10) / 10;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 오늘(KST) 'YYYY-MM-DD' */
export function kstToday(nowMs) {
  return new Date(nowMs + KST_MS).toISOString().slice(0, 10);
}

/** 이번 달(KST) 1일 0시의 UTC ms */
export function kstMonthStartMs(nowMs) {
  const d = new Date(nowMs + KST_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - KST_MS;
}

/**
 * 고객 품목 키 — 상담의 furniture_categories(목록 안 값만). 비었으면 앱 연출컷 품목(generationCategory)이 품목 키와
 * 같은 이름일 때 그 키 (catalog.js APP_KIND_TO_ITEM). 둘 다 없으면 빈 배열.
 */
export function customerItems(consult, generationCategory = null) {
  const out = [];
  for (const k of Array.isArray(consult && consult.furniture_categories)
    ? consult.furniture_categories
    : []) {
    if (ITEM_KEYS.includes(k) && !out.includes(k)) out.push(k);
  }
  if (out.length) return out;
  const fromApp =
    generationCategory && Object.prototype.hasOwnProperty.call(APP_KIND_TO_ITEM, generationCategory)
      ? APP_KIND_TO_ITEM[generationCategory]
      : null;
  return fromApp ? [fromApp] : [];
}

/** 업체 풀 밖이면 그 이유 — 다담 공장(hq)은 언제나 풀 안 */
export function poolReasons(company) {
  if (!company || company.kind === 'hq') return [];
  const reasons = [];
  if (company.kind !== 'partner' || company.plan !== 'agent') reasons.push('tier');
  if (company.status !== 'active') reasons.push('inactive');
  return reasons;
}

export const isPoolCompany = (company) =>
  Boolean(company) &&
  (company.kind === 'hq' || company.kind === 'partner') &&
  poolReasons(company).length === 0;

/** 상담 받는 지역 — 설정한 지역, 비었으면 업체 주소의 시/군/구 하나 */
export function serviceRegions(settings, company) {
  const regions = settings && Array.isArray(settings.regions) ? settings.regions.filter(isObj) : [];
  if (regions.length) return regions;
  return company && company.sido && company.gugun
    ? [{ sido: company.sido, gugun: company.gugun }]
    : [];
}

function regionOk(consult, settings, company) {
  if (!consult || !consult.sido || !consult.gugun) return false;
  return serviceRegions(settings, company).some(
    (r) => r.sido === consult.sido && r.gugun === consult.gugun
  );
}

function itemOk(items, settings) {
  const offered = settings && isObj(settings.items) ? settings.items : {};
  return items.every((k) => R.ITEM_PASS.includes(offered[k]));
}

function limitOk(settings, monthCount) {
  const limit = settings ? settings.monthly_limit : null;
  if (limit === null || limit === undefined) return !R.REQUIRE_MONTHLY_LIMIT;
  return monthCount < limit;
}

/**
 * 거른 이유 (빈 배열이면 통과).
 * @param {object} p  { consult, items, company, settings, evaluation, stats }
 */
export function filterReasons({ consult, items, company, settings, evaluation, stats }) {
  const pool = poolReasons(company);
  if (pool.length) return pool;
  const reasons = [];
  if (!regionOk(consult, settings, company)) reasons.push('region');
  if (!itemOk(items, settings)) reasons.push('item');
  if (!limitOk(settings, (stats && stats.monthCount) || 0)) reasons.push('limit');
  if (!docsOk(evaluation)) reasons.push('docs');
  return reasons;
}

// ── 점수 ──────────────────────────────────────────────────────

const half = (max) => max * R.NO_DATA_SHARE;

/** 설치 후 문항 평균(0~FEEDBACK_SCORE_MAX) → 0~5. 답이 없으면 null */
export function satisfactionOf(stats) {
  if (!stats || !stats.feedbackCount) return null;
  return (stats.feedbackSum / stats.feedbackCount / R.FEEDBACK_SCORE_MAX) * R.SATISFACTION_SCALE;
}

/** 최근 배정 중 24시간 안에 받은 비율 (0~1). 끝난 배정이 없으면 null */
export function responseRateOf(stats) {
  if (!stats || !stats.respondedCount) return null;
  return stats.fastAcceptCount / stats.respondedCount;
}

/** 본사 평가 40 */
export function evalScore(evaluation, stats) {
  const grade =
    evaluation && Object.prototype.hasOwnProperty.call(R.GRADE_POINTS, evaluation.grade)
      ? R.GRADE_POINTS[evaluation.grade]
      : R.NO_GRADE_POINTS;
  const sat = satisfactionOf(stats);
  const satisfaction =
    sat === null ? half(R.SATISFACTION_MAX) : (sat / R.SATISFACTION_SCALE) * R.SATISFACTION_MAX;
  const rework =
    stats && stats.recentOrderCount
      ? (stats.cleanOrderCount / stats.recentOrderCount) * R.REWORK_MAX
      : half(R.REWORK_MAX);
  const rate = responseRateOf(stats);
  const response = rate === null ? half(R.RESPONSE_MAX) : rate * R.RESPONSE_MAX;
  const sum = grade + satisfaction + rework + response;
  return {
    grade: r1(grade),
    satisfaction: r1(satisfaction),
    rework: r1(rework),
    response: r1(response),
    sum: r1(sum),
    raw: sum,
  };
}

/** 고객 품목이 하나라도 든 완료 수주 수 */
export function itemRecordCount(items, stats) {
  const done = (stats && stats.completedItems) || [];
  if (!items.length) return 0;
  return done.filter((set) => items.some((k) => set.has(k))).length;
}

export function itemRecordPoints(count) {
  for (const step of R.ITEM_RECORD_STEPS) if (count >= step.min) return step.points;
  return 0;
}

export function finishPoints(consult, evaluation) {
  const f = consult && consult.door_finish;
  if (!f || f === DOOR_FINISH_UNKNOWN) return R.FINISH_UNKNOWN;
  const finishes = evaluation && isObj(evaluation.finishes) ? evaluation.finishes : {};
  return finishes[doorFinishKey(f)] === 'yes' ? R.FINISH_MAX : 0;
}

export function pricePoints(consult, evaluation) {
  const want = R.customerPriceTier(consult);
  if (want === null) return R.PRICE_UNKNOWN;
  const have = evaluation ? evaluation.price_tier : null;
  if (!R.PRICE_TIERS.includes(have)) return 0;
  const gap = Math.abs(R.PRICE_TIERS.indexOf(want) - R.PRICE_TIERS.indexOf(have));
  if (gap === 0) return R.PRICE_SAME;
  if (gap === 1) return R.PRICE_ONE_STEP;
  return 0;
}

export function designPoints(consult, evaluation) {
  if (!(consult && consult.request_detail_design === true)) return R.DESIGN_MAX;
  const staff = evaluation && isObj(evaluation.staff) ? evaluation.staff : {};
  const design = evaluation && isObj(evaluation.design) ? evaluation.design : {};
  return Number(staff.design) >= R.DESIGN_MIN_STAFF && design.planner === true ? R.DESIGN_MAX : 0;
}

/** 선택 적합도 35 */
export function fitScore({ consult, items, settings, evaluation, stats, today }) {
  const item = itemRecordPoints(itemRecordCount(items, stats));
  const finish = finishPoints(consult, evaluation);
  const price = pricePoints(consult, evaluation);
  const timing = R.timingScore(
    consult && consult.preferred_date,
    settings ? settings.next_available_date : null,
    today
  );
  const design = designPoints(consult, evaluation);
  const sum = item + finish + price + timing + design;
  return { item, finish, price, timing, design, sum, raw: sum };
}

/** 기타 10 — maxRecent: 순위 대상 업체 중 최근 30일 배정 수가 가장 많은 수 */
export function otherScore({ settings, stats, maxRecent }) {
  const n = (stats && stats.recentCount) || 0;
  const spread = maxRecent > 0 ? R.SPREAD_MAX * (1 - n / maxRecent) : R.SPREAD_MAX;
  const limit = settings ? settings.monthly_limit : null;
  // 한도가 없으면 여유를 잴 수 없다 (REQUIRE_MONTHLY_LIMIT 이 켜져 있으면 여기 오지 않는다)
  const capacity =
    limit > 0
      ? R.CAPACITY_MAX * Math.max(0, 1 - ((stats && stats.inProgressCount) || 0) / limit)
      : 0;
  const sum = spread + capacity;
  return { spread: r1(spread), capacity: r1(capacity), sum: r1(sum), raw: sum };
}

/** 한 업체 점수 — { total, score } (score 는 화면 · 배정 기록 모양) */
export function scoreCompany({
  consult,
  items,
  company,
  settings,
  evaluation,
  stats,
  maxRecent,
  today,
}) {
  const ev = evalScore(evaluation, stats);
  const fit = fitScore({ consult, items, settings, evaluation, stats, today });
  const loc = R.locationScore(consult, company);
  const other = otherScore({ settings, stats, maxRecent });
  const total = Math.round(ev.raw + fit.raw + loc.sum + other.raw);
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'raw'));
  return {
    total: Math.max(0, Math.min(100, total)),
    score: {
      eval: strip(ev),
      fit: strip(fit),
      location: { sum: loc.sum, why: loc.why },
      other: strip(other),
    },
  };
}

/**
 * 거르기 + 점수 + 순위.
 * @param {object} p
 *   consult, items       상담 · 고객 품목 키 (customerItems)
 *   companies            본사(platform)를 뺀 업체 행 { id, kind, name, plan, status, sido, gugun }
 *   settingsBy · evaluationBy · statsBy  Map company_id → 행 / 통계 (data.js)
 *   nowMs
 * @returns {{ ranked: object[], filtered: object[] }}
 *   ranked   순위 대상 전부 (rank 1 부터) — { company, total, rank, score, last_assigned_at }
 *   filtered 걸러진 업체 — { company_id, company_name, reasons }
 */
export function rankCandidates({
  consult,
  items,
  companies,
  settingsBy,
  evaluationBy,
  statsBy,
  nowMs,
}) {
  const today = kstToday(nowMs);
  const eligible = [];
  const filtered = [];
  for (const company of companies || []) {
    const settings = settingsBy.get(company.id) || null;
    const evaluation = evaluationBy.get(company.id) || null;
    const stats = statsBy.get(company.id) || null;
    const reasons = filterReasons({ consult, items, company, settings, evaluation, stats });
    if (reasons.length)
      filtered.push({ company_id: company.id, company_name: company.name, reasons });
    else eligible.push({ company, settings, evaluation, stats });
  }
  const maxRecent = eligible.reduce(
    (m, e) => Math.max(m, (e.stats && e.stats.recentCount) || 0),
    0
  );
  const scored = eligible.map((e) => ({
    company: e.company,
    last_assigned_at: (e.stats && e.stats.lastAssignedAt) || null,
    ...scoreCompany({ consult, items, ...e, maxRecent, today }),
  }));
  scored.sort(compareCandidates);
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });
  filtered.sort((a, b) => String(a.company_name).localeCompare(String(b.company_name), 'ko'));
  return { ranked: scored, filtered };
}

/** 총점 높은 순 → 마지막 배정이 오래된 순(없으면 맨 앞) → 이름 → id */
export function compareCandidates(a, b) {
  if (a.total !== b.total) return b.total - a.total;
  const ta = a.last_assigned_at ? Date.parse(a.last_assigned_at) : -Infinity;
  const tb = b.last_assigned_at ? Date.parse(b.last_assigned_at) : -Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const byName = String(a.company.name).localeCompare(String(b.company.name), 'ko');
  if (byName) return byName;
  return String(a.company.id) < String(b.company.id) ? -1 : 1;
}

/** 화면 한 줄 — GET /admin/consultations/:id/candidates items[] */
export function candidateView(c) {
  return {
    company_id: c.company.id,
    company_name: c.company.name,
    kind: c.company.kind,
    total: c.total,
    rank: c.rank,
    score: c.score,
  };
}

export { DAY_MS };
