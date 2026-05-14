// ═══════════════════════════════════════════════════════════════
// SketchUp 통합 상수
//
// - 단위 변환: 다담AI는 mm 사용, SketchUp 내부는 inch (1 inch = 25.4mm)
// - 좌표계 변환: planner Three.js (Y-up) → SketchUp (Z-up)
//   planner(x, y, z) → SketchUp(x, z, y)
// - 색상 매핑: MaterialTone 의 body/accent/shadow/trim 헥스를
//   SketchUp Material 이름으로 변환
// - mhyrr/sketchup-mcp 프로토콜: JSON-RPC 2.0 over TCP (newline-delimited)
//   기본 포트 9876, method = "tools/call"
// ═══════════════════════════════════════════════════════════════

import type { ColorKey, MaterialTone } from '../types/planner.types.js';
import { MATERIALS } from '../types/planner.types.js';

// ───────────────────────────────────────────────────────────────
// 단위 변환
// ───────────────────────────────────────────────────────────────

/** 1 mm = 0.0393700787 inch (SketchUp 내부 단위) */
export const MM_PER_INCH = 25.4;

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

// ───────────────────────────────────────────────────────────────
// 좌표계 변환 (planner Y-up → SketchUp Z-up)
// ───────────────────────────────────────────────────────────────

export interface PlannerVec3 {
  x: number;
  y: number;
  z: number;
}

export interface SketchupVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * planner Three.js 좌표 (Y-up) → SketchUp 좌표 (Z-up).
 *   planner: x=가로, y=수직(높이), z=깊이
 *   sketchup: x=가로, y=깊이, z=수직(높이)
 * 입력은 mm, 출력은 mm (단위 변환은 별도).
 */
export function plannerToSketchup(v: PlannerVec3): SketchupVec3 {
  return {
    x: v.x,
    y: v.z,
    z: v.y,
  };
}

// ───────────────────────────────────────────────────────────────
// 색상 매핑 (ColorKey + MaterialTone → 헥스)
// ───────────────────────────────────────────────────────────────

export function resolveColorHex(tone: MaterialTone, key: ColorKey): string {
  return MATERIALS[tone][key];
}

/** SketchUp Material 이름 규칙: "dadam_{tone}_{key}" — 동일 머티리얼 재사용. */
export function sketchupMaterialName(tone: MaterialTone, key: ColorKey): string {
  return `dadam_${tone}_${key}`;
}

// ───────────────────────────────────────────────────────────────
// 컴포넌트 명명 규칙
// ───────────────────────────────────────────────────────────────

/** 컴포넌트 이름: dadam.{category}.{partId} — 디자이너가 outliner 에서 식별 가능. */
export function sketchupComponentName(category: string, partId: string): string {
  return `dadam.${category}.${partId}`;
}

// ───────────────────────────────────────────────────────────────
// mhyrr/sketchup-mcp 프로토콜
// ───────────────────────────────────────────────────────────────

export const MHYRR_DEFAULT_HOST = '127.0.0.1';
export const MHYRR_DEFAULT_PORT = 9876;
export const MHYRR_RECEIVE_TIMEOUT_MS = 15000;

/** mhyrr 가 노출하는 tools/call name 집합 (src/sketchup_mcp/server.py 참조). */
export const MHYRR_TOOLS = {
  CREATE_COMPONENT: 'create_component',
  DELETE_COMPONENT: 'delete_component',
  TRANSFORM_COMPONENT: 'transform_component',
  SET_MATERIAL: 'set_material',
  EXPORT_SCENE: 'export_scene',
  GET_SCENE_INFO: 'get_scene_info',
  GET_SELECTED_COMPONENTS: 'get_selected_components',
  EVAL_RUBY: 'eval_ruby',
} as const;

export type MhyrrToolName = (typeof MHYRR_TOOLS)[keyof typeof MHYRR_TOOLS];
