export type CabinetCategory = 'sink' | 'wardrobe' | 'vanity' | 'shoe' | 'fridge' | 'storage';

export type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

export type ModuleSection = 'lower' | 'upper' | 'full';

export type ModuleKind = 'door' | 'drawer' | 'open';

export interface CabinetModule {
  id: string;
  section: ModuleSection;
  kind: ModuleKind;
  width: number;
  height: number;
  depth: number;
  moduleType?: ModuleType;
  doorCount?: number;
  drawerCount?: number;
  /** 'secondary' = 차선모듈, 'tertiary' = 3차선 (ㄷ자형) */
  orientation?: 'normal' | 'secondary' | 'tertiary';
  blindAnchorId?: string;
}

export interface CabinetPreset {
  id: CabinetCategory;
  name: string;
  summary: string;
  roomLabel: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDepth: number;
  lowerHeight: number;
  upperHeight: number;
  upperDepth: number;
  toeKickHeight: number;
  counterThickness: number;
  lowerCount: number;
  upperCount: number;
  hasCountertop: boolean;
  fullHeight: boolean;
  defaultMoldingH: number;
}

export type ModuleType = 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';

export interface ModuleEntry {
  id: string;
  kind: ModuleKind;
  width: number;
  moduleType?: ModuleType;
  doorCount?: number;
  drawerCount?: number;
  /** 'secondary' = 차선모듈(ㄱ자 좌측/우측), 'tertiary' = 3차선(ㄷ자 반대편) */
  orientation?: 'normal' | 'secondary' | 'tertiary';
  /** 멍장 연결 대상(주선) 모듈 ID — 차선모듈이 어느 앵커에 붙는지 */
  blindAnchorId?: string;
}

export interface PlannerState {
  presetId: CabinetCategory;
  width: number;
  height: number;
  depth: number;
  lowerCount: number;
  upperCount: number;
  lowerModules: ModuleEntry[];
  upperModules: ModuleEntry[];
  material: MaterialTone;
  moldingH: number;
  toeKickH: number;
  finishLeftW: number;
  finishRightW: number;
  /** 차선모듈(ㄱ자) 자유단 마감재 폭 (mm) — 기본 휠라 60 */
  secondaryFillerW?: number;
  /** 차선모듈 시작 방향: 'left' = 좌측에서 시작, 'right' = 우측에서 시작 */
  secondaryStartSide?: 'left' | 'right';
  // 유틸리티: null=자동, 0=삭제/숨김, >0=활성(mm from left)
  distributorStart: number | null;
  distributorEnd: number | null;
  ventStart: number | null;
}

export interface CabinetPart {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  colorKey: 'body' | 'accent' | 'shadow' | 'trim';
  wireframe?: boolean;
  essential?: boolean;
  moduleType?: ModuleType;
  moduleKind?: ModuleKind;
  doorCount?: number;
  drawerCount?: number;
  /** Y축 회전 (라디안). 차선모듈(secondary) 용 */
  rotationY?: number;
}

export interface ModuleLayout {
  section: 'lower' | 'upper' | 'full';
  startX: number;
  endX: number;
  centerY: number;
  z: number;
  depth: number;
}

export interface UtilityPositions {
  distributorStart: number | null;
  distributorEnd: number | null;
  ventStart: number | null;
}

export interface DerivedCabinet {
  preset: CabinetPreset;
  parts: CabinetPart[];
  modules: CabinetModule[];
  lowerLayout: ModuleLayout | null;
  upperLayout: ModuleLayout | null;
  utilities: UtilityPositions;
  footprintAreaM2: number;
  facadeAreaM2: number;
  estimatedBoardAreaM2: number;
}

export const MATERIALS: Record<
  MaterialTone,
  { name: string; body: string; accent: string; shadow: string; trim: string }
> = {
  cream: { name: 'Warm Cream', body: '#f1ede3', accent: '#d4c4a8', shadow: '#b7aa90', trim: '#c8bda8' },
  oak: { name: 'Natural Oak', body: '#d1b089', accent: '#9e7144', shadow: '#6f5031', trim: '#8a6a42' },
  walnut: { name: 'Deep Walnut', body: '#8b6447', accent: '#b48a6a', shadow: '#5d412c', trim: '#6e5238' },
  graphite: { name: 'Graphite', body: '#696a6b', accent: '#c2b49c', shadow: '#3d4042', trim: '#555657' },
};

export const PRESETS: CabinetPreset[] = [
  {
    id: 'sink',
    name: '싱크대',
    summary: '하부장, 상부장, 상판을 한 번에 조정하는 주방형 레이아웃',
    roomLabel: '주방',
    defaultWidth: 3000,
    defaultHeight: 2300,
    defaultDepth: 650,
    lowerHeight: 870,
    upperHeight: 720,
    upperDepth: 295,
    toeKickHeight: 150,
    counterThickness: 12,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: true,
    fullHeight: false,
    defaultMoldingH: 60,
  },
  {
    id: 'wardrobe',
    name: '붙박이장',
    summary: '천장까지 차오르는 침실 수납장과 행거 중심 구성',
    roomLabel: '침실',
    defaultWidth: 3600,
    defaultHeight: 2400,
    defaultDepth: 620,
    lowerHeight: 2400,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 40,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 20,
  },
  {
    id: 'vanity',
    name: '화장대',
    summary: '거울 하부 서랍장과 측면 수납을 포함한 파우더존 구성',
    roomLabel: '침실',
    defaultWidth: 1400,
    defaultHeight: 2000,
    defaultDepth: 550,
    lowerHeight: 780,
    upperHeight: 1050,
    upperDepth: 220,
    toeKickHeight: 80,
    counterThickness: 18,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: true,
    fullHeight: false,
    defaultMoldingH: 40,
  },
  {
    id: 'shoe',
    name: '신발장',
    summary: '현관형 얕은 깊이와 오픈 니치가 어울리는 수납 레이아웃',
    roomLabel: '현관',
    defaultWidth: 1800,
    defaultHeight: 2300,
    defaultDepth: 360,
    lowerHeight: 2300,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 70,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 30,
  },
  {
    id: 'fridge',
    name: '냉장고장',
    summary: '냉장고 니치와 키큰장 조합에 맞춘 주방 수납 시스템',
    roomLabel: '주방',
    defaultWidth: 1900,
    defaultHeight: 2350,
    defaultDepth: 700,
    lowerHeight: 2350,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 80,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 50,
  },
  {
    id: 'storage',
    name: '수납장',
    summary: '거실, 다용도실, 팬트리에 대응하는 범용 수납장',
    roomLabel: '멀티룸',
    defaultWidth: 2400,
    defaultHeight: 2200,
    defaultDepth: 500,
    lowerHeight: 2200,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 60,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 40,
  },
];

