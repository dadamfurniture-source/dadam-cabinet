// ═══════════════════════════════════════════════════════════════
// API Client - Supabase 및 Gemini API 호출
// ═══════════════════════════════════════════════════════════════

import { getConfig } from './config.js';
import type {
  GeminiRequest,
  GeminiResponse,
  RagSearchParams,
  DesignRule
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────
// Supabase API Client
// ─────────────────────────────────────────────────────────────────

export async function supabaseRpc<T>(
  functionName: string,
  params: Record<string, unknown>
): Promise<T> {
  const config = getConfig();

  const response = await fetch(
    `${config.supabase.url}/rest/v1/rpc/${functionName}`,
    {
      method: 'POST',
      headers: {
        'apikey': config.supabase.anonKey,
        'Authorization': `Bearer ${config.supabase.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(config.supabase.timeout),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase RPC error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export async function searchRagRules(params: RagSearchParams): Promise<DesignRule[]> {
  return supabaseRpc<DesignRule[]>('quick_trigger_search', params as unknown as Record<string, unknown>);
}

// ─────────────────────────────────────────────────────────────────
// Gemini API Client
// ─────────────────────────────────────────────────────────────────

export async function geminiGenerate(
  model: string,
  request: GeminiRequest
): Promise<GeminiResponse> {
  const config = getConfig();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.gemini.timeout),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<GeminiResponse>;
}

export async function geminiVisionAnalysis(
  image: string,
  imageType: string,
  prompt: string
): Promise<GeminiResponse> {
  const config = getConfig();

  const request: GeminiRequest = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: imageType,
            data: image,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  return geminiGenerate(config.gemini.models.vision, request);
}

export async function geminiImageGeneration(
  prompt: string,
  referenceImage?: string,
  imageType?: string
): Promise<GeminiResponse> {
  const config = getConfig();

  const parts: GeminiRequest['contents'][0]['parts'] = [];

  // 참조 이미지가 있으면 먼저 추가
  if (referenceImage && imageType) {
    parts.push({
      inline_data: {
        mime_type: imageType,
        data: referenceImage,
      },
    });
  }

  parts.push({ text: prompt });

  const request: GeminiRequest = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['image', 'text'],
      temperature: 0.4,
    },
  };

  return geminiGenerate(config.gemini.models.imagePreview, request);
}

// ─────────────────────────────────────────────────────────────────
// Response Parsing Helpers
// ─────────────────────────────────────────────────────────────────

export function extractTextFromGeminiResponse(response: GeminiResponse): string | null {
  try {
    const candidates = response.candidates || [];
    if (candidates.length === 0) return null;

    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        return part.text;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function extractImageFromGeminiResponse(response: GeminiResponse): string | null {
  try {
    const candidates = response.candidates || [];
    if (candidates.length === 0) return null;

    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      const inlineData = part.inline_data || part.inlineData;
      if (inlineData?.data) {
        return inlineData.data;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function extractJsonFromText(text: string): Record<string, unknown> | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Gemini Chat (Text-only)
// ─────────────────────────────────────────────────────────────────

export async function geminiChat(
  message: string,
  systemPrompt?: string
): Promise<GeminiResponse> {
  const config = getConfig();

  const parts: GeminiRequest['contents'][0]['parts'] = [];

  if (systemPrompt) {
    parts.push({ text: systemPrompt });
  }
  parts.push({ text: message });

  const request: GeminiRequest = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  return geminiGenerate(config.gemini.models.vision, request);
}
