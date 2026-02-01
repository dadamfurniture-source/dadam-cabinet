// ═══════════════════════════════════════════════════════════════
// Gemini Vision Tool - 벽 구조 분석
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  geminiVisionAnalysis,
  extractTextFromGeminiResponse,
  extractJsonFromText,
} from '../utils/api-client.js';
import type { WallAnalysis } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────

export const geminiVisionTool = {
  name: 'gemini_wall_analysis',
  description: 'Gemini Vision으로 방 사진의 벽 구조를 분석합니다. 타일 기반 벽 치수 계산, 급수/배기/가스 배관 위치를 감지합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      image: {
        type: 'string',
        description: 'Base64 인코딩된 이미지 데이터',
      },
      image_type: {
        type: 'string',
        description: 'MIME 타입 (예: image/jpeg, image/png)',
        default: 'image/jpeg',
      },
    },
    required: ['image'],
  },
};

// ─────────────────────────────────────────────────────────────────
// Input Validation Schema
// ─────────────────────────────────────────────────────────────────

const inputSchema = z.object({
  image: z.string(),
  image_type: z.string().optional().default('image/jpeg'),
});

// ─────────────────────────────────────────────────────────────────
// Wall Analysis Prompt
// ─────────────────────────────────────────────────────────────────

const WALL_ANALYSIS_PROMPT = `[TASK: WALL STRUCTURE & UTILITY POSITION ANALYSIS]

Analyze this construction/renovation room photo to calculate wall dimensions and identify utility positions for kitchen furniture placement.

═══════════════════════════════════════════════════════════════
[STEP 1: WALL DIMENSIONS - TILE MEASUREMENT]
═══════════════════════════════════════════════════════════════
Identify tile type and count:
- Subway Tile Small: 75×150mm
- Subway Tile Medium: 100×200mm
- Subway Tile Large: 100×300mm
- Standard Wall Tile: 300×600mm (most common in Korean kitchens)
- Large Wall Tile: 400×800mm
- Large Porcelain: 600×1200mm
- XL Porcelain: 800×1600mm

If no tiles visible, use these references:
- Standard door width: 900mm
- Standard door height: 2100mm
- Electrical outlet height from floor: 300mm

Calculate:
- Wall Width (mm) = Tile Width × Horizontal Count
- Wall Height (mm) = Tile Height × Vertical Count

═══════════════════════════════════════════════════════════════
[STEP 2: CRITICAL UTILITY DETECTION - VERY IMPORTANT]
═══════════════════════════════════════════════════════════════

>> EXHAUST DUCT (배기 덕트) - FOR RANGE HOOD PLACEMENT
Visual features to look for:
- Flexible aluminum/silver duct pipe coming from wall
- Round or rectangular wall opening/hole
- Usually 100-150mm diameter
- Located: UPPER wall area, typically 1800-2200mm from floor
- Often near corner or side of kitchen wall
PURPOSE: Range hood and cooktop must be placed HERE

>> WATER MANIFOLD / SUPPLY PIPES (급수 분배기) - FOR SINK PLACEMENT
Visual features to look for:
- Red and blue pipes (hot/cold water)
- White/beige manifold box with multiple valves
- Exposed pipes coming from wall near floor
- Located: LOWER wall area, typically 200-500mm from floor
- Often has shut-off valves visible
PURPOSE: Sink must be placed HERE

>> GAS LINE (가스 배관) - FOR COOKTOP PLACEMENT
Visual features to look for:
- Yellow colored pipe
- Gas valve/cock
- Usually near exhaust duct location
- Located: Lower-middle wall area
PURPOSE: Gas cooktop connection point

>> ELECTRICAL OUTLETS (전기 콘센트)
- Count all visible outlets
- Note dedicated high-voltage outlets (for oven, dishwasher)

═══════════════════════════════════════════════════════════════
[STEP 3: FURNITURE PLACEMENT LOGIC]
═══════════════════════════════════════════════════════════════

Based on detected utilities, determine optimal placement:

1. SINK CABINET: Must align with water_supply position
   - Center of sink = water manifold position

2. COOKTOP + RANGE HOOD: Must align with exhaust_duct position
   - Center of cooktop = exhaust duct position
   - Range hood directly above cooktop

3. LAYOUT RULE:
   - If water is LEFT of exhaust → Sink LEFT, Cooktop RIGHT
   - If water is RIGHT of exhaust → Sink RIGHT, Cooktop LEFT
   - Maintain work triangle efficiency

═══════════════════════════════════════════════════════════════
[STEP 4: OUTPUT FORMAT - JSON ONLY]
═══════════════════════════════════════════════════════════════

{
  "tile_detected": true/false,
  "tile_type": "standard_wall",
  "tile_size_mm": { "width": 300, "height": 600 },
  "tile_count": { "horizontal": 10, "vertical": 4 },
  "wall_dimensions_mm": {
    "width": 3000,
    "height": 2400
  },
  "utility_positions": {
    "exhaust_duct": {
      "detected": true/false,
      "from_left_mm": <number>,
      "from_left_percent": <0-100>,
      "height_mm": <number>,
      "description": "Flexible aluminum duct on upper right wall"
    },
    "water_supply": {
      "detected": true/false,
      "from_left_mm": <number>,
      "from_left_percent": <0-100>,
      "height_mm": <number>,
      "description": "Red/blue manifold box with valves on lower center wall"
    },
    "gas_line": {
      "detected": true/false,
      "from_left_mm": <number>,
      "from_left_percent": <0-100>,
      "description": "Yellow gas pipe near exhaust area"
    },
    "electrical_outlets": [
      { "from_left_mm": 300, "height_mm": 300, "type": "standard" }
    ]
  },
  "furniture_placement": {
    "sink_position": "center_at_<X>mm based on water_supply",
    "cooktop_position": "center_at_<X>mm based on exhaust_duct",
    "range_hood_position": "above cooktop at exhaust_duct location",
    "layout_direction": "sink_left_cooktop_right" or "sink_right_cooktop_left"
  },
  "reference_used": "tile" or "door" or "outlet",
  "confidence": "high" or "medium" or "low",
  "notes": "Additional observations about the space"
}

CRITICAL: Output ONLY valid JSON, no additional text or explanation.`;

