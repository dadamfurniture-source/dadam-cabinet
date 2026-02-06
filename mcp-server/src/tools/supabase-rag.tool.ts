// ═══════════════════════════════════════════════════════════════
// Supabase RAG Search Tool - MCP 도구 (얇은 핸들러)
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';

const inputSchema = z.object({
  triggers: z.array(z.string()),
  category: z.enum(['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage']),
  limit: z.number().optional().default(25),
});

registerTool(
  {
    name: 'supabase_rag_search',
    description: 'Supabase에서 다담AI 설계 규칙을 RAG 검색합니다. 카테고리별 모듈, 도어, 자재, 배경 처리 규칙을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: '검색할 트리거 키워드 배열 (예: ["상부장", "하부장", "도어규격"])',
        },
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리',
        },
        limit: {
          type: 'number',
          description: '반환할 최대 결과 수 (기본값: 25)',
          default: 25,
        },
      },
      required: ['triggers', 'category'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    try {
      const { triggers, category } = parsed.data;
      const result = await searchAndClassifyRules(category, triggers.join(' '));

      return mcpSuccess({
        success: true,
        total_count: result.rules.length,
        category,
        rules: result.classified,
      });
    } catch (error) {
      return mcpError(`RAG search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
