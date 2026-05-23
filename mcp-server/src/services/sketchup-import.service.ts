// ═══════════════════════════════════════════════════════════════
// SketchUp Import Service — SketchUp 활성 씬 → V2 parts → PlannerState
//
// Si-1: entities dump (이 파일의 fetchSketchupEntities)
// Si-2: entities → V2 parts 역변환 (parseEntities)         — TODO
// Si-3: V2 parts → PlannerState 역추적 (reconstructPlannerState) — TODO
//
// W4/W5 의 sketchup-builder.service.ts 와 대칭 — builder 가 (planner→SketchUp)
// 인 반면, 본 import service 는 (SketchUp→planner) 방향.
// ═══════════════════════════════════════════════════════════════

import { sendCommand } from './sketchup-mcp-bridge.service.js';
import { evalRubySafe } from './sketchup-builder.service.js';
import { createLogger } from '../utils/logger.js';
import type { CabinetCategory, CabinetPartV2, ColorKey, ModuleType } from '../types/planner.types.js';

const VALID_CATEGORIES: readonly CabinetCategory[] = ['sink', 'wardrobe', 'vanity', 'shoe', 'fridge', 'storage'];

const log = createLogger('sketchup-import');

/**
 * mhyrr eval_ruby 의 DUMP_ENTITIES Ruby 코드가 반환하는 JSON 구조.
 *
 * Ruby 측 (constants/sketchup.ts:DUMP_ENTITIES) 의 to_json 출력과 일치.
 */
export interface SketchupEntityDump {
  /** SketchUp entityID (Group.entityID) */
  id: number;
  /** outliner name 또는 component.definition.name */
  name: string;
  /** 'group' (anonymous transformation) 또는 'component' (instance) */
  type: 'group' | 'component';
  /** AABB bounds, mm 단위. SketchUp 내부 inch * 25.4 */
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  /** 16-element transformation matrix (column-major 또는 row-major, SketchUp 의 to_a 형식) */
  transformation: number[];
  /** 적용된 머티리얼 이름 (없으면 null) */
  material_name: string | null;
}

export interface FetchEntitiesOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export interface FetchEntitiesResult {
  ok: boolean;
  entities?: SketchupEntityDump[];
  /** dump 시점 SketchUp 모델의 활성 entity 수 */
  count?: number;
  error?: { code?: number; message: string };
}

/**
 * Si-1: 현재 SketchUp 활성 모델의 모든 top-level group/component 을 dump.
 *
 * mhyrr eval_ruby (allowlist DUMP_ENTITIES) 호출 → JSON 응답 parse.
 *
 * 활성 모델이 비어 있으면 entities=[] count=0 반환 (ok=true).
 *
 * @returns FetchEntitiesResult — Si-2 에서 parseEntities 가 입력으로 받음.
 */
export async function fetchSketchupEntities(
  options: FetchEntitiesOptions = {},
): Promise<FetchEntitiesResult> {
  const cmd = evalRubySafe('DUMP_ENTITIES');
  const result = await sendCommand(cmd, options);

  if (!result.ok) {
    log.warn({ error: result.error }, 'fetch entities failed');
    return { ok: false, error: result.error ?? { message: 'unknown error' } };
  }

  // mhyrr 응답 형식: result.content[0].text = puts 출력
  const text = (result.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text;
  if (!text) {
    return {
      ok: false,
      error: { message: 'mhyrr response missing content[0].text' },
    };
  }

  let entities: SketchupEntityDump[];
  try {
    entities = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: { message: `failed to parse entities JSON: ${msg}` },
    };
  }

  if (!Array.isArray(entities)) {
    return {
      ok: false,
      error: { message: 'entities response is not an array' },
    };
  }

  log.info({ count: entities.length }, 'fetched SketchUp entities');
  return { ok: true, entities, count: entities.length };
}

// ═══════════════════════════════════════════════════════════════
// Si-2: entities → CabinetPartV2[] 역변환
// ═══════════════════════════════════════════════════════════════

