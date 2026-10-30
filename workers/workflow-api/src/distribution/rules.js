/**
 * 상담 분배 — 거르기 · 점수 상수와 규칙 (이 파일 한 곳).
 *
 * 다담 본사가 받은 상담을 업체 풀(활동 중인 Agent 협력업체 + 다담 공장)에 나눌 때 쓰는 값.
 * 계산 순서 · 자료 읽기는 score.js · data.js — 숫자와 규칙은 여기만 고친다.
 *
 * ★ 대표 확인 (2026-10-30, 추천값 그대로) — 아래 넷. 바꿀 때는 이 파일만 고친다.
 *   ① 위치          같은 시/군/구 15 · 같은 시/도 10 · 그 밖 5            (locationScore)
 *                   이웃 시/군/구 표가 없어(segan/regions.js 에 없다) 처음엔 같은 시/도를 이웃으로 본다.
 *                   이웃 표가 생기면 locationScore 만 바꾼다.
 *   ② 고객 가격대    상담의 wanted_price_tier. 모름 · 빈 값이면 모든 업체 3  (customerPriceTier · PRICE_UNKNOWN)
 *   ③ 희망 시기      업체 다음 가능 날짜가 희망 날짜 안 6 · 7일 안 늦음 3 · 그 밖 0, 희망 날짜 없으면 모두 6 (timingScore)
 *   ④ 한도 없음      한 달 한도(monthly_limit)를 정하지 않은 업체는 거른다 — 상담 설정을 마쳐야 배정받는다
 *                   (REQUIRE_MONTHLY_LIMIT)
 *   ⑤ 거친 업체      같은 상담을 못 받음 · 무응답으로 돌려보낸 업체는 그 상담 후보에서 뺀다 (TRIED_STATES)
 *
 * ☆ 정하지 않음 — 약속서에 값이 없어 임시로 둔 것. 역시 여기만 고친다.
 *   NO_GRADE_POINTS · RESPONSE_WINDOW_DAYS · NEXT_AVAILABLE_UNSET(timingScore) · FEEDBACK_SCORE_MAX 환산
 */

/** 이 규칙 묶음의 판 — 배정 기록(consult_assignments.score)에 같이 남겨 나중에 기준을 견준다 */
export const RULES_VERSION = '2026-10-30';

/** 순위에 올리는 업체 수 (1~3순위) */
export const TOP_N = 3;

/** 배정 뒤 업체가 답할 시간 — 지나면 무응답(expired)으로 돌려보낸다 */
export const ASSIGNMENT_TTL_HOURS = 24;

// ── 거르기 ────────────────────────────────────────────────────

/** 걸러진 이유 이름 (화면 계약) */
export const FILTER_REASONS = Object.freeze([
  'region',
  'item',
  'limit',
  'docs',
  'tier',
  'inactive',
  'tried',
]);

/** 품목 거르기 — 업체 「하는 품목」 값 중 통과하는 것 (함 · 외주). 「안 함(no)」 · 빈 값은 탈락 */
export const ITEM_PASS = Object.freeze(['do', 'outsource']);

/** 서류 거르기 — 본사가 확인한(checked_at 이 있는) 서류 둘 다 있어야 한다: 배상 책임 보험 · 표준 계약서 */
export const REQUIRED_DOCS = Object.freeze(['insurance', 'contract']);

/** ★④ 한 달 한도를 정하지 않은 업체는 거른다 (대표 확인 2026-10-30) */
export const REQUIRE_MONTHLY_LIMIT = true;

/** ★⑤ 같은 상담에서 이 배정 상태였던 업체는 거른다 — 못 받음 · 무응답 (대표 확인 2026-10-30) */
export const TRIED_STATES = Object.freeze(['declined', 'expired']);

// ── 점수 1) 본사 평가 40 ───────────────────────────────────────

/** 등급 점수 */
export const GRADE_POINTS = Object.freeze({ S: 16, A: 13, B: 10, C: 4 });
/** ☆ 등급을 아직 매기지 않은 업체 (정하지 않음 — 임시 0) */
export const NO_GRADE_POINTS = 0;

/** 고객 만족 만점 — 설치 후 문항 평균(0~5) ÷ 5 × 12 */
export const SATISFACTION_MAX = 12;
/**
 * ☆ 설치 후 문항(install_feedback.score)은 0~10 으로 받는다 (src/feedback.js).
 * 약속서의 0~5 로 바꿔 쓴다: 평균 ÷ 10 × 5 (정하지 않음 — 받는 칸이 0~5 로 바뀌면 5 로)
 */
export const FEEDBACK_SCORE_MAX = 10;
/** 만족을 0~5 로 보여 줄 때의 만점 */
export const SATISFACTION_SCALE = 5;

/** 재작업 만점 — 최근 90일 수주 중 재작업이 없는 비율 × 6 */
export const REWORK_MAX = 6;
export const REWORK_WINDOW_DAYS = 90;

