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
  from_origin_mm: number;         // 기준점(0mm)에서의 거리
  from_origin_percent?: number;   // 기준점에서의 거리 (%)
  from_floor_mm?: number;         // 바닥에서의 높이
  from_left_mm?: number;          // 레거시 호환
  from_left_percent?: number;     // 레거시 호환
  height_mm?: number;             // 레거시 호환
  description?: string;           // 시각적 특징 설명
}

export interface ReferenceWall {
  origin_point: 'open_edge' | 'far_from_hood' | 'left_edge';
  origin_reason: string;
}

export interface UtilityPositions {
  water_supply?: UtilityPosition;
  exhaust_duct?: UtilityPosition;
  gas_pipe?: UtilityPosition;   // gas_line에서 변경
  gas_line?: UtilityPosition;   // 레거시 호환
  electrical_outlets?: Array<{
    from_origin_mm: number;
    from_floor_mm: number;
    from_left_mm?: number;      // 레거시 호환
    height_mm?: number;         // 레거시 호환
    type?: string;
  }>;
}

export interface FurniturePlacement {
  // 위치 문자열 (프롬프트용)
  sink_position?: string;
  cooktop_position?: string;
  range_hood_position?: string;
  layout_direction?: string;
  // 구체적인 좌표 (mm)
  sink_center_mm?: number;
  cooktop_center_mm?: number;
  // 캐비닛 높이 계산값
  upper_cabinet_bottom_mm?: number;   // 상부장 하단 높이
  lower_cabinet_height_mm?: number;   // 하부장 높이 (표준 870mm)
  countertop_height_mm?: number;      // 작업대 높이
}

export interface WallAnalysis {
  // 기준벽 정보
  reference_wall?: ReferenceWall;

  // 타일 측정
  tile_detected: boolean;
  tile_type: string;
  tile_size_mm: TileSize;
  tile_count?: TileCount;
  tile_measurement?: {
    detected: boolean;
    tile_size_mm: TileSize;
    tile_count: TileCount;
  };

  // 벽 치수
  wall_dimensions_mm?: {
    width: number;
    height: number;
  };
  wall_width_mm: number;
  wall_height_mm: number;

  // 배관 위치 (배관 기반 설비 배치용)
  utility_positions?: UtilityPositions;
  water_pipe_x?: number | undefined;      // 수도 배관 X 위치 (감지된 경우에만)
  exhaust_duct_x?: number | undefined;    // 후드 배기구 X 위치 (감지된 경우에만)
  gas_pipe_x?: number | undefined;        // 가스 배관 X 위치 (감지된 경우에만)

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

// ─────────────────────────────────────────────────────────────────
// Few-Shot Learning 참조 이미지 타입
// ─────────────────────────────────────────────────────────────────

export type ReferenceImageCategory =
  | 'water_pipe'      // 급수 배관
  | 'exhaust_duct'    // 배기 덕트
  | 'gas_pipe'        // 가스 배관
  | 'outlet'          // 전기 콘센트
  | 'tile';           // 타일 종류

export interface ReferenceImage {
  id: string;
  category: ReferenceImageCategory;
  subcategory?: string;
  storage_path: string;
  original_filename?: string;
  ground_truth: Record<string, unknown>;
  name: string;
  description?: string;
  visual_features: string[];
  is_active: boolean;
  created_at: string;
}

export interface ImageInput {
  data: string;           // Base64 이미지 데이터
  mime_type: string;      // MIME 타입 (image/jpeg, image/png)
  role?: 'target' | 'reference';  // 역할: 분석 대상 또는 참조
  label?: string;         // 라벨 (참조 이미지 이름)
}

export interface WallAnalysisV2Input {
  image: string;                    // Base64 분석 대상 이미지
  image_type?: string;              // MIME 타입 (기본: image/jpeg)
  use_reference_images?: boolean;   // 참조 이미지 사용 여부 (기본: true)
  reference_categories?: ReferenceImageCategory[];  // 사용할 참조 카테고리
}