export const getPresetById = (id: CabinetCategory): CabinetPreset =>
  PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const distributeWidths = (totalWidth: number, count: number) => {
  const safeCount = Math.max(1, count);
  const raw = totalWidth / safeCount;
  const rounded = Math.round(raw / 50) * 50;
  const widths = Array.from({ length: safeCount }, () => rounded);
  const used = rounded * safeCount;
  widths[widths.length - 1] += totalWidth - used;
  return widths;
};

export const MODULE_DEFAULT_W = 600;

let _idCounter = 1;
export const genModuleId = () => `mod-${_idCounter++}-${Date.now().toString(36)}`;

export const createPlannerState = (presetId: CabinetCategory): PlannerState => {
  const preset = getPresetById(presetId);
  return {
    presetId,
    width: preset.defaultWidth,
    height: preset.defaultHeight,
    depth: preset.defaultDepth,
    lowerCount: preset.lowerCount,
    upperCount: preset.upperCount,
    lowerModules: [],
    upperModules: [],
    material: 'cream',
    moldingH: preset.defaultMoldingH,
    toeKickH: preset.toeKickHeight,
    finishLeftW: 60,
    finishRightW: 60,
    secondaryFillerW: 60,
    distributorStart: null,
    distributorEnd: null,
    ventStart: null,
  };
};

// ── 자동계산: 설비 기준 모듈 자동 배치 (calc-engine.js 포팅) ──

import {
  DOOR_TARGET, DOOR_MIN, DOOR_MAX,
  SINK_W_SMALL, SINK_W_LARGE, SINK_MAX_W, LT_MAX_W,
  COOK_FIXED_W, LT_FIXED_W, HOOD_DEFAULT_W, SIDE_PANEL,
} from './calc-constants';
import {
  distributeModules, adjustFixedPositions, calculateGaps,
  fillGapWithModules, type FixedModule, type GapSpace,
} from './calc-utils';

/** distributeModules 결과를 ModuleEntry[]로 변환 (_x 좌표 포함) */
function distToEntries(gap: GapSpace, kind: ModuleKind = 'door', type?: ModuleType): (ModuleEntry & { _x: number })[] {
  const filled = fillGapWithModules(gap);
  return filled.map((m) => ({
    id: genModuleId(),
    kind,
    width: m.w,
    moduleType: type,
    doorCount: m.is2D ? 2 : 1,
    _x: m.x,
  }));
}

/** 갭 흡수: 350mm 미만 공간을 인접 모듈에 합치기 */
function absorbSmallGaps(
  modules: ModuleEntry[],
  smallGaps: GapSpace[],
  fixedModules?: FixedModule[],
): void {
  if (smallGaps.length === 0) return;
  let remaining = smallGaps.reduce((s, g) => s + g.width, 0);

  // 1순위: 일반 모듈 (450mm 기준 편차 큰 순)
  const sorted = [...modules].sort((a, b) => {
    const aDoorW = (a.doorCount ?? 1) >= 2 ? a.width / 2 : a.width;
    const bDoorW = (b.doorCount ?? 1) >= 2 ? b.width / 2 : b.width;
    return Math.abs(bDoorW - DOOR_TARGET) - Math.abs(aDoorW - DOOR_TARGET);
  });
  for (const mod of sorted) {
    if (remaining <= 0) break;
    mod.width += remaining;
    remaining = 0;
  }

  if (remaining <= 0 || !fixedModules) return;

  // 2순위: 개수대 (SINK_MAX_W 이내)
  const sinkFixed = fixedModules.find((f) => f.type === 'sink');
  if (remaining > 0 && sinkFixed) {
    const canAbsorb = Math.min(remaining, SINK_MAX_W - sinkFixed.w);
    if (canAbsorb > 0) { sinkFixed.w += canAbsorb; remaining -= canAbsorb; }
  }

  // 3순위: LT망장 (LT_MAX_W 이내)
  const ltFixed = fixedModules.find((f) => f.name === 'LT망장');
  if (remaining > 0 && ltFixed) {
    const canAbsorb = Math.min(remaining, LT_MAX_W - ltFixed.w);
    if (canAbsorb > 0) { ltFixed.w += canAbsorb; remaining -= canAbsorb; }
  }
}

