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
  /** 엣지 — 부재 1면 (대표 2026-10-18: 1면에 최대 10~20초 → 20초). 뒷판은 엣지 없음 */
  edgePerFace: 20,
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

/** 외주 업체 기본값 — Step 4 [발주 처리] 에서 비워 두면 이 이름 (work-reports-archive.plan.md §2.1) */
export const DEFAULT_VENDORS = Object.freeze({
  door: '상일',
  cutEdge: '일성합판',
  // 상판은 재질마다 업체가 다르다 (2026-10-18 사장님 Q7) — 이름은 설정에서 넣는다. 비면 요청서에 [확인 필요]
  topMarble: '',
  topStone: '',
  topCeramic: '',
});

/**
 * 상판 발주 요청서 기본값 (2026-10-18 사장님 — 조사해 정하고 바꿀 수 있게).
 * 업계 공식 표준치는 없다 — 국내 시공에서 흔한 값: 뒷턱(백가드) 50 · 앞턱(등뜨기) 40 (12T 를 앞에서 40 으로 보이게, 50T 는 해당 없음).
 * 있음/없음은 1/0. 품목 사양(topBacksplash · topFrontLip · topDrip, 'on'/'off')이 덮어쓴다.
 */
export const DEFAULT_COUNTERTOP = Object.freeze({
  backsplash: 1,
  backsplashH: 50,
  frontLip: 1,
  frontLipH: 40,
  drip: 1,
});

export const DEFAULT_LEADS = Object.freeze({
  /** 도어 외주(상일) 최소 납기, 근무일 */
  doorLeadDays: 3,
  /** 재단+엣지 외주 납기, 근무일 */
  outsourceLeadDays: 2,
  /** 상판 주문 마감 — 설치일 몇 근무일 전까지 (2026-10-18 사장님: 최소 4일 전, 근무일 기준) */
  topLeadDays: 4,
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
  // 간접비(월세·전기·차량·광고 등)는 매출 전체에서 충당하고 품목 원가에는 넣지 않는다 (2026-10-13 대표).
  // 품목에 배분하고 싶으면 공장 작업 1시간당 금액을 넣는다 (예: 월 380만 ÷ 월 20건 × 5.7h ≈ 33,000).
  overheadPerHour: 0,
  installPerMeter: 40000, // 시공 외주, 시공 길이 m당
  // 상판·설비·철거도 원가 × (1 + 마진) — 견적 전체가 "최종 지출비용 × 1.2" 가 되게 (2026-10-13 대표)
  // 인조대리석 상판 매입+시공, m당 — 고객가 m당 16만 ÷ 1.2 (2026-10-19 대표 확정). 예전 기본 125,000 은 mergeSettings 가 바꿔 읽는다
  countertopPerMeter: 133333,
  sinkBowl: 55000, // 싱크볼 (거래명세서 DS850)
  faucet: 30000, // 수전 (거래명세서 KF-7)
  hood: 59000, // 후드 (거래명세서 하이드 IB60S)
  demolitionPerMeter: 25000, // 기존 철거, 상·하부 길이 m당 — 고객가 m당 3만 ÷ 1.2 (2026-10-19 대표 확정)
  // 원판 장수 계산 (2026-10-13 대표): 자투리를 재사용하므로 현장마다 정수 장수가 아니라 면적 기준.
  //   PB·뒷판 = 부재 면적 ÷ (원판 면적 × pbYield), 0.1장 단위 올림
  //   도어    = 부재 면적 ÷ (원판 면적 × doorYield), 0.5장 단위 올림 (상일이 반 장 단위로 청구)
  // sheetBasis 를 'nested' 로 두면 예전처럼 재단 배치의 정수 장수를 쓴다.
  sheetBasis: 'area',
  pbYield: 0.8,
  doorYield: 0.8,
  // 고정비 회수 — 몸통 PB 1장마다 원가에 더하는 금액 (2026-10-18 대표 확정).
  //   연평균 월 40품목 · 조립 B·엣지 탄력 운영 · 대표 급여 500만 · 잘 되는 달/안 되는 달(거래명세서 0.2/0.69/2.42배) 평균으로
  //   1년 손익이 맞는 몸통 장당(거래처·고객 평균 114,700원)에서 지금 견적 장당(67,200원)을 뺀 값 ÷ 1.15.
  //   고객 장당 +49,600 · 거래처 +45,400. 손익 요약에서는 지출이 아니라 매출로 본다.
  fixedPerPbSheet: 41300,
  // 월 고정비 — 품목 원가 밖에서 매출 전체로 덮는 돈. 월 손익 요약에서만 뺀다.
  //   월세 130만 + 운영비 250만 + 4명 식대 54만 + 동력 전기 25만 + 4대보험·퇴직(상시 인원분) 약 160만 (대표 급여는 별도)
  overheadMonthly: 6190000,
  marginRate: 0.2, // 고객 금액 = 최종 지출비용 × (1 + 이 값)
  partnerMarginRate: 0.1, // 거래처(인테리어 업체) 금액 = 최종 지출비용 × (1 + 이 값) — 2026-10-13 대표 기본값
});
