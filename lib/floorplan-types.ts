/**
 * Floorplan v2 데이터 모델
 *
 * 기존 단일 박스 모델(`item.w/h/d` + `specs.layoutShape`)을
 * **N개의 사각형 공간(Space)이 Top View 평면 위에 자유 배치**되는 모델로 전환.
 *
 * 결정 사항(M0 합의서 §2):
 * - A: 회전은 90°×k 스냅
 * - B: 직각 케이스만 (M3 1차 출시)
 * - C: 트리밍은 시각 + BOM 모두 (카운터탑/몰딩만 트리밍 전 길이)
 * - D: 모델은 N공간 일반화, M3 UX는 ≤2
 * - E: 분배기/환풍구는 space별
 * - H: 회전 중심은 사각형 중심
 *
 * 참고: 마이그레이션 계획 §3 데이터 모델 설계
 */

// ============================================================
// 기본 좌표
// ============================================================

export interface Point2D {
  x: number;
  y: number;
}

// ============================================================
// 도메인 enum (단일 진실 원천 — data-constants.js와 동기화)
// ============================================================

export type CabinetCategory =
  | 'sink'      // 싱크대
  | 'island'    // 아일랜드
  | 'wardrobe'  // 붙박이장
  | 'fridge'    // 냉장고장
  | 'shoerack'  // 신발장
  | 'vanity'    // 화장대
  | 'storage'   // 수납장
  | 'warehouse' // 창고장
  | 'door'      // 도어교체
  | 'custom';   // 비규격장

export const CABINET_CATEGORIES: readonly CabinetCategory[] = [
  'sink', 'island', 'wardrobe', 'fridge', 'shoerack',
  'vanity', 'storage', 'warehouse', 'door', 'custom',
] as const;

export type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

export const MATERIAL_TONES: readonly MaterialTone[] = [
  'cream', 'oak', 'walnut', 'graphite',
] as const;

/** 공간 내 실측 기준 코너 (Top-Left, Top-Right, Bottom-Left, Bottom-Right) */
export type MeasurementBase = 'TL' | 'TR' | 'BL' | 'BR';

// ============================================================
// Space — 평면상 한 사각형 공간 (1자형 단위)
// ============================================================

export interface Space {
  /** 'space-{nanoid}' 형식. 모듈 ID와 공간 ID는 별도 네임스페이스. */
  id: string;

  /** 가로 (mm). Top View X축. 회전 0일 때. */
  w: number;
  /** 세로/깊이 (mm). Top View Y축. 회전 0일 때.
   *  ※ '천장 높이'는 별도 verticalH 필드. */
  h: number;

  /** 평면 좌표 (mm). Floorplan 기준 (좌상단 0,0). 회전 중심 = 사각형 중심. */
  x: number;
  y: number;

  /**
   * 회전 (라디안). M3 1차 출시는 90°×k 스냅 강제 (결정 A).
   * 0 / π/2 / π / 3π/2 만 허용 권장.
   */
  rotation: number;

  /**
   * "앞으로 보내기" 우선순위. 코너 트리밍 시 zIndex 큰 쪽이 그대로 남고,
   * 작은 쪽이 트리밍당함. 동일값은 충돌(UI에서 차단).
   */
  zIndex: number;

  /** 천장 높이 (mm). 기존 item.h. */
  verticalH: number;

  /** 공간이 속한 카테고리. M0 결정 F: 1차는 카테고리 단일이지만 모델은 공간별 보유. */
  category: CabinetCategory;

  /** 실측 기준 코너 (선택). 미지정 시 'BL' 기본. */
  measurementBase?: MeasurementBase;

  // ── 분배기/환풍구 (결정 E: space별) ──
  /** 분배기 시작 좌표 (mm, 공간 로컬). null = 분배기 없음. */
  distributorStart?: number | null;
  /** 분배기 끝 좌표 (mm, 공간 로컬). */
  distributorEnd?: number | null;
  /** 환풍구 위치 (mm, 공간 로컬). null = 환풍구 없음. */
  ventStart?: number | null;

  /** 사용자가 부여한 라벨 (예: "주공간", "보조공간"). UI 표시용. */
  label?: string;
}

