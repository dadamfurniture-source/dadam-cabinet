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
import { generateRateLimit } from '../middleware/rate-limiter.js';

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

type InlineImage = { data: string; mimeType: string };

type LayoutConstraints = {
  total_width_mm?: number;
  fixed_appliances?: {
    sink?: { x_mm?: number; width_mm?: number; center_mm?: number; anchor?: string };
    cooktop?: { x_mm?: number; width_mm?: number; center_mm?: number; anchor?: string };
    hood?: { x_mm?: number; width_mm?: number; center_mm?: number; anchor?: string; align_to?: string };
  };
  upper_modules?: Array<{ type?: string; position_from_left_mm?: number; width_mm?: number; fixed?: boolean }>;
  lower_modules?: Array<{ type?: string; position_from_left_mm?: number; width_mm?: number; fixed?: boolean }>;
};

type RandomColorScheme = {
  seed?: number;
  scheme_type?: string;
  upper?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
  lower?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
  countertop?: { name_ko?: string; name_en?: string; color_hex?: string; prompt_description?: string };
};

type FixtureVisionAnalysis = {
  sink_center_pct?: number | null;
  cooktop_center_pct?: number | null;
  hood_center_pct?: number | null;
  confidence?: 'high' | 'medium' | 'low';
};

function alignLayoutConstraints(
  layoutConstraints: LayoutConstraints | undefined,
  fixtureVision: FixtureVisionAnalysis | undefined,
  wallData: { waterPct: number; exhaustPct: number }
): LayoutConstraints | undefined {
  if (!layoutConstraints?.fixed_appliances || !layoutConstraints.total_width_mm) {
    return layoutConstraints;
  }

  const totalWidth = layoutConstraints.total_width_mm;
  const sinkWidth = layoutConstraints.fixed_appliances.sink?.width_mm ?? 900;
  const cooktopWidth = layoutConstraints.fixed_appliances.cooktop?.width_mm ?? 600;
  const hoodWidth = layoutConstraints.fixed_appliances.hood?.width_mm ?? 600;
  const sinkCenter = Math.round(totalWidth * (((fixtureVision?.sink_center_pct ?? wallData.waterPct) || wallData.waterPct) / 100));
  const cooktopCenter = Math.round(totalWidth * (((fixtureVision?.cooktop_center_pct ?? wallData.exhaustPct) || wallData.exhaustPct) / 100));
  const hoodCenter = Math.round(totalWidth * (((fixtureVision?.hood_center_pct ?? fixtureVision?.cooktop_center_pct ?? wallData.exhaustPct) || wallData.exhaustPct) / 100));
  const sinkX = Math.max(0, Math.min(totalWidth - sinkWidth, sinkCenter - Math.round(sinkWidth / 2)));
  const cooktopX = Math.max(0, Math.min(totalWidth - cooktopWidth, cooktopCenter - Math.round(cooktopWidth / 2)));
  const hoodX = Math.max(0, Math.min(totalWidth - hoodWidth, hoodCenter - Math.round(hoodWidth / 2)));

  return {
    ...layoutConstraints,
    fixed_appliances: {
      sink: { ...layoutConstraints.fixed_appliances.sink, x_mm: sinkX, width_mm: sinkWidth, center_mm: sinkX + Math.round(sinkWidth / 2) },
      cooktop: { ...layoutConstraints.fixed_appliances.cooktop, x_mm: cooktopX, width_mm: cooktopWidth, center_mm: cooktopX + Math.round(cooktopWidth / 2) },
      hood: { ...layoutConstraints.fixed_appliances.hood, x_mm: hoodX, width_mm: hoodWidth, center_mm: hoodX + Math.round(hoodWidth / 2), align_to: 'cooktop_center' },
    },
    lower_modules: [
      { type: 'storage', position_from_left_mm: 0, width_mm: Math.max(300, sinkX), fixed: false },
      { type: 'sink', position_from_left_mm: sinkX, width_mm: sinkWidth, fixed: true },
      { type: 'storage', position_from_left_mm: sinkX + sinkWidth, width_mm: Math.max(250, cooktopX - (sinkX + sinkWidth)), fixed: false },
      { type: 'cooktop', position_from_left_mm: cooktopX, width_mm: cooktopWidth, fixed: true },
      { type: 'storage', position_from_left_mm: cooktopX + cooktopWidth, width_mm: Math.max(250, totalWidth - (cooktopX + cooktopWidth)), fixed: false },
    ].filter((module) => (module.width_mm ?? 0) > 0),
    upper_modules: [
      { type: 'storage', position_from_left_mm: 0, width_mm: Math.max(300, hoodX), fixed: false },
      { type: 'hood', position_from_left_mm: hoodX, width_mm: hoodWidth, fixed: true },
      { type: 'storage', position_from_left_mm: hoodX + hoodWidth, width_mm: Math.max(250, totalWidth - (hoodX + hoodWidth)), fixed: false },
    ].filter((module) => (module.width_mm ?? 0) > 0),
  };
}

