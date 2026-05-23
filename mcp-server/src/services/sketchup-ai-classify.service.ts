// ═══════════════════════════════════════════════════════════════
// Phase 3b: Gemini Vision 기반 SketchUp entity 자동 분류
//
// SketchUp 활성 모델 PNG + entities 메타데이터 → Gemini Vision API →
// 각 entity 의 type/partId/colorKey 자동 추정.
//
// 비용: 호출당 ~$0.003 (Gemini Vision 1회, 가구 1개 ≈ 1회 호출)
// 응답 시간: 5-10초 (Gemini API + PNG 전송)
// ═══════════════════════════════════════════════════════════════

import { sendCommand } from './sketchup-mcp-bridge.service.js';
import { evalRubySafe } from './sketchup-builder.service.js';
import { geminiVisionAnalysis } from '../clients/gemini.client.js';
import { extractTextFromGeminiResponse } from '../clients/gemini.client.js';
import { createLogger } from '../utils/logger.js';
import type { SketchupEntityDump, EntitySuggestion, SuggestedPartType } from './sketchup-import.service.js';

const log = createLogger('sketchup-ai');

export interface CaptureSceneOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

/**
 * SketchUp active view 를 PNG 로 캡처. mhyrr eval_ruby (CAPTURE_VIEW_PNG) 호출.
 * 응답: base64 PNG (1280×720, opaque).
 */
export async function captureSketchupView(opts: CaptureSceneOptions = {}): Promise<{ ok: boolean; base64?: string; error?: string }> {
  const result = await sendCommand(evalRubySafe('CAPTURE_VIEW_PNG'), opts);
  if (!result.ok) {
    return { ok: false, error: result.error?.message ?? 'unknown error' };
  }
  const text = (result.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text;
  if (!text || text.length < 100) {
    return { ok: false, error: 'mhyrr response missing PNG base64 content' };
  }
  return { ok: true, base64: text.trim() };
}

/**
 * Phase 3b: SketchUp PNG + entities 메타데이터 → Gemini Vision API → AI suggestions.
 *
 * 응답: 각 entity 의 EntitySuggestion (type, confidence, partId, moduleType, colorKey).
 * AI 추정이 실패하거나 신뢰도 낮으면 fallback heuristic suggestion 으로 대체.
 */
export interface AiClassifyResult {
  ok: boolean;
  suggestions?: EntitySuggestion[];
  /** AI 모델 의 가구 카테고리 추정 (sink/wardrobe/...) */
  inferredCategory?: string;
  /** AI 응답 raw text (디버깅용) */
  rawResponse?: string;
  error?: string;
  /** Gemini 호출 소요 시간 (ms) */
  durationMs?: number;
}

export async function classifyEntitiesWithAi(
  sceneImageBase64: string,
  entities: SketchupEntityDump[],
): Promise<AiClassifyResult> {
  if (entities.length === 0) {
    return { ok: true, suggestions: [], inferredCategory: undefined };
  }

  const entitiesText = entities
    .map((e, i) => {
      const w = Math.round(e.bounds.max[0] - e.bounds.min[0]);
      const d = Math.round(e.bounds.max[1] - e.bounds.min[1]);
      const h = Math.round(e.bounds.max[2] - e.bounds.min[2]);
      const z = Math.round(e.bounds.min[2]);
      return `[${i}] id=${e.id} name="${e.name}" bbox(mm)=${w}x${d}x${h} z_min=${z}`;
    })
    .join('\n');

  const prompt = `You are analyzing a dadam furniture cabinet built in SketchUp. Classify each entity by its role.

GIVEN:
1. An image of the SketchUp scene (perspective view).
2. A list of entities (groups), each with bounding box (mm) and z-position from floor.

CLASSIFY each entity as ONE of these types:
- module-body: cabinet body (lower/upper storage, sink, cook, hood) - typical bbox 400-1000 x 300-650 x 600-900
- module-door: thin door panel (depth <= 25mm)
- toekick: bottom trim (horizontal, low z, height <= 200mm)
- molding-top: ceiling trim (horizontal, high z >= 2000mm, height <= 80mm)
- finish-side: side panel (vertical, width <= 80mm)
- countertop: counter slab (thin horizontal, height <= 20mm, z = 600-1500mm)
- utility: distributor/vent (small, height <= 100mm)
- unknown: cannot classify

ALSO INFER the cabinet category from image + entities: sink (kitchen with sink/cook), wardrobe (full-height closet), vanity (bathroom), shoe (entrance), fridge (refrigerator nook), storage (generic).

Entities:
${entitiesText}

Return ONLY a JSON object (no markdown, no explanation):
{
  "inferredCategory": "sink" | "wardrobe" | "vanity" | "shoe" | "fridge" | "storage",
  "categoryConfidence": 0.0-1.0,
  "entities": [
    {
      "index": 0,
      "type": "module-body" | "module-door" | "toekick" | "molding-top" | "finish-side" | "countertop" | "utility" | "unknown",
      "partId": "string (e.g. lower-body-1, toekick, molding-top, finish-left-lower, utility-distributor, countertop)",
      "moduleType": "storage" | "sink" | "cook" | "hood" | "drawer" | null,
      "colorKey": "body" | "accent" | "shadow" | "trim",
      "confidence": 0.0-1.0
    }
  ]
}`;

  const start = Date.now();
  try {
    const response = await geminiVisionAnalysis(sceneImageBase64, 'image/png', prompt);
    const durationMs = Date.now() - start;

    const text = extractTextFromGeminiResponse(response);
    if (!text) {
      return { ok: false, error: 'Gemini response empty', durationMs };
    }

    // markdown code fence 제거 + JSON parse
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    let parsed: {
      inferredCategory?: string;
      categoryConfidence?: number;
      entities?: Array<{
        index: number;
        type: SuggestedPartType;
        partId: string;
        moduleType?: string | null;
        colorKey: 'body' | 'accent' | 'shadow' | 'trim';
        confidence: number;
      }>;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        ok: false,
        error: `Gemini response JSON parse failed: ${e instanceof Error ? e.message : e}`,
        rawResponse: text,
        durationMs,
      };
    }

    if (!parsed.entities || !Array.isArray(parsed.entities)) {
      return { ok: false, error: 'Gemini response missing entities array', rawResponse: text, durationMs };
    }

    // AI 응답 → EntitySuggestion[] (index 순서 보존)
    const suggestions: EntitySuggestion[] = entities.map((_, i) => {
      const ai = parsed.entities!.find((e) => e.index === i);
      if (!ai) {
        return {
          type: 'unknown' as SuggestedPartType,
          confidence: 0,
          suggestedPartId: 'unknown',
          suggestedColorKey: 'body',
        };
      }
      return {
        type: ai.type,
        confidence: ai.confidence,
        suggestedPartId: ai.partId,
        suggestedModuleType: (ai.moduleType ?? undefined) as any,
        suggestedColorKey: ai.colorKey,
      };
    });

    log.info(
      {
        entityCount: entities.length,
        inferredCategory: parsed.inferredCategory,
        durationMs,
        avgConfidence: suggestions.reduce((s, x) => s + x.confidence, 0) / suggestions.length,
      },
      'Gemini Vision classification complete',
    );

    return {
      ok: true,
      suggestions,
      inferredCategory: parsed.inferredCategory,
      durationMs,
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs,
    };
  }
}