// ============================================================
// Junction — 두 공간이 만나는 코너 (트리밍 대상)
// ============================================================

/**
 * 코너 형태. M3 1차 출시는 'L-inside'만 지원.
 * 'L-outside' = 바깥 코너, 'T' = T자 교차, 'X' = 십자 교차.
 */
export type CornerType = 'L-inside' | 'L-outside' | 'T' | 'X';

/** 트리밍당하는 변. 공간 로컬 좌표계 기준. */
export type TrimmedEdge = 'front' | 'back' | 'left' | 'right';

export interface Junction {
  /** 'junction-{nanoid}'. */
  id: string;

  /** 트리밍당하는 쪽 (zIndex 낮음). */
  spaceAId: string;
  /** 앞으로 나오는 쪽 (zIndex 높음). */
  spaceBId: string;

  /** 정확한 겹침 폴리곤 (mm, Floorplan 좌표계). 직각 케이스에서 사각형. */
  overlapPolygon: Point2D[];

  /** spaceA의 어느 변이 잘렸는지. */
  trimmedEdge: TrimmedEdge;

  cornerType: CornerType;
}

// ============================================================
// TrimmedSpace — 트리밍 적용 후 실제 가구 점유 폴리곤
// ============================================================

export interface TrimmedEdgeInfo {
  edge: TrimmedEdge;
  /** 트리밍 전 길이 (mm). 카운터탑/몰딩 산출 시 사용. */
  originalLength: number;
  /** 트리밍 후 길이 (mm). 측판/지판/뒷판/도어 산출 시 사용. */
  trimmedLength: number;
  junctionId: string;
}

export interface TrimmedSpace {
  spaceId: string;
  /** 시계방향 외곽선. 직각 케이스에서 4점(사각형) 또는 5~6점(L폴리곤). mm, Floorplan 좌표계. */
  outline: Point2D[];
  trimmedEdges: TrimmedEdgeInfo[];
}

// ============================================================
// Floorplan — 공간들의 컬렉션
// ============================================================

export interface Floorplan {
  /** 데이터 마이그레이션 식별자. v2부터 명시. */
  schemaVersion: 2;
  /** 최소 1개. */
  spaces: Space[];
  /** 자동 산출. 사용자가 직접 편집하지 않음. */
  junctions: Junction[];
  /** 자동 산출. 트리밍 적용 후 폴리곤. */
  trimmedSpaces: TrimmedSpace[];
}

// ============================================================
// ModuleV2 — 가구 모듈 (어느 공간에 속하는가 + 공간 로컬 좌표)
// ============================================================

export type ModulePosition = 'lower' | 'upper';

export type ModuleType =
  | 'sink'
  | 'cook'
  | 'hood'
  | 'storage'
  | 'open'
  | 'drawer'
  | 'blind'           // 멍판 (코너 죽은 공간 막이)
  | 'blind-corner'    // 코너 멍판
  | 'corner-filler';  // 코너 충진재

export type DoorOpenDirection = 'left' | 'right' | 'both';
export type DoorType = 'swing' | 'sliding' | 'liftup';

export interface ModuleV2 {
  id: string;
  /** 소속 공간 (필수). */
  spaceId: string;
  pos: ModulePosition;
  /** 공간 로컬 X 좌표 (0 = 공간 좌측). */
  posXInSpace: number;

  w: number;
  /** 모듈 자체 높이 (선택). 미지정 시 카테고리/pos별 기본값 사용. */
  h?: number;
  /** 모듈 자체 깊이 (선택). 공간 d와 다를 수 있음. */
  d?: number;

  type: ModuleType;
  doorCount?: number;
  doorOpenDirection?: DoorOpenDirection;
  doorType?: DoorType;
  isFixed?: boolean;
  isDrawer?: boolean;

  // ── 트리밍 인지 ──
  /** 이 모듈이 코너에 인접한가. 자동 분배 시 부여. */
  adjacentJunctionId?: string;
  /** L 코너 전용 캐비닛 (양면 도어). */
  isCornerCabinet?: boolean;

  // 호환: 기존 v1 필드를 임시 보존하려는 경우. M6에서 정리.
  /** @deprecated v1 호환 — spaceId가 그 역할 대체. */
  orientation?: 'normal' | 'secondary' | 'tertiary';
}

