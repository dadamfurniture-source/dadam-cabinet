// ═══════════════════════════════════════════════════════════════
// Generate Route — 투톤 컬러 및 위치 고정 강화 버전
// POST /api/generate
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import { calculateQuote, type ImageAnalysisResult } from '../services/quote.service.js';
import { generateRateLimit } from '../middleware/rate-limiter.js';

const log = createLogger('route:generate');
const router = Router();

// ─── 스타일 매핑 (상부장 기본 색상) ───
const STYLE_UPPER_COLOR: Record<string, string> = {
  'modern-minimal': 'Warm White',
  'scandinavian': 'Milk White',
  'industrial': 'Sand Gray',
  'classic': 'Ivory',
  'luxury': 'Cashmere',
};

// ─── 대체 스타일 매핑 ───
const ALT_STYLE_MAP: Record<string, string> = {
  'modern-minimal': 'scandinavian',
  'scandinavian': 'modern-minimal',
  'industrial': 'classic',
  'classic': 'luxury',
  'luxury': 'modern-minimal',
};

// ─── 투톤 컬러 매핑 (상부장 → 추천 하부장) ───
const TWO_TONE_MAP: Record<string, string> = {
  'Warm White': 'Navy Blue',
  'Milk White': 'Deep Green',
  'Sand Gray': 'Concrete Gray',
  'Ivory': 'Walnut',
  'Cashmere': 'Dark Charcoal',
  'Scandinavian White': 'Nature Oak',
  'Default': 'Deep Grey',
};

