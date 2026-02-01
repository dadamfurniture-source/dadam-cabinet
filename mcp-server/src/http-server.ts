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
import {
  searchInteriorImages,
  getCategoryQuery,
  trackDownload,
  type UnsplashImage,
} from './services/unsplash-service.js';

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

    // 테마/컬러 데이터 (프론트엔드에서 전달)
    const styleKeywords = body.style_keywords || '';
    const styleAtmosphere = body.style_atmosphere || '';
    const colorName = body.color_name || '';
    const colorHex = body.color_hex || '';
    const colorPrompt = body.color_prompt || '';

    // 설계 데이터 추출
    const cabinetSpecs = body.cabinet_specs || {};
    const modules = body.modules || {};
    const items = body.items || body.design_data?.items || [];

    // 테마/컬러 정보를 cabinetSpecs에 병합
    if (colorName) {
      cabinetSpecs.door_color_upper = colorName;
      cabinetSpecs.door_color_lower = colorName;
    }

    if (!roomImage) {
      return res.status(400).json({
        success: false,
        error: 'room_image is required',
      });
    }

    // 트리거 생성
    const triggers = getTriggers(category, style);

    console.log(`[API] Category: ${category}, Style: ${style}`);
    console.log(`[API] Theme: ${styleKeywords}, Color: ${colorName} (${colorHex})`);
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

          // 배관 위치 간편 접근용 필드 설정
          if (parsed.utility_positions) {
            wallData.water_pipe_x = parsed.utility_positions.water_supply?.from_origin_mm
              || parsed.utility_positions.water_supply?.from_left_mm || 800;
            wallData.exhaust_duct_x = parsed.utility_positions.exhaust_duct?.from_origin_mm
              || parsed.utility_positions.exhaust_duct?.from_left_mm || 2200;
            wallData.gas_pipe_x = parsed.utility_positions.gas_pipe?.from_origin_mm
              || parsed.utility_positions.gas_line?.from_origin_mm || 2000;
          }

          console.log(`[API] Wall analysis complete: ${wallData.wall_width_mm}x${wallData.wall_height_mm}mm`);
          console.log(`[API] Utility positions - Water: ${wallData.water_pipe_x}mm, Hood: ${wallData.exhaust_duct_x}mm, Gas: ${wallData.gas_pipe_x}mm`);
        }
      }
    } catch (error) {
      console.log('[API] Wall analysis failed, using defaults');
    }

    // 4. 프롬프트 조립 (설계 데이터 + 테마/컬러 포함)
    const closedPrompt = buildClosedDoorPrompt(category, style, wallData, classifiedRules, cabinetSpecs, modules, styleKeywords, styleAtmosphere, colorPrompt);

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

// ─────────────────────────────────────────────────────────────────
// 테마 갤러리 API: 인테리어 테마 이미지 조회
// ─────────────────────────────────────────────────────────────────

