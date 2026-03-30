// ═══════════════════════════════════════════════════════════════
// Direct Generation Service — n8n 없이 Gemini 직접 호출
// 벽분석 → 프롬프트 생성 → 가구 생성 → 열린문 생성
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import { AppError } from '../utils/errors.js';
import { sanitizePromptInput } from '../utils/sanitize.js';
import {
  DEFAULT_WALL_WIDTH_MM,
  DEFAULT_WALL_HEIGHT_MM,
  SINK_POSITION_RATIO,
  COOKTOP_POSITION_RATIO,
} from '../constants/dimensions.js';

const log = createLogger('direct-generation');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface GenerationInput {
  roomImage: string;       // base64
  imageType: string;       // image/jpeg
  category: string;        // sink, wardrobe, etc.
  kitchenLayout?: string;  // i_type, l_type, u_type, peninsula
  designStyle: string;     // modern-minimal, scandinavian, etc.
  styleName?: string;
  styleKeywords?: string;
  styleMoodPrompt?: string;
  styleDoorColor?: string;
  styleDoorHex?: string;
  styleDoorFinish?: string;
  styleCountertopPrompt?: string;
  styleHandlePrompt?: string;
  styleAccentPrompt?: string;
}

export interface GenerationResult {
  success: boolean;
  backgroundImage: string;
  closedImage: string;
  openImage: string | null;
  wallAnalysis?: Record<string, unknown>;
  prompt?: string;
  elapsed?: number;
}

// ─────────────────────────────────────────────────────────────
// Gemini API 호출 헬퍼
// ─────────────────────────────────────────────────────────────