/**
 * Si-1b 의 SET_NAMES 가 적용한 outliner name 패턴:
 *   `dadam.{category}.{partId}`
 *
 * partId 는 sketchupComponentName 에서 영숫자/_/-/. 만 허용 (`.` 는 `_` 로 치환됨).
 * regex: `^dadam\.([sink|wardrobe|...]+)\.(.+)$`
 */
const DADAM_NAME_PATTERN = /^dadam\.(sink|wardrobe|vanity|shoe|fridge|storage)\.(.+)$/;

/**
 * partId prefix → 구조물/유틸리티/모듈 분류.
 * W4 deriveCabinet 의 partId 명명 규칙 기반.
 */
const STRUCTURAL_PREFIXES = [
  'molding-top',
  'molding-top-sec',
  'toekick',
  'finish-left-lower',
  'finish-left-upper',
  'finish-right-lower',
  'finish-right-upper',
  'filler-sec',
  'countertop',
  'countertop-sec',
  'corner-post',
  'corner-floor',
  'blind-panel',
  'sec-inner-panel',
  'install-space',
  'mirror',
  'fridge-cavity',
];
const UTILITY_PREFIXES = ['utility-distributor', 'utility-vent'];

export type ImportPartCategory = 'module' | 'structural' | 'utility' | 'unknown';

export interface ParsedEntity {
  /** SketchUp entityID */
  entityId: number;
  /** outliner 에서 추출한 dadam.{cat}.{partId} 분해 결과 */
  category: CabinetCategory | null;
  partId: string;
  /** module / structural / utility / unknown (dadam 마킹 없는 외부 entity) */
  partCategory: ImportPartCategory;
  /** 원본 mhyrr entity dump */
  source: SketchupEntityDump;
  /** 추정 V2 part (성공 시), null = unknown 또는 invalid */
  part: CabinetPartV2 | null;
}

export interface ParseEntitiesResult {
  /** dadam.* 마킹 + 좌표 정상 → V2 변환 완료 */
  parts: CabinetPartV2[];
  /** 분류별 상세 (모듈/구조물/유틸/unknown) — 사용자에게 진단 표시용 */
  parsed: ParsedEntity[];
  /** 가구 카테고리 (다수결) — preset 추정 단서 */
  inferredCategory: CabinetCategory | null;
  /** 마킹 없는 entity 수 (Phase 3a/3b 대상) */
  unknownCount: number;
}

/**
 * Si-2: SketchupEntityDump[] → CabinetPartV2[] 역변환.
 *
 * 단계:
 *   1. outliner name `dadam.{cat}.{partId}` 파싱
 *   2. bounds (mm) → V2 corner/width/depth/height
 *   3. transformation matrix → rotationZDeg 추출
 *   4. partId prefix → moduleType / colorKey / isDoor 추정
 *   5. dadam 마킹 없는 entity 는 unknown 으로 분류 (Phase 3a 의 수동 매핑 대상)
 *
 * 외부 자료 (dadam 마킹 없음) 는 parts 에 포함되지 않음 — Phase 3a/3b 에서 보조.
 */
export function parseEntities(entities: SketchupEntityDump[]): ParseEntitiesResult {
  const parsed: ParsedEntity[] = [];
  const categoryCounts = new Map<CabinetCategory, number>();

  for (const ent of entities) {
    const result = parseEntity(ent);
    parsed.push(result);
    if (result.category) {
      categoryCounts.set(result.category, (categoryCounts.get(result.category) ?? 0) + 1);
    }
  }

  // 다수결로 가구 카테고리 추정
  let inferredCategory: CabinetCategory | null = null;
  let maxCount = 0;
  for (const [cat, count] of categoryCounts) {
    if (count > maxCount) {
      maxCount = count;
      inferredCategory = cat;
    }
  }

  const parts = parsed.filter((p) => p.part !== null).map((p) => p.part!);
  const unknownCount = parsed.filter((p) => p.partCategory === 'unknown').length;

  return { parts, parsed, inferredCategory, unknownCount };
}

