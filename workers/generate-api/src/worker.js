/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 * Gemini Flash Image 직접 호출 (벽분석 + 가구생성 + 열린문)
 */

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
async function callGemini(env, prompt, image, imageType, responseModalities = ['IMAGE', 'TEXT'], temperature = 0.4) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const parts = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
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
function buildWallAnalysisPrompt() {
  return `[TASK: Korean kitchen wall structure analysis]
Analyze this photo and extract as JSON:
- wall_dimensions_mm: { width, height } (estimate)
- utility_positions_mm: { water_supply_from_left, exhaust_duct_from_left }
- confidence: "high" | "medium" | "low"
Return ONLY valid JSON.`;
}

// ─── 가구 생성 프롬프트 ───
function buildFurniturePrompt(category, style, kitchenLayout, wallData, themeData) {
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
    const structure = getWardrobeStructure(wallData.wallW);
    return `Place ${doorColor} ${doorFinish} built-in wardrobe on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm.
[CRITICAL] The wardrobe MUST cover the ENTIRE wall from left edge to right edge with NO gaps. Every section must have closed flat-panel doors.
[STRUCTURE] ${structure.prompt}
Full-width floor-to-ceiling wardrobe spanning the entire wall width (~${wallData.wallW}mm).
Height: floor to ceiling (~${wallData.wallH}mm). Depth: ~600mm.
No visible handles (J-pull grip or push-to-open). ${styleName}. Photorealistic. All doors CLOSED. No text.`;
  }

  if (category === 'shoe' || category === 'shoe_cabinet') {
    return `Place ${doorColor} ${doorFinish} shoe cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Slim profile 300-400mm depth. Floor-to-ceiling.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
  }

  if (category === 'fridge' || category === 'fridge_cabinet') {
    return `Place ${doorColor} ${doorFinish} refrigerator surround cabinet on this photo. PRESERVE background EXACTLY.
Wall: ${wallData.wallW}x${wallData.wallH}mm. Center opening for fridge, tall storage on sides, bridge above.
No visible handles. ${styleName}. Photorealistic. All doors closed.`;
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

// ─── 붙박이장 내부 구조 사양 (벽 폭 기준) ───
function getWardrobeStructure(w) {
  if (w > 3200) {
    // 7도어: 2도어 3통(2단2개+1단1개) + 1도어 1통(선반형)
    return {
      prompt: '4 sections total: THREE 2-door sections (two with double-tier hanging rods, one with single-tier hanging rod and one large drawer at the bottom) + ONE single-door shelf section with multiple fixed shelves. Total 7 doors.',
      openPrompt: `  - Section 1 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 2 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 3 (2-door): single full-height hanging rod for long coats/dresses, one large drawer at bottom
  - Section 4 (1-door, shelf unit): 5-6 fixed shelves with folded clothes and storage boxes`,
    };
  }
  if (w > 2600) {
    // 6도어: 2도어 3통(2단2개+1단1개)
    return {
      prompt: '3 sections total: THREE 2-door sections (two with double-tier hanging rods, one with single-tier hanging rod and one large drawer at the bottom). Total 6 doors.',
      openPrompt: `  - Section 1 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 2 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 3 (2-door): single full-height hanging rod for long coats/dresses, one large drawer at bottom`,
    };
  }
  if (w > 2000) {
    // 5도어: 2도어 2통(2단1개+1단1개) + 1도어 1통(선반형)
    return {
      prompt: '3 sections total: TWO 2-door sections (one with double-tier hanging rods, one with single-tier hanging rod and one large drawer at the bottom) + ONE single-door shelf section with multiple fixed shelves. Total 5 doors.',
      openPrompt: `  - Section 1 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 2 (2-door): single full-height hanging rod for long coats/dresses, one large drawer at bottom
  - Section 3 (1-door, shelf unit): 5-6 fixed shelves with folded clothes and storage boxes`,
    };
  }
  // 4도어: 2도어 2통(2단1개+1단1개)
  return {
    prompt: '2 sections total: TWO 2-door sections (one with double-tier hanging rods, one with single-tier hanging rod and one large drawer at the bottom). Total 4 doors.',
    openPrompt: `  - Section 1 (2-door): upper hanging rod + lower hanging rod for short clothes, one large drawer at bottom
  - Section 2 (2-door): single full-height hanging rod for long coats/dresses, one large drawer at bottom`,
  };
}

// ─── 열린문 프롬프트 ───
function buildOpenDoorPrompt(category, wallW) {
  if (category === 'wardrobe') {
    const structure = getWardrobeStructure(wallW || 3000);
    return `[TASK] Open ALL wardrobe doors in this image to reveal the organized interior.

[RULES]
- Keep the EXACT same camera angle, lighting, and room background
- Open every wardrobe door to approximately 90 degrees
- Show a well-organized wardrobe interior:
${structure.openPrompt}
- Each section clearly divided by vertical partition panels
- Hanging rods with neatly hung clothes (shirts, jackets, dresses, coats)
- Folded clothes and storage boxes on shelves
- Large pull-out drawer visible at the bottom of each hanging section
- Keep all wardrobe structure and room elements in place
- Photorealistic result

[FORBIDDEN]
- Do NOT change camera angle or room background
- Do NOT add/remove/merge any door sections
- NO text, labels, or annotations`;
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
          ...themeData
        } = body;

        if (!room_image) {
          return new Response(JSON.stringify({ success: false, error: 'room_image is required' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[Generate] category=${category}, style=${design_style}, layout=${kitchen_layout}`);

        // ═══ Step 1: 벽면 분석 ═══
        let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;

        try {
          const wallResult = await callGemini(env, buildWallAnalysisPrompt(), room_image, image_type, ['TEXT'], 0.2);

          if (wallResult.text) {
            const jsonMatch = wallResult.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              const dims = parsed.wall_dimensions_mm || {};
              const utils = parsed.utility_positions_mm || {};
              wallW = dims.width || 3000;
              wallH = dims.height || 2400;
              if (utils.water_supply_from_left) waterPct = Math.round(utils.water_supply_from_left / wallW * 100);
              if (utils.exhaust_duct_from_left) exhaustPct = Math.round(utils.exhaust_duct_from_left / wallW * 100);
            }
          }
          console.log(`[Generate] Wall: ${wallW}x${wallH}, water=${waterPct}%, exhaust=${exhaustPct}%`);
        } catch (e) {
          console.warn('[Generate] Wall analysis failed, using defaults');
        }

        // ═══ Step 2: 가구 생성 (닫힌문) ═══
        const furniturePrompt = buildFurniturePrompt(category, design_style, kitchen_layout, { wallW, wallH, waterPct, exhaustPct }, themeData);
        const closedResult = await callGemini(env, furniturePrompt, room_image, image_type);

        if (!closedResult.image) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to generate closed door image' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        console.log('[Generate] Closed door image generated');

        // ═══ Step 3: 열린문 생성 ═══
        let openImage = null;
        try {
          const openResult = await callGemini(env, buildOpenDoorPrompt(category, wallW), closedResult.image, 'image/png');
          openImage = openResult.image || null;
          if (openImage) console.log('[Generate] Open door image generated');
        } catch (e) {
          console.warn('[Generate] Open door generation failed');
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

        return new Response(JSON.stringify({
          success: true,
          generated_image: {
            background: room_image,
            closed: closedResult.image,
            open: openImage,
          },
          quote,
          wall_analysis: { wallW, wallH, waterPct, exhaustPct },
          metadata: {
            category, kitchen_layout, design_style,
            model: env.GEMINI_MODEL || 'gemini-2.5-flash-image',
            elapsed_ms: elapsed,
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
