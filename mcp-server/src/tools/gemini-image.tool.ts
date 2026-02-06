// ═══════════════════════════════════════════════════════════════
// Gemini Image Generation Tool - MCP 도구 (얇은 핸들러)
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import {
  geminiImageGeneration,
  extractImageFromGeminiResponse,
  extractTextFromGeminiResponse,
} from '../clients/gemini.client.js';

const inputSchema = z.object({
  prompt: z.string(),
  reference_image: z.string().optional(),
  image_type: z.string().optional().default('image/jpeg'),
});

registerTool(
  {
    name: 'gemini_generate_image',
    description: 'Gemini로 포토리얼리스틱 가구 이미지를 생성합니다. 방 사진을 참조하여 맞춤형 가구 렌더링을 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '이미지 생성 프롬프트',
        },
        reference_image: {
          type: 'string',
          description: 'Base64 인코딩된 참조 이미지 (선택)',
        },
        image_type: {
          type: 'string',
          description: '참조 이미지 MIME 타입',
          default: 'image/jpeg',
        },
      },
      required: ['prompt'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    try {
      const { prompt, reference_image, image_type } = parsed.data;
      const response = await geminiImageGeneration(prompt, reference_image, image_type);

      const imageBase64 = extractImageFromGeminiResponse(response);
      const textResponse = extractTextFromGeminiResponse(response);

      if (!imageBase64) {
        return mcpError(JSON.stringify({
          success: false,
          error: 'No image generated',
          text_response: textResponse,
        }));
      }

      return mcpSuccess({
        success: true,
        image: { base64: imageBase64, mime_type: 'image/png' },
        text_response: textResponse,
      });
    } catch (error) {
      return mcpError(`Image generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
