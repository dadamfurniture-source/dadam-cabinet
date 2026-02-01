// ═══════════════════════════════════════════════════════════════
// 다담AI HTTP API Server
// n8n 웹훅을 대체하는 REST API 서버
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import {
  searchRagRules,
  geminiVisionAnalysis,
  geminiImageGeneration,
  extractTextFromGeminiResponse,
  extractImageFromGeminiResponse,
  extractJsonFromText,
} from './utils/api-client.js';
import type { WallAnalysis, DesignRule, RuleType } from './types/index.js';

// 환경 변수 로드
config();

const app = express();
const PORT = process.env.HTTP_PORT || 3200;

// 미들웨어
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─────────────────────────────────────────────────────────────────
// 헬스 체크
// ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'dadam-api', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────
// 메인 API: 방 사진 → AI 가구 설계
// n8n /webhook/dadam-interior-v4 대체
// ─────────────────────────────────────────────────────────────────

app.post('/webhook/dadam-interior-v4', async (req, res) => {
  console.log('[API] /webhook/dadam-interior-v4 called');

  try {
    const body = req.body;

    // 1. 입력 파싱
    const category = body.category || 'sink';
    const style = body.design_style || body.style || 'modern';
    const roomImage = body.room_image || '';
    const imageType = body.image_type || 'image/jpeg';

    if (!roomImage) {
      return res.status(400).json({
        success: false,
        error: 'room_image is required',
      });
    }

    // 트리거 생성
    const triggers = getTriggers(category, style);

    console.log(`[API] Category: ${category}, Style: ${style}`);

    // 2. RAG 검색
    console.log('[API] Searching RAG rules...');
    let ragRules: DesignRule[] = [];
    try {
      ragRules = await searchRagRules({
        query_triggers: triggers,
        filter_category: category,
        limit_count: 25,
      });
      console.log(`[API] Found ${ragRules.length} RAG rules`);
    } catch (error) {
      console.log('[API] RAG search failed, using defaults');
    }

    // RAG 규칙 분류
    const classifiedRules = classifyRules(ragRules);

    // 3. 벽 분석
    console.log('[API] Analyzing wall structure...');
    let wallData: WallAnalysis = getDefaultWallData();

    try {
      const wallResponse = await geminiVisionAnalysis(
        roomImage,
        imageType,
        WALL_ANALYSIS_PROMPT
      );
      const wallText = extractTextFromGeminiResponse(wallResponse);
      if (wallText) {
        const parsed = extractJsonFromText(wallText) as WallAnalysis | null;
        if (parsed) {
          wallData = { ...wallData, ...parsed };
          console.log(`[API] Wall analysis complete: ${wallData.wall_width_mm}x${wallData.wall_height_mm}mm`);
        }
      }
    } catch (error) {
      console.log('[API] Wall analysis failed, using defaults');
    }

    // 4. 프롬프트 조립
    const closedPrompt = buildClosedDoorPrompt(category, style, wallData, classifiedRules);

    // 5. 닫힌 도어 이미지 생성
    console.log('[API] Generating closed door image...');
    let closedImage: string | null = null;

    try {
      const closedResponse = await geminiImageGeneration(closedPrompt, roomImage, imageType);
      closedImage = extractImageFromGeminiResponse(closedResponse);
      console.log('[API] Closed door image generated');
    } catch (error) {
      console.log('[API] Closed door generation failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate closed door image',
      });
    }

    if (!closedImage) {
      return res.status(500).json({
        success: false,
        error: 'No image generated',
      });
    }

    // 6. 열린 도어 이미지 생성
    console.log('[API] Generating open door image...');
    let openImage: string | null = null;

    try {
      const openPrompt = buildOpenDoorPrompt(category);
      const openResponse = await geminiImageGeneration(openPrompt, closedImage, 'image/png');
      openImage = extractImageFromGeminiResponse(openResponse);
      console.log('[API] Open door image generated');
    } catch (error) {
      console.log('[API] Open door generation failed, returning closed only');
    }

    // 7. 응답 반환
    res.json({
      success: true,
      message: '이미지 생성 완료',
      category,
      style,
      rag_rules_count: ragRules.length,
      generated_image: {
        closed: {
          base64: closedImage,
          mime_type: 'image/png',
        },
        open: openImage ? {
          base64: openImage,
          mime_type: 'image/png',
        } : null,
      },
    });

  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 설계 데이터 → 이미지 API
// n8n /webhook/design-to-image 대체
// ─────────────────────────────────────────────────────────────────

app.post('/webhook/design-to-image', async (req, res) => {
  console.log('[API] /webhook/design-to-image called');

  try {
    const body = req.body;
    const designData = body.design_data || body;
    const items = body.items || designData.items || [];
    const style = body.style || body.design_style || 'modern minimal';
    const category = body.category || items[0]?.categoryId || 'sink';
    const cabinetSpecs = body.cabinet_specs || {};

    // 프롬프트 생성
    const prompt = buildDesignToImagePrompt(category, style, cabinetSpecs, items);

    // 이미지 생성
    console.log('[API] Generating design image...');
    const response = await geminiImageGeneration(prompt);
    const image = extractImageFromGeminiResponse(response);

    if (!image) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate image',
      });
    }

    res.json({
      success: true,
      message: '이미지 생성 완료',
      category,
      style,
      generated_image: {
        base64: image,
        mime_type: 'image/png',
      },
    });

  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

const TRIGGER_MAP: Record<string, string[]> = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감'],
};

function getTriggers(category: string, style: string): string[] {
  const baseTriggers = TRIGGER_MAP[category] || TRIGGER_MAP.sink;
  const colorKeywords = extractColorKeywords(style);
  return [...baseTriggers, ...colorKeywords.slice(0, 5)];
}

function extractColorKeywords(text: string): string[] {
  const keywords = ['화이트', '그레이', '블랙', '오크', '월넛', '무광', '유광', 'white', 'gray', 'oak'];
  return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
}

interface ClassifiedRules {
  background: string[];
  modules: string[];
  doors: string[];
  materials: DesignRule[];
}

function classifyRules(rules: DesignRule[]): ClassifiedRules {
  const result: ClassifiedRules = { background: [], modules: [], doors: [], materials: [] };

  for (const rule of rules) {
    const type = (rule.rule_type || rule.chunk_type || 'module') as RuleType;
    if (type === 'background') result.background.push(`- ${rule.content}`);
    else if (type === 'module') result.modules.push(`- ${rule.triggers?.[0] || ''}: ${rule.content}`);
    else if (type === 'door') result.doors.push(`- ${rule.triggers?.[0] || ''}: ${rule.content}`);
    else if (type === 'material') result.materials.push(rule);
  }

  if (result.background.length === 0) {
    result.background.push('- Clean, bright walls');
    result.background.push('- Natural light');
  }

  return result;
}

function getDefaultWallData(): WallAnalysis {
  return {
    tile_detected: false,
    tile_type: 'standard_wall',
    tile_size_mm: { width: 300, height: 600 },
    wall_width_mm: 3000,
    wall_height_mm: 2400,
    confidence: 'low',
  };
}

const WALL_ANALYSIS_PROMPT = `Analyze this room photo for wall dimensions and utility positions.
Output JSON only:
{
  "tile_detected": true/false,
  "tile_type": "standard_wall",
  "tile_size_mm": { "width": 300, "height": 600 },
  "wall_dimensions_mm": { "width": 3000, "height": 2400 },
  "utility_positions": {
    "water_supply": { "detected": true/false, "from_left_mm": 800 },
    "exhaust_duct": { "detected": true/false, "from_left_mm": 2200 }
  },
  "confidence": "high/medium/low"
}`;

function buildClosedDoorPrompt(
  category: string,
  style: string,
  wallData: WallAnalysis,
  rules: ClassifiedRules
): string {
  return `[TASK: KOREAN BUILT-IN KITCHEN RENDERING - PHOTOREALISTIC]

Generate a photorealistic image of Korean-style built-in ${category} furniture.

[WALL MEASUREMENTS]
- Wall Width: ${wallData.wall_width_mm}mm
- Wall Height: ${wallData.wall_height_mm}mm

[STYLE: ${style}]
- Modern Korean minimalist
- Matte or low-gloss finish
- Hidden handles (push-open)
- Flush doors

[BACKGROUND RULES]
${rules.background.join('\n')}

[MODULE RULES]
${rules.modules.length > 0 ? rules.modules.join('\n') : '- Standard Korean built-in specifications'}

[DOOR SPECS]
${rules.doors.length > 0 ? rules.doors.join('\n') : '- Full door coverage, all doors CLOSED'}

[CRITICAL]
1. PHOTOREALISTIC quality
2. EXACT camera angle from original photo
3. ALL doors CLOSED
4. Clean, finished background
5. No people or clutter

[OUTPUT: Single photorealistic image]`;
}

function buildOpenDoorPrompt(category: string): string {
  const contents: Record<string, string> = {
    sink: '그릇, 접시, 컵, 냄비, 조리도구',
    wardrobe: '셔츠, 재킷, 바지, 서랍 속 옷',
    fridge: '커피머신, 토스터, 식료품',
    storage: '책, 수납박스, 바구니',
  };

  return `[TASK] Open all doors in this furniture image.

[DO NOT CHANGE]
- Door count, positions, sizes
- Colors, materials
- Camera angle, perspective
- Background

[CHANGE ONLY]
- Swing doors: open 90 degrees
- Drawers: pull out 30-40%

[INTERIOR CONTENTS - ${category}]
${contents[category] || contents.storage}

[OUTPUT: Photorealistic image with doors open]`;
}

function buildDesignToImagePrompt(
  category: string,
  style: string,
  specs: Record<string, unknown>,
  items: unknown[]
): string {
  const width = specs.total_width_mm || 3000;
  const height = specs.total_height_mm || 2400;

  return `[TASK: PHOTOREALISTIC KOREAN ${category.toUpperCase()}]

Generate a photorealistic interior photograph of a modern Korean ${category}.

[DIMENSIONS]
- Total: ${width}mm (W) x ${height}mm (H)
- Items: ${items.length}

[STYLE: ${style}]
- Modern Korean minimalist
- Flat panel doors
- Concealed hinges

[ROOM]
- Modern Korean apartment
- White walls, light wood floor
- Natural lighting

[CRITICAL]
1. PHOTOREALISTIC quality
2. ALL DOORS CLOSED
3. Magazine-quality composition

[OUTPUT: High-resolution photorealistic image]`;
}

// ─────────────────────────────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          다담AI HTTP API Server Started                  ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                                              ║`);
  console.log('║  Endpoints:                                               ║');
  console.log('║    POST /webhook/dadam-interior-v4                        ║');
  console.log('║    POST /webhook/design-to-image                          ║');
  console.log('║    GET  /health                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
});

export default app;