export function autoCalculateModules(state: PlannerState): { lower: ModuleEntry[]; upper: ModuleEntry[] } {
  const preset = getPresetById(state.presetId);
  const fL = state.finishLeftW ?? 60;
  const fR = state.finishRightW ?? 60;
  const effectiveW = Math.max(0, state.width - fL - fR);
  const startBound = fL;
  const endBound = startBound + effectiveW;

  if (effectiveW < DOOR_MIN) {
    return effectiveW > 0
      ? { lower: [{ id: genModuleId(), kind: 'door', width: effectiveW }], upper: [] }
      : { lower: [], upper: [] };
  }

  // ═══════════════════════════════════════════
  // 하부장
  // ═══════════════════════════════════════════
  const lower: ModuleEntry[] = [];

  if (preset.id === 'sink' || preset.id === 'vanity') {
    // ── 유틸리티 좌표 계산 ──
    const SINK_DEF_W = state.width > 2500 ? SINK_W_LARGE : SINK_W_SMALL;
    const distStart = state.distributorStart ?? Math.round(SINK_DEF_W * 0.15);
    const distEnd = state.distributorEnd ?? Math.round(SINK_DEF_W * 0.15 + 700);
    const ventPos = state.ventStart ?? Math.round(SINK_DEF_W * 0.7);

    // 절대 좌표 (좌측 기준)
    const dStartAbs = distStart > 0 ? Math.max(startBound, Math.min(endBound, startBound + distStart)) : 0;
    const dEndAbs = distEnd > distStart ? Math.max(startBound, Math.min(endBound, startBound + distEnd)) : 0;
    const ventAbs = ventPos > 0 ? Math.max(startBound, Math.min(endBound, startBound + ventPos)) : 0;

    // ── 고정 모듈 배치 ──
    const fixedList: FixedModule[] = [];

    // ① 가스대: 환풍구 중심 배치 (vanity는 가스대 없음)
    if (preset.id === 'sink') {
      const cookW = COOK_FIXED_W;
      let cookX = ventAbs > 0 ? ventAbs - cookW / 2 : endBound - cookW;
      cookX = Math.max(startBound, Math.min(endBound - cookW, cookX));
      fixedList.push({ id: genModuleId(), type: 'cook', name: '가스대', x: cookX, endX: cookX + cookW, w: cookW });

      // ③ LT망장: 가스대 옆 벽쪽
      const ltX = cookX + cookW; // 좌측기준: 가스대 우측
      const ltXClamped = Math.max(startBound, Math.min(endBound - LT_FIXED_W, ltX));
      fixedList.push({ id: genModuleId(), type: 'storage', name: 'LT망장', x: ltXClamped, endX: ltXClamped + LT_FIXED_W, w: LT_FIXED_W, isDrawer: true });
    }

    // ② 개수대: 분배기 포함
    let sinkW: number, sinkX: number;
    const cookEntry = fixedList.find((f) => f.type === 'cook');
    const sinkZoneStart = startBound;
    const sinkZoneEnd = cookEntry ? cookEntry.x : endBound;
    const zoneW = sinkZoneEnd - sinkZoneStart;

    if (dStartAbs > 0 && dEndAbs > dStartAbs) {
      const distSpan = dEndAbs - dStartAbs;
      sinkW = Math.max(SINK_W_SMALL, Math.min(SINK_MAX_W, distSpan + SIDE_PANEL * 2));
      if (sinkW > zoneW && zoneW > 0) sinkW = zoneW;
      sinkX = Math.max(sinkZoneStart, dStartAbs - SIDE_PANEL);
      sinkX = Math.max(sinkZoneStart, Math.min(sinkZoneEnd - sinkW, sinkX));
    } else {
      sinkW = SINK_DEF_W;
      if (sinkW > zoneW && zoneW > 0) sinkW = zoneW;
      sinkX = sinkZoneStart;
    }
    sinkX = Math.max(sinkZoneStart, Math.min(sinkZoneEnd - sinkW, sinkX));
    fixedList.push({ id: genModuleId(), type: 'sink', name: '개수대', x: sinkX, endX: sinkX + sinkW, w: sinkW });

    // ── 겹침 방지 (가스대 > 개수대 > LT) ──
    fixedList.sort((a, b) => a.x - b.x);
    for (let i = 1; i < fixedList.length; i++) {
      const prev = fixedList[i - 1];
      const curr = fixedList[i];
      const overlap = prev.endX - curr.x;
      if (overlap > 0) {
        if (curr.type === 'cook') {
          prev.w = Math.max(0, prev.w - overlap);
          prev.endX = prev.x + prev.w;
        } else {
          curr.x = prev.endX;
          curr.endX = curr.x + curr.w;
          if (curr.endX > endBound) { curr.w = Math.max(0, endBound - curr.x); curr.endX = curr.x + curr.w; }
        }
      }
    }

    // ── 빈 공간 채우기 ──
    const gaps = calculateGaps(fixedList, startBound, endBound);
    const fillable: GapSpace[] = [];
    const smallGaps: GapSpace[] = [];
    gaps.forEach((g) => { if (g.width >= DOOR_MIN) fillable.push(g); else if (g.width > 0) smallGaps.push(g); });

    const newModules: (ModuleEntry & { _x: number })[] = [];
    fillable.forEach((gap) => { newModules.push(...distToEntries(gap, 'door', 'storage')); });

    // 갭 흡수
    absorbSmallGaps(newModules, smallGaps, fixedList);

    // ── 고정 모듈 → ModuleEntry 변환 ──
    fixedList.forEach((f) => {
      if (f.w <= 0) return;
      newModules.push({
        id: f.id,
        kind: f.isDrawer ? 'drawer' as ModuleKind : 'door' as ModuleKind,
        width: f.w,
        moduleType: f.type as ModuleType,
        _x: f.x,
      });
    });

    // _x 기준 정렬 후 lower에 추가
    newModules.sort((a, b) => a._x - b._x);
    newModules.forEach((m) => { const { _x, ...rest } = m; lower.push(rest); });
  } else if (preset.id === 'fridge') {
    // ── 냉장고장: 냉장고 니치(900mm, open) + 나머지 균등 분배 ──
    const FRIDGE_NICHE_W = 900;
    if (effectiveW <= FRIDGE_NICHE_W + DOOR_MIN) {
      // 공간이 좁으면 니치만
      const nicheW = Math.min(FRIDGE_NICHE_W, effectiveW);
      lower.push({ id: genModuleId(), kind: 'open', width: nicheW, moduleType: 'storage' });
      const rest = effectiveW - nicheW;
      if (rest >= DOOR_MIN) {
        const gap: GapSpace = { start: startBound + nicheW, end: endBound, width: rest };
        lower.push(...distToEntries(gap).map(({ _x, ...m }) => m));
      }
    } else {
      // 냉장고 니치는 우측 벽 쪽 배치 (표준 배치)
      const nicheX = endBound - FRIDGE_NICHE_W;
      const leftGap: GapSpace = { start: startBound, end: nicheX, width: nicheX - startBound };
      const leftMods = distToEntries(leftGap).sort((a, b) => a._x - b._x);
      leftMods.forEach(({ _x, ...m }) => lower.push(m));
      lower.push({ id: genModuleId(), kind: 'open', width: FRIDGE_NICHE_W, moduleType: 'storage' });
    }
  } else {
    // ── 비싱크대: 균등 분배 (2D 페어링 + 잔여 최적화) ──
    const gap: GapSpace = { start: startBound, end: endBound, width: effectiveW };
    const mods = distToEntries(gap).sort((a, b) => a._x - b._x);
    mods.forEach(({ _x, ...m }) => lower.push(m));
  }

  // 하부장 총 폭 보정
  const lowerSum = lower.reduce((s, m) => s + m.width, 0);
  if (lower.length > 0 && lowerSum !== effectiveW) {
    lower[lower.length - 1].width += effectiveW - lowerSum;
  }

  // 안전장치
  if (lower.length > 30) {
    return { lower: lower.filter((m) => m.moduleType === 'sink' || m.moduleType === 'cook'), upper: [] };
  }

  // ═══════════════════════════════════════════
  // 상부장
  // ═══════════════════════════════════════════
  const upper: ModuleEntry[] = [];

  if (!preset.fullHeight && preset.upperHeight > 0) {
    const ventPos = state.ventStart ?? 0;
    const ventAbs = ventPos > 0 ? Math.max(startBound, Math.min(endBound, startBound + ventPos)) : 0;

    // 하부장에서 개수대/가스대 위치 추출
    let sinkCenterX = 0, cookCenterX = 0;
    let cx = startBound;
    lower.forEach((m) => {
      if (m.moduleType === 'sink') sinkCenterX = cx + m.width / 2;
      if (m.moduleType === 'cook') cookCenterX = cx + m.width / 2;
      cx += m.width;
    });

    const fixedList: FixedModule[] = [];

    // ① 후드장: 환풍구 중심 → 가스대 위 폴백
    const hoodW = Math.min(HOOD_DEFAULT_W, effectiveW);
    let hoodX: number;
    if (ventAbs > 0) hoodX = ventAbs - hoodW / 2;
    else if (cookCenterX > 0) hoodX = cookCenterX - hoodW / 2;
    else hoodX = endBound - hoodW;
    hoodX = Math.max(startBound, Math.min(endBound - hoodW, hoodX));
    fixedList.push({ id: genModuleId(), type: 'hood', name: '후드장', x: hoodX, endX: hoodX + hoodW, w: hoodW });

    // ② 기준상부장(2D): 개수대 위 정렬 (후드와 겹치면 스킵)
    if (sinkCenterX > 0) {
      const sinkMod = lower.find((m) => m.moduleType === 'sink');
      const refW = sinkMod ? Math.min(SINK_MAX_W, sinkMod.width) : SINK_W_SMALL;
      let refX = sinkCenterX - refW / 2;
      refX = Math.max(startBound, Math.min(endBound - refW, refX));
      const overlapsHood = refX < hoodX + hoodW && refX + refW > hoodX;
      if (!overlapsHood) {
        fixedList.push({ id: genModuleId(), type: 'storage', name: '기준상부장', x: refX, endX: refX + refW, w: refW, is2door: true });
      }
    }

    // ── 빈 공간 채우기 ──
    const adjustedFixed = adjustFixedPositions(fixedList, startBound, endBound);
    const gaps = calculateGaps(adjustedFixed, startBound, endBound);
    const fillable: GapSpace[] = [];
    const smallGaps: GapSpace[] = [];
    gaps.forEach((g) => { if (g.width >= DOOR_MIN) fillable.push(g); else if (g.width > 0) smallGaps.push(g); });

    const newModules: (ModuleEntry & { _x: number })[] = [];
    fillable.forEach((gap) => { newModules.push(...distToEntries(gap, 'door', 'storage')); });

    // 갭 흡수
    absorbSmallGaps(newModules, smallGaps);

    // 고정 모듈 → ModuleEntry
    adjustedFixed.forEach((f) => {
      if (f.w <= 0) return;
      newModules.push({
        id: f.id,
        kind: f.type === 'hood' ? 'open' as ModuleKind : 'door' as ModuleKind,
        width: f.w,
        moduleType: f.type === 'hood' ? 'hood' as ModuleType : 'storage' as ModuleType,
        doorCount: (f as any).is2door ? 2 : undefined,
        _x: f.x,
      });
    });

    // _x 기준 정렬 후 upper에 추가
    newModules.sort((a, b) => a._x - b._x);
    newModules.forEach((m) => { const { _x, ...rest } = m; upper.push(rest); });

    // 상부장 총 폭 보정
    const upperSum = upper.reduce((s, m) => s + m.width, 0);
    if (upper.length > 0 && upperSum !== effectiveW) {
      upper[upper.length - 1].width += effectiveW - upperSum;
    }

    if (upper.length > 30) {
      return { lower, upper: upper.filter((m) => m.moduleType === 'hood') };
    }
  }

  return { lower, upper };
}