async function geminiCall(model: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = getConfig();
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${config.gemini.apiKey}`;

  const res = await fetchWithRetry('gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: config.gemini.timeout,
  });

  return res.json() as Promise<Record<string, unknown>>;
}

function extractImage(data: Record<string, unknown>): string | null {
  const candidates = (data.candidates || []) as Array<{ content?: { parts?: Array<{ inlineData?: { data: string } }> } }>;
  for (const c of candidates) {
    for (const part of c.content?.parts || []) {
      if (part.inlineData?.data) return part.inlineData.data;
    }
  }
  return null;
}

function extractText(data: Record<string, unknown>): string {
  const candidates = (data.candidates || []) as Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  for (const c of candidates) {
    for (const part of c.content?.parts || []) {
      if (part.text) return part.text;
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// Step 1: 벽면 분석 (Gemini Vision)
// ─────────────────────────────────────────────────────────────

async function analyzeWall(roomImage: string, imageType: string): Promise<Record<string, unknown>> {
  const config = getConfig();

  const prompt = `한국 주방 현장 사진을 분석하세요. JSON만 반환하세요.
{
  "wall_width_mm": 벽 너비(mm),
  "wall_height_mm": 벽 높이(mm),
  "water_supply_position": 급수관 왼쪽 끝으로부터 거리(mm) 또는 null,
  "exhaust_duct_position": 배기덕트/환풍구 왼쪽 끝으로부터 거리(mm) 또는 null,
  "gas_pipe_position": 가스관 왼쪽 끝으로부터 거리(mm) 또는 null,
  "confidence": "high"|"medium"|"low"
}`;

  try {
    const data = await geminiCall(config.gemini.models.vision, {
      contents: [{
        parts: [
          { inlineData: { mimeType: imageType, data: roomImage } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });

    const text = extractText(data);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    log.warn({ error: e }, 'Wall analysis failed, using defaults');
  }

  return {
    wall_width_mm: 3000,
    wall_height_mm: 2400,
    water_supply_position: 900,
    exhaust_duct_position: 2100,
    confidence: 'low',
  };
}

// ─────────────────────────────────────────────────────────────
// Step 2: 프롬프트 생성 (n8n 300자 제한 없음!)
// ─────────────────────────────────────────────────────────────

function buildFurniturePrompt(input: GenerationInput, wallData: Record<string, unknown>): string {
  const rawW = wallData.wall_width_mm as number;
  const rawH = wallData.wall_height_mm as number;
  const wallW = (Number.isFinite(rawW) && rawW > 0) ? rawW : DEFAULT_WALL_WIDTH_MM;
  const wallH = (Number.isFinite(rawH) && rawH > 0) ? rawH : DEFAULT_WALL_HEIGHT_MM;
  const waterPos = (wallData.water_supply_position as number) || Math.round(wallW * SINK_POSITION_RATIO);
  const exhaustPos = (wallData.exhaust_duct_position as number) || Math.round(wallW * COOKTOP_POSITION_RATIO);
  const waterPct = Math.round(waterPos / wallW * 100);
  const exhaustPct = Math.round(exhaustPos / wallW * 100);

  const isKitchen = ['sink', 'l_shaped_sink', 'island_kitchen', 'kitchen'].includes(input.category);

  // 레이아웃별 설명
  const layoutDescMap: Record<string, string> = {
    i_type: 'straight linear I-shaped kitchen along one wall',
    l_type: 'L-shaped corner kitchen using two walls',
    u_type: 'U-shaped kitchen using three walls',
    peninsula: 'peninsula kitchen with island counter facing living room',
  };
  const layoutDesc = layoutDescMap[input.kitchenLayout || 'i_type'] || 'straight linear kitchen';

  // 스타일 (사용자 입력 sanitize)
  const doorColor = sanitizePromptInput(input.styleDoorColor, 100) || 'white';
  const doorFinish = sanitizePromptInput(input.styleDoorFinish, 100) || 'matte';
  const countertop = sanitizePromptInput(input.styleCountertopPrompt, 200) || 'white engineered stone';
  const handle = 'handleless integrated grip recessed into door material, no visible hardware, clean flush surface';
  const style = sanitizePromptInput(input.styleName || input.designStyle, 200) || 'Modern Minimal';
  const mood = sanitizePromptInput(input.styleMoodPrompt, 300);

  if (isKitchen) {
    return `[TASK] Place ${doorColor} ${doorFinish} flat panel ${layoutDesc} cabinets on this photo.

[CRITICAL RULES]
- PRESERVE the original background EXACTLY: walls, floor, ceiling, windows, pipes, electrical boxes
- Do NOT change camera angle, lighting, or room structure
- Clean the construction debris from floor but keep all wall/ceiling elements
- All cabinet doors must be CLOSED

[KITCHEN LAYOUT]
- Wall: ${wallW}mm wide × ${wallH}mm tall
- Layout: ${layoutDesc}
- Sink position: ${waterPct}% from left wall
- Cooktop/hood position: ${exhaustPct}% from left wall

[CABINET SPECIFICATIONS]
- Upper cabinets: flush to ceiling, ${doorColor} ${doorFinish} flat panel doors, NO handles, NO knobs
- Lower cabinets: floor-standing with toe kick, ${doorColor} ${doorFinish} flat panel doors, NO handles, NO knobs
- ALL doors and drawers: completely HANDLELESS — NO bar handles, NO knobs, NO pull handles, NO visible hardware at all
- Door opening method: hidden J-profile grip or push-to-open, recessed into the door panel itself
- Countertop: ${countertop}
- Sink: stainless steel undermount with chrome faucet
- Hood: concealed/integrated range hood

[STYLE]
- ${style}
${mood ? '- ' + mood : ''}
- Photorealistic interior photography, magazine quality
- Natural lighting, no artificial effects

[FORBIDDEN]
- NO handles, NO knobs, NO bar pulls, NO visible door hardware on ANY cabinet
- NO text, numbers, dimensions, labels, or annotations
- NO watermarks or logos
- NO people or pets
- NO changing the room structure`;
  }

  // 비주방 카테고리
  const categoryPrompts: Record<string, string> = {
    wardrobe: `full-width floor-to-ceiling built-in wardrobe with ${doorColor} ${doorFinish} hinged doors`,
    shoe_cabinet: `slim profile floor-to-ceiling shoe cabinet (300-400mm depth) with ${doorColor} ${doorFinish} doors`,
    vanity: `bathroom vanity cabinet with ${countertop} countertop, sink at ${waterPct}% from left, mirror cabinet above`,
    fridge_cabinet: `refrigerator surround cabinet with center opening for fridge, tall storage on sides, bridge cabinet above`,
    storage_cabinet: `floor-to-ceiling storage cabinet with multiple ${doorColor} ${doorFinish} door sections`,
  };

  const catDesc = categoryPrompts[input.category] || `${input.category} built-in cabinet`;

  return `[TASK] Place ${catDesc} on this photo.

[CRITICAL RULES]
- PRESERVE the original background EXACTLY
- Wall: ${wallW}mm × ${wallH}mm
- ${handle}
- ${style}
- Photorealistic, all doors closed

[FORBIDDEN]
- NO text, labels, dimensions, annotations
- NO watermarks, logos, people`;
}

function buildOpenDoorPrompt(category: string): string {
  return `[TASK] Open ALL cabinet doors and drawers in this kitchen image.

[RULES]
- Keep the EXACT same camera angle, lighting, and room background
- Open every door to approximately 90 degrees
- Open every drawer fully pulled out
- Show neatly organized storage contents inside (dishes, pots, utensils)
- Keep all cabinet structure, countertop, and appliances in place
- Photorealistic result

[FORBIDDEN]
- Do NOT change camera angle
- Do NOT add/remove/merge/split any doors
- Do NOT change door types (swing vs drawer)
- NO text or annotations`;
}

// ─────────────────────────────────────────────────────────────
// Step 3: 가구 이미지 생성 (Gemini 3.1 Flash Image)
// ─────────────────────────────────────────────────────────────

async function generateFurnitureImage(
  prompt: string,
  roomImage: string,
  imageType: string,
): Promise<string> {
  const config = getConfig();
  const model = config.gemini.models.imageGeneration;

  const data = await geminiCall(model, {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: imageType, data: roomImage } },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      temperature: 0.4,
    },
  });

  const image = extractImage(data);
  if (!image) {
    const text = extractText(data);
    throw new AppError(`Gemini returned no image. Text: ${text.substring(0, 100)}`, 500, 'NO_IMAGE');
  }

  return image;
}

// ─────────────────────────────────────────────────────────────
// 메인 파이프라인
// ─────────────────────────────────────────────────────────────

export async function generateDirect(input: GenerationInput): Promise<GenerationResult> {
  const startTime = Date.now();

  log.info({ category: input.category, style: input.designStyle }, 'Direct generation started');

  // Step 1: 벽면 분석
  log.info('Step 1: Wall analysis');
  const wallData = await analyzeWall(input.roomImage, input.imageType);
  log.info({ wallData }, 'Wall analysis complete');

  // Step 2: 프롬프트 생성 (길이 제한 없음!)
  const furniturePrompt = buildFurniturePrompt(input, wallData);
  log.info({ promptLength: furniturePrompt.length }, 'Step 2: Prompt built (no length limit)');

  // Step 3: 닫힌문 이미지 생성
  log.info('Step 3: Generating closed door image');
  const closedImage = await generateFurnitureImage(furniturePrompt, input.roomImage, input.imageType);
  log.info('Closed door image generated');

  // Step 4: 열린문 이미지 생성
  let openImage: string | null = null;
  try {
    log.info('Step 4: Generating open door image');
    const openPrompt = buildOpenDoorPrompt(input.category);
    openImage = await generateFurnitureImage(openPrompt, closedImage, 'image/png');
    log.info('Open door image generated');
  } catch (e) {
    log.warn({ error: e }, 'Open door generation failed');
  }

  const elapsed = Date.now() - startTime;
  log.info({ elapsed, category: input.category }, 'Direct generation complete');

  return {
    success: true,
    backgroundImage: input.roomImage,
    closedImage,
    openImage,
    wallAnalysis: wallData,
    prompt: furniturePrompt,
    elapsed,
  };
}
