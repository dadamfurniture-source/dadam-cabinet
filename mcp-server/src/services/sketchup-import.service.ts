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