const buildModulesFromEntries = (
  entries: ModuleEntry[],
  section: ModuleSection,
  height: number,
  depth: number,
): CabinetModule[] =>
  entries.map((entry) => {
    const isLower = section === 'lower' || section === 'full';
    const isSecondary = entry.orientation === 'secondary' || entry.orientation === 'tertiary';
    // 주선 하부/풀하이트: 상판(실측 depth) 기준으로 재귀(recess)
    //   door/drawer → 도어 20T 앞쪽 생성, 모듈 본체 + 도어 합계 = depth - 10 (상판이 10mm 오버행)
    //   open → depth - 30 (상판이 30mm 오버행)
    // 상부장/차선모듈은 기존 depth 유지
    // 모듈별 깊이 결정
    // 상판(counter) depth가 기준(650), 모듈은 타입별 고정 깊이 사용
    let effDepth = depth;
    if (isSecondary) {
      // 차선모듈: 전달받은 depth 그대로 사용 (하부=counter depth, 상부=upperDepth)
      effDepth = depth;
    } else if (isLower) {
      // 하부 모듈: 타입별 깊이 — sink=600, 일반/cook=550
      const baseDepth = entry.moduleType === 'sink' ? 600 : 550;
      effDepth = baseDepth;
    }
    return {
      id: entry.id,
      section,
      kind: entry.kind,
      width: entry.width,
      height,
      depth: effDepth,
      moduleType: entry.moduleType,
      doorCount: entry.doorCount,
      drawerCount: entry.drawerCount,
      orientation: entry.orientation,
      blindAnchorId: entry.blindAnchorId,
    };
  });

