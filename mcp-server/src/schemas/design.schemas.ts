// ═══════════════════════════════════════════════════════════════
// Design Zod Schemas - 설계 데이터 입력 검증
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  CategorySchema,
  ConfidenceSchema,
  DimensionMmSchema,
  PositiveDimensionSchema,
  StyleSchema,
  KitchenLayoutSchema,
} from './common.schemas.js';

// ─── 설비 위치 ───

const UtilityPositionSchema = z.object({
  detected: z.boolean(),
  from_origin_mm: DimensionMmSchema,
  from_origin_percent: z.number().min(0).max(100).optional(),
  from_floor_mm: DimensionMmSchema.optional(),
  from_left_mm: DimensionMmSchema.optional(),
  from_left_percent: z.number().min(0).max(100).optional(),
  height_mm: DimensionMmSchema.optional(),
  description: z.string().optional(),
});

const UtilityPositionsSchema = z.object({
  water_supply: UtilityPositionSchema.optional(),
  exhaust_duct: UtilityPositionSchema.optional(),
  gas_pipe: UtilityPositionSchema.optional(),
  gas_line: UtilityPositionSchema.optional(),
  electrical_outlets: z.array(z.object({
    from_origin_mm: DimensionMmSchema,
    from_floor_mm: DimensionMmSchema,
    from_left_mm: DimensionMmSchema.optional(),
    height_mm: DimensionMmSchema.optional(),
    type: z.string().optional(),
  })).optional(),
});

// ─── 벽 분석 ───

export const WallAnalysisSchema = z.object({
  reference_wall: z.object({
    origin_point: z.enum(['open_edge', 'far_from_hood', 'left_edge']),
    origin_reason: z.string(),
  }).optional(),
  tile_detected: z.boolean(),
  tile_type: z.string(),
  tile_size_mm: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  tile_count: z.object({
    horizontal: z.number().nonnegative(),
    vertical: z.number().nonnegative(),
  }).optional(),
  tile_measurement: z.object({
    detected: z.boolean(),
    tile_size_mm: z.object({ width: z.number().positive(), height: z.number().positive() }),
    tile_count: z.object({ horizontal: z.number().nonnegative(), vertical: z.number().nonnegative() }),
  }).optional(),
  wall_dimensions_mm: z.object({
    width: PositiveDimensionSchema,
    height: PositiveDimensionSchema,
  }).optional(),
  wall_width_mm: PositiveDimensionSchema,
  wall_height_mm: PositiveDimensionSchema,
  utility_positions: UtilityPositionsSchema.optional(),
  water_pipe_x: DimensionMmSchema.optional(),
  exhaust_duct_x: DimensionMmSchema.optional(),
  gas_pipe_x: DimensionMmSchema.optional(),
  furniture_placement: z.object({
    sink_position: z.string().optional(),
    cooktop_position: z.string().optional(),
    range_hood_position: z.string().optional(),
    layout_direction: z.string().optional(),
    sink_center_mm: DimensionMmSchema.optional(),
    cooktop_center_mm: DimensionMmSchema.optional(),
    upper_cabinet_bottom_mm: DimensionMmSchema.optional(),
    lower_cabinet_height_mm: DimensionMmSchema.optional(),
    countertop_height_mm: DimensionMmSchema.optional(),
  }).optional(),
  reference_used: z.string().optional(),
  confidence: ConfidenceSchema,
  notes: z.string().optional(),
});

// ─── 캐비닛 스펙 ───

export const CabinetSpecsSchema = z.object({
  total_width_mm: PositiveDimensionSchema.optional(),
  total_height_mm: PositiveDimensionSchema.optional(),
  depth_mm: PositiveDimensionSchema.optional(),
  upper_cabinet_height: PositiveDimensionSchema.optional(),
  lower_cabinet_height: PositiveDimensionSchema.optional(),
  leg_height: DimensionMmSchema.optional(),
  molding_height: DimensionMmSchema.optional(),
  countertop_thickness: DimensionMmSchema.optional(),
  upper_door_overlap: DimensionMmSchema.optional(),
  door_color_upper: z.string().optional(),
  door_color_lower: z.string().optional(),
  door_finish_upper: z.string().optional(),
  door_finish_lower: z.string().optional(),
  countertop_color: z.string().optional(),
  handle_type: z.string().optional(),
  kitchen_layout: KitchenLayoutSchema.optional(),
  sink_type: z.string().optional(),
  sink_position_mm: DimensionMmSchema.optional(),
  cooktop_type: z.string().optional(),
  cooktop_position_mm: DimensionMmSchema.optional(),
  hood_type: z.string().optional(),
  faucet_type: z.string().optional(),
});