// ─────────────────────────────────────────────────────────────────
// Tool Handler
// ─────────────────────────────────────────────────────────────────

export async function handleGeminiVision(args: unknown) {
  // 입력 검증
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { image, image_type } = parsed.data;

  try {
    // Gemini Vision API 호출
    const response = await geminiVisionAnalysis(image, image_type, WALL_ANALYSIS_PROMPT);

    // 텍스트 응답 추출
    const text = extractTextFromGeminiResponse(response);
    if (!text) {
      throw new Error('No text response from Gemini');
    }

    // JSON 파싱
    const wallData = extractJsonFromText(text) as WallAnalysis | null;
    if (!wallData) {
      throw new Error('Failed to parse wall analysis JSON');
    }

    // 기본값 적용
    const result = applyDefaults(wallData);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            wall_data: result,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Wall analysis failed: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

function applyDefaults(data: Partial<WallAnalysis>): WallAnalysis {
  return {
    tile_detected: data.tile_detected ?? false,
    tile_type: data.tile_type ?? 'unknown',
    tile_size_mm: data.tile_size_mm ?? { width: 300, height: 600 },
    tile_count: data.tile_count,
    wall_dimensions_mm: data.wall_dimensions_mm,
    wall_width_mm: data.wall_dimensions_mm?.width ?? data.wall_width_mm ?? 3000,
    wall_height_mm: data.wall_dimensions_mm?.height ?? data.wall_height_mm ?? 2400,
    utility_positions: data.utility_positions,
    furniture_placement: data.furniture_placement,
    reference_used: data.reference_used,
    confidence: data.confidence ?? 'low',
    notes: data.notes,
  };
}
