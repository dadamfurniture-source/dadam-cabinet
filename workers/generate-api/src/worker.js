/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 *
 * 이 파일은 카테고리 무관 인프라(callGemini, CORS, fetch handler 골격) 와
 * 카테고리별 prompt 모듈을 호출하는 얇은 dispatcher 만 담당한다.
 *
 * 카테고리별 프롬프트는 ./prompts/{category}-prompt.js 에 격리되어 있어
 * 한 카테고리 수정이 다른 카테고리로 새는 사고를 원천 차단한다.
 *
 * Dispatch 룩업:
 *   - CLOSED_BUILDERS[category](ctx) → Step 2 프롬프트 문자열
 *   - ALT_BUILDERS[category](ctx)    → Step 3 {inputKey, prompt, metadata}
 *   - FRIDGE_CATEGORIES               → Step 1b 철거가 필요한 카테고리
 *   - applyWallWidthCorrection        → Step 1 후 카테고리별 보정
 */

import { buildWallAnalysisPrompt, applyWallWidthCorrection } from './prompts/wall-analysis.js';
import {
  SINK_CATEGORIES,
  buildSinkClosedPrompt,
  buildSinkAltSpec,
} from './prompts/sink-prompt.js';
import {
  WARDROBE_CATEGORIES,
  buildWardrobeClosedPrompt,
  buildWardrobeAltSpec,
  buildWardrobeQuote,
} from './prompts/wardrobe-prompt.js';
import {
  VANITY_CATEGORIES,
  buildVanityClosedPrompt,
  buildVanityAltSpec,
} from './prompts/vanity-prompt.js';
import {
  SHOE_CATEGORIES,
  buildShoeClosedPrompt,
  buildShoeAltSpec,
} from './prompts/shoe-prompt.js';
import {
  FRIDGE_CATEGORIES,
  buildFridgeClosedPrompt,
  buildFridgeAltSpec,
  buildFridgeDemolitionPrompt,
} from './prompts/fridge-prompt.js';

// ─── 스타일 매핑 (카테고리 무관) ───
const STYLE_MAP = {
  'modern-minimal': 'Modern Minimal',
  'scandinavian-warm': 'Scandinavian Warm',
  'natural-zen': 'Natural Zen',
  'luxury-dark': 'Luxury Dark',
  'urban-industrial': 'Urban Industrial',
};

// ─── 카테고리 → prompt 빌더 룩업 테이블 ───
// 신규 카테고리 추가 시 여기 한 줄만 추가하면 됨 (+ 모듈 파일 1개)
const CLOSED_BUILDERS = {};
const ALT_BUILDERS = {};
function register(categories, closedBuilder, altBuilder) {
  for (const c of categories) {
    CLOSED_BUILDERS[c] = closedBuilder;
    ALT_BUILDERS[c] = altBuilder;
  }
}
register(SINK_CATEGORIES, buildSinkClosedPrompt, buildSinkAltSpec);
register(WARDROBE_CATEGORIES, buildWardrobeClosedPrompt, buildWardrobeAltSpec);
register(VANITY_CATEGORIES, buildVanityClosedPrompt, buildVanityAltSpec);
register(SHOE_CATEGORIES, buildShoeClosedPrompt, buildShoeAltSpec);
register(FRIDGE_CATEGORIES, buildFridgeClosedPrompt, buildFridgeAltSpec);

