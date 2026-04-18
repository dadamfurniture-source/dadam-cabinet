/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 * Gemini Flash Image 직접 호출 (벽분석 + 가구생성 + 열린문)
 *
 * 카테고리별 프롬프트 모듈:
 *   - 냉장고장: ./fridge-prompt.js
 *   - 그 외: worker.js 내부 buildFurniturePrompt / getWardrobeStructure 등
 */

import { buildFridgePrompt, buildFridgeDemolitionPrompt, buildFridgeRecommendedPrompt } from './fridge-prompt.js';

// ─── 레이아웃/스타일 매핑 ───
const LAYOUT_DESC = {
  i_type: 'straight linear I-shaped',
  l_type: 'L-shaped corner',
  u_type: 'U-shaped three-wall',
  peninsula: 'peninsula island facing living room',
};

const STYLE_MAP = {
  'modern-minimal': 'Modern Minimal',
  'scandinavian': 'Scandinavian Nordic',
  'industrial': 'Industrial Vintage',
  'classic': 'Classic Traditional',
  'luxury': 'Luxury Premium',
};

// ─── Gemini API 호출 ───
async function callGemini(env, prompt, image, imageType, responseModalities = ['IMAGE', 'TEXT'], temperature = 0.4, extraImages = []) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const parts = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
  }
  // 추가 레퍼런스 이미지 (포트폴리오 등) - 메인 이미지 다음, 프롬프트 이전
  for (const ex of extraImages) {
    if (ex && ex.base64 && ex.mimeType) {
      parts.push({ inlineData: { mimeType: ex.mimeType, data: ex.base64 } });
    }
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities, temperature },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const resultParts = data.candidates?.[0]?.content?.parts || [];
  let resultImage, resultText;

  for (const part of resultParts) {
    if (part.inlineData) resultImage = part.inlineData.data;
    if (part.text) resultText = part.text;
  }

  return { image: resultImage, text: resultText };
}

// ─── 벽분석 프롬프트 ───
function buildWallAnalysisPrompt(category) {
  if (category === 'wardrobe') {
    return `Analyze this Korean apartment room photo for built-in wardrobe installation.

CALIBRATION — Use these KNOWN Korean apartment features as size references:
- Standard door frame: 900mm wide × 2100mm tall (most common reference)
- Light switch / outlet plate: 70mm wide × 120mm tall
- Ceiling height: typically 2300-2400mm
- Standard room door: use as PRIMARY scale reference

TASK:
1. Identify any visible doors, door frames, outlets, or light switches
2. Use them as scale reference to calculate the target wall width in mm
3. Korean apartment rooms typically have walls 1800-5000mm wide. Be conservative.

Return JSON only:
{"wall_dimensions_mm":{"width":number,"height":number},"reference_used":"door_frame"|"outlet"|"ceiling"|"none","confidence":"high"|"medium"|"low"}`;
  }

  return `[TASK: Korean kitchen wall structure analysis]
Analyze this photo and extract as JSON:
- wall_dimensions_mm: { width, height } (estimate)
- utility_positions_mm: { water_supply_from_left, exhaust_duct_from_left }
- confidence: "high" | "medium" | "low"
Return ONLY valid JSON.`;
}

