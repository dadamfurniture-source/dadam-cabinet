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

// W4-4: plannerToSketchup (Y-up → Z-up 축 교환) 제거됨.
// planner-vite 가 W4-3 부터 V2 (Z-up corner mm) 로 직접 송신 — 축 변환 불요.

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

/** 컴포넌트 이름에 허용되는 partId 문자: 영숫자, _, - 만. */
const SAFE_PART_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 컴포넌트 이름: dadam.{category}.{partId} — 디자이너가 outliner 에서 식별 가능.
 * partId 에 점/공백/슬래시 등이 들어오면 SketchUp outliner 검색·계층 분리자와
 * 충돌하므로 _ 로 치환한다 (data loss 없이 안전한 fallback).
 */
export function sketchupComponentName(category: string, partId: string): string {
  const safePartId = SAFE_PART_ID_RE.test(partId)
    ? partId
    : partId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `dadam.${category}.${safePartId}`;
}

// ───────────────────────────────────────────────────────────────
// eval_ruby allowlist — RCE 가드
//
// mhyrr eval_ruby 는 임의의 Ruby 코드를 실행할 수 있어 매우 위험하다.
// MCP 도구 입력은 외부 LLM agent 로부터 오므로, 우리는 사전 정의된
// 명령어만 허용한다. 자유 입력 Ruby 는 expose 하지 않는다.
// ───────────────────────────────────────────────────────────────

export const RUBY_COMMANDS = {
  /** 현재 모델의 active_entities 비우기 — clearExisting 옵션 구현. */
  CLEAR_ENTITIES: 'Sketchup.active_model.active_entities.clear!',
  /** 트랜잭션 시작 — buildPlanFromParts(transactional=true) 에서 자동 prepend. */
  START_OP: "Sketchup.active_model.start_operation('dadam_build', true)",
  /** 트랜잭션 커밋 — buildPlanFromParts(transactional=true) 에서 자동 append. */
  COMMIT_OP: 'Sketchup.active_model.commit_operation',
  /** 트랜잭션 롤백 — sendBatch(autoAbortOnFailure=true) 에서 실패 감지 시 호출. */
  ABORT_OP: 'Sketchup.active_model.abort_operation',
  /**
   * W4-5: 16개 머티리얼 (4 tone × 4 colorKey) idempotent 사전 등록.
   * 이름과 색상은 sketchup-builder.service.ts 의 sketchupMaterialName + MATERIALS 와 동기화.
   * 동적 입력 없이 고정 Ruby 코드 — eval_ruby allowlist 위반 없음.
   */
  /**
   * 빌드 완료 후 SketchUp 의 active view 가 가구 전체에 자동 fit.
   * 사용자가 빌드 직후 카메라 수동 조정 불요 — planner UI 와 비교 용이.
   */
  ZOOM_EXTENTS: 'Sketchup.active_model.active_view.zoom_extents',
  ENSURE_MATERIALS: `
    palette = {
      'cream' => { 'body' => '#f1ede3', 'accent' => '#d4c4a8', 'shadow' => '#b7aa90', 'trim' => '#c8bda8' },
      'oak' => { 'body' => '#d1b089', 'accent' => '#9e7144', 'shadow' => '#6f5031', 'trim' => '#8a6a42' },
      'walnut' => { 'body' => '#8b6447', 'accent' => '#b48a6a', 'shadow' => '#5d412c', 'trim' => '#6e5238' },
      'graphite' => { 'body' => '#696a6b', 'accent' => '#c2b49c', 'shadow' => '#3d4042', 'trim' => '#555657' }
    }
    materials = Sketchup.active_model.materials
    palette.each do |tone, keys|
      keys.each do |key, hex|
        name = "dadam_" + tone + "_" + key
        mat = materials[name] || materials.add(name)
        mat.color = hex
      end
    end
  `.trim(),
  /**
   * Si-1: 현재 SketchUp 활성 모델의 모든 top-level group/component 을 JSON 으로 dump.
   *
   * 각 entity 마다:
   *   - id: SketchUp entityID
   *   - name: outliner name (dadam.{cat}.{partId} 또는 임의)
   *   - type: 'group' | 'component'
   *   - bounds: [min_mm[3], max_mm[3]] (mm 단위, SketchUp 내부 inch * 25.4)
   *   - transformation: 16-element matrix (회전/이동 detect 용)
   *   - material_name: 적용된 머티리얼 이름 또는 null
   *
   * 응답은 puts 로 JSON 출력 — eval_ruby 의 result.content[0].text 에 들어옴.
   * planner-import.service.ts 가 JSON.parse 로 파싱.
   *
   * 동적 입력 없는 고정 Ruby — allowlist 안전.
   */
  DUMP_ENTITIES: `
    m = Sketchup.active_model
    entities = m.active_entities.to_a.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }
    result = entities.map do |e|
      b = e.bounds
      mat_name = e.material ? e.material.display_name : nil
      t = e.transformation.to_a
      type_str = e.is_a?(Sketchup::Group) ? 'group' : 'component'
      ent_name = (e.respond_to?(:name) && !e.name.to_s.empty?) ? e.name : (e.respond_to?(:definition) ? e.definition.name : '')
      {
        :id => e.entityID,
        :name => ent_name,
        :type => type_str,
        :bounds => {
          :min => [(b.min.x * 25.4).round(3), (b.min.y * 25.4).round(3), (b.min.z * 25.4).round(3)],
          :max => [(b.max.x * 25.4).round(3), (b.max.y * 25.4).round(3), (b.max.z * 25.4).round(3)]
        },
        :transformation => t.map { |v| v.round(6) },
        :material_name => mat_name
      }
    end
    require 'json'
    result.to_json
  `.trim(),
} as const;

