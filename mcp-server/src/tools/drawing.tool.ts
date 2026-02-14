// ═══════════════════════════════════════════════════════════════
// Drawing Tool - 2D 도면 좌표 생성 MCP 도구
// StructuredDesignData → DrawingData (좌표 JSON)
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';
import { analyzeWall } from '../services/wall-analysis.service.js';
import { extractDesignData } from '../services/design-data.service.js';
import { generateBom } from '../services/bom.service.js';
import { generateDrawingData } from '../services/drawing.service.js';
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
  include_views: z.boolean().optional().default(true),
  include_manufacturing: z.boolean().optional().default(true),
  include_installation: z.boolean().optional().default(true),
});

registerTool(
  {
    name: 'generate_drawing',
    description: '설계 데이터에서 2D 도면 좌표를 생성합니다. 정면도/단면도/평면도 공통 뷰와 제작/설치 서브 레이아웃을 포함합니다.',
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
        include_views: {
          type: 'boolean',
          description: '공통 뷰(정면/단면/평면) 포함 여부 (기본값: true)',
        },
        include_manufacturing: {
          type: 'boolean',
          description: '제작 서브 레이아웃 포함 여부 (기본값: true)',
        },
        include_installation: {
          type: 'boolean',
          description: '설치 서브 레이아웃 포함 여부 (기본값: true)',
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
      const {
        category, style, room_image, image_type,
        cabinet_specs, modules,
        include_views, include_manufacturing, include_installation,
      } = parsed.data;

      // 1. 벽 분석
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

      // 4. BOM 생성
      const bom = generateBom(designData);

      // 5. 도면 좌표 생성
      const drawing = generateDrawingData(designData, bom, {
        include_views,
        include_manufacturing,
        include_installation,
      });

      return mcpSuccess({
        success: true,
        drawing,
        design_data: designData,
        bom_summary: bom.summary,
      });
    } catch (error) {
      return mcpError(`Drawing generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