// ─── 모듈 ───

export const ModuleInfoSchema = z.object({
  width_mm: PositiveDimensionSchema.optional(),
  w: PositiveDimensionSchema.optional(),
  width: PositiveDimensionSchema.optional(),
  height: PositiveDimensionSchema.optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  door_count: z.number().int().nonnegative().optional(),
  doorCount: z.number().int().nonnegative().optional(),
  is_drawer: z.boolean().optional(),
  isDrawer: z.boolean().optional(),
  has_sink: z.boolean().optional(),
  has_cooktop: z.boolean().optional(),
});

export const ModulesDataSchema = z.object({
  upper: z.array(ModuleInfoSchema).optional(),
  lower: z.array(ModuleInfoSchema).optional(),
  upper_count: z.number().int().nonnegative().optional(),
  lower_count: z.number().int().nonnegative().optional(),
});

// ─── 캐비닛 유닛 (StructuredDesignData 내부) ───

export const CabinetUnitSchema = z.object({
  position_mm: DimensionMmSchema,
  width_mm: PositiveDimensionSchema,
  type: z.string(),
  door_count: z.number().int().nonnegative(),
  is_drawer: z.boolean(),
  has_sink: z.boolean().optional(),
  has_cooktop: z.boolean().optional(),
});

// ─── StructuredDesignData ───

export const StructuredDesignDataSchema = z.object({
  category: CategorySchema,
  style: z.string(),
  wall: z.object({
    width_mm: PositiveDimensionSchema,
    height_mm: PositiveDimensionSchema,
    tile_type: z.string(),
    confidence: ConfidenceSchema,
  }),
  utilities: z.object({
    water_supply: z.object({ detected: z.boolean(), position_mm: DimensionMmSchema }),
    exhaust_duct: z.object({ detected: z.boolean(), position_mm: DimensionMmSchema }),
    gas_pipe: z.object({ detected: z.boolean(), position_mm: DimensionMmSchema }),
  }),
  layout: z.object({
    direction: z.string(),
    total_width_mm: PositiveDimensionSchema,
    depth_mm: PositiveDimensionSchema,
  }),
  cabinets: z.object({
    upper: z.array(CabinetUnitSchema),
    lower: z.array(CabinetUnitSchema),
    upper_height_mm: PositiveDimensionSchema,
    lower_height_mm: PositiveDimensionSchema,
    leg_height_mm: DimensionMmSchema,
    molding_height_mm: DimensionMmSchema,
    countertop_thickness_mm: DimensionMmSchema,
    upper_door_overlap_mm: DimensionMmSchema,
  }),
  equipment: z.object({
    sink: z.object({ position_mm: DimensionMmSchema, width_mm: PositiveDimensionSchema, type: z.string() }).optional(),
    cooktop: z.object({ position_mm: DimensionMmSchema, width_mm: PositiveDimensionSchema, type: z.string(), burner_count: z.number().int().positive().optional() }).optional(),
    hood: z.object({ position_mm: DimensionMmSchema, width_mm: PositiveDimensionSchema, type: z.string() }).optional(),
    faucet: z.object({ type: z.string() }).optional(),
  }),
  materials: z.object({
    door_color: z.string(),
    door_finish: z.string(),
    countertop: z.string(),
    material_codes: z.array(z.string()),
    handle_type: z.string(),
  }),
  rag_rules_applied: z.object({
    background: z.array(z.string()),
    modules: z.array(z.string()),
    doors: z.array(z.string()),
    material_codes: z.array(z.string()),
  }),
});

// ─── ExtractDesignData 입력 ───

export const ExtractDesignDataInputSchema = z.object({
  category: CategorySchema,
  style: StyleSchema,
  wallData: WallAnalysisSchema,
  classified: z.object({
    background: z.array(z.string()),
    modules: z.array(z.string()),
    doors: z.array(z.string()),
    materials: z.array(z.any()),
    materialKeywords: z.array(z.any()),
  }),
  cabinetSpecs: CabinetSpecsSchema.optional(),
  modules: ModulesDataSchema.optional(),
});

// ─── 타입 추출 ───

export type WallAnalysisInput = z.infer<typeof WallAnalysisSchema>;
export type StructuredDesignDataInput = z.infer<typeof StructuredDesignDataSchema>;
export type ExtractDesignDataInputParsed = z.infer<typeof ExtractDesignDataInputSchema>;
