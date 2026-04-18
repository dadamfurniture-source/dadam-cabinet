// ═══════════════════════════════════════════════════════════════
// Generate Route — 투톤 컬러 및 위치 고정 강화 + 붙박이장 벽면 전체
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
      wall_width_override,
      // 레거시 호환: 기존 색상 스키마가 전달되면 무시
      random_color_scheme: _rcs, alt_random_color_scheme: _arcs,
      layout_image, mask_image,
      color_reference_image: _cri, alt_color_reference_image: _acri,
      fridge_options,
      vanity_options,
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

    // ═══ Step 1: 벽면 분석 (Gemini Vision, TEXT only) ═══
    log.info('Step 1: Wall analysis');
    let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;
    let wallW2 = 0; // ㄱ자/ㄷ자 두 번째 벽
    let detectedLShape = kitchen_layout === 'l_type';

    // 사용자 수동 입력값이 있으면 AI 분석 건너뜀
    const manualW = Number(wall_width_override);
    if (manualW >= 1000 && manualW <= 6000) {
      wallW = manualW;
      log.info({ wallW, source: 'user_override' }, 'Wall width from user input');
    } else {

    try {
      let wallPrompt: string;
      if (category === 'sink') {
        wallPrompt = `Analyze this Korean apartment kitchen photo.

L-SHAPE DETECTION — Check if this kitchen has an L-shaped (ㄱ자) corner:
- Look for a 90-degree corner where cabinets change direction
- Visual cues: vertical edge where two walls meet, countertop corner joint, corner cabinet (blind corner module), cabinet doors facing different directions
- If L-shaped: set is_l_shape=true and estimate both wall widths

CALIBRATION — Use these KNOWN cabinet sizes as reference:
- Sink cabinet (개수대): 1000mm wide
- Cooktop/hood cabinet (가스대/후드장): 600mm wide
- IMPORTANT: Korean apartment kitchens are typically 2200-4500mm wide per wall. Be conservative.

Return JSON only:
{"wall":{"width":number,"height":number,"width2":number},"plumbing":{"waterPct":number,"exhaustPct":number},"is_l_shape":boolean,"confidence":"high"|"medium"|"low"}
width=main wall mm, width2=secondary wall mm (0 if not L-shaped). waterPct/exhaustPct as % from left of MAIN wall.`;
      } else if (category === 'wardrobe') {
        wallPrompt = `Analyze this Korean apartment room photo for built-in wardrobe installation.

CALIBRATION — Use these KNOWN Korean apartment features as size references:
- Standard door frame: 900mm wide × 2100mm tall (most common reference — look for room doors)
- Light switch / outlet plate: 70mm wide × 120mm tall (small rectangular plates on walls)
- Ceiling height: typically 2300-2400mm in Korean apartments
- Standard room door: visible in most room photos, use as PRIMARY scale reference

TASK:
1. Identify any visible doors, door frames, outlets, or light switches in the photo
2. Use them as scale reference to calculate the target wall width in mm
3. The target wall is where the wardrobe will be installed (usually the longest unobstructed wall)
4. Korean apartment rooms typically have walls 1800-5000mm wide. Be conservative.

Return JSON only:
{"wall":{"width":number,"height":number},"reference_used":"door_frame"|"outlet"|"ceiling"|"none","confidence":"high"|"medium"|"low"}`;
      } else {
        wallPrompt = `Analyze this Korean apartment photo.
Estimate wall width in mm. Korean apartments typically have 2200-4500mm wide walls. Be conservative.
Return JSON only:
{"wall":{"width":number,"height":number,"width2":number},"is_l_shape":boolean,"confidence":"high"|"medium"|"low"}`;
      }

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
          // ㄱ자 자동 감지 + 두 번째 벽
          if (parsed.is_l_shape) detectedLShape = true;
          if (parsed.wall?.width2) {
            wallW2 = parsed.wall.width2;
            if (wallW2 > 0 && wallW2 < 100) wallW2 = Math.round(wallW2 * 1000);
            wallW2 = Math.round(wallW2 * KOREAN_REFERENCE.lens_correction);
          }
          if (category === 'sink') {
            waterPct = parsed.plumbing?.waterPct || 30;
            exhaustPct = parsed.plumbing?.exhaustPct || 70;
          }
          log.info({ wallW, wallW2, wallH, waterPct, exhaustPct, detectedLShape, kitchen_layout }, 'Wall analysis parsed');
        }
      }
    } catch (e) {
      log.warn('Wall analysis failed, using defaults');
    }
    } // end else (AI wall analysis)

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
      wardrobe: 'floor-to-ceiling full-wall built-in wardrobe with flat-panel doors covering entire wall',
      fridge: 'tall pantry and refrigerator surround cabinet',
      vanity: 'built-in recessed-niche dressing table (벽감 화장대): floating counter + 2 drawers + open knee space + ROUND mirror (원형거울) above — NOT a bathroom washbasin',
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
      if (cat === 'wardrobe') {
        const s = getWardrobeStructure(wallW);
        return `Edit photo: install built-in wardrobe covering entire wall (~${wallW}mm wide, ~${wallH}mm tall).
Doors: "${color}" matte flat-panel, each door is one single piece running full height from floor to ceiling. Door surface is completely smooth and seamless with no indentations, no grooves, no cutouts. ${s.prompt}
All doors closed. No gaps between doors. Preserve background. Photorealistic. No text.`;
      }
      if (cat === 'fridge') {
        return buildFridgePrompt(color, countertop);
      }
      if (cat === 'vanity') {
        return buildVanityPrompt(color, countertop);
      }
      return `Edit photo: install ${subject}. ALL cabinets must be "${color}" (matte flat panel). Countertop: ${ctDesc}. Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ─── 붙박이장 구조 (벽 폭 기준, 섹션 950mm) ───
    // All doors are FULL-HEIGHT single doors (floor to ceiling, never split upper/lower)
    // Interior types: short-hang = 2 hanging rods inside, long-hang = 1 rod + internal drawer
    // Shelves are minimized — prefer hanging rods and internal drawers
    function getWardrobeStructure(w: number): { prompt: string; open: string } {
      if (w > 3200) return { // 7 full-height doors
        prompt: '4 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, short-clothes hanging with 2 rods inside) + section C (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom) + section D (1 full-height door, long-clothes hanging with 1 rod + internal drawer at bottom). Total 7 full-height doors.',
        open: 'Section A: 2 rods for short clothes. Section B: 2 rods for short clothes. Section C: 1 rod for long coats + internal drawer at bottom. Section D: 1 rod for long coats + internal drawer at bottom.',
      };
      if (w > 2600) return { // 6 full-height doors
        prompt: '3 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, short-clothes hanging with 2 rods inside) + section C (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom). Total 6 full-height doors.',
        open: 'Section A: 2 rods for short clothes. Section B: 2 rods for short clothes. Section C: 1 rod for long coats + internal drawer at bottom.',
      };
      if (w > 2000) return { // 5 full-height doors
        prompt: '3 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom) + section C (1 full-height door, long-clothes hanging with 1 rod + internal drawer at bottom). Total 5 full-height doors.',
        open: 'Section A: 2 rods for short clothes. Section B: 1 rod for long coats + internal drawer at bottom. Section C: 1 rod for long coats + internal drawer at bottom.',
      };
      return { // 4 full-height doors
        prompt: '2 sections (~950mm each): section A (2 full-height doors, short-clothes hanging with 2 rods inside) + section B (2 full-height doors, long-clothes hanging with 1 rod + internal drawer at bottom). Total 4 full-height doors.',
        open: 'Section A: 2 rods for short clothes. Section B: 1 rod for long coats + internal drawer at bottom.',
      };
    }

    // ─── 붙박이장 열린문 ───
    function buildWardrobeOpenPrompt(): string {
      const s = getWardrobeStructure(wallW);
      return `Open all wardrobe doors ~90°. Show organized interior: ${s.open} Clothes on hangers, folded items in drawers. Same camera/lighting/background. Photorealistic. No text.`;
    }

    // ─── 냉장고장 프롬프트 ───
    const FRIDGE_UNIT_DESC: Record<string, string> = {
      '1door': 'single-door column refrigerator',
      '3door': 'three-door refrigerator',
      '4door': 'french-door (4-door) refrigerator',
    };
    const FRIDGE_LINE_DESC: Record<string, string> = {
      'bespoke': 'Samsung Bespoke Kitchen Fit',
      'infinite': 'Samsung Infinite Line',
      'standing': 'freestanding',
      'fitmax': 'LG Fit & Max built-in',
    };

    function buildFridgeComboDesc(): string {
      const opts = fridge_options || {};
      const combo: Record<string, number> = opts.combo || { '4door': 1 };
      const parts: string[] = [];
      for (const [type, count] of Object.entries(combo)) {
        if (Number(count) > 0) {
          const desc = FRIDGE_UNIT_DESC[type] || type;
          parts.push(Number(count) > 1 ? `${count}x ${desc}` : desc);
        }
      }
      if (parts.length === 0) parts.push(FRIDGE_UNIT_DESC['4door']);
      const brand = opts.brand === 'lg' ? 'LG' : 'Samsung';
      const lineDesc = FRIDGE_LINE_DESC[opts.modelLine] || '';
      const lineStr = lineDesc ? ` (${lineDesc})` : '';
      return `${brand}${lineStr}: ${parts.join(' + ')}`;
    }

    function buildFridgePrompt(color: string, countertop: CountertopColor): string {
      const ctDesc = `"${countertop.name}" (${countertop.desc})`;
      const comboDesc = buildFridgeComboDesc();

      return `Edit photo: install refrigerator surround cabinet (~${wallW}mm wide, ~${wallH}mm tall).