// ─── 가구 생성 프롬프트 ───
function buildFurniturePrompt(category, style, kitchenLayout, wallData, themeData, fridgeOptions, extra = {}) {
  const layoutDesc = LAYOUT_DESC[kitchenLayout] || 'straight linear';
  const styleName = STYLE_MAP[style] || 'Modern Minimal';
  const doorColor = themeData.style_door_color || 'white';
  const doorFinish = themeData.style_door_finish || 'matte';
  const countertop = themeData.style_countertop_prompt || 'white stone countertop';

  if (['sink', 'kitchen', 'l_shaped_sink', 'island_kitchen'].includes(category)) {
    return `Place ${doorColor} ${doorFinish} flat panel ${layoutDesc} kitchen cabinets on this photo. PRESERVE background EXACTLY.
[WALL] ${wallData.wallW}x${wallData.wallH}mm wall.
[PLUMBING] Sink at ${wallData.waterPct}% from left, cooktop at ${wallData.exhaustPct}% from left.
[UPPER] 4 upper cabinets flush to ceiling, no gap between ceiling and cabinets.
[LOWER] 5 lower cabinets (600mm, sink, 600mm, cooktop, 600mm).
[COUNTERTOP] ${countertop}, continuous surface.
[DOORS] No visible handles. Push-to-open mechanism.
[HOOD] Concealed range hood integrated into upper cabinet above cooktop.
[STYLE] ${styleName}. Clean lines. Photorealistic interior photography.
[QUALITY] 8K quality, natural lighting, proper shadows and reflections.
CRITICAL: PRESERVE original room background EXACTLY. All doors CLOSED. No text/labels. Photorealistic.`;
  }

  if (category === 'wardrobe') {
    const s = getWardrobeStructure(wallData.wallW);
    return `Edit photo: install built-in wardrobe covering entire wall (~${wallData.wallW}mm wide, ~${wallData.wallH}mm tall).
Doors: "${doorColor}" matte flat-panel, each door is one single piece running full height from floor to ceiling. Door surface is completely smooth and seamless with no indentations, no grooves, no cutouts. ${s.prompt}
All doors closed. No gaps between doors. Preserve background. Photorealistic. No text.`;
  }

  if (category === 'shoe' || category === 'shoe_cabinet') {
    return `Place ${doorColor} ${doorFinish} shoe cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'fridge' || category === 'fridge_cabinet') {
    return buildFridgePrompt({
      doorColor,
      doorFinish,
      wallData,
      styleName,
      fridgeOpts: fridgeOptions,
      siteAlreadyCleared: !!extra.siteAlreadyCleared,
    });
  }

  if (category === 'vanity') {
    return `Place ${doorColor} ${doorFinish} bathroom vanity on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Vanity with sink at ${wallData.waterPct}% from left. Mirror cabinet above.
${countertop}. ${styleName}. Photorealistic. Faucet chrome finish.`;
  }

  return `Place ${doorColor} ${doorFinish} storage cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Floor-to-ceiling built-in with multiple door sections.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
}

// ─── 붙박이장 구조 (벽 폭 기준, 섹션 950mm) ───
// All doors are FULL-HEIGHT single doors (floor to ceiling, never split upper/lower)
// Shelves are minimized — prefer hanging rods and internal drawers
function getWardrobeStructure(w) {
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

// ─── 열린문 프롬프트 ───
function buildOpenDoorPrompt(category, wallW) {
  if (category === 'wardrobe') {
    const s = getWardrobeStructure(wallW || 3000);
    return `Open all wardrobe doors ~90°. Show organized interior: ${s.open} Clothes on hangers, folded items in drawers. Same camera/lighting/background. Photorealistic. No text.`;
  }

  return `Using this closed-door furniture image, generate the SAME furniture with doors OPEN.
RULES:
- SAME camera angle, lighting, background, furniture position
- Open doors to ~90 degrees showing interior
- Show neatly organized storage inside
- Photorealistic quality
- Do NOT change any furniture structure or color`;
}

// ─── CORS 헤더 ───
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ═══════════════════════════════════════════════════════════════
// Worker Fetch Handler
// ═══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const headers = corsHeaders(origin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // Health check
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'dadam-generate-api', worker: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // POST /api/generate
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      const startTime = Date.now();

      try {
        if (!env.GEMINI_API_KEY) {
          return new Response(JSON.stringify({ success: false, error: 'GEMINI_API_KEY not configured' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        const body = await request.json();
        const {
          room_image,
          image_type = 'image/jpeg',
          category = 'sink',
          kitchen_layout = 'i_type',
          design_style = 'modern-minimal',
          wall_width_override,
          fridge_options,
          reference_images,
          ...themeData
        } = body;

        // reference_images: [{ base64, mimeType, description? }, ...]
        const refImages = Array.isArray(reference_images)
          ? reference_images.filter((r) => r && r.base64 && r.mimeType)
          : [];
        if (refImages.length > 0) {
          console.log(`[Generate] reference_images: ${refImages.length} attached`);
        }

        if (!room_image) {
          return new Response(JSON.stringify({ success: false, error: 'room_image is required' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[Generate] category=${category}, style=${design_style}, layout=${kitchen_layout}`);

        // ═══ Step 1: 벽면 분석 ═══
        let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;
        const manualW = Number(wall_width_override);

        if (manualW >= 1000 && manualW <= 6000) {
          wallW = manualW;
          console.log(`[Generate] Wall width from user override: ${wallW}mm`);
        } else {
        try {
          const wallResult = await callGemini(env, buildWallAnalysisPrompt(category), room_image, image_type, ['TEXT'], 0.2);

          if (wallResult.text) {
            const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              const dims = parsed.wall_dimensions_mm || {};
              const utils = parsed.utility_positions_mm || {};
              wallW = dims.width || 3000;
              wallH = dims.height || 2400;
              // 미터 → mm 변환 보호
              if (wallW > 0 && wallW < 100) wallW = Math.round(wallW * 1000);
              if (wallH > 0 && wallH < 100) wallH = Math.round(wallH * 1000);
              // 렌즈 왜곡 보정 (15% 과대측정)
              wallW = Math.round(wallW * 0.85);
              // 범위 클램핑
              wallW = Math.max(1800, Math.min(5000, wallW));
              if (utils.water_supply_from_left) waterPct = Math.round(utils.water_supply_from_left / wallW * 100);
              if (utils.exhaust_duct_from_left) exhaustPct = Math.round(utils.exhaust_duct_from_left / wallW * 100);
            }
          }
          console.log(`[Generate] Wall: ${wallW}x${wallH}, water=${waterPct}%, exhaust=${exhaustPct}%`);
        } catch (e) {
          console.warn('[Generate] Wall analysis failed, using defaults');
        }
        } // end else (AI wall analysis)

        // ═══ Step 1b: 냉장고장 전용 — 기존 구조 철거 (빈 벽 사진 생성) ═══
        const isFridge = (category === 'fridge' || category === 'fridge_cabinet');
        let installBaseImage = room_image;
        let installMime = image_type;
        let demoSucceeded = false;
        let demolishedImage = null;
        if (isFridge) {
          try {
            const demoResult = await callGemini(
              env,
              buildFridgeDemolitionPrompt(),
              room_image,
              image_type,
              ['IMAGE', 'TEXT'],
              0.2,
            );
            if (demoResult.image) {
              installBaseImage = demoResult.image;
              installMime = 'image/png';
              demoSucceeded = true;
              demolishedImage = demoResult.image;
              console.log('[Generate] Fridge demolition stage complete');
            } else {
              console.warn('[Generate] Fridge demolition returned no image, using raw room image');
            }
          } catch (e) {
            console.warn('[Generate] Fridge demolition failed, using raw room image:', e.message);
          }
        }

        // ═══ Step 2: 가구 생성 (닫힌문) ═══
        const fridgeOptsForPrompt = isFridge
          ? { ...(fridge_options || {}), referenceCount: refImages.length }
          : fridge_options;
        const furniturePrompt = buildFurniturePrompt(
          category,
          design_style,
          kitchen_layout,
          { wallW, wallH, waterPct, exhaustPct },
          themeData,
          fridgeOptsForPrompt,
          { siteAlreadyCleared: demoSucceeded },
        );
        const closedResult = await callGemini(env, furniturePrompt, installBaseImage, installMime, undefined, undefined, refImages);

        if (!closedResult.image) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to generate closed door image' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        console.log('[Generate] Closed door image generated');

        // ═══ Step 3: 대안 이미지 생성 ═══
        //   fridge → AI 추천 디자인 (냉장고장 + 홈바/홈카페 수납장, 배경 고정)
        //   그 외  → 기존 열린문 생성
        let openImage = null;
        try {
          if (isFridge) {
            const recDoorColor = themeData.style_door_color || 'white';
            const recDoorFinish = themeData.style_door_finish || 'matte';
            const recStyleName = STYLE_MAP[design_style] || 'Modern Minimal';
            const recPrompt = buildFridgeRecommendedPrompt({
              doorColor: recDoorColor,
              doorFinish: recDoorFinish,
              wallData: { wallW, wallH, waterPct, exhaustPct },
              styleName: recStyleName,
              fridgeOpts: fridgeOptsForPrompt,
              siteAlreadyCleared: demoSucceeded,
            });
            const recResult = await callGemini(env, recPrompt, installBaseImage, installMime, undefined, undefined, refImages);
            openImage = recResult.image || null;
            if (openImage) console.log('[Generate] Fridge recommended design generated (homebar/cafe)');
            else console.warn('[Generate] Fridge recommended design returned no image');
          } else {
            const openResult = await callGemini(env, buildOpenDoorPrompt(category, wallW), closedResult.image, 'image/png');
            openImage = openResult.image || null;
            if (openImage) console.log('[Generate] Open door image generated');
          }
        } catch (e) {
          console.warn('[Generate] Alt image generation failed:', e.message);
        }

        // ═══ 견적 (붙박이장: 300mm당 14만원) ═══
        let quote = null;
        if (category === 'wardrobe') {
          const UNIT_MM = 300;
          const UNIT_PRICE = 140000;
          const units = Math.ceil(wallW / UNIT_MM);
          const cabinetTotal = units * UNIT_PRICE;
          const installTotal = 200000;
          const demolitionTotal = Math.round(30000 * wallW / 1000);
          const items = [
            { name: '붙박이장 캐비닛', quantity: `${wallW}mm (${units}자)`, unit_price: UNIT_PRICE, total: cabinetTotal },
            { name: '시공비', quantity: '1식', unit_price: installTotal, total: installTotal },
            { name: '기존 철거', quantity: `${wallW}mm`, unit_price: 30000, total: demolitionTotal },
          ];
          const subtotal = items.reduce((s, i) => s + i.total, 0);
          const vat = Math.round(subtotal * 0.10);
          const total = subtotal + vat;
          quote = {
            items, subtotal, vat, total,
            range: { min: Math.round(total * 0.95), max: Math.round(total * 1.30) },
            grade: 'basic',
          };
          console.log(`[Generate] Wardrobe quote: ${units}자 × ${UNIT_PRICE} = ${total}원`);
        }

        // ═══ 응답 ═══
        const elapsed = Date.now() - startTime;
        console.log(`[Generate] Complete in ${elapsed}ms`);

        const generatedImage = {
          background: room_image,
          closed: closedResult.image,
          open: openImage,
        };
        if (isFridge) {
          // 철거 중간 이미지는 UI 에 표시하지 않지만 디버깅/회귀 검수를 위해 payload 에 포함
          generatedImage.demolished = demolishedImage;
        }

        return new Response(JSON.stringify({
          success: true,
          generated_image: generatedImage,
          quote,
          wall_analysis: { wallW, wallH, waterPct, exhaustPct },
          metadata: {
            category, kitchen_layout, design_style,
            model: env.GEMINI_MODEL || 'gemini-2.5-flash-image',
            elapsed_ms: elapsed,
            fridge_demolition: isFridge ? { attempted: true, succeeded: demoSucceeded } : undefined,
          },
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });

      } catch (error) {
        console.error('[Generate] Error:', error.message);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
