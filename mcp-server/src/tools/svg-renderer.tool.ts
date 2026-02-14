// ═══════════════════════════════════════════════════════════════
// SVG Renderer Tool - DrawingData → SVG 변환 MCP 도구
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { searchAndClassifyRules } from '../services/rag-search.service.js';
import { analyzeWall } from '../services/wall-analysis.service.js';
import { extractDesignData } from '../services/design-data.service.js';
import { generateBom } from '../services/bom.service.js';
import { generateDrawingData } from '../services/drawing.service.js';
import { renderDrawingToSvg } from '../services/svg-renderer.service.js';
import { getDefaultWallData } from '../services/furniture-placement.service.js';
import type { Category, CabinetSpecs, ModulesData } from '../types/index.js';

const categoryEnum = z.enum(['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage']);
const viewEnum = z.enum(['front', 'side', 'plan', 'manufacturing', 'installation']);

const inputSchema = z.object({
  category: categoryEnum,
  style: z.string().default('modern'),
  room_image: z.string().optional(),
  image_type: z.string().optional().default('image/jpeg'),
  cabinet_specs: z.record(z.unknown()).optional(),
  modules: z.record(z.unknown()).optional(),
  views: z.array(viewEnum).optional(),
  scale: z.number().min(0.1).max(2).optional().default(0.5),
});

registerTool(
  {
    name: 'render_drawing_svg',
    description: '설계 데이터에서 2D 도면 SVG를 생성합니다. 정면도/단면도/평면도/제작/설치 뷰를 SVG 문자열로 반환합니다.',
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
          description: 'Base64 인코딩된 방 사진 (선택사항)',
        },
        image_type: {
          type: 'string',
          description: 'MIME 타입 (기본값: image/jpeg)',
        },
        cabinet_specs: {
          type: 'object',
          description: '캐비닛 사양',
        },
        modules: {
          type: 'object',
          description: '모듈 구성 데이터',
        },
        views: {
          type: 'array',
          description: '렌더링할 뷰 목록 (기본값: 전체). front, side, plan, manufacturing, installation',
        },
        scale: {
          type: 'number',
          description: 'mm → px 스케일 (기본값: 0.5, 범위: 0.1~2)',
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
        cabinet_specs, modules, views, scale,
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

      // 4. BOM + Drawing 좌표 생성
      const bom = generateBom(designData);
      const drawing = generateDrawingData(designData, bom);

      // 5. SVG 렌더링
      const svg = renderDrawingToSvg(drawing, {
        scale,
        views: views as ('front' | 'side' | 'plan' | 'manufacturing' | 'installation')[] | undefined,
      });

      return mcpSuccess({
        success: true,
        svg,
        metadata: drawing.metadata,
      });
    } catch (error) {
      return mcpError(`SVG rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);
