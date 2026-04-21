/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 *
 * 카테고리 무관 인프라(callGemini, CORS, fetch handler 골격) + 얇은 dispatcher 만 담당.
 * 카테고리별 프롬프트는 ./prompts/{category}-prompt.js 에 격리되어 있어
 * 한 카테고리 수정이 다른 카테고리로 새는 사고를 원천 차단한다.
 *
 * 파이프라인:
 *   Step 1   Gemini Vision  — 벽 분석 (모든 카테고리 공통, 카테고리별 보정 applyWallWidthCorrection)
 *   Step 1.5 Claude          — 카테고리 pre-analysis (냉장고장만 Opus 4.7)
 *   Step 1b  Gemini Image   — 냉장고장 철거 (냉장고장만)
 *   Step 2   Gemini Image   — 닫힌 도어 (카테고리별 모듈)
 *   Step 3   Gemini Image   — 대안 이미지 (카테고리별 모듈 — sink=투톤/fridge=홈바/나머지=열린문)
 */

import { buildWallAnalysisPrompt, applyWallWidthCorrection } from './prompts/wall-analysis.js';
import { SINK_CATEGORIES, buildSinkClosedPrompt, buildSinkAltSpec, buildSinkQuote } from './prompts/sink-prompt.js';
import { WARDROBE_CATEGORIES, WARDROBE_ANALYSIS_MODEL, buildWardrobeClosedPrompt, buildWardrobeStructureAnalysisPrompt, buildWardrobeAltSpec, buildWardrobeQuote } from './prompts/wardrobe-prompt.js';
import { SHOE_CATEGORIES, buildShoeClosedPrompt, buildShoeAltSpec, buildShoeQuote } from './prompts/shoe-prompt.js';
import {
  FRIDGE_CATEGORIES,
  FRIDGE_ANALYSIS_MODEL,
  buildFridgeAnalysisPrompt,
  buildFridgeDemolitionPrompt,
  buildFridgeClosedPrompt,
  buildFridgeAltSpec,
  buildFridgeQuote,
} from './prompts/fridge-prompt.js';
import { VANITY_CATEGORIES, buildVanityClosedPrompt, buildVanityAltSpec, buildVanityQuote } from './prompts/vanity-prompt.js';
import { buildStorageClosedPrompt, buildStorageAltSpec, buildStorageQuote } from './prompts/storage-prompt.js';
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
const CLOSED_BUILDERS = {};
const ALT_BUILDERS = {};
// 카테고리별 견적 빌더. 모든 카테고리가 견적을 가지도록 각자 `build{Cat}Quote(wallW)` 등록.
// 매치 실패 시 buildStorageQuote fallback.
const QUOTE_BUILDERS = {};
// Pre-analysis (Step 1.5) — Claude reads the original room photo BEFORE Step 2.
const PRE_ANALYSIS = {}; // { [category]: { model, promptBuilder } }
// Structure analysis (Step 2.5) — Claude reads the Step 2 CLOSED image AFTER it's
// generated, BEFORE Step 3. Lets Step 3 open exactly the doors that were rendered.
const STRUCTURE_ANALYSIS = {}; // { [category]: { model, promptBuilder } }
function register(categories, closedBuilder, altBuilder, opts = {}) {
  for (const c of categories) {
    CLOSED_BUILDERS[c] = closedBuilder;
    ALT_BUILDERS[c] = altBuilder;
    if (opts.quoteBuilder) {
      QUOTE_BUILDERS[c] = opts.quoteBuilder;
    }
    if (opts.analysisModel && opts.analysisPromptBuilder) {
      PRE_ANALYSIS[c] = { model: opts.analysisModel, promptBuilder: opts.analysisPromptBuilder };
    }
    if (opts.structureModel && opts.structurePromptBuilder) {
      STRUCTURE_ANALYSIS[c] = { model: opts.structureModel, promptBuilder: opts.structurePromptBuilder };
    }
  }
}
register(SINK_CATEGORIES, buildSinkClosedPrompt, buildSinkAltSpec, { quoteBuilder: buildSinkQuote });
register(WARDROBE_CATEGORIES, buildWardrobeClosedPrompt, buildWardrobeAltSpec, {
  structureModel: WARDROBE_ANALYSIS_MODEL,
  structurePromptBuilder: buildWardrobeStructureAnalysisPrompt,
  quoteBuilder: buildWardrobeQuote,
});
register(SHOE_CATEGORIES, buildShoeClosedPrompt, buildShoeAltSpec, { quoteBuilder: buildShoeQuote });
register(FRIDGE_CATEGORIES, buildFridgeClosedPrompt, buildFridgeAltSpec, {
  analysisModel: FRIDGE_ANALYSIS_MODEL,
  analysisPromptBuilder: buildFridgeAnalysisPrompt,
  quoteBuilder: buildFridgeQuote,
});
register(VANITY_CATEGORIES, buildVanityClosedPrompt, buildVanityAltSpec, { quoteBuilder: buildVanityQuote });