/** 응답 만점 — 최근 배정 중 24시간 안에 받은 비율 × 6 */
export const RESPONSE_MAX = 6;
export const RESPONSE_WITHIN_HOURS = 24;
/** ☆ 「최근 배정」 기간 (정하지 않음 — 재작업과 같은 90일로 둠) */
export const RESPONSE_WINDOW_DAYS = 90;

/** 만족 · 재작업 · 응답은 자료가 없으면 만점의 절반 */
export const NO_DATA_SHARE = 0.5;

// ── 점수 2) 선택 적합도 35 ─────────────────────────────────────

/** 품목 실적 — 그 품목 완료 수주 수 → 점수 (위에서부터 처음 맞는 줄) */
export const ITEM_RECORD_STEPS = Object.freeze([
  Object.freeze({ min: 5, points: 12 }),
  Object.freeze({ min: 1, points: 6 }),
  Object.freeze({ min: 0, points: 3 }),
]);

/** 도어 마감 — 고객이 고른 마감을 업체가 취급 6 · 안 함 0 · 고객 「모름」이면 모두 3 */
export const FINISH_MAX = 6;
export const FINISH_UNKNOWN = 3;

/** 가격대 — 같음 6 · 한 칸 차이 2 · 그 밖 0 */
export const PRICE_TIERS = Object.freeze(['basic', 'mid', 'high']);
export const PRICE_SAME = 6;
export const PRICE_ONE_STEP = 2;
/** ★② 고객 가격대를 모르면 모든 업체 3 (대표 확인 2026-10-30) */
export const PRICE_UNKNOWN = 3;

/** ★③ 희망 시기 (대표 확인 2026-10-30) */
export const TIMING_ON_TIME = 6;
export const TIMING_LATE = 3;
export const TIMING_LATE_DAYS = 7;
export const TIMING_NO_DATE = 6;

/** 상세 설계 — 요청이 있으면 설계 인원 1명 이상 + 플래너 사용 5 · 아니면 0. 요청 없으면 모두 5 */
export const DESIGN_MAX = 5;
export const DESIGN_MIN_STAFF = 1;

// ── 점수 3) 위치 15 ───────────────────────────────────────────

/** ★① 위치 (대표 확인 2026-10-30) */
export const LOCATION_SAME_GUGUN = 15;
export const LOCATION_SAME_SIDO = 10;
export const LOCATION_OTHER = 5;

// ── 점수 4) 기타 10 ───────────────────────────────────────────

/** 일감 고르게 — 최근 30일 배정 수 0 → 5, 많을수록 깎여 그 수가 가장 많은 업체 0 */
export const SPREAD_MAX = 5;
export const SPREAD_WINDOW_DAYS = 30;
/** 처리 여유 — 진행 중 수주 ÷ 한 달 한도 0 → 5, 1 이상 → 0 */
export const CAPACITY_MAX = 5;

// ── 대표 확인 규칙 (함수) ──────────────────────────────────

const DAY_MS = 86400000;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * ★① 위치 — 업체 주소(companies.sido · gugun)와 고객 지역.
 * @returns {{ sum: number, why: 'same_gugun' | 'same_sido' | 'other' }}
 */
export function locationScore(consult, company) {
  const sido = consult && consult.sido;
  if (sido && company && company.sido === sido) {
    if (consult.gugun && company.gugun === consult.gugun)
      return { sum: LOCATION_SAME_GUGUN, why: 'same_gugun' };
    // 이웃 시/군/구 표가 없어 같은 시/도를 이웃으로 본다
    return { sum: LOCATION_SAME_SIDO, why: 'same_sido' };
  }
  return { sum: LOCATION_OTHER, why: 'other' };
}

/** ★② 고객 가격대 — basic | mid | high, 모름(unknown) · 빈 값이면 null */
export function customerPriceTier(consult) {
  const t = consult && consult.wanted_price_tier;
  return PRICE_TIERS.includes(t) ? t : null;
}

/**
 * ★③ 희망 시기.
 *   preferredDate      고객 희망 날짜 'YYYY-MM-DD' (없으면 모두 TIMING_NO_DATE)
 *   nextAvailableDate  업체 다음 가능 날짜 'YYYY-MM-DD'
 *   today              오늘(KST) 'YYYY-MM-DD'
 * ☆ 업체가 다음 가능 날짜를 비워 두면 오늘부터 된다고 본다 (정하지 않음).
 */
export function timingScore(preferredDate, nextAvailableDate, today) {
  if (!isDate(preferredDate)) return TIMING_NO_DATE;
  const ready = isDate(nextAvailableDate) ? nextAvailableDate : today;
  if (!isDate(ready)) return TIMING_NO_DATE;
  const late = Math.round(
    (Date.parse(`${ready}T00:00:00Z`) - Date.parse(`${preferredDate}T00:00:00Z`)) / DAY_MS
  );
  if (late <= 0) return TIMING_ON_TIME;
  if (late <= TIMING_LATE_DAYS) return TIMING_LATE;
  return 0;
}
