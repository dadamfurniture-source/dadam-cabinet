// ═══════════════════════════════════════════════════════════════
// Generate Route v2 — 투톤 + 위치 고정 + 300자 프롬프트
// POST /api/generate
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import { calculateQuote, type ImageAnalysisResult } from '../services/quote.service.js';
import { generateRateLimit } from '../middleware/rate-limiter.js';
import { getWallAnalysisPrompt } from '../lib/ai/prompts/wall-analysis.js';
import { getProductGeneratePrompt, getStyleAltPrompt } from '../lib/ai/prompts/product-generate.js';
import { describeLayoutConstraints, alignLayoutConstraints, type WallAnalysis } from '../lib/utils/layout-engine.js';
import { STYLE_MAP, TWO_TONE_LOWER_COLORS, ALT_DOOR_COLORS, type KitchenStyle } from '../config/kitchen-styles.js';

const log = createLogger('route:generate');
const router = Router();

type InlineImage = { data: string; mimeType: string };

type RandomColorScheme = {
  seed?: number;
  upper?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
  lower?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
  countertop?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
};

// ─── Gemini API 호출 ───
async function callGemini(
  prompt: string,
  image?: string,
  imageType?: string,
  responseModalities: string[] = ['IMAGE', 'TEXT'],
  temperature = 0.4,
  extraImages: InlineImage[] = [],
): Promise<{ image?: string; text?: string }> {
  const config = getConfig();
  const model = config.gemini.models.imageGeneration;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  const parts: Array<Record<string, unknown>> = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
  }
  for (const extra of extraImages) {
    parts.push({ inlineData: { mimeType: extra.mimeType, data: extra.data } });
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

// ─── Claude Vision API (견적 분석용) ───
async function callClaude(prompt: string, imageBase64: string, imageType = 'image/png'): Promise<string> {
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
      model: 'claude-sonnet-4-6-20250514',
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
  return data.content?.find((b: { type: string }) => b.type === 'text')?.text || '';
}

// ─── 색상 결정 ───
function resolveColors(
  styleKey: string,
  randomScheme?: RandomColorScheme,
): { upperColor: string; lowerColor: string; countertopDesc: string; upperHex: string; lowerHex: string } {
  const style = STYLE_MAP[styleKey] || STYLE_MAP['modern-minimal'];

  return {
    upperColor: randomScheme?.upper?.name_en || style.doorColor,
    lowerColor: randomScheme?.lower?.name_en || style.doorColor,
    countertopDesc: randomScheme?.countertop?.prompt_description || `${style.countertopColor} ${style.countertopMaterial}`,
    upperHex: randomScheme?.upper?.color_hex || '',
    lowerHex: randomScheme?.lower?.color_hex || '',
  };
}

function resolveAltColors(
  styleKey: string,
  altScheme?: RandomColorScheme,
): { upperColor: string; lowerColor: string; upperHex: string; lowerHex: string } {
  const twoToneLower = TWO_TONE_LOWER_COLORS[styleKey] || 'Deep Navy';
  const style = STYLE_MAP[styleKey] || STYLE_MAP['modern-minimal'];

  return {
    upperColor: altScheme?.upper?.name_en || style.doorColor,
    lowerColor: altScheme?.lower?.name_en || twoToneLower,
    upperHex: altScheme?.upper?.color_hex || '',
    lowerHex: altScheme?.lower?.color_hex || '',
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/generate
// ═══════════════════════════════════════════════════════════════
router.post('/', generateRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const {
      room_image, image_type = 'image/jpeg',
      category = 'sink', design_style = 'modern-minimal',
      kitchen_layout = 'i_type',
      random_color_scheme, alt_random_color_scheme,
      layout_constraints, layout_image, mask_image, color_reference_image,
    } = req.body;

    if (!room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

    const style = STYLE_MAP[design_style] || STYLE_MAP['modern-minimal'];
    const colors = resolveColors(design_style, random_color_scheme as RandomColorScheme);

    // extra images (레이아웃 가이드, 마스크, 색상 참고)
    const extraImages: InlineImage[] = [];
    if (layout_image?.base64 && layout_image?.mime_type) {
      extraImages.push({ data: String(layout_image.base64), mimeType: String(layout_image.mime_type) });
    }
    if (mask_image?.base64 && mask_image?.mime_type) {
      extraImages.push({ data: String(mask_image.base64), mimeType: String(mask_image.mime_type) });
    }
    if (color_reference_image?.base64 && color_reference_image?.mime_type) {
      extraImages.push({ data: String(color_reference_image.base64), mimeType: String(color_reference_image.mime_type) });
    }

    log.info({ category, design_style, extraImages: extraImages.length }, 'Generate request');

    // ═══ Step 1: 벽면 분석 (Gemini Vision, TEXT only) ═══
    log.info('Step 1: Wall analysis');
    let wallAnalysis: WallAnalysis = {
      wall: { width: 3000, height: 2400 },
      plumbing: { sinkCenter: null, cooktopCenter: null, waterPct: 30, exhaustPct: 70 },
    };

    try {
      const wallResult = await callGemini(
        getWallAnalysisPrompt(category), room_image, image_type, ['TEXT'], 0.2,
      );
      if (wallResult.text) {
        const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          wallAnalysis = {
            wall: { width: parsed.wall?.width || 3000, height: parsed.wall?.height || 2400 },
            plumbing: {
              sinkCenter: parsed.plumbing?.sinkCenter || null,
              cooktopCenter: parsed.plumbing?.cooktopCenter || null,
              waterPct: parsed.plumbing?.waterPct || 30,
              exhaustPct: parsed.plumbing?.exhaustPct || 70,
            },
          };
          log.info(wallAnalysis, 'Wall analysis parsed');
        }
      }
    } catch (e) {
      log.warn('Wall analysis failed, using defaults');
    }

    // ═══ Step 2: 가구 이미지 생성 (Gemini Image, <300 chars) ═══
    log.info('Step 2: Generate furniture image');
    const layoutDesc = describeLayoutConstraints(
      wallAnalysis, category, colors.upperColor, colors.lowerColor, colors.countertopDesc,
    );

    const furniturePrompt = getProductGeneratePrompt(
      category, style, layoutDesc, colors.upperColor, colors.lowerColor,
    );
    log.info({ promptLength: furniturePrompt.length }, 'Furniture prompt');

    const closedResult = await callGemini(
      furniturePrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.28, extraImages,
    );

    if (!closedResult.image) {
      res.status(500).json({ success: false, error: 'Failed to generate image' });
      return;
    }
    log.info('Closed door image generated');

    // ═══ Step 3: 대체 스타일 (투톤: 상부=무채색, 하부=컬러) ═══
    log.info('Step 3: Generate alt style (two-tone)');
    const altColors = resolveAltColors(design_style, alt_random_color_scheme as RandomColorScheme);

    let altImage: string | undefined;
    try {
      const altPrompt = getStyleAltPrompt(
        category,
        { name: style.name, doorColor: altColors.upperColor, doorFinish: style.doorFinish },
        layoutDesc,
        altColors.upperColor,
        altColors.lowerColor,
      );
      log.info({ promptLength: altPrompt.length }, 'Alt prompt');

      const altResult = await callGemini(
        altPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.28, extraImages,
      );
      altImage = altResult.image;
      if (altImage) log.info('Alt style image generated');
    } catch (e) {
      log.warn('Alt style generation failed');
    }

    // ═══ Step 4: 견적 (Claude Vision) ═══
    log.info('Step 4: Quote analysis');
    let quote = null;
    try {
      const quotePrompt = `Analyze this kitchen image. Count upper/lower cabinets, estimate total width mm, count drawers. Wall width ~${wallAnalysis.wall.width}mm. Return JSON: {"upper_count":N,"lower_count":N,"total_width_mm":N,"drawer_count":N,"countertop_length_mm":N}`;

      const mimeType = closedResult.image.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
      const quoteText = await callClaude(quotePrompt, closedResult.image, mimeType);
      const quoteMatch = quoteText.match(/\{[\s\S]*\}/);
      if (quoteMatch) {
        const analysis = JSON.parse(quoteMatch[0]) as ImageAnalysisResult;
        quote = calculateQuote(analysis, category);
        log.info({ total: quote?.total }, 'Quote calculated');
      }
    } catch (e) {
      log.warn('Quote analysis failed');
    }

    const elapsed = Date.now() - startTime;
    log.info({ elapsed }, 'Generation complete');

    res.json({
      success: true,
      generated_image: {
        closed: closedResult.image,
        alt: altImage || null,
      },
      alt_style: {
        name: `Two-tone: ${altColors.upperColor} + ${altColors.lowerColor}`,
        upper: altColors.upperColor,
        lower: altColors.lowerColor,
      },
      quote,
      wall_analysis: wallAnalysis,
      applied_random_color_scheme: random_color_scheme || null,
      applied_alt_random_color_scheme: alt_random_color_scheme || null,
      metadata: {
        category, kitchen_layout, design_style,
        model: 'gemini-3.1-flash-image-preview',
        elapsed_ms: elapsed,
        prompt_length: furniturePrompt.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