function resolveBuilders(category) {
  return {
    closed: CLOSED_BUILDERS[category] || buildStorageClosedPrompt,
    alt: ALT_BUILDERS[category] || buildStorageAltSpec,
  };
}

function resolveQuoteBuilder(category) {
  return QUOTE_BUILDERS[category] || buildStorageQuote;
}

// ─── Gemini API 호출 ───
// AI_GATEWAY_BASE 가 설정되어 있으면 Cloudflare AI Gateway 경유 (geo-restriction 우회, US egress).
// 없으면 Google 원본 엔드포인트 직접 호출 (fallback).
// 카테고리별 모델 분기: 싱크대는 env.GEMINI_MODEL_SINK (기본 2.5), 그 외는 env.GEMINI_MODEL (기본 3.1).
// 싱크대 2D 투톤 렌더는 2.5 에서 색/레이아웃 안정성이 검증된 반면, 3.1 은 아직 회귀 리스크가 있어 분리.
function resolveGeminiModel(env, category) {
  if (category && SINK_CATEGORIES.includes(category)) {
    return env.GEMINI_MODEL_SINK || 'gemini-2.5-flash-image';
  }
  return env.GEMINI_MODEL || 'gemini-2.5-flash-image';
}

async function callGemini(env, prompt, image, imageType, responseModalities = ['IMAGE', 'TEXT'], temperature = 0.4, extraImages = [], modelOverride) {
  const model = modelOverride || env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const base = env.AI_GATEWAY_BASE
    ? `${env.AI_GATEWAY_BASE.replace(/\/$/, '')}/google-ai-studio/v1beta`
    : 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const parts = [];
  if (image && imageType) {
    parts.push({ inlineData: { mimeType: imageType, data: image } });
  }
  for (const ref of extraImages || []) {
    if (ref && ref.base64 && ref.mimeType) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
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

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'dadam-generate-api', worker: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

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
          vanity_options,
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
        // 카테고리별 Gemini 모델 결정 (싱크대=2.5, 기타=3.1). 이 핸들러의 모든 callGemini 호출에 재사용.
        const geminiModel = resolveGeminiModel(env, category);
        console.log(`[Generate] category=${category}, style=${design_style}, layout=${kitchen_layout}, gemini=${geminiModel}`);

        // ═══ Step 1: 벽면 분석 ═══
        let wallW = 3000, wallH = 2400, waterPct = 30, exhaustPct = 70;
        const manualW = Number(wall_width_override);

        if (manualW >= 1000 && manualW <= 6000) {
          wallW = manualW;
          console.log(`[Generate] Wall width from user override: ${wallW}mm`);
        } else {
          try {
            const wallResult = await callGemini(env, buildWallAnalysisPrompt(category), room_image, image_type, ['TEXT'], 0.2, [], geminiModel);

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
        const isFridge = FRIDGE_CATEGORIES.includes(category);
        const fridgeOptsForPrompt = isFridge
          ? { ...(fridge_options || {}), referenceCount: refImages.length }
          : fridge_options;
        const ctx = {
          category, kitchenLayout: kitchen_layout, design_style, styleName,
          wallData, themeData,
          fridgeOpts: fridgeOptsForPrompt,
          vanityOpts: vanity_options,
        };
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

        // ═══ Step 1b: 냉장고장 전용 — 기존 구조 철거 ═══
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
              [],
              geminiModel,
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
        ctx.siteAlreadyCleared = demoSucceeded;

        // ═══ Step 2: 가구 생성 (닫힌문) ═══
        const closedPrompt = builders.closed(ctx);
        const closedResult = await callGemini(env, closedPrompt, installBaseImage, installMime, undefined, undefined, refImages, geminiModel);

        if (!closedResult.image) {
          return new Response(JSON.stringify({ success: false, error: 'Failed to generate closed door image' }), {
            status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        console.log('[Generate] Closed door image generated');

        // ═══ Step 2.5: 닫힌 이미지 구조 분석 (Claude) — 해당 모듈이 등록한 경우만 ═══
        let structureAnalysis = null;
        let structureAnalysisMeta = null;
        const sa = STRUCTURE_ANALYSIS[category];
        if (sa) {
          const saStart = Date.now();
          try {
            const saPrompt = sa.promptBuilder(ctx);
            const saRes = await callClaudeVision(env, {
              model: sa.model,
              prompt: saPrompt,
              image: closedResult.image,
              imageType: 'image/png',
              maxTokens: 1200,
            });
            structureAnalysis = extractJson(saRes.text);
            structureAnalysisMeta = {
              model: sa.model,
              usage: saRes.usage,
              elapsed_ms: Date.now() - saStart,
              parsed: !!structureAnalysis,
            };
            if (structureAnalysis) {
              console.log(`[Generate] ${sa.model} structure-analysis OK (${structureAnalysisMeta.elapsed_ms}ms, doors=${structureAnalysis.door_count || '?'})`);
            } else {
              console.warn(`[Generate] ${sa.model} structure-analysis returned non-JSON, Step 3 proceeds without it`);
            }
          } catch (e) {
            console.warn(`[Generate] Structure-analysis failed (${sa.model}): ${e.message} — Step 3 proceeds without it`);
            structureAnalysisMeta = { model: sa.model, error: e.message, elapsed_ms: Date.now() - saStart, parsed: false };
          }
        }
        ctx.structureAnalysis = structureAnalysis;

        // ═══ Step 3: 대안 이미지 (카테고리별) ═══
        let altImage = null;
        let altMetadata = {};
        try {
          const altSpec = builders.alt({ ...ctx, closedImage: closedResult.image });
          const inputImage = altSpec.inputKey === 'install' ? installBaseImage : closedResult.image;
          const inputMime = altSpec.inputKey === 'install' ? installMime : 'image/png';
          const extraRefs = altSpec.inputKey === 'install' ? refImages : [];
          const altResult = await callGemini(env, altSpec.prompt, inputImage, inputMime, undefined, undefined, extraRefs, geminiModel);
          altImage = altResult.image || null;
          altMetadata = altSpec.metadata || {};
          if (altImage) console.log(`[Generate] Alt image generated (${altMetadata.alt_style?.name || 'default'})`);
        } catch (e) {
          console.warn('[Generate] Alt image generation failed:', e.message);
        }

        // ═══ 견적 (전 카테고리) ═══
        // 각 카테고리 프롬프트 모듈이 자체 buildXxxQuote(wallW) 를 등록. 매치 실패 시 buildStorageQuote fallback.
        const quoteBuilder = resolveQuoteBuilder(category);
        let quote = null;
        try {
          quote = quoteBuilder(wallW);
          if (quote) console.log(`[Generate] Quote(${category}) total: ${quote.total.toLocaleString()}원`);
        } catch (e) {
          console.warn(`[Generate] Quote build failed for ${category}: ${e.message}`);
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
        if (isFridge) generatedImage.demolished = demolishedImage;

        return new Response(JSON.stringify({
          success: true,
          generated_image: generatedImage,
          quote,
          wall_analysis: { wallW, wallH, waterPct, exhaustPct },
          alt_style: altMetadata.alt_style || null,
          metadata: {
            category, kitchen_layout, design_style,
            model: geminiModel,
            elapsed_ms: elapsed,
            pre_analysis: preAnalysisMeta,
            pre_analysis_data: preAnalysis,
            structure_analysis: structureAnalysisMeta,
            structure_analysis_data: structureAnalysis,
            fridge_demolition: isFridge ? { attempted: true, succeeded: demoSucceeded } : undefined,
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

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