app.get('/api/themes/images', async (req, res) => {
  console.log('[API] /api/themes/images called');

  try {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 20;
    const query = (req.query.query as string) || 'korean interior kitchen';
    const category = req.query.category as string;

    // 카테고리가 제공되면 해당 쿼리 사용
    const searchQuery = category ? getCategoryQuery(category) : query;

    console.log(`[API] Theme search: "${searchQuery}" (page ${page}, per_page ${perPage})`);

    const result = await searchInteriorImages(searchQuery, page, perPage);

    res.json(result);
  } catch (error) {
    console.error('[API] Theme images error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch theme images',
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 테마 기반 AI 이미지 생성
// ─────────────────────────────────────────────────────────────────

app.post('/api/themes/generate', async (req, res) => {
  console.log('[API] /api/themes/generate called');

  try {
    const body = req.body;
    const style = body.style || 'modern-minimal';
    const styleKeywords = body.styleKeywords || '';
    const styleAtmosphere = body.styleAtmosphere || '';
    const color = body.color || 'pure-white';
    const colorPrompt = body.colorPrompt || 'pure white matte finish';
    const colorHex = body.colorHex || '#FFFFFF';
    const cabinetSpecs = body.cabinetSpecs || {};

    console.log(`[API] Generating design: style=${style}, color=${color}`);

    // 스타일+컬러 기반 프롬프트 생성
    const prompt = buildStyleColorPrompt(style, styleKeywords, styleAtmosphere, colorPrompt, cabinetSpecs);

    // Gemini 이미지 생성 (참조 이미지 없이)
    console.log('[API] Generating AI image...');
    const response = await geminiImageGeneration(prompt);
    const generatedImage = extractImageFromGeminiResponse(response);

    if (!generatedImage) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate image',
      });
    }

    console.log('[API] Style-based image generated successfully');

    res.json({
      success: true,
      generatedImage: {
        base64: generatedImage,
        mimeType: 'image/png',
      },
    });
  } catch (error) {
    console.error('[API] Theme generate error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 스타일+컬러 기반 프롬프트 빌더
 */
function buildStyleColorPrompt(
  style: string,
  styleKeywords: string,
  styleAtmosphere: string,
  colorPrompt: string,
  cabinetSpecs?: CabinetSpecs
): string {
  const specs = cabinetSpecs || {};

  let specsSection = '';
  if (Object.keys(specs).length > 0) {
    specsSection = `
[CABINET SPECIFICATIONS]
${specs.total_width_mm ? `- Total width: ${specs.total_width_mm}mm` : ''}
${specs.total_height_mm ? `- Total height: ${specs.total_height_mm}mm` : ''}
${specs.countertop_color ? `- Countertop: ${specs.countertop_color}` : ''}
${specs.handle_type ? `- Handle: ${specs.handle_type}` : ''}`;
  }

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: KOREAN APARTMENT KITCHEN - PHOTOREALISTIC PHOTOGRAPH]
Generate a photorealistic interior photograph of a modern Korean apartment kitchen.

[INTERIOR STYLE: ${style.toUpperCase().replace('-', ' ')}]
Style keywords: ${styleKeywords}
Atmosphere: ${styleAtmosphere}

[DOOR COLOR & FINISH]
Cabinet door color: ${colorPrompt}
- Apply this color consistently to all cabinet doors (upper and lower)
- Matte or satin finish preferred
- Seamless flat panel doors with concealed hinges

[KITCHEN LAYOUT]
- Korean I-shaped or L-shaped kitchen layout
- Upper cabinets: wall-mounted, reaching near ceiling
- Lower cabinets: base cabinets with countertop
- Integrated sink and cooktop area
- Clean countertop surface (engineered stone or similar)

[ROOM SETTING]
- Modern Korean apartment (typical 30-40 pyeong apartment)
- Ceiling height: approximately 2.3-2.4m
- Natural lighting from window (if visible)
- Light-colored walls (white or light gray)
- Light wood or tile flooring

[APPLIANCES & FIXTURES]
- Built-in or under-counter refrigerator space
- Recessed or slim range hood
- Modern single-lever faucet
- Undermount or integrated sink
${specsSection}

[CAMERA ANGLE]
- Eye-level perspective, slightly angled
- Show full kitchen from one end
- Professional interior photography composition

[STRICTLY FORBIDDEN - WILL REJECT IF VIOLATED]
- NO dimension labels, measurements, or rulers
- NO text, numbers, letters, or characters anywhere
- NO arrows, lines, or technical markings
- NO watermarks, logos, or brand names
- NO people, pets, or moving objects
- NO food items or cooking utensils on counters
- NO annotations of any kind

[OUTPUT REQUIREMENTS]
- Photorealistic quality (must look like a real photograph)
- Magazine-quality interior design photography
- Professional lighting with natural feel
- All cabinet doors CLOSED
- Clean, uncluttered countertops
- High resolution, sharp details`;
}

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
    reference_wall: {
      origin_point: 'left_edge',
      origin_reason: '기본값: 왼쪽 끝선 기준',
    },
    tile_detected: false,
    tile_type: 'standard_wall',
    tile_size_mm: { width: 300, height: 600 },
    wall_width_mm: 3000,
    wall_height_mm: 2400,
    // 배관 위치 기본값 (일반적인 한국 주방 레이아웃)
    water_pipe_x: 800,       // 싱크대 위치 (왼쪽에서 800mm)
    exhaust_duct_x: 2200,    // 후드 위치 (왼쪽에서 2200mm)
    gas_pipe_x: 2000,        // 가스레인지 위치 (왼쪽에서 2000mm)
    confidence: 'low',
  };
}

const WALL_ANALYSIS_PROMPT = `[TASK: KOREAN KITCHEN WALL ANALYSIS]

[STEP 1: 기준벽 및 기준점(0mm) 설정]
기준점 설정 우선순위:
1순위: 벽이 없이 틔어져 있는 끝선 (개방된 공간 쪽)
2순위: 양쪽이 막혀 있다면 → 후드에서 먼 쪽 끝선을 기준점으로 설정

※ 해당 기준점을 0mm로 설정하고, 반대 방향으로 거리 측정

[STEP 2: 타일을 자(Ruler)로 활용한 치수 측정]
- 벽 타일이 있는 경우: 타일 1장 = 가로 300mm × 세로 600mm (한국 표준 규격)
- 타일 개수를 세어 전체 벽면 크기 계산
- 타일이 없는 경우: 표준 한국 아파트 천장 높이 2400mm 기준으로 추정

[STEP 3: 배관 및 설비 위치 식별]
기준점(0mm)에서의 거리를 계산:
- 수도 배관 (급수/배수): 싱크볼 설치 위치 결정용
- 후드 배기구멍: 후드 및 쿡탑 설치 위치 결정용
- 가스 배관: 가스레인지/쿡탑 설치 위치 결정용

Output JSON only:
{
  "reference_wall": {
    "origin_point": "open_edge or far_from_hood",
    "origin_reason": "1: 틔어진 끝선 or 2: 양쪽 막힘 - 후드 반대편 기준"
  },
  "tile_measurement": {
    "detected": true/false,
    "tile_size_mm": { "width": 300, "height": 600 },
    "tile_count": { "horizontal": 10, "vertical": 4 }
  },
  "wall_dimensions_mm": { "width": 3000, "height": 2400 },
  "utility_positions": {
    "water_supply": { "detected": true/false, "from_origin_mm": 800, "from_floor_mm": 500 },
    "exhaust_duct": { "detected": true/false, "from_origin_mm": 2200, "from_floor_mm": 2100 },
    "gas_pipe": { "detected": true/false, "from_origin_mm": 2000, "from_floor_mm": 800 }
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
  modules?: ModulesData,
  styleKeywords?: string,
  styleAtmosphere?: string,
  colorPrompt?: string
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

  // 배관 위치 정보
  const waterPos = wallData.water_pipe_x || 800;
  const exhaustPos = wallData.exhaust_duct_x || 2200;
  const gasPos = wallData.gas_pipe_x || 2000;

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: KOREAN BUILT-IN KITCHEN - PHOTOREALISTIC PHOTO]

═══════════════════════════════════════════════════════════════
[SECTION 1: 공간 구조 유지 + 배경 보정]
═══════════════════════════════════════════════════════════════
PRESERVE (반드시 유지):
- 카메라 앵글과 시점
- 방의 전체적인 구조와 레이아웃
- 창문, 문, 천장의 위치
- 조명 조건

CLEAN UP (깔끔하게 보정):
- 노출된 전선 → 제거 또는 벽 안으로 숨김
- 시멘트 벽, 미장 안 된 벽 → 깔끔한 벽지/페인트로 마감
- 찢어진 벽지, 곰팡이 → 새 벽지로 교체
- 공사 자재, 먼지 → 제거하여 깔끔한 상태로
- 바닥 보호 비닐, 테이프 → 제거하고 마감된 바닥으로

═══════════════════════════════════════════════════════════════
[SECTION 2: 배관 위치 기반 설비 배치]
═══════════════════════════════════════════════════════════════
수도 배관 위치 (기준점에서 약 ${waterPos}mm):
→ 싱크볼 중심을 이 위치에 맞춰 설치
→ 수전(Faucet)을 싱크볼 위에 설치

후드 배기구멍 위치 (기준점에서 약 ${exhaustPos}mm):
→ 레인지후드를 이 위치 아래에 설치
→ 쿡탑/가스레인지를 후드 바로 아래에 설치

가스 배관 위치 (기준점에서 약 ${gasPos}mm):
→ 가스레인지/쿡탑 설치 시 참고

═══════════════════════════════════════════════════════════════
[SECTION 3: 캐비닛 디자인]
═══════════════════════════════════════════════════════════════
Upper cabinets: ${upperCount} units
Lower cabinets: ${lowerCount} units
${upperLayout ? `Upper layout: ${upperLayout}` : ''}
${lowerLayout ? `Lower layout: ${lowerLayout}` : ''}

═══════════════════════════════════════════════════════════════
[SECTION 4: 사용자 선택 테마/컬러 적용] ★ 중요
═══════════════════════════════════════════════════════════════
[STYLE: ${style}]
${styleKeywords ? styleKeywords : 'Modern Korean minimalist kitchen with clean seamless door panels.'}
${styleAtmosphere ? `Atmosphere: ${styleAtmosphere}` : ''}

[DOOR COLOR - 사용자 선택]
- 도어 색상: ${doorColor}
- 마감: ${doorFinish}
${colorPrompt ? `- 색상 스타일: ${colorPrompt}` : ''}

※ 반드시 위 사용자 선택 컬러로 모든 캐비닛 도어를 렌더링할 것

═══════════════════════════════════════════════════════════════
[SECTION 5: 추가 마감재]
═══════════════════════════════════════════════════════════════
- Countertop: ${countertop}
- Handle: ${handleType}
${sinkType ? `- Sink: ${sinkType}` : ''}
${hoodType ? `- Hood: ${hoodType}` : ''}
${cooktopType ? `- Cooktop: ${cooktopType}` : ''}

═══════════════════════════════════════════════════════════════
[STRICTLY FORBIDDEN]
═══════════════════════════════════════════════════════════════
❌ NO dimension labels or measurements
❌ NO text, numbers, or characters
❌ NO arrows, lines, or technical markings
❌ NO watermarks or logos
❌ NO people or pets

═══════════════════════════════════════════════════════════════
[OUTPUT]
═══════════════════════════════════════════════════════════════
Clean photorealistic interior photograph.
Magazine quality, professional lighting.
Construction mess cleaned up, walls finished nicely.
All cabinet doors CLOSED with user-selected color.`;
}

function buildOpenDoorPrompt(category: string): string {
  const contents: Record<string, string> = {
    sink: '그릇, 접시, 컵, 냄비, 조리도구',
    wardrobe: '셔츠, 재킷, 바지, 서랍 속 옷',
    fridge: '커피머신, 토스터, 식료품',
    storage: '책, 수납박스, 바구니',
  };

  return `[TASK] Open all doors in this furniture image.

[CRITICAL - PRESERVE EXACTLY]
- KEEP the EXACT same camera angle and perspective
- KEEP the EXACT same room background (walls, floor, ceiling, windows)
- KEEP the EXACT same lighting conditions
- KEEP the EXACT same door count, positions, sizes
- KEEP the EXACT same colors and materials

[CHANGE ONLY - DOOR STATE]
- Swing doors: open 90 degrees outward
- Drawers: pull out 30-40%

[INTERIOR CONTENTS - ${category}]
${contents[category] || contents.storage}

[ABSOLUTELY FORBIDDEN]
- NEVER add dimension labels, measurements, or text
- NEVER change the background or room elements
- NEVER change the camera angle

[OUTPUT: Photorealistic image with doors open, same background]`;
}

function buildDesignToImagePrompt(
  category: string,
  style: string,
  specs: Record<string, unknown>,
  items: unknown[]
): string {
  const width = specs.total_width_mm || 3000;
  const height = specs.total_height_mm || 2400;

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: PHOTOREALISTIC KOREAN ${category.toUpperCase()}]

Generate a photorealistic interior photograph of a modern Korean ${category}.

[STYLE: ${style}]
Modern Korean minimalist with flat panel doors and concealed hinges.

[ROOM SETTING]
Modern Korean apartment with white walls, light wood floor, natural lighting.

[STRICTLY FORBIDDEN - WILL REJECT IF VIOLATED]
❌ NO dimension labels or measurements
❌ NO text, numbers, or characters
❌ NO arrows, lines, or technical markings
❌ NO rulers, scales, or size indicators
❌ NO watermarks or logos
❌ NO annotations of any kind
❌ NO people or pets

[OUTPUT]
Clean photorealistic interior photograph.
Magazine quality, professional lighting.
All cabinet doors CLOSED.`;
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
  console.log('║    GET  /api/themes/images                                ║');
  console.log('║    POST /api/themes/generate                              ║');
  console.log('║    GET  /health                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
});

export default app;
