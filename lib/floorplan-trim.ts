/**
 * Floorplan 트리밍 — 직각 분석적 알고리즘
 *
 * M0 결정: 90° 스냅 + 직각 케이스 한정.
 * 모든 공간이 축 정렬(AABB)이라는 전제 하에, 외부 라이브러리 없이 정확한 트리밍.
 *
 * 부동소수 안전:
 *   - 모든 좌표를 1mm 단위로 반올림 후 정수 비교
 *   - 회전은 0 / π/2 / π / 3π/2 만 허용
 *
 * 알고리즘:
 *   1. 각 Space를 회전 적용한 AABB(축 정렬 사각형)로 변환
 *   2. 모든 Space 페어에 대해 겹침 사각형(intersection) 계산
 *   3. 겹침이 있으면 zIndex 비교 → 낮은 쪽이 트리밍당함
 *   4. 트리밍당하는 변(front/back/left/right) 결정
 *   5. TrimmedSpace.outline은 직사각형 또는 L폴리곤 (최대 6점)
 */

import type {
  Point2D,
  Space,
  Junction,
  TrimmedSpace,
  TrimmedEdge,
  TrimmedEdgeInfo,
  CornerType,
} from './floorplan-types';

// ============================================================
// 내부 표현
// ============================================================

interface AABB {
  spaceId: string;
  /** 회전 적용 후 좌상단 (mm, Floorplan 좌표). */
  minX: number;
  minY: number;
  /** 회전 적용 후 우하단. */
  maxX: number;
  maxY: number;
  /** 원본 회전. 트리밍 변(front/back/left/right) 매핑에 사용. */
  rotationStep: 0 | 1 | 2 | 3;
  zIndex: number;
}

// ============================================================
// 유틸리티
// ============================================================

/** 1mm 단위 반올림 후 정수화. 부동소수 누적 오차 차단. */
function roundMm(v: number): number {
  return Math.round(v);
}

