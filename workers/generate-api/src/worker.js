/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 *
 * 카테고리 무관 인프라(callGemini, CORS, fetch handler 골격) + 얇은 dispatcher 만 담당.
 * 카테고리별 프롬프트는 ./prompts/{category}-prompt.js 에 격리되어 있어
 * 한 카테고리 수정이 다른 카테고리로 새는 사고를 원천 차단한다.
 *
 * 새 카테고리 추가:
 *   1) ./prompts/{name}-prompt.js 생성 (CATEGORIES 배열 + 2개 export)
 *   2) 아래 import + register(...) 한 줄씩 추가
 */

import { buildWallAnalysisPrompt } from './prompts/wall-analysis.js';
import { SINK_CATEGORIES, buildSinkClosedPrompt, buildSinkAltSpec } from './prompts/sink-prompt.js';
import { WARDROBE_CATEGORIES, buildWardrobeClosedPrompt, buildWardrobeAltSpec } from './prompts/wardrobe-prompt.js';
import { SHOE_CATEGORIES, buildShoeClosedPrompt, buildShoeAltSpec } from './prompts/shoe-prompt.js';
import {
  FRIDGE_CATEGORIES,
  FRIDGE_ANALYSIS_MODEL,
  buildFridgeAnalysisPrompt,
  buildFridgeClosedPrompt,
  buildFridgeAltSpec,
} from './prompts/fridge-prompt.js';
import { VANITY_CATEGORIES, buildVanityClosedPrompt, buildVanityAltSpec } from './prompts/vanity-prompt.js';
import { buildStorageClosedPrompt, buildStorageAltSpec } from './prompts/storage-prompt.js';
import { callClaudeVision, extractJson } from './clients/claude.js';

// ─── 스타일 매핑 (카테고리 무관) ───
const STYLE_MAP = {
  'modern-minimal': 'Modern Minimal',
  'scandinavian': 'Scandinavian Nordic',
  'industrial': 'Industrial Vintage',
  'classic': 'Classic Traditional',
  'luxury': 'Luxury Premium',
};

// ─── 카테고리 → prompt builder 룩업 ───
// 신규 카테고리 = 모듈 파일 1개 + 아래 register 한 줄
const CLOSED_BUILDERS = {};
const ALT_BUILDERS = {};
// Pre-analysis 를 쓰는 카테고리만 등록. 없는 카테고리는 Claude 호출 스킵.
const PRE_ANALYSIS = {}; // { [category]: { model, promptBuilder } }
function register(categories, closedBuilder, altBuilder, opts = {}) {
  for (const c of categories) {
    CLOSED_BUILDERS[c] = closedBuilder;
    ALT_BUILDERS[c] = altBuilder;
    if (opts.analysisModel && opts.analysisPromptBuilder) {
      PRE_ANALYSIS[c] = { model: opts.analysisModel, promptBuilder: opts.analysisPromptBuilder };
    }
  }
}
register(SINK_CATEGORIES, buildSinkClosedPrompt, buildSinkAltSpec);
register(WARDROBE_CATEGORIES, buildWardrobeClosedPrompt, buildWardrobeAltSpec);
register(SHOE_CATEGORIES, buildShoeClosedPrompt, buildShoeAltSpec);
register(FRIDGE_CATEGORIES, buildFridgeClosedPrompt, buildFridgeAltSpec, {
  analysisModel: FRIDGE_ANALYSIS_MODEL,
  analysisPromptBuilder: buildFridgeAnalysisPrompt,
});
register(VANITY_CATEGORIES, buildVanityClosedPrompt, buildVanityAltSpec);

// 룩업에 없는 category 가 들어오면 일반 수납장으로 폴백
function resolveBuilders(category) {
  return {
    closed: CLOSED_BUILDERS[category] || buildStorageClosedPrompt,
    alt: ALT_BUILDERS[category] || buildStorageAltSpec,
  };
}

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

        const styleName = STYLE_MAP[design_style] || 'Modern Minimal';
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

        const wallData = { wallW, wallH, waterPct, exhaustPct };
        const ctx = { category, kitchenLayout: kitchen_layout, design_style, styleName, wallData, themeData };
        const builders = resolveBuilders(category);

        // ═══ Step 1.5: 카테고리별 pre-analysis (Claude) — 해당 모듈이 등록한 경우만 ═══
        let preAnalysis = null;
        let preAnalysisMeta = null;
        const pa = PRE_ANALYSIS[category];
        if (pa) {
          const preStart = Date.now();
          try {
            const analysisPrompt = pa.promptBuilder(ctx);
            const res = await callClaudeVision(env, {
              model: pa.model,
              prompt: analysisPrompt,
              image: room_image,
              imageType: image_type,
              maxTokens: 1200,
            });
            preAnalysis = extractJson(res.text);
            preAnalysisMeta = {
              model: pa.model,
              usage: res.usage,
              elapsed_ms: Date.now() - preStart,
              parsed: !!preAnalysis,
            };
            if (preAnalysis) {
              console.log(`[Generate] ${pa.model} pre-analysis OK (${preAnalysisMeta.elapsed_ms}ms, ${res.usage?.input_tokens || '?'}→${res.usage?.output_tokens || '?'} tokens)`);
            } else {
              console.warn(`[Generate] ${pa.model} pre-analysis returned non-JSON, proceeding without context`);
            }
          } catch (e) {
            console.warn(`[Generate] Pre-analysis failed (${pa.model}): ${e.message} — proceeding without context`);
            preAnalysisMeta = { model: pa.model, error: e.message, elapsed_ms: Date.now() - preStart, parsed: false };
          }
        }
        ctx.preAnalysis = preAnalysis;

        // ═══ Step 2: 가구 생성 (닫힌문) ═══
        const closedPrompt = builders.closed(ctx);
        const closedResult = await callGemini(env, closedPrompt, room_image, image_type);

        if (!closedResult.image) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to generate closed door image' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        console.log('[Generate] Closed door image generated');

        // ═══ Step 3: 대안 이미지 생성 ═══
        let altImage = null;
        let altMetadata = {};
        try {
          const altSpec = builders.alt(ctx);
          const inputImage = altSpec.inputKey === 'install' ? room_image : closedResult.image;
          const inputMime = altSpec.inputKey === 'install' ? image_type : 'image/png';
          const altResult = await callGemini(env, altSpec.prompt, inputImage, inputMime);
          altImage = altResult.image || null;
          altMetadata = altSpec.metadata || {};
          if (altImage) console.log(`[Generate] Alt image generated (${altMetadata.alt_style?.name || 'default'})`);
        } catch (e) {
          console.warn('[Generate] Alt image generation failed:', e.message);
        }

        // ═══ 응답 ═══
        const elapsed = Date.now() - startTime;
        console.log(`[Generate] Complete in ${elapsed}ms`);

        return new Response(JSON.stringify({
          success: true,
          generated_image: {
            background: room_image,
            closed: closedResult.image,
            open: altImage,
            alt: altImage,
          },
          wall_analysis: { wallW, wallH, waterPct, exhaustPct },
          alt_style: altMetadata.alt_style || null,
          metadata: {
            category, kitchen_layout, design_style,
            model: env.GEMINI_MODEL || 'gemini-2.5-flash-image',
            elapsed_ms: elapsed,
            pre_analysis: preAnalysisMeta,
            pre_analysis_data: preAnalysis,
            ...altMetadata,
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
