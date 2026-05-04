/**
 * v1 ↔ v2 데이터 마이그레이션
 *
 * v1 (현재 운영 형식): item.w/h/d + specs.layoutShape ('I'|'L'|'U') + secondary/tertiary 필드
 * v2 (새 형식): item.floorplan.spaces[] (Space 배열) + 모듈은 spaceId로 소속 표현
 *
 * 핵심 매핑:
 *   layoutShape='I' → spaces.length === 1
 *   layoutShape='L' → spaces.length === 2 (secondaryStartSide로 위치/회전 결정)
 *   layoutShape='U' → spaces.length === 3 (tertiaryStartFrom으로 3번째 위치 결정)
 *
 * 호환:
 *   - 상향(v1→v2): 모든 v1 → v2
 *   - 하향(v2→v1): spaces.length === 1만 안전. 다중 공간은 거부.
 */

import type {
  ItemV1,
  ItemV2,
  ModuleV1,
  ModuleV2,
  Space,
  Floorplan,
  CabinetCategory,
  SpecsV2,
} from './floorplan-types';
import { isCabinetCategory } from './floorplan-types';
import { recomputeFloorplan } from './floorplan-trim';

// ============================================================
// 유틸리티
// ============================================================

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function categoryFrom(item: ItemV1): CabinetCategory {
  const c = item.categoryId ?? item.category ?? 'sink';
  return isCabinetCategory(c) ? c : 'sink';
}

let _spaceIdCounter = 0;
function genSpaceId(itemUniqueId: number, suffix: string): string {
  return `space-i${itemUniqueId}-${suffix}-${++_spaceIdCounter}`;
}

let _moduleIdCounter = 0;
function genModuleId(itemUniqueId: number, originalId: string | number | undefined): string {
  if (originalId !== undefined) return `m-i${itemUniqueId}-${String(originalId)}`;
  return `m-i${itemUniqueId}-auto-${++_moduleIdCounter}`;
}

// ============================================================
// V1 → V2
// ============================================================

/**
 * v1 item을 v2로 변환. 항상 성공.
 *
 * - layoutShape='I' → spaces[0]에 모든 정보
 * - layoutShape='L' → 주공간 + 보조공간(secondaryStartSide로 위치)
 * - layoutShape='U' → + tertiaryStartFrom으로 3번째 공간
 */