/** 라디안을 90° 단위 step (0/1/2/3)으로 정규화. 가까운 값으로 스냅. */
function rotationToStep(rad: number): 0 | 1 | 2 | 3 {
  const HALF_PI = Math.PI / 2;
  // 음수/큰 값 정규화
  const normalized = ((rad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const step = Math.round(normalized / HALF_PI) % 4;
  return step as 0 | 1 | 2 | 3;
}

/**
 * Space를 회전 적용한 AABB로 변환.
 * 회전 중심 = 사각형 중심(결정 H), 회전은 90°×k.
 * - step 0/2: w x h 그대로
 * - step 1/3: w와 h가 swap (90° 회전)
 */
function spaceToAABB(space: Space): AABB {
  const step = rotationToStep(space.rotation);
  const isQuarter = step === 1 || step === 3;
  const effW = isQuarter ? space.h : space.w;
  const effH = isQuarter ? space.w : space.h;

  const minX = roundMm(space.x - effW / 2);
  const minY = roundMm(space.y - effH / 2);
  const maxX = roundMm(space.x + effW / 2);
  const maxY = roundMm(space.y + effH / 2);

  return { spaceId: space.id, minX, minY, maxX, maxY, rotationStep: step, zIndex: space.zIndex };
}

/** 두 AABB의 겹침 사각형 (없으면 null). */
function intersect(a: AABB, b: AABB): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * 트리밍당하는 쪽(spaceA)에서 어느 변이 잘렸는지 결정.
 * Floorplan 좌표계의 'world edge'를 spaceA 로컬 변(front/back/left/right)으로 변환.
 *
 * 로컬 변 정의 (회전 0일 때):
 *   - back  = -Y면 (위)
 *   - front = +Y면 (아래)
 *   - left  = -X면 (좌)
 *   - right = +X면 (우)
 *
 * 회전(step) 적용 시 변 매핑:
 *   step 0: world+X→right, world-X→left, world+Y→front, world-Y→back
 *   step 1: 시계 90° → world+X→front, world-X→back, world+Y→left, world-Y→right
 *   step 2: 180° → world+X→left, world-X→right, world+Y→back, world-Y→front
 *   step 3: 시계 270° → world+X→back, world-X→front, world+Y→right, world-Y→left
 */
function worldEdgeToLocalEdge(
  worldEdge: '+X' | '-X' | '+Y' | '-Y',
  step: 0 | 1 | 2 | 3,
): TrimmedEdge {
  const map: Record<typeof step, Record<typeof worldEdge, TrimmedEdge>> = {
    0: { '+X': 'right', '-X': 'left', '+Y': 'front', '-Y': 'back' },
    1: { '+X': 'front', '-X': 'back', '+Y': 'left', '-Y': 'right' },
    2: { '+X': 'left', '-X': 'right', '+Y': 'back', '-Y': 'front' },
    3: { '+X': 'back', '-X': 'front', '+Y': 'right', '-Y': 'left' },
  };
  return map[step][worldEdge];
}

/**
 * 겹침 사각형이 spaceA의 어느 world edge에 닿아 있는지 판정.
 * 겹침은 항상 spaceA의 한 변(또는 코너)에 닿아 있음 (직각 케이스 가정).
 *
 * 우선순위: 더 긴 접촉 변 선택. 동률이면 +X > -X > +Y > -Y 임의 순서.
 */
function detectWorldEdge(
  a: AABB,
  overlap: { minX: number; minY: number; maxX: number; maxY: number },
): '+X' | '-X' | '+Y' | '-Y' {
  const candidates: Array<{ edge: '+X' | '-X' | '+Y' | '-Y'; touching: boolean; length: number }> = [
    { edge: '+X', touching: overlap.maxX === a.maxX, length: overlap.maxY - overlap.minY },
    { edge: '-X', touching: overlap.minX === a.minX, length: overlap.maxY - overlap.minY },
    { edge: '+Y', touching: overlap.maxY === a.maxY, length: overlap.maxX - overlap.minX },
    { edge: '-Y', touching: overlap.minY === a.minY, length: overlap.maxX - overlap.minX },
  ];
  const touching = candidates.filter((c) => c.touching);
  if (touching.length === 0) {
    // 안쪽 완전 포함 (사실상 spaceA가 spaceB에 완전히 묻힘) — 가장 긴 변을 임의로 반환
    return '+X';
  }
  touching.sort((a, b) => b.length - a.length);
  return touching[0].edge;
}

// ============================================================
// 메인 트리밍 함수
// ============================================================

export interface TrimResult {
  junctions: Junction[];
  trimmedSpaces: TrimmedSpace[];
}

/**
 * 모든 Space에 대해 페어와이즈 겹침을 검출하고 트리밍 결과 산출.
 *
 * 계약:
 *   - 입력: spaces 배열 (1개 이상)
 *   - 출력: junctions (트리밍된 코너 목록), trimmedSpaces (트리밍 후 폴리곤)
 *   - 트리밍이 없는 공간도 trimmedSpaces에 직사각형 outline으로 포함됨
 *   - junction.id는 'junction-{spaceA-spaceB}' 형식 (idempotent)
 */
export function computeTrimming(spaces: Space[], options?: { junctionIdPrefix?: string }): TrimResult {
  const prefix = options?.junctionIdPrefix ?? 'junction';
  const aabbs = spaces.map(spaceToAABB);

  // 모든 페어 검사
  const junctions: Junction[] = [];
  // spaceId → 트리밍된 변 목록
  const trimsBySpaceId = new Map<string, TrimmedEdgeInfo[]>();

  for (let i = 0; i < aabbs.length; i++) {
    for (let j = i + 1; j < aabbs.length; j++) {
      const a = aabbs[i];
      const b = aabbs[j];
      const overlap = intersect(a, b);
      if (!overlap) continue;

      // zIndex가 큰 쪽이 앞으로(spaceB), 작은 쪽이 트리밍당함(spaceA)
      // 동률은 첫 번째 등장이 앞 (입력 순서 안정성)
      const aWins = a.zIndex > b.zIndex;
      const trimmedAabb = aWins ? b : a;
      const winnerAabb = aWins ? a : b;

      const worldEdge = detectWorldEdge(trimmedAabb, overlap);
      const localEdge = worldEdgeToLocalEdge(worldEdge, trimmedAabb.rotationStep);

      const overlapPolygon: Point2D[] = [
        { x: overlap.minX, y: overlap.minY },
        { x: overlap.maxX, y: overlap.minY },
        { x: overlap.maxX, y: overlap.maxY },
        { x: overlap.minX, y: overlap.maxY },
      ];

      const junctionId = `${prefix}-${trimmedAabb.spaceId}-${winnerAabb.spaceId}`;
      junctions.push({
        id: junctionId,
        spaceAId: trimmedAabb.spaceId,
        spaceBId: winnerAabb.spaceId,
        overlapPolygon,
        trimmedEdge: localEdge,
        cornerType: classifyCornerType(trimmedAabb, winnerAabb, overlap),
      });

      // 트리밍 정보 누적
      const trimmedLength =
        worldEdge === '+X' || worldEdge === '-X'
          ? overlap.maxY - overlap.minY
          : overlap.maxX - overlap.minX;
      const originalLength =
        worldEdge === '+X' || worldEdge === '-X'
          ? trimmedAabb.maxY - trimmedAabb.minY
          : trimmedAabb.maxX - trimmedAabb.minX;

      const list = trimsBySpaceId.get(trimmedAabb.spaceId) ?? [];
      list.push({
        edge: localEdge,
        originalLength,
        trimmedLength: originalLength - trimmedLength,
        junctionId,
      });
      trimsBySpaceId.set(trimmedAabb.spaceId, list);
    }
  }

  // TrimmedSpace 산출 — 각 공간의 outline 계산
  const trimmedSpaces: TrimmedSpace[] = aabbs.map((aabb) => ({
    spaceId: aabb.spaceId,
    outline: computeOutline(aabb, junctions),
    trimmedEdges: trimsBySpaceId.get(aabb.spaceId) ?? [],
  }));

  return { junctions, trimmedSpaces };
}

/**
 * 코너 타입 분류 (단순 휴리스틱).
 * 'L-inside': spaceA 사각형 내부에 spaceB가 코너 부분 침범 (가장 일반적)
 * 'L-outside': 바깥 코너 (현재 직각 모델에서는 케이스 없음)
 * 'T'/'X': 더 복잡한 케이스 (M3 1차 출시 외)
 */
function classifyCornerType(
  trimmed: AABB,
  winner: AABB,
  overlap: { minX: number; minY: number; maxX: number; maxY: number },
): CornerType {
  // winner가 trimmed의 코너에서 침범한 경우 (L-inside)
  const overlapAtCorner =
    (overlap.minX === trimmed.minX || overlap.maxX === trimmed.maxX) &&
    (overlap.minY === trimmed.minY || overlap.maxY === trimmed.maxY);
  if (overlapAtCorner) return 'L-inside';

  // 한 변 전체에 걸친 경우 (T)
  const fullVerticalSpan = overlap.minY === trimmed.minY && overlap.maxY === trimmed.maxY;
  const fullHorizontalSpan = overlap.minX === trimmed.minX && overlap.maxX === trimmed.maxX;
  if (fullVerticalSpan || fullHorizontalSpan) return 'T';

  return 'L-inside'; // 보수적 기본값
}

/**
 * 한 공간의 트리밍 후 외곽선 계산.
 * 트리밍이 없으면 사각형 4점, 있으면 L폴리곤 5~6점.
 *
 * 본 구현은 1차 출시 범위에서 **단일 코너 트리밍**까지만 정확. 다중 코너는 후속.
 */
function computeOutline(aabb: AABB, junctions: Junction[]): Point2D[] {
  const myJunctions = junctions.filter((j) => j.spaceAId === aabb.spaceId);

  // 트리밍 없음: 사각형
  if (myJunctions.length === 0) {
    return [
      { x: aabb.minX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.maxY },
      { x: aabb.minX, y: aabb.maxY },
    ];
  }

  // 단일 트리밍: L폴리곤 (시계방향 6점)
  // M3 1차 출시 한정.
  if (myJunctions.length === 1) {
    const j = myJunctions[0];
    const corner = j.overlapPolygon;
    // overlap의 4점을 사용해서 L 폴리곤 생성
    // aabb 코너 - overlap 코너 차감
    const minX = aabb.minX, minY = aabb.minY, maxX = aabb.maxX, maxY = aabb.maxY;
    const oMinX = Math.min(...corner.map((p) => p.x));
    const oMinY = Math.min(...corner.map((p) => p.y));
    const oMaxX = Math.max(...corner.map((p) => p.x));
    const oMaxY = Math.max(...corner.map((p) => p.y));

    // 4가지 코너 케이스를 단순 분기로
    if (oMinX === minX && oMinY === minY) {
      // 좌상 코너 트리밍 → L폴리곤 (시계방향)
      return [
        { x: oMaxX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: oMaxY },
        { x: oMaxX, y: oMaxY },
      ];
    }
    if (oMaxX === maxX && oMinY === minY) {
      // 우상 코너 트리밍
      return [
        { x: minX, y: minY },
        { x: oMinX, y: minY },
        { x: oMinX, y: oMaxY },
        { x: maxX, y: oMaxY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ];
    }
    if (oMinX === minX && oMaxY === maxY) {
      // 좌하 코너 트리밍
      return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: oMaxX, y: maxY },
        { x: oMaxX, y: oMinY },
        { x: minX, y: oMinY },
      ];
    }
    if (oMaxX === maxX && oMaxY === maxY) {
      // 우하 코너 트리밍
      return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: oMinY },
        { x: oMinX, y: oMinY },
        { x: oMinX, y: maxY },
        { x: minX, y: maxY },
      ];
    }
    // 변 중앙 침범 (T자) — 사각형 그대로 + 노티 (M3 외 케이스, 보수적)
  }

  // 다중 트리밍 또는 비코너: 사각형 fallback (M3 외, 후속)
  return [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY },
    { x: aabb.minX, y: aabb.maxY },
  ];
}

// ============================================================
// Helpers
// ============================================================

/** Floorplan에 트리밍을 다시 계산해서 적용. spaces가 변경된 후 호출. */
export function recomputeFloorplan<T extends { spaces: Space[]; junctions: Junction[]; trimmedSpaces: TrimmedSpace[] }>(
  floorplan: T,
): T {
  const { junctions, trimmedSpaces } = computeTrimming(floorplan.spaces);
  return { ...floorplan, junctions, trimmedSpaces };
}
