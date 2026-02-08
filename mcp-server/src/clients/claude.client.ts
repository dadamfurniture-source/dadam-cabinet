// ═══════════════════════════════════════════════════════════════
// Claude Client - Anthropic Claude API 클라이언트
// n8n v8과 동일한 벽면 분석 기능 제공
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';

const log = createLogger('claude-client');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_API_VERSION = '2023-06-01';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContentBlock[];
}

export interface ClaudeContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('Missing required environment variable: ANTHROPIC_API_KEY');
  }
  return key;
}

export async function claudeVisionAnalysis(
  image: string,
  imageType: string,
  prompt: string,
  systemPrompt?: string
): Promise<ClaudeResponse> {
  const apiKey = getApiKey();

  const request: ClaudeRequest = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageType,
              data: image,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  };

  if (systemPrompt) {
    request.system = systemPrompt;
  }

  log.debug({ model: CLAUDE_MODEL }, 'Calling Claude API for vision analysis');

  const response = await fetchWithRetry('claude', CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    body: JSON.stringify(request),
    timeout: 120000,
  });

  return response.json() as Promise<ClaudeResponse>;
}

export async function claudeMultiImageAnalysis(
  images: Array<{ data: string; mime_type: string }>,
  prompt: string,
  systemPrompt?: string
): Promise<ClaudeResponse> {
  const apiKey = getApiKey();

  const contentBlocks: ClaudeContentBlock[] = [];

  for (const img of images) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mime_type,
        data: img.data,
      },
    });
  }

  contentBlocks.push({
    type: 'text',
    text: prompt,
  });

  const request: ClaudeRequest = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: contentBlocks,
      },
    ],
  };

  if (systemPrompt) {
    request.system = systemPrompt;
  }

  log.debug({ model: CLAUDE_MODEL, imageCount: images.length }, 'Calling Claude API for multi-image analysis');

  const response = await fetchWithRetry('claude', CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    body: JSON.stringify(request),
    timeout: 120000,
  });

  return response.json() as Promise<ClaudeResponse>;
}

export function extractTextFromClaudeResponse(response: ClaudeResponse): string | null {
  try {
    const content = response.content || [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        return block.text;
      }
    }
    return null;
  } catch {
    return null;
  }
}