/**
 * 단일 entity → ParsedEntity. parseEntities 의 내부 헬퍼.
 */
function parseEntity(ent: SketchupEntityDump): ParsedEntity {
  // 1. name 파싱
  const match = ent.name.match(DADAM_NAME_PATTERN);
  if (!match) {
    return {
      entityId: ent.id,
      category: null,
      partId: ent.name,
      partCategory: 'unknown',
      source: ent,
      part: null,
    };
  }
  const [, catRaw, partId] = match;
  const category = VALID_CATEGORIES.includes(catRaw as CabinetCategory)
    ? (catRaw as CabinetCategory)
    : null;
  if (!category) {
    return {
      entityId: ent.id,
      category: null,
      partId,
      partCategory: 'unknown',
      source: ent,
      part: null,
    };
  }

  // 2. 분류 판정
  const partCategory = classifyPartId(partId);

  // 3. bounds → V2 corner + size
  const { min, max } = ent.bounds;
  const width = max[0] - min[0];
  const depth = max[1] - min[1];
  const height = max[2] - min[2];

  // 4. 회전 추출 (transformation matrix → Z축 각도)
  const rotationZDeg = extractZRotation(ent.transformation);

  // 5. partId → moduleType / colorKey / isDoor 추정
  const moduleType = inferModuleType(partId, partCategory);
  const colorKey = inferColorKey(partId, ent.material_name);
  const isDoor = false; // W4 시기 도어는 별 part 로 분리 안 됨 (본체에 포함) — Phase 후속 보정

  // V2 corner = bounds.min, V2 dimensions = max - min
  const part: CabinetPartV2 = {
    id: partId,
    label: partId,
    x: min[0],
    y: min[1],
    z: min[2],
    width,
    depth,
    height,
    colorKey,
    rotationZDeg,
    moduleType,
    isDoor,
  };

  return {
    entityId: ent.id,
    category,
    partId,
    partCategory,
    source: ent,
    part,
  };
}

/**
 * partId prefix 로 module/structural/utility 구분.
 */
function classifyPartId(partId: string): ImportPartCategory {
  if (UTILITY_PREFIXES.some((p) => partId === p || partId.startsWith(`${p}-`))) {
    return 'utility';
  }
  if (STRUCTURAL_PREFIXES.some((p) => partId === p || partId.startsWith(`${p}-`))) {
    return 'structural';
  }
  return 'module';
}

/**
 * partId / colorKey 기반 moduleType 추정.
 * W4 deriveCabinet 의 partId 명명 규칙에서는 본체 type 정보가 명시적이지 않음.
 * 외부에서 모듈 type 확실히 알려면 SketchUp 의 별도 attribute 또는 plugin 마킹 필요 (Phase 2).
 */
function inferModuleType(partId: string, partCategory: ImportPartCategory): ModuleType | undefined {
  if (partCategory !== 'module') return undefined;
  // 명시 prefix 우선
  if (partId.includes('sink')) return 'sink';
  if (partId.includes('cook')) return 'cook';
  if (partId.includes('hood')) return 'hood';
  if (partId.includes('drawer')) return 'drawer';
  if (partId.includes('blind')) return 'storage';
  return 'storage';
}

/**
 * partId / material_name 기반 colorKey 추정.
 * material_name 은 mhyrr 가 entity.material 에 저장 안 함 (Si-1 e2e 확인) → 대부분 null.
 * partId prefix 로 fallback (도어=accent, 본체/마감재=body 등).
 */
function inferColorKey(partId: string, materialName: string | null): ColorKey {
  // material_name 우선 (있는 경우)
  if (materialName) {
    const m = materialName.match(/dadam_\w+_(body|accent|shadow|trim)/);
    if (m) return m[1] as ColorKey;
  }
  // partId prefix 추정
  if (partId.startsWith('molding-top') || partId.startsWith('toekick') || partId.startsWith('finish-') || partId.startsWith('filler-')) {
    return 'trim';
  }
  if (partId.startsWith('countertop')) {
    return 'shadow';
  }
  if (partId.includes('door') || partId.includes('upper-')) {
    return 'accent';
  }
  return 'body';
}