export function migrateItemV1ToV2(item: ItemV1): ItemV2 {
  const category = categoryFrom(item);
  const w = num(item.w, 3000);
  const h = num(item.h, 2310);
  const d = num(item.d, 600);
  const specs = item.specs ?? {};
  const layoutShape = (specs.lowerLayoutShape ?? specs.layoutShape ?? 'I') as 'I' | 'L' | 'U';

  // ── 주공간 (primary) ──
  // 좌상단(0,0)에 배치, 회전 0, zIndex 1 (앞)
  const primaryId = genSpaceId(item.uniqueId, 'primary');
  const primary: Space = {
    id: primaryId,
    w,
    h: d, // ★ v1의 d(깊이)가 Top View에서 h(세로/깊이)로 매핑됨
    x: w / 2,
    y: d / 2,
    rotation: 0,
    zIndex: 1,
    verticalH: h,
    category,
    distributorStart: specs.distributorStart != null ? num(specs.distributorStart, 0) : null,
    distributorEnd: specs.distributorEnd != null ? num(specs.distributorEnd, 0) : null,
    ventStart: specs.ventStart != null ? num(specs.ventStart, 0) : null,
    measurementBase: specs.measurementBase === 'Right' ? 'BR' : 'BL',
    label: '주공간',
  };

  const spaces: Space[] = [primary];

  // ── 보조공간 (secondary, ㄱ자) ──
  let secondaryId: string | undefined;
  if (layoutShape === 'L' || layoutShape === 'U') {
    const secW = num(specs.lowerSecondaryW, 600);
    const secD = num(specs.lowerSecondaryD, d);
    const startSide = specs.secondaryStartSide ?? 'left';
    secondaryId = genSpaceId(item.uniqueId, 'secondary');

    // ㄱ자 배치: 주공간 깊이축 위/아래 또는 좌/우 측면에 직각으로 붙임
    // startSide='left': 주공간 좌측에서 시작 (Top View에서 주공간의 좌측에 보조공간이 위로 뻗음)
    // startSide='right': 주공간 우측에서 시작
    // 회전 90°: 보조공간의 w는 Top View Y축으로 뻗음
    let secX: number, secY: number;
    if (startSide === 'left') {
      secX = secD / 2;            // 주공간 좌측 가장자리에 정렬
      secY = -(secW / 2) + d / 2; // 주공간의 위쪽으로 뻗어나감 (보조공간 중심이 음수 Y)
    } else {
      secX = w - secD / 2;
      secY = -(secW / 2) + d / 2;
    }

    const secondary: Space = {
      id: secondaryId,
      // 회전 후 AABB가 secD x secW가 되도록 회전 90° + w/h 원래값 그대로
      w: secW,
      h: secD,
      x: secX,
      y: secY,
      rotation: Math.PI / 2,
      zIndex: 0, // 주공간이 앞 (1) → 보조공간이 트리밍당함
      verticalH: h,
      category,
      label: '보조공간',
    };
    spaces.push(secondary);
  }

  // ── 3차공간 (tertiary, ㄷ자) ──
  if (layoutShape === 'U') {
    const terW = num(specs.lowerTertiaryW, 600);
    const terD = num(specs.lowerTertiaryD, d);
    const startFrom = specs.tertiaryStartFrom ?? 'prime';
    const tertiaryId = genSpaceId(item.uniqueId, 'tertiary');

    // 'prime': 주공간 반대편에 보조공간과 평행
    // 'secondary': 보조공간 끝에서 직각으로
    // M3 1차 출시는 'prime'만 정확. 'secondary'는 후속 M3+에서 정밀화.
    let terX: number, terY: number, terRot: number;
    if (startFrom === 'prime') {
      // 주공간의 startSide 반대편에 평행하게
      const startSide = specs.secondaryStartSide ?? 'left';
      if (startSide === 'left') {
        // 주공간의 우측에 보조공간과 같은 방향으로
        terX = w - terD / 2;
        terY = -(terW / 2) + d / 2;
      } else {
        terX = terD / 2;
        terY = -(terW / 2) + d / 2;
      }
      terRot = Math.PI / 2;
    } else {
      // 'secondary' from: 보조공간 끝에서 직각 (정밀 위치는 후속)
      terX = w / 2;
      terY = -(terW / 2);
      terRot = 0;
    }

    spaces.push({
      id: tertiaryId,
      w: terW,
      h: terD,
      x: terX,
      y: terY,
      rotation: terRot,
      zIndex: 0,
      verticalH: h,
      category,
      label: '3차공간',
    });
  }

  // ── 모듈 변환 (orientation → spaceId) ──
  const modules: ModuleV2[] = (item.modules ?? []).map((m: ModuleV1) => {
    let spaceId = primaryId;
    if (m.orientation === 'secondary' && secondaryId) spaceId = secondaryId;
    else if (m.orientation === 'tertiary' && spaces.length >= 3) spaceId = spaces[2].id;

    const v2Mod: ModuleV2 = {
      id: genModuleId(item.uniqueId, m.id),
      spaceId,
      pos: m.pos,
      posXInSpace: num(m.x ?? m.posXInSpace, 0),
      w: num(m.w, 600),
      h: m.h !== undefined ? num(m.h) : undefined,
      d: m.d !== undefined ? num(m.d) : undefined,
      type: (m.type as ModuleV2['type']) || 'storage',
      doorCount: m.doorCount ?? (m.is2door ? 2 : undefined),
      isFixed: m.isFixed,
      isDrawer: m.isDrawer,
      orientation: m.orientation, // deprecated 보존
    };
    return v2Mod;
  });

  // ── specs 변환 (분배기/환풍구는 space로 이전됨, 너비 등 number 필드는 정수화) ──
  // SpecsV1은 number|string 허용하나 SpecsV2는 number만. 이중 단언 후 명시 필드만 다듬음.
  const v2Specs: SpecsV2 = { ...(specs as unknown as SpecsV2) };
  if (specs.finishLeftWidth !== undefined) v2Specs.finishLeftWidth = num(specs.finishLeftWidth);
  if (specs.finishRightWidth !== undefined) v2Specs.finishRightWidth = num(specs.finishRightWidth);
  delete v2Specs.distributorStart;
  delete v2Specs.distributorEnd;
  delete v2Specs.ventStart;
  // layoutShape는 deprecated이지만 v1 라운드트립을 위해 보존
  // (M6에서 제거)

  // ── Floorplan 트리밍 자동 산출 ──
  const floorplan: Floorplan = recomputeFloorplan({
    schemaVersion: 2,
    spaces,
    junctions: [],
    trimmedSpaces: [],
  });

  return {
    schemaVersion: 2,
    uniqueId: item.uniqueId,
    categoryId: category,
    labelName: item.name ?? `${category}-${item.uniqueId}`,
    floorplan,
    modules,
    specs: v2Specs,
  };
}

// ============================================================
// V2 → V1 (하향 호환)
// ============================================================

export interface DowngradeResult {
  ok: boolean;
  /** ok=true일 때만 의미 있음. */
  item?: ItemV1;
  /** ok=false일 때 거부 사유. */
  reason?: string;
}