export type RubyCommandKey = keyof typeof RUBY_COMMANDS;
export type RubyCommandLiteral = (typeof RUBY_COMMANDS)[RubyCommandKey];

// ───────────────────────────────────────────────────────────────
// mhyrr/sketchup-mcp 프로토콜
// ───────────────────────────────────────────────────────────────

export const MHYRR_DEFAULT_HOST = '127.0.0.1';
export const MHYRR_DEFAULT_PORT = 9876;
export const MHYRR_RECEIVE_TIMEOUT_MS = 15000;

/**
 * mhyrr 가 노출하는 tools/call name 집합.
 *
 * 실제 mhyrr v0.1.0 (su_mcp/main.rb) 검증 (2026-05-15 디자이너 PC):
 *   create_component / delete_component / transform_component
 *   get_selection (= 가장 가벼운 query, ping 용)
 *   export / export_scene / set_material / eval_ruby
 *   boolean_operation / chamfer_edges / fillet_edges
 *   create_mortise_tenon / create_dovetail / create_finger_joint
 *
 * 참고: README 에 명시된 get_scene_info / get_selected_components 는 v0.1.0 미구현 —
 * 상수는 README 기반으로 보존하되 pingSketchup 은 실 호환 도구 GET_SELECTION 사용.
 */
export const MHYRR_TOOLS = {
  CREATE_COMPONENT: 'create_component',
  DELETE_COMPONENT: 'delete_component',
  TRANSFORM_COMPONENT: 'transform_component',
  SET_MATERIAL: 'set_material',
  EXPORT_SCENE: 'export_scene',
  /** README 명시 (mhyrr v0.1.0 미구현 — 호환 환경에서만 사용) */
  GET_SCENE_INFO: 'get_scene_info',
  /** README 명시 (mhyrr v0.1.0 미구현 — 호환 환경에서만 사용) */
  GET_SELECTED_COMPONENTS: 'get_selected_components',
  /** mhyrr v0.1.0 의 가장 가벼운 query — pingSketchup 의 기본값 */
  GET_SELECTION: 'get_selection',
  EVAL_RUBY: 'eval_ruby',
} as const;

export type MhyrrToolName = (typeof MHYRR_TOOLS)[keyof typeof MHYRR_TOOLS];
