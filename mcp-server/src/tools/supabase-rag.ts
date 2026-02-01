// ═══════════════════════════════════════════════════════════════
// Supabase RAG Search Tool - 설계 규칙 검색
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { searchRagRules } from '../utils/api-client.js';
import type { DesignRule, RuleType } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────

export const supabaseRagTool = {
  name: 'supabase_rag_search',
  description: 'Supabase에서 다담AI 설계 규칙을 RAG 검색합니다. 카테고리별 모듈, 도어, 자재, 배경 처리 규칙을 반환합니다.',
  inputSchema: {
    type: 'object' as const,
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
};

// ─────────────────────────────────────────────────────────────────
// Input Validation Schema
// ─────────────────────────────────────────────────────────────────

const inputSchema = z.object({
  triggers: z.array(z.string()),
  category: z.enum(['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage']),
  limit: z.number().optional().default(25),
});

// ─────────────────────────────────────────────────────────────────
// Tool Handler
// ─────────────────────────────────────────────────────────────────

export async function handleSupabaseRag(args: unknown) {
  // 입력 검증
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { triggers, category, limit } = parsed.data;

  try {
    // Supabase RPC 호출
    const rules = await searchRagRules({
      query_triggers: triggers,
      filter_category: category,
      limit_count: limit,
    });

    // 규칙 분류
    const classified = classifyRules(rules);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            total_count: rules.length,
            category,
            rules: classified,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `RAG search failed: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

interface ClassifiedRules {
  background: string[];
  modules: string[];
  doors: string[];
  materials: DesignRule[];
  materialKeywords: DesignRule[];
}

function classifyRules(rules: DesignRule[]): ClassifiedRules {
  const classified: ClassifiedRules = {
    background: [],
    modules: [],
    doors: [],
    materials: [],
    materialKeywords: [],
  };

  for (const rule of rules) {
    const ruleType: RuleType = rule.rule_type || rule.chunk_type || 'module';

    switch (ruleType) {
      case 'background':
        classified.background.push(`- ${rule.content}`);
        break;
      case 'module':
        const modulePrefix = rule.triggers?.[0] || '';
        classified.modules.push(`- ${modulePrefix}: ${rule.content}`);
        break;
      case 'door':
        const doorPrefix = rule.triggers?.[0] || '';
        classified.doors.push(`- ${doorPrefix}: ${rule.content}`);
        break;
      case 'material':
        classified.materials.push(rule);
        break;
      case 'material_keyword':
        classified.materialKeywords.push(rule);
        break;
    }
  }

  // 기본 배경 규칙 추가
  if (classified.background.length === 0) {
    classified.background.push('- Clean, bright walls with smooth finished surface');
    classified.background.push('- Natural light coming into the space');
    classified.background.push('- Modern minimal interior design');
  }

  return classified;
}
