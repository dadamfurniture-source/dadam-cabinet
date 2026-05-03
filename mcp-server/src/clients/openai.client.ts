// ═══════════════════════════════════════════════════════════════
// OpenAI Client - GPT Image 2 PoC 전용 (gemini.client.ts 미러링)
//
// 본 파일은 GPT Image 2 마이그레이션 PoC 단계에서만 사용됨.
// 프로덕션 채택이 결정되면 image-generation.service.ts를 분기시키거나
// gemini.client.ts와 통합 추상화를 도입할 예정.
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';

const log = createLogger('openai-client');

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAIImageGenerationOptions {
  size?: '1024x1024' | '1024x1536' | '1536x1024' | '2048x2048' | '4096x4096' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  n?: number;
}

export interface OpenAIImageResponse {
  created: number;
  data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
    output_tokens?: number;
    total_tokens?: number;
  };
}

export async function openaiImageGeneration(
  prompt: string,
  options: OpenAIImageGenerationOptions = {}
): Promise<OpenAIImageResponse> {
  const config = getConfig();
  const url = `${OPENAI_BASE_URL}/images/generations`;

  log.debug({ model: config.openai.models.imageGeneration, size: options.size }, 'Calling OpenAI image generation');

  const body = {
    model: config.openai.models.imageGeneration,
    prompt,
    size: options.size || '1024x1024',
    quality: options.quality || 'auto',
    n: options.n || 1,
  };

  const response = await fetchWithRetry('openai', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: config.openai.timeout,
  });

  return response.json() as Promise<OpenAIImageResponse>;
}

export async function openaiImageEdit(
  prompt: string,
  referenceImageBase64: string,
  mimeType: string,
  options: OpenAIImageGenerationOptions = {}
): Promise<OpenAIImageResponse> {
  const config = getConfig();
  const url = `${OPENAI_BASE_URL}/images/edits`;

  log.debug({ model: config.openai.models.imageGeneration, size: options.size }, 'Calling OpenAI image edit');

  const form = new FormData();
  form.append('model', config.openai.models.imageGeneration);
  form.append('prompt', prompt);
  form.append('size', options.size || '1024x1024');
  form.append('quality', options.quality || 'auto');
  form.append('n', String(options.n || 1));

  const binary = Buffer.from(referenceImageBase64, 'base64');
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const blob = new Blob([binary], { type: mimeType });
  form.append('image', blob, `reference.${ext}`);

  const response = await fetchWithRetry('openai', url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: form,
    timeout: config.openai.timeout,
  });

  return response.json() as Promise<OpenAIImageResponse>;
}

export function extractImageFromOpenAiResponse(response: OpenAIImageResponse): string | null {
  const first = response.data?.[0];
  return first?.b64_json || null;
}
