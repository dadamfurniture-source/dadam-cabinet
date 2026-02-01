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
  geminiChat,
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

    // 설계 데이터 추출
    const cabinetSpecs = body.cabinet_specs || {};
    const modules = body.modules || {};
    const items = body.items || body.design_data?.items || [];

    if (!roomImage) {
      return res.status(400).json({
        success: false,
        error: 'room_image is required',
      });
    }

    // 트리거 생성
    const triggers = getTriggers(category, style);

    console.log(`[API] Category: ${category}, Style: ${style}`);
    console.log(`[API] Cabinet specs: ${JSON.stringify(cabinetSpecs)}`);
    console.log(`[API] Modules: upper=${modules.upper_count || modules.upper?.length || 0}, lower=${modules.lower_count || modules.lower?.length || 0}`);
    console.log(`[API] Upper modules: ${JSON.stringify(modules.upper || [])}`);
    console.log(`[API] Lower modules: ${JSON.stringify(modules.lower || [])}`);
    console.log(`[API] Items: ${JSON.stringify(items.slice(0, 2))}...`);

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

    // 4. 프롬프트 조립 (설계 데이터 포함)
    const closedPrompt = buildClosedDoorPrompt(category, style, wallData, classifiedRules, cabinetSpecs, modules);

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

    // 7. 응답 반환 (ai-design.html 호환 형식)
    res.json({
      success: true,
      message: '이미지 생성 완료',
      category,
      style,
      rag_rules_count: ragRules.length,
      // ai-design.html 호환: generated_image.closed.base64, generated_image.open.base64
      generated_image: {
        // 닫힌 도어 이미지
        closed: {
          base64: closedImage,
          mime_type: 'image/png',
        },
        // 열린 도어 이미지
        open: openImage ? {
          base64: openImage,
          mime_type: 'image/png',
        } : null,
        // 레거시 호환 (detaildesign.html 기존 코드용)
        base64: closedImage,
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
// AI 채팅 API
// n8n /webhook/chat 대체
// ─────────────────────────────────────────────────────────────────

app.post('/webhook/chat', async (req, res) => {
  console.log('[API] /webhook/chat called');

  try {
    const body = req.body;
    const message = body.message || '';
    const context = body.context || {};

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required',
      });
    }

    // 시스템 프롬프트 구성
    const systemPrompt = buildChatSystemPrompt(context);

    console.log(`[API] Chat message: "${message.substring(0, 50)}..."`);

    // Gemini 채팅 호출
    const response = await geminiChat(message, systemPrompt);
    const aiResponse = extractTextFromGeminiResponse(response);

    if (!aiResponse) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate response',
      });
    }

    console.log('[API] Chat response generated');

    res.json({
      success: true,
      response: aiResponse,
      output: aiResponse,
    });

  } catch (error) {
    console.error('[API] Chat error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      response: '죄송합니다. 응답 생성 중 오류가 발생했습니다.',
    });
  }
});

function buildChatSystemPrompt(context: Record<string, unknown>): string {
  const page = context.page || 'unknown';
  const itemCount = context.itemCount || 0;
  const designData = context.designData as Record<string, unknown> | undefined;

  let designContext = '';
  if (designData && designData.items) {
    const items = designData.items as unknown[];
    designContext = `현재 설계에 ${items.length}개의 가구 아이템이 있습니다.`;
  }

  return `당신은 다담AI 가구 설계 어시스턴트입니다.
한국어로 친절하고 전문적으로 답변해주세요.

[역할]
- 한국형 빌트인 가구(싱크대, 붙박이장, 냉장고장 등) 설계 전문가
- 사용자의 가구 배치, 치수, 스타일 질문에 답변
- 설계 팁과 추천 제공

[현재 상황]
- 페이지: ${page}
- 아이템 수: ${itemCount}
${designContext}

[응답 가이드라인]
- 간결하고 명확하게 답변
- 구체적인 치수나 규격이 필요하면 한국 표준 기준 제시
- 질문이 불분명하면 확인 질문을 먼저 함`;
}

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

interface CabinetSpecs {
  total_width_mm?: number;
  total_height_mm?: number;
  upper_cabinet_height?: number;
  lower_cabinet_height?: number;
  depth_mm?: number;
  leg_height?: number;
  molding_height?: number;
  door_color_upper?: string;
  door_color_lower?: string;
  door_finish_upper?: string;
  door_finish_lower?: string;
  countertop_color?: string;
  handle_type?: string;
  sink_type?: string;
  faucet_type?: string;
  hood_type?: string;
  cooktop_type?: string;
}