function describeLayoutConstraints(layoutConstraints?: LayoutConstraints, fixtureVision?: FixtureVisionAnalysis): string {
  if (!layoutConstraints?.fixed_appliances) {
    return '';
  }

  const lines: string[] = [];
  const sink = layoutConstraints.fixed_appliances.sink;
  const cooktop = layoutConstraints.fixed_appliances.cooktop;
  const hood = layoutConstraints.fixed_appliances.hood;

  if (layoutConstraints.total_width_mm) {
    lines.push(`[LAYOUT WIDTH] total cabinet width ${layoutConstraints.total_width_mm}mm`);
  }
  if (sink) {
    lines.push(`[FIXED SINK] left ${sink.x_mm ?? 0}mm, width ${sink.width_mm ?? 0}mm, center ${sink.center_mm ?? 0}mm`);
  }
  if (cooktop) {
    lines.push(`[FIXED COOKTOP] left ${cooktop.x_mm ?? 0}mm, width ${cooktop.width_mm ?? 0}mm, center ${cooktop.center_mm ?? 0}mm`);
  }
  if (hood) {
    lines.push(`[FIXED HOOD] left ${hood.x_mm ?? 0}mm, width ${hood.width_mm ?? 0}mm, center ${hood.center_mm ?? 0}mm, align ${hood.align_to || 'manual'}`);
  }

  const upper = (layoutConstraints.upper_modules || [])
    .map((module) => `${module.type}@${module.position_from_left_mm}mm/${module.width_mm}mm${module.fixed ? ':fixed' : ''}`)
    .join(', ');
  const lower = (layoutConstraints.lower_modules || [])
    .map((module) => `${module.type}@${module.position_from_left_mm}mm/${module.width_mm}mm${module.fixed ? ':fixed' : ''}`)
    .join(', ');

  if (upper) lines.push(`[UPPER MODULES] ${upper}`);
  if (lower) lines.push(`[LOWER MODULES] ${lower}`);
  if (fixtureVision?.confidence) lines.push(`[IMAGE ANALYSIS] fixture confidence ${fixtureVision.confidence}`);

  lines.push('Do not relocate sink, cooktop, or hood. Preserve the left-to-right appliance order exactly.');
  return lines.join('\n');
}

