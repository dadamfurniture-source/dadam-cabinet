/**
 * 생산 표준시간 · 인력 · 단가 기본값.
 *
 * 2026-10-13 대표 확정값 (재단·엣지·조립 평균, 서랍 = 통 1개, 도어 1분, 포장 5분/통)과
 * 소규모 공장 추정값을 섞었다. 운영 중 실측으로 바꿀 수 있게 전부 한 객체에 모은다 —
 * planner 는 이 값을 인자로 받기만 하고 상수를 직접 읽지 않는다.
 *
 * 단위: 시간은 초, 금액은 원(부가세 별도).
 */

export const DEFAULT_STANDARDS = Object.freeze({
  /** 재단 기사 — 원판 1장(몸통 PB·뒷판, 밴드·처짐방지목 포함, 자기 검수 포함) */
  cutPerSheet: 420,
  /** 재단 기사 — 현장마다 작업지시 확인·자재 피킹 */
  cutPerJob: 1200,
  /** 알바 — 엣지밴딩, PB 1장 (뒷판은 엣지 없음) */
  edgePerPbSheet: 900,
  /** 조립 기사 — 통 1개 */
  asmPerBox: 720,
  /** 조립 기사 — 서랍 1개 (통 1개와 같게) */
  asmPerDrawer: 720,
  /** 조립 기사 — 도어 1짝 입고 검수 + 달기 */
  asmPerDoor: 45 + 60,
  asmPerShelf: 25,
  asmPerLeg: 40,
  asmPerRod: 180,
  /** 조립 기사 — 완성 검수·포장, 통 1개 */
  packPerBox: 300,
});

export const DEFAULT_CREW = Object.freeze({
  /** 하루 근무시간 */
  hoursPerDay: 8,
  /** 쉬는 시간·준비 시간을 뺀 실작업 비율 */
  util: 0.85,
  /** 재단 기사 상시 인원 */
  cutters: 1,
  /** 엣지밴더 대수 — 알바가 2명이어도 엣지는 기계 대수만큼만 동시에 된다 */
  edgeMachines: 1,
  /** 알바 하루 연장 근무 최대 시간 */
  edgeMaxOvertimeHours: 2,
  /** 조립 기사 기본 인원 (일당 — 일이 있는 날만 부른다) */
  assemblers: 1,
  /** 하루 추가로 부를 수 있는 조립 인원 최대 */
  assemblersMaxExtra: 1,
});

export const DEFAULT_COSTS = Object.freeze({
  assemblerDay: 200000,
  partTimeHourly: 12000,
  /** 일성합판 재단+엣지 외주, PB 1장 (거래명세서 실적 10,000~13,000) */
  outsourceCutEdgePerSheet: 13000,
});

export const DEFAULT_LEADS = Object.freeze({
  /** 도어 외주(상일) 최소 납기, 근무일 */
  doorLeadDays: 3,
  /** 재단+엣지 외주 납기, 근무일 */
  outsourceLeadDays: 2,
  /** 설치일이 없을 때 주문일부터 공장 완료까지 잡는 근무일 */
  defaultLeadDays: 7,
});

/**
 * 장당 견적 원가 기준 (원, 부가세 별도). 2026-10-13 대표 확정값 + 거래명세서 실적.
 * 고객 견적 = BOM 수량으로 계산한 실제 원가 × (1 + marginRate).
 */
export const DEFAULT_QUOTE = Object.freeze({
  pbSheet: 32000, // 몸통 PB 15T
  backSheet: 19500, // 뒷판 MDF 2.7T PVC
  edgeRoll: 16500, // 0.6T PVC 엣지 1롤
  edgeRollMeters: 200,
  doorSheet: 100000, // 도어 외주 원장 1장 (실적 평균 91,654)
  hinge: 460,
  rail: 8600,
  leg: 600,
  shelfPin: 20,
  rod: 1700,
  fastenerPerBox: 1800, // 미니픽스·피스
  cutterMonthly: 3500000, // 재단 기사 월급 (4대보험 포함)
  workDays: 22,
  overheadPerHour: 33000, // 간접비 380만 ÷ 월 20건 기준 공장 작업 약 115시간
  installPerMeter: 40000, // 시공 외주, 시공 길이 m당
  marginRate: 0.2,
});
