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
  retryOverride: { maxRetries?: number } = {},
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
  }, retryOverride);

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
router.post('/api/generate', generateRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const {
      room_image, image_type = 'image/jpeg',
      category = 'sink', design_style = 'modern-minimal',
      kitchen_layout = 'i_type',
      // 레거시 호환: 기존 색상 스키마가 전달되면 무시
      random_color_scheme: _rcs, alt_random_color_scheme: _arcs,
      layout_image, mask_image,
      color_reference_image: _cri, alt_color_reference_image: _acri,
    } = req.body;

    if (!room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

    // extra images (레이아웃 가이드, 마스크만 유지 — 색상 참조 이미지 제거)
    const extraImages: InlineImage[] = [];
    if (layout_image?.base64 && layout_image?.mime_type) {
      extraImages.push({ data: String(layout_image.base64), mimeType: String(layout_image.mime_type) });
    }
    if (mask_image?.base64 && mask_image?.mime_type) {
      extraImages.push({ data: String(mask_image.base64), mimeType: String(mask_image.mime_type) });
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

    // ─── 싱크대 공통 디테일 (압축) ───
    const SINK_DETAILS = `Sink: undermount single-bowl, matte gunmetal. Faucet: minimalist pull-down, matte black. Hood: slim hidden under-cabinet type. Cooktop: flush induction (NO gas). Below cooktop: 2-tier drawer. Upper cabinets: MUST be NEW flat-panel J-pull handleless (NOT original).`;

    // ─── 카테고리별 기구 설명 ───
    const CATEGORY_SUBJECT: Record<string, string> = {
      sink: 'modern handleless flat-panel kitchen cabinets',
      wardrobe: 'floor-to-ceiling built-in wardrobe with flat-panel doors',
      fridge: 'tall pantry and refrigerator surround cabinet',
      vanity: 'modern vanity cabinet with mirror cabinet above',
      shoe: 'entryway shoe cabinet with ventilation',
      storage: 'custom storage cabinet with adjustable shelves',
    };

    // ─── 색상 팔레트 ───
    const BASE_ACHROMATICS = ['white', 'milk white', 'sand gray', 'light gray', 'fog gray', 'cashmere'];
    const ALT_TWO_TONES: Array<{ upper: string; lower: string }> = [
      { upper: 'cream white', lower: 'deep forest green' },
      { upper: 'white',       lower: 'navy blue' },
      { upper: 'light gray',  lower: 'deep purple' },
      { upper: 'sand beige',  lower: 'terracotta' },
      { upper: 'cashmere',    lower: 'walnut wood' },
      { upper: 'milk white',  lower: 'natural oak wood' },
      { upper: 'fog gray',    lower: 'concrete charcoal' },
      { upper: 'ivory',       lower: 'matte black' },
      { upper: 'warm white',  lower: 'olive green' },
      { upper: 'pale taupe',  lower: 'burgundy' },
    ];

    // ─── 기본안 (무채색 단일) ───
    function buildBasePrompt(cat: string, color: string): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      if (cat === 'sink') {
        return `[POSITION FIXED] Keep sink, cooktop, hood at EXACT same positions. Do NOT move appliances.
Edit photo: install ${subject}. ${sinkLayoutConstraints}
[COLOR FIXED] ALL cabinets must be "${color}" — matte flat panel, exactly this color, no variation.
Countertop: white ceramic or warm ivory stone.
${SINK_DETAILS}
Keep wall, floor, camera identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. ALL cabinets must be "${color}" (matte flat panel). Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ─── AI 추천안 (투톤) ───
    function buildAltPrompt(cat: string, upper: string, lower: string): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      if (cat === 'sink') {
        return `[POSITION FIXED] Keep sink, cooktop, hood at EXACT same positions. Do NOT move appliances.
Edit photo: install ${subject}. ${sinkLayoutConstraints}
[TWO-TONE FIXED] Upper cabinets: "${upper}" (matte flat panel). Lower cabinets: "${lower}" (matte flat panel). Use EXACTLY these colors, no substitution.
Countertop: ceramic white or concrete.
${SINK_DETAILS}
Keep wall, floor, camera identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. Upper: "${upper}", Lower: "${lower}". Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ═══ Step 3: 기본안 생성 (시드로 무채색 팔레트에서 픽) ═══
    log.info('Step 3: Generate base design (기본안 — seeded color pick)');

    const baseSeed = Math.floor(Math.random() * 9999);
    const baseColor = BASE_ACHROMATICS[baseSeed % BASE_ACHROMATICS.length];
    const mainPrompt = buildBasePrompt(category, baseColor);
    log.info({ promptLength: mainPrompt.length, category, baseSeed, baseColor }, 'Base design prompt (seeded pick)');

    const closedResult = await callGemini(
      mainPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.4, extraImages, { maxRetries: 0 },
    );

    if (!closedResult.image) {
      res.status(500).json({ success: false, error: 'Failed to generate image' });
      return;
    }
    log.info('Base design (기본안) generated');

    // ═══ Step 4: AI 추천안 생성 (시드로 투톤 팔레트에서 픽) ═══
    log.info('Step 4: Generate AI recommendation (AI 추천안 — seeded two-tone pick)');

    let altImage: string | undefined;
    let altPick: { upper: string; lower: string } | null = null;
    try {
      const altSeed = Math.floor(Math.random() * 9999);
      altPick = ALT_TWO_TONES[altSeed % ALT_TWO_TONES.length];
      const altPrompt = buildAltPrompt(category, altPick.upper, altPick.lower);
      log.info({ promptLength: altPrompt.length, category, altSeed, altPick }, 'AI recommendation prompt (seeded two-tone)');

      const altResult = await callGemini(
        altPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.4, extraImages, { maxRetries: 0 },
      );
      altImage = altResult.image;
      if (altImage) log.info('AI recommendation (AI 추천안) generated');
    } catch (e: any) {
      log.warn({ error: e?.message || String(e) }, 'Alt style generation failed');
    }

    // ═══ Step 5: 견적 (Claude Vision) ═══
    log.info('Step 5: Quote analysis');
    let quote = null;
    try {
      const quotePrompt = `Analyze this cabinet design image. Wall ~${wallW}mm. Return JSON:
{"upper_cabinets":[{"width_mm":N,"type":"door"}],"lower_cabinets":[{"width_mm":N,"type":"door|drawer"}],"countertop_length_mm":N,"wall_width_mm":${wallW},"has_sink":true,"has_cooktop":true,"has_hood":true,"door_count":N,"drawer_count":N}
Estimate each cabinet width. type=drawer for drawer units.`;

      const mimeType = closedResult.image!.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
      const quoteText = await callClaude(quotePrompt, closedResult.image!, mimeType);
      const quoteMatch = quoteText.match(/\{[\s\S]*\}/);
      if (quoteMatch) {
        const raw = JSON.parse(quoteMatch[0]);
        // 방어: 배열 없으면 카운트 기반으로 변환
        const analysis: ImageAnalysisResult = {
          upper_cabinets: raw.upper_cabinets || Array.from({ length: raw.upper_count || 0 }, () => ({ width_mm: Math.round((raw.total_width_mm || wallW) / (raw.upper_count || 1)), type: 'door' })),
          lower_cabinets: raw.lower_cabinets || Array.from({ length: raw.lower_count || 0 }, () => ({ width_mm: Math.round((raw.total_width_mm || wallW) / (raw.lower_count || 1)), type: 'door' })),
          countertop_length_mm: raw.countertop_length_mm || raw.total_width_mm || wallW,
          wall_width_mm: raw.wall_width_mm || wallW,
          has_sink: raw.has_sink ?? true,
          has_cooktop: raw.has_cooktop ?? true,
          has_hood: raw.has_hood ?? true,
          door_count: raw.door_count || 0,
          drawer_count: raw.drawer_count || 0,
        };
        quote = calculateQuote(analysis, category);
        log.info({ total: quote?.total }, 'Quote calculated');
      }
    } catch (e: any) {
      log.warn({ error: e?.message || String(e) }, 'Quote analysis failed');
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
        name: 'AI Two-tone Recommendation',
      },
      quote,
      wall_analysis: { wallW, wallH, waterPct, exhaustPct },
      metadata: {
        category, kitchen_layout, design_style,
        model: 'gemini-3.1-flash-image-preview',
        elapsed_ms: elapsed,
        color_mode: 'seeded-pick',
        base_color: baseColor,
        alt_colors: altPick,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