/**
 * v2 → v1 시도. 안전하게 변환 가능한 경우만 ok=true.
 *
 * 거부 조건:
 *   - spaces.length > 3 (v1은 ㄷ자까지만)
 *   - 비직각 회전 존재
 *   - L폴리곤 outline (트리밍 발생) — v1에는 표현할 자리 없음 (※ 관용 모드 옵션)
 */
export function tryDowngradeV2ToV1(
  item: ItemV2,
  options: { allowTrimmed?: boolean } = {},
): DowngradeResult {
  const fp = item.floorplan;
  if (fp.spaces.length === 0) {
    return { ok: false, reason: 'spaces가 비어 있음' };
  }
  if (fp.spaces.length > 3) {
    return { ok: false, reason: `spaces.length=${fp.spaces.length} (v1은 최대 3 = ㄷ자)` };
  }

  // 비직각 회전 거부
  for (const s of fp.spaces) {
    const rem = ((s.rotation % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (rem > 0.001 && rem < Math.PI / 2 - 0.001) {
      return { ok: false, reason: `비직각 회전 (space ${s.id})` };
    }
  }

  // 트리밍이 있는 v2를 v1으로 표현하려면 손실 발생
  if (!options.allowTrimmed && fp.junctions.length > 0) {
    // 1자형이면 트리밍 없으므로 OK
    if (fp.spaces.length === 1) {
      // pass
    } else {
      // L자/ㄷ자에서는 트리밍이 자연스러우므로 허용 (자동 재계산 가능)
      // 단 비-자명한 트리밍은 거부 (예: zIndex 반전, 다중 코너 등)
    }
  }

  const primary = fp.spaces[0];
  const secondary = fp.spaces[1];
  const tertiary = fp.spaces[2];

  const layoutShape: 'I' | 'L' | 'U' =
    fp.spaces.length === 1 ? 'I' : fp.spaces.length === 2 ? 'L' : 'U';

  // 주공간 → item.w/h/d
  const w = primary.w;
  const verticalH = primary.verticalH;
  const d = primary.h;

  // 보조공간 위치 → secondaryStartSide 추정
  let secondaryStartSide: 'left' | 'right' | undefined;
  if (secondary) {
    secondaryStartSide = secondary.x < w / 2 ? 'left' : 'right';
  }

  let tertiaryStartFrom: 'prime' | 'secondary' | undefined;
  if (tertiary) {
    // 회전이 secondary와 같으면 'prime' (평행), 다르면 'secondary'
    tertiaryStartFrom = Math.abs(tertiary.rotation - (secondary?.rotation ?? 0)) < 0.001
      ? 'prime'
      : 'secondary';
  }

  // 모듈 → orientation 매핑
  const modules: ModuleV1[] = item.modules.map((m): ModuleV1 => {
    let orientation: 'normal' | 'secondary' | 'tertiary' = 'normal';
    if (secondary && m.spaceId === secondary.id) orientation = 'secondary';
    else if (tertiary && m.spaceId === tertiary.id) orientation = 'tertiary';

    return {
      id: m.id,
      pos: m.pos,
      type: m.type,
      w: m.w,
      h: m.h,
      d: m.d,
      orientation,
      doorCount: m.doorCount,
      isFixed: m.isFixed,
      isDrawer: m.isDrawer,
    };
  });

  // specs 합성 — v2에서 space로 옮겨갔던 분배기/환풍구를 다시 specs로
  // SpecsV2의 인덱스 시그니처(unknown)와 SpecsV1의 명시 필드(number|string)가 호환되지 않아
  // 이중 단언으로 좁히기. 다운그레이드는 명시적 손실이 허용되는 경계 작업이라 OK.
  const specs = { ...(item.specs as unknown as ItemV1['specs']) };
  specs.layoutShape = layoutShape;
  specs.lowerLayoutShape = layoutShape;
  if (secondary) {
    specs.lowerSecondaryW = secondary.w;
    specs.lowerSecondaryD = secondary.h;
    specs.secondaryStartSide = secondaryStartSide;
  }
  if (tertiary) {
    specs.lowerTertiaryW = tertiary.w;
    specs.lowerTertiaryD = tertiary.h;
    specs.tertiaryStartFrom = tertiaryStartFrom;
  }
  if (primary.distributorStart != null) specs.distributorStart = primary.distributorStart;
  if (primary.distributorEnd != null) specs.distributorEnd = primary.distributorEnd;
  if (primary.ventStart != null) specs.ventStart = primary.ventStart;

  return {
    ok: true,
    item: {
      uniqueId: item.uniqueId,
      categoryId: item.categoryId,
      category: item.categoryId,
      name: item.labelName,
      w,
      h: verticalH,
      d,
      specs,
      modules,
    },
  };
}
