// ═══════════════════════════════════════════════════════════════
// Generate Route — n8n 파이프라인 대체
// POST /api/generate
// Gemini 3.1 Flash Image 직접 호출 (벽분석 + 가구생성 + 열린문)
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import { calculateQuote, type ImageAnalysisResult } from '../services/quote.service.js';

const log = createLogger('route:generate');
const router = Router();

// ─── 레이아웃 타입 설명 ───
const LAYOUT_DESC: Record<string, string> = {
  i_type: 'straight linear I-shaped',
  l_type: 'L-shaped corner',
  u_type: 'U-shaped three-wall',
  peninsula: 'peninsula island facing living room',
};

// ─── 스타일 매핑 ───
const STYLE_MAP: Record<string, string> = {
  'modern-minimal': 'Modern Minimal',
  'scandinavian': 'Scandinavian Nordic',
  'industrial': 'Industrial Vintage',
  'classic': 'Classic Traditional',
  'luxury': 'Luxury Premium',
};

// ─── 대체 스타일 매핑 (선택 스타일 → 다른 스타일) ───
const ALT_STYLE_MAP: Record<string, string> = {
  'modern-minimal': 'scandinavian',
  'scandinavian': 'modern-minimal',
  'industrial': 'classic',
  'classic': 'luxury',
  'luxury': 'modern-minimal',
};

// ─── 대체 스타일 도어 색상 ───
const ALT_DOOR_COLORS: Record<string, { color: string; finish: string; countertop: string }> = {
  'modern-minimal': { color: 'white', finish: 'matte', countertop: 'white engineered stone' },
  'scandinavian': { color: 'light oak wood', finish: 'natural', countertop: 'white marble' },
  'industrial': { color: 'dark charcoal', finish: 'matte', countertop: 'concrete gray countertop' },
  'classic': { color: 'cream ivory', finish: 'semi-gloss', countertop: 'beige granite' },
  'luxury': { color: 'deep navy', finish: 'high-gloss', countertop: 'calacatta marble' },
};

// ─── Gemini API 호출 ───
async function callGemini(
  prompt: string,
  image?: string,
  imageType?: string,
  responseModalities: string[] = ['IMAGE', 'TEXT'],
  temperature = 0.4,
): Promise<{ image?: string; text?: string }> {
  const config = getConfig();
  const model = config.gemini.models.imageGeneration;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  const parts: Array<Record<string, unknown>> = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities, temperature },
  };

  const res = await fetchWithRetry('gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: config.gemini.timeout,
  });

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }
    }>
  };

  const resultParts = data.candidates?.[0]?.content?.parts || [];
  let resultImage: string | undefined;
  let resultText: string | undefined;

  for (const part of resultParts) {
    if (part.inlineData) resultImage = part.inlineData.data;
    if (part.text) resultText = part.text;
  }

  return { image: resultImage, text: resultText };
}

// ─── Claude Vision API 호출 (견적 분석용) ───
async function callClaude(
  prompt: string,
  imageBase64: string,
  imageType: string = 'image/png',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  return textBlock?.text || '';
}

// ─── 벽분석 프롬프트 ───
function buildWallAnalysisPrompt(): string {
  return `[TASK: 한국 주방 벽면 구조 및 설비 분석]

이 사진에서 다음 정보를 JSON으로 추출하세요:
- wall_dimensions_mm: { width, height } (추정치)
- utility_positions_mm: {
    water_supply_from_left, water_supply_confidence,
    exhaust_duct_from_left, exhaust_duct_confidence,
    gas_pipe_from_left, gas_pipe_confidence
  }
- confidence: "high" | "medium" | "low"

JSON만 반환하세요.`;
}