Fridge: ${comboDesc}. Tall pantry cabinets on sides, bridge cabinet above.
ALL cabinet doors: "${color}" matte flat-panel. Countertop: ${ctDesc}.
Door surface smooth and seamless. Preserve background. Photorealistic. No text.`;
    }

    // ─── 화장대 프롬프트 (스탠딩형/의자형) ───
    // 스탠딩형: 벽감 + 플로팅 상판 + 서랍 2개 + 무릎 트임 + 원형거울
    // 의자형: 양문 하부장 + 상판 밑 서랍 2개 + 오른쪽 5단 수납타워 + 상판 740mm + 원형거울 (OBJ 레퍼런스)
    function buildVanityPrompt(
      color: string,
      countertop: CountertopColor,
      upper?: string,
      lower?: string,
    ): string {
      const ctDesc = `"${countertop.name}" (${countertop.desc})`;
      const type = (vanity_options?.type === 'chair') ? 'chair' : 'standing';
      const twoTone = upper && lower;
      const drawerColor = twoTone ? `"${lower}"` : `"${color}"`;
      const panelColor = twoTone ? `"${upper}"` : `"${color}"`;

      const STRUCTURAL_PRESERVE = `
[STRUCTURAL PRESERVATION — HIGHEST PRIORITY]
This is an IMAGE EDIT / INPAINT task on the uploaded photo. The original room MUST remain pixel-identical except for the area where the dressing table is added:
- Walls: keep ORIGINAL color, wallpaper, paint, texture, joints, niches AS-IS
- Floor: keep ORIGINAL material, pattern, board direction, joint lines, color AS-IS
- Ceiling: keep ORIGINAL height, color, moldings, beams, soffits AS-IS
- Architecture: PRESERVE all columns (기둥), beams (보), soffits, ledges, alcoves, door frames (문틀), window frames (창틀), baseboards (걸레받이), crown moldings (몰딩)
- Existing fixtures: PRESERVE switches, outlets, sensors, vents, lights, sliding-door tracks, existing closets visible in the photo
- Lighting: keep ORIGINAL direction, color temperature, shadows, reflections AS-IS
- Camera: keep IDENTICAL angle, focal length, perspective, framing
- The dressing table is INSERTED in front of / inside the existing structure — it does NOT replace the wall, floor, or any architectural element`;

      const SHARED_FORBIDDEN = `
