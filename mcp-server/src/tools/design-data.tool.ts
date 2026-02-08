// ═══════════════════════════════════════════════════════════════
// Design Data Tool - 구조화된 설계 데이터 추출 MCP 도구
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';
import { analyzeWall } from '../services/wall-analysis.service.js';
import { extractDesignData } from '../services/design-data.service.js';
import { getDefaultWallData } from '../services/furniture-placement.service.js';
import type { Category, CabinetSpecs, ModulesData } from '../types/index.js';

const categoryEnum = z.enum(['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage']);

const inputSchema = z.object({
  category: categoryEnum,
  style: z.string().default('modern'),
  room_image: z.string().optional(),
  image_type: z.string().optional().default('image/jpeg'),
  cabinet_specs: z.record(z.unknown()).optional(),
  modules: z.record(z.unknown()).optional(),
});

registerTool(
  {
    name: 'extract_design_data',
    description: '벽면 분석 결과와 RAG 규칙을 결합하여 구조화된 설계 데이터(JSON)를 추출합니다. 캐비닛 구성, 모듈 배치, 자재 정보 등을 포함합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리',
        },
        style: {
          type: 'string',
          description: '디자인 스타일 (기본값: modern)',
        },
        room_image: {
          type: 'string',
          description: 'Base64 인코딩된 방 사진 (선택사항 - 없으면 기본 벽 데이터 사용)',
        },
        image_type: {
          type: 'string',
          description: 'MIME 타입 (기본값: image/jpeg)',
        },
        cabinet_specs: {
          type: 'object',
          description: '캐비닛 사양 (총 너비, 높이, 깊이, 색상 등)',
        },
        modules: {
          type: 'object',
          description: '모듈 구성 데이터 (상부/하부 모듈 배열)',
        },
      },
      required: ['category'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    try {
      const { category, style, room_image, image_type, cabinet_specs, modules } = parsed.data;

      // 1. 벽 분석 (이미지 있으면 분석, 없으면 기본값)
      let wallData;
      if (room_image) {
        wallData = await analyzeWall({ image: room_image, imageType: image_type });
      } else {
        wallData = getDefaultWallData();
      }

      // 2. RAG 규칙 검색
      const ragResult = await searchAndClassifyRules(category, style);

      // 3. 설계 데이터 추출
      const designData = extractDesignData({
        category: category as Category,
        style,
        wallData,
        classified: ragResult.classified,
        cabinetSpecs: cabinet_specs as CabinetSpecs | undefined,
        modules: modules as ModulesData | undefined,
      });

      return mcpSuccess({
        success: true,
        design_data: designData,
        rag_rules_count: ragResult.rules.length,
      });
    } catch (error) {
      return mcpError(`Design data extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