type InlineImage = { data: string; mimeType: string };

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
      model: 'claude-sonnet-4-6',
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
      layout_image, mask_image, color_reference_image,
    } = req.body;

    if (!room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

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

    // ═══ Step 1: 벽면 분석 (Gemini Vision, TEXT only) — 싱크대만 plumbing 분석 ═══
    log.info('Step 1: Wall analysis');
    let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;

    try {
      const wallPrompt = category === 'sink'
        ? `Analyze this Korean apartment photo. Return JSON only:
{"wall":{"width":number,"height":number},"plumbing":{"waterPct":number,"exhaustPct":number},"confidence":"high"|"medium"|"low"}
Measure wall width using tile count (Korean 300x600mm tiles). waterPct/exhaustPct as % from left.`
        : `Analyze this Korean apartment photo. Return JSON only:
{"wall":{"width":number,"height":number},"confidence":"high"|"medium"|"low"}
Estimate wall width in mm.`;

      const wallResult = await callGemini(wallPrompt, room_image, image_type, ['TEXT'], 0.2);
      if (wallResult.text) {
        const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          wallW = parsed.wall?.width || 3000;
          wallH = parsed.wall?.height || 2400;
          if (category === 'sink') {
            waterPct = parsed.plumbing?.waterPct || 30;
            exhaustPct = parsed.plumbing?.exhaustPct || 70;
          }
          log.info({ wallW, wallH, waterPct, exhaustPct }, 'Wall analysis parsed');
        }
      }
    } catch (e) {
      log.warn('Wall analysis failed, using defaults');
    }

    // ═══ Step 2: 레이아웃 제약조건 (싱크대만 위치 고정) ═══
    const sinkSide = waterPct <= 50 ? 'LEFT' : 'RIGHT';
    const cooktopSide = exhaustPct <= 50 ? 'LEFT' : 'RIGHT';
    const sinkLayoutConstraints = [
      `[FIXED SINK] ${sinkSide} side at ${waterPct}% from left. MUST MATCH ORIGINAL PLUMBING.`,
      `[FIXED COOKTOP] ${cooktopSide} side at ${exhaustPct}% from left. MUST MATCH ORIGINAL VENT.`,
      `Wall ${wallW}x${wallH}mm.`,
    ].join(' ');

    // ─── 카테고리별 기구 설명 ───
    const CATEGORY_SUBJECT: Record<string, string> = {
      sink: 'handleless flat-panel kitchen cabinets with upper and lower sections, integrated sink, cooktop',
      wardrobe: 'floor-to-ceiling built-in wardrobe with flat-panel doors, handleless push-to-open design',
      fridge: 'tall pantry and refrigerator surround cabinet with flat-panel doors, handleless design',
      vanity: 'modern vanity cabinet with mirror cabinet above, flat-panel doors, handleless push-to-open',
      shoe: 'entryway shoe cabinet with flat-panel doors, handleless push-to-open, ventilation slats',
      storage: 'custom storage cabinet with flat-panel doors, adjustable shelves, handleless design',
    };

    // ─── 카테고리별 기본안 프롬프트 빌더 ───
    function buildBasePrompt(cat: string, colorDesc: string, countertop: string): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      if (cat === 'sink') {
        return `Edit photo: install ${subject}. ${colorDesc} ${sinkLayoutConstraints} ${countertop} countertop. Below cooktop MUST have 2 stacked horizontal drawers. Keep wall tiles, camera identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. ${colorDesc} Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ─── 카테고리별 AI 추천안 프롬프트 빌더 ───
    function buildAltPrompt(cat: string, upperColor: string, upperHex: string, lowerColor: string, lowerHex: string): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      const twoToneDesc = `[TWO-TONE] Upper=${upperColor}${upperHex ? ` HEX ${upperHex}` : ''}, Lower=${lowerColor}${lowerHex ? ` HEX ${lowerHex}` : ''}. [MANDATORY] Upper and lower MUST be DIFFERENT colors.`;
      if (cat === 'sink') {
        return `Edit photo: install ${subject}. ${twoToneDesc} ${sinkLayoutConstraints} Below cooktop MUST have 2 stacked horizontal drawers. Keep wall tiles, camera, sink, cooktop positions identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. ${twoToneDesc} Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ═══ Step 3: 기본안 생성 (무채색 단일 품목) ═══
    log.info('Step 3: Generate base design (기본안)');
    const rcs = random_color_scheme as any;
    const mainUpperColor = rcs?.upper?.name_en || STYLE_UPPER_COLOR[design_style] || 'Warm White';
    const mainLowerColor = rcs?.lower?.name_en || mainUpperColor; // 기본은 단색
    const mainCountertop = rcs?.countertop?.prompt_description || 'white engineered stone';
    const mainUpperHex = rcs?.upper?.color_hex || '';
    const mainLowerHex = rcs?.lower?.color_hex || '';

    const isTwoTone = mainUpperColor !== mainLowerColor;
    const colorPart = isTwoTone
      ? `[TWO-TONE] Upper=${mainUpperColor}${mainUpperHex ? ` HEX ${mainUpperHex}` : ''}, Lower=${mainLowerColor}${mainLowerHex ? ` HEX ${mainLowerHex}` : ''}. Upper and lower MUST be different colors.`
      : `All cabinets ${mainUpperColor}${mainUpperHex ? ` HEX ${mainUpperHex}` : ''} matte.`;

    const mainPrompt = buildBasePrompt(category, colorPart, mainCountertop);

    log.info({ promptLength: mainPrompt.length, mainUpperColor, mainLowerColor, category }, 'Base design prompt');

    const closedResult = await callGemini(
      mainPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.28, extraImages,
    );

    if (!closedResult.image) {
      res.status(500).json({ success: false, error: 'Failed to generate image' });
      return;
    }
    log.info('Base design (기본안) generated');

    // ═══ Step 4: AI 추천안 생성 (투톤 고정: 상부=무채색, 하부=컬러) ═══
    log.info('Step 4: Generate AI recommendation (AI 추천안)');
    const arcs = alt_random_color_scheme as any;
    const altStyleKey = ALT_STYLE_MAP[design_style] || 'scandinavian';
    const altUpperColor = arcs?.upper?.name_en || STYLE_UPPER_COLOR[altStyleKey] || 'Milk White';
    const altLowerColor = arcs?.lower?.name_en || TWO_TONE_MAP[altUpperColor] || TWO_TONE_MAP['Default'];
    const altUpperHex = arcs?.upper?.color_hex || '';
    const altLowerHex = arcs?.lower?.color_hex || '';

    let altImage: string | undefined;
    try {
      const altPrompt = buildAltPrompt(category, altUpperColor, altUpperHex, altLowerColor, altLowerHex);

      log.info({ promptLength: altPrompt.length, altUpperColor, altLowerColor, category }, 'AI recommendation prompt');

      const altResult = await callGemini(
        altPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.28, extraImages,
      );
      altImage = altResult.image;
      if (altImage) log.info('AI recommendation (AI 추천안) generated');
    } catch (e) {
      log.warn('Alt style generation failed');
    }

    // ═══ Step 5: 견적 (Claude Vision) ═══
    log.info('Step 5: Quote analysis');
    let quote = null;
    try {
      const quotePrompt = `Analyze this cabinet design image. Upper cabinets are ${mainUpperColor}, lower are ${mainLowerColor}. Count upper/lower cabinets, estimate total width mm, count drawers. Wall ~${wallW}mm. Return JSON: {"upper_count":N,"lower_count":N,"total_width_mm":N,"drawer_count":N,"countertop_length_mm":N}`;

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
        name: `Two-tone: ${altUpperColor} + ${altLowerColor}`,
        upper: altUpperColor,
        lower: altLowerColor,
      },
      quote,
      wall_analysis: { wallW, wallH, waterPct, exhaustPct },
      applied_random_color_scheme: random_color_scheme || null,
      applied_alt_random_color_scheme: alt_random_color_scheme || null,
      metadata: {
        category, kitchen_layout, design_style,
        model: 'gemini-3.1-flash-image-preview',
        elapsed_ms: elapsed,
        main_colors: { upper: mainUpperColor, lower: mainLowerColor },
        alt_colors: { upper: altUpperColor, lower: altLowerColor },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
