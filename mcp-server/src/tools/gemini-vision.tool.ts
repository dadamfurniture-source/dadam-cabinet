// ═══════════════════════════════════════════════════════════════
// Gemini Vision Tool - MCP 도구 (얇은 핸들러)
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { analyzeWall } from '../services/wall-analysis.service.js';

const inputSchema = z.object({
  image: z.string(),
  image_type: z.string().optional().default('image/jpeg'),
  use_reference_images: z.boolean().optional().default(true),
  reference_categories: z.array(z.string()).optional().default(['water_pipe', 'exhaust_duct', 'gas_pipe']),
});

registerTool(
  {
    name: 'gemini_wall_analysis',
    description: 'Gemini Vision으로 방 사진의 벽 구조를 분석합니다. 타일 기반 벽 치수 계산, 급수/배기/가스 배관 위치를 감지합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Base64 인코딩된 이미지 데이터',
        },
        image_type: {
          type: 'string',
          description: 'MIME 타입 (예: image/jpeg, image/png)',
          default: 'image/jpeg',
        },
        use_reference_images: {
          type: 'boolean',
          description: '참조 이미지 사용 여부 (Few-Shot Learning)',
          default: true,
        },
        reference_categories: {
          type: 'array',
          items: { type: 'string' },
          description: '사용할 참조 카테고리',
          default: ['water_pipe', 'exhaust_duct', 'gas_pipe'],
        },
      },
      required: ['image'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    try {
      const { image, image_type, use_reference_images, reference_categories } = parsed.data;

      const wallData = await analyzeWall({
        image,
        imageType: image_type,
        useReferenceImages: use_reference_images,
        referenceCategories: reference_categories as any,
      });

      return mcpSuccess({
        success: true,
        wall_data: wallData,
      });
    } catch (error) {
      return mcpError(`Wall analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