// ─── 가구 생성 프롬프트 ───
function buildFurniturePrompt(
  category: string,
  style: string,
  kitchenLayout: string,
  wallData: { wallW: number; wallH: number; waterPct: number; exhaustPct: number },
  themeData: Record<string, string>,
): string {
  const layoutDesc = LAYOUT_DESC[kitchenLayout] || 'straight linear';
  const styleName = STYLE_MAP[style] || 'Modern Minimal';
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  const countertop = themeData.style_countertop_prompt || 'white stone countertop';

  if (['sink', 'kitchen', 'l_shaped_sink', 'island_kitchen'].includes(category)) {
    return `Place ${doorColor} ${doorFinish} flat panel ${layoutDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY.

[WALL] ${wallData.wallW}x${wallData.wallH}mm wall.
[PLUMBING] Sink at ${wallData.waterPct}% from left, cooktop at ${wallData.exhaustPct}% from left.
[UPPER] 4 upper cabinets flush to ceiling, no gap between ceiling and cabinets. NO dish drying rack on upper cabinets.
[LOWER] 5 lower cabinets (600mm, sink, 600mm, cooktop, 600mm).
[COUNTERTOP] ${countertop}, continuous surface.
[DOORS] No visible handles. Push-to-open mechanism.
[HOOD] Range hood integrated into upper cabinet above cooktop.
[STYLE] ${styleName}. Clean lines. Photorealistic interior photography.
[QUALITY] 8K quality, natural lighting, proper shadows and reflections.

CRITICAL RULES:
- PRESERVE the original room background, walls, floor, ceiling EXACTLY
- All cabinet doors must be CLOSED
- NO dish drying rack or dish drainer on or inside upper cabinets
- No text, labels, dimensions, or annotations
- No people or pets
- Photorealistic magazine-quality result`;
  }

  if (category === 'wardrobe') {
    return `Place ${doorColor} ${doorFinish} built-in wardrobe on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Full-width floor-to-ceiling wardrobe with hinged doors.
Lower cabinet doors can be opened by reaching behind the door. No visible handles.
${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'shoe' || category === 'shoe_cabinet') {
    return `Place ${doorColor} ${doorFinish} shoe cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling.
No visible handles on doors. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'fridge' || category === 'fridge_cabinet') {
    return `Place ${doorColor} ${doorFinish} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Center opening for fridge, tall storage on sides, bridge above.
No visible handles on doors. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'vanity') {
    return `Place ${doorColor} ${doorFinish} bathroom vanity on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Vanity with sink at ${wallData.waterPct}% from left. Mirror cabinet above.
${countertop}. ${styleName}. Photorealistic. Faucet chrome finish.`;
  }

  // storage, custom
  return `Place ${doorColor} ${doorFinish} storage cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Floor-to-ceiling built-in with multiple door sections.
No visible handles on doors. ${styleName}. Photorealistic. All doors closed.`;
}

// ─── 열린문 프롬프트 ───
function buildOpenDoorPrompt(category: string): string {
  return `Using this closed-door furniture image, generate the SAME furniture with doors OPEN.

RULES:
- SAME camera angle, lighting, background, furniture position
- Open doors to ~90 degrees showing interior
- Show neatly organized storage inside
- Photorealistic quality
- Do NOT change any furniture structure or color`;
}

// ─── 견적 분석 프롬프트 ───
function buildQuoteAnalysisPrompt(category: string): string {
  return `Analyze this generated furniture image and extract cabinet specifications as JSON.

Count and measure all visible cabinets precisely.

Return ONLY valid JSON:
{
  "upper_cabinets": [{"width_mm": number, "type": "storage"|"hood"}],
  "lower_cabinets": [{"width_mm": number, "type": "storage"|"sink"|"cooktop"|"drawer"}],
  "countertop_length_mm": number,
  "wall_width_mm": number,
  "has_sink": boolean,
  "has_cooktop": boolean,
  "has_hood": boolean,
  "door_count": number,
  "drawer_count": number
}

Category: ${category}
- Estimate widths in mm based on proportions
- Count ALL doors visible (upper + lower)
- Identify sink (water faucet area), cooktop (burner area), hood (above cooktop)`;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/generate — 메인 이미지 생성 엔드포인트
// ═══════════════════════════════════════════════════════════════
router.post('/api/generate', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const {
      room_image,
      image_type = 'image/jpeg',
      category = 'sink',
      kitchen_layout = 'i_type',
      design_style = 'modern-minimal',
      ...themeData
    } = req.body;

    if (!room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

    log.info({ category, kitchen_layout, design_style }, 'Generate request received');

    // ═══ Step 1: 벽면 분석 ═══
    log.info('Step 1: Wall analysis');
    let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;

    try {
      const wallResult = await callGemini(
        buildWallAnalysisPrompt(),
        room_image,
        image_type,
        ['TEXT'],
        0.2,
      );

      if (wallResult.text) {
        const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const dims = parsed.wall_dimensions_mm || {};
          const utils = parsed.utility_positions_mm || {};
          wallW = dims.width || 3000;
          wallH = dims.height || 2400;
          if (utils.water_supply_from_left) {
            waterPct = Math.round(utils.water_supply_from_left / wallW * 100);
          }
          if (utils.exhaust_duct_from_left) {
            exhaustPct = Math.round(utils.exhaust_duct_from_left / wallW * 100);
          }
          log.info({ wallW, wallH, waterPct, exhaustPct }, 'Wall analysis parsed');
        }
      }
    } catch (e) {
      log.warn('Wall analysis failed, using defaults');
    }

    // ═══ Step 2: 가구 생성 (닫힌문) ═══
    log.info('Step 2: Generating closed door furniture');
    const furniturePrompt = buildFurniturePrompt(
      category, design_style, kitchen_layout,
      { wallW, wallH, waterPct, exhaustPct },
      themeData,
    );

    const closedResult = await callGemini(
      furniturePrompt,
      room_image,
      image_type,
    );

    if (!closedResult.image) {
      res.status(500).json({ success: false, error: 'Failed to generate closed door image' });
      return;
    }

    log.info('Closed door image generated');

    // ═══ Step 3: 대체 스타일 이미지 생성 ═══
    const altStyleKey = ALT_STYLE_MAP[design_style] || 'scandinavian';
    const altColors = ALT_DOOR_COLORS[altStyleKey] || ALT_DOOR_COLORS['scandinavian'];
    log.info({ altStyleKey }, 'Step 3: Generating alternative style');

    let altImage: string | undefined;

    try {
      const altPrompt = buildFurniturePrompt(
        category, altStyleKey, kitchen_layout,
        { wallW, wallH, waterPct, exhaustPct },
        {
          style_door_color: altColors.color,
          style_door_finish: altColors.finish,
          style_countertop_prompt: altColors.countertop,
        },
      );

      const altResult = await callGemini(
        altPrompt,
        room_image,
        image_type,
      );
      altImage = altResult.image;
      if (altImage) log.info('Alternative style image generated');
    } catch (e) {
      log.warn('Alternative style generation failed');
    }

    // ═══ Step 4: 이미지 분석 → 견적 산출 (Claude Vision) ═══
    log.info('Step 4: Analyzing image with Claude for quote');
    let quote = null;

    try {
      const claudeText = await callClaude(
        buildQuoteAnalysisPrompt(category),
        closedResult.image,
        'image/png',
      );
      log.info({ responseLen: claudeText.length }, 'Claude analysis received');

      if (claudeText) {
        const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysisData = JSON.parse(jsonMatch[0]) as ImageAnalysisResult;
          if (!analysisData.wall_width_mm) analysisData.wall_width_mm = wallW;
          if (!analysisData.countertop_length_mm) {
            analysisData.countertop_length_mm = analysisData.lower_cabinets?.reduce((s: number, m: {width_mm: number}) => s + m.width_mm, 0) || wallW;
          }
          quote = calculateQuote(analysisData, category, 'basic');
          log.info({ total: quote.total, items: quote.items.length }, 'Quote calculated via Claude');
        }
      }
    } catch (e) {
      log.warn('Quote analysis failed');
    }

    // ═══ 응답 ═══
    const elapsed = Date.now() - startTime;
    log.info({ elapsed, category }, 'Generation complete');

    res.json({
      success: true,
      generated_image: {
        background: room_image,
        closed: closedResult.image,
        alt: altImage || null,
      },
      alt_style: {
        key: altStyleKey,
        name: STYLE_MAP[altStyleKey] || altStyleKey,
        door_color: altColors.color,
      },
      quote,
      wall_analysis: { wallW, wallH, waterPct, exhaustPct },
      metadata: {
        category,
        kitchen_layout,
        design_style,
        model: 'gemini-3.1-flash-image-preview',
        elapsed_ms: elapsed,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
