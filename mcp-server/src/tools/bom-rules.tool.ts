// ═══════════════════════════════════════════════════════════════
// BOM Rules Tool - 제작 규칙 조회/수정 MCP 도구
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import {
  getBomRules,
  saveBomRules,
  resetBomRules,
  loadBomRules,
  getBomRulesPath,
} from '../config/bom-rules.loader.js';
import type { BomRules } from '../config/bom-rules.defaults.js';

const inputSchema = z.object({
  operation: z.enum(['get', 'update', 'reset', 'reload']),
  section: z.string().optional(),
  updates: z.record(z.unknown()).optional(),
});

registerTool(
  {
    name: 'manage_bom_rules',
    description: '제작 규칙(bom-rules.json)을 조회, 수정, 초기화합니다. 자재 두께, 패널 공식, 하드웨어 설정 등을 관리합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['get', 'update', 'reset', 'reload'],
          description: 'get=조회, update=수정, reset=기본값 복원, reload=파일 다시 로드',
        },
        section: {
          type: 'string',
          description: '특정 섹션만 조회/수정 (materials, cabinet_defaults, construction, hardware, wardrobe 등)',
        },
        updates: {
          type: 'object',
          description: 'update 시 변경할 값 (해당 섹션의 키-값 쌍)',
        },
      },
      required: ['operation'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    const { operation, section, updates } = parsed.data;

    try {
      switch (operation) {
        case 'get': {
          const rules = getBomRules();
          if (section) {
            const sectionData = (rules as unknown as Record<string, unknown>)[section];
            if (!sectionData) {
              return mcpError(`Unknown section: ${section}. Available: materials, cabinet_defaults, construction, upper_cabinet, hardware, molding_clearance, wardrobe`);
            }
            return mcpSuccess({ section, data: sectionData, path: getBomRulesPath() });
          }
          return mcpSuccess({ rules, path: getBomRulesPath() });
        }

        case 'update': {
          if (!updates) {
            return mcpError('updates is required for update operation');
          }
          const rules = getBomRules();
          if (section) {
            const current = (rules as unknown as Record<string, unknown>)[section];
            if (!current || typeof current !== 'object') {
              return mcpError(`Unknown section: ${section}`);
            }
            (rules as unknown as Record<string, unknown>)[section] = { ...current as object, ...updates };
          } else {
            Object.assign(rules, updates);
          }
          saveBomRules(rules as BomRules);
          return mcpSuccess({ message: 'Rules updated', rules });
        }

        case 'reset': {
          const rules = resetBomRules();
          return mcpSuccess({ message: 'Rules reset to defaults', rules });
        }

        case 'reload': {
          const rules = loadBomRules();
          return mcpSuccess({ message: 'Rules reloaded from file', rules });
        }

        default:
          return mcpError(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      return mcpError(`Rules operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