[FORBIDDEN]
- NO washbasin, NO sink, NO faucet, NO water, NO plumbing, NO toilet, NO bathroom tiles
- NO rectangular or oval mirrors (round only)
- NO visible handles or knobs on any door or drawer
- NO repainting walls, NO replacing flooring, NO removing or altering columns/beams/architectural elements

Photorealistic. No text, no labels.`;

      if (type === 'chair') {
        return `Edit photo: install a DESK-STYLE CHAIR-TYPE built-in dressing table (책상형 의자형 붙박이 화장대, ~1400mm wide, ~650mm total depth, floor-to-ceiling).
${STRUCTURAL_PRESERVE}

[FORM — MUST MATCH EXACTLY]
- Flush full-height side panels on both sides (${panelColor} matte flat-panel)
- COUNTERTOP slab at ~740mm height, ~12mm thick, full ~650mm depth (wall to front edge), surface: ${ctDesc}
- BELOW THE COUNTER, the under-counter volume is split by depth into TWO zones:
  * REAR ZONE (wall side, ~300mm deep):
    - Lower cabinet (0~610mm): TWO hinged flat-panel doors side by side (${panelColor} matte), handleless push-to-open
    - Toe-kick plinth (0~60mm) recessed ~20mm behind the door faces
    - TWO slim handleless drawers (610~740mm), ~300mm deep, full width (${drawerColor})
  * FRONT ZONE (user side, ~350mm deep): COMPLETELY OPEN knee space — NO panels, NO drawers, NO doors, just open negative space so a chair can tuck UNDER the countertop like a desk
