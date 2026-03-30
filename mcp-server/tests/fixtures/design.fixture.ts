// ═══════════════════════════════════════════════════════════════
// Shared Test Fixtures - 테스트용 공통 팩토리 함수
// ═══════════════════════════════════════════════════════════════

import type { StructuredDesignData, WallAnalysis } from '../../src/types/index.js';
import type { ClassifiedRules } from '../../src/mappers/rule-classifier.js';

/**
 * 표준 주방 설계 데이터 생성 (3600mm 벽, 3 하부장 + 1 상부장)
 */
export function makeKitchenDesign(
  overrides: Partial<StructuredDesignData> = {},
): StructuredDesignData {
  return {
    category: 'sink',
    style: 'modern',
    wall: { width_mm: 3600, height_mm: 2400, tile_type: 'subway', confidence: 'high' },
    utilities: {
      water_supply: { detected: true, position_mm: 900 },
      exhaust_duct: { detected: true, position_mm: 2700 },
      gas_pipe: { detected: true, position_mm: 2700 },
    },
    layout: { direction: 'sink_left_cooktop_right', total_width_mm: 3600, depth_mm: 600 },
    cabinets: {
      upper: [
        { position_mm: 0, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
      ],
      lower: [
        { position_mm: 0, width_mm: 800, type: 'sink', door_count: 2, is_drawer: false, has_sink: true },
        { position_mm: 800, width_mm: 600, type: 'drawer', door_count: 3, is_drawer: true },
        { position_mm: 1400, width_mm: 800, type: 'cooktop', door_count: 1, is_drawer: false, has_cooktop: true },
      ],
      upper_height_mm: 720,
      lower_height_mm: 870,
      leg_height_mm: 150,
      molding_height_mm: 60,
      countertop_thickness_mm: 12,
      upper_door_overlap_mm: 15,
    },
    equipment: {
      sink: { position_mm: 400, width_mm: 800, type: 'undermount' },
      cooktop: { position_mm: 1800, width_mm: 600, type: '3-burner', burner_count: 3 },
      hood: { position_mm: 1800, width_mm: 600, type: 'slim' },
      faucet: { type: 'single_lever' },
    },
    materials: {
      door_color: 'white',
      door_finish: 'matte',
      countertop: 'white_marble',
      material_codes: ['WM-01'],
      handle_type: 'line',
    },
    rag_rules_applied: { background: [], modules: [], doors: [], material_codes: [] },
    ...overrides,
  };
}

/**
 * 표준 벽 분석 데이터 생성
 */
export function makeWallData(
  overrides: Partial<WallAnalysis> = {},
): WallAnalysis {
  return {
    tile_detected: true,
    tile_type: 'subway_tile',
    tile_size_mm: { width: 300, height: 600 },
    wall_width_mm: 3600,
    wall_height_mm: 2400,
    water_pipe_x: 900,
    exhaust_duct_x: 2700,
    gas_pipe_x: 2700,
    confidence: 'high',
    ...overrides,
  };
}

/**
 * 표준 분류된 RAG 규칙 생성
 */
export function makeClassified(
  overrides: Partial<ClassifiedRules> = {},
): ClassifiedRules {
  return {
    background: ['- Clean walls'],
    modules: ['- 상부장: 600mm standard'],
    doors: ['- 도어: 1-door hinged'],
    materials: [
      { id: 'm1', rule_type: 'material', content: 'White matte laminate', triggers: ['WM-01'] },
    ],
    materialKeywords: [],
    ...overrides,
  };
}

/**
 * 빈 캐비닛 설계 데이터 (엣지 케이스 테스트용)
 */
export function makeEmptyDesign(
  overrides: Partial<StructuredDesignData> = {},
): StructuredDesignData {
  return makeKitchenDesign({
    cabinets: {
      upper: [],
      lower: [],
      upper_height_mm: 720,
      lower_height_mm: 870,
      leg_height_mm: 150,
      molding_height_mm: 60,
      countertop_thickness_mm: 12,
      upper_door_overlap_mm: 15,
    },
    equipment: {},
    ...overrides,
  });
}

/**
 * 붙박이장 설계 데이터
 */
export function makeWardrobeDesign(
  overrides: Partial<StructuredDesignData> = {},
): StructuredDesignData {
  return makeKitchenDesign({
    category: 'wardrobe',
    style: 'modern',
    cabinets: {
      upper: [],
      lower: [
        { position_mm: 0, width_mm: 800, type: 'standard', door_count: 2, is_drawer: false },
        { position_mm: 800, width_mm: 800, type: 'standard', door_count: 2, is_drawer: false },
        { position_mm: 1600, width_mm: 600, type: 'drawer', door_count: 4, is_drawer: true },
      ],
      upper_height_mm: 720,
      lower_height_mm: 2100,
      leg_height_mm: 0,
      molding_height_mm: 0,
      countertop_thickness_mm: 0,
      upper_door_overlap_mm: 0,
    },
    equipment: {},
    ...overrides,
  });
}
