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
import { snapToStandard, enforceMinWidth, adjustToWallWidth, FIXED_MODULE_WIDTHS, KOREAN_REFERENCE } from '../constants/cabinet-standards.js';

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
    let wallW2 = 0; // ㄱ자/ㄷ자 두 번째 벽
    const isLType = kitchen_layout === 'l_type';
    const isUType = kitchen_layout === 'u_type';

    try {
      const layoutHint = isLType
        ? '\nThis is an L-shaped (ㄱ자) kitchen. Measure BOTH walls: main wall (longer) and secondary wall (shorter, perpendicular). Return wall.width for main wall and wall.width2 for secondary wall.'
        : isUType
          ? '\nThis is a U-shaped (ㄷ자) kitchen. Measure all walls. Return wall.width for main wall and wall.width2 for total of secondary walls.'
          : '';

      const wallPrompt = category === 'sink'
        ? `Analyze this Korean apartment kitchen photo.${layoutHint}

CALIBRATION — Estimate wall width using these steps:
1. Find an electrical outlet/switch plate in the photo (Korean standard: 70mm wide, 120mm tall). If visible, use it as a ruler to calculate wall width.
2. If no outlet visible, use these KNOWN cabinet sizes as reference:
   - Sink cabinet (개수대): 1000mm wide
   - Cooktop/hood cabinet (가스대/후드장): 600mm wide
3. Count visible cabinet modules and estimate total wall width.
4. IMPORTANT: Korean apartment kitchens are typically 2200-4500mm wide. Be conservative — do NOT overestimate.

Return JSON only:
{"wall":{"width":number,"height":number${isLType || isUType ? ',"width2":number' : ''}},"plumbing":{"waterPct":number,"exhaustPct":number},"confidence":"high"|"medium"|"low"}
waterPct/exhaustPct as % from left of MAIN wall.`
        : `Analyze this Korean apartment photo.${layoutHint}
Estimate wall width in mm. Korean apartments typically have 2200-4500mm wide kitchen walls. Be conservative.
Return JSON only:
{"wall":{"width":number,"height":number${isLType || isUType ? ',"width2":number' : ''}},"confidence":"high"|"medium"|"low"}`;

      const wallResult = await callGemini(wallPrompt, room_image, image_type, ['TEXT'], 0.2);
      if (wallResult.text) {
        const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          wallW = parsed.wall?.width || 3000;
          // 방어: 벽 분석이 미터 단위(< 100)로 반환되면 mm로 변환
          if (wallW > 0 && wallW < 100) wallW = Math.round(wallW * 1000);
          // 광각 렌즈 왜곡 보정 + 범위 클램핑
          wallW = Math.round(wallW * KOREAN_REFERENCE.lens_correction);
          wallW = Math.max(KOREAN_REFERENCE.kitchen_wall_range.min, Math.min(KOREAN_REFERENCE.kitchen_wall_range.max, wallW));
          wallH = parsed.wall?.height || 2400;
          if (wallH > 0 && wallH < 100) wallH = Math.round(wallH * 1000);
          // ㄱ자/ㄷ자 두 번째 벽
          if (parsed.wall?.width2) {
            wallW2 = parsed.wall.width2;
            if (wallW2 > 0 && wallW2 < 100) wallW2 = Math.round(wallW2 * 1000);
            wallW2 = Math.round(wallW2 * KOREAN_REFERENCE.lens_correction);
          }
          if (category === 'sink') {
            waterPct = parsed.plumbing?.waterPct || 30;
            exhaustPct = parsed.plumbing?.exhaustPct || 70;
          }
          log.info({ wallW, wallW2, wallH, waterPct, exhaustPct, kitchen_layout }, 'Wall analysis parsed');
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

    // ═══ Step 5: 견적 — 모듈 카운트 기반 길이 산출 (Claude Vision) ═══
    log.info('Step 5: Quote analysis (module-count based)');
    let quote = null;
    let quoteMetadata: Record<string, unknown> = {};
    // 모듈 타입별 기본 너비 (mm)
    const MODULE_DEFAULT_WIDTHS: Record<string, number> = {
      sink: 1000, cooktop: 600, door: 450, drawer: 500,
    };
    try {
      const quotePrompt = `Analyze this kitchen cabinet design image.

Count and classify each cabinet module from LEFT to RIGHT.
Lower cabinets (하부장):
- sink: module containing sink bowl (1 per kitchen)
- cooktop: module with cooktop/induction (1 per kitchen)
- drawer: drawer unit (horizontal lines/gaps)
- door: hinged door (vertical lines/gaps)

Upper cabinets (상부장): count total number of door modules.

Also detect: has_sink (boolean), has_cooktop (boolean), has_hood (boolean).

Return ONLY this JSON:
{
  "lower": [{"type":"sink"}, {"type":"door"}, {"type":"cooktop"}, {"type":"drawer"}, ...],
  "upper_count": 5,
  "has_sink": true,
  "has_cooktop": true,
  "has_hood": true
}`;

      const mimeType = closedResult.image!.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
      const quoteText = await callClaude(quotePrompt, closedResult.image!, mimeType);
      const quoteMatch = quoteText.match(/\{[\s\S]*\}/);
      if (quoteMatch) {
        const raw = JSON.parse(quoteMatch[0]);
        const lowerModules: Array<{ type: string }> = raw.lower || [];
        const upperCount: number = raw.upper_count || lowerModules.length;

        // 모듈 타입별 고정/기본 너비로 길이 산출 (wallW 무관)
        const lowerWithWidths = lowerModules.map(m => {
          const type = m.type || 'door';
          return { type, width: MODULE_DEFAULT_WIDTHS[type] || MODULE_DEFAULT_WIDTHS.door };
        });
        const lowerTotalCalc = lowerWithWidths.reduce((s, m) => s + m.width, 0);

        // 상부장: 하부장 총 길이를 상부장 모듈 수로 균등 분배
        const upperModuleW = upperCount > 0 ? Math.round(lowerTotalCalc / upperCount) : 0;
        const upperWithWidths = Array.from({ length: upperCount }, () => ({
          type: 'door' as string,
          width: snapToStandard(upperModuleW),
        }));
        const upperAdjusted = upperCount > 0 ? adjustToWallWidth(upperWithWidths, lowerTotalCalc) : [];

        log.info({
          lower_modules: lowerWithWidths,
          lower_total: lowerTotalCalc,
          upper_count: upperCount,
          upper_total: upperAdjusted.reduce((s, m) => s + m.width, 0),
        }, 'Module-count based dimension analysis');

        const analysis: ImageAnalysisResult = {
          lower_cabinets: lowerWithWidths.map(m => ({ width_mm: m.width, type: m.type })),
          upper_cabinets: upperAdjusted.map(m => ({ width_mm: m.width, type: m.type })),
          countertop_length_mm: lowerTotalCalc,
          wall_width_mm: lowerTotalCalc,
          has_sink: raw.has_sink ?? true,
          has_cooktop: raw.has_cooktop ?? true,
          has_hood: raw.has_hood ?? true,
          door_count: lowerWithWidths.filter(m => m.type === 'door').length + upperCount,
          drawer_count: lowerWithWidths.filter(m => m.type === 'drawer').length,
        };

        quote = calculateQuote(analysis, category);
        quoteMetadata = {
          analysis_version: 'module-count-v2',
          lower_modules: lowerWithWidths,
          upper_count: upperCount,
          lower_total_mm: lowerTotalCalc,
          wall_analysis_wallW: wallW,
        };
        log.info({ total: quote?.total, ...quoteMetadata }, 'Quote calculated (module-count)');
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
      wall_analysis: { wallW, wallW2, wallH, waterPct, exhaustPct, kitchen_layout, totalCabinetW: wallW + wallW2 },
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
