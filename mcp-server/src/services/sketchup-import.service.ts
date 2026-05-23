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