- BACK PANEL (flush matte) rising from the countertop to the ceiling (~740~2300mm)
- RIGHT-SIDE TALL STORAGE TOWER on the right side, sitting on top of the counter: ~150mm wide × ~570mm deep × ~1500mm tall (from ~740mm to ~2240mm) (${panelColor} matte)
  * BOTTOM OPEN COMPARTMENT (~740~1040mm, height 300mm): completely OPEN niche — NO door, NO drawers, exposed interior
  * UPPER CLOSED STORAGE (~1040~2240mm, height ~1200mm): internal horizontal SHELVES (3~4 tiers)
    – DOOR on the LEFT SIDE FACE of the tower (interior-facing, toward the mirror), swinging open sideways
    – FRONT FACE (facing the user) MUST be a FLUSH matte panel with NO door, NO drawer, NO seam — plain solid column from the front
    – All faces handleless (push-to-open), matte flat-panel
- Top crown moulding at ~2240~2300mm

[MIRROR — ROUND ONLY]
- ONE perfectly ROUND / CIRCULAR wall mirror (원형거울) mounted on the back wall, centered above the countertop to the LEFT of the right-side drawer tower
- Round shape only — STRICTLY NOT rectangular, NOT square, NOT oval, NOT irregular
- Diameter ~500~600mm, thin frameless or micro-bezel

[SEATING]
- Matching upholstered dressing stool or small chair TUCKED UNDER the countertop in the front knee zone (rear cabinet is only 300mm deep, the front ~350mm is open like a desk)

