// ═══════════════════════════════════════════════════════════════
// 자동계산 핵심 알고리즘 — calc-engine.js 124-394줄 TS 포팅
// ═══════════════════════════════════════════════════════════════

import {
  DOOR_TARGET, DOOR_MAX, DOOR_MIN,
  MAX_REMAINDER, SINK_W_SMALL, COOK_FIXED_W, LT_FIXED_W,
} from './calc-constants';

// ── 타입 ──

export interface DistributeResult {
  modules: { w: number; is2D: boolean }[];
  doorWidth: number;
  doorCount: number;
}

export interface FixedModule {
  id: string;
  type: string;
  name: string;
  x: number;
  endX: number;
  w: number;
  [key: string]: unknown;
}

export interface GapSpace {
  start: number;
  end: number;
  width: number;
}

// ── 도어 너비 최적화 (calc-engine.js 124-172) ──

export function findBestDoorWidth(totalSpace: number, doorCount: number): number | null {
  const rawWidth = totalSpace / doorCount;
  if (rawWidth > DOOR_MAX || rawWidth < DOOR_MIN) return null;

  const candidates: { width: number; priority: number; gap: number }[] = [];

  const tenFloor = Math.floor(rawWidth / 10) * 10;
  const tenCeil = Math.ceil(rawWidth / 10) * 10;
  const evenFloor = Math.floor(rawWidth / 2) * 2;
  const evenCeil = Math.ceil(rawWidth / 2) * 2;
  const evenDiv = Math.floor(rawWidth);

  const allCandidates = [
    { width: tenFloor, priority: 1 },
    { width: tenCeil, priority: 1 },
    { width: evenFloor, priority: 2 },
    { width: evenCeil, priority: 2 },
    { width: evenDiv, priority: 3 },
  ];

  for (const cand of allCandidates) {
    if (cand.width < DOOR_MIN || cand.width > DOOR_MAX) continue;
    const used = cand.width * doorCount;
    const gap = totalSpace - used;
    if (gap < 0 || gap > MAX_REMAINDER) continue;
    candidates.push({ ...cand, gap });
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.gap - b.gap;
  });

  return candidates.length > 0 ? candidates[0].width : null;
}

// ── 모듈 균등 분배 (calc-engine.js 181-269) ──
// 2D 페어링 + 잔여 최적화 + 450mm 목표

export function distributeModules(totalSpace: number): DistributeResult {
  if (totalSpace < 100) return { modules: [], doorWidth: 0, doorCount: 0 };

  const minCount = Math.max(1, Math.ceil(totalSpace / DOOR_MAX));
  const baseCount = Math.round(totalSpace / DOOR_TARGET);
  const maxDoorCount = Math.floor(totalSpace / DOOR_MIN);
  const maxCount = Math.min(maxDoorCount, Math.max(baseCount + 3, minCount + 5));

  const allResults: { doorCount: number; doorWidth: number; gap: number; targetDiff: number }[] = [];

  for (let count = minCount; count <= maxCount; count++) {
    // 균등 분배 후보
    const evenWidth = Math.floor(totalSpace / count);
    const evenGap = totalSpace - evenWidth * count;
    if (evenWidth >= DOOR_MIN && evenWidth <= DOOR_MAX && evenGap >= 0 && evenGap <= MAX_REMAINDER) {
      allResults.push({ doorCount: count, doorWidth: evenWidth, gap: evenGap, targetDiff: Math.abs(evenWidth - DOOR_TARGET) });
    }

    // 10단위 내림 후보
    const floorWidth = Math.floor(totalSpace / count / 10) * 10;
    if (floorWidth >= DOOR_MIN && floorWidth <= DOOR_MAX) {
      const floorGap = totalSpace - floorWidth * count;
      if (floorGap >= 0 && floorGap <= MAX_REMAINDER) {
        allResults.push({ doorCount: count, doorWidth: floorWidth, gap: floorGap, targetDiff: Math.abs(floorWidth - DOOR_TARGET) });
      }
    }

    // 짝수 내림 후보
    const evenFloor = Math.floor(totalSpace / count / 2) * 2;
    if (evenFloor >= DOOR_MIN && evenFloor <= DOOR_MAX && evenFloor !== floorWidth) {
      const eg = totalSpace - evenFloor * count;
      if (eg >= 0 && eg <= MAX_REMAINDER) {
        allResults.push({ doorCount: count, doorWidth: evenFloor, gap: eg, targetDiff: Math.abs(evenFloor - DOOR_TARGET) });
      }
    }
  }

  // 정렬: 목표 450mm 근접 → 잔여 작은 순 → 도어 수 적은 순
  allResults.sort((a, b) => {
    if (a.targetDiff !== b.targetDiff) return a.targetDiff - b.targetDiff;
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.doorCount - b.doorCount;
  });

  const best = allResults.length > 0 ? allResults[0] : null;
  if (!best) return { modules: [], doorWidth: 0, doorCount: 0 };

  const { doorCount, doorWidth } = best;
  const quotient = Math.floor(doorCount / 2);
  const remainder = doorCount % 2;

  const modules: { w: number; is2D: boolean }[] = [];
  for (let i = 0; i < quotient; i++) {
    modules.push({ w: doorWidth * 2, is2D: true });
  }
  if (remainder > 0) {
    modules.push({ w: doorWidth, is2D: false });
  }

  return { modules, doorWidth, doorCount };
}