interface ModulesData {
  upper?: Array<{ name?: string; width?: number; height?: number }>;
  lower?: Array<{ name?: string; width?: number; height?: number }>;
  upper_count?: number;
  lower_count?: number;
}

function buildClosedDoorPrompt(
  category: string,
  style: string,
  wallData: WallAnalysis,
  rules: ClassifiedRules,
  cabinetSpecs?: CabinetSpecs,
  modules?: ModulesData
): string {
  // 설계 데이터에서 치수 추출
  const specs = cabinetSpecs || {};
  const totalWidth = specs.total_width_mm || wallData.wall_width_mm;
  const totalHeight = specs.total_height_mm || wallData.wall_height_mm;
  const upperHeight = specs.upper_cabinet_height || 720;
  const lowerHeight = specs.lower_cabinet_height || 870;
  const depth = specs.depth_mm || 600;
  const legHeight = specs.leg_height || 150;

  // 모듈 개수 및 레이아웃
  const upperCount = modules?.upper_count || modules?.upper?.length || 0;
  const lowerCount = modules?.lower_count || modules?.lower?.length || 0;

  // 개별 모듈 크기 문자열 생성
  let upperLayout = '';
  let lowerLayout = '';

  if (modules?.upper && Array.isArray(modules.upper) && modules.upper.length > 0) {
    upperLayout = modules.upper.map((m: Record<string, unknown>) => {
      const w = m.width || m.w || 600;
      const name = m.name || m.type || 'cabinet';
      return `${name}(${w}mm)`;
    }).join(' → ');
  }

  if (modules?.lower && Array.isArray(modules.lower) && modules.lower.length > 0) {
    lowerLayout = modules.lower.map((m: Record<string, unknown>) => {
      const w = m.width || m.w || 600;
      const name = m.name || m.type || 'cabinet';
      return `${name}(${w}mm)`;
    }).join(' → ');
  }

  // 마감재 정보
  const doorColor = specs.door_color_upper || specs.door_color_lower || '화이트';
  const doorFinish = specs.door_finish_upper || specs.door_finish_lower || '무광';
  const countertop = specs.countertop_color || '스노우 화이트';
  const handleType = specs.handle_type || '푸시오픈';

  // 주방 기기
  const sinkType = specs.sink_type || '';
  const hoodType = specs.hood_type || '';
  const cooktopType = specs.cooktop_type || '';

  return `[TASK: KOREAN BUILT-IN KITCHEN - PHOTOREALISTIC RENDERING]

Create a photorealistic interior photo of a modern Korean built-in ${category} cabinet system.

[CABINET SPECIFICATIONS - EXACT MATCH REQUIRED]
- Total width: ${totalWidth}mm (${(totalWidth/1000).toFixed(1)}m)
- Total height: ${totalHeight}mm
- Upper cabinet: ${upperCount}개, height ${upperHeight}mm
- Lower cabinet: ${lowerCount}개, height ${lowerHeight}mm
- Depth: ${depth}mm
- Leg/kickboard height: ${legHeight}mm
${upperLayout ? `\n[UPPER CABINET LAYOUT - LEFT TO RIGHT]\n${upperLayout}` : ''}
${lowerLayout ? `\n[LOWER CABINET LAYOUT - LEFT TO RIGHT]\n${lowerLayout}` : ''}

[MATERIALS & COLORS - MUST MATCH]
- Door color: ${doorColor}
- Door finish: ${doorFinish} (matte/satin)
- Countertop: ${countertop}
- Handle: ${handleType}
${sinkType ? `- Sink: ${sinkType}` : ''}
${hoodType ? `- Hood: ${hoodType}` : ''}
${cooktopType ? `- Cooktop: ${cooktopType}` : ''}

[STYLE: ${style}]
- Modern Korean minimalist apartment kitchen
- Clean, seamless door panels
- Integrated handles or push-open system
- Premium quality finish

[COMPOSITION]
- Frontal or slight angle view
- Show full cabinet system from floor to ceiling
- Natural daylight from window
- Clean white/light gray walls

[MUST AVOID - CRITICAL]
- NO dimension labels or measurements on image
- NO text, numbers, or annotations
- NO arrows or dimension lines
- NO watermarks or logos
- NO people or pets
- NO clutter or mess

[OUTPUT]
Single photorealistic image, magazine quality, interior design photograph style.
ALL cabinet doors must be CLOSED.`;
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
  console.log('║    POST /webhook/chat                                     ║');
  console.log('║    GET  /health                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
});

export default app;
