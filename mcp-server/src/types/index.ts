// ═══════════════════════════════════════════════════════════════
// 다담AI MCP Server - Type Definitions
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────────────────────────

export type Category = 'sink' | 'wardrobe' | 'fridge' | 'vanity' | 'shoe' | 'storage';

export interface RoomDesignInput {
  category: Category;
  style: string;
  room_image: string;  // Base64
  image_type: string;  // MIME type (image/jpeg, image/png)
}

export interface DesignDataInput {
  design_data?: Record<string, unknown>;
  items?: DesignItem[];
  style?: string;
  category?: Category;
  cabinet_specs?: CabinetSpecs;
  modules?: ModulesData;
}

export interface DesignItem {
  w?: number;
  h?: number;
  d?: number;
  categoryId?: string;
  [key: string]: unknown;
}

export interface CabinetSpecs {
  total_width_mm?: number;
  total_height_mm?: number;
  depth_mm?: number;
  upper_cabinet_height?: number;
  lower_cabinet_height?: number;
  leg_height?: number;
  molding_height?: number;
  countertop_thickness?: number;
  door_color_upper?: string;
  door_color_lower?: string;
  door_finish_upper?: string;
  door_finish_lower?: string;
  countertop_color?: string;
  handle_type?: string;
  sink_type?: string;
  sink_position_mm?: number;
  cooktop_type?: string;
  cooktop_position_mm?: number;
  hood_type?: string;
  faucet_type?: string;
}

export interface ModulesData {
  upper?: ModuleInfo[];
  lower?: ModuleInfo[];
  upper_count?: number;
  lower_count?: number;
}

export interface ModuleInfo {
  width_mm?: number;
  w?: number;
  door_count?: number;
  doorCount?: number;
  is_drawer?: boolean;
  isDrawer?: boolean;
  has_sink?: boolean;
  has_cooktop?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// RAG 검색 타입
// ─────────────────────────────────────────────────────────────────

export type RuleType = 'background' | 'module' | 'door' | 'material' | 'material_keyword';

export interface DesignRule {
  id: string;
  rule_type: RuleType;
  chunk_type?: RuleType;
  content: string;
  triggers?: string[];
  metadata?: Record<string, unknown>;
}

export interface RagSearchParams {
  query_triggers: string[];
  filter_category: string;
  limit_count: number;
}

// ─────────────────────────────────────────────────────────────────
// 벽 분석 타입
// ─────────────────────────────────────────────────────────────────

export interface TileSize {
  width: number;
  height: number;
}

export interface TileCount {
  horizontal: number;
  vertical: number;
}

export interface UtilityPosition {
  detected: boolean;
  from_left_mm: number;
  from_left_percent: number;
  height_mm?: number;
  description: string;
}

export interface UtilityPositions {
  water_supply?: UtilityPosition;
  exhaust_duct?: UtilityPosition;
  gas_line?: UtilityPosition;
  electrical_outlets?: Array<{
    from_left_mm: number;
    height_mm: number;
    type: string;
  }>;
}

export interface FurniturePlacement {
  sink_position?: string;
  cooktop_position?: string;
  range_hood_position?: string;
  layout_direction?: string;
}

export interface WallAnalysis {
  tile_detected: boolean;
  tile_type: string;
  tile_size_mm: TileSize;
  tile_count?: TileCount;
  wall_dimensions_mm?: {
    width: number;
    height: number;
  };
  wall_width_mm: number;
  wall_height_mm: number;
  utility_positions?: UtilityPositions;
  furniture_placement?: FurniturePlacement;
  reference_used?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────
// 이미지 생성 타입
// ─────────────────────────────────────────────────────────────────

export interface GeneratedImageData {
  base64: string;
  mime_type: string;
}

export interface GeneratedImage {
  closed: GeneratedImageData;
  open: GeneratedImageData | null;
}

// ─────────────────────────────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────────────────────────────

export interface DesignResponse {
  success: boolean;
  message: string;
  category: string;
  style: string;
  rag_rules_count: number;
  generated_image: GeneratedImage;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────
// Gemini API 타입
// ─────────────────────────────────────────────────────────────────

export interface GeminiContent {
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
  inlineData?: {
    mime_type: string;
    data: string;
  };
}

export interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseModalities?: string[];
  };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
}

// ─────────────────────────────────────────────────────────────────
// 프롬프트 빌더 타입
// ─────────────────────────────────────────────────────────────────

export interface PromptParams {
  category: Category;
  style: string;
  wallData: WallAnalysis;
  ragRules: {
    background: string[];
    modules: string[];
    doors: string[];
    materials: DesignRule[];
    materialKeywords: DesignRule[];
  };
  roomImage?: string;
  imageType?: string;
}

// ─────────────────────────────────────────────────────────────────
// 파싱된 입력 타입
// ─────────────────────────────────────────────────────────────────

export interface ParsedInput {
  category: Category;
  style: string;
  roomImage: string;
  imageType: string;
  triggers: string[];
  materialCodes: string[];
  colorKeywords: string[];
  hasMaterialRequest: boolean;
}

// ─────────────────────────────────────────────────────────────────
// 타일 참조 타입
// ─────────────────────────────────────────────────────────────────

export interface TileReference {
  width: number;
  height: number;
  name: string;
}

export type TileReferenceMap = Record<string, TileReference>;

// ─────────────────────────────────────────────────────────────────
// 색상/자재 매핑 타입
// ─────────────────────────────────────────────────────────────────

export type ColorMap = Record<string, string>;
export type FinishMap = Record<string, string>;
export type HandleMap = Record<string, string>;
