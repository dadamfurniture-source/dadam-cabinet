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
import { snapToStandard, enforceMinWidth, adjustToWallWidth } from '../constants/cabinet-standards.js';

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
          // 방어: 벽 분석이 미터 단위(< 100)로 반환되면 mm로 변환
          if (wallW > 0 && wallW < 100) wallW = Math.round(wallW * 1000);
          wallH = parsed.wall?.height || 2400;
          if (wallH > 0 && wallH < 100) wallH = Math.round(wallH * 1000);
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

    // ─── 캐비닛 색상 팔레트 ───
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

    // ─── 상판 색상 팔레트 (스타론/라디안츠 기반, 솔리드 제외) ───
    // 기본안용: 샌디드, 아스펜, 페블, 메탈릭, 쿼리, 테라조, 크리스탈, 템피스트
    const BASE_COUNTERTOPS = [
      // 샌디드
      { name: 'Sanded Icicle',      code: 'SI414', desc: 'white with fine sand speckles' },
      { name: 'Sanded Cream',       code: 'SM421', desc: 'warm cream with subtle sand texture' },
      { name: 'Sanded Grey',        code: 'SG420', desc: 'medium gray with fine sand texture' },
      { name: 'Sanded Stratus',     code: 'SS418', desc: 'soft white with gentle sand particles' },
      // 아스펜
      { name: 'Aspen Snow',         code: 'AS610', desc: 'clean snow white with fine grain pattern' },
      { name: 'Aspen Glacier',      code: 'AG612', desc: 'glacier white with subtle cool tone' },
      { name: 'Aspen Concrete',     code: 'AC629', desc: 'concrete-look gray with natural texture' },
      // 페블
      { name: 'Pebble Ice',         code: 'PI811', desc: 'icy white with small pebble flecks' },
      { name: 'Pebble Swan',        code: 'PS813', desc: 'elegant white with soft pebble pattern' },
      { name: 'Pebble Grey',        code: 'PG810', desc: 'refined gray with pebble texture' },
      // 메탈릭
      { name: 'Metallic Yukon',     code: 'EY510', desc: 'white with subtle metallic shimmer' },
      { name: 'Metallic Sleeksilver', code: 'ES582', desc: 'sleek silver-gray with metallic flecks' },
      // 쿼리
      { name: 'Quarry Starred',     code: 'QS287', desc: 'natural stone look with fine mineral pattern' },
      // 테라조
      { name: 'Terrazzo Venezia',   code: 'NT150', desc: 'white terrazzo with colorful chip fragments' },
      { name: 'Terrazzo Bologna',   code: 'NT970', desc: 'gray terrazzo with scattered stone chips' },
      // 크리스탈
      { name: 'Crystal Cascade White', code: 'FC116', desc: 'crystal white with translucent flecks' },
      // 템피스트
      { name: 'Tempest Dawn',       code: 'FP112', desc: 'soft white with flowing tempest veining' },
      { name: 'Tempest Threshold',  code: 'FT128', desc: 'warm gray with dynamic swirl pattern' },
    ];

    // AI 추천안용: 기본안 팔레트 + 프리미에르, 슈프림, 아리아, 이클립스, 스타코, 템피스트 스텔라 + 라디안츠
    const ALT_COUNTERTOPS = [
      ...BASE_COUNTERTOPS,
      // 프리미에르
      { name: 'Premier Saranac',    code: 'GP111', desc: 'warm beige with elegant veining' },
      // 슈프림
      { name: 'Supreme Cotton White', code: 'VC110', desc: 'soft cotton white with luxurious fine particles' },
      { name: 'Supreme Magnolia',   code: 'VM143', desc: 'warm magnolia beige with premium texture' },
      { name: 'Supreme Urban Grey', code: 'VU127', desc: 'sophisticated urban gray with depth' },
      // 아리아
      { name: 'Aria Snow White',    code: 'VA311', desc: 'pure snow white with elegant marble veining' },
      { name: 'Aria Snowfall',      code: 'VS324', desc: 'delicate white with soft snowfall pattern' },
      // 이클립스
      { name: 'Eclipse Zenith',     code: 'FZ184', desc: 'deep dark with dramatic eclipse pattern' },
      // 스타코
      { name: 'Starco Luce',        code: 'SL170', desc: 'luminous white with starlight sparkle' },
      // 템피스트 스텔라
      { name: 'Tempest Stella Nimbus', code: 'TN198', desc: 'cloud white with stellar veining pattern' },
      // 라디안츠 쿼츠
      { name: 'Diamond White',      code: 'DW105', desc: 'sparkling quartz white with silver flecks' },
      { name: 'Everest White',      code: 'EW120', desc: 'alpine white quartz with soft veining' },
      { name: 'Gentle Gray',        code: 'GG900', desc: 'warm gray quartz with subtle movement' },
      { name: 'Calacatta Classic',  code: 'CC001', desc: 'white marble-look with elegant gray veining' },
      { name: 'Carrara Bella',      code: 'CB001', desc: 'white with delicate gray marble veins' },
      { name: 'Bristol Beige',      code: 'BB227', desc: 'warm beige quartz with natural tone' },
    ];
    type CountertopColor = typeof BASE_COUNTERTOPS[number];

    // ─── 기본안 (무채색 단일) ───
    function buildBasePrompt(cat: string, color: string, countertop: CountertopColor): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      const ctDesc = `"${countertop.name}" (${countertop.desc})`;
      if (cat === 'sink') {
        return `[POSITION FIXED] Keep sink, cooktop, hood at EXACT same positions. Do NOT move appliances.
Edit photo: install ${subject}. ${sinkLayoutConstraints}
[COLOR FIXED] ALL cabinets must be "${color}" — matte flat panel, exactly this color, no variation.
[COUNTERTOP FIXED] Countertop must be ${ctDesc}. Use this exact color/pattern.
${SINK_DETAILS}
Keep wall, floor, camera identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. ALL cabinets must be "${color}" (matte flat panel). Countertop: ${ctDesc}. Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ─── AI 추천안 (투톤) ───
    function buildAltPrompt(cat: string, upper: string, lower: string, countertop: CountertopColor): string {
      const subject = CATEGORY_SUBJECT[cat] || CATEGORY_SUBJECT['storage'];
      const ctDesc = `"${countertop.name}" (${countertop.desc})`;
      if (cat === 'sink') {
        return `[POSITION FIXED] Keep sink, cooktop, hood at EXACT same positions. Do NOT move appliances.
Edit photo: install ${subject}. ${sinkLayoutConstraints}
[TWO-TONE FIXED] Upper cabinets: "${upper}" (matte flat panel). Lower cabinets: "${lower}" (matte flat panel). Use EXACTLY these colors, no substitution.
[COUNTERTOP FIXED] Countertop must be ${ctDesc}. Use this exact color/pattern.
${SINK_DETAILS}
Keep wall, floor, camera identical. No clutter.`;
      }
      return `Edit photo: install ${subject}. Upper: "${upper}", Lower: "${lower}". Countertop: ${ctDesc}. Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ═══ Step 3: 기본안 생성 (시드로 무채색 팔레트 + 상판 색상 픽) ═══
    log.info('Step 3: Generate base design (기본안 — seeded color pick)');

    const baseSeed = Math.floor(Math.random() * 9999);
    const baseColor = BASE_ACHROMATICS[baseSeed % BASE_ACHROMATICS.length];
    const baseCTSeed = Math.floor(Math.random() * 9999);
    const baseCT = BASE_COUNTERTOPS[baseCTSeed % BASE_COUNTERTOPS.length];
    const mainPrompt = buildBasePrompt(category, baseColor, baseCT);
    log.info({ promptLength: mainPrompt.length, category, baseSeed, baseColor, countertop: baseCT.name }, 'Base design prompt (seeded pick)');

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
      const altCTSeed = Math.floor(Math.random() * 9999);
      const altCT = ALT_COUNTERTOPS[altCTSeed % ALT_COUNTERTOPS.length];
      const altPrompt = buildAltPrompt(category, altPick.upper, altPick.lower, altCT);
      log.info({ promptLength: altPrompt.length, category, altSeed, altPick, countertop: altCT.name }, 'AI recommendation prompt (seeded two-tone)');

      const altResult = await callGemini(
        altPrompt, room_image, image_type, ['IMAGE', 'TEXT'], 0.4, extraImages, { maxRetries: 0 },
      );
      altImage = altResult.image;
      if (altImage) log.info('AI recommendation (AI 추천안) generated');
    } catch (e: any) {
      log.warn({ error: e?.message || String(e) }, 'Alt style generation failed');
    }

    // ═══ Step 5: 견적 — 멀티스테이지 구조 분석 (Claude Vision) ═══
    log.info('Step 5: Quote analysis (multi-stage)');
    let quote = null;
    let quoteMetadata: Record<string, unknown> = {};
    try {
      // 5a + 5b: 모듈 타입 분류 + 비율 추정을 단일 호출로
      const quotePrompt = `Analyze this kitchen cabinet design image.
Total wall width: ${wallW}mm.

STEP 1 — Count and classify each cabinet module from LEFT to RIGHT.
Lower cabinets (하부장):
- sink: module containing sink bowl
- cooktop: module with cooktop/induction
- drawer: drawer unit (horizontal lines/gaps)
- door: hinged door (vertical lines/gaps)

Upper cabinets (상부장): classify same way (all are "door" type typically).

STEP 2 — Estimate each module's width as a PERCENTAGE of total wall width.
All lower percentages must sum to 100.
All upper percentages must sum to 100.

Also detect: has_sink (boolean), has_cooktop (boolean), has_hood (boolean).

Return ONLY this JSON (no other text):
{
  "lower": [{"type":"door","pct":25}, {"type":"sink","pct":30}, ...],
  "upper": [{"type":"door","pct":33}, ...],
  "has_sink": true,
  "has_cooktop": true,
  "has_hood": true
}`;

      const mimeType = closedResult.image!.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
      const quoteText = await callClaude(quotePrompt, closedResult.image!, mimeType);
      const quoteMatch = quoteText.match(/\{[\s\S]*\}/);
      if (quoteMatch) {
        const raw = JSON.parse(quoteMatch[0]);
        const lowerModules: Array<{ type: string; pct: number }> = raw.lower || [];
        const upperModules: Array<{ type: string; pct: number }> = raw.upper || [];

        // 5c: 비율 → mm → 스냅 → 제약 → 합계 보정
        const lowerRaw = lowerModules.map(m => ({
          type: m.type || 'door',
          rawWidth: Math.round(wallW * (m.pct || 0) / 100),
        }));
        const upperRaw = upperModules.map(m => ({
          type: m.type || 'door',
          rawWidth: Math.round(wallW * (m.pct || 0) / 100),
        }));

        // 스냅 + 최소 너비 적용
        const lowerSnapped = lowerRaw.map(m => ({
          type: m.type,
          width: enforceMinWidth(snapToStandard(m.rawWidth), m.type),
        }));
        const upperSnapped = upperRaw.map(m => ({
          type: m.type,
          width: enforceMinWidth(snapToStandard(m.rawWidth), m.type),
        }));

        // 합계를 wallW에 맞춤
        const lowerAdjusted = adjustToWallWidth(lowerSnapped, wallW);
        const upperAdjusted = adjustToWallWidth(upperSnapped, wallW);

        log.info({
          lower_raw: lowerRaw.map(m => m.rawWidth),
          lower_snapped: lowerAdjusted.map(m => m.width),
          upper_raw: upperRaw.map(m => m.rawWidth),
          upper_snapped: upperAdjusted.map(m => m.width),
          wallW,
          lower_sum: lowerAdjusted.reduce((s, m) => s + m.width, 0),
        }, 'Module dimension analysis (raw → snapped)');

        const analysis: ImageAnalysisResult = {
          lower_cabinets: lowerAdjusted.map(m => ({ width_mm: m.width, type: m.type })),
          upper_cabinets: upperAdjusted.map(m => ({ width_mm: m.width, type: m.type })),
          countertop_length_mm: lowerAdjusted.reduce((s, m) => s + m.width, 0),
          wall_width_mm: wallW,
          has_sink: raw.has_sink ?? true,
          has_cooktop: raw.has_cooktop ?? true,
          has_hood: raw.has_hood ?? true,
          door_count: lowerAdjusted.filter(m => m.type === 'door').length + upperAdjusted.filter(m => m.type === 'door').length,
          drawer_count: lowerAdjusted.filter(m => m.type === 'drawer').length,
        };

        quote = calculateQuote(analysis, category);
        quoteMetadata = {
          analysis_version: 'multi-stage-v1',
          module_widths_raw: lowerRaw.map(m => ({ type: m.type, width: m.rawWidth })),
          module_widths_snapped: lowerAdjusted,
          upper_widths_snapped: upperAdjusted,
          wall_width_mm: wallW,
          sum_diff: wallW - lowerAdjusted.reduce((s, m) => s + m.width, 0),
        };
        log.info({ total: quote?.total, ...quoteMetadata }, 'Quote calculated (multi-stage)');
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
      quote_analysis: quoteMetadata,
      wall_analysis: { wallW, wallH, waterPct, exhaustPct },
      metadata: {
        category, kitchen_layout, design_style,
        model: 'gemini-3.1-flash-image-preview',
        elapsed_ms: elapsed,
        color_mode: 'seeded-pick',
        base_color: baseColor,
        base_countertop: baseCT.name,
        alt_colors: altPick,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