/**
 * SketchUp transformation matrix (16-element, column-major) 에서 Z축 회전 각도 추출.
 *
 * 매트릭스 형식 (Geom::Transformation):
 *   m[0..3]   = X axis vector (cos, sin, 0, 0) for Z-rotation
 *   m[4..7]   = Y axis vector (-sin, cos, 0, 0) for Z-rotation
 *   m[8..11]  = Z axis vector (0, 0, 1, 0) for Z-rotation
 *   m[12..15] = translation + w
 *
 * Z 회전 각도 = atan2(m[1], m[0]) — 라디안 → 도.
 * 회전 없으면 m[0]=1, m[1]=0 → angle=0.
 */
function extractZRotation(transformation: number[]): number | undefined {
  if (transformation.length !== 16) return undefined;
  const m00 = transformation[0];
  const m01 = transformation[1];
  // Z 회전이 없으면 (m00 ≈ 1, m01 ≈ 0) → 0도 → undefined 반환 (의도 보존)
  const rad = Math.atan2(m01, m00);
  if (Math.abs(rad) < 1e-6) return undefined;
  return (rad * 180) / Math.PI;
}

// ═══════════════════════════════════════════════════════════════
// Si-3: V2 parts → PlannerState 역추적
// ═══════════════════════════════════════════════════════════════

export type LayoutShape = 'I' | 'L' | 'U';
export type ModuleKind = 'door' | 'drawer' | 'open';

export interface ReconstructedModuleEntry {
  id: string;
  kind: ModuleKind;
  width: number;
  moduleType?: ModuleType;
  orientation?: 'normal' | 'secondary' | 'tertiary';
}

/**
 * mcp-server → planner-vite 응답 형식.
 * planner-vite 가 이 데이터를 받아 setPlanner() 로 PlannerState 구성.
 * PlannerState 필드와 1:1 매핑 (이름 일치).
 */
export interface ReconstructedPlannerData {
  // 핵심 측정값
  category: CabinetCategory;
  width: number;
  height: number;
  depth: number;
  toeKickH: number;
  moldingH: number;
  finishLeftW: number;
  finishRightW: number;

  // 레이아웃
  layoutShape: LayoutShape;
  secondaryW?: number;
  secondaryD?: number;
  secondaryStartSide?: 'left' | 'right';
  tertiaryW?: number;
  tertiaryD?: number;

  // 모듈
  lowerModules: ReconstructedModuleEntry[];
  upperModules: ReconstructedModuleEntry[];
  lowerCount: number;
  upperCount: number;

  // 유틸
  distributorStart: number | null;
  distributorEnd: number | null;
  ventStart: number | null;

  // 재질
  material: MaterialTone;

  // 신뢰도 / 경고
  /** 0~1, 1=완벽 복원, 낮을수록 사용자 확인 필요 */
  confidence: number;
  /** 추정 신뢰도 낮은 항목 (모달에 표시) */
  warnings: string[];
}

type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

/**
 * Si-3: 파싱된 entity 들로부터 PlannerState 의 필드를 역추적.
 *
 * 단계:
 *   1. 카테고리 (Si-2 의 inferredCategory)
 *   2. 가구 bbox → width/height/depth
 *   3. 구조물 측정 (toeKickH, moldingH, finishLeftW/RightW)
 *   4. 모듈 분리 (z 위치 → lower/upper)
 *   5. layoutShape 추정 (y 클러스터링 → I/L/U)
 *   6. ModuleEntry[] 재구성 (X 정렬 + moduleType + kind)
 *   7. 유틸리티 위치
 *   8. materialTone 추정
 *   9. 신뢰도 / warnings
 */
