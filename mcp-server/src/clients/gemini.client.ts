// ═══════════════════════════════════════════════════════════════
// Gemini Client - Gemini API 전용 클라이언트
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';
import type {
  GeminiRequest,
  GeminiResponse,
  GeminiPart,
  ImageInput,
} from '../types/index.js';

const log = createLogger('gemini-client');

function getGeminiUrl(model: string): string {
  const config = getConfig();
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;
}

export async function geminiGenerate(
  model: string,
  request: GeminiRequest
): Promise<GeminiResponse> {
  const config = getConfig();
  const url = getGeminiUrl(model);

  log.debug({ model }, 'Calling Gemini API');

  const response = await fetchWithRetry('gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeout: config.gemini.timeout,
  });

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

export async function geminiMultiImageAnalysis(
  images: ImageInput[],
  prompt: string
): Promise<GeminiResponse> {
  const config = getConfig();

  const parts: GeminiPart[] = images.map(img => ({
    inline_data: {
      mime_type: img.mime_type,
      data: img.data,
    },
  }));

  parts.push({ text: prompt });

  const request: GeminiRequest = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
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

// Response parsing helpers
export function extractTextFromGeminiResponse(response: GeminiResponse): string | null {
  try {
    const candidates = response.candidates || [];
    if (candidates.length === 0) return null;

    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.text) return part.text;
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
      if (inlineData?.data) return inlineData.data;
    }
    return null;
  } catch {
    return null;
  }
}