// ─── Gemini API 호출 ───
async function callGemini(env, prompt, image, imageType, responseModalities = ['IMAGE', 'TEXT'], temperature = 0.4, extraImages = []) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const parts = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
  }
  // 추가 레퍼런스 이미지 (포트폴리오 등) — 메인 이미지 다음, 프롬프트 이전
  for (const ref of extraImages || []) {
    if (ref && ref.base64 && ref.mimeType) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
    }
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      responseModalities,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Gemini API ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const outParts = data.candidates?.[0]?.content?.parts || [];
  let outImage = null;
  let outText = '';
  for (const p of outParts) {
    if (p.inlineData?.data) outImage = p.inlineData.data;
    if (p.text) outText += p.text;
  }
  return { image: outImage, text: outText };
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

        const styleName = STYLE_MAP[design_style] || 'Modern Minimal';
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
                // 카테고리별 렌즈 왜곡 보정 (싱크대는 미적용)
                wallW = applyWallWidthCorrection(category, wallW);
                if (utils.water_supply_from_left) waterPct = Math.round(utils.water_supply_from_left / wallW * 100);
                if (utils.exhaust_duct_from_left) exhaustPct = Math.round(utils.exhaust_duct_from_left / wallW * 100);
              }
            }
            console.log(`[Generate] Wall: ${wallW}x${wallH}, water=${waterPct}%, exhaust=${exhaustPct}%`);
          } catch (e) {
            console.warn('[Generate] Wall analysis failed, using defaults');
          }
        }

        const wallData = { wallW, wallH, waterPct, exhaustPct };

        // ═══ Step 1b: 냉장고장 전용 — 기존 구조 철거 ═══
        const isFridge = FRIDGE_CATEGORIES.includes(category);
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
            console.warn('[Generate] Fridge demolition failed:', e.message);
          }
        }

        // ═══ Step 2: 가구 생성 (닫힌문) ═══
        const fridgeOptsForPrompt = isFridge
          ? { ...(fridge_options || {}), referenceCount: refImages.length }
          : fridge_options;

        const ctx = {
          category, style: design_style, styleName, kitchenLayout: kitchen_layout,
          wallData, themeData, fridgeOpts: fridgeOptsForPrompt,
          siteAlreadyCleared: demoSucceeded,
        };

        const closedBuilder = CLOSED_BUILDERS[category];
        if (!closedBuilder) {
          return new Response(JSON.stringify({ success: false, error: `Unsupported category: ${category}` }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        const furniturePrompt = closedBuilder(ctx);
        const closedResult = await callGemini(env, furniturePrompt, installBaseImage, installMime, undefined, undefined, refImages);

        if (!closedResult.image) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to generate closed door image' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        console.log('[Generate] Closed door image generated');

        // ═══ Step 3: 대안 이미지 (카테고리별) ═══
        let altImage = null;
        let altMetadata = {};
        try {
          const altBuilder = ALT_BUILDERS[category];
          if (altBuilder) {
            const altSpec = altBuilder({ ...ctx, closedImage: closedResult.image });
            const inputImage = altSpec.inputKey === 'install' ? installBaseImage : closedResult.image;
            const inputMime = altSpec.inputKey === 'install' ? installMime : 'image/png';
            // fridge 는 install 이미지 위에 생성 — refImages 필요, 그 외는 closed 를 변환 — refImages 불필요
            const extraRefs = altSpec.inputKey === 'install' ? refImages : [];
            const altResult = await callGemini(env, altSpec.prompt, inputImage, inputMime, undefined, undefined, extraRefs);
            altImage = altResult.image || null;
            altMetadata = altSpec.metadata || {};
            if (altImage) console.log(`[Generate] Alt image generated (${altSpec.metadata?.alt_style?.name || 'default'})`);
          }
        } catch (e) {
          console.warn('[Generate] Alt image generation failed:', e.message);
        }

        // ═══ 견적 (붙박이장 전용) ═══
        const quote = category === 'wardrobe' ? buildWardrobeQuote(wallW) : null;
        if (quote) {
          console.log(`[Generate] Wardrobe quote total: ${quote.total}원`);
        }

        // ═══ 응답 ═══
        const elapsed = Date.now() - startTime;
        console.log(`[Generate] Complete in ${elapsed}ms`);

        const generatedImage = {
          background: room_image,
          closed: closedResult.image,
          open: altImage,
          alt: altImage,
        };
        if (isFridge) {
          generatedImage.demolished = demolishedImage;
        }

        return new Response(JSON.stringify({
          success: true,
          generated_image: generatedImage,
          quote,
          wall_analysis: { wallW, wallH, waterPct, exhaustPct },
          alt_style: altMetadata.alt_style || null,
          metadata: {
            category, kitchen_layout, design_style,
            model: env.GEMINI_MODEL || 'gemini-2.5-flash-image',
            elapsed_ms: elapsed,
            alt_colors: altMetadata.alt_colors,
            alt_countertop: altMetadata.alt_countertop,
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