export function reconstructPlannerData(
  parsed: ParsedEntity[],
): ReconstructedPlannerData | null {
  const warnings: string[] = [];

  // 카테고리 (Si-2 의 다수결 사용)
  const result = { parts: parsed.filter((p) => p.part !== null).map((p) => p.part!), parsed };
  const inferredCategory = inferCategory(parsed);
  if (!inferredCategory) {
    return null; // dadam.* 마킹 entity 가 하나도 없음 → 외부 자료. Phase 3a/3b 대상.
  }

  // 가구 bbox — 유틸리티 제외 (분배기/환풍구가 가구 벽 밖으로 튀어나갈 수 있음).
  // 가구 wall 측정 우선순위:
  //   1) countertop / molding-top 의 width (가구 전체 가로) — 가장 정확
  //   2) 좌/우 마감재 outer edge 차이
  //   3) fallback: 모듈 + 구조물 bbox
  const measureParts = parsed
    .filter((p) => p.part !== null && p.partCategory !== 'utility')
    .map((p) => p.part!);
  if (measureParts.length === 0) return null;

  const bbox = computeBbox(measureParts);

  // width 측정 — countertop 또는 molding-top 의 width 가 가장 신뢰
  const countertop = findByPartId(parsed, 'countertop');
  const molding = findByPartId(parsed, 'molding-top');
  const widthCandidates: number[] = [];
  if (countertop?.part) widthCandidates.push(countertop.part.width);
  if (molding?.part) widthCandidates.push(molding.part.width);
  widthCandidates.push(bbox.max.x - bbox.min.x);
  const width = Math.round(widthCandidates[0]);

  const height = Math.round(bbox.max.z - bbox.min.z);
  // depth 도 utility 제외 (utility 가 -y 쪽으로 돌출)
  const depth = Math.round(bbox.max.y - bbox.min.y);

  // 구조물 측정 (countertop / molding 은 width 측정에서 이미 찾음)
  const toeKick = findByPartId(parsed, 'toekick');
  const finishLeftLower = findByPartId(parsed, 'finish-left-lower');
  const finishRightLower = findByPartId(parsed, 'finish-right-lower');

  const toeKickH = toeKick?.part?.height ?? 0;
  const moldingH = molding?.part?.height ?? 0;
  const finishLeftW = finishLeftLower?.part?.width ?? 0;
  const finishRightW = finishRightLower?.part?.width ?? 0;

  // 모듈 part 분리 (z 클러스터링: 두 cluster 면 lower/upper, 단일이면 fullHeight)
  const modules = parsed.filter((p) => p.partCategory === 'module' && p.part);
  const moduleZs = modules.map((p) => p.part!.z);
  const zClusters = clusterValues(moduleZs, 200); // 200mm 임계값

  let lowerFinal: ParsedEntity[] = [];
  let upperFinal: ParsedEntity[] = [];

  if (zClusters.length >= 2) {
    // 가장 낮은 cluster = lower, 가장 높은 cluster = upper
    const lowerZMax = Math.max(...zClusters[0]);
    const upperZMin = Math.min(...zClusters[zClusters.length - 1]);
    lowerFinal = modules.filter((p) => p.part!.z <= lowerZMax);
    upperFinal = modules.filter((p) => p.part!.z >= upperZMin);
  } else {
    // 단일 z 클러스터 (fullHeight) — 모두 lower
    lowerFinal = modules;
    upperFinal = [];
  }

  // layoutShape 추정 (y 위치 클러스터)
  const yPositions = modules.map((p) => p.part!.y);
  const yClusters = clusterValues(yPositions, 200); // 200mm 임계값
  let layoutShape: LayoutShape = 'I';
  if (yClusters.length === 2) layoutShape = 'L';
  else if (yClusters.length >= 3) layoutShape = 'U';

  // L/U 자 추가 측정 (현 단계는 간단 — secondaryW/D 정확 분리는 Si-3b 에서)
  let secondaryW: number | undefined;
  let secondaryD: number | undefined;
  let secondaryStartSide: 'left' | 'right' | undefined;
  if (layoutShape !== 'I') {
    warnings.push(`레이아웃 ${layoutShape}자 가구 추정 — 차선/3차선 모듈 분리는 사용자 확인 권장`);
  }

  // ModuleEntry[] 재구성 (X 정렬)
  const lowerModules = lowerFinal
    .sort((a, b) => a.part!.x - b.part!.x)
    .map((p) => toModuleEntry(p));
  const upperModules = upperFinal
    .sort((a, b) => a.part!.x - b.part!.x)
    .map((p) => toModuleEntry(p));

  // 유틸리티
  const distributor = findByPartId(parsed, 'utility-distributor');
  const vent = findByPartId(parsed, 'utility-vent');
  const distributorStart = distributor?.part ? distributor.part.x : null;
  const distributorEnd = distributor?.part ? distributor.part.x + distributor.part.width : null;
  const ventStart = vent?.part?.x ?? null;

  // materialTone 추정
  const material = inferMaterialTone(parsed) ?? 'cream';

  // 신뢰도 산출
  let confidence = 1.0;
  if (lowerModules.length === 0 && upperModules.length === 0) {
    confidence -= 0.5;
    warnings.push('모듈 엔트리 추출 실패 — 본체 part 가 분류되지 않음');
  }
  if (toeKickH === 0 && !inferredCategoryAllowsZeroToekick(inferredCategory)) {
    confidence -= 0.05;
    warnings.push('걸레받이 (toekick) 부재 — 0mm 로 설정됨');
  }
  if (moldingH === 0) {
    confidence -= 0.05;
    warnings.push('상몰딩 부재 — 0mm 로 설정됨');
  }
  if (layoutShape !== 'I') {
    confidence -= 0.15;
  }
  const unknownCount = parsed.filter((p) => p.partCategory === 'unknown').length;
  if (unknownCount > 0) {
    confidence -= Math.min(0.1, unknownCount / parsed.length);
    warnings.push(`${unknownCount}개 entity 가 dadam.* 마킹 없음 (외부 또는 잔여 — 자동 매핑 안 됨)`);
  }
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    category: inferredCategory,
    width,
    height,
    depth,
    toeKickH,
    moldingH,
    finishLeftW,
    finishRightW,
    layoutShape,
    secondaryW,
    secondaryD,
    secondaryStartSide,
    lowerModules,
    upperModules,
    lowerCount: lowerModules.length,
    upperCount: upperModules.length,
    distributorStart,
    distributorEnd,
    ventStart,
    material,
    confidence,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────
// Si-3 헬퍼
// ─────────────────────────────────────────────────────────────────

function inferCategory(parsed: ParsedEntity[]): CabinetCategory | null {
  const counts = new Map<CabinetCategory, number>();
  for (const p of parsed) {
    if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  let max = 0;
  let result: CabinetCategory | null = null;
  for (const [cat, n] of counts) {
    if (n > max) {
      max = n;
      result = cat;
    }
  }
  return result;
}

function computeBbox(parts: CabinetPartV2[]): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  return parts.reduce(
    (acc, p) => ({
      min: {
        x: Math.min(acc.min.x, p.x),
        y: Math.min(acc.min.y, p.y),
        z: Math.min(acc.min.z, p.z),
      },
      max: {
        x: Math.max(acc.max.x, p.x + p.width),
        y: Math.max(acc.max.y, p.y + p.depth),
        z: Math.max(acc.max.z, p.z + p.height),
      },
    }),
    {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    },
  );
}

function findByPartId(parsed: ParsedEntity[], partId: string): ParsedEntity | undefined {
  return parsed.find((p) => p.partId === partId);
}

/**
 * 값 배열을 임계값 기준으로 클러스터링.
 * threshold 이내는 같은 클러스터로 묶음.
 *
 * 예: [0, 5, 700, 705, 1400] threshold=100 → [[0,5], [700,705], [1400]] → 3 클러스터
 */
function clusterValues(values: number[], threshold: number): number[][] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    if (sorted[i] - last[last.length - 1] <= threshold) {
      last.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters;
}

function toModuleEntry(p: ParsedEntity): ReconstructedModuleEntry {
  const part = p.part!;
  const moduleType = p.partId.includes('drawer') ? undefined : (p.part?.moduleType ?? 'storage');
  const kind: ModuleKind = p.partId.includes('drawer') ? 'drawer'
    : (moduleType === 'hood' || moduleType === 'cook') ? 'door'
    : 'door';
  return {
    id: p.partId,
    kind,
    width: Math.round(part.width),
    moduleType,
  };
}

function inferMaterialTone(parsed: ParsedEntity[]): MaterialTone | undefined {
  const counts = new Map<MaterialTone, number>();
  for (const p of parsed) {
    const m = p.source.material_name?.match(/^dadam_(cream|oak|walnut|graphite)_/);
    if (m) {
      const tone = m[1] as MaterialTone;
      counts.set(tone, (counts.get(tone) ?? 0) + 1);
    }
  }
  let max = 0;
  let result: MaterialTone | undefined;
  for (const [tone, n] of counts) {
    if (n > max) {
      max = n;
      result = tone;
    }
  }
  return result;
}

function inferredCategoryAllowsZeroToekick(cat: CabinetCategory): boolean {
  // wardrobe / shoe / fridge 같은 fullHeight preset 은 걸레받이 0mm 가능
  return cat === 'wardrobe' || cat === 'shoe' || cat === 'fridge';
}

// ═══════════════════════════════════════════════════════════════
// Phase 3a: 수동 매핑 UI 보조 — entity 별 자동 추론 suggestion
// ═══════════════════════════════════════════════════════════════

export type SuggestedPartType =
  | 'module-body'    // 일반 모듈 본체 (lower/upper)
  | 'module-door'    // 도어 (얇은 accent)
  | 'toekick'        // 걸레받이 (낮은 가로 trim)
  | 'molding-top'    // 상몰딩 (높은 가로 trim)
  | 'finish-side'    // 좌/우 마감재 (좁고 높은 trim)
  | 'countertop'     // 상판 (얇은 가로)
  | 'utility'        // 분배기 / 환풍구 (작은 박스)
  | 'unknown';

export interface EntitySuggestion {
  /** 추정 type */
  type: SuggestedPartType;
  /** 추정 신뢰도 0~1 */
  confidence: number;
  /** 추정 partId (수동 매핑 UI 의 default 값) */
  suggestedPartId: string;
  /** 추정 moduleType (module 인 경우) */
  suggestedModuleType?: ModuleType;
  /** 추정 colorKey */
  suggestedColorKey: ColorKey;
}

/**
 * Phase 3a: 단일 entity 의 bbox/colorKey/material 로 type 추론.
 *
 * 휴리스틱 (우선순위):
 *   1. dadam.* 마킹 있으면 → name 파싱 결과 사용 (높은 신뢰)
 *   2. height ≤ 200mm + width ≥ 1000mm → toekick (낮은 가로 trim)
 *   3. height ≤ 80mm + width ≥ 1000mm + z > 2000mm → molding-top
 *   4. width ≤ 80mm + height ≥ 500mm → finish-side
 *   5. height ≤ 20mm + width ≥ 1000mm + z 600~1500 → countertop
 *   6. depth ≤ 25mm → module-door
 *   7. 100×40×80mm 범위 → utility
 *   8. width × depth × height 가 일반 모듈 범위 (≥ 200mm 각 축) → module-body
 *   9. 그 외 → unknown
 */
export function inferEntitySuggestion(ent: SketchupEntityDump): EntitySuggestion {
  // 0) dadam.* 마킹 우선
  const match = ent.name.match(DADAM_NAME_PATTERN);
  if (match) {
    const partId = match[2];
    const partCategory = classifyPartId(partId);
    const moduleType = inferModuleType(partId, partCategory);
    const colorKey = inferColorKey(partId, ent.material_name);
    let type: SuggestedPartType = 'unknown';
    if (partId.startsWith('toekick')) type = 'toekick';
    else if (partId.startsWith('molding-top')) type = 'molding-top';
    else if (partId.startsWith('finish-')) type = 'finish-side';
    else if (partId.startsWith('countertop')) type = 'countertop';
    else if (partId.startsWith('utility-')) type = 'utility';
    else if (partCategory === 'module') type = 'module-body';
    return {
      type,
      confidence: 1.0,
      suggestedPartId: partId,
      suggestedModuleType: moduleType,
      suggestedColorKey: colorKey,
    };
  }

  // 1) bbox 기반 휴리스틱 (dadam 마킹 없음)
  const w = ent.bounds.max[0] - ent.bounds.min[0];
  const d = ent.bounds.max[1] - ent.bounds.min[1];
  const h = ent.bounds.max[2] - ent.bounds.min[2];
  const zMin = ent.bounds.min[2];

  // toekick: 낮고 (h≤200) 가로 (w≥1000) z≈0
  if (h <= 200 && w >= 1000 && zMin < 200) {
    return {
      type: 'toekick',
      confidence: 0.8,
      suggestedPartId: 'toekick',
      suggestedColorKey: 'trim',
    };
  }

  // molding-top: 낮고 가로 z 위
  if (h <= 80 && w >= 1000 && zMin >= 2000) {
    return {
      type: 'molding-top',
      confidence: 0.8,
      suggestedPartId: 'molding-top',
      suggestedColorKey: 'trim',
    };
  }

  // countertop: 매우 얇고 (h≤20) 가로 z=중간
  if (h <= 20 && w >= 1000 && zMin >= 600 && zMin <= 1500) {
    return {
      type: 'countertop',
      confidence: 0.85,
      suggestedPartId: 'countertop',
      suggestedColorKey: 'shadow',
    };
  }

  // finish-side: 좁고 (w≤80) 높음 (h≥500)
  if (w <= 80 && h >= 500) {
    // z=0 부근이면 lower, 그 외 upper
    const partId = zMin < 200 ? (ent.bounds.min[0] < 0 ? 'finish-left-lower' : 'finish-right-lower')
                              : (ent.bounds.min[0] < 0 ? 'finish-left-upper' : 'finish-right-upper');
    return {
      type: 'finish-side',
      confidence: 0.65,
      suggestedPartId: partId,
      suggestedColorKey: 'trim',
    };
  }

  // utility: 작은 박스
  if (w <= 800 && d <= 80 && h <= 100) {
    return {
      type: 'utility',
      confidence: 0.6,
      suggestedPartId: 'utility-unknown',
      suggestedColorKey: 'body',
    };
  }

  // module-door: 매우 얇음 (depth ≤ 25)
  if (d <= 25 && w >= 200 && h >= 200) {
    return {
      type: 'module-door',
      confidence: 0.7,
      suggestedPartId: 'door',
      suggestedColorKey: 'accent',
    };
  }

  // module-body: 일반 모듈 범위
  if (w >= 200 && d >= 200 && h >= 200) {
    return {
      type: 'module-body',
      confidence: 0.55,
      suggestedPartId: 'body',
      suggestedModuleType: 'storage',
      suggestedColorKey: 'body',
    };
  }

  // unknown
  return {
    type: 'unknown',
    confidence: 0.0,
    suggestedPartId: 'unknown',
    suggestedColorKey: 'body',
  };
}

/**
 * Phase 3a: entities 배열에 자동 추론 suggestion 첨부.
 * UI 가 사용자에게 추정 결과를 default 로 표시 → 사용자가 수정 또는 그대로 적용.
 */
export interface EntityWithSuggestion {
  entity: SketchupEntityDump;
  suggestion: EntitySuggestion;
}

export function suggestEntities(entities: SketchupEntityDump[]): EntityWithSuggestion[] {
  return entities.map((ent) => ({ entity: ent, suggestion: inferEntitySuggestion(ent) }));
}
