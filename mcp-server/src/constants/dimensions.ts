// ═══════════════════════════════════════════════════════════════
// Dimension Constants - 가구 설계 기본 치수 (mm)
// 서비스 전체에서 공유하는 매직넘버 통합
// ═══════════════════════════════════════════════════════════════

// ─── 벽면 기본값 ───

/** 벽 너비 기본값 (mm) - 벽 분석 실패 시 fallback */
export const DEFAULT_WALL_WIDTH_MM = 3000;
/** 벽 높이 기본값 (mm) */
export const DEFAULT_WALL_HEIGHT_MM = 2400;

// ─── 캐비닛 표준 높이 ───

/** 상부장 높이 (mm) */
export const STANDARD_UPPER_CABINET_HEIGHT_MM = 720;
/** 하부장 높이 (mm) - 다리발 + 본체 + 상판 포함 */
export const STANDARD_LOWER_CABINET_HEIGHT_MM = 870;

// ─── 캐비닛 부위 치수 ───

/** 다리발 높이 (mm) */
export const STANDARD_LEG_HEIGHT_MM = 150;
/** 몰딩 높이 (mm) */
export const STANDARD_MOLDING_HEIGHT_MM = 60;
/** 카운터탑 두께 (mm) */
export const STANDARD_COUNTERTOP_THICKNESS_MM = 12;
/** 상부장 도어 오버랩 (mm) */
export const STANDARD_UPPER_DOOR_OVERLAP_MM = 15;

// ─── 캐비닛 깊이 ───

/** 표준 깊이 (mm) */
export const STANDARD_DEPTH_MM = 600;
/** 상부장 깊이 비율 (하부장 대비) */
export const UPPER_DEPTH_RATIO = 0.55;

// ─── 설비 배치 기본 비율 ───

/** 싱크대 기본 위치: 벽 너비의 30% */
export const SINK_POSITION_RATIO = 0.3;
/** 쿡탑 기본 위치: 벽 너비의 70% */
export const COOKTOP_POSITION_RATIO = 0.7;

// ─── 도면 상수 ───

/** 상부장~하부장 간격 (mm) */
export const UPPER_LOWER_GAP_MM = 600;
/** 경첩: 도어 상/하단에서의 오프셋 (mm) */
export const HINGE_OFFSET_MM = 100;
/** 도면용 카운터탑 두께 (mm) - 시각적 표현용 */
export const DRAWING_COUNTERTOP_THICKNESS_MM = 30;

// ─── 타일 기본값 ───

/** 기본 타일 너비 (mm) */
export const DEFAULT_TILE_WIDTH_MM = 300;
/** 기본 타일 높이 (mm) */
export const DEFAULT_TILE_HEIGHT_MM = 600;

// ─── 캐비닛 모듈 기본 너비 ───

/** 싱크장 기본 너비 (mm) */
export const DEFAULT_SINK_CABINET_WIDTH_MM = 800;
/** 서랍장 기본 너비 (mm) */
export const DEFAULT_DRAWER_CABINET_WIDTH_MM = 600;
/** 쿡탑장 기본 너비 (mm) */
export const DEFAULT_COOKTOP_CABINET_WIDTH_MM = 800;
/** 표준 모듈 기본 너비 (mm) */
export const DEFAULT_STANDARD_CABINET_WIDTH_MM = 800;