export const deriveCabinet = (state: PlannerState): DerivedCabinet => {
  const preset = getPresetById(state.presetId);
  const width = clamp(Math.round(state.width), 600, 6000);
  const height = clamp(Math.round(state.height), 700, 2800);
  const depth = clamp(Math.round(state.depth), 220, 900);
  const lowerEntries = state.lowerModules ?? [];
  const upperEntries = state.upperModules ?? [];
  const lowerCount = lowerEntries.length;
  const upperCount = upperEntries.length;
  const moldingH = clamp(Math.round(state.moldingH ?? 0), 0, 120);
  const toeKickH = clamp(Math.round(state.toeKickH ?? 0), 0, 300);
  const finishLeftW = clamp(Math.round(state.finishLeftW ?? 0), 0, 200);
  const finishRightW = clamp(Math.round(state.finishRightW ?? 0), 0, 200);
  const secondaryFillerW = clamp(Math.round(state.secondaryFillerW ?? 60), 0, 200);

  const effectiveWidth = Math.max(0, width - finishLeftW - finishRightW);
  const counterThickness = preset.hasCountertop ? preset.counterThickness : 0;
  const upperDepth = preset.fullHeight ? depth : preset.upperDepth;

  // --- 실측 기준 Y 좌표 계산 (바닥 Y=0) ---
  // 하부장: 걸레받이 위에 배치
  const lowerBodyH = preset.fullHeight
    ? Math.max(0, height - moldingH - toeKickH)
    : Math.min(preset.lowerHeight - toeKickH, height - toeKickH);
  const lowerBottomY = toeKickH;
  const lowerTopY = lowerBottomY + lowerBodyH;

  // 상부장: 천장 몰딩 아래에 배치
  const upperHeight = preset.fullHeight ? 0 : Math.min(preset.upperHeight, Math.max(0, height - moldingH - lowerTopY - counterThickness));
  const upperTopY = height - moldingH;
  const upperBottomY = upperTopY - upperHeight;

  // 상부장 Z offset: 벽 쪽으로 후퇴 (하부장보다 얕음)
  const upperZOffset = preset.fullHeight ? 0 : -(depth - upperDepth) / 2;

  const parts: CabinetPart[] = [];

  // 차선모듈 체인 수집 (걸레받이/상판/몰딩/마감재 재배치용)
  interface SecondaryChain {
    section: 'lower' | 'upper';
    xCenter: number;          // 월드 X 중심
    xExtent: number;          // 월드 X extent (차선모듈 depth = 600)
    startZ: number;           // 월드 Z 근접 edge (주선 정면)
    endZ: number;             // 월드 Z 원접 edge (자유단: 차선모듈 몸체 끝)
    anchorRightX: number;     // 주선 앵커의 오른쪽 edge
    primaryFrontEdgeZ: number; // 주선 상판의 정면 끝 Z (= moduleDepth/2 + 9 오버행)
    bodyH: number;            // 모듈 본체 높이
    bottomY: number;          // 모듈 본체 Y 바닥
  }
  const secondaryChains: SecondaryChain[] = [];

  // --- 모듈 생성 (개별 배열 기반) ---
  const modules: CabinetModule[] = [
    ...buildModulesFromEntries(lowerEntries, preset.fullHeight ? 'full' : 'lower', lowerBodyH, depth),
    ...(upperHeight > 0 ? buildModulesFromEntries(upperEntries, 'upper', upperHeight, upperDepth) : []),
  ];

  // 모듈 X offset: 좌측 마감재 이후부터 시작 (상부/하부 각각 독립 cursor)
  const moduleStartX = -width / 2 + finishLeftW;

  const renderModules = (list: CabinetModule[]): ModuleLayout | null => {
    if (list.length === 0) return null;
    const startX = moduleStartX;
    let cursor = startX;
    const isUpper = list[0].section === 'upper';
    const centerY = isUpper ? upperBottomY + list[0].height / 2 : lowerBottomY + list[0].height / 2;
    const z = isUpper ? upperZOffset : 0;
    // 주선 기준 "상판 앞 edge" Z (하부: 실측 depth의 절반, 상부: 상부장 앞면)
    // 하부 모듈은 kind별 재귀(recess)가 적용되므로 moduleDepth ≠ counterDepth
    // → 상판/차선체인 기준은 실측 depth 사용
    const counterFrontZ = isUpper ? upperZOffset + upperDepth / 2 : depth / 2;
    const counterBackZ = isUpper ? upperZOffset - upperDepth / 2 : -depth / 2;

    const ESSENTIAL_TYPES: ModuleType[] = ['sink', 'cook', 'hood'];

    // 차선모듈 체인용 Z 커서 — 연속된 secondary 엔트리를 Z축으로 쌓음
    let secNearZ: number | null = null; // 현재 체인의 다음 모듈 근접(near) 면 Z
    let curChain: SecondaryChain | null = null; // 현재 진행중인 체인

    list.forEach((module, idx) => {
      const y = isUpper ? upperBottomY + module.height / 2 : lowerBottomY + module.height / 2;
      const isEssential = !!module.moduleType && ESSENTIAL_TYPES.includes(module.moduleType);
      const isSecondary = module.orientation === 'secondary' || module.orientation === 'tertiary';
      const isTertiary = module.orientation === 'tertiary';

      if (isSecondary) {
        // 차선모듈 ㄱ자 배치: 앵커(주선) 모듈 끝에 밀착하여 Z축(정면) 방향으로 돌출
        // 체인 지원: 여러 차선모듈이 연속되면 Z축으로 순차 배치
        // 좌측 차선: cursor 위치(startX)에서 방 안쪽(+X)으로 연장
        // 우측 차선: cursor 위치(endX)에서 방 안쪽(-X)으로 연장
        // 상부장: 벽(counterBackZ)에서 시작 → 코너가 주선과 자연스럽게 이어짐
        // 하부장: 상판 앞면(counterFrontZ)에서 시작 → 상판이 코너를 덮음
        // 사용자 설정 우선, 없으면 cursor 위치로 자동 판단
        // tertiary는 secondary 반대편에 배치
        const secondarySide = state.secondaryStartSide
          ? state.secondaryStartSide === 'left'
          : Math.abs(cursor - startX) < 1;
        const isLeftChain = isTertiary ? !secondarySide : secondarySide;
        if (secNearZ === null) {
          // 상부·하부 모두 counterFrontZ(앞면)에서 시작 → 방 안쪽(+Z)으로 연장
          // counterBackZ 에서 시작하면 blind panel과 Z가 겹침
          secNearZ = counterFrontZ;
          curChain = {
            section: isUpper ? 'upper' : 'lower',
            xCenter: isLeftChain ? cursor + module.depth / 2 : cursor - module.depth / 2,
            xExtent: module.depth,
            startZ: secNearZ,
            endZ: secNearZ,
            anchorRightX: isLeftChain ? cursor + module.depth : cursor,
            primaryFrontEdgeZ: counterFrontZ, // 상판 정면 edge (실측: +9 오버행 제거)
            bodyH: module.height,
            bottomY: isUpper ? upperBottomY : lowerBottomY,
          };
        }
        const perpX = isLeftChain ? cursor + module.depth / 2 : cursor - module.depth / 2;
        const perpZ = secNearZ + module.width / 2;
        secNearZ += module.width;
        if (curChain) curChain.endZ = secNearZ;
        // 체인 종료 판정: 마지막이거나 다음 모듈의 orientation이 다름
        const isLastInChain = idx === list.length - 1 || list[idx + 1].orientation !== module.orientation;
        if (isLastInChain && curChain) {
          secondaryChains.push(curChain);
          curChain = null;
          secNearZ = null; // 체인 종료 시 Z 커서 초기화 (secondary→tertiary 전환 대비)
        }
        parts.push({
          id: module.id,
          label: `${module.section}-${module.kind}-${isTertiary ? 'tertiary' : 'secondary'}`,
          x: perpX,
          y,
          z: perpZ,
          width: module.width,
          height: module.height,
          depth: module.depth,
          colorKey: isUpper ? 'accent' : 'body',
          essential: isEssential,
          moduleType: module.moduleType,
          moduleKind: module.kind,
          doorCount: module.doorCount,
          drawerCount: module.drawerCount,
          rotationY: isLeftChain ? Math.PI / 2 : -Math.PI / 2, // 좌: +90°, 우: -90°
        });
        // 차선모듈은 주선의 X축 cursor를 증가시키지 않음
      } else {
        secNearZ = null; // 주선 모듈을 만나면 차선 체인 종료
        curChain = null;
        const centeredX = cursor + module.width / 2;
        // 주선 하부: 상판 앞면에서 30mm 안쪽 정렬 (모듈 앞면 = counterFrontZ - 30)
        // 주선 상부: 기존 upperZOffset 유지
        const COUNTER_INSET = 30; // 상판 앞면 대비 모듈 후퇴량 (mm)
        const primaryZ = isUpper ? z : (counterFrontZ - COUNTER_INSET - module.depth / 2);
        parts.push({
          id: module.id,
          label: `${module.section}-${module.kind}`,
          x: centeredX,
          y,
          z: primaryZ,
          width: module.width,
          height: module.height,
          depth: module.depth,
          colorKey: isUpper ? 'accent' : 'body',
          essential: isEssential,
          moduleType: module.moduleType,
          moduleKind: module.kind,
          doorCount: module.doorCount,
          drawerCount: module.drawerCount,
        });
        cursor += module.width;
      }
    });

    const normalRef = list.find((m) => m.orientation !== 'secondary' && m.orientation !== 'tertiary') ?? list[0];
    return { section: isUpper ? 'upper' : 'lower', startX, endX: cursor, centerY, z, depth: normalRef.depth };
  };

  const lowerModules = modules.filter((m) => m.section !== 'upper');
  const upperModules = modules.filter((m) => m.section === 'upper');
  const lowerLayout = renderModules(lowerModules);
  const upperLayout = renderModules(upperModules);

  const hasFinish = finishLeftW > 0 || finishRightW > 0 || moldingH > 0 || toeKickH > 0;

  // 차선 체인이 각 섹션 좌/우 단부에 있는지 판정 (마감재 생략 + 상판/몰딩 벽까지 확장)
  const hasLowerRightChain = secondaryChains.some(c => c.section === 'lower' && Math.abs(c.anchorRightX - (lowerLayout?.endX ?? Number.NEGATIVE_INFINITY)) < 1);
  const hasLowerLeftChain = secondaryChains.some(c => c.section === 'lower' && Math.abs((c.anchorRightX - c.xExtent) - (lowerLayout?.startX ?? Number.POSITIVE_INFINITY)) < 1);
  const hasUpperRightChain = secondaryChains.some(c => c.section === 'upper' && Math.abs(c.anchorRightX - (upperLayout?.endX ?? Number.NEGATIVE_INFINITY)) < 1);
  const hasUpperLeftChain = secondaryChains.some(c => c.section === 'upper' && Math.abs((c.anchorRightX - c.xExtent) - (upperLayout?.startX ?? Number.POSITIVE_INFINITY)) < 1);

  /** 차선 체인이 벽측 마감재를 대체하는 경우, 차선 요소의 X 오버행을 벽까지 확장 */
  const chainOuterExtend = (ch: SecondaryChain, baseOverhang = 9): { cx: number; width: number } => {
    const isRight = ch.section === 'lower'
      ? Math.abs(ch.anchorRightX - (lowerLayout?.endX ?? -Infinity)) < 1
      : Math.abs(ch.anchorRightX - (upperLayout?.endX ?? -Infinity)) < 1;
    const isLeft = ch.section === 'lower'
      ? Math.abs((ch.anchorRightX - ch.xExtent) - (lowerLayout?.startX ?? Infinity)) < 1
      : Math.abs((ch.anchorRightX - ch.xExtent) - (upperLayout?.startX ?? Infinity)) < 1;
    const outerRight = isRight ? finishRightW : baseOverhang;
    const outerLeft = isLeft ? finishLeftW : baseOverhang;
    return {
      cx: ch.xCenter + (outerRight - outerLeft) / 2,
      width: ch.xExtent + outerLeft + outerRight,
    };
  };

  // --- 마감재 (실측 완료 시 모듈 없어도 표시) ---

  // 상몰딩 — 상부장 위에 덮는 방식 (좌우 마감재 위로 올라감)
  // Z를 1mm 앞으로 밀어 좌우 마감재와의 Z-fighting 방지
  if (moldingH > 0) {
    const moldingDepth = preset.fullHeight ? depth : upperDepth;
    const moldingZ = preset.fullHeight ? 0 : upperZOffset;
    parts.push({
      id: 'molding-top',
      label: '상몰딩',
      x: 0,
      y: height - moldingH / 2,
      z: moldingZ + 1,
      width,
      height: moldingH,
      depth: moldingDepth + 6,
      colorKey: 'trim',
    });
  }

  // 걸레받이 — 바닥 위, 유효폭
  if (toeKickH > 0) {
    parts.push({
      id: 'toekick',
      label: '걸레받이',
      x: 0,
      y: toeKickH / 2,
      z: -20,
      width: effectiveWidth,
      height: toeKickH,
      depth: depth - 40,
      colorKey: 'trim',
    });
    // 차선모듈 체인용 걸레받이 — 모듈 본체 영역만 (휠라 제외), 40mm 리세스
    secondaryChains.filter(c => c.section === 'lower').forEach((ch, i) => {
      const chLen = ch.endZ - ch.startZ;
      parts.push({
        id: `toekick-sec-${i}`,
        label: '걸레받이(차선)',
        x: ch.xCenter,
        y: toeKickH / 2,
        z: ch.startZ + chLen / 2 + 20,
        width: ch.xExtent - 40,
        height: toeKickH,
        depth: chLen - 40,
        colorKey: 'trim',
      });
    });
  }

  // 차선 체인 안쪽 측판(inner side panel) — 앵커(멍장) 쪽 측면에 마감재 색상으로 렌더
  // 위치: 체인의 startZ (주선 상판 앞 edge)를 중심으로 18mm 두께
  // 역할: 멍장(앵커 주선 모듈)과 차선 체인 첫 모듈 사이의 시각적 마감 경계
  // 상부장: 벽에서 시작하므로 코너 측판 불필요 (모듈 자체가 코너를 채움)
  const INNER_PANEL_T = 18;
  secondaryChains.filter(c => c.section === 'lower').forEach((ch, i) => {
    parts.push({
      id: `sec-inner-panel-${ch.section}-${i}`,
      label: '마감재(차선 안쪽)',
      x: ch.xCenter,
      y: ch.bottomY + ch.bodyH / 2,
      z: ch.startZ + INNER_PANEL_T / 2,
      width: ch.xExtent,
      height: ch.bodyH,
      depth: INNER_PANEL_T,
      colorKey: 'trim',
    });
  });

  // 차선모듈 체인용 상판 — 주선 상판 정면 오버행 끝부터 시작, 휠라 위까지 덮음
  // Z 범위: primaryFrontEdgeZ (주선 상판 앞 끝 오버행) → endZ + fillerW (휠라 끝에 딱 맞게)
  // X 범위: 차선 xExtent + 18mm 오버행(외측) — 내측(주선측)은 주선 상판과 맞닿으므로 오버행 없음
  if (preset.hasCountertop && lowerEntries.length > 0) {
    secondaryChains.filter(c => c.section === 'lower').forEach((ch, i) => {
      const secBackZ = ch.primaryFrontEdgeZ;              // 주선 상판 오버행 끝과 플러시
      const secFrontZ = ch.endZ + Math.max(secondaryFillerW, 0); // 휠라 끝과 플러시
      const secZCenter = (secBackZ + secFrontZ) / 2;
      const secZDepth = secFrontZ - secBackZ;
      const { cx, width: xWidth } = chainOuterExtend(ch, 0);
      parts.push({
        id: `countertop-sec-${i}`,
        label: 'countertop-sec',
        x: cx,
        y: lowerTopY + counterThickness / 2,
        z: secZCenter,
        width: xWidth,
        height: counterThickness,
        depth: secZDepth,
        colorKey: 'shadow',
      });
    });
  }

  // 차선모듈 상부장 체인용 상몰딩 연장 — 벽(코너)부터 휠라 끝까지
  if (moldingH > 0) {
    secondaryChains.filter(c => c.section === 'upper').forEach((ch, i) => {
      const secBackZ = ch.startZ; // 상부·하부 모두 counterFrontZ (앞면)에서 시작
      const secFrontZ = ch.endZ + Math.max(secondaryFillerW, 0);
      const secZCenter = (secBackZ + secFrontZ) / 2;
      const secZDepth = secFrontZ - secBackZ;
      const { cx, width: xWidth } = chainOuterExtend(ch, 3);
      parts.push({
        id: `molding-top-sec-${i}`,
        label: '상몰딩(차선)',
        x: cx,
        y: height - moldingH / 2,
        z: secZCenter,
        width: xWidth,
        height: moldingH,
        depth: secZDepth,
        colorKey: 'trim',
      });
    });
  }

  // 좌/우 마감재 — 하부장/상부장 별도 (실측 기준 Y 정렬)
  // 차선모듈이 해당 방향·섹션에 있으면 해당 측 primary 마감재 렌더 생략
  // (차선 자유단 휠라가 그 역할 대체)

  const finishSides: Array<{ id: 'left' | 'right'; label: string; x: number; fw: number }> = [];
  if (finishLeftW > 0) finishSides.push({ id: 'left', label: '좌', x: -width / 2 + finishLeftW / 2, fw: finishLeftW });
  if (finishRightW > 0) finishSides.push({ id: 'right', label: '우', x: width / 2 - finishRightW / 2, fw: finishRightW });

  for (const side of finishSides) {
    const skipLower = side.id === 'left' ? hasLowerLeftChain : hasLowerRightChain;
    const skipUpper = side.id === 'left' ? hasUpperLeftChain : hasUpperRightChain;

    if (preset.fullHeight) {
      if (skipLower || skipUpper) continue; // fullHeight: 상·하 통합 — 어느 쪽이든 체인 있으면 생략
      const finishH = height - toeKickH - moldingH;
      parts.push({
        id: `finish-${side.id}`,
        label: `마감재(${side.label})`,
        x: side.x,
        y: toeKickH + finishH / 2,
        z: 0,
        width: side.fw,
        height: finishH,
        depth,
        colorKey: 'trim',
      });
    } else {
      if (!skipLower) {
        const lowerFinishH = lowerBodyH + toeKickH;
        parts.push({
          id: `finish-${side.id}-lower`,
          label: `마감재(${side.label})-하부`,
          x: side.x,
          y: lowerFinishH / 2,
          z: 0,
          width: side.fw,
          height: lowerFinishH,
          depth,
          colorKey: 'trim',
        });
      }
      if (upperHeight > 0 && !skipUpper) {
        // 상몰딩 아래까지만 — 1mm 간격으로 상몰딩이 위에서 덮도록
        const upperFinishH = Math.max(0, upperHeight - 1);
        parts.push({
          id: `finish-${side.id}-upper`,
          label: `마감재(${side.label})-상부`,
          x: side.x,
          y: upperBottomY + upperFinishH / 2,
          z: upperZOffset,
          width: side.fw,
          height: upperFinishH,
          depth: upperDepth,
          colorKey: 'trim',
        });
      }
    }
  }

  // --- 차선모듈 ㄱ자 자유단 마감재 (휠라) — secondaryFillerW 기본 60 ---
  // 차선 체인이 벽측 마감재를 대체하는 경우, 휠라도 벽까지 X 확장
  if (secondaryFillerW > 0) {
    secondaryChains.forEach((ch, i) => {
      const { cx, width: xWidth } = chainOuterExtend(ch, 0);
      if (ch.section === 'lower') {
        const h = ch.bodyH + toeKickH;
        parts.push({
          id: `filler-sec-lower-${i}`,
          label: '휠라(차선)',
          x: cx,
          y: h / 2,
          z: ch.endZ + secondaryFillerW / 2,
          width: xWidth,
          height: h,
          depth: secondaryFillerW,
          colorKey: 'trim',
        });
      } else {
        // 상몰딩 아래까지만 (moldingH 제외 — 상몰딩이 전폭을 커버)
        const h = ch.bodyH;
        parts.push({
          id: `filler-sec-upper-${i}`,
          label: '휠라(차선)',
          x: cx,
          y: upperTopY - h / 2,
          z: ch.endZ + secondaryFillerW / 2,
          width: xWidth,
          height: h,
          depth: secondaryFillerW,
          colorKey: 'trim',
        });
      }
    });
  }

  // --- 설치공간 wireframe (해당 영역에 모듈 없을 때) ---
  if (hasFinish) {
    if (preset.fullHeight) {
      if (lowerCount === 0) {
        const spaceH = height - toeKickH - moldingH;
        parts.push({
          id: 'install-space',
          label: '설치공간',
          x: 0,
          y: toeKickH + spaceH / 2,
          z: 0,
          width: effectiveWidth,
          height: spaceH,
          depth,
          colorKey: 'accent',
          wireframe: true,
        });
      }
    } else {
      if (lowerCount === 0) {
        parts.push({
          id: 'install-space-lower',
          label: '설치공간(하부)',
          x: 0,
          y: lowerBottomY + lowerBodyH / 2,
          z: 0,
          width: effectiveWidth,
          height: lowerBodyH,
          depth,
          colorKey: 'accent',
          wireframe: true,
        });
      }
      if (upperCount === 0 && upperHeight > 0) {
        parts.push({
          id: 'install-space-upper',
          label: '설치공간(상부)',
          x: 0,
          y: upperBottomY + upperHeight / 2,
          z: upperZOffset,
          width: effectiveWidth,
          height: upperHeight,
          depth: upperDepth,
          colorKey: 'accent',
          wireframe: true,
        });
      }
    }
  }

  // --- 유틸리티 (분배기/환풍구) ---
  const autoDistStart = Math.round(width * 0.15);
  const autoDistEnd = Math.round(width * 0.15 + 700);
  const autoVentX = Math.round(width * 0.7);

  const distStart = state.distributorStart === 0 ? null : (state.distributorStart ?? autoDistStart);
  const distEnd = state.distributorEnd === 0 ? null : (state.distributorEnd ?? autoDistEnd);
  const ventX = state.ventStart === 0 ? null : (state.ventStart ?? autoVentX);

  const halfW = width / 2;

  if (distStart != null && distEnd != null && distStart > 0 && distEnd > 0) {
    let dw = Math.abs(distEnd - distStart);
    let cx = -halfW + (distStart + distEnd) / 2;

    // 개수대 모듈 범위 내로 클램핑
    const sinkPart = parts.find(p => p.id.startsWith('mod-') && (p as any).moduleType === 'sink');
    if (sinkPart) {
      const sinkLeft = sinkPart.x - sinkPart.width / 2;
      const sinkRight = sinkPart.x + sinkPart.width / 2;
      const distLeft = cx - dw / 2;
      const distRight = cx + dw / 2;
      // 분배기가 개수대 범위를 초과하면 클램핑
      const clampedLeft = Math.max(sinkLeft + 15, distLeft);
      const clampedRight = Math.min(sinkRight - 15, distRight);
      if (clampedRight > clampedLeft) {
        dw = clampedRight - clampedLeft;
        cx = (clampedLeft + clampedRight) / 2;
      }
    }

    parts.push({
      id: 'utility-distributor',
      label: '분배기',
      x: cx,
      y: lowerBottomY + 40,
      z: -depth / 2 - 80,
      width: dw,
      height: 80,
      depth: 40,
      colorKey: 'body',
      wireframe: false,
    });
  }

  if (ventX != null && ventX > 0 && !preset.fullHeight) {
    parts.push({
      id: 'utility-vent',
      label: '환풍구',
      x: -halfW + ventX,
      y: upperTopY - 30,
      z: upperZOffset - upperDepth / 2 - 60,
      width: 200,
      height: 80,
      depth: 40,
      colorKey: 'body',
      wireframe: false,
    });
  }

  // Countertop — 하부장 상단, 실측 정보(width × depth) 그대로
  // 차선 체인이 있는 측은 마감재 영역만큼 X 범위를 좁혀 차선 상판과 플러시 정렬
  if (preset.hasCountertop && lowerCount > 0) {
    const leftExclude = hasLowerLeftChain ? finishLeftW : 0;
    const rightExclude = hasLowerRightChain ? finishRightW : 0;
    const counterWidth = Math.max(0, width - leftExclude - rightExclude);
    const counterX = (leftExclude - rightExclude) / 2;
    parts.push({
      id: 'countertop',
      label: 'countertop',
      x: counterX,
      y: lowerTopY + counterThickness / 2,
      z: 0,
      width: counterWidth,
      height: counterThickness,
      depth, // 실측 depth 그대로 (+18 오버행 제거)
      colorKey: 'shadow',
    });
  }

  if (preset.id === 'fridge' && lowerCount > 0) {
    parts.push({
      id: 'fridge-cavity',
      label: 'fridge-cavity',
      x: -width * 0.18,
      y: height * 0.42,
      z: 0,
      width: width * 0.34,
      height: height * 0.78,
      depth: depth - 60,
      colorKey: 'accent',
      wireframe: true,
    });
  }

  if (preset.id === 'vanity' && lowerCount > 0) {
    parts.push({
      id: 'mirror',
      label: 'mirror',
      x: 0,
      y: lowerTopY + upperHeight * 0.45,
      z: depth / 2 + 20,
      width: width * 0.7,
      height: Math.max(600, upperHeight * 0.8),
      depth: 8,
      colorKey: 'accent',
    });
  }

  const footprintAreaM2 = Number(((width * depth) / 1_000_000).toFixed(2));
  const facadeAreaM2 = Number(((width * height) / 1_000_000).toFixed(2));
  const estimatedBoardAreaM2 = Number(
    (((width * height * 2 + width * depth * 2 + height * depth * 2) / 1_000_000) * 1.15).toFixed(2)
  );

  return {
    preset,
    parts,
    modules,
    lowerLayout,
    upperLayout,
    utilities: { distributorStart: distStart, distributorEnd: distEnd, ventStart: ventX },
    footprintAreaM2,
    facadeAreaM2,
    estimatedBoardAreaM2,
  };
};

export const formatMillimeters = (value: number) => `${Math.round(value).toLocaleString('ko-KR')} mm`;