// ============================================================
// Specs v2 — 카테고리 비특화 공통 스펙
// ============================================================

/**
 * 카테고리별 spec은 키가 천차만별이라 unknown으로 허용. 마이그레이션 시 그대로 보존.
 * 분배기/환풍구는 v2에서 Space로 이전됐으므로 specs에서는 제거 권장.
 */
export interface SpecsV2 {
  material?: MaterialTone;
  finishLeftType?: string;
  finishLeftWidth?: number;
  finishRightType?: string;
  finishRightWidth?: number;
  // 카테고리별 추가 필드는 임의 키 허용
  [key: string]: unknown;
}

// ============================================================
// ItemV2 — Floorplan을 갖는 컨테이너
// ============================================================

export interface ItemV2 {
  schemaVersion: 2;
  uniqueId: number;
  categoryId: CabinetCategory;
  labelName: string;
  floorplan: Floorplan;
  modules: ModuleV2[];
  specs: SpecsV2;
}

// ============================================================
// V1 호환 인터페이스 (마이그레이션 입력용)
// ============================================================

/**
 * 운영 v1 데이터 형식. persistence-init.js의 saveDesignItems가 저장하는 구조.
 * 마이그레이션 함수 입력용으로만 사용. 신규 코드는 ItemV2를 사용.
 */
export interface ItemV1 {
  uniqueId: number;
  category?: string;
  categoryId?: string;
  name?: string;
  /** 가로 (mm). */
  w: number | string;
  /** 천장 높이 (mm). */
  h: number | string;
  /** 깊이 (mm). */
  d: number | string;
  specs: SpecsV1;
  modules: ModuleV1[];
  image?: string | null;
  imageUrl?: string | null;
}

export interface SpecsV1 {
  layoutShape?: 'I' | 'L' | 'U';
  lowerLayoutShape?: 'I' | 'L' | 'U';
  // ㄱ자 보조공간
  lowerSecondaryW?: number | string;
  lowerSecondaryD?: number | string;
  upperSecondaryW?: number | string;
  upperSecondaryD?: number | string;
  secondaryUpperEnabled?: boolean;
  secondaryStartSide?: 'left' | 'right';
  // ㄷ자 3차공간
  lowerTertiaryW?: number | string;
  lowerTertiaryD?: number | string;
  tertiaryStartFrom?: 'prime' | 'secondary';
  // 분배기/환풍구 (v2: space별로 이동)
  distributorStart?: number | string | null;
  distributorEnd?: number | string | null;
  ventStart?: number | string | null;
  // 마감재
  finishLeftType?: string;
  finishLeftWidth?: number | string;
  finishRightType?: string;
  finishRightWidth?: number | string;
  finishCorner1Type?: string;
  finishCorner1Width?: number | string;
  finishCorner2Type?: string;
  finishCorner2Width?: number | string;
  measurementBase?: 'Left' | 'Right' | string;
  materialTone?: string;
  [key: string]: unknown;
}

export interface ModuleV1 {
  id: string | number;
  pos: 'lower' | 'upper';
  type: string;
  w: number | string;
  h?: number | string;
  d?: number | string;
  /** v1에서 secondary/tertiary 모듈 식별. v2에서는 spaceId로 대체. */
  orientation?: 'normal' | 'secondary' | 'tertiary';
  doorCount?: number;
  isDrawer?: boolean;
  isFixed?: boolean;
  is2door?: boolean;
  [key: string]: unknown;
}

// ============================================================
// Type guards (런타임 검증 — message-schema에서 재사용)
// ============================================================

export function isCabinetCategory(value: unknown): value is CabinetCategory {
  return typeof value === 'string' && (CABINET_CATEGORIES as readonly string[]).includes(value);
}

export function isMaterialTone(value: unknown): value is MaterialTone {
  return typeof value === 'string' && (MATERIAL_TONES as readonly string[]).includes(value);
}

export function isFloorplan(value: unknown): value is Floorplan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 2 &&
    Array.isArray(v.spaces) &&
    Array.isArray(v.junctions) &&
    Array.isArray(v.trimmedSpaces)
  );
}