function resolveThemeData(
  themeData: Record<string, unknown>,
  randomColorScheme?: RandomColorScheme
): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(themeData).map(([key, value]) => [key, String(value ?? '')])),
    style_door_color:
      randomColorScheme?.upper?.name_en ||
      String(themeData.style_door_color || 'white'),
    style_lower_door_color:
      randomColorScheme?.lower?.name_en ||
      String(themeData.style_lower_door_color || themeData.style_door_color || 'white'),
    style_countertop_prompt:
      randomColorScheme?.countertop?.prompt_description ||
      String(themeData.style_countertop_prompt || 'white engineered stone countertop'),
    style_upper_color_hex:
      randomColorScheme?.upper?.color_hex ||
      String(themeData.style_upper_color_hex || themeData.style_door_color_hex || ''),
    style_lower_color_hex:
      randomColorScheme?.lower?.color_hex ||
      String(themeData.style_lower_color_hex || themeData.style_door_color_hex || ''),
    style_countertop_color_hex:
      randomColorScheme?.countertop?.color_hex ||
      String(themeData.style_countertop_color_hex || ''),
    style_random_seed: String(randomColorScheme?.seed ?? ''),
  };
}

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
  for (const extraImage of extraImages) {
    parts.push({ inlineData: { mimeType: extraImage.mimeType, data: extraImage.data } });
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
function buildFixtureVisionPrompt(): string {
  return `Analyze the uploaded kitchen photo and return ONLY valid JSON.

{
  "sink_center_pct": number | null,
  "cooktop_center_pct": number | null,
  "hood_center_pct": number | null,
  "confidence": "high" | "medium" | "low"
}

Rules:
- Percentages are horizontal center positions from the left edge of the visible cabinet wall.
- If a fixture is not visible, return null.
- Sink center is the bowl or faucet centerline.
- Cooktop center is the burner centerline.
- Hood center is the hood centerline.
- Return JSON only.`;
}

function buildFurniturePrompt(
  category: string,
  style: string,
  kitchenLayout: string,
  wallData: { wallW: number; wallH: number; waterPct: number; exhaustPct: number },
  themeData: Record<string, string>,
  layoutGuidance = '',
): string {
  const layoutDesc = LAYOUT_DESC[kitchenLayout] || 'straight linear';
  const styleName = STYLE_MAP[style] || 'Modern Minimal';
  const doorColor = themeData.style_door_color || 'white';
  const lowerDoorColor = themeData.style_lower_door_color || doorColor;
  const doorFinish = themeData.style_door_finish || 'matte';
  const countertop = themeData.style_countertop_prompt || 'white stone countertop';
  const upperHex = themeData.style_upper_color_hex || '';
  const lowerHex = themeData.style_lower_color_hex || '';
  const countertopHex = themeData.style_countertop_color_hex || '';
  const immutablePlateRules = `[BASE IMAGE RULE]
- The FIRST image is the immutable source room photo.
- Keep the exact same camera position, lens, perspective, crop, horizon, and field of view.
- Keep the exact same background, including walls, ceiling, floor, windows, doors, trim, outlets, tiles, shadows, and lighting direction.
- Preserve the kitchen wall tile exactly as in the source image, including tile size, tile pattern, grout lines, grout color, gloss or matte finish, reflections, and all visible tile edges.
- Do not zoom, pan, rotate, reframe, restage, or redesign the room.
- Only add cabinetry onto the existing room photo.
- Any additional reference images are guides for layout and color only. They must NOT change the viewpoint or background.`;
  const transformationRules = `[CABINET TRANSFORMATION RULE]
- Make the cabinetry visually substantial and clearly new.
- Fill the available wall span with full cabinetry according to the layout constraints.
- Use clear panel lines, realistic cabinet volumes, toe-kick, countertop thickness, and upper/lower separation so the change is obvious.
- The room must stay the same, but the cabinetry itself should read as a decisive design proposal, not a faint overlay.
- Prioritize strong cabinet visibility over timid blending.
- Make the cabinet installation look complete, premium, and immediately noticeable from the existing camera view.`;

  if (['sink', 'kitchen', 'l_shaped_sink', 'island_kitchen'].includes(category)) {
    return `Place upper cabinets in ${doorColor} and lower cabinets in ${lowerDoorColor}, ${doorFinish} flat panel ${layoutDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY.

[EDIT MODE] Edit the first image instead of generating a new scene.
[OUTPUT] Return the same room photo with only the cabinetry inserted.
[CAMERA] Same camera angle, same framing, same perspective, same lens.
[BACKGROUND LOCK] Do not alter any non-cabinet pixels except tiny contact shadows where the new cabinets touch the room.
[WALL TILE LOCK] Keep the backsplash and wall tile identical to the original photo. Do not replace, simplify, repaint, retile, blur, or reinterpret the tile.
[REFERENCE PRIORITY] First image = source room photo. Later images = layout/color guides only.
[COMPOSITE] Treat this as a photoreal furniture compositing task, not a room redesign task.
[PLATE LOCK]
${immutablePlateRules}
[TRANSFORMATION]
${transformationRules}
[WALL] ${wallData.wallW}x${wallData.wallH}mm wall.
[PLUMBING] Sink at ${wallData.waterPct}% from left, cooktop at ${wallData.exhaustPct}% from left.
[UPPER] 4 upper cabinets flush to ceiling, no gap between ceiling and cabinets. NO dish drying rack on upper cabinets.
[LOWER] 5 lower cabinets (600mm, sink, 600mm, cooktop drawer base, 600mm).
[COOKTOP BASE] The cabinet directly below the cooktop must be a clearly visible 2-drawer base cabinet: one shallow top drawer line and one deep lower drawer line. Never use a hinged door below the cooktop. The two drawer front lines must be obvious in the final image.
[EXISTING APPLIANCES] If a refrigerator or tall appliance is already visible in the source image, preserve it exactly in the same position, size, angle, and appearance. Build the new cabinetry around it. Do not move, replace, cover, or redesign the refrigerator.
[COUNTERTOP] ${countertop}, continuous surface.
[DECLUTTER] Remove all dishes, bowls, cups, utensils, cutting boards, small appliances, dish racks, sink items, and countertop clutter. Sink and countertop must look clean and empty.
[DOORS] No visible handles. Push-to-open mechanism.
[HOOD] Range hood integrated into upper cabinet above cooktop.
[COLOR SCHEME] Use the provided upper/lower color split exactly. Do not normalize all cabinets to a single color.
[UPPER COLOR] ${doorColor}${upperHex ? `, exact HEX ${upperHex}` : ''}
[LOWER COLOR] ${lowerDoorColor}${lowerHex ? `, exact HEX ${lowerHex}` : ''}
[COUNTERTOP COLOR] ${countertop}${countertopHex ? `, exact HEX ${countertopHex}` : ''}
[REFERENCE IMAGES] One reference image shows the exact cabinet layout. Another reference image shows the exact target colors. Match both exactly.
[LAYOUT CONSTRAINTS]
${layoutGuidance || 'Keep sink, cooktop, and hood aligned in standard Korean kitchen positions.'}
[STYLE] ${styleName}. Clean lines. Photorealistic interior photography.
[QUALITY] 8K quality, natural lighting, proper shadows and reflections.

CRITICAL RULES:
- PRESERVE the original room background, walls, floor, ceiling EXACTLY
- Preserve the original camera angle and framing EXACTLY
- Preserve the original wall tile and grout exactly
- All cabinet doors must be CLOSED
- NO dish drying rack or dish drainer on or inside upper cabinets
- Remove all dishes, cookware, utensils, and countertop clutter
- Keep the sink empty and the countertop clear
- Sink, cooktop, and hood positions must remain fixed
- If a refrigerator exists in the photo, preserve it exactly and keep it visible
- The cooktop base must be a clearly visible 2-drawer cabinet, not a door cabinet
- Match the provided cabinet colors exactly, including the upper/lower split
- Make the cabinetry change visually obvious and fully realized
- No text, labels, dimensions, or annotations
- No people or pets
- Photorealistic magazine-quality result`;
  }

  if (category === 'wardrobe') {
    return `Place ${doorColor} ${doorFinish} built-in wardrobe on this photo. PRESERVE background EXACTLY.
[EDIT MODE] Edit the first image instead of generating a new scene.
${immutablePlateRules}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Full-width floor-to-ceiling wardrobe with hinged doors.
Lower cabinet doors can be opened by reaching behind the door. No visible handles.
${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'shoe' || category === 'shoe_cabinet') {
    return `Place ${doorColor} ${doorFinish} shoe cabinet on this photo. PRESERVE background EXACTLY.
[EDIT MODE] Edit the first image instead of generating a new scene.
${immutablePlateRules}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling.
No visible handles on doors. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'fridge' || category === 'fridge_cabinet') {
    return `Place ${doorColor} ${doorFinish} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.
[EDIT MODE] Edit the first image instead of generating a new scene.
${immutablePlateRules}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Center opening for fridge, tall storage on sides, bridge above.
No visible handles on doors. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'vanity') {
    return `Place ${doorColor} ${doorFinish} bathroom vanity on this photo. PRESERVE background EXACTLY.
[EDIT MODE] Edit the first image instead of generating a new scene.
${immutablePlateRules}
Wall: ${wallData.wallW}x${wallData.wallH}mm. Vanity with sink at ${wallData.waterPct}% from left. Mirror cabinet above.
${countertop}. ${styleName}. Photorealistic. Faucet chrome finish.`;
  }

  // storage, custom
  return `Place ${doorColor} ${doorFinish} storage cabinet on this photo. PRESERVE background EXACTLY.
[EDIT MODE] Edit the first image instead of generating a new scene.
${immutablePlateRules}
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
router.post('/api/generate', generateRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  try {
    const {
      room_image,
      image_type = 'image/jpeg',
      category = 'sink',
      kitchen_layout = 'i_type',
      design_style = 'modern-minimal',
      random_color_scheme,
      alt_random_color_scheme,
      layout_constraints,
      layout_image,
      mask_image,
      color_reference_image,
      ...themeData
    } = req.body;

    if (!room_image) {
      res.status(400).json({ success: false, error: 'room_image is required' });
      return;
    }

    const resolvedThemeData = resolveThemeData(themeData, random_color_scheme as RandomColorScheme | undefined);
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

    log.info(
      {
        category,
        kitchen_layout,
        design_style,
        hasLayoutConstraints: !!layout_constraints,
        hasRandomColorScheme: !!random_color_scheme,
        extraReferenceImages: extraImages.length,
      },
      'Generate request received'
    );

    // ═══ Step 1: 벽면 분석 ═══
    log.info('Step 1: Wall analysis');
    let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;
    let fixtureVision: FixtureVisionAnalysis | undefined;

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
    if (category === 'sink') {
      try {
        const fixtureText = await callClaude(buildFixtureVisionPrompt(), room_image, image_type);
        const fixtureMatch = fixtureText.match(/\{[\s\S]*\}/);
        if (fixtureMatch) {
          fixtureVision = JSON.parse(fixtureMatch[0]) as FixtureVisionAnalysis;
          log.info({ fixtureVision }, 'Fixture vision parsed');
        }
      } catch (e) {
        log.warn('Fixture vision failed, using wall-analysis alignment only');
      }
    }

    const alignedLayoutConstraints = alignLayoutConstraints(
      layout_constraints as LayoutConstraints | undefined,
      fixtureVision,
      { waterPct, exhaustPct }
    );
    const layoutGuidance = describeLayoutConstraints(alignedLayoutConstraints, fixtureVision);

    log.info('Step 2: Generating closed door furniture');
    const furniturePrompt = buildFurniturePrompt(
      category, design_style, kitchen_layout,
      { wallW, wallH, waterPct, exhaustPct },
      resolvedThemeData,
      layoutGuidance,
    );

    const closedResult = await callGemini(
      furniturePrompt,
      room_image,
      image_type,
      ['IMAGE', 'TEXT'],
      0.28,
      extraImages,
    );

    if (!closedResult.image) {
      res.status(500).json({ success: false, error: 'Failed to generate closed door image' });
      return;
    }

    log.info('Closed door image generated');

    // ═══ Step 3: 대체 스타일 이미지 생성 ═══
    const altStyleKey = ALT_STYLE_MAP[design_style] || 'scandinavian';
    const altColors = ALT_DOOR_COLORS[altStyleKey] || ALT_DOOR_COLORS['scandinavian'];
    const altResolvedThemeData = resolveThemeData(
      {
        style_door_color: altColors.color,
        style_lower_door_color: altColors.color,
        style_door_finish: altColors.finish,
        style_countertop_prompt: altColors.countertop,
      },
      alt_random_color_scheme as RandomColorScheme | undefined,
    );
    log.info({ altStyleKey }, 'Step 3: Generating special style');

    let altImage: string | undefined;

    try {
      const altPrompt = buildFurniturePrompt(
        category, altStyleKey, kitchen_layout,
        { wallW, wallH, waterPct, exhaustPct },
        altResolvedThemeData,
        layoutGuidance,
      );

      const altResult = await callGemini(
        altPrompt,
        room_image,
        image_type,
        ['IMAGE', 'TEXT'],
        0.28,
        extraImages,
      );
      altImage = altResult.image;
      if (altImage) log.info('Special style image generated');
    } catch (e) {
      log.warn('Special style generation failed');
    }

    // ═══ Step 4: 이미지 분석 → 견적 산출 (Claude Vision) ═══
    log.info('Step 4: Analyzing image with Claude for quote');
    let quote = null;

    try {
      // base64 헤더로 MIME 타입 감지
      const imgMime = closedResult.image.startsWith('/9j/') ? 'image/jpeg'
        : closedResult.image.startsWith('iVBOR') ? 'image/png'
        : closedResult.image.startsWith('R0lGO') ? 'image/gif'
        : 'image/webp';
      const claudeText = await callClaude(
        buildQuoteAnalysisPrompt(category),
        closedResult.image,
        imgMime,
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
    } catch (e: any) {
      log.warn({ error: e?.message || String(e) }, 'Quote analysis failed');
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
        door_color: altResolvedThemeData.style_door_color || altColors.color,
      },
      quote,
      wall_analysis: { wallW, wallH, waterPct, exhaustPct },
      applied_random_color_scheme: random_color_scheme || null,
      applied_alt_random_color_scheme: alt_random_color_scheme || null,
      applied_layout_constraints: alignedLayoutConstraints || null,
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