[FINISH]
- All panels, doors, and drawer fronts: matte flat-panel, completely handleless
- Counter neatly styled with perfume bottle, skincare bottles, makeup tray, jewelry dish
${SHARED_FORBIDDEN}
- NO full-depth lower cabinet — rear storage must be only ~300mm deep
- NO panels or drawers in the front knee zone below the counter
- NO door or drawer on the FRONT face of the right-side tower (flush plain panel only)
- NO drawers inside the right-side tower (shelves + single side-opening door only)
- NO enclosed bottom on the right-side tower (bottom 300mm MUST be an open compartment)`;
      }

      return `Edit photo: install a STANDING-TYPE built-in dressing table (스탠딩형 붙박이 화장대).
${STRUCTURAL_PRESERVE}

[FORM — MUST MATCH EXACTLY]
- Built between flush full-height side panels (${panelColor} matte flat-panel)
- COUNTER HEIGHT = 900mm from floor (standing use)
- FLOOR-TO-COUNTER FULL DRAWER BANK (0~900mm): the ENTIRE vertical space from floor to the countertop is filled with flat-panel drawers stacked vertically — NO open knee space, NO hinged doors, NO plinth gap
- 4 to 5 horizontal handleless drawers of equal or slightly graduated height (~180~225mm each), full cabinet width (${drawerColor} matte, push-to-open or hidden J-profile)
- COUNTERTOP slab at ~900mm height, ~12~20mm thick, clean square edge, surface: ${ctDesc}
- BACK PANEL (flush matte) rising from the countertop to the ceiling (~900~2300mm)
- Cabinet width ~800~1200mm, depth ~450~500mm

[MIRROR — ROUND ONLY]
- ONE perfectly ROUND / CIRCULAR wall mirror (원형거울) mounted on the back wall, centered above the countertop
- Round shape only — STRICTLY NOT rectangular, NOT square, NOT oval, NOT irregular
- Diameter ~500~600mm, thin frameless or micro-bezel

[FINISH]
- All drawer fronts, side panels, and back wall: matte flat-panel, completely handleless
- Counter neatly styled with a perfume bottle, skincare bottles, makeup tray
${SHARED_FORBIDDEN}
- NO open knee space under the counter (MUST be full drawer bank from floor)
- NO hinged doors in the 0~900mm section (drawers only)`;
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
      if (cat === 'fridge') {
        const comboDesc = buildFridgeComboDesc();
        return `Edit photo: install refrigerator surround cabinet (~${wallW}mm wide, ~${wallH}mm tall).