// ── 고정 모듈 위치 조정 (calc-engine.js 298-340) ──

export function adjustFixedPositions(fixedList: FixedModule[], startBound: number, endBound: number): FixedModule[] {
  fixedList.sort((a, b) => a.x - b.x);

  function getMinW(mod: FixedModule): number {
    if (mod.type === 'sink') return SINK_W_SMALL;
    if (mod.type === 'cook') return COOK_FIXED_W;
    if (mod.name === 'LT망장') return LT_FIXED_W;
    return DOOR_MIN;
  }

  // 좌→우 겹침 방지
  let cursor = startBound;
  fixedList.forEach((mod) => {
    if (mod.x < cursor) mod.x = cursor;
    if (mod.x + mod.w > endBound) {
      const minW = getMinW(mod);
      mod.w = Math.max(minW, endBound - mod.x);
      if (mod.x + mod.w > endBound) mod.x = endBound - mod.w;
      if (mod.x < startBound) mod.x = startBound;
    }
    mod.endX = mod.x + mod.w;
    cursor = mod.endX;
  });

  // 우→좌 경계 조정
  let rightCursor = endBound;
  for (let i = fixedList.length - 1; i >= 0; i--) {
    const mod = fixedList[i];
    if (mod.endX > rightCursor) {
      mod.endX = rightCursor;
      const minW = getMinW(mod);
      mod.x = Math.max(startBound, mod.endX - Math.max(minW, mod.w));
      mod.w = mod.endX - mod.x;
    }
    rightCursor = mod.x;
  }

  return fixedList;
}

// ── 빈 공간 계산 (calc-engine.js 345-360) ──

export function calculateGaps(fixedList: FixedModule[], startBound: number, endBound: number): GapSpace[] {
  const gaps: GapSpace[] = [];
  let cursor = startBound;

  const sorted = [...fixedList].sort((a, b) => a.x - b.x);
  for (const fixed of sorted) {
    if (fixed.x > cursor + 1) {
      gaps.push({ start: cursor, end: fixed.x, width: fixed.x - cursor });
    }
    cursor = fixed.endX;
  }
  if (cursor < endBound - 1) {
    gaps.push({ start: cursor, end: endBound, width: endBound - cursor });
  }

  return gaps;
}

// ── Gap을 모듈로 채우기 (calc-engine.js 371-394) ──

export interface FilledModule {
  w: number;
  is2D: boolean;
  x: number;
}

export function fillGapWithModules(gap: GapSpace): FilledModule[] {
  const result = distributeModules(gap.width);
  if (!result.doorWidth || result.doorCount < 1) return [];

  const modules: FilledModule[] = [];
  let dx = gap.start;

  const { doorWidth, doorCount } = result;
  const quotient = Math.floor(doorCount / 2);
  const mod1D = doorCount % 2;

  for (let i = 0; i < quotient; i++) {
    modules.push({ w: doorWidth * 2, is2D: true, x: dx });
    dx += doorWidth * 2;
  }
  if (mod1D > 0) {
    modules.push({ w: doorWidth, is2D: false, x: dx });
  }

  return modules;
}