Fridge: ${comboDesc}. Tall pantry cabinets on sides, bridge cabinet above.
Upper cabinets: "${upper}" matte flat-panel. Lower cabinets: "${lower}" matte flat-panel.
Countertop: ${ctDesc}. Door surface smooth and seamless. Preserve background. Photorealistic. No text.`;
      }
      if (cat === 'vanity') {
        return buildVanityPrompt(upper, countertop, upper, lower);
      }
      return `Edit photo: install ${subject}. Upper: "${upper}", Lower: "${lower}". Countertop: ${ctDesc}. Wall ~${wallW}mm. Keep wall, floor, camera identical. No clutter.`;
    }

    // ═══ Step 3: 기본안 생성 (시드로 무채색 팔레트 + 상판 색상 픽) ═══
    log.info('Step 3: Generate base design (기본안 — seeded color pick)');

    const baseSeed = Math.floor(Math.random() * 9999);
    // 붙박이장은 그레이 계열 제외
    const wardrobePalette = ['white', 'milk white', 'cashmere', 'ivory', 'warm white'];
    const colorPalette = category === 'wardrobe' ? wardrobePalette : BASE_ACHROMATICS;
    const baseColor = colorPalette[baseSeed % colorPalette.length];
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

    // ═══ Step 4: 2nd image — 붙박이장은 열린문, 나머지는 AI 추천안 (투톤) ═══
    let altImage: string | undefined;
    let altPick: { upper: string; lower: string } | null = null;
    let altStyleLabel = 'AI Two-tone Recommendation';

    if (category === 'wardrobe') {
      // 붙박이장: 기본안(닫힌 문) 이미지를 입력으로 열린문 생성
      log.info('Step 4: Generate wardrobe open-door interior view');
      try {
        const openPrompt = buildWardrobeOpenPrompt();
        const closedMime = closedResult.image!.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
        const openResult = await callGemini(
          openPrompt, closedResult.image!, closedMime, ['IMAGE', 'TEXT'], 0.4, [], { maxRetries: 0 },
        );
        altImage = openResult.image;
        altStyleLabel = '내부 구조 (열린문)';
        if (altImage) log.info('Wardrobe open-door interior generated');
      } catch (e: any) {
        log.warn({ error: e?.message || String(e) }, 'Wardrobe open-door generation failed');
      }
    } else {
      log.info('Step 4: Generate AI recommendation (AI 추천안 — seeded two-tone pick)');
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
    }

    // ═══ Step 5: 견적 ═══
    log.info('Step 5: Quote analysis');
    let quote = null;
    let quoteMetadata: Record<string, unknown> = {};

    // 붙박이장: 벽 폭 기준 300mm당 14만원 구간 견적
    if (category === 'wardrobe') {
      try {
        const WARDROBE_UNIT_MM = 300;
        const WARDROBE_UNIT_PRICE = 140000;
        const units = Math.ceil(wallW / WARDROBE_UNIT_MM);
        const cabinetTotal = units * WARDROBE_UNIT_PRICE;
        const installTotal = 200000;
        const demolitionTotal = Math.round(30000 * wallW / 1000);

        const items = [
          { name: '붙박이장 캐비닛', quantity: `${wallW}mm (${units}자)`, unit_price: WARDROBE_UNIT_PRICE, total: cabinetTotal },
          { name: '시공비', quantity: '1식', unit_price: installTotal, total: installTotal },
          { name: '기존 철거', quantity: `${wallW}mm`, unit_price: 30000, total: demolitionTotal },
        ];
        const subtotal = items.reduce((s, i) => s + i.total, 0);
        const vat = Math.round(subtotal * 0.10);
        const total = subtotal + vat;

        quote = {
          items,
          subtotal,
          vat,
          total,
          range: { min: Math.round(total * 0.95), max: Math.round(total * 1.30) },
          grade: 'basic',
        };
        quoteMetadata = {
          analysis_version: 'wardrobe-unit-v1',
          wall_width_mm: wallW,
          unit_count: units,
          unit_price: WARDROBE_UNIT_PRICE,
        };
        log.info({ total: quote.total, units, wallW }, 'Wardrobe quote calculated');
      } catch (e: any) {
        log.warn({ error: e?.message || String(e) }, 'Wardrobe quote failed');
      }
    } else {
    // 싱크대 등: 이미지 분석 기반 견적
    try {
      const cornerHint = detectedLShape
        ? `\nL-SHAPE DETECTION: This kitchen has an L-shaped corner.
Look for the CORNER MODULE (블라인드 코너장) — the cabinet where two walls meet at 90°.
Mark it as type "corner". It is typically ~900mm wide.
List ALL modules: main wall first (left to right), then "corner", then secondary wall modules.`
        : '';

      const quotePrompt = `Analyze this kitchen cabinet design image.

KNOWN REFERENCE SIZES:
- Sink cabinet (개수대) = exactly 1000mm wide
- Cooktop/hood cabinet (가스대/후드장) = exactly 600mm wide
${cornerHint}
STEP 1: Count and classify each lower cabinet module from LEFT to RIGHT:
- sink: module containing sink bowl (1 per kitchen, 1000mm)
- cooktop: module with cooktop/induction (1 per kitchen, 600mm)
- drawer: drawer unit (horizontal lines/gaps)
- door: hinged door (vertical lines/gaps)${detectedLShape ? '\n- corner: L-shaped blind corner cabinet where two walls meet (~900mm)' : ''}

STEP 2: For each door/drawer module, estimate its width RELATIVE to the sink (1000mm).
Example: if a door appears to be half the width of the sink, its ratio is 0.5 (= 500mm).

STEP 3: Count upper cabinet door modules.

Return ONLY this JSON:
{
  "lower": [{"type":"sink","ratio":1.0}, {"type":"door","ratio":0.45}, ${detectedLShape ? '{"type":"corner","ratio":0.9}, ' : ''}{"type":"cooktop","ratio":0.6}, ...],
  "upper_count": 5,
  "has_sink": true,
  "has_cooktop": true,
  "has_hood": true
}
ratio: width relative to sink (1.0 = 1000mm). sink=1.0, cooktop=0.6${detectedLShape ? ', corner=0.9' : ''}.`;

      const mimeType = closedResult.image!.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
      const quoteText = await callClaude(quotePrompt, closedResult.image!, mimeType);
      const quoteMatch = quoteText.match(/\{[\s\S]*\}/);
      if (quoteMatch) {
        const raw = JSON.parse(quoteMatch[0]);
        const SINK_WIDTH = 1000;
        const lowerModules: Array<{ type: string; ratio?: number }> = raw.lower || [];
        const upperCount: number = raw.upper_count || lowerModules.length;

        // ratio × 1000mm(sink 기준) → 실제 너비, 표준 규격 스냅
        const CORNER_WIDTH = 900;
        const lowerWithWidths = lowerModules.map(m => {
          const type = m.type || 'door';
          if (type === 'sink') return { type, width: SINK_WIDTH };
          if (type === 'cooktop') return { type, width: 600 };
          if (type === 'corner') return { type, width: CORNER_WIDTH };
          const rawWidth = Math.round((m.ratio || 0.45) * SINK_WIDTH);
          return { type, width: snapToStandard(Math.max(300, rawWidth)) };
        });
        const lowerTotalCalc = lowerWithWidths.reduce((s, m) => s + m.width, 0);

        // ㄱ자: corner 모듈 기준으로 주선/보조선 분리
        const cornerIdx = lowerWithWidths.findIndex(m => m.type === 'corner');
        let mainLineW = lowerTotalCalc;
        let secondLineW = 0;
        if (cornerIdx >= 0) {
          mainLineW = lowerWithWidths.slice(0, cornerIdx).reduce((s, m) => s + m.width, 0);
          secondLineW = lowerWithWidths.slice(cornerIdx + 1).reduce((s, m) => s + m.width, 0);
          log.info({ mainLineW, cornerWidth: CORNER_WIDTH, secondLineW, detectedLShape }, 'L-shape split at corner module');
        }

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
        }, 'Ratio-based dimension analysis (sink=1000mm reference)');

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
          analysis_version: 'ratio-based-v4',
          lower_modules: lowerWithWidths,
          upper_count: upperCount,
          lower_total_mm: lowerTotalCalc,
          detected_l_shape: detectedLShape,
          main_line_mm: cornerIdx >= 0 ? mainLineW : lowerTotalCalc,
          corner_mm: cornerIdx >= 0 ? CORNER_WIDTH : 0,
          second_line_mm: secondLineW,
          wall_analysis_wallW: wallW,
        };
        log.info({ total: quote?.total, ...quoteMetadata }, 'Quote calculated (ratio-based)');
      }
    } catch (e: any) {
      log.warn({ error: e?.message || String(e) }, 'Quote analysis failed');
    }
    } // end else (non-wardrobe quote)

    const elapsed = Date.now() - startTime;
    log.info({ elapsed }, 'Generation complete');

    res.json({
      success: true,
      generated_image: {
        closed: closedResult.image,
        alt: altImage || null,
      },
      alt_style: {
        name: altStyleLabel,
      },
      quote,
      quote_analysis: quoteMetadata,
      wall_analysis: { wallW, wallW2, wallH, waterPct, exhaustPct, kitchen_layout, detectedLShape, totalCabinetW: wallW + wallW2 },
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
